"""
nlp/msds_parser.py
------------------
Parses a Material Safety Data Sheet (MSDS) PDF and extracts structured
chemical information for downstream compatibility scoring.

Public API
----------
    parse_msds(pdf_path: str) -> dict
    detect_hazmat(text: str, hazard_class=None) -> bool
    detect_reuse_potential(text: str) -> str

Run directly for a demo:
    python msds_parser.py
"""

import re
import os
from typing import Optional

try:
    import pdfplumber
except ImportError:
    pdfplumber = None  # type: ignore[assignment]

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

# Regex patterns for material name extraction
_NAME_PATTERNS: list[re.Pattern] = [
    re.compile(r"Product\s+Name\s*[:\-]\s*(.+)", re.IGNORECASE),
    re.compile(r"Chemical\s+Name\s*[:\-]\s*(.+)", re.IGNORECASE),
    re.compile(r"^Material\s*[:\-]\s*(.+)", re.IGNORECASE | re.MULTILINE),
    re.compile(r"Trade\s+Name\s*[:\-]\s*(.+)", re.IGNORECASE),
    re.compile(r"Substance\s+Name\s*[:\-]\s*(.+)", re.IGNORECASE),
]

# Keywords that signal a chemical property line
_PROPERTY_KEYWORDS: list[str] = [
    "flash point",
    "boiling point",
    "ph",
    "density",
    "viscosity",
    "solubility",
    "melting point",
    "vapour pressure",
    "vapor pressure",
    "auto-ignition",
    "autoignition",
    "specific gravity",
]

# GHS hazard statement codes:
#   H2xx = physical hazards, H3xx = health hazards, H4xx = environmental hazards
_GHS_HAZARD_PATTERN: re.Pattern = re.compile(
    r"\b(H[2-4]\d{2}[A-Za-z]?)\b", re.IGNORECASE
)

# UN hazard class numbers (1-9 with optional sub-class)
_UN_CLASS_PATTERN: re.Pattern = re.compile(
    r"\bUN\s*(?:Class|Hazard)?\s*([1-9](?:\.\d{1,2})?)\b", re.IGNORECASE
)

# Keywords that strongly indicate a hazardous material.
# Uses a word-boundary compiled pattern (merged from compatibility_routes.py)
# to avoid false positives like "non-hazardous" triggering "hazardous".
import re as _re  # re already imported above; this alias silences duplicate-import warnings
_HAZMAT_KW_PATTERN: "re.Pattern" = re.compile(
    r"(?<![\w-])(?:"
    r"flammable|explosive|(?<!non[-\s])toxic|corrosive|oxidis[ei]r|oxidizer|"
    r"carcinogen|mutagen|teratogen|poison|radioactive|compressed\s+gas|"
    r"self[-\s]reactive|pyrophoric|(?<!non[-\s])hazardous"
    r")(?![\w-])",
    re.IGNORECASE,
)

# Reuse-positive and reuse-negative signal words (merged from compatibility_routes.py)
_REUSE_HIGH_KEYWORDS: tuple = (
    "reusable", "recoverable", "recyclable", "non-hazardous", "non hazardous",
    "safe for reuse", "biodegradable", "food grade", "industrial grade",
)
_REUSE_LOW_KEYWORDS: tuple = (
    "carcinogen", "mutagen", "teratogen", "persistent", "bioaccumulat",
    "highly toxic", "acutely toxic", "environmentally hazardous",
)

# Flash-point and pH extraction helpers
_FLASH_POINT_PATTERN: re.Pattern = re.compile(
    r"flash\s+point\s*[:\-]?\s*([\-\d\.]+)\s*(?:deg(?:\s+C|C)|\u00b0C|\bC\b)",
    re.IGNORECASE,
)
_PH_PATTERN: re.Pattern = re.compile(
    r"\bpH\s*[:\-]?\s*([\d\.]+)\s*(?:to|[--])\s*([\d\.]+)|\bpH\s*[:\-]?\s*([\d\.]+)",
    re.IGNORECASE,
)

# Default return value used when parsing fails completely
_DEFAULT_RESULT: dict = {
    "material_name":       "Unknown",
    "chemical_properties": {},
    "isHazmat":            False,
    "hazard_class":        None,
    "reuse_potential":     "MEDIUM",
    "raw_text":            "",
}


