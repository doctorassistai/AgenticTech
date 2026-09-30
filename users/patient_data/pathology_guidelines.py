# pathology_guidelines.py — Guideline reference for the Onco-Pathology advisory engines
# ─────────────────────────────────────────────────────────────────────────────
# The single place the `/*/recommendations` engines in onco_pathology.py get their
# guideline attribution from. Pure data and pure functions: no env reads, no I/O,
# no Mongo, no LLM client, no secrets.
#
# WHAT THIS FILE IS
# -----------------
# Citations and structure only. It names WHICH framework applies to a case — which
# CAP Cancer Protocol, which AJCC chapter, which WHO volume, which NCCN guideline,
# which cytology reporting system — and nothing else.
#
# WHAT THIS FILE DELIBERATELY IS NOT
# ----------------------------------
#   • No protocol version strings. "CAP Cancer Protocol - Colon and Rectum", never
#     "v4.2.0.0". A fabricated version in a clinical system is worse than admitting
#     the version is unknown, which is what ADVISORY_SOURCE_VERSION_STATUS does.
#   • No numeric cut-offs, thresholds, scores or reporting criteria. The engines'
#     standing rule — name the guideline a marker is reported against instead of
#     stating a cut-off value — applies to this file too.
#   • No organ-specific diagnostic panel content. It used to live in
#     MICROSCOPY_KNOWLEDGE in onco_pathology.py because a 20B model could not
#     recall it. The three diagnostic engines now run on a larger model that can,
#     so the panel content was removed rather than moved here.
#
# The AJCC 8th Edition references match what the module already commits to in
# TNM_CONFIG (onco_pathology.py) and components/onco-pathology/shared/tnmConfig.js.
#
# Every citation here still needs pathology-department sign-off before clinical
# use; until then each suggestion carries ADVISORY_SOURCE_VERSION_STATUS.
# ─────────────────────────────────────────────────────────────────────────────

from typing import Any, Dict, List, Optional


# The one honest statement about versions, previously repeated as a bare literal
# in every advisory normalizer.
ADVISORY_SOURCE_VERSION_STATUS = "Requires local protocol-version approval"


# ═════════════════════════════════════════════════════════════════════════════
# SITE REGISTRY
# ═════════════════════════════════════════════════════════════════════════════
# Keyed on the sites the module already models. `keywords` is the ONLY keyword
# list in the module — Grossing protocol selection and the three diagnostic
# engines all resolve a site through it.
#
# Order matters: matching walks this dict top-down and takes the first hit, so
# terms shared by two sites (e.g. "segmentectomy", breast and lung) resolve to
# whichever appears first. Breast precedes lung to preserve the behaviour of the
# original GROSSING_PROTOCOL_CATALOG ordering.
#
# `general` is the fallback and must stay last: an unrecognised case gets generic
# attribution, never another site's protocol.

