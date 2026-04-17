# Crop Catalogue (Pilot 8)

Values below are practical baselines for simulation bootstrapping and should be calibrated with district-level datasets in Phase 2.

| Crop | crop_id | Season | Typical yield (kg/acre) | Base cost (INR/acre) | Key risks |
|---|---|---|---:|---:|---|
| Rice (Paddy) | rice | Kharif | 2200-3200 | 22000-32000 | Water stress, blast disease, lodging, price swings |
| Wheat | wheat | Rabi | 1600-2400 | 18000-26000 | Heat stress at grain fill, rust, unseasonal rain |
| Maize | maize | Kharif/Rabi | 1800-3000 | 17000-28000 | Fall armyworm, drought, market volatility |
| Sugarcane | sugarcane | Annual | 28000-40000 | 45000-70000 | Long duration water stress, ratoon decline, delayed payments |
| Cotton | cotton | Kharif | 700-1300 | 24000-42000 | Bollworm/pink bollworm, erratic rainfall, pest sprays cost |
| Pulses (Chickpea/Tur) | pulses | Rabi/Kharif | 500-1100 | 12000-22000 | Moisture stress, pod borer, wilt diseases |
| Groundnut | groundnut | Kharif | 700-1400 | 18000-30000 | Leaf spot/rust, dry spells, harvest rain risk |
| Soybean | soybean | Kharif | 800-1400 | 15000-26000 | Excess rain, pest/disease complex, price fluctuations |

## Notes

- Yield and cost ranges represent broad India-level estimates and not district recommendations.
- Use these only as initial `crop_parameters.csv` defaults until data ingestion and model calibration are complete.
