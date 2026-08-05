import React, { useState, useRef, useEffect, useCallback } from "react";
import { Box, Typography } from "@mui/material";
import {
  LocalHospital,
  SaveRounded,
  CheckCircleRounded,
  AutoAwesomeRounded,
  RefreshRounded,
} from "@mui/icons-material";

// If your history table component lives at a different path, update this import.
import PainManagementHistoryTables from "./PainManagementHistoryTables";
import { getCompletedInvestigationDocuments, CompletedInvestigationsTable } from "./LabInvestigations";
import { getDoctorInfo } from "./shared/api";

/**
 * PainManagementNewFollowUp
 * ------------------------------------------------------------------
 * NCG-KCDO Pain Management — New OR Follow Up form (never both).
 *
 * On mount, checks whether the patient already has prior Pain
 * Management records via the existing history endpoint:
 *   GET {API}hms/users/data/context/pain-management/history/{patientId}/{doctorId}
 *
 *   - No prior records  -> defaults to the New form.
 *   - Has prior records  -> defaults to the Follow Up form (previous
 *                           visit data + AI summary shown above it).
 *
 * The doctor can still manually switch between New and Follow Up via
 * the "Visit Type" toggle in the header — this overrides the
 * auto-detected default (e.g. to correct a wrong guess, or to log a
 * fresh "New" assessment for a patient who does have prior records).
 * Switching does NOT discard anything: New-form and Follow-Up-form
 * data are held in separate state, so toggling back and forth is safe.
 *
 * Saves via `onSave(payload)` passed from DoctorDashboard.
 * payload = { doctor_id, patient_id, formType: 'new' | 'follow_up',
 *             newForm | followUpForm, saved_at }
 * NOTE: confirm this shape matches your save endpoint — happy to
 * adjust once you share it.
 * ------------------------------------------------------------------
 */

// ─── Design tokens & Components ──────────────────────────────────────────
import { 
  C, FONT, FW_LIGHT, FW_NORMAL, FW_BOLD,
  saveBtnSx, outlineBtnSx, inputStyle
} from "./shared/designTokens";
import { 
  SectionBox, FieldLabel, TextInput, CbxGroup, RdoGroup, FG
} from "./shared/FormComponents";

const os = (extra = {}) => ({ fontFamily: FONT, fontWeight: FW_LIGHT, ...extra });

const severityStyle = (level) => {
  if (level === "critical" || level === "high") return { background: C.black, color: C.white, px: 1, py: 0.25, fontSize: 11, fontWeight: FW_BOLD, borderRadius: "2px" };
  if (level === "moderate") return { background: C.textSecond, color: C.white, px: 1, py: 0.25, fontSize: 11, fontWeight: FW_BOLD, borderRadius: "2px" };
  if (level === "low") return { background: C.border, color: C.textPrimary, px: 1, py: 0.25, fontSize: 11, fontWeight: FW_BOLD, borderRadius: "2px" };
  return { background: C.bgSecondary, color: C.textMuted, px: 1, py: 0.25, fontSize: 11, fontWeight: FW_BOLD, borderRadius: "2px" };
};

const SubSectionHeader = ({ title }) => (
  <Typography sx={{ 
    fontSize: 12, fontWeight: FW_BOLD, color: C.textSecond, 
    textTransform: "uppercase", letterSpacing: "0.08em",
    mt: 3, mb: 2, borderBottom: `1px dashed ${C.border}`, pb: 0.5 
  }}>
    {title}
  </Typography>
);

const API_BASE_URL = import.meta.env.VITE_BACKEND_URL;
const TRANSCRIBE_URL = `${API_BASE_URL}hms/users/ai/elevenlabs/api/transcribe_labs`;
const EXTRACT_URL = `${API_BASE_URL}hms/users/data/context/pain-management/extract-fields`;
const PATIENT_DETAILS_URL = (patientId, doctorId) =>
  `${API_BASE_URL}hms/users/data/context/pain-management/patient-details/${patientId}/${doctorId}`;
const HISTORY_URL = (patientId, doctorId) =>
  `${API_BASE_URL}hms/users/data/context/pain-management/history/${patientId}/${doctorId}`;
// Patient documents (imaging / lab reports, etc.) — same feed shown in the
// "Text Health"-style document viewer. Only needs the patientId.
const DOCUMENTS_URL = (patientId) =>
  `${API_BASE_URL}hms/users/data/context/th/patient/${patientId}`;

// Modality keywords used to decide whether a document is an "imaging report".
// Matched case-insensitively against file_name / og_file_name / raw_markdown.
const IMAGING_KEYWORDS = [
  "CT", "MRI", "USG", "PET", "X-RAY", "XRAY", "BONE SCAN", "ULTRASOUND", "PET-CT", "PET CT",
];

const isImagingReport = (doc) => {
  const haystack = `${doc.file_name || ""} ${doc.og_file_name || ""} ${doc.raw_markdown || ""}`.toUpperCase();
  return IMAGING_KEYWORDS.some((kw) => haystack.includes(kw));
};

// Only these keys get auto-filled from dictation (Pain Characteristics + Quality of Life)
const PAIN_CHAR_QOL_KEYS = [
  "site", "radiatesTo", "referredTo", "typeOfPain", "distribution", "course", "pattern",
  "painScore", "duration", "btpEpisodes", "relieving", "aggravating", "pathophysiology",
  "painSyndrome", "painDiagnosis", "diagnosisMadeBy", "affect", "perfScaleType", "perfStatus",
];

// ─── Generic field primitives ────────────────────────────────────────────
const DateInput = ({ label, value, onChange }) => (
  <TextInput type="date" label={label} value={value} onChange={onChange} />
);

const DropdownSelect = ({ label, value, onChange, options, placeholder = "Select..." }) => (
  <Box sx={{ display: "flex", flexDirection: "column", gap: 0.5 }}>
    <FieldLabel>{label}</FieldLabel>
    <select
      value={value ?? ""}
      onChange={(e) => onChange(e.target.value)}
      style={{
        ...inputStyle,
        width: "100%",
        padding: "8px 12px",
        borderRadius: "4px",
        border: `1px solid ${C.border}`,
        backgroundColor: C.white,
        fontSize: "12px",
        fontFamily: FONT,
        color: C.textPrimary,
        cursor: "pointer",
        outline: "none",
        boxSizing: "border-box",
      }}
    >
      <option value="">{placeholder}</option>
      {options.map((opt) => {
        const val = typeof opt === "object" ? opt.value : opt;
        const lbl = typeof opt === "object" ? opt.label : opt;
        return (
          <option key={val} value={val}>
            {lbl}
          </option>
        );
      })}
    </select>
  </Box>
);

/**
 * Chip / Pill selector for multi-select options (checkboxes).
 * Displays options as styled interactive pill buttons with clear spacing and active fill states.
 */
