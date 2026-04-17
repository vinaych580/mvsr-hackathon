from __future__ import annotations

import csv
import os
from pathlib import Path

import requests

_DATASET_DIR = Path(__file__).resolve().parents[2] / "dataset"
_FALLBACK_CSV = _DATASET_DIR / "mandi_prices.csv"

# Crop name mapping for data.gov.in commodity filter
_CROP_COMMODITY: dict[str, str] = {
    "rice": "Rice",
    "wheat": "Wheat",
    "maize": "Maize",
    "sugarcane": "Sugarcane",
    "cotton": "Cotton",
    "pulses": "Tur",
    "groundnut": "Groundnut",
    "soybean": "Soybean",
}

_BASE_URL = "https://api.data.gov.in/resource/9ef84268-d588-465a-a308-a864a43d0070"


def fetch_mandi_price(crop_id: str, state: str | None = None) -> float | None:
    """
    Fetch latest mandi price (INR/kg) for a crop from data.gov.in.
    Returns None if API is unavailable or key is missing; caller should use fallback.
    API key is read from the DATAGOV_API_KEY environment variable.
    """
    api_key = os.getenv("DATAGOV_API_KEY")
    if not api_key:
        return None

    commodity = _CROP_COMMODITY.get(crop_id)
    if not commodity:
        return None

    params: dict[str, str | int] = {
        "api-key": api_key,
        "format": "json",
        "limit": 10,
        "filters[Commodity]": commodity,
    }
    if state:
        params["filters[State]"] = state

    try:
        resp = requests.get(_BASE_URL, params=params, timeout=8)
        resp.raise_for_status()
        records = resp.json().get("records", [])
        if not records:
            return None
        # Modal price is the most representative; convert quintal → kg (÷100)
        prices = [float(r["Modal_Price"]) / 100 for r in records if r.get("Modal_Price")]
        return round(sum(prices) / len(prices), 2) if prices else None
    except Exception:
        return None


def get_mandi_price(crop_id: str, region_id: str, state: str | None = None) -> float:
    """
    Returns mandi price for a crop. Tries live API first, falls back to CSV.
    """
    live = fetch_mandi_price(crop_id, state)
    if live is not None:
        return live

    # Fallback: read from static CSV
    if _FALLBACK_CSV.exists():
        with _FALLBACK_CSV.open("r", newline="", encoding="utf-8") as f:
            for row in csv.DictReader(f):
                if row["crop_id"] == crop_id and row["region_id"] == region_id:
                    return float(row["price_inr_per_kg"])

    raise ValueError(f"No mandi price available for crop='{crop_id}' region='{region_id}'")
