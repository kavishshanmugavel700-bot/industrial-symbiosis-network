"""
routes/compatibility_routes.py
-------------------------------
Flask Blueprint exposing the compatibility scoring and buyer-ranking endpoints
consumed by the Node.js backend.

Registered prefix: /compatibility

Routes
------
    POST /compatibility/score
    POST /compatibility/rank-buyers

Run directly (starts a dev server on port 5001):
    python compatibility_routes.py
"""

import re
from flask import Blueprint, request, jsonify, Response

# Internal imports (relative, assuming the project runs from ai-service/)
try:
    from models.compatibility_scorer import CompatibilityScorer, rank_buyers_by_compatibility
except ImportError:
    import sys, os  # noqa: E401
    sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
    from models.compatibility_scorer import CompatibilityScorer, rank_buyers_by_compatibility

# ---------------------------------------------------------------------------
# Blueprint registration
# ---------------------------------------------------------------------------

compatibility_bp = Blueprint("compatibility", __name__, url_prefix="/compatibility")

# A single shared scorer instance (stateless, safe to reuse across requests)
_scorer = CompatibilityScorer()


# ---------------------------------------------------------------------------
# Text-analysis helpers (no model loading - pure keyword scanning)
# ---------------------------------------------------------------------------

# GHS hazard codes and keyword signals
_HAZMAT_GHS_PATTERN: re.Pattern = re.compile(
    r"\b(H[2-4]\d{2}[A-Za-z]?)\b", re.IGNORECASE
)
# Compiled word-boundary pattern avoids false positives like "non-hazardous"
_HAZMAT_KW_PATTERN: re.Pattern = re.compile(
    r"(?<![\w-])(?:"
    r"flammable|explosive|(?<!non[-\s])toxic|corrosive|oxidis[ei]r|oxidizer|"
    r"carcinogen|mutagen|poison|radioactive|compressed\s+gas|"
    r"pyrophoric|self[-\s]reactive|(?<!non[-\s])hazardous"
    r")(?![\w-])",
    re.IGNORECASE,
)

# Reuse-positive and reuse-negative signal words
_REUSE_HIGH_KEYWORDS: tuple[str, ...] = (
    "reusable", "recoverable", "recyclable", "non-hazardous", "non hazardous",
    "safe for reuse", "biodegradable", "food grade", "industrial grade",
)
_REUSE_LOW_KEYWORDS: tuple[str, ...] = (
    "carcinogen", "mutagen", "teratogen", "persistent", "bioaccumulat",
    "highly toxic", "acutely toxic", "environmentally hazardous",
)

# Flash-point extractor — accepts both '°C' and 'deg C' forms
_FLASH_POINT_PATTERN: re.Pattern = re.compile(
    r"flash\s+point\s*[:\-]?\s*([\-\d\.]+)\s*(?:deg\s*C|[\u00b0]C|C)\b",
    re.IGNORECASE,
)
_PH_PATTERN: re.Pattern = re.compile(
    r"\bpH\s*[:\-]?\s*([\d\.]+)\s*(?:to|[-])\s*([\d\.]+)|\bpH\s*[:\-]?\s*([\d\.]+)",
    re.IGNORECASE,
)


def detect_hazmat_from_text(text: str) -> bool:
    """
    Determine whether MSDS text indicates a hazardous material using simple
    keyword and GHS-code scanning - no NLP model required.

    Signals checked:
    - Presence of GHS hazard statement codes (H2xx, H3xx, H4xx).
    - Presence of one or more hazmat keywords (flammable, toxic, etc.).

    Args:
        text: Raw MSDS text (may be multi-line, mixed case).

    Returns:
        True if hazardous signals are found, False otherwise.
    """
    if not text:
        return False

    # Check for GHS codes
    if _HAZMAT_GHS_PATTERN.search(text):
        return True

    # Check for keyword matches using word-boundary regex
    # (avoids false positives like 'non-hazardous' triggering 'hazardous')
    return bool(_HAZMAT_KW_PATTERN.search(text))


def detect_reuse_from_text(text: str) -> str:
    """
    Infer the reuse potential category from MSDS text using keyword heuristics.

    Rules (in order of precedence):
    1. LOW:    Text contains one or more reuse-negative keywords (carcinogen,
               persistent, highly toxic, etc.) regardless of other signals.
    2. HIGH:   Text contains reuse-positive keywords (reusable, recyclable ...)
               OR flash point > 60  degC AND pH in neutral range [6, 8].
    3. MEDIUM: Default when no strong signal is found.

    Args:
        text: Raw MSDS text (may be multi-line, mixed case).

    Returns:
        One of "HIGH", "MEDIUM", or "LOW".
    """
    if not text:
        return "MEDIUM"

    text_lower = text.lower()

    # 1. Low reuse - serious hazard signals
    if any(kw in text_lower for kw in _REUSE_LOW_KEYWORDS):
        return "LOW"

    # 2. High reuse - positive keyword or favourable physical properties
    has_positive_kw = any(kw in text_lower for kw in _REUSE_HIGH_KEYWORDS)

    flash_point: float | None = None
    fp_match = _FLASH_POINT_PATTERN.search(text)
    if fp_match:
        try:
            flash_point = float(fp_match.group(1))
        except (ValueError, TypeError):
            pass

    ph: float | None = None
    ph_match = _PH_PATTERN.search(text)
    if ph_match:
        try:
            if ph_match.group(1) and ph_match.group(2):
                ph = (float(ph_match.group(1)) + float(ph_match.group(2))) / 2
            else:
                val = ph_match.group(1) or ph_match.group(3)
                ph = float(val) if val else None
        except (ValueError, TypeError):
            pass

    has_favourable_props = (
        (flash_point is not None and flash_point > 60)
        or (ph is not None and 6.0 <= ph <= 8.0)
    )

    if has_positive_kw or has_favourable_props:
        return "HIGH"

    return "MEDIUM"


# ---------------------------------------------------------------------------
# Route 1: POST /compatibility/score
# ---------------------------------------------------------------------------

@compatibility_bp.route("/score", methods=["POST"])
def score_compatibility() -> tuple[Response, int]:
    """
    Score the compatibility of a material type using MSDS text analysis.

    Request JSON:
        {
            "materialType": str,   // e.g. "chemical_solvent"
            "msdsText":     str    // raw text extracted from the MSDS PDF
        }

    Response JSON (200):
        {
            "score":    float,  // 0-100
            "isHazmat": bool
        }

    Error responses:
        400: Missing required fields or non-JSON body.
        500: Unexpected server error.
    """
    # -- Parse request --------------------------------------------------------
    try:
        payload = request.get_json(force=True, silent=True)
    except Exception:
        payload = None

    if not payload:
        return (
            jsonify({"error": "Request body must be valid JSON."}),
            400,
        )

    material_type: str | None = payload.get("materialType")
    msds_text: str | None     = payload.get("msdsText")

    if not material_type:
        return (
            jsonify({"error": "'materialType' is a required field."}),
            400,
        )

    # msdsText is optional - default to empty string if omitted
    msds_text = msds_text or ""

    # -- Detect hazmat and reuse potential from text --------------------------
    try:
        is_hazmat      = detect_hazmat_from_text(msds_text)
        reuse_potential = detect_reuse_from_text(msds_text)

        msds_data = {
            "isHazmat":       is_hazmat,
            "reuse_potential": reuse_potential,
        }

        # -- Score ------------------------------------------------------------
        result = _scorer.score(material_type, msds_data)

        return (
            jsonify(
                {
                    "score":    result["score"],
                    "isHazmat": result["isHazmat"],
                }
            ),
            200,
        )

    except Exception as exc:
        return (
            jsonify({"error": f"Internal scoring error: {str(exc)}"}),
            500,
        )


# ---------------------------------------------------------------------------
# Route 2: POST /compatibility/rank-buyers
# ---------------------------------------------------------------------------

@compatibility_bp.route("/rank-buyers", methods=["POST"])
def rank_buyers() -> tuple[Response, int]:
    """
    Rank a list of potential buyer factories for a given surplus material by
    compatibility, proximity, and trust score.

    Request JSON:
        {
            "sellerMaterial": str,    // e.g. "organic_sludge"
            "sellerLat":      float,  // seller latitude
            "sellerLon":      float,  // seller longitude
            "buyerFactories": [       // list of buyer dicts
                {
                    "factory_id":          int,
                    "needs_material_type": str,
                    "latitude":            float,
                    "longitude":           float,
                    "trust_score":         float   // 0-100
                },
                ...
            ]
        }

    Response JSON (200):
        {
            "rankedBuyers": [
                {
                    "factoryId":          int,
                    "compatibilityScore": float,
                    "distanceKm":         float,
                    "totalScore":         float
                },
                ...
            ]
        }

    Error responses:
        400: Missing required fields or invalid JSON.
        500: Unexpected server error.
    """
    # -- Parse request --------------------------------------------------------
    try:
        payload = request.get_json(force=True, silent=True)
    except Exception:
        payload = None

    if not payload:
        return (
            jsonify({"error": "Request body must be valid JSON."}),
            400,
        )

    # Validate required fields
    missing = [
        field for field in ("sellerMaterial", "sellerLat", "sellerLon", "buyerFactories")
        if field not in payload
    ]
    if missing:
        return (
            jsonify({"error": f"Missing required field(s): {', '.join(missing)}"}),
            400,
        )

    seller_material: str = payload["sellerMaterial"]
    buyer_factories: list = payload["buyerFactories"]

    try:
        seller_lat = float(payload["sellerLat"])
        seller_lon = float(payload["sellerLon"])
    except (TypeError, ValueError):
        return (
            jsonify({"error": "'sellerLat' and 'sellerLon' must be numeric values."}),
            400,
        )

    if not isinstance(buyer_factories, list):
        return (
            jsonify({"error": "'buyerFactories' must be a JSON array."}),
            400,
        )

    # -- Rank -----------------------------------------------------------------
    try:
        ranked = rank_buyers_by_compatibility(
            seller_material, buyer_factories, seller_lat, seller_lon
        )
        return (
            jsonify({"rankedBuyers": ranked}),
            200,
        )
    except Exception as exc:
        return (
            jsonify({"error": f"Internal ranking error: {str(exc)}"}),
            500,
        )


# ---------------------------------------------------------------------------
# Demo / entry point (standalone dev server)
# ---------------------------------------------------------------------------

if __name__ == "__main__":
    from flask import Flask

    print("=" * 60)
    print("  COMPATIBILITY ROUTES - STANDALONE DEV SERVER")
    print("=" * 60)
    print("\n  Starting Flask dev server on http://127.0.0.1:5001")
    print("  Available endpoints:")
    print("    POST /compatibility/score")
    print("    POST /compatibility/rank-buyers")
    print("\n  Example cURL (score):")
    print(
        '    curl -s -X POST http://127.0.0.1:5001/compatibility/score \\\n'
        '         -H "Content-Type: application/json" \\\n'
        '         -d \'{"materialType":"chemical_solvent","msdsText":"H225 flammable"}\''
    )
    print()

    app = Flask(__name__)
    app.register_blueprint(compatibility_bp)
    app.run(host="127.0.0.1", port=5001, debug=True)