const CbxPillGroup = ({ label, options, value = [], onChange }) => {
  const selectedList = Array.isArray(value) ? value : [];

  const toggleOption = (opt) => {
    if (selectedList.includes(opt)) {
      onChange(selectedList.filter((item) => item !== opt));
    } else {
      onChange([...selectedList, opt]);
    }
  };

  return (
    <Box sx={{ mb: 2.5 }}>
      {label && <FieldLabel>{label}</FieldLabel>}
      <Box sx={{ display: "flex", flexWrap: "wrap", gap: 1, mt: 0.75 }}>
        {options.map((opt) => {
          const isSelected = selectedList.includes(opt);
          return (
            <Box
              key={opt}
              component="button"
              type="button"
              onClick={() => toggleOption(opt)}
              sx={{
                px: 1.75,
                py: 0.65,
                fontSize: 12,
                fontFamily: FONT,
                fontWeight: isSelected ? FW_BOLD : FW_NORMAL,
                borderRadius: "20px",
                cursor: "pointer",
                border: `1px solid ${isSelected ? C.black : C.border}`,
                background: isSelected ? C.black : C.white,
                color: isSelected ? C.white : C.textPrimary,
                boxShadow: isSelected ? "0 2px 4px rgba(0,0,0,0.12)" : "none",
                transition: "all 0.15s ease-in-out",
                "&:hover": {
                  borderColor: C.black,
                  background: isSelected ? C.black : C.bgSecondary,
                },
              }}
            >
              {opt}
            </Box>
          );
        })}
      </Box>
    </Box>
  );
};

/**
 * Chip / Pill selector for single-select options (radio buttons).
 * Displays options as styled interactive pill buttons with active fill states.
 */
const RdoPillGroup = ({ label, options, value, onChange, direction = "row" }) => {
  return (
    <Box sx={{ mb: 2.5 }}>
      {label && <FieldLabel>{label}</FieldLabel>}
      <Box
        sx={{
          display: "flex",
          flexDirection: direction === "column" ? "column" : "row",
          flexWrap: "wrap",
          gap: 1,
          mt: 0.75,
        }}
      >
        {options.map((opt) => {
          const isSelected = value === opt;
          return (
            <Box
              key={opt}
              component="button"
              type="button"
              onClick={() => onChange(opt)}
              sx={{
                px: 1.75,
                py: 0.65,
                fontSize: 12,
                fontFamily: FONT,
                fontWeight: isSelected ? FW_BOLD : FW_NORMAL,
                borderRadius: "20px",
                cursor: "pointer",
                border: `1px solid ${isSelected ? C.black : C.border}`,
                background: isSelected ? C.black : C.white,
                color: isSelected ? C.white : C.textPrimary,
                boxShadow: isSelected ? "0 2px 4px rgba(0,0,0,0.12)" : "none",
                transition: "all 0.15s ease-in-out",
                "&:hover": {
                  borderColor: C.black,
                  background: isSelected ? C.black : C.bgSecondary,
                },
              }}
            >
              {opt}
            </Box>
          );
        })}
      </Box>
    </Box>
  );
};

const NumberInput = ({ label, value, onChange, unit }) => (
  <Box sx={{ display: "flex", flexDirection: "column" }}>
    <FieldLabel>{label}</FieldLabel>
    <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
      <input
        type="number"
        value={value || ""}
        onChange={onChange}
        style={{ ...inputStyle, flex: 1 }}
      />
      {unit && (
        <Typography sx={{ ...os({ fontSize: 12, color: C.textSecond }), flexShrink: 0, whiteSpace: "nowrap" }}>
          {unit}
        </Typography>
      )}
    </Box>
  </Box>
);

const YesNoBox = ({ label, value, onChange }) => {
  const val = value || { flag: "No", detail: "" };
  return (
    <Box sx={{ mb: 2 }}>
      <FieldLabel>{label}</FieldLabel>
      <Box sx={{ display: "flex", gap: 1, alignItems: "center", flexWrap: "wrap" }}>
        {["Yes", "No"].map((opt) => (
          <Box
            key={opt}
            component="button"
            type="button"
            onClick={() => onChange({ ...val, flag: opt })}
            sx={{
              px: 1.5, py: 0.5, fontSize: 11.5, fontFamily: FONT, borderRadius: 4, cursor: "pointer",
              border: `1px solid ${val.flag === opt ? C.black : C.border}`,
              background: val.flag === opt ? C.black : C.white,
              color: val.flag === opt ? C.white : C.textPrimary,
              boxShadow: val.flag === opt ? "0 2px 4px rgba(0,0,0,0.1)" : "none",
            }}
          >
            {opt}
          </Box>
        ))}
        {val.flag === "Yes" && (
          <input
            type="text"
            placeholder="Details"
            value={val.detail}
            onChange={(e) => onChange({ ...val, detail: e.target.value })}
            style={{ ...inputStyle, flex: 1, minWidth: 150, padding: "8px 10px", fontSize: 12 }}
          />
        )}
      </Box>
    </Box>
  );
};

// ─── Imaging Reports (auto-populated under Quality of Life) ─────────────
// Fetches the patient's documents feed and keeps only the ones that look
// like imaging reports (CT / MRI / USG / PET / X-Ray / Bone Scan) based on
// a keyword match against the filename or extracted raw_markdown text.
const ImagingReportsList = ({ reports, loading, error }) => {
  if (loading) {
    return (
      <Typography sx={{ ...os({ fontSize: 11.5, color: C.ash, fontStyle: "italic" }) }}>
        Loading imaging reports...
      </Typography>
    );
  }
  if (error) {
    return (
      <Typography sx={{ ...os({ fontSize: 11.5, color: C.ash, fontStyle: "italic" }) }}>
        {error}
      </Typography>
    );
  }
  if (!reports || reports.length === 0) {
    return (
      <Typography sx={{ ...os({ fontSize: 11.5, color: C.ash, fontStyle: "italic" }) }}>
        No imaging reports found for this patient.
      </Typography>
    );
  }
  return (
    <Box sx={{ display: "flex", flexDirection: "column", gap: 1.5 }}>
      {reports.map((doc) => (
        <Box
          key={doc.id || doc.document_id}
          sx={{ border: `1px solid ${C.fog}`, borderRadius: "4px", p: 1.5, background: C.white }}
        >
          <Box sx={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 1, mb: 1 }}>
            <Typography
              component="a"
              href={doc.file_url}
              target="_blank"
              rel="noopener noreferrer"
              sx={{ ...os({ fontSize: 12.5, color: C.charcoal, textDecoration: "underline" }), cursor: "pointer" }}
            >
              {doc.og_file_name || doc.file_name || "View report"}
            </Typography>
            {doc.document_date && (
              <Typography sx={{ ...os({ fontSize: 10.5, color: C.ash }) }}>{doc.document_date}</Typography>
            )}
          </Box>
          <Box
            component="pre"
            sx={{
              m: 0, maxHeight: 220, overflowY: "auto", whiteSpace: "pre-wrap", wordBreak: "break-word",
              fontFamily: FONT, fontSize: 11.5, fontWeight: 300, color: C.smoke,
              background: C.ghost, border: `1px solid ${C.fog}`, borderRadius: "2px", p: 1.25,
            }}
          >
            {doc.raw_markdown || "No extracted text available."}
          </Box>
        </Box>
      ))}
    </Box>
  );
};

