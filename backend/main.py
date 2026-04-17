from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.gzip import GZipMiddleware
from fastapi.staticfiles import StaticFiles
from starlette.middleware.base import BaseHTTPMiddleware
from pydantic import BaseModel, Field, field_validator
from typing import Dict, Any, List, Optional
from statistics import mean
import sys
import os

# Add project root to path to import engine and utils
sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from utils.csv_cache import load as _csv_load, index_by as _csv_index, first_by as _csv_first
from engine.simulator import simulate
from backend.chatbot import answer as chatbot_answer
from ml.predict import recommend_crops, location_based_insights, mandi_price_analytics, rotation_planner
from ml.train_models import train_all as ml_train_all
from engine.features import (
    fertilizer_recommendation,
    get_msp_data,
    msp_vs_market,
    best_time_to_sell,
    irrigation_schedule,
    get_crop_calendar,
    pest_disease_alerts,
    loan_calculator,
    soil_health_projection,
    price_forecast,
    cross_mandi_arbitrage,
    get_strategy_templates,
    region_benchmark,
    log_expense,
    get_expense_summary,
    match_government_schemes,
)

app = FastAPI(title="AgriSim - Farm Intelligence Platform")

# Allow CORS for local dev
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Gzip: mandi-price / yield-history responses routinely exceed 50 KB of JSON;
# compression cuts that by ~80% on the wire for near-zero CPU cost.
app.add_middleware(GZipMiddleware, minimum_size=800)


class StaticCacheHeaders(BaseHTTPMiddleware):
    """Adds sensible Cache-Control headers for the static frontend assets.

    - HTML & service worker: no-cache so the browser always revalidates.
    - JS / CSS / images / fonts: 1-day cache with stale-while-revalidate.
    - API responses: short 30s cache (private) so rapid repeat calls feel instant.
    """

    async def dispatch(self, request: Request, call_next):
        response = await call_next(request)
        path = request.url.path
        if path.startswith("/api/"):
            response.headers.setdefault("Cache-Control", "private, max-age=30")
        elif path.endswith(("/sw.js", ".html", "/")):
            response.headers.setdefault("Cache-Control", "no-cache")
        elif "." in path.rsplit("/", 1)[-1]:
            response.headers.setdefault(
                "Cache-Control", "public, max-age=86400, stale-while-revalidate=604800"
            )
        return response


app.add_middleware(StaticCacheHeaders)

# --- Models ---
class SimulationRequest(BaseModel):
    crop_id: str
    area_acres: float
    region_id: str
    mandi_price_per_kg: float
    irrigation_level: Optional[float] = 0.5
    seed_variety: Optional[str] = "standard"
    sowing_date: Optional[str] = "2024-06-15"
    soil: Dict[str, Any]
    weather: Dict[str, Any]
    input_plan: Optional[Dict[str, float]] = Field(default_factory=dict)

    @field_validator("area_acres")
    @classmethod
    def area_must_be_positive(cls, v: float) -> float:
        if v <= 0:
            raise ValueError("area_acres must be greater than 0")
        return v

    @field_validator("mandi_price_per_kg")
    @classmethod
    def price_must_be_positive(cls, v: float) -> float:
        if v <= 0:
            raise ValueError("mandi_price_per_kg must be greater than 0")
        return v

    @field_validator("irrigation_level")
    @classmethod
    def irrigation_in_range(cls, v: float | None) -> float | None:
        if v is not None and not (0.0 <= v <= 1.0):
            raise ValueError("irrigation_level must be between 0 and 1")
        return v

class RecommendationRequest(BaseModel):
    region_id: str
    season: str
    budget_per_acre: float
    area_acres: float

    @field_validator("budget_per_acre", "area_acres")
    @classmethod
    def must_be_positive(cls, v: float) -> float:
        if v <= 0:
            raise ValueError("Value must be greater than 0")
        return v

class CompareRequest(BaseModel):
    strategies: List[SimulationRequest]

class RotationRequest(BaseModel):
    region_id: str
    budget_per_acre: float
    area_acres: float

    @field_validator("budget_per_acre", "area_acres")
    @classmethod
    def must_be_positive_rot(cls, v: float) -> float:
        if v <= 0:
            raise ValueError("Value must be greater than 0")
        return v

