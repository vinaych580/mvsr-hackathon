"""
ml/train_models.py
Training pipeline for 3 ML models:
  1. Yield Prediction       – RandomForestRegressor
  2. Price Forecasting      – GradientBoostingRegressor with lag features
  3. Crop Recommendation    – RandomForestClassifier (best crop for conditions)

Run directly:  python -m ml.train_models
Or via API:    POST /api/train
"""
from __future__ import annotations

import csv
import hashlib
import json
import random
import warnings
from pathlib import Path
from typing import Any

import joblib
import numpy as np
from sklearn.ensemble import (
    GradientBoostingRegressor,
    RandomForestClassifier,
    RandomForestRegressor,
)
from sklearn.metrics import (
    accuracy_score,
    mean_absolute_error,
    mean_squared_error,
    r2_score,
)
from sklearn.model_selection import train_test_split
from sklearn.preprocessing import LabelEncoder

warnings.filterwarnings("ignore", category=UserWarning)

DATASET_DIR = Path(__file__).resolve().parents[1] / "dataset"
MODEL_DIR = Path(__file__).resolve().parent / "models"
MODEL_DIR.mkdir(exist_ok=True)

# ---------------------------------------------------------------------------
# CSV helpers
# ---------------------------------------------------------------------------

def _load_csv(name: str) -> list[dict[str, str]]:
    path = DATASET_DIR / name
    if not path.exists():
        return []
    with path.open("r", newline="", encoding="utf-8") as f:
        return list(csv.DictReader(f))


# ---------------------------------------------------------------------------
# Encoders (saved alongside models so predict.py can reuse them)
# ---------------------------------------------------------------------------

def _fit_label_encoders(crops: list[str], regions: list[str], seasons: list[str]):
    crop_le = LabelEncoder().fit(sorted(set(crops)))
    region_le = LabelEncoder().fit(sorted(set(regions)))
    season_le = LabelEncoder().fit(sorted(set(seasons)))
    return crop_le, region_le, season_le


# ===================================================================
# 1. YIELD PREDICTION MODEL
# ===================================================================

def _build_yield_dataset() -> tuple[np.ndarray, np.ndarray]:
    """
    Build training data for yield prediction by joining:
      yield_history × crop_parameters × soil × weather
    Then augment with gaussian noise to ~500+ samples.
    """
    yield_hist = _load_csv("yield_history.csv")
    crop_params = {r["crop_id"]: r for r in _load_csv("crop_parameters.csv")}
    soil_data = {}
    for r in _load_csv("soil.csv"):
        soil_data[r["region_id"]] = r
    weather_rows = _load_csv("weather.csv")
    weather_data = {}
    for r in weather_rows:
        key = (r["region_id"], r["season"].lower())
        weather_data[key] = r

    all_crops = sorted(crop_params.keys())
    all_regions = sorted(soil_data.keys())
    all_seasons = ["kharif", "rabi", "annual"]

    crop_le, region_le, season_le = _fit_label_encoders(all_crops, all_regions, all_seasons)

    rows_X, rows_y = [], []

    for row in yield_hist:
        cid = row["crop_id"]
        rid = row["region_id"]
        season = row.get("season", "kharif").lower()
        yld = float(row["yield_kg_per_acre"])

        if cid not in crop_params or rid not in soil_data:
            continue

        cp = crop_params[cid]
        soil = soil_data[rid]
        wkey = (rid, season)
        weather = weather_data.get(wkey, {})

        features = _yield_features(cid, rid, season, cp, soil, weather,
                                   crop_le, region_le, season_le,
                                   irrigation=0.5)
        rows_X.append(features)
        rows_y.append(yld)

    # ---- Data augmentation ----
    # With only ~70 real rows, we augment by perturbing numeric features ±10%
    rng = np.random.RandomState(42)
    aug_X, aug_y = [], []
    for i in range(len(rows_X)):
        for _ in range(6):  # 6 augmentations per real sample
            noise = rng.uniform(0.90, 1.10, size=len(rows_X[i]))
            # Keep encoded indices intact (first 3 features)
            noised = np.array(rows_X[i]) * noise
            noised[:3] = rows_X[i][:3]
            aug_X.append(noised.tolist())
            aug_y.append(rows_y[i] * rng.uniform(0.92, 1.08))
    rows_X.extend(aug_X)
    rows_y.extend(aug_y)

    return np.array(rows_X, dtype=np.float32), np.array(rows_y, dtype=np.float32)


