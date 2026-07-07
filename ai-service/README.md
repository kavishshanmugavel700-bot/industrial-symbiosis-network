# ai-service/README.md

## Industrial Symbiosis AI Microservice

Python/Flask microservice providing NLP, compatibility scoring, and surplus prediction for the Industrial Symbiosis Intelligence Network.

---

## Endpoints

### GET /health
Liveness probe for load-balancer checks.

**Response:**
`json
{ "status": "ok", "service": "industrial-symbiosis-ai" }
`

---

### POST /compatibility/parse-msds  *(NEW — MSDS PDF Upload)*

Accepts a multipart/form-data PDF upload, extracts text with pdfplumber, and returns structured chemical information.

**Request:** multipart/form-data, field name ile (PDF)

**Response (200):**
`json
{
  "material_name":       "MEK Solvent (Methyl Ethyl Ketone)",
  "chemical_properties": { "flash_point": "Flash Point: -9 deg C ...", "boiling_point": "..." },
  "isHazmat":            true,
  "hazard_class":        "H225, H319, H336, UN Class 3",
  "reuse_potential":     "LOW",
  "raw_text":            "<full extracted PDF text>"
}
`

**Error (400):** Missing file, empty file, or non-text-layer (scanned image) PDF.

**cURL example:**
`ash
curl -X POST http://localhost:5000/compatibility/parse-msds \
     -F "file=@nlp/sample_msds/hazmat_solvent.pdf"
`

> **Integration note for Backend Lead (Role 1/2):**
> The Node.js backend needs a multer route that accepts the PDF from the browser
> and forwards it to this endpoint. A stub function parseMsds({ filePath })
> is already wired up in ackend/src/services/aiClient.service.js — see
> the JSDoc comment there for a complete Express/multer route example.

---

### POST /compatibility/score

Scores the compatibility of a material type using MSDS text analysis.

**Request (JSON):**
`json
{ "materialType": "chemical_solvent", "msdsText": "H225 flammable liquid..." }
`

**Response (200):**
`json
{ "score": 65.0, "isHazmat": true }
`

**cURL example:**
`ash
curl -X POST http://localhost:5000/compatibility/score \
     -H "Content-Type: application/json" \
     -d '{"materialType":"chemical_solvent","msdsText":"H225 highly flammable"}'
`

---

### POST /compatibility/rank-buyers

Ranks candidate buyer factories by compatibility, proximity, and trust score.

**Request (JSON):**
`json
{
  "sellerMaterial": "organic_sludge",
  "sellerLat": 25.0330, "sellerLon": 121.5654,
  "buyerFactories": [
    { "factory_id": 1, "needs_material_type": "heat_energy",
      "latitude": 24.99, "longitude": 121.30, "trust_score": 80.0 }
  ]
}
`

**Response (200):**
`json
{ "rankedBuyers": [{ "factoryId": 1, "compatibilityScore": 85.0, "distanceKm": 30.5, "totalScore": 61.5 }] }
`

---

### POST /compatibility/rank-buyers-smart

Four-factor ranking: compatibility (40%) + proximity (25%) + trust (15%) + prediction confidence (20%).

**Request (JSON):** Same as rank-buyers plus "sellerFactoryId": int (required) and optional "productionSchedule": {}.

---

### POST /predict/surplus  *(Role 3 — do not modify)*

Calls the surplus prediction RandomForest model.

---

## Running Locally

`ash
# From the ai-service/ directory
python app.py
# or for production:
gunicorn -w 2 -b 0.0.0.0:5000 app:app
`

---

## Running Tests

`ash
# From the ai-service/ directory

# 1. Generate synthetic sample MSDS PDFs (one-time setup)
python scripts/generate_sample_pdfs.py

# 2. Run the full pytest suite
pytest tests/ -v
`

Expected output: all tests pass, including the parse-msds endpoint test that proves Gap 1 works end-to-end.

---

## Compatibility Scores

All material pair compatibility scores are sourced from:
data/maestri_compatibility_table.csv

Every score is traceable to a cited real-world case (Taiwan EPA, MAESTRI project,
Taiwan industrial park reports). The CSV is loaded at import time by

lp/embedding_utils.py — no hardcoded values diverge from it.

---

## Key Source Files

| File | Purpose |
|------|---------|
| pp.py | Flask app factory + blueprint registration |
| outes/compatibility_routes.py | /compatibility/* endpoints |
| outes/predict_routes.py | /predict/* endpoints (Role 3) |
| 
lp/msds_parser.py | PDF parser + shared hazmat/reuse detection |
| 
lp/embedding_utils.py | CSV-backed compatibility lookup + keyword extraction |
| models/compatibility_scorer.py | Scoring + buyer ranking logic |
| models/buyer_ranking.py | Smart four-factor ranking (Role 3 integration) |
| data/maestri_compatibility_table.csv | Cited compatibility data (single source of truth) |
| 
lp/sample_msds/ | Synthetic MSDS PDFs for testing |
| scripts/generate_sample_pdfs.py | Generates the sample PDFs using fpdf2 |
| 	ests/ | pytest test suite |