SITE_GUIDELINES = {
    "colorectal": {
        "label": "Colorectal",
        "grossing_protocol_id": "grossing-colorectal-resection",
        "keywords": [
            "colon", "rectum", "rectal", "colorectal", "colectomy", "proctectomy",
            "hemicolectomy", "abdominoperineal", "anterior resection", "sigmoid",
            "caecum", "cecum", "appendix",
        ],
        "cap_protocol": "CAP Cancer Protocol - Colon and Rectum",
        "ajcc": "AJCC Cancer Staging Manual, 8th Edition - Colon and Rectum",
        "who": "WHO Classification of Tumours, 5th Edition - Digestive System Tumours",
        "nccn": "NCCN Clinical Practice Guidelines in Oncology - Colon Cancer / Rectal Cancer",
        "biomarker": [
            "CAP/ASCP/ASCO Guideline - Molecular Biomarkers for the Evaluation of Colorectal Cancer",
        ],
    },
    "breast": {
        "label": "Breast",
        "grossing_protocol_id": "grossing-breast-resection",
        "keywords": [
            "breast", "mammary", "mastectomy", "lumpectomy", "wide local excision",
            "segmentectomy", "sentinel node",
        ],
        "cap_protocol": "CAP Cancer Protocol - Invasive Carcinoma of the Breast",
        "ajcc": "AJCC Cancer Staging Manual, 8th Edition - Breast",
        "who": "WHO Classification of Tumours, 5th Edition - Breast Tumours",
        "nccn": "NCCN Clinical Practice Guidelines in Oncology - Breast Cancer",
        "biomarker": [
            "ASCO/CAP Guideline - Estrogen and Progesterone Receptor Testing in Breast Cancer",
            "ASCO/CAP Guideline - HER2 Testing in Breast Cancer",
        ],
    },
    "lung": {
        "label": "Lung and pleura",
        "grossing_protocol_id": "grossing-lung-resection",
        "keywords": [
            "lung", "pulmonary", "lobectomy", "pneumonectomy", "wedge resection",
            "bronchus", "bronchial", "pleura",
        ],
        "cap_protocol": "CAP Cancer Protocol - Lung",
        "ajcc": "AJCC Cancer Staging Manual, 8th Edition - Lung",
        "who": "WHO Classification of Tumours, 5th Edition - Thoracic Tumours",
        "nccn": "NCCN Clinical Practice Guidelines in Oncology - Non-Small Cell Lung Cancer / Small Cell Lung Cancer",
        "biomarker": [
            "CAP/IASLC/AMP Guideline - Molecular Testing for the Selection of Lung Cancer Patients for Treatment",
        ],
    },
    "prostate": {
        "label": "Prostate",
        "grossing_protocol_id": "grossing-prostate-resection",
        "keywords": ["prostate", "prostatectomy", "seminal vesicle"],
        "cap_protocol": "CAP Cancer Protocol - Prostate Gland",
        "ajcc": "AJCC Cancer Staging Manual, 8th Edition - Prostate",
        "who": "WHO Classification of Tumours, 5th Edition - Urinary and Male Genital Tumours",
        "nccn": "NCCN Clinical Practice Guidelines in Oncology - Prostate Cancer",
        "biomarker": [
            "ISUP/WHO Grade Group system for prostatic carcinoma (Gleason)",
        ],
    },
    "kidney": {
        "label": "Kidney",
        "grossing_protocol_id": "grossing-kidney-resection",
        "keywords": ["kidney", "renal", "nephrectomy", "partial nephrectomy", "ureter"],
        "cap_protocol": "CAP Cancer Protocol - Kidney",
        "ajcc": "AJCC Cancer Staging Manual, 8th Edition - Kidney",
        "who": "WHO Classification of Tumours, 5th Edition - Urinary and Male Genital Tumours",
        "nccn": "NCCN Clinical Practice Guidelines in Oncology - Kidney Cancer",
        "biomarker": [
            "WHO/ISUP nucleolar grading system for renal cell carcinoma",
        ],
    },
    # Fallback. Keep last; `keywords` is empty so it never matches by keyword.
    "general": {
        "label": "General surgical pathology",
        "grossing_protocol_id": "grossing-general-surgical-pathology",
        "keywords": [],
        "cap_protocol": "Applicable CAP Cancer Protocol",
        "ajcc": "Applicable AJCC Cancer Staging Manual chapter, 8th Edition",
        "who": "Applicable WHO Classification of Tumours volume, 5th Edition",
        "nccn": "Applicable NCCN Clinical Practice Guidelines in Oncology",
        "biomarker": [],
    },
}

GENERAL_SITE_KEY = "general"


# ═════════════════════════════════════════════════════════════════════════════
# GROSSING PROTOCOL CATALOG
# ═════════════════════════════════════════════════════════════════════════════
# Moved from onco_pathology.py unchanged except that `keywords` now lives in
# SITE_GUIDELINES instead of being duplicated here. The frontend reads
# protocol_id / display_name / internal_version / source_families
# (GrossingBenchTab.jsx), so those keys and their values are untouched.

