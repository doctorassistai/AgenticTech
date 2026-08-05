import json
import logging
import re
from typing import Optional, Dict, List, Any, Literal
from typing_extensions import TypedDict, NotRequired
from datetime import datetime

from groq import Groq
from langgraph.graph import StateGraph, END
from langgraph.prebuilt import ToolNode

from common.HMS.db import reportnode_collection_sync

from dotenv import load_dotenv
import os

load_dotenv()
api_base_url = os.getenv("VITE_BACKEND_URL")

# =====================================================================
# LOGGING CONFIGURATION
# =====================================================================
logger = logging.getLogger(__name__)

# =====================================================================
# GROQ CLIENT INITIALIZATION
# =====================================================================
groq_client = Groq(
    api_key=os.getenv("GROQ_API_KEY")
)

# =====================================================================
# TYPEDDICT STRUCTURES - HIERARCHICAL MEDICAL DOCUMENT SCHEMA
# =====================================================================

class CategoryInfo(TypedDict):
    """Category information structure"""
    key: str
    name: str


class SubcategoryInfo(TypedDict):
    """Subcategory information structure"""
    key: str
    name: str


class TestInfo(TypedDict):
    """Test information structure"""
    name: str


class VitalSigns(TypedDict, total=False):
    """Vital signs structure"""
    description: Optional[str]
    temperature: Optional[str]
    blood_pressure: Optional[str]
    heart_rate: Optional[str]
    respiratory_rate: Optional[str]
    oxygen_saturation: Optional[str]


class LesionMassInfo(TypedDict, total=False):
    """Lesion or mass information structure"""
    location: Optional[str]
    size: Optional[str]
    characteristics: Optional[str]
    biopsy_result: Optional[str]
    suspicion: Optional[str]


class InvestigationItem(TypedDict, total=False):
    """Investigation item structure"""
    test_name: str
    date: Optional[str]
    results: Optional[str]


class ProcedureItem(TypedDict, total=False):
    """Procedure item structure"""
    procedure_name: str
    date: Optional[str]
    details: Optional[str]
    findings: Optional[str]


class MedicationItem(TypedDict, total=False):
    """Medication item structure"""
    medication_name: str
    dose: Optional[str]
    frequency: Optional[str]
    duration: Optional[str]


class LabTestParameter(TypedDict, total=False):
    """Laboratory test parameter structure"""
    test_name: str
    value: str
    reference_range: Optional[str]
    flag: Optional[str]
    date: Optional[str]
    unit: Optional[str]


class TargetLesion(TypedDict, total=False):
    """Target lesion for interventional procedures"""
    location: Optional[str]
    characteristics: Optional[str]
    prior_findings: Optional[str]


class DischargeSummaryReport(TypedDict, total=False):
    """Discharge summary report structure"""
    admission_date: Optional[str]
    discharge_date: Optional[str]
    length_of_stay: Optional[str]
    admission_diagnosis: Optional[str]
    final_diagnosis: Optional[List[str]]
    chief_complaint: Optional[str]
    history_of_present_illness: Optional[str]
    past_medical_history: Optional[List[str]]
    physical_examination: Optional[str]
    vital_signs: NotRequired[VitalSigns]
    investigations: NotRequired[List[InvestigationItem]]
    procedures_performed: NotRequired[List[ProcedureItem]]
    lesion_or_mass_information: NotRequired[LesionMassInfo]
    hospital_course: Optional[str]
    treatment_given: Optional[List[str]]
    condition_at_discharge: Optional[str]
    discharge_medications: NotRequired[List[MedicationItem]]
    discharge_advice: Optional[str]
    nutritional_advice: Optional[str]
    preventive_care: Optional[str]
    follow_up_plans: Optional[str]
    cross_consultation: Optional[str]


class CTGuidedBiopsyReport(TypedDict, total=False):
    """CT-guided biopsy report structure"""
    procedure_name: Optional[str]
    indication: Optional[str]
    target_lesion: NotRequired[TargetLesion]
    technique: Optional[str]
    anesthesia: Optional[str]
    procedure_details: Optional[str]
    specimens_obtained: Optional[str]
    complications: Optional[str]
    post_procedure_observation: Optional[str]
    patient_condition_post_procedure: Optional[str]


class LaboratoryReport(TypedDict, total=False):
    """Laboratory report structure"""
    tests: List[LabTestParameter]
    parameters: NotRequired[Dict[str, LabTestParameter]]


class BronchoscopyReport(TypedDict, total=False):
    """Bronchoscopy report structure"""
    indication: Optional[str]
    findings: Optional[str]
    biopsy_taken: Optional[str]
    biopsy_result: Optional[str]
    procedure_details: Optional[str]


class ImagingReport(TypedDict, total=False):
    """Generic imaging report structure"""
    findings: Any  # Can be STRING, ARRAY, or OBJECT
    impression: Optional[str]
    technique: Optional[str]
    comparison: Optional[str]


class DocumentMetadata(TypedDict, total=False):
    """Document metadata structure"""
    report_date: Optional[str]
    ordering_provider: Optional[str]
    performing_provider: Optional[str]
    facility: Optional[str]
    department: Optional[str]
    normalized_by: Optional[str]
    source_category: Optional[str]
    subcategory: Optional[str]


class QualityFlags(TypedDict, total=False):
    """Quality assessment flags"""
    confidence: Literal["high", "medium", "low"]
    requires_review: bool
    mixed_content: bool
    missing_expected_sections: List[str]


class DocumentSegment(TypedDict):
    """Individual document segment structure"""
    segment_id: str
    page_range: NotRequired[str]
    report_type: str
    classification_confidence: Literal["high", "medium", "low"]
    detected_boundaries: Optional[str]
    extracted_data: Dict[str, Any]
    condition_inference: Optional[str]
    quality_flags: NotRequired[QualityFlags]
    metadata: NotRequired[DocumentMetadata]


class DocumentSummary(TypedDict):
    """Document summary structure"""
    total_segments: int
    report_types_found: List[str]
    processing_timestamp: str


class LLMExtractionOutput(TypedDict):
    """LLM extraction output structure"""
    document_summary: DocumentSummary
    segments: List[DocumentSegment]


class NormalizedDocument(TypedDict):
    """Normalized document structure for API"""
    category: CategoryInfo
    subcategory: SubcategoryInfo
    test: TestInfo
    report: Dict[str, Any]
    report_date: Optional[str]


class NormalizedOutput(TypedDict):
    """Final normalized output structure"""
    documents: List[NormalizedDocument]


class SavePayload(TypedDict, total=False):
    """Payload for saving documents"""
    patient_id: str
    doctor_id: str
    document_type: str
    report: Dict[str, Any]
    report_date: Optional[str]
    metadata: DocumentMetadata
    imaging_type: NotRequired[str]
    document_subtype: NotRequired[str]


class SaveResult(TypedDict, total=False):
    """Result of save operation"""
    category: str
    subcategory: str
    test_name: str
    status_code: NotRequired[int]
    status: NotRequired[str]
    response: NotRequired[Dict[str, Any]]
    error: NotRequired[str]


# =====================================================================
# LANGGRAPH STATE DEFINITIONS
# =====================================================================

class ProcessingState(TypedDict, total=False):
    """State for LangGraph workflow"""
    # Input
    text: str
    doctor_id: Optional[str]
    patient_id: Optional[str]
    base_url: str
    
    # Intermediate
    raw_llm_output: Optional[str]
    extraction_result: Optional[LLMExtractionOutput]
    normalized_output: Optional[str]
    sanitized_output: Optional[str]
    
    # Output
    save_results: Optional[List[SaveResult]]
    final_output: Optional[str]
    
    # Error handling
    error: Optional[str]
    retry_count: int


# =====================================================================
# DOCUMENT TAXONOMY CONSTANTS
# =====================================================================

