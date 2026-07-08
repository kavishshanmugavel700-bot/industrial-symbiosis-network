"""
app.py
------
Flask application entry point for the Industrial Symbiosis Intelligence Network
AI microservice.

Registers all blueprints and exposes a /health endpoint for load-balancer checks.

Start with:
    flask run --port 5000
or via gunicorn (production):
    gunicorn -w 2 -b 0.0.0.0:5000 app:app
"""

import os
from flask import Flask, jsonify
from dotenv import load_dotenv

# Load environment variables from .env if present (dev convenience)
load_dotenv()

# ---------------------------------------------------------------------------
# Blueprint imports
# ---------------------------------------------------------------------------
from routes.compatibility_routes import compatibility_bp
from routes.predict_routes import predict_bp

# ---------------------------------------------------------------------------
# App factory
# ---------------------------------------------------------------------------

def create_app() -> Flask:
    """
    Create and configure the Flask application.

    Registers all route blueprints and attaches a simple health-check endpoint
    that the Node.js backend can poll to confirm the AI service is alive.

    Returns:
        Configured Flask application instance.
    """
    app = Flask(__name__)

    # -- Register blueprints -------------------------------------------------
    # Role 4 (AI/Data): compatibility scoring and buyer ranking
    app.register_blueprint(compatibility_bp)

    # Role 3 (AI Lead): surplus prediction
    app.register_blueprint(predict_bp)

    # -- Health check --------------------------------------------------------
    @app.get("/health")
    def health() -> tuple:
        """
        Lightweight liveness probe.

        Returns:
            JSON: { "status": "ok", "service": "industrial-symbiosis-ai" }
        """
        return jsonify({"status": "ok", "service": "industrial-symbiosis-ai"}), 200

    return app


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------

app = create_app()

if __name__ == "__main__":
    port = int(os.getenv("FLASK_PORT", 5000))
    debug = os.getenv("FLASK_ENV", "development") == "development"
    print(f"[INFO] AI service starting on http://0.0.0.0:{port}  (debug={debug})")
    print("[INFO] Registered routes:")
    print("         GET  /health")
    print("         POST /compatibility/parse-msds   [NEW — MSDS PDF upload]")
    print("         POST /compatibility/score")
    print("         POST /compatibility/rank-buyers")
    print("         POST /compatibility/rank-buyers-smart")
    print("         POST /predict/surplus")
    app.run(host="0.0.0.0", port=port, debug=debug)
