"""
clinical_expertise_skills.py

Composable clinical expertise layer for the pre-treatment assessment system.

Architecture
------------
SPECIALTY SKILL + DISEASE SKILL + TREATMENT SKILL + FACILITY SKILL

The skills are reasoning lenses. They are NOT patient evidence and must never
create, modify, calculate, prescribe, or override patient facts.

This file intentionally contains all skill definitions in one place so that
new specialties, diseases, treatment modalities, and facility capabilities can
be added without changing the generic agent architecture.
"""

from __future__ import annotations

from copy import deepcopy
from typing import Any, Dict, Iterable, List, Optional, Tuple
import re


# ============================================================
# COMMON SAFETY CONTRACT
# ============================================================

SKILL_SAFETY_CONTRACT = {
    "role": "reasoning_lens",
    "rules": [
        "Skills define what deserves deeper inspection; they are not patient evidence.",
        "Never create an undocumented patient fact.",
        "Never replace an authoritative patient value with a skill-derived value.",
        "Never prescribe treatment.",
        "Never select a treatment for the patient.",
        "Never calculate or recommend a dose.",
        "Never infer an undocumented diagnosis, stage, response, toxicity, or treatment.",
        "Never override source hierarchy.",
        "Use only patient information actually supplied in the current context.",
        "If a skill dimension is not supported by supplied patient data, report it as not documented rather than guessing.",
        "Clinical guidelines must come from an explicitly supplied or retrieved evidence source; a skill is not a guideline.",
    ],
}


# ============================================================
# SPECIALTY SKILLS
# ============================================================