class BatchSimRequest(BaseModel):
    crop_ids: List[str]
    area_acres: float
    region_id: str
    budget_per_acre: float
    irrigation_level: Optional[float] = 0.5
    seed_variety: Optional[str] = "standard"
    sowing_date: Optional[str] = "2024-06-15"
    soil: Dict[str, Any]
    weather: Dict[str, Any]

class CropMixRequest(BaseModel):
    region_id: str
    season: str
    total_area_acres: float
    total_budget: float
    soil: Dict[str, Any]
    weather: Dict[str, Any]

class LoanRequest(BaseModel):
    total_cost: float
    expected_profit: float
    loan_amount: Optional[float] = None
    interest_rate_annual: Optional[float] = 4.0
    tenure_months: Optional[int] = 12

class SoilProjectionRequest(BaseModel):
    current_soil: Dict[str, Any]
    rotation: List[Dict[str, str]]
    years: Optional[int] = 5
    apply_fertilizer: Optional[bool] = True

class ExpenseLogRequest(BaseModel):
    farm_id: str
    category: str
    amount: float
    date: Optional[str] = None
    note: Optional[str] = ""

class BenchmarkRequest(BaseModel):
    region_id: str
    crop_id: str
    user_yield_kg_per_acre: float
    user_profit_per_acre: float

# --- Helper functions ---
# All dataset reads go through the shared mtime-aware CSV cache. Hot endpoints
# below use index_by() to skip full-table scans entirely.
def read_csv(filename: str) -> List[Dict[str, str]]:
    return _csv_load(filename)

# --- API Endpoints ---

@app.get("/api/health")
async def health_check():
    return {"status": "ok", "service": "AgriSim Engine"}


@app.get("/api/_cache/stats")
async def cache_stats():
    """Diagnostic: current CSV cache state (rows per file + indexes)."""
    from utils.csv_cache import stats as _stats
    return _stats()

@app.get("/api/crops")
async def get_crops():
    return read_csv("crop_parameters.csv")

@app.get("/api/crops/{crop_id}")
async def get_crop(crop_id: str):
    crop = _csv_first("crop_parameters.csv", "crop_id", crop_id)
    if crop:
        return crop
    raise HTTPException(status_code=404, detail="Crop not found")

@app.get("/api/regions")
async def get_regions():
    soil_data = read_csv("soil.csv")
    regions = []
    seen = set()
    # Known state abbreviations that should stay uppercase
    STATE_ABBR = {"mp", "up", "tn", "mh", "kar", "guj", "pb", "ap", "tg", "ka", "wb", "or", "ka", "jk", "hp", "uk"}
    for row in soil_data:
        rid = row["region_id"]
        if rid not in seen:
            # Clean region id for display: "telangana_medak" -> "Telangana · Medak", "mp_sehore" -> "MP · Sehore"
            parts = rid.split('_')
            display_parts = [p.upper() if p.lower() in STATE_ABBR else p.capitalize() for p in parts]
            name = " · ".join(display_parts)
            regions.append({"id": rid, "name": name})
            seen.add(rid)
    return regions

@app.get("/api/weather/{region_id}")
async def get_weather(region_id: str, season: Optional[str] = None):
    results = _csv_index("weather.csv", "region_id").get(region_id, [])
    if season:
        results = [row for row in results if row["season"] == season]
    if not results:
        raise HTTPException(status_code=404, detail="Weather data not found for region")
    # Return the most recent year's data or average
    return results[-1]

@app.get("/api/soil/{region_id}")
async def get_soil(region_id: str):
    row = _csv_first("soil.csv", "region_id", region_id)
    if row:
        return row
    raise HTTPException(status_code=404, detail="Soil data not found for region")

@app.get("/api/mandi-prices/{region_id}")
async def get_mandi_prices(region_id: str, crop_id: Optional[str] = None):
    results = _csv_index("mandi_prices.csv", "region_id").get(region_id, [])
    if crop_id:
        results = [row for row in results if row["crop_id"] == crop_id]
    return results

@app.get("/api/yield-history/{region_id}")
async def get_yield_history(region_id: str, crop_id: Optional[str] = None):
    results = _csv_index("yield_history.csv", "region_id").get(region_id, [])
    if crop_id:
        results = [row for row in results if row["crop_id"] == crop_id]
    return results

@app.get("/api/location-insights/{region_id}")
async def get_location_insights(region_id: str, season: str = "kharif"):
    try:
        return location_based_insights(region_id, season)
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))

