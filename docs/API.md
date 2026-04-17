# API Reference

Base URL: `http://localhost:8000` (dev).
All endpoints return JSON. Interactive Swagger UI: [`/docs`](http://localhost:8000/docs).

**Conventions**

- POST bodies are JSON (`Content-Type: application/json`).
- Errors: `{"detail": "message"}` with a 4xx / 5xx status.
- `region_id` is a snake-cased `state_district` slug — e.g. `telangana_medak`, `mp_sehore`. Get the full list from `GET /api/regions`.
- `crop_id` is the canonical key — e.g. `rice`, `cotton`, `paddy_basmati`. Get the full list from `GET /api/crops`.
- All monetary values are INR. Areas are acres. Weights are kg. Temperatures are °C.

---

## Table of contents

- [Core data](#core-data)
- [Simulation & recommendations](#simulation--recommendations)
- [Market intelligence](#market-intelligence)
- [Farm advisory](#farm-advisory)
- [Farm management](#farm-management)
- [Chat](#chat)
- [ML management](#ml-management)
- [Diagnostics](#diagnostics)

---

## Core data

### `GET /api/health`

Liveness probe. `{"status": "ok", "service": "AgriSim Engine"}`.

### `GET /api/crops`

All crop parameters from `dataset/crop_parameters.csv`. Returns a list of
dicts (29 rows).

### `GET /api/crops/{crop_id}`

Single crop. `404` if not found.

### `GET /api/regions`

Returns `[{"id": "...", "name": "..."}]`. `name` is a pretty display form,
e.g. `"Telangana · Medak"`.

### `GET /api/soil/{region_id}`

One row from `dataset/soil.csv` for the region. `404` if missing.

### `GET /api/weather/{region_id}?season=kharif`

Latest weather row for the given region (and optional season). `404` if
missing.

### `GET /api/mandi-prices/{region_id}?crop_id=rice`

Raw monthly mandi price observations. Optional `crop_id` filter.

### `GET /api/yield-history/{region_id}?crop_id=rice`

Historical yields (kg/acre) by year and season.

---

## Simulation & recommendations

### `POST /api/recommend`

Top-K crops for a farm profile.

**Request**
```json
{
  "region_id": "telangana_medak",
  "season": "kharif",
  "budget_per_acre": 15000,
  "area_acres": 3
}
```

**Response** — array of crop recommendations, each with:

| Field | Meaning |
|---|---|
| `crop_id`, `crop_name` | Identifier + display name |
| `predicted_yield_kg_per_acre` | From ML yield model (or heuristic) |
| `expected_profit` | Total over `area_acres` |
| `roi_percent` | `(revenue - cost) / cost × 100` |
| `risk_score` | 0–100, higher = riskier |
| `smart_score` | 0–100 composite rank |
| `ml_confidence` | 0–1 per-class probability |
| `prediction_source` | `"ml_model"` or `"heuristic"` |

### `POST /api/simulate`

Deterministic single-crop simulation with full cost + yield breakdown.

**Request** — see `SimulationRequest` in `backend/main.py`. Key fields:
`crop_id`, `region_id`, `area_acres`, `mandi_price_per_kg`, `soil` dict,
`weather` dict, `input_plan` dict (seed/fertilizer/labour/… per-acre costs).

**Response** — includes `yield_kg_per_acre`, `total_cost`, `revenue`,
`profit`, `roi_percent`, `risk_score`, `water_efficiency`,
`nutrient_analysis`, `sensitivity` (5×5 profit matrix varying price ±20 %
× yield ±20 %).

### `POST /api/batch-simulate`

Simulate many crops at once for a shared region/budget/area. Returns
results sorted by profit. Reuses the region's mandi price rows once
internally (O(1) lookup via the CSV cache index).

### `POST /api/compare-strategies`

Accepts a list of full `SimulationRequest` objects, returns each simulation
result paired with its input strategy.

### `POST /api/optimal-mix`

Greedy multi-crop land allocator. Given total area + total budget,
allocates area proportional to each candidate crop's smart score.

### `POST /api/rotation-plan`

Best kharif → rabi pairs scored by profit + diversity.

### `GET /api/crop-comparison/{region_id}/{season}`

All crops for a region/season with full metrics — useful for tables.

---

## Market intelligence

### `GET /api/price-analytics/{region_id}/{crop_id}`

Average price, volatility, trend (rising/falling/stable), 3-month moving
average, seasonal monthly pattern, best/worst selling month.

### `GET /api/yield-trend/{region_id}/{crop_id}`

Historical yields with year-over-year % change.

### `GET /api/msp?crop_id=rice&year=2025`

Minimum Support Price records. Both `crop_id` and `year` are optional —
omit to get all rows.

### `GET /api/msp-vs-market/{region_id}/{crop_id}`

Compares latest MSP against latest mandi price. Emits a
`recommendation` string like _"Sell at MSP (market is 4% below)"_.

### `GET /api/sell-advisor/{region_id}/{crop_id}`

Hold / sell / partial-sell advice with best selling month and expected
uplift %.

### `GET /api/price-forecast/{region_id}/{crop_id}?months_ahead=6`

ML-powered autoregressive forecast (1–6 months). Falls back to
`seasonal_index × linear_trend` if the model isn't present.

### `GET /api/arbitrage/{crop_id}`

Cross-mandi price gaps for a crop; identifies which regions buy cheap /
sell expensive and the spread %.

---

## Farm advisory

### `GET /api/fertilizer-recommendation/{crop_id}?n=42&p=19&k=170`

Given soil NPK, recommends specific fertilizer brands (Urea, DAP, MOP)
with exact kg/acre doses to close the nutrient gap.

### `GET /api/irrigation-schedule/{crop_id}?sowing_date=2025-06-15&rainfall_mm=800&irrigation_level=0.5`

Week-by-week water plan over the entire crop duration, with stage,
required mm, and stress-window flagging.

### `GET /api/crop-calendar/{crop_id}?season=kharif`

Land-prep → sowing → flowering → harvest dates, critical irrigation
windows, pest watch periods, total duration.

### `GET /api/pest-alerts/{crop_id}?avg_temp_c=28&rainfall_mm=800`

Matches the weather against `dataset/pest_rules.csv`. Returns pest name,
severity (low/medium/high), description, and management (chemical /
biological).

### `POST /api/loan-calculator`

**Request**
```json
{
  "total_cost": 80000,
  "expected_profit": 120000,
  "loan_amount": 50000,
  "interest_rate_annual": 7.0,
  "tenure_months": 12
}
```

Returns EMI, total interest, total repayment, DSCR, verdict
(`safe / moderate / risky`).

### `POST /api/soil-projection`

Project soil NPK over 3–5 years of a given crop rotation. Models legume
nitrogen fixation and heavy-feeder depletion; fertilizer restores at 60 %
efficiency.

### `POST /api/benchmark`

Compares a farmer's actual yield/profit against regional averages.

### `GET /api/strategy-templates?profile=small`

8 pre-built strategy presets. Filter by profile: `small`, `medium`,
`large`.

### `GET /api/government-schemes?crop_id=rice&region_id=up_lucknow&area_acres=2&season=kharif`

Match eligible central/state schemes. Returns scheme name, description,
benefit, application URL.

---

## Farm management

### `POST /api/expense/log`

Record a single expense for a farm.

**Request**
```json
{ "farm_id": "alice_farm_1", "category": "fertilizer", "amount": 3200,
  "date": "2025-07-12", "note": "Urea 2 bags" }
```

### `GET /api/expense/{farm_id}?planned_budget=15000`

Sum by category with optional variance analysis against `planned_budget`.

_In-memory store only; a production deployment would back this with a DB._

### `GET /api/location-insights/{region_id}?season=kharif`

Composite soil + weather + historical-yield briefing for a region.

---

## Chat

### `POST /api/chat`

Site-aware chatbot. See [`CHATBOT.md`](./CHATBOT.md) for the full intent
catalogue.

**Request**
```json
{
  "message": "best time to sell cotton in maharashtra yavatmal",
  "context": { "region_id": "mh_yavatmal", "crop_id": "cotton", "season": "kharif" }
}
```

**Response**
```json
{
  "reply": "### Sell advice — Cotton @ Mh · Yavatmal\n\n…",
  "suggestions": ["Price forecast for cotton", "MSP vs market for cotton"],
  "actions": [{ "label": "Open price forecast →", "href": "/dashboard.html?tool=forecast&region_id=mh_yavatmal&crop_id=cotton" }],
  "context": { "region_id": "mh_yavatmal", "crop_id": "cotton", "season": "kharif" }
}
```

Slash commands are accepted: `/help /recommend /msp /mandi /pest /sell /irrigate /calendar /schemes /loan /crops /regions`.

---

## ML management

### `POST /api/ml/train`

Retrains all 3 models from current CSV data. Returns training metrics
(R², MAE, RMSE, accuracy) and top feature importances.

### `GET /api/ml/status`

`{yield_model_loaded, price_model_loaded, recommend_model_loaded,
model_dir, models_exist, training_report}`.

---

## Diagnostics

### `GET /api/_cache/stats`

Current CSV cache contents. Each file reports `{rows, mtime_ns}` and the
list of derived indexes held.

```json
{
  "files": {
    "mandi_prices.csv": { "rows": 2868, "mtime_ns": 1729259821000000000 },
    "soil.csv":         { "rows": 51,   "mtime_ns": 1729259800000000000 }
  },
  "indexes": {
    "mandi_prices.csv": ["by:region_id"]
  }
}
```

---

## Status codes

| Code | Meaning |
|---|---|
| 200 | OK |
| 400 | Bad request — usually a validator failed or engine raised on bad inputs |
| 404 | Region / crop / dataset row not found |
| 500 | Unhandled error (ML model crashed, filesystem issue). Check server logs. |
