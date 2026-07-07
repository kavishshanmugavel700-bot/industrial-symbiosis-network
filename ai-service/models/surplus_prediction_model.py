"""
models/surplus_prediction_model.py
------------------------------------
Surplus prediction model for the Industrial Symbiosis Intelligence Network.

Trains a RandomForestRegressor on *synthetically generated* historical surplus
event data derived from ai-service/data/synthetic_taiwan_factories.csv.

Because the CSV is a single snapshot (not a time-series), this module first
generates realistic historical surplus event rows per factory using
``surplus_frequency_days`` as the base cycle, then adds Gaussian noise to
simulate real production variance.  The generator is fully self-contained in
``_generate_historical_data()``.

Public API
----------
    predict_surplus(factory_id, production_schedule: dict) -> dict

Model persistence
-----------------
    MODEL_PATH env var (default: ./models/surplus_model.pkl)
    The model is trained once and pickled.  On subsequent process starts the
    pickle is loaded directly, so the Flask app never re-trains.

Run directly for a quick smoke-test:
    python surplus_prediction_model.py
"""

import os
import math
import pickle
import logging
from datetime import datetime, timedelta, timezone
from typing import Any

import numpy as np
import pandas as pd
from sklearn.ensemble import RandomForestRegressor
from sklearn.preprocessing import LabelEncoder

# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------

# Model persistence path (overridable via env var)
_DEFAULT_MODEL_PATH: str = "./models/surplus_model.pkl"
MODEL_PATH: str = os.getenv("MODEL_PATH", _DEFAULT_MODEL_PATH)

# Path to the factory snapshot CSV (relative to ai-service/)
_CSV_PATH: str = os.path.join(os.path.dirname(__file__), "..", "data", "synthetic_taiwan_factories.csv")

# Synthetic history parameters
_HISTORY_EVENTS_PER_FACTORY: int = 50   # number of historical surplus events to generate per factory
_NOISE_STD_DAYS:             float = 2.0  # σ (days) — jitter applied to the base cycle
_NOISE_STD_KG_FRAC:          float = 0.15  # σ as fraction of average_surplus_kg

# Model hyper-parameters (reasonable defaults; tune post-hackathon if needed)
_RF_N_ESTIMATORS: int = 200
_RF_MAX_DEPTH:    int = 8
_RF_RANDOM_STATE: int = 42

logging.basicConfig(level=logging.INFO, format="[%(levelname)s] %(message)s")
_log = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Industry-type label encoder (fit once at module level)
# ---------------------------------------------------------------------------

_KNOWN_INDUSTRY_TYPES: list[str] = [
    "plastics_manufacturer",
    "textile_dyeing_factory",
    "food_processing_plant",
    "metal_fabrication_shop",
    "electronics_manufacturer",
    "paper_mill",
    "unknown",
]

_industry_encoder: LabelEncoder = LabelEncoder()
_industry_encoder.fit(_KNOWN_INDUSTRY_TYPES)


def _encode_industry(industry_type: str) -> int:
    """
    Encode an industry_type string to an integer label.

    Falls back to the label for 'unknown' if the type was not seen during
    training, so the model never throws on new industries at inference time.

    Args:
        industry_type: Raw industry type string.

    Returns:
        Integer label for the industry type.
    """
    normalised = str(industry_type).strip().lower()
    if normalised not in _industry_encoder.classes_:
        normalised = "unknown"
    return int(_industry_encoder.transform([normalised])[0])


# ---------------------------------------------------------------------------
# Synthetic historical data generator
# ---------------------------------------------------------------------------

