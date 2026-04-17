from __future__ import annotations

import csv
from pathlib import Path

import requests

_DATASET_DIR = Path(__file__).resolve().parents[2] / "dataset"
_FALLBACK_CSV = _DATASET_DIR / "weather.csv"

_FORECAST_URL = "https://api.open-meteo.com/v1/forecast"
_ARCHIVE_URL = "https://archive-api.open-meteo.com/v1/archive"

# Region → (lat, lon) for the 3 pilot regions
_REGION_COORDS: dict[str, tuple[float, float]] = {
    "telangana_medak": (17.61, 78.26),
    "mp_sehore": (23.20, 77.08),
    "punjab_ludhiana": (30.90, 75.85),
}


def fetch_weather(lat: float, lon: float) -> dict[str, float] | None:
    """
    Fetch last 90-day weather from Open-Meteo historical archive for given coordinates.
    Returns dict with rainfall_mm and avg_temp_c, or None on failure.
    No API key required.
    """
    from datetime import date, timedelta
    end = date.today() - timedelta(days=1)
    start = end - timedelta(days=89)
    params = {
        "latitude": lat,
        "longitude": lon,
        "start_date": start.isoformat(),
        "end_date": end.isoformat(),
        "daily": "precipitation_sum,temperature_2m_max,temperature_2m_min",
        "timezone": "Asia/Kolkata",
    }
    try:
        resp = requests.get(_ARCHIVE_URL, params=params, timeout=10)
        resp.raise_for_status()
        daily = resp.json().get("daily", {})
        precip = daily.get("precipitation_sum", [])
        tmax = daily.get("temperature_2m_max", [])
        tmin = daily.get("temperature_2m_min", [])
        if not precip or not tmax:
            return None
        rainfall_mm = round(sum(v for v in precip if v is not None), 1)
        pairs = [(a, b) for a, b in zip(tmax, tmin) if a is not None and b is not None]
        avg_temp = round(sum((a + b) / 2 for a, b in pairs) / len(pairs), 1)
        return {"rainfall_mm": rainfall_mm, "avg_temp_c": avg_temp}
    except Exception:
        return None


def get_weather(region_id: str, season: str, lat: float | None = None, lon: float | None = None) -> dict[str, float]:
    """
    Returns weather dict for a region. Uses lat/lon if provided, else looks up
    pilot region coords. Falls back to static CSV if API fails.
    """
    if lat is None or lon is None:
        coords = _REGION_COORDS.get(region_id)
        if coords:
            lat, lon = coords

    if lat is not None and lon is not None:
        live = fetch_weather(lat, lon)
        if live is not None:
            return live

    # Fallback: static CSV
    if _FALLBACK_CSV.exists():
        with _FALLBACK_CSV.open("r", newline="", encoding="utf-8") as f:
            for row in csv.DictReader(f):
                if row["region_id"] == region_id and row["season"] == season:
                    return {
                        "rainfall_mm": float(row["rainfall_mm"]),
                        "avg_temp_c": float(row["avg_temp_c"]),
                    }

    raise ValueError(f"No weather data available for region='{region_id}' season='{season}'")