def _yield_features(cid, rid, season, cp, soil, weather,
                    crop_le, region_le, season_le, irrigation=0.5):
    """Build feature vector for yield prediction."""
    def safe(d, k, default=0.0):
        try:
            return float(d.get(k, default))
        except (ValueError, TypeError):
            return default

    return [
        crop_le.transform([cid])[0],
        region_le.transform([rid])[0],
        season_le.transform([season.lower() if season else "kharif"])[0],
        safe(cp, "base_yield_kg_per_acre"),
        safe(cp, "water_requirement_mm"),
        safe(cp, "temp_min_c"),
        safe(cp, "temp_max_c"),
        safe(cp, "npk_n_kg_per_acre"),
        safe(cp, "npk_p_kg_per_acre"),
        safe(cp, "npk_k_kg_per_acre"),
        safe(soil, "ph", 7.0),
        safe(soil, "n_kg_per_acre", 40),
        safe(soil, "p_kg_per_acre", 20),
        safe(soil, "k_kg_per_acre", 20),
        safe(soil, "organic_carbon_pct", 0.5),
        safe(weather, "rainfall_mm", 800),
        safe(weather, "avg_temp_c", 28),
        safe(weather, "min_temp_c", 20),
        safe(weather, "max_temp_c", 35),
        irrigation,
    ]

YIELD_FEATURE_NAMES = [
    "crop_enc", "region_enc", "season_enc",
    "base_yield", "water_req", "temp_min", "temp_max",
    "npk_n", "npk_p", "npk_k",
    "soil_ph", "soil_n", "soil_p", "soil_k", "soil_oc",
    "rainfall", "avg_temp", "min_temp", "max_temp",
    "irrigation",
]


def train_yield_model() -> dict[str, Any]:
    """Train RandomForest yield prediction model."""
    X, y = _build_yield_dataset()
    X_train, X_test, y_train, y_test = train_test_split(
        X, y, test_size=0.2, random_state=42,
    )

    model = RandomForestRegressor(
        n_estimators=200,
        max_depth=12,
        min_samples_split=5,
        min_samples_leaf=3,
        random_state=42,
        n_jobs=-1,
    )
    model.fit(X_train, y_train)

    y_pred = model.predict(X_test)
    metrics = {
        "mae": round(float(mean_absolute_error(y_test, y_pred)), 2),
        "rmse": round(float(np.sqrt(mean_squared_error(y_test, y_pred))), 2),
        "r2": round(float(r2_score(y_test, y_pred)), 4),
        "train_samples": len(X_train),
        "test_samples": len(X_test),
    }

    # Feature importances
    importances = dict(zip(YIELD_FEATURE_NAMES,
                           [round(float(x), 4) for x in model.feature_importances_]))

    # Save
    joblib.dump(model, MODEL_DIR / "yield_model.joblib")

    # Save encoders
    all_crops = sorted({r["crop_id"] for r in _load_csv("crop_parameters.csv")})
    all_regions = sorted({r["region_id"] for r in _load_csv("soil.csv")})
    all_seasons = ["kharif", "rabi", "annual"]
    crop_le, region_le, season_le = _fit_label_encoders(all_crops, all_regions, all_seasons)
    joblib.dump({"crop": crop_le, "region": region_le, "season": season_le},
                MODEL_DIR / "label_encoders.joblib")

    return {"model": "yield_prediction", "algorithm": "RandomForestRegressor",
            "metrics": metrics, "feature_importances": importances}


# ===================================================================
# 2. PRICE FORECASTING MODEL
# ===================================================================

