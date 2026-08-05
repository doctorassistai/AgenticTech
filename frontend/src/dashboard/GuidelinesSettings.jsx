import React, { useState, useEffect, useRef } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import {
  Save, Plus, X, Search, BookOpen, Tag,
  CheckCircle, ArrowLeft, FileText, Layers,
  Star, Eye, Heart, Activity, Brain, Bone,
  Droplets, Microscope, Stethoscope, Pill, Syringe,
  ChevronRight, Info, BookMarked, Sparkles,
  Home, Calendar, Notebook, LogOut,
} from "lucide-react";
import logo from "../assets/lodo_only.png";

const API_BASE_URL = import.meta.env.VITE_BACKEND_URL;

/* ─────────────────────────────────────────
   THEME TOKENS
───────────────────────────────────────── */
const T = {
  bg:        "#ffffff",
  bgAlt:     "#fafafa",
  bgTert:    "#f5f5f5",
  text:      "#000000",
  textSec:   "#444444",
  textMuted: "#888888",
  border:    "#e0e0e0",
  borderStr: "#000000",
  font:      "'Open Sans', sans-serif",
};

const SIDEBAR_W = "240px";

/* ─────────────────────────────────────────
   GLOBAL CSS
───────────────────────────────────────── */
const CSS = `
  @import url('https://fonts.googleapis.com/css2?family=Open+Sans:wght@300;400;600&display=swap');
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
  ::selection { background: #000; color: #fff; }
  body, html { font-family: ${T.font}; font-weight: 300; background: ${T.bg}; color: ${T.text}; -webkit-font-smoothing: antialiased; }
  input, select, textarea, button { font-family: ${T.font}; }

  .da-nav-btn { transition: background 0.15s, color 0.15s; }
  .da-nav-btn:hover { background: ${T.bgAlt} !important; color: ${T.text} !important; }
  .da-nav-btn.da-active { background: ${T.bgAlt} !important; color: ${T.text} !important; font-weight: 400 !important; border-left-color: ${T.borderStr} !important; }

  .da-btn-primary:hover  { background: transparent !important; color: ${T.text} !important; }
  .da-btn-outline:hover  { border-color: ${T.borderStr} !important; color: ${T.text} !important; }

  .da-guideline-card { transition: background 0.15s, border-color 0.15s; cursor: pointer; }
  .da-guideline-card:hover { background: ${T.bgAlt} !important; border-color: #c0c0c0 !important; }
  .da-guideline-card.da-selected { background: ${T.bgAlt} !important; border-color: ${T.borderStr} !important; border-left: 2px solid ${T.borderStr} !important; }

  .da-selected-item { animation: da-slideIn 0.18s ease; }
  @keyframes da-slideIn { from { opacity:0; transform:translateY(6px); } to { opacity:1; transform:translateY(0); } }
  @keyframes da-fadeIn  { from { opacity:0; } to { opacity:1; } }

  .da-sidebar-scroll::-webkit-scrollbar { display: none; }
  .da-sidebar-scroll { -ms-overflow-style: none; scrollbar-width: none; }

  .da-list-scroll { height: 100%; overflow-y: auto; }
  .da-list-scroll::-webkit-scrollbar { width: 3px; }
  .da-list-scroll::-webkit-scrollbar-thumb { background: ${T.border}; }

  .da-modal-overlay { animation: da-fadeIn 0.18s ease; }

  .da-input {
    width: 100%; height: 40px; padding: 0 0.875rem;
    border: 1px solid ${T.border}; background: ${T.bg};
    font-family: ${T.font}; font-weight: 300;
    font-size: 0.82rem; color: ${T.text};
    outline: none; transition: border-color 0.15s;
  }
  .da-input:focus { border-color: ${T.borderStr}; }
  .da-input::placeholder { color: #bbb; }
  textarea.da-input { height: auto; padding: 0.65rem 0.875rem; resize: vertical; }
`;

/* ─────────────────────────────────────────
   SHARED STYLE SNIPPETS
───────────────────────────────────────── */
const S = {
  secLabel: {
    fontSize: "0.6rem", textTransform: "uppercase",
    letterSpacing: "0.18em", color: T.textMuted,
    fontWeight: 400, display: "block", marginBottom: "0.2rem",
  },
  btnPrimary: {
    padding: "0.55rem 1.25rem",
    background: T.text, color: T.bg,
    border: `1px solid ${T.text}`,
    fontSize: "0.75rem", fontWeight: 400,
    cursor: "pointer", fontFamily: T.font,
    transition: "all 0.15s",
    display: "inline-flex", alignItems: "center", gap: "6px",
    letterSpacing: "0.04em",
  },
  btnOutline: {
    padding: "0.55rem 1.25rem",
    background: T.bg, color: T.textSec,
    border: `1px solid ${T.border}`,
    fontSize: "0.75rem", fontWeight: 300,
    cursor: "pointer", fontFamily: T.font,
    transition: "all 0.15s",
    display: "inline-flex", alignItems: "center", gap: "6px",
  },
  panelHeader: {
    display: "flex", justifyContent: "space-between", alignItems: "center",
    padding: "0.75rem 1rem",
    background: T.bgAlt, borderBottom: `1px solid ${T.border}`,
    flexShrink: 0,
  },
  panelTitle: {
    fontSize: "0.72rem", fontWeight: 400,
    textTransform: "uppercase", letterSpacing: "0.12em", color: T.text,
    display: "flex", alignItems: "center", gap: "6px",
  },
  badge: {
    padding: "0.18rem 0.5rem",
    border: `1px solid ${T.border}`,
    fontSize: "0.6rem", fontWeight: 400,
    textTransform: "uppercase", letterSpacing: "0.08em",
    color: T.textMuted, display: "inline-block",
  },
};

/* ─────────────────────────────────────────
   DATA
───────────────────────────────────────── */
const SPECIALIZATION_MAP = {
  "general medicine": "general", "general": "general",
  
  "emergency medicine": "emergency", "emergency": "emergency",
  "cardiology": "cardiology",
  "pulmonology": "pulmonology",
  "endocrinology": "endocrinology",
  "gastroenterology": "gastroenterology",
  "nephrology": "nephrology",

  "medical oncology": "medical_oncology",
  "chemotherapy": "chemotherapy",
  "immunotherapy": "immunotherapy",
  "targeted therapy": "targeted_therapy",
  "hormone therapy": "hormone_therapy",
  "precision oncology": "precision_oncology",
  "radiation oncology": "radiation_oncology",
  "external beam radiotherapy": "external_beam_radiotherapy",
  "brachytherapy": "brachytherapy",
  "stereotactic radiosurgery": "stereotactic_radiosurgery",
  "surgical oncology": "surgical_oncology",
  "curative surgery": "curative_surgery",
  "cytoreductive surgery": "cytoreductive_surgery",
  "reconstructive surgery": "reconstructive_surgery",
  "breast oncology": "breast_oncology",
  "thoracic oncology": "thoracic_oncology",
  "gastrointestinal oncology": "gastrointestinal_oncology",
  "gynecologic oncology": "gynecologic_oncology",
  "urologic oncology": "urologic_oncology",
  "head and neck oncology": "head_neck_oncology",
  "neuro-oncology": "neuro_oncology",
  "pediatric oncology": "pediatric_oncology",
  "hematologic oncology": "hematologic_oncology",
  "imaging oncology": "imaging_oncology",
  "pathology": "pathology",
  "histopathology": "histopathology",
  "cytology": "cytology",
  "molecular pathology": "molecular_pathology",
  "molecular oncology": "molecular_oncology",
  "biomarker analysis": "biomarker_analysis",
  "nuclear medicine": "nuclear_medicine",
  "interventional oncology": "interventional_oncology",
  "ablation therapies": "ablation_therapies",
  "embolization": "embolization",
  "research oncology": "research_oncology",
  "palliative oncology": "palliative_oncology",
  "pain management": "pain_management",
  "rehabilitation oncology": "rehabilitation_oncology",
  "nutritional oncology": "nutritional_oncology",
  "psycho-oncology": "psycho_oncology",
  "preventive oncology": "preventive_oncology",
  "cancer screening programs": "cancer_screening_programs",
  "genetic counseling": "genetic_counseling"
};

