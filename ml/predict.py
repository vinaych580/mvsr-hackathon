from __future__ import annotations

import csv
from pathlib import Path
from statistics import mean
from typing import Any

import numpy as np

from utils.calculations import (
    CropParameter,
    calculate_risk_score_and_subscores,
    calculate_yield_kg_per_acre,
    clamp,
)

DATASET_DIR = Path(__file__).resolve().parents[1] / "dataset"
MODEL_DIR = Path(__file__).resolve().parent / "models"

# Module-level caches to avoid re-reading CSV on every function call
_cache_crop_params: dict[str, CropParameter] | None = None
_cache_yield_history: list[dict[str, str]] | None = None
_cache_weather: dict[tuple[str, str], dict[str, str]] | None = None
_cache_soil: dict[str, dict[str, str]] | None = None
_cache_mandi: list[dict[str, str]] | None = None

# ML model caches
_ml_yield_model = None
_ml_price_model = None
_ml_recommend_model = None
_ml_label_encoders = None
_ml_price_encoders = None
_ml_recommend_encoders = None
_ml_models_loaded = False


def _load_ml_models():
    """Load trained ML models from disk. Silent no-op if models don't exist."""
    global _ml_yield_model, _ml_price_model, _ml_recommend_model
    global _ml_label_encoders, _ml_price_encoders, _ml_recommend_encoders
    global _ml_models_loaded
    if _ml_models_loaded:
        return
    _ml_models_loaded = True
    try:
        import joblib
        ym = MODEL_DIR / "yield_model.joblib"
        if ym.exists():
            _ml_yield_model = joblib.load(ym)
        le = MODEL_DIR / "label_encoders.joblib"
        if le.exists():
            _ml_label_encoders = joblib.load(le)
        pm = MODEL_DIR / "price_model.joblib"
        if pm.exists():
            _ml_price_model = joblib.load(pm)
        pe = MODEL_DIR / "price_encoders.joblib"
        if pe.exists():
            _ml_price_encoders = joblib.load(pe)
        rm = MODEL_DIR / "recommend_model.joblib"
        if rm.exists():
            _ml_recommend_model = joblib.load(rm)
        re_ = MODEL_DIR / "recommend_encoders.joblib"
        if re_.exists():
            _ml_recommend_encoders = joblib.load(re_)
    except Exception:
        pass  # Fallback to heuristics


def _load_csv(file_name: str) -> list[dict[str, str]]:
    # Shared mtime-aware cache — avoids re-parsing CSVs on every ML call.
    from utils.csv_cache import load as _cached_load
    return _cached_load(file_name)


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
    """Returns the most recent year's weather data keyed by (region_id, season)."""
    global _cache_weather
    if _cache_weather is not None:
        return _cache_weather
    rows = _load_csv("weather.csv")
    data: dict[tuple[str, str], dict[str, str]] = {}
    for row in rows:
        key = (row["region_id"], row["season"])
        existing = data.get(key)
        if existing is None or int(row.get("year", 0)) >= int(existing.get("year", 0)):
            data[key] = row
    _cache_weather = data
    return data


def _load_soil_by_region() -> dict[str, dict[str, float | str]]:
    """Average numeric soil values when a region has multiple samples."""
    global _cache_soil
    if _cache_soil is not None:
        return _cache_soil
    rows = _load_csv("soil.csv")
    grouped: dict[str, list[dict[str, str]]] = {}
    for row in rows:
        grouped.setdefault(row["region_id"], []).append(row)
    numeric_keys = ["ph", "n_kg_per_acre", "p_kg_per_acre", "k_kg_per_acre", "organic_carbon_percent"]
    data: dict[str, dict[str, float | str]] = {}
    for region_id, group in grouped.items():
        merged: dict[str, float | str] = {"region_id": region_id, "soil_type": group[0]["soil_type"]}
        for k in numeric_keys:
            vals = [float(r[k]) for r in group if k in r]
            merged[k] = round(mean(vals), 2) if vals else 0.0
        data[region_id] = merged
    _cache_soil = data
    return data


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


