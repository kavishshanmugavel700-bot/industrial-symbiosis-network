"""
routes/production_routes.py
---------------------------
Flask Blueprint exposing the production-schedule PDF extraction endpoint.

Registered prefix: /extract

Routes
------
    POST /extract/production-schedule
        Accepts a multipart/form-data upload containing:
          - file       : PDF file of the factory's production schedule
          - factoryId  : (optional) integer factory ID echoed back in the response

        Extracts raw text with pdfplumber, sends it to Groq Llama-3.1-8b-instant
        requesting STRICT JSON output, validates each row, and returns:
          {
              "factoryId":     <int | null>,
              "extractedRows": [{"material_type": str, "quantity_kg": float, "production_date": str}, ...],
              "rowCount":      <int>
          }

Run directly (starts a dev server on port 5003):
    python production_routes.py
"""

import json
import os
import re
import tempfile
from datetime import datetime, timezone

import requests
from flask import Blueprint, request, jsonify, Response

try:
    import pdfplumber
except ImportError:
    pdfplumber = None  # type: ignore[assignment]

# ---------------------------------------------------------------------------
# Blueprint registration
# ---------------------------------------------------------------------------

production_bp = Blueprint("production", __name__, url_prefix="/extract")

# ---------------------------------------------------------------------------
# Internal helpers
# ---------------------------------------------------------------------------

_GROQ_API_URL = "https://api.groq.com/openai/v1/chat/completions"
_GROQ_MODEL   = "llama-3.1-8b-instant"

_SYSTEM_PROMPT = (
    "You are a production schedule parser. "
    "Extract structured data from the given text and return ONLY a raw JSON object "
    "with a single key 'schedule' whose value is an array of objects. "
    "Each object MUST have exactly these three keys:\n"
    "  - 'material_type': string (the type of material, e.g. 'metal_offcut')\n"
    "  - 'quantity_kg': number (quantity in kilograms, must be positive)\n"
    "  - 'production_date': string (date in YYYY-MM-DD format)\n"
    "Do NOT include any prose, explanation, markdown fences, or backticks. "
    "Return ONLY the raw JSON object, nothing else."
)


def _extract_text(pdf_path: str) -> str:
    """Extract all text from a PDF using pdfplumber (same approach as msds_parser.py)."""
    if pdfplumber is None:
        raise RuntimeError("pdfplumber is not installed; cannot parse PDF.")
    with pdfplumber.open(pdf_path) as pdf:
        pages = [page.extract_text() or "" for page in pdf.pages]
    return "\n".join(pages)


def _call_groq(text: str, api_key: str) -> str:
    """Send extracted text to Groq and return the raw response string."""
    payload = {
        "model": _GROQ_MODEL,
        "messages": [
            {"role": "system", "content": _SYSTEM_PROMPT},
            {
                "role": "user",
                "content": (
                    "Parse the following production schedule text and return ONLY the JSON:\n\n"
                    + text[:8000]  # cap to avoid token overflow
                ),
            },
        ],
        "temperature": 0.0,
        "max_tokens": 2000,
        "response_format": {"type": "json_object"},
    }
    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json",
    }
    resp = requests.post(_GROQ_API_URL, json=payload, headers=headers, timeout=30)
    resp.raise_for_status()
    return resp.json()["choices"][0]["message"]["content"]


def _validate_rows(raw_rows: list) -> list:
    """
    Validate and normalise extracted rows.
    Silently drops rows that fail validation rather than aborting.
    """
    today = datetime.now(tz=timezone.utc).date()
    valid = []
    for row in raw_rows:
        try:
            material_type   = str(row.get("material_type", "")).strip()
            quantity_kg     = float(row.get("quantity_kg", 0))
            production_date = str(row.get("production_date", "")).strip()

            if not material_type:
                continue
            if quantity_kg <= 0:
                continue

            # Parse date — accept YYYY-MM-DD or ISO 8601
            parsed_date = datetime.fromisoformat(production_date.replace("Z", "+00:00")).date()
            if parsed_date < today:
                continue  # skip past dates

            valid.append({
                "material_type":   material_type,
                "quantity_kg":     round(quantity_kg, 2),
                "production_date": parsed_date.isoformat(),
            })
        except (ValueError, TypeError, KeyError):
            continue

    return valid


