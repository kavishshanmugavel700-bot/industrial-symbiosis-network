"""
generate_synthetic_data.py
--------------------------
Generates a synthetic dataset of 20 realistic Taiwanese industrial factories
for the Industrial Symbiosis Intelligence Network.

Output: ai-service/data/synthetic_taiwan_factories.csv

Run directly:
    python generate_synthetic_data.py
"""

import os
import numpy as np
import pandas as pd

# ---------------------------------------------------------------------------
# Configuration constants
# ---------------------------------------------------------------------------

# Real city coordinates: (latitude, longitude)
CITY_COORDINATES: dict[str, tuple[float, float]] = {
    "Taipei":    (25.0330, 121.5654),
    "Taoyuan":   (24.9936, 121.3010),
    "Hsinchu":   (24.8138, 120.9675),
    "Taichung":  (24.1477, 120.6736),
    "Tainan":    (22.9999, 120.2269),
    "Kaohsiung": (22.6273, 120.3014),
}

# Industry profiles: industry_type -> (material_type, needs_material_type, name_prefix)
INDUSTRY_PROFILES: list[dict] = [
    {
        "industry_type":   "plastics_manufacturer",
        "material_type":   "chemical_solvent",
        "needs_material":  "heat_energy",
        "name_prefix":     "Taiwan Plastics",
    },
    {
        "industry_type":   "textile_dyeing_factory",
        "material_type":   "chemical_solvent",
        "needs_material":  "water",
        "name_prefix":     "Formosa Textile",
    },
    {
        "industry_type":   "food_processing_plant",
        "material_type":   "organic_sludge",
        "needs_material":  "heat_energy",
        "name_prefix":     "Pacific Food",
    },
    {
        "industry_type":   "metal_fabrication_shop",
        "material_type":   "metal_offcut",
        "needs_material":  "plastic_offcut",
        "name_prefix":     "SteelTech",
    },
    {
        "industry_type":   "electronics_manufacturer",
        "material_type":   "chemical_solvent",
        "needs_material":  "metal_offcut",
        "name_prefix":     "TaiwanSemi",
    },
    {
        "industry_type":   "paper_mill",
        "material_type":   "organic_sludge",
        "needs_material":  "chemical_solvent",
        "name_prefix":     "Yuen Foong",
    },
]

OUTPUT_DIR  = os.path.join(os.path.dirname(__file__), "data")
OUTPUT_FILE = os.path.join(OUTPUT_DIR, "synthetic_taiwan_factories.csv")

NUM_FACTORIES = 20
RANDOM_SEED   = 42


def _jitter_coordinates(lat: float, lon: float, rng: np.random.Generator) -> tuple[float, float]:
    """
    Add a small random offset (±0.05 deg, ≈5 km) to a city's centre coordinates
    so that factories within the same city don't share identical lat/lon values.

    Args:
        lat: Base latitude in decimal degrees.
        lon: Base longitude in decimal degrees.
        rng: A seeded NumPy random generator for reproducibility.

    Returns:
        Tuple of (jittered_latitude, jittered_longitude) rounded to 4 d.p.
    """
    lat_jitter = rng.uniform(-0.05, 0.05)
    lon_jitter = rng.uniform(-0.05, 0.05)
    return round(lat + lat_jitter, 4), round(lon + lon_jitter, 4)