# ---------------------------------------------------------------------------
# Internal helpers
# ---------------------------------------------------------------------------

def _extract_text_from_pdf(pdf_path: str) -> str:
    """
    Use pdfplumber to read every page of a PDF and concatenate the text.

    Args:
        pdf_path: Absolute or relative path to the PDF file.

    Returns:
        Full text of the PDF as a single string, or empty string on failure.
    """
    if pdfplumber is None:
        print("[WARN] pdfplumber is not installed. Cannot extract PDF text.")
        return ""

    try:
        with pdfplumber.open(pdf_path) as pdf:
            pages = [page.extract_text() or "" for page in pdf.pages]
        return "\n".join(pages)
    except FileNotFoundError:
        print(f"[ERROR] PDF not found: {pdf_path}")
        return ""
    except Exception as exc:  # noqa: BLE001
        print(f"[ERROR] Failed to read PDF '{pdf_path}': {exc}")
        return ""


def _extract_material_name(text: str) -> str:
    """
    Search the raw text for common MSDS product-name labels and return the
    first match found, stripped of surrounding whitespace.

    Args:
        text: Full raw text from the MSDS PDF.

    Returns:
        Material name string, or "Unknown" if no pattern matches.
    """
    for pattern in _NAME_PATTERNS:
        match = pattern.search(text)
        if match:
            name = match.group(1).strip()
            # Truncate at first newline in case the value spans multiple lines
            name = name.split("\n")[0].strip()
            if name:
                return name
    return "Unknown"


def _extract_chemical_properties(text: str) -> dict[str, str]:
    """
    Scan the text line-by-line and collect any line that contains a recognised
    chemical-property keyword.  The line is stored as-is so the caller can
    parse numeric values if needed.

    Args:
        text: Full raw text from the MSDS PDF.

    Returns:
        Dictionary mapping normalised property keyword -> matched line text.
    """
    properties: dict[str, str] = {}
    for line in text.splitlines():
        line_lower = line.lower().strip()
        for keyword in _PROPERTY_KEYWORDS:
            if keyword in line_lower and line.strip():
                # Use the keyword as the dict key (underscored, no spaces)
                key = keyword.replace(" ", "_")
                if key not in properties:
                    properties[key] = line.strip()
    return properties


def _extract_hazard_class(text: str) -> Optional[str]:
    """
    Look for GHS hazard codes (H2xx - H4xx) or UN hazard class numbers in the
    text and return them as a comma-separated string.

    Args:
        text: Full raw text from the MSDS PDF.

    Returns:
        Comma-separated hazard codes/classes, or None if nothing found.
    """
    ghs_codes = _GHS_HAZARD_PATTERN.findall(text)
    un_classes = _UN_CLASS_PATTERN.findall(text)

    found: list[str] = []
    if ghs_codes:
        # De-duplicate while preserving order
        seen: set[str] = set()
        for code in ghs_codes:
            upper = code.upper()
            if upper not in seen:
                found.append(upper)
                seen.add(upper)
    if un_classes:
        for cls in un_classes:
            label = f"UN Class {cls}"
            if label not in found:
                found.append(label)

    return ", ".join(found) if found else None


def detect_hazmat(text: str, hazard_class: Optional[str] = None) -> bool:
    """
    Determine whether the material should be classified as hazardous.

    Public function — single source of truth for hazmat detection used by
    both parse_msds() and the /compatibility/score route.

    A material is considered hazardous if:
    - At least one GHS hazard code or UN class was found, OR
    - The text matches the hazmat keyword pattern (with negative lookbehind
      to avoid false positives like "non-hazardous" → "hazardous").

    Args:
        text:         Full raw text from the MSDS PDF.
        hazard_class: Optional output of _extract_hazard_class().

    Returns:
        True if hazardous, False otherwise.
    """
    # hazard_class overrides everything — check it first before any text guard
    if hazard_class:
        return True
    if not text:
        return False
    # Also check for GHS codes directly in text
    if _GHS_HAZARD_PATTERN.search(text):
        return True
    # Keyword scan with negative-lookbehind (avoids "non-hazardous" false positives)
    return bool(_HAZMAT_KW_PATTERN.search(text))