DOCUMENT_CATEGORIES: Dict[str, Dict[str, Any]] = {
    "laboratory": {
        "name": "Laboratory & Pathology Reports",
        "info": "All laboratory test results, pathology reports, and related diagnostic studies",
        "subcategories": {
            "routine_lab": {
                "name": "Core Laboratory Panels (Routine)",
                "tests": [
                    "Complete Blood Count (CBC)",
                    "CBC - Hemoglobin & Hematocrit",
                    "CBC - Differential Count",
                    "Peripheral Blood Smear",
                    "Blood Urea Nitrogen (BUN)",
                    "Serum Creatinine",
                    "Estimated Glomerular Filtration Rate (eGFR)",
                    "Serum Uric Acid",
                    "Serum Electrolytes Panel (Na, K, Cl, HCO3)",
                    "Serum Sodium",
                    "Serum Potassium",
                    "Serum Chloride",
                    "Serum Bicarbonate",
                    "Serum Calcium (Total)",
                    "Ionized Calcium",
                    "Serum Magnesium",
                    "Serum Phosphorus",
                    "Liver Function Test (LFT) - Complete",
                    "Total Protein",
                    "Serum Albumin",
                    "Globulin",
                    "Albumin/Globulin Ratio",
                    "Aspartate Aminotransferase (AST/SGOT)",
                    "Alanine Aminotransferase (ALT/SGPT)",
                    "Alkaline Phosphatase (ALP)",
                    "Gamma-Glutamyl Transferase (GGT)",
                    "Total Bilirubin",
                    "Direct Bilirubin",
                    "Indirect Bilirubin",
                    "Fasting Plasma Glucose",
                    "Postprandial Glucose",
                    "Random Blood Glucose",
                    "Hemoglobin A1c (HbA1c)",
                    "Lipid Profile - Complete",
                    "Total Cholesterol",
                    "LDL Cholesterol",
                    "HDL Cholesterol",
                    "Triglycerides",
                    "Urine Routine Examination",
                    "Urine Microscopy",
                    "Urine Protein",
                    "Urine Albumin-Creatinine Ratio (UACR)"
                ]
            },
            "cardiac_markers": {
                "name": "Cardiac Biomarkers",
                "tests": [
                    "Troponin I",
                    "Troponin T",
                    "High-Sensitivity Troponin",
                    "Creatine Kinase-MB (CK-MB)",
                    "B-Type Natriuretic Peptide (BNP)",
                    "NT-proBNP",
                    "High-Sensitivity C-Reactive Protein (hs-CRP)",
                    "D-Dimer",
                    "Homocysteine",
                    "Lipoprotein(a)"
                ]
            },
            "tumor_markers": {
                "name": "Tumor Markers & Cancer Biomarkers",
                "tests": [
                    "Prostate-Specific Antigen (PSA)",
                    "Free PSA",
                    "PSA Free/Total Ratio",
                    "Alpha-Fetoprotein (AFP)",
                    "Carcinoembryonic Antigen (CEA)",
                    "Cancer Antigen 125 (CA-125)",
                    "Cancer Antigen 19-9 (CA 19-9)",
                    "Cancer Antigen 15-3 (CA 15-3)",
                    "Beta-human Chorionic Gonadotropin (β-hCG)",
                    "Lactate Dehydrogenase (LDH)"
                ]
            },
            "diabetes_markers": {
                "name": "Diabetes & Glycemic Markers",
                "tests": [
                    "Glycated Albumin",
                    "C-Peptide",
                    "Insulin (Fasting)",
                    "Insulin (Postprandial)",
                    "Islet Cell Antibody",
                    "Glutamic Acid Decarboxylase Antibody (GAD)",
                    "Oral Glucose Tolerance Test (OGTT)"
                ]
            },
            "hematology_specialized": {
                "name": "Hematology & Iron Studies",
                "tests": [
                    "Ferritin",
                    "Serum Iron",
                    "Total Iron Binding Capacity (TIBC)",
                    "Transferrin Saturation",
                    "Vitamin B12",
                    "Serum Folate",
                    "Reticulocyte Count",
                    "Coagulation Profile (PT/INR, APTT)",
                    "Prothrombin Time (PT)",
                    "International Normalized Ratio (INR)",
                    "Activated Partial Thromboplastin Time (APTT)",
                    "Bleeding Time",
                    "Clotting Time",
                    "Fibrinogen",
                    "D-Dimer",
                    "Coagulation Factor Assays",
                    "Platelet Function Tests",
                    "Thromboelastography (TEG)",
                    "Flow Cytometry (Hematologic Malignancy)"
                ]
            },
            "vitamins_minerals": {
                "name": "Vitamins & Minerals",
                "tests": [
                    "25-Hydroxy Vitamin D",
                    "Vitamin D3",
                    "Vitamin B12",
                    "Serum Folate",
                    "Iron Studies",
                    "Calcium",
                    "Magnesium",
                    "Phosphorus",
                    "Zinc",
                    "Copper"
                ]
            },
            "gi_markers": {
                "name": "Gastrointestinal Markers",
                "tests": [
                    "Amylase",
                    "Lipase",
                    "Fecal Calprotectin",
                    "Fecal Occult Blood Test (FOBT)",
                    "Fecal Fat Quantification",
                    "Gastric Emptying Study",
                    "Hydrogen Breath Test (Lactose)",
                    "Hydrogen Breath Test (Fructose)",
                    "Urea Breath Test (Helicobacter pylori)"
                ]
            },
            "sepsis_inflammation": {
                "name": "Sepsis & Inflammatory Markers",
                "tests": [
                    "Procalcitonin",
                    "Serum Lactate",
                    "Interleukin-6 (IL-6)",
                    "C-Reactive Protein (CRP)",
                    "Erythrocyte Sedimentation Rate (ESR)"
                ]
            },
            "microbiology": {
                "name": "Microbiology & Culture Tests",
                "tests": [
                    "Blood Culture",
                    "Urine Culture",
                    "Sputum Culture",
                    "Stool Culture",
                    "Wound Swab Culture",
                    "Pus Culture",
                    "Cerebrospinal Fluid Culture",
                    "Gram Stain",
                    "Acid-Fast Bacilli (AFB) Smear",
                    "Mycobacterium tuberculosis Culture",
                    "CBNAAT (GeneXpert)",
                    "Line Probe Assay (LPA)",
                    "Antibiotic Sensitivity Testing",
                    "Fungal Culture",
                    "KOH Mount"
                ]
            },
            "infectious_disease": {
                "name": "Infectious Disease Serology",
                "tests": [
                    "Malaria Peripheral Smear",
                    "Rapid Malaria Antigen Test",
                    "Widal Test",
                    "Weil-Felix Test",
                    "Dengue NS1 Antigen",
                    "Dengue IgM Antibody",
                    "Dengue IgG Antibody",
                    "Chikungunya IgM Antibody",
                    "Zika Virus PCR",
                    "COVID-19 RT-PCR",
                    "Influenza A/B PCR",
                    "Hepatitis B Surface Antigen (HBsAg)",
                    "Hepatitis B e Antigen (HBeAg)",
                    "Hepatitis C Antibody",
                    "HIV 1/2 Antibody",
                    "HIV Viral Load",
                    "CD4 Count",
                    "CD8 Count",
                    "Syphilis VDRL",
                    "TPHA (Treponema pallidum)"
                ]
            },
            "hormones_thyroid": {
                "name": "Thyroid Function Tests",
                "tests": [
                    "Thyroid Stimulating Hormone (TSH)",
                    "Free T4",
                    "Free T3",
                    "Total T4",
                    "Total T3",
                    "Anti-Thyroid Peroxidase Antibody (Anti-TPO)",
                    "Anti-Thyroglobulin Antibody",
                    "Thyroglobulin"
                ]
            },
            "hormones_adrenal": {
                "name": "Adrenal Function Tests",
                "tests": [
                    "Serum Cortisol (Morning)",
                    "Serum Cortisol (Evening)",
                    "Adrenocorticotropic Hormone (ACTH)",
                    "Aldosterone",
                    "Plasma Renin Activity",
                    "24-Hour Urinary Cortisol",
                    "Metanephrines"
                ]
            },
            "hormones_reproductive": {
                "name": "Reproductive Hormones",
                "tests": [
                    "Luteinizing Hormone (LH)",
                    "Follicle Stimulating Hormone (FSH)",
                    "Estradiol (E2)",
                    "Progesterone",
                    "Testosterone (Total)",
                    "Free Testosterone",
                    "Dehydroepiandrosterone Sulfate (DHEAS)",
                    "Prolactin",
                    "Anti-Mullerian Hormone (AMH)",
                    "Sex Hormone Binding Globulin (SHBG)",
                    "Beta-hCG (Quantitative)"
                ]
            },
            "hormones_other": {
                "name": "Other Hormones & Growth Factors",
                "tests": [
                    "Parathyroid Hormone (PTH)",
                    "Insulin-like Growth Factor 1 (IGF-1)",
                    "Growth Hormone",
                    "Calcitonin",
                    "Vitamin D (1,25-Dihydroxy)"
                ]
            },
            "immunology": {
                "name": "Immunological & Autoimmune Markers",
                "tests": [
                    "Antinuclear Antibody (ANA)",
                    "Anti-dsDNA Antibody",
                    "Anti-Smith Antibody",
                    "Rheumatoid Factor (RF)",
                    "Anti-Cyclic Citrullinated Peptide (Anti-CCP)",
                    "Complement C3",
                    "Complement C4",
                    "Anti-Neutrophil Cytoplasmic Antibody (ANCA)",
                    "p-ANCA",
                    "c-ANCA",
                    "Anti-Cardiolipin Antibody (IgG, IgM)",
                    "Lupus Anticoagulant",
                    "Beta-2 Glycoprotein I Antibody",
                    "Immunoglobulin G (IgG)",
                    "Immunoglobulin A (IgA)",
                    "Immunoglobulin M (IgM)",
                    "Immunoglobulin E (Total IgE)",
                    "Serum Protein Electrophoresis",
                    "Immunofixation Electrophoresis"
                ]
            },
            "pathology_histology": {
                "name": "Histopathology & Cytology",
                "tests": [
                    "Histopathological Examination (HPE)",
                    "Fine Needle Aspiration Cytology (FNAC)",
                    "Core Needle Biopsy",
                    "Excisional Biopsy",
                    "Incisional Biopsy",
                    "Tru-Cut Biopsy",
                    "Endoscopic Biopsy",
                    "Image-Guided Biopsy Report",
                    "Frozen Section Analysis",
                    "Immunohistochemistry (IHC)",
                    "Special Stains (PAS, Ziehl-Neelsen)",
                    "Molecular Pathology Report",
                    "FISH Analysis",
                    "PCR Tissue Analysis",
                    "Tumor Grading Report",
                    "Tumor Staging (TNM) Report",
                    "Mitotic Index Assessment",
                    "Ki-67 Proliferation Index",
                    "Molecular Tumor Profiling",
                    "Bone Marrow Aspiration Report",
                    "Bone Marrow Biopsy Report"
                ]
            },
            "arterial_blood_gas": {
                "name": "Blood Gas Analysis",
                "tests": [
                    "Arterial Blood Gas (ABG)",
                    "Venous Blood Gas (VBG)",
                    "pH",
                    "pCO2",
                    "pO2",
                    "HCO3",
                    "Base Excess",
                    "Lactate"
                ]
            }
        }
    },
    "imaging": {
        "name": "Imaging & Radiology Reports",
        "info": "All radiological imaging studies and diagnostic imaging reports",
        "subcategories": {
            "xray": {
                "name": "Plain Radiography (X-ray)",
                "tests": [
                    "Chest X-ray (PA View)",
                    "Chest X-ray (AP View)",
                    "Chest X-ray (Lateral View)",
                    "Abdomen X-ray (Erect)",
                    "Abdomen X-ray (Supine)",
                    "X-ray KUB (Kidney-Ureter-Bladder)",
                    "X-ray Skull (AP/Lateral)",
                    "X-ray Cervical Spine",
                    "X-ray Thoracic Spine",
                    "X-ray Lumbar Spine",
                    "X-ray Pelvis",
                    "X-ray Hip Joint",
                    "X-ray Knee Joint (AP/Lateral)",
                    "X-ray Shoulder Joint",
                    "X-ray Elbow Joint",
                    "X-ray Wrist Joint",
                    "X-ray Hand",
                    "X-ray Foot",
                    "X-ray Ankle Joint",
                    "X-ray Femur",
                    "X-ray Tibia/Fibula",
                    "X-ray Humerus",
                    "X-ray Radius/Ulna",
                    "X-ray Paranasal Sinuses (Waters View)",
                    "X-ray Nasal Bone",
                    "X-ray IVU (Intravenous Urography)"
                ]
            },
            "ultrasound": {
                "name": "Ultrasonography (USG)",
                "tests": [
                    "Ultrasound Abdomen (Whole)",
                    "Ultrasound Abdomen (Upper)",
                    "Ultrasound Pelvis (Male)",
                    "Ultrasound Pelvis (Female)",
                    "Ultrasound KUB",
                    "Ultrasound Hepatobiliary System",
                    "Ultrasound Pancreas",
                    "Ultrasound Spleen",
                    "Ultrasound Thyroid",
                    "Ultrasound Breast",
                    "Ultrasound Scrotum",
                    "Ultrasound Prostate (Transabdominal)",
                    "Transrectal Ultrasound Prostate (TRUS)",
                    "Ultrasound Soft Tissue/Neck",
                    "Ultrasound Guided Biopsy",
                    "FAST Scan (Trauma)"
                ]
            },
            "obstetric_ultrasound": {
                "name": "Obstetric Ultrasonography",
                "tests": [
                    "Ultrasound Early Pregnancy/Dating Scan",
                    "Ultrasound NT Scan (Nuchal Translucency)",
                    "Ultrasound Anomaly Scan (Level II)",
                    "Ultrasound Growth Scan (Third Trimester)",
                    "Ultrasound Follicular Study",
                    "Obstetric Doppler Study",
                    "Ultrasound Biophysical Profile (BPP)"
                ]
            },
            "doppler": {
                "name": "Doppler Studies",
                "tests": [
                    "Color Doppler Lower Limb Arteries",
                    "Color Doppler Lower Limb Veins",
                    "Color Doppler Upper Limb Arteries",
                    "Color Doppler Upper Limb Veins",
                    "Renal Doppler",
                    "Carotid Doppler",
                    "Portal Vein Doppler",
                    "Penile Doppler",
                    "Transcranial Doppler (TCD)"
                ]
            },
            "ct_scan": {
                "name": "Computed Tomography (CT)",
                "tests": [
                    "CT Brain (Plain)",
                    "CT Brain (Contrast)",
                    "CT Chest (Plain)",
                    "CT Chest (Contrast)",
                    "CT Chest HRCT",
                    "CT Abdomen (Plain)",
                    "CT Abdomen (Contrast)",
                    "CT Abdomen and Pelvis",
                    "CT KUB (Non-Contrast)",
                    "CT Spine (Cervical)",
                    "CT Spine (Thoracic)",
                    "CT Spine (Lumbar)",
                    "CT Paranasal Sinuses",
                    "CT Temporal Bone",
                    "CT Neck (Plain/Contrast)",
                    "CT Enterography",
                    "CT Colonography",
                    "CT Urography",
                    "CT Guided Biopsy"
                ]
            },
            "ct_angiography": {
                "name": "CT Angiography",
                "tests": [
                    "CT Angiography Brain",
                    "CT Angiography Coronary (CTCA)",
                    "CT Pulmonary Angiography (CTPA)",
                    "CT Aortography",
                    "CT Peripheral Angiography",
                    "CT Renal Angiography"
                ]
            },
            "mri": {
                "name": "Magnetic Resonance Imaging (MRI)",
                "tests": [
                    "MRI Brain (Plain)",
                    "MRI Brain (Contrast)",
                    "MRI Brain with MR Angiography",
                    "MRI Brain with MR Venography",
                    "MRI Epilepsy Protocol",
                    "MRI Pituitary",
                    "MRI Internal Auditory Canal (IAC)",
                    "MRI Spine (Cervical)",
                    "MRI Spine (Thoracic)",
                    "MRI Spine (Lumbar)",
                    "MRI Whole Spine",
                    "MRI Knee Joint",
                    "MRI Shoulder Joint",
                    "MRI Hip Joint",
                    "MRI Ankle Joint",
                    "MRI Wrist Joint",
                    "MRI Elbow Joint",
                    "MRI Brachial Plexus",
                    "MRI Abdomen",
                    "MRI Pelvis",
                    "MRI Liver (Contrast)",
                    "MR Cholangiopancreatography (MRCP)",
                    "MR Enterography",
                    "MR Urography"
                ]
            },
            "mri_specialized": {
                "name": "Specialized MRI",
                "tests": [
                    "MRI Prostate (Multiparametric)",
                    "MRI Breast (Bilateral)",
                    "MRI Placenta (Accreta Protocol)",
                    "MRI Fetal",
                    "Cardiac MRI",
                    "MR Angiography Brain",
                    "MR Angiography Neck",
                    "MR Angiography Peripheral",
                    "MRI Tumor Protocol"
                ]
            },
            "cardiac_imaging": {
                "name": "Cardiac Imaging",
                "tests": [
                    "Echocardiography (2D Echo)",
                    "Doppler Echocardiography",
                    "Stress Echocardiography",
                    "Transesophageal Echocardiography (TEE)",
                    "Fetal Echocardiography",
                    "Cardiac CT",
                    "Cardiac MRI",
                    "Coronary Angiography"
                ]
            },
            "nuclear_medicine": {
                "name": "Nuclear Medicine & PET Scans",
                "tests": [
                    "PET CT (Whole Body)",
                    "PET MRI",
                    "Myocardial Perfusion Imaging (SPECT)",
                    "Bone Scan (Tc-99m)",
                    "Thyroid Scan (Technetium)",
                    "Renal Nuclear Scan (DTPA)",
                    "Renal Nuclear Scan (MAG3)",
                    "Gallium Scan",
                    "Nuclear Renal Split Function Test"
                ]
            },
            "interventional_radiology": {
                "name": "Interventional & Fluoroscopy",
                "tests": [
                    "Fluoroscopy Barium Swallow",
                    "Barium Meal Study",
                    "Barium Follow Through",
                    "Barium Enema",
                    "Hysterosalpingography (HSG)",
                    "Micturating Cystourethrogram (MCU)",
                    "Voiding Cystourethrogram (VCUG)",
                    "Sinogram",
                    "Fistulogram",
                    "Sialography",
                    "Digital Subtraction Angiography (DSA)",
                    "Coronary Angiography",
                    "Peripheral Angiography",
                    "Cerebral Angiography"
                ]
            },
            "mammography": {
                "name": "Mammography",
                "tests": [
                    "Mammography (Bilateral)",
                    "Digital Mammography",
                    "Tomosynthesis (3D Mammography)"
                ]
            },
            "dexa_scan": {
                "name": "Bone Density",
                "tests": [
                    "DEXA Scan (Bone Densitometry)",
                    "DEXA Spine",
                    "DEXA Hip"
                ]
            }
        }
    },
    "functional": {
        "name": "Functional & Special Tests",
        "info": "Physiological function tests, endoscopy, and specialized diagnostic procedures",
        "subcategories": {
            "pulmonary": {
                "name": "Pulmonary Function Tests (PFTs)",
                "tests": [
                    "Spirometry (Complete)",
                    "Forced Vital Capacity (FVC)",
                    "Forced Expiratory Volume (FEV1)",
                    "FEV1/FVC Ratio",
                    "Peak Expiratory Flow Rate (PEFR)",
                    "Forced Expiratory Flow 25-75% (FEF25-75)",
                    "Bronchodilator Reversibility Test",
                    "Lung Volumes (TLC, RV, FRC)",
                    "Diffusing Capacity (DLCO)",
                    "Airway Resistance Measurement",
                    "Six Minute Walk Test (6MWT)",
                    "Cardiopulmonary Exercise Testing (CPET)",
                    "Methacholine Challenge Test",
                    "Exercise-Induced Bronchoconstriction Test"
                ]
            },
            "cardiac_tests": {
                "name": "Cardiac Functional Tests",
                "tests": [
                    "Electrocardiogram (ECG) - Resting",
                    "Stress ECG (Treadmill Test - TMT)",
                    "Holter Monitoring (24 Hour ECG)",
                    "Ambulatory Blood Pressure Monitoring (ABPM)",
                    "Tilt Table Test",
                    "Signal-Averaged ECG",
                    "Heart Rate Variability Analysis",
                    "Pacemaker Interrogation",
                    "ICD Interrogation",
                    "Fractional Flow Reserve (FFR)",
                    "Intravascular Ultrasound (IVUS)",
                    "Optical Coherence Tomography (Coronary OCT)",
                    "Cardiac Autonomic Reflex Tests"
                ]
            },
            "neurophysiology": {
                "name": "Neurophysiological Tests",
                "tests": [
                    "Electroencephalogram (EEG)",
                    "Video EEG Monitoring",
                    "Long-Term Video EEG Monitoring",
                    "Sleep EEG",
                    "Quantitative EEG (qEEG)",
                    "Visual Evoked Potential (VEP)",
                    "Brainstem Auditory Evoked Response (BAER/ABR)",
                    "Somatosensory Evoked Potential (SSEP)",
                    "Electromyography (EMG)",
                    "Nerve Conduction Study (NCS)",
                    "Repetitive Nerve Stimulation Test",
                    "Autonomic Function Tests",
                    "Intraoperative Neurophysiological Monitoring (IONM)"
                ]
            },
            "endoscopy_gi": {
                "name": "Gastrointestinal Endoscopy",
                "tests": [
                    "Upper GI Endoscopy (EGD)",
                    "Colonoscopy",
                    "Sigmoidoscopy",
                    "Proctoscopy",
                    "Enteroscopy",
                    "Capsule Endoscopy",
                    "Endoscopic Retrograde Cholangiopancreatography (ERCP)",
                    "Endoscopic Ultrasound (EUS)",
                    "Esophageal Varices Grading",
                    "Barrett's Esophagus Assessment",
                    "Colonic Polyp Detection Report"
                ]
            },
            "endoscopy_respiratory": {
                "name": "Respiratory Endoscopy",
                "tests": [
                    "Bronchoscopy",
                    "Flexible Bronchoscopy",
                    "Rigid Bronchoscopy",
                    "Bronchoalveolar Lavage (BAL)",
                    "Endobronchial Biopsy",
                    "CT Virtual Bronchoscopy"
                ]
            },
            "endoscopy_urological": {
                "name": "Urological Endoscopy",
                "tests": [
                    "Cystoscopy",
                    "Ureteroscopy",
                    "Bladder Lesion Evaluation"
                ]
            },
            "endoscopy_gynecological": {
                "name": "Gynecological Endoscopy",
                "tests": [
                    "Hysteroscopy",
                    "Colposcopy",
                    "Laparoscopy (Diagnostic)"
                ]
            },
            "endoscopy_joint": {
                "name": "Joint Endoscopy",
                "tests": [
                    "Arthroscopy (Diagnostic) - Knee",
                    "Arthroscopy (Diagnostic) - Shoulder",
                    "Arthroscopy (Diagnostic) - Hip",
                    "Arthroscopy (Diagnostic) - Ankle"
                ]
            },
            "gi_manometry": {
                "name": "GI Motility & Manometry",
                "tests": [
                    "Anorectal Manometry",
                    "Esophageal Manometry",
                    "24 Hour pH Monitoring",
                    "Impedance pH Study",
                    "Small Bowel Manometry"
                ]
            },
            "urodynamics": {
                "name": "Urodynamic Studies",
                "tests": [
                    "Urodynamic Study (Complete)",
                    "Cystometrogram",
                    "Uroflowmetry",
                    "Pressure Flow Study",
                    "Post-Void Residual Volume",
                    "Ambulatory Urodynamic Study"
                ]
            },
            "sleep_studies": {
                "name": "Sleep Studies",
                "tests": [
                    "Polysomnography (Level I)",
                    "Polysomnography (Level II)",
                    "Polysomnography (Level III)",
                    "Polysomnography (Level IV)",
                    "CPAP Titration Study",
                    "BiPAP Titration Study",
                    "Overnight Pulse Oximetry",
                    "Multiple Sleep Latency Test (MSLT)"
                ]
            },
            "audiology": {
                "name": "Audiology & Vestibular Tests",
                "tests": [
                    "Pure Tone Audiometry (PTA)",
                    "Speech Audiometry",
                    "Tympanometry",
                    "Impedance Audiometry",
                    "Auditory Brainstem Response (ABR)",
                    "Otoacoustic Emissions (OAE)",
                    "Vestibular Function Tests"
                ]
            },
            "ophthalmology": {
                "name": "Ophthalmological Tests",
                "tests": [
                    "Visual Acuity Test",
                    "Visual Field Analysis (Perimetry)",
                    "Optical Coherence Tomography (OCT) - Eye",
                    "Fundus Photography",
                    "Fluorescein Angiography",
                    "Tonometry (IOP Measurement)",
                    "Corneal Topography",
                    "A-Scan Biometry",
                    "B-Scan Ultrasound (Eye)"
                ]
            },
            "cognitive_assessment": {
                "name": "Cognitive & Psychological Assessment",
                "tests": [
                    "Mini-Mental State Examination (MMSE)",
                    "Montreal Cognitive Assessment (MoCA)",
                    "Glasgow Coma Scale (GCS)",
                    "Neuropsychological Testing"
                ]
            },
            "rehabilitation": {
                "name": "Physical Medicine & Rehabilitation",
                "tests": [
                    "Gait Analysis",
                    "Range of Motion Assessment",
                    "Functional Independence Measure (FIM)",
                    "Diagnostic Nerve Block Test"
                ]
            }
        }
    },
    "clinical": {
        "name": "Clinical Notes & Records",
        "info": "Clinical documentation, progress notes, and medical records",
        "subcategories": {
            "admission": {
                "name": "Admission Records",
                "tests": [
                    "Admission Note",
                    "History & Physical Examination",
                    "Chief Complaint Documentation",
                    "Presenting Illness Documentation",
                    "Past Medical History",
                    "Family History",
                    "Social History",
                    "Medication History",
                    "Allergy Documentation"
                ]
            },
            "progress_notes": {
                "name": "Progress Notes",
                "tests": [
                    "Daily Progress Note",
                    "SOAP Note",
                    "Consultant Note",
                    "Specialty Consultation Report",
                    "Follow-up Note",
                    "Telephone Encounter Note",
                    "Clinical Note"
                ]
            }
        }
    },
    "surgical": {
        "name": "Surgical & Procedure Records",
        "info": "Surgical documentation, operative notes, and procedure records",
        "subcategories": {
            "preoperative": {
                "name": "Pre-Operative Records",
                "tests": [
                    "Pre-Operative Assessment",
                    "Pre-Anesthetic Evaluation",
                    "Surgical Consent Form",
                    "Pre-Operative Checklist",
                    "Surgical Safety Checklist (WHO)",
                    "Risk Assessment & Stratification"
                ]
            },
            "operative": {
                "name": "Operative Records",
                "tests": [
                    "Operative Note",
                    "Procedure Note",
                    "Surgeon's Report",
                    "Anesthesia Record",
                    "Intra-Operative Nursing Note",
                    "Implant Documentation",
                    "Surgical Specimen Documentation"
                ]
            },
            "postoperative": {
                "name": "Post-Operative Records",
                "tests": [
                    "Post-Operative Note",
                    "Post-Anesthesia Care Unit (PACU) Note",
                    "Recovery Room Record",
                    "Post-Operative Orders",
                    "Post-Operative Complications Note"
                ]
            },
            "interventional": {
                "name": "Interventional Procedures",
                "tests": [
                    "Cardiac Catheterization Report",
                    "Coronary Angioplasty Report",
                    "Stent Placement Record",
                    "Pacemaker Implantation Record",
                    "ICD Implantation Record",
                    "Percutaneous Biopsy Report",
                    "Therapeutic Endoscopy Report",
                    "Dialysis Access Procedure",
                    "Central Line Placement Note",
                    "Lumbar Puncture Note",
                    "Thoracentesis Note",
                    "Paracentesis Note",
                    "Joint Aspiration Note",
                    "Bone Marrow Biopsy Procedure Note"
                ]
            }
        }
    },
    "pharmacy": {
        "name": "Pharmacy & Medication Records",
        "info": "Medication documentation, prescriptions, and drug therapy records",
        "subcategories": {
            "prescriptions": {
                "name": "Prescriptions",
                "tests": [
                    "Outpatient Prescription",
                    "Discharge Prescription",
                    "Controlled Substance Prescription",
                    "Chronic Disease Prescription",
                    "Electronic Prescription (e-Rx)"
                ]
            },
            "medication_admin": {
                "name": "Medication Administration",
                "tests": [
                    "Medication Administration Record (MAR)",
                    "IV Medication Record",
                    "Controlled Drug Administration Record",
                    "PRN (As Needed) Medication Log",
                    "Medication Reconciliation Form"
                ]
            },
            "pharmacy_review": {
                "name": "Pharmacy Reviews",
                "tests": [
                    "Pharmacist Consultation Note",
                    "Drug Interaction Check",
                    "Therapeutic Drug Monitoring Report",
                    "Adverse Drug Reaction Report",
                    "Medication Therapy Management (MTM)"
                ]
            }
        }
    },
    "emergency": {
        "name": "Emergency & Critical Care",
        "info": "Emergency department and ICU documentation",
        "subcategories": {
            "emergency_records": {
                "name": "Emergency Department Records",
                "tests": [
                    "Emergency Department Triage Note",
                    "ED Physician Note",
                    "Trauma Documentation",
                    "FAST Scan Report",
                    "Emergency Procedure Note",
                    "ED Discharge Instructions",
                    "Against Medical Advice (AMA) Form"
                ]
            },
            "critical_care": {
                "name": "Critical Care Records",
                "tests": [
                    "ICU Admission Note",
                    "Daily ICU Progress Note",
                    "Ventilator Settings Record",
                    "Arterial Line Record",
                    "Central Line Documentation",
                    "Vasopressor/Inotrope Titration Record",
                    "Sedation Assessment",
                    "Delirium Screening (CAM-ICU)",
                    "Code Blue Documentation",
                    "Rapid Response Team Note"
                ]
            }
        }
    },
    "specialty": {
        "name": "Specialty Department Records",
        "info": "Specialty-specific clinical documentation",
        "subcategories": {
            "obstetrics": {
                "name": "Obstetrics Records",
                "tests": [
                    "Antenatal Care Record",
                    "Prenatal Visit Note",
                    "Labor and Delivery Note",
                    "Partogram",
                    "Non-Stress Test (NST) Report",
                    "Cardiotocography (CTG) Report",
                    "Biophysical Profile (BPP)",
                    "Postpartum Note",
                    "Lactation Consultation"
                ]
            },
            "gynecology": {
                "name": "Gynecology Records",
                "tests": [
                    "Gynecological Examination Note",
                    "Pap Smear Report",
                    "Cervical Biopsy Report",
                    "Endometrial Biopsy Report",
                    "Menstrual History",
                    "Contraception Counseling Note"
                ]
            },
            "pediatrics": {
                "name": "Pediatrics Records",
                "tests": [
                    "Well Child Visit Note",
                    "Growth Chart",
                    "Developmental Milestone Assessment",
                    "Immunization Record",
                    "Pediatric Physical Examination",
                    "Newborn Screening Results"
                ]
            },
            "oncology": {
                "name": "Oncology Records",
                "tests": [
                    "Oncology Consultation Note",
                    "Chemotherapy Protocol",
                    "Chemotherapy Administration Record",
                    "Radiation Oncology Plan",
                    "Tumor Board Discussion Note",
                    "Cancer Staging Documentation",
                    "Minimal Residual Disease (MRD) Report",
                    "Molecular Tumor Profiling Report"
                ]
            },
            "dialysis": {
                "name": "Dialysis & Nephrology",
                "tests": [
                    "Hemodialysis Session Record",
                    "Peritoneal Dialysis Record",
                    "Vascular Access Monitoring",
                    "Dialysis Adequacy (Kt/V) Report",
                    "Renal Biopsy Report"
                ]
            },
            "rehabilitation": {
                "name": "Rehabilitation Records",
                "tests": [
                    "Physical Therapy Evaluation",
                    "Physical Therapy Progress Note",
                    "Occupational Therapy Evaluation",
                    "Speech Therapy Evaluation",
                    "Rehabilitation Plan of Care"
                ]
            },
            "psychiatry": {
                "name": "Psychiatry Records",
                "tests": [
                    "Psychiatric Evaluation",
                    "Mental Status Examination",
                    "Psychiatric Progress Note",
                    "Psychotherapy Note",
                    "Suicide Risk Assessment",
                    "Involuntary Commitment Documentation"
                ]
            }
        }
    },
    "discharge": {
        "name": "Discharge & Summary Documents",
        "info": "Discharge documentation and clinical summaries",
        "subcategories": {
            "discharge_summary": {
                "name": "Discharge Documentation",
                "tests": [
                    "Discharge Summary",
                    "Discharge Instructions",
                    "Discharge Medication List",
                    "Discharge Against Medical Advice (DAMA)",
                    "Transfer Summary",
                    "Death Summary",
                    "Post-Discharge Follow-up Plan"
                ]
            },
            "clinical_summary": {
                "name": "Clinical Summaries",
                "tests": [
                    "Episode of Care Summary",
                    "Continuity of Care Document",
                    "Treatment Summary Report",
                    "Hospital Course Summary"
                ]
            }
        }
    },
    "referral": {
        "name": "Referral & Transfer Documents",
        "info": "Inter-facility and inter-specialty referral documentation",
        "subcategories": {
            "referrals": {
                "name": "Referral Documentation",
                "tests": [
                    "Specialist Referral Letter",
                    "Primary Care Referral",
                    "Inter-Hospital Transfer Note",
                    "Emergency Transfer Documentation",
                    "Referral Response Letter"
                ]
            }
        }
    },
    "administrative": {
        "name": "Administrative & Consent Forms",
        "info": "Administrative documentation and legal consent forms",
        "subcategories": {
            "consent_forms": {
                "name": "Consent Forms",
                "tests": [
                    "Informed Consent for Procedure",
                    "Informed Consent for Surgery",
                    "Anesthesia Consent",
                    "Blood Transfusion Consent",
                    "Research Study Consent",
                    "Photography/Video Consent",
                    "Release of Medical Records Authorization"
                ]
            },
            "administrative_forms": {
                "name": "Administrative Forms",
                "tests": [
                    "Patient Registration Form",
                    "Advance Directive",
                    "Living Will",
                    "Healthcare Power of Attorney",
                    "DNR (Do Not Resuscitate) Order",
                    "POLST (Physician Orders for Life-Sustaining Treatment)",
                    "Patient Rights & Responsibilities",
                    "Privacy Policy Acknowledgment (HIPAA)",
                    "Financial Agreement"
                ]
            },
            "medical_legal": {
                "name": "Medical-Legal Documents",
                "tests": [
                    "Fitness for Work Certificate",
                    "Medical Leave Certificate",
                    "Disability Certificate",
                    "Medico-Legal Case (MLC) Documentation",
                    "Autopsy Report",
                    "Death Certificate",
                    "Birth Certificate"
                ]
            }
        }
    },
    "insurance": {
        "name": "Insurance & Billing Documents",
        "info": "Insurance claims, pre-authorization, and billing documentation",
        "subcategories": {
            "insurance_documents": {
                "name": "Insurance Documentation",
                "tests": [
                    "Insurance Verification Form",
                    "Pre-Authorization Request",
                    "Insurance Claim Form",
                    "Explanation of Benefits (EOB)",
                    "Coordination of Benefits",
                    "Letter of Medical Necessity"
                ]
            },
            "billing": {
                "name": "Billing Records",
                "tests": [
                    "Itemized Bill",
                    "Invoice",
                    "Payment Receipt",
                    "Billing Statement",
                    "Cashless Treatment Approval"
                ]
            }
        }
    }
}

