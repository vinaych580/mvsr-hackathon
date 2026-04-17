import sys
from pathlib import Path
from pprint import pprint

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from ml import (
    location_based_insights,
    predict_yield_kg_per_acre,
    profit_estimator,
    recommend_crops,
    smart_risk_score,
)


if __name__ == "__main__":
    region_id = "mp_sehore"
    season = "kharif"
    budget_per_acre = 21000.0
    area_acres = 3.0
    crop_id = "soybean"

    weather = {"rainfall_mm": 840.0, "avg_temp_c": 27.0}
    soil = {"ph": 7.3, "n_kg_per_acre": 48.0, "p_kg_per_acre": 22.0, "k_kg_per_acre": 210.0}

    predicted_yield = predict_yield_kg_per_acre(crop_id, region_id, season, weather, soil)
    risk = smart_risk_score(crop_id, weather, soil, budget_per_acre)
    profit = profit_estimator(crop_id, predicted_yield, area_acres, budget_per_acre, mandi_price_per_kg=49.0)
    insights = location_based_insights(region_id)
    top_recommendations = recommend_crops(region_id, season, budget_per_acre, area_acres, top_k=3)

    print("Predicted yield per acre:")
    pprint(predicted_yield)
    print("\nSmart risk score:")
    pprint(risk)
    print("\nProfit estimator:")
    pprint(profit)
    print("\nLocation-based insights:")
    pprint(insights)
    print("\nTop crop recommendations:")
    pprint(top_recommendations)
