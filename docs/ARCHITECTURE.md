# Architecture

High-level system design for Mitti Mantra / AgriSim.

## One-sentence summary

A single FastAPI process serves **both** the REST API and the static
vanilla-JS frontend. All dataset reads go through one mtime-aware in-memory
cache. Three scikit-learn models provide yield / price / recommendation
predictions with deterministic heuristic fallbacks. A site-grounded
intent-based chatbot stitches the user's natural-language questions to the
same backend engine.

---

## Component diagram

```
                     ┌──────────────────────────────┐
                     │          Browser             │
                     │                              │
 ┌───────────────┐   │  index.html / dashboard.html │
 │  Service      │◀──┤  ├── mm-core.js (utils)      │
 │  Worker (PWA) │   │  ├── dashboard.js (14 tools) │
 └───────┬───────┘   │  ├── mm-enhance.js (UI)      │
         │           │  ├── chatbot.js (assistant)  │
         │precache   │  └── india-globe.js (Three)  │
         ▼           └─────────────┬────────────────┘
   IndexedDB / Cache               │ fetch + JSON
                                   ▼
                     ┌──────────────────────────────┐
                     │     FastAPI (backend/)       │
                     │                              │
                     │  Middleware:                 │
                     │  ├─ CORS                     │
                     │  ├─ GZip (minimum 800 bytes) │
                     │  └─ StaticCacheHeaders       │
                     │                              │
                     │  Routers:                    │
                     │  ├─ /api/*                   │
                     │  └─ /  → StaticFiles         │
                     └─────┬───────────┬────────────┘
                           │           │
            ┌──────────────┘           └────────────┐
            ▼                                       ▼
  ┌─────────────────────┐              ┌─────────────────────┐
  │  engine/            │              │  ml/                │
  │  ├─ simulator.py    │              │  ├─ predict.py      │
  │  └─ features.py     │              │  ├─ train_models.py │
  └──────────┬──────────┘              │  └─ models/*.joblib │
             │                         └─────────┬───────────┘
             │                                   │
             └───────────┬───────────────────────┘
                         ▼
           ┌──────────────────────────────┐
           │  utils/csv_cache.py          │
           │  (mtime-aware, indexed)      │
           └──────────────┬───────────────┘
                          ▼
                 ┌──────────────────┐
                 │  dataset/*.csv   │
                 └──────────────────┘
```

---

## Request lifecycle

A typical `POST /api/recommend`:

1. **FastAPI receives** the request → Pydantic `RecommendationRequest` model validates types and positivity constraints.
2. **`recommend_crops()`** in `ml/predict.py` is called.
3. It pulls soil/weather/crop/yield rows via the shared `utils.csv_cache.load()` — parsed once, indexed by `region_id` on first access, served from memory thereafter.
4. ML model is loaded lazily (`_load_ml_models`) and cached for the process lifetime.
5. Feature vectors are built and `predict_proba` returns per-crop confidence.
6. Smart-score ranking blends ML confidence, ROI, risk, budget fit and soil health.
7. Response is serialized, GZip middleware compresses it (responses > 800 B), `Cache-Control: private, max-age=30` header is attached.
8. Browser renders the list → `mm-enhance.js` MutationObserver decorates each row with a "Why this crop?" drawer + risk gauge + source footer.

---

## The data layer — why one cache matters

Before `utils/csv_cache.py` every endpoint that needed mandi prices, weather,
or yield history would call `list(csv.DictReader(open(path)))` _on every
request_. With `mandi_prices.csv` at 2868 rows this is a 6 ms hit per
request. Under light load (20 rps) that's ~120 ms/s wasted on re-parsing
the same file.

The cache:

- Keeps `{filename: (mtime_ns, rows)}` — reads once, serves O(1) thereafter.
- **Automatically invalidates** when `os.stat().st_mtime_ns` changes, so
  editing a CSV (or running `dataset/_seed_extra.py`) takes effect instantly
  without a server restart.
- Builds **indexes** lazily: `index_by("mandi_prices.csv", "region_id")`
  returns a dict of rows grouped by region. Subsequent calls are O(1).
- Thread-safe via a single `RLock`.

Every dataset-reading module (`backend/main.py`, `backend/chatbot.py`,
`engine/features.py`, `ml/predict.py`) delegates to this cache. Benchmark on
a warm cache: **222× faster** than the naïve re-parse-every-time pattern.

---

## Caching strategy (three layers)

| Layer | Where | TTL / invalidation |
|---|---|---|
| In-memory CSV cache | `utils/csv_cache.py` | mtime-based, automatic |
| HTTP response cache | `StaticCacheHeaders` middleware | API: 30 s private · static: 1 day + SWR 1 week · HTML / sw.js: no-cache |
| Service Worker | `frontend/sw.js` v13 | Precache shell · network-first HTML · cache-first static · SWR for CDN libs · network-only for `/api/*` |

