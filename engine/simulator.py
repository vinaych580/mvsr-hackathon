from __future__ import annotations

import csv
from dataclasses import dataclass
from pathlib import Path
from typing import Any


DATASET_DIR = Path(__file__).resolve().parents[1] / "dataset"


def clamp(value: float, low: float, high: float) -> float:
    return max(low, min(high, value))


@dataclass
class CropParameter:
    crop_id: str
    crop_name: str
    season: str
    base_yield_kg_per_acre: float
    water_requirement_mm: float
    temp_min_c: float
    temp_max_c: float
    avg_input_cost_inr_per_acre: float
    mandi_price_min_inr_per_kg: float
    mandi_price_max_inr_per_kg: float


# Module-level cache to avoid re-reading CSV on every call
_crop_params_cache: dict[str, CropParameter] | None = None


def _load_crop_parameters() -> dict[str, CropParameter]:
    global _crop_params_cache
    if _crop_params_cache is not None:
        return _crop_params_cache

    file_path = DATASET_DIR / "crop_parameters.csv"
    with file_path.open("r", newline="", encoding="utf-8") as handle:
        rows = list(csv.DictReader(handle))

    data: dict[str, CropParameter] = {}
    for row in rows:
        crop_id = row["crop_id"]
        data[crop_id] = CropParameter(
            crop_id=crop_id,
            crop_name=row["crop_name"],
            season=row["season"].lower(),
            base_yield_kg_per_acre=float(row["base_yield_kg_per_acre"]),
            water_requirement_mm=float(row["water_requirement_mm"]),
            temp_min_c=float(row["temp_min_c"]),
            temp_max_c=float(row["temp_max_c"]),
            avg_input_cost_inr_per_acre=float(row["avg_input_cost_inr_per_acre"]),
            mandi_price_min_inr_per_kg=float(row["mandi_price_min_inr_per_kg"]),
            mandi_price_max_inr_per_kg=float(row["mandi_price_max_inr_per_kg"]),
        )
    _crop_params_cache = data
    return data


def _soil_factor(soil: dict[str, float]) -> float:
    ph = soil.get("ph", 7.0)
    n = soil.get("n_kg_per_acre", 40.0)
    p = soil.get("p_kg_per_acre", 20.0)
    k = soil.get("k_kg_per_acre", 20.0)
    ph_score = 1.0 - min(abs(ph - 7.0) * 0.08, 0.35)
    nutrient_score = clamp((n / 50.0 + p / 25.0 + k / 180.0) / 3.0, 0.6, 1.3)
    return clamp(ph_score * nutrient_score, 0.55, 1.3)


def _climate_factor(weather: dict[str, float], crop: CropParameter) -> float:
    rainfall = weather.get("rainfall_mm", crop.water_requirement_mm)
    temp = weather.get("avg_temp_c", (crop.temp_min_c + crop.temp_max_c) / 2.0)
    optimal_rainfall = crop.water_requirement_mm
    optimal_temp = (crop.temp_min_c + crop.temp_max_c) / 2.0
    rainfall_gap = abs(rainfall - optimal_rainfall) / max(optimal_rainfall, 1.0)
    temp_gap = abs(temp - optimal_temp) / max(optimal_temp, 1.0)
    rainfall_score = clamp(1.0 - 0.7 * rainfall_gap, 0.55, 1.2)
    temp_score = clamp(1.0 - 0.8 * temp_gap, 0.6, 1.15)
    return clamp(rainfall_score * temp_score, 0.45, 1.25)


def _irrigation_factor(irrigation_level: float) -> float:
    return clamp(0.7 + (0.5 * irrigation_level), 0.7, 1.2)


def estimate_yield_kg_per_acre(strategy: dict[str, Any]) -> float:
    crop_id = strategy["crop_id"]
    crop = _load_crop_parameters()[crop_id]
    soil_factor = _soil_factor(strategy["soil"])
    climate_factor = _climate_factor(strategy["weather"], crop)
    irrigation_factor = _irrigation_factor(float(strategy.get("irrigation_level", 0.5)))
    return crop.base_yield_kg_per_acre * soil_factor * climate_factor * irrigation_factor


