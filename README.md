<div align="center">

# 🌾 Mitti Mantra · AgriSim

**AI-powered farm intelligence for Indian agriculture.**
Smart crop recommendations, yield forecasts, mandi-price analytics and a
site-aware farmer chatbot — all trained on real Indian farm data and served
from a single FastAPI process with a zero-build vanilla-JS frontend.

_Mitti se judao, fasal se pao._

[Architecture](./docs/ARCHITECTURE.md) ·
[API reference](./docs/API.md) ·
[Frontend guide](./docs/FRONTEND.md) ·
[Chatbot](./docs/CHATBOT.md) ·
[Datasets](./docs/DATASETS.md) ·
[Development](./docs/DEVELOPMENT.md)

</div>

---

## Features

- **Smart crop recommender** — 3 ML models (yield, price forecast, fit score) ranked for your region, season, and budget.
- **Yield & profit simulator** — full cost breakdown, ROI, water efficiency, nutrient gap, sensitivity heatmap.
- **Rotation planner** — best kharif → rabi pairs for the whole year.
- **Mandi analytics** — cross-region arbitrage, MSP-vs-market, 6-month price forecast, best-time-to-sell advisor.
- **Pest & disease alerts** — weather-driven risk matrix per crop.
- **Fertilizer / irrigation schedules**, loan calculator, multi-year soil-health projection.
- **Government scheme matcher** (PM-KISAN, PMFBY, KCC, etc.).
- **Site-aware chatbot** — grounded in the actual datasets, supports slash commands (`/recommend`, `/msp`, `/pest`…), voice input, session memory, and deep-link buttons into the dashboard.
- **Unified Farm Profile** — set region / season / area / budget once; every tool auto-fills, chatbot remembers.
- **Live 3D India map** — clickable states, multiple heatmap modes, per-crop suitability overlay.
- **Draw-your-farm tool** — Leaflet polygon + SoilGrids fetch at the centroid, auto-filled into the dashboard.
- **PWA** — installable, offline-capable, precached shell with service worker.
- **Share & export** — WhatsApp share, print/PDF, high-contrast / large-text accessibility modes.
- **Multi-language UI** — English, Hindi, Telugu.

---

## Tech stack

| Layer | Stack |
|---|---|
| Backend | FastAPI, Pydantic v2, scikit-learn, pandas |
| Frontend | Vanilla JS, Three.js, Leaflet + Turf, Chart.js — no build step |
| Data | CSV seed data + live fetchers (SoilGrids v2, Open-Meteo, data.gov.in mandi) |
| Caching | File + in-memory `@cached` decorator (`data_ingestion/cache.py`) |
| PWA | Service Worker (`frontend/sw.js`) with three strategies |
| Testing | pytest (`tests/`) |

---

## Repository layout

```
backend/
  main.py               FastAPI app, 35+ endpoints, all middleware, static mount
  chatbot.py            Site-aware intent-based chatbot (/api/chat)
engine/
  simulator.py          Deterministic yield/cost/profit/risk simulation
  features.py           14 advisory features (fertilizer, MSP, pest, irrigation…)
ml/
  predict.py            ML-backed yield, price, recommendation, rotation
  train_models.py       Retrains all 3 models from CSV
  models/               Serialized .joblib artifacts + manifest.json
utils/
  csv_cache.py          Shared mtime-aware CSV cache w/ indexes (hot-path 222× speedup)
  calculations.py       Core math helpers + CropParameter dataclass
data_ingestion/
  cache.py              @cached decorator (file + memory layers)
  fetchers/             Live-API wrappers (SoilGrids, Open-Meteo, data.gov.in)
  prepare_data.py       Validates + rebuilds derived CSVs
dataset/                29 crops × 35 regions of seed data (see docs/DATASETS.md)
frontend/               Zero-build static site (served by FastAPI)
  index.html            Landing + 3D India globe + live demo
  dashboard.html        14-tool dashboard
  farm-boundary.html    Draw-a-polygon + SoilGrids centroid fetch
  mm-core.js            Cross-page utilities: Farm Profile, share, PWA install, a11y
  mm-enhance.js         Non-invasive dashboard augmentations ("why this crop?", gauges)
  chatbot.js            Floating draggable chat widget
  dashboard.js          All 14 dashboard tools
  india-globe.js        Three.js globe with suitability overlays
  state-data.js         36 states + UTs reference data
  demo-recommender.js   Client-side on-page recommender
  farm-boundary.js      Leaflet map + polygon + soil fetch
  site-ui.js            Nav, reveal animations, PWA register
  i18n.js               EN / HI / TE switcher
  toolbar.js            Floating dark-mode / voice / TTS / WhatsApp / PDF
  sw.js                 Service worker (v13) — 3 caching strategies
  style.css             "Clay" design system
  manifest.webmanifest  PWA manifest
tests/                  Pytest suite
docs/                   Project documentation (this set)
  01_discovery/         Problem framing, personas, crop catalogue
```