SPECIALTY_SKILLS: Dict[str, Dict[str, Any]] = {
    "specialty.radiation_oncology": {
        "id": "specialty.radiation_oncology",
        "type": "specialty",
        "name": "Radiation Oncology",
        "focus": [
            "Disease extent",
            "Primary/nodal/metastatic targets",
            "Previous radiation",
            "Dose/fields",
            "Interval since radiation",
            "Current imaging",
            "Treatment constraints",
            "Potential normal-tissue exposure",
        ],
        "questions": [
            "Radiation indicated?",
            "Definitive/adjuvant/neoadjuvant/palliative?",
            "Target?",
            "Timing?",
            "Previous radiation constraint?",
        ],
        "perspective": (
            "Evaluate the documented patient state from the perspective of "
            "radiation treatment planning, target definition, treatment delivery, "
            "image guidance, safety, response, toxicity, prior radiation exposure, "
            "follow-up, and multidisciplinary coordination."
        ),
        "clinical_domains": {
            "cancer_history": {
                "inspect": [
                    "diagnosis", "histology", "grade", "biomarkers", "stage", "TNM",
                    "recurrence", "metastatic disease", "treatment trajectory",
                ],
                "relationships": [
                    "pathology_to_stage", "imaging_to_stage", "stage_to_radiation_context",
                    "systemic_therapy_to_radiation_context", "surgery_to_radiation_context",
                ],
            },
            "radiation_treatment_intent": {
                "inspect": [
                    "documented treatment intent", "definitive", "adjuvant", "neoadjuvant",
                    "salvage", "consolidative", "palliative", "stereotactic treatment",
                    "reirradiation",
                ],
                "evidence": [
                    "pathology", "imaging", "stage", "surgery", "systemic therapy",
                    "previous radiation",
                ],
            },
            "target_definition": {
                "inspect": [
                    "GTV", "CTV", "ITV", "PTV", "target volume", "target location",
                    "laterality", "treatment site", "target relationship to anatomy",
                ],
            },
            "organ_at_risk_assessment": {
                "inspect": [
                    "organs at risk", "OAR contouring", "anatomical proximity", "dose",
                    "dose-volume information", "documented constraints", "target/OAR relationship",
                ],
            },
            "treatment_planning": {
                "inspect": [
                    "prescription", "fractionation", "technique", "beam energy",
                    "treatment volume", "plan status", "plan revision", "beam arrangement",
                    "immobilization", "simulation information",
                ],
            },
            "dose_and_fractionation": {
                "inspect": [
                    "prescribed dose", "delivered dose", "fractions prescribed",
                    "fractions delivered", "fractions remaining", "fraction schedule",
                    "dose per fraction", "treatment interruptions",
                ],
            },
            "beam_technique": {
                "inspect": [
                    "3D CRT", "IMRT", "VMAT", "SBRT", "SRS", "photons", "electrons",
                    "FFF", "flattened beams", "beam energy", "field information",
                ],
            },
            "IGRT_and_image_fusion": {
                "inspect": [
                    "CBCT", "kV imaging", "MV imaging", "stereotactic imaging", "image fusion",
                    "registration", "positioning", "couch correction", "setup deviation",
                    "simulation reference", "daily image guidance",
                ],
            },
            "DVH_and_plan_quality": {
                "inspect": [
                    "target coverage", "D95", "D98", "D2", "V95", "V100", "OAR Dmax",
                    "OAR Dmean", "Vx parameters", "DVH", "documented constraint comparison",
                    "plan validation", "plan approval status",
                ],
                "instruction": (
                    "Extract documented values and documented reference/constraint information. "
                    "Flag items for clinician/physicist review when evidence supports that need; "
                    "do not independently approve or reject a treatment plan."
                ),
            },
            "adaptive_radiotherapy": {
                "inspect": [
                    "anatomical change", "tumor shrinkage", "weight change", "organ motion",
                    "bladder/rectal filling changes", "treatment response", "replanning",
                    "online adaptation", "offline adaptation",
                ],
            },
            "previous_radiation_and_reirradiation": {
                "inspect": [
                    "previous radiation site", "previous dose", "fractionation", "dates",
                    "previous treatment plan", "previously exposed OARs", "overlapping region",
                    "cumulative dose information", "reirradiation context",
                ],
            },
            "imaging_response": {
                "inspect": [
                    "baseline imaging", "interim imaging", "latest imaging", "lesion measurements",
                    "metabolic response", "response", "progression", "recurrence", "new lesions",
                    "PET/CT", "MRI", "CT", "ultrasound", "mammography where supplied",
                ],
            },
            "pathology_imaging_radiation_correlation": {
                "inspect": [
                    "histology", "grade", "biomarkers", "tumor size", "nodal status", "TNM",
                    "surgery", "margin status", "systemic therapy", "imaging", "current radiation context",
                ],
            },
            "stage_consistency": {
                "inspect": [
                    "cTNM", "pTNM", "rTNM", "stage statements", "pathology/imaging consistency",
                    "documented staging discrepancies",
                ],
            },
            "guideline_evidence_context": {
                "inspect": [
                    "applicable guideline source", "guideline version/date", "evidence source",
                    "documented pathway", "radiation considerations supported by evidence",
                ],
            },
            "toxicity_and_late_effects": {
                "inspect": [
                    "radiation dermatitis", "mucositis", "dysphagia", "xerostomia", "fatigue",
                    "pneumonitis", "neuropathy", "bowel toxicity", "bladder toxicity", "lymphedema",
                    "fibrosis", "endocrine effects", "cardiac exposure/risk", "neurocognitive effects",
                    "acute toxicity", "chronic toxicity", "late effects", "worsening toxicity", "resolved toxicity",
                ],
            },
            "concurrent_systemic_therapy": {
                "inspect": [
                    "chemotherapy", "immunotherapy", "targeted therapy", "hormonal therapy",
                    "radiosensitizers", "treatment timing", "treatment toxicity", "documented sequencing",
                ],
            },
            "treatment_delivery": {
                "inspect": [
                    "fractions delivered", "fractions remaining", "interruptions", "treatment status",
                    "delivery record", "delivered dose", "authorization/status",
                ],
            },
            "quality_assurance": {
                "inspect": [
                    "patient-specific QA", "machine QA", "plan validation", "documented QA status",
                    "plan review", "plan approval",
                ],
            },
            "tumor_board_and_multidisciplinary_context": {
                "inspect": [
                    "diagnosis", "stage", "pathology", "imaging", "previous treatment", "radiation history",
                    "current disease status", "clinical question", "documented multidisciplinary discussion",
                ],
            },
            "follow_up_and_surveillance": {
                "inspect": [
                    "response assessment", "toxicity", "surveillance imaging", "pending imaging",
                    "pending investigations", "follow-up interval", "referrals", "outstanding questions",
                ],
            },
        },
        "safety_contract": SKILL_SAFETY_CONTRACT,
    },

    "specialty.medical_oncology": {
        "id": "specialty.medical_oncology",
        "type": "specialty",
        "name": "Medical Oncology",
        "focus": [
            "Stage",
            "Disease biology",
            "Biomarkers",
            "Molecular profile",
            "Previous systemic treatment",
            "Lines of therapy",
            "Response",
            "Resistance/progression",
            "Organ function",
            "Toxicity",
            "Cumulative exposure",
        ],
        "questions": [
            "Systemic therapy required?",
            "Which treatment strategies need consideration?",
            "Neoadjuvant/adjuvant/metastatic intent?",
            "Previous exposure affecting options?",
            "Biomarker-driven pathway?",
            "Clinical trial?",
        ],
        "perspective": (
            "Evaluate the documented patient state from the perspective of systemic "
            "anticancer therapy, treatment-line history, response, resistance, toxicity, "
            "organ-function monitoring, treatment readiness, molecular evidence, and "
            "longitudinal treatment reconciliation."
        ),
        "clinical_domains": {
            "cancer_characterization": {
                "inspect": [
                    "diagnosis", "histology", "grade", "biomarkers", "molecular profile",
                    "stage", "disease extent", "metastatic sites", "recurrence",
                ],
            },
            "treatment_intent_and_strategy": {
                "inspect": [
                    "treatment intent", "treatment line", "previous lines", "current line",
                    "planned line", "response", "progression", "recurrence", "documented treatment goal",
                ],
            },
            "systemic_therapy": {
                "inspect": [
                    "regimen", "agents", "combination", "cycle", "day", "dose", "route",
                    "schedule", "treatment status", "administration", "treatment duration",
                ],
            },
            "chemotherapy": {
                "inspect": [
                    "cycles", "cumulative exposure", "dose modifications", "delays", "holds",
                    "discontinuation", "response", "toxicity", "administration history",
                ],
            },
            "immunotherapy": {
                "inspect": [
                    "agent", "administration", "response", "immune-related toxicity",
                    "treatment interruption", "treatment status", "documented adverse events",
                ],
            },
            "targeted_therapy": {
                "inspect": [
                    "target", "biomarker", "treatment", "response", "resistance", "toxicity",
                    "treatment status", "documented molecular relationship",
                ],
            },
            "endocrine_therapy": {
                "inspect": [
                    "receptor status", "treatment", "duration", "adherence where documented",
                    "response", "toxicity", "treatment status",
                ],
            },
            "molecular_and_biomarker_context": {
                "inspect": [
                    "genomic results", "biomarkers", "mutations", "alterations", "expression",
                    "resistance findings", "documented actionable findings", "molecular trends",
                ],
            },
            "treatment_response": {
                "inspect": [
                    "baseline", "current", "imaging", "pathology", "biomarkers", "laboratory",
                    "clinical response", "progression", "new disease", "lesion measurements",
                ],
            },
            "toxicity": {
                "inspect": [
                    "hematologic", "renal", "hepatic", "cardiac", "neurologic", "gastrointestinal",
                    "constitutional", "treatment-related events", "severity/grade when documented",
                    "current toxicity", "resolved toxicity", "worsening toxicity",
                ],
            },
            "treatment_readiness": {
                "inspect": [
                    "latest labs", "organ function", "performance status", "toxicity", "infection",
                    "treatment changes", "pending results", "documented readiness concerns",
                ],
            },
            "treatment_reconciliation": {
                "inspect": [
                    "previous regimens", "current regimen", "planned regimen", "dose changes",
                    "treatment line", "response", "reason for documented change", "holds", "delays",
                    "discontinuation", "completion",
                ],
            },
            "supportive_care": {
                "inspect": [
                    "supportive medications", "toxicity management", "symptom management",
                    "hydration", "antiemetic/supportive therapy where documented", "monitoring plans",
                ],
            },
            "follow_up": {
                "inspect": [
                    "next assessment", "pending investigations", "response monitoring", "toxicity monitoring",
                    "surveillance", "follow-up interval", "outstanding questions",
                ],
            },
        },
        "safety_contract": SKILL_SAFETY_CONTRACT,
    },

    "specialty.surgical_oncology": {
        "id": "specialty.surgical_oncology",
        "type": "specialty",
        "name": "Surgical Oncology",
        "focus": [
            "Primary tumour location",
            "Size",
            "Local extension",
            "Invasion",
            "Nodal disease",
            "Resectability",
            "Previous surgery",
            "Margins",
            "Surgical complications",
            "Reconstruction considerations",
        ],
        "questions": [
            "Resectable?",
            "Borderline?",
            "Unresectable?",
            "Surgery now?",
            "Surgery after systemic treatment?",
            "Additional imaging required?",
        ],
        "perspective": (
            "Evaluate the documented patient state from the perspective of surgical "
            "anatomy, pathology, disease extent, prior treatment, operative history, "
            "documented surgical context, perioperative readiness, postoperative course, "
            "and recurrence."
        ),
        "clinical_domains": {
            "diagnosis_and_anatomy": {
                "inspect": [
                    "pathology", "histology", "grade", "tumor location", "tumor size",
                    "multifocality", "multicentricity", "laterality", "local extension",
                ],
            },
            "staging": {
                "inspect": [
                    "clinical stage", "pathological stage", "TNM", "nodal status", "metastatic status",
                    "documented disease extent",
                ],
            },
            "imaging": {
                "inspect": [
                    "CT", "MRI", "PET", "ultrasound", "anatomical relationships",
                    "vascular involvement", "organ involvement", "lesion measurements",
                    "relationship to critical structures",
                ],
            },
            "previous_treatment": {
                "inspect": [
                    "neoadjuvant therapy", "chemotherapy", "immunotherapy", "radiation",
                    "previous surgery", "systemic therapy response", "treatment-related anatomical change",
                ],
            },
            "surgical_context": {
                "inspect": [
                    "surgical procedure", "planned procedure", "operative history", "surgical site",
                    "reconstruction", "margins", "nodal evaluation", "operative findings",
                ],
            },
            "documented_resectability_context": {
                "inspect": [
                    "documented resectability", "anatomical extent", "critical structure relationship",
                    "metastatic extent", "documented surgical feasibility considerations",
                ],
                "instruction": "Report documented information; do not independently declare a tumor resectable or unresectable.",
            },
            "perioperative": {
                "inspect": [
                    "laboratory status", "organ function", "medications", "anticoagulation", "infection",
                    "nutritional status", "performance status", "documented perioperative concerns",
                ],
            },
            "pathology": {
                "inspect": [
                    "margin status", "nodal status", "tumor size", "grade", "treatment response",
                    "residual disease", "lymphovascular invasion", "pathologic findings",
                ],
            },
            "postoperative": {
                "inspect": [
                    "wound", "complications", "pathology", "recovery", "drains", "functional status",
                    "postoperative symptoms", "readmission/ongoing issues when documented",
                ],
            },
            "recurrence": {
                "inspect": [
                    "local recurrence", "regional recurrence", "distant recurrence", "previous surgery",
                    "previous radiation", "current disease status",
                ],
            },
            "follow_up": {
                "inspect": [
                    "pathology review", "recovery", "pending investigations", "surveillance imaging",
                    "functional outcomes", "outstanding surgical questions",
                ],
            },
        },
        "safety_contract": SKILL_SAFETY_CONTRACT,
    },
    "specialty.radiology": {
        "id": "specialty.radiology",
        "type": "specialty",
        "name": "Radiology",
        "focus": [
            "Imaging findings",
            "Disease distribution",
            "Measurements",
            "Nodes",
            "Metastases",
            "Response/progression",
            "Comparison with previous imaging",
            "Uncertain findings",
        ],
        "questions": [],
        "perspective": (
            "Verify and characterize the documented imaging state, including "
            "findings, disease distribution, measurements, nodes, metastases, "
            "response or progression, comparison with previous imaging, and uncertain findings."
        ),
        "clinical_domains": {
            "imaging_verification": {
                "inspect": [
                    "imaging findings",
                    "disease distribution",
                    "measurements",
                    "nodes",
                    "metastases",
                    "response/progression",
                    "comparison with previous imaging",
                    "uncertain findings",
                ],
            },
        },
        "safety_contract": SKILL_SAFETY_CONTRACT,
    },
}


