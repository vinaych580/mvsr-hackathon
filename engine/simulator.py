from __future__ import annotations

import csv
from pathlib import Path
from typing import Any

from utils.calculations import (
    CropParameter,
    calculate_risk_score_and_subscores,
    calculate_yield_kg_per_acre,
)

DATASET_DIR = Path(__file__).resolve().parents[1] / "dataset"

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
            npk_n_kg_per_acre=float(row["npk_n_kg_per_acre"]),
            npk_p_kg_per_acre=float(row["npk_p_kg_per_acre"]),
            npk_k_kg_per_acre=float(row["npk_k_kg_per_acre"]),
        )
    _crop_params_cache = data
    return data


def estimate_yield_kg_per_acre(strategy: dict[str, Any]) -> float:
    crop_id = strategy["crop_id"]
    crop = _load_crop_parameters()[crop_id]
    return calculate_yield_kg_per_acre(
        crop=crop,
        soil=strategy["soil"],
        weather=strategy["weather"],
        irrigation_level=float(strategy.get("irrigation_level", 0.5)),
        seed_variety=strategy.get("seed_variety"),
        sowing_date=strategy.get("sowing_date"),
    )


def calculate_cost_per_acre(strategy: dict[str, Any]) -> dict[str, float]:
    plan = strategy.get("input_plan", {})
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
    return calculate_risk_score_and_subscores(
        crop=crop,
        weather=strategy["weather"],
        soil=strategy["soil"],
        irrigation_level=float(strategy.get("irrigation_level", 0.5)),
    )


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
            "Yield estimation includes soil, weather, irrigation, and seed variety factors.",
            "Input costs are provided per acre and scaled linearly by area.",
            "Single mandi price is applied across total production.",
        ],
    }
