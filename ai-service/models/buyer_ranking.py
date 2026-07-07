"""
models/buyer_ranking.py
------------------------
Advanced buyer-ranking module for the Industrial Symbiosis Intelligence Network.

Context / relationship to compatibility_scorer.py
--------------------------------------------------
Role 4's ``rank_buyers_by_compatibility()`` (in compatibility_scorer.py) ranks
buyers using a three-factor formula:

    compatibility (50%) + proximity (30%) + trust (20%)

This module builds on top of that baseline by introducing a fourth signal —
**surplus prediction confidence** — sourced from Role 3's
``surplus_prediction_model.predict_surplus()``.  The confidence score (0-1)
reflects how certain the RandomForest is that a surplus will actually occur
for the seller factory.  Including it lets the system surface the best buyers
only when the alert is actually reliable, rather than treating every scheduled
surplus equally.

Four-factor formula used here:
    compatibility (40%) + proximity (25%) + trust (15%) + confidence (20%)

Public API
----------
    rank_buyers_smart(seller_factory_id, seller_material, buyer_factories,
                      seller_lat, seller_lon,
                      production_schedule=None) -> dict

Run directly for a demo:
    python buyer_ranking.py
"""

import logging
import math
from typing import Any

# ---------------------------------------------------------------------------
# Internal imports (relative, assuming the project runs from ai-service/)
# ---------------------------------------------------------------------------

try:
    from nlp.embedding_utils import get_compatibility_score
    from models.surplus_prediction_model import predict_surplus
except ImportError:
    import sys, os  # noqa: E401
    sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
    from nlp.embedding_utils import get_compatibility_score
    from models.surplus_prediction_model import predict_surplus


_log = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Ranking weights (must sum to 1.0)
# ---------------------------------------------------------------------------

_WEIGHT_COMPATIBILITY: float = 0.40
_WEIGHT_PROXIMITY:     float = 0.25
_WEIGHT_TRUST:         float = 0.15
_WEIGHT_CONFIDENCE:    float = 0.20


# ---------------------------------------------------------------------------
# Haversine distance helper (local copy — avoids importing from Role 4's module)
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
# Public API
# ---------------------------------------------------------------------------

def rank_buyers_smart(
    seller_factory_id: int | str,
    seller_material: str,
    buyer_factories: list[dict[str, Any]],
    seller_lat: float,
    seller_lon: float,
    production_schedule: dict | None = None,
) -> dict[str, Any]:
    """
    Rank a list of potential buyer factories using a four-factor composite
    score that blends material compatibility, geographic proximity, trust,
    and surplus prediction confidence.

    The prediction confidence comes from Role 3's RandomForest model and
    reflects how reliably the seller factory's next surplus can be forecast.
    A high-confidence surplus triggers aggressive buyer surfacing; a
    low-confidence one produces a more conservative ranking.

    Scoring formula per buyer:
        confidence_component  = seller_confidence * 100 * 0.20
        compat_component      = get_compatibility_score(seller_material,
                                    buyer.needs_material_type) * 0.40
        proximity_component   = max(0, 100 - distance_km) * 0.25
        trust_component       = buyer.trust_score * 0.15
        total_score           = sum of all four components

    Args:
        seller_factory_id:   Integer or string factory ID of the seller
                             (used to call predict_surplus and look up features).
        seller_material:     Material type the seller has as surplus.
        buyer_factories:     List of buyer factory dicts, each containing:
                                 factory_id          (int)
                                 needs_material_type (str)
                                 latitude            (float)
                                 longitude           (float)
                                 trust_score         (float, expected 0-100)
        seller_lat:          Seller factory latitude in decimal degrees.
        seller_lon:          Seller factory longitude in decimal degrees.
        production_schedule: Optional schedule dict forwarded to predict_surplus.
                             Defaults to an empty dict (use CSV snapshot values).

    Returns:
        Dict with:
            ``rankedBuyers``          list — buyers sorted by total_score desc:
                factoryId             (int)
                compatibilityScore    (float, 0-100)
                distanceKm            (float)
                confidenceScore       (float, 0-1)  — echoed per row for the UI
                totalScore            (float)
            ``predictionConfidence``  float — seller's model confidence (0-1)
            ``materialType``          str   — resolved from predict_surplus
            ``predictedSurplusDate``  str   — ISO 8601 UTC date string
    """
    schedule = production_schedule or {}

    # -- Step 1: Get surplus prediction for the seller -----------------------
    try:
        prediction = predict_surplus(seller_factory_id, schedule)
        seller_confidence: float = float(prediction.get("confidenceScore", 0.5))
        material_type: str       = prediction.get("materialType", seller_material)
        predicted_date: str      = prediction.get("predictedSurplusDate", "")
    except Exception as exc:
        # If the model fails, default to neutral confidence and carry on
        _log.warning("predict_surplus failed for factory %s: %s", seller_factory_id, exc)
        seller_confidence = 0.5
        material_type     = seller_material
        predicted_date    = ""

    # Scale confidence from [0, 1] → [0, 100] to match the other factor ranges
    confidence_raw_100: float = seller_confidence * 100.0

    # -- Step 2: Rank buyers --------------------------------------------------
    if not buyer_factories:
        return {
            "rankedBuyers":         [],
            "predictionConfidence": seller_confidence,
            "materialType":         material_type,
            "predictedSurplusDate": predicted_date,
        }

    ranked: list[dict[str, Any]] = []

    for buyer in buyer_factories:
        try:
            factory_id     = int(buyer.get("factory_id", 0))
            needs_material = str(buyer.get("needs_material_type", ""))
            buyer_lat      = float(buyer.get("latitude", 0.0))
            buyer_lon      = float(buyer.get("longitude", 0.0))
            trust_score    = float(buyer.get("trust_score", 50.0))

            # -- Compatibility component (40%) --------------------------------
            compat_raw              = get_compatibility_score(seller_material, needs_material)
            compatibility_component = compat_raw * _WEIGHT_COMPATIBILITY

            # -- Proximity component (25%) ------------------------------------
            distance_km         = _haversine_km(seller_lat, seller_lon, buyer_lat, buyer_lon)
            proximity_raw       = max(0.0, 100.0 - distance_km)
            proximity_component = proximity_raw * _WEIGHT_PROXIMITY

            # -- Trust component (15%) ----------------------------------------
            trust_component = trust_score * _WEIGHT_TRUST

            # -- Confidence component (20%) ------------------------------------
            confidence_component = confidence_raw_100 * _WEIGHT_CONFIDENCE

            # -- Total --------------------------------------------------------
            total_score = (
                compatibility_component
                + proximity_component
                + trust_component
                + confidence_component
            )

            ranked.append(
                {
                    "factoryId":          factory_id,
                    "compatibilityScore": round(compat_raw, 2),
                    "distanceKm":         round(distance_km, 2),
                    "confidenceScore":    seller_confidence,   # 0-1, UI-friendly
                    "totalScore":         round(total_score, 2),
                }
            )

        except (TypeError, ValueError, KeyError) as exc:
            # Skip malformed buyer entries — never crash the whole ranking
            _log.warning("Skipping malformed buyer entry: %s. Reason: %s", buyer, exc)
            continue

    # Sort by total score descending
    ranked.sort(key=lambda x: x["totalScore"], reverse=True)

    return {
        "rankedBuyers":         ranked,
        "predictionConfidence": seller_confidence,
        "materialType":         material_type,
        "predictedSurplusDate": predicted_date,
    }