def _parse_flash_point(text: str) -> Optional[float]:
    """
    Extract the flash point temperature (in  degC) from the text.

    Args:
        text: Full raw text from the MSDS PDF.

    Returns:
        Flash point as a float, or None if not found / not parseable.
    """
    match = _FLASH_POINT_PATTERN.search(text)
    if match:
        try:
            return float(match.group(1))
        except (ValueError, TypeError):
            return None
    return None


def _parse_ph(text: str) -> Optional[float]:
    """
    Extract a representative pH value from the text.

    If a range is given (e.g. "6.5 to 7.5"), returns the midpoint.

    Args:
        text: Full raw text from the MSDS PDF.

    Returns:
        pH as a float, or None if not found.
    """
    match = _PH_PATTERN.search(text)
    if not match:
        return None
    try:
        if match.group(1) and match.group(2):
            # Range found
            return (float(match.group(1)) + float(match.group(2))) / 2
        val = match.group(1) or match.group(3)
        return float(val) if val else None
    except (ValueError, TypeError):
        return None


def _calculate_reuse_potential(
    is_hazmat: bool,
    flash_point: Optional[float],
    ph: Optional[float],
    text: str = "",
) -> str:
    """
    Determine the reuse potential category based on hazard signals and
    chemical properties.

    Rules (in order of precedence):
    - LOW    : Text contains reuse-negative keywords (carcinogen, highly toxic…)
               regardless of other signals.
    - LOW    : is_hazmat AND (flash_point < 23 or extreme pH < 2 or > 12)
    - HIGH   : Reuse-positive keywords (reusable, recyclable…) OR
               (flash_point > 60 AND/OR pH in neutral range 6-8)
    - MEDIUM : All other cases.

    Args:
        is_hazmat:   Whether GHS/UN hazmat signals were found.
        flash_point: Flash point in degC, or None.
        ph:          pH value, or None.
        text:        Raw MSDS text for keyword scanning (optional).

    Returns:
        One of "HIGH", "MEDIUM", or "LOW".
    """
    text_lower = text.lower() if text else ""

    # Serious hazard keywords → always LOW regardless of physical props
    if any(kw in text_lower for kw in _REUSE_LOW_KEYWORDS):
        return "LOW"

    if is_hazmat:
        # Check for highly dangerous physical properties
        dangerous = False
        if flash_point is not None and flash_point < 23:  # highly flammable
            dangerous = True
        if ph is not None and (ph < 2 or ph > 12):        # highly corrosive
            dangerous = True
        return "LOW" if dangerous else "MEDIUM"

    # Not hazmat — assess reuse-positive signals
    has_positive_kw = any(kw in text_lower for kw in _REUSE_HIGH_KEYWORDS)
    has_favourable_props = (
        (flash_point is not None and flash_point > 60)
        or (ph is not None and 6.0 <= ph <= 8.0)
    )
    return "HIGH" if (has_positive_kw or has_favourable_props) else "MEDIUM"


def detect_reuse_potential(text: str) -> str:
    """
    Infer the reuse potential category from raw MSDS text.

    Public function — single source of truth used by both parse_msds() and
    the /compatibility/score route (delegates to _calculate_reuse_potential).

    Args:
        text: Raw MSDS text (may be multi-line, mixed case).

    Returns:
        One of "HIGH", "MEDIUM", or "LOW".
    """
    if not text:
        return "MEDIUM"

    flash_point: Optional[float] = None
    fp_match = _FLASH_POINT_PATTERN.search(text)
    if fp_match:
        try:
            flash_point = float(fp_match.group(1))
        except (ValueError, TypeError):
            pass

    ph: Optional[float] = None
    ph_match = _PH_PATTERN.search(text)
    if ph_match:
        try:
            if ph_match.group(1) and ph_match.group(2):
                ph = (float(ph_match.group(1)) + float(ph_match.group(2))) / 2
            else:
                val = ph_match.group(1) or ph_match.group(3)
                ph = float(val) if val else None
        except (ValueError, TypeError):
            pass

    is_haz = detect_hazmat(text)
    return _calculate_reuse_potential(is_haz, flash_point, ph, text)


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------

