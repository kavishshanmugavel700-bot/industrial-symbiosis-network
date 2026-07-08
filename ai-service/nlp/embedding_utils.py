"""
nlp/embedding_utils.py
-----------------------
Provides a material-compatibility lookup table grounded in real industrial
symbiosis research (MAESTRI project) and a lightweight TF-IDF-style keyword
extractor for industrial material text.

Public API
----------
    get_compatibility_score(waste_material, need_material) -> float
    embed_material_text(text) -> list[str]

The compatibility table is loaded from:
    data/maestri_compatibility_table.csv  (single source of truth)
with a hardcoded fallback if the CSV cannot be found.

Run directly for a demo:
    python embedding_utils.py
"""

import csv
import os
import re
from typing import Optional

# ---------------------------------------------------------------------------
# Compatibility lookup table — loaded from CSV at import time
# ---------------------------------------------------------------------------
# Built from MAESTRI project (Managing industrial Symbiosis through Enterprise
# Transformation and Technology Innovation) findings and general industrial
# ecology research, as documented in:
#   data/maestri_compatibility_table.csv
#
# Key format:  (waste_material, need_material)
# Score range: 0-100  (higher = more compatible / higher reuse potential)

# --- Hardcoded fallback (used only if the CSV cannot be found) ---------------
_FALLBACK_COMPATIBILITY_TABLE: dict[tuple[str, str], float] = {
    # -- HIGH compatibility pairs (80-100) ----------------------------------
    ("chemical_solvent",  "chemical_solvent"):  95.0,
    ("metal_offcut",      "metal_offcut"):       90.0,
    ("plastic_offcut",    "plastic_offcut"):     88.0,
    ("organic_sludge",    "heat_energy"):        85.0,
    ("water",             "water"):              85.0,
    ("water",             "cooling_systems"):    85.0,
    ("heat_energy",       "food_drying"):        83.0,
    ("chemical_solvent",  "textile_dyeing"):     82.0,
    ("heat_energy",       "water"):              80.0,
    ("organic_sludge",    "fertilizer"):         78.0,
    ("organic_sludge",    "agriculture"):        78.0,
    ("metal_offcut",      "construction"):       75.0,
    ("metal_offcut",      "hardware"):           75.0,
    ("plastic_offcut",    "construction"):       72.0,
    ("heat_energy",       "heat_energy"):        88.0,
    ("water",             "food_processing"):    80.0,
    # -- MEDIUM compatibility pairs (31-79) ----------------------------------
    ("chemical_solvent",  "plastic_offcut"):     55.0,
    ("organic_sludge",    "water"):              50.0,
    ("metal_offcut",      "heat_energy"):        45.0,
    ("plastic_offcut",    "heat_energy"):        48.0,
    ("water",             "textile_dyeing"):     65.0,
    ("chemical_solvent",  "heat_energy"):         5.0,
    ("organic_sludge",    "organic_sludge"):     60.0,
    # -- INCOMPATIBLE pairs (0-30) --------------------------------------------
    ("chemical_solvent",  "organic_sludge"):     15.0,
    ("metal_offcut",      "water"):              10.0,
    ("heat_energy",       "chemical_solvent"):    5.0,
    ("organic_sludge",    "metal_offcut"):       20.0,
    ("plastic_offcut",    "water"):              25.0,
    ("chemical_solvent",  "food_processing"):     8.0,
}


