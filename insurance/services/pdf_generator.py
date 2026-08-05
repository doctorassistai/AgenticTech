import os
import re
from jinja2 import Environment, FileSystemLoader
from weasyprint import HTML
from services.conclusion_formatter import format_conclusion_html, get_section_html

# ─────────────────────────────────────────────────────────────────────────────
# PATHS
# ─────────────────────────────────────────────────────────────────────────────

BASE_DIR      = os.path.dirname(os.path.dirname(__file__))
TEMPLATE_DIR  = os.path.join(BASE_DIR, "templates")
GENERATED_DIR = os.path.join(BASE_DIR, "generated")
os.makedirs(GENERATED_DIR, exist_ok=True)

# ─────────────────────────────────────────────────────────────────────────────
# JINJA ENVIRONMENT
# ─────────────────────────────────────────────────────────────────────────────

env = Environment(loader=FileSystemLoader(TEMPLATE_DIR))

# ─────────────────────────────────────────────────────────────────────────────
# HELPERS
# ─────────────────────────────────────────────────────────────────────────────

def normalize(value: str) -> str:
    return str(value or "").strip().lower()


def get_claimed_amount(case_data: dict) -> float:
    """Parse claimedAmount from numeric (123) or string ('1,23,456') format."""
    val = case_data.get("claimedAmount") or 0
    try:
        return float(str(val).replace(",", "").strip())
    except (ValueError, TypeError):
        return 0.0


def get_pdf_filename_base(case_data: dict) -> str:
    """
    Use insurerRef (Claim ID / Insurer Ref) as the filename base for every
    generated document (PDF and DOCX alike).
    Falls back to caseId if insurerRef is missing/blank.
    Strips characters that are unsafe for filenames.
    """
    raw = str(case_data.get("insurerRef") or case_data.get("caseId") or "unknown").strip()
    safe = re.sub(r"[^A-Za-z0-9_\-]+", "_", raw).strip("_")
    return safe or "unknown"


def apply_amount_threshold(config: dict, case_data: dict) -> dict:
    """
    If the resolved config defines a claim_amount_threshold, compare claimedAmount:
      - amount < threshold  → use the base config (current template)
      - amount >= threshold → use config["threshold_template"] (fallback to base if missing)
    If no threshold is defined, return config unchanged.
    """
    threshold = config.get("claim_amount_threshold")
    if threshold is None:
        return config

    amount = get_claimed_amount(case_data)
    if amount >= threshold:
        return config.get("threshold_template", config)

    return config


# ─────────────────────────────────────────────────────────────────────────────
# INSURER-ONLY MAP
# ─────────────────────────────────────────────────────────────────────────────

INSURER_TEMPLATE_MAP = {
    "oriental insurance company": {
        "template":     "oriental.html",
        "header_image": "templates/assets/oriental_logo.jpg",
        "stamp_image":  "templates/assets/stamp_image.jpg",
    },
    "bajaj allianz general insurance": {
        "template":     "bajaj_spot.html",
        "header_image": "templates/assets/optimus_header.jpg",
        "stamp_image":  "templates/assets/stamp_image.jpg",
    },
    "cholamandalam ms general insurance": {
        "template":     "chola.html",
        "header_image": "templates/assets/chola_logo.png",
        "stamp_image":  "templates/assets/stamp_image.jpg",
    },

    # ── Common template insurers ──────────────────────────────────────────────
    "royal sundaram general insurance": {
        "template":     "common_insurer.html",
        "header_image": "templates/assets/optimus_header.jpg",
        "stamp_image":  "templates/assets/stamp_image.jpg",
    },
    "magma hdi general insurance": {
        "template":     "common_insurer.html",
        "header_image": "templates/assets/optimus_header.jpg",
        "stamp_image":  "templates/assets/stamp_image.jpg",
    },
    "hdfc ergo general insurance": {
        "template":     "common_insurer.html",
        "header_image": "templates/assets/optimus_header.jpg",
        "stamp_image":  "templates/assets/stamp_image.jpg",
    },
    "care health insurance": {
        "template":     "common_insurer.html",
        "header_image": "templates/assets/optimus_header.jpg",
        "stamp_image":  "templates/assets/stamp_image.jpg",
    },
    "universal sompo general insurance": {
        "template":     "common_insurer.html",
        "header_image": "templates/assets/optimus_header.jpg",
        "stamp_image":  "templates/assets/stamp_image.jpg",
    },
    "new india assurance": {
    "template":     "common_insurer.html",   # or "new_india.html" if you have one
    "header_image": "templates/assets/optimus_header.jpg",
    "stamp_image":  "templates/assets/stamp_image.jpg",
},


}

