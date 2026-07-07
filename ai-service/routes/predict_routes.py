"""
routes/predict_routes.py
-------------------------
Flask Blueprint exposing the surplus prediction endpoint consumed by the
Node.js backend.

Registered prefix: /predict

Routes
------
    POST /predict/surplus

Run directly (starts a dev server on port 5002):
    python predict_routes.py
"""

from flask import Blueprint, request, jsonify, Response

# Internal imports (relative, assuming the project runs from ai-service/)
try:
    from models.surplus_prediction_model import predict_surplus
except ImportError:
    import sys, os  # noqa: E401
    sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
    from models.surplus_prediction_model import predict_surplus

# ---------------------------------------------------------------------------
# Blueprint registration
# ---------------------------------------------------------------------------

predict_bp = Blueprint("predict", __name__, url_prefix="/predict")


# ---------------------------------------------------------------------------
# Route 1: POST /predict/surplus
# ---------------------------------------------------------------------------

@predict_bp.route("/surplus", methods=["POST"])
def surplus_prediction() -> tuple[Response, int]:
    """
    Predict the next surplus event for a factory based on its production
    schedule.

    Request JSON:
        {
            "factoryId":          int | str,  // factory identifier (required)
            "productionSchedule": {}          // schedule dict forwarded to model
                                              // (optional; may be empty or omitted)
        }

    Response JSON (200):
        {
            "materialType":         str,    // e.g. "chemical_solvent"
            "quantityKg":           float,  // predicted surplus quantity in kg
            "predictedSurplusDate": str,    // ISO 8601 UTC datetime string
            "confidenceScore":      float   // model confidence in [0.0, 1.0]
        }

    Error responses:
        400: Missing required fields or non-JSON body.
        500: Unexpected server error (model inference failure, unknown factory, etc.)
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

    factory_id = payload.get("factoryId")

    if factory_id is None:
        return (
            jsonify({"error": "'factoryId' is a required field."}),
            400,
        )

    # productionSchedule is optional; default to empty dict so the model
    # falls back entirely to the CSV snapshot values for that factory
    production_schedule: dict = payload.get("productionSchedule") or {}

    if not isinstance(production_schedule, dict):
        return (
            jsonify({"error": "'productionSchedule' must be a JSON object."}),
            400,
        )

    # -- Run prediction -------------------------------------------------------
    try:
        result = predict_surplus(factory_id, production_schedule)

        return (
            jsonify(
                {
                    "materialType":         result["materialType"],
                    "quantityKg":           result["quantityKg"],
                    "predictedSurplusDate": result["predictedSurplusDate"],
                    "confidenceScore":      result["confidenceScore"],
                }
            ),
            200,
        )

    except KeyError as exc:
        # factory_id not found in the snapshot — caller error
        return (
            jsonify({"error": f"Unknown factoryId: {str(exc)}"}),
            400,
        )

    except Exception as exc:
        return (
            jsonify({"error": f"Internal prediction error: {str(exc)}"}),
            500,
        )


# ---------------------------------------------------------------------------
# Demo / entry point (standalone dev server)
# ---------------------------------------------------------------------------

if __name__ == "__main__":
    from flask import Flask

    print("=" * 60)
    print("  PREDICT ROUTES - STANDALONE DEV SERVER")
    print("=" * 60)
    print("\n  Starting Flask dev server on http://127.0.0.1:5002")
    print("  Available endpoints:")
    print("    POST /predict/surplus")
    print("\n  Example cURL (predict surplus):")
    print(
        '    curl -s -X POST http://127.0.0.1:5002/predict/surplus \\\n'
        '         -H "Content-Type: application/json" \\\n'
        '         -d \'{"factoryId": 1, "productionSchedule": {}}\''
    )
    print()

    app = Flask(__name__)
    app.register_blueprint(predict_bp)
    app.run(host="127.0.0.1", port=5002, debug=True)
