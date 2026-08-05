import React, { useEffect, useState } from "react";
import { Save, Trash2 } from "lucide-react";
import { useLocation } from "react-router-dom";

/* ================= BRAND ================= */
const PRIMARY = "#005a8b";
const TEAL = "#00c2a7";
const BG = "#f4f7fb";

/* ================= UTIL ================= */
const API_BASE_URL = import.meta.env.VITE_BACKEND_URL;
const hexToRgba = (hex, alpha) => {
    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
};
const textarea = {
    width: "100%",
    padding: "14px",
    borderRadius: "14px",
    border: "1px solid #ddd",
    fontSize: "14px",
    lineHeight: 1.6,
    resize: "vertical",
};

const glass = {
    background: "rgba(255,255,255,0.75)",
    backdropFilter: "blur(24px)",
    borderRadius: "18px",
    border: "1px solid rgba(255,255,255,0.9)",
    boxShadow: "0 12px 30px rgba(0,0,0,0.08)",
};

/* ================= DOCUMENT TAXONOMY (SAMPLE) ================= */
/* 👉 You can paste your FULL HTML JSON here later */
const DOCUMENT_CATEGORIES = {
    laboratory: {
        name: "Laboratory & Pathology Reports",
        info: "All laboratory test results, pathology reports, and related diagnostic studies",
        subcategories: {
            routine_lab: {
                name: "Core Laboratory Panels (Routine)",
                tests: [
                    "Complete Blood Count",
                    "Hemoglobin & Hematocrit",
                    "Differential Count",
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
            cardiac_markers: {
                name: "Cardiac Biomarkers",
                tests: [
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
            tumor_markers: {
                name: "Tumor Markers & Cancer Biomarkers",
                tests: [
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
            diabetes_markers: {
                name: "Diabetes & Glycemic Markers",
                tests: [
                    "Glycated Albumin",
                    "C-Peptide",
                    "Insulin (Fasting)",
                    "Insulin (Postprandial)",
                    "Islet Cell Antibody",
                    "Glutamic Acid Decarboxylase Antibody (GAD)",
                    "Oral Glucose Tolerance Test (OGTT)"
                ]
            },
            hematology_specialized: {
                name: "Hematology & Iron Studies",
                tests: [
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
            vitamins_minerals: {
                name: "Vitamins & Minerals",
                tests: [
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
            gi_markers: {
                name: "Gastrointestinal Markers",
                tests: [
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
            sepsis_inflammation: {
                name: "Sepsis & Inflammatory Markers",
                tests: [
                    "Procalcitonin",
                    "Serum Lactate",
                    "Interleukin-6 (IL-6)",
                    "C-Reactive Protein (CRP)",
                    "Erythrocyte Sedimentation Rate (ESR)"
                ]
            },
            microbiology: {
                name: "Microbiology & Culture Tests",
                tests: [
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
            infectious_disease: {
                name: "Infectious Disease Serology",
                tests: [
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
            hormones_thyroid: {
                name: "Thyroid Function Tests",
                tests: [
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
            hormones_adrenal: {
                name: "Adrenal Function Tests",
                tests: [
                    "Serum Cortisol (Morning)",
                    "Serum Cortisol (Evening)",
                    "Adrenocorticotropic Hormone (ACTH)",
                    "Aldosterone",
                    "Plasma Renin Activity",
                    "24-Hour Urinary Cortisol",
                    "Metanephrines"
                ]
            },
            hormones_reproductive: {
                name: "Reproductive Hormones",
                tests: [
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
            hormones_other: {
                name: "Other Hormones & Growth Factors",
                tests: [
                    "Parathyroid Hormone (PTH)",
                    "Insulin-like Growth Factor 1 (IGF-1)",
                    "Growth Hormone",
                    "Calcitonin",
                    "Vitamin D (1,25-Dihydroxy)"
                ]
            },
            immunology: {
                name: "Immunological & Autoimmune Markers",
                tests: [
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
            pathology_histology: {
                name: "Histopathology & Cytology",
                tests: [
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
            arterial_blood_gas: {
                name: "Blood Gas Analysis",
                tests: [
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
    imaging: {
        name: "Imaging & Radiology Reports",
        info: "All radiological imaging studies and diagnostic imaging reports",
        subcategories: {
            xray: {
                name: "Plain Radiography (X-ray)",
                tests: [
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
            ultrasound: {
                name: "Ultrasonography (USG)",
                tests: [
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
            obstetric_ultrasound: {
                name: "Obstetric Ultrasonography",
                tests: [
                    "Ultrasound Early Pregnancy/Dating Scan",
                    "Ultrasound NT Scan (Nuchal Translucency)",
                    "Ultrasound Anomaly Scan (Level II)",
                    "Ultrasound Growth Scan (Third Trimester)",
                    "Ultrasound Follicular Study",
                    "Obstetric Doppler Study",
                    "Ultrasound Biophysical Profile (BPP)"
                ]
            },
            doppler: {
                name: "Doppler Studies",
                tests: [
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
            ct_scan: {
                name: "Computed Tomography (CT)",
                tests: [
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
            ct_angiography: {
                name: "CT Angiography",
                tests: [
                    "CT Angiography Brain",
                    "CT Angiography Coronary (CTCA)",
                    "CT Pulmonary Angiography (CTPA)",
                    "CT Aortography",
                    "CT Peripheral Angiography",
                    "CT Renal Angiography"
                ]
            },
            mri: {
                name: "Magnetic Resonance Imaging (MRI)",
                tests: [
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
            mri_specialized: {
                name: "Specialized MRI",
                tests: [
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
            cardiac_imaging: {
                name: "Cardiac Imaging",
                tests: [
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
            nuclear_medicine: {
                name: "Nuclear Medicine & PET Scans",
                tests: [
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
            interventional_radiology: {
                name: "Interventional & Fluoroscopy",
                tests: [
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
            mammography: {
                name: "Mammography",
                tests: [
                    "Mammography (Bilateral)",
                    "Digital Mammography",
                    "Tomosynthesis (3D Mammography)"
                ]
            },
            dexa_scan: {
                name: "Bone Density",
                tests: [
                    "DEXA Scan (Bone Densitometry)",
                    "DEXA Spine",
                    "DEXA Hip"
                ]
            }
        }
    },
    functional: {
        name: "Functional & Special Tests",
        info: "Physiological function tests, endoscopy, and specialized diagnostic procedures",
        subcategories: {
            pulmonary: {
                name: "Pulmonary Function Tests (PFTs)",
                tests: [
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
            cardiac_tests: {
                name: "Cardiac Functional Tests",
                tests: [
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
            neurophysiology: {
                name: "Neurophysiological Tests",
                tests: [
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
            endoscopy_gi: {
                name: "Gastrointestinal Endoscopy",
                tests: [
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
            endoscopy_respiratory: {
                name: "Respiratory Endoscopy",
                tests: [
                    "Bronchoscopy",
                    "Flexible Bronchoscopy",
                    "Rigid Bronchoscopy",
                    "Bronchoalveolar Lavage (BAL)",
                    "Endobronchial Biopsy",
                    "CT Virtual Bronchoscopy"
                ]
            },
            endoscopy_urological: {
                name: "Urological Endoscopy",
                tests: [
                    "Cystoscopy",
                    "Ureteroscopy",
                    "Bladder Lesion Evaluation"
                ]
            },
            endoscopy_gynecological: {
                name: "Gynecological Endoscopy",
                tests: [
                    "Hysteroscopy",
                    "Colposcopy",
                    "Laparoscopy (Diagnostic)"
                ]
            },
            endoscopy_joint: {
                name: "Joint Endoscopy",
                tests: [
                    "Arthroscopy (Diagnostic) - Knee",
                    "Arthroscopy (Diagnostic) - Shoulder",
                    "Arthroscopy (Diagnostic) - Hip",
                    "Arthroscopy (Diagnostic) - Ankle"
                ]
            },
            gi_manometry: {
                name: "GI Motility & Manometry",
                tests: [
                    "Anorectal Manometry",
                    "Esophageal Manometry",
                    "24 Hour pH Monitoring",
                    "Impedance pH Study",
                    "Small Bowel Manometry"
                ]
            },
            urodynamics: {
                name: "Urodynamic Studies",
                tests: [
                    "Urodynamic Study (Complete)",
                    "Cystometrogram",
                    "Uroflowmetry",
                    "Pressure Flow Study",
                    "Post-Void Residual Volume",
                    "Ambulatory Urodynamic Study"
                ]
            },
            sleep_studies: {
                name: "Sleep Studies",
                tests: [
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
            audiology: {
                name: "Audiology & Vestibular Tests",
                tests: [
                    "Pure Tone Audiometry (PTA)",
                    "Speech Audiometry",
                    "Tympanometry",
                    "Impedance Audiometry",
                    "Auditory Brainstem Response (ABR)",
                    "Otoacoustic Emissions (OAE)",
                    "Vestibular Function Tests"
                ]
            },
            ophthalmology: {
                name: "Ophthalmological Tests",
                tests: [
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
            cognitive_assessment: {
                name: "Cognitive & Psychological Assessment",
                tests: [
                    "Mini-Mental State Examination (MMSE)",
                    "Montreal Cognitive Assessment (MoCA)",
                    "Glasgow Coma Scale (GCS)",
                    "Neuropsychological Testing"
                ]
            },
            rehabilitation: {
                name: "Physical Medicine & Rehabilitation",
                tests: [
                    "Gait Analysis",
                    "Range of Motion Assessment",
                    "Functional Independence Measure (FIM)",
                    "Diagnostic Nerve Block Test"
                ]
            }
        }
    },
    clinical: {
        name: "Clinical Notes & Records",
        info: "Clinical documentation, progress notes, and medical records",
        subcategories: {
            admission: {
                name: "Admission Records",
                tests: [
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
            progress_notes: {
                name: "Progress Notes",
                tests: [
                    "Daily Progress Note",
                    "SOAP Note",
                    "Consultant Note",
                    "Specialty Consultation Report",
                    "Follow-up Note",
                    "Telephone Encounter Note",
                    "Clinical Note"
                ]
            },

        }
    },
    surgical: {
        name: "Surgical & Procedure Records",
        info: "Surgical documentation, operative notes, and procedure records",
        subcategories: {
            preoperative: {
                name: "Pre-Operative Records",
                tests: [
                    "Pre-Operative Assessment",
                    "Pre-Anesthetic Evaluation",
                    "Surgical Consent Form",
                    "Pre-Operative Checklist",
                    "Surgical Safety Checklist (WHO)",
                    "Risk Assessment & Stratification"
                ]
            },
            operative: {
                name: "Operative Records",
                tests: [
                    "Operative Note",
                    "Procedure Note",
                    "Surgeon's Report",
                    "Anesthesia Record",
                    "Intra-Operative Nursing Note",
                    "Implant Documentation",
                    "Surgical Specimen Documentation"
                ]
            },
            postoperative: {
                name: "Post-Operative Records",
                tests: [
                    "Post-Operative Note",
                    "Post-Anesthesia Care Unit (PACU) Note",
                    "Recovery Room Record",
                    "Post-Operative Orders",
                    "Post-Operative Complications Note"
                ]
            },
            interventional: {
                name: "Interventional Procedures",
                tests: [
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
    pharmacy: {
        name: "Pharmacy & Medication Records",
        info: "Medication documentation, prescriptions, and drug therapy records",
        subcategories: {
            prescriptions: {
                name: "Prescriptions",
                tests: [
                    "Outpatient Prescription",
                    "Discharge Prescription",
                    "Controlled Substance Prescription",
                    "Chronic Disease Prescription",
                    "Electronic Prescription (e-Rx)"
                ]
            },
            medication_admin: {
                name: "Medication Administration",
                tests: [
                    "Medication Administration Record (MAR)",
                    "IV Medication Record",
                    "Controlled Drug Administration Record",
                    "PRN (As Needed) Medication Log",
                    "Medication Reconciliation Form"
                ]
            },
            pharmacy_review: {
                name: "Pharmacy Reviews",
                tests: [
                    "Pharmacist Consultation Note",
                    "Drug Interaction Check",
                    "Therapeutic Drug Monitoring Report",
                    "Adverse Drug Reaction Report",
                    "Medication Therapy Management (MTM)"
                ]
            }
        }
    },
    emergency: {
        name: "Emergency & Critical Care",
        info: "Emergency department and ICU documentation",
        subcategories: {
            emergency_records: {
                name: "Emergency Department Records",
                tests: [
                    "Emergency Department Triage Note",
                    "ED Physician Note",
                    "Trauma Documentation",
                    "FAST Scan Report",
                    "Emergency Procedure Note",
                    "ED Discharge Instructions",
                    "Against Medical Advice (AMA) Form"
                ]
            },
            critical_care: {
                name: "Critical Care Records",
                tests: [
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
    specialty: {
        name: "Specialty Department Records",
        info: "Specialty-specific clinical documentation",
        subcategories: {
            obstetrics: {
                name: "Obstetrics Records",
                tests: [
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
            gynecology: {
                name: "Gynecology Records",
                tests: [
                    "Gynecological Examination Note",
                    "Pap Smear Report",
                    "Cervical Biopsy Report",
                    "Endometrial Biopsy Report",
                    "Menstrual History",
                    "Contraception Counseling Note"
                ]
            },
            pediatrics: {
                name: "Pediatrics Records",
                tests: [
                    "Well Child Visit Note",
                    "Growth Chart",
                    "Developmental Milestone Assessment",
                    "Immunization Record",
                    "Pediatric Physical Examination",
                    "Newborn Screening Results"
                ]
            },
            oncology: {
                name: "Oncology Records",
                tests: [
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
            dialysis: {
                name: "Dialysis & Nephrology",
                tests: [
                    "Hemodialysis Session Record",
                    "Peritoneal Dialysis Record",
                    "Vascular Access Monitoring",
                    "Dialysis Adequacy (Kt/V) Report",
                    "Renal Biopsy Report"
                ]
            },
            rehabilitation: {
                name: "Rehabilitation Records",
                tests: [
                    "Physical Therapy Evaluation",
                    "Physical Therapy Progress Note",
                    "Occupational Therapy Evaluation",
                    "Speech Therapy Evaluation",
                    "Rehabilitation Plan of Care"
                ]
            },
            psychiatry: {
                name: "Psychiatry Records",
                tests: [
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
    discharge: {
        name: "Discharge & Summary Documents",
        info: "Discharge documentation and clinical summaries",
        subcategories: {
            discharge_summary: {
                name: "Discharge Documentation",
                tests: [
                    "Discharge Summary",
                    "Discharge Instructions",
                    "Discharge Medication List",
                    "Discharge Against Medical Advice (DAMA)",
                    "Transfer Summary",
                    "Death Summary",
                    "Post-Discharge Follow-up Plan"
                ]
            },
            clinical_summary: {
                name: "Clinical Summaries",
                tests: [
                    "Episode of Care Summary",
                    "Continuity of Care Document",
                    "Treatment Summary Report",
                    "Hospital Course Summary"
                ]
            }
        }
    },
    referral: {
        name: "Referral & Transfer Documents",
        info: "Inter-facility and inter-specialty referral documentation",
        subcategories: {
            referrals: {
                name: "Referral Documentation",
                tests: [
                    "Specialist Referral Letter",
                    "Primary Care Referral",
                    "Inter-Hospital Transfer Note",
                    "Emergency Transfer Documentation",
                    "Referral Response Letter"
                ]
            }
        }
    },
    administrative: {
        name: "Administrative & Consent Forms",
        info: "Administrative documentation and legal consent forms",
        subcategories: {
            consent_forms: {
                name: "Consent Forms",
                tests: [
                    "Informed Consent for Procedure",
                    "Informed Consent for Surgery",
                    "Anesthesia Consent",
                    "Blood Transfusion Consent",
                    "Research Study Consent",
                    "Photography/Video Consent",
                    "Release of Medical Records Authorization"
                ]
            },
            administrative_forms: {
                name: "Administrative Forms",
                tests: [
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
            medical_legal: {
                name: "Medical-Legal Documents",
                tests: [
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
    insurance: {
        name: "Insurance & Billing Documents",
        info: "Insurance claims, pre-authorization, and billing documentation",
        subcategories: {
            insurance_documents: {
                name: "Insurance Documentation",
                tests: [
                    "Insurance Verification Form",
                    "Pre-Authorization Request",
                    "Insurance Claim Form",
                    "Explanation of Benefits (EOB)",
                    "Coordination of Benefits",
                    "Letter of Medical Necessity"
                ]
            },
            billing: {
                name: "Billing Records",
                tests: [
                    "Itemized Bill",
                    "Invoice",
                    "Payment Receipt",
                    "Billing Statement",
                    "Cashless Treatment Approval"
                ]
            }
        }
    }
};

/* ================= API ================= */
const API = {
    document: {
        get: `${API_BASE_URL}hms/users/cm/storagehms/report-node/get`,
        generate:
            `${API_BASE_URL}hms/users/cm/storagehms/report-node/generate-rules`,
        save: `${API_BASE_URL}hms/users/cm/storagehms/report-node/save`,
    },
};

/* ================= COMPONENT ================= */
export default function ReportNode() {
    const location = useLocation();
    const doctorId = new URLSearchParams(location.search).get("doctor_id");

    /* ===== CATEGORY STATES ===== */
    const [mainCategory, setMainCategory] = useState("");
    const [subCategory, setSubCategory] = useState("");
    const [specificType, setSpecificType] = useState("");

    /* ===== RULE STATES ===== */
    const [analysisRules, setAnalysisRules] = useState({});
    const [availableOutputKeys, setAvailableOutputKeys] = useState([]);
    const [selectedOutputKeys, setSelectedOutputKeys] = useState([]);

    // Store generated rules to show in textarea
    const [generatedRulesList, setGeneratedRulesList] = useState([]);
    const [selectedAnalysisRule, setSelectedAnalysisRule] = useState("");

    const [loadingRules, setLoadingRules] = useState(false);
    const [saving, setSaving] = useState(false);

    /* ================= FETCH EXISTING CONFIG ================= */
    const fetchExisting = async () => {
        if (!doctorId || !specificType) return;

        try {
            const res = await fetch(
                `${API.document.get}?doctor_id=${doctorId}&doc_type=${specificType.toLowerCase()}`,
                { credentials: "include" }
            );

            if (!res.ok) return;
            const json = await res.json();

            if (json.status === "success") {
                // Set saved rule in textarea
                setSelectedAnalysisRule(json.data.analysis_rule_text || "");
                setSelectedOutputKeys(json.data.output_keys || []);
            }
        } catch (error) {
            console.error("Error fetching existing config:", error);
        }
    };

    useEffect(() => {
        // Clear states when specific type changes
        setAnalysisRules({});
        setAvailableOutputKeys([]);
        setSelectedOutputKeys([]);
        setGeneratedRulesList([]);
        setSelectedAnalysisRule("");
        
        // Fetch existing saved rule
        fetchExisting();
    }, [specificType]);

    /* ================= GENERATE RULES ================= */
    const handleGenerateRules = async () => {
        if (!doctorId || !specificType) {
            return alert("Please complete document classification");
        }

        try {
            setLoadingRules(true);
            const res = await fetch(API.document.generate, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                credentials: "include",
                body: JSON.stringify({
                    doctor_id: doctorId,
                    doc_type: specificType,
                    main_category: mainCategory,
                    sub_category: subCategory,
                }),
            });

            const json = await res.json();
            if (json.status === "success") {
                setAnalysisRules(json.data.analysis_rules || {});
                setAvailableOutputKeys(json.data.output_keys || []);
                
                // Store generated rules in an array to show in textarea
                const rulesArray = Object.values(json.data.analysis_rules || {})
                    .map(rule => rule.rule_sentence);
                setGeneratedRulesList(rulesArray);
                
                // If we have generated rules, show the first one in textarea
                if (rulesArray.length > 0 && !selectedAnalysisRule) {
                    setSelectedAnalysisRule(rulesArray[0]);
                }
            }
        } catch (error) {
            console.error("Error generating rules:", error);
            alert("Error generating rules. Please try again.");
        } finally {
            setLoadingRules(false);
        }
    };

    /* ================= SAVE ================= */
    const handleSave = async () => {
        if (
            !doctorId ||
            !specificType ||
            !selectedAnalysisRule 
        ) {
            return alert("Please complete all sections");
        }

        const payload = {
            doctor_id: doctorId,
            doc_type: specificType.toLowerCase(),
            analysis_rule_text: selectedAnalysisRule,
            output_keys: selectedOutputKeys,
        };
        
        console.log("Payload to be sent:", payload);
        try {
            setSaving(true);
            const res = await fetch(API.document.save, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                credentials: "include",
                body: JSON.stringify(payload),
            });
            
            const json = await res.json();
            if (json.status === "success") {
                alert("Saved successfully ✅");
            } else {
                alert("Save failed: " + (json.message || "Unknown error"));
            }
        } catch (error) {
            console.error("Error saving:", error);
            alert("Error saving. Please try again.");
        } finally {
            setSaving(false);
        }
    };

    /* ================= OUTPUT KEYS ================= */
    const addKey = (k) =>
        !selectedOutputKeys.includes(k) &&
        setSelectedOutputKeys((prev) => [...prev, k]);

    const removeKey = (k) =>
        setSelectedOutputKeys((prev) => prev.filter((x) => x !== k));

    /* ================= UI ================= */
    return (
        <div style={{ minHeight: "100vh", background: BG, padding: "2rem" }}>
            <div style={{ maxWidth: 1100, margin: "auto" }}>
                <div style={{ ...glass, padding: "1.2rem 1.5rem", display: "flex", justifyContent: "space-between" }}>
                    <h2 style={{ color: PRIMARY, fontWeight: 800 }}>
                        Report Node Configuration
                    </h2>
                    <button style={saveBtn} onClick={handleSave}>
                        <Save size={16} /> {saving ? "Saving..." : "Save"}
                    </button>
                </div>

                <div style={{ ...glass, padding: "1.5rem", marginTop: "1.2rem" }}>
                    <Section title="Document Classification">
                        <select
                            value={mainCategory}
                            onChange={(e) => {
                                setMainCategory(e.target.value);
                                setSubCategory("");
                                setSpecificType("");
                                setSelectedAnalysisRule(""); // Clear textarea when category changes
                            }}
                            style={input}
                        >
                            <option value="">Select Main Category</option>
                            {Object.entries(DOCUMENT_CATEGORIES).map(([k, v]) => (
                                <option key={k} value={k}>{v.name}</option>
                            ))}
                        </select>

                        {mainCategory && (
                            <select
                                value={subCategory}
                                onChange={(e) => {
                                    setSubCategory(e.target.value);
                                    setSpecificType("");
                                    setSelectedAnalysisRule(""); // Clear textarea when subcategory changes
                                }}
                                style={{ ...input, marginTop: 12 }}
                            >
                                <option value="">Select Sub-Category</option>
                                {Object.entries(
                                    DOCUMENT_CATEGORIES[mainCategory].subcategories
                                ).map(([k, v]) => (
                                    <option key={k} value={k}>{v.name}</option>
                                ))}
                            </select>
                        )}

                        {subCategory && (
                            <select
                                value={specificType}
                                onChange={(e) => setSpecificType(e.target.value)}
                                style={{ ...input, marginTop: 12 }}
                            >
                                <option value="">Select Specific Test / Document</option>
                                {DOCUMENT_CATEGORIES[mainCategory]
                                    .subcategories[subCategory]
                                    .tests.map((t) => (
                                        <option key={t} value={t}>{t}</option>
                                    ))}
                            </select>
                        )}
                    </Section>

                    <button 
                        onClick={handleGenerateRules} 
                        style={primaryBtn}
                        disabled={loadingRules || !specificType}
                    >
                        {loadingRules ? "Processing..." : "Generate Rules"}
                    </button>

                    {/* Always show the textarea section if we have a specific type selected */}
                    {specificType && (
                        <Section title="Analysis Rule">
                            <div style={{ marginBottom: "1rem", color: PRIMARY, fontWeight: 600 }}>
                                {selectedAnalysisRule ? "Edit Rule:" : "No rule selected. Click 'Generate Rules' or select a rule below."}
                            </div>
                            <textarea
                                value={selectedAnalysisRule}
                                onChange={(e) => setSelectedAnalysisRule(e.target.value)}
                                style={textarea}
                                rows={6}
                                placeholder="Analysis rule will appear here. You can edit it directly or select a generated rule below."
                            />
                        </Section>
                    )}

                    {/* Show generated rules as clickable cards */}
                    {generatedRulesList.length > 0 && (
                        <Section title="Generated Rules (Click to Select)">
                            <div style={{ marginBottom: "0.5rem", color: "#666", fontSize: "0.9rem" }}>
                                Click on any rule below to load it into the textarea above
                            </div>
                            {generatedRulesList.map((rule, i) => (
                                <RuleCard
                                    key={i}
                                    title={`Rule ${i + 1}`}
                                    text={rule}
                                    active={selectedAnalysisRule === rule}
                                    onClick={() => setSelectedAnalysisRule(rule)}
                                />
                            ))}
                        </Section>
                    )}

                    {/* Show output keys section */}
                  
                </div>
            </div>
        </div>
    );
}

/* ================= SMALL COMPONENTS ================= */
const Section = ({ title, children }) => (
    <div style={{ marginBottom: "1.5rem" }}>
        <h4 style={{ color: PRIMARY, marginBottom: "0.5rem" }}>{title}</h4>
        {children}
    </div>
);

const RuleCard = ({ title, text, onClick, active }) => (
    <div
        onClick={onClick}
        style={{
            padding: "14px",
            borderRadius: "14px",
            border: `2px solid ${active ? TEAL : "#e1e5ea"}`,
            marginBottom: "10px",
            cursor: "pointer",
            background: active ? hexToRgba(TEAL, 0.15) : "white",
            transition: "all 0.2s",
        }}
    >
        <strong style={{ color: active ? TEAL : PRIMARY }}>{title}</strong>
        <p style={{ marginTop: "8px", marginBottom: 0 }}>{text}</p>
    </div>
);

/* ================= STYLES ================= */
const input = {
    width: "100%",
    padding: "12px",
    borderRadius: "12px",
    border: "1px solid #ddd",
    fontSize: "14px",
};

const primaryBtn = {
    background: PRIMARY,
    color: "white",
    padding: "12px 20px",
    borderRadius: "12px",
    fontWeight: 700,
    border: "none",
    cursor: "pointer",
    marginTop: "12px",
    width: "100%",
    fontSize: "15px",
};

const saveBtn = {
    ...primaryBtn,
    display: "flex",
    alignItems: "center",
    gap: "6px",
    width: "auto",
    padding: "10px 20px",
};

const chipWrap = { display: "flex", flexWrap: "wrap", gap: "8px" };

const chip = {
    display: "inline-flex",
    alignItems: "center",
    gap: "6px",
    padding: "6px 12px",
    borderRadius: "20px",
    background: hexToRgba(TEAL, 0.15),
    cursor: "pointer",
    fontWeight: 600,
    fontSize: "14px",
    transition: "all 0.2s",
};