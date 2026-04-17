"""
One-shot seeder: appends realistic rows to weather.csv, yield_history.csv and
mandi_prices.csv for the newly added regions & crops. Deterministic (seeded).
Run once:   python dataset/_seed_extra.py
Safe to re-run: it skips region/crop combos that already exist in each file.
"""
from __future__ import annotations
import csv, os, random
from pathlib import Path

ROOT = Path(__file__).resolve().parent
random.seed(42)

# ---------- regions (climate profile per region) ----------
# (region_id, kharif_rain, rabi_rain, kharif_temp, rabi_temp)
REGIONS = [
    ("bihar_patna",            1040, 85,  28.1, 17.2),
    ("rajasthan_jaipur",        520, 25,  29.4, 16.8),
    ("haryana_karnal",          640, 60,  28.3, 15.9),
    ("ap_guntur",               820, 180, 29.0, 23.5),
    ("odisha_cuttack",         1380, 110, 28.4, 22.1),
    ("wb_bardhaman",           1420, 95,  28.7, 20.5),
    ("kerala_palakkad",        1720, 280, 27.0, 24.6),
    ("hp_shimla",              1180, 180, 20.5,  9.1),
    ("chhattisgarh_raipur",    1180, 70,  27.9, 19.4),
    ("assam_nagaon",           2150, 95,  27.2, 18.0),
    ("jk_pulwama",              640, 240, 22.5,  5.4),
    ("uk_udhamsinghnagar",     1380, 95,  27.4, 15.5),
    ("jharkhand_ranchi",       1150, 60,  25.8, 17.8),
    ("goa_north",              2640, 35,  27.5, 25.1),
    ("tripura_west",           2140, 75,  27.0, 19.2),
    ("mh_nashik",               720, 45,  26.5, 20.1),
    ("mh_yavatmal",             920, 55,  28.8, 22.6),
    ("kar_belagavi",            880, 110, 26.2, 22.4),
    ("tn_coimbatore",           620, 280, 28.3, 24.1),
    ("up_varanasi",             920, 70,  28.0, 17.5),
    ("mp_indore",               860, 45,  26.9, 18.2),
    ("guj_anand",               820, 18,  28.9, 20.7),
]

# Crops suited per region (used for yield + mandi seeding)
REGION_CROPS = {
    "bihar_patna":           ["rice", "wheat", "maize", "pulses", "mustard", "potato"],
    "rajasthan_jaipur":      ["bajra", "mustard", "wheat", "moong", "barley", "sunflower"],
    "haryana_karnal":        ["wheat", "rice", "mustard", "sugarcane", "barley", "paddy_basmati"],
    "ap_guntur":             ["rice", "cotton", "chilli", "tobacco", "maize", "turmeric"],
    "odisha_cuttack":        ["rice", "pulses", "groundnut", "sugarcane", "mustard"],
    "wb_bardhaman":          ["rice", "potato", "jute", "mustard", "wheat"],
    "kerala_palakkad":       ["rice", "coconut", "banana", "tea", "coffee", "ginger"],
    "hp_shimla":             ["wheat", "maize", "barley", "potato"],
    "chhattisgarh_raipur":   ["rice", "soybean", "maize", "pulses", "ragi"],
    "assam_nagaon":          ["rice", "tea", "mustard", "potato", "ginger"],
    "jk_pulwama":            ["rice", "wheat", "mustard", "barley"],
    "uk_udhamsinghnagar":    ["rice", "wheat", "sugarcane", "mustard", "potato"],
    "jharkhand_ranchi":      ["rice", "maize", "pulses", "ragi"],
    "goa_north":             ["rice", "coconut", "banana", "cashew"],
    "tripura_west":          ["rice", "jute", "tea", "potato"],
    "mh_nashik":             ["onion", "tomato", "sugarcane", "soybean", "cotton"],
    "mh_yavatmal":           ["cotton", "soybean", "arhar", "jowar"],
    "kar_belagavi":          ["sugarcane", "cotton", "jowar", "maize", "ragi", "turmeric"],
    "tn_coimbatore":         ["cotton", "turmeric", "banana", "sugarcane", "coconut", "tomato"],
    "up_varanasi":           ["rice", "wheat", "sugarcane", "mustard", "potato"],
    "mp_indore":             ["soybean", "wheat", "pulses", "cotton", "onion"],
    "guj_anand":             ["cotton", "groundnut", "wheat", "tomato", "banana"],
}

