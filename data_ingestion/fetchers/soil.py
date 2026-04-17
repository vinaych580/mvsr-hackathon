from __future__ import annotations

import csv
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


def fetch_soil(lat: float, lon: float) -> dict[str, float] | None:
    """
    Fetch soil properties from SoilGrids for given coordinates.
    Returns dict with ph, n_kg_per_acre, p_kg_per_acre, k_kg_per_acre, or None on failure.
    No API key required.
    SoilGrids does not provide P/K directly; P and K are estimated from N proxy.
    """
    try:
        resp = requests.get(
            _BASE_URL,
            params={"lon": lon, "lat": lat, "property": ["phh2o", "nitrogen", "soc"], "depth": "0-30cm", "value": "mean"},
            timeout=12,
        )
        resp.raise_for_status()
        layers = resp.json().get("properties", {}).get("layers", [])
        values: dict[str, float] = {}
        for layer in layers:
            name = layer["name"]
            for depth in layer.get("depths", []):
                raw = depth.get("values", {}).get("mean")
                if raw is not None:
                    values[name] = raw
                    break

        if "phh2o" not in values:
            return None

        ph = round(values["phh2o"] / 10, 2)
        n_raw = values.get("nitrogen", 1000)
        n_kg_per_acre = round((n_raw / 100) * 0.4047 * 10, 1)
        p_kg_per_acre = round(n_kg_per_acre * 0.45, 1)
        k_kg_per_acre = round(n_kg_per_acre * 4.0, 1)

        return {
            "ph": ph,
            "n_kg_per_acre": n_kg_per_acre,
            "p_kg_per_acre": p_kg_per_acre,
            "k_kg_per_acre": k_kg_per_acre,
        }
    except Exception:
        return None


def get_soil(region_id: str, lat: float | None = None, lon: float | None = None) -> dict[str, float]:
    """
    Returns soil dict for a region. Uses lat/lon if provided, else looks up
    pilot region coords. Falls back to static CSV if API fails.
    """
    if lat is None or lon is None:
        coords = _REGION_COORDS.get(region_id)
        if coords:
            lat, lon = coords

    if lat is not None and lon is not None:
        live = fetch_soil(lat, lon)
        if live is not None:
            return live

    # Fallback: static CSV
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

    raise ValueError(f"No soil data available for region='{region_id}'")
