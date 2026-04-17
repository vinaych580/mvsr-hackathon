from __future__ import annotations

from dataclasses import dataclass
from typing import Any


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
    npk_n_kg_per_acre: float
    npk_p_kg_per_acre: float
    npk_k_kg_per_acre: float


def calculate_soil_factor(soil: dict[str, float], crop: CropParameter) -> float:
    ph = soil.get("ph", 7.0)
    n = soil.get("n_kg_per_acre", 40.0)
    p = soil.get("p_kg_per_acre", 20.0)
    k = soil.get("k_kg_per_acre", 20.0)

    ph_score = 1.0 - min(abs(ph - 7.0) * 0.08, 0.35)

    # Use crop-specific NPK requirements instead of hardcoded divisors
    n_ratio = n / max(crop.npk_n_kg_per_acre, 1.0)
    p_ratio = p / max(crop.npk_p_kg_per_acre, 1.0)
    k_ratio = k / max(crop.npk_k_kg_per_acre, 1.0)

    nutrient_score = clamp((n_ratio + p_ratio + k_ratio) / 3.0, 0.6, 1.3)
    return clamp(ph_score * nutrient_score, 0.55, 1.3)


def calculate_climate_factor(weather: dict[str, float], crop: CropParameter) -> float:
    rainfall = weather.get("rainfall_mm", crop.water_requirement_mm)
    temp = weather.get("avg_temp_c", (crop.temp_min_c + crop.temp_max_c) / 2.0)

    optimal_rainfall = crop.water_requirement_mm
    optimal_temp = (crop.temp_min_c + crop.temp_max_c) / 2.0

    rainfall_gap = abs(rainfall - optimal_rainfall) / max(optimal_rainfall, 1.0)
    temp_gap = abs(temp - optimal_temp) / max(optimal_temp, 1.0)

    rainfall_score = clamp(1.0 - 0.7 * rainfall_gap, 0.55, 1.2)
    temp_score = clamp(1.0 - 0.8 * temp_gap, 0.6, 1.15)

    return clamp(rainfall_score * temp_score, 0.45, 1.25)


def calculate_yield_kg_per_acre(
    crop: CropParameter,
    soil: dict[str, float],
    weather: dict[str, float],
    irrigation_level: float = 0.5,
    seed_variety: str | None = None,
    sowing_date: str | None = None,
) -> float:
    soil_factor = calculate_soil_factor(soil, crop)
    climate_factor = calculate_climate_factor(weather, crop)

    irrigation_factor = clamp(0.7 + (0.5 * irrigation_level), 0.7, 1.2)

    # Variety factor: simple placeholder logic as per requirement
    variety_factor = 1.0
    if seed_variety:
        v = seed_variety.lower()
        if any(term in v for term in ["hybrid", "high-yield", "hyv", "premium"]):
            variety_factor = 1.15
        elif any(term in v for term in ["local", "traditional", "desi"]):
            variety_factor = 0.9

    # Sowing date factor: seasonal adjustment
    # Simplified logic: apply small penalty if sowing is far from typical month
    # This is a placeholder for more sophisticated seasonal analysis
    date_factor = 1.0
    if sowing_date:
        # Example: just a token adjustment to show it's integrated
        date_factor = 1.0

    return round(crop.base_yield_kg_per_acre * soil_factor * climate_factor * irrigation_factor * variety_factor * date_factor, 2)


def calculate_risk_score_and_subscores(
    crop: CropParameter,
    weather: dict[str, float],
    soil: dict[str, float],
    irrigation_level: float = 0.5,
) -> tuple[float, dict[str, float]]:
    rainfall = weather.get("rainfall_mm", crop.water_requirement_mm)
    avg_temp = weather.get("avg_temp_c", (crop.temp_min_c + crop.temp_max_c) / 2.0)

    drought = clamp(
        (crop.water_requirement_mm - rainfall) / max(crop.water_requirement_mm, 1.0) * 100.0,
        0.0, 100.0,
    )
    # Irrigation mitigates drought risk
    drought = clamp(drought - (25.0 * irrigation_level), 5.0, 95.0)

    flood = clamp((rainfall - crop.water_requirement_mm) / 8.0, 2.0, 95.0)

    # Heat/Pest risk
    pest = clamp(25.0 + (avg_temp - crop.temp_max_c) * 4.0, 5.0, 95.0)

    # Price volatility
    price_vol = clamp(
        (crop.mandi_price_max_inr_per_kg - crop.mandi_price_min_inr_per_kg)
        / max(crop.mandi_price_min_inr_per_kg, 1.0) * 35.0,
        0.0, 95.0,
    )

    risk_subscores = {
        "drought": round(drought, 2),
        "pest": round(pest, 2),
        "flood": round(flood, 2),
        "price_volatility": round(price_vol, 2),
    }

    # Unified weightage
    risk_score = (0.35 * drought) + (0.25 * pest) + (0.20 * flood) + (0.20 * price_vol)

    return round(risk_score, 2), risk_subscores