@app.post("/api/recommend")
async def get_recommendations(req: RecommendationRequest):
    try:
        return recommend_crops(
            region_id=req.region_id,
            season=req.season,
            budget_per_acre=req.budget_per_acre,
            area_acres=req.area_acres
        )
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))

@app.post("/api/simulate")
async def run_simulation(request: SimulationRequest):
    try:
        strategy = request.model_dump()
        result = simulate(strategy)
        return result
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))

@app.post("/api/compare-strategies")
async def compare_strategies(req: CompareRequest):
    try:
        results = []
        for strategy in req.strategies:
            strat_dict = strategy.model_dump()
            res = simulate(strat_dict)
            results.append({
                "strategy": strat_dict,
                "result": res
            })
        return {"comparisons": results}
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))

@app.get("/api/price-analytics/{region_id}/{crop_id}")
async def get_price_analytics(region_id: str, crop_id: str):
    """Returns mandi price analytics: trend, volatility, seasonal pattern, moving averages."""
    try:
        return mandi_price_analytics(region_id, crop_id)
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))

@app.post("/api/rotation-plan")
async def get_rotation_plan(req: RotationRequest):
    """Returns optimal kharif→rabi crop rotation plans."""
    try:
        return rotation_planner(req.region_id, req.budget_per_acre, req.area_acres)
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))

@app.get("/api/crop-comparison/{region_id}/{season}")
async def get_crop_comparison(region_id: str, season: str, budget_per_acre: float = 15000, area_acres: float = 3):
    """Returns all crops compared for a region/season with full metrics."""
    try:
        return recommend_crops(region_id, season, budget_per_acre, area_acres, top_k=50)
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))

@app.post("/api/batch-simulate")
async def batch_simulate(req: BatchSimRequest):
    """Simulate multiple crops in one call, returning ranked results."""
    # Pre-filter to the region once so each crop lookup is O(k) not O(n).
    region_rows = _csv_index("mandi_prices.csv", "region_id").get(req.region_id, [])
    results = []
    errors = []
    for crop_id in req.crop_ids:
        try:
            crop_prices = [float(r["price_inr_per_kg"]) for r in region_rows if r["crop_id"] == crop_id]
            price = crop_prices[-1] if crop_prices else 25.0
            budget = req.budget_per_acre
            strategy = {
                "crop_id": crop_id,
                "area_acres": req.area_acres,
                "region_id": req.region_id,
                "mandi_price_per_kg": price,
                "irrigation_level": req.irrigation_level,
                "seed_variety": req.seed_variety,
                "sowing_date": req.sowing_date,
                "soil": req.soil,
                "weather": req.weather,
                "input_plan": {
                    "seed_cost_per_acre": budget * 0.12,
                    "fertilizer_cost_per_acre": budget * 0.30,
                    "labour_cost_per_acre": budget * 0.25,
                    "irrigation_cost_per_acre": budget * 0.15,
                    "pesticide_cost_per_acre": budget * 0.10,
                    "machinery_cost_per_acre": budget * 0.08,
                },
            }
            result = simulate(strategy)
            results.append(result)
        except Exception as e:
            errors.append({"crop_id": crop_id, "error": str(e)})
    results.sort(key=lambda x: x["profit"], reverse=True)
    return {"results": results, "errors": errors, "total_simulated": len(results)}

@app.post("/api/optimal-mix")
async def optimal_crop_mix(req: CropMixRequest):
    """Find optimal multi-crop allocation for given land and budget."""
    try:
        all_crops = recommend_crops(req.region_id, req.season, req.total_budget / max(req.total_area_acres, 1), req.total_area_acres, top_k=50)
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))

    if not all_crops:
        raise HTTPException(status_code=404, detail="No crops available for this region/season")

    # Greedy allocation: assign area proportional to smart_score, minimum 0.5 acres per crop
    total_score = sum(c["smart_score"] for c in all_crops)
    if total_score == 0:
        raise HTTPException(status_code=400, detail="All crops scored 0")

    allocations = []
    remaining_area = req.total_area_acres
    remaining_budget = req.total_budget
    for crop in all_crops:
        if remaining_area < 0.5:
            break
        share = crop["smart_score"] / total_score
        area = round(max(share * req.total_area_acres, 0.5), 2)
        area = min(area, remaining_area)
        budget_for_crop = round(area / req.total_area_acres * req.total_budget, 2)
        allocations.append({
            "crop_id": crop["crop_id"],
            "crop_name": crop["crop_name"],
            "allocated_acres": area,
            "allocated_budget": budget_for_crop,
            "expected_profit": round(crop["expected_profit"] * (area / max(req.total_area_acres, 1)), 2),
            "roi_percent": crop["roi_percent"],
            "risk_score": crop["risk_score"],
            "smart_score": crop["smart_score"],
        })
        remaining_area -= area
        remaining_budget -= budget_for_crop

    total_profit = sum(a["expected_profit"] for a in allocations)
    avg_risk = mean([a["risk_score"] for a in allocations]) if allocations else 0
    return {
        "region_id": req.region_id,
        "season": req.season,
        "total_area_acres": req.total_area_acres,
        "total_budget": req.total_budget,
        "allocations": allocations,
        "total_expected_profit": round(total_profit, 2),
        "avg_risk_score": round(avg_risk, 2),
        "num_crops": len(allocations),
    }