def _generate_historical_data(df: pd.DataFrame) -> pd.DataFrame:
    """
    Generate a synthetic historical surplus-event dataset from the factory
    snapshot DataFrame.

    For each factory row, ``_HISTORY_EVENTS_PER_FACTORY`` historical events
    are created by simulating past surplus cycles.  Each event represents one
    surplus occurrence and records:

    * ``days_until_next_surplus`` — the gap (in days) to the *next* event,
      computed as ``surplus_frequency_days + Gaussian_noise``, clipped to [1, ∞).
    * ``predicted_quantity_kg``  — ``average_surplus_kg`` with multiplicative
      Gaussian noise (mean=1, std=0.15), clipped to [1, ∞).

    These become the regression targets.  The features are factory-level
    properties that a production schedule would carry.

    Args:
        df: Factory snapshot DataFrame loaded from synthetic_taiwan_factories.csv.

    Returns:
        DataFrame with one row per historical event, containing both features
        and regression targets.
    """
    rng = np.random.default_rng(seed=_RF_RANDOM_STATE)
    records: list[dict[str, Any]] = []

    for _, row in df.iterrows():
        factory_id            = int(row["factory_id"])
        industry_encoded      = _encode_industry(row["industry_type"])
        weekly_production_kg  = float(row["weekly_production_kg"])
        surplus_frequency_days = float(row["surplus_frequency_days"])
        average_surplus_kg    = float(row["average_surplus_kg"])

        # Clip to prevent nonsensical values from noise
        base_freq = max(1.0, surplus_frequency_days)
        base_qty  = max(1.0, average_surplus_kg)

        # Derived feature: daily production rate
        daily_production_kg = weekly_production_kg / 7.0

        for _ in range(_HISTORY_EVENTS_PER_FACTORY):
            # --- Target 1: days until next surplus (regression) ---------------
            noisy_freq = base_freq + rng.normal(0, _NOISE_STD_DAYS)
            days_until_next = float(max(1.0, noisy_freq))

            # --- Target 2: quantity in kg (regression) -----------------------
            noise_multiplier = 1.0 + rng.normal(0, _NOISE_STD_KG_FRAC)
            qty_kg = float(max(1.0, base_qty * noise_multiplier))

            records.append(
                {
                    # Features (same shape as predict-time inputs)
                    "factory_id":             factory_id,
                    "industry_type_encoded":  industry_encoded,
                    "weekly_production_kg":   weekly_production_kg,
                    "surplus_frequency_days": surplus_frequency_days,
                    "average_surplus_kg":     average_surplus_kg,
                    "daily_production_kg":    daily_production_kg,

                    # Targets
                    "days_until_next_surplus": days_until_next,
                    "predicted_quantity_kg":   qty_kg,
                }
            )

    return pd.DataFrame(records)


# ---------------------------------------------------------------------------
# Feature column names (must stay in sync between training and inference)
# ---------------------------------------------------------------------------

_FEATURE_COLS: list[str] = [
    "industry_type_encoded",
    "weekly_production_kg",
    "surplus_frequency_days",
    "average_surplus_kg",
    "daily_production_kg",
]

# ---------------------------------------------------------------------------
# Model training
# ---------------------------------------------------------------------------

def _train_and_save_model(csv_path: str, model_path: str) -> dict[str, RandomForestRegressor]:
    """
    Load the factory CSV, generate synthetic history, train two
    RandomForestRegressors (one per target), and persist them to disk.

    Two separate models are trained:
    * ``days_model``  — predicts ``days_until_next_surplus``
    * ``qty_model``   — predicts ``predicted_quantity_kg``

    Confidence is derived at inference time from the variance across the
    individual decision-tree predictions in the forest.

    Args:
        csv_path:   Absolute or relative path to synthetic_taiwan_factories.csv.
        model_path: Path where the pickled model bundle will be saved.

    Returns:
        Model bundle dict with keys ``"days_model"`` and ``"qty_model"``.
    """
    _log.info("Loading factory data from %s", csv_path)
    df = pd.read_csv(csv_path)

    _log.info("Generating synthetic historical surplus events (%d factories × %d events) …",
              len(df), _HISTORY_EVENTS_PER_FACTORY)
    history_df = _generate_historical_data(df)

    X = history_df[_FEATURE_COLS].values
    y_days = history_df["days_until_next_surplus"].values
    y_qty  = history_df["predicted_quantity_kg"].values

    _log.info("Training RandomForestRegressors on %d samples …", len(history_df))

    days_model = RandomForestRegressor(
        n_estimators=_RF_N_ESTIMATORS,
        max_depth=_RF_MAX_DEPTH,
        random_state=_RF_RANDOM_STATE,
        n_jobs=-1,
    )
    days_model.fit(X, y_days)

    qty_model = RandomForestRegressor(
        n_estimators=_RF_N_ESTIMATORS,
        max_depth=_RF_MAX_DEPTH,
        random_state=_RF_RANDOM_STATE,
        n_jobs=-1,
    )
    qty_model.fit(X, y_qty)

    bundle = {"days_model": days_model, "qty_model": qty_model}

    # Ensure the directory exists before writing
    os.makedirs(os.path.dirname(os.path.abspath(model_path)), exist_ok=True)

    with open(model_path, "wb") as fh:
        pickle.dump(bundle, fh, protocol=pickle.HIGHEST_PROTOCOL)

    _log.info("Model bundle saved to %s", model_path)
    return bundle