---

## ML integration

Three models live in `ml/models/*.joblib` and load lazily:

| Model | Algorithm | Purpose | Fallback |
|---|---|---|---|
| `yield_model` | `RandomForestRegressor` (200 trees) | Predict kg/acre yield given crop × soil × weather × inputs | Heuristic: `base_yield × soil_factor × climate_factor` from `utils/calculations.py` |
| `price_model` | `GradientBoostingRegressor` (300 trees) | Autoregressive 1–6 month price forecast with lag features | Seasonal decomposition × linear trend |
| `recommend_model` | `RandomForestClassifier` (200 trees) | `predict_proba` confidence per crop class | Heuristic ROI + risk + budget + soil scoring |

All ML results include a `prediction_source` field (`"ml_model"` or
`"heuristic"`) so the UI can tag confidence honestly. If `ml/models/`
directory is missing, the system **still works**, just on heuristics —
the UI transparently shows the downgrade.

Retraining is a POST away: `POST /api/ml/train` rebuilds all three from
current CSVs, writes new `.joblib` files + `manifest.json`, and subsequent
requests pick up the new models.

---

## Chatbot grounding

The bot (`backend/chatbot.py`) is **intent-based**, not an LLM. It:

1. Matches the user message against regex intent patterns.
2. Extracts entities (crop, region, season, numbers) using the live dataset
   cache.
3. Calls the **exact same** engine/feature functions the dashboard uses
   (`best_time_to_sell`, `pest_disease_alerts`, `msp_vs_market`, …).
4. Formats results as markdown (tables for irrigation schedules, emoji
   severity icons for pest risk, labelled lines for loan/feasibility).
5. Returns a `context` dict (remembered region / crop / season) and an
   `actions` array (deep-link buttons into the dashboard). The frontend
   persists `context` across messages.

Because it reuses the real engine, the bot cannot hallucinate — every
answer is reproducible via the dashboard's own endpoints.

See [`CHATBOT.md`](./CHATBOT.md) for the intent catalogue and slash-command
reference.

---

## Frontend philosophy — zero build

Every `.js` file is a script tag; there is no bundler, no TypeScript, no
npm install in the frontend. This means:

- Deploys are `cp -r frontend/ /var/www/` (or FastAPI mounts it directly).
- The service worker can precache a finite, known asset list.
- Debugging is "View Source".
- There's no package-lock drift.

The one concession is two CDN loads: Chart.js on the dashboard and
Three.js on the landing page. Both are cached by the service worker under
a stale-while-revalidate strategy.

Cross-page utilities (`mm-core.js`) expose a `window.MM` namespace:
`MM.fmt.inr()`, `MM.profile.get()`, `MM.share.whatsapp()`, `MM.toast()`.

---

## Key design decisions (and why)

| Decision | Rationale |
|---|---|
| **FastAPI, not Flask** | Async, automatic OpenAPI docs, Pydantic validation for free. |
| **CSV source of truth**, not Postgres | Hackathon MVP; easy git-diffable data; every loader is one line to swap later. |
| **Vanilla JS, not React** | No build step means instant deploy, fast on rural 2G, minimal SW cache. |
| **mtime-based cache, not TTL-based** | Correctness: a CSV edit must be visible instantly for live demos. |
| **Intent chatbot, not LLM** | Zero hallucination, zero latency, zero API cost, zero data leakage. |
| **Heuristic fallbacks for every ML call** | System must degrade gracefully if models aren't present (fresh checkout, deploy without models). |
| **Service worker network-first for HTML** | Avoids stale HTML referencing new CSS/JS after an update. |
| **`MutationObserver` enhancements** (`mm-enhance.js`) | Layer UX improvements without touching the 82 KB `dashboard.js`. |

---

## Diagnostics

- `GET /api/health` — quick liveness.
- `GET /api/_cache/stats` — CSV cache inspection (row counts, index keys).
- `GET /api/ml/status` — which models are loaded + training manifest.

---

## What's next

- **Swap CSV for SQLite / Postgres** — single file change in `utils/csv_cache.py`. Business logic is untouched.
- **Live IMD / OpenWeather forecast** — plug into `data_ingestion/fetchers/weather.py`. Pest alerts and irrigation already accept a weather dict, so the cascade is automatic.
- **Scheduled ML retrain** — cron / GitHub Actions calling `POST /api/ml/train` after dataset updates.
- **Horizontal scale** — the process is stateless except for the in-memory cache; safe behind a load balancer.
