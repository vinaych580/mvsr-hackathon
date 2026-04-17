from __future__ import annotations

import csv
from pathlib import Path
from statistics import mean
from typing import Any

from utils.calculations import (
    CropParameter,
    calculate_risk_score_and_subscores,
    calculate_yield_kg_per_acre,
    clamp,
)

DATASET_DIR = Path(__file__).resolve().parents[1] / "dataset"

# Module-level caches to avoid re-reading CSV on every function call
_cache_crop_params: dict[str, CropParameter] | None = None
_cache_yield_history: list[dict[str, str]] | None = None
_cache_weather: dict[tuple[str, str], dict[str, str]] | None = None
_cache_soil: dict[str, dict[str, str]] | None = None
_cache_mandi: list[dict[str, str]] | None = None


def _load_csv(file_name: str) -> list[dict[str, str]]:
    file_path = DATASET_DIR / file_name
    with file_path.open("r", newline="", encoding="utf-8") as handle:
        return list(csv.DictReader(handle))


def _load_crop_parameters() -> dict[str, CropParameter]:
    global _cache_crop_params
    if _cache_crop_params is not None:
        return _cache_crop_params
    rows = _load_csv("crop_parameters.csv")
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
    _cache_crop_params = data
    return data


def _load_yield_history() -> list[dict[str, str]]:
    global _cache_yield_history
    if _cache_yield_history is not None:
        return _cache_yield_history
    _cache_yield_history = _load_csv("yield_history.csv")
    return _cache_yield_history


def _load_weather_by_region() -> dict[tuple[str, str], dict[str, str]]:
    """Returns weather data keyed by (region_id, season) to support multiple seasons per region."""
    global _cache_weather
    if _cache_weather is not None:
        return _cache_weather
    rows = _load_csv("weather.csv")
    data: dict[tuple[str, str], dict[str, str]] = {}
    for row in rows:
        key = (row["region_id"], row["season"])
        data[key] = row
    _cache_weather = data
    return data


def _load_soil_by_region() -> dict[str, dict[str, str]]:
    global _cache_soil
    if _cache_soil is not None:
        return _cache_soil
    rows = _load_csv("soil.csv")
    _cache_soil = {row["region_id"]: row for row in rows}
    return _cache_soil


def _load_mandi_prices() -> list[dict[str, str]]:
    global _cache_mandi
    if _cache_mandi is not None:
        return _cache_mandi
    _cache_mandi = _load_csv("mandi_prices.csv")
    return _cache_mandi


def _season_match(input_season: str, crop_season: str) -> bool:
    return input_season.lower() in crop_season


def _historical_yield_average(crop_id: str, region_id: str, history_rows: list[dict[str, str]]) -> float | None:
    region_crop = [
        float(row["yield_kg_per_acre"])
        for row in history_rows
        if row["crop_id"] == crop_id and row["region_id"] == region_id
    ]
    if region_crop:
        return mean(region_crop)

    crop_only = [float(row["yield_kg_per_acre"]) for row in history_rows if row["crop_id"] == crop_id]
    if crop_only:
        return mean(crop_only)
    return None


def predict_yield_kg_per_acre(
    crop_id: str,
    region_id: str,
    season: str,
    weather: dict[str, float],
    soil: dict[str, float],
    irrigation_level: float = 0.5,
    seed_variety: str | None = None,
    sowing_date: str | None = None,
) -> float:
    crop_params = _load_crop_parameters()
    history_rows = _load_yield_history()
    crop = crop_params[crop_id]
    if not _season_match(season, crop.season):
        return 0.0

    historical = _historical_yield_average(crop_id, region_id, history_rows)
    
    # We use a combined approach: historical baseline adjusted by current factors
    # But to maintain consistency with Simulator, we should use the same logic
    # Maybe we can use historical as a multiplier or just use the same formula
    # Let's use the formula but scale it if historical data exists
    
    calc_yield = calculate_yield_kg_per_acre(
        crop=crop,
        soil=soil,
        weather=weather,
        irrigation_level=irrigation_level,
        seed_variety=seed_variety,
        sowing_date=sowing_date,
    )
    
    if historical is not None:
        # Adjustment factor based on history
        historical_baseline = crop.base_yield_kg_per_acre
        adjustment = historical / historical_baseline if historical_baseline else 1.0
        return round(calc_yield * adjustment, 2)
    
    return calc_yield