const GUIDELINES_BY_SPECIALIZATION = {
  general: [
    { id:1,  title:"WHO Guidelines",              reference:"World Health Organization, CDC, United Nations",                              explanation:"Global health recommendations for disease prevention, vaccination, and public health systems.",           category:"General",      icon:"Stethoscope" },
    { id:2,  title:"NICE Guidelines",             reference:"National Institute for Health and Care Excellence, NHS England",               explanation:"Evidence-based clinical care recommendations for diagnosis, treatment, and healthcare policy.",          category:"General",      icon:"BookOpen"    },
    { id:3,  title:"USPSTF Preventive Guidelines",reference:"Agency for Healthcare Research and Quality, U.S. Department of Health",        explanation:"Preventive screening and preventive medicine recommendations.",                                         category:"Preventive",   icon:"Microscope"  },
    { id:4,  title:"CDC Public Health Guidelines", reference:"Centers for Disease Control and Prevention, U.S. Department of Health",       explanation:"Infectious disease control and vaccination policies used globally.",                                   category:"Infectious",   icon:"Syringe"     },
    { id:5,  title:"ACP Internal Medicine Guidelines",reference:"American College of Physicians, Annals of Internal Medicine",             explanation:"Internal medicine clinical practice guidelines for chronic disease management.",                       category:"General",      icon:"Stethoscope" },
    { id:6,  title:"SIGN Clinical Guidelines",    reference:"Scottish Intercollegiate Guidelines Network, NHS Scotland",                    explanation:"Evidence-based healthcare treatment guidelines used internationally.",                                  category:"General",      icon:"BookOpen"    },
    { id:7,  title:"IDSA Infectious Disease Guidelines",reference:"Infectious Diseases Society of America, Clinical Infectious Diseases Journal",explanation:"Guidelines for infectious diseases including antimicrobial therapy and sepsis management.",      category:"Infectious",   icon:"Activity"    },
    { id:8,  title:"AHRQ Healthcare Quality Guidelines",reference:"Agency for Healthcare Research and Quality, U.S. Department of Health",  explanation:"Evidence-based healthcare quality and patient safety recommendations.",                             category:"Quality",      icon:"CheckCircle" },
    { id:9,  title:"ICMR National Health Guidelines",reference:"Indian Council of Medical Research, Ministry of Health India",             explanation:"National clinical recommendations for disease management in India.",                                  category:"Public Health",icon:"FileText"    },
    { id:10, title:"BMJ Best Practice",           reference:"British Medical Journal, BMJ Publishing Group",                               explanation:"Clinical decision support system for diagnosis and treatment recommendations.",                       category:"General",      icon:"BookOpen"    },
  ],
 
  emergency: [
    { id:201,title:"ACEP Emergency Guidelines",reference:"American College of Emergency Physicians",  explanation:"Emergency department clinical policies and acute care protocols.",      category:"Emergency",    icon:"Activity"},
    { id:202,title:"ATLS Trauma Guidelines",   reference:"American College of Surgeons, Committee on Trauma",explanation:"Standardized trauma management protocol.",                        category:"Trauma",       icon:"Activity"},
    { id:203,title:"ACLS Guidelines",          reference:"American Heart Association, ILCOR",         explanation:"Advanced cardiac arrest management algorithms.",                         category:"Resuscitation",icon:"Heart"  },
    { id:204,title:"PALS Guidelines",          reference:"American Heart Association, AAP",           explanation:"Pediatric emergency life support protocols.",                            category:"Pediatric",    icon:"Activity"},
    { id:205,title:"BLS Guidelines",           reference:"American Heart Association, ILCOR",         explanation:"Basic life support and CPR recommendations.",                            category:"Resuscitation",icon:"Heart"  },
    { id:206,title:"IFEM Emergency Standards", reference:"International Federation for Emergency Medicine",explanation:"Global standards for emergency medicine practice.",                category:"Emergency",    icon:"Activity"},
    { id:207,title:"WHO Trauma Care Guidelines",reference:"World Health Organization",               explanation:"Trauma system development and emergency care recommendations.",          category:"Trauma",       icon:"Activity"},
  ],
  cardiology: [
    { id:301,title:"AHA Guidelines",    reference:"American Heart Association, Circulation Journal",   explanation:"Prevention and treatment recommendations for cardiovascular disease.",   category:"Cardiology",  icon:"Heart"},
    { id:302,title:"ACC Guidelines",    reference:"American College of Cardiology, JACC",              explanation:"Evidence-based cardiology clinical practice guidelines.",                category:"Cardiology",  icon:"Heart"},
    { id:303,title:"ESC Guidelines",    reference:"European Society of Cardiology, European Heart Journal",explanation:"European cardiovascular disease management recommendations.",      category:"Cardiology",  icon:"Heart"},
    { id:304,title:"HFSA Guidelines",   reference:"Heart Failure Society of America",                  explanation:"Heart failure diagnosis and management guidelines.",                    category:"Heart Failure",icon:"Heart"},
    { id:305,title:"HRS Guidelines",    reference:"Heart Rhythm Society",                              explanation:"Cardiac rhythm disorder management guidelines.",                        category:"Arrhythmia",  icon:"Activity"},
    { id:306,title:"STS Surgical Guidelines",reference:"Society of Thoracic Surgeons",                explanation:"Cardiac surgery clinical recommendations.",                             category:"Surgery",     icon:"Heart"},
    { id:307,title:"ACC/AHA Joint Guidelines",reference:"ACC / AHA, Circulation Journal",             explanation:"Joint cardiovascular disease treatment guidelines.",                    category:"Cardiology",  icon:"Heart"},
  ],
  pulmonology: [
    { id:401,title:"GOLD COPD Guidelines",  reference:"GOLD Scientific Committee, ATS, ERS", explanation:"COPD diagnosis and management recommendations.",                      category:"Respiratory",icon:"Activity"},
    { id:402,title:"GINA Asthma Guidelines",reference:"GINA Executive Committee, WHO",       explanation:"Global asthma prevention and treatment strategies.",                  category:"Respiratory",icon:"Activity"},
    { id:403,title:"ATS Respiratory Guidelines",reference:"American Thoracic Society",      explanation:"Respiratory disease guidelines including ARDS and pulmonary fibrosis.",category:"Respiratory",icon:"Activity"},
    { id:404,title:"ERS Guidelines",        reference:"European Respiratory Society",       explanation:"European respiratory disease treatment recommendations.",               category:"Respiratory",icon:"Activity"},
    { id:405,title:"WHO TB Guidelines",     reference:"World Health Organization, Stop TB", explanation:"Tuberculosis diagnosis and treatment recommendations.",                category:"Infectious", icon:"Activity"},
    { id:406,title:"NTCP TB Control Guidelines",reference:"Ministry of Health India, NTEP", explanation:"National tuberculosis control strategies.",                           category:"Public Health",icon:"Activity"},
  ],
  endocrinology: [
    { id:501,title:"ADA Diabetes Guidelines",    reference:"American Diabetes Association",           explanation:"Diabetes diagnosis, treatment, and prevention standards.",           category:"Diabetes", icon:"Droplets"},
    { id:502,title:"AACE Guidelines",            reference:"American Association of Clinical Endocrinology",explanation:"Clinical endocrinology recommendations for metabolic diseases.", category:"Metabolic",icon:"Droplets"},
    { id:503,title:"EASD Diabetes Guidelines",   reference:"European Association for the Study of Diabetes",explanation:"Diabetes research and clinical treatment strategies in Europe.", category:"Diabetes", icon:"Droplets"},
    { id:504,title:"Endocrine Society Guidelines",reference:"Endocrine Society, JCEM",               explanation:"Hormonal disease management including adrenal and pituitary disorders.",category:"Hormonal",icon:"Activity"},
    { id:505,title:"ATA Thyroid Guidelines",     reference:"American Thyroid Association",            explanation:"Thyroid disease diagnosis and treatment recommendations.",           category:"Thyroid",  icon:"Activity"},
    { id:506,title:"IDF Diabetes Guidelines",    reference:"International Diabetes Federation",       explanation:"Global diabetes prevention and management policies.",                category:"Diabetes", icon:"Droplets"},
    { id:507,title:"WHO Diabetes Guidelines",    reference:"World Health Organization",               explanation:"Public health strategies for diabetes prevention and care.",          category:"Public Health",icon:"FileText"},
  ],
  gastroenterology: [
    { id:601,title:"ACG Guidelines",    reference:"American College of Gastroenterology",       explanation:"Evidence-based gastrointestinal disease treatment recommendations.",category:"Gastroenterology",icon:"Activity"},
    { id:602,title:"AGA Guidelines",    reference:"American Gastroenterological Association",   explanation:"Digestive disease management recommendations.",                   category:"Gastroenterology",icon:"Activity"},
    { id:603,title:"ASGE Endoscopy Guidelines",reference:"American Society for GI Endoscopy",  explanation:"GI endoscopy clinical practice guidelines.",                      category:"Endoscopy",        icon:"Microscope"},
    { id:604,title:"EASL Liver Guidelines",reference:"European Association for Study of Liver",explanation:"Liver disease management including hepatitis and cirrhosis.",     category:"Hepatology",       icon:"Activity"},
    { id:605,title:"WGO Global Guidelines",reference:"World Gastroenterology Organisation",    explanation:"Global digestive disease practice recommendations.",               category:"Gastroenterology", icon:"FileText"},
    { id:606,title:"BSG Gastroenterology Guidelines",reference:"British Society of Gastroenterology",explanation:"GI disease clinical management in the UK.",                 category:"Gastroenterology", icon:"Activity"},
  ],
  nephrology: [
    { id:701,title:"KDIGO Guidelines",  reference:"Kidney Disease Improving Global Outcomes, NKF, ISN",explanation:"Evidence-based recommendations for kidney disease diagnosis and management.",category:"Renal",    icon:"Droplets"},
    { id:702,title:"KDOQI Guidelines",  reference:"National Kidney Foundation, ASN",                   explanation:"Chronic kidney disease and dialysis clinical practice guidelines.",            category:"Renal",    icon:"Droplets"},
    { id:703,title:"ERA Guidelines",    reference:"European Renal Association",                         explanation:"European kidney disease treatment recommendations.",                         category:"Renal",    icon:"Droplets"},
    { id:704,title:"ISN Guidelines",    reference:"International Society of Nephrology",                explanation:"Global kidney disease prevention and management initiatives.",                category:"Renal",    icon:"Droplets"},
    { id:705,title:"ASN Guidelines",    reference:"American Society of Nephrology, JASN",               explanation:"Evidence-based nephrology practice recommendations.",                        category:"Renal",    icon:"Droplets"},
    { id:706,title:"NKF Kidney Guidelines",reference:"National Kidney Foundation",                     explanation:"Kidney disease awareness, screening, and management recommendations.",       category:"Renal",    icon:"Droplets"},
    { id:707,title:"AST Transplant Guidelines",reference:"American Society of Transplantation",        explanation:"Kidney transplant management and immunosuppression guidelines.",             category:"Transplant",icon:"Droplets"},
  ],

// Add these to your GUIDELINES_BY_SPECIALIZATION object:

chemotherapy: [
  { id:3001, title:"NCCN Chemotherapy Regimens", reference:"NCCN", explanation:"Standard chemotherapy protocols by cancer type, dosing schedules, and toxicity management.", category:"Chemotherapy", icon:"Activity" },
  { id:3002, title:"ASCO Chemotherapy Safety", reference:"ASCO", explanation:"Safe administration, dose calculation, and management of chemotherapy side effects.", category:"Chemotherapy", icon:"Activity" },
  { id:3003, title:"ESMO Chemotherapy Guidelines", reference:"ESMO", explanation:"European chemotherapy standards and treatment protocols.", category:"Chemotherapy", icon:"Activity" },
  { id:3004, title:"ONS Chemotherapy Guidelines", reference:"Oncology Nursing Society", explanation:"Nursing standards for chemotherapy administration and patient care.", category:"Chemotherapy", icon:"Activity" },
  { id:3005, title:"MASCC Antiemetic Guidelines", reference:"MASCC", explanation:"Prevention and management of chemotherapy-induced nausea and vomiting.", category:"Chemotherapy", icon:"Activity" },
  { id:3006, title:"ASCO Chemotherapy Dose Modification", reference:"ASCO", explanation:"Dose adjustments for renal/hepatic impairment and toxicity.", category:"Chemotherapy", icon:"Activity" },
  { id:3007, title:"NCCN Chemotherapy Order Templates", reference:"NCCN", explanation:"Standardized chemotherapy order sets and prescribing guidelines.", category:"Chemotherapy", icon:"Activity" },
  { id:3008, title:"ESMO Chemotherapy Extravasation", reference:"ESMO", explanation:"Management of chemotherapy extravasation injuries.", category:"Chemotherapy", icon:"Activity" },
  { id:3009, title:"ASCO Fertility Preservation", reference:"ASCO", explanation:"Fertility preservation for patients receiving chemotherapy.", category:"Chemotherapy", icon:"Activity" },
  { id:3010, title:"NCCN Chemotherapy in Older Adults", reference:"NCCN", explanation:"Geriatric chemotherapy management guidelines.", category:"Chemotherapy", icon:"Activity" },
],

immunotherapy: [
  { id:3101, title:"SITC Immunotherapy Guidelines", reference:"Society for Immunotherapy of Cancer", explanation:"Clinical practice guidelines for immune checkpoint inhibitors, CAR-T, and cancer vaccines.", category:"Immunotherapy", icon:"Activity" },
  { id:3102, title:"ASCO Immunotherapy Guidelines", reference:"ASCO", explanation:"Management of irAEs (immune-related adverse events) and patient selection.", category:"Immunotherapy", icon:"Activity" },
  { id:3103, title:"ESMO Immunotherapy Guidelines", reference:"ESMO", explanation:"European recommendations for immunotherapy in solid tumors.", category:"Immunotherapy", icon:"Activity" },
  { id:3104, title:"NCCN Immunotherapy Recommendations", reference:"NCCN", explanation:"Immunotherapy indications by cancer type and sequencing strategies.", category:"Immunotherapy", icon:"Activity" },
  { id:3105, title:"ASCO irAE Management", reference:"ASCO", explanation:"Diagnosis and treatment of immune-related adverse events.", category:"Immunotherapy", icon:"Activity" },
  { id:3106, title:"ESCAT Immunotherapy Biomarkers", reference:"ESMO", explanation:"Biomarker selection for immunotherapy candidates.", category:"Immunotherapy", icon:"Microscope" },
  { id:3107, title:"ASTCT CAR-T Guidelines", reference:"American Society for Transplantation and Cellular Therapy", explanation:"CAR-T cell therapy administration and toxicity management.", category:"Immunotherapy", icon:"Activity" },
  { id:3108, title:"SITC Cancer Vaccines", reference:"SITC", explanation:"Therapeutic cancer vaccine guidelines.", category:"Immunotherapy", icon:"Activity" },
  { id:3109, title:"ESMO Checkpoint Inhibitors", reference:"ESMO", explanation:"PD-1, PD-L1, and CTLA-4 inhibitor recommendations.", category:"Immunotherapy", icon:"Activity" },
  { id:3110, title:"NCCN Immunotherapy Toxicity", reference:"NCCN", explanation:"Management of immunotherapy-related toxicities.", category:"Immunotherapy", icon:"Activity" },
],

targeted_therapy: [
  { id:3201, title:"NCCN Targeted Therapy Guidelines", reference:"NCCN", explanation:"Guidelines for targeted agents including TKIs, PARP inhibitors, and monoclonal antibodies.", category:"Targeted Therapy", icon:"Activity" },
  { id:3202, title:"ESMO Precision Medicine Guidelines", reference:"ESMO", explanation:"Biomarker-driven targeted therapy recommendations.", category:"Targeted Therapy", icon:"Activity" },
  { id:3203, title:"ASCO Molecular Testing Guidelines", reference:"ASCO", explanation:"Guidance on molecular profiling to guide targeted therapy selection.", category:"Targeted Therapy", icon:"Microscope" },
  { id:3204, title:"NCCN EGFR Inhibitors", reference:"NCCN", explanation:"EGFR-mutant lung cancer targeted therapy guidelines.", category:"Targeted Therapy", icon:"Activity" },
  { id:3205, title:"ESMO PARP Inhibitors", reference:"ESMO", explanation:"PARP inhibitor use in BRCA-mutated cancers.", category:"Targeted Therapy", icon:"Activity" },
  { id:3206, title:"ASCO BRAF/MEK Inhibitors", reference:"ASCO", explanation:"Targeted therapy for BRAF-mutant melanoma.", category:"Targeted Therapy", icon:"Activity" },
  { id:3207, title:"NCCN HER2-Targeted Therapy", reference:"NCCN", explanation:"HER2-directed therapy for breast and gastric cancers.", category:"Targeted Therapy", icon:"Activity" },
  { id:3208, title:"ESMO ALK/ROS1 Inhibitors", reference:"ESMO", explanation:"Targeted therapy for ALK/ROS1-positive lung cancer.", category:"Targeted Therapy", icon:"Activity" },
  { id:3209, title:"AMP Biomarker Testing", reference:"AMP", explanation:"Molecular biomarker testing standards for targeted therapy.", category:"Targeted Therapy", icon:"Microscope" },
  { id:3210, title:"NCCN NTRK Inhibitors", reference:"NCCN", explanation:"TRK inhibitor use in NTRK fusion-positive cancers.", category:"Targeted Therapy", icon:"Activity" },
],

hormone_therapy: [
  { id:3301, title:"ASCO Hormonal Therapy Guidelines", reference:"ASCO", explanation:"Endocrine therapy for breast, prostate, and endometrial cancers.", category:"Hormone Therapy", icon:"Activity" },
  { id:3302, title:"ESMO Endocrine Therapy Guidelines", reference:"ESMO", explanation:"European standards for hormone therapy in oncology.", category:"Hormone Therapy", icon:"Activity" },
  { id:3303, title:"NCCN Hormone Therapy Recommendations", reference:"NCCN", explanation:"Adjuvant and metastatic hormone therapy protocols.", category:"Hormone Therapy", icon:"Activity" },
  { id:3304, title:"AUA Hormone Therapy for Prostate", reference:"AUA", explanation:"Androgen deprivation therapy guidelines for prostate cancer.", category:"Hormone Therapy", icon:"Activity" },
  { id:3305, title:"ESMO Breast Endocrine Therapy", reference:"ESMO", explanation:"Tamoxifen, aromatase inhibitors, and SERDs.", category:"Hormone Therapy", icon:"Activity" },
  { id:3306, title:"NCCN Aromatase Inhibitors", reference:"NCCN", explanation:"AI use in postmenopausal breast cancer.", category:"Hormone Therapy", icon:"Activity" },
  { id:3307, title:"ASCO Adjuvant Endocrine Therapy", reference:"ASCO", explanation:"Duration and sequencing of adjuvant hormone therapy.", category:"Hormone Therapy", icon:"Activity" },
  { id:3308, title:"ESMO Selective Estrogen Receptor Degraders", reference:"ESMO", explanation:"SERD use in ER+ breast cancer.", category:"Hormone Therapy", icon:"Activity" },
  { id:3309, title:"NCCN Gonadotropin-Releasing Hormone Agonists", reference:"NCCN", explanation:"GnRH agonist use in hormone-sensitive cancers.", category:"Hormone Therapy", icon:"Activity" },
  { id:3310, title:"ASCO Hormone Therapy Toxicity", reference:"ASCO", explanation:"Management of endocrine therapy side effects.", category:"Hormone Therapy", icon:"Activity" },
],

precision_oncology: [
  { id:3401, title:"ESMO Precision Oncology Guidelines", reference:"ESMO", explanation:"Genomic profiling and precision medicine in cancer care.", category:"Precision Oncology", icon:"Microscope" },
  { id:3402, title:"ASCO Precision Medicine Guidelines", reference:"ASCO", explanation:"Integration of genomic data into clinical decision making.", category:"Precision Oncology", icon:"Microscope" },
  { id:3403, title:"AMP Molecular Pathology Guidelines", reference:"AMP", explanation:"Standards for molecular diagnostics in oncology.", category:"Precision Oncology", icon:"Microscope" },
  { id:3404, title:"NCCN Precision Medicine Recommendations", reference:"NCCN", explanation:"Targeted therapy based on genomic alterations.", category:"Precision Oncology", icon:"Activity" },
  { id:3405, title:"ESCAT Molecular Targets", reference:"ESMO", explanation:"ESMO Scale for Clinical Actionability of Molecular Targets.", category:"Precision Oncology", icon:"Microscope" },
  { id:3406, title:"ACMG Genomic Testing", reference:"ACMG", explanation:"Clinical genomic testing standards.", category:"Precision Oncology", icon:"Microscope" },
  { id:3407, title:"CAP Genomic Reporting", reference:"CAP", explanation:"Reporting standards for genomic testing.", category:"Precision Oncology", icon:"Microscope" },
  { id:3408, title:"ASCO Tumor Mutational Burden", reference:"ASCO", explanation:"TMB as a biomarker for immunotherapy.", category:"Precision Oncology", icon:"Microscope" },
  { id:3409, title:"ESMO Liquid Biopsy", reference:"ESMO", explanation:"Circulating tumor DNA testing guidelines.", category:"Precision Oncology", icon:"Microscope" },
  { id:3410, title:"NCCN Molecular Tumor Board", reference:"NCCN", explanation:"Multidisciplinary molecular tumor board standards.", category:"Precision Oncology", icon:"Activity" },
],

radiation_oncology: [
  { id:3501, title:"ASTRO Radiation Guidelines", reference:"ASTRO", explanation:"Radiation oncology treatment standards including IMRT, SBRT, and proton therapy.", category:"Radiation Oncology", icon:"Activity" },
  { id:3502, title:"ESTRO Guidelines", reference:"ESTRO", explanation:"European radiation therapy clinical practice guidelines.", category:"Radiation Oncology", icon:"Activity" },
  { id:3503, title:"RADIANCE Guidelines", reference:"RADIANCE", explanation:"Evidence-based radiation oncology recommendations.", category:"Radiation Oncology", icon:"Activity" },
  { id:3504, title:"NCCN Radiation Therapy Guidelines", reference:"NCCN", explanation:"Radiation therapy indications by cancer type.", category:"Radiation Oncology", icon:"Activity" },
  { id:3505, title:"ASCO Radiation Guidelines", reference:"ASCO", explanation:"Adjuvant and definitive radiation therapy recommendations.", category:"Radiation Oncology", icon:"Activity" },
  { id:3506, title:"ESTRO SBRT Guidelines", reference:"ESTRO", explanation:"Stereotactic body radiation therapy standards.", category:"Radiation Oncology", icon:"Activity" },
  { id:3507, title:"ASTRO Proton Therapy", reference:"ASTRO", explanation:"Proton beam therapy indications and protocols.", category:"Radiation Oncology", icon:"Activity" },
  { id:3508, title:"ICRU Radiation Reporting", reference:"ICRU", explanation:"Dosimetry and treatment planning standards.", category:"Radiation Oncology", icon:"Microscope" },
  { id:3509, title:"ESMO Radiation Toxicity", reference:"ESMO", explanation:"Management of radiation therapy side effects.", category:"Radiation Oncology", icon:"Activity" },
  { id:3510, title:"ASTRO Palliative Radiation", reference:"ASTRO", explanation:"Palliative radiation therapy guidelines.", category:"Radiation Oncology", icon:"Activity" },
],

external_beam_radiotherapy: [
  { id:3601, title:"AAPM External Beam Guidelines", reference:"AAPM", explanation:"External beam radiation therapy physics and quality assurance.", category:"Radiation Therapy", icon:"Activity" },
  { id:3602, title:"ASTRO EBRT Guidelines", reference:"ASTRO", explanation:"Conventional and conformal external beam techniques.", category:"Radiation Therapy", icon:"Activity" },
  { id:3603, title:"ESTRO IMRT Guidelines", reference:"ESTRO", explanation:"Intensity-modulated radiation therapy standards.", category:"Radiation Therapy", icon:"Activity" },
  { id:3604, title:"NCCN EBRT Recommendations", reference:"NCCN", explanation:"External beam radiotherapy indications by cancer type.", category:"Radiation Therapy", icon:"Activity" },
  { id:3605, title:"ICRU EBRT Prescribing", reference:"ICRU", explanation:"Prescribing, recording, and reporting EBRT.", category:"Radiation Therapy", icon:"Microscope" },
  { id:3606, title:"ASTRO Image-Guided RT", reference:"ASTRO", explanation:"IGRT implementation standards.", category:"Radiation Therapy", icon:"Activity" },
  { id:3607, title:"ESTRO VMAT Guidelines", reference:"ESTRO", explanation:"Volumetric modulated arc therapy protocols.", category:"Radiation Therapy", icon:"Activity" },
  { id:3608, title:"AAPM Motion Management", reference:"AAPM", explanation:"Respiratory motion management in EBRT.", category:"Radiation Therapy", icon:"Activity" },
  { id:3609, title:"ASTRO 3D Conformal RT", reference:"ASTRO", explanation:"3D-CRT treatment planning standards.", category:"Radiation Therapy", icon:"Activity" },
  { id:3610, title:"ESTRO EBRT Quality Assurance", reference:"ESTRO", explanation:"QA procedures for external beam radiotherapy.", category:"Radiation Therapy", icon:"CheckCircle" },
],

brachytherapy: [
  { id:3701, title:"ABS Brachytherapy Guidelines", reference:"American Brachytherapy Society", explanation:"General brachytherapy practice standards.", category:"Brachytherapy", icon:"Activity" },
  { id:3702, title:"ESTRO Brachytherapy Guidelines", reference:"ESTRO", explanation:"European brachytherapy treatment standards.", category:"Brachytherapy", icon:"Activity" },
  { id:3703, title:"ASTRO Brachytherapy Recommendations", reference:"ASTRO", explanation:"Brachytherapy indications and techniques.", category:"Brachytherapy", icon:"Activity" },
  { id:3704, title:"ABS Prostate Brachytherapy", reference:"ABS", explanation:"Low-dose-rate and high-dose-rate prostate brachytherapy.", category:"Brachytherapy", icon:"Activity" },
  { id:3705, title:"ABS Gynecologic Brachytherapy", reference:"ABS", explanation:"Cervical and endometrial brachytherapy standards.", category:"Brachytherapy", icon:"Activity" },
  { id:3706, title:"ESTRO Breast Brachytherapy", reference:"ESTRO", explanation:"Partial breast irradiation brachytherapy.", category:"Brachytherapy", icon:"Activity" },
  { id:3707, title:"GEC-ESTRO HDR Guidelines", reference:"GEC-ESTRO", explanation:"High-dose-rate brachytherapy protocols.", category:"Brachytherapy", icon:"Activity" },
  { id:3708, title:"ABS Skin Brachytherapy", reference:"ABS", explanation:"Brachytherapy for skin cancer.", category:"Brachytherapy", icon:"Activity" },
  { id:3709, title:"ESTRO Ocular Brachytherapy", reference:"ESTRO", explanation:"Eye plaque brachytherapy for uveal melanoma.", category:"Brachytherapy", icon:"Activity" },
  { id:3710, title:"ICRU Brachytherapy Reporting", reference:"ICRU", explanation:"Brachytherapy dosimetry reporting standards.", category:"Brachytherapy", icon:"Microscope" },
],

stereotactic_radiosurgery: [
  { id:3801, title:"ASTRO SRS Guidelines", reference:"ASTRO", explanation:"Stereotactic radiosurgery for brain metastases and benign tumors.", category:"SRS/SBRT", icon:"Activity" },
  { id:3802, title:"ESTRO SRS Guidelines", reference:"ESTRO", explanation:"European stereotactic radiosurgery standards.", category:"SRS/SBRT", icon:"Activity" },
  { id:3803, title:"ASTRO SBRT Guidelines", reference:"ASTRO", explanation:"Stereotactic body radiation therapy for lung, liver, spine.", category:"SRS/SBRT", icon:"Activity" },
  { id:3804, title:"RSS SRS/SBRT Guidelines", reference:"Radiology Society of SRS/SBRT", explanation:"Radiosurgery treatment planning and delivery standards.", category:"SRS/SBRT", icon:"Activity" },
  { id:3805, title:"ESTRO SBRT Lung", reference:"ESTRO", explanation:"SBRT for early-stage NSCLC.", category:"SRS/SBRT", icon:"Activity" },
  { id:3806, title:"ASTRO Spine SRS", reference:"ASTRO", explanation:"Spinal stereotactic radiosurgery guidelines.", category:"SRS/SBRT", icon:"Activity" },
  { id:3807, title:"AAPM SRS Physics", reference:"AAPM", explanation:"Physics considerations for SRS/SBRT.", category:"SRS/SBRT", icon:"Microscope" },
  { id:3808, title:"ASTRO Liver SBRT", reference:"ASTRO", explanation:"SBRT for primary and metastatic liver tumors.", category:"SRS/SBRT", icon:"Activity" },
  { id:3809, title:"ESTRO Pancreas SBRT", reference:"ESTRO", explanation:"SBRT for pancreatic cancer.", category:"SRS/SBRT", icon:"Activity" },
  { id:3810, title:"RSS SRS Toxicity", reference:"RSS", explanation:"Management of radiosurgery-related toxicities.", category:"SRS/SBRT", icon:"Activity" },
],

curative_surgery: [
  { id:3901, title:"SSO Curative Resection Guidelines", reference:"SSO", explanation:"Curative-intent cancer surgery standards.", category:"Surgical Oncology", icon:"Heart" },
  { id:3902, title:"ACS Curative Surgery Principles", reference:"ACS", explanation:"R0 resection and oncologic principles.", category:"Surgical Oncology", icon:"Heart" },
  { id:3903, title:"NCCN Curative Surgery Guidelines", reference:"NCCN", explanation:"Curative surgery indications by cancer type.", category:"Surgical Oncology", icon:"Heart" },
  { id:3904, title:"ESSO Curative Resection", reference:"ESSO", explanation:"European curative surgery standards.", category:"Surgical Oncology", icon:"Heart" },
  { id:3905, title:"SSO Margin Assessment", reference:"SSO", explanation:"Surgical margin evaluation in curative resection.", category:"Surgical Oncology", icon:"Heart" },
  { id:3906, title:"ACS Lymphadenectomy Guidelines", reference:"ACS", explanation:"Lymph node dissection standards.", category:"Surgical Oncology", icon:"Heart" },
  { id:3907, title:"NCCN Minimally Invasive Curative Surgery", reference:"NCCN", explanation:"Laparoscopic and robotic curative resections.", category:"Surgical Oncology", icon:"Heart" },
  { id:3908, title:"SSO Primary Tumor Resection", reference:"SSO", explanation:"Primary tumor resection guidelines.", category:"Surgical Oncology", icon:"Heart" },
  { id:3909, title:"ACS Metastasectomy Guidelines", reference:"ACS", explanation:"Curative metastasectomy for oligometastatic disease.", category:"Surgical Oncology", icon:"Heart" },
  { id:3910, title:"ESSO Quality Standards", reference:"ESSO", explanation:"Quality measures in curative cancer surgery.", category:"Surgical Oncology", icon:"CheckCircle" },
],

cytoreductive_surgery: [
  { id:4001, title:"PSOGI CRS Guidelines", reference:"Peritoneal Surface Oncology Group International", explanation:"Cytoreductive surgery for peritoneal malignancies.", category:"Surgical Oncology", icon:"Heart" },
  { id:4002, title:"ACSOG CRS/HIPEC Guidelines", reference:"ACSOG", explanation:"CRS with hyperthermic intraperitoneal chemotherapy.", category:"Surgical Oncology", icon:"Heart" },
  { id:4003, title:"NCCN CRS Recommendations", reference:"NCCN", explanation:"Cytoreductive surgery for ovarian and colorectal peritoneal mets.", category:"Surgical Oncology", icon:"Heart" },
  { id:4004, title:"ESGO CRS Guidelines", reference:"ESGO", explanation:"European cytoreductive surgery for ovarian cancer.", category:"Surgical Oncology", icon:"Heart" },
  { id:4005, title:"PSOGI Completeness of Cytoreduction", reference:"PSOGI", explanation:"CC score and resection quality standards.", category:"Surgical Oncology", icon:"Heart" },
  { id:4006, title:"ASCO Optimal CRS", reference:"ASCO", explanation:"Patient selection for optimal cytoreduction.", category:"Surgical Oncology", icon:"Activity" },
  { id:4007, title:"ESMO CRS/HIPEC", reference:"ESMO", explanation:"European CRS and HIPEC practice guidelines.", category:"Surgical Oncology", icon:"Activity" },
  { id:4008, title:"PSOGI CRS Complications", reference:"PSOGI", explanation:"Management of CRS-related morbidity.", category:"Surgical Oncology", icon:"Heart" },
  { id:4009, title:"NCCN Interval CRS", reference:"NCCN", explanation:"Interval cytoreductive surgery after neoadjuvant therapy.", category:"Surgical Oncology", icon:"Heart" },
  { id:4010, title:"ESSO CRS Training", reference:"ESSO", explanation:"CRS surgeon training and credentialing standards.", category:"Surgical Oncology", icon:"CheckCircle" },
],

reconstructive_surgery: [
  { id:4101, title:"ASPS Oncologic Reconstruction", reference:"American Society of Plastic Surgeons", explanation:"Reconstructive surgery after cancer resection.", category:"Reconstructive Surgery", icon:"Heart" },
  { id:4102, title:"ASBrS Breast Reconstruction", reference:"American Society of Breast Surgeons", explanation:"Post-mastectomy breast reconstruction guidelines.", category:"Reconstructive Surgery", icon:"Heart" },
  { id:4103, title:"SSO/ASPS Joint Guidelines", reference:"SSO/ASPS", explanation:"Oncoplastic and reconstructive surgery standards.", category:"Reconstructive Surgery", icon:"Heart" },
  { id:4104, title:"NCCN Reconstruction Guidelines", reference:"NCCN", explanation:"Reconstruction timing and techniques in oncology.", category:"Reconstructive Surgery", icon:"Heart" },
  { id:4105, title:"ESPRAS Cancer Reconstruction", reference:"ESPRAS", explanation:"European reconstructive oncology standards.", category:"Reconstructive Surgery", icon:"Heart" },
  { id:4106, title:"ASPS Head & Neck Reconstruction", reference:"ASPS", explanation:"Free flap and pedicled flap reconstruction.", category:"Reconstructive Surgery", icon:"Heart" },
  { id:4107, title:"ASBrS Oncoplastic Surgery", reference:"ASBrS", explanation:"Oncoplastic breast-conserving surgery techniques.", category:"Reconstructive Surgery", icon:"Heart" },
  { id:4108, title:"AOA Mandibular Reconstruction", reference:"AOA", explanation:"Mandibular reconstruction after oral cancer surgery.", category:"Reconstructive Surgery", icon:"Heart" },
  { id:4109, title:"ASPS Prosthetic Reconstruction", reference:"ASPS", explanation:"Breast reconstruction with implants.", category:"Reconstructive Surgery", icon:"Heart" },
  { id:4110, title:"SSO Timing of Reconstruction", reference:"SSO", explanation:"Immediate vs delayed reconstruction guidelines.", category:"Reconstructive Surgery", icon:"Heart" },
],

imaging_oncology: [
  { id:4201, title:"ACR Appropriateness Criteria - Oncology", reference:"American College of Radiology", explanation:"Appropriate imaging for cancer diagnosis and staging.", category:"Imaging Oncology", icon:"Microscope" },
  { id:4202, title:"ESR Cancer Imaging Guidelines", reference:"European Society of Radiology", explanation:"European oncologic imaging standards.", category:"Imaging Oncology", icon:"Microscope" },
  { id:4203, title:"RSNA Cancer Imaging", reference:"RSNA", explanation:"Radiologic oncology imaging protocols.", category:"Imaging Oncology", icon:"Microscope" },
  { id:4204, title:"EUSOBI Breast Imaging", reference:"European Society of Breast Imaging", explanation:"Breast cancer imaging recommendations.", category:"Imaging Oncology", icon:"Microscope" },
  { id:4205, title:"ACR Lung-RADS", reference:"ACR", explanation:"Lung cancer screening CT reporting standards.", category:"Imaging Oncology", icon:"Microscope" },
  { id:4206, title:"ACR BI-RADS", reference:"ACR", explanation:"Breast imaging reporting and data system.", category:"Imaging Oncology", icon:"Microscope" },
  { id:4207, title:"ESUR Prostate Imaging", reference:"ESUR", explanation:"Prostate MRI and PI-RADS standards.", category:"Imaging Oncology", icon:"Microscope" },
  { id:4208, title:"NCCN Imaging Guidelines", reference:"NCCN", explanation:"Surveillance imaging recommendations by cancer type.", category:"Imaging Oncology", icon:"Activity" },
  { id:4209, title:"EANM Oncology PET/CT", reference:"EANM", explanation:"PET/CT in oncologic imaging.", category:"Imaging Oncology", icon:"Microscope" },
  { id:4210, title:"ACR LI-RADS", reference:"ACR", explanation:"Liver imaging reporting for HCC.", category:"Imaging Oncology", icon:"Microscope" },
],

histopathology: [
  { id:4301, title:"CAP Histopathology Protocols", reference:"CAP", explanation:"Histopathology reporting standards for cancer specimens.", category:"Pathology", icon:"Microscope" },
  { id:4302, title:"RCPath Histopathology", reference:"RCPath", explanation:"UK histopathology cancer standards.", category:"Pathology", icon:"Microscope" },
  { id:4303, title:"ICCR Histopathology Datasets", reference:"ICCR", explanation:"International histopathology reporting datasets.", category:"Pathology", icon:"Microscope" },
  { id:4304, title:"WHO Histopathology Classification", reference:"WHO", explanation:"Tumor histologic classification standards.", category:"Pathology", icon:"Microscope" },
  { id:4305, title:"AJCC Histopathology Staging", reference:"AJCC", explanation:"Pathologic staging integration guidelines.", category:"Pathology", icon:"Microscope" },
  { id:4306, title:"ASCP Histotechnology", reference:"ASCP", explanation:"Histology laboratory quality standards.", category:"Pathology", icon:"Microscope" },
  { id:4307, title:"ESMO Histopathology", reference:"ESMO", explanation:"Histopathology for treatment decision making.", category:"Pathology", icon:"Microscope" },
  { id:4308, title:"CAP Frozen Section", reference:"CAP", explanation:"Intraoperative frozen section guidelines.", category:"Pathology", icon:"Microscope" },
  { id:4309, title:"UK NEQAS Histopathology", reference:"UK NEQAS", explanation:"External quality assurance for histopathology.", category:"Pathology", icon:"CheckCircle" },
  { id:4310, title:"IARC Histopathology QA", reference:"IARC", explanation:"Quality assurance in cancer histopathology.", category:"Pathology", icon:"Microscope" },
],

cytology: [
  { id:4401, title:"CAP Cytopathology Guidelines", reference:"CAP", explanation:"Cytopathology reporting standards for cancer screening.", category:"Pathology", icon:"Microscope" },
  { id:4402, title:"RCPath Cytology Guidelines", reference:"RCPath", explanation:"UK cytology reporting standards.", category:"Pathology", icon:"Microscope" },
  { id:4403, title:"Bethesda System for Cervical Cytology", reference:"NCI", explanation:"Cervical cytology reporting standards.", category:"Pathology", icon:"Microscope" },
  { id:4404, title:"Bethesda System for Thyroid Cytology", reference:"ATA", explanation:"Thyroid FNA reporting standards.", category:"Pathology", icon:"Microscope" },
  { id:4405, title:"Papanicolaou Society Urine Cytology", reference:"PSC", explanation:"Urinary cytology reporting guidelines.", category:"Pathology", icon:"Microscope" },
  { id:4406, title:"IAC Lung Cytology", reference:"International Academy of Cytology", explanation:"Respiratory cytology standards.", category:"Pathology", icon:"Microscope" },
  { id:4407, title:"ESMO Cytology Recommendations", reference:"ESMO", explanation:"Cytology for cancer diagnosis.", category:"Pathology", icon:"Microscope" },
  { id:4408, title:"ASCP Cytotechnology", reference:"ASCP", explanation:"Cytology laboratory quality standards.", category:"Pathology", icon:"Microscope" },
  { id:4409, title:"CAP FNA Guidelines", reference:"CAP", explanation:"Fine needle aspiration cytology standards.", category:"Pathology", icon:"Microscope" },
  { id:4410, title:"ICCR Cytology Reporting", reference:"ICCR", explanation:"International cytology reporting standards.", category:"Pathology", icon:"Microscope" },
],

biomarker_analysis: [
  { id:4501, title:"AMP Biomarker Testing Guidelines", reference:"AMP", explanation:"Biomarker testing standards in oncology.", category:"Molecular Pathology", icon:"Microscope" },
  { id:4502, title:"CAP Biomarker Reporting", reference:"CAP", explanation:"Cancer biomarker reporting guidelines.", category:"Molecular Pathology", icon:"Microscope" },
  { id:4503, title:"ESMO Biomarker Guidelines", reference:"ESMO", explanation:"ESMO recommendations for biomarker testing.", category:"Molecular Pathology", icon:"Microscope" },
  { id:4504, title:"NCCN Biomarker Compendium", reference:"NCCN", explanation:"Companion diagnostic biomarker guidelines.", category:"Molecular Pathology", icon:"Microscope" },
  { id:4505, title:"ASCO Biomarker Guidelines", reference:"ASCO", explanation:"Biomarker-guided therapy recommendations.", category:"Molecular Pathology", icon:"Microscope" },
  { id:4506, title:"ACMG Biomarker Interpretation", reference:"ACMG", explanation:"Biomarker variant interpretation standards.", category:"Molecular Pathology", icon:"Microscope" },
  { id:4507, title:"FDA Biomarker Qualifications", reference:"FDA", explanation:"Regulatory biomarker qualification standards.", category:"Molecular Pathology", icon:"FileText" },
  { id:4508, title:"CIMT Biomarker Assays", reference:"CIMT", explanation:"Immunotherapy biomarker assay standards.", category:"Molecular Pathology", icon:"Microscope" },
  { id:4509, title:"MPATH Biomarker Nomenclature", reference:"MPATH", explanation:"Biomarker nomenclature standards.", category:"Molecular Pathology", icon:"Microscope" },
  { id:4510, title:"IQNPath Biomarker Validation", reference:"IQNPath", explanation:"Biomarker assay validation guidelines.", category:"Molecular Pathology", icon:"Microscope" },
],

molecular_oncology: [
  { id:4601, title:"AMP Molecular Oncology Guidelines", reference:"AMP", explanation:"Molecular oncology diagnostic standards.", category:"Molecular Oncology", icon:"Microscope" },
  { id:4602, title:"ESMO Molecular Oncology", reference:"ESMO", explanation:"European molecular oncology guidelines.", category:"Molecular Oncology", icon:"Microscope" },
  { id:4603, title:"ASCO Molecular Oncology", reference:"ASCO", explanation:"Molecular profiling in oncology practice.", category:"Molecular Oncology", icon:"Microscope" },
  { id:4604, title:"CAP Molecular Oncology", reference:"CAP", explanation:"Molecular oncology laboratory standards.", category:"Molecular Oncology", icon:"Microscope" },
  { id:4605, title:"NCCN Molecular Oncology", reference:"NCCN", explanation:"Molecular testing treatment recommendations.", category:"Molecular Oncology", icon:"Activity" },
  { id:4606, title:"ACMG Molecular Genetics", reference:"ACMG", explanation:"Molecular genetic testing standards.", category:"Molecular Oncology", icon:"Microscope" },
  { id:4607, title:"ESCAT Molecular Targets", reference:"ESMO", explanation:"Molecular target actionability scoring.", category:"Molecular Oncology", icon:"Microscope" },
  { id:4608, title:"AMP NGS Guidelines", reference:"AMP", explanation:"Next-generation sequencing in molecular oncology.", category:"Molecular Oncology", icon:"Microscope" },
  { id:4609, title:"CAP Molecular Validation", reference:"CAP", explanation:"Molecular assay validation standards.", category:"Molecular Oncology", icon:"Microscope" },
  { id:4610, title:"ESMO Molecular Tumor Board", reference:"ESMO", explanation:"Molecular tumor board guidelines.", category:"Molecular Oncology", icon:"Activity" },
],

ablation_therapies: [
  { id:4701, title:"CIRSE Ablation Guidelines", reference:"CIRSE", explanation:"Thermal ablation techniques in interventional oncology.", category:"Interventional Oncology", icon:"Activity" },
  { id:4702, title:"SIR RFA Guidelines", reference:"SIR", explanation:"Radiofrequency ablation standards.", category:"Interventional Oncology", icon:"Activity" },
  { id:4703, title:"CIRSE MWA Guidelines", reference:"CIRSE", explanation:"Microwave ablation guidelines.", category:"Interventional Oncology", icon:"Activity" },
  { id:4704, title:"ACR Cryoablation Guidelines", reference:"ACR", explanation:"Cryoablation for kidney, liver, and lung tumors.", category:"Interventional Oncology", icon:"Activity" },
  { id:4705, title:"CIRSE Liver Ablation", reference:"CIRSE", explanation:"Ablation for HCC and liver metastases.", category:"Interventional Oncology", icon:"Activity" },
  { id:4706, title:"SIR Lung Ablation", reference:"SIR", explanation:"Ablation for primary and metastatic lung tumors.", category:"Interventional Oncology", icon:"Activity" },
  { id:4707, title:"CIRSE Renal Ablation", reference:"CIRSE", explanation:"Renal tumor ablation standards.", category:"Interventional Oncology", icon:"Activity" },
  { id:4708, title:"SIR Bone Ablation", reference:"SIR", explanation:"Ablation for bone metastases.", category:"Interventional Oncology", icon:"Activity" },
  { id:4709, title:"CIRSE Ablation Complications", reference:"CIRSE", explanation:"Management of ablation-related complications.", category:"Interventional Oncology", icon:"Activity" },
  { id:4710, title:"ACR Ablation Reporting", reference:"ACR", explanation:"Ablation procedure documentation standards.", category:"Interventional Oncology", icon:"Microscope" },
],

embolization: [
  { id:4801, title:"CIRSE Embolization Guidelines", reference:"CIRSE", explanation:"Transarterial embolization techniques.", category:"Interventional Oncology", icon:"Activity" },
  { id:4802, title:"SIR TACE Guidelines", reference:"SIR", explanation:"Transarterial chemoembolization for HCC.", category:"Interventional Oncology", icon:"Activity" },
  { id:4803, title:"CIRSE TAE Guidelines", reference:"CIRSE", explanation:"Transarterial embolization standards.", category:"Interventional Oncology", icon:"Activity" },
  { id:4804, title:"SIR DEB-TACE Guidelines", reference:"SIR", explanation:"Drug-eluting bead TACE protocols.", category:"Interventional Oncology", icon:"Activity" },
  { id:4805, title:"CIRSE Y-90 Radioembolization", reference:"CIRSE", explanation:"Selective internal radiation therapy guidelines.", category:"Interventional Oncology", icon:"Activity" },
  { id:4806, title:"SIR Portal Vein Embolization", reference:"SIR", explanation:"Preoperative PVE guidelines.", category:"Interventional Oncology", icon:"Activity" },
  { id:4807, title:"CIRSE Uterine Artery Embolization", reference:"CIRSE", explanation:"UAE for uterine fibroids.", category:"Interventional Oncology", icon:"Activity" },
  { id:4808, title:"SIR Embolization for Bleeding", reference:"SIR", explanation:"Embolization for tumor-related hemorrhage.", category:"Interventional Oncology", icon:"Activity" },
  { id:4809, title:"CIRSE Embolization Complications", reference:"CIRSE", explanation:"Management of embolization adverse events.", category:"Interventional Oncology", icon:"Activity" },
  { id:4810, title:"SIR Embolization Quality", reference:"SIR", explanation:"Quality standards for embolization procedures.", category:"Interventional Oncology", icon:"CheckCircle" },
],

research_oncology: [
  { id:4901, title:"NCI Clinical Trial Guidelines", reference:"NCI", explanation:"Clinical trial design and conduct in oncology.", category:"Research Oncology", icon:"Microscope" },
  { id:4902, title:"ICH GCP Guidelines", reference:"ICH", explanation:"Good clinical practice in cancer research.", category:"Research Oncology", icon:"FileText" },
  { id:4903, title:"EORTC Research Standards", reference:"EORTC", explanation:"European oncology research protocols.", category:"Research Oncology", icon:"Microscope" },
  { id:4904, title:"ASCO Clinical Trial Guidelines", reference:"ASCO", explanation:"Clinical research quality standards.", category:"Research Oncology", icon:"Activity" },
  { id:4905, title:"RECIST Guidelines", reference:"RECIST Working Group", explanation:"Tumor response criteria in clinical trials.", category:"Research Oncology", icon:"Microscope" },
  { id:4906, title:"NCCN Clinical Research", reference:"NCCN", explanation:"Clinical trial enrollment recommendations.", category:"Research Oncology", icon:"Activity" },
  { id:4907, title:"ESMO Research Guidelines", reference:"ESMO", explanation:"European cancer research standards.", category:"Research Oncology", icon:"Activity" },
  { id:4908, title:"FDA Oncology Research", reference:"FDA", explanation:"Regulatory standards for oncology drug development.", category:"Research Oncology", icon:"FileText" },
  { id:4909, title:"CTEP Protocol Guidelines", reference:"CTEP", explanation:"Cancer therapy evaluation program standards.", category:"Research Oncology", icon:"Microscope" },
  { id:4910, title:"ICTRP Trial Registration", reference:"WHO", explanation:"Clinical trial registration and reporting standards.", category:"Research Oncology", icon:"FileText" },
],

rehabilitation_oncology: [
  { id:5001, title:"ACRM Cancer Rehabilitation", reference:"American Congress of Rehabilitation Medicine", explanation:"Cancer rehabilitation assessment and intervention standards.", category:"Rehabilitation Oncology", icon:"Activity" },
  { id:5002, title:"NCCN Survivorship Guidelines", reference:"NCCN", explanation:"Cancer rehabilitation and survivorship care.", category:"Rehabilitation Oncology", icon:"Activity" },
  { id:5003, title:"ASCO Rehabilitation Guidelines", reference:"ASCO", explanation:"Rehabilitation in cancer care recommendations.", category:"Rehabilitation Oncology", icon:"Activity" },
  { id:5004, title:"ESMO Rehabilitation", reference:"ESMO", explanation:"European cancer rehabilitation standards.", category:"Rehabilitation Oncology", icon:"Activity" },
  { id:5005, title:"APTA Cancer Rehabilitation", reference:"APTA", explanation:"Physical therapy in cancer rehabilitation.", category:"Rehabilitation Oncology", icon:"Activity" },
  { id:5006, title:"ASHA Cancer Rehabilitation", reference:"ASHA", explanation:"Speech and swallowing rehabilitation in head/neck cancer.", category:"Rehabilitation Oncology", icon:"Activity" },
  { id:5007, title:"NCCN Lymphedema Guidelines", reference:"NCCN", explanation:"Lymphedema management after cancer treatment.", category:"Rehabilitation Oncology", icon:"Activity" },
  { id:5008, title:"ACRM Cancer Fatigue", reference:"ACRM", explanation:"Cancer-related fatigue rehabilitation.", category:"Rehabilitation Oncology", icon:"Activity" },
  { id:5009, title:"ESMO Cognitive Rehabilitation", reference:"ESMO", explanation:"Chemo-brain and cognitive rehabilitation.", category:"Rehabilitation Oncology", icon:"Activity" },
  { id:5010, title:"APTA Exercise Oncology", reference:"APTA", explanation:"Exercise prescription for cancer patients and survivors.", category:"Rehabilitation Oncology", icon:"Activity" },
],

nutritional_oncology: [
  { id:5101, title:"ASPEN Cancer Nutrition Guidelines", reference:"ASPEN", explanation:"Nutritional support in cancer patients.", category:"Nutritional Oncology", icon:"Activity" },
  { id:5102, title:"ESPEN Cancer Nutrition Guidelines", reference:"ESPEN", explanation:"European clinical nutrition in oncology.", category:"Nutritional Oncology", icon:"Activity" },
  { id:5103, title:"NCCN Nutrition Guidelines", reference:"NCCN", explanation:"Nutritional management in cancer care.", category:"Nutritional Oncology", icon:"Activity" },
  { id:5104, title:"ASCO Nutrition Guidelines", reference:"ASCO", explanation:"Dietary interventions in oncology.", category:"Nutritional Oncology", icon:"Activity" },
  { id:5105, title:"ESMO Nutrition Guidelines", reference:"ESMO", explanation:"European cancer nutrition standards.", category:"Nutritional Oncology", icon:"Activity" },
  { id:5106, title:"AND Oncology Nutrition", reference:"Academy of Nutrition and Dietetics", explanation:"Medical nutrition therapy in cancer.", category:"Nutritional Oncology", icon:"Activity" },
  { id:5107, title:"ASPEN Enteral Nutrition", reference:"ASPEN", explanation:"Tube feeding in cancer patients.", category:"Nutritional Oncology", icon:"Activity" },
  { id:5108, title:"ESPEN Parenteral Nutrition", reference:"ESPEN", explanation:"TPN in oncology setting.", category:"Nutritional Oncology", icon:"Activity" },
  { id:5109, title:"NCCN Cachexia Guidelines", reference:"NCCN", explanation:"Cancer cachexia diagnosis and management.", category:"Nutritional Oncology", icon:"Activity" },
  { id:5110, title:"ESMO Sarcopenia Guidelines", reference:"ESMO", explanation:"Sarcopenia assessment in cancer patients.", category:"Nutritional Oncology", icon:"Activity" },
],

psycho_oncology: [
  { id:5201, title:"IPOS Psycho-Oncology Guidelines", reference:"International Psycho-Oncology Society", explanation:"Psychosocial care standards in oncology.", category:"Psycho-oncology", icon:"Activity" },
  { id:5202, title:"NCCN Distress Management", reference:"NCCN", explanation:"Distress screening and management in cancer patients.", category:"Psycho-oncology", icon:"Activity" },
  { id:5203, title:"ASCO Psychosocial Guidelines", reference:"ASCO", explanation:"Psychosocial support in cancer care.", category:"Psycho-oncology", icon:"Activity" },
  { id:5204, title:"ESMO Psycho-Oncology", reference:"ESMO", explanation:"European psychosocial oncology standards.", category:"Psycho-oncology", icon:"Activity" },
  { id:5205, title:"APA Cancer Psychology", reference:"American Psychological Association", explanation:"Psychological interventions for cancer patients.", category:"Psycho-oncology", icon:"Activity" },
  { id:5206, title:"NCCN Anxiety/Depression", reference:"NCCN", explanation:"Psychiatric symptom management in cancer.", category:"Psycho-oncology", icon:"Activity" },
  { id:5207, title:"MASCC Psychosocial Guidelines", reference:"MASCC", explanation:"Psychosocial support in palliative oncology.", category:"Psycho-oncology", icon:"Activity" },
  { id:5208, title:"IPOS Fear of Recurrence", reference:"IPOS", explanation:"Managing fear of cancer recurrence.", category:"Psycho-oncology", icon:"Activity" },
  { id:5209, title:"ASCO End-of-Life Communication", reference:"ASCO", explanation:"Breaking bad news and advance care planning.", category:"Psycho-oncology", icon:"Activity" },
  { id:5210, title:"ESMO Quality of Life", reference:"ESMO", explanation:"QoL assessment and management in oncology.", category:"Psycho-oncology", icon:"Activity" },
],

cancer_screening_programs: [
  { id:5301, title:"USPSTF Cancer Screening", reference:"USPSTF", explanation:"Breast, cervical, colorectal, lung cancer screening.", category:"Preventive Oncology", icon:"Microscope" },
  { id:5302, title:"WHO Cancer Screening Guidelines", reference:"WHO", explanation:"Global cancer screening recommendations.", category:"Preventive Oncology", icon:"FileText" },
  { id:5303, title:"ACS Cancer Screening Guidelines", reference:"American Cancer Society", explanation:"Population-based cancer screening standards.", category:"Preventive Oncology", icon:"Activity" },
  { id:5304, title:"ECAC Screening Recommendations", reference:"European Code Against Cancer", explanation:"European cancer screening protocols.", category:"Preventive Oncology", icon:"Activity" },
  { id:5305, title:"IARC Screening Handbook", reference:"IARC", explanation:"Evidence-based cancer screening.", category:"Preventive Oncology", icon:"BookOpen" },
  { id:5306, title:"CDC Cancer Screening Programs", reference:"CDC", explanation:"US public screening program guidelines.", category:"Preventive Oncology", icon:"FileText" },
  { id:5307, title:"NCCN Early Detection", reference:"NCCN", explanation:"Early cancer detection guidelines.", category:"Preventive Oncology", icon:"Activity" },
  { id:5308, title:"UICC Screening Guidelines", reference:"UICC", explanation:"International screening program standards.", category:"Preventive Oncology", icon:"Activity" },
  { id:5309, title:"ESMO Screening Guidelines", reference:"ESMO", explanation:"European cancer screening recommendations.", category:"Preventive Oncology", icon:"Activity" },
  { id:5310, title:"NSGC Genetic Screening", reference:"NSGC", explanation:"Hereditary cancer screening programs.", category:"Preventive Oncology", icon:"Droplets" },
],
  medical_oncology: [
    { id:1401, title:"NCCN Medical Oncology Guidelines", reference:"NCCN", explanation:"Systemic therapy for solid tumors including chemotherapy, immunotherapy, and targeted agents.", category:"Medical Oncology", icon:"Activity" },
    { id:1402, title:"ASCO Medical Oncology Guidelines", reference:"ASCO", explanation:"Evidence-based systemic cancer treatment recommendations.", category:"Medical Oncology", icon:"Activity" },
    { id:1403, title:"ESMO Clinical Practice Guidelines", reference:"ESMO", explanation:"European medical oncology standards.", category:"Medical Oncology", icon:"Activity" },
    { id:1404, title:"NCG India Guidelines", reference:"National Cancer Grid, India", explanation:"Indian medical oncology treatment protocols.", category:"Medical Oncology", icon:"Activity" },
    { id:1405, title:"NCI Medical Oncology Protocols", reference:"NCI", explanation:"Research-based systemic therapy protocols.", category:"Medical Oncology", icon:"Microscope" },
    { id:1406, title:"CCO Systemic Therapy Guidelines", reference:"Cancer Care Ontario", explanation:"Regional medical oncology standards.", category:"Medical Oncology", icon:"Activity" },
    { id:1407, title:"ESMO Scale for CTCAE", reference:"ESMO", explanation:"Toxicity management in medical oncology.", category:"Medical Oncology", icon:"Activity" },
    { id:1408, title:"ASCO Quality Oncology", reference:"ASCO", explanation:"Quality measures in medical oncology practice.", category:"Medical Oncology", icon:"CheckCircle" },
    { id:1409, title:"NCCN Older Adult Oncology", reference:"NCCN", explanation:"Geriatric medical oncology management.", category:"Medical Oncology", icon:"Activity" },
    { id:1410, title:"ESCAT Precision Medicine", reference:"ESMO", explanation:"Molecular targets for medical oncology.", category:"Medical Oncology", icon:"Microscope" },
  ],

  surgical_oncology: [
    { id:1501, title:"SSO Surgical Oncology Guidelines", reference:"Society of Surgical Oncology", explanation:"Cancer surgery standards and indications.", category:"Surgical Oncology", icon:"Heart" },
    { id:1502, title:"ACS Cancer Surgery Guidelines", reference:"American College of Surgeons", explanation:"Oncologic resection principles.", category:"Surgical Oncology", icon:"Heart" },
    { id:1503, title:"ESSO Guidelines", reference:"European Society of Surgical Oncology", explanation:"European surgical oncology standards.", category:"Surgical Oncology", icon:"Heart" },
    { id:1504, title:"NCCN Surgical Margins Guidelines", reference:"NCCN", explanation:"Margin assessment and adequacy standards.", category:"Surgical Oncology", icon:"Heart" },
    { id:1505, title:"ASBrS Oncoplastic Guidelines", reference:"American Society of Breast Surgeons", explanation:"Oncoplastic surgery techniques.", category:"Surgical Oncology", icon:"Heart" },
    { id:1506, title:"ERAS Oncology Guidelines", reference:"ERAS Society", explanation:"Enhanced recovery after cancer surgery.", category:"Surgical Oncology", icon:"Activity" },
    { id:1507, title:"IHPBA Hepatobiliary Guidelines", reference:"IHPBA", explanation:"Liver and pancreatic cancer surgery.", category:"Surgical Oncology", icon:"Heart" },
    { id:1508, title:"STS Thoracic Surgery Guidelines", reference:"Society of Thoracic Surgeons", explanation:"Thoracic oncologic surgery standards.", category:"Surgical Oncology", icon:"Heart" },
    { id:1509, title:"SUO Urologic Surgery Guidelines", reference:"Society of Urologic Oncology", explanation:"Urologic cancer surgery standards.", category:"Surgical Oncology", icon:"Heart" },
    { id:1510, title:"SAGES Laparoscopic Oncology", reference:"SAGES", explanation:"Minimally invasive cancer surgery.", category:"Surgical Oncology", icon:"Heart" },
  ],

  neuro_oncology: [
    { id:1601, title:"NCCN CNS Cancer Guidelines", reference:"NCCN", explanation:"Gliomas, meningiomas, and brain metastases management.", category:"Neuro-oncology", icon:"Activity" },
    { id:1602, title:"EANO Guidelines", reference:"European Association of Neuro-Oncology", explanation:"European brain tumor treatment standards.", category:"Neuro-oncology", icon:"Activity" },
    { id:1603, title:"SNO Guidelines", reference:"Society for Neuro-Oncology", explanation:"Neuro-oncology clinical practice standards.", category:"Neuro-oncology", icon:"Activity" },
    { id:1604, title:"RANO Response Criteria", reference:"RANO Working Group", explanation:"Response assessment in neuro-oncology.", category:"Neuro-oncology", icon:"Microscope" },
    { id:1605, title:"ASCO Brain Metastases", reference:"ASCO", explanation:"Management of brain metastases from solid tumors.", category:"Neuro-oncology", icon:"Activity" },
    { id:1606, title:"ESMO Primary Brain Tumors", reference:"ESMO", explanation:"European guidelines for primary CNS tumors.", category:"Neuro-oncology", icon:"Activity" },
    { id:1607, title:"NCCN Spinal Cord Tumors", reference:"NCCN", explanation:"Primary and metastatic spinal tumors.", category:"Neuro-oncology", icon:"Activity" },
    { id:1608, title:"AANS/CNS Tumor Guidelines", reference:"American Association of Neurological Surgeons", explanation:"Neurosurgical oncology standards.", category:"Neuro-oncology", icon:"Heart" },
    { id:1609, title:"SIOPE Pediatric Neuro-oncology", reference:"SIOPE", explanation:"Pediatric brain tumor guidelines.", category:"Pediatric Oncology", icon:"Activity" },
    { id:1610, title:"NOA Neuro-oncology Guidelines", reference:"Neuro-Oncology Working Group Germany", explanation:"German neuro-oncology standards.", category:"Neuro-oncology", icon:"Activity" },
  ],

  pediatric_oncology: [
    { id:1701, title:"COG Pediatric Guidelines", reference:"Children's Oncology Group", explanation:"Childhood cancer treatment protocols.", category:"Pediatric Oncology", icon:"Activity" },
    { id:1702, title:"SIOP Guidelines", reference:"International Society of Pediatric Oncology", explanation:"Global pediatric cancer standards.", category:"Pediatric Oncology", icon:"Activity" },
    { id:1703, title:"NCCN Pediatric Guidelines", reference:"NCCN", explanation:"Pediatric solid tumor management.", category:"Pediatric Oncology", icon:"Activity" },
    { id:1704, title:"UKCCLG Guidelines", reference:"UK Children's Cancer and Leukaemia Group", explanation:"British pediatric oncology standards.", category:"Pediatric Oncology", icon:"Activity" },
    { id:1705, title:"GPOH Guidelines", reference:"German Society of Pediatric Oncology", explanation:"German pediatric cancer protocols.", category:"Pediatric Oncology", icon:"Activity" },
    { id:1706, title:"CCLG Late Effects Guidelines", reference:"Children's Cancer and Leukaemia Group", explanation:"Long-term follow-up of childhood cancer survivors.", category:"Pediatric Oncology", icon:"Activity" },
    { id:1707, title:"SIOPE Rare Tumors", reference:"SIOPE", explanation:"Rare pediatric tumors management.", category:"Pediatric Oncology", icon:"Activity" },
    { id:1708, title:"ACR Pediatric Imaging", reference:"American College of Radiology", explanation:"Imaging children with cancer.", category:"Pediatric Oncology", icon:"Microscope" },
    { id:1709, title:"PRISM Palliative Care", reference:"PRISM", explanation:"Pediatric palliative oncology standards.", category:"Palliative Oncology", icon:"Activity" },
    { id:1710, title:"IPSO Pediatric Surgery", reference:"International Pediatric Surgical Oncology", explanation:"Surgical management of childhood cancers.", category:"Pediatric Oncology", icon:"Heart" },
  ],

  hematologic_oncology: [
    { id:1801, title:"NCCN Hematologic Guidelines", reference:"NCCN", explanation:"Leukemia, lymphoma, myeloma, and MDS management.", category:"Hematologic Oncology", icon:"Activity" },
    { id:1802, title:"ASH Guidelines", reference:"American Society of Hematology", explanation:"Evidence-based hematologic malignancy treatment.", category:"Hematologic Oncology", icon:"Activity" },
    { id:1803, title:"EHA Guidelines", reference:"European Hematology Association", explanation:"European hematologic cancer standards.", category:"Hematologic Oncology", icon:"Activity" },
    { id:1804, title:"ELN AML Guidelines", reference:"European LeukemiaNet", explanation:"Acute myeloid leukemia diagnosis and treatment.", category:"Hematologic Oncology", icon:"Activity" },
    { id:1805, title:"iWCLL Guidelines", reference:"International Workshop on CLL", explanation:"Chronic lymphocytic leukemia management.", category:"Hematologic Oncology", icon:"Activity" },
    { id:1806, title:"Lugano Classification", reference:"Lymphoma Lugano Group", explanation:"Lymphoma response criteria.", category:"Hematologic Oncology", icon:"Microscope" },
    { id:1807, title:"IMWG Myeloma Guidelines", reference:"International Myeloma Working Group", explanation:"Multiple myeloma diagnosis and treatment.", category:"Hematologic Oncology", icon:"Activity" },
    { id:1808, title:"EBMT Transplant Guidelines", reference:"European Society for Blood and Marrow Transplantation", explanation:"Stem cell transplantation standards.", category:"Hematologic Oncology", icon:"Activity" },
    { id:1809, title:"BCSH Guidelines", reference:"British Committee for Standards in Haematology", explanation:"British hematologic cancer standards.", category:"Hematologic Oncology", icon:"Activity" },
    { id:1810, title:"IWC MDS Guidelines", reference:"International Working Group on MDS", explanation:"Myelodysplastic syndromes management.", category:"Hematologic Oncology", icon:"Activity" },
  ],

  pathology: [
    { id:1901, title:"CAP Cancer Protocols", reference:"College of American Pathologists", explanation:"Cancer pathology reporting standards.", category:"Pathology", icon:"Microscope" },
    { id:1902, title:"RCPath Guidelines", reference:"Royal College of Pathologists", explanation:"UK pathology reporting standards.", category:"Pathology", icon:"Microscope" },
    { id:1903, title:"ICCR Datasets", reference:"International Collaboration on Cancer Reporting", explanation:"International pathology reporting standards.", category:"Pathology", icon:"Microscope" },
    { id:1904, title:"WHO Classification of Tumours", reference:"WHO", explanation:"Global tumor classification standards.", category:"Pathology", icon:"BookOpen" },
    { id:1905, title:"AJCC Pathology Reporting", reference:"AJCC", explanation:"Pathology staging integration.", category:"Pathology", icon:"Microscope" },
    { id:1906, title:"IARC Pathology Guidelines", reference:"International Agency for Research on Cancer", explanation:"Cancer pathology quality assurance.", category:"Pathology", icon:"Microscope" },
    { id:1907, title:"ASCP Pathology Guidelines", reference:"American Society for Clinical Pathology", explanation:"Laboratory cancer diagnostic standards.", category:"Pathology", icon:"Microscope" },
    { id:1908, title:"ESMO Pathology Recommendations", reference:"ESMO", explanation:"Pathology for precision oncology.", category:"Pathology", icon:"Microscope" },
    { id:1909, title:"PALGA Guidelines", reference:"PALGA Foundation", explanation:"Pathology data standards.", category:"Pathology", icon:"Microscope" },
    { id:1910, title:"ISBER Biobanking Standards", reference:"International Society for Biological and Environmental Repositories", explanation:"Tissue banking for cancer pathology.", category:"Pathology", icon:"Microscope" },
  ],

  molecular_pathology: [
    { id:2001, title:"AMP Molecular Guidelines", reference:"Association for Molecular Pathology", explanation:"Molecular diagnostic standards.", category:"Molecular Pathology", icon:"Microscope" },
    { id:2002, title:"CAP/AMP Molecular Reporting", reference:"CAP/AMP", explanation:"Molecular oncology report standards.", category:"Molecular Pathology", icon:"Microscope" },
    { id:2003, title:"ESMO Molecular Testing", reference:"ESMO", explanation:"Biomarker testing recommendations.", category:"Molecular Pathology", icon:"Microscope" },
    { id:2004, title:"NCCN Molecular Markers", reference:"NCCN", explanation:"Companion diagnostic guidelines.", category:"Molecular Pathology", icon:"Microscope" },
    { id:2005, title:"ACMG Genetic Variants", reference:"American College of Medical Genetics", explanation:"Variant interpretation standards.", category:"Molecular Pathology", icon:"Microscope" },
    { id:2006, title:"ClinGen Guidelines", reference:"ClinGen Consortium", explanation:"Clinical validity of molecular markers.", category:"Molecular Pathology", icon:"Microscope" },
    { id:2007, title:"EuroGentest Guidelines", reference:"EuroGentest", explanation:"European molecular diagnostics standards.", category:"Molecular Pathology", icon:"Microscope" },
    { id:2008, title:"FDA/CDRH Companion Dx", reference:"FDA", explanation:"Regulatory standards for companion diagnostics.", category:"Molecular Pathology", icon:"FileText" },
    { id:2009, title:"IQNPath NGS Guidelines", reference:"IQNPath", explanation:"Next-generation sequencing in oncology.", category:"Molecular Pathology", icon:"Microscope" },
    { id:2010, title:"MPATH-DX Nomenclature", reference:"MPATH-DX Working Group", explanation:"Molecular pathology nomenclature standards.", category:"Molecular Pathology", icon:"Microscope" },
  ],

  nuclear_medicine: [
    { id:2101, title:"SNMMI Guidelines", reference:"Society of Nuclear Medicine and Molecular Imaging", explanation:"PET/CT, SPECT, and radionuclide therapy standards.", category:"Nuclear Medicine", icon:"Activity" },
    { id:2102, title:"EANM Guidelines", reference:"European Association of Nuclear Medicine", explanation:"European nuclear medicine oncology standards.", category:"Nuclear Medicine", icon:"Activity" },
    { id:2103, title:"ACR-ACNM PET/CT", reference:"American College of Radiology", explanation:"PET/CT imaging protocols.", category:"Nuclear Medicine", icon:"Microscope" },
    { id:2104, title:"IAEA Nuclear Medicine", reference:"International Atomic Energy Agency", explanation:"Global nuclear medicine safety standards.", category:"Nuclear Medicine", icon:"FileText" },
    { id:2105, title:"RADIANCE Theranostics", reference:"RADIANCE Consortium", explanation:"Theranostic agent guidelines.", category:"Nuclear Medicine", icon:"Activity" },
    { id:2106, title:"ASTRO Radionuclide Therapy", reference:"ASTRO", explanation:"Radionuclide therapy standards.", category:"Nuclear Medicine", icon:"Activity" },
    { id:2107, title:"EANM Dosimetry", reference:"EANM", explanation:"Radiation dosimetry in nuclear oncology.", category:"Nuclear Medicine", icon:"Activity" },
    { id:2108, title:"PSMA PET Guidelines", reference:"SNMMI/EANM", explanation:"PSMA PET imaging for prostate cancer.", category:"Nuclear Medicine", icon:"Microscope" },
    { id:2109, title:"FDG PET/CT Guidelines", reference:"SNMMI", explanation:"FDG PET/CT in oncology.", category:"Nuclear Medicine", icon:"Microscope" },
    { id:2110, title:"EANM Bone Metastasis", reference:"EANM", explanation:"Radionuclide therapy for bone metastases.", category:"Nuclear Medicine", icon:"Activity" },
  ],

  interventional_oncology: [
    { id:2201, title:"CIRSE Guidelines", reference:"Cardiovascular and Interventional Radiological Society of Europe", explanation:"Interventional oncology procedures.", category:"Interventional Oncology", icon:"Activity" },
    { id:2202, title:"SIR Guidelines", reference:"Society of Interventional Radiology", explanation:"Image-guided cancer interventions.", category:"Interventional Oncology", icon:"Activity" },
    { id:2203, title:"ACR Interventional Guidelines", reference:"American College of Radiology", explanation:"Interventional oncology standards.", category:"Interventional Oncology", icon:"Microscope" },
    { id:2204, title:"TACE Guidelines", reference:"CIRSE/SIR", explanation:"Transarterial chemoembolization standards.", category:"Interventional Oncology", icon:"Activity" },
    { id:2205, title:"RFA/MWA Guidelines", reference:"CIRSE", explanation:"Ablation therapy standards.", category:"Interventional Oncology", icon:"Activity" },
    { id:2206, title:"Y-90 Radioembolization", reference:"CIRSE/SIR", explanation:"Selective internal radiation therapy.", category:"Interventional Oncology", icon:"Activity" },
    { id:2207, title:"CIRSE Portal Vein Embolization", reference:"CIRSE", explanation:"Preoperative PVE guidelines.", category:"Interventional Oncology", icon:"Activity" },
    { id:2208, title:"SIR-Biliary Interventions", reference:"SIR", explanation:"Biliary drainage and stenting in cancer.", category:"Interventional Oncology", icon:"Activity" },
    { id:2209, title:"CLIP Guidelines", reference:"CLIP Consortium", explanation:"Interventional oncology for liver cancer.", category:"Interventional Oncology", icon:"Activity" },
    { id:2210, title:"EIO Guidelines", reference:"European Institute of Oncology", explanation:"Interventional oncology quality standards.", category:"Interventional Oncology", icon:"CheckCircle" },
  ],

  palliative_oncology: [
    { id:2301, title:"NCCN Palliative Care Guidelines", reference:"NCCN", explanation:"Palliative care integration in oncology.", category:"Palliative Oncology", icon:"Activity" },
    { id:2302, title:"ASCO Palliative Care Guidelines", reference:"ASCO", explanation:"Early palliative care standards.", category:"Palliative Oncology", icon:"Activity" },
    { id:2303, title:"ESMO Palliative Care", reference:"ESMO", explanation:"European palliative oncology standards.", category:"Palliative Oncology", icon:"Activity" },
    { id:2304, title:"WHO Palliative Care", reference:"WHO", explanation:"Global palliative cancer care standards.", category:"Palliative Oncology", icon:"FileText" },
    { id:2305, title:"AAHPM Guidelines", reference:"American Academy of Hospice and Palliative Medicine", explanation:"Hospice and palliative medicine standards.", category:"Palliative Oncology", icon:"Activity" },
    { id:2306, title:"EAPC Guidelines", reference:"European Association for Palliative Care", explanation:"European palliative care standards.", category:"Palliative Oncology", icon:"Activity" },
    { id:2307, title:"NCP Guidelines", reference:"National Consensus Project", explanation:"Clinical practice guidelines for quality palliative care.", category:"Palliative Oncology", icon:"CheckCircle" },
    { id:2308, title:"ESMO Symptom Management", reference:"ESMO", explanation:"Cancer symptom management guidelines.", category:"Palliative Oncology", icon:"Activity" },
    { id:2309, title:"ASCO Prognostic Tools", reference:"ASCO", explanation:"Prognostication in palliative oncology.", category:"Palliative Oncology", icon:"Activity" },
    { id:2310, title:"ICPCN Pediatric Palliative", reference:"International Children's Palliative Care Network", explanation:"Pediatric palliative oncology standards.", category:"Palliative Oncology", icon:"Activity" },
  ],

  pain_management: [
    { id:2401, title:"WHO Analgesic Ladder", reference:"WHO", explanation:"Cancer pain management guidelines.", category:"Pain Management", icon:"Activity" },
    { id:2402, title:"ASCO Pain Management", reference:"ASCO", explanation:"Cancer pain assessment and treatment.", category:"Pain Management", icon:"Activity" },
    { id:2403, title:"ESMO Pain Guidelines", reference:"ESMO", explanation:"European cancer pain standards.", category:"Pain Management", icon:"Activity" },
    { id:2404, title:"CDC Opioid Guidelines", reference:"CDC", explanation:"Opioid prescribing for cancer pain.", category:"Pain Management", icon:"FileText" },
    { id:2405, title:"IASP Cancer Pain", reference:"International Association for the Study of Pain", explanation:"Specialized cancer pain management.", category:"Pain Management", icon:"Activity" },
    { id:2406, title:"ASPMN Guidelines", reference:"American Society for Pain Management Nursing", explanation:"Nursing standards for cancer pain.", category:"Pain Management", icon:"Activity" },
    { id:2407, title:"EAPC Cancer Pain", reference:"European Association for Palliative Care", explanation:"European cancer pain standards.", category:"Pain Management", icon:"Activity" },
    { id:2408, title:"NCCN Adult Cancer Pain", reference:"NCCN", explanation:"Comprehensive cancer pain management.", category:"Pain Management", icon:"Activity" },
    { id:2409, title:"RCPI Pain Guidelines", reference:"Royal College of Physicians of Ireland", explanation:"Interventional pain management in cancer.", category:"Pain Management", icon:"Activity" },
    { id:2410, title:"WSPM Cancer Pain", reference:"World Society of Pain Management", explanation:"Global cancer pain standards.", category:"Pain Management", icon:"Activity" },
  ],

  preventive_oncology: [
    { id:2501, title:"USPSTF Cancer Screening", reference:"USPSTF", explanation:"Breast, cervical, colorectal, lung cancer screening.", category:"Preventive Oncology", icon:"Microscope" },
    { id:2502, title:"WHO Cancer Prevention", reference:"WHO", explanation:"Global cancer prevention strategies.", category:"Preventive Oncology", icon:"FileText" },
    { id:2503, title:"ACS Cancer Prevention", reference:"American Cancer Society", explanation:"Lifestyle and vaccination for cancer prevention.", category:"Preventive Oncology", icon:"Activity" },
    { id:2504, title:"ECAC Cancer Screening", reference:"European Code Against Cancer", explanation:"European cancer screening standards.", category:"Preventive Oncology", icon:"Activity" },
    { id:2505, title:"NCCN Risk Reduction", reference:"NCCN", explanation:"Genetic and lifestyle risk reduction.", category:"Preventive Oncology", icon:"Activity" },
    { id:2506, title:"IARC Prevention Handbook", reference:"International Agency for Research on Cancer", explanation:"Evidence-based cancer prevention.", category:"Preventive Oncology", icon:"BookOpen" },
    { id:2507, title:"ASCO Primary Prevention", reference:"ASCO", explanation:"Cancer prevention in clinical practice.", category:"Preventive Oncology", icon:"Activity" },
    { id:2508, title:"CDC Cancer Screening", reference:"CDC", explanation:"US population screening guidelines.", category:"Preventive Oncology", icon:"FileText" },
    { id:2509, title:"UICC Cancer Control", reference:"Union for International Cancer Control", explanation:"National cancer control programs.", category:"Preventive Oncology", icon:"Activity" },
    { id:2510, title:"CNS Cancer Screening", reference:"Cancer Network Sweden", explanation:"Scandinavian screening standards.", category:"Preventive Oncology", icon:"Activity" },
  ],

  genetic_counseling: [
    { id:2601, title:"NSGC Genetic Counseling", reference:"National Society of Genetic Counselors", explanation:"Hereditary cancer genetic counseling standards.", category:"Genetic Counseling", icon:"Droplets" },
    { id:2602, title:"ACMG Cancer Genetics", reference:"American College of Medical Genetics", explanation:"Hereditary cancer testing guidelines.", category:"Genetic Counseling", icon:"Droplets" },
    { id:2603, title:"NCCN Genetic Testing", reference:"NCCN", explanation:"BRCA, Lynch syndrome, and other hereditary cancers.", category:"Genetic Counseling", icon:"Activity" },
    { id:2604, title:"ESMO Hereditary Cancer", reference:"ESMO", explanation:"European hereditary cancer guidelines.", category:"Genetic Counseling", icon:"Activity" },
    { id:2605, title:"ASHG Counseling Guidelines", reference:"American Society of Human Genetics", explanation:"Genetic counseling best practices.", category:"Genetic Counseling", icon:"Droplets" },
    { id:2606, title:"ENIGMA Guidelines", reference:"ENIGMA Consortium", explanation:"Variant interpretation in hereditary cancer.", category:"Genetic Counseling", category:"Genetic Counseling", icon:"Microscope" },
    { id:2607, title:"CGC Certification Standards", reference:"Canadian College of Genetic Counsellors", explanation:"Canadian genetic counseling standards.", category:"Genetic Counseling", icon:"CheckCircle" },
    { id:2608, title:"EHTG Guidelines", reference:"European Hereditary Tumour Group", explanation:"European hereditary tumor management.", category:"Genetic Counseling", icon:"Activity" },
    { id:2609, title:"IGC Genetic Counseling", reference:"International Genetic Counseling", explanation:"Global genetic counseling standards.", category:"Genetic Counseling", icon:"FileText" },
    { id:2610, title:"GEC-KO Guidelines", reference:"GEC-KO Network", explanation:"Genetic counseling for hereditary cancer syndromes.", category:"Genetic Counseling", icon:"Droplets" },
  ],
};
const getIconComponent = (iconName, size = 14, color = T.textMuted) => {
  const map = { Heart, Activity, Stethoscope, Droplets, Microscope, Brain, Bone, Pill, Syringe };
  const Icon = map[iconName] || FileText;
  return <Icon size={size} color={color} />;
};