# ============================================================
# DISEASE SKILLS
# ============================================================

# The breast cancer skill is intentionally detailed because it is the disease
# example used in the architecture discussion. The other disease definitions
# provide extensible structures without pretending to supply disease-specific
# clinical rules that were not defined in the source discussion.

BREAST_CANCER_SKILL = {
    "id": "disease.breast_cancer",
    "type": "disease",
    "name": "Breast Cancer",
    "perspective": "Organize breast-cancer-specific clinical dimensions for deeper inspection by the active specialty and treatment skills.",
    "domains": {
        "disease_characterization": {
            "inspect": [
                "laterality", "histology", "grade", "tumor size", "tumor location",
                "multifocality", "multicentricity",
            ]
        },
        "biomarkers": {
            "inspect": ["ER", "PR", "HER2", "Ki67", "molecular subtype"]
        },
        "nodal_disease": {
            "inspect": [
                "axillary nodes", "sentinel nodes", "internal mammary nodes", "supraclavicular nodes"
            ]
        },
        "imaging": {
            "inspect": [
                "mammography", "ultrasound", "breast MRI", "PET/CT", "CT", "lesion measurements"
            ]
        },
        "pathology": {
            "inspect": [
                "invasive component", "DCIS", "grade", "lymphovascular invasion", "margins", "nodal status"
            ]
        },
        "systemic_treatment": {
            "inspect": [
                "neoadjuvant", "adjuvant", "endocrine", "HER2-targeted", "chemotherapy", "immunotherapy"
            ]
        },
        "surgery": {
            "inspect": [
                "lumpectomy", "mastectomy", "sentinel node", "axillary dissection", "reconstruction"
            ]
        },
        "response": {
            "inspect": [
                "baseline tumor", "post-treatment tumor", "pathological response", "imaging response"
            ]
        },
        "radiation": {
            "inspect": [
                "breast", "chest wall", "regional nodes", "treatment sequence", "previous radiation"
            ]
        },
        "recurrence": {
            "inspect": ["local", "regional", "distant"]
        },
    },
    "safety_contract": SKILL_SAFETY_CONTRACT,
}


