import React, { useState, useRef, useEffect, useCallback } from "react";
import { Box, Typography } from "@mui/material";
import {
  LocalHospital,
  SaveRounded,
  CheckCircleRounded,
  AutoAwesomeRounded,
  RefreshRounded,
  UploadFileRounded,
} from "@mui/icons-material";
import PatientReferralsTab from "./PatientReferralsTab";
import { getCompletedInvestigationDocuments, CompletedInvestigationsTable } from "./LabInvestigations";
import { getDoctorInfo } from "./shared/api";

/**
 * PalliativeAssessmentForm
 * ------------------------------------------------------------------
 * NCG-KCDO Palliative Medicine Assessment Module (v2.0).
 * Implements spec sections 1-7:
 *   1. Past Details
 *   2. Performance Scale (ECOG / PPS)
 *   3. Edmonton Symptom Assessment System - Revised (ESAS-r)
 *   4. Nursing Assessment (optional)
 *   5. Psychosocial & Spiritual Assessment
 *   6. Confusion Assessment Method (CAM) Diagnostic Algorithm
 *   7. Comprehensive Care Plan
 *
 * INTENDED USAGE: mount this component ONLY for doctors whose
 * specialty matches the Pain & Palliative gate (mirrors how
 * PainManagementNewFollowUp.jsx is gated in DoctorDashboard.jsx via
 * `isPainPalliativeSpecialist`). All other doctors should instead see
 * <PalliativeAssessmentSummary /> (read-only).
 *
 * BACKEND: the endpoints below MIRROR the existing pain-management
 * endpoint naming convention 1:1, with "pain-management" swapped for
 * "palliative-assessment". These routes do not necessarily exist yet
 * on the backend -- share the pain-management route handlers and
 * these can be added alongside them:
 *   GET  {API}hms/users/data/context/pain-management/history/{patientId}/{doctorId}
 *   POST {API}hms/users/data/context/pain-management/save
 *   POST {API}hms/users/data/context/pain-management/extract-fields
 *   GET  {API}hms/users/data/context/pain-management/latest-medications/{patientId}/{doctorId}
 * mirrored to:
 *   GET  {API}hms/users/data/context/palliative-assessment/history/{patientId}/{doctorId}
 *   POST {API}hms/users/data/context/palliative-assessment/save
 *   POST {API}hms/users/data/context/palliative-assessment/extract-fields
 *   GET  {API}hms/users/data/context/palliative-assessment/latest-medications/{patientId}/{doctorId}
 *   GET  {API}hms/users/data/context/palliative-assessment/patient-context/{patientId}/{doctorId}
 *     -> expected to return { cancer_diagnosis, last_mdt_notes, treatment_history }
 *        for the "Auto populate as per case no" fields in section 1B-1D.
 * NOTE: confirm these routes / response shapes with backend before go-live.
 * ------------------------------------------------------------------
 */

// ─── Design tokens (mirrors DoctorDashboard.jsx / PainManagementNewFollowUp.jsx) ──
const FONT = '"Open Sans", sans-serif';
const FW = 300;
const C = {
  black: "#0a0a0a",
  ink: "#1a1a1a",
  charcoal: "#2e2e2e",
  smoke: "#4a4a4a",
  ash: "#7a7a7a",
  silver: "#a8a8a8",
  mist: "#d4d4d4",
  fog: "#e8e8e8",
  ghost: "#f2f2f2",
  white: "#ffffff",
};
const os = (extra = {}) => ({ fontFamily: FONT, fontWeight: FW, ...extra });
const sectionCard = {
  background: C.white,
  border: `1px solid ${C.fog}`,
  borderRadius: "4px",
  boxShadow: "0 1px 3px rgba(0,0,0,0.06)",
  overflow: "hidden",
};
const actionButton = {
  px: 2.5, py: 1.1, borderRadius: "2px", fontSize: 12, fontWeight: 400,
  fontFamily: FONT, textTransform: "none", letterSpacing: "0.06em",
  background: C.black, color: C.white, border: "none", cursor: "pointer",
  display: "flex", alignItems: "center", justifyContent: "center", gap: 0.75,
  transition: "background 0.18s ease",
  "&:hover": { background: C.charcoal },
  "&:disabled": { opacity: 0.4, cursor: "not-allowed" },
};
const ghostButton = {
  px: 2.5, py: 1.1, borderRadius: "2px", fontSize: 12, fontWeight: 400,
  fontFamily: FONT, textTransform: "none", letterSpacing: "0.04em",
  background: "transparent", color: C.charcoal, border: `1px solid ${C.mist}`,
  cursor: "pointer", display: "flex", alignItems: "center", gap: 0.75,
  transition: "all 0.15s ease",
  "&:hover": { borderColor: C.smoke, background: C.ghost },
};

const API_BASE_URL = import.meta.env.VITE_BACKEND_URL;
const TRANSCRIBE_URL = `${API_BASE_URL}hms/users/ai/elevenlabs/api/transcribe_labs`;
const EXTRACT_URL = `${API_BASE_URL}hms/users/data/context/palliative-assessment/extract-fields`;
const HISTORY_URL = (patientId, doctorId) =>
  `${API_BASE_URL}hms/users/data/context/palliative-assessment/history/${patientId}/${doctorId}`;
const PATIENT_CONTEXT_URL = (patientId, doctorId) =>
  `${API_BASE_URL}hms/users/data/context/palliative-assessment/patient-context/${patientId}/${doctorId}`;
const LATEST_MEDS_URL = (patientId, doctorId) =>
  `${API_BASE_URL}hms/users/data/context/palliative-assessment/latest-medications/${patientId}/${doctorId}`;
const SAVE_URL = `${API_BASE_URL}hms/users/data/context/palliative-assessment/save`;
// New URL alongside the existing ones
const INVESTIGATIONS_SUMMARY_URL = (patientId, doctorId) =>
  `${API_BASE_URL}hms/users/data/context/palliative-assessment/investigations-summary/${patientId}/${doctorId}`;
const REFERRAL_UPLOAD_URL = `${API_BASE_URL}hms/users/data/context/palliative-assessment/upload-referral-letter`;

// Keys that voice dictation is allowed to auto-fill (Sections 2–7)
const ESAS_KEYS = [
  "esas_pain", "esas_tiredness", "esas_drowsiness", "esas_nausea", "esas_appetite",
  "esas_breath", "esas_depression", "esas_anxiety", "esas_wellbeing", "esas_constipation",
  "esas_sleep", "esas_other",
];

const DICTATION_KEYS = [
  "ecog", "pps",
  "bp", "pulse", "temperature", "respiratoryRate", "spo2",
  "tracheostomy", "stoma", "woundPressureInjury", "oralCavity", "oedema",
  "nutrition", "adl", "primaryCaregiver", "nursingOther",
  "patientKnowsDiagnosis", "caregiverKnowsDiagnosis", "patientKnowsPrognosis", "caregiverKnowsPrognosis",
  "psychosocialTools", "psychosocialScores", "socialSupport", "socialSupportDetails",
  "spiritualImportant", "spiritualResourcesWorking",
  "camAcuteOnset", "camInattention", "camDisorganized", "camConsciousness",
  "palliativeDiagnosis", "goalsOfCare", "primaryDecisionMaker", "preferredPlaceOfCare",
  "procedures", "pmPocusViews", "medicationsPrescribed",
  "reCounselling", "psychSpiritualSupport", "socialSupportPlan",
  "followUpPlan", "followUpDate", "referralLetter",
  ...ESAS_KEYS,
  ...ESAS_KEYS.map((k) => `${k}_details`),
];
// ─── Generic field primitives (same conventions as PainManagementNewFollowUp.jsx) ─
const FieldLabel = ({ children }) => (
  <Typography sx={{ ...os({ fontSize: 11, color: C.ash, textTransform: "uppercase", letterSpacing: "0.06em", mb: 0.75 }) }}>
    {children}
  </Typography>
);