SAVE_ENDPOINTS: Dict[str, str] = {
    "laboratory": "/save_laboratory",
    "lab": "/save_laboratory",
    "lab_report": "/save_laboratory",
    "imaging": "/save_imaging",
    "radiology": "/save_imaging",
    "ultrasound": "/save_imaging",
    "ct": "/save_imaging",
    "ct_scan": "/save_imaging",
    "mri": "/save_imaging",
    "x_ray": "/save_imaging",
    "clinical": "/save_clinical",
    "clinical_note": "/save_clinical",
    "consultation": "/save_clinical",
    "emergency": "/save_emergency",
    "surgical": "/save_surgical",
    "operative_report": "/save_surgical",
    "surgery_report": "/save_surgical",
    "discharge": "/save_discharge",
    "discharge_summary": "/save_discharge",
    "pharmacy": "/save_pharmacy",
    "medication": "/save_pharmacy",
    "referral": "/save_referral",
    "administrative": "/save_administrative",
    "insurance": "/save_insurance_claim"
}

# =====================================================================
# UTILITY FUNCTIONS
# =====================================================================
def run_rule_based_report_llm(
    *,
    text: str,
    category_key: str,
    subcategory_key: str,
    hospital_rules: dict
) -> dict:
    """
    Rule-driven extraction (parallel to existing pipeline)
    """

    fields = hospital_rules.get("fields", [])
    abnormality_rules = hospital_rules.get("abnormality_rules", [])

    prompt = f"""
You are a medical report extraction AI.

Extract ONLY the following fields:
{json.dumps(fields, indent=2)}

Apply abnormality rules:
{json.dumps(abnormality_rules, indent=2)}

Rules:
- Do not infer values
- Missing → "Not Mentioned"
- Return JSON only

OUTPUT:
{{
  "investigation_name": "{hospital_rules.get('investigation_name')}",
  "structured_data": {{}},
  "abnormalities": [],
  "summary": "",
  "overall_status": "Normal | Abnormal"
}}

REPORT TEXT:
{text}
"""

    completion = groq_client.chat.completions.create(
        model="llama-3.1-8b-instant",
        messages=[{"role": "user", "content": prompt}],
        temperature=0.1,
        max_tokens=2000
    )

    return json.loads(completion.choices[0].message.content)

