# Data Dictionary

## `soil.csv`

- `region_id`: Region identifier used across datasets.
- `soil_type`: Dominant soil class.
- `ph`: Soil pH (unitless, 0-14).
- `n_kg_per_acre`: Available nitrogen in kg/acre.
- `p_kg_per_acre`: Available phosphorus in kg/acre.
- `k_kg_per_acre`: Available potassium in kg/acre.
- `organic_carbon_percent`: Soil organic carbon percentage.

## `weather.csv`

- `region_id`: Region identifier.
- `season`: Crop season (`kharif`, `rabi`, `annual`).
- `year`: Observation year.
- `rainfall_mm`: Seasonal rainfall in mm.
- `avg_temp_c`: Average temperature in Celsius.
- `min_temp_c`: Minimum observed temperature in Celsius.
- `max_temp_c`: Maximum observed temperature in Celsius.

## `yield_history.csv`

- `region_id`: Region identifier.
- `crop_id`: Crop identifier.
- `year`: Production year.
- `season`: Crop season.
- `yield_kg_per_acre`: Yield in kg/acre.
- `area_acres`: Cultivated area in acres.
- `production_kg`: Total production in kg.

## `mandi_prices.csv`

- `region_id`: Region identifier.
- `crop_id`: Crop identifier.
- `date`: Price observation date (`YYYY-MM-DD`).
- `price_inr_per_kg`: Price in INR per kg.
- `market_name`: Market/APMC name.

## `crop_parameters.csv`

- `crop_id`: Canonical crop key.
- `crop_name`: Display name.
- `season`: Typical crop season.
- `base_yield_kg_per_acre`: Baseline yield for simulation.
- `water_requirement_mm`: Seasonal crop water need in mm.
- `npk_n_kg_per_acre`: Recommended nitrogen application.
- `npk_p_kg_per_acre`: Recommended phosphorus application.
- `npk_k_kg_per_acre`: Recommended potassium application.
- `temp_min_c`: Lower bound of suitable temperature.
- `temp_max_c`: Upper bound of suitable temperature.
- `growing_degree_days`: Approximate growing-degree-day requirement.
- `avg_input_cost_inr_per_acre`: Baseline input cost per acre.
- `mandi_price_min_inr_per_kg`: Conservative mandi price band floor.
- `mandi_price_max_inr_per_kg`: Conservative mandi price band ceiling.