# These are deliberately structural disease lenses. Add depth here as your
# validated disease-specific requirements are defined; do not silently inventtttt
# rules or thresholds.
DISEASE_SKILLS: Dict[str, Dict[str, Any]] = {
    "disease.breast_cancer": BREAST_CANCER_SKILL,
    "disease.lung_cancer": {
        "id": "disease.lung_cancer",
        "type": "disease",
        "name": "Lung Cancer",
        "perspective": "Organize lung-cancer-specific disease, thoracic anatomy, pathology, staging, imaging, systemic-treatment and radiation/surgical context for deeper inspection.",
        "domains": {
            "disease_characterization": {"inspect": ["histology", "grade", "laterality", "primary site", "tumor size", "disease extent"]},
            "staging": {"inspect": ["clinical stage", "pathological stage", "TNM", "nodal disease", "metastatic disease"]},
            "imaging": {"inspect": ["CT", "PET/CT", "MRI where supplied", "lesion measurements", "nodal findings", "metastatic findings"]},
            "pathology_and_biomarkers": {"inspect": ["histology", "molecular findings", "biomarkers", "pathology response"]},
            "thoracic_context": {"inspect": ["lung findings", "mediastinal findings", "airway relationship", "vascular/critical structure relationship"]},
            "treatment_context": {"inspect": ["surgery", "chemotherapy", "immunotherapy", "targeted therapy", "radiation", "response"]},
            "recurrence_and_response": {"inspect": ["local", "regional", "distant", "baseline versus current imaging"]},
        },
        "safety_contract": SKILL_SAFETY_CONTRACT,
    },
    "disease.colorectal_cancer": {
        "id": "disease.colorectal_cancer",
        "type": "disease",
        "name": "Colorectal Cancer",
        "perspective": "Organize colorectal-cancer-specific pathology, anatomy, staging, imaging, surgical and systemic-treatment context for deeper inspection.",
        "domains": {
            "disease_characterization": {"inspect": ["primary site", "histology", "grade", "tumor size", "disease extent"]},
            "staging": {"inspect": ["clinical stage", "pathological stage", "TNM", "nodal status", "metastatic status"]},
            "imaging": {"inspect": ["CT", "MRI", "PET/CT where supplied", "lesion measurements", "local extension", "metastatic findings"]},
            "pathology": {"inspect": ["histology", "grade", "margins", "nodes", "lymphovascular invasion", "treatment response"]},
            "surgery": {"inspect": ["resection", "operative findings", "margins", "anastomosis/operative status where documented"]},
            "systemic_treatment": {"inspect": ["chemotherapy", "targeted therapy", "immunotherapy", "response", "toxicity"]},
            "radiation": {"inspect": ["pelvic/other treatment site where documented", "treatment sequence", "previous radiation"]},
        },
        "safety_contract": SKILL_SAFETY_CONTRACT,
    },
    "disease.prostate_cancer": {
        "id": "disease.prostate_cancer",
        "type": "disease",
        "name": "Prostate Cancer",
        "perspective": "Organize prostate-cancer-specific disease, pathology, imaging, PSA/biomarker, staging, radiation, systemic and surgical context for deeper inspection.",
        "domains": {
            "disease_characterization": {"inspect": ["histology", "grade", "tumor extent", "risk/stage information as documented"]},
            "biomarkers": {"inspect": ["PSA", "other documented biomarkers", "molecular findings"]},
            "staging": {"inspect": ["clinical stage", "pathological stage", "TNM", "nodal disease", "metastatic disease"]},
            "imaging": {"inspect": ["MRI", "PET/CT where supplied", "CT", "bone/metastatic findings where documented"]},
            "surgery": {"inspect": ["prostatectomy", "lymph-node evaluation", "margin status", "postoperative findings"]},
            "radiation": {"inspect": ["treatment site", "target information", "OAR information", "dose/fractionation", "image guidance"]},
            "systemic_treatment": {"inspect": ["androgen-directed/endocrine therapy", "chemotherapy", "targeted therapy", "immunotherapy where documented"]},
            "response_and_recurrence": {"inspect": ["PSA trend", "imaging response", "biochemical recurrence", "local/regional/distant disease"]},
        },
        "safety_contract": SKILL_SAFETY_CONTRACT,
    },
    "esophageal_cancer": {
        "id": "esophageal_cancer",
        "name": "Esophageal Cancer",
        "type": "disease",
        "description": "Disease-specific clinical reasoning framework for esophageal malignancies.",
        "focus": [
            {
                "name": "Disease Characterization",
                "description": "Assess the documented characteristics of the disease."
            },
            {
                "name": "Pathology",
                "description": "Assess documented histopathology and relevant pathological findings."
            },
            {
                "name": "Anatomic Disease Extent",
                "description": "Assess documented primary tumor location and extent."
            },
            {
                "name": "Stage",
                "description": "Assess available staging evidence relevant to management."
            },
            {
                "name": "Regional Disease",
                "description": "Assess documented regional disease when available."
            },
            {
                "name": "Distant Disease",
                "description": "Assess documented distant disease when available."
            },
            {
                "name": "Treatment Planning",
                "description": "Assess treatment planning considerations based on the documented disease state."
            },
            {
                "name": "Treatment Response",
                "description": "Assess documented treatment response when prior treatment exists."
            },
            {
                "name": "Progression",
                "description": "Assess documented progression when supported by current evidence."
            },
            {
                "name": "Treatment Toxicity",
                "description": "Assess documented treatment-related toxicity when treatment exposure exists."
            },
            {
                "name": "Monitoring",
                "description": "Assess clinically relevant monitoring based on the current documented state."
            }
        ],
        "assessment_instruction": (
            "Use this disease-specific framework together with the active "
            "specialty skill. Select only dimensions supported by the "
            "current visit and available evidence."
        )
    }
}