@app.get("/api/yield-trend/{region_id}/{crop_id}")
async def get_yield_trend(region_id: str, crop_id: str):
    """Returns historical yield trend with year-over-year growth rate."""
    region_rows = _csv_index("yield_history.csv", "region_id").get(region_id, [])
    results = [row for row in region_rows if row["crop_id"] == crop_id]
    if not results:
        raise HTTPException(status_code=404, detail="No yield history found")
    results = sorted(results, key=lambda x: int(x["year"]))
    trend = []
    for i, row in enumerate(results):
        entry = {
            "year": int(row["year"]),
            "season": row["season"],
            "yield_kg_per_acre": float(row["yield_kg_per_acre"]),
            "yoy_change_percent": None
        }
        if i > 0:
            prev = float(results[i-1]["yield_kg_per_acre"])
            curr = float(row["yield_kg_per_acre"])
            entry["yoy_change_percent"] = round((curr - prev) / max(prev, 1.0) * 100.0, 2)
        trend.append(entry)
    yields = [float(r["yield_kg_per_acre"]) for r in results]
    return {
        "region_id": region_id,
        "crop_id": crop_id,
        "trend": trend,
        "avg_yield": round(mean(yields), 2),
        "min_yield": round(min(yields), 2),
        "max_yield": round(max(yields), 2),
    }

# ---------------------------------------------------------------------------
# Feature Endpoints (14 new features)
# ---------------------------------------------------------------------------

@app.get("/api/fertilizer-recommendation/{crop_id}")
async def get_fertilizer_rec(crop_id: str, n: float = 40, p: float = 20, k: float = 20):
    """Get specific fertilizer recommendations based on soil NPK and crop needs."""
    try:
        return fertilizer_recommendation(crop_id, {"n_kg_per_acre": n, "p_kg_per_acre": p, "k_kg_per_acre": k})
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))

@app.get("/api/msp")
async def get_msp(crop_id: Optional[str] = None, year: Optional[int] = None):
    """Get MSP (Minimum Support Price) data."""
    return get_msp_data(crop_id, year)

@app.get("/api/msp-vs-market/{region_id}/{crop_id}")
async def get_msp_comparison(region_id: str, crop_id: str):
    """Compare MSP with current mandi prices."""
    try:
        return msp_vs_market(region_id, crop_id)
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))

@app.get("/api/sell-advisor/{region_id}/{crop_id}")
async def get_sell_advice(region_id: str, crop_id: str):
    """Get best time to sell recommendation."""
    try:
        return best_time_to_sell(region_id, crop_id)
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))

@app.get("/api/irrigation-schedule/{crop_id}")
async def get_irrigation_schedule(crop_id: str, sowing_date: str = "2025-06-15", rainfall_mm: float = 800, irrigation_level: float = 0.5):
    """Get week-by-week irrigation schedule."""
    try:
        return irrigation_schedule(crop_id, sowing_date, rainfall_mm, irrigation_level)
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))

@app.get("/api/crop-calendar/{crop_id}")
async def get_calendar(crop_id: str, season: Optional[str] = None):
    """Get crop calendar with key activity dates."""
    try:
        return get_crop_calendar(crop_id, season)
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))

@app.get("/api/pest-alerts/{crop_id}")
async def get_pest_alerts(crop_id: str, avg_temp_c: float = 28, rainfall_mm: float = 800):
    """Get pest and disease risk alerts based on weather conditions."""
    try:
        return pest_disease_alerts(crop_id, {"avg_temp_c": avg_temp_c, "rainfall_mm": rainfall_mm})
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))