def _build_price_dataset() -> tuple[np.ndarray, np.ndarray, LabelEncoder, LabelEncoder]:
    """
    Build time-series features for price prediction:
    lag_1, lag_2, lag_3, rolling_mean_3, rolling_std_3, month, year,
    crop_encoded, region_encoded
    """
    rows = _load_csv("mandi_prices.csv")

    all_crops = sorted({r["crop_id"] for r in rows})
    all_regions = sorted({r["region_id"] for r in rows})
    crop_le = LabelEncoder().fit(all_crops)
    region_le = LabelEncoder().fit(all_regions)

    # Group by (region, crop), sort by date
    groups: dict[tuple[str, str], list[dict]] = {}
    for r in rows:
        key = (r["region_id"], r["crop_id"])
        groups.setdefault(key, []).append(r)

    X_all, y_all = [], []
    for (rid, cid), series in groups.items():
        series.sort(key=lambda x: x["date"])
        prices = [float(s["price_inr_per_kg"]) for s in series]
        dates = [s["date"] for s in series]

        for i in range(3, len(prices)):
            try:
                month = int(dates[i].split("-")[1])
                year = int(dates[i].split("-")[0])
            except (ValueError, IndexError):
                continue

            lag1 = prices[i - 1]
            lag2 = prices[i - 2]
            lag3 = prices[i - 3]
            roll_mean = np.mean(prices[max(0, i - 3):i])
            roll_std = np.std(prices[max(0, i - 3):i]) if i >= 3 else 0.0
            price_range = max(prices) - min(prices)

            features = [
                crop_le.transform([cid])[0],
                region_le.transform([rid])[0],
                month,
                year - 2024,  # normalize year
                lag1, lag2, lag3,
                roll_mean,
                roll_std,
                price_range,
            ]
            X_all.append(features)
            y_all.append(prices[i])

    return (np.array(X_all, dtype=np.float32),
            np.array(y_all, dtype=np.float32),
            crop_le, region_le)

PRICE_FEATURE_NAMES = [
    "crop_enc", "region_enc", "month", "year_offset",
    "lag_1", "lag_2", "lag_3",
    "rolling_mean_3", "rolling_std_3", "price_range",
]


def train_price_model() -> dict[str, Any]:
    """Train GradientBoosting price forecasting model."""
    X, y, crop_le, region_le = _build_price_dataset()
    X_train, X_test, y_train, y_test = train_test_split(
        X, y, test_size=0.2, random_state=42,
    )

    model = GradientBoostingRegressor(
        n_estimators=300,
        max_depth=6,
        learning_rate=0.05,
        min_samples_split=5,
        subsample=0.8,
        random_state=42,
    )
    model.fit(X_train, y_train)

    y_pred = model.predict(X_test)
    metrics = {
        "mae": round(float(mean_absolute_error(y_test, y_pred)), 2),
        "rmse": round(float(np.sqrt(mean_squared_error(y_test, y_pred))), 2),
        "r2": round(float(r2_score(y_test, y_pred)), 4),
        "train_samples": len(X_train),
        "test_samples": len(X_test),
    }

    importances = dict(zip(PRICE_FEATURE_NAMES,
                           [round(float(x), 4) for x in model.feature_importances_]))

    joblib.dump(model, MODEL_DIR / "price_model.joblib")
    joblib.dump({"crop": crop_le, "region": region_le},
                MODEL_DIR / "price_encoders.joblib")

    return {"model": "price_forecasting", "algorithm": "GradientBoostingRegressor",
            "metrics": metrics, "feature_importances": importances}


# ===================================================================
# 3. CROP RECOMMENDATION MODEL
# ===================================================================

