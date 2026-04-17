from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel
from typing import Dict, Any, List, Optional
import sys
import os
import csv

# Add project root to path to import engine and utils
sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from engine.simulator import simulate
from ml.predict import recommend_crops, location_based_insights

app = FastAPI(title="AgriSim - Farm Intelligence Platform")

# Allow CORS for local dev
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

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
    input_plan: Optional[Dict[str, float]] = {}

class RecommendationRequest(BaseModel):
    region_id: str
    season: str
    budget_per_acre: float
    area_acres: float

class CompareRequest(BaseModel):
    strategies: List[SimulationRequest]

# --- Helper functions ---
def read_csv(filename: str) -> List[Dict[str, str]]:
    filepath = os.path.join(os.path.dirname(os.path.dirname(__file__)), "dataset", filename)
    if not os.path.exists(filepath):
        return []
    with open(filepath, "r", encoding="utf-8") as f:
        return list(csv.DictReader(f))

# --- API Endpoints ---

@app.get("/api/crops")
async def get_crops():
    return read_csv("crop_parameters.csv")

@app.get("/api/crops/{crop_id}")
async def get_crop(crop_id: str):
    crops = read_csv("crop_parameters.csv")
    for crop in crops:
        if crop["crop_id"] == crop_id:
            return crop
    raise HTTPException(status_code=404, detail="Crop not found")

@app.get("/api/regions")
async def get_regions():
    soil_data = read_csv("soil.csv")
    regions = []
    seen = set()
    for row in soil_data:
        rid = row["region_id"]
        if rid not in seen:
            # Clean region id for display: "telangana_medak" -> "Telangana - Medak"
            parts = rid.split('_')
            name = " - ".join(p.capitalize() for p in parts)
            regions.append({"id": rid, "name": name})
            seen.add(rid)
    return regions

@app.get("/api/weather/{region_id}")
async def get_weather(region_id: str, season: Optional[str] = None):
    weather_data = read_csv("weather.csv")
    results = [row for row in weather_data if row["region_id"] == region_id]
    if season:
        results = [row for row in results if row["season"] == season]
    if not results:
        raise HTTPException(status_code=404, detail="Weather data not found for region")
    # Return the most recent year's data or average
    return results[-1] 

@app.get("/api/soil/{region_id}")
async def get_soil(region_id: str):
    soil_data = read_csv("soil.csv")
    for row in soil_data:
        if row["region_id"] == region_id:
            return row
    raise HTTPException(status_code=404, detail="Soil data not found for region")

@app.get("/api/mandi-prices/{region_id}")
async def get_mandi_prices(region_id: str, crop_id: Optional[str] = None):
    mandi_data = read_csv("mandi_prices.csv")
    results = [row for row in mandi_data if row["region_id"] == region_id]
    if crop_id:
        results = [row for row in results if row["crop_id"] == crop_id]
    return results

@app.get("/api/yield-history/{region_id}")
async def get_yield_history(region_id: str, crop_id: Optional[str] = None):
    history = read_csv("yield_history.csv")
    results = [row for row in history if row["region_id"] == region_id]
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
        strategy = request.dict()
        result = simulate(strategy)
        return result
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))

@app.post("/api/compare-strategies")
async def compare_strategies(req: CompareRequest):
    try:
        results = []
        for strategy in req.strategies:
            strat_dict = strategy.dict()
            res = simulate(strat_dict)
            results.append({
                "strategy": strat_dict,
                "result": res
            })
        return {"comparisons": results}
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))

# Mount frontend files at /
frontend_dir = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "frontend")
if os.path.exists(frontend_dir):
    app.mount("/", StaticFiles(directory=frontend_dir, html=True), name="frontend")

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
