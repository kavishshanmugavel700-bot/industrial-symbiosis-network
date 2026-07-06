# Industrial Symbiosis Intelligence Network
Taiwan Presidential Hackathon 2026 — 7-person team build

An AI-powered platform that predicts factory waste 48–72 hrs before it's
generated and matches it to nearby buyers, issuing a verified carbon
certificate on every exchange.

## Repo layout

```
industrial-symbiosis-network/
├── backend/          → Node.js + Express API           (Role 1 + Role 2)
├── ai-service/        → Python + Flask AI microservice   (Role 3 + Role 4)
├── frontend/          → HTML + CSS + vanilla JS          (Role 5 + Role 6)
├── database/          → PostgreSQL schema + seed data    (Role 1)
├── docs/              → Wireframes, pitch deck, script   (Role 7)
└── docker-compose.yml → optional local orchestration
```

## Who owns what

| # | Role | Folder(s) | Key files |
|---|------|-----------|-----------|
| 1 | **Backend Lead** | `backend/src/{routes,controllers,middleware,config}`, `database/` | `auth.routes.js`, `auth.middleware.js`, `schema.sql`, `app.js`, `server.js` |
| 2 | **Backend + Integrations** | `backend/src/services`, `backend/src/jobs` | `email.service.js`, `pdfCertificate.service.js`, `carbonCalculator.service.js`, `openDataTaiwan.service.js`, `surplusAlert.cron.js` |
| 3 | **AI Lead** | `ai-service/models`, `ai-service/routes`, `ai-service/app.py` | `surplus_prediction_model.py`, `buyer_ranking.py`, `predict_routes.py` |
| 4 | **AI + Data Engineer** | `ai-service/nlp`, `ai-service/data` | `msds_parser.py`, `compatibility_scorer.py`, `generate_synthetic_data.py`, `synthetic_taiwan_factories.csv` |
| 5 | **Frontend Lead** | `frontend/*.html` (core pages), `frontend/js/{api,auth,marketplace,factoryProfile}.js` | `register.html`, `login.html`, `marketplace.html`, `factory-profile.html` |
| 6 | **Frontend + Dashboard** | `frontend/gov-dashboard.html`, `frontend/js/{map,charts,notifications}.js` | `map.js` (Leaflet), `charts.js` (Chart.js), `gov-dashboard.html` |
| 7 | **Team Lead / PM / Pitch** | `docs/` | `demo-script.md`, `wireframes/`, `pitch-deck/` |

## Build order (matches Team_Roles_Execution_Plan)

1. **Stage 1 (Day 1):** Role 7 wireframes in `docs/wireframes/`; Role 1 drafts `database/schema.sql`.
2. **Stage 2 (Days 2-4):** Role 1 builds `backend/src/config`, `models`, auth routes. Role 4 starts `ai-service/generate_synthetic_data.py`. Role 5 builds static `register.html` / `login.html`.
3. **Stage 3 (Days 5-7):** Role 5 wires forms to `backend/src/routes/auth.routes.js`. Role 2 starts `marketplace.routes.js` CRUD.
4. **Stage 4 (Days 8-11):** Role 3 builds `surplus_prediction_model.py` against the synthetic dataset. Role 4 builds `msds_parser.py` in parallel.
5. **Stage 5 (Days 12-16):** Role 5 builds `marketplace.html` / `factory-profile.html`. Role 2 builds `carbonCalculator.service.js` + `pdfCertificate.service.js`. Role 3 exposes `predict_routes.py` as a Flask endpoint.
6. **Stage 6 (Days 17-21):** Role 1 wires `surplusAlert.cron.js` → `aiClient.service.js` → `ai-service/app.py`. This is the core integration — test it in isolation first.
7. **Stage 7 (Days 22-26):** Role 6 builds `gov-dashboard.html`, `map.js`, `charts.js`. Role 4 finalizes `compatibility_scorer.py`.
8. **Stage 8-9 (Days 27-44):** All roles — bug fixing, deploy (Render.com), pitch deck (`docs/pitch-deck/`), demo rehearsal.

## Tech stack

- **Frontend:** HTML/CSS/Vanilla JS, Leaflet.js, Chart.js
- **Backend:** Node.js, Express, JWT auth, Nodemailer, PDFKit, node-cron
- **AI/ML:** Python, Flask, scikit-learn, spaCy, pdfplumber
- **Database:** PostgreSQL (+ PostGIS for proximity queries)
- **Hosting:** Render.com (backend + AI service + Postgres, free tier), Vercel/Netlify (frontend)

## Local setup (once code is filled in)

```bash
# Backend
cd backend && npm install && npm run dev

# AI service
cd ai-service && pip install -r requirements.txt && python app.py

# Frontend
cd frontend && npx serve .
```

## Environment variables

Copy `.env.example` → `.env` in both `backend/` and `ai-service/` and fill in:
- `DATABASE_URL`
- `JWT_SECRET`
- `GMAIL_USER` / `GMAIL_APP_PASSWORD` (Nodemailer)
- `AI_SERVICE_URL` (backend → ai-service base URL)