const TextInput = ({ label, value, onChange, placeholder, multiline, minHeight }) => (
  <Box sx={{ mb: 2 }}>
    <FieldLabel>{label}</FieldLabel>
    {multiline ? (
      <textarea
        value={value || ""}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        style={{ width: "100%", minHeight: minHeight || 60, padding: "9px 12px", border: `1px solid ${C.mist}`, borderRadius: 2, fontFamily: FONT, fontSize: 13, fontWeight: 300, color: C.ink, resize: "vertical", outline: "none", boxSizing: "border-box" }}
      />
    ) : (
      <input
        type="text"
        value={value || ""}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        style={{ width: "100%", padding: "9px 12px", border: `1px solid ${C.mist}`, borderRadius: 2, fontFamily: FONT, fontSize: 13, fontWeight: 300, color: C.ink, outline: "none", boxSizing: "border-box" }}
      />
    )}
  </Box>
);

const DateInput = ({ label, value, onChange }) => (
  <Box sx={{ mb: 2 }}>
    <FieldLabel>{label}</FieldLabel>
    <input
      type="date"
      value={value || ""}
      onChange={(e) => onChange(e.target.value)}
      style={{ width: "100%", padding: "9px 12px", border: `1px solid ${C.mist}`, borderRadius: 2, fontFamily: FONT, fontSize: 13, fontWeight: 300, color: C.ink, outline: "none", boxSizing: "border-box" }}
    />
  </Box>
);

const NumberInput = ({ label, value, onChange, unit }) => (
  <Box sx={{ mb: 2 }}>
    <FieldLabel>{label}</FieldLabel>
    <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
      <input
        type="number"
        value={value ?? ""}
        onChange={(e) => onChange(e.target.value)}
        style={{ width: "100%", padding: "9px 12px", border: `1px solid ${C.mist}`, borderRadius: 2, fontFamily: FONT, fontSize: 13, fontWeight: 300, color: C.ink, outline: "none", boxSizing: "border-box" }}
      />
      {unit && <Typography sx={{ ...os({ fontSize: 11, color: C.ash, flexShrink: 0 }) }}>{unit}</Typography>}
    </Box>
  </Box>
);

// Multi-select → checkbox grid; single-select → native dropdown
const ChoiceGroup = ({ label, options, value, onChange, multi = true }) => {
  const selected = Array.isArray(value) ? value : value ? [value] : [];
  const toggle = (opt) => {
    if (multi) {
      onChange(selected.includes(opt) ? selected.filter((o) => o !== opt) : [...selected, opt]);
    } else {
      onChange(selected[0] === opt ? "" : opt);
    }
  };
  if (!multi) {
    return (
      <Box sx={{ mb: 2 }}>
        {label && <FieldLabel>{label}</FieldLabel>}
        <select
          value={selected[0] || ""}
          onChange={(e) => onChange(e.target.value || "")}
          style={{ width: "100%", padding: "9px 12px", border: `1px solid ${C.mist}`, borderRadius: 2, fontFamily: FONT, fontSize: 13, fontWeight: 300, color: selected[0] ? C.ink : C.ash, outline: "none", background: C.white, cursor: "pointer", boxSizing: "border-box" }}
        >
          <option value="">— Select —</option>
          {options.map((opt) => <option key={opt} value={opt}>{opt}</option>)}
        </select>
      </Box>
    );
  }
  return (
    <Box sx={{ mb: 2 }}>
      {label && <FieldLabel>{label}</FieldLabel>}
      <Box sx={{ display: "grid", gridTemplateColumns: { xs: "1fr", sm: "1fr 1fr" }, gap: 0.25 }}>
        {options.map((opt) => {
          const isSel = selected.includes(opt);
          return (
            <Box key={opt} component="label" sx={{ display: "flex", alignItems: "center", gap: 1, cursor: "pointer", py: 0.6, px: 1, borderRadius: "2px", background: isSel ? C.ghost : "transparent", "&:hover": { background: C.ghost } }}>
              <input type="checkbox" checked={isSel} onChange={() => toggle(opt)} style={{ accentColor: C.black, width: 14, height: 14, cursor: "pointer", flexShrink: 0 }} />
              <Typography sx={{ ...os({ fontSize: 12.5, color: C.charcoal }) }}>{opt}</Typography>
            </Box>
          );
        })}
      </Box>
    </Box>
  );
};

const RadioRow = ({ label, options, value, onChange }) => (
  <Box sx={{ mb: 2 }}>
    <FieldLabel>{label}</FieldLabel>
    <Box sx={{ display: "flex", gap: 2.5, flexWrap: "wrap" }}>
      {options.map((opt) => (
        <Box key={opt} component="label" sx={{ display: "flex", alignItems: "center", gap: 0.75, cursor: "pointer" }}>
          <input type="radio" checked={value === opt} onChange={() => onChange(opt)} style={{ accentColor: C.black, width: 14, height: 14, cursor: "pointer", flexShrink: 0 }} />
          <Typography sx={{ ...os({ fontSize: 12.5, color: C.charcoal }) }}>{opt}</Typography>
        </Box>
      ))}
    </Box>
  </Box>
);

// 0-10 slider with filled track + severity coloring, used throughout ESAS-r (section 3)
const ScaleInput = ({ value, onChange }) => {
  const hasVal = value !== undefined && value !== null;
  const n = hasVal ? Number(value) : 0;
  const sev = n >= 7
    ? { line: "#dc2626", bg: "#fef2f2", text: "#991b1b" }
    : n >= 4
      ? { line: "#d97706", bg: "#fffbeb", text: "#92400e" }
      : { line: C.black, bg: C.ghost, text: C.ink };
  const pct = (n / 10) * 100;
  const track = hasVal
    ? `linear-gradient(to right, ${sev.line} 0%, ${sev.line} ${pct}%, ${C.fog} ${pct}%, ${C.fog} 100%)`
    : C.fog;
  return (
    <Box sx={{ display: "flex", alignItems: "center", gap: 1.5 }}>
      <Typography sx={{ ...os({ fontSize: 10, color: C.ash, flexShrink: 0, width: 12, textAlign: "center" }) }}>0</Typography>
      <input
        type="range" min={0} max={10} step={1}
        value={hasVal ? value : 0}
        onChange={(e) => onChange(Number(e.target.value))}
        className="esas-slider"
        style={{ flex: 1, background: track, "--thumb": hasVal ? sev.line : C.silver }}
      />
      <Typography sx={{ ...os({ fontSize: 10, color: C.ash, flexShrink: 0, width: 16, textAlign: "center" }) }}>10</Typography>
      <Box sx={{ minWidth: 34, height: 30, display: "flex", alignItems: "center", justifyContent: "center", border: `1px solid ${hasVal ? sev.line : C.mist}`, borderRadius: "4px", background: hasVal ? sev.bg : C.white }}>
        <Typography sx={{ ...os({ fontSize: 13, color: hasVal ? sev.text : C.ash, fontWeight: 500 }) }}>
          {hasVal ? n : "—"}
        </Typography>
      </Box>
    </Box>
  );
};

const Grid2 = ({ children }) => (
  <Box sx={{ display: "grid", gridTemplateColumns: { xs: "1fr", sm: "1fr 1fr" }, gap: { xs: 0, sm: 2.5 } }}>{children}</Box>
);
const Grid3 = ({ children }) => (
  <Box sx={{ display: "grid", gridTemplateColumns: { xs: "1fr", sm: "1fr 1fr 1fr" }, gap: { xs: 0, sm: 2.5 } }}>{children}</Box>
);
const Grid5 = ({ children }) => (
  <Box sx={{ display: "grid", gridTemplateColumns: { xs: "1fr 1fr", sm: "repeat(5, 1fr)" }, gap: { xs: 1, sm: 2 } }}>{children}</Box>
);