def parse_msds(pdf_path: str) -> dict:
    """
    Parse a Material Safety Data Sheet (MSDS) PDF and return structured
    information suitable for compatibility scoring.

    Extraction steps:
    1. Extract raw text using pdfplumber.
    2. Identify material name from common label patterns.
    3. Collect chemical property lines (flash point, pH, etc.).
    4. Detect GHS hazard codes (H2xx/H3xx/H4xx) and UN hazard classes.
    5. Classify hazmat status and reuse potential.

    Args:
        pdf_path: Path to the MSDS PDF file.

    Returns:
        Dictionary with keys:
            material_name       (str)  - Product / chemical name
            chemical_properties (dict) - Keyword -> line mapping
            isHazmat            (bool) - True if hazardous signals found
            hazard_class        (str|None) - GHS codes / UN class string
            reuse_potential     (str)  - "HIGH", "MEDIUM", or "LOW"
            raw_text            (str)  - Full extracted PDF text
    """
    try:
        raw_text = _extract_text_from_pdf(pdf_path)

        material_name       = _extract_material_name(raw_text)
        chemical_properties = _extract_chemical_properties(raw_text)
        hazard_class        = _extract_hazard_class(raw_text)
        is_hazmat           = detect_hazmat(raw_text, hazard_class)
        flash_point         = _parse_flash_point(raw_text)
        ph                  = _parse_ph(raw_text)
        reuse_potential     = _calculate_reuse_potential(is_hazmat, flash_point, ph, raw_text)

        return {
            "material_name":       material_name,
            "chemical_properties": chemical_properties,
            "isHazmat":            is_hazmat,
            "hazard_class":        hazard_class,
            "reuse_potential":     reuse_potential,
            "raw_text":            raw_text,
        }

    except Exception as exc:  # noqa: BLE001
        print(f"[ERROR] parse_msds failed for '{pdf_path}': {exc}")
        result = dict(_DEFAULT_RESULT)
        return result


# ---------------------------------------------------------------------------
# Demo / entry point
# ---------------------------------------------------------------------------

if __name__ == "__main__":
    print("=" * 60)
    print("  MSDS PARSER - DEMO (no real PDF available)")
    print("=" * 60)

    # Simulate what parse_msds would produce on a real MSDS document
    # by calling the internal helpers with synthetic text.
    SAMPLE_MSDS_TEXT = """
    Safety Data Sheet

    Product Name: Acetone (Technical Grade)
    Chemical Name: Propan-2-one
    CAS Number: 67-64-1

    Section 9 - Physical and Chemical Properties
    Flash Point: -20 deg C (closed cup)
    Boiling Point: 56 deg C
    pH: Not applicable (non-aqueous)
    Density: 0.791 g/cm3 at 20 deg C
    Viscosity: 0.32 mPa.s at 20 deg C
    Solubility: Miscible with water

    Section 2 - Hazard Identification
    GHS Hazard Statements:
      H225 - Highly flammable liquid and vapour
      H319 - Causes serious eye irritation
      H336 - May cause drowsiness or dizziness

    UN Class 3 - Flammable Liquids

    Precautionary Statements:
      P210 - Keep away from heat, sparks, and open flame.
    """

    print("\n[INFO] Running internal helpers on synthetic MSDS text ...\n")

    material_name       = _extract_material_name(SAMPLE_MSDS_TEXT)
    chemical_properties = _extract_chemical_properties(SAMPLE_MSDS_TEXT)
    hazard_class        = _extract_hazard_class(SAMPLE_MSDS_TEXT)
    is_hazmat           = detect_hazmat(SAMPLE_MSDS_TEXT, hazard_class)
    flash_point         = _parse_flash_point(SAMPLE_MSDS_TEXT)
    ph                  = _parse_ph(SAMPLE_MSDS_TEXT)
    reuse_potential     = _calculate_reuse_potential(is_hazmat, flash_point, ph, SAMPLE_MSDS_TEXT)

    result = {
        "material_name":       material_name,
        "chemical_properties": chemical_properties,
        "isHazmat":            is_hazmat,
        "hazard_class":        hazard_class,
        "reuse_potential":     reuse_potential,
        "raw_text":            "(truncated for display)",
    }

    print("Parsed MSDS result:")
    for key, value in result.items():
        print(f"  {key:25s}: {value}")

    print("\n[INFO] parse_msds() called on a non-existent path (graceful failure):")
    fallback = parse_msds("/non/existent/path.pdf")
    print(f"  material_name   : {fallback['material_name']}")
    print(f"  isHazmat        : {fallback['isHazmat']}")
    print(f"  reuse_potential : {fallback['reuse_potential']}")
    print("=" * 60)