GROSSING_PROTOCOL_CATALOG = [
    {
        "protocol_id": "grossing-colorectal-resection",
        "display_name": "Colorectal resection Grossing advisory",
        "internal_version": "1.0.0",
        "source_families": [
            "CAP Cancer Protocols - Colon and Rectum",
            "ICCR Colorectal Cancer Dataset",
            "RCPath colorectal cancer dataset and macroscopic guidance",
        ],
    },
    {
        "protocol_id": "grossing-breast-resection",
        "display_name": "Breast resection Grossing advisory",
        "internal_version": "1.0.0",
        "source_families": [
            "CAP Cancer Protocols - Invasive Carcinoma of the Breast",
            "ICCR Breast Cancer Dataset",
            "RCPath breast cancer dataset and specimen handling guidance",
        ],
    },
    {
        "protocol_id": "grossing-lung-resection",
        "display_name": "Lung resection Grossing advisory",
        "internal_version": "1.0.0",
        "source_families": [
            "CAP Cancer Protocols - Lung",
            "ICCR Lung Cancer Dataset",
            "RCPath lung cancer dataset and specimen handling guidance",
        ],
    },
    {
        "protocol_id": "grossing-prostate-resection",
        "display_name": "Prostate resection Grossing advisory",
        "internal_version": "1.0.0",
        "source_families": [
            "CAP Cancer Protocols - Prostate Gland",
            "ICCR Prostate Cancer Dataset",
            "RCPath prostate cancer dataset and specimen handling guidance",
        ],
    },
    {
        "protocol_id": "grossing-kidney-resection",
        "display_name": "Kidney resection Grossing advisory",
        "internal_version": "1.0.0",
        "source_families": [
            "CAP Cancer Protocols - Kidney",
            "ICCR Renal Tumours Dataset",
            "RCPath renal cancer dataset and specimen handling guidance",
        ],
    },
    {
        "protocol_id": "grossing-general-surgical-pathology",
        "display_name": "General surgical pathology Grossing advisory",
        "internal_version": "1.0.0",
        "source_families": [
            "Applicable CAP Cancer Protocol",
            "Applicable ICCR Cancer Dataset",
            "Applicable RCPath dataset and local validated Grossing SOP",
        ],
    },
]


# ═════════════════════════════════════════════════════════════════════════════
# DIAGNOSTIC-ENGINE FAMILIES
# ═════════════════════════════════════════════════════════════════════════════
# Appended to the resolved site citations by citations_for(). Cross-site reporting
# standards and the local SOP that always applies. The local SOP is last so that
# the normalizers' `source_names[0]` fallback lands on the site's CAP protocol
# rather than on the SOP.

_ENGINE_FAMILIES = {
    "microscopy": [
        "Local validated microscopy and reporting SOP",
    ],
    "molecular": [
        "AMP/ASCO/CAP standards for interpretation and reporting of sequence variants in cancer",
        "Local validated molecular testing and reporting SOP",
    ],
    "cytopathology": [
        "Local validated cytology and ROSE SOP",
    ],
}


# ═════════════════════════════════════════════════════════════════════════════
# CYTOLOGY REPORTING SYSTEMS
# ═════════════════════════════════════════════════════════════════════════════
# PAIRED LIST: components/onco-pathology/shared/cytopathologyModel.js
# (REPORTING_SYSTEM_OPTIONS + DIAGNOSTIC_CATEGORIES). The `categories` below are
# that file's lists verbatim — the two must not drift. Change one, change both.
#
# The Cytopathology engine is asked to recommend a reporting system, so it needs
# to see each system's category set; previously it saw neither. System names and
# category names are structure, not versions or cut-offs.
#
# Order matters: site-specific systems first, "WHO Reporting System" last as the
# broad fallback (empty `applies_to`, so it never matches by keyword).

