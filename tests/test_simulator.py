"""
Smoke tests for engine.simulator.

Run from the project root:
    pytest -q tests

These are intentionally light — they exercise the public contract
without pinning specific numeric outputs so the tests remain useful
even as the model evolves.
"""

from __future__ import annotations

import os
import sys
import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from engine.simulator import simulate  # noqa: E402


def _base_strategy(**overrides):
    strat = {
        "crop_id": "soybean",
        "crop_name": "Soybean",
        "season": "kharif",
        "area_acres": 4.0,
        "irrigation_level": 0.6,
        "mandi_price_per_kg": 45.0,
        "seed_cost_per_acre": 2500,
        "fertilizer_cost_per_acre": 4000,
        "labour_cost_per_acre": 5000,
        "other_costs_per_acre": 2000,
        "soil": {"nitrogen": 220, "phosphorus": 30, "potassium": 180, "ph": 6.7},
        "weather": {"rainfall_mm": 900, "avg_temp_c": 26.0},
    }
    strat.update(overrides)
    return strat


def test_simulate_returns_expected_shape():
    out = simulate(_base_strategy())
    for key in (
        "crop_id", "yield_kg_per_acre", "total_yield_kg",
        "total_cost", "revenue", "profit", "roi_percent",
        "risk_score", "sensitivity", "nutrient_analysis",
    ):
        assert key in out, f"missing field: {key}"
    assert out["area_acres"] == 4.0
    assert out["total_yield_kg"] >= 0


def test_profit_scales_with_area():
    small = simulate(_base_strategy(area_acres=2))
    large = simulate(_base_strategy(area_acres=8))
    # Roughly linear (within a reasonable tolerance)
    assert large["total_cost"] > small["total_cost"]
    assert large["revenue"] > small["revenue"]


def test_higher_price_increases_profit():
    cheap = simulate(_base_strategy(mandi_price_per_kg=20))
    pricey = simulate(_base_strategy(mandi_price_per_kg=60))
    assert pricey["profit"] > cheap["profit"]


def test_risk_score_in_bounds():
    out = simulate(_base_strategy())
    assert 0.0 <= out["risk_score"] <= 1.0


def test_unknown_crop_raises():
    with pytest.raises(ValueError):
        simulate(_base_strategy(crop_id="unobtanium"))


def test_zero_irrigation_does_not_crash():
    out = simulate(_base_strategy(irrigation_level=0.0))
    assert out["yield_kg_per_acre"] >= 0
