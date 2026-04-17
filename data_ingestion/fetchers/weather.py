from __future__ import annotations

import csv
import logging
from datetime import date, timedelta
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

logger = logging.getLogger(__name__)


def fetch_weather(
    lat: float, 
    lon: float, 
    start_date: date | None = None, 
    end_date: date | None = None
) -> dict[str, float] | None:
    """
    Fetch weather data from Open-Meteo. 
    Uses historical archive if end_date is in the past, otherwise uses forecast.
    Defaults to last 90 days if dates are not provided.
    """
    if end_date is None:
        end_date = date.today() - timedelta(days=1)
    if start_date is None:
        start_date = end_date - timedelta(days=89)

    is_historical = end_date < date.today()
    url = _ARCHIVE_URL if is_historical else _FORECAST_URL
    
    params = {
        "latitude": lat,
        "longitude": lon,
        "start_date": start_date.isoformat(),
        "end_date": end_date.isoformat(),
        "daily": "precipitation_sum,temperature_2m_max,temperature_2m_min",
        "timezone": "Asia/Kolkata",
    }
    
    try:
        resp = requests.get(url, params=params, timeout=10)
        resp.raise_for_status()
        daily = resp.json().get("daily", {})
        precip = daily.get("precipitation_sum", [])
        tmax = daily.get("temperature_2m_max", [])
        tmin = daily.get("temperature_2m_min", [])
        
        if not precip or not tmax:
            logger.warning(f"Weather API returned no daily data for lat={lat}, lon={lon}")
            return None
            
        # Filter out None values and calculate averages
        valid_precip = [v for v in precip if v is not None]
        rainfall_mm = round(sum(valid_precip), 1) if valid_precip else 0.0
        
        pairs = [(a, b) for a, b in zip(tmax, tmin) if a is not None and b is not None]
        if not pairs:
            logger.warning(f"Weather API returned no valid temperature pairs for lat={lat}, lon={lon}")
            return None
            
        avg_temp = round(sum((a + b) / 2 for a, b in pairs) / len(pairs), 1)
        
        return {"rainfall_mm": rainfall_mm, "avg_temp_c": avg_temp}
    except requests.exceptions.RequestException as e:
        logger.error(f"Network error fetching weather data: {e}")
        return None
    except Exception as e:
        logger.error(f"Unexpected error fetching weather data: {e}")
        return None


def get_weather(
    region_id: str, 
    season: str, 
    lat: float | None = None, 
    lon: float | None = None,
    start_date: str | None = None,
    end_date: str | None = None
) -> dict[str, float]:
    """
    Returns weather dict for a region. Uses lat/lon if provided, else looks up
    pilot region coords. Falls back to static CSV if API fails.
    """
    try:
        if lat is None or lon is None:
            coords = _REGION_COORDS.get(region_id)
            if coords:
                lat, lon = coords

        if lat is not None and lon is not None:
            # Parse dates if provided
            s_date = date.fromisoformat(start_date) if start_date else None
            e_date = date.fromisoformat(end_date) if end_date else None
            
            live = fetch_weather(lat, lon, start_date=s_date, end_date=e_date)
            if live is not None:
                return live
    except Exception as e:
        logger.warning(f"Failed to get live weather data for {region_id}: {e}")

    # Fallback: static CSV
    try:
        if _FALLBACK_CSV.exists():
            with _FALLBACK_CSV.open("r", newline="", encoding="utf-8") as f:
                for row in csv.DictReader(f):
                    if row["region_id"] == region_id and row["season"].lower() == season.lower():
                        return {
                            "rainfall_mm": float(row["rainfall_mm"]),
                            "avg_temp_c": float(row["avg_temp_c"]),
                        }
    except Exception as e:
        logger.error(f"Error reading weather fallback CSV: {e}")

    raise ValueError(f"No weather data available for region='{region_id}' season='{season}'")