def smart_risk_score(
    crop_id: str,
    weather: dict[str, float],
    soil: dict[str, float],
    budget_per_acre: float,
    irrigation_level: float = 0.5,
) -> dict[str, float]:
    crop = _load_crop_parameters()[crop_id]
    
    risk_score, risk_subscores = calculate_risk_score_and_subscores(
        crop=crop,
        weather=weather,
        soil=soil,
        irrigation_level=irrigation_level,
    )
    
    # Budget risk is specific to ML predictor's smart_risk_score
    budget_risk = clamp((crop.avg_input_cost_inr_per_acre - budget_per_acre) / max(crop.avg_input_cost_inr_per_acre, 1.0) * 100.0, 0.0, 100.0)
    
    # Re-calculate total risk including budget risk
    # We'll give budget risk a 15% weight as before, and scale others
    total_risk = (risk_score * 0.85) + (budget_risk * 0.15)
    
    confidence_score = 100.0 - total_risk
    
    return {
        "risk_score": round(total_risk, 2),
        "confidence_score": round(clamp(confidence_score, 0.0, 100.0), 2),
        "drought_risk": risk_subscores["drought"],
        "heat_risk": risk_subscores["pest"],  # Aligning pest with heat as per original logic
        "flood_risk": risk_subscores["flood"],
        "price_volatility_risk": risk_subscores["price_volatility"],
        "budget_risk": round(budget_risk, 2),
    }


def profit_estimator(
    crop_id: str,
    predicted_yield_kg_per_acre: float,
    area_acres: float,
    budget_per_acre: float,
    mandi_price_per_kg: float | None = None,
) -> dict[str, float]:
    crop = _load_crop_parameters()[crop_id]
    price = mandi_price_per_kg or ((crop.mandi_price_min_inr_per_kg + crop.mandi_price_max_inr_per_kg) / 2.0)
    total_yield = predicted_yield_kg_per_acre * area_acres
    total_cost = budget_per_acre * area_acres
    expected_revenue = total_yield * price
    expected_profit = expected_revenue - total_cost
    roi_percent = (expected_profit / total_cost * 100.0) if total_cost else 0.0

    optimistic_profit = (total_yield * 1.1 * price * 1.08) - total_cost
    pessimistic_profit = (total_yield * 0.88 * price * 0.9) - total_cost

    return {
        "expected_revenue": round(expected_revenue, 2),
        "expected_profit": round(expected_profit, 2),
        "roi_percent": round(roi_percent, 2),
        "optimistic_profit": round(optimistic_profit, 2),
        "pessimistic_profit": round(pessimistic_profit, 2),
        "break_even_price_per_kg": round((total_cost / total_yield) if total_yield else 0.0, 2),
    }