def _ml_predict_yield(
    crop_id: str, region_id: str, season: str,
    crop_params_dict: dict, soil: dict, weather: dict, irrigation: float,
) -> float | None:
    """Try ML model prediction; return None if model unavailable."""
    _load_ml_models()
    if _ml_yield_model is None or _ml_label_encoders is None:
        return None
    try:
        cp = crop_params_dict.get(crop_id)
        if cp is None:
            return None
        crop_le = _ml_label_encoders["crop"]
        region_le = _ml_label_encoders["region"]
        season_le = _ml_label_encoders["season"]
        # Safely encode — return None if unseen label
        if crop_id not in crop_le.classes_:
            return None
        if region_id not in region_le.classes_:
            return None
        s = season.lower()
        if s not in season_le.classes_:
            s = "kharif"  # default
        features = np.array([[
            crop_le.transform([crop_id])[0],
            region_le.transform([region_id])[0],
            season_le.transform([s])[0],
            cp.base_yield_kg_per_acre,
            cp.water_requirement_mm,
            cp.temp_min_c,
            cp.temp_max_c,
            cp.npk_n_kg_per_acre,
            cp.npk_p_kg_per_acre,
            cp.npk_k_kg_per_acre,
            float(soil.get("ph", 7.0)),
            float(soil.get("n_kg_per_acre", 40)),
            float(soil.get("p_kg_per_acre", 20)),
            float(soil.get("k_kg_per_acre", 20)),
            float(soil.get("organic_carbon_pct", 0.5)),
            float(weather.get("rainfall_mm", 800)),
            float(weather.get("avg_temp_c", 28)),
            float(weather.get("min_temp_c", 20)),
            float(weather.get("max_temp_c", 35)),
            irrigation,
        ]], dtype=np.float32)
        pred = _ml_yield_model.predict(features)[0]
        return round(float(pred), 2)
    except Exception:
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
    crop = crop_params[crop_id]
    if not _season_match(season, crop.season):
        return 0.0

    # Try ML model first
    ml_pred = _ml_predict_yield(
        crop_id, region_id, season, crop_params, soil, weather, irrigation_level,
    )
    if ml_pred is not None and ml_pred > 0:
        return ml_pred

    # Fallback: heuristic formula
    history_rows = _load_yield_history()
    historical = _historical_yield_average(crop_id, region_id, history_rows)
    
    calc_yield = calculate_yield_kg_per_acre(
        crop=crop,
        soil=soil,
        weather=weather,
        irrigation_level=irrigation_level,
        seed_variety=seed_variety,
        sowing_date=sowing_date,
    )
    
    if historical is not None:
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
        "heat_risk": risk_subscores["heat"],
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


def mandi_price_analytics(region_id: str, crop_id: str) -> dict[str, Any]:
    """Compute price statistics, trend, volatility, and seasonal pattern for a crop in a region."""
    rows = _load_mandi_prices()
    prices = [
        {"date": r["date"], "price": float(r["price_inr_per_kg"]), "market": r.get("market_name", "")}
        for r in rows
        if r["region_id"] == region_id and r["crop_id"] == crop_id
    ]
    if not prices:
        raise ValueError(f"No mandi price data for {crop_id} in {region_id}")

    prices = sorted(prices, key=lambda x: x["date"])
    price_vals = [p["price"] for p in prices]
    n = len(price_vals)

    avg_price = mean(price_vals)
    std_dev = (sum((p - avg_price) ** 2 for p in price_vals) / max(n - 1, 1)) ** 0.5
    coeff_of_variation = (std_dev / avg_price * 100) if avg_price else 0.0

    # 3-month moving average
    ma3 = []
    for i in range(n):
        window = price_vals[max(0, i - 2):i + 1]
        ma3.append(round(mean(window), 2))

    # Trend direction: linear slope of last 6 prices
    recent = price_vals[-min(6, n):]
    if len(recent) >= 2:
        x_mean = (len(recent) - 1) / 2.0
        y_mean = mean(recent)
        num = sum((i - x_mean) * (y - y_mean) for i, y in enumerate(recent))
        den = sum((i - x_mean) ** 2 for i in range(len(recent)))
        slope = num / den if den else 0.0
        if slope > 0.3:
            trend = "rising"
        elif slope < -0.3:
            trend = "falling"
        else:
            trend = "stable"
    else:
        slope = 0.0
        trend = "insufficient_data"

    # Seasonal pattern: avg price by month
    monthly: dict[int, list[float]] = {}
    for p in prices:
        try:
            month = int(p["date"].split("-")[1])
            monthly.setdefault(month, []).append(p["price"])
        except (ValueError, IndexError):
            pass
    seasonal_pattern = {m: round(mean(v), 2) for m, v in sorted(monthly.items())}
    best_month = max(seasonal_pattern, key=seasonal_pattern.get) if seasonal_pattern else None
    worst_month = min(seasonal_pattern, key=seasonal_pattern.get) if seasonal_pattern else None

    return {
        "region_id": region_id,
        "crop_id": crop_id,
        "data_points": n,
        "current_price": price_vals[-1],
        "avg_price": round(avg_price, 2),
        "min_price": round(min(price_vals), 2),
        "max_price": round(max(price_vals), 2),
        "std_deviation": round(std_dev, 2),
        "volatility_pct": round(coeff_of_variation, 2),
        "trend_direction": trend,
        "trend_slope": round(slope, 3),
        "moving_avg_3m": ma3,
        "seasonal_pattern": seasonal_pattern,
        "best_selling_month": best_month,
        "worst_selling_month": worst_month,
        "price_timeline": [{"date": p["date"], "price": p["price"]} for p in prices],
    }