---

## Quickstart

```bash
# 1. Create a virtual environment & install deps
python -m venv venv
venv\Scripts\activate           # Windows
# source venv/bin/activate       # macOS / Linux
pip install -r requirements.txt

# 2. (Optional) Copy .env.example → .env and set keys
#    DATAGOV_API_KEY=...         # for live mandi prices
#    SoilGrids and Open-Meteo need no key.

# 3. Validate & rebuild derived datasets
python data_ingestion/prepare_data.py

# 4. Run the backend (serves both API and static frontend)
uvicorn backend.main:app --reload --port 8000

# 5. Open http://localhost:8000 in your browser
```

The FastAPI app also mounts `frontend/` as static files, so a single URL
serves both `/api/*` and the HTML pages.

### Tests

```bash
pytest -q tests
```

### CLI examples

```bash
python -m engine.example_usage
python -m ml.example_usage
```

---

## Environment variables

| Name | Required | Purpose |
|---|---|---|
| `DATAGOV_API_KEY` | no | Live mandi prices from data.gov.in. Falls back to `dataset/mandi_prices.csv` if absent. |
| `AGRISIM_CACHE_DIR` | no | Override the on-disk cache location (default: `.cache/`). |

No key is needed for SoilGrids or Open-Meteo — both are open APIs.

---

## Deployment

### Frontend only (Netlify / Vercel / GitHub Pages)

`frontend/` is static. Upload the folder; it works with any host. Point
`window.AGRISIM_API_BASE` (inject via env at build or a small `config.js`) at
your deployed backend.

### Backend (Render / Railway / Fly.io)

```bash
pip install -r requirements.txt
uvicorn backend.main:app --host 0.0.0.0 --port $PORT
```

Render example `render.yaml`:

```yaml
services:
  - type: web
    name: agrisim
    runtime: python
    buildCommand: pip install -r requirements.txt
    startCommand: uvicorn backend.main:app --host 0.0.0.0 --port $PORT
    envVars:
      - key: DATAGOV_API_KEY
        sync: false
```

### PWA

The site registers a service worker (`frontend/sw.js`) automatically on the
first `https://` or `localhost` load. Bump `VERSION` in `sw.js` whenever you
ship new assets so old caches get evicted.

---

## API at a glance

35+ endpoints across five domains — **core data**, **simulation**,
**market intelligence**, **farm advisory**, and **ML management**. See
[`docs/API.md`](./docs/API.md) for the complete reference or
`http://localhost:8000/docs` for interactive Swagger.

| Domain | Example endpoints |
|---|---|
| **Core data** | `GET /api/regions`, `/api/crops`, `/api/soil/{region}`, `/api/weather/{region}` |
| **Simulation** | `POST /api/simulate`, `/api/recommend`, `/api/rotation-plan`, `/api/optimal-mix` |
| **Market** | `/api/price-forecast`, `/api/sell-advisor`, `/api/arbitrage`, `/api/msp-vs-market` |
| **Advisory** | `/api/pest-alerts`, `/api/irrigation-schedule`, `/api/fertilizer-recommendation`, `/api/government-schemes` |
| **Chat & ML** | `POST /api/chat`, `POST /api/ml/train`, `GET /api/ml/status` |

---

## Docs index

| Document | What's inside |
|---|---|
| [`docs/ARCHITECTURE.md`](./docs/ARCHITECTURE.md) | System design, request lifecycle, caching strategy, ML integration |
| [`docs/API.md`](./docs/API.md) | Every endpoint — request/response shapes, examples |
| [`docs/FRONTEND.md`](./docs/FRONTEND.md) | How the zero-build frontend is organised |
| [`docs/CHATBOT.md`](./docs/CHATBOT.md) | Intent router, slash commands, voice, deep-linking |
| [`docs/DATASETS.md`](./docs/DATASETS.md) | All 9 CSVs — columns, units, where they're used |
| [`docs/DEVELOPMENT.md`](./docs/DEVELOPMENT.md) | Local setup, testing, contributing, deploy |

---

## Contributing

1. Fork & branch from `main`.
2. Keep the frontend **zero-build** — no bundler, no TypeScript, no frameworks.
3. Backend must pass `pytest` and follow the existing FastAPI style.
4. See [`docs/DEVELOPMENT.md`](./docs/DEVELOPMENT.md) for full guidance.

## License

MIT — see [LICENSE](./LICENSE).
