// dashboardConfig.js — static skeleton for the Surgical Oncology Intelligence dashboard.
// Defines the 12 modules, their table columns, and the parameter list each one renders.
// Patient data (finding / status / reference / action) is supplied at runtime by the
// agent pipeline. Until that data exists for a given parameter, every cell falls back to
// "Not available" — the skeleton here is the single source of truth for structure.

export const NA = "Not available";

// Most modules share this 5-column layout.
export const STANDARD_COLUMNS = [
  { key: "parameter", label: "Parameter" },
  { key: "finding", label: "Current Finding" },
  { key: "reference", label: "Reference / Expected" },
  { key: "status", label: "Status", isStatus: true },
  { key: "action", label: "Indication / Action" },
];

// Module 9 (Documentation) uses a different column set.
export const DOC_COLUMNS = [
  { key: "parameter", label: "Document" },
  { key: "status", label: "Status", isStatus: true },
  { key: "lastGenerated", label: "Last Generated" },
  { key: "completeness", label: "Completeness" },
  { key: "action", label: "Indication / Action" },
];

// KPI strip — six headline metrics. Values + status come from agent data at runtime.
export const KPI_SLOTS = [
  { key: "resectionStatus", label: "Resection Status" },
  { key: "stageDiscordance", label: "Stage Discordance Engine" },
  { key: "complications", label: "Post-op Complications" },
  { key: "nodeYield", label: "Node Yield" },
  { key: "adjuvantDecision", label: "Adjuvant Decision" },
  { key: "dischargeReadiness", label: "Discharge Readiness" },
];

// Patient summary strip — six identity/context cells, all runtime-supplied.
export const PATIENT_STRIP_SLOTS = [
  { key: "patientId", label: "Patient ID" },
  { key: "diagnosis", label: "Diagnosis" },
  { key: "procedure", label: "Procedure" },
  { key: "pathologyStatus", label: "Pathology Status", collapsible: true },
  { key: "stageMigration", label: "Stage Migration" },
  { key: "reportGenerated", label: "Report Generated" },
];