const SectionHeader = ({ title, sub }) => (
  <Box sx={{ mb: 2 }}>
    <Box sx={{ display: "flex", alignItems: "center", gap: 1.25, pb: 0.75, borderBottom: `2px solid ${C.black}` }}>
      <Typography sx={{ ...os({ fontSize: 13, color: C.black, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em" }) }}>
        {title}
      </Typography>
    </Box>
    {sub && <Typography sx={{ ...os({ fontSize: 11, color: C.ash, mt: 0.5 }) }}>{sub}</Typography>}
  </Box>
);

const SubCard = ({ title, children, sx = {} }) => (
  <Box
    sx={{
      background: C.white,
      border: `1px solid ${C.fog}`,
      borderRadius: "6px",
      p: { xs: 2, sm: 2.5 },
      mb: 2.5,
      boxShadow: "0 1px 3px rgba(0,0,0,0.03)",
      ...sx,
    }}
  >
    {title && (
      <Typography
        sx={{
          ...os({
            fontSize: 11,
            color: C.smoke,
            fontWeight: 700,
            textTransform: "uppercase",
            letterSpacing: "0.07em",
            mb: 2,
            pb: 1,
            borderBottom: `1px solid ${C.ghost}`,
          }),
        }}
      >
        {title}
      </Typography>
    )}
    {children}
  </Box>
);

const YesNoText = ({ label, value, onChange, extraOptions = [] }) => {
  const val = value || { flag: "", detail: "" };
  const opts = ["Yes", "No", ...extraOptions];
  return (
    <Box sx={{ mb: 2 }}>
      <FieldLabel>{label}</FieldLabel>
      <Box sx={{ display: "flex", gap: 2.5, alignItems: "center", flexWrap: "wrap" }}>
        {opts.map((opt) => (
          <Box key={opt} component="label" sx={{ display: "flex", alignItems: "center", gap: 0.75, cursor: "pointer" }}>
            <input type="radio" checked={val.flag === opt} onChange={() => onChange({ ...val, flag: opt })} style={{ accentColor: C.black, width: 14, height: 14, cursor: "pointer", flexShrink: 0 }} />
            <Typography sx={{ ...os({ fontSize: 12.5, color: C.charcoal }) }}>{opt}</Typography>
          </Box>
        ))}
        {(val.flag === "Yes" || val.flag === "Others" || val.flag === "Other") && (
          <input
            type="text" placeholder="Specify..." value={val.detail || ""}
            onChange={(e) => onChange({ ...val, detail: e.target.value })}
            style={{ flex: 1, minWidth: 140, padding: "8px 10px", border: `1px solid ${C.mist}`, borderRadius: 2, fontFamily: FONT, fontSize: 12, boxSizing: "border-box" }}
          />
        )}
      </Box>
    </Box>
  );
};

// Checkbox list where each checked item can carry its own free-text detail
const DetailChoiceList = ({ label, options, value, onChange }) => {
  const val = value || {};
  const toggle = (key) => {
    const cur = val[key] || { checked: false, detail: "" };
    onChange({ ...val, [key]: { ...cur, checked: !cur.checked } });
  };
  const setDetail = (key, detail) => {
    const cur = val[key] || { checked: false, detail: "" };
    onChange({ ...val, [key]: { ...cur, detail } });
  };
  return (
    <Box sx={{ mb: 2 }}>
      {label && <FieldLabel>{label}</FieldLabel>}
      <Box sx={{ display: "flex", flexDirection: "column", gap: 0.5 }}>
        {options.map(({ key, label: optLabel }) => {
          const cur = val[key] || { checked: false, detail: "" };
          return (
            <Box key={key} sx={{ display: "flex", gap: 1.5, alignItems: "center", flexWrap: "wrap", py: 0.4 }}>
              <Box component="label" sx={{ display: "flex", alignItems: "center", gap: 1, cursor: "pointer", minWidth: 180 }}>
                <input type="checkbox" checked={cur.checked} onChange={() => toggle(key)} style={{ accentColor: C.black, width: 14, height: 14, cursor: "pointer", flexShrink: 0 }} />
                <Typography sx={{ ...os({ fontSize: 12.5, color: C.charcoal }) }}>{optLabel}</Typography>
              </Box>
              {cur.checked && (
                <input
                  type="text" placeholder="Details..." value={cur.detail || ""}
                  onChange={(e) => setDetail(key, e.target.value)}
                  style={{ flex: 1, minWidth: 140, padding: "7px 10px", border: `1px solid ${C.mist}`, borderRadius: 2, fontFamily: FONT, fontSize: 12, boxSizing: "border-box" }}
                />
              )}
            </Box>
          );
        })}
      </Box>
    </Box>
  );
};

// ─── Option lists (verbatim from NER Palliative Medicine Assessment Module v2.0) ──
const REASON_FOR_REFERRAL_OPTS = [
  "Symptom Management", "Under Evaluation+ Palliative Care", "Palliative care + Curative intent treatment",
  "Early Palliative Care", "Best Supportive Care", "Psychosocial/Spiritual Support",
  "Hospice Care", "Home Based Care", "End of Life Care", "Any other",
];
const COMORBIDITY_OPTS = ["HTN", "DM", "CAD", "CVA", "TB", "Asthma", "COPD", "Allergy", "Psychiatric disorders", "Biohazard", "Others"];
const ECOG_OPTS = ["0", "1", "2", "3", "4"];
const PPS_OPTS = ["100%", "90%", "80%", "70%", "60%", "50%", "40%", "30%", "20%", "10%", "0%"];
const NUTRITION_OPTS = ["Orally", "Via NGT", "Via NJT", "Via PEG", "Via FJ", "TPN"];
const ADL_OPTS = ["Dressing", "Ambulating", "Bathing", "Eating", "Transferring", "Toileting"];
const PSYCHOSOCIAL_TOOL_OPTS = ["NCCN-DT with problem checklist", "PHQ-9", "GAD 7"];
const CONSCIOUSNESS_OPTS = ["Alert", "Vigilant", "Lethargic", "Stupor", "Coma"];
const GOALS_OF_CARE_OPTS = [
  { key: "palliativeCareDisease", label: "Palliative care + disease" },
  { key: "palliativeCareOnly", label: "Palliative care only" },
  { key: "symptomManagement", label: "Symptom Management" },
  { key: "psychosocialCare", label: "Psychosocial Care" },
  { key: "respiteCare", label: "Respite Care" },
  { key: "hospiceCare", label: "Hospice Care" },
  { key: "homeCare", label: "Home Care" },
  { key: "advancedCarePlanning", label: "Advanced Care Planning" },
  { key: "eolc", label: "EOLC" },
  { key: "other", label: "Any other" },
];
const PLACE_OF_CARE_OPTS = [
  { key: "hospital", label: "Hospital" },
  { key: "hospice", label: "Hospice" },
  { key: "home", label: "Home" },
];
const PROCEDURE_OPTS = ["Pleural Tapping", "Procedures for Pain relief", "Wound care", "Catheterisation", "IV Fluids", "NGT", "Paracentesis", "PM POCUS", "Others"];
const PM_POCUS_SUB_OPTS = [
  "Right lung base and right upper quadrant", "Right lower quadrant abdomen", "Subxiphoid cardiac view",
  "Left lung base and left upper abdomen", "Suprapubic Pelvic view",
  "Compression ultrasound of femoral vessels-Left", "Compression ultrasound of femoral vessels-Right",
];
const SOCIAL_SUPPORT_PLAN_OPTS = [
  { key: "medicines", label: "Medicines" },
  { key: "travel", label: "Travel" },
  { key: "equipment", label: "Equipment" },
  { key: "other", label: "Other" },
];
const INTERDISCIPLINARY_REFERRAL_OPTS = [
  "Medical Oncology", "Radiation Oncology", "Surgical Oncology", "Interventional Oncology",
  "Chest Medicine", "Psychiatry and psycho oncology", "Stoma Clinic", "Occupational Therapy",
  "Physiotherapy", "Others",
];
const FOLLOWUP_DATE_ENABLED = ["Yes"];

// ESAS-r item definitions: [key, "No X" label, "Worst possible X" label]
const ESAS_ITEMS = [
  ["esas_pain", "No Pain", "Worst Possible pain"],
  ["esas_tiredness", "No Tiredness (Lack of energy)", "Worst Possible Tiredness"],
  ["esas_drowsiness", "No Drowsiness (Feeling sleepy)", "Worst Possible Drowsiness"],
  ["esas_nausea", "No Nausea", "Worst Possible Nausea"],
  ["esas_appetite", "No Lack of Appetite", "Worst possible lack of appetite"],
  ["esas_breath", "No Shortness of Breath", "Worst Possible shortness of breath"],
  ["esas_depression", "No Depression (Feeling sad)", "Worst possible depression"],
  ["esas_anxiety", "No Anxiety (Feeling nervous)", "Worst possible anxiety"],
  ["esas_wellbeing", "Best Wellbeing (How you feel overall)", "Worst possible Wellbeing"],
  ["esas_constipation", "No Constipation", "Worst possible constipation"],
  ["esas_sleep", "Adequate Sleep", "Loss of sleep"],
  ["esas_other", "No other problem", "Worst Possible"],
];

// ─── CAM diagnostic algorithm interpretation ──────────────────────────────
// Standard short-form CAM: positive for delirium requires BOTH
//   (1) Acute onset/fluctuating course, AND (2) Inattention
// PLUS EITHER
//   (3) Disorganized thinking OR (4) Altered level of consciousness (not "Alert")
function interpretCAM({ acuteOnset, inattention, disorganized, consciousness }) {
  if (!acuteOnset || !inattention || !consciousness) return null; // incomplete
  const feature1and2 = acuteOnset === "Yes" && inattention === "Yes";
  const feature3or4 = disorganized === "Yes" || (consciousness && consciousness !== "Alert");
  if (!feature1and2) return { positive: false, label: "CAM Negative — criteria 1 & 2 not both met" };
  return feature1and2 && feature3or4
    ? { positive: true, label: "CAM Positive — delirium likely" }
    : { positive: false, label: "CAM Negative — criterion 3 or 4 not met" };
}

// ══════════════════════════════════════════════════════════════════════
//  MAIN COMPONENT
// ══════════════════════════════════════════════════════════════════════
export default function PalliativeAssessmentForm({ doctorId, patientId, patientName, initialData, onSave }) {
  const [form, setForm] = useState(initialData || {});
  const set = (key) => (val) => setForm((prev) => ({ ...prev, [key]: val }));

  const [doctorInfoName, setDoctorInfoName] = useState("");
  const [hospitalId, setHospitalId] = useState("");

  useEffect(() => {
    if (doctorId) {
      getDoctorInfo(doctorId)
        .then((res) => {
          if (res) {
            const docData = res?.data || res?.doctor || res;
            const name = docData?.name || docData?.doctor_name || (Array.isArray(docData) ? docData[0]?.name || docData[0]?.doctor_name : "");
            const hId = docData?.hospital_id || docData?.hospitalId || (Array.isArray(docData) ? docData[0]?.hospital_id || docData[0]?.hospitalId : "");
            setDoctorInfoName(name);
            setHospitalId(hId);
          }
        })
        .catch((err) => console.error("Failed to load doctor info:", err));
    }
  }, [doctorId]);

  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [saveError, setSaveError] = useState(null);

  // ─── Prior-visit hint (informational only — "Patient is" stays a manual
  //     choice per spec 1A, we just default it sensibly) ─────────────────
  const [priorRecordsExist, setPriorRecordsExist] = useState(false);
  const [contextLoading, setContextLoading] = useState(true);

  const loadContext = useCallback(async () => {
    if (!doctorId || !patientId) return;
    setContextLoading(true);
    try {
      const [historyRes, contextRes, investigationsRes] = await Promise.all([
        fetch(HISTORY_URL(patientId, doctorId)).then((r) => r.json()).catch(() => null),
        fetch(PATIENT_CONTEXT_URL(patientId, doctorId)).then((r) => r.json()).catch(() => null),
        fetch(INVESTIGATIONS_SUMMARY_URL(patientId, doctorId)).then((r) => r.json()).catch(() => null),
      ]);

      const hasPrior = historyRes?.status === "success" && Array.isArray(historyRes.data) && historyRes.data.length > 0;
      setPriorRecordsExist(hasPrior);

      const invText = investigationsRes?.finaloutput?.investigations_text || "";

      setForm((prev) => ({
        ...prev,
        patientType: prev.patientType || (hasPrior ? "Follow up" : "New"),
        cancerDiagnosis: prev.cancerDiagnosis || contextRes?.data?.cancer_diagnosis || "",
        lastMdtNotes: prev.lastMdtNotes || contextRes?.data?.last_mdt_notes || "",
        treatmentHistory: prev.treatmentHistory || contextRes?.data?.treatment_history || "",
        investigationsNote: prev.investigationsNote || invText,
        carePlanInvestigations: prev.carePlanInvestigations || invText,
      }));
    } catch (err) {
      console.error("Palliative assessment context load failed:", err);
    } finally {
      setContextLoading(false);
    }
  }, [doctorId, patientId]);

  useEffect(() => { loadContext(); }, [loadContext]);

  // ─── Completed Lab Investigation ──────────────────────────────────────
  const [completedLabs, setCompletedLabs] = useState([]);
  const [loadingLabs, setLoadingLabs] = useState(false);
  const [doctorNamesMap, setDoctorNamesMap] = useState({});

  useEffect(() => {
    if (patientId) {
      setLoadingLabs(true);
      getCompletedInvestigationDocuments(patientId, doctorId)
        .then((res) => {
          if (res && res.data) {
            setCompletedLabs(res.data);
          }
        })
        .catch((err) => console.error("Failed to fetch completed investigations:", err))
        .finally(() => setLoadingLabs(false));
    }
  }, [patientId, doctorId]);

  useEffect(() => {
    if (!completedLabs || !completedLabs.length) return;
    const ids = [...new Set(completedLabs.map((inv) => inv.doctor_id).filter(Boolean))];
    const missing = ids.filter((id) => !doctorNamesMap[id]);
    if (missing.length > 0) {
      Promise.all(
        missing.map((id) =>
          getDoctorInfo(id)
            .then((res) => {
              const docData = res?.data || res?.doctor || res;
              const name =
                docData?.name ||
                docData?.doctor_name ||
                (Array.isArray(docData) ? docData[0]?.name || docData[0]?.doctor_name : "") ||
                id;
              return { id, name };
            })
            .catch(() => ({ id, name: id }))
        )
      ).then((results) => {
        setDoctorNamesMap((prev) => {
          const next = { ...prev };
          results.forEach((r) => (next[r.id] = r.name));
          return next;
        });
      });
    }
  }, [completedLabs]);

  // ─── Auto-fill Ongoing Medications from latest prescription (7.E.i) ─────
  const [medsAutoFilling, setMedsAutoFilling] = useState(false);
  const [medsAutoFilled, setMedsAutoFilled] = useState(false);
  const [medsAutoFillError, setMedsAutoFillError] = useState(null);
  const [uploadingReferral, setUploadingReferral] = useState(false);
  const [referralUploadError, setReferralUploadError] = useState(null);

  const uploadReferralLetter = async (file) => {
    if (!file) return;
    setUploadingReferral(true);
    setReferralUploadError(null);
    try {
      const formData = new FormData();
      formData.append("file", file);
      formData.append("patient_id", patientId);
      formData.append("doctor_id", doctorId);

      const res = await fetch(REFERRAL_UPLOAD_URL, { method: "POST", body: formData });
      const json = await res.json();
      if (!res.ok || json.status !== "success") {
        throw new Error(json.detail || json.message || "Upload failed");
      }
      set("referralLetterFile")({ name: file.name, file_url: json.file_url, file_id: json.file_id });
    } catch (err) {
      console.error("Referral letter upload failed:", err);
      setReferralUploadError(err.message || "Failed to upload referral letter");
    } finally {
      setUploadingReferral(false);
    }
  };

  useEffect(() => {
    if (!doctorId || !patientId) return;
    if ((form.ongoingMedications || "").trim().length > 0) return;
    let cancelled = false;
    (async () => {
      setMedsAutoFilling(true);
      setMedsAutoFillError(null);
      try {
        const res = await fetch(LATEST_MEDS_URL(patientId, doctorId));
        const json = await res.json();
        if (cancelled) return;
        if (json.status === "success") {
          const text = json.finaloutput?.currentMedicationsText || json.finaloutput?.ongoing_medications || "";
          if (text) {
            setForm((prev) => ({ ...prev, ongoingMedications: prev.ongoingMedications || text }));
            setMedsAutoFilled(true);
          }
        } else {
          setMedsAutoFillError(json.message || "Could not auto-fill ongoing medications");
        }
      } catch (err) {
        if (!cancelled) setMedsAutoFillError("Could not auto-fill ongoing medications");
      } finally {
        if (!cancelled) setMedsAutoFilling(false);
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [doctorId, patientId]);

  // ─── Voice dictation (ESAS-r scores + a few free-text fields) ──────────
  const mediaRecorder = useRef(null);
  const audioChunks = useRef([]);
  const [recording, setRecording] = useState(false);
  const [transcribing, setTranscribing] = useState(false);
  const [transcript, setTranscript] = useState("");
  const [extracting, setExtracting] = useState(false);
  const [extractError, setExtractError] = useState(null);
  const [fillSuccess, setFillSuccess] = useState(false);

  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      mediaRecorder.current = new MediaRecorder(stream);
      audioChunks.current = [];
      mediaRecorder.current.ondataavailable = (e) => { if (e.data.size > 0) audioChunks.current.push(e.data); };
      mediaRecorder.current.start();
      setRecording(true);
    } catch {
      alert("Microphone permission is required.");
    }
  };

  const stopRecording = () => {
    if (!mediaRecorder.current) return;
    mediaRecorder.current.onstop = transcribeAudio;
    mediaRecorder.current.stop();
    mediaRecorder.current.stream.getTracks().forEach((t) => t.stop());
    setRecording(false);
  };

  const transcribeAudio = async () => {
    if (!audioChunks.current.length) return;
    setTranscribing(true);
    try {
      const blob = new Blob(audioChunks.current, { type: "audio/webm" });
      audioChunks.current = [];
      const formData = new FormData();
      formData.append("file", blob, "audio.webm");
      const res = await fetch(TRANSCRIBE_URL, { method: "POST", body: formData });
      const data = await res.json();
      const text = data?.text || "";
      setTranscript((prev) => (prev ? `${prev}\n${text}` : text));
    } catch {
      alert("Transcription failed");
    } finally {
      setTranscribing(false);
    }
  };

  const fillFieldsFromDictation = async () => {
    if (!transcript.trim()) return;
    setExtracting(true);
    setExtractError(null);
    try {
      const res = await fetch(EXTRACT_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ doctor_id: doctorId, patient_id: patientId, dictation: transcript, target_section: "esas_and_referral" }),
      });
      const json = await res.json();
      const extracted = json?.finaloutput ?? json?.data ?? json ?? {};
      console.log("RAW extracted from backend:", extracted); // TEMP
      setForm((prev) => {
        const next = { ...prev };
        DICTATION_KEYS.forEach((k) => {
          const val = extracted[k];
          if (val === undefined || val === null || val === "") return;

          if (Array.isArray(val)) {
            // Multi-select array fields -> union-merge with existing selections
            const existing = Array.isArray(prev[k]) ? prev[k] : [];
            next[k] = [...new Set([...existing, ...val])];
          } else if (typeof val === "object" && !Array.isArray(val)) {
            if (val.flag !== undefined || val.detail !== undefined) {
              // Flag-detail object (e.g. spiritualImportant, reCounselling)
              next[k] = { ...(prev[k] || {}), ...val };
            } else {
              // Nested choice map (e.g. goalsOfCare, preferredPlaceOfCare, socialSupportPlan, psychosocialScores)
              const existingMap = typeof prev[k] === "object" ? prev[k] : {};
              const mergedMap = { ...existingMap };
              Object.entries(val).forEach(([subKey, subVal]) => {
                mergedMap[subKey] = { ...(mergedMap[subKey] || {}), ...subVal };
              });
              next[k] = mergedMap;
            }
          } else {
            // Scalar values (strings, numbers)
            next[k] = val;
          }
        });
        return next;
      });
      setFillSuccess(true);
      setTimeout(() => setFillSuccess(false), 2000);
    } catch (err) {
      console.error("Field extraction failed:", err);
      setExtractError("Failed to extract fields from dictation. Please fill manually.");
    } finally {
      setExtracting(false);
    }
  };

  // ─── Save ────────────────────────────────────────────────────────────
  const handleSave = async () => {
    setSaving(true);
    setSaveError(null);
    try {
      const payload = {
        doctor_id: doctorId,
        patient_id: patientId,
        palliativeAssessment: form,
        saved_at: new Date().toISOString(),
      };
      if (onSave) {
        await onSave(payload);
      } else {
        const res = await fetch(SAVE_URL, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        const json = await res.json();
        if (!res.ok || json.status !== "success") {
          throw new Error(json.detail || json.message || "Failed to save palliative assessment");
        }
      }
      setSaved(true);
      window.dispatchEvent(new Event("refreshPalliativeAssessmentHistory"));
      setTimeout(() => setSaved(false), 2500);
    } catch (err) {
      console.error("Palliative assessment save failed:", err);
      setSaveError(err.message || "Failed to save palliative assessment");
    } finally {
      setSaving(false);
    }
  };

  const camResult = interpretCAM({
    acuteOnset: form.camAcuteOnset,
    inattention: form.camInattention,
    disorganized: form.camDisorganized,
    consciousness: form.camConsciousness,
  });

  // ── Render ───────────────────────────────────────────────────────────
  return (
    <Box sx={{ ...sectionCard }}>
      {/* Header */}
      <Box sx={{ px: { xs: 2.5, sm: 3 }, py: 2, display: "flex", alignItems: "center", gap: 1.5, background: C.white, borderBottom: `1px solid ${C.fog}` }}>
        <Box sx={{ width: 34, height: 34, borderRadius: "4px", background: C.ghost, border: `1px solid ${C.fog}`, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
          <LocalHospital sx={{ fontSize: 18, color: C.ink }} />
        </Box>
        <Box>
          <Typography sx={{ ...os({ fontSize: 15, color: C.ink, fontWeight: 500, letterSpacing: "0.01em" }) }}>
            Palliative Medicine Assessment
          </Typography>
          <Typography sx={{ ...os({ fontSize: 11, color: C.ash, mt: 0.2 }) }}>
            {patientName ? `${patientName} — ` : ""}NCG-KCDO Palliative Medicine Assessment Module (v2.0)
          </Typography>
        </Box>
      </Box>

      {contextLoading ? (
        <Box sx={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 1, py: 6 }}>
          <RefreshRounded sx={{ fontSize: 20, color: C.ash, animation: "spin 1s linear infinite" }} />
          <Typography sx={{ ...os({ fontSize: 12.5, color: C.ash }) }}>Loading patient context...</Typography>
        </Box>
      ) : (
        <Box sx={{ p: { xs: 2, sm: 3 } }}>

          {/* ── 1. Past Details ─────────────────────────────────────────── */}
          <Box sx={{ mb: 4 }}>
            <SectionHeader title="1. Past Details" />

            <SubCard title="Form Details & Patient Type">
              <RadioRow label="Patient is" options={["New", "Follow up"]} value={form.patientType} onChange={set("patientType")} />
              {priorRecordsExist && form.patientType === "New" && (
                <Typography sx={{ ...os({ fontSize: 11, color: C.ash, fontStyle: "italic", mt: -1, mb: 1 }) }}>
                  Note: prior palliative assessment records exist for this patient — confirm "New" is intentional.
                </Typography>
              )}
            </SubCard>

            <SubCard title="Clinical Context & Diagnosis">
              <TextInput label="Cancer Diagnosis" value={form.cancerDiagnosis} onChange={set("cancerDiagnosis")} multiline placeholder="Auto-populated from patient case record — edit if needed" />
              <TextInput label="Clinical Notes from Last MDT" value={form.lastMdtNotes} onChange={set("lastMdtNotes")} multiline placeholder="Auto-populated from patient case record — edit if needed" />
              <TextInput label="Treatment History" value={form.treatmentHistory} onChange={set("treatmentHistory")} multiline placeholder="Auto-populated from patient case record — edit if needed" />
            </SubCard>

            <SubCard title="Referral Context & Co-morbidities">
              <ChoiceGroup label="Reason for Referral" options={REASON_FOR_REFERRAL_OPTS} value={form.reasonForReferral} onChange={set("reasonForReferral")} />
              {Array.isArray(form.reasonForReferral) && form.reasonForReferral.includes("Any other") && (
                <TextInput label="Reason for Referral — Other (please specify)" value={form.reasonForReferralOther} onChange={set("reasonForReferralOther")} />
              )}
              <ChoiceGroup label="Pre-Existing Co-morbidities" options={COMORBIDITY_OPTS} value={form.comorbidities} onChange={set("comorbidities")} />
            </SubCard>

            <SubCard title="Investigations & Clinical Findings">
              <TextInput label="Investigations" value={form.investigationsNote} onChange={set("investigationsNote")} placeholder="Reference note — full results are linked from the Data tab / Investigation Notes" />
              <TextInput label="Examination / Significant Findings" value={form.examinationFindings} onChange={set("examinationFindings")} multiline />
            </SubCard>
          </Box>

          {/* ── Voice Dictation ─────────────────────────────────────────── */}
          <SubCard title="Voice Dictation — Symptom Scores & Findings" sx={{ background: C.ghost }}>
            <style>{`
              @keyframes micPulse { 0% { box-shadow: 0 0 0 0 rgba(220,38,38,0.45); } 70% { box-shadow: 0 0 0 12px rgba(220,38,38,0); } 100% { box-shadow: 0 0 0 0 rgba(220,38,38,0); } }
              @keyframes blinkDot { 0%,100% { opacity: 1; } 50% { opacity: 0.3; } }
              @keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
            `}</style>
            <Box sx={{ display: "flex", alignItems: "center", gap: 1.5, mb: 1.5 }}>
              <Box
                component="button" type="button"
                onClick={() => (recording ? stopRecording() : startRecording())}
                sx={{
                  width: 46, height: 46, borderRadius: "50%", border: "none", cursor: "pointer",
                  display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0,
                  background: recording ? "#dc2626" : C.black, color: C.white,
                  animation: recording ? "micPulse 1.4s infinite" : "none", transition: "background 0.15s",
                }}
              >
                {recording ? (
                  <Box sx={{ width: 14, height: 14, background: C.white, borderRadius: "2px" }} />
                ) : (
                  <svg width="18" height="18" fill="currentColor" viewBox="0 0 20 20">
                    <path fillRule="evenodd" d="M7 4a3 3 0 016 0v4a3 3 0 11-6 0V4zm4 10.93A7.001 7.001 0 0017 8a1 1 0 10-2 0A5 5 0 015 8a1 1 0 00-2 0 7.001 7.001 0 006 6.93V17H6a1 1 0 100 2h8a1 1 0 100-2h-3v-2.07z" clipRule="evenodd" />
                  </svg>
                )}
              </Box>
              <Box>
                <Typography sx={{ ...os({ fontSize: 12, color: C.ink }) }}>
                  {recording ? "Recording — tap to stop" : transcribing ? "Transcribing..." : "Tap to start dictation"}
                </Typography>
                {recording && (
                  <Box sx={{ display: "flex", alignItems: "center", gap: 0.75, mt: 0.5 }}>
                    <Box sx={{ width: 6, height: 6, borderRadius: "50%", background: "#dc2626", animation: "blinkDot 1s infinite" }} />
                    <Typography sx={{ ...os({ fontSize: 11, color: "#dc2626" }) }}>Listening...</Typography>
                  </Box>
                )}
              </Box>
            </Box>
            <Typography sx={{ ...os({ fontSize: 11, color: C.ash, lineHeight: 1.6, mb: 2 }) }}>
              Speak about any items in Sections 2 through 7 (ECOG/PPS, ESAS 0–10 scores &amp; details, vitals,
              nursing findings, nutrition, ADLs, caregiver info, psychosocial &amp; spiritual assessment,
              CAM delirium criteria, goals of care, procedures, prescribed meds, and follow-up plan).
            </Typography>
            <Box sx={{ mb: 1.5 }}>
              <FieldLabel>Transcript (review &amp; edit, then fill fields)</FieldLabel>
              <textarea
                value={transcript}
                onChange={(e) => setTranscript(e.target.value)}
                placeholder="Transcribed text will appear here..."
                style={{ width: "100%", minHeight: 90, padding: "9px 12px", border: `1px solid ${C.mist}`, borderRadius: 2, fontFamily: FONT, fontSize: 13, fontWeight: 300, color: C.ink, resize: "vertical", outline: "none", boxSizing: "border-box", background: C.white }}
              />
            </Box>
            {extractError && <Typography sx={{ ...os({ fontSize: 11, color: "#d32f2f", mb: 1 }) }}>{extractError}</Typography>}
            <Box sx={{ display: "flex", gap: 1 }}>
              <Box
                component="button" type="button" onClick={fillFieldsFromDictation}
                disabled={!transcript.trim() || extracting}
                sx={{ ...actionButton, px: 2, py: 0.85, fontSize: 12, opacity: !transcript.trim() || extracting ? 0.4 : 1, cursor: !transcript.trim() || extracting ? "not-allowed" : "pointer" }}
              >
                {fillSuccess ? (<><CheckCircleRounded sx={{ fontSize: 15 }} /> Fields Filled</>) : extracting ? "Filling Fields..." : "Fill Fields from Dictation"}
              </Box>
              {transcript && (
                <Box component="button" type="button" onClick={() => setTranscript("")} sx={{ ...ghostButton, px: 2, py: 0.85, fontSize: 12 }}>Clear</Box>
              )}
            </Box>
          </SubCard>

          {/* ── 2. Performance Scale ────────────────────────────────────── */}
          <Box sx={{ mb: 4 }}>
            <SectionHeader title="2. Performance Scale" sub="Choose one of the below two scales" />
            <Grid2>
              <SubCard title="PS - ECOG">
                <ChoiceGroup label="" options={ECOG_OPTS} value={form.ecog} onChange={set("ecog")} multi={false} />
              </SubCard>
              <SubCard title="Palliative Performance Scale (PPS)">
                <ChoiceGroup label="" options={PPS_OPTS} value={form.pps} onChange={set("pps")} multi={false} />
              </SubCard>
            </Grid2>
          </Box>

          {/* ── 3. ESAS-r ────────────────────────────────────────────────── */}
          <Box sx={{ mb: 4 }}>
            <SectionHeader title="3. Edmonton Symptom Assessment System — Revised (ESAS-r)" sub="Drag each slider to the score that best describes how the patient feels in the last 24 hours (0–10)" />
            <SubCard title="Symptom Ratings (0 - 10 Scale)">
              <style>{`
                .esas-slider { -webkit-appearance: none; appearance: none; height: 6px; border-radius: 3px; outline: none; cursor: pointer; }
                .esas-slider::-webkit-slider-thumb { -webkit-appearance: none; appearance: none; width: 18px; height: 18px; border-radius: 50%; background: #fff; border: 2px solid var(--thumb, #0a0a0a); box-shadow: 0 1px 4px rgba(0,0,0,0.28); cursor: pointer; transition: transform 0.1s ease; }
                .esas-slider::-webkit-slider-thumb:hover { transform: scale(1.15); }
                .esas-slider::-moz-range-thumb { width: 18px; height: 18px; border-radius: 50%; background: #fff; border: 2px solid var(--thumb, #0a0a0a); box-shadow: 0 1px 4px rgba(0,0,0,0.28); cursor: pointer; }
                .esas-slider:focus-visible::-webkit-slider-thumb { box-shadow: 0 0 0 3px rgba(10,10,10,0.15); }
              `}</style>
              <Box sx={{ display: "grid", gridTemplateColumns: { xs: "1fr", md: "1fr 1fr" }, gap: { xs: 2.5, md: 3 } }}>
                {ESAS_ITEMS.map(([key, leftLabel, rightLabel]) => (
                  <Box key={key} sx={{ pb: 1.5, borderBottom: `1px solid ${C.fog}` }}>
                    <Box sx={{ display: "flex", justifyContent: "space-between", flexWrap: "wrap", gap: 1, mb: 1 }}>
                      <Typography sx={{ ...os({ fontSize: 12, color: C.ink, fontWeight: 500 }) }}>{leftLabel}</Typography>
                      <Typography sx={{ ...os({ fontSize: 11, color: C.ash }) }}>{rightLabel}</Typography>
                    </Box>
                    <ScaleInput value={form[key]} onChange={set(key)} />
                    <Box sx={{ mt: 1 }}>
                      <input
                        type="text" placeholder="Mention details (optional)..."
                        value={form[`${key}_details`] || ""}
                        onChange={(e) => set(`${key}_details`)(e.target.value)}
                        style={{ width: "100%", padding: "7px 10px", border: `1px solid ${C.mist}`, borderRadius: 2, fontFamily: FONT, fontSize: 12, boxSizing: "border-box" }}
                      />
                    </Box>
                  </Box>
                ))}
              </Box>
            </SubCard>
          </Box>

          {/* ── 4. Nursing Assessment (optional) ────────────────────────── */}
          <Box sx={{ mb: 4 }}>
            <SectionHeader title="4. Nursing Assessment" sub="Optional" />
            <SubCard title="Vital Signs">
              <Grid5>
                <TextInput label="Blood Pressure" value={form.bp} onChange={set("bp")} placeholder="e.g. 120/80" />
                <NumberInput label="Pulse" value={form.pulse} onChange={set("pulse")} unit="/min" />
                <NumberInput label="Temperature" value={form.temperature} onChange={set("temperature")} unit="°F" />
                <NumberInput label="Respiratory Rate" value={form.respiratoryRate} onChange={set("respiratoryRate")} />
                <NumberInput label="SpO2" value={form.spo2} onChange={set("spo2")} unit="%" />
              </Grid5>
            </SubCard>

            <SubCard title="Clinical Assessment & Airway">
              <RadioRow label="Tracheostomy" options={["Yes", "No"]} value={form.tracheostomy} onChange={set("tracheostomy")} />
              <Grid2>
                <TextInput label="Stoma" value={form.stoma} onChange={set("stoma")} placeholder="Brief note" />
                <TextInput label="Wound / Pressure Injury" value={form.woundPressureInjury} onChange={set("woundPressureInjury")} placeholder="Brief note" />
              </Grid2>
              <Grid2>
                <TextInput label="Oral Cavity" value={form.oralCavity} onChange={set("oralCavity")} />
                <TextInput label="Oedema" value={form.oedema} onChange={set("oedema")} />
              </Grid2>
            </SubCard>

            <SubCard title="Nutrition & Daily Living">
              <ChoiceGroup label="Nutrition" options={NUTRITION_OPTS} value={form.nutrition} onChange={set("nutrition")} />
              <ChoiceGroup label="Activities of Daily Living (ADL)" options={ADL_OPTS} value={form.adl} onChange={set("adl")} />
              <Grid2>
                <TextInput label="Primary Caregiver" value={form.primaryCaregiver} onChange={set("primaryCaregiver")} placeholder="Name, relation, contact" />
                <TextInput label="Any Other" value={form.nursingOther} onChange={set("nursingOther")} />
              </Grid2>
            </SubCard>
          </Box>

          {/* ── 5. Psychosocial and Spiritual Assessment ────────────────── */}
          <Box sx={{ mb: 4 }}>
            <SectionHeader title="5. Psychosocial and Spiritual Assessment" />
            <SubCard title="Communication & Awareness">
              <Grid2>
                <RadioRow label="Patient Knows Diagnosis" options={["Yes", "No"]} value={form.patientKnowsDiagnosis} onChange={set("patientKnowsDiagnosis")} />
                <RadioRow label="Caregiver Knows Diagnosis" options={["Yes", "No"]} value={form.caregiverKnowsDiagnosis} onChange={set("caregiverKnowsDiagnosis")} />
              </Grid2>
              <Grid2>
                <RadioRow label="Patient Knows Prognosis" options={["Yes", "No"]} value={form.patientKnowsPrognosis} onChange={set("patientKnowsPrognosis")} />
                <RadioRow label="Caregiver Knows Prognosis" options={["Yes", "No"]} value={form.caregiverKnowsPrognosis} onChange={set("caregiverKnowsPrognosis")} />
              </Grid2>
            </SubCard>

            <SubCard title="Psychosocial Screening & Support">
              <ChoiceGroup label="Psychosocial Issues — Screening Tool Used (optional)" options={PSYCHOSOCIAL_TOOL_OPTS} value={form.psychosocialTools} onChange={set("psychosocialTools")} />
              {Array.isArray(form.psychosocialTools) && form.psychosocialTools.map((tool) => (
                <Box key={tool} sx={{ mb: 2, p: 1.5, border: `1px solid ${C.fog}`, borderRadius: "4px", background: C.ghost }}>
                  <Typography sx={{ ...os({ fontSize: 11, color: C.smoke, mb: 1, fontWeight: 600 }) }}>{tool} — Score</Typography>
                  <Grid2>
                    <NumberInput
                      label="Total Score"
                      value={form.psychosocialScores?.[tool]?.score}
                      onChange={(v) => set("psychosocialScores")({ ...(form.psychosocialScores || {}), [tool]: { ...(form.psychosocialScores?.[tool] || {}), score: v } })}
                    />
                    <TextInput
                      label="Notes"
                      value={form.psychosocialScores?.[tool]?.notes}
                      onChange={(v) => set("psychosocialScores")({ ...(form.psychosocialScores || {}), [tool]: { ...(form.psychosocialScores?.[tool] || {}), notes: v } })}
                    />
                  </Grid2>
                </Box>
              ))}

              <RadioRow label="Social Support" options={["Yes", "No"]} value={form.socialSupport} onChange={set("socialSupport")} />
              {form.socialSupport === "Yes" && (
                <TextInput label="Details (e.g. family tree, caregivers, children, spouse)" value={form.socialSupportDetails} onChange={set("socialSupportDetails")} multiline />
              )}
            </SubCard>

            <SubCard title="Spiritual Screening">
              <YesNoText label="Is spirituality and religion important to you?" value={form.spiritualImportant} onChange={set("spiritualImportant")} extraOptions={["Uncertain", "Others"]} />
              <YesNoText label="Are your spiritual resources working for you?" value={form.spiritualResourcesWorking} onChange={set("spiritualResourcesWorking")} extraOptions={["Uncertain", "Others"]} />
            </SubCard>
          </Box>

          {/* ── 6. CAM Diagnostic Algorithm ─────────────────────────────── */}
          <Box sx={{ mb: 4 }}>
            <SectionHeader title="6. Confusion Assessment Method (CAM)" sub="For patients with suspected delirium" />
            <SubCard title="Delirium Diagnostic Criteria">
              <RadioRow
                label="Acute Onset or Fluctuating Course — Is there evidence of an acute change in mental status from baseline? Did the behaviour fluctuate during the day?"
                options={["Yes", "No"]} value={form.camAcuteOnset} onChange={set("camAcuteOnset")}
              />
              <RadioRow
                label="Inattention — Did the patient have difficulty focusing attention, e.g. being easily distractible or losing track of conversation?"
                options={["Yes", "No"]} value={form.camInattention} onChange={set("camInattention")}
              />
              <RadioRow
                label="Disorganized Thinking — Was the patient's thinking disorganized or incoherent (rambling, illogical flow of ideas, unpredictable subject switching)?"
                options={["Yes", "No"]} value={form.camDisorganized} onChange={set("camDisorganized")}
              />
              <RadioRow
                label="Altered Level of Consciousness — Overall rating"
                options={CONSCIOUSNESS_OPTS} value={form.camConsciousness} onChange={set("camConsciousness")}
              />
              {camResult && (
                <Box sx={{
                  mt: 1, p: 1.5, borderRadius: "4px",
                  border: `1px solid ${camResult.positive ? "#d32f2f" : C.fog}`,
                  background: camResult.positive ? "#fef2f2" : C.ghost,
                }}>
                  <Typography sx={{ ...os({ fontSize: 12, color: camResult.positive ? "#991b1b" : C.charcoal, fontWeight: 500 }) }}>
                    {camResult.label}
                  </Typography>
                </Box>
              )}
            </SubCard>
          </Box>

          {/* ── 7. Comprehensive Care Plan ──────────────────────────────── */}
          <Box sx={{ mb: 4 }}>
            <SectionHeader title="7. Comprehensive Care Plan" />

            <SubCard title="Diagnosis & Goals of Care">
              <TextInput label="Palliative Medicine Diagnosis" value={form.palliativeDiagnosis} onChange={set("palliativeDiagnosis")} multiline />
              <DetailChoiceList label="Goals of Care" options={GOALS_OF_CARE_OPTS} value={form.goalsOfCare} onChange={set("goalsOfCare")} />
              <TextInput label="Primary Decision Maker" value={form.primaryDecisionMaker} onChange={set("primaryDecisionMaker")} />
              <DetailChoiceList label="Preferred Place of Care" options={PLACE_OF_CARE_OPTS} value={form.preferredPlaceOfCare} onChange={set("preferredPlaceOfCare")} />
            </SubCard>

            <SubCard title="Investigations & Procedures">
              <TextInput label="Investigations" value={form.carePlanInvestigations} onChange={set("carePlanInvestigations")} placeholder="Reference note — full results linked from Data tab" />
              <ChoiceGroup label="Procedures" options={PROCEDURE_OPTS} value={form.procedures} onChange={set("procedures")} />
              {Array.isArray(form.procedures) && form.procedures.includes("PM POCUS") && (
                <ChoiceGroup label="PM POCUS — views performed" options={PM_POCUS_SUB_OPTS} value={form.pmPocusViews} onChange={set("pmPocusViews")} />
              )}
            </SubCard>

            <SubCard title="Medications Management">
              <Box sx={{ mb: 0.5 }}>
                <TextInput label="Ongoing Medications" value={form.ongoingMedications} onChange={set("ongoingMedications")} multiline />
                {(medsAutoFilling || medsAutoFilled || medsAutoFillError) && (
                  <Box sx={{ display: "flex", alignItems: "center", gap: 0.75, mt: -1.5, mb: 2 }}>
                    <AutoAwesomeRounded sx={{ fontSize: 13, color: C.smoke }} />
                    <Typography sx={{ ...os({ fontSize: 10.5, color: C.ash, fontStyle: "italic" }) }}>
                      {medsAutoFilling ? "Auto-filling from latest prescription..." : medsAutoFillError || "Auto-filled from patient's latest prescription"}
                    </Typography>
                  </Box>
                )}
              </Box>
              <TextInput label="Medications Prescribed (this visit)" value={form.medicationsPrescribed} onChange={set("medicationsPrescribed")} multiline placeholder="Drug, dose, route, frequency — one per line" />
            </SubCard>

            <SubCard title="Non-Pharmacological Plan & Referrals">
              <YesNoText label="Re-counselling required" value={form.reCounselling} onChange={set("reCounselling")} extraOptions={["Other"]} />
              <YesNoText label="Psychological and spiritual support" value={form.psychSpiritualSupport} onChange={set("psychSpiritualSupport")} extraOptions={["Others"]} />
              <DetailChoiceList label="Social Support" options={SOCIAL_SUPPORT_PLAN_OPTS} value={form.socialSupportPlan} onChange={set("socialSupportPlan")} />
            </SubCard>

            <SubCard title="Follow-up & Referral Letter">
              <RadioRow label="Follow-up Plan" options={["Yes", "No"]} value={form.followUpPlan} onChange={set("followUpPlan")} />
              {FOLLOWUP_DATE_ENABLED.includes(form.followUpPlan) && (
                <DateInput label="Follow-up Date" value={form.followUpDate} onChange={set("followUpDate")} />
              )}
              <RadioRow label="Referral Letter" options={["Yes", "No"]} value={form.referralLetter} onChange={set("referralLetter")} />
              {form.referralLetter === "Yes" && (
                <Box sx={{ mb: 2 }}>
                  <FieldLabel>Upload Referral Letter</FieldLabel>
                  <Box sx={{ display: "flex", alignItems: "center", gap: 1.5, flexWrap: "wrap" }}>
                    <Box component="label" sx={{ ...ghostButton, display: "inline-flex", cursor: uploadingReferral ? "not-allowed" : "pointer", opacity: uploadingReferral ? 0.5 : 1 }}>
                      <UploadFileRounded sx={{ fontSize: 15 }} />
                      {uploadingReferral ? "Uploading..." : form.referralLetterFile?.name || "Choose file"}
                      <input
                        type="file" hidden disabled={uploadingReferral}
                        accept=".pdf,.jpg,.jpeg,.png"
                        onChange={(e) => e.target.files?.[0] && uploadReferralLetter(e.target.files[0])}
                      />
                    </Box>
                    {form.referralLetterFile?.file_url && (
                      <Box component="a" href={form.referralLetterFile.file_url} target="_blank" rel="noopener noreferrer"
                        sx={{ ...os({ fontSize: 11, color: C.smoke, textDecoration: "underline" }) }}>
                        View uploaded file
                      </Box>
                    )}
                  </Box>
                  {referralUploadError && (
                    <Typography sx={{ ...os({ fontSize: 11, color: "#d32f2f", mt: 0.75 }) }}>{referralUploadError}</Typography>
                  )}
                </Box>
              )}
            </SubCard>
          </Box>

          {/* ── 8. Patient Referrals ─────────────────────────────────────── */}
          <Box sx={{ mb: 4 }}>
            <SectionHeader title="8. Patient Referrals" />
            <PatientReferralsTab
              patientId={patientId}
              doctorId={doctorId}
              doctorName={doctorInfoName}
              hospitalId={hospitalId}
            />
          </Box>

          {/* ── 9. Completed Lab Investigation ───────────────────────────── */}
          <Box sx={{ mb: 4 }}>
            <SectionHeader title="9. Completed Lab Investigation" />
            <CompletedInvestigationsTable completedInvestigations={completedLabs} doctorNamesMap={doctorNamesMap} />
          </Box>

          {saveError && (
            <Typography sx={{ ...os({ fontSize: 12, color: "#d32f2f", mb: 1 }) }}>{saveError}</Typography>
          )}
        </Box>
      )}

      {/* Footer — Save */}
      {!contextLoading && (
        <Box sx={{ px: { xs: 2.5, sm: 3 }, py: 2, borderTop: `1px solid ${C.fog}`, background: C.ghost, display: "flex", alignItems: "center", justifyContent: "flex-end", gap: 2 }}>
          <Box component="button" type="button" onClick={handleSave} disabled={saving} sx={{ ...actionButton, minWidth: 140 }}>
            {saved ? (<><CheckCircleRounded sx={{ fontSize: 15 }} /> Saved</>) : saving ? "Saving..." : (<><SaveRounded sx={{ fontSize: 15 }} /> Save</>)}
          </Box>
        </Box>
      )}
    </Box>
  );
}