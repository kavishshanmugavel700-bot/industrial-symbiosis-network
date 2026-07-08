"""
scripts/generate_sample_pdfs.py
--------------------------------
Generates 3 synthetic MSDS-style PDF files under ai-service/nlp/sample_msds/
for use as test fixtures.

Run from the ai-service/ directory:
    python scripts/generate_sample_pdfs.py

Requires fpdf2 (listed in requirements.txt).
"""

import os
import sys

try:
    from fpdf import FPDF
except ImportError:
    print("[ERROR] fpdf2 is not installed. Run: pip install fpdf2")
    sys.exit(1)

_THIS_DIR = os.path.dirname(os.path.abspath(__file__))
_OUTPUT_DIR = os.path.normpath(os.path.join(_THIS_DIR, "..", "nlp", "sample_msds"))
os.makedirs(_OUTPUT_DIR, exist_ok=True)


def _make_pdf(filename, content):
    pdf = FPDF()
    pdf.set_auto_page_break(auto=True, margin=15)
    pdf.add_page()
    pdf.set_font("Courier", size=10)
    for line in content.splitlines():
        safe_line = line.encode("latin-1", errors="replace").decode("latin-1")
        pdf.cell(0, 5, safe_line, ln=True)
    out_path = os.path.join(_OUTPUT_DIR, filename)
    pdf.output(out_path)
    print(f"  [OK] Written: {out_path}")


HAZMAT_SOLVENT_TEXT = """MATERIAL SAFETY DATA SHEET

Product Name: MEK Solvent (Methyl Ethyl Ketone)
Chemical Name: Butan-2-one
CAS Number: 78-93-3
Trade Name: Industrial MEK Grade A

Section 2 - Hazard Identification
GHS Hazard Classification:
  H225 - Highly flammable liquid and vapour
  H319 - Causes serious eye irritation
  H336 - May cause drowsiness or dizziness

UN Hazard Class 3 - Flammable Liquids
Signal Word: DANGER
This material is flammable and toxic in high concentrations.

Section 9 - Physical and Chemical Properties
Flash Point: -9 deg C (closed cup, Pensky-Martens)
Boiling Point: 79.6 deg C
pH: Not applicable (non-aqueous solvent)
Density: 0.805 g/cm3 at 20 deg C
Vapour Pressure: 105 hPa at 20 deg C
Auto-ignition: 404 deg C
"""

SAFE_WATER_TEXT = """MATERIAL SAFETY DATA SHEET

Product Name: Treated Process Water
Chemical Name: Water (deionised, filtered)
Trade Name: DI Water Grade 3
CAS Number: 7732-18-5

Section 2 - Hazard Identification
GHS Classification: Non-hazardous
Signal Word: None

This material is non-hazardous. Non-toxic, non-flammable.
Classified as safe for reuse. Recyclable. Recoverable. Biodegradable.

Section 9 - Physical and Chemical Properties
pH: 6.8 to 7.2
Flash Point: Not applicable (non-flammable)
Boiling Point: 100 deg C
Density: 1.00 g/cm3 at 20 deg C

Section 15 - Regulatory Information
Taiwan EPA Reuse Category: Category 1 - Direct Reuse Permitted
Industrial grade water meeting CNS 10508 standard.
"""

BORDERLINE_SLUDGE_TEXT = """MATERIAL SAFETY DATA SHEET

Product Name: Food Processing Organic Sludge
Chemical Name: Mixed organic waste - sludge fraction
Material: Organic Sludge (food processing origin)
CAS Number: Not assigned (mixture)

Section 2 - Hazard Identification
GHS Classification: Not classified for physical or health hazards.
Signal Word: WARNING (environmental precaution only)
May contain biological agents. Not classified as acutely toxic.

Section 9 - Physical and Chemical Properties
pH: 5.5 to 6.5
Flash Point: Not applicable (aqueous sludge)
Boiling Point: ~100 deg C
Density: 1.05 g/cm3

Section 13 - Disposal Considerations
Suitable for anaerobic digestion to produce biogas.
Compatible with composting if heavy metal content is within Taiwan EPA limits.
Potential reuse pathways: fertilizer, agriculture, biogas production.
"""

if __name__ == "__main__":
    print(f"Generating synthetic MSDS PDFs in: {_OUTPUT_DIR}")
    _make_pdf("hazmat_solvent.pdf",    HAZMAT_SOLVENT_TEXT)
    _make_pdf("safe_water.pdf",        SAFE_WATER_TEXT)
    _make_pdf("borderline_sludge.pdf", BORDERLINE_SLUDGE_TEXT)
    print("Done. All 3 PDFs generated successfully.")