def sanitize_json_string(json_str: str) -> str:
    """
    Remove control characters and sanitize JSON string.
    
    Args:
        json_str: Raw JSON string to sanitize
        
    Returns:
        Sanitized JSON string
    """
    try:
        # Try to parse and re-serialize if possible
        parsed = json.loads(json_str)
        return json.dumps(parsed, separators=(',', ':'))
    except json.JSONDecodeError:
        # Manual sanitization
        sanitized = json_str
        
        # Remove control characters (except properly escaped ones)
        sanitized = re.sub(r'[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]', '', sanitized)
        
        # Replace smart quotes with regular quotes
        sanitized = sanitized.replace('"', '"').replace("'", "'")
        
        # Remove trailing commas
        sanitized = re.sub(r',\s*}', '}', sanitized)
        sanitized = re.sub(r',\s*]', ']', sanitized)
        
        # Remove non-ASCII characters
        
        
        return sanitized


def validate_json_output(json_str: str) -> bool:
    """
    Validate that a string is valid JSON.
    
    Args:
        json_str: String to validate
        
    Returns:
        True if valid JSON, False otherwise
    """
    try:
        json.loads(json_str)
        return True
    except json.JSONDecodeError:
        return False


# =====================================================================
# LANGGRAPH WORKFLOW NODES
# =====================================================================