# ============================================================
# TREATMENT / MODALITY SKILLS
# ============================================================

TREATMENT_SKILLS: Dict[str, Dict[str, Any]] = {
    "treatment.radiation_therapy": {
        "id": "treatment.radiation_therapy",
        "type": "treatment",
        "name": "Radiation Therapy",
        "domains": {
            "simulation": {"inspect": ["simulation", "immobilization", "CT simulation", "positioning"]},
            "planning": {"inspect": ["target volumes", "OAR", "prescription", "fractionation", "technique", "plan status"]},
            "delivery": {"inspect": ["machine", "energy", "modality", "fractions", "delivered dose", "treatment status"]},
            "image_guidance": {"inspect": ["imaging", "registration", "setup", "corrections", "CBCT", "stereotactic imaging"]},
            "response": {"inspect": ["interval imaging", "disease change", "anatomical change", "treatment response"]},
            "safety": {"inspect": ["QA", "treatment interruptions", "toxicity", "previous radiation"]},
        },
        "safety_contract": SKILL_SAFETY_CONTRACT,
    },
    "treatment.chemotherapy": {
        "id": "treatment.chemotherapy",
        "type": "treatment",
        "name": "Chemotherapy",
        "domains": {
            "regimen": {"inspect": ["regimen", "agents", "combination", "cycle", "day", "route", "schedule"]},
            "dose_and_exposure": {"inspect": ["documented dose", "dose unit", "administration", "cumulative exposure", "documented modifications"]},
            "treatment_course": {"inspect": ["cycles completed", "cycles remaining", "delays", "holds", "interruptions", "discontinuation"]},
            "readiness": {"inspect": ["latest labs", "organ function", "performance status", "infection", "toxicity", "pending results"]},
            "toxicity": {"inspect": ["hematologic", "renal", "hepatic", "cardiac", "neurologic", "gastrointestinal", "constitutional"]},
            "response": {"inspect": ["baseline", "interim", "latest", "imaging", "pathology", "biomarkers", "clinical response", "progression"]},
            "supportive_care": {"inspect": ["supportive medications", "toxicity management", "symptom management"]},
        },
        "safety_contract": SKILL_SAFETY_CONTRACT,
    },
    "treatment.immunotherapy": {
        "id": "treatment.immunotherapy",
        "type": "treatment",
        "name": "Immunotherapy",
        "domains": {
            "agent_and_schedule": {"inspect": ["agent", "dose as documented", "route", "schedule", "cycle", "treatment status"]},
            "response": {"inspect": ["baseline", "current imaging", "clinical response", "progression", "new disease"]},
            "immune_related_toxicity": {"inspect": ["documented immune-related adverse events", "organ-specific toxicity", "severity/grade when documented", "management"]},
            "treatment_changes": {"inspect": ["hold", "delay", "interruption", "discontinuation", "documented reason"]},
            "monitoring": {"inspect": ["laboratory monitoring", "organ function", "pending investigations"]},
        },
        "safety_contract": SKILL_SAFETY_CONTRACT,
    },
    "treatment.targeted_therapy": {
        "id": "treatment.targeted_therapy",
        "type": "treatment",
        "name": "Targeted Therapy",
        "domains": {
            "molecular_relationship": {"inspect": ["target", "biomarker", "mutation", "alteration", "expression"]},
            "treatment": {"inspect": ["agent", "dose as documented", "route", "schedule", "cycle", "status"]},
            "response_and_resistance": {"inspect": ["response", "progression", "resistance findings", "new molecular findings"]},
            "toxicity": {"inspect": ["documented adverse events", "organ-specific toxicity", "treatment-related changes"]},
            "treatment_changes": {"inspect": ["dose modification", "hold", "delay", "discontinuation", "documented reason"]},
        },
        "safety_contract": SKILL_SAFETY_CONTRACT,
    },
    "treatment.endocrine_therapy": {
        "id": "treatment.endocrine_therapy",
        "type": "treatment",
        "name": "Endocrine Therapy",
        "domains": {
            "biomarker_relationship": {"inspect": ["receptor status", "documented biomarker relationship"]},
            "treatment_course": {"inspect": ["agent", "route", "schedule", "duration", "status", "adherence where documented"]},
            "response": {"inspect": ["clinical response", "imaging response", "biomarker response", "progression"]},
            "toxicity": {"inspect": ["documented adverse effects", "treatment-related symptoms", "treatment changes"]},
        },
        "safety_contract": SKILL_SAFETY_CONTRACT,
    },
    "treatment.surgery": {
        "id": "treatment.surgery",
        "type": "treatment",
        "name": "Surgery",
        "domains": {
            "preoperative": {"inspect": ["laboratory status", "organ function", "medications", "anticoagulation", "infection", "nutrition", "performance status"]},
            "procedure": {"inspect": ["procedure", "site", "laterality", "operative plan", "documented surgical objective"]},
            "operative_course": {"inspect": ["operative findings", "complications", "reconstruction", "drains", "estimated blood loss where documented"]},
            "pathology": {"inspect": ["tumor size", "histology", "grade", "margins", "nodes", "residual disease", "treatment response"]},
            "postoperative": {"inspect": ["wound", "complications", "recovery", "functional status", "pending pathology/investigations"]},
            "follow_up": {"inspect": ["surveillance", "recurrence", "functional outcomes", "outstanding surgical issues"]},
        },
        "safety_contract": SKILL_SAFETY_CONTRACT,
    },
    "treatment.combination_systemic_therapy": {
        "id": "treatment.combination_systemic_therapy",
        "type": "treatment",
        "name": "Combination Systemic Therapy",
        "domains": {
            "regimen": {"inspect": ["agents", "combination", "cycle", "day", "route", "schedule", "documented dose"]},
            "sequencing": {"inspect": ["treatment line", "previous therapy", "current therapy", "planned therapy", "documented transitions"]},
            "toxicity": {"inspect": ["documented treatment-related toxicity", "organ function", "laboratory monitoring"]},
            "response": {"inspect": ["imaging", "pathology", "biomarkers", "clinical response", "progression"]},
            "reconciliation": {"inspect": ["previous regimen", "current regimen", "planned regimen", "holds", "delays", "discontinuation"]},
        },
        "safety_contract": SKILL_SAFETY_CONTRACT,
    },
}