def _parse_llm_response(raw: str) -> list:
    """
    Parse and validate the LLM JSON response.
    Returns a list of valid schedule row dicts.
    Raises ValueError if the JSON is malformed or contains no valid rows.
    """
    # Strip any accidental markdown fences the model might slip in
    cleaned = re.sub(r"```(?:json)?", "", raw).strip()
    data    = json.loads(cleaned)  # raises json.JSONDecodeError on bad JSON

    # Accept either {"schedule": [...]} or just a bare list
    if isinstance(data, list):
        rows = data
    elif isinstance(data, dict):
        rows = data.get("schedule") or data.get("entries") or []
    else:
        rows = []

    valid_rows = _validate_rows(rows)
    return valid_rows


# ---------------------------------------------------------------------------
# Route: POST /extract/production-schedule
# ---------------------------------------------------------------------------

@production_bp.route("/production-schedule", methods=["POST"])
def extract_production_schedule() -> tuple[Response, int]:
    """
    Extract a structured production schedule from an uploaded PDF.

    Request (multipart/form-data):
        file      - PDF file (required)
        factoryId - Integer factory ID (optional; echoed back in response)

    Response (200):
        {
            "factoryId":     <int | null>,
            "extractedRows": [{"material_type": str, "quantity_kg": float, "production_date": str}],
            "rowCount":      <int>
        }

    Error responses:
        400: No file provided, or LLM returned malformed JSON after retry.
        500: Unexpected server error.
    """
    # -- Validate file presence -----------------------------------------------
    if "file" not in request.files:
        return jsonify({"error": "No file field in request. Send a PDF as 'file'."}), 400

    pdf_file   = request.files["file"]
    factory_id_raw = request.form.get("factoryId")
    factory_id = int(factory_id_raw) if factory_id_raw and factory_id_raw.isdigit() else None

    api_key = os.getenv("GROQ_API_KEY", "")
    if not api_key:
        return jsonify({"error": "GROQ_API_KEY is not configured on the server."}), 500

    # -- Save PDF to a temp file and extract text ----------------------------
    try:
        with tempfile.NamedTemporaryFile(suffix=".pdf", delete=False) as tmp:
            pdf_file.save(tmp.name)
            tmp_path = tmp.name

        raw_text = _extract_text(tmp_path)
    except Exception as exc:
        return jsonify({"error": f"Failed to read PDF: {str(exc)}"}), 400
    finally:
        try:
            os.unlink(tmp_path)
        except Exception:
            pass

    if not raw_text.strip():
        return jsonify({"error": "PDF appears to contain no extractable text."}), 400

    # -- Call Groq (with one retry on bad JSON) --------------------------------
    valid_rows = []
    last_error = None
    for attempt in range(2):
        try:
            raw_response = _call_groq(raw_text, api_key)
            valid_rows   = _parse_llm_response(raw_response)
            break  # success
        except (json.JSONDecodeError, ValueError) as exc:
            last_error = str(exc)
            continue  # retry once
        except requests.RequestException as exc:
            return jsonify({"error": f"Groq API error: {str(exc)}"}), 502

    if not valid_rows and last_error:
        return jsonify({
            "error": (
                "LLM returned malformed JSON after 2 attempts. "
                f"Last error: {last_error}"
            )
        }), 400

    return jsonify({
        "factoryId":     factory_id,
        "extractedRows": valid_rows,
        "rowCount":      len(valid_rows),
    }), 200


# ---------------------------------------------------------------------------
# Demo / entry point (standalone dev server on port 5003)
# ---------------------------------------------------------------------------

if __name__ == "__main__":
    from flask import Flask

    print("=" * 60)
    print("  PRODUCTION ROUTES — STANDALONE DEV SERVER")
    print("=" * 60)
    print("\n  Starting Flask dev server on http://127.0.0.1:5003")
    print("  Available endpoints:")
    print("    POST /extract/production-schedule")
    print()
    print("  Example cURL (upload a PDF):")
    print(
        '    curl -s -X POST http://127.0.0.1:5003/extract/production-schedule \\\n'
        '         -F "factoryId=1" \\\n'
        '         -F "file=@/path/to/schedule.pdf"'
    )
    print()

    _app = Flask(__name__)
    _app.register_blueprint(production_bp)
    _app.run(host="127.0.0.1", port=5003, debug=True)