def validate_input(state: ProcessingState) -> ProcessingState:
    """
    Validate input parameters.
    
    Args:
        state: Current processing state
        
    Returns:
        Updated state with validation results
    """
    if not state.get("text") or not state["text"].strip():
        state["error"] = "LLM input text is empty"
        logger.error("❌ Validation failed: Empty input text")
        return state
    
    logger.info("✅ Input validation passed")
    return state


def extract_with_llm(state: ProcessingState) -> ProcessingState:
    """
    Execute LLM for structured extraction with COMPLETE prompt.
    
    Args:
        state: Current processing state
        
    Returns:
        Updated state with LLM extraction results

        
    """
    text = state["text"]
    
    prompt = f"""
You are a medical document processing system. You will receive medical document text that may contain one or multiple report types.

Your task is to:
1. Segment the document into distinct medical reports
2. Classify each segment by report type
3. Extract ALL clinically relevant structured data from each segment
4. Return everything in a single JSON output

=== CRITICAL: YOU ARE A JSON GENERATOR, NOT A CODE GENERATOR ===
- You MUST output ONLY valid JSON
- You MUST NOT output Python code, functions, or any programming language
- You MUST NOT output explanations, markdown, or comments
- The FIRST character must be {{ and the LAST character must be }}
- ANYTHING other than a single JSON object is INVALID

🚨 NUMERIC IMMUTABILITY RULE (ABSOLUTE):

- ALL numbers MUST be treated as opaque strings
- You MUST copy numeric values CHARACTER-FOR-CHARACTER
- You MUST NOT round, approximate, format, or correct numbers
- "0.78" is NOT equal to "0.75" or "0.8"
- If uncertain, KEEP THE ORIGINAL STRING EXACTLY

=== PHASE 1: DOCUMENT SEGMENTATION ===

SEGMENTATION STRATEGY:
Analyze the document for boundaries that indicate separate reports:

Visual/Structural Boundaries:
- Page breaks or clear section separators
- Header changes (different letterheads, logos, report titles)
- Date changes indicating different examination dates
- Provider/facility name changes
- Signature blocks or report end markers
- Table structure changes

Semantic Boundaries:
- Explicit report type headers (e.g., "LABORATORY REPORT", "CT SCAN REPORT", "ECG REPORT")
- Changes in diagnostic modality language
- Transition from one organ system to another with new context
- New patient identifier sections (though same patient)

Segmentation Rules:
- Each segment should represent ONE complete medical report
- A segment may span multiple pages
- If the entire document is a single report type, create one segment
- Look for phrases like "DISCHARGE SUMMARY", "BIOPSY REPORT", "CT GUIDED", etc. to identify report boundaries

=== PHASE 2: REPORT TYPE CLASSIFICATION ===

For each identified segment, determine the report type.

REPORT TYPE CATEGORIES:
Primary types (use exact match if found in document):
- laboratory_report / lab_report
- ct_scan / computed_tomography
- ct_guided_biopsy / ct_guided_procedure
- mri / magnetic_resonance_imaging
- x_ray / radiography
- ultrasound / sonography
- doppler_ultrasound / doppler_study / color_doppler
- pet_scan / positron_emission_tomography
- pet_ct / pet_ct_scan
- ecg / electrocardiogram
- echocardiogram / cardiac_ultrasound / echo
- mammography
- nuclear_medicine_scan
- pathology_report / histopathology
- endoscopy_report
- colonoscopy_report
- biopsy_report
- bronchoscopy
- pulmonary_function_test
- stress_test / treadmill_test
- holter_monitor
- discharge_summary / discharge_report
- admission_note
- progress_note / clinical_note
- operative_report / surgery_report
- chemotherapy_chart / chemo_administration
- radiation_therapy_report
- consultation_report
- bone_scan
- dexa_scan / bone_density
- angiography / angiogram
- interventional_radiology_report

SPECIAL DETECTION RULES:
- If document contains "CT GUIDED BIOPSY" or similar → ct_guided_biopsy
- If document contains "DISCHARGE SUMMARY" → discharge_summary
- If document contains "BRONCHOSCOPY" → bronchoscopy
- If document contains multiple procedures in one report → use the primary procedure type

Use the EXACT terminology from the document header/title if present.
If no explicit label exists, infer from diagnostic content and terminology.

CLASSIFICATION CONFIDENCE:
- high: Explicit report title/header present
- medium: Strong diagnostic language patterns
- low: Ambiguous content, multiple interpretations possible

INSURANCE CLASSIFICATION RULE (TAXONOMY-BOUND):

If the document title or content EXACTLY or CLEARLY MATCHES ANY of the following
DOCUMENT_CATEGORIES["insurance"] tests:

"Insurance Documentation":
- "Insurance Verification Form"
- "Pre-Authorization Request"
- "Insurance Claim Form"
- "Explanation of Benefits (EOB)"
- "Coordination of Benefits"
- "Letter of Medical Necessity"

"Billing Records":
- "Itemized Bill"
- "Invoice"
- "Payment Receipt"
- "Billing Statement"
- "Cashless Treatment Approval"

OR contains strong indicators:
- "CLAIM FORM"
- "HEALTH INSURANCE"
- "POLICY NUMBER"
- "TPA"
- "INSURER"
- "CASHLESS"

THEN:
- "category.key" = "insurance"
- "category.name" = "Insurance & Billing Documents"
- "classification_confidence" = "high"


=== PHASE 3: COMPREHENSIVE STRUCTURED DATA EXTRACTION ===

Administrative & Insurance (DOCUMENT_CATEGORIES["insurance"]):

- "insurance"
- "insurance_document"
- "insurance_claim_form"
- "billing_document"


CRITICAL EXTRACTION MANDATE:



🚨 NUMERIC IMMUTABILITY RULE (ABSOLUTE):

- ALL numbers MUST be treated as opaque strings
- You MUST copy numeric values CHARACTER-FOR-CHARACTER
- You MUST NOT round, approximate, format, or correct numbers
- "0.78" is NOT equal to "0.75" or "0.8"
- If uncertain, KEEP THE ORIGINAL STRING EXACTLY


- Extract a laboratory parameter ONLY if BOTH are present:
  1) Parameter NAME exists explicitly in DOCUMENT TEXT
  2) Parameter VALUE exists explicitly in DOCUMENT TEXT

- If name exists but value does NOT → DO NOT include
- If value exists but name does NOT → DO NOT include
- DO NOT reconstruct tables
- DO NOT infer missing rows
- DO NOT assume standard panels (CBC, LFT, RFT, Lipid Profile)
- DO NOT use medical knowledge
- DO NOT complete partial reports

- Numeric values, units, reference ranges MUST be copied CHARACTER-FOR-CHARACTER
- OCR issues are NOT a reason to hallucinate data
- EMPTY output is ALWAYS better than WRONG output

🚨 LABORATORY REPORT STRICTNESS OVERRIDE (ABSOLUTE — DO NOT VIOLATE):
📌 REFERENCE RANGE ASSOCIATION RULE (STRICT):

If a reference range appears ANYWHERE in the document AND:
- The laboratory test appears ONLY ONCE in the document
- The reference range is clearly related to that test

THEN:
- Attach the reference range verbatim to that test
- DO NOT paraphrase
- DO NOT infer additional ranges
- DO NOT drop reference ranges due to formatting or section headers

🚨 OCR VALUE RECOVERY RULE (CRITICAL):

🚫 SOURCE-BOUND EXTRACTION RULE (ABSOLUTE — OVERRIDES ALL):

- You are FORBIDDEN from extracting any test, parameter, value, or date
  unless the EXACT SAME STRING appears in the provided DOCUMENT TEXT.
- If a value, unit, reference range, or date is NOT literally present
  in the DOCUMENT TEXT, you MUST NOT include it.
- DO NOT reconstruct tables.
- DO NOT infer missing rows.
- DO NOT assume standard panels (CBC, LFT, RFT).
- DO NOT use medical knowledge.
- If OCR text is incomplete → return fewer results, NOT guessed results.
- EMPTY output is ALWAYS CORRECT if text is unclear.


🚨 INSURANCE DOCUMENTS — DOCUMENT_CATEGORIES["insurance"] (ABSOLUTE RULES):

Insurance documents are ADMINISTRATIVE, NOT CLINICAL.

For documents where "category.key" == "insurance":

- DO NOT apply laboratory, imaging, discharge, or clinical extraction rules
- DO NOT extract tests, lab values, diagnoses, or procedures
- DO NOT infer or normalize medical meaning
- DO NOT summarize or interpret content

Extraction objective:
- Preserve FORM STRUCTURE and CONTENT FIDELITY
- Extract sections, subsections, field labels, and values EXACTLY as written
- Maintain hierarchy ("Section A", "Section B", etc.)
- Extract ONLY text explicitly present in the document
- Empty or placeholder fields MAY be included IF explicitly shown
- DO NOT invent missing values


- OCR output may contain fragmented, line-broken, or table-split values
- If a test name and its value appear on separate lines, rows, or nearby text blocks,
  they MUST be associated and extracted together
- Do NOT drop values due to table formatting, alignment, or column breaks
- Extraction priority:
  OCR TEXT > visual alignment > table structure
- DO NOT infer, complete, or assume any laboratory test or parameter

- Extract a laboratory parameter ONLY if:
  1) the parameter NAME exists AND
  2) the parameter VALUE exists explicitly in the document text
- If a parameter name appears without a value → DO NOT include it
- DO NOT auto-complete panels such as CBC, LFT, RFT, Lipid Profile, etc.
- NEVER include expected, typical, or reference-only values
- Numeric values MUST be copied CHARACTER-FOR-CHARACTER
EXTRACTION PRINCIPLES:
1. DOCUMENT FIDELITY (ABSOLUTE RULE)
   - Extract ONLY explicitly stated information
   - NEVER infer, guess, or hallucinate data
   - If value is absent in text → return null
   - Preserve exact clinical meaning and wording
   - OCR formatting issues, broken tables, or line wrapping are NOT a reason to drop a value
   - If a value, unit, or reference range appears anywhere near the parameter name,
     extract it verbatim
   - Return "null" ONLY if the value is completely absent from the document text

2. COMPREHENSIVE CAPTURE (MAXIMALIST APPROACH)
NOTE:
This rule DOES NOT apply to laboratory reports.
Laboratory reports MUST follow LABORATORY REPORT STRICTNESS rules ONLY.
   - Extract every measurement, observation, and finding
   - Include both normal and abnormal findings
   - Capture temporal information (dates, durations, sequences)
   - Extract medication names, dosages, frequencies
   - Include tumor characteristics (size, location, stage, grade, markers)
   - Capture vital signs, physical examination findings
   - Extract treatment plans, recommendations, follow-up instructions
   - Include patient history relevant to current condition
   - Capture procedural details and techniques used
   - Extract lab values with reference ranges

3. VALUE COMPLETENESS RULES:
   
   For LABORATORY REPORTS:
   - Use concise values as written (e.g., "7.2 mg/dL", "Negative", "185")
   - Include reference ranges if provided
   - Each test = separate object in array
   - Include panel/category grouping if indicated
   
   For RADIOLOGY/IMAGING/PROCEDURE REPORTS:
   - NEVER use single-word values
   - Each finding must be a complete sentence (15-30 words minimum)
   - Include: location, appearance, measurements, clinical significance
   - Use ONLY language from the report
   - Each key must answer a DIFFERENT clinical question
   - Do NOT reuse sentences across keys
   - Capture comparison with prior studies if mentioned
   
   For DISCHARGE SUMMARIES:
   - Extract ALL sections present in the document
   - Capture diagnosis, physical exam, investigations, procedures, treatments
   - Include discharge medications with full details
   - Extract follow-up instructions and advice
   
   For OTHER REPORT TYPES:
   - Default to complete clinical sentences
   - Preserve clinical context and detail
   - Include measurements with units

EXTRACTION SCHEMAS BY TYPE:

DISCHARGE SUMMARY:
{{
  "admission_date": "date if present or null",
  "discharge_date": "date if present or null",
  "length_of_stay": "duration if stated or null",
  "admission_diagnosis": "reason for admission",
  "final_diagnosis": ["list of all discharge diagnoses"],
  "chief_complaint": "presenting complaint or null",
  "history_of_present_illness": "detailed HPI if present",
  "past_medical_history": ["relevant past conditions or empty array"],
  "physical_examination": "physical exam findings from document",
  "vital_signs": {{
    "description": "vital signs status as described in text or null"
  }},
  "investigations": [
    {{
      "test_name": "name of investigation",
      "date": "date performed",
      "results": "results as stated in document"
    }}
  ],
  "procedures_performed": [
    {{
      "procedure_name": "name of procedure",
      "date": "when performed or null",
      "details": "description of procedure",
      "findings": "key findings if mentioned or null"
    }}
  ],
  "lesion_or_mass_information": {{
    "location": "anatomical location if tumor/mass/lesion present",
    "size": "dimensions if stated or null",
    "characteristics": "description from imaging or exam",
    "biopsy_result": "histopathology result if mentioned or null",
    "suspicion": "clinical suspicion stated in report or null"
  }},
  "hospital_course": "narrative of hospital stay",
  "treatment_given": ["list of medications given during hospitalization"],
  "condition_at_discharge": "patient condition at discharge",
  "discharge_medications": [
    {{
      "medication_name": "drug name",
      "dose": "dosage",
      "frequency": "how often",
      "duration": "how long"
    }}
  ],
  "discharge_advice": "instructions given to patient",
  "nutritional_advice": "dietary instructions if given or null",
  "preventive_care": "preventive recommendations or null",
  "follow_up_plans": "follow-up instructions",
  "cross_consultation": "consultations mentioned or null"
}}

CT GUIDED BIOPSY / INTERVENTIONAL PROCEDURE:
{{
  "procedure_name": "name of procedure performed",
  "indication": "reason for procedure",
  "target_lesion": {{
    "location": "anatomical site of lesion",
    "characteristics": "description from imaging",
    "prior_findings": "previous investigations if mentioned"
  }},
  "technique": "procedure technique described",
  "anesthesia": "type of anesthesia used",
  "procedure_details": "step-by-step details if provided",
  "specimens_obtained": "what samples were taken",
  "complications": "any complications during procedure or null",
  "post_procedure_observation": "observation period and findings",
  "patient_condition_post_procedure": "condition after procedure"
}}

LABORATORY REPORT:
{{
  "tests": [
    {{
      "test_name": "complete name of test",
      "value": "result value with unit",
      "reference_range": "normal range if provided or null",
      "flag": "high/low/normal/critical if indicated or null",
      "date": "test date if present"
    }}
  ]
}}

BRONCHOSCOPY:
{{
  "indication": "reason for bronchoscopy",
  "findings": "bronchoscopic findings",
  "biopsy_taken": "whether biopsy was performed",
  "biopsy_result": "pathology result if available or null",
  "procedure_details": "details of procedure"
}}


INSURANCE DOCUMENT — DOCUMENT_CATEGORIES["insurance"]:

{{
  "category": {{
    "key": "insurance",
    "name": "Insurance & Billing Documents"
  }},
  "subcategory": {{
    "key": "insurance_documents | billing",
    "name": "Insurance Documentation | Billing Records"
  }},
  "test": {{
    "name": "EXACT MATCH FROM TAXONOMY TEST LIST"
  }},
  "report": {{
    "sections": {{
      "section_key": {{
        "fields": {{
          "field_label": "field_value_or_placeholder_text"
        }}
      }}
    }}
  }}
}}
FOR ANY UNLISTED REPORT TYPE:
Create an appropriate schema that captures:
- All measurements with units
- All observations and findings
- Temporal information
- Treatment or procedural details
- Interpretations and impressions
- Recommendations
UNIVERSAL FIELDS (STRICT — DO NOT INFER):

📅 REPORT DATE EXTRACTION RULE (UPDATED — STRICT SOURCE-BOUND):

- report_date MUST be extracted if ANY ONE of the following labels
  appears explicitly in the DOCUMENT TEXT:

  "Report Date"
  "Reported On"
  "Date"
  "Date of Report"
  "Sample Coll Dt"
  "Sample Collection Date"
  "Sample Coll Dt /time"
  "Auth Dt"
  "Auth Dt /time"
  "Authorized Date"
  "Exam Date"
  "Reported"

- Use the FIRST matching date found in top-to-bottom reading order
- Copy the date string CHARACTER-FOR-CHARACTER exactly as written
- DO NOT reformat, infer, or normalize the date
- If NO such labeled date exists → set "report_date": "null"


- ordering_provider:
Extract ONLY if explicitly labeled (e.g., "Ordered By", "Referring Doctor")

- performing_provider:
Extract ONLY if explicitly labeled (e.g., "Performed By", "Consultant")

- facility_name:
Extract ONLY if clearly stated as hospital/lab name in header

- department:
Extract ONLY if explicitly labeled

- patient_age, patient_sex:
Extract ONLY if explicitly present
DO NOT infer from DOB or demographics tables


Before producing the final JSON output:

- Re-scan the DOCUMENT TEXT.
- For EACH extracted test, parameter, value, and date:
  → Confirm the EXACT SAME STRING appears verbatim in the DOCUMENT TEXT.
- If ANY extracted item does NOT appear verbatim:
  → DELETE that item from the output.
- If a test ends up with ZERO valid parameters:
  → DELETE the entire test.
- If a segment ends up empty:
  → DELETE the entire segment.
- It is STRICTLY FORBIDDEN to keep data “because it is typical”.
- EMPTY output is ALWAYS the correct choice if verification fails.

=== PHASE 4: CONDITION INFERENCE (OPTIONAL) ===

For each segment, optionally provide cautious clinical inference:

{{
  "condition_inference": "string OR null"
}}
Rules:
- Use ONLY cautious language: "may suggest", "could indicate", "is consistent with", "compatible with", "raises suspicion for"
- NEVER diagnose definitively
- NEVER express certainty
- Base strictly on extracted findings
- Examples:
  * "Left upper lobe lung mass with suspicion for malignancy requiring histopathological confirmation"
  * "Patient underwent CT-guided biopsy for tissue diagnosis of lung lesion"
- If inappropriate or insufficient data → return null

=== PHASE 5: QUALITY & VALIDATION CHECKS ===

For each segment, include quality assessment:

"quality_flags": {{
  "confidence": "high/medium/low",
  "requires_review": true/false,
  "mixed_content": false,
  "missing_expected_sections": []
}}

=== ABSOLUTE OUTPUT FORMAT ===

YOU MUST RETURN EXACTLY ONE VALID JSON OBJECT IN THIS FORMAT:

{{
  "document_summary": {{
    "total_segments": number,
    "report_types_found": ["list", "of", "types"],
    "processing_timestamp": "ISO timestamp"
  }},
  "segments": [
    {{
      "segment_id": "segment_1",
      "page_range": "1-3",
      "report_type": "discharge_summary",
      "classification_confidence": "high",
      "detected_boundaries": "Report title and structure analysis",
      "extracted_data": {{
        // Complete structured data using appropriate schema
      }},
      "condition_inference": "string or null",
      "quality_flags": {{
        "confidence": "high",
        "requires_review": false,
        "mixed_content": false
      }},
      "metadata": {{
        "report_date": "extracted date or null",
        "ordering_provider": "doctor name or null",
        "performing_provider": "provider name or null",
        "facility": "facility name or null",
        "department": "department name or null"
      }}
    }}
  ]
}}

=== ABSOLUTE PROHIBITIONS ===

YOU MUST NOT OUTPUT:
- Python code or any programming language
- Function definitions
- Import statements
- Variable assignments
- Comments or explanations
- Markdown formatting (```json, ```, etc.)
- Multiple JSON blocks
- Text before {{ or after }}
- Section headers like "PHASE 1:", "OUTPUT:", etc.

IF YOU OUTPUT ANYTHING OTHER THAN A SINGLE JSON OBJECT, YOUR RESPONSE IS COMPLETELY INVALID.

=== FINAL VALIDATION CHECKLIST ===

Before responding, verify:
✓ First character is {{
✓ Last character is }}
✓ No text outside the JSON object
✓ No Python code anywhere
✓ No markdown formatting
✓ All required fields present
✓ All extracted data based strictly on document text
✓ No hallucinated values

=== DOCUMENT TEXT ===
{text}

=== OUTPUT ONLY JSON BELOW THIS LINE ===
"""
    
    try:
        completion = groq_client.chat.completions.create(
            model="llama-3.1-8b-instant",
            messages=[{"role": "user", "content": prompt}],
            temperature=0.1,
            max_tokens=4000,
        )
        
        raw_output = completion.choices[0].message.content.strip()
        logger.info(f"🧠 LLM RAW OUTPUT (first 500 chars):\n{raw_output}...")
        
        state["raw_llm_output"] = raw_output
        state["retry_count"] = state.get("retry_count", 0)
        
        return state
        
    except Exception as e:
        logger.error(f"❌ LLM extraction failed: {str(e)}")
        state["error"] = f"LLM extraction error: {str(e)}"
        return state