def calculate_cost_per_acre(strategy: dict[str, Any]) -> dict[str, float]:
    plan = strategy["input_plan"]
    return {
        "seed": float(plan.get("seed_cost_per_acre", 0.0)),
        "fertilizer": float(plan.get("fertilizer_cost_per_acre", 0.0)),
        "labour": float(plan.get("labour_cost_per_acre", 0.0)),
        "irrigation": float(plan.get("irrigation_cost_per_acre", 0.0)),
        "pesticide": float(plan.get("pesticide_cost_per_acre", 0.0)),
        "machinery": float(plan.get("machinery_cost_per_acre", 0.0)),
    }


def calculate_risk_score(strategy: dict[str, Any]) -> tuple[float, dict[str, float]]:
    crop_id = strategy["crop_id"]
    crop = _load_crop_parameters()[crop_id]
    weather = strategy["weather"]
    irrigation_level = float(strategy.get("irrigation_level", 0.5))
    rainfall = float(weather.get("rainfall_mm", 700.0))
    avg_temp = float(weather.get("avg_temp_c", 26.0))

    drought = clamp(
        (crop.water_requirement_mm - rainfall) / max(crop.water_requirement_mm, 1.0) * 100.0,
        5.0, 95.0,
    )
    # Irrigation mitigates drought risk
    drought = clamp(drought - (25.0 * irrigation_level), 5.0, 95.0)

    flood = clamp((rainfall - crop.water_requirement_mm) / 8.0, 2.0, 95.0)
    pest = clamp(25.0 + (avg_temp - crop.temp_max_c) * 4.0, 5.0, 95.0)

    # Compute price volatility from actual mandi price band
    price_vol = clamp(
        (crop.mandi_price_max_inr_per_kg - crop.mandi_price_min_inr_per_kg)
        / max(crop.mandi_price_min_inr_per_kg, 1.0) * 35.0,
        0.0, 95.0,
    )

    risk_subscores = {
        "drought": drought,
        "pest": pest,
        "flood": flood,
        "price_volatility": price_vol,
    }
    risk_score = (0.35 * drought) + (0.25 * pest) + (0.2 * flood) + (0.2 * price_vol)
    return round(risk_score, 2), {k: round(v, 2) for k, v in risk_subscores.items()}


def simulate(strategy_dict: dict[str, Any]) -> dict[str, Any]:
    crop_id = strategy_dict["crop_id"]
    crop_params = _load_crop_parameters()
    if crop_id not in crop_params:
        raise ValueError(f"Unsupported crop_id: {crop_id}")

    area = float(strategy_dict["area_acres"])
    yield_per_acre = estimate_yield_kg_per_acre(strategy_dict)
    total_yield = yield_per_acre * area
    mandi_price = float(strategy_dict["mandi_price_per_kg"])

    cost_breakdown_per_acre = calculate_cost_per_acre(strategy_dict)
    total_cost_per_acre = sum(cost_breakdown_per_acre.values())
    total_cost = total_cost_per_acre * area
    revenue = total_yield * mandi_price
    profit = revenue - total_cost
    roi_percent = (profit / total_cost * 100.0) if total_cost else 0.0

    risk_score, risk_subscores = calculate_risk_score(strategy_dict)
    return {
        "crop_id": crop_id,
        "area_acres": area,
        "yield_kg_per_acre": round(yield_per_acre, 2),
        "total_yield_kg": round(total_yield, 2),
        "cost_breakdown_per_acre": {k: round(v, 2) for k, v in cost_breakdown_per_acre.items()},
        "total_cost": round(total_cost, 2),
        "revenue": round(revenue, 2),
        "profit": round(profit, 2),
        "roi_percent": round(roi_percent, 2),
        "risk_score": risk_score,
        "risk_subscores": risk_subscores,
        "assumptions": [
            "Crop parameters are read from crop_parameters.csv.",
            "Input costs are provided per acre and scaled linearly by area.",
            "Single mandi price is applied across total production.",
        ],
    }