def rotation_planner(
    region_id: str,
    budget_per_acre: float,
    area_acres: float,
) -> dict[str, Any]:
    """Plan a kharif→rabi annual rotation maximizing combined profit & minimizing risk."""
    kharif_recs = recommend_crops(region_id, "kharif", budget_per_acre, area_acres, top_k=5)
    rabi_recs = recommend_crops(region_id, "rabi", budget_per_acre, area_acres, top_k=5)

    if not kharif_recs and not rabi_recs:
        raise ValueError(f"No crop recommendations available for {region_id}")

    # Score all kharif×rabi combos
    combos: list[dict[str, Any]] = []
    for k in (kharif_recs or [{"crop_id": None, "expected_profit": 0, "risk_score": 50, "smart_score": 0}]):
        for r in (rabi_recs or [{"crop_id": None, "expected_profit": 0, "risk_score": 50, "smart_score": 0}]):
            if k["crop_id"] is None and r["crop_id"] is None:
                continue
            annual_profit = (k.get("expected_profit", 0) or 0) + (r.get("expected_profit", 0) or 0)
            avg_risk = ((k.get("risk_score", 50) or 50) + (r.get("risk_score", 50) or 50)) / 2.0
            diversity_bonus = 5.0 if k.get("crop_id") != r.get("crop_id") else 0.0
            combo_score = ((k.get("smart_score", 0) or 0) + (r.get("smart_score", 0) or 0)) / 2.0 + diversity_bonus
            combos.append({
                "kharif_crop": k.get("crop_id"),
                "kharif_profit": k.get("expected_profit", 0),
                "kharif_risk": k.get("risk_score", 0),
                "rabi_crop": r.get("crop_id"),
                "rabi_profit": r.get("expected_profit", 0),
                "rabi_risk": r.get("risk_score", 0),
                "annual_profit": round(annual_profit, 2),
                "avg_risk_score": round(avg_risk, 2),
                "rotation_score": round(combo_score, 2),
            })

    ranked = sorted(combos, key=lambda x: x["rotation_score"], reverse=True)
    return {
        "region_id": region_id,
        "budget_per_acre": budget_per_acre,
        "area_acres": area_acres,
        "best_rotation": ranked[0] if ranked else None,
        "top_rotations": ranked[:5],
        "kharif_options": kharif_recs,
        "rabi_options": rabi_recs,
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


def _ml_recommend_crop(
    region_id: str, season: str, soil: dict, weather: dict,
    budget: float, irrigation: float,
) -> list[dict[str, float]] | None:
    """Use ML classifier to get ranked crop probabilities. Returns None if unavailable."""
    _load_ml_models()
    if _ml_recommend_model is None or _ml_recommend_encoders is None:
        return None
    try:
        region_le = _ml_recommend_encoders["region"]
        season_le = _ml_recommend_encoders["season"]
        crop_le = _ml_recommend_encoders["crop"]
        if region_id not in region_le.classes_:
            return None
        s = season.lower()
        if s not in season_le.classes_:
            s = "kharif"
        features = np.array([[
            region_le.transform([region_id])[0],
            season_le.transform([s])[0],
            float(soil.get("ph", 7.0)),
            float(soil.get("n_kg_per_acre", 40)),
            float(soil.get("p_kg_per_acre", 20)),
            float(soil.get("k_kg_per_acre", 20)),
            float(soil.get("organic_carbon_pct", 0.5)),
            float(weather.get("rainfall_mm", 800)),
            float(weather.get("avg_temp_c", 28)),
            float(weather.get("avg_temp_c", 28)) - 8,
            float(weather.get("avg_temp_c", 28)) + 7,
            budget,
            irrigation,
        ]], dtype=np.float32)
        probas = _ml_recommend_model.predict_proba(features)[0]
        classes = _ml_recommend_model.classes_
        result = []
        for idx, prob in zip(classes, probas):
            crop_name = crop_le.inverse_transform([idx])[0]
            result.append({"crop_id": crop_name, "ml_confidence": round(float(prob), 4)})
        result.sort(key=lambda x: x["ml_confidence"], reverse=True)
        return result
    except Exception:
        return None


def _ml_predict_price(
    region_id: str, crop_id: str, recent_prices: list[float], target_month: int, target_year: int,
) -> float | None:
    """Use ML model to predict a single future price point. Returns None if unavailable."""
    _load_ml_models()
    if _ml_price_model is None or _ml_price_encoders is None:
        return None
    try:
        crop_le = _ml_price_encoders["crop"]
        region_le = _ml_price_encoders["region"]
        if crop_id not in crop_le.classes_ or region_id not in region_le.classes_:
            return None
        if len(recent_prices) < 3:
            return None
        lag1, lag2, lag3 = recent_prices[-1], recent_prices[-2], recent_prices[-3]
        roll_mean = float(np.mean(recent_prices[-3:]))
        roll_std = float(np.std(recent_prices[-3:]))
        price_range = float(max(recent_prices) - min(recent_prices))
        features = np.array([[
            crop_le.transform([crop_id])[0],
            region_le.transform([region_id])[0],
            target_month,
            target_year - 2024,
            lag1, lag2, lag3,
            roll_mean, roll_std, price_range,
        ]], dtype=np.float32)
        pred = _ml_price_model.predict(features)[0]
        return round(float(max(pred, 0.5)), 2)
    except Exception:
        return None


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

    # Get ML confidence scores if available
    ml_conf = _ml_recommend_crop(region_id, season, soil, weather, budget_per_acre, 0.5)
    ml_conf_map: dict[str, float] = {}
    if ml_conf:
        ml_conf_map = {item["crop_id"]: item["ml_confidence"] for item in ml_conf}

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
        roi_normalized = clamp(profit["roi_percent"] / 3.0, 0.0, 100.0)
        n_ratio = soil.get("n_kg_per_acre", 40.0) / max(crop.npk_n_kg_per_acre, 1.0)
        p_ratio = soil.get("p_kg_per_acre", 20.0) / max(crop.npk_p_kg_per_acre, 1.0)
        k_ratio = soil.get("k_kg_per_acre", 20.0) / max(crop.npk_k_kg_per_acre, 1.0)
        soil_health = clamp(((n_ratio + p_ratio + k_ratio) / 3.0) * 100.0, 0.0, 120.0)

        # Blend ML confidence into smart_score if available
        ml_bonus = ml_conf_map.get(crop_id, 0.0) * 15  # Up to 15 points from ML
        smart_score = clamp(
            0.35 * roi_normalized
            + 0.20 * risk["confidence_score"]
            + 0.15 * budget_fit
            + 0.15 * soil_health
            + 0.15 * (ml_bonus if ml_bonus > 0 else roi_normalized * 0.15),
            0.0,
            100.0,
        )

        rec_entry = {
            "crop_id": crop_id,
            "crop_name": crop.crop_name,
            "predicted_yield_kg_per_acre": predicted_yield,
            "expected_profit": profit["expected_profit"],
            "roi_percent": profit["roi_percent"],
            "risk_score": risk["risk_score"],
            "smart_score": round(smart_score, 2),
            "prediction_source": "ml_model" if _ml_yield_model is not None else "heuristic",
            "reason": "Ranked using ML models + location, soil, season fit, budget fit, profit, and risk confidence.",
        }
        if crop_id in ml_conf_map:
            rec_entry["ml_confidence"] = ml_conf_map[crop_id]
        recommendations.append(rec_entry)

    ranked = sorted(recommendations, key=lambda x: x["smart_score"], reverse=True)
    return ranked[:top_k]