def normalize_with_llm(state: ProcessingState) -> ProcessingState:

    """
    Normalize extracted data using LLM with COMPLETE prompt.
    
    Args:
        state: Current processing state
        
    Returns:
        Updated state with normalized output
    """
    extracted_text = state.get("raw_llm_output", "")
    
    if not extracted_text:
        state["error"] = "No extracted text to normalize"
        return state
    
    document_categories_str = json.dumps(DOCUMENT_CATEGORIES, indent=2)
    
    prompt = (
    "YOU ARE A MEDICAL DOCUMENT NORMALIZATION ENGINE.\n"
    "Your ONLY task is to normalize extracted medical document data into a SINGLE\n"
    "clean JSON object that follows the EXACT schema defined below.\n\n"

    "🚨 ABSOLUTE OUTPUT RULES (NO EXCEPTIONS):\n"
    "1. OUTPUT MUST BE A SINGLE VALID JSON OBJECT ONLY\n"
    "2. NO explanations, comments, markdown, or code\n"
    "3. NO text before or after JSON\n"
    "4. NEVER invent, infer, or guess any data\n"
    "5. INCLUDE ONLY information present in the input\n\n"

    "📐 REQUIRED OUTPUT SCHEMA (MANDATORY — EXACTLY THIS):\n"
    "{\n"
    "  \"documents\": [\n"
    "    {\n"
    "      \"category\": { \"key\": \"string\", \"name\": \"string\" },\n"
    "      \"subcategory\": { \"key\": \"string\", \"name\": \"string\" },\n"
    "      \"test\": { \"name\": \"string\" },\n"
    "      \"report\": { \"OBJECT WITH CLINICAL CONTENT\" },\n"
    "      \"report_date\": \"string\"\n"
    "    }\n"
    "  ]\n"
    "}\n\n"

    "📋 INPUT DATA TO PROCESS:\n"
    f"{extracted_text}\n\n"

    "🏥 DOCUMENT TAXONOMY (AUTHORITATIVE — USE EXACTLY):\n"
    f"{document_categories_str}\n\n"

    "🎯 CRITICAL MAPPING RULES:\n"
    "1. category.key MUST come ONLY from the document taxonomy\n"
    "2. subcategory.key MUST come ONLY from the document taxonomy\n"
    "3. test.name MUST come ONLY from the document taxonomy\n"
    "4. category.name MUST EXACTLY MATCH the taxonomy name\n"
    "5. subcategory.name MUST EXACTLY MATCH the taxonomy name\n"
    "6. test.name MUST EXACTLY MATCH the taxonomy value (case-sensitive)\n"
    "7. test.name MUST belong to the selected category AND subcategory\n"
    "8. NEVER derive, normalize, paraphrase, or construct names\n"
    "9. If NO exact match exists for category, subcategory, OR test — OMIT the document\n"
    "10. Map using procedure_name, study_description, or clinical content ONLY\n"
    "11. If multiple documents exist, create MULTIPLE objects inside documents[]\n"
    "12. NEVER merge multiple reports into one document object\n"
    "13. Choose the MOST SPECIFIC test name when ambiguous\n\n"

    "🔤 KEY RULE — USE ONLY TAXONOMY NAMES:\n"
    "1. test.name, category.key, and subcategory.key MUST ONLY use names from the document taxonomy\n"
    "2. DO NOT use any names that appear in extracted_text but are NOT in the taxonomy\n"
    "3. Even if extracted_text contains similar or related names, ONLY use exact matches from taxonomy\n"
    "4. If extracted_text contains 'CT Scan Abdomen' but taxonomy has 'CT Abdomen', use taxonomy name\n"
    "5. If extracted_text contains 'CBC Test' but taxonomy has 'Complete Blood Count', use taxonomy name\n\n"

    "🧪 TEST NAME ENFORCEMENT (ABSOLUTE):\n"
    "1. test.name is a taxonomy-bound field — NO free text allowed\n"
    "2. Partial, fuzzy, or semantic matches are FORBIDDEN\n"
    "3. If taxonomy does not contain the test, the document is INVALID\n"
    "4. DO NOT use extracted_text test names — ONLY use taxonomy test names\n\n"

    "🔑 CATEGORY/SUBCATEGORY KEY ENFORCEMENT:\n"
    "1. category.key and subcategory.key MUST ONLY come from taxonomy\n"
    "2. Even if extracted_text mentions different category/subcategory names, ignore them\n"
    "3. ONLY use the keys defined in the document taxonomy\n"
    "4. Map based on the test name's position in the taxonomy hierarchy\n\n"

    "🧪 LAB REPORT STRUCTURING RULES:\n"
    "1. If lab data includes value + unit + reference range, group under:\n"
    "   \"parameters\": { \"parameter_name\": { \"value\": \"string\", \"unit\": \"string\", \"reference_range\": \"string\" } }\n"
    "2. Preserve parameter names EXACTLY as in the source\n"
    "3. If only simple values exist, include them directly in report as \"value\": \"string\"\n\n"

    "🧠 PATHOLOGY RULES:\n"
    "1. Preserve diagnosis, grade, origin, stage, and notes EXACTLY\n"
    "2. DO NOT normalize or reinterpret medical terminology\n\n"

    "🖼️ IMAGING RULES:\n"
    "1. Imaging reports MUST include \"findings\" and/or \"impression\" if present\n"
    "2. findings may be STRING, ARRAY, or OBJECT — preserve original structure\n"
    "3. DO NOT rename organs or anatomical terms\n\n"

    "🔄 CT SCAN NAME NORMALIZATION (APPLY EXACTLY):\n"
    "• 'CT PLAIN & CONTRAST OF ABDOMEN' → Use taxonomy name for CT Abdomen\n"
    "• 'CT ABDOMEN WITH CONTRAST' → Use taxonomy name for CT Abdomen (Contrast)\n"
    "• 'CT ABDOMEN PLAIN' → Use taxonomy name for CT Abdomen (Plain)\n"
    "• 'CT KUB NCCT' → Use taxonomy name for CT KUB (Non-Contrast)\n"
    "• 'CT CHEST WITH CONTRAST' → Use taxonomy name for CT Chest (Contrast)\n"
    "• 'CT BRAIN PLAIN' → Use taxonomy name for CT Brain (Plain)\n\n"

    "❌ FORBIDDEN OUTPUT (NEVER USE):\n"
    "- Dynamic JSON keys for test names\n"
    "- category or subcategory as arrays\n"
    "- procedure_name or study_description as keys\n"
    "- Flattening or restructuring clinical content\n"
    "- Any names from extracted_text that don't match taxonomy exactly\n"
    "- patient_info, name, age, sex, patient_id, patient_age, patient_sex fields\n"
    "- Numeric values without quotes\n\n"

    "🧹 REMOVE THESE FIELDS COMPLETELY IF PRESENT:\n"
    "patient_info, patient_name, patient_age, patient_sex, patient_id, \n"
    "procedure_name, study_description, ordering_provider, performing_provider, \n"
    "facility, department, metadata, page_range, classification_confidence, \n"
    "discharge_date, reported_on\n\n"

    "📅 REPORT DATE RULE:\n"
    "1. Use report_date from document if available\n"
    "2. Otherwise extract date from clinical content\n"
    "3. If no date exists, set report_date to \"null\" (as string)\n"
    "4. report_date MUST be a string in YYYY-MM-DD format or \"null\"\n"
    "5. Add report_date as a top-level field in EACH document object\n\n"

    "🔍 CLINICAL CONTENT PRESERVATION:\n"
    "1. Preserve ALL clinical content exactly as provided\n"
    "2. DO NOT rename keys, values, organs, or parameters\n"
    "3. DO NOT collapse or flatten nested objects\n"
    "4. Use \"null\" for missing values — NEVER guess\n"
    "5. DO NOT include patient demographics or identifying information\n\n"

    "⚠️ PATIENT INFO REMOVAL RULE:\n"
    "1. STRICTLY REMOVE ALL patient identifying information\n"
    "2. DO NOT include name, age, sex, or any patient demographics\n"
    "3. ONLY include clinical findings, test results, and report dates\n"
    "4. If input contains patient_info block, IGNORE it completely\n\n"

    "⚠️ STRING-ONLY VALUE RULE (CRITICAL):\n"
    "1. ALL values in the JSON MUST be strings (enclosed in double quotes)\n"
    "2. NO numeric values without quotes - use strings for everything\n"
    "3. Examples:\n"
    "   - CORRECT: \"value\": \"3.9 mil/L\"\n"
    "   - CORRECT: \"value\": \"1.1\"\n"
    "   - CORRECT: \"value\": \"45\"\n"
    "   - CORRECT: \"reference_range\": \"4.5 - 5.5\"\n"
    "   - CORRECT: \"unit\": \"mil/L\"\n"
    "   - INCORRECT: \"value\": 3.9 mil/L\n"
    "   - INCORRECT: \"value\": 1.1\n"
    "   - INCORRECT: \"value\": 45\n"
    "4. Even pure numbers must be quoted as strings\n"
    "5. null values must be the string \"null\" not JSON null\n"
    "6. This prevents JSON parsing errors with values like \"3.9 mil/L\"\n\n"
    
    "🔒 JSON KEY SAFETY RULE (CRITICAL — ABSOLUTE):"
    "1. ALL JSON OBJECT KEYS MUST BE SAFE, MACHINE-READABLE STRINGS"
    "2. JSON KEYS MUST NOT contain:"
    "- Double quotes (\")"
    "- Single quotes (')"
    "- Pipes (|)"
    "- Slashes (/ or \\)"
    "- Colons (:)"
    "- Parentheses ()"
    "- OCR noise or special symbols"
    "3. NEVER copy OCR text verbatim as JSON keys"
    "4. NEVER include measurement units, ranges, or symbols inside keys"
    "5. USE clean medical identifiers ONLY for keys"

    "✅ ALLOWED KEY FORMAT:"
    "- Letters, numbers, underscores only"
    "- Examples:"
    "- \"hemoglobin\""
    "- \"rbc_count\""
    "- \"mean_corpuscular_volume\""
    "- \"platelet_count\""

    "❌ FORBIDDEN KEY EXAMPLES (NEVER USE):"
    "- \"eo\\\" Corpuscular Hb | MCH\""
    "- \"Mean Corpuscular Volume | MCV\""
    "- \"Hb(g/dL)\""
    "- \"WBC / cumm\""
    "- \"Na+ (mmol/L)\""

    "6. If the original parameter name is complex or messy:"
    "- MOVE the exact original name into the VALUE"
    "- Use a clean key"

    "✅ CORRECT EXAMPLE:"
    "\"mean_corpuscular_hemoglobin\": {"
    "  \"original_name\": \"Mean Corpuscular Hb | MCH\","
    "  \"value\": \"31.3\","
    "  \"unit\": \"pg\","
    "  \"reference_range\": \"27 - 33\""
    "}"

    "7. NEVER allow invalid JSON even if it means DROPPING a parameter"
    "8. VALID JSON IS MORE IMPORTANT THAN COMPLETENESS"

    "⚠️ JSON ESCAPING RULE:\n"
    "1. Escape all special characters in strings\n"
    "2. Double quotes inside strings: \\\"\n"
    "3. Backslashes: \\\\\n"
    "4. Forward slashes: \\/\n"
    "5. Control characters: use \\uXXXX notation\n\n"

    "⚠️ FINAL RULE:\n"
    "If NO valid documents can be mapped, output exactly: {}\n\n"

    "🚀 BEGIN JSON OUTPUT NOW — STRICT JSON ONLY (ALL VALUES AS STRINGS):"
)


    
    try:
        completion = groq_client.chat.completions.create(
            model="llama-3.1-8b-instant",
            messages=[{"role": "user", "content": prompt}],
            temperature=0.1,
            max_tokens=6000,
        )
        
        raw_output = completion.choices[0].message.content.strip()
        logger.info(f"📝 Normalization RAW OUTPUT (first 500 chars):\n{raw_output}...")
        
        state["normalized_output"] = raw_output
        
        return state
        
    except Exception as e:
        logger.error(f"❌ Normalization failed: {str(e)}")
        state["error"] = f"Normalization error: {str(e)}"
        return state