CYTOLOGY_REPORTING_SYSTEMS = [
    {
        "system": "Bethesda System",
        "scope": "Thyroid fine-needle aspiration",
        "applies_to": ["thyroid", "thyroid nodule"],
        "categories": [
            "Nondiagnostic", "Benign", "Atypia of undetermined significance",
            "Follicular neoplasm", "Suspicious for malignancy", "Malignant",
        ],
    },
    {
        "system": "Paris System",
        "scope": "Urinary tract cytology",
        "applies_to": ["urine", "urinary", "bladder", "urothelial", "ureter", "renal pelvis"],
        "categories": [
            "Non-diagnostic", "Negative for high-grade urothelial carcinoma",
            "Atypical urothelial cells", "Suspicious for high-grade urothelial carcinoma",
            "High-grade urothelial carcinoma", "Other malignancy",
        ],
    },
    {
        "system": "Yokohama System",
        "scope": "Breast fine-needle aspiration",
        "applies_to": ["breast", "mammary"],
        "categories": [
            "Insufficient", "Benign", "Atypical", "Suspicious for malignancy", "Malignant",
        ],
    },
    {
        "system": "Milan System",
        "scope": "Salivary gland fine-needle aspiration",
        "applies_to": ["salivary", "parotid", "submandibular", "sublingual"],
        "categories": [
            "Non-diagnostic", "Non-neoplastic", "Atypia of undetermined significance",
            "Neoplasm: uncertain malignant potential", "Suspicious for malignancy", "Malignant",
        ],
    },
    {
        "system": "TPS / IASLC",
        "scope": "Respiratory and lung cytology",
        "applies_to": ["lung", "bronchial", "bronchoalveolar", "ebus", "sputum", "pulmonary"],
        "categories": [
            "Unsatisfactory", "Negative for malignancy", "Atypical",
            "Suspicious for malignancy", "Malignant",
        ],
    },
    {
        "system": "WHO Reporting System",
        "scope": "Sites without a dedicated system above (e.g. serous effusion, lymph node, pancreatobiliary, soft tissue, liver)",
        "applies_to": [],
        "categories": [
            "Non-diagnostic", "Negative for malignancy", "Atypical",
            "Suspicious for malignancy", "Malignant",
        ],
    },
]


# ═════════════════════════════════════════════════════════════════════════════
# SPREAD PATTERNS AND TREATMENT-EFFECT FRAMEWORKS
# ═════════════════════════════════════════════════════════════════════════════
# Reference for the posture layer in pathology_posture.py. Same constraint as the
# rest of this file: structure and citations only.
#
# `expected_spread_regions` is presented to the pathologist as REFERENCE beside
# the imaging actually on record. Nothing in this module or the posture layer
# compares the two, claims a region was assessed, or recommends an investigation
# — that is a deliberate clinical-governance decision, not an omission.
#
# `treatment_effect_framework` names a regression-grading or treatment-effect
# reporting system. A name only: never a percentage, threshold or grade cut-off.

SITE_SPREAD_PATTERNS = {
    "colorectal": {
        "regional_nodes": "pericolic / perirectal nodes and the named vascular pedicle nodes",
        "direct_extension": [
            "muscularis propria", "pericolic or perirectal fat", "visceral peritoneum",
            "adjacent organs and structures",
        ],
        "common_metastatic_sites": ["liver", "lung", "peritoneum", "non-regional lymph nodes"],
        "expected_spread_regions": ["liver", "chest", "abdomen", "pelvis", "peritoneum"],
        "treatment_effect_framework": "CAP tumour regression grade for rectal carcinoma (modified Ryan scheme)",
    },
    "breast": {
        "regional_nodes": "axillary levels I-III, internal mammary and supraclavicular nodes",
        "direct_extension": ["skin", "nipple", "chest wall", "pectoral muscle"],
        "common_metastatic_sites": ["bone", "liver", "lung", "brain", "non-regional lymph nodes"],
        "expected_spread_regions": ["axilla", "bone", "liver", "chest", "brain"],
        "treatment_effect_framework": "Residual Cancer Burden, with the Miller-Payne and Pinder systems for breast treatment response",
    },
    "lung": {
        "regional_nodes": "intrapulmonary, hilar, mediastinal and supraclavicular nodal stations",
        "direct_extension": [
            "visceral pleura", "chest wall", "mediastinum", "diaphragm", "great vessels",
        ],
        "common_metastatic_sites": ["brain", "bone", "liver", "adrenal gland", "contralateral lung"],
        "expected_spread_regions": ["chest", "brain", "bone", "liver", "adrenal gland"],
        "treatment_effect_framework": "IASLC recommendations for pathological assessment of response to neoadjuvant therapy",
    },
    "prostate": {
        "regional_nodes": "pelvic nodes (obturator, internal and external iliac)",
        "direct_extension": [
            "extraprostatic soft tissue", "seminal vesicles", "bladder neck", "rectum",
        ],
        "common_metastatic_sites": ["bone", "non-regional lymph nodes", "liver", "lung"],
        "expected_spread_regions": ["pelvis", "bone", "abdomen"],
        # Grading after therapy is a framework-applicability point, not a cut-off.
        "treatment_effect_framework": "treatment-effect reporting per the applicable CAP Cancer Protocol; the ISUP/WHO Grade Group is not applied to carcinoma showing treatment effect",
    },
    "kidney": {
        "regional_nodes": "hilar, para-aortic and paracaval nodes",
        "direct_extension": [
            "perinephric fat", "renal sinus", "renal vein", "Gerota fascia", "ipsilateral adrenal gland",
        ],
        "common_metastatic_sites": ["lung", "bone", "liver", "brain", "contralateral kidney"],
        "expected_spread_regions": ["chest", "abdomen", "bone", "brain"],
        "treatment_effect_framework": "treatment-effect reporting per the applicable CAP Cancer Protocol; the WHO/ISUP grade is not applied to carcinoma showing treatment effect",
    },
    "general": {
        "regional_nodes": "the regional nodal basin defined for this site in the applicable CAP Cancer Protocol",
        "direct_extension": [],
        "common_metastatic_sites": [],
        "expected_spread_regions": [],
        "treatment_effect_framework": "treatment-effect reporting per the applicable CAP Cancer Protocol",
    },
}


