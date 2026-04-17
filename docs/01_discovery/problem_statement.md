# Problem Statement

Small and medium farmers in India often make sowing and input decisions with fragmented information about soil, weather, input costs, and mandi prices. This leads to avoidable yield loss, unstable profits, and higher financial risk.

This project builds a farm-strategy simulation platform that helps farmers compare crop strategies before committing resources. The system estimates yield, total cost, expected revenue, profit, ROI, and risk for key Indian crops using soil, climate, and market signals.

## Scope (Phase 1 baseline)

- Pilot geographies: 2-3 representative regions across India (initially configurable in data files).
- Pilot crops: rice, wheat, maize, sugarcane, cotton, chickpea/tur pulses, groundnut, soybean.
- Input factors: soil pH, NPK, rainfall, temperature, irrigation level, seed variety, sowing date, cultivated area.
- Outputs: yield estimate, cost breakdown, revenue, profit, ROI, and risk score with sub-components.

## Target User

Primary user is a price-sensitive, risk-aware farmer or farm advisor who needs fast scenario comparison (for example: "cotton vs soybean under lower rainfall") before sowing.

## Initial Product Goal

Provide a deterministic simulation engine first, then improve model quality with ML while keeping explainability and practical recommendations as first-class outcomes.