def sanitize_output(state: ProcessingState) -> ProcessingState:
    """
    Sanitize and validate JSON output.
    
    Args:
        state: Current processing state
        
    Returns:
        Updated state with sanitized output
    """
    raw_output = state.get("normalized_output", "")
    
    if not raw_output:
        state["error"] = "No output to sanitize"
        return state
    
    try:
        # Sanitize the output
        sanitized = sanitize_json_string(raw_output)
        
        # Validate it's valid JSON
        parsed = json.loads(sanitized)

        # 🔧 REMOVE documents that contain only "null" values
        filtered_documents = []

        for doc in parsed.get("documents", []):
            report = doc.get("report", {})

            # Case 1: report is {"value": "null"}
            if report == {"value": "null"}:
                continue

            # Case 2: report.parameters exists but all values are "null"
            parameters = report.get("parameters")
            if isinstance(parameters, dict):
                has_real_value = False
                for param in parameters.values():
                    if isinstance(param, dict) and param.get("value") not in ("null", "", None):
                        has_real_value = True
                        break
                if not has_real_value:
                    continue

            filtered_documents.append(doc)

        parsed["documents"] = filtered_documents

        state["sanitized_output"] = json.dumps(parsed)
        state["final_output"] = state["sanitized_output"]

        logger.info("✅ Output sanitized, filtered, and validated successfully")

        
        return state
        
    except Exception as e:
        logger.error(f"❌ Sanitization failed: {str(e)}")
        state["sanitized_output"] = json.dumps({"documents": []})
        state["final_output"] = json.dumps({"documents": []})
        return state