# Base yield & price reference (kg/acre, INR/kg) — realistic ballparks
CROP_BASE = {
    "rice": (2500, 22), "wheat": (1950, 24), "maize": (2300, 19),
    "sugarcane": (34000, 3.5), "cotton": (980, 68), "pulses": (780, 72),
    "groundnut": (1040, 60), "soybean": (1080, 52), "mustard": (890, 64),
    "bajra": (840, 28), "jowar": (890, 33), "potato": (9200, 14),
    "onion": (12000, 18), "tomato": (14500, 16), "chilli": (3200, 98),
    "turmeric": (9400, 92), "ginger": (8600, 74), "banana": (34500, 17),
    "coconut": (10800, 22), "tea": (1400, 190), "coffee": (900, 280),
    "barley": (1600, 22), "sunflower": (920, 58), "ragi": (1420, 38),
    "urad": (620, 92), "moong": (610, 88), "mango": (8400, 54),
    "paddy_basmati": (2200, 45), "arhar": (720, 78),
    "jute": (1800, 48), "tobacco": (1600, 180), "cashew": (450, 950),
}

# ---------- 1. weather.csv ----------
def append_weather():
    path = ROOT / "weather.csv"
    existing = set()
    with open(path, "r", encoding="utf-8") as f:
        r = csv.DictReader(f)
        for row in r:
            existing.add((row["region_id"], row["season"], row["year"]))
    rows = []
    for rid, kr, rr, kt, rt in REGIONS:
        for year in (2022, 2023, 2024):
            for season, rain, t in (("kharif", kr, kt), ("rabi", rr, rt)):
                if (rid, season, str(year)) in existing:
                    continue
                rain_y = max(10, round(rain * random.uniform(0.8, 1.15), 1))
                t_y   = round(t + random.uniform(-1.2, 1.2), 1)
                tmin  = round(t_y - random.uniform(4.0, 7.5), 1)
                tmax  = round(t_y + random.uniform(4.0, 9.0), 1)
                rows.append([rid, season, year, rain_y, t_y, tmin, tmax])
    if rows:
        with open(path, "a", newline="", encoding="utf-8") as f:
            w = csv.writer(f)
            for r_ in rows:
                w.writerow(r_)
    print(f"weather.csv  +{len(rows)} rows")

# ---------- 2. yield_history.csv ----------
def append_yield():
    path = ROOT / "yield_history.csv"
    existing = set()
    with open(path, "r", encoding="utf-8") as f:
        r = csv.DictReader(f)
        for row in r:
            existing.add((row["region_id"], row["crop_id"], row["year"]))
    rows = []
    for rid, crops in REGION_CROPS.items():
        for crop in crops:
            if crop not in CROP_BASE:
                continue
            base_y, _ = CROP_BASE[crop]
            for year in (2022, 2023, 2024):
                if (rid, crop, str(year)) in existing:
                    continue
                season = "rabi" if crop in ("wheat","mustard","potato","onion","barley","pulses") else \
                         "annual" if crop in ("sugarcane",) else \
                         "perennial" if crop in ("coconut","tea","coffee","mango") else "kharif"
                y      = max(100, int(base_y * random.uniform(0.82, 1.12)))
                area   = random.randint(40_000, 240_000)
                prod   = y * area
                rows.append([rid, crop, year, season, y, area, prod])
    if rows:
        with open(path, "a", newline="", encoding="utf-8") as f:
            w = csv.writer(f)
            for r_ in rows:
                w.writerow(r_)
    print(f"yield_history.csv  +{len(rows)} rows")

# ---------- 3. mandi_prices.csv (monthly for 2024) ----------
def append_mandi():
    path = ROOT / "mandi_prices.csv"
    existing = set()
    with open(path, "r", encoding="utf-8") as f:
        r = csv.DictReader(f)
        for row in r:
            existing.add((row["region_id"], row["crop_id"], row["date"]))
    rows = []
    for rid, crops in REGION_CROPS.items():
        market = rid.split("_", 1)[-1].title() + " APMC"
        for crop in crops:
            if crop not in CROP_BASE:
                continue
            _, base_p = CROP_BASE[crop]
            for month in range(1, 13):
                date = f"2024-{month:02d}-01"
                if (rid, crop, date) in existing:
                    continue
                # seasonal wave + noise
                import math
                seasonal = 1 + 0.12 * math.sin((month - 3) / 12 * 2 * math.pi)
                price = round(base_p * seasonal * random.uniform(0.85, 1.18), 2)
                rows.append([rid, crop, date, price, market])
    if rows:
        with open(path, "a", newline="", encoding="utf-8") as f:
            w = csv.writer(f)
            for r_ in rows:
                w.writerow(r_)
    print(f"mandi_prices.csv  +{len(rows)} rows")

if __name__ == "__main__":
    append_weather()
    append_yield()
    append_mandi()
    print("Done.")