# ---------------------------------------------------------------------------
# Lazy model loader (train once, load thereafter)
# ---------------------------------------------------------------------------

_model_bundle: dict[str, RandomForestRegressor] | None = None


def _get_model_bundle() -> dict[str, RandomForestRegressor]:
    """
    Return the cached model bundle, loading or training it as needed.

    Load order:
    1. Return in-process cache ``_model_bundle`` if already loaded.
    2. Load from ``MODEL_PATH`` pickle if it exists on disk.
    3. Train from scratch (writes pickle to ``MODEL_PATH`` for future starts).

    Returns:
        Dict with keys ``"days_model"`` and ``"qty_model"``.
    """
    global _model_bundle

    if _model_bundle is not None:
        return _model_bundle

    if os.path.isfile(MODEL_PATH):
        _log.info("Loading cached model bundle from %s", MODEL_PATH)
        with open(MODEL_PATH, "rb") as fh:
            _model_bundle = pickle.load(fh)
    else:
        _log.info("No cached model found at %s — training now …", MODEL_PATH)
        _model_bundle = _train_and_save_model(_CSV_PATH, MODEL_PATH)

    return _model_bundle


# ---------------------------------------------------------------------------
# Factory snapshot lookup (needed to resolve factory_id -> features)
# ---------------------------------------------------------------------------

_factory_df: pd.DataFrame | None = None


def _get_factory_df() -> pd.DataFrame:
    """
    Return the factory snapshot DataFrame, loading it lazily.

    Returns:
        DataFrame indexed by ``factory_id``.
    """
    global _factory_df
    if _factory_df is None:
        _factory_df = pd.read_csv(_CSV_PATH).set_index("factory_id")
    return _factory_df


# ---------------------------------------------------------------------------
# Confidence score helper
# ---------------------------------------------------------------------------

def _compute_confidence(model: RandomForestRegressor, X_row: np.ndarray) -> float:
    """
    Derive a confidence score (0-1) from inter-tree prediction variance.

    Low variance across the individual estimators → high confidence.
    The raw coefficient of variation (σ/μ) is mapped to [0, 1] via an
    exponential decay so the caller always receives a clean probability-like
    number.

    Args:
        model: A fitted RandomForestRegressor.
        X_row: Single sample array with shape (1, n_features).

    Returns:
        Confidence score in [0.0, 1.0].
    """
    tree_preds = np.array([tree.predict(X_row)[0] for tree in model.estimators_])
    mean_pred  = np.mean(tree_preds)
    std_pred   = np.std(tree_preds)

    if mean_pred <= 0:
        return 0.5  # guard against division by zero on degenerate inputs

    cv = std_pred / mean_pred  # coefficient of variation
    # Map to [0,1]: confidence=1 when cv=0, decays exponentially
    confidence = float(math.exp(-2.0 * cv))
    return round(max(0.0, min(1.0, confidence)), 4)


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------