export const MODULES = [
  {
    id: "m1", idx: "01", title: "Patient Assessment & Surgical Readiness",
    summary: "10 checks tracked",
    description: "Confirms the patient is fit and complete for surgery — eligibility, frailty, resectability, comorbidity optimization, and neoadjuvant response.",
    parameters: [
      "Surgical Eligibility", "ECOG/KPS & Frailty", "Operability & Resectability",
      "Pre-Anesthesia Risk (ASA)", "Comorbidity Optimization", "Nutritional Risk (NRS-2002)",
      "Infection & Contraindication Screening", "Baseline Investigation Completeness",
      "Neoadjuvant Response Assessment", "Pre-operative Checklist",
    ],
  },
  {
    id: "m2", idx: "02", title: "Diagnosis, Staging & Surgical Planning",
    summary: "15 checks tracked",
    description: "Guideline-aligned staging and operative strategy — procedure, margins, lymph node dissection, reconstruction, and approach, checked against tumor-specific protocols.",
    parameters: [
      "Clinical TNM Staging", "AJCC Stage Grouping", "Imaging & Pathology Correlation",
      "Surgical Procedure Recommendation", "Surgical Margin Planning", "Organ Preservation Assessment",
      "Lymph Node Dissection Recommendation", "Reconstruction Planning", "Surgical Approach",
      "High-Risk Anatomy Identification", "Pre-op Imaging Review", "Multidisciplinary Surgical Planning",
      "Surgical Guideline Recommendation", "Personalized Surgical Strategy", "Pre-operative Planning Summary",
    ],
  },
  {
    id: "m3", idx: "03", title: "Surgical Safety & Intraoperative Intelligence",
    summary: "12 checks tracked",
    description: "WHO checklist automation, prophylaxis, and real-time risk prediction during the case — a safety layer that runs alongside the operating team.",
    parameters: [
      "WHO Surgical Safety Checklist", "Procedure Verification", "Implant & Device Verification",
      "Blood Requirement Prediction", "Antibiotic Prophylaxis", "VTE Prophylaxis",
      "Intraoperative Risk Prediction", "Surgical Duration Prediction", "Intraoperative Complication",
      "Critical Structure Risk Alerts", "Intraoperative Documentation", "Surgical Workflow Dashboard",
    ],
  },
  {
    id: "m4", idx: "04", title: "Pathology Correlation & Margin Intelligence",
    summary: "15 checks tracked", flagship: true,
    flagshipTag: "Flagship · Stage Discordance Engine",
    flagshipNote: "Final pathology is automatically compared against the pre-operative clinical stage. Nodal upstaging and lymphovascular invasion are detected within minutes of the synoptic report being signed, and the case is returned to the MDT queue with an adjuvant therapy recommendation attached.",
    description: "The platform's flagship engines — clinical-vs-pathological stage discordance and margin/residual disease intelligence — run automatically the moment pathology is finalized.",
    parameters: [
      "Clinical vs. Pathological Stage", "Margin Status Analysis", "Positive Margin Detection",
      "Upstaging / Downstaging Detection", "Residual Disease Assessment", "Lymph Node Yield",
      "Lymph Node Ratio", "Histopathology Summarization", "Molecular Pathology Integration",
      "Biomarker Correlation", "Pathology Quality Validation", "Synoptic Report Completeness",
      "MDT Re-discussion Trigger", "Adjuvant Therapy Trigger", "Surgical Outcome Summary",
    ],
  },
  {
    id: "m5", idx: "05", title: "Post-operative Management",
    summary: "12 checks tracked",
    description: "ERAS compliance and day-by-day recovery monitoring — complication prediction, wound and anastomotic risk, and discharge readiness.",
    parameters: [
      "ERAS Protocol Compliance", "Post-operative Complication Prediction", "Clavien-Dindo Classification",
      "Wound Infection Detection", "Anastomotic Leak Risk", "Post-operative Bleeding Detection",
      "Drain Management", "Pain Management", "Nutrition Recovery Monitoring",
      "Discharge Readiness Assessment", "Readmission Risk Prediction", "Post-operative Care Dashboard",
    ],
  },
  {
    id: "m6", idx: "06", title: "Surgical Quality & Outcome Analytics",
    summary: "10 checks tracked",
    description: "This case's outcome metrics benchmarked against unit and national standards — resection quality, complication burden, and length of stay.",
    parameters: [
      "R0/R1/R2 Resection", "Margin Distance Analytics", "Lymph Node Harvest Quality",
      "Surgical Quality Indicator Dashboard", "Complication Rate (this case)", "Mortality & Morbidity",
      "Re-operation Tracking", "Length of Stay Analytics", "Enhanced Recovery Compliance",
      "Surgical Performance Dashboard",
    ],
  },
  {
    id: "m7", idx: "07", title: "Adjuvant Therapy Decision Support",
    summary: "10 checks tracked", flagship: true,
    flagshipTag: "Flagship · Adjuvant Recommendation, Auto-generated",
    flagshipNote: "Nodal upstaging, lymphovascular invasion, and an elevated lymph node ratio are combined with guideline logic to generate an adjuvant chemotherapy recommendation for MDT review — rather than waiting for a scheduled follow-up to surface these findings.",
    description: "Once pathology triggers a re-discussion, this module assembles the evidence-based adjuvant recommendation the MDT will review.",
    parameters: [
      "Surgery vs. Pathology Correlation", "Adjuvant Chemotherapy Recommendation",
      "Adjuvant Radiotherapy Recommendation", "Combined Modality Recommendation",
      "High-Risk Feature Identification", "Residual Disease Assessment", "Recurrence Risk Prediction",
      "Guideline Compliance Analysis", "MDT Recommendation Generator", "Adjuvant Planning Dashboard",
    ],
  },
  {
    id: "m8", idx: "08", title: "Follow-up & Recurrence Surveillance",
    summary: "12 checks tracked",
    description: "Longitudinal imaging, tumor markers, and functional outcomes on a continuous timeline once the patient leaves the surgical episode.",
    parameters: [
      "Follow-up Schedule Generator", "Surveillance Imaging Recommendation", "Tumor Marker Monitoring",
      "Local Recurrence Detection", "Distant Metastasis Surveillance", "Post-operative Functional Outcome",
      "Long-term Complication Monitoring", "Survivorship Care Planning", "Recurrence Risk Dashboard",
      "Follow-up Compliance Monitoring", "Outcome Trend Analysis", "Survivorship Dashboard",
    ],
  },
  {
    id: "m9", idx: "09", title: "Documentation & Clinical Intelligence",
    summary: "10 checks tracked", columns: DOC_COLUMNS,
    description: "Auto-generated, explainable summaries at every stage of the surgical episode — so nothing depends on manual re-typing between systems.",
    parameters: [
      "Surgical Consultation Summary", "Pre-operative Summary", "Operative Note Generator",
      "Post-operative Progress Summary", "Discharge Summary Generator", "Histopathology Correlation Summary",
      "MDT Summary Generator", "Clinical Timeline Generator", "Guideline Evidence Viewer",
      "Explainable AI Surgical Recommendation",
    ],
  },
  {
    id: "m10", idx: "10", title: "Multidisciplinary Oncology Intelligence",
    summary: "12 checks tracked",
    description: "Coordinates surgery with chemotherapy and radiotherapy timelines, prepares the MDT packet, and tracks the decision to closure.",
    parameters: [
      "Tumor Board Preparation Engine", "Stage Migration Detection", "Treatment Sequence Recommendation",
      "Surgery–Chemotherapy Correlation", "Surgery–Radiotherapy Correlation", "Molecular Tumor Board Support",
      "Clinical Trial Eligibility", "Cross-specialty Guideline Compliance", "Patient-specific Risk Stratification",
      "Personalized Treatment Roadmap", "MDT Decision Tracking", "Longitudinal Oncology Dashboard",
    ],
  },
  {
    id: "m11", idx: "11", title: "Surgical Pathology Intelligence",
    summary: "10 checks tracked",
    description: "Structured validation of the pathology report itself — completeness, invasion patterns, margin mapping, and biomarker extraction.",
    parameters: [
      "Synoptic Pathology Validator", "Missing Pathology Parameter Detection", "Tumor Regression Grade",
      "Margin Mapping Visualization", "Lymphovascular & Perineural Invasion", "Biomarker Extraction Engine",
      "Molecular Report Correlation", "Histology Variant Recognition", "Pathology Completeness Dashboard",
      "Structured Pathology Intelligence Report",
    ],
  },
  {
    id: "m12", idx: "12", title: "Department Analytics & Operations",
    summary: "10 checks tracked",
    description: "Zooms out from the single patient to theatre, ward, and cohort-level performance — the operational layer that keeps every case on schedule.",
    parameters: [
      "Operating Room Utilization", "Surgical Waiting List Optimization", "Case Duration Analytics",
      "Cancellation Prediction", "Bed Occupancy Prediction", "Resource Utilization Dashboard",
      "Surgical Oncology Registry", "Quality Benchmark Dashboard", "Outcome Benchmarking",
      "Surgical Department Performance Score",
    ],
  },
];

// Resolve columns for a module (defaults to the standard 5-column layout).
export function columnsFor(module) {
  return module.columns || STANDARD_COLUMNS;
}

// Build an empty "Not available" row for a parameter, keyed to the module's columns.
export function emptyRow(parameter, columns) {
  const row = { parameter, status: "neutral" };
  columns.forEach((c) => {
    if (c.key === "parameter" || c.key === "status") return;
    row[c.key] = c.key === "action" ? "No action." : NA;
  });
  return row;
}