# ---------------------------------------------------------------------------
# Demo / entry point
# ---------------------------------------------------------------------------

if __name__ == "__main__":
    print("=" * 60)
    print("  ADVANCED BUYER RANKER - DEMO")
    print("=" * 60)

    seller_factory_id = 1          # Taiwan Plastics Taipei 01
    seller_material   = "chemical_solvent"
    seller_lat        = 25.0269
    seller_lon        = 121.6013

    buyers = [
        {
            "factory_id":          4,
            "needs_material_type": "plastic_offcut",
            "latitude":            22.6405,
            "longitude":           120.3272,
            "trust_score":         85.0,
        },
        {
            "factory_id":          5,
            "needs_material_type": "metal_offcut",
            "latitude":            22.9694,
            "longitude":           120.2236,
            "trust_score":         70.0,
        },
        {
            "factory_id":          8,
            "needs_material_type": "water",
            "latitude":            23.0304,
            "longitude":           120.2156,
            "trust_score":         90.0,
        },
        {
            "factory_id":          2,
            "needs_material_type": "water",
            "latitude":            23.0285,
            "longitude":           120.1897,
            "trust_score":         60.0,
        },
    ]

    result = rank_buyers_smart(
        seller_factory_id, seller_material, buyers, seller_lat, seller_lon
    )

    print(f"\n  Seller factory : {seller_factory_id} ({seller_material})")
    print(f"  Material type  : {result['materialType']}")
    print(f"  Surplus date   : {result['predictedSurplusDate']}")
    print(f"  AI confidence  : {result['predictionConfidence']:.4f}")
    print()
    print(f"  {'Rank':<5} {'Factory':<10} {'Compat':>8} {'Dist km':>10} "
          f"{'Confidence':>12} {'Total':>8}")
    print("  " + "-" * 58)
    for rank, r in enumerate(result["rankedBuyers"], start=1):
        print(
            f"  {rank:<5} {r['factoryId']:<10} "
            f"{r['compatibilityScore']:>8.2f} "
            f"{r['distanceKm']:>10.2f} "
            f"{r['confidenceScore']:>12.4f} "
            f"{r['totalScore']:>8.2f}"
        )
    print("=" * 60)
