import React, { useState, useCallback, useEffect, useRef } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import {
  ArrowLeft, Sparkles, Save, HeartPulse, X, FileText, ClipboardList,
  Loader2, Plus, Trash2, Layers, Mic, Square,
} from "lucide-react";

const API_BASE_URL = import.meta.env.VITE_BACKEND_URL;

/* ─── VOICE ENDPOINTS ───
   Diarization: raw audio -> transcript text (used by BOTH Part A & Part C)
   Structure:   transcript text -> structured nurse/patient turns (Part A ONLY) */
const DIARIZATION_URL = "https://doctorassist.ai/api/hms/users/ai/elevenlabs/api/transcribe_with_diarization";
const STRUCTURE_CONVERSATION_URL = "https://doctorassist.ai/api/hms/users/data/context/structure_nurse_patient_conversation_mobile";

/* ─── THEME ─── */
const T = {
  bg: "#ffffff",
  bgAlt: "#fafafa",
  bgTert: "#f2f2f2",
  text: "#000000",
  textSec: "#444444",
  textMuted: "#8a8a8a",
  border: "#e2e2e2",
  borderStrong: "#cfcfcf",
  accent: "#000000",
  good: "#1a7a3a",
  bad: "#c00",
};

const F = {
  page: { fontFamily: "'Open Sans', sans-serif", fontWeight: 300, color: T.text, background: T.bg, minHeight: "100vh" },
  topBar: {
    position: "sticky", top: 0, background: T.bg, borderBottom: `1px solid ${T.border}`,
    padding: "0.875rem 2rem", display: "flex", justifyContent: "space-between", alignItems: "center", zIndex: 50, gap: 12,
  },
  backBtn: { background: "none", border: "none", cursor: "pointer", display: "flex", alignItems: "center", gap: 6, color: T.text, fontSize: "0.8rem" },
  title: { fontSize: "1rem", fontWeight: 400, margin: 0 },
  body: { padding: "2rem", maxWidth: 1240, margin: "0 auto" },

  /* ── AI paste box ── */
  aiBox: { border: `1px solid ${T.border}`, background: T.bgAlt, padding: "1.25rem 1.4rem", marginBottom: "1.75rem", borderRadius: 6 },
  aiLabelRow: { display: "flex", alignItems: "center", gap: 8, marginBottom: 10 },
  aiIconBadge: { width: 26, height: 26, borderRadius: 6, background: T.text, color: T.bg, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 },
  aiLabel: { fontSize: "0.72rem", textTransform: "uppercase", letterSpacing: "0.08em", color: T.textSec, fontWeight: 400 },
  aiSubLabel: { fontSize: "0.72rem", color: T.textMuted, marginBottom: 10, display: "block" },
  textarea: {
    width: "100%", minHeight: 110, padding: "0.7rem", border: `1px solid ${T.border}`, fontFamily: "'Open Sans', sans-serif",
    fontSize: "0.82rem", resize: "vertical", boxSizing: "border-box", background: T.bg, color: T.text, borderRadius: 4,
  },
  aiBtnRow: { display: "flex", alignItems: "center", flexWrap: "wrap", gap: 10 },
  aiBtn: {
    marginTop: 10, display: "inline-flex", alignItems: "center", gap: 6, padding: "0.55rem 1.1rem",
    background: T.text, color: T.bg, border: "none", cursor: "pointer", fontSize: "0.75rem", fontFamily: "'Open Sans', sans-serif",
    borderRadius: 4,
  },
  micBtn: {
    marginTop: 10, display: "inline-flex", alignItems: "center", gap: 6, padding: "0.55rem 1.1rem",
    background: T.bg, color: T.text, border: `1px solid ${T.border}`, cursor: "pointer", fontSize: "0.75rem",
    fontFamily: "'Open Sans', sans-serif", borderRadius: 4,
  },
  micBtnActive: {
    marginTop: 10, display: "inline-flex", alignItems: "center", gap: 6, padding: "0.55rem 1.1rem",
    background: T.bad, color: "#fff", border: `1px solid ${T.bad}`, cursor: "pointer", fontSize: "0.75rem",
    fontFamily: "'Open Sans', sans-serif", borderRadius: 4, animation: "pfx-pulse 1.2s ease-in-out infinite",
  },
  voiceStatusText: { marginTop: 10, fontSize: "0.72rem", color: T.textMuted, display: "flex", alignItems: "center", gap: 6 },

  fieldGrid: { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: "1rem" },
  fieldLabel: { fontSize: "0.72rem", color: T.textMuted, marginBottom: 4, display: "block", textTransform: "uppercase", letterSpacing: "0.05em" },
  input: { width: "100%", padding: "0.5rem", border: `1px solid ${T.border}`, fontSize: "0.8rem", boxSizing: "border-box", fontFamily: "'Open Sans', sans-serif", borderRadius: 4 },
  select: { width: "100%", padding: "0.5rem", border: `1px solid ${T.border}`, fontSize: "0.8rem", boxSizing: "border-box", fontFamily: "'Open Sans', sans-serif", borderRadius: 4 },
  radioRow: { display: "flex", gap: "1.25rem", flexWrap: "wrap" },
  radioLabel: { display: "flex", alignItems: "center", gap: 6, fontSize: "0.8rem", cursor: "pointer" },
  checkGrid: { display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(180px, 1fr))", gap: "0.4rem 1rem" },
  checkLabel: { display: "flex", alignItems: "center", gap: 6, fontSize: "0.78rem", cursor: "pointer" },
  subTable: { width: "100%", borderCollapse: "collapse", marginTop: 8 },
  th: { textAlign: "left", padding: "0.4rem 0.5rem", fontSize: "0.62rem", textTransform: "uppercase", color: T.textMuted, borderBottom: `1px solid ${T.border}` },
  td: { padding: "0.4rem 0.5rem", borderBottom: `1px solid ${T.border}` },
  smallBtn: { padding: "0.3rem 0.6rem", fontSize: "0.68rem", border: `1px solid ${T.border}`, background: T.bg, cursor: "pointer", display: "inline-flex", alignItems: "center", gap: 4, borderRadius: 4 },
  saveBar: {
    position: "sticky", bottom: 0, background: T.bg, borderTop: `1px solid ${T.border}`, padding: "1rem 2rem",
    display: "flex", justifyContent: "flex-end", alignItems: "center", gap: 12,
  },
  saveBtn: { display: "flex", alignItems: "center", gap: 8, padding: "0.65rem 1.5rem", background: T.text, color: T.bg, border: "none", cursor: "pointer", fontSize: "0.8rem", borderRadius: 4 },
  saveBtnSecondary: { display: "flex", alignItems: "center", gap: 8, padding: "0.5rem 1.1rem", background: T.bg, color: T.text, border: `1px solid ${T.border}`, cursor: "pointer", fontSize: "0.75rem", borderRadius: 4 },
  banner: { fontSize: "0.75rem", padding: "0.6rem 1rem", marginTop: 12, marginBottom: 0, border: `1px solid ${T.border}`, borderRadius: 4 },
  otherDetailWrap: { marginTop: 8, gridColumn: "1 / -1" },
  vitalsCard: { border: `1px solid ${T.border}`, padding: "0.85rem 1rem", background: T.bgAlt, borderRadius: 6 },
  vitalsRow: { display: "flex", alignItems: "center", gap: 10, padding: "0.4rem 0", borderBottom: `1px solid ${T.border}` },
  vitalsRowLast: { display: "flex", alignItems: "center", gap: 10, padding: "0.4rem 0" },
  vitalsLabel: { fontSize: "0.78rem", minWidth: 130, display: "flex", alignItems: "center", gap: 6 },
  subCheckWrap: { marginLeft: 24, marginTop: 4, display: "flex", flexDirection: "column", gap: 4 },
  thumb: { maxWidth: 160, maxHeight: 120, border: `1px solid ${T.border}`, display: "block", marginTop: 8, borderRadius: 4 },
  imgRemoveBtn: { display: "inline-flex", alignItems: "center", gap: 4, marginTop: 6, background: "none", border: `1px solid ${T.border}`, padding: "0.25rem 0.5rem", fontSize: "0.68rem", cursor: "pointer", borderRadius: 4 },
  modalOverlay: {
    position: "fixed", top: 0, left: 0, right: 0, bottom: 0, background: "rgba(0,0,0,0.75)",
    display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000, padding: "2rem",
  },
  modalImage: { maxWidth: "90vw", maxHeight: "85vh", borderRadius: 6, display: "block", boxShadow: "0 4px 24px rgba(0,0,0,0.4)" },
  modalCloseBtn: {
    position: "absolute", top: 24, right: 32, background: "rgba(255,255,255,0.9)", border: "none",
    borderRadius: "50%", width: 36, height: 36, display: "flex", alignItems: "center", justifyContent: "center",
    cursor: "pointer",
  },

  /* ── main top-level tabs: Part A / Part C ── */
  mainTabBar: { display: "flex", gap: 8, marginBottom: "1.75rem" },
  mainTab: (active) => ({
    display: "flex", alignItems: "center", gap: 10, padding: "0.9rem 1.6rem",
    fontSize: "0.85rem", cursor: "pointer", fontFamily: "'Open Sans', sans-serif",
    border: `1px solid ${active ? T.text : T.border}`,
    background: active ? T.text : T.bg,
    color: active ? T.bg : T.textSec,
    fontWeight: active ? 400 : 300,
    borderRadius: 6,
    transition: "all 0.15s ease",
  }),
  mainTabSub: (active) => ({ fontSize: "0.66rem", opacity: 0.75, textTransform: "uppercase", letterSpacing: "0.06em", color: active ? T.bg : T.textMuted }),

  loadingWrap: { display: "flex", alignItems: "center", gap: 8, padding: "3rem 0", justifyContent: "center", color: T.textMuted, fontSize: "0.85rem" },

  /* ── left-hand section navigation (per top-level tab) ── */
  formLayout: { display: "flex", gap: "1.5rem", alignItems: "flex-start" },
  formSidebar: {
    width: 270, flexShrink: 0, border: `1px solid ${T.border}`, position: "sticky", top: 20,
    maxHeight: "calc(100vh - 140px)", overflowY: "auto", background: T.bg, borderRadius: 6, overflow: "hidden",
  },
  formSidebarHeading: {
    padding: "0.7rem 1rem", fontSize: "0.66rem", textTransform: "uppercase", letterSpacing: "0.08em",
    color: T.textMuted, background: T.bgTert, borderBottom: `1px solid ${T.border}`,
  },
  formSidebarItem: (active) => ({
    display: "block", width: "100%", textAlign: "left", padding: "0.75rem 1rem",
    fontSize: "0.76rem", border: "none", borderBottom: `1px solid ${T.border}`,
    background: active ? T.bgAlt : T.bg, cursor: "pointer",
    color: active ? T.text : T.textSec, fontWeight: active ? 400 : 300,
    fontFamily: "'Open Sans', sans-serif", borderLeft: active ? `3px solid ${T.text}` : "3px solid transparent",
    transition: "background 0.12s ease",
  }),
  formContent: { flex: 1, minWidth: 0, border: `1px solid ${T.border}`, borderRadius: 6, overflow: "hidden" },
  formContentHeader: {
    padding: "0.9rem 1.25rem", background: T.bgAlt, borderBottom: `1px solid ${T.border}`,
    fontSize: "0.82rem", fontWeight: 400, textTransform: "uppercase", letterSpacing: "0.08em", margin: 0,
  },
  formContentBody: { padding: "1.5rem" },
};