# ============================================================
# FACILITY SKILLS
# ============================================================

FACILITY_SKILLS: Dict[str, Dict[str, Any]] = {
    "facility.panacea_radiation": {
        "id": "facility.panacea_radiation",
        "type": "facility",
        "name": "Panacea Radiation Facility Capability",
        "description": (
            "Facility/equipment capability context derived from the supplied Panacea Medical Technologies "
            "radiation-system description. This is capability metadata, not a patient-specific treatment rule."
        ),
        "linac": {
            "salient_features": [
                "Dual Energy Linac",
                "6 and 9/10 MV photon capability as documented",
                "Dual modality: photons and electrons",
                "Ring gantry system",
                "150 cm bore dimension",
                "Robotic couch with 6 degrees of freedom",
                "In-gantry stereotactic imaging system for patient positioning",
                "Dynamic 72 leaf pairs of MLC",
                "Krystal Record and Verification System",
                "Four-step treatment delivery workflow as documented",
                "3D CRT",
                "IMRT",
                "VMAT",
                "SBRT",
                "SRS",
                "Surface Guided Radiotherapy (SGRT)",
                "Deep Inspiration Breath Hold (DIBH)",
                "Adaptive Radiotherapy",
                "Autonomous Patient Specific QA",
                "Autonomous Daily QA",
            ],
            "electron_beam_energy": ["6 MeV", "9 MeV", "10 MeV"],
            "photon_beam_energy": ["6 MV", "9 MV", "10 MV"],
            "imaging": ["CBCT", "stereotactic imaging", "dual kV imaging techniques as documented"],
            "mlc": {
                "leaf_pairs": 72,
                "type": "Tertiary",
                "leaf_width_at_isocenter": "3 mm central field / 5 mm outer field as documented",
                "minimum_definable_field_size": "0.5 cm x 0.5 cm",
                "maximum_field_size": "30 cm x 30 cm",
                "average_leaf_transmission": "< 0.1%",
                "maximum_interleaf_leakage": "< 2.5%",
                "maximum_leaf_speed": "up to 3 cm/sec",
                "readout_resolution": "0.1 mm",
                "penumbra": "< 6 mm",
                "rotational_accuracy": "< 0.5°",
            },
            "gantry": {
                "type": "Ring gantry",
                "minimum_speed": "0.9°/sec",
                "maximum_speed": "6.9°/sec",
                "rotational_accuracy": "≤ 0.2 degrees",
                "rotational_range": "±180°",
                "bore_diameter": "150 cm (100 cm at MLC side as documented)",
            },
            "six_d_couch": {
                "top": "Carbon fiber",
                "length": "284 cm",
                "width": "51.2 cm",
                "maximum_load": "185 kg",
                "vertical_range": "60 cm",
                "longitudinal_range": "157.5 cm",
                "lateral_range": "±15 cm",
                "couch_theta_range": "±30°",
                "roll": "±2.5°",
            },
            "isocenter": {
                "target_to_isocentre": "100 cm",
                "floor_to_isocentre": "120 cm",
                "gantry_and_collimator_accuracy": "≤1 mm radius",
                "collimator_and_couch_accuracy": "≤1 mm radius",
            },
            "beam_quality_data": {
                "flattened_photons": {
                    "6 MV": {
                        "dmax": "1.5 ± 0.2 cm",
                        "dose_at_10cm": "67.5 ± 2%",
                    },
                    "9 MV": {
                        "dmax": "2.3 ± 0.2 cm",
                        "dose_at_10cm": "73.0% ± 2%",
                    },
                    "10 MV": {
                        "dmax": "2.3 ± 0.2 cm",
                        "dose_at_10cm": "73.0% ± 2%",
                    },
                    "common_documented_parameters": {
                        "flatness": "±3%",
                        "symmetry": "<2%",
                        "penumbra": "≤6 mm",
                        "maximum_dose_rate_with_large_flattening_filter": "650/800/600 MU/min as documented",
                        "maximum_dose_rate_with_small_flattening_filter": "1200/1650 MU/min as documented",
                    },
                },
                "fff_photons": {
                    "6 MV FFF": {
                        "dmax": "1.24 ± 0.2 cm",
                        "dose_at_10cm": "64 ± 2%",
                    },
                    "9 MV FFF": {
                        "dmax": "2.1 ± 0.2 cm",
                        "dose_at_10cm": "71.1 ± 2%",
                    },
                    "10 MV FFF": {
                        "dmax": "2.1 ± 0.2 cm",
                        "dose_at_10cm": "71.1 ± 2%",
                    },
                    "common_documented_parameters": {
                        "symmetry": "<1%",
                        "penumbra": "≤6 mm",
                        "minimum_dose_rate": "50 MU/min",
                        "maximum_dose_rate": "800 / 2000 / 2250 MU/min as documented",
                    },
                },
                "electron_dose_rate": {
                    "6 MeV": "up to 1000 MU/min",
                    "9 MeV": "up to 1000 MU/min",
                    "10 MeV": "up to 1000 MU/min",
                },
            },
        },
        "krystal_rois": {
            "name": "KRYSTAL ROIS",
            "description": "Online Record & Verification / Radiation Oncology Information System capability as documented.",
            "capabilities": [
                "patient demographics registration",
                "patient treatment list and progress",
                "HIS demographic population as documented",
                "prescription templates",
                "imaging-cycle configuration",
                "treatment-technique configuration",
                "disease-specific clinical protocol templates as a facility software capability",
                "multiple energy and multi-modality support",
                "OAR constraints entry",
                "beam accessories",
                "patient immobilization and positioning fields",
                "plan review and approval",
                "gantry/MLC/dose/machine parameter validation",
                "plan simulation",
                "dose delivered monitoring",
                "image acquisition and plan revision visualization",
                "MLC field shaping and playback",
                "electronic authorization",
                "appointment scheduling",
                "fraction tracking",
                "vitals display",
                "toxicity display",
                "treatment review",
                "automatic/manual registration",
                "2D-2D registration",
                "3D-3D registration",
                "stereoscopic review",
                "CBCT reconstructed slice review",
                "DICOM RT and DICOM 3.0 compatibility as documented",
                "integration with therapy machines as documented",
            ],
        },
        "safety_contract": SKILL_SAFETY_CONTRACT,
    },
}