def location_based_insights(region_id: str, season: str = "kharif") -> dict[str, Any]:
    weather_data = _load_weather_by_region()
    soil_data = _load_soil_by_region()
    mandi_rows = _load_mandi_prices()

    weather_key = (region_id, season)
    if weather_key not in weather_data or region_id not in soil_data:
        raise ValueError(f"Unsupported region_id: {region_id} or season: {season}")

    weather = weather_data[weather_key]
    soil = soil_data[region_id]
    local_prices = [row for row in mandi_rows if row["region_id"] == region_id]
    top_price_rows = sorted(local_prices, key=lambda x: float(x["price_inr_per_kg"]), reverse=True)[:3]

    rainfall = float(weather["rainfall_mm"])
    rain_band = "high rainfall" if rainfall >= 800 else ("moderate rainfall" if rainfall >= 450 else "low rainfall")

    return {
        "region_id": region_id,
        "season": weather["season"],
        "rainfall_mm": rainfall,
        "avg_temp_c": float(weather["avg_temp_c"]),
        "soil_type": soil["soil_type"],
        "soil_ph": float(soil["ph"]),
        "rainfall_trend_hint": f"This region is currently in a {rain_band} band.",
        "best_priced_local_crops": [
            {"crop_id": row["crop_id"], "price_inr_per_kg": float(row["price_inr_per_kg"])}
            for row in top_price_rows
        ],
    }


def recommend_crops(
    region_id: str,
    season: str,
    budget_per_acre: float,
    area_acres: float,
    top_k: int = 3,
) -> list[dict[str, Any]]:
    crop_params = _load_crop_parameters()
    weather_data = _load_weather_by_region()
    soil_data = _load_soil_by_region()
    mandi_rows = _load_mandi_prices()

    weather_key = (region_id, season)
    if weather_key not in weather_data or region_id not in soil_data:
        raise ValueError(f"Unsupported region_id: {region_id} or season: {season}")

    weather = {
        "rainfall_mm": float(weather_data[weather_key]["rainfall_mm"]),
        "avg_temp_c": float(weather_data[weather_key]["avg_temp_c"]),
    }
    soil = {
        "ph": float(soil_data[region_id]["ph"]),
        "n_kg_per_acre": float(soil_data[region_id]["n_kg_per_acre"]),
        "p_kg_per_acre": float(soil_data[region_id]["p_kg_per_acre"]),
        "k_kg_per_acre": float(soil_data[region_id]["k_kg_per_acre"]),
    }

    region_crop_price: dict[str, float] = {}
    for row in mandi_rows:
        if row["region_id"] == region_id:
            region_crop_price[row["crop_id"]] = float(row["price_inr_per_kg"])

    recommendations: list[dict[str, Any]] = []
    for crop_id, crop in crop_params.items():
        if not _season_match(season, crop.season):
            continue

        predicted_yield = predict_yield_kg_per_acre(crop_id, region_id, season, weather, soil)
        risk = smart_risk_score(crop_id, weather, soil, budget_per_acre)
        price = region_crop_price.get(crop_id, (crop.mandi_price_min_inr_per_kg + crop.mandi_price_max_inr_per_kg) / 2.0)
        profit = profit_estimator(
            crop_id=crop_id,
            predicted_yield_kg_per_acre=predicted_yield,
            area_acres=area_acres,
            budget_per_acre=budget_per_acre,
            mandi_price_per_kg=price,
        )

        budget_fit = clamp((budget_per_acre / max(crop.avg_input_cost_inr_per_acre, 1.0)) * 100.0, 0.0, 120.0)
        # Normalize ROI to 0-100 scale using 300% as the effective ceiling
        roi_normalized = clamp(profit["roi_percent"] / 3.0, 0.0, 100.0)
        smart_score = clamp(
            0.45 * roi_normalized
            + 0.25 * risk["confidence_score"]
            + 0.20 * budget_fit
            + 0.10 * 100.0,
            0.0,
            100.0,
        )

        recommendations.append(
            {
                "crop_id": crop_id,
                "crop_name": crop.crop_name,
                "predicted_yield_kg_per_acre": predicted_yield,
                "expected_profit": profit["expected_profit"],
                "roi_percent": profit["roi_percent"],
                "risk_score": risk["risk_score"],
                "smart_score": round(smart_score, 2),
                "reason": "Ranked using location, soil, season fit, budget fit, profit, and risk confidence.",
            }
        )

    ranked = sorted(recommendations, key=lambda x: x["smart_score"], reverse=True)
    return ranked[:top_k]
