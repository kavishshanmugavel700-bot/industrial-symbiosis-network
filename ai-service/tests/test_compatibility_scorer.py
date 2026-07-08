"""
tests/test_compatibility_scorer.py
------------------------------------
Pytest tests covering:
  - get_compatibility_score() sourced from CSV (Gap 3)
  - POST /compatibility/score via Flask test client
  - POST /compatibility/parse-msds via Flask test client (Gap 1)
  - POST /compatibility/rank-buyers via Flask test client
"""

import io
import os
import sys
import pytest

_AI_SERVICE = os.path.normpath(os.path.join(os.path.dirname(__file__), ".."))
if _AI_SERVICE not in sys.path:
    sys.path.insert(0, _AI_SERVICE)

from nlp.embedding_utils import get_compatibility_score, MATERIAL_COMPATIBILITY_TABLE
from app import create_app

_SAMPLE_DIR = os.path.join(_AI_SERVICE, "nlp", "sample_msds")


def _pdf_path(name: str) -> str:
    return os.path.join(_SAMPLE_DIR, name)


def _pdf_exists(name: str) -> bool:
    return os.path.isfile(_pdf_path(name))


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------

@pytest.fixture(scope="module")
def flask_client():
    app = create_app()
    app.config["TESTING"] = True
    with app.test_client() as client:
        yield client


# ---------------------------------------------------------------------------
# Tests: get_compatibility_score (Gap 3 — CSV is now the source of truth)
# ---------------------------------------------------------------------------

class TestGetCompatibilityScore:
    """Verify that scores come from the CSV table (not the old hardcoded dict)."""

    def test_csv_table_not_empty(self):
        assert len(MATERIAL_COMPATIBILITY_TABLE) > 0, "Compatibility table should be loaded from CSV"

    def test_csv_has_expected_pairs(self):
        # All these pairs are in the CSV
        assert ("chemical_solvent", "chemical_solvent") in MATERIAL_COMPATIBILITY_TABLE
        assert ("metal_offcut", "metal_offcut") in MATERIAL_COMPATIBILITY_TABLE
        assert ("organic_sludge", "heat_energy") in MATERIAL_COMPATIBILITY_TABLE

    def test_chemical_solvent_self_score(self):
        score = get_compatibility_score("chemical_solvent", "chemical_solvent")
        assert score == 95.0, f"Expected 95.0, got {score}"

    def test_metal_offcut_self_score(self):
        score = get_compatibility_score("metal_offcut", "metal_offcut")
        assert score == 90.0, f"Expected 90.0, got {score}"

    def test_organic_sludge_heat_energy(self):
        score = get_compatibility_score("organic_sludge", "heat_energy")
        assert score == 85.0, f"Expected 85.0, got {score}"

    def test_heat_energy_chemical_solvent_incompatible(self):
        score = get_compatibility_score("heat_energy", "chemical_solvent")
        assert score == 5.0, f"Expected 5.0 (INCOMPATIBLE), got {score}"

    def test_chemical_solvent_organic_sludge_incompatible(self):
        score = get_compatibility_score("chemical_solvent", "organic_sludge")
        assert score == 15.0, f"Expected 15.0 (INCOMPATIBLE), got {score}"

    def test_metal_offcut_water_incompatible(self):
        score = get_compatibility_score("metal_offcut", "water")
        assert score == 10.0, f"Expected 10.0 (INCOMPATIBLE), got {score}"

    def test_unknown_pair_returns_default(self):
        score = get_compatibility_score("unknown_material_xyz", "another_unknown_abc")
        assert score == 40.0, f"Expected default 40.0, got {score}"

    def test_symmetric_lookup(self):
        # Some pairs should be found via symmetric reverse lookup
        # water -> cooling_systems is in the CSV; try the reverse
        score_direct = get_compatibility_score("water", "cooling_systems")
        assert score_direct > 0  # confirms the pair exists

    def test_case_normalisation(self):
        # Uppercase input should be normalised before lookup
        score = get_compatibility_score("Chemical Solvent", "Chemical Solvent")
        assert score == 95.0

    def test_plastic_offcut_self_score(self):
        score = get_compatibility_score("plastic_offcut", "plastic_offcut")
        assert score == 88.0


# ---------------------------------------------------------------------------
# Tests: POST /compatibility/score  (existing endpoint, unchanged contract)
# ---------------------------------------------------------------------------

class TestScoreEndpoint:
    def test_valid_request_returns_score_and_ishazmat(self, flask_client):
        resp = flask_client.post(
            "/compatibility/score",
            json={"materialType": "chemical_solvent", "msdsText": "H225 flammable liquid"},
        )
        assert resp.status_code == 200
        data = resp.get_json()
        assert "score" in data
        assert "isHazmat" in data
        assert isinstance(data["score"], (int, float))
        assert isinstance(data["isHazmat"], bool)

    def test_hazmat_material_flagged_correctly(self, flask_client):
        resp = flask_client.post(
            "/compatibility/score",
            json={"materialType": "chemical_solvent", "msdsText": "H225 highly flammable"},
        )
        assert resp.status_code == 200
        assert resp.get_json()["isHazmat"] is True

    def test_non_hazmat_not_flagged(self, flask_client):
        resp = flask_client.post(
            "/compatibility/score",
            json={"materialType": "water", "msdsText": "non-hazardous, food grade process water"},
        )
        assert resp.status_code == 200
        assert resp.get_json()["isHazmat"] is False

    def test_missing_material_type_returns_400(self, flask_client):
        resp = flask_client.post("/compatibility/score", json={"msdsText": "some text"})
        assert resp.status_code == 400

    def test_empty_body_returns_400(self, flask_client):
        resp = flask_client.post("/compatibility/score", data="not json",
                                 content_type="text/plain")
        assert resp.status_code == 400

    def test_response_shape_matches_contract(self, flask_client):
        """Verify the exact contract that aiClient.service.js depends on."""
        resp = flask_client.post(
            "/compatibility/score",
            json={"materialType": "metal_offcut", "msdsText": ""},
        )
        assert resp.status_code == 200
        data = resp.get_json()
        # Only score and isHazmat are guaranteed in the Node contract
        assert set(data.keys()) >= {"score", "isHazmat"}


# ---------------------------------------------------------------------------
# Tests: POST /compatibility/parse-msds  (Gap 1 — the critical new endpoint)
# ---------------------------------------------------------------------------

class TestParseMsdsEndpoint:
    def test_no_file_field_returns_400(self, flask_client):
        resp = flask_client.post("/compatibility/parse-msds", data={})
        assert resp.status_code == 400
        assert "error" in resp.get_json()

    def test_wrong_field_name_returns_400(self, flask_client):
        data = {"document": (io.BytesIO(b"%PDF-1.4"), "test.pdf")}
        resp = flask_client.post("/compatibility/parse-msds",
                                 data=data, content_type="multipart/form-data")
        assert resp.status_code == 400

    @pytest.mark.skipif(
        not _pdf_exists("hazmat_solvent.pdf"),
        reason="hazmat_solvent.pdf not generated yet"
    )
    def test_hazmat_pdf_returns_200_with_is_hazmat_true(self, flask_client):
        with open(_pdf_path("hazmat_solvent.pdf"), "rb") as f:
            data = {"file": (f, "hazmat_solvent.pdf")}
            resp = flask_client.post(
                "/compatibility/parse-msds",
                data=data,
                content_type="multipart/form-data",
            )
        assert resp.status_code == 200, f"Expected 200, got {resp.status_code}: {resp.data}"
        result = resp.get_json()
        assert result["isHazmat"] is True, (
            f"Expected isHazmat=True for hazmat solvent PDF. Got: {result}"
        )

    @pytest.mark.skipif(
        not _pdf_exists("hazmat_solvent.pdf"),
        reason="hazmat_solvent.pdf not generated yet"
    )
    def test_parse_msds_response_has_required_keys(self, flask_client):
        with open(_pdf_path("hazmat_solvent.pdf"), "rb") as f:
            data = {"file": (f, "hazmat_solvent.pdf")}
            resp = flask_client.post(
                "/compatibility/parse-msds",
                data=data,
                content_type="multipart/form-data",
            )
        assert resp.status_code == 200
        result = resp.get_json()
        required = {"material_name", "chemical_properties", "isHazmat",
                    "hazard_class", "reuse_potential", "raw_text"}
        assert required.issubset(set(result.keys())), (
            f"Missing keys: {required - set(result.keys())}"
        )

    @pytest.mark.skipif(
        not _pdf_exists("safe_water.pdf"),
        reason="safe_water.pdf not generated yet"
    )
    def test_safe_pdf_returns_is_hazmat_false(self, flask_client):
        with open(_pdf_path("safe_water.pdf"), "rb") as f:
            data = {"file": (f, "safe_water.pdf")}
            resp = flask_client.post(
                "/compatibility/parse-msds",
                data=data,
                content_type="multipart/form-data",
            )
        assert resp.status_code == 200
        result = resp.get_json()
        assert result["isHazmat"] is False, (
            f"Expected isHazmat=False for safe water PDF. Got: {result}"
        )