def _build_recommendation_dataset() -> tuple[np.ndarray, np.ndarray]:
    """
    Build crop recommendation training data:
    For each (region, season), simulate all crops and label the best one
    by estimated profit. Augment with varied budgets and irrigation levels.
    """
    crop_params_list = _load_csv("crop_parameters.csv")
    crop_params = {r["crop_id"]: r for r in crop_params_list}
    soil_data = {r["region_id"]: r for r in _load_csv("soil.csv")}
    weather_rows = _load_csv("weather.csv")
    weather_data = {}
    for r in weather_rows:
        weather_data[(r["region_id"], r["season"].lower())] = r
    mandi_rows = _load_csv("mandi_prices.csv")

    # Latest mandi price per (region, crop)
    mandi_latest: dict[tuple[str, str], float] = {}
    for r in sorted(mandi_rows, key=lambda x: x["date"]):
        mandi_latest[(r["region_id"], r["crop_id"])] = float(r["price_inr_per_kg"])

    all_crops = sorted(crop_params.keys())
    all_regions = sorted(soil_data.keys())
    all_seasons = ["kharif", "rabi"]

    crop_le = LabelEncoder().fit(all_crops)
    region_le = LabelEncoder().fit(all_regions)
    season_le = LabelEncoder().fit(all_seasons + ["annual"])

    rng = np.random.RandomState(42)
    X_all, y_all = [], []

    def sf(d, k, default=0.0):
        try:
            return float(d.get(k, default))
        except (ValueError, TypeError):
            return default

    # Wider parameter sweeps + synthetic soil/weather combos for diversity
    ph_variants = [5.5, 6.0, 6.5, 7.0, 7.5, 8.0]
    rain_variants = [400, 600, 800, 1000, 1200]
    temp_variants = [22, 25, 28, 31, 35]

    for rid in all_regions:
        base_soil = soil_data[rid]
        for season in all_seasons:
            wkey = (rid, season)
            base_weather = weather_data.get(wkey, {})

            for budget in [8000, 12000, 18000, 25000, 35000]:
                for irr in [0.1, 0.3, 0.5, 0.7, 0.9]:
                    for ph in ph_variants:
                        for rain in rain_variants:
                            for temp in temp_variants:
                                # Score each crop with realistic factors
                                best_crop = None
                                best_score = -1e9
                                for cid, cp in crop_params.items():
                                    crop_season = cp["season"].lower()
                                    if season not in crop_season and "annual" not in crop_season:
                                        continue

                                    base_yield = float(cp["base_yield_kg_per_acre"])
                                    cost = float(cp["avg_input_cost_inr_per_acre"])
                                    price = mandi_latest.get(
                                        (rid, cid),
                                        (float(cp["mandi_price_min_inr_per_kg"]) +
                                         float(cp["mandi_price_max_inr_per_kg"])) / 2)
                                    water_req = float(cp["water_requirement_mm"])
                                    temp_min = float(cp["temp_min_c"])
                                    temp_max = float(cp["temp_max_c"])
                                    n_req = float(cp["npk_n_kg_per_acre"])

                                    # Budget penalty: if cost > budget, heavy penalty
                                    budget_fit = 1.0 if budget >= cost else budget / cost * 0.5

                                    # Water fit: compare rainfall+irrigation vs crop need
                                    water_supply = rain + irr * water_req
                                    water_fit = min(water_supply / max(water_req, 1), 1.3)
                                    water_fit = max(water_fit, 0.3)

                                    # Temperature fitness
                                    if temp_min <= temp <= temp_max:
                                        temp_fit = 1.0
                                    elif temp < temp_min:
                                        temp_fit = max(0.3, 1.0 - (temp_min - temp) / 10)
                                    else:
                                        temp_fit = max(0.3, 1.0 - (temp - temp_max) / 10)

                                    # pH suitability (most crops prefer 6-7.5)
                                    ph_fit = max(0.4, 1.0 - abs(ph - 6.8) / 3)
                                    if cid in ("rice",) and ph < 6.5:
                                        ph_fit *= 0.7
                                    if cid in ("pulses", "groundnut") and ph > 7.5:
                                        ph_fit *= 0.8

                                    # Soil N bonus for heavy feeders
                                    soil_n = sf(base_soil, "n_kg_per_acre", 40) * (ph / 7.0)
                                    n_fit = min(soil_n / max(n_req, 1), 1.2)

                                    yield_est = base_yield * water_fit * temp_fit * ph_fit * n_fit * (0.6 + 0.5 * irr)
                                    revenue = yield_est * price
                                    profit = (revenue - cost) * budget_fit
                                    score = profit

                                    if score > best_score:
                                        best_score = score
                                        best_crop = cid

                                if best_crop is None:
                                    continue

                                features = [
                                    region_le.transform([rid])[0],
                                    season_le.transform([season])[0],
                                    ph,
                                    sf(base_soil, "n_kg_per_acre", 40),
                                    sf(base_soil, "p_kg_per_acre", 20),
                                    sf(base_soil, "k_kg_per_acre", 20),
                                    sf(base_soil, "organic_carbon_pct", 0.5),
                                    rain,
                                    temp,
                                    temp - 8,  # approx min_temp
                                    temp + 7,  # approx max_temp
                                    budget,
                                    irr,
                                ]
                                X_all.append(features)
                                y_all.append(crop_le.transform([best_crop])[0])

    # Light augmentation
    base_len = len(X_all)
    for i in range(base_len):
        noised = np.array(X_all[i])
        noised[2:11] *= rng.uniform(0.92, 1.08, size=9)
        noised[11] *= rng.uniform(0.9, 1.1)
        noised[12] = np.clip(noised[12] + rng.uniform(-0.1, 0.1), 0.05, 1.0)
        X_all.append(noised.tolist())
        y_all.append(y_all[i])

    return np.array(X_all, dtype=np.float32), np.array(y_all, dtype=np.int32)