# Canonical anatomic sites and their synonyms. Used to decide whether a specimen's
# recorded site appears among the radiotherapy plan's target volumes or
# organs-at-risk — both of which are structured, clinician-entered names
# (`targetVolumes[].volumeName`, `organsAtRisk[].organName`), never OCR'd text.
#
# The match is a keyword approximation and the posture layer always reports which
# term matched, so a reader can see the basis and disagree with it.
ANATOMIC_SITE_SYNONYMS = {
    "liver": ["liver", "hepatic", "hepatectomy"],
    "lung": ["lung", "pulmonary", "bronch", "lobectomy", "pneumonectomy"],
    "pleura": ["pleura", "pleural"],
    "breast": ["breast", "mammary", "mastectomy", "lumpectomy"],
    "chest wall": ["chest wall", "thoracic wall"],
    "oesophagus": ["oesophag", "esophag"],
    "stomach": ["stomach", "gastric", "gastrectomy"],
    "pancreas": ["pancreas", "pancreatic", "whipple"],
    "colon": ["colon", "colonic", "sigmoid", "caecum", "cecum", "colectomy"],
    "rectum": ["rectum", "rectal", "mesorectum", "proctectomy"],
    "anus": ["anus", "anal canal"],
    "prostate": ["prostate", "prostatic", "prostatectomy"],
    "bladder": ["bladder", "vesical", "urothelial"],
    "kidney": ["kidney", "renal", "nephrectomy"],
    "adrenal gland": ["adrenal"],
    "uterus": ["uterus", "uterine", "endometri", "cervix", "cervical canal"],
    "ovary": ["ovary", "ovarian", "adnexa"],
    "brain": ["brain", "cerebr", "cranial", "whole brain", "intracranial"],
    "head and neck": ["oral cavity", "tongue", "larynx", "pharyn", "tonsil", "parotid", "salivary"],
    "thyroid": ["thyroid"],
    "bone": ["bone", "osseous", "vertebra", "spine", "spinal", "femur", "rib", "sacrum", "humerus"],
    "lymph node": [
        "lymph node", "nodal", "axilla", "axillary", "supraclavicular", "mediastinal",
        "inguinal", "iliac node", "para-aortic",
    ],
    "peritoneum": ["peritoneum", "peritoneal", "omentum", "omental"],
    "skin": ["skin", "cutaneous", "dermal"],
    "pelvis": ["pelvis", "pelvic"],
    "abdomen": ["abdomen", "abdominal"],
    "heart": ["heart", "cardiac", "myocard"],
    "spinal cord": ["spinal cord", "cord"],
}


# ═════════════════════════════════════════════════════════════════════════════
# RESOLVERS
# ═════════════════════════════════════════════════════════════════════════════