# ─────────────────────────────────────────────────────────────────────────────
# TPA + INSURER COMBO MAP
# key: (tpa exact normalized, insurer exact normalized)
# ─────────────────────────────────────────────────────────────────────────────

TPA_INSURER_TEMPLATE_MAP = {
    ("medi assist india tpa pvt ltd", "national insurance co. ltd."): {
        "template":     "national_insurance_mediassist.html",
        "header_image": "templates/assets/mediassist.png",
        "stamp_image":  "templates/assets/stamp_image.jpg",
    },
    ("medi assist india tpa pvt ltd", "manipalcigna health insurance"): {
        "template":     "manipal_cigna_mediassist.html",
        "header_image": "templates/assets/mediassist.png",
        "stamp_image":  "templates/assets/stamp_image.jpg",
    },
    ("raksha health insurance tpa pvt ltd", "oriental insurance company"): {
    "template":     "oriental_raksha.html",
    "header_image": "templates/assets/raksha_logo.png",
    "stamp_image":  "templates/assets/stamp_image.jpg",
},
("medi assist india tpa pvt ltd", "oriental insurance company"): {
    "template":     "oriental_mediassist.html",
    "header_image": "templates/assets/mediassist.png",
    "stamp_image":  "templates/assets/stamp_image.jpg",
},

# ── Raksha + National Insurance ───────────────────────────────────────────────
("raksha health insurance tpa pvt ltd", "national insurance co. ltd."): {
    "template":     "national_insurance_raksha.html",
    "header_image": "templates/assets/raksha_logo.png",
    "stamp_image":  "templates/assets/stamp_image.jpg",
},
("raksha health insurance tpa pvt ltd", "new india assurance"): {
    "template":     "new_india_raksha.html",
    "header_image": "templates/assets/raksha_logo.png",
    "stamp_image":  "templates/assets/stamp_image.jpg",
},
    ("medi assist india tpa pvt ltd", "new india assurance"): {
        "template":     "new_india_mediassist.html",
        "header_image": "templates/assets/mediassist.png",
        "stamp_image":  "templates/assets/stamp_image.jpg",
    },
    ("raksha health insurance tpa pvt ltd", "dhfl general insurance"): {
    "template":     "dhfl_raksha.html",
    "header_image": "templates/assets/raksha_logo.png",
    "stamp_image":  "templates/assets/stamp_image.jpg",
},
("medi assist india tpa pvt ltd", "dhfl general insurance"): {
    "template":     "dhfl_mediassist.html",
    "header_image": "templates/assets/mediassist.png",
    "stamp_image":  "templates/assets/stamp_image.jpg",
},

        # ── UIIC + Medi Assist: amount-based routing ──────────────────────────────
    ("medi assist india tpa pvt ltd", "united india insurance"): {
        "template":               "united_india_mediassist_below_1.html",  # amount < 1 lakh
        "header_image":           "templates/assets/mediassist.png",
        "stamp_image":            "templates/assets/stamp_image.jpg",
        "claim_amount_threshold": 100000,
        "threshold_template": {
            "template":     "united_india_mediassist_above_1.html",                       # amount >= 1 lakh
            "header_image": "templates/assets/mediassist.png",
            "stamp_image":  "templates/assets/stamp_image.jpg",
        },
    },
        ("raksha health insurance tpa pvt ltd", "united india insurance"): {
        "template":               "united_india_raksha_above_1.html",   # amount >= 1 lakh
        "header_image":           "templates/assets/raksha_logo.png",
        "stamp_image":            "templates/assets/stamp_image.jpg",
        "claim_amount_threshold": 100000,
        "threshold_template": {
            "template":     "uiic_raksha_above_1lakh.html",         # same — no below-1L template yet for Raksha
            "header_image": "templates/assets/raksha_logo.png",
            "stamp_image":  "templates/assets/stamp_image.jpg",
        },
    },
}

