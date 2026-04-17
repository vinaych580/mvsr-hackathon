# MVSR Hackathon - Farm Strategy Simulator

This repository is being built phase-by-phase from the project breakdown.

## Current Progress

- Phase 1 (Discovery): completed baseline docs in `docs/01_discovery/`.
- Phase 2 (Data): created starter datasets in `dataset/` and validation script in `data_ingestion/prepare_data.py`.
- Phase 3 (Core Engine): created a rule-based simulation engine in `engine/`.
- Phase 4 (ML Layer): added prediction and recommendation utilities in `ml/`:
  - yield prediction (`predict_yield_kg_per_acre`)
  - smart risk + confidence scoring (`smart_risk_score`)
  - scenario-based profit estimator (`profit_estimator`)
  - location-based insights (`location_based_insights`)
  - smart crop recommendations using location, soil, season, and budget (`recommend_crops`)

## Quick Run

```bash
python data_ingestion/prepare_data.py
python -m engine.example_usage
python -m ml.example_usage
```

## Next Build Steps

- Phase 5: add backend API and frontend clay design system.
- Phase 6: complete docs, deployment, and demo assets.