def _load_compatibility_table() -> dict[tuple[str, str], float]:
    """
    Load the MAESTRI compatibility table from the CSV file.

    Searches for the CSV at:
        <this file's directory>/../data/maestri_compatibility_table.csv
    (works both when run from ai-service/ and from nlp/)

    Returns:
        Dict mapping (waste_material, need_material) -> compatibility_score.
        Falls back to the hardcoded dict if the CSV is not found or is unreadable.
    """
    # Resolve path relative to this source file, so it works from any cwd
    _this_dir = os.path.dirname(os.path.abspath(__file__))
    csv_path = os.path.join(_this_dir, "..", "data", "maestri_compatibility_table.csv")
    csv_path = os.path.normpath(csv_path)

    if not os.path.isfile(csv_path):
        print(f"[WARN] embedding_utils: CSV not found at {csv_path!r} — using hardcoded fallback table.")
        return dict(_FALLBACK_COMPATIBILITY_TABLE)

    table: dict[tuple[str, str], float] = {}
    try:
        with open(csv_path, newline="", encoding="utf-8") as fh:
            reader = csv.DictReader(fh)
            for row in reader:
                waste = row["waste_material"].strip().lower()
                need  = row["need_material"].strip().lower()
                score_str = row["compatibility_score"].strip()
                try:
                    score = float(score_str)
                except ValueError:
                    continue  # skip malformed rows
                # Normalise to underscore form (spaces -> underscores)
                waste = re.sub(r"[\s\-]+", "_", waste)
                need  = re.sub(r"[\s\-]+", "_", need)
                table[(waste, need)] = score
        print(f"[INFO] embedding_utils: loaded {len(table)} compatibility pairs from CSV.")
        return table
    except Exception as exc:
        print(f"[WARN] embedding_utils: failed to load CSV ({exc}) — using hardcoded fallback table.")
        return dict(_FALLBACK_COMPATIBILITY_TABLE)


# Build the table at module import time (single source of truth: the CSV)
MATERIAL_COMPATIBILITY_TABLE: dict[tuple[str, str], float] = _load_compatibility_table()

# ---------------------------------------------------------------------------
# Industrial keyword vocabulary for TF-IDF-style extraction
# ---------------------------------------------------------------------------
# Each entry is a keyword (normalised to lowercase with underscores).
# These reflect property terms, material classes, and process names that
# commonly appear in industrial symbiosis and MSDS documentation.

_INDUSTRIAL_KEYWORDS: list[str] = [
    # Material classes
    "chemical_solvent", "organic_sludge", "metal_offcut", "plastic_offcut",
    "heat_energy", "water", "steam", "biogas", "fertilizer", "compost",
    "cooling_water", "process_water", "waste_heat",

    # Chemical properties
    "flash_point", "boiling_point", "ph", "density", "viscosity",
    "solubility", "conductivity", "melting_point", "vapour_pressure",
    "specific_gravity", "auto_ignition",

    # Hazard identifiers
    "flammable", "corrosive", "toxic", "oxidiser", "explosive",
    "carcinogen", "hazmat", "ghs", "un_class", "reactant",

    # Process and industry terms
    "dyeing", "electroplating", "anodising", "machining", "stamping",
    "casting", "moulding", "distillation", "fermentation", "digestion",
    "incineration", "recycling", "recovery", "symbiosis",

    # Sector tags
    "plastics", "textile", "food_processing", "metal_fabrication",
    "electronics", "paper_mill", "semiconductor", "chemical_plant",
    "automotive", "construction",
]

# Pre-compile a single pattern that matches any keyword token
# (with spaces or underscores as separators)
_KEYWORD_PATTERN: re.Pattern = re.compile(
    r"\b(?:" + "|".join(re.escape(kw.replace("_", " ")) for kw in _INDUSTRIAL_KEYWORDS) + r")\b",
    re.IGNORECASE,
)


# ---------------------------------------------------------------------------
# Public functions
# ---------------------------------------------------------------------------

def get_compatibility_score(waste_material: str, need_material: str) -> float:
    """
    Return the compatibility score between a waste material and a needed
    material based on the MAESTRI-informed lookup table.

    The lookup is attempted in three ways (to handle minor naming variations):
    1. Exact key match as given.
    2. Lowercased / underscore-normalised key.
    3. Symmetric reverse lookup (need, waste).

    Args:
        waste_material: The material type being offered as waste/surplus.
        need_material:  The material type needed by a potential buyer.

    Returns:
        Compatibility score in the range [0, 100].
        Returns 40.0 (default) if the pair is not found in the table.
    """
    default_score = 40.0

    def _normalise(s: str) -> str:
        """Lowercase and replace spaces/hyphens with underscores."""
        return re.sub(r"[\s\-]+", "_", s.strip().lower())

    waste_norm = _normalise(waste_material)
    need_norm  = _normalise(need_material)

    # Direct lookup
    score = MATERIAL_COMPATIBILITY_TABLE.get((waste_norm, need_norm))
    if score is not None:
        return score

    # Symmetric lookup (some pairs are commutative)
    score = MATERIAL_COMPATIBILITY_TABLE.get((need_norm, waste_norm))
    if score is not None:
        return score

    # Partial match: check if either key starts with the other
    for (w, n), s in MATERIAL_COMPATIBILITY_TABLE.items():
        if waste_norm.startswith(w) or w.startswith(waste_norm):
            if need_norm.startswith(n) or n.startswith(need_norm):
                return s

    return default_score


