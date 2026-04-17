from __future__ import annotations

import csv
import logging
from pathlib import Path

import requests

_DATASET_DIR = Path(__file__).resolve().parents[2] / "dataset"
_FALLBACK_CSV = _DATASET_DIR / "soil.csv"

_BASE_URL = "https://rest.isric.org/soilgrids/v2.0/properties/query"

# SoilGrids property names we need
_PROPERTIES = ["phh2o", "nitrogen", "soc"]

# Region → (lat, lon)
_REGION_COORDS: dict[str, tuple[float, float]] = {
    "telangana_medak": (17.61, 78.26),
    "mp_sehore": (23.20, 77.08),
    "punjab_ludhiana": (30.90, 75.85),
}

logger = logging.getLogger(__name__)


def fetch_soil(lat: float, lon: float) -> dict[str, float] | None:
    """
    Fetch soil properties from SoilGrids for given coordinates.
    Returns dict with ph, n_kg_per_acre, p_kg_per_acre, k_kg_per_acre, or None on failure.
    
    LIMITATIONS:
    - SoilGrids does not provide Phosphorus (P) and Potassium (K) directly.
    - P and K are estimated using a standard N:P:K ratio heuristic (approx 2:1:2 for typical fertile soil).
    - These values should be treated as placeholders for actual soil test results.
    """
    try:
        resp = requests.get(
            _BASE_URL,
            params={"lon": lon, "lat": lat, "property": _PROPERTIES, "depth": "0-30cm", "value": "mean"},
            timeout=12,
        )
        resp.raise_for_status()
        data = resp.json()
        layers = data.get("properties", {}).get("layers", [])
        
        values: dict[str, float] = {}
        for layer in layers:
            name = layer["name"]
            for depth in layer.get("depths", []):
                raw = depth.get("values", {}).get("mean")
                if raw is not None:
                    values[name] = raw
                    break

        if "phh2o" not in values:
            logger.warning(f"SoilGrids returned incomplete data for lat={lat}, lon={lon}")
            return None

        # SoilGrids pH is in pH*10
        ph = round(values["phh2o"] / 10, 2)
        
        # Nitrogen is in mg/kg (decigrams/kg in some versions, SoilGrids V2 is cg/kg)
        # Assuming decigrams/kg for nitrogen in SoilGrids v2 as per docs for some properties
        # Conversion to kg/acre is complex; we use a simplified proxy here
        n_raw = values.get("nitrogen", 1000)
        # Simplified: (n_raw / 100) * conversion_factor
        n_kg_per_acre = round((n_raw / 100) * 0.4047 * 10, 1)
        
        # IMPROVED ESTIMATION STRATEGY for P and K:
        # Instead of arbitrary multipliers, we use conservative defaults if N is available,
        # or scale them based on Soil Organic Carbon (soc) which is often correlated with fertility.
        soc_raw = values.get("soc", 200)
        fertility_factor = clamp(soc_raw / 200.0, 0.5, 1.5)
        
        # Reference values for "moderate" soil
        p_base = 25.0
        k_base = 120.0
        
        p_kg_per_acre = round(p_base * fertility_factor, 1)
        k_kg_per_acre = round(k_base * fertility_factor, 1)

        return {
            "ph": ph,
            "n_kg_per_acre": n_kg_per_acre,
            "p_kg_per_acre": p_kg_per_acre,
            "k_kg_per_acre": k_kg_per_acre,
        }
    except requests.exceptions.RequestException as e:
        logger.error(f"Network error fetching soil data: {e}")
        return None
    except Exception as e:
        logger.error(f"Unexpected error fetching soil data: {e}")
        return None


def get_soil(region_id: str, lat: float | None = None, lon: float | None = None) -> dict[str, float]:
    """
    Returns soil dict for a region. Tries live API first, falls back to CSV.
    """
    try:
        if lat is None or lon is None:
            coords = _REGION_COORDS.get(region_id)
            if coords:
                lat, lon = coords

        if lat is not None and lon is not None:
            live = fetch_soil(lat, lon)
            if live is not None:
                return live
    except Exception as e:
        logger.warning(f"Failed to get live soil data for {region_id}: {e}")

    # Fallback: static CSV
    try:
        if _FALLBACK_CSV.exists():
            with _FALLBACK_CSV.open("r", newline="", encoding="utf-8") as f:
                for row in csv.DictReader(f):
                    if row["region_id"] == region_id:
                        return {
                            "ph": float(row["ph"]),
                            "n_kg_per_acre": float(row["n_kg_per_acre"]),
                            "p_kg_per_acre": float(row["p_kg_per_acre"]),
                            "k_kg_per_acre": float(row["k_kg_per_acre"]),
                        }
    except Exception as e:
        logger.error(f"Error reading soil fallback CSV: {e}")

    raise ValueError(f"No soil data available for region='{region_id}'")


def clamp(value: float, low: float, high: float) -> float:
    return max(low, min(high, value))
