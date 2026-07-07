"""
models/compatibility_scorer.py
-------------------------------
Core compatibility scoring logic for the Industrial Symbiosis Intelligence
Network.  Combines material-pair lookup scores with MSDS-derived hazmat /
reuse signals and geographic + trust-weighted buyer ranking.

Public API
----------
    CompatibilityScorer.score(material_type, msds_data) -> dict
    rank_buyers_by_compatibility(seller_material, buyer_factories,
                                 seller_lat, seller_lon) -> list

Run directly for a demo:
    python compatibility_scorer.py
"""

import math
from typing import Any

# Internal imports (relative, assuming the project is run from ai-service/)
try:
    from nlp.embedding_utils import get_compatibility_score
except ImportError:
    # Fallback when the module is run standalone from the models/ directory
    import sys, os  # noqa: E401
    sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
    from nlp.embedding_utils import get_compatibility_score


# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

_HAZMAT_PENALTY:    float = 30.0  # deducted when material is flagged hazardous
_HIGH_REUSE_BONUS:  float = 10.0  # added when reuse_potential == "HIGH"
_SCORE_MIN:         float = 0.0
_SCORE_MAX:         float = 100.0

# Ranking weights (must sum to 1.0)
_WEIGHT_COMPATIBILITY: float = 0.5
_WEIGHT_PROXIMITY:     float = 0.3
_WEIGHT_TRUST:         float = 0.2


# ---------------------------------------------------------------------------
# Haversine distance helper
# ---------------------------------------------------------------------------

def _haversine_km(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    """
    Calculate the great-circle distance between two geographic points using
    the Haversine formula.

    Args:
        lat1: Latitude of point A in decimal degrees.
        lon1: Longitude of point A in decimal degrees.
        lat2: Latitude of point B in decimal degrees.
        lon2: Longitude of point B in decimal degrees.

    Returns:
        Distance in kilometres (non-negative float).
    """
    earth_radius_km = 6_371.0
    phi1 = math.radians(lat1)
    phi2 = math.radians(lat2)
    dphi = math.radians(lat2 - lat1)
    dlambda = math.radians(lon2 - lon1)

    a = (
        math.sin(dphi / 2) ** 2
        + math.cos(phi1) * math.cos(phi2) * math.sin(dlambda / 2) ** 2
    )
    c = 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))
    return earth_radius_km * c


# ---------------------------------------------------------------------------
# CompatibilityScorer class
# ---------------------------------------------------------------------------

class CompatibilityScorer:
    """
    Scores how compatible a surplus material is for industrial reuse based on:

    1. A base score from the MAESTRI-informed material compatibility lookup.
    2. Adjustments derived from MSDS data (hazmat status, reuse potential).

    The resulting score is clamped to [0, 100].
    """

    def score(self, material_type: str, msds_data: dict) -> dict:
        """
        Compute a composite compatibility score for a given material and its
        associated MSDS-derived properties.

        Scoring logic:
            base_score  = MATERIAL_COMPATIBILITY_TABLE[material_type -> material_type]
            adjustments:
                -30 if msds_data["isHazmat"] is True
                +10 if msds_data["reuse_potential"] == "HIGH"
            final_score = clamp(base_score + adjustments, 0, 100)

        Args:
            material_type: The material type string (e.g. "chemical_solvent").
            msds_data:     Dict with at least these keys:
                               isHazmat       (bool)
                               reuse_potential (str: "HIGH" | "MEDIUM" | "LOW")
                           Missing keys default to safe values (no hazmat, medium reuse).

        Returns:
            Dict with:
                score       (float) - Final clamped score [0-100]
                isHazmat    (bool)  - Echoed from msds_data
                adjustments (list)  - Human-readable explanation of score changes
        """
        adjustments: list[str] = []

        # 1. Base score: same-material reuse compatibility
        base_score = get_compatibility_score(material_type, material_type)
        adjustments.append(
            f"Base score for '{material_type}' -> '{material_type}': {base_score:.1f}"
        )

        running_score = base_score

        # 2. Hazmat penalty
        is_hazmat: bool = bool(msds_data.get("isHazmat", False))
        if is_hazmat:
            running_score -= _HAZMAT_PENALTY
            adjustments.append(
                f"Hazmat penalty applied: -{_HAZMAT_PENALTY:.1f} "
                f"(material flagged as hazardous)"
            )

        # 3. High-reuse bonus
        reuse_potential: str = str(msds_data.get("reuse_potential", "MEDIUM")).upper()
        if reuse_potential == "HIGH":
            running_score += _HIGH_REUSE_BONUS
            adjustments.append(
                f"High-reuse bonus applied: +{_HIGH_REUSE_BONUS:.1f} "
                f"(reuse_potential == 'HIGH')"
            )

        # 4. Clamp
        final_score = max(_SCORE_MIN, min(_SCORE_MAX, running_score))
        if final_score != running_score:
            adjustments.append(
                f"Score clamped from {running_score:.1f} to {final_score:.1f}"
            )

        return {
            "score":       round(final_score, 2),
            "isHazmat":    is_hazmat,
            "adjustments": adjustments,
        }


# ---------------------------------------------------------------------------
# Buyer ranking function
# ---------------------------------------------------------------------------