/* ─── OPTION LISTS (from PDF) ─── */
const VISIT_TYPE_OPTIONS = ["New", "Follow Up"];
const SYMPTOM_OPTIONS = ["General", "Breast Symptoms", "Cervical Symptoms", "Oral Symptoms", "Gastro Intestinal Symptoms", "Urinary Symptoms", "Respiratory Symptoms", "Others"];
const COMORBIDITY_OPTIONS = ["Renal disease", "Kochs", "Hypertension", "Hepatitis", "Heart disease", "Diabetes", "Cancer", "Blood Transfusion", "Asthma", "Others"];
const HABIT_OPTIONS = ["Alcohol", "Beedi", "Betal leaves", "Betel Nut", "Cigarette", "Gutka", "Masheri", "Pan Masala", "Snuff", "Tobacco Chewing", "Marijuana/Drugs", "Others"];
const TREATMENT_OPTIONS = ["Bone Marrow Transplant", "Stenting", "Hormone Therapy", "Symptomatic", "Radiology Intervention", "Endoscopy Intervention", "Chemotherapy", "Radiation therapy", "Surgery"];
const CONTRACEPTIVE_OPTIONS = ["Oral Pills", "Tubal ligation", "Vasectomy", "Natural method", "Barrier", "Sterilization", "I.U.D", "Injectables", "Others"];
const GEN_EXAM_OPTIONS = ["Oedema", "Cyanosis", "Clubbing", "Purpura", "Obesity", "Icterus", "Pallor"];
const AXILLA_OPTIONS = ["Normal", "Abnormal", "Others"];
const IMPRESSION_OPTIONS = ["Normal", "Invasive Cancer", "CIN 3", "CIN 2", "CIN I", "HPV Changes", "Polyp", "Cervicitis", "Ectropion", "Frank Growth", "Atrophy", "Others"];
const DURATION_UNITS = ["Years", "Months", "Weeks", "Days"];

/* ─── TOP-LEVEL TABS ─── */
const MAIN_TABS = [
  { key: "partA", label: "Part A", sub: "Case History (& Part B)", icon: FileText },
  { key: "partC", label: "Part C", sub: "Examination Details", icon: ClipboardList },
];

/* ─── LEFT-HAND SECTION MENUS (scoped to each top-level tab) ─── */
const PART_A_SECTIONS = [
  { key: "case_details", title: "Case Details" },
  { key: "registration", title: "Registration" },
  { key: "history", title: "History (Co-morbidities)" },
  { key: "family_history", title: "Family History" },
  { key: "substance_abuse", title: "Substance Abuse History" },
  { key: "previous_cancer", title: "History of Previous Cancer" },
  { key: "menstrual_history", title: "Part B — Menstrual History", femaleOnly: true },
  { key: "obstetric_history", title: "Part B — Obstetric History", femaleOnly: true },
  { key: "contraceptive_history", title: "Part B — Contraceptive History", femaleOnly: true },
  { key: "hrt_history", title: "Part B — Hormone Replacement Therapy History", femaleOnly: true },
];

const PART_C_SECTIONS = [
  { key: "general_examination", title: "General Examination" },
  { key: "breast_examination", title: "Breast Examination Findings", femaleOnly: true },
  { key: "cervical_examination", title: "Cervical Examination Findings", femaleOnly: true },
  { key: "investigations_advised", title: "Investigations Advised" },
  { key: "prescription_followup", title: "Prescription, Follow-up & Referral" },
];

/* ─── DEFAULT STATE ─── */
const emptyDuration = () => ({ value: "", unit: "Years" });
const emptyVitalItem = () => ({ checked: false, value: "" });
const emptyOtherVital = () => ({ id: `ov_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`, name: "", value: "" });

const defaultCaseHistory = () => ({
  visit_type: null,
  registration: { routine_screening: null, asymptomatic: null, symptoms: [], symptoms_other_detail: "", duration_of_symptoms: emptyDuration() },
  history: { comorbidities_present: null, comorbidities: [], remarks: "" },
  family_history: { family_history_of_cancer: null, relation_with_patient: "", cancer_site: "", laterality: "", age_at_onset: "", duration_months_years: "", status: null },
  substance_abuse: { substance_abuse_history: null, habits: [], occupational_exposure: "", remarks: "" },
  previous_cancer: { history_of_previous_cancer: null, diagnosis: "", cancer_site: "", stage_at_diagnosis: "", type_of_treatment: [], remarks: "" },
  menstrual_history: { menstrual_history: null, menopause_status: null, lmp_date: "", marital_status: null, age_at_marriage: "", hysterectomy_done: null, indications_for_hysterectomy: "", age_at_hysterectomy: "" },
  obstetric_history: { obstetric_history: null, gravida: "", para: "", abortion: "", living_children: "", normal_delivery: "", caesarean_section: "", dead_children: "", still_births: "", breastfed: null, breastfeeding_duration_months: "" },
  contraceptive_history: { contraceptives: null, contraceptive_type: [], contraceptive_type_other_detail: "", duration_of_contraceptive: "", remarks: "" },
  hrt_history: { hrt_history: null, type_of_therapy: null, from_date: "", route_of_administration: "", remarks: "" },
});

const defaultExamination = () => ({
  general_examination: {
    height_cm: "", weight_kg: "",
    /* vitals.others is an ARRAY of { id, name, value } rows so the user can
       add any number of custom vitals, each with its own name (left) and
       value (right), instead of one fixed "Others" box. */
    vitals: { spo2: emptyVitalItem(), blood_pressure: emptyVitalItem(), others: [] },
    findings: [], nutrition: "", hydration: "", oral_cavity_findings: "", dental_hygiene: "", mouth_opening_cm: "",
  },
  breast_examination: {
    left: { signs_of_surgery: null, axilla: null, axilla_other_detail: "", palpation: "", nipple_discharge: "", nipple_retraction: "", other_findings: "" },
    right: { signs_of_surgery: null, axilla: null, axilla_other_detail: "", palpation: "", nipple_discharge: "", nipple_retraction: "", other_findings: "" },
  },
  cervical_examination: { via: null, vili: "", colposcopy: "", colposcopy_image: null, impression: null, impression_other_detail: "", remarks: "" },
  investigations_advised: {},
  prescription: "",
  follow_up_advise: { tobacco_cessation_details: "", lifestyle_modification_details: "", others: "" },
  follow_up_visit: { oral: null, breast: null, cervical: null },
  refer_to_other_departments: "",
  refer_outside_hospital: "",
});

/* ─── small immutable path setter: setPath(obj, "a.b.c", value) ─── */
function setPath(obj, path, value) {
  const keys = path.split(".");
  const clone = Array.isArray(obj) ? [...obj] : { ...obj };
  let cur = clone;
  for (let i = 0; i < keys.length - 1; i++) {
    const k = keys[i];
    cur[k] = Array.isArray(cur[k]) ? [...cur[k]] : { ...cur[k] };
    cur = cur[k];
  }
  cur[keys[keys.length - 1]] = value;
  return clone;
}
function toggleArrayValue(arr, value) {
  const a = arr || [];
  return a.includes(value) ? a.filter((v) => v !== value) : [...a, value];
}

/* Deep-merge helper used when loading saved data from the DB */
function deepMerge(base, incoming) {
  if (incoming === null || incoming === undefined) return base;
  if (Array.isArray(base)) return Array.isArray(incoming) ? incoming : base;
  if (typeof base === "object" && base !== null && typeof incoming === "object") {
    const out = { ...base };
    for (const key of Object.keys(base)) {
      if (key in incoming) out[key] = deepMerge(base[key], incoming[key]);
    }
    return out;
  }
  return incoming;
}

/* ─── REUSABLE FIELD COMPONENTS ─── */
function FormPane({ title, children }) {
  return (
    <div style={F.formContent}>
      <p style={F.formContentHeader}>{title}</p>
      <div style={F.formContentBody}>{children}</div>
    </div>
  );
}

function YesNo({ label, value, onChange, options = ["Yes", "No"] }) {
  return (
    <div>
      <span style={F.fieldLabel}>{label}</span>
      <div style={F.radioRow}>
        {options.map((opt) => (
          <label key={opt} style={F.radioLabel}>
            <input type="radio" checked={value === opt} onChange={() => onChange(opt)} />
            {opt}
          </label>
        ))}
      </div>
    </div>
  );
}

function TextField({ label, value, onChange, type = "text" }) {
  return (
    <div>
      <span style={F.fieldLabel}>{label}</span>
      <input style={F.input} type={type} value={value ?? ""} onChange={(e) => onChange(e.target.value)} />
    </div>
  );
}

function TextArea({ label, value, onChange }) {
  return (
    <div style={{ gridColumn: "1 / -1" }}>
      <span style={F.fieldLabel}>{label}</span>
      <textarea style={{ ...F.textarea, minHeight: 70 }} value={value ?? ""} onChange={(e) => onChange(e.target.value)} />
    </div>
  );
}

function SelectField({ label, value, onChange, options, otherDetail, onOtherDetailChange }) {
  const showOther = value === "Others" && !!onOtherDetailChange;
  return (
    <div>
      <span style={F.fieldLabel}>{label}</span>
      <select style={F.select} value={value ?? ""} onChange={(e) => onChange(e.target.value || null)}>
        <option value="">—</option>
        {options.map((o) => (
          <option key={o} value={o}>{o}</option>
        ))}
      </select>
      {showOther && (
        <input
          style={{ ...F.input, marginTop: 6 }}
          placeholder="Please specify…"
          value={otherDetail ?? ""}
          onChange={(e) => onOtherDetailChange(e.target.value)}
        />
      )}
    </div>
  );
}

function CheckGroup({ label, options, selected, onChange, otherDetail, onOtherDetailChange }) {
  const hasOthersOption = options.includes("Others");
  const othersChecked = (selected || []).includes("Others");
  return (
    <div style={{ gridColumn: "1 / -1" }}>
      <span style={F.fieldLabel}>{label}</span>
      <div style={F.checkGrid}>
        {options.map((opt) => (
          <label key={opt} style={F.checkLabel}>
            <input type="checkbox" checked={(selected || []).includes(opt)} onChange={() => onChange(toggleArrayValue(selected, opt))} />
            {opt}
          </label>
        ))}
      </div>
      {hasOthersOption && othersChecked && onOtherDetailChange && (
        <div style={F.otherDetailWrap}>
          <input
            style={F.input}
            placeholder="Please specify other…"
            value={otherDetail ?? ""}
            onChange={(e) => onOtherDetailChange(e.target.value)}
          />
        </div>
      )}
    </div>
  );
}

function DurationField({ label, duration, onChange }) {
  return (
    <div>
      <span style={F.fieldLabel}>{label}</span>
      <div style={{ display: "flex", gap: 6 }}>
        <input style={{ ...F.input, width: 80 }} type="number" value={duration?.value ?? ""} onChange={(e) => onChange({ ...duration, value: e.target.value })} />
        <select style={F.select} value={duration?.unit ?? "Years"} onChange={(e) => onChange({ ...duration, unit: e.target.value })}>
          {DURATION_UNITS.map((u) => <option key={u} value={u}>{u}</option>)}
        </select>
      </div>
    </div>
  );
}

/* Input is ALWAYS editable (not gated on checked). Checking the box simply
   marks the vital as "recorded"; typing into the value field auto-checks
   it too, so users are never stuck unable to type into SpO2 / BP. */
function VitalRow({ label, item, onChange, placeholder, last = false }) {
  const handleValueChange = (val) => {
    onChange({ ...item, value: val, checked: val ? true : item?.checked });
  };
  return (
    <div style={last ? F.vitalsRowLast : F.vitalsRow}>
      <label style={F.vitalsLabel}>
        <input
          type="checkbox"
          checked={!!item?.checked}
          onChange={(e) => onChange({ ...item, checked: e.target.checked })}
        />
        {label}
      </label>
      <input
        style={F.input}
        placeholder={placeholder}
        value={item?.value ?? ""}
        onChange={(e) => handleValueChange(e.target.value)}
      />
    </div>
  );
}

/* "Other Vitals" block: lets the user ADD any number of custom vitals.
   Each row has a NAME field on the left (e.g. "Pulse", "Temp", "RBS") and a
   VALUE field on the right (e.g. "88 bpm", "98.6°F"). Rows can be added
   with "+ Add other vital" and removed individually. */
function OtherVitalsBlock({ items, onChange }) {
  const rows = items || [];

  const addRow = () => onChange([...rows, emptyOtherVital()]);
  const updateRow = (id, field, val) =>
    onChange(rows.map((r) => (r.id === id ? { ...r, [field]: val } : r)));
  const removeRow = (id) => onChange(rows.filter((r) => r.id !== id));

  return (
    <div style={{ paddingTop: 8 }}>
      <span style={{ ...F.vitalsLabel, minWidth: 0, marginBottom: 8 }}>Other Vitals</span>
      {rows.length === 0 && (
        <p style={{ fontSize: "0.74rem", color: T.textMuted, margin: "4px 0 10px" }}>
          No other vitals added yet.
        </p>
      )}
      {rows.map((row) => (
        <div key={row.id} style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 8 }}>
          <input
            style={{ ...F.input, flex: 1 }}
            placeholder="Vital name (e.g. Pulse, Temp)"
            value={row.name ?? ""}
            onChange={(e) => updateRow(row.id, "name", e.target.value)}
          />
          <input
            style={{ ...F.input, flex: 1 }}
            placeholder="Value (e.g. 88 bpm)"
            value={row.value ?? ""}
            onChange={(e) => updateRow(row.id, "value", e.target.value)}
          />
          <button
            type="button"
            style={{ ...F.smallBtn, flexShrink: 0 }}
            onClick={() => removeRow(row.id)}
            title="Remove this vital"
          >
            <Trash2 size={12} />
          </button>
        </div>
      ))}
      <button type="button" style={F.smallBtn} onClick={addRow}>
        <Plus size={12} /> Add other vital
      </button>
    </div>
  );
}

/* ─── MAIN COMPONENT ─── */
import { LabInvestigations } from "./LabInvestigations";
import PatientReferralsTab from "./PatientReferralsTab";