@app.post("/api/loan-calculator")
async def calculate_loan(req: LoanRequest):
    """Calculate loan feasibility and EMI."""
    try:
        return loan_calculator(
            total_cost=req.total_cost,
            expected_profit=req.expected_profit,
            loan_amount=req.loan_amount,
            interest_rate_annual=req.interest_rate_annual,
            tenure_months=req.tenure_months,
        )
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))

@app.post("/api/soil-projection")
async def project_soil_health(req: SoilProjectionRequest):
    """Project soil NPK health over multiple years of crop rotation."""
    try:
        return soil_health_projection(
            current_soil=req.current_soil,
            rotation=req.rotation,
            years=req.years,
            apply_fertilizer=req.apply_fertilizer,
        )
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))

@app.get("/api/price-forecast/{region_id}/{crop_id}")
async def get_price_forecast(region_id: str, crop_id: str, months_ahead: int = 6):
    """Forecast mandi prices for next N months."""
    try:
        return price_forecast(region_id, crop_id, months_ahead)
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))

@app.get("/api/arbitrage/{crop_id}")
async def get_arbitrage(crop_id: str):
    """Find cross-mandi price arbitrage opportunities."""
    try:
        return cross_mandi_arbitrage(crop_id)
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))

@app.get("/api/strategy-templates")
async def get_templates(profile: Optional[str] = None):
    """Get pre-built strategy templates, optionally filtered by profile."""
    return get_strategy_templates(profile)

@app.post("/api/benchmark")
async def get_benchmark(req: BenchmarkRequest):
    """Compare user results against regional benchmarks."""
    try:
        return region_benchmark(
            region_id=req.region_id,
            crop_id=req.crop_id,
            user_yield_kg_per_acre=req.user_yield_kg_per_acre,
            user_profit_per_acre=req.user_profit_per_acre,
        )
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))

@app.post("/api/expense/log")
async def post_expense(req: ExpenseLogRequest):
    """Log an actual expense."""
    return log_expense(req.farm_id, req.category, req.amount, req.date, req.note)

@app.get("/api/expense/{farm_id}")
async def get_expenses(farm_id: str, planned_budget: Optional[float] = None):
    """Get expense summary with optional variance analysis."""
    return get_expense_summary(farm_id, planned_budget)

@app.get("/api/government-schemes")
async def get_schemes(crop_id: str = "all", region_id: str = "all", area_acres: float = 3, season: str = "all"):
    """Match eligible government schemes for farmer profile."""
    return match_government_schemes(crop_id, region_id, area_acres, season)

# ---------------------------------------------------------------------------
# ML Model Endpoints
# ---------------------------------------------------------------------------

@app.post("/api/ml/train")
async def train_models():
    """Train all 3 ML models (yield, price, crop recommendation)."""
    try:
        report = ml_train_all()
        return {"status": "success", "report": report}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/api/ml/status")
async def model_status():
    """Check which ML models are loaded and available."""
    import ml.predict as pred
    pred._load_ml_models()
    model_dir = os.path.join(os.path.dirname(os.path.dirname(__file__)), "ml", "models")
    manifest_path = os.path.join(model_dir, "manifest.json")
    manifest = None
    if os.path.exists(manifest_path):
        import json
        with open(manifest_path, "r") as f:
            manifest = json.load(f)
    return {
        "yield_model_loaded": pred._ml_yield_model is not None,
        "price_model_loaded": pred._ml_price_model is not None,
        "recommend_model_loaded": pred._ml_recommend_model is not None,
        "model_dir": model_dir,
        "models_exist": os.path.exists(os.path.join(model_dir, "yield_model.joblib")),
        "training_report": manifest,
    }

# ---------------------------------------------------------------------------
# Chatbot
# ---------------------------------------------------------------------------
class ChatRequest(BaseModel):
    message: str
    context: Optional[Dict[str, Any]] = None


@app.post("/api/chat")
async def chat(req: ChatRequest):
    """Site-aware assistant grounded in Mitti Mantra's data + engine."""
    try:
        return chatbot_answer(req.message, req.context or {})
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# Mount frontend files at /
frontend_dir = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "frontend")
if os.path.exists(frontend_dir):
    app.mount("/", StaticFiles(directory=frontend_dir, html=True), name="frontend")

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