# ============================================================
# EXACT, CONFIGURATION-LEVEL ID RESOLUTION
# ============================================================

# These are routing metadata mappings, not clinical keyword rules.
# Prefer explicit *_skill_id fields from MongoDB whenever available.

SPECIALTY_ALIASES = {
    "radiation oncology": "specialty.radiation_oncology",
    "radiation oncologist": "specialty.radiation_oncology",
    "medical oncology": "specialty.medical_oncology",
    "medical oncologist": "specialty.medical_oncology",
    "surgical oncology": "specialty.surgical_oncology",
    "surgical oncologist": "specialty.surgical_oncology",
    "radiology": "specialty.radiology",
    "radiologist": "specialty.radiology",
}

DISEASE_ALIASES = {
    "breast cancer": "disease.breast_cancer",
    "breast carcinoma": "disease.breast_cancer",
    "carcinoma of breast": "disease.breast_cancer",
    "lung cancer": "disease.lung_cancer",
    "lung carcinoma": "disease.lung_cancer",
    "colorectal cancer": "disease.colorectal_cancer",
    "colorectal carcinoma": "disease.colorectal_cancer",
    "colon cancer": "disease.colorectal_cancer",
    "prostate cancer": "disease.prostate_cancer",
    "prostate carcinoma": "disease.prostate_cancer",
}

TREATMENT_ALIASES = {
    "radiation therapy": "treatment.radiation_therapy",
    "radiotherapy": "treatment.radiation_therapy",
    "radiation": "treatment.radiation_therapy",
    "chemotherapy": "treatment.chemotherapy",
    "chemo": "treatment.chemotherapy",
    "immunotherapy": "treatment.immunotherapy",
    "targeted therapy": "treatment.targeted_therapy",
    "targeted treatment": "treatment.targeted_therapy",
    "endocrine therapy": "treatment.endocrine_therapy",
    "hormonal therapy": "treatment.endocrine_therapy",
    "surgery": "treatment.surgery",
    "operative treatment": "treatment.surgery",
    "combination systemic therapy": "treatment.combination_systemic_therapy",
}

FACILITY_ALIASES = {
    "panacea radiation facility": "facility.panacea_radiation",
    "panacea radiation": "facility.panacea_radiation",
    "panacea medical technologies radiation": "facility.panacea_radiation",
}


def _normalize_identity(value: Any) -> str:
    if value is None:
        return ""
    value = str(value).strip().lower()
    value = re.sub(r"[\u2010-\u2015\-_/]+", " ", value)
    value = re.sub(r"\s+", " ", value)
    return value


def _walk_dicts(value: Any) -> Iterable[Dict[str, Any]]:
    if isinstance(value, dict):
        yield value
        for child in value.values():
            yield from _walk_dicts(child)
    elif isinstance(value, list):
        for child in value:
            yield from _walk_dicts(child)


def _first_explicit_skill_id(data: Any, keys: Tuple[str, ...]) -> Optional[str]:
    for obj in _walk_dicts(data):
        for key in keys:
            value = obj.get(key)
            if isinstance(value, str) and value.strip():
                return value.strip()
    return None


def _first_identity(data: Any, keys: Tuple[str, ...]) -> Optional[str]:
    for obj in _walk_dicts(data):
        for key in keys:
            value = obj.get(key)
            if isinstance(value, str) and value.strip():
                return value.strip()
    return None


def _resolve_exact(
    explicit_skill_id: Optional[str],
    identity: Optional[str],
    aliases: Dict[str, str],
    registry: Dict[str, Dict[str, Any]],
) -> Tuple[Optional[Dict[str, Any]], str]:
    if explicit_skill_id and explicit_skill_id in registry:
        return deepcopy(registry[explicit_skill_id]), "explicit_skill_id"

    normalized = _normalize_identity(identity)
    skill_id = aliases.get(normalized)
    if skill_id and skill_id in registry:
        return deepcopy(registry[skill_id]), "exact_configured_identity"

    return None, "not_resolved"


def resolve_specialty_skill(doctor_data: Any) -> Tuple[Optional[Dict[str, Any]], str]:
    explicit = _first_explicit_skill_id(
        doctor_data,
        ("specialty_skill_id", "expertise_skill_id"),
    )
    identity = _first_identity(
        doctor_data,
        ("specialty", "specialization", "speciality", "doctor_specialty"),
    )
    return _resolve_exact(explicit, identity, SPECIALTY_ALIASES, SPECIALTY_SKILLS)


def resolve_disease_skills(context: Any) -> List[Tuple[Dict[str, Any], str]]:
    found: List[Tuple[Dict[str, Any], str]] = []
    seen = set()

    for obj in _walk_dicts(context):
        explicit = obj.get("disease_skill_id") or obj.get("cancer_skill_id")
        identity = (
            obj.get("disease")
            or obj.get("disease_name")
            or obj.get("cancer_type")
            or obj.get("cancer")
            or obj.get("primary_diagnosis")
        )

        if isinstance(identity, dict):
            identity = identity.get("name") or identity.get("label")

        skill, source = _resolve_exact(
            explicit,
            identity,
            DISEASE_ALIASES,
            DISEASE_SKILLS,
        )
        if skill and skill["id"] not in seen:
            found.append((skill, source))
            seen.add(skill["id"])

    return found