// ─── Option lists ─────────────────────────────────────────────────────────
const CHRONIC_DISEASE_OPTS = ["COPD", "Epilepsy", "Asthma", "HT", "DM", "IHD", "Others", "None"];
const PAIN_TYPE_MULTI = ["Burning", "Stabbing", "Dull Aching", "Numbness", "Pricking", "Shooting", "Spasmodic", "Tingling", "Throbbing Pain"];
const PAIN_LOCAL_SINGLE = ["Localised", "Generalised"];
const PAIN_COURSE_SINGLE = ["Continuous", "Intermittent"];
const PAIN_BT_SINGLE = ["Breakthrough", "Incidental"];
const AGGRAVATING_OPTS = ["After meals", "On movement", "Not related", "On Swallowing", "Coughing", "Others"];
const PATHOPHYSIOLOGY_OPTS = ["Somatic", "Visceral", "Neuropathic", "Psychogenic"];
const PAIN_SYNDROME_OPTS = ["Head and Neck Cancer Pain Syndrome", "Post Mastectomy Pain", "Visceral Pain Syndrome", "Pelvic Pain Syndrome", "Skeletal Metastasis", "STS Pain Syndrome", "Bracheal Plexopathy", "Lumbosacral Plexopathy", "Post Thoracotomy Pain", "Post RT Pain", "Post CT Pain", "Phantom Limb Pain", "CRPS", "Others"];
const PAIN_DIAGNOSIS_OPTS = ["Due to cancer", "Cancer Therapy", "Unrelated"];
const DIAGNOSIS_MADE_BY_OPTS = ["Clinical", "X-Ray", "CT", "Bone Scan", "USG", "MRI", "PET"];
const AFFECT_OPTS = ["Sleep", "Mood", "Bladder", "Bowel", "Appetite", "Others", "None"];
const CURRENT_MED_OPTS = ["Morphine", "Tapentadol", "Paracetamol", "Transdermal Fentanyl", "Codeine", "Transdermal Buprenorphine", "Tramadol", "Diclofenac", "Ibuprofen", "COX-2 Inhibitors", "Methadone", "Others", "None"];
const ROUTE_OPTS = ["Oral", "Transdermal", "Sub Lingual", "Nasal Spray", "Intravenous"];
const FREQ_OPIOID_OPTS = ["4 Hourly", "6 Hourly", "8 Hourly", "12 Hourly", "OD", "3 days", "7 days", "SOS", "HS"];
const FREQ_NSAID_OPTS = ["6 Hourly", "8 Hourly", "12 Hourly", "OD", "SOS"];
const FREQ_PARA_OPTS = ["6 Hourly", "8 Hourly", "12 Hourly", "SOS"];
const FREQ_ADJ_OPTS = ["8 Hourly", "12 Hourly", "HS"];
const OVERALL_RELIEF_OPTS = ["<30%", "40%", "50%", "60%", "70%", ">80%"];
const DRUG_ADHERENCE_OPTS = ["Good", "Fair", "Poor"];
const PERFORMANCE_SCALE_TYPE = ["Karnofsky", "ECOG"];
const KARNOFSKY_OPTS = [">80% Normal activity, no special care", "50–70% Unable to work, lives at home", "<50% Needs Hospital Care"];
const ECOG_OPTS = ["0", "1", "2", "3", "4"];
const SIDE_EFFECT_OPTS = ["None", "Vomiting", "Sedation/Drowsiness", "Constipation", "Hallucinations", "Pruritus", "Urinary Retention", "Others"];
const FOLLOWUP_AFTER_OPTS = ["1 day", "2 days", "1 week", "10 days", "20 days", "1 month", "3 months", "Others"];

const DRUG_TABLE_DEFS = {
  opioid: { label: "Opioid", freq: FREQ_OPIOID_OPTS, drugs: [
    { name: "Buprenorphine Transdermal Patch", unit: "mcg" }, { name: "Codeine", unit: "mg" },
    { name: "Buprenorphine SL", unit: "mcg" }, { name: "Morphine", unit: "mg" },
    { name: "Fentanyl Transdermal Patch", unit: "mcg" }, { name: "Tapentadol", unit: "mg" },
    { name: "Methadone", unit: "mg" }, { name: "Tramadol", unit: "mg" }, { name: "BTP dose of Morphine", unit: "mg" },
  ]},
  nsaid: { label: "NSAIDs", freq: FREQ_NSAID_OPTS, drugs: [
    { name: "Diclofenac", unit: "mg" }, { name: "Etoricoxib", unit: "mg" }, { name: "Ibuprofen", unit: "mg" },
    { name: "Aceclofenac", unit: "mg" }, { name: "Others", unit: "mg" },
  ]},
  paracetamol: { label: "Paracetamol", freq: FREQ_PARA_OPTS, drugs: [
    { name: "Paracetamol", unit: "mg" }, { name: "Others", unit: "mg" },
  ]},
  adjuvants: { label: "Adjuvants", freq: FREQ_ADJ_OPTS, drugs: [
    { name: "Gabapentin", unit: "mg" }, { name: "Pregabalin", unit: "mg" },
    { name: "Amitryptiline", unit: "mg" }, { name: "Nortryptiline", unit: "mg" }, { name: "Others", unit: "mg" },
  ]},
  muscleRelaxants: { label: "Muscle Relaxants", freq: FREQ_ADJ_OPTS, drugs: [
    { name: "Baclofen", unit: "mg" }, { name: "Flupiritine", unit: "mg" },
    { name: "Chloroxazone", unit: "mg" }, { name: "Tizanidine", unit: "mg" }, { name: "Others", unit: "mg" },
  ]},
};

// ─── Drug table (Opioid / NSAIDs / Paracetamol / Adjuvants / Muscle Relaxants) ──
// NOTE: still used by the Follow Up form's "Updated Treatment Plan" section.
const DrugTable = ({ defKey, value, onChange }) => {
  const def = DRUG_TABLE_DEFS[defKey];
  const rows = value || {};
  const setRow = (drugName, patch) => {
    onChange({ ...rows, [drugName]: { ...(rows[drugName] || {}), ...patch } });
  };
  return (
    <SectionBox title={def.label}>
      <Box sx={{ overflowX: "auto" }}>
        <Box sx={{ minWidth: 620 }}>
          <Box sx={{ display: "grid", gridTemplateColumns: "1.6fr 0.7fr 0.9fr 1.3fr", gap: 1, mb: 0.75 }}>
            {["Drug", "Dosage", "Route", "Frequency"].map((h) => (
              <Typography key={h} sx={{ ...os({ fontSize: 10, color: C.silver, textTransform: "uppercase", letterSpacing: "0.06em" }) }}>{h}</Typography>
            ))}
          </Box>
          {def.drugs.map((d) => {
            const row = rows[d.name] || {};
            return (
              <Box key={d.name} sx={{ display: "grid", gridTemplateColumns: "1.6fr 0.7fr 0.9fr 1.3fr", gap: 1, alignItems: "center", py: 0.6, borderTop: `1px solid ${C.fog}` }}>
                <Box
                  component="button" type="button"
                  onClick={() => setRow(d.name, { checked: !row.checked })}
                  sx={{ textAlign: "left", px: 1, py: 0.5, fontSize: 12, fontFamily: FONT, fontWeight: 300, borderRadius: "2px", cursor: "pointer",
                    border: `1px solid ${row.checked ? C.black : C.mist}`, background: row.checked ? C.black : C.white, color: row.checked ? C.white : C.charcoal }}
                >
                  {d.name}
                </Box>
                <input
                  type="number" placeholder={d.unit} value={row.dosage ?? ""}
                  onChange={(e) => setRow(d.name, { dosage: e.target.value })}
                  style={{ width: "100%", padding: "6px 8px", border: `1px solid ${C.mist}`, borderRadius: 2, fontFamily: FONT, fontSize: 12, boxSizing: "border-box" }}
                />
                <select
                  value={row.route || ""} onChange={(e) => setRow(d.name, { route: e.target.value })}
                  style={{ width: "100%", padding: "6px 8px", border: `1px solid ${C.mist}`, borderRadius: 2, fontFamily: FONT, fontSize: 12, background: C.white }}
                >
                  <option value="">—</option>
                  {ROUTE_OPTS.map((r) => <option key={r} value={r}>{r}</option>)}
                </select>
                <select
                  value={row.frequency || ""} onChange={(e) => setRow(d.name, { frequency: e.target.value })}
                  style={{ width: "100%", padding: "6px 8px", border: `1px solid ${C.mist}`, borderRadius: 2, fontFamily: FONT, fontSize: 12, background: C.white }}
                >
                  <option value="">—</option>
                  {def.freq.map((f) => <option key={f} value={f}>{f}</option>)}
                </select>
              </Box>
            );
          })}
        </Box>
      </Box>
    </SectionBox>
  );
};