def generate_factory_records(num_factories: int, seed: int) -> pd.DataFrame:
    """
    Generate a DataFrame containing *num_factories* synthetic Taiwanese
    industrial factory records with realistic operational parameters.

    Each factory is randomly assigned to one city and one industry profile.
    Numeric fields (weekly_production_kg, surplus_frequency_days,
    average_surplus_kg) are drawn from realistic distributions using NumPy.

    Args:
        num_factories: Total number of factory rows to generate.
        seed:          Random seed for reproducibility.

    Returns:
        pandas DataFrame with columns:
            factory_id, name, industry_type, city, latitude, longitude,
            material_type, weekly_production_kg, surplus_frequency_days,
            average_surplus_kg, needs_material_type
    """
    rng = np.random.default_rng(seed)

    cities   = list(CITY_COORDINATES.keys())
    records  = []

    # Counters to build unique factory names within each profile
    profile_counters: dict[str, int] = {p["name_prefix"]: 1 for p in INDUSTRY_PROFILES}

    for i in range(num_factories):
        # Pick a random industry profile and city
        profile = INDUSTRY_PROFILES[i % len(INDUSTRY_PROFILES)]
        city    = rng.choice(cities)
        base_lat, base_lon = CITY_COORDINATES[city]
        lat, lon = _jitter_coordinates(base_lat, base_lon, rng)

        # Build a unique factory name
        name_prefix  = profile["name_prefix"]
        name_counter = profile_counters[name_prefix]
        profile_counters[name_prefix] += 1
        factory_name = f"{name_prefix} {city} {name_counter:02d}"

        # Weekly production: log-normal distribution centred around 5,000 kg
        weekly_production_kg = int(rng.lognormal(mean=8.5, sigma=0.6))
        weekly_production_kg = int(np.clip(weekly_production_kg, 500, 50_000))

        # Surplus frequency: uniform between 3 and 14 days
        surplus_frequency_days = int(rng.integers(3, 15))

        # Average surplus: uniform between 200 and 2,000 kg with small noise
        average_surplus_kg = round(
            float(rng.uniform(200, 2000)) + float(rng.normal(0, 50)), 2
        )
        average_surplus_kg = max(200.0, min(2000.0, average_surplus_kg))

        records.append(
            {
                "factory_id":            i + 1,
                "name":                  factory_name,
                "industry_type":         profile["industry_type"],
                "city":                  city,
                "latitude":              lat,
                "longitude":             lon,
                "material_type":         profile["material_type"],
                "weekly_production_kg":  weekly_production_kg,
                "surplus_frequency_days": surplus_frequency_days,
                "average_surplus_kg":    round(average_surplus_kg, 2),
                "needs_material_type":   profile["needs_material"],
            }
        )

    return pd.DataFrame(records)


def save_to_csv(df: pd.DataFrame, output_path: str) -> None:
    """
    Save a DataFrame to a CSV file, creating any required parent directories.

    Args:
        df:          The DataFrame to persist.
        output_path: Absolute or relative file path for the CSV output.
    """
    os.makedirs(os.path.dirname(output_path), exist_ok=True)
    df.to_csv(output_path, index=False, encoding="utf-8")
    print(f"[OK] CSV saved -> {output_path}")


def print_summary(df: pd.DataFrame) -> None:
    """
    Print a human-readable summary of the generated dataset to stdout.

    Includes: row/column counts, column dtypes, per-city factory counts,
    per-industry-type counts, and descriptive statistics for numeric columns.

    Args:
        df: The generated factory DataFrame.
    """
    print("\n" + "=" * 60)
    print("  SYNTHETIC TAIWAN FACTORY DATASET - SUMMARY")
    print("=" * 60)
    print(f"  Rows      : {len(df)}")
    print(f"  Columns   : {list(df.columns)}")
    print()

    print("-- Factories per city " + "-" * 37)
    print(df["city"].value_counts().to_string())
    print()

    print("-- Factories per industry type " + "-" * 28)
    print(df["industry_type"].value_counts().to_string())
    print()

    print("-- Factories per material type produced " + "-" * 19)
    print(df["material_type"].value_counts().to_string())
    print()

    print("-- Numeric column statistics " + "-" * 30)
    numeric_cols = ["weekly_production_kg", "surplus_frequency_days", "average_surplus_kg"]
    print(df[numeric_cols].describe().round(2).to_string())
    print()

    print("-- First 5 rows " + "-" * 43)
    print(df.head(5).to_string(index=False))
    print("=" * 60 + "\n")


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------

if __name__ == "__main__":
    print("[INFO] Generating synthetic Taiwan factory dataset ...")

    df = generate_factory_records(num_factories=NUM_FACTORIES, seed=RANDOM_SEED)
    save_to_csv(df, OUTPUT_FILE)
    print_summary(df)
