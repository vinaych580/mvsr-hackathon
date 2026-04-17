import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from engine import simulate


if __name__ == "__main__":
    sample_strategy = {
        "crop_id": "soybean",
        "region_id": "mp_sehore",
        "area_acres": 2.5,
        "sowing_date": "2026-06-20",
        "seed_variety": "JS-95-60",
        "soil": {"ph": 7.1, "n_kg_per_acre": 46, "p_kg_per_acre": 22, "k_kg_per_acre": 190},
        "weather": {"rainfall_mm": 780, "avg_temp_c": 27.2},
        "irrigation_level": 0.45,
        "input_plan": {
            "seed_cost_per_acre": 3200,
            "fertilizer_cost_per_acre": 4200,
            "labour_cost_per_acre": 3600,
            "irrigation_cost_per_acre": 1900,
            "pesticide_cost_per_acre": 1700,
            "machinery_cost_per_acre": 2100,
        },
        "mandi_price_per_kg": 51.0,
    }
    print(simulate(sample_strategy))
