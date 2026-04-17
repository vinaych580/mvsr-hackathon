from fastapi import FastAPI, HTTPException
from pydantic import BaseModel
from typing import Dict, Any
import sys
import os

# Add project root to path to import engine and utils
sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from engine.simulator import simulate

app = FastAPI(title="MVSR Hackathon - Farm Simulator")

class SimulationRequest(BaseModel):
    crop_id: str
    area_acres: float
    region_id: str
    seed_variety: str = "standard"
    sowing_date: str = "2024-06-15"

@app.get("/crops")
async def get_crops():
    import csv
    crops = []
    with open("dataset/crop_parameters.csv", "r") as f:
        reader = csv.DictReader(f)
        for row in reader:
            crops.append(row)
    return crops

@app.post("/simulate")
async def run_simulation(request: SimulationRequest):
    try:
        strategy = request.dict()
        result = simulate(strategy)
        return result
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
