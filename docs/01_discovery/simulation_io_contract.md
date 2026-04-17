# Simulation Input/Output Contract

## Function Signature

`simulate(strategy_dict: dict) -> result_dict: dict`

## Input Schema (`strategy_dict`)

- `crop_id` (str): one of `rice`, `wheat`, `maize`, `sugarcane`, `cotton`, `pulses`, `groundnut`, `soybean`
- `region_id` (str): region or district key
- `area_acres` (float): cultivated area in acres
- `sowing_date` (str): ISO date (`YYYY-MM-DD`)
- `seed_variety` (str): variety identifier or name
- `soil` (dict)
  - `ph` (float)
  - `n_kg_per_acre` (float)
  - `p_kg_per_acre` (float)
  - `k_kg_per_acre` (float)
- `weather` (dict)
  - `rainfall_mm` (float)
  - `avg_temp_c` (float)
- `irrigation_level` (float): normalized 0.0 to 1.0
- `input_plan` (dict)
  - `seed_cost_per_acre` (float)
  - `fertilizer_cost_per_acre` (float)
  - `labour_cost_per_acre` (float)
  - `irrigation_cost_per_acre` (float)
  - `pesticide_cost_per_acre` (float)
  - `machinery_cost_per_acre` (float)
- `mandi_price_per_kg` (float): expected selling price

## Output Schema (`result_dict`)

- `crop_id` (str)
- `area_acres` (float)
- `yield_kg_per_acre` (float)
- `total_yield_kg` (float)
- `cost_breakdown_per_acre` (dict)
- `total_cost` (float)
- `revenue` (float)
- `profit` (float)
- `roi_percent` (float)
- `risk_score` (float): 0-100
- `risk_subscores` (dict)
  - `drought` (float, 0-100)
  - `pest` (float, 0-100)
  - `flood` (float, 0-100)
  - `price_volatility` (float, 0-100)
- `assumptions` (list[str]): key assumptions used in simulation