def save_documents(state: ProcessingState) -> ProcessingState:
    """
    Save normalized documents to appropriate endpoints.
    
    Args:
        state: Current processing state
        
    Returns:
        Updated state with save results
    """
    import requests
    
    sanitized_output = state.get("sanitized_output", "")
    patient_id = state.get("patient_id", "")
    doctor_id = state.get("doctor_id", "")
    base_url = state.get("base_url", "")
    
    if not sanitized_output:
        state["error"] = "No sanitized output to save"
        return state
    
    try:
        parsed: NormalizedOutput = json.loads(sanitized_output)
        documents = parsed.get("documents", [])
        results: List[SaveResult] = []
        
        for doc in documents:
            category_key = doc.get("category", {}).get("key")
            subcategory_key = doc.get("subcategory", {}).get("key")
            test_name = doc.get("test", {}).get("name")
            report = doc.get("report", {})

            # ❌ Skip invalid documents
            if not category_key or not test_name:
                continue

            # ❌ Skip empty or null-only reports
            if not report:
                continue

            if report == {"value": "null"}:
                continue

            parameters = report.get("parameters")
            if isinstance(parameters, dict):
                has_real_value = False
                for p in parameters.values():
                    if isinstance(p, dict) and p.get("value") not in ("null", "", None):
                        has_real_value = True
                        break
                if not has_real_value:
                    continue

            
            endpoint = SAVE_ENDPOINTS.get(category_key)
            if not endpoint:
                continue
            
            # Build payload
            if category_key == "insurance":
                payload = {
                    "patient_id": patient_id,
                    "raw_data": [state.get("text", "")]
                }

            # ================= NORMAL DOCUMENT FLOW =================
            else:
                payload: SavePayload = {
                    "patient_id": patient_id,
                    "doctor_id": doctor_id,
                    "document_type": test_name,
                    "report": doc.get("report", {}),
                    "report_date": doc.get("report_date"),
                    "metadata": {
                        "normalized_by": "llm",
                        "source_category": category_key,
                        "subcategory": subcategory_key
                    }
                }
            
            # Add category-specific fields
            if category_key == "imaging":
                payload["imaging_type"] = subcategory_key
            elif category_key == "laboratory":
                payload["document_subtype"] = subcategory_key
            
            try:
                response = requests.post(
                    f"{base_url}{endpoint}",
                    json=payload,
                    timeout=10
                )
                
                results.append({
                    "category": category_key,
                    "subcategory": subcategory_key,
                    "test_name": test_name,
                    "status_code": response.status_code,
                    "response": response.json()
                })
                
                logger.info(f"✅ Saved {test_name}: {response.status_code}")
                
            except Exception as e:
                results.append({
                    "category": category_key,
                    "subcategory": subcategory_key,
                    "test_name": test_name,
                    "status": "failed",
                    "error": str(e)
                })
                logger.error(f"❌ Failed to save {test_name}: {str(e)}")
        
        state["save_results"] = results
        logger.info(
            "💾 Save operation completed: %d documents processed out of %d",
            len(results),
            len(documents)
        )

        
        return state
        
    except Exception as e:
        logger.error(f"❌ Save documents failed: {str(e)}")
        state["error"] = f"Save error: {str(e)}"
        return state


def handle_error(state: ProcessingState) -> ProcessingState:
    """
    Handle errors and prepare fallback response.
    
    Args:
        state: Current processing state
        
    Returns:
        Updated state with error handling
    """
    error = state.get("error", "Unknown error")
    logger.error(f"🚨 Error handler triggered: {error}")
    
    state["final_output"] = json.dumps({"documents": []})
    state["save_results"] = []
    
    return state


# =====================================================================
# LANGGRAPH WORKFLOW DEFINITION
# =====================================================================

def create_processing_workflow() -> StateGraph:
    """
    Create the LangGraph workflow for document processing.
    
    Returns:
        Compiled StateGraph workflow
    """
    # Create the graph
    workflow = StateGraph(ProcessingState)
    
    # Add nodes
    workflow.add_node("validate_input", validate_input)
    workflow.add_node("extract_with_llm", extract_with_llm)
    workflow.add_node("normalize_with_llm", normalize_with_llm)
    workflow.add_node("sanitize_output", sanitize_output)
    workflow.add_node("save_documents", save_documents)
    workflow.add_node("handle_error", handle_error)
    
    # Define conditional edges
    def should_continue_after_validation(state: ProcessingState) -> str:
        if state.get("error"):
            return "handle_error"
        return "extract_with_llm"
    
    def should_continue_after_extraction(state: ProcessingState) -> str:
        if state.get("error"):
            return "handle_error"
        return "normalize_with_llm"
    
    def should_continue_after_normalization(state: ProcessingState) -> str:
        if state.get("error"):
            return "handle_error"
        return "sanitize_output"
    
    def should_continue_after_sanitization(state: ProcessingState) -> str:
        if state.get("error"):
            return "handle_error"
        return "save_documents"
    
    # Set entry point
    workflow.set_entry_point("validate_input")
    
    # Add conditional edges
    workflow.add_conditional_edges(
        "validate_input",
        should_continue_after_validation,
        {
            "extract_with_llm": "extract_with_llm",
            "handle_error": "handle_error"
        }
    )
    
    workflow.add_conditional_edges(
        "extract_with_llm",
        should_continue_after_extraction,
        {
            "normalize_with_llm": "normalize_with_llm",
            "handle_error": "handle_error"
        }
    )
    
    workflow.add_conditional_edges(
        "normalize_with_llm",
        should_continue_after_normalization,
        {
            "sanitize_output": "sanitize_output",
            "handle_error": "handle_error"
        }
    )
    
    workflow.add_conditional_edges(
        "sanitize_output",
        should_continue_after_sanitization,
        {
            "save_documents": "save_documents",
            "handle_error": "handle_error"
        }
    )
    
    # Add edges to END
    workflow.add_edge("save_documents", END)
    workflow.add_edge("handle_error", END)
    
    # Compile the graph
    return workflow.compile()


# =====================================================================
# MAIN ENTRY POINT FUNCTION
# =====================================================================

def run_lab_biomarker_llm(
    *,
    text: str,
    doctor_id: Optional[str] = None,
    patient_id: Optional[str] = None,
    base_url: str = f"{api_base_url}hms/users/data/context/"
) -> str:
    """
    Execute medical document processing workflow using LangGraph.
    
    Args:
        text: Medical document text to process
        doctor_id: Optional doctor identifier
        patient_id: Optional patient identifier
        base_url: Base URL for API endpoints
        
    Returns:
        JSON string with normalized documents
        
    Raises:
        ValueError: If input text is empty
    """
    if not text or not text.strip():
        raise ValueError("LLM input text is empty")
    
    logger.info("🚀 Starting document processing workflow")
    
    # Create workflow
    workflow = create_processing_workflow()
    
    # Initialize state
    initial_state: ProcessingState = {
        "text": text,
        "doctor_id": doctor_id,
        "patient_id": patient_id,
        "base_url": base_url,
        "retry_count": 0
    }
    
    try:
        # Run workflow
        final_state = workflow.invoke(initial_state)
        
        # Log results
        if final_state.get("save_results"):
            logger.info(f"💾 SAVE RESULTS:\n{json.dumps(final_state['save_results'], indent=2)}")
        
        # Return final output
        return {
            "raw_llm_output": final_state.get("raw_llm_output"),
            "normalized_output": final_state.get("final_output"),
        }
        
    except Exception as e:
        logger.error(f"❌ Workflow execution failed: {str(e)}")
        return json.dumps({"documents": []})


# =====================================================================
# BACKWARD COMPATIBILITY WRAPPER
# =====================================================================

def normalize_medical_documents_with_llm(extracted_text: str) -> str:
    """
    Legacy function for backward compatibility.
    
    Args:
        extracted_text: Extracted medical document text
        
    Returns:
        Normalized JSON string
    """
    logger.info("⚠️ Using legacy normalize_medical_documents_with_llm function")
    
    # Create a minimal workflow just for normalization
    workflow = StateGraph(ProcessingState)
    workflow.add_node("normalize", normalize_with_llm)
    workflow.add_node("sanitize", sanitize_output)
    workflow.set_entry_point("normalize")
    workflow.add_edge("normalize", "sanitize")
    workflow.add_edge("sanitize", END)
    
    compiled = workflow.compile()
    
    initial_state: ProcessingState = {
        "raw_llm_output": extracted_text,
        "text": "",
        "base_url": "",
        "retry_count": 0
    }
    
    try:
        result = compiled.invoke(initial_state)
        return result.get("final_output", json.dumps({"documents": []}))
    except Exception as e:
        logger.error(f"❌ Legacy normalization failed: {str(e)}")
        return json.dumps({"documents": []})


def save_normalized_documents_sync(
    sanitized_output: str,
    patient_id: str,
    doctor_id: str,
    base_url: str
) -> List[SaveResult]:
    """
    Legacy function for backward compatibility.
    
    Args:
        sanitized_output: Sanitized JSON output
        patient_id: Patient identifier
        doctor_id: Doctor identifier
        base_url: Base URL for API
        
    Returns:
        List of save results
    """
    logger.info("⚠️ Using legacy save_normalized_documents_sync function")
    
    # Create a minimal workflow just for saving
    workflow = StateGraph(ProcessingState)
    workflow.add_node("save", save_documents)
    workflow.set_entry_point("save")
    workflow.add_edge("save", END)
    
    compiled = workflow.compile()
    
    initial_state: ProcessingState = {
        "sanitized_output": sanitized_output,
        "patient_id": patient_id,
        "doctor_id": doctor_id,
        "base_url": base_url,
        "text": "",
        "retry_count": 0
    }
    
    try:
        result = compiled.invoke(initial_state)
        return result.get("save_results", [])
    except Exception as e:
        logger.error(f"❌ Legacy save failed: {str(e)}")
        return []