RAKSHA_DEFAULT = {
    "template":     "common_raksha.html",
    "header_image": "templates/assets/raksha_logo.png",
    "stamp_image":  "templates/assets/stamp_image.jpg",
}
# ─────────────────────────────────────────────────────────────────────────────
# INSURER + CLAIM MODE COMBO MAP
# key: (insurer exact normalized, claim_mode exact normalized)
# ─────────────────────────────────────────────────────────────────────────────

INSURER_CLAIMMODE_TEMPLATE_MAP = {
    ("tata aig general insurance", "cashless"): {
        "template":     "tata_cashless.html",
        "stamp_image":  "templates/assets/stamp_image.jpg",
    },
    ("sbi general insurance", "cashless"): {
        "template":     "sbi_cashless.html",
        "header_image": "templates/assets/optimus_header.jpg",
        "stamp_image":  "templates/assets/stamp_image.jpg",
    },
    ("niva bupa health insurance", "cashless"): {
        "template":    "nivabupa_cashless.html",
        "stamp_image": "templates/assets/stamp_image.jpg",
    },
    ("niva bupa health insurance", "reimbursement"): {
        "template":    "nivabupa_reimbursement.html",
        "stamp_image": "templates/assets/stamp_image.jpg",
    },
    ("future generali india insurance", "cashless"): {
        "template":     "future_generali_cashless.html",
        "header_image": "templates/assets/future_generali.png",
        "stamp_image":  "templates/assets/stamp_image.jpg",
    },
    ("aditya birla health insurance", "cashless"): {
        "template":     "aditya_birla_cashless.html",
        "header_image": "templates/assets/optimus_header.jpg",
        "stamp_image":  "templates/assets/stamp_image.jpg",
    },
    ("manipalcigna health insurance", "cashless"): {
        "template":     "manipal_cigna.html",
        "header_image": "templates/assets/optimus_header.jpg",
        "stamp_image":  "templates/assets/stamp_image.jpg",
    },
}

# ─────────────────────────────────────────────────────────────────────────────
# DEFAULT
# ─────────────────────────────────────────────────────────────────────────────

DEFAULT_TEMPLATE = {
    "template":     "optimus_general.html",
    "header_image": "templates/assets/optimus_header.jpg",
    "stamp_image":  "templates/assets/stamp_image.jpg",
}
MEDIASSIST_DEFAULT = {
    "template":     "common_mediassist.html",
    "header_image": "templates/assets/mediassist.png",
    "stamp_image":  "templates/assets/stamp_image.jpg",
}

# ─────────────────────────────────────────────────────────────────────────────
# RESOLVER
# ─────────────────────────────────────────────────────────────────────────────

def resolve_template(insurer: str, tpa: str, claim_mode: str, case_data: dict = None) -> dict:
    norm_insurer    = normalize(insurer)
    norm_tpa        = normalize(tpa)
    norm_claim_mode = normalize(claim_mode)
    case_data       = case_data or {}

    # 1. TPA + insurer combo
    if norm_tpa:
        combo_key = (norm_tpa, norm_insurer)
        if combo_key in TPA_INSURER_TEMPLATE_MAP:
            return apply_amount_threshold(TPA_INSURER_TEMPLATE_MAP[combo_key], case_data)
        # Raksha catch-all
        if norm_tpa == "raksha health insurance tpa pvt ltd":
            return apply_amount_threshold(RAKSHA_DEFAULT, case_data)
        if norm_tpa == "medi assist india tpa pvt ltd":
            return apply_amount_threshold(MEDIASSIST_DEFAULT, case_data)

    # 2. Insurer + claim mode combo
    if norm_claim_mode:
        mode_key = (norm_insurer, norm_claim_mode)
        if mode_key in INSURER_CLAIMMODE_TEMPLATE_MAP:
            return apply_amount_threshold(INSURER_CLAIMMODE_TEMPLATE_MAP[mode_key], case_data)

    # 3. Insurer only
    config = INSURER_TEMPLATE_MAP.get(norm_insurer, DEFAULT_TEMPLATE)
    return apply_amount_threshold(config, case_data)