/* ─────────────────────────────────────────
   MAIN COMPONENT
───────────────────────────────────────── */
const GuidelinesSettings = () => {
  const location  = useLocation();
  const navigate  = useNavigate();
  const modalRef  = useRef();

  const query    = new URLSearchParams(location.search);
  const doctorId = query.get("doctor_id");

  const [selectedSpec,       setSelectedSpec]       = useState("");
  const [selectedGuidelines, setSelectedGuidelines] = useState([]);
  const [searchTerm,         setSearchTerm]         = useState("");
  const [showPreview,        setShowPreview]        = useState(false);
  const [doctorName,         setDoctorName]         = useState("");
  const [doctorSpeciality,   setDoctorSpeciality]   = useState("");
  const [customGuideline,    setCustomGuideline]    = useState({ title: "", reference: "", explanation: "" });

  /* ── fetch doctor details ── */
  useEffect(() => {
    if (!doctorId) return;
    fetch(`${API_BASE_URL}hms/users/doctors/get_doctor/${doctorId}`)
      .then(r => r.json())
      .then(d => {
        if (d.status === "success") {
          const doc = d.doctor;
          setDoctorName(doc.name || "Doctor");
          setDoctorSpeciality(doc.specialization || "");
          if (doc.specialization) {
            const mapped = SPECIALIZATION_MAP[doc.specialization.toLowerCase().trim()];
            setSelectedSpec(mapped);
          }
        }
      })
      .catch(console.error);
  }, [doctorId]);

  /* ── fetch saved guidelines ── */
  useEffect(() => {
    if (!doctorId || !selectedSpec) return;
    fetch(`${API_BASE_URL}hms/users/data/context/get_DoctorGuidelines/${doctorId}/${selectedSpec}`)
      .then(r => r.json())
      .then(d => {
        if (d.status === "success" && d.data.guidelines) {
          setSelectedGuidelines(d.data.guidelines.map(g => ({ ...g, icon: "FileText" })));
        }
      })
      .catch(console.error);
  }, [doctorId, selectedSpec]);

  /* ── click-outside modal ── */
  useEffect(() => {
    if (!showPreview) return;
    const handler = (e) => { if (modalRef.current && !modalRef.current.contains(e.target)) setShowPreview(false); };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [showPreview]);

  const currentGuidelines = GUIDELINES_BY_SPECIALIZATION[selectedSpec] || [];
  const filtered = currentGuidelines.filter(g =>
    g.title.toLowerCase().includes(searchTerm.toLowerCase()) ||
    g.reference.toLowerCase().includes(searchTerm.toLowerCase()) ||
    g.category.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const handleSelect   = (g)  => { if (!selectedGuidelines.find(x => x.id === g.id)) setSelectedGuidelines(p => [...p, g]); };
  const handleRemove   = (id) => setSelectedGuidelines(p => p.filter(g => g.id !== id));
  const isSelected     = (id) => !!selectedGuidelines.find(g => g.id === id);

  const handleAddCustom = () => {
    if (!customGuideline.title || !customGuideline.reference || !customGuideline.explanation) { alert("Please fill in all fields."); return; }
    setSelectedGuidelines(p => [...p, { id: Date.now(), ...customGuideline, category: "Custom", icon: "FileText", isCustom: true }]);
    setCustomGuideline({ title: "", reference: "", explanation: "" });
  };

  const handleSaveAll = async () => {
    if (!selectedGuidelines.length) { alert("Please select at least one guideline."); return; }
    try {
      const res = await fetch(`${API_BASE_URL}/hms/users/data/context/save_DoctorGuidelines`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ doctorId, specialization: selectedSpec, guidelines: selectedGuidelines.map(g => ({ id: g.id, title: g.title, reference: g.reference, explanation: g.explanation })) }),
      });
      if (!res.ok) throw new Error();
      alert("Guidelines saved successfully.");
    } catch { alert("Error saving guidelines."); }
  };

  const handleLogout = async () => {
    try { await fetch(`${API_BASE_URL}/hms/users/auth/logout`, { method: "POST", credentials: "include" }); }
    finally { navigate("/login"); }
  };

  const navItems = [
    { label: "Dashboard",                       icon: <Home size={14} />,    onClick: () => navigate(`/doctor-dashboard?doctor_id=${doctorId}`) },
    { label: "Medical Context Skills",    icon: <Calendar size={14} />,onClick: () => navigate(`/medical-current-context-rule-settings?doctor_id=${doctorId}`) },
    { label: "Structured Note Skills",    icon: <Notebook size={14} />,onClick: () => navigate(`/structured-note-instructions-settings?doctor_id=${doctorId}`) },
    { label: "Guidelines Skills",             icon: <FileText size={14} />,active: true, onClick: () => navigate(`/guidelines-settings?doctor_id=${doctorId}`) },
  ];

  /* ─── cell styles ─── */
  const TH = {
    padding: "0.625rem 1rem", fontSize: "0.6rem", fontWeight: 400,
    textTransform: "uppercase", letterSpacing: "0.12em", color: T.textMuted,
    borderBottom: `1px solid ${T.border}`, background: T.bgAlt, textAlign: "left",
  };

  return (
    <>
      <style>{CSS}</style>
      <div style={{ display: "flex", minHeight: "100vh", background: T.bg, fontFamily: T.font, fontWeight: 300, color: T.text }}>

        {/* ══════════ SIDEBAR ══════════ */}
        <aside style={{
          width: SIDEBAR_W, minHeight: "100vh",
          position: "fixed", top: 0, left: 0, bottom: 0, zIndex: 100,
          background: T.bg, borderRight: `1px solid ${T.border}`,
          display: "flex", flexDirection: "column",
        }}>
          <div style={{ padding: "1.5rem 1.5rem 1rem", borderBottom: `1px solid ${T.border}`, flexShrink: 0 }}>
            <div style={{ display: "flex", alignItems: "center", gap: "10px", marginBottom: "1.25rem" }}>
             
              <span style={{ fontSize: "0.9rem", fontWeight: 400, letterSpacing: "-0.01em", color: T.text }}>Doctorassist.AI</span>
            </div>
            <span style={S.secLabel}>Physician</span>
            <p style={{ fontSize: "0.85rem", fontWeight: 400, color: T.text, margin: 0 }}>{doctorName || "Loading…"}</p>
            <p style={{ fontSize: "0.7rem", color: T.textMuted, marginTop: "2px" }}>{doctorSpeciality || "—"}</p>
          </div>

          <nav className="da-sidebar-scroll" style={{ flex: 1, overflowY: "auto", padding: "0.75rem 0" }}>
            <span style={{ fontSize: "0.58rem", textTransform: "uppercase", letterSpacing: "0.15em", color: T.textMuted, padding: "0.5rem 1.25rem", display: "block" }}>Settings</span>
            {navItems.map((item, i) => (
              <button key={i} className={`da-nav-btn${item.active ? " da-active" : ""}`}
                onClick={item.onClick}
                style={{
                  width: "100%", background: "transparent", border: "none",
                  textAlign: "left", padding: "0.55rem 1.25rem",
                  fontSize: "0.78rem", fontWeight: item.active ? 400 : 300,
                  color: item.active ? T.text : T.textSec,
                  cursor: "pointer", display: "flex", alignItems: "flex-start", gap: "10px",
                  fontFamily: T.font, transition: "all 0.15s", lineHeight: 1.4,
                  borderLeft: item.active ? `2px solid ${T.borderStr}` : "2px solid transparent",
                }}>
                <span style={{ flexShrink: 0, marginTop: "2px" }}>{item.icon}</span>
                <span>{item.label}</span>
              </button>
            ))}
          </nav>

          <div style={{ padding: "1rem 1.25rem", borderTop: `1px solid ${T.border}`, flexShrink: 0 }}>
            <button className="da-btn-outline" style={{ ...S.btnOutline, width: "100%", justifyContent: "center" }} onClick={handleLogout}>
              <LogOut size={13} /> Logout
            </button>
          </div>
        </aside>

        {/* ══════════ MAIN ══════════ */}
        <main style={{ marginLeft: SIDEBAR_W, flex: 1, minWidth: 0, display: "flex", flexDirection: "column" }}>

          {/* top bar */}
          <div style={{
            position: "sticky", top: 0, zIndex: 50,
            background: T.bg, borderBottom: `1px solid ${T.border}`,
            padding: "0.875rem 2rem",
            display: "flex", justifyContent: "space-between", alignItems: "center",
          }}>
            <div>
              <span style={S.secLabel}>Clinical Configuration</span>
              <h1 style={{ fontSize: "1rem", fontWeight: 400, letterSpacing: "-0.01em", color: T.text, margin: 0 }}>
                Clinical Guidelines Management
              </h1>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: "0.75rem" }}>
              {selectedSpec && (
                <span style={S.badge}>{selectedSpec}</span>
              )}
              <button className="da-btn-outline" style={S.btnOutline} onClick={() => window.history.back()}>
                <ArrowLeft size={13} /> Back
              </button>
            </div>
          </div>

          {/* body */}
          <div style={{ padding: "1.5rem 2rem", flex: 1, display: "flex", flexDirection: "column", gap: "1.25rem" }}>

            {/* specialization strip */}
            {selectedSpec && (
              <div style={{ border: `1px solid ${T.border}`, background: T.bgAlt, padding: "0.875rem 1.25rem", display: "flex", alignItems: "center", gap: "1rem" }}>
                <span style={S.secLabel}>Specialization</span>
                <span style={{ fontSize: "0.9rem", fontWeight: 400, color: T.text }}>{doctorSpeciality || selectedSpec}</span>
                <span style={{ ...S.badge, marginLeft: "auto" }}>{(GUIDELINES_BY_SPECIALIZATION[selectedSpec] || []).length} guidelines available</span>
              </div>
            )}

            {/* two-column grid */}
            <div style={{ display: "grid", gridTemplateColumns: "380px 1fr", gap: "1.25rem", flex: 1, minHeight: 0 }}>

              {/* ─── LEFT: available guidelines ─── */}
              <div style={{ border: `1px solid ${T.border}`, background: T.bg, display: "flex", flexDirection: "column", overflow: "hidden" }}>
                <div style={S.panelHeader}>
                  <div style={S.panelTitle}><BookOpen size={13} color={T.textMuted} /> Available Guidelines</div>
                  <span style={S.badge}>{filtered.length}</span>
                </div>

                {/* search */}
                <div style={{ padding: "0.75rem 1rem", borderBottom: `1px solid ${T.border}`, display: "flex", alignItems: "center", gap: "8px", background: T.bgAlt }}>
                  <Search size={13} color={T.textMuted} strokeWidth={1.5} style={{ flexShrink: 0 }} />
                  <input
                    type="text" value={searchTerm} onChange={e => setSearchTerm(e.target.value)}
                    placeholder="Search guidelines…"
                    style={{ border: "none", background: "none", outline: "none", flex: 1, fontSize: "0.78rem", fontWeight: 300, color: T.text, fontFamily: T.font }}
                  />
                </div>

                {/* list */}
                <div className="da-list-scroll" style={{ flex: 1, overflowY: "auto" }}>
                  {filtered.map(g => (
                    <div key={g.id}
                      className={`da-guideline-card${isSelected(g.id) ? " da-selected" : ""}`}
                      style={{
                        padding: "0.875rem 1rem",
                        borderBottom: `1px solid ${T.border}`,
                        background: isSelected(g.id) ? T.bgAlt : T.bg,
                        borderLeft: isSelected(g.id) ? `2px solid ${T.borderStr}` : "2px solid transparent",
                      }}
                      onClick={() => handleSelect(g)}
                    >
                      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: "8px", marginBottom: "4px" }}>
                        <div style={{ display: "flex", alignItems: "center", gap: "7px", flex: 1, minWidth: 0 }}>
                          {getIconComponent(g.icon, 13)}
                          <span style={{ fontSize: "0.82rem", fontWeight: isSelected(g.id) ? 400 : 300, color: T.text, lineHeight: 1.4 }}>{g.title}</span>
                        </div>
                        {isSelected(g.id) && <CheckCircle size={12} color={T.text} style={{ flexShrink: 0, marginTop: "2px" }} />}
                      </div>
                      <div style={{ display: "flex", alignItems: "center", gap: "4px", marginBottom: "4px", paddingLeft: "20px" }}>
                        <Tag size={10} color={T.textMuted} />
                        <span style={{ fontSize: "0.65rem", color: T.textMuted, lineHeight: 1.4 }}>{g.reference}</span>
                      </div>
                      <div style={{ paddingLeft: "20px" }}>
                        <span style={S.badge}>{g.category}</span>
                      </div>
                    </div>
                  ))}
                  {filtered.length === 0 && (
                    <div style={{ padding: "2.5rem", textAlign: "center", fontSize: "0.78rem", color: T.textMuted }}>
                      No guidelines match "{searchTerm}"
                    </div>
                  )}
                </div>
              </div>

              {/* ─── RIGHT: selected + custom form ─── */}
              <div style={{ display: "flex", flexDirection: "column", gap: "1.25rem" }}>

                {/* selected guidelines */}
                <div style={{ border: `1px solid ${T.border}`, background: T.bg, display: "flex", flexDirection: "column", flex: 1, overflow: "hidden", minHeight: 300 }}>
                  <div style={S.panelHeader}>
                    <div style={S.panelTitle}><Sparkles size={13} color={T.textMuted} /> Selected Guidelines</div>
                    <span style={S.badge}>{selectedGuidelines.length} selected</span>
                  </div>

                  <div className="da-list-scroll" style={{ flex: 1, overflowY: "auto" }}>
                    {selectedGuidelines.length === 0 ? (
                      <div style={{ padding: "2.5rem", textAlign: "center" }}>
                        <FileText size={28} color={T.textMuted} style={{ opacity: 0.4, marginBottom: "0.75rem" }} />
                        <p style={{ fontSize: "0.78rem", color: T.textMuted, fontWeight: 300 }}>No guidelines selected yet.</p>
                        <p style={{ fontSize: "0.68rem", color: T.textMuted, marginTop: "4px" }}>Click a guideline on the left to add it here.</p>
                      </div>
                    ) : selectedGuidelines.map(g => (
                      <div key={g.id} className="da-selected-item"
                        style={{ padding: "0.875rem 1rem", borderBottom: `1px solid ${T.border}`, position: "relative", background: T.bg }}>
                        <button onClick={() => handleRemove(g.id)}
                          style={{ position: "absolute", top: "0.75rem", right: "0.75rem", background: "none", border: "none", cursor: "pointer", color: T.textMuted, padding: "2px", display: "flex" }}>
                          <X size={13} />
                        </button>

                        <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "0.5rem", paddingRight: "1.5rem" }}>
                          {getIconComponent(g.icon, 13)}
                          <span style={{ fontSize: "0.82rem", fontWeight: 400, color: T.text }}>{g.title}</span>
                          {g.isCustom && <span style={{ ...S.badge, marginLeft: "auto" }}>Custom</span>}
                        </div>
                        <p style={{ fontSize: "0.68rem", color: T.textMuted, marginBottom: "0.5rem", paddingLeft: "21px", fontWeight: 300 }}>
                          {g.reference}
                        </p>
                        <div style={{ borderLeft: `2px solid ${T.borderStr}`, paddingLeft: "0.875rem", marginLeft: "21px" }}>
                          <div style={{ display: "flex", alignItems: "center", gap: "5px", marginBottom: "3px" }}>
                            <Info size={11} color={T.textMuted} />
                            <span style={{ fontSize: "0.6rem", textTransform: "uppercase", letterSpacing: "0.12em", color: T.textMuted }}>Explanation</span>
                          </div>
                          <p style={{ fontSize: "0.75rem", color: T.textSec, lineHeight: 1.6, fontWeight: 300 }}>{g.explanation}</p>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                {/* custom guideline form */}
                <div style={{ border: `1px solid ${T.border}`, background: T.bgAlt }}>
                  <div style={S.panelHeader}>
                    <div style={S.panelTitle}><Plus size={13} color={T.textMuted} /> Add Custom Guideline</div>
                  </div>
                  <div style={{ padding: "1.25rem", display: "flex", flexDirection: "column", gap: "0.875rem" }}>
                    {[
                      { key: "title",       label: "Guideline Title",    ph: "e.g., Local Protocol for…" },
                      { key: "reference",   label: "Reference Source",   ph: "e.g., Hospital Protocol, Local Guidelines…" },
                    ].map(({ key, label, ph }) => (
                      <div key={key}>
                        <label style={{ ...S.secLabel, marginBottom: "0.35rem" }}>{label}</label>
                        <input className="da-input" type="text" placeholder={ph}
                          value={customGuideline[key]}
                          onChange={e => setCustomGuideline(p => ({ ...p, [key]: e.target.value }))} />
                      </div>
                    ))}
                    <div>
                      <label style={{ ...S.secLabel, marginBottom: "0.35rem" }}>Explanation</label>
                      <textarea className="da-input" rows={3} placeholder="Describe the guideline details…"
                        value={customGuideline.explanation}
                        onChange={e => setCustomGuideline(p => ({ ...p, explanation: e.target.value }))} />
                    </div>
                    <button className="da-btn-primary" style={{ ...S.btnPrimary, width: "100%", justifyContent: "center" }} onClick={handleAddCustom}>
                      <Plus size={13} /> Add Custom Guideline
                    </button>
                  </div>
                </div>
              </div>
            </div>

            {/* action bar */}
            <div style={{ border: `1px solid ${T.border}`, background: T.bgAlt, padding: "0.875rem 1.25rem", display: "flex", alignItems: "center", justifyContent: "space-between", gap: "0.75rem", flexWrap: "wrap" }}>
              <span style={{ fontSize: "0.72rem", color: T.textMuted }}>
                {selectedGuidelines.length} guideline{selectedGuidelines.length !== 1 ? "s" : ""} selected
              </span>
              <div style={{ display: "flex", gap: "0.625rem" }}>
                <button className="da-btn-outline" style={S.btnOutline} onClick={() => setShowPreview(true)}>
                  <Eye size={13} /> Preview ({selectedGuidelines.length})
                </button>
                <button className="da-btn-primary" style={S.btnPrimary} onClick={handleSaveAll}>
                  <Save size={13} /> Save All Guidelines
                </button>
              </div>
            </div>

          </div>
        </main>

        {/* ══════════ PREVIEW MODAL ══════════ */}
        {showPreview && (
          <div className="da-modal-overlay" style={{
            position: "fixed", inset: 0, zIndex: 200,
            background: "rgba(0,0,0,0.4)",
            display: "flex", alignItems: "center", justifyContent: "center",
          }}>
            <div ref={modalRef} style={{
              background: T.bg, border: `1px solid ${T.borderStr}`,
              width: 560, maxWidth: "92vw", maxHeight: "80vh",
              display: "flex", flexDirection: "column",
              boxShadow: "0 8px 32px rgba(0,0,0,0.16)",
            }}>
              {/* modal header */}
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "0.875rem 1.25rem", borderBottom: `1px solid ${T.border}`, background: T.bgAlt, flexShrink: 0 }}>
                <div style={S.panelTitle}><Eye size={13} color={T.textMuted} /> Preview — {selectedGuidelines.length} selected</div>
                <button onClick={() => setShowPreview(false)}
                  style={{ background: "none", border: "none", cursor: "pointer", color: T.textMuted, padding: "2px", display: "flex" }}>
                  <X size={15} />
                </button>
              </div>

              {/* modal list */}
              <div style={{ overflowY: "auto", flex: 1 }}>
                {selectedGuidelines.map((g, i) => (
                  <div key={g.id} style={{ padding: "0.875rem 1.25rem", borderBottom: `1px solid ${T.border}` }}>
                    <div style={{ display: "flex", alignItems: "center", gap: "7px", marginBottom: "3px" }}>
                      {getIconComponent(g.icon, 12)}
                      <span style={{ fontSize: "0.82rem", fontWeight: 400, color: T.text }}>{g.title}</span>
                      <span style={{ ...S.badge, marginLeft: "auto" }}>{g.category}</span>
                    </div>
                    <p style={{ fontSize: "0.68rem", color: T.textMuted, paddingLeft: "19px", fontWeight: 300 }}>{g.reference}</p>
                  </div>
                ))}
                {selectedGuidelines.length === 0 && (
                  <div style={{ padding: "2.5rem", textAlign: "center", fontSize: "0.78rem", color: T.textMuted }}>No guidelines selected.</div>
                )}
              </div>

              {/* modal footer */}
              <div style={{ padding: "0.875rem 1.25rem", borderTop: `1px solid ${T.border}`, background: T.bgAlt, display: "flex", justifyContent: "flex-end", flexShrink: 0 }}>
                <button className="da-btn-primary" style={S.btnPrimary} onClick={() => setShowPreview(false)}>
                  <CheckCircle size={13} /> OK
                </button>
              </div>
            </div>
          </div>
        )}

      </div>
    </>
  );
};

export default GuidelinesSettings;