export default function PreventiveScreening() {
  const location = useLocation();
  const navigate = useNavigate();
  const query = new URLSearchParams(location.search);
  const doctorId = query.get("doctor_id");
  const patientId = query.get("patient_id");
  const hospitalId = query.get("hospital_id");
  const doctorName = query.get("doctor_name");
  const [appointmentId, setAppointmentId] = useState(null);

  /* ✅ Only two top-level tabs now: "partA" and "partC" */
  const [activeMainTab, setActiveMainTab] = useState("partA");
  const [loadingRecord, setLoadingRecord] = useState(true);

  const [isFemale, setIsFemale] = useState(false);
  const [caseHistory, setCaseHistory] = useState(defaultCaseHistory());
  const [patientInfo, setPatientInfo] = useState({ patientName: "", age: null, gender: "", phone: "" });
  const [examination, setExamination] = useState(defaultExamination());

  const [conversationText, setConversationText] = useState("");
  const [nurseNotesText, setNurseNotesText] = useState("");

  const [processingHistory, setProcessingHistory] = useState(false);
  const [processingExam, setProcessingExam] = useState(false);
  const [historyBanner, setHistoryBanner] = useState(null);
  const [examBanner, setExamBanner] = useState(null);
  const [saving, setSaving] = useState(false);
  const [savingVitals, setSavingVitals] = useState(false);
  const [vitalsBanner, setVitalsBanner] = useState(null);
  const [saveAllBanner, setSaveAllBanner] = useState(null);
   const [cervicalImages, setCervicalImages] = useState([]);
  const [uploadingCervicalImage, setUploadingCervicalImage] = useState(false);
  const [cervicalImageBanner, setCervicalImageBanner] = useState(null);
   const [previewImageUrl, setPreviewImageUrl] = useState(null);

  /* ── voice recording state — Part A (case history: diarization -> structure) ── */
  const [isRecordingCaseHistory, setIsRecordingCaseHistory] = useState(false);
  const [transcribingCaseHistory, setTranscribingCaseHistory] = useState(false);
  const mediaRecorderCHRef = useRef(null);
  const audioChunksCHRef = useRef([]);

  /* ── voice recording state — Part C (examination: diarization ONLY) ── */
  const [isRecordingExam, setIsRecordingExam] = useState(false);
  const [transcribingExam, setTranscribingExam] = useState(false);
  const mediaRecorderExRef = useRef(null);
  const audioChunksExRef = useRef([]);

  /* which section is selected in each tab's left-hand menu — kept
     independently so switching Part A ↔ Part C remembers each tab's spot */
  const [activePartASection, setActivePartASection] = useState("case_details");
  const [activePartCSection, setActivePartCSection] = useState("general_examination");

  const visiblePartASections = PART_A_SECTIONS.filter((s) => !s.femaleOnly || isFemale);
  const visiblePartCSections = PART_C_SECTIONS.filter((s) => !s.femaleOnly || isFemale);

  /* fall back to the first visible section if the current one gets hidden
     (e.g. "Female patient" unchecked while on a Part B / breast / cervical section) */
  useEffect(() => {
    if (!visiblePartASections.some((s) => s.key === activePartASection)) {
      setActivePartASection(visiblePartASections[0]?.key || "case_details");
    }
    if (!visiblePartCSections.some((s) => s.key === activePartCSection)) {
      setActivePartCSection(visiblePartCSections[0]?.key || "general_examination");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isFemale]);

  /* ══════════════════════════════════════════════════════════
     FETCH ON LOAD — pull latest saved record for this patient_id.
     If nothing exists yet, form stays blank (defaults).
     ══════════════════════════════════════════════════════════ */
  useEffect(() => {
    let cancelled = false;
    async function loadExisting() {
      if (!patientId) {
        setLoadingRecord(false);
        return;
      }
      setLoadingRecord(true);
      try {
          // Get appointment ID
  const appointmentRes = await fetch(
    `${API_BASE_URL}hms/users/data/patient_basic_screening_details/${patientId}/${doctorId}`
  );

  if (appointmentRes.ok) {
    const appointmentData = await appointmentRes.json();
    const appt = appointmentData.data.latest_appointment;
    setAppointmentId(appt?.appointment_id || null);
  }

  // Auto-detect patient gender -> auto-show Part B / female-only sections
  // Auto-fill patient identity (Case Number, Name, Age, Sex) + auto-detect
  // gender -> auto-show Part B / female-only sections
  try {
    const patientDetailsRes = await fetch(
      `${API_BASE_URL}hms/users/data/context/pain-management/patient-details/${patientId}/${doctorId}`
    );
    if (patientDetailsRes.ok) {
      const patientDetailsData = await patientDetailsRes.json();
      if (patientDetailsData.status === "success" && patientDetailsData.data) {
        const d = patientDetailsData.data;
        setPatientInfo({
          patientName: d.patientName || "",
          age: d.age ?? null,
          gender: d.gender || "",
          phone: d.phone || "",
        });
        if (d.gender && d.gender.trim().toLowerCase() === "female") {
          setIsFemale(true);
        }
      }
    }
  } catch (genderErr) {
    console.error("Failed to fetch patient details for auto-fill:", genderErr);
  }

        const res = await fetch(`${API_BASE_URL}hms/users/data/context/preventive-screening/get/${patientId}`);
        const data = await res.json();
        if (cancelled) return;

        if (data.status === "success") {
          if (data.case_history) {
            setCaseHistory((prev) => deepMerge(defaultCaseHistory(), data.case_history));
          }
          if (data.examination) {
            setExamination((prev) => deepMerge(defaultExamination(), data.examination));
          }
          if (data.case_history?.menstrual_history?.menstrual_history) {
            setIsFemale(true);
          }
        }
      } catch (e) {
        console.error("Failed to load existing preventive-screening record:", e);
      } finally {
        if (!cancelled) setLoadingRecord(false);
      }
    }
    loadExisting();
    return () => { cancelled = true; };
  }, [patientId]);

  /* fetch previously uploaded colposcopy images for this patient */
  useEffect(() => {
    let cancelled = false;
    async function loadCervicalImages() {
      if (!patientId) return;
      try {
        const res = await fetch(`${API_BASE_URL}hms/users/cm/storage/preventive-images/${patientId}`);
        if (res.ok) {
          const data = await res.json();
          if (!cancelled) setCervicalImages(data.images || []);
        }
      } catch (e) {
        console.error("Failed to load cervical/colposcopy images:", e);
      }
    }
    loadCervicalImages();
    return () => { cancelled = true; };
  }, [patientId]);

  /* stop any in-progress recordings if the component unmounts mid-recording */
  useEffect(() => {
    return () => {
      if (mediaRecorderCHRef.current && mediaRecorderCHRef.current.state !== "inactive") {
        mediaRecorderCHRef.current.stop();
        mediaRecorderCHRef.current.stream?.getTracks().forEach((t) => t.stop());
      }
      if (mediaRecorderExRef.current && mediaRecorderExRef.current.state !== "inactive") {
        mediaRecorderExRef.current.stop();
        mediaRecorderExRef.current.stream?.getTracks().forEach((t) => t.stop());
      }
    };
  }, []);

  /* -- helpers to update nested form state -- */
  const setCH = useCallback((path, value) => setCaseHistory((prev) => setPath(prev, path, value)), []);
  const setEX = useCallback((path, value) => setExamination((prev) => setPath(prev, path, value)), []);

  /* -- BMI / BSA auto-calc -- */
  const heightCm = parseFloat(examination.general_examination.height_cm);
  const weightKg = parseFloat(examination.general_examination.weight_kg);
  const bmi = heightCm && weightKg ? (weightKg / Math.pow(heightCm / 100, 2)).toFixed(1) : "";
  const bsa = heightCm && weightKg ? Math.sqrt((heightCm * weightKg) / 3600).toFixed(2) : "";

  /* -- call LLM #1: Part A + Part B from conversation -- */
  const handleGenerateCaseHistory = async () => {
    if (!conversationText.trim()) return;
    setProcessingHistory(true);
    setHistoryBanner(null);
    try {
      const res = await fetch(`${API_BASE_URL}hms/users/orchestration/generate-case-history`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ doctor_id: doctorId, patient_id: patientId, conversation: conversationText }),
      });
      const data = await res.json();
      if (data.status === "success") {
        const out = data.finaloutput || {};
        setIsFemale(!!data.is_female);
        setCaseHistory((prev) => deepMerge(prev, out));
        setHistoryBanner({ ok: true, text: "Case history populated from the conversation. Please review the sections below before saving." });
      } else {
        setHistoryBanner({ ok: false, text: "Could not generate case history. Please try again." });
      }
    } catch (e) {
      setHistoryBanner({ ok: false, text: "Request failed. Check connection and try again." });
    } finally {
      setProcessingHistory(false);
    }
  };

  /* -- call LLM #2: Part C from nurse notes only -- */
  const handleGenerateExamination = async () => {
    if (!nurseNotesText.trim()) return;
    setProcessingExam(true);
    setExamBanner(null);
    try {
      const res = await fetch(`${API_BASE_URL}hms/users/orchestration/generate-examination`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ doctor_id: doctorId, patient_id: patientId, nurse_notes: nurseNotesText }),
      });
      const data = await res.json();
      if (data.status === "success") {
        const out = data.finaloutput || {};
        setIsFemale((prev) => prev || !!data.is_female);
        setExamination((prev) => deepMerge(prev, out));
        setExamBanner({ ok: true, text: "Examination details populated from the notes. Please review the sections below before saving." });
      } else {
        setExamBanner({ ok: false, text: "Could not generate examination details. Please try again." });
      }
    } catch (e) {
      setExamBanner({ ok: false, text: "Request failed. Check connection and try again." });
    } finally {
      setProcessingExam(false);
    }
  };

  /* ══════════════════════════════════════════════════════════
     VOICE — PART A (Case History)
     Record -> Diarization endpoint (raw audio -> transcript)
             -> Structure endpoint (transcript -> nurse/patient turns)
             -> populate conversationText
     ══════════════════════════════════════════════════════════ */
  const handleStartRecordingCaseHistory = async () => {
    setHistoryBanner(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mimeType = MediaRecorder.isTypeSupported("audio/webm") ? "audio/webm" : "";
      const recorder = mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream);
      audioChunksCHRef.current = [];

      recorder.ondataavailable = (e) => {
        if (e.data && e.data.size > 0) audioChunksCHRef.current.push(e.data);
      };
      recorder.onstop = () => {
        stream.getTracks().forEach((t) => t.stop());
        const audioBlob = new Blob(audioChunksCHRef.current, { type: recorder.mimeType || "audio/webm" });
        processCaseHistoryVoice(audioBlob);
      };

      recorder.start();
      mediaRecorderCHRef.current = recorder;
      setIsRecordingCaseHistory(true);
    } catch (e) {
      console.error("Microphone access failed:", e);
      setHistoryBanner({ ok: false, text: "Microphone access failed. Please check browser permissions." });
    }
  };

  const handleStopRecordingCaseHistory = () => {
    const recorder = mediaRecorderCHRef.current;
    if (recorder && recorder.state !== "inactive") {
      recorder.stop();
    }
    setIsRecordingCaseHistory(false);
  };

  const processCaseHistoryVoice = async (audioBlob) => {
    setTranscribingCaseHistory(true);
    try {
      const fd = new FormData();
      fd.append("file", audioBlob, "case_history_recording.webm");
      fd.append("language_code", "eng");

      const diarRes = await fetch(DIARIZATION_URL, { method: "POST", body: fd });
      const diarData = await diarRes.json();
      const rawText = diarData?.text || "";

      if (!rawText.trim()) {
        setHistoryBanner({ ok: false, text: "No speech detected in the recording. Please try again." });
        return;
      }

      /* Part A ONLY: pass the transcript into the structure endpoint before
         populating the textarea */
      let finalText = rawText;
      try {
        const structRes = await fetch(STRUCTURE_CONVERSATION_URL, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ conversation_text: rawText }),
        });
        const structData = await structRes.json();
        if (structData?.conversation?.length) {
          finalText = structData.conversation.join("\n");
        }
      } catch (structErr) {
        console.error("Structuring failed, falling back to raw transcript:", structErr);
      }

      setConversationText((prev) => (prev ? `${prev}\n${finalText}` : finalText));
      setHistoryBanner({ ok: true, text: "Voice transcribed and added to the conversation box below." });
    } catch (e) {
      console.error(e);
      setHistoryBanner({ ok: false, text: "Voice processing failed. Please try again." });
    } finally {
      setTranscribingCaseHistory(false);
    }
  };

  /* ══════════════════════════════════════════════════════════
     VOICE — PART C (Examination)
     Record -> Diarization endpoint (raw audio -> transcript) ONLY
             -> populate nurseNotesText directly (NO structure call)
     ══════════════════════════════════════════════════════════ */
  const handleStartRecordingExam = async () => {
    setExamBanner(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mimeType = MediaRecorder.isTypeSupported("audio/webm") ? "audio/webm" : "";
      const recorder = mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream);
      audioChunksExRef.current = [];

      recorder.ondataavailable = (e) => {
        if (e.data && e.data.size > 0) audioChunksExRef.current.push(e.data);
      };
      recorder.onstop = () => {
        stream.getTracks().forEach((t) => t.stop());
        const audioBlob = new Blob(audioChunksExRef.current, { type: recorder.mimeType || "audio/webm" });
        processExamVoice(audioBlob);
      };

      recorder.start();
      mediaRecorderExRef.current = recorder;
      setIsRecordingExam(true);
    } catch (e) {
      console.error("Microphone access failed:", e);
      setExamBanner({ ok: false, text: "Microphone access failed. Please check browser permissions." });
    }
  };

  const handleStopRecordingExam = () => {
    const recorder = mediaRecorderExRef.current;
    if (recorder && recorder.state !== "inactive") {
      recorder.stop();
    }
    setIsRecordingExam(false);
  };

  const processExamVoice = async (audioBlob) => {
    setTranscribingExam(true);
    try {
      const fd = new FormData();
      fd.append("file", audioBlob, "exam_recording.webm");
      fd.append("language_code", "eng");

      const diarRes = await fetch(DIARIZATION_URL, { method: "POST", body: fd });
      const diarData = await diarRes.json();
      const rawText = diarData?.text || "";

      if (!rawText.trim()) {
        setExamBanner({ ok: false, text: "No speech detected in the recording. Please try again." });
        return;
      }

      /* Part C: diarization output ONLY — do NOT call the structure endpoint */
      setNurseNotesText((prev) => (prev ? `${prev}\n${rawText}` : rawText));
      setExamBanner({ ok: true, text: "Voice transcribed and added to the notes box below." });
    } catch (e) {
      console.error(e);
      setExamBanner({ ok: false, text: "Voice processing failed. Please try again." });
    } finally {
      setTranscribingExam(false);
    }
  };

  /* -- save Part A/B/C to the preventive-screening record (upsert by patient_id) -- */
  const handleSave = async () => {
    setSaving(true);
    try {
      const res = await fetch(`${API_BASE_URL}hms/users/data/context/preventive-screening/save`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          doctor_id: doctorId,
          patient_id: patientId,
          appointment_id: appointmentId,
          case_history: caseHistory,
          examination: { ...examination, general_examination: { ...examination.general_examination, bmi, bsa } },
        }),
      });
      return res.ok;
    } catch (e) {
      return false;
    } finally {
      setSaving(false);
    }
  };

  /* -- save ONLY the vitals slice to the dedicated vitals endpoint (/save_patient_vitals) -- */
  const handleSaveVitals = async () => {
    setSavingVitals(true);
    setVitalsBanner(null);

    try {
        const timestamp = new Date().toISOString();
        const vitalsEntry = {
            doctor_id: doctorId,
            height_cm: examination.general_examination.height_cm || null,
            weight_kg: examination.general_examination.weight_kg || null,
            bmi: bmi || null,
            bsa: bsa || null,
            spo2: examination.general_examination.vitals.spo2,
            blood_pressure: examination.general_examination.vitals.blood_pressure,
            others: examination.general_examination.vitals.others,
        };

        const res = await fetch(`${API_BASE_URL}hms/users/data/save_patient_vitals`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                sys_user_id: patientId,
                appointment_id: appointmentId,
                vitals: { [timestamp]: vitalsEntry },
            }),
        });
      if (res.ok) {
        setVitalsBanner({ ok: true, text: "Vitals saved." });
        return true;
      }
      setVitalsBanner({ ok: false, text: "Could not save vitals. Please try again." });
      return false;
    } catch (e) {
      setVitalsBanner({ ok: false, text: "Request failed while saving vitals." });
      return false;
    } finally {
      setSavingVitals(false);
    }
  };

  /* -- ONE button that saves everything: case history + examination + vitals -- */
  const handleSaveAll = async () => {
    setSaveAllBanner(null);
    const [historyOk, vitalsOk] = await Promise.all([handleSave(), handleSaveVitals()]);
    if (historyOk && vitalsOk) {
      setSaveAllBanner({ ok: true, text: "All preventive screening data saved successfully." });
    } else if (historyOk && !vitalsOk) {
      setSaveAllBanner({ ok: false, text: "Case history & examination saved, but vitals failed to save." });
    } else {
      setSaveAllBanner({ ok: false, text: "Saving failed. Please check your connection and try again." });
    }
  };

  /* -- comorbidity row helpers -- */
  const addComorbidityRow = (name) => {
    const rows = caseHistory.history.comorbidities || [];
    if (rows.some((r) => r.name === name)) return;
    setCH("history.comorbidities", [...rows, { name, age_at_onset: "", duration: emptyDuration(), detail: "" }]);
  };
  const removeComorbidityRow = (name) => {
    setCH("history.comorbidities", (caseHistory.history.comorbidities || []).filter((r) => r.name !== name));
  };
  const updateComorbidityRow = (name, field, value) => {
    setCH("history.comorbidities", (caseHistory.history.comorbidities || []).map((r) => (r.name === name ? { ...r, [field]: value } : r)));
  };

  /* -- habit row helpers -- */
  const addHabitRow = (name) => {
    const rows = caseHistory.substance_abuse.habits || [];
    if (rows.some((r) => r.name === name)) return;
    setCH("substance_abuse.habits", [...rows, { name, quantity: "", age_started: "", duration: emptyDuration(), quit: null, age_quit: "", duration_since_quit: emptyDuration(), detail: "" }]);
  };
  const removeHabitRow = (name) => {
    setCH("substance_abuse.habits", (caseHistory.substance_abuse.habits || []).filter((r) => r.name !== name));
  };
  const updateHabitRow = (name, field, value) => {
    setCH("substance_abuse.habits", (caseHistory.substance_abuse.habits || []).map((r) => (r.name === name ? { ...r, [field]: value } : r)));
  };

  /* -- colposcopy image upload (base64) -- */
  /* -- colposcopy image upload (via proxy storage endpoint) -- */
  const handleColposcopyImage = async (file) => {
    if (!file) return;
    setUploadingCervicalImage(true);
    setCervicalImageBanner(null);
    try {
      const fd = new FormData();
      fd.append("doctor_id", doctorId);
      fd.append("patient_id", patientId);
      fd.append("doc_type", "colposcopy");
      fd.append("category", "preventive_screening");
      fd.append("subcategory", "cervical_examination");
      fd.append("file", file);

      const res = await fetch(`${API_BASE_URL}hms/users/cm/storage/proxy/upload-file-url/preventive`, {
        method: "POST",
        body: fd,
      });

      if (!res.ok) {
        setCervicalImageBanner({ ok: false, text: "Image upload failed. Please try again." });
        return;
      }

      const data = await res.json();
      const fileUrl = data.file_url;

      // set as the "current" colposcopy image on the form
      setEX("cervical_examination.colposcopy_image", fileUrl);
      // add to the gallery of all uploaded images for this patient
      setCervicalImages((prev) => [...prev, { patient_id: patientId, file_url: fileUrl, created_at: new Date().toISOString() }]);
      setCervicalImageBanner({ ok: true, text: "Image uploaded." });
    } catch (e) {
      console.error("Colposcopy image upload failed:", e);
      setCervicalImageBanner({ ok: false, text: "Image upload failed. Please try again." });
    } finally {
      setUploadingCervicalImage(false);
    }
  };

  return (
    <div style={F.page}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Open+Sans:wght@300;400;600&display=swap');
        @keyframes pfx-spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
        @keyframes pfx-pulse { 0% { opacity: 1; } 50% { opacity: 0.6; } 100% { opacity: 1; } }
        .pfx-sidebar-item:hover { background: ${T.bgAlt} !important; }
        .pfx-main-tab:hover { border-color: ${T.borderStrong} !important; }
      `}</style>

      <div style={F.topBar}>
        <button style={F.backBtn} onClick={() => navigate(-1)}>
          <ArrowLeft size={16} /> Back
        </button>
        <p style={F.title}>Preventive Oncology Screening</p>
        <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: "0.75rem" }}>
          <input type="checkbox" checked={isFemale} onChange={(e) => setIsFemale(e.target.checked)} />
          Female patient (shows Part B)
        </label>
      </div>

      <div style={F.body}>

        {/* ══════════ TOP-LEVEL TABS: Part A / Part C ══════════ */}
        <div style={F.mainTabBar}>
          {MAIN_TABS.map(({ key, label, sub, icon: Icon }) => (
            <button
              key={key}
              className="pfx-main-tab"
              style={F.mainTab(activeMainTab === key)}
              onClick={() => setActiveMainTab(key)}
            >
              <Icon size={16} />
              <span>
                <div>{label}</div>
                <div style={F.mainTabSub(activeMainTab === key)}>{sub}</div>
              </span>
            </button>
          ))}
        </div>

        {loadingRecord ? (
          <div style={F.loadingWrap}>
            <Loader2 size={16} style={{ animation: "pfx-spin 1s linear infinite" }} />
            Loading saved record for this patient…
          </div>
        ) : activeMainTab === "partA" ? (
          <>
            {/* ── Part A: AI paste box (conversation → Case History Parts A & B) ── */}
            <div style={F.aiBox}>
              <div style={F.aiLabelRow}>
                <span style={F.aiIconBadge}><Sparkles size={14} /></span>
                <span style={F.aiLabel}>Paste patient–nurse conversation</span>
              </div>
              <span style={F.aiSubLabel}>Used to auto-fill Case History — Part A (and Part B, if applicable) below. You can also record the conversation directly with the mic button.</span>

              <div style={{ display: "flex", gap: 24, flexWrap: "wrap", padding: "0.6rem 0 0.9rem", fontSize: "0.78rem", color: T.textSec }}>
                <span><strong>Case No:</strong> {patientId || "—"}</span>
                <span><strong>Name:</strong> {patientInfo.patientName || "—"}</span>
                <span><strong>Age:</strong> {patientInfo.age ?? "—"}</span>
                <span><strong>Sex:</strong> {patientInfo.gender || "—"}</span>
              </div>

              <textarea
                style={F.textarea}
                placeholder="Paste or type the conversation between the nurse and patient here, or use the mic to record it…"
                value={conversationText}
                onChange={(e) => setConversationText(e.target.value)}
              />
              <div style={F.aiBtnRow}>
                <button style={F.aiBtn} onClick={handleGenerateCaseHistory} disabled={processingHistory}>
                  <Sparkles size={14} /> {processingHistory ? "Generating…" : "Generate Case History with AI"}
                </button>
                <button
                  style={isRecordingCaseHistory ? F.micBtnActive : F.micBtn}
                  onClick={isRecordingCaseHistory ? handleStopRecordingCaseHistory : handleStartRecordingCaseHistory}
                  disabled={transcribingCaseHistory}
                >
                  {isRecordingCaseHistory ? <Square size={14} /> : <Mic size={14} />}
                  {isRecordingCaseHistory ? "Stop Recording" : "Record Conversation"}
                </button>
              </div>
              {(isRecordingCaseHistory || transcribingCaseHistory) && (
                <div style={F.voiceStatusText}>
                  {isRecordingCaseHistory && <><HeartPulse size={12} /> Recording… tap "Stop Recording" when done.</>}
                  {transcribingCaseHistory && <><Loader2 size={12} style={{ animation: "pfx-spin 1s linear infinite" }} /> Transcribing and structuring conversation…</>}
                </div>
              )}
              {historyBanner && (
                <div style={{ ...F.banner, borderColor: historyBanner.ok ? T.border : T.bad, color: historyBanner.ok ? T.textSec : T.bad }}>
                  {historyBanner.text}
                </div>
              )}
            </div>

            {/* ── Part A: left-hand section menu + content pane ── */}
            <div style={F.formLayout}>
              <div style={F.formSidebar}>
                <div style={F.formSidebarHeading}>Part A Sections</div>
                {visiblePartASections.map((s) => (
                  <button
                    key={s.key}
                    className="pfx-sidebar-item"
                    style={F.formSidebarItem(activePartASection === s.key)}
                    onClick={() => setActivePartASection(s.key)}
                  >
                    {s.title}
                  </button>
                ))}
              </div>

              {activePartASection === "case_details" && (
                <FormPane title="Case Details">
                  <div style={F.fieldGrid}>
                    <YesNo label="Visit Type" options={VISIT_TYPE_OPTIONS} value={caseHistory.visit_type} onChange={(v) => setCH("visit_type", v)} />
                  </div>
                </FormPane>
              )}

              {activePartASection === "registration" && (
                <FormPane title="Registration">
                  <div style={F.fieldGrid}>
                    <YesNo label="Routine Screening" value={caseHistory.registration.routine_screening} onChange={(v) => setCH("registration.routine_screening", v)} />
                    <YesNo label="Asymptomatic" value={caseHistory.registration.asymptomatic} onChange={(v) => setCH("registration.asymptomatic", v)} />
                    <CheckGroup
                      label="Symptoms" options={SYMPTOM_OPTIONS} selected={caseHistory.registration.symptoms}
                      onChange={(v) => setCH("registration.symptoms", v)}
                      otherDetail={caseHistory.registration.symptoms_other_detail}
                      onOtherDetailChange={(v) => setCH("registration.symptoms_other_detail", v)}
                    />
                    <DurationField label="Duration of symptoms" duration={caseHistory.registration.duration_of_symptoms} onChange={(v) => setCH("registration.duration_of_symptoms", v)} />
                  </div>
                </FormPane>
              )}

              {activePartASection === "history" && (
                <FormPane title="History (Co-morbidities)">
                  <div style={F.fieldGrid}>
                    <YesNo label="Co-morbidities present" options={["Yes", "No", "Unknown"]} value={caseHistory.history.comorbidities_present} onChange={(v) => setCH("history.comorbidities_present", v)} />
                  </div>
                  {caseHistory.history.comorbidities_present === "Yes" && (
                    <>
                      <div style={{ ...F.checkGrid, marginTop: 12 }}>
                        {COMORBIDITY_OPTIONS.map((opt) => (
                          <label key={opt} style={F.checkLabel}>
                            <input
                              type="checkbox"
                              checked={(caseHistory.history.comorbidities || []).some((r) => r.name === opt)}
                              onChange={(e) => (e.target.checked ? addComorbidityRow(opt) : removeComorbidityRow(opt))}
                            />
                            {opt}
                          </label>
                        ))}
                      </div>
                      {(caseHistory.history.comorbidities || []).length > 0 && (
                        <table style={F.subTable}>
                          <thead><tr><th style={F.th}>Name</th><th style={F.th}>Age at Onset</th><th style={F.th}>Duration</th>{(caseHistory.history.comorbidities || []).some(r => r.name === "Others") && <th style={F.th}>Specify</th>}</tr></thead>
                          <tbody>
                            {caseHistory.history.comorbidities.map((row) => (
                              <tr key={row.name}>
                                <td style={F.td}>{row.name}</td>
                                <td style={F.td}><input style={F.input} type="number" value={row.age_at_onset ?? ""} onChange={(e) => updateComorbidityRow(row.name, "age_at_onset", e.target.value)} /></td>
                                <td style={F.td}><DurationField label="" duration={row.duration} onChange={(v) => updateComorbidityRow(row.name, "duration", v)} /></td>
                                {row.name === "Others" && (
                                  <td style={F.td}><input style={F.input} placeholder="Please specify…" value={row.detail ?? ""} onChange={(e) => updateComorbidityRow(row.name, "detail", e.target.value)} /></td>
                                )}
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      )}
                    </>
                  )}
                  <div style={{ marginTop: 12 }}>
                    <TextArea label="Remarks" value={caseHistory.history.remarks} onChange={(v) => setCH("history.remarks", v)} />
                  </div>
                </FormPane>
              )}

              {activePartASection === "family_history" && (
                <FormPane title="Family History">
                  <div style={F.fieldGrid}>
                    <YesNo label="Family history of cancer" options={["Yes", "No", "Unknown"]} value={caseHistory.family_history.family_history_of_cancer} onChange={(v) => setCH("family_history.family_history_of_cancer", v)} />
                    {caseHistory.family_history.family_history_of_cancer === "Yes" && (
                      <>
                        <TextField label="Relation with patient" value={caseHistory.family_history.relation_with_patient} onChange={(v) => setCH("family_history.relation_with_patient", v)} />
                        <TextField label="Cancer Site" value={caseHistory.family_history.cancer_site} onChange={(v) => setCH("family_history.cancer_site", v)} />
                        <TextField label="Laterality" value={caseHistory.family_history.laterality} onChange={(v) => setCH("family_history.laterality", v)} />
                        <TextField label="Age at onset (years)" type="number" value={caseHistory.family_history.age_at_onset} onChange={(v) => setCH("family_history.age_at_onset", v)} />
                        <TextField label="Duration (months/years)" value={caseHistory.family_history.duration_months_years} onChange={(v) => setCH("family_history.duration_months_years", v)} />
                        <SelectField label="Status" options={["Death", "Disease free", "Palliative Care", "Others"]} value={caseHistory.family_history.status} onChange={(v) => setCH("family_history.status", v)} />
                      </>
                    )}
                  </div>
                </FormPane>
              )}

              {activePartASection === "substance_abuse" && (
                <FormPane title="Substance Abuse History">
                  <div style={F.fieldGrid}>
                    <YesNo label="Substance abuse history" options={["Yes", "No", "Unknown"]} value={caseHistory.substance_abuse.substance_abuse_history} onChange={(v) => setCH("substance_abuse.substance_abuse_history", v)} />
                  </div>
                  {caseHistory.substance_abuse.substance_abuse_history === "Yes" && (
                    <>
                      <div style={{ ...F.checkGrid, marginTop: 12 }}>
                        {HABIT_OPTIONS.map((opt) => (
                          <label key={opt} style={F.checkLabel}>
                            <input
                              type="checkbox"
                              checked={(caseHistory.substance_abuse.habits || []).some((r) => r.name === opt)}
                              onChange={(e) => (e.target.checked ? addHabitRow(opt) : removeHabitRow(opt))}
                            />
                            {opt}
                          </label>
                        ))}
                      </div>
                      {(caseHistory.substance_abuse.habits || []).map((row) => (
                        <div key={row.name} style={{ border: `1px solid ${T.border}`, padding: 10, marginTop: 10, borderRadius: 4 }}>
                          <strong style={{ fontSize: "0.78rem" }}>{row.name}</strong>
                          <div style={{ ...F.fieldGrid, marginTop: 8 }}>
                            <TextField label="Quantity" value={row.quantity} onChange={(v) => updateHabitRow(row.name, "quantity", v)} />
                            <TextField label="Age when habit started" type="number" value={row.age_started} onChange={(v) => updateHabitRow(row.name, "age_started", v)} />
                            <DurationField label="Duration" duration={row.duration} onChange={(v) => updateHabitRow(row.name, "duration", v)} />
                            <YesNo label="Has the patient quit" value={row.quit} onChange={(v) => updateHabitRow(row.name, "quit", v)} />
                            {row.quit === "Yes" && (
                              <>
                                <TextField label="Age when quit" type="number" value={row.age_quit} onChange={(v) => updateHabitRow(row.name, "age_quit", v)} />
                                <DurationField label="Duration since quit" duration={row.duration_since_quit} onChange={(v) => updateHabitRow(row.name, "duration_since_quit", v)} />
                              </>
                            )}
                            {row.name === "Others" && (
                              <TextField label="Please specify" value={row.detail} onChange={(v) => updateHabitRow(row.name, "detail", v)} />
                            )}
                          </div>
                        </div>
                      ))}
                    </>
                  )}
                  <div style={{ ...F.fieldGrid, marginTop: 12 }}>
                    <TextField label="Occupational exposure to known carcinogens" value={caseHistory.substance_abuse.occupational_exposure} onChange={(v) => setCH("substance_abuse.occupational_exposure", v)} />
                    <TextArea label="Remarks" value={caseHistory.substance_abuse.remarks} onChange={(v) => setCH("substance_abuse.remarks", v)} />
                  </div>
                </FormPane>
              )}

              {activePartASection === "previous_cancer" && (
                <FormPane title="History of Previous Cancer">
                  <div style={F.fieldGrid}>
                    <YesNo label="History of previous cancer" options={["Yes", "No", "Unknown"]} value={caseHistory.previous_cancer.history_of_previous_cancer} onChange={(v) => setCH("previous_cancer.history_of_previous_cancer", v)} />
                    {caseHistory.previous_cancer.history_of_previous_cancer === "Yes" && (
                      <>
                        <TextField label="Diagnosis" value={caseHistory.previous_cancer.diagnosis} onChange={(v) => setCH("previous_cancer.diagnosis", v)} />
                        <TextField label="Cancer site" value={caseHistory.previous_cancer.cancer_site} onChange={(v) => setCH("previous_cancer.cancer_site", v)} />
                        <TextField label="Stage at diagnosis" value={caseHistory.previous_cancer.stage_at_diagnosis} onChange={(v) => setCH("previous_cancer.stage_at_diagnosis", v)} />
                        <CheckGroup label="Type of treatment" options={TREATMENT_OPTIONS} selected={caseHistory.previous_cancer.type_of_treatment} onChange={(v) => setCH("previous_cancer.type_of_treatment", v)} />
                        <TextArea label="Remarks" value={caseHistory.previous_cancer.remarks} onChange={(v) => setCH("previous_cancer.remarks", v)} />
                      </>
                    )}
                  </div>
                </FormPane>
              )}

              {isFemale && activePartASection === "menstrual_history" && (
                <FormPane title="Part B — Menstrual History">
                  <div style={F.fieldGrid}>
                    <YesNo label="Menstrual history" options={["Yes", "No", "Unknown"]} value={caseHistory.menstrual_history.menstrual_history} onChange={(v) => setCH("menstrual_history.menstrual_history", v)} />
                    <SelectField label="Menopause status" options={["Pre Menarchal", "Pre-Menopausal", "Peri Menopausal", "Post Menopausal"]} value={caseHistory.menstrual_history.menopause_status} onChange={(v) => setCH("menstrual_history.menopause_status", v)} />
                    <TextField label="LMP Date" type="date" value={caseHistory.menstrual_history.lmp_date} onChange={(v) => setCH("menstrual_history.lmp_date", v)} />
                    <SelectField label="Marital status" options={["Married", "Unmarried", "Separated", "Divorced"]} value={caseHistory.menstrual_history.marital_status} onChange={(v) => setCH("menstrual_history.marital_status", v)} />
                    <TextField label="Age at marriage" type="number" value={caseHistory.menstrual_history.age_at_marriage} onChange={(v) => setCH("menstrual_history.age_at_marriage", v)} />
                    <YesNo label="Hysterectomy done" value={caseHistory.menstrual_history.hysterectomy_done} onChange={(v) => setCH("menstrual_history.hysterectomy_done", v)} />
                    {caseHistory.menstrual_history.hysterectomy_done === "Yes" && (
                      <>
                        <TextField label="Indications for hysterectomy" value={caseHistory.menstrual_history.indications_for_hysterectomy} onChange={(v) => setCH("menstrual_history.indications_for_hysterectomy", v)} />
                        <TextField label="Age at hysterectomy" type="number" value={caseHistory.menstrual_history.age_at_hysterectomy} onChange={(v) => setCH("menstrual_history.age_at_hysterectomy", v)} />
                      </>
                    )}
                  </div>
                </FormPane>
              )}

              {isFemale && activePartASection === "obstetric_history" && (
                <FormPane title="Part B — Obstetric History">
                  <div style={F.fieldGrid}>
                    <YesNo label="Obstetric history" options={["Yes", "No", "Unknown"]} value={caseHistory.obstetric_history.obstetric_history} onChange={(v) => setCH("obstetric_history.obstetric_history", v)} />
                    {caseHistory.obstetric_history.obstetric_history === "Yes" && (
                      <>
                        <TextField label="Gravida" value={caseHistory.obstetric_history.gravida} onChange={(v) => setCH("obstetric_history.gravida", v)} />
                        <TextField label="Para" value={caseHistory.obstetric_history.para} onChange={(v) => setCH("obstetric_history.para", v)} />
                        <TextField label="Abortion" type="number" value={caseHistory.obstetric_history.abortion} onChange={(v) => setCH("obstetric_history.abortion", v)} />
                        <TextField label="Living children" type="number" value={caseHistory.obstetric_history.living_children} onChange={(v) => setCH("obstetric_history.living_children", v)} />
                        <TextField label="Normal delivery" type="number" value={caseHistory.obstetric_history.normal_delivery} onChange={(v) => setCH("obstetric_history.normal_delivery", v)} />
                        <TextField label="Caesarean section" type="number" value={caseHistory.obstetric_history.caesarean_section} onChange={(v) => setCH("obstetric_history.caesarean_section", v)} />
                        <TextField label="No. of dead children" type="number" value={caseHistory.obstetric_history.dead_children} onChange={(v) => setCH("obstetric_history.dead_children", v)} />
                        <TextField label="No. of still births" type="number" value={caseHistory.obstetric_history.still_births} onChange={(v) => setCH("obstetric_history.still_births", v)} />
                        <YesNo label="Ever breastfed?" value={caseHistory.obstetric_history.breastfed} onChange={(v) => setCH("obstetric_history.breastfed", v)} />
                        {caseHistory.obstetric_history.breastfed === "Yes" && (
                          <TextField label="Duration of breastfeeding (months)" type="number" value={caseHistory.obstetric_history.breastfeeding_duration_months} onChange={(v) => setCH("obstetric_history.breastfeeding_duration_months", v)} />
                        )}
                      </>
                    )}
                  </div>
                </FormPane>
              )}

              {isFemale && activePartASection === "contraceptive_history" && (
                <FormPane title="Part B — Contraceptive History">
                  <div style={F.fieldGrid}>
                    <YesNo label="Contraceptives" options={["Yes", "No", "Unknown"]} value={caseHistory.contraceptive_history.contraceptives} onChange={(v) => setCH("contraceptive_history.contraceptives", v)} />
                    {caseHistory.contraceptive_history.contraceptives === "Yes" && (
                      <>
                        <CheckGroup
                          label="Contraceptive type" options={CONTRACEPTIVE_OPTIONS} selected={caseHistory.contraceptive_history.contraceptive_type}
                          onChange={(v) => setCH("contraceptive_history.contraceptive_type", v)}
                          otherDetail={caseHistory.contraceptive_history.contraceptive_type_other_detail}
                          onOtherDetailChange={(v) => setCH("contraceptive_history.contraceptive_type_other_detail", v)}
                        />
                        <TextField label="Duration of contraceptive" value={caseHistory.contraceptive_history.duration_of_contraceptive} onChange={(v) => setCH("contraceptive_history.duration_of_contraceptive", v)} />
                        <TextArea label="Remarks" value={caseHistory.contraceptive_history.remarks} onChange={(v) => setCH("contraceptive_history.remarks", v)} />
                      </>
                    )}
                  </div>
                </FormPane>
              )}

              {isFemale && activePartASection === "hrt_history" && (
                <FormPane title="Part B — Hormone Replacement Therapy History">
                  <div style={F.fieldGrid}>
                    <YesNo label="HRT history" options={["Yes", "No", "Unknown"]} value={caseHistory.hrt_history.hrt_history} onChange={(v) => setCH("hrt_history.hrt_history", v)} />
                    {caseHistory.hrt_history.hrt_history === "Yes" && (
                      <>
                        <SelectField label="Type of therapy" options={["Oestrogen only", "Oestrogen-Progestogen Sequential", "Oestrogen-Progestogen Continuous Combined", "Tibolone", "SERMs"]} value={caseHistory.hrt_history.type_of_therapy} onChange={(v) => setCH("hrt_history.type_of_therapy", v)} />
                        <TextField label="From date" type="date" value={caseHistory.hrt_history.from_date} onChange={(v) => setCH("hrt_history.from_date", v)} />
                        <TextField label="Route of administration" value={caseHistory.hrt_history.route_of_administration} onChange={(v) => setCH("hrt_history.route_of_administration", v)} />
                        <TextArea label="Remarks" value={caseHistory.hrt_history.remarks} onChange={(v) => setCH("hrt_history.remarks", v)} />
                      </>
                    )}
                  </div>
                </FormPane>
              )}
            </div>
          </>
        ) : (
          <>
            {/* ── Part C: AI paste box (nurse notes → Examination Details) ── */}
            <div style={F.aiBox}>
              <div style={F.aiLabelRow}>
                <span style={F.aiIconBadge}><Sparkles size={14} /></span>
                <span style={F.aiLabel}>Paste nurse examination notes</span>
              </div>
              <span style={F.aiSubLabel}>Used to auto-fill Examination Details — Part C below. You can also record the dictation directly with the mic button (transcript only, not structured).</span>
              <textarea
                style={F.textarea}
                placeholder="Paste or type the nurse's examination dictation here, or use the mic to record it…"
                value={nurseNotesText}
                onChange={(e) => setNurseNotesText(e.target.value)}
              />
              <div style={F.aiBtnRow}>
                <button style={F.aiBtn} onClick={handleGenerateExamination} disabled={processingExam}>
                  <Sparkles size={14} /> {processingExam ? "Generating…" : "Generate Examination Details with AI"}
                </button>
                <button
                  style={isRecordingExam ? F.micBtnActive : F.micBtn}
                  onClick={isRecordingExam ? handleStopRecordingExam : handleStartRecordingExam}
                  disabled={transcribingExam}
                >
                  {isRecordingExam ? <Square size={14} /> : <Mic size={14} />}
                  {isRecordingExam ? "Stop Recording" : "Record Dictation"}
                </button>
              </div>
              {(isRecordingExam || transcribingExam) && (
                <div style={F.voiceStatusText}>
                  {isRecordingExam && <><HeartPulse size={12} /> Recording… tap "Stop Recording" when done.</>}
                  {transcribingExam && <><Loader2 size={12} style={{ animation: "pfx-spin 1s linear infinite" }} /> Transcribing dictation…</>}
                </div>
              )}
              {examBanner && (
                <div style={{ ...F.banner, borderColor: examBanner.ok ? T.border : T.bad, color: examBanner.ok ? T.textSec : T.bad }}>
                  {examBanner.text}
                </div>
              )}
            </div>

            {/* ── Part C: left-hand section menu + content pane ── */}
            <div style={F.formLayout}>
              <div style={F.formSidebar}>
                <div style={F.formSidebarHeading}>Part C Sections</div>
                {visiblePartCSections.map((s) => (
                  <button
                    key={s.key}
                    className="pfx-sidebar-item"
                    style={F.formSidebarItem(activePartCSection === s.key)}
                    onClick={() => setActivePartCSection(s.key)}
                  >
                    {s.title}
                  </button>
                ))}
              </div>

              {activePartCSection === "general_examination" && (
                <FormPane title="General Examination">
                  <div style={F.fieldGrid}>
                    <TextField label="Height (cm)" type="number" value={examination.general_examination.height_cm} onChange={(v) => setEX("general_examination.height_cm", v)} />
                    <TextField label="Weight (kg)" type="number" value={examination.general_examination.weight_kg} onChange={(v) => setEX("general_examination.weight_kg", v)} />
                    <TextField label="BMI (auto)" value={bmi} onChange={() => {}} />
                    <TextField label="BSA sq.m (auto)" value={bsa} onChange={() => {}} />
                  </div>

                  <div style={{ marginTop: 16 }}>
                    <span style={F.fieldLabel}>Vitals</span>
                    <div style={F.vitalsCard}>
                      <VitalRow label="SpO2" item={examination.general_examination.vitals.spo2} onChange={(v) => setEX("general_examination.vitals.spo2", v)} placeholder="e.g. 98%" />
                      <VitalRow label="Blood Pressure" item={examination.general_examination.vitals.blood_pressure} onChange={(v) => setEX("general_examination.vitals.blood_pressure", v)} placeholder="e.g. 120/80 mmHg" />
                      <OtherVitalsBlock
                        items={examination.general_examination.vitals.others}
                        onChange={(v) => setEX("general_examination.vitals.others", v)}
                      />
                    </div>
                    <div style={{ marginTop: 10, display: "flex", alignItems: "center", gap: 10 }}>
                      <button style={F.saveBtnSecondary} onClick={handleSaveVitals} disabled={savingVitals}>
                        <HeartPulse size={14} /> {savingVitals ? "Saving Vitals…" : "Save Vitals Only"}
                      </button>
                      {vitalsBanner && (
                        <span style={{ fontSize: "0.72rem", color: vitalsBanner.ok ? T.good : T.bad }}>{vitalsBanner.text}</span>
                      )}
                    </div>
                  </div>

                  <div style={{ ...F.fieldGrid, marginTop: 16 }}>
                    <CheckGroup label="General examination findings" options={GEN_EXAM_OPTIONS} selected={examination.general_examination.findings} onChange={(v) => setEX("general_examination.findings", v)} />
                    <TextField label="Nutrition" value={examination.general_examination.nutrition} onChange={(v) => setEX("general_examination.nutrition", v)} />
                    <TextField label="Hydration" value={examination.general_examination.hydration} onChange={(v) => setEX("general_examination.hydration", v)} />
                    <TextArea label="Mouth & oral cavity findings (lips/tongue/teeth/gums/buccal mucosa)" value={examination.general_examination.oral_cavity_findings} onChange={(v) => setEX("general_examination.oral_cavity_findings", v)} />
                    <TextField label="Dental hygiene" value={examination.general_examination.dental_hygiene} onChange={(v) => setEX("general_examination.dental_hygiene", v)} />
                    <TextField label="Mouth opening (cm)" type="number" value={examination.general_examination.mouth_opening_cm} onChange={(v) => setEX("general_examination.mouth_opening_cm", v)} />
                  </div>
                </FormPane>
              )}

              {isFemale && activePartCSection === "breast_examination" && (
                <FormPane title="Breast Examination Findings">
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "1.5rem" }}>
                    {["left", "right"].map((side) => (
                      <div key={side}>
                        <strong style={{ fontSize: "0.78rem", textTransform: "capitalize" }}>{side}</strong>
                        <div style={{ ...F.fieldGrid, gridTemplateColumns: "1fr", marginTop: 8 }}>
                          <YesNo label="Signs of breast surgery" value={examination.breast_examination[side].signs_of_surgery} onChange={(v) => setEX(`breast_examination.${side}.signs_of_surgery`, v)} />
                          <SelectField
                            label="Axilla" options={AXILLA_OPTIONS} value={examination.breast_examination[side].axilla}
                            onChange={(v) => setEX(`breast_examination.${side}.axilla`, v)}
                            otherDetail={examination.breast_examination[side].axilla_other_detail}
                            onOtherDetailChange={(v) => setEX(`breast_examination.${side}.axilla_other_detail`, v)}
                          />
                          <TextField label="Palpation" value={examination.breast_examination[side].palpation} onChange={(v) => setEX(`breast_examination.${side}.palpation`, v)} />
                          <TextField label="Nipple discharge" value={examination.breast_examination[side].nipple_discharge} onChange={(v) => setEX(`breast_examination.${side}.nipple_discharge`, v)} />
                          <TextField label="Nipple retraction" value={examination.breast_examination[side].nipple_retraction} onChange={(v) => setEX(`breast_examination.${side}.nipple_retraction`, v)} />
                          <TextField label="Other significant findings" value={examination.breast_examination[side].other_findings} onChange={(v) => setEX(`breast_examination.${side}.other_findings`, v)} />
                        </div>
                      </div>
                    ))}
                  </div>
                </FormPane>
              )}

              {isFemale && activePartCSection === "cervical_examination" && (
                <FormPane title="Cervical Examination Findings">
                  <div style={F.fieldGrid}>
                    <SelectField label="VIA" options={["Positive", "Negative", "Inconclusive"]} value={examination.cervical_examination.via} onChange={(v) => setEX("cervical_examination.via", v)} />
                    <TextField label="VILI" value={examination.cervical_examination.vili} onChange={(v) => setEX("cervical_examination.vili", v)} />
                    <TextField label="Colposcopy (notes)" value={examination.cervical_examination.colposcopy} onChange={(v) => setEX("cervical_examination.colposcopy", v)} />
                    <div style={{ gridColumn: "1 / -1" }}>
                      <span style={F.fieldLabel}>Colposcopy — diagram / image</span>
                      <input
                        type="file"
                        accept="image/*"
                        onChange={(e) => handleColposcopyImage(e.target.files?.[0])}
                        disabled={uploadingCervicalImage}
                      />
                      {uploadingCervicalImage && (
                        <div style={F.voiceStatusText}>
                          <Loader2 size={12} style={{ animation: "pfx-spin 1s linear infinite" }} /> Uploading image…
                        </div>
                      )}
                      {cervicalImageBanner && (
                        <div style={{ ...F.banner, borderColor: cervicalImageBanner.ok ? T.border : T.bad, color: cervicalImageBanner.ok ? T.textSec : T.bad }}>
                          {cervicalImageBanner.text}
                        </div>
                      )}

                      {cervicalImages.length > 0 && (
                        <div style={{ display: "flex", flexWrap: "wrap", gap: 10, marginTop: 12 }}>
                          {cervicalImages.map((img, idx) => (
                            <div key={img.file_url || idx} style={{ position: "relative" }}>
                              <img
                                src={img.file_url}
                                alt={`Colposcopy ${idx + 1}`}
                                style={{
                                  ...F.thumb,
                                  cursor: "pointer",
                                  outline: examination.cervical_examination.colposcopy_image === img.file_url ? `2px solid ${T.text}` : "none",
                                }}
                                onClick={() => setPreviewImageUrl(img.file_url)}
                              />
                              <button
                                type="button"
                                style={{ ...F.smallBtn, marginTop: 4, width: "100%", justifyContent: "center" }}
                                onClick={() => setEX("cervical_examination.colposcopy_image", img.file_url)}
                              >
                                {examination.cervical_examination.colposcopy_image === img.file_url ? "Selected ✓" : "Use as current"}
                              </button>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                    <SelectField
                      label="Impression" options={IMPRESSION_OPTIONS} value={examination.cervical_examination.impression}
                      onChange={(v) => setEX("cervical_examination.impression", v)}
                      otherDetail={examination.cervical_examination.impression_other_detail}
                      onOtherDetailChange={(v) => setEX("cervical_examination.impression_other_detail", v)}
                    />
                    <TextArea label="Remarks" value={examination.cervical_examination.remarks} onChange={(v) => setEX("cervical_examination.remarks", v)} />
                  </div>
                </FormPane>
              )}

              {activePartCSection === "investigations_advised" && (
                <FormPane title="Investigations Advised">
                  <div style={{ marginTop: "-1rem" }}>
                    <LabInvestigations
                      patientId={patientId}
                      doctorId={doctorId}
                      currentBookingId={appointmentId}
                      department="preventive"
                    />
                  </div>
                </FormPane>
              )}

              {activePartCSection === "prescription_followup" && (
                <div style={{ display: "flex", flexDirection: "column", gap: "1.5rem" }}>
                  <FormPane title="Prescription & Follow-up">
                    <div style={F.fieldGrid}>
                      <TextArea label="Prescription" value={examination.prescription} onChange={(v) => setEX("prescription", v)} />
                      <TextField label="Tobacco cessation — details" value={examination.follow_up_advise.tobacco_cessation_details} onChange={(v) => setEX("follow_up_advise.tobacco_cessation_details", v)} />
                      <TextField label="Lifestyle modification advice — details" value={examination.follow_up_advise.lifestyle_modification_details} onChange={(v) => setEX("follow_up_advise.lifestyle_modification_details", v)} />
                      <TextField label="Other follow-up advice" value={examination.follow_up_advise.others} onChange={(v) => setEX("follow_up_advise.others", v)} />
                      <SelectField label="Follow-up visit — Oral" options={["After 3 months", "After 6 months", "After 1 year"]} value={examination.follow_up_visit.oral} onChange={(v) => setEX("follow_up_visit.oral", v)} />
                      <SelectField label="Follow-up visit — Breast" options={["After 3 months", "After 6 months", "After 1 year", "After 2 years"]} value={examination.follow_up_visit.breast} onChange={(v) => setEX("follow_up_visit.breast", v)} />
                      <SelectField label="Follow-up visit — Cervical" options={["After 3 months", "After 6 months", "After 1 year", "After 2 years"]} value={examination.follow_up_visit.cervical} onChange={(v) => setEX("follow_up_visit.cervical", v)} />
                    </div>
                  </FormPane>

                  <FormPane title="Patient Referrals">
                    <PatientReferralsTab
                      patientId={patientId}
                      doctorId={doctorId}
                      doctorName={doctorName}
                      hospitalId={hospitalId}
                    />
                  </FormPane>
                </div>
              )}
            </div>
          </>
        )}

      </div>

      <div style={F.saveBar}>
        {saveAllBanner && (
          <span style={{ fontSize: "0.75rem", color: saveAllBanner.ok ? T.good : T.bad, marginRight: "auto" }}>{saveAllBanner.text}</span>
        )}
        <button style={F.saveBtn} onClick={handleSaveAll} disabled={saving || savingVitals}>
          <Save size={15} /> {saving || savingVitals ? "Saving…" : "Save All"}
        </button>
      </div>

      {/* ── image preview popup / lightbox ── */}
      {previewImageUrl && (
        <div style={F.modalOverlay} onClick={() => setPreviewImageUrl(null)}>
          <button style={F.modalCloseBtn} onClick={() => setPreviewImageUrl(null)} title="Close">
            <X size={18} />
          </button>
          <img
            src={previewImageUrl}
            alt="Colposcopy full view"
            style={F.modalImage}
            onClick={(e) => e.stopPropagation()}
          />
        </div>
      )}
    </div>
  );
}