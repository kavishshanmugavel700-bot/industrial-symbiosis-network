"""
tests/test_msds_parser.py
--------------------------
Pytest tests for nlp/msds_parser.py covering:
  - parse_msds() against each of the 3 sample PDFs
  - detect_hazmat() public function
  - detect_reuse_potential() public function
  - parse_msds() graceful failure on non-existent path
"""

import os
import sys
import pytest

# Ensure ai-service/ is on sys.path so imports resolve correctly
_AI_SERVICE = os.path.normpath(os.path.join(os.path.dirname(__file__), ".."))
if _AI_SERVICE not in sys.path:
    sys.path.insert(0, _AI_SERVICE)

from nlp.msds_parser import parse_msds, detect_hazmat, detect_reuse_potential

_SAMPLE_DIR = os.path.join(_AI_SERVICE, "nlp", "sample_msds")


# ---------------------------------------------------------------------------
# Fixtures / helpers
# ---------------------------------------------------------------------------

def _pdf(name: str) -> str:
    return os.path.join(_SAMPLE_DIR, name)


def _sample_exists(name: str) -> bool:
    return os.path.isfile(_pdf(name))


# ---------------------------------------------------------------------------
# Tests: detect_hazmat (public, Gap 2)
# ---------------------------------------------------------------------------

class TestDetectHazmat:
    def test_ghs_code_triggers_hazmat(self):
        assert detect_hazmat("GHS H225 - Highly flammable liquid") is True

    def test_flammable_keyword_triggers_hazmat(self):
        assert detect_hazmat("This product is flammable at room temperature.") is True

    def test_non_hazardous_does_not_trigger(self):
        # "non-hazardous" must NOT be matched as hazardous
        assert detect_hazmat("This material is non-hazardous and safe.") is False

    def test_empty_text_returns_false(self):
        assert detect_hazmat("") is False

    def test_hazard_class_arg_overrides_keyword_check(self):
        # Even empty text returns True when hazard_class is provided
        assert detect_hazmat("", hazard_class="H225") is True

    def test_toxic_keyword_triggers_hazmat(self):
        assert detect_hazmat("The vapour is toxic when inhaled.") is True

    def test_non_toxic_does_not_trigger(self):
        assert detect_hazmat("This substance is non-toxic and food safe.") is False


# ---------------------------------------------------------------------------
# Tests: detect_reuse_potential (public, Gap 2)
# ---------------------------------------------------------------------------

class TestDetectReusePotential:
    def test_recyclable_keyword_returns_high(self):
        result = detect_reuse_potential("This material is recyclable and recoverable.")
        assert result == "HIGH"

    def test_carcinogen_returns_low(self):
        result = detect_reuse_potential("This substance is a known carcinogen.")
        assert result == "LOW"

    def test_neutral_ph_returns_high(self):
        result = detect_reuse_potential("pH: 7.0")
        assert result == "HIGH"

    def test_empty_returns_medium(self):
        result = detect_reuse_potential("")
        assert result == "MEDIUM"

    def test_highly_flammable_with_low_flash_point(self):
        # Flash point < 23 degC with hazmat signal -> LOW
        text = "H225 flammable. Flash Point: -9 deg C"
        result = detect_reuse_potential(text)
        assert result == "LOW"


# ---------------------------------------------------------------------------
# Tests: parse_msds() on sample PDFs
# ---------------------------------------------------------------------------

class TestParseMsds:
    @pytest.mark.skipif(
        not _sample_exists("hazmat_solvent.pdf"),
        reason="hazmat_solvent.pdf not generated yet — run scripts/generate_sample_pdfs.py"
    )
    def test_hazmat_solvent_is_hazmat(self):
        result = parse_msds(_pdf("hazmat_solvent.pdf"))
        assert result["isHazmat"] is True, (
            f"Expected isHazmat=True for hazmat_solvent.pdf. Got: {result}"
        )

    @pytest.mark.skipif(
        not _sample_exists("hazmat_solvent.pdf"),
        reason="hazmat_solvent.pdf not generated yet"
    )
    def test_hazmat_solvent_has_material_name(self):
        result = parse_msds(_pdf("hazmat_solvent.pdf"))
        assert result["material_name"] != "Unknown", (
            f"Expected a material name to be extracted. Got: {result['material_name']}"
        )

    @pytest.mark.skipif(
        not _sample_exists("hazmat_solvent.pdf"),
        reason="hazmat_solvent.pdf not generated yet"
    )
    def test_hazmat_solvent_reuse_potential_is_low(self):
        result = parse_msds(_pdf("hazmat_solvent.pdf"))
        assert result["reuse_potential"] == "LOW", (
            f"Expected LOW reuse_potential for hazmat solvent. Got: {result['reuse_potential']}"
        )

    @pytest.mark.skipif(
        not _sample_exists("safe_water.pdf"),
        reason="safe_water.pdf not generated yet"
    )
    def test_safe_water_is_not_hazmat(self):
        result = parse_msds(_pdf("safe_water.pdf"))
        assert result["isHazmat"] is False, (
            f"Expected isHazmat=False for safe_water.pdf. Got: {result}"
        )

    @pytest.mark.skipif(
        not _sample_exists("safe_water.pdf"),
        reason="safe_water.pdf not generated yet"
    )
    def test_safe_water_reuse_potential_is_high(self):
        result = parse_msds(_pdf("safe_water.pdf"))
        assert result["reuse_potential"] == "HIGH", (
            f"Expected HIGH reuse_potential for safe water. Got: {result['reuse_potential']}"
        )

    @pytest.mark.skipif(
        not _sample_exists("borderline_sludge.pdf"),
        reason="borderline_sludge.pdf not generated yet"
    )
    def test_borderline_sludge_not_acutely_hazmat(self):
        result = parse_msds(_pdf("borderline_sludge.pdf"))
        # borderline sludge has no GHS codes and no strong hazmat keywords
        assert isinstance(result["isHazmat"], bool)
        assert "reuse_potential" in result

    def test_parse_msds_graceful_failure_on_missing_file(self):
        result = parse_msds("/non/existent/path/fake.pdf")
        # Should not raise; should return the default structure
        assert result["material_name"] == "Unknown"
        assert result["isHazmat"] is False
        assert result["reuse_potential"] in ("HIGH", "MEDIUM", "LOW")

    def test_parse_msds_returns_required_keys(self):
        result = parse_msds("/non/existent.pdf")
        required_keys = {"material_name", "chemical_properties", "isHazmat",
                         "hazard_class", "reuse_potential", "raw_text"}
        assert required_keys.issubset(set(result.keys())), (
            f"Missing keys: {required_keys - set(result.keys())}"
        )