def rank_buyers_by_compatibility(
    seller_material: str,
    buyer_factories: list[dict[str, Any]],
    seller_lat: float,
    seller_lon: float,
) -> list[dict[str, Any]]:
    """
    Rank a list of potential buyer factories by a weighted composite score
    that accounts for material compatibility, geographic proximity, and trust.

    Scoring formula per buyer:
        compatibility_component = get_compatibility_score(seller_material,
                                      buyer.needs_material_type) * 0.5
        proximity_component     = max(0, 100 - distance_km) * 0.3
        trust_component         = buyer.trust_score * 0.2
        total_score             = sum of the above three components

    Args:
        seller_material:  Material type the seller has as surplus.
        buyer_factories:  List of buyer factory dicts, each containing:
                              factory_id        (int)
                              needs_material_type (str)
                              latitude          (float)
                              longitude         (float)
                              trust_score       (float, expected 0-100)
        seller_lat:       Seller factory latitude in decimal degrees.
        seller_lon:       Seller factory longitude in decimal degrees.

    Returns:
        List of result dicts sorted by total_score descending:
            [
                {
                    "factoryId":          int,
                    "compatibilityScore": float,   # 0-100
                    "distanceKm":         float,
                    "totalScore":         float,
                },
                ...
            ]
        Returns an empty list if buyer_factories is empty or None.
    """
    if not buyer_factories:
        return []

    ranked: list[dict[str, Any]] = []

    for buyer in buyer_factories:
        try:
            factory_id       = int(buyer.get("factory_id", 0))
            needs_material   = str(buyer.get("needs_material_type", ""))
            buyer_lat        = float(buyer.get("latitude", 0.0))
            buyer_lon        = float(buyer.get("longitude", 0.0))
            trust_score      = float(buyer.get("trust_score", 50.0))

            # -- Compatibility component ----------------------------------
            compat_raw = get_compatibility_score(seller_material, needs_material)
            compatibility_component = compat_raw * _WEIGHT_COMPATIBILITY

            # -- Proximity component --------------------------------------
            distance_km = _haversine_km(seller_lat, seller_lon, buyer_lat, buyer_lon)
            proximity_raw = max(0.0, 100.0 - distance_km)
            proximity_component = proximity_raw * _WEIGHT_PROXIMITY

            # -- Trust component ------------------------------------------
            trust_component = trust_score * _WEIGHT_TRUST

            # -- Total ----------------------------------------------------
            total_score = compatibility_component + proximity_component + trust_component

            ranked.append(
                {
                    "factoryId":          factory_id,
                    "compatibilityScore": round(compat_raw, 2),
                    "distanceKm":         round(distance_km, 2),
                    "totalScore":         round(total_score, 2),
                }
            )

        except (TypeError, ValueError, KeyError) as exc:
            # Skip malformed buyer entries - never crash the whole ranking
            print(f"[WARN] Skipping malformed buyer entry: {buyer}. Reason: {exc}")
            continue

    # Sort by total score descending
    ranked.sort(key=lambda x: x["totalScore"], reverse=True)
    return ranked


# ---------------------------------------------------------------------------
# Demo / entry point
# ---------------------------------------------------------------------------

if __name__ == "__main__":
    print("=" * 60)
    print("  COMPATIBILITY SCORER - DEMO")
    print("=" * 60)

    scorer = CompatibilityScorer()

    # -- CompatibilityScorer.score() demo----
    test_cases = [
        {
            "material_type": "chemical_solvent",
            "msds_data":     {"isHazmat": False, "reuse_potential": "HIGH"},
        },
        {
            "material_type": "chemical_solvent",
            "msds_data":     {"isHazmat": True,  "reuse_potential": "MEDIUM"},
        },
        {
            "material_type": "organic_sludge",
            "msds_data":     {"isHazmat": False, "reuse_potential": "HIGH"},
        },
        {
            "material_type": "metal_offcut",
            "msds_data":     {"isHazmat": False, "reuse_potential": "MEDIUM"},
        },
    ]

    print("\n-- CompatibilityScorer.score() " + "-" * 28)
    for tc in test_cases:
        result = scorer.score(tc["material_type"], tc["msds_data"])
        print(f"\n  Material : {tc['material_type']}")
        print(f"  MSDS     : {tc['msds_data']}")
        print(f"  Score    : {result['score']}")
        print(f"  isHazmat : {result['isHazmat']}")
        for adj in result["adjustments"]:
            print(f"             * {adj}")

    # -- rank_buyers_by_compatibility() demo
    print("\n-- rank_buyers_by_compatibility() " + "-" * 25)

    seller_material = "chemical_solvent"
    seller_lat, seller_lon = 25.0330, 121.5654  # Taipei

    buyers = [
        {
            "factory_id":          1,
            "needs_material_type": "chemical_solvent",
            "latitude":            24.9936,
            "longitude":           121.3010,
            "trust_score":         80.0,
        },
        {
            "factory_id":          2,
            "needs_material_type": "heat_energy",
            "latitude":            22.6273,
            "longitude":           120.3014,
            "trust_score":         90.0,
        },
        {
            "factory_id":          3,
            "needs_material_type": "organic_sludge",
            "latitude":            24.1477,
            "longitude":           120.6736,
            "trust_score":         60.0,
        },
        {
            "factory_id":          4,
            "needs_material_type": "textile_dyeing",
            "latitude":            24.8138,
            "longitude":           120.9675,
            "trust_score":         75.0,
        },
    ]

    ranked = rank_buyers_by_compatibility(seller_material, buyers, seller_lat, seller_lon)
    print(f"\n  Seller: {seller_material!r} at ({seller_lat}, {seller_lon})")
    print(f"\n  {'Rank':<5} {'Factory ID':<12} {'Compat':>8} {'Dist km':>10} {'Total':>8}")
    print("  " + "-" * 48)
    for rank, r in enumerate(ranked, start=1):
        print(
            f"  {rank:<5} {r['factoryId']:<12} "
            f"{r['compatibilityScore']:>8.2f} "
            f"{r['distanceKm']:>10.2f} "
            f"{r['totalScore']:>8.2f}"
        )
    print("=" * 60)