def resolve_treatment_skills(context: Any) -> List[Tuple[Dict[str, Any], str]]:
    found: List[Tuple[Dict[str, Any], str]] = []
    seen = set()

    for obj in _walk_dicts(context):
        explicit = obj.get("treatment_skill_id") or obj.get("modality_skill_id")
        identity = (
            obj.get("treatment_type")
            or obj.get("treatment_modality")
            or obj.get("modality")
            or obj.get("therapy_type")
        )

        if isinstance(identity, dict):
            identity = identity.get("name") or identity.get("type")

        skill, source = _resolve_exact(
            explicit,
            identity,
            TREATMENT_ALIASES,
            TREATMENT_SKILLS,
        )
        if skill and skill["id"] not in seen:
            found.append((skill, source))
            seen.add(skill["id"])

    return found


def resolve_facility_skills(context: Any) -> List[Tuple[Dict[str, Any], str]]:
    found: List[Tuple[Dict[str, Any], str]] = []
    seen = set()

    for obj in _walk_dicts(context):
        explicit = obj.get("facility_skill_id") or obj.get("facility_capability_skill_id")
        identity = obj.get("facility_name") or obj.get("facility")

        if isinstance(identity, dict):
            identity = identity.get("name") or identity.get("facility_name")

        skill, source = _resolve_exact(
            explicit,
            identity,
            FACILITY_ALIASES,
            FACILITY_SKILLS,
        )
        if skill and skill["id"] not in seen:
            found.append((skill, source))
            seen.add(skill["id"])

    return found


# ============================================================
# PUBLIC SKILL CONTEXT BUILDER
# ============================================================

def build_expertise_context(clinical_context: Dict[str, Any]) -> Dict[str, Any]:
    """
    Resolve composable expertise lenses from structured routing metadata.

    Preferred metadata:
      doctor_context.data.specialty_skill_id
      patient/current context disease_skill_id
      patient/current context treatment_skill_id
      patient/current context facility_skill_id

    Exact configured identities are supported as a convenience fallback.
    No substring/keyword matching is performed.
    """

    doctor_context = clinical_context.get("doctor_context", {})
    doctor_data = (
        doctor_context.get("data", {})
        if isinstance(doctor_context, dict)
        else {}
    )

    specialty_skill, specialty_source = resolve_specialty_skill(doctor_data)

    disease_matches = resolve_disease_skills(clinical_context)
    treatment_matches = resolve_treatment_skills(clinical_context)
    facility_matches = resolve_facility_skills(clinical_context)

    specialty_name = None
    if specialty_skill:
        specialty_name = specialty_skill.get("name")
    else:
        specialty_name = _first_identity(
            doctor_data,
            ("specialty", "specialization", "speciality", "doctor_specialty"),
        )

    return {
        "version": "1.0",
        "selection_policy": {
            "composition": "specialty + disease + treatment + facility",
            "matching": "explicit skill id preferred; exact configured identity fallback",
            "keyword_matching": False,
            "skills_are_patient_evidence": False,
        },
        "safety_contract": SKILL_SAFETY_CONTRACT,
        "doctor_specialty": specialty_name,
        "specialty_skill": specialty_skill,
        "specialty_resolution_source": specialty_source,
        "disease_skills": [skill for skill, _ in disease_matches],
        "disease_resolution": [source for _, source in disease_matches],
        "treatment_skills": [skill for skill, _ in treatment_matches],
        "treatment_resolution": [source for _, source in treatment_matches],
        "facility_skills": [skill for skill, _ in facility_matches],
        "facility_resolution": [source for _, source in facility_matches],
    }


def render_expertise_instructions(expertise_context: Dict[str, Any]) -> str:
    """
    Produce a prompt section for the Planner and downstream agents.
    The skills remain structured JSON in the user payload as well; this
    textual section gives the model explicit operating instructions.
    """

    specialty = expertise_context.get("specialty_skill") or {}
    diseases = expertise_context.get("disease_skills") or []
    treatments = expertise_context.get("treatment_skills") or []
    facilities = expertise_context.get("facility_skills") or []

    lines: List[str] = [
        "EXPERTISE LAYER",
        "The following are composable expertise lenses, not patient evidence.",
        "Use them to determine which dimensions of the supplied patient context deserve deeper inspection.",
        "Never turn a skill instruction into an undocumented patient fact or treatment decision.",
        "Preserve authoritative patient values exactly as documented.",
        "If a dimension is not supported by the supplied patient context, say it is not documented in the supplied context.",
        "",
    ]

    if specialty:
        lines.extend([
            f"SPECIALTY LENS: {specialty.get('name', specialty.get('id', 'Unknown'))}",
            str(specialty.get("perspective", "")),
        ])

        focus = specialty.get("focus") or []
        if focus:
            lines.append("SPECIALTY FOCUS:")
            lines.extend([f"- {item}" for item in focus])

        questions = specialty.get("questions") or []
        if questions:
            lines.append("SPECIALTY CLINICAL QUESTIONS:")
            lines.extend([f"- {item}" for item in questions])

    if diseases:
        lines.append("DISEASE LENSES:")
        for disease in diseases:
            lines.append(f"- {disease.get('name', disease.get('id', 'Unknown'))}")
            lines.append(str(disease.get("perspective", "")))

    if treatments:
        lines.append("TREATMENT / MODALITY LENSES:")
        for treatment in treatments:
            lines.append(f"- {treatment.get('name', treatment.get('id', 'Unknown'))}")

    if facilities:
        lines.append("FACILITY CAPABILITY LENSES:")
        for facility in facilities:
            lines.append(f"- {facility.get('name', facility.get('id', 'Unknown'))}")

    return "\n".join(lines)


__all__ = [
    "SPECIALTY_SKILLS",
    "DISEASE_SKILLS",
    "TREATMENT_SKILLS",
    "FACILITY_SKILLS",
    "build_expertise_context",
    "render_expertise_instructions",
]