def embed_material_text(text: str) -> list[str]:
    """
    Perform lightweight TF-IDF-style keyword extraction on industrial text.

    Scans the input text for industrial vocabulary terms (material classes,
    chemical property names, hazard identifiers, process names, sector tags)
    and returns a deduplicated, sorted list of matched keywords.

    This intentionally avoids sentence-transformers or any neural model to
    stay within the project's dependency constraints.

    Args:
        text: Free-form text, e.g. from an MSDS document, factory description,
              or material listing.

    Returns:
        Sorted list of normalised industrial keyword strings found in the text.
        Returns an empty list if no keywords match or the input is empty.
    """
    if not text or not text.strip():
        return []

    matches = _KEYWORD_PATTERN.findall(text)
    # Normalise to underscore form and deduplicate
    normalised: set[str] = set()
    for m in matches:
        normalised.add(re.sub(r"\s+", "_", m.strip().lower()))

    return sorted(normalised)


def describe_compatibility(waste_material: str, need_material: str) -> str:
    """
    Return a human-readable description of the compatibility between two
    material types based on the scored lookup.

    Args:
        waste_material: The surplus / waste material type.
        need_material:  The needed material type.

    Returns:
        A short descriptive string (e.g. "HIGH (95.0) - Direct reuse ...").
    """
    score = get_compatibility_score(waste_material, need_material)
    if score >= 80:
        tier = "HIGH"
    elif score >= 50:
        tier = "MEDIUM"
    elif score >= 30:
        tier = "LOW"
    else:
        tier = "INCOMPATIBLE"
    return f"{tier} ({score}) for {waste_material!r} -> {need_material!r}"


# ---------------------------------------------------------------------------
# Demo / entry point
# ---------------------------------------------------------------------------

if __name__ == "__main__":
    print("=" * 60)
    print("  EMBEDDING UTILS - DEMO")
    print("=" * 60)

    # -- get_compatibility_score demo
    test_pairs = [
        ("chemical_solvent",  "chemical_solvent"),
        ("organic_sludge",    "heat_energy"),
        ("metal_offcut",      "metal_offcut"),
        ("heat_energy",       "chemical_solvent"),
        ("chemical_solvent",  "organic_sludge"),
        ("metal_offcut",      "water"),
        ("plastic_offcut",    "plastic_offcut"),
        ("unknown_material",  "another_unknown"),
    ]

    print("\n-- Compatibility Scores " + "-" * 35)
    for waste, need in test_pairs:
        score = get_compatibility_score(waste, need)
        label = "HIGH" if score >= 80 else ("MEDIUM" if score >= 40 else "LOW / INCOMPAT")
        print(f"  {waste:25s} -> {need:25s} : {score:5.1f}  [{label}]")

    # -- embed_material_text demo
    sample_text = (
        "The factory produces chemical solvent waste with a flash point of 25 deg C. "
        "The sludge has a high pH and could be used in food processing or dyeing. "
        "Metal offcut from stamping operations available. GHS H225 flammable liquid. "
        "UN Class 3 - suitable for recycling or recovery."
    )

    print("\n-- embed_material_text " + "-" * 36)
    print(f"  Input text: {sample_text[:80]}...")
    keywords = embed_material_text(sample_text)
    print(f"  Matched keywords ({len(keywords)}): {keywords}")

    print("\n-- describe_compatibility " + "-" * 33)
    for waste, need in test_pairs[:4]:
        print(f"  {describe_compatibility(waste, need)}")
    print("=" * 60)