def _searchable(*values: Any) -> str:
    """Flatten mixed values (strings, lists, None) into one lowercase haystack."""
    parts: List[str] = []
    for value in values:
        if value is None:
            continue
        if isinstance(value, (list, tuple, set)):
            parts.extend(str(item) for item in value if item is not None)
        else:
            parts.append(str(value))
    return " ".join(parts).lower()


def resolve_site(*values: Any) -> str:
    """Resolve recorded site / procedure / diagnosis text to a SITE_GUIDELINES key.

    Walks SITE_GUIDELINES in definition order and returns the first keyword hit,
    falling back to `general`. This is the module's only site matcher.
    """
    text = _searchable(*values)
    if text:
        for site_key, entry in SITE_GUIDELINES.items():
            if any(keyword in text for keyword in entry["keywords"]):
                return site_key
    return GENERAL_SITE_KEY


def site_guidelines(site_key: str) -> Dict[str, Any]:
    """The registry entry for a site key, falling back to `general`."""
    return SITE_GUIDELINES.get(site_key) or SITE_GUIDELINES[GENERAL_SITE_KEY]


def citations_for(site_key: str, engine: str) -> List[str]:
    """The allowed source_name list for one diagnostic engine on one site.

    Ordered most specific first: the site's CAP protocol, AJCC chapter, WHO
    volume, NCCN guideline and biomarker frameworks, then the engine's cross-site
    reporting standards, then the local SOP. Deduplicated, order preserved.
    """
    entry = site_guidelines(site_key)
    ordered = [
        entry["cap_protocol"],
        entry["ajcc"],
        entry["who"],
        entry["nccn"],
        *entry.get("biomarker", []),
        *_ENGINE_FAMILIES.get(engine, []),
    ]
    return list(dict.fromkeys(citation for citation in ordered if citation))


def guideline_framework(site_key: str, engine: str) -> Dict[str, Any]:
    """The compact framework block sent to a diagnostic engine's prompt.

    Names the frameworks and says explicitly that versions are withheld, so the
    model cites a framework and never a version or a cut-off.
    """
    entry = site_guidelines(site_key)
    return {
        "resolved_site": entry["label"],
        "site_matched": site_key != GENERAL_SITE_KEY,
        "frameworks": citations_for(site_key, engine),
        "version_status": ADVISORY_SOURCE_VERSION_STATUS,
    }


def select_grossing_protocol(site_key: str) -> Dict[str, Any]:
    """The Grossing protocol catalogue entry for a resolved site key."""
    protocol_id = site_guidelines(site_key)["grossing_protocol_id"]
    for protocol in GROSSING_PROTOCOL_CATALOG:
        if protocol["protocol_id"] == protocol_id:
            return protocol
    return GROSSING_PROTOCOL_CATALOG[-1]


def resolve_cytology_reporting_system(*values: Any) -> Optional[Dict[str, Any]]:
    """The site-specific cytology reporting system for a specimen, or None.

    None means no dedicated system matched — the engine is then told to choose the
    site-appropriate system itself from the full catalogue rather than being
    steered towards a default that may be wrong for the site.
    """
    text = _searchable(*values)
    if not text:
        return None
    for system in CYTOLOGY_REPORTING_SYSTEMS:
        if any(keyword in text for keyword in system["applies_to"]):
            return system
    return None


def spread_pattern_for(site_key: str) -> Dict[str, Any]:
    """The spread pattern and treatment-effect framework for a site key.

    `expected_spread_regions` is reference material shown beside the imaging on
    record. Nothing compares the two or recommends an investigation.
    """
    return SITE_SPREAD_PATTERNS.get(site_key) or SITE_SPREAD_PATTERNS[GENERAL_SITE_KEY]


def canonical_sites(*values: Any) -> List[str]:
    """Canonical anatomic site keys named anywhere in the supplied text.

    Used on both sides of the radiotherapy field question: the specimen's recorded
    site, and the plan's target-volume / organ-at-risk names. Returns [] when
    nothing is recognised, which the posture layer treats as "cannot determine"
    rather than as "no overlap".
    """
    text = _searchable(*values)
    if not text:
        return []
    return [
        site for site, keywords in ANATOMIC_SITE_SYNONYMS.items()
        if any(keyword in text for keyword in keywords)
    ]