def predict_surplus(factory_id: int | str, production_schedule: dict) -> dict:
    """
    Predict the next surplus event for a factory, given its current production
    schedule.

    The function resolves the factory's base features from the CSV snapshot
    and overrides them with any values present in ``production_schedule``,
    making it forward-compatible with richer schedule data from the Node.js
    backend (e.g. adjusted weekly volumes, forecast adjustments).

    Args:
        factory_id:          Integer or string factory identifier matching
                             ``factory_id`` in synthetic_taiwan_factories.csv.
        production_schedule: Dict of production context forwarded from the
                             Node.js backend.  Recognised override keys:
                               ``weekly_production_kg`` (float)
                               ``surplus_frequency_days`` (float)
                               ``average_surplus_kg`` (float)
                               ``industry_type`` (str)
                             Any additional keys are silently ignored.

    Returns:
        Dict matching the contract defined in aiClient.service.js::
            {
                "materialType":         str,    # material_type from CSV
                "quantityKg":           float,  # predicted surplus quantity
                "predictedSurplusDate": str,    # ISO 8601 UTC date string
                "confidenceScore":      float   # 0.0 – 1.0
            }

    Raises:
        KeyError:  If ``factory_id`` is not found in the CSV snapshot.
        Exception: Propagated from model inference on unexpected input shapes.
    """
    # -- Resolve base factory features from snapshot --------------------------
    fdf = _get_factory_df()
    factory_id_int = int(factory_id)

    if factory_id_int not in fdf.index:
        raise KeyError(
            f"factory_id {factory_id_int!r} not found in factory snapshot. "
            f"Available IDs: {sorted(fdf.index.tolist())}"
        )

    row = fdf.loc[factory_id_int]

    # Apply any overrides coming from the production schedule
    industry_type         = production_schedule.get("industry_type",         row["industry_type"])
    weekly_production_kg  = float(production_schedule.get("weekly_production_kg",  row["weekly_production_kg"]))
    surplus_frequency_days = float(production_schedule.get("surplus_frequency_days", row["surplus_frequency_days"]))
    average_surplus_kg    = float(production_schedule.get("average_surplus_kg",    row["average_surplus_kg"]))
    material_type: str    = str(row["material_type"])

    # Derived feature
    daily_production_kg = weekly_production_kg / 7.0

    # -- Build feature vector -------------------------------------------------
    industry_encoded = _encode_industry(industry_type)
    X_row = np.array([[
        industry_encoded,
        weekly_production_kg,
        surplus_frequency_days,
        average_surplus_kg,
        daily_production_kg,
    ]])

    # -- Inference ------------------------------------------------------------
    bundle     = _get_model_bundle()
    days_model = bundle["days_model"]
    qty_model  = bundle["qty_model"]

    days_until_next  = float(max(1.0, days_model.predict(X_row)[0]))
    quantity_kg      = float(max(1.0, qty_model.predict(X_row)[0]))
    confidence_score = _compute_confidence(days_model, X_row)

    # -- Compute predicted surplus date (UTC, ISO 8601) -----------------------
    surplus_date: datetime = datetime.now(tz=timezone.utc) + timedelta(days=days_until_next)
    predicted_surplus_date: str = surplus_date.strftime("%Y-%m-%dT%H:%M:%SZ")

    return {
        "materialType":         material_type,
        "quantityKg":           round(quantity_kg, 2),
        "predictedSurplusDate": predicted_surplus_date,
        "confidenceScore":      confidence_score,
    }


# ---------------------------------------------------------------------------
# Demo / entry point (smoke-test)
# ---------------------------------------------------------------------------

if __name__ == "__main__":
    print("=" * 60)
    print("  SURPLUS PREDICTION MODEL - SMOKE TEST")
    print("=" * 60)
    print()

    test_cases = [
        # (factory_id, production_schedule override dict)
        (1,  {}),                                     # use all defaults from CSV
        (9,  {"weekly_production_kg": 8000}),         # override weekly volume
        (12, {"surplus_frequency_days": 2}),          # higher frequency override
        (20, {"industry_type": "textile_dyeing_factory"}),
    ]

    for fid, sched in test_cases:
        result = predict_surplus(fid, sched)
        print(f"  Factory ID : {fid}")
        print(f"  Schedule   : {sched or '(no overrides)'}")
        print(f"  Result     : {result}")
        print()

    print("=" * 60)