# ─────────────────────────────────────────────────────────────────────────────
# SHARED RENDER HELPERS
# ─────────────────────────────────────────────────────────────────────────────

def _render_html(case_data: dict, config: dict) -> str:
    """Build the fully-rendered HTML string for a case + template config
    (no PDF conversion). Shared by the PDF path and by the formatted-docx
    export, so both outputs come from the exact same markup."""
    hospital      = case_data.get("hospitalDetails", {})          or {}
    critical      = case_data.get("criticalDetails", {})          or {}
    additional    = case_data.get("additionalMedicalDetails", {}) or {}
    billing       = case_data.get("billingDetails", {})           or {}
    investigation = case_data.get("investigationDetails", {})     or {}
    medical_staff = case_data.get("medicalStaff", {})             or {}
    accident      = case_data.get("accidentDetails", {})          or {}
    facts         = case_data.get("pre_extracted_facts", {})      or {}

    conclusion_raw          = case_data.get("conclusion") or ""
    conclusion_html         = format_conclusion_html(conclusion_raw)
    hospital_findings_html  = get_section_html(conclusion_raw, 1)
    member_findings_html    = get_section_html(conclusion_raw, 2)
    overall_findings_html   = get_section_html(conclusion_raw, 3)

    template = env.get_template(config["template"])
    return template.render(
        case            = case_data,
        hospital        = hospital,
        critical        = critical,
        additional      = additional,
        billing         = billing,
        investigation   = investigation,
        medical_staff   = medical_staff,
        accident        = accident,
        facts           = facts,
        header_image    = config.get("header_image", ""),
        stamp_image     = config.get("stamp_image", ""),
        show_stamp      = True,
        conclusion_html = conclusion_html,
        hospital_findings_html = hospital_findings_html,
        member_findings_html   = member_findings_html,
        overall_findings_html  = overall_findings_html,
    )


def _render(case_data: dict, config: dict, output_path: str) -> str:
    try:
        html_content = _render_html(case_data, config)
        HTML(string=html_content, base_url=BASE_DIR).write_pdf(output_path)
        return output_path
    except Exception:
        import traceback
        print(f"PDF GENERATION ERROR: {traceback.format_exc()}")
        raise


def render_case_html(case_data: dict) -> str:
    """
    Return the same fully-rendered HTML the PDF uses, for the formatted-docx
    export — so the Word output matches the PDF's layout/headings/tables.
    """
    config = resolve_template(
        insurer=case_data.get("insurer", ""),
        tpa=case_data.get("tpaName", ""),
        claim_mode=case_data.get("claimMode", ""),
        case_data=case_data,
    )
    return _render_html(case_data, config)

# ─────────────────────────────────────────────────────────────────────────────
# PUBLIC FUNCTIONS
# ─────────────────────────────────────────────────────────────────────────────

def generate_investigation_pdf(case_data: dict) -> str:
    config = resolve_template(
        insurer    = case_data.get("insurer", ""),
        tpa        = case_data.get("tpaName", ""),
        claim_mode = case_data.get("claimMode", ""),
        case_data  = case_data,
    )
    filename_base = get_pdf_filename_base(case_data)
    output = os.path.join(GENERATED_DIR, f"{filename_base}.pdf")
    return _render(case_data, config, output)


def generate_investigation_pdf_edited(case_data: dict) -> str:
    config = resolve_template(
        insurer    = case_data.get("insurer", ""),
        tpa        = case_data.get("tpaName", ""),
        claim_mode = case_data.get("claimMode", ""),
        case_data  = case_data,
    )
    filename_base = get_pdf_filename_base(case_data)
    output = os.path.join(GENERATED_DIR, f"{filename_base}_edited.pdf")
    return _render(case_data, config, output)