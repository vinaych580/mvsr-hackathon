from __future__ import annotations

import csv
import os
from pathlib import Path

# Load .env if present (optional dependency)
try:
    from dotenv import load_dotenv
    load_dotenv(Path(__file__).resolve().parents[1] / ".env")
except ImportError:
    pass


DATASET_DIR = Path(__file__).resolve().parents[1] / "dataset"
REQUIRED_FILES = [
    "soil.csv",
    "weather.csv",
    "yield_history.csv",
    "mandi_prices.csv",
    "crop_parameters.csv",
]


def _read_rows(file_path: Path) -> list[dict[str, str]]:
    with file_path.open("r", newline="", encoding="utf-8") as handle:
        return list(csv.DictReader(handle))


def _validate_crop_ids(rows: list[dict[str, str]], file_name: str, valid_crop_ids: set[str]) -> None:
    for idx, row in enumerate(rows, start=2):
        crop_id = row.get("crop_id")
        if crop_id and crop_id not in valid_crop_ids:
            raise ValueError(f"{file_name}:{idx} has unknown crop_id '{crop_id}'")


def validate_dataset() -> None:
    for file_name in REQUIRED_FILES:
        file_path = DATASET_DIR / file_name
        if not file_path.exists():
            raise FileNotFoundError(f"Missing required dataset file: {file_path}")

    crop_rows = _read_rows(DATASET_DIR / "crop_parameters.csv")
    valid_crop_ids = {row["crop_id"] for row in crop_rows}
    if len(valid_crop_ids) < 8:
        raise ValueError("Expected at least 8 pilot crops in crop_parameters.csv")

    for file_name in ["yield_history.csv", "mandi_prices.csv"]:
        rows = _read_rows(DATASET_DIR / file_name)
        _validate_crop_ids(rows, file_name, valid_crop_ids)


def main() -> None:
    validate_dataset()
    print("Dataset validation passed.")


if __name__ == "__main__":
    main()