// ══════════════════════════════════════════════════════════════════════
//  MAIN COMPONENT
// ══════════════════════════════════════════════════════════════════════
export default function PainManagementNewFollowUp({ doctorId, patientId, patientName, initialData, onSave }) {
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  const [newForm, setNewForm] = useState(initialData?.newForm || {});
  const [followUpForm, setFollowUpForm] = useState(initialData?.followUpForm || {});

  const set = (setter) => (key) => (val) => setter((prev) => ({ ...prev, [key]: val }));
  const setNew = set(setNewForm);
  const setFollow = set(setFollowUpForm);

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

  // ─── Determine visit type: New (no prior records) vs Follow Up (has prior records) ──
  const [visitTypeLoading, setVisitTypeLoading] = useState(true);
  const [isFollowUpVisit, setIsFollowUpVisit] = useState(false);
  const [visitTypeError, setVisitTypeError] = useState(null);

  // Manual override — lets the doctor switch between New and Follow Up
  // regardless of what auto-detection found (e.g. to correct a wrong
  // guess, or to log a fresh "New" visit for a patient who does have
  // prior records). null = "use the auto-detected value".
  // newForm/followUpForm are separate pieces of state, so toggling
  // back and forth never discards anything already typed in either.
  const [visitTypeOverride, setVisitTypeOverride] = useState(null); // null | "new" | "follow_up"
  const autoDetectedType = isFollowUpVisit ? "follow_up" : "new";
  const activeVisitType = visitTypeOverride || autoDetectedType;
  // ─── Auto-fill Name / Age / Gender / Phone from patient_users (General Details) ──
const [patientDetailsAutoFilling, setPatientDetailsAutoFilling] = useState(false);

useEffect(() => {
  if (!doctorId || !patientId) return;
  // Guard: only auto-fill once, only if age is still empty (age has no
  // other default source, so it's a reliable "not yet filled" signal).
  if (newForm.age !== undefined && newForm.age !== "" && newForm.age !== null) return;

  let cancelled = false;

  const fetchPatientDetails = async () => {
    setPatientDetailsAutoFilling(true);
    try {
      const res = await fetch(PATIENT_DETAILS_URL(patientId, doctorId));
      const json = await res.json();
      if (cancelled) return;
      if (json.status === "success" && json.data) {
        const { patientName: fetchedName, age, gender, phone } = json.data;
        setNewForm((prev) => ({
          ...prev,
          patientName: prev.patientName || fetchedName || patientName || "",
          age: (prev.age === undefined || prev.age === "" || prev.age === null) ? (age ?? "") : prev.age,
          gender: prev.gender || gender || "",
          phone: prev.phone || phone || "",
        }));
      }
    } catch (err) {
      console.error("Auto-fill patient details failed:", err);
    } finally {
      if (!cancelled) setPatientDetailsAutoFilling(false);
    }
  };

  fetchPatientDetails();
  return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
}, [doctorId, patientId]);
  const isFollowUp = activeVisitType === "follow_up";

  const checkVisitType = useCallback(async () => {
    if (!doctorId || !patientId) return;
    setVisitTypeLoading(true);
    setVisitTypeError(null);
    try {
      const res = await fetch(HISTORY_URL(patientId, doctorId));
      const json = await res.json();
      if (json.status === "success") {
        const records = Array.isArray(json.data) ? json.data : [];
        setIsFollowUpVisit(records.length > 0);

        // ── Pre-fill editable form fields from the most recent saved record ──
        // records are sorted most-recent-first by the backend (created_at desc).
        const latestWithNewForm = records.find(
          (r) => r.new_form && Object.keys(r.new_form).length > 0
        );
        const latestWithFollowUpForm = records.find(
          (r) => r.follow_up_form && Object.keys(r.follow_up_form).length > 0
        );
        if (latestWithNewForm) {
          setNewForm((prev) => ({ ...latestWithNewForm.new_form, ...prev }));
        }
        if (latestWithFollowUpForm) {
          setFollowUpForm((prev) => ({ ...latestWithFollowUpForm.follow_up_form, ...prev }));
        }
      } else {
        // If the check fails, default to New rather than blocking the doctor.
        setIsFollowUpVisit(false);
        setVisitTypeError(json.message || "Could not verify visit history — defaulting to New.");
      }
    } catch (err) {
      console.error("Visit-type check failed:", err);
      setIsFollowUpVisit(false);
      setVisitTypeError("Could not verify visit history — defaulting to New.");
    } finally {
      setVisitTypeLoading(false);
    }
  }, [doctorId, patientId]);

  useEffect(() => {
    checkVisitType();
    // Reset any manual override when switching to a different patient,
    // so the new patient starts from their own auto-detected default.
    setVisitTypeOverride(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [checkVisitType]);

  // ─── Voice dictation for Pain Characteristics + Quality of Life ─────────
  const mediaRecorder = useRef(null);
  const audioChunks = useRef([]);
  const [recording, setRecording] = useState(false);
  const [transcribing, setTranscribing] = useState(false);
  const [dictationTranscript, setDictationTranscript] = useState("");
  const [extracting, setExtracting] = useState(false);
  const [extractError, setExtractError] = useState(null);
  const [fillSuccess, setFillSuccess] = useState(false);

  // ─── Auto-fill "Current Medication" fields from latest medication analysis ──
  const [medsAutoFilling, setMedsAutoFilling] = useState(false);
  const [medsAutoFilled, setMedsAutoFilled] = useState(false);
  const [medsAutoFillError, setMedsAutoFillError] = useState(null);

  // ─── Imaging Reports — auto-populated under Quality of Life ─────────────
  // Pulls the patient's document feed (GET .../th/patient/{patientId}) and
  // keeps only documents that look like imaging reports, matched by
  // modality keyword (CT/MRI/USG/PET/X-Ray/Bone Scan/...) in the filename
  // or the extracted raw_markdown text.
  const [imagingReports, setImagingReports] = useState([]);
  const [imagingLoading, setImagingLoading] = useState(false);
  const [imagingError, setImagingError] = useState(null);

  useEffect(() => {
    if (!patientId) return;
    let cancelled = false;

    const fetchImagingReports = async () => {
      setImagingLoading(true);
      setImagingError(null);
      try {
        const res = await fetch(DOCUMENTS_URL(patientId));
        const json = await res.json();
        if (cancelled) return;
        if (json.status === "success" && Array.isArray(json.documents)) {
          setImagingReports(json.documents.filter(isImagingReport));
        } else {
          setImagingReports([]);
          setImagingError(json.message || "Could not load imaging reports.");
        }
      } catch (err) {
        if (!cancelled) {
          console.error("Fetching imaging reports failed:", err);
          setImagingError("Could not load imaging reports.");
        }
      } finally {
        if (!cancelled) setImagingLoading(false);
      }
    };

    fetchImagingReports();
    return () => { cancelled = true; };
  }, [patientId]);

  useEffect(() => {
    // Only auto-fill once, and only if both target fields are still empty
    // (so we never clobber a restored draft or manual entry).
    if (!doctorId || !patientId) return;
    const alreadyHasText = (newForm.currentMedicationsText || "").trim().length > 0;
    const alreadyHasTags = Array.isArray(newForm.currentMedication) && newForm.currentMedication.length > 0;
    if (alreadyHasText || alreadyHasTags) return;

    let cancelled = false;

    const fetchLatestMedications = async () => {
      setMedsAutoFilling(true);
      setMedsAutoFillError(null);
      try {
        const res = await fetch(
          `${API_BASE_URL}hms/users/data/context/pain-management/latest-medications/${patientId}/${doctorId}`
        );
        const json = await res.json();
        if (cancelled) return;
        if (json.status === "success") {
          const { currentMedicationsText, currentMedication } = json.finaloutput || {};
          if (currentMedicationsText || (currentMedication && currentMedication.length)) {
            setNewForm((prev) => ({
              ...prev,
              currentMedicationsText: prev.currentMedicationsText || currentMedicationsText || "",
              currentMedication: (Array.isArray(prev.currentMedication) && prev.currentMedication.length)
                ? prev.currentMedication
                : (currentMedication || []),
            }));
            setMedsAutoFilled(true);
          }
        } else {
          setMedsAutoFillError(json.message || "Could not auto-fill current medications");
        }
      } catch (err) {
        if (!cancelled) {
          console.error("Auto-fill current medications failed:", err);
          setMedsAutoFillError("Could not auto-fill current medications");
        }
      } finally {
        if (!cancelled) setMedsAutoFilling(false);
      }
    };

    fetchLatestMedications();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [doctorId, patientId]);

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
      setDictationTranscript((prev) => (prev ? `${prev}\n${text}` : text));
    } catch {
      alert("Transcription failed");
    } finally {
      setTranscribing(false);
    }
  };

  const applyExtractedFields = (extracted) => {
    setNewForm((prev) => {
      const next = { ...prev };
      PAIN_CHAR_QOL_KEYS.forEach((k) => {
        if (extracted[k] !== undefined && extracted[k] !== null && extracted[k] !== "") {
          next[k] = extracted[k];
        }
      });
      return next;
    });
  };

  const fillFieldsFromDictation = async () => {
    if (!dictationTranscript.trim()) return;
    setExtracting(true);
    setExtractError(null);
    try {
      const res = await fetch(EXTRACT_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          doctor_id: doctorId,
          patient_id: patientId,
          dictation: dictationTranscript,
          target_section: "pain_characteristics_qol",
        }),
      });
      const json = await res.json();
      const extracted = json?.finaloutput ?? json?.data ?? json ?? {};
      applyExtractedFields(extracted);
      setFillSuccess(true);
      setTimeout(() => setFillSuccess(false), 2000);
    } catch (err) {
      console.error("Field extraction failed:", err);
      setExtractError("Failed to extract fields from dictation. Please fill manually.");
    } finally {
      setExtracting(false);
    }
  };

  const handleSave = async () => {
    setSaving(true);
    const payload = isFollowUp
      ? { doctor_id: doctorId, patient_id: patientId, formType: "follow_up", followUpForm, saved_at: new Date().toISOString() }
      : { doctor_id: doctorId, patient_id: patientId, formType: "new", newForm, saved_at: new Date().toISOString() };
    try {
      if (onSave) await onSave(payload);
      setSaved(true);
      // Let the history panel know there's a new record to show.
      window.dispatchEvent(new Event("refreshPainManagementHistory"));
      setTimeout(() => setSaved(false), 2500);
    } finally {
      setSaving(false);
    }
  };

  // ── New Form (first visit) ──────────────────────────────────────────
  const renderNewForm = () => (
    <Box sx={{ p: { xs: 2, sm: 3 } }}>
      <SectionBox title="General Details">
        <FG>
          <TextInput label="Patient Name" value={newForm.patientName ?? patientName} onChange={setNew("patientName")} />
          <NumberInput label="Age" value={newForm.age} onChange={setNew("age")} unit="yrs" />
          <RdoGroup label="Gender" options={["Male", "Female", "Other"]} value={newForm.gender} onChange={setNew("gender")} />
        </FG>
        <FG>
          <TextInput label="Case Number" value={newForm.caseNumber} onChange={setNew("caseNumber")} />
          <TextInput label="Phone Number" value={newForm.phone} onChange={setNew("phone")} />
          <TextInput label="Pain / Palliative Physician" value={newForm.physician} onChange={setNew("physician")} />
        </FG>
        <Box sx={{ mb: 2 }}>
          <RdoGroup label="Any Allergies" options={["Yes", "No"]} value={newForm.allergies} onChange={setNew("allergies")} />
        </Box>
        <FG>
          <RdoGroup label="Service" options={["OPD", "Ward"]} value={newForm.service} onChange={setNew("service")} />
          <RdoGroup label="Disease Status" options={["Curative", "Palliative", "Disease Free Interval"]} value={newForm.diseaseStatus} onChange={setNew("diseaseStatus")} />
        </FG>
        <Box sx={{ mb: 2.5 }}>
          <CbxPillGroup label="Pre-Existing Chronic Disease" options={CHRONIC_DISEASE_OPTS} value={newForm.chronicDisease} onChange={setNew("chronicDisease")} />
        </Box>
        <Box sx={{ mb: 2 }}>
          <TextInput label="Current Medications (free text)" value={newForm.currentMedicationsText} onChange={setNew("currentMedicationsText")} multiline />
        </Box>
        {(medsAutoFilling || medsAutoFilled || medsAutoFillError) && (
          <Box sx={{ display: "flex", alignItems: "center", gap: 0.75, mt: -1, mb: 2 }}>
            <AutoAwesomeRounded sx={{ fontSize: 13, color: medsAutoFillError ? C.textMuted : C.textSecond }} />
            <Typography sx={{ ...os({ fontSize: 10.5, color: medsAutoFillError ? C.textMuted : C.textMuted, fontStyle: "italic" }) }}>
              {medsAutoFilling
                ? "Auto-filling from latest medication record..."
                : medsAutoFillError
                  ? medsAutoFillError
                  : "Auto-filled from patient's latest medication analysis"}
            </Typography>
          </Box>
        )}
      </SectionBox>
      <SectionBox title="Completed Lab Investigation">
        <CompletedInvestigationsTable completedInvestigations={completedLabs} doctorNamesMap={doctorNamesMap} />
      </SectionBox>

      {/* Voice Dictation — fills Pain Characteristics + Quality of Life */}
      <Box sx={{ mb: 3, p: 2.5, border: `1px solid ${C.border}`, borderRadius: 0, background: C.bgSecondary }}>
        <style>{`
          @keyframes micPulse {
            0% { box-shadow: 0 0 0 0 rgba(220,38,38,0.45); }
            70% { box-shadow: 0 0 0 12px rgba(220,38,38,0); }
            100% { box-shadow: 0 0 0 0 rgba(220,38,38,0); }
          }
          @keyframes blinkDot { 0%,100% { opacity: 1; } 50% { opacity: 0.3; } }
        `}</style>

        <Typography sx={{ ...os({ fontSize: 12, color: C.textPrimary, mb: 1.5, letterSpacing: "0.03em" }) }}>
          Voice Dictation — Pain Characteristics &amp; Quality of Life
        </Typography>

        <Box sx={{ display: "flex", alignItems: "center", gap: 1.5, mb: 1.5 }}>
          <Box
            component="button"
            type="button"
            onClick={() => (recording ? stopRecording() : startRecording())}
            sx={{
              width: 46, height: 46, borderRadius: "50%", border: "none", cursor: "pointer",
              display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0,
              background: recording ? "#dc2626" : C.black,
              color: C.white,
              animation: recording ? "micPulse 1.4s infinite" : "none",
              transition: "background 0.15s",
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
          Speak about: site of pain, where it radiates/refers to, type of pain (burning, stabbing,
          dull aching, numbness, etc.), whether it's localised or generalised, continuous or
          intermittent, breakthrough or incidental, pain score (0–10), duration &amp; onset, number
          of breakthrough episodes, aggravating and relieving factors, pain pathophysiology, pain
          syndrome, pain diagnosis, how the diagnosis was made, and how the pain is affecting sleep,
          mood, bladder, bowel, or appetite — plus current performance status.
        </Typography>

          <Box sx={{ mb: 1.5 }}>
            <FieldLabel>Transcript (review &amp; edit, then fill fields)</FieldLabel>
            <textarea
              value={dictationTranscript}
              onChange={(e) => setDictationTranscript(e.target.value)}
              placeholder="Transcribed text will appear here..."
              style={{ width: "100%", minHeight: 90, padding: "10px 14px", border: `1px solid ${C.mist}`, borderRadius: 6, fontFamily: FONT, fontSize: 13, fontWeight: 300, color: C.ink, resize: "vertical", outline: "none", boxSizing: "border-box", background: C.white }}
            />
          </Box>

        {extractError && (
          <Typography sx={{ ...os({ fontSize: 11, color: "#d32f2f", mb: 1 }) }}>{extractError}</Typography>
        )}

        <Box sx={{ display: "flex", gap: 1 }}>
          <Box
            component="button" type="button"
            onClick={fillFieldsFromDictation}
            disabled={!dictationTranscript.trim() || extracting}
            sx={{
              ...saveBtnSx, px: 2, py: 0.85, fontSize: 12,
              opacity: !dictationTranscript.trim() || extracting ? 0.4 : 1,
              cursor: !dictationTranscript.trim() || extracting ? "not-allowed" : "pointer",
            }}
          >
            {fillSuccess ? (<><CheckCircleRounded sx={{ fontSize: 15 }} /> Fields Filled</>) : extracting ? "Filling Fields..." : "Fill Fields from Dictation"}
          </Box>
          {dictationTranscript && (
            <Box component="button" type="button" onClick={() => setDictationTranscript("")} sx={{ ...outlineBtnSx, px: 2, py: 0.85, fontSize: 12 }}>
              Clear
            </Box>
          )}
        </Box>
      </Box>

      <SectionBox title="Location & Type">
        <FG>
          <TextInput label="Site" value={newForm.site} onChange={setNew("site")} />
          <TextInput label="Radiates To" value={newForm.radiatesTo} onChange={setNew("radiatesTo")} />
          <TextInput label="Referred To" value={newForm.referredTo} onChange={setNew("referredTo")} />
        </FG>
        <CbxPillGroup label="Type of Pain" options={PAIN_TYPE_MULTI} value={newForm.typeOfPain} onChange={setNew("typeOfPain")} />
        <FG>
          <RdoGroup label="Distribution" options={PAIN_LOCAL_SINGLE} value={newForm.distribution} onChange={setNew("distribution")} />
          <RdoGroup label="Course" options={PAIN_COURSE_SINGLE} value={newForm.course} onChange={setNew("course")} />
          <RdoGroup label="Pattern" options={PAIN_BT_SINGLE} value={newForm.pattern} onChange={setNew("pattern")} />
        </FG>
      </SectionBox>

      <SectionBox title="Severity & Intensity">
        <Box sx={{ display: "grid", gridTemplateColumns: { xs: "1fr", sm: "1fr 1fr" }, gap: 2.5, mb: 2.5 }}>
          <DropdownSelect
            label="Pain Score (0–10, Numeric Rating Scale)"
            options={["0","1","2","3","4","5","6","7","8","9","10"]}
            value={newForm.painScore !== undefined && newForm.painScore !== null ? String(newForm.painScore) : ""}
            onChange={(val) => setNew("painScore")(val !== "" ? Number(val) : "")}
            placeholder="Select Pain Score (0-10)..."
          />
          <TextInput label="Duration & Onset (e.g. 3 weeks)" value={newForm.duration} onChange={setNew("duration")} />
          <NumberInput label="No. of episodes of BTP" value={newForm.btpEpisodes} onChange={setNew("btpEpisodes")} />
          <TextInput label="Relieving Factors" value={newForm.relieving} onChange={setNew("relieving")} />
        </Box>
        <CbxPillGroup label="Aggravating Factors" options={AGGRAVATING_OPTS} value={newForm.aggravating} onChange={setNew("aggravating")} />
      </SectionBox>

      <SectionBox title="Clinical Assessment">
        <CbxPillGroup label="Pain Pathophysiology" options={PATHOPHYSIOLOGY_OPTS} value={newForm.pathophysiology} onChange={setNew("pathophysiology")} />
        <CbxPillGroup label="Pain Syndrome" options={PAIN_SYNDROME_OPTS} value={newForm.painSyndrome} onChange={setNew("painSyndrome")} />
        <CbxPillGroup label="Pain Diagnosis" options={PAIN_DIAGNOSIS_OPTS} value={newForm.painDiagnosis} onChange={setNew("painDiagnosis")} />
        <CbxPillGroup label="Diagnosis Made By" options={DIAGNOSIS_MADE_BY_OPTS} value={newForm.diagnosisMadeBy} onChange={setNew("diagnosisMadeBy")} />
      </SectionBox>

      <SectionBox title="Quality of Life">
        <CbxPillGroup label="Affect" options={AFFECT_OPTS} value={newForm.affect} onChange={setNew("affect")} />
        <Box sx={{ display: "grid", gridTemplateColumns: { xs: "1fr", sm: "1fr 1fr" }, gap: 2.5, mb: 2 }}>
          <DropdownSelect
            label="Performance Scale"
            options={PERFORMANCE_SCALE_TYPE}
            value={newForm.perfScaleType}
            onChange={setNew("perfScaleType")}
            placeholder="Select Scale Type..."
          />
          <DropdownSelect
            label="Performance Status"
            options={newForm.perfScaleType === "ECOG" ? ECOG_OPTS : KARNOFSKY_OPTS}
            value={newForm.perfStatus}
            onChange={setNew("perfStatus")}
            placeholder="Select Performance Status..."
          />
        </Box>

        {/* Auto-populated imaging reports that confirmed the diagnosis.
            Matched by modality keyword against filename/raw_markdown,
            sourced from GET .../th/patient/{patientId}. */}
        <Box sx={{ mt: 1 }}>
          <FieldLabel>Imaging Reports Confirming Diagnosis</FieldLabel>
          <ImagingReportsList reports={imagingReports} loading={imagingLoading} error={imagingError} />
        </Box>
      </SectionBox>

      <SectionBox title="Current Medication">
        <CbxPillGroup
          label="Select medications"
          options={CURRENT_MED_OPTS}
          value={newForm.currentMedication}
          onChange={setNew("currentMedication")}
        />
        {(medsAutoFilling || medsAutoFilled || medsAutoFillError) && (
          <Box sx={{ display: "flex", alignItems: "center", gap: 0.75, mt: -1 }}>
            <AutoAwesomeRounded sx={{ fontSize: 13, color: medsAutoFillError ? C.textMuted : C.textSecond }} />
            <Typography sx={{ ...os({ fontSize: 10.5, color: C.textMuted, fontStyle: "italic" }) }}>
              {medsAutoFilling
                ? "Auto-filling from latest medication record..."
                : medsAutoFillError
                  ? medsAutoFillError
                  : "Auto-filled from patient's latest medication analysis"}
            </Typography>
          </Box>
        )}
      </SectionBox>

      {/* Treatment Plan drug tables removed from the New form per request. */}

      <SectionBox title="Adjunct Orders">
        <FG>
          <Box sx={{ mb: 2 }}>
            <RdoGroup label="Laxatives" options={["Yes", "No"]} value={(newForm.laxatives || {}).flag} onChange={(v) => setNew("laxatives")({ ...(newForm.laxatives || {}), flag: v })} />
          </Box>
          <Box sx={{ mb: 2 }}>
            <RdoGroup label="Hyoscine" options={["Yes", "No"]} value={(newForm.hyoscine || {}).flag} onChange={(v) => setNew("hyoscine")({ ...(newForm.hyoscine || {}), flag: v })} />
          </Box>
          <Box sx={{ mb: 2 }}>
            <RdoGroup label="Steroids" options={["Yes", "No"]} value={(newForm.steroids || {}).flag} onChange={(v) => setNew("steroids")({ ...(newForm.steroids || {}), flag: v })} />
          </Box>
          <Box sx={{ mb: 2 }}>
            <RdoGroup label="Cyclopam (Dicyclomine)" options={["Yes", "No"]} value={(newForm.cyclopam || {}).flag} onChange={(v) => setNew("cyclopam")({ ...(newForm.cyclopam || {}), flag: v })} />
          </Box>
          <Box sx={{ mb: 2 }}>
            <RdoGroup label="Bisphosphonates" options={["Yes", "No"]} value={(newForm.bisphosphonates || {}).flag} onChange={(v) => setNew("bisphosphonates")({ ...(newForm.bisphosphonates || {}), flag: v })} />
          </Box>
          <Box sx={{ mb: 2 }}>
            <RdoGroup label="Antiemetic" options={["Yes", "No"]} value={(newForm.antiemetic || {}).flag} onChange={(v) => setNew("antiemetic")({ ...(newForm.antiemetic || {}), flag: v })} />
          </Box>
          <Box sx={{ mb: 2 }}>
            <RdoGroup label="Antacid" options={["Yes", "No"]} value={(newForm.antacid || {}).flag} onChange={(v) => setNew("antacid")({ ...(newForm.antacid || {}), flag: v })} />
          </Box>
        </FG>
        <TextInput label="Advice" value={newForm.advice} onChange={setNew("advice")} multiline />
        <DateInput label="Next Follow Up Date" value={newForm.nextFollowUpDate} onChange={setNew("nextFollowUpDate")} />
      </SectionBox>
    </Box>
  );

  // ── Follow Up Form (subsequent visit) ──────────────────────────────
  const renderFollowUpForm = () => (
    <Box sx={{ p: { xs: 2, sm: 3 } }}>
      {/* Previous visit data + AI summary, reused from the history panel */}
      <Box sx={{ mb: 3 }}>
        <PainManagementHistoryTables patientId={patientId} doctorId={doctorId} />
      </Box>

      <SectionBox title="Change Treatment">
        <Box sx={{ mb: 2.5 }}>
          <RdoGroup label="Do you want to change treatment?" options={["Yes", "No"]} value={followUpForm.changeTreatment} onChange={setFollow("changeTreatment")} />
        </Box>

        <Box sx={{ display: "grid", gridTemplateColumns: { xs: "1fr", sm: "1fr 1fr" }, gap: 2.5, mb: 1 }}>
          <DropdownSelect
            label="Pain Score (0–10, Numeric Rating Scale)"
            options={["0","1","2","3","4","5","6","7","8","9","10"]}
            value={followUpForm.painScore !== undefined && followUpForm.painScore !== null ? String(followUpForm.painScore) : ""}
            onChange={(val) => setFollow("painScore")(val !== "" ? Number(val) : "")}
            placeholder="Select Pain Score (0-10)..."
          />

          <DropdownSelect
            label="Overall Pain Relief"
            options={OVERALL_RELIEF_OPTS}
            value={followUpForm.overallRelief}
            onChange={setFollow("overallRelief")}
            placeholder="Select Pain Relief %..."
          />

          <DropdownSelect
            label="Drug Adherence"
            options={DRUG_ADHERENCE_OPTS}
            value={followUpForm.drugAdherence}
            onChange={setFollow("drugAdherence")}
            placeholder="Select Adherence..."
          />

          <DropdownSelect
            label="Performance Scale"
            options={PERFORMANCE_SCALE_TYPE}
            value={followUpForm.perfScaleType}
            onChange={setFollow("perfScaleType")}
            placeholder="Select Scale Type..."
          />

          <DropdownSelect
            label="Performance Status"
            options={followUpForm.perfScaleType === "ECOG" ? ECOG_OPTS : KARNOFSKY_OPTS}
            value={followUpForm.perfStatus}
            onChange={setFollow("perfStatus")}
            placeholder="Select Performance Status..."
          />

          <NumberInput label="No. of episodes of BTP" value={followUpForm.btpEpisodes} onChange={setFollow("btpEpisodes")} />

          <Box sx={{ gridColumn: { xs: "1", sm: "1 / -1" } }}>
            <TextInput label="Rescue Doses" value={followUpForm.rescueDoses} onChange={setFollow("rescueDoses")} />
          </Box>
        </Box>
      </SectionBox>

      {followUpForm.changeTreatment === "Yes" && (
        <>
          <Typography sx={{ ...os({ fontSize: 13, color: C.ink, mb: 1.5 }) }}>Updated Treatment Plan</Typography>
          <DrugTable defKey="opioid" value={followUpForm.opioid} onChange={setFollow("opioid")} />
          <DrugTable defKey="nsaid" value={followUpForm.nsaid} onChange={setFollow("nsaid")} />
          <DrugTable defKey="paracetamol" value={followUpForm.paracetamol} onChange={setFollow("paracetamol")} />
          <DrugTable defKey="adjuvants" value={followUpForm.adjuvants} onChange={setFollow("adjuvants")} />
          <DrugTable defKey="muscleRelaxants" value={followUpForm.muscleRelaxants} onChange={setFollow("muscleRelaxants")} />
        </>
      )}

      <SectionBox title="New Pain (since last visit)">
        <Box sx={{ mb: 2.5 }}>
          <RdoGroup label="New Pain?" options={["Yes", "No"]} value={followUpForm.newPain} onChange={setFollow("newPain")} />
        </Box>
        {followUpForm.newPain === "Yes" && (
          <>
            <Box sx={{ mt: -1 }} />
            <SubSectionHeader title="Location & Type" />
            <Box sx={{ display: "grid", gridTemplateColumns: { xs: "1fr", sm: "1fr 1fr 1fr" }, gap: 2, mb: 2.5 }}>
              <TextInput label="Site" value={followUpForm.npSite} onChange={setFollow("npSite")} />
              <TextInput label="Radiates To" value={followUpForm.npRadiatesTo} onChange={setFollow("npRadiatesTo")} />
              <TextInput label="Referred To" value={followUpForm.npReferredTo} onChange={setFollow("npReferredTo")} />
            </Box>
            <CbxPillGroup label="Type of Pain" options={PAIN_TYPE_MULTI} value={followUpForm.npTypeOfPain} onChange={setFollow("npTypeOfPain")} />
            
            <SubSectionHeader title="Severity & Intensity" />
            <Box sx={{ display: "grid", gridTemplateColumns: { xs: "1fr", sm: "1fr 1fr" }, gap: 2.5, mb: 2.5 }}>
              <DropdownSelect
                label="Pain Score (0–10, Numeric Rating Scale)"
                options={["0","1","2","3","4","5","6","7","8","9","10"]}
                value={followUpForm.npPainScore !== undefined && followUpForm.npPainScore !== null ? String(followUpForm.npPainScore) : ""}
                onChange={(val) => setFollow("npPainScore")(val !== "" ? Number(val) : "")}
                placeholder="Select Pain Score (0-10)..."
              />
              <TextInput label="Duration & Onset" value={followUpForm.npDuration} onChange={setFollow("npDuration")} />
              <NumberInput label="No. of episodes of BTP" value={followUpForm.npBtpEpisodes} onChange={setFollow("npBtpEpisodes")} />
              <TextInput label="Relieving Factors" value={followUpForm.npRelieving} onChange={setFollow("npRelieving")} />
            </Box>
            <CbxPillGroup label="Aggravating Factors" options={AGGRAVATING_OPTS} value={followUpForm.npAggravating} onChange={setFollow("npAggravating")} />
            
            <SubSectionHeader title="Clinical Assessment" />
            <CbxPillGroup label="Pain Pathophysiology" options={PATHOPHYSIOLOGY_OPTS} value={followUpForm.npPathophysiology} onChange={setFollow("npPathophysiology")} />
            <CbxPillGroup label="Pain Syndrome" options={PAIN_SYNDROME_OPTS} value={followUpForm.npPainSyndrome} onChange={setFollow("npPainSyndrome")} />
            <CbxPillGroup label="Pain Diagnosis" options={PAIN_DIAGNOSIS_OPTS} value={followUpForm.npPainDiagnosis} onChange={setFollow("npPainDiagnosis")} />
            <CbxPillGroup label="Diagnosis Made By" options={DIAGNOSIS_MADE_BY_OPTS} value={followUpForm.npDiagnosisMadeBy} onChange={setFollow("npDiagnosisMadeBy")} />
          </>
        )}
      </SectionBox>

      <SectionBox title="Side Effects & Follow Up">
        <CbxPillGroup label="Side Effects" options={SIDE_EFFECT_OPTS} value={followUpForm.sideEffects} onChange={setFollow("sideEffects")} />

        <Box sx={{ mb: 2.5 }}>
          <TextInput label="Advice" value={followUpForm.advice} onChange={setFollow("advice")} multiline />
        </Box>

        <Box sx={{ mb: 2.5 }}>
          <TextInput label="Interim Cancer Treatment" value={followUpForm.interimTreatment} onChange={setFollow("interimTreatment")} multiline />
        </Box>

        <Box sx={{ display: "grid", gridTemplateColumns: { xs: "1fr", sm: "1fr 1fr" }, gap: 2.5 }}>
          <DropdownSelect
            label="Follow Up After"
            options={FOLLOWUP_AFTER_OPTS}
            value={followUpForm.followUpAfter}
            onChange={setFollow("followUpAfter")}
            placeholder="Select Follow Up Duration..."
          />
          <DateInput label="Follow Up Date" value={followUpForm.followUpDate} onChange={setFollow("followUpDate")} />
        </Box>
      </SectionBox>
    </Box>
  );

  return (
    <Box sx={{ background: C.white, border: `1px solid ${C.border}`, borderRadius: 0 }}>
      {/* Header */}
      <Box sx={{ px: { xs: 2.5, sm: 3 }, pt: { xs: 2.5, sm: 3 }, pb: 1.5, display: "flex", alignItems: "center", gap: 1.5, borderBottom: `1px solid ${C.fog}` }}>
        <LocalHospital sx={{ fontSize: 18, color: C.smoke }} />
        <Box>
          <Typography sx={{ ...os({ fontSize: 14, color: C.ink, letterSpacing: "0.02em" }) }}>
            Pain Management — {visitTypeLoading ? "Checking visit..." : isFollowUp ? "Follow Up" : "New"}
          </Typography>
          <Typography sx={{ ...os({ fontSize: 11, color: C.ash, mt: 0.3 }) }}>
            {patientName ? `${patientName} — ` : ""}NCG-KCDO Pain Management Module (v2.0)
          </Typography>
        </Box>
      </Box>

      {visitTypeLoading ? (
        <Box sx={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 1, py: 6 }}>
          <RefreshRounded sx={{ fontSize: 20, color: C.ash, animation: "spin 1s linear infinite" }} />
          <Typography sx={{ ...os({ fontSize: 12.5, color: C.ash }) }}>Checking patient's visit history...</Typography>
        </Box>
      ) : (
        <>
          {visitTypeError && (
            <Box sx={{ mx: { xs: 2.5, sm: 3 }, mt: 2 }}>
              <Typography sx={{ ...os({ fontSize: 11.5, color: C.ash, fontStyle: "italic" }) }}>{visitTypeError}</Typography>
            </Box>
          )}

          {/* ── Manual Visit Type toggle — overrides the auto-detected value ── */}
          <Box sx={{ px: { xs: 2.5, sm: 3 }, py: 1.5, display: "flex", alignItems: "center", gap: 1.5, flexWrap: "wrap", borderTop: `1px solid ${C.border}`, background: C.bgSecondary }}>
            <Typography sx={{ ...os({ fontSize: 11, color: C.textMuted, textTransform: "uppercase", letterSpacing: "0.06em" }) }}>
              Visit Type
            </Typography>
            <Box sx={{ display: "flex", gap: 1 }}>
              {[{ key: "new", label: "New" }, { key: "follow_up", label: "Follow Up" }].map(({ key, label }) => {
                const active = activeVisitType === key;
                return (
                  <Box
                    key={key}
                    component="button"
                    type="button"
                    onClick={() => setVisitTypeOverride(key)}
                    sx={{
                      px: 1.75, py: 0.6, fontSize: 12, fontFamily: FONT, fontWeight: 300,
                      borderRadius: 0, cursor: "pointer",
                      border: `1px solid ${active ? C.black : C.border}`,
                      background: active ? C.black : C.white,
                      color: active ? C.white : C.textPrimary,
                      "&:hover": { borderColor: C.textPrimary },
                    }}
                  >
                    {label}
                  </Box>
                );
              })}
            </Box>
            {visitTypeOverride && visitTypeOverride !== autoDetectedType && (
              <Typography sx={{ ...os({ fontSize: 10.5, color: C.textSecond, fontStyle: "italic" }) }}>
                (auto-detected as {autoDetectedType === "follow_up" ? "Follow Up" : "New"} — manually switched)
              </Typography>
            )}
          </Box>

          <Box sx={{ borderTop: `1px solid ${C.border}` }}>
            {isFollowUp ? renderFollowUpForm() : renderNewForm()}
          </Box>

          {/* Footer — Save directly under the form, no step navigation */}
          <Box sx={{ px: { xs: 2.5, sm: 3 }, py: 2, borderTop: `1px solid ${C.border}`, background: C.bgSecondary, display: "flex", alignItems: "center", justifyContent: "flex-end", gap: 2 }}>
            <Box component="button" type="button" onClick={handleSave} disabled={saving} sx={{ ...saveBtnSx, minWidth: 140 }}>
              {saved ? (<><CheckCircleRounded sx={{ fontSize: 15 }} /> Saved</>) : saving ? "Saving..." : (<><SaveRounded sx={{ fontSize: 15 }} /> Save</>)}
            </Box>
          </Box>
        </>
      )}
    </Box>
  );
}