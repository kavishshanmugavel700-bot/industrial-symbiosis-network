"""
routes/compatibility_routes.py
-------------------------------
Flask Blueprint exposing the compatibility scoring and buyer-ranking endpoints
consumed by the Node.js backend.

Registered prefix: /compatibility

Routes
------
    POST /compatibility/parse-msds         -- NEW: MSDS PDF upload and parsing
    POST /compatibility/score
    POST /compatibility/rank-buyers
    POST /compatibility/rank-buyers-smart

Run directly (starts a dev server on port 5001):
    python compatibility_routes.py
"""

import os
import re
import tempfile
from flask import Blueprint, request, jsonify, Response

# Internal imports (relative, assuming the project runs from ai-service/)
try:
    from models.compatibility_scorer import CompatibilityScorer, rank_buyers_by_compatibility
    from models.buyer_ranking import rank_buyers_smart
    from nlp.msds_parser import parse_msds, detect_hazmat, detect_reuse_potential
except ImportError:
    import sys, os as _os  # noqa: E401
    sys.path.insert(0, _os.path.join(_os.path.dirname(__file__), ".."))
    from models.compatibility_scorer import CompatibilityScorer, rank_buyers_by_compatibility
    from models.buyer_ranking import rank_buyers_smart
    from nlp.msds_parser import parse_msds, detect_hazmat, detect_reuse_potential

# ---------------------------------------------------------------------------
# Blueprint registration
# ---------------------------------------------------------------------------

compatibility_bp = Blueprint("compatibility", __name__, url_prefix="/compatibility")

# A single shared scorer instance (stateless, safe to reuse across requests)
_scorer = CompatibilityScorer()


# ---------------------------------------------------------------------------
# Text-analysis helpers — thin wrappers around nlp/msds_parser.py
# (Gap 2: msds_parser.py is the single source of truth for these signals;
#  the implementations here were merged into the shared module and deleted)
# ---------------------------------------------------------------------------

# Flash-point extractor kept here only for the /score route's flash-point logging;
# actual hazmat/reuse decisions now go through the shared msds_parser functions.
_FLASH_POINT_PATTERN: re.Pattern = re.compile(
    r"flash\s+point\s*[:\-]?\s*([\-\d\.]+)\s*(?:deg\s*C|[\u00b0]C|C)\b",
    re.IGNORECASE,
)


def detect_hazmat_from_text(text: str) -> bool:
    """
    Determine whether MSDS text indicates a hazardous material.

    Thin wrapper — delegates to ``nlp.msds_parser.detect_hazmat`` which is the
    single source of truth (Gap 2 fix).  Kept here so existing callers inside
    this module do not need renaming.

    Args:
        text: Raw MSDS text (may be multi-line, mixed case).

    Returns:
        True if hazardous signals are found, False otherwise.
    """
    return detect_hazmat(text)


def detect_reuse_from_text(text: str) -> str:
    """
    Infer the reuse potential category from MSDS text.

    Thin wrapper — delegates to ``nlp.msds_parser.detect_reuse_potential`` which
    is the single source of truth (Gap 2 fix).  Kept here so existing callers
    inside this module do not need renaming.

    Args:
        text: Raw MSDS text (may be multi-line, mixed case).

    Returns:
        One of "HIGH", "MEDIUM", or "LOW".
    """
    return detect_reuse_potential(text)


# ---------------------------------------------------------------------------
# Route 0: POST /compatibility/parse-msds   (Gap 1 — NEW)
# ---------------------------------------------------------------------------

@compatibility_bp.route("/parse-msds", methods=["POST"])
def parse_msds_route() -> tuple[Response, int]:
    """
    Accept a multipart/form-data PDF upload, parse the MSDS, and return
    structured chemical information as JSON.

    This endpoint is the platform's advertised MSDS PDF upload entry point.
    The Node.js backend should forward the file from a multer (or equivalent)
    file-upload route to this endpoint.

    Request:
        multipart/form-data  field name: "file"  (PDF)

    Response JSON (200):
        {
            "material_name":       str,
            "chemical_properties": dict,
            "isHazmat":            bool,
            "hazard_class":        str | null,
            "reuse_potential":     str,   // "HIGH" | "MEDIUM" | "LOW"
            "raw_text":            str
        }

    Error responses:
        400: No file uploaded, wrong field name, or empty file.
        500: Unexpected server error during parsing.
    """
    # -- Validate upload ------------------------------------------------------
    if "file" not in request.files:
        return (
            jsonify({"error": "No file field in request. Expected multipart/form-data with field name 'file'."}),
            400,
        )

    uploaded_file = request.files["file"]
    if uploaded_file.filename == "" or not uploaded_file.filename:
        return (
            jsonify({"error": "Uploaded file has no filename. Send a valid PDF."}),
            400,
        )

    # -- Save to temp file, parse, clean up -----------------------------------
    tmp_path: str | None = None
    try:
        # Write to a named temp file so pdfplumber can open it by path
        suffix = os.path.splitext(uploaded_file.filename or "")[-1] or ".pdf"
        with tempfile.NamedTemporaryFile(delete=False, suffix=suffix) as tmp:
            uploaded_file.save(tmp)
            tmp_path = tmp.name

        result = parse_msds(tmp_path)

        # parse_msds returns _DEFAULT_RESULT on total failure (material_name == "Unknown",
        # raw_text == "").  Treat that as a parse failure and return 400.
        if result.get("raw_text", "") == "" and result.get("material_name") == "Unknown":
            return (
                jsonify({"error": "Could not extract text from the uploaded PDF. Ensure it is a text-layer PDF, not a scanned image."}),
                400,
            )

        return jsonify(result), 200

    except Exception as exc:
        return (
            jsonify({"error": f"Unexpected error during MSDS parsing: {str(exc)}"}),
            500,
        )
    finally:
        # Always clean up the temp file
        if tmp_path and os.path.exists(tmp_path):
            try:
                os.remove(tmp_path)
            except OSError:
                pass  # best-effort cleanup


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
# Route 3: POST /compatibility/rank-buyers-smart
# ---------------------------------------------------------------------------

@compatibility_bp.route("/rank-buyers-smart", methods=["POST"])
def rank_buyers_advanced() -> tuple[Response, int]:
    """
    Rank a list of potential buyer factories using a four-factor composite
    score that extends Role 4's baseline ranker with surplus prediction
    confidence from the RandomForest model (Role 3).

    Four factors (weights):
        compatibility (40%) + proximity (25%) + trust (15%) + confidence (20%)

    Request JSON:
        {
            "sellerFactoryId": int,   // required — used to call predict_surplus
            "sellerMaterial":  str,   // e.g. "chemical_solvent"
            "sellerLat":       float, // seller latitude
            "sellerLon":       float, // seller longitude
            "buyerFactories":  [      // list of buyer dicts
                {
                    "factory_id":          int,
                    "needs_material_type": str,
                    "latitude":            float,
                    "longitude":           float,
                    "trust_score":         float   // 0-100
                },
                ...
            ],
            "productionSchedule": {}  // optional — forwarded to predict_surplus
        }

    Response JSON (200):
        {
            "rankedBuyers": [
                {
                    "factoryId":          int,
                    "compatibilityScore": float,
                    "distanceKm":         float,
                    "confidenceScore":    float,   // seller model confidence 0-1
                    "totalScore":         float
                },
                ...
            ],
            "predictionConfidence": float,  // seller-level confidence (0-1)
            "materialType":         str,    // resolved from predict_surplus
            "predictedSurplusDate": str     // ISO 8601 UTC
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
        field for field in ("sellerFactoryId", "sellerMaterial", "sellerLat", "sellerLon", "buyerFactories")
        if field not in payload
    ]
    if missing:
        return (
            jsonify({"error": f"Missing required field(s): {', '.join(missing)}"}),
            400,
        )

    seller_factory_id = payload["sellerFactoryId"]
    seller_material: str = payload["sellerMaterial"]
    buyer_factories: list = payload["buyerFactories"]
    production_schedule: dict = payload.get("productionSchedule") or {}

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
        result = rank_buyers_smart(
            seller_factory_id,
            seller_material,
            buyer_factories,
            seller_lat,
            seller_lon,
            production_schedule=production_schedule,
        )
        return (
            jsonify(result),
            200,
        )
    except KeyError as exc:
        return (
            jsonify({"error": f"Unknown sellerFactoryId: {str(exc)}"}),
            400,
        )
    except Exception as exc:
        return (
            jsonify({"error": f"Internal smart-ranking error: {str(exc)}"}),
            500,
        )


# ---------------------------------------------------------------------------
# Route 4: POST /compatibility/explain-match
# ---------------------------------------------------------------------------

@compatibility_bp.route("/explain-match", methods=["POST"])
def explain_match() -> tuple[Response, int]:
    """
    Generate a natural-language explanation of why a match between a seller
    factory and a buyer factory is strong, powered by Claude 3.5 Sonnet.

    Request JSON:
        {
            "sellerMaterial":     str,   // e.g. "chemical_solvent"
            "sellerFactoryName":  str,   // e.g. "Kaohsiung Petrochemical"
            "buyerFactoryName":   str,   // e.g. "Tainan Textile"
            "buyerNeedsMaterial": str,   // e.g. "chemical_solvent"
            "compatibilityScore": float, // 0-100 compatibility score
            "distanceKm":         float, // distance in km
            "confidenceScore":    float, // surplus prediction confidence 0-100
            "predictedSurplusDate": str  // predicted date of surplus
        }

    Response JSON (200):
        {
            "explanation": str
        }
    """
    try:
        payload = request.get_json(force=True, silent=True)
    except Exception:
        payload = None

    if not payload:
        return (
            jsonify({"error": "Request body must be valid JSON."}),
            400,
        )

    # Extract match parameters
    seller_material = payload.get("sellerMaterial", "unknown material")
    seller_factory_name = payload.get("sellerFactoryName", "Seller Facility")
    buyer_factory_name = payload.get("buyerFactoryName", "Buyer Facility")
    buyer_needs_material = payload.get("buyerNeedsMaterial", "unknown material")
    compatibility_score = payload.get("compatibilityScore", 90.0)
    distance_km = payload.get("distanceKm", 0.0)
    confidence_score = payload.get("confidenceScore", 95.0)
    predicted_surplus_date = payload.get("predictedSurplusDate", "soon")

    fallback_explanation = f"Strong match between {seller_factory_name} and {buyer_factory_name} based on high material compatibility ({compatibility_score}%) and proximity ({distance_km} km)."

    # Read API Key
    api_key = os.getenv("GROQ_API_KEY")
    if not api_key:
        # Graceful fallback if key is missing
        return jsonify({"explanation": fallback_explanation}), 200

    try:
        import requests
        
        # System prompt and user message
        system_prompt = (
            "You are an AI assistant specialized in industrial symbiosis and circular economy. "
            "Keep your explanations concise, professional, and limited to exactly 2-3 sentences. "
            "Do not include introductory text, warnings, pleasantries, or Markdown formatting. "
            "Explain why the match is a good fit."
        )
        
        user_message = (
            f"Explain why this industrial symbiosis match is strong based on the following data:\n"
            f"- Seller Factory: {seller_factory_name} (has surplus {seller_material})\n"
            f"- Buyer Factory: {buyer_factory_name} (needs {buyer_needs_material})\n"
            f"- Material Compatibility Score: {compatibility_score}%\n"
            f"- Distance between factories: {distance_km} km\n"
            f"- Surplus Prediction Date: {predicted_surplus_date}\n"
            f"- AI Match Confidence: {confidence_score}%\n\n"
            f"Highlight the material synergy, geographical feasibility (short distance), and timely exchange."
        )

        headers = {
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json"
        }
        
        payload_data = {
            "model": "llama-3.1-8b-instant",
            "messages": [
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_message}
            ],
            "temperature": 0.0,
            "max_tokens": 150
        }
        
        response = requests.post(
            "https://api.groq.com/openai/v1/chat/completions",
            json=payload_data,
            headers=headers,
            timeout=5.0
        )
        
        if response.status_code == 200:
            res_json = response.json()
            explanation = res_json["choices"][0]["message"]["content"].strip()
            explanation = explanation.strip('"').strip("'")
            return jsonify({"explanation": explanation}), 200
        else:
            print(f"[WARNING] Groq API returned status code {response.status_code}: {response.text}")
            return jsonify({"explanation": fallback_explanation}), 200

    except Exception as exc:
        print(f"[WARNING] Groq API call failed: {str(exc)}")
        # Graceful fallback on API failure
        return jsonify({"explanation": fallback_explanation}), 200


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
    print("    POST /compatibility/parse-msds")
    print("    POST /compatibility/score")
    print("    POST /compatibility/rank-buyers")
    print("    POST /compatibility/rank-buyers-smart")
    print("\n  Example cURL (parse-msds):")
    print(
        '    curl -s -X POST http://127.0.0.1:5001/compatibility/parse-msds \\\n'
        '         -F "file=@nlp/sample_msds/hazmat_solvent.pdf"'
    )
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