RECOMMEND_FEATURE_NAMES = [
    "region_enc", "season_enc",
    "soil_ph", "soil_n", "soil_p", "soil_k", "soil_oc",
    "rainfall", "avg_temp", "min_temp", "max_temp",
    "budget", "irrigation",
]


def train_recommendation_model() -> dict[str, Any]:
    """Train RandomForest crop recommendation classifier."""
    X, y = _build_recommendation_dataset()
    X_train, X_test, y_train, y_test = train_test_split(
        X, y, test_size=0.2, random_state=42, stratify=y,
    )

    model = RandomForestClassifier(
        n_estimators=200,
        max_depth=10,
        min_samples_split=4,
        random_state=42,
        n_jobs=-1,
    )
    model.fit(X_train, y_train)

    y_pred = model.predict(X_test)
    accuracy = round(float(accuracy_score(y_test, y_pred)), 4)

    # Per-class probabilities give us ranked recommendations
    metrics = {
        "accuracy": accuracy,
        "train_samples": len(X_train),
        "test_samples": len(X_test),
        "num_classes": len(set(y)),
    }

    importances = dict(zip(RECOMMEND_FEATURE_NAMES,
                           [round(float(x), 4) for x in model.feature_importances_]))

    joblib.dump(model, MODEL_DIR / "recommend_model.joblib")

    # Save encoders for recommendation
    all_crops = sorted({r["crop_id"] for r in _load_csv("crop_parameters.csv")})
    all_regions = sorted({r["region_id"] for r in _load_csv("soil.csv")})
    all_seasons = ["kharif", "rabi", "annual"]
    crop_le = LabelEncoder().fit(all_crops)
    region_le = LabelEncoder().fit(all_regions)
    season_le = LabelEncoder().fit(all_seasons)
    joblib.dump({"crop": crop_le, "region": region_le, "season": season_le},
                MODEL_DIR / "recommend_encoders.joblib")

    return {"model": "crop_recommendation", "algorithm": "RandomForestClassifier",
            "metrics": metrics, "feature_importances": importances}


# ===================================================================
# Master training function
# ===================================================================

def train_all() -> dict[str, Any]:
    """Train all 3 models and return combined report."""
    print("=" * 60)
    print("Training Yield Prediction Model...")
    yield_report = train_yield_model()
    print(f"  R² = {yield_report['metrics']['r2']}  MAE = {yield_report['metrics']['mae']}")

    print("Training Price Forecasting Model...")
    price_report = train_price_model()
    print(f"  R² = {price_report['metrics']['r2']}  MAE = {price_report['metrics']['mae']}")

    print("Training Crop Recommendation Model...")
    rec_report = train_recommendation_model()
    print(f"  Accuracy = {rec_report['metrics']['accuracy']}")

    print("=" * 60)
    print("All models saved to:", MODEL_DIR)

    # Save a manifest
    manifest = {
        "models": [yield_report, price_report, rec_report],
        "model_dir": str(MODEL_DIR),
    }
    with open(MODEL_DIR / "manifest.json", "w") as f:
        json.dump(manifest, f, indent=2)

    return manifest


if __name__ == "__main__":
    report = train_all()
    print(json.dumps(report, indent=2))
