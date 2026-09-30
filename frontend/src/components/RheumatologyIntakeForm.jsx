import React, { useState, useEffect, useCallback } from "react";
import {
  Box,
  Typography,
  Chip,
  IconButton,
  Tooltip,
} from "@mui/material";
import { RefreshRounded, LocalHospital, SaveRounded, AutoAwesomeRounded } from "@mui/icons-material";
import { THEMES } from "../dashboard/themes";
import { announceRheumContextUpdate, subscribeRheumContextUpdate } from "../dashboard/rheumatologyContextBus";

const API_BASE_URL = import.meta.env.VITE_BACKEND_URL;

// ─── Theme tokens (matches DoctorDashboard.jsx exactly) ─────────────────────
const themeName = localStorage.getItem("theme") || "PurpleWhite";
const theme = THEMES[themeName] || THEMES.PurpleWhite;
const FONT = '"Open Sans", sans-serif';
const FW = 300;

const C = {
  white: theme.bg, ghost: theme.bgAlt, fog: theme.bgTert,
  black: theme.text, ink: theme.text, charcoal: theme.textSec,
  smoke: theme.textSec, ash: theme.textMuted, silver: theme.textMuted,
  mist: theme.border, border: theme.borderStr,
  accent: theme.accent, sec: theme.sec,
};

const os = (extra = {}) => ({ fontFamily: FONT, fontWeight: FW, ...extra });

const card = { background: C.white, border: `1px solid ${C.fog}`, borderRadius: "4px", boxShadow: "0 1px 3px rgba(0,0,0,0.06)" };

const actionButton = {
  px: 2.5, py: 1.1, borderRadius: "2px", fontSize: 12, fontWeight: 400,
  fontFamily: FONT, textTransform: "none", letterSpacing: "0.06em",
  background: C.black, color: C.white, border: "none", cursor: "pointer",
  display: "flex", alignItems: "center", justifyContent: "center", gap: 0.75,
  transition: "background 0.18s ease",
  "&:hover": { background: C.charcoal }, "&:disabled": { opacity: 0.4, cursor: "not-allowed" },
};

const ghostButton = {
  px: 2, py: 0.9, borderRadius: "2px", fontSize: 12, fontWeight: 400,
  fontFamily: FONT, textTransform: "none", letterSpacing: "0.04em",
  background: "transparent", color: C.charcoal, border: `1px solid ${C.mist}`,
  cursor: "pointer", display: "flex", alignItems: "center", gap: 0.5,
  transition: "all 0.15s ease", "&:hover": { borderColor: C.smoke, background: C.ghost },
};

const inputSx = {
  width: "100%", padding: "10px 14px", border: `1px solid ${C.mist}`,
  borderRadius: "2px", background: C.white, fontFamily: FONT, fontSize: "13px",
  fontWeight: 300, color: C.ink, outline: "none", boxSizing: "border-box",
};

const Field = ({ label, children }) => (
  <Box sx={{ mb: 2 }}>
    <Typography sx={{ ...os({ fontSize: 10, color: C.ash, textTransform: "uppercase", letterSpacing: "0.07em", mb: 0.75 }) }}>
      {label}
    </Typography>
    {children}
  </Box>
);

const SELECT_OPTIONS = {
  progression: ["Improving", "Stable", "Worsening", "Fluctuating"],
  joint_distribution: ["Monoarticular", "Oligoarticular", "Polyarticular"],
  joint_size: ["Small joints", "Large joints", "Both"],
  joint_symmetry: ["Symmetrical", "Asymmetrical"],
  axial_involvement: ["Yes", "No", "Uncertain"],
};

const EMPTY_INTAKE = {
  chief_complaint: "",
  current_symptoms: "",
  history_of_present_illness: "",
  onset: "",
  progression: "",
  joint_distribution: "",
  joint_size: "",
  joint_symmetry: "",
  axial_involvement: "",
  morning_stiffness_minutes: "",
  affected_joints: [],
  extra_articular_symptoms: [],
  previous_autoimmune_disease: "",
  family_history: "",
  previous_medications: "",
  steroid_exposure: { has_used: "", detail: "" },
  functional_limitations: "",
  comorbidities: [],
  pregnancy_reproductive_considerations: "",
  suspected_patterns: [],
};

// Small helper: editable comma-separated list field
const ListField = ({ label, value = [], onChange }) => (
  <Field label={label}>
    <input
      style={inputSx}
      placeholder="Comma-separated, e.g. bilateral MCP, left knee"
      value={(value || []).join(", ")}
      onChange={(e) => onChange(e.target.value.split(",").map((s) => s.trim()).filter(Boolean))}
    />
  </Field>
);

export default function RheumatologyIntakeForm({ doctorId, patientId, patientName, dictationText, dictationTrigger }) {
  const [intake, setIntake] = useState(EMPTY_INTAKE);
  const [context, setContext] = useState({ known_diagnosis: "", current_medications: "" });
  const [extracting, setExtracting] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState("");

  const loadContext = useCallback(async () => {
    if (!patientId || !doctorId) return;
    try {
      const res = await fetch(`${API_BASE_URL}hms/users/data/context/rheumatology-intake/patient-context/${patientId}/${doctorId}`);
      const json = await res.json();
      if (json?.status === "success") setContext(json.data || {});
    } catch (err) {
      console.error("Failed to load rheumatology patient context:", err);
    }
  }, [patientId, doctorId]);

  useEffect(() => {
    loadContext();
    return subscribeRheumContextUpdate(loadContext);
  }, [loadContext]);

  const updateField = (key, value) => setIntake((prev) => ({ ...prev, [key]: value }));

  const handleAnalyzeDictation = async (textOverride) => {
    const text = (textOverride ?? dictationText ?? "").trim();
    if (!text) return;
    setExtracting(true);
    try {
      const res = await fetch(`${API_BASE_URL}hms/users/data/context/rheumatology-intake/extract-fields`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ doctor_id: doctorId, patient_id: patientId, dictation: text }),
      });
      const json = await res.json();
      if (json?.status === "success") {
        setIntake((prev) => ({ ...prev, ...json.finaloutput }));
      }
    } catch (err) {
      console.error("Rheumatology extract-fields failed:", err);
    } finally {
      setExtracting(false);
    }
  };

  // Auto-extract whenever a new dictation comes in from the main Clinical Dictation panel
  useEffect(() => {
    if (!dictationTrigger || !dictationText?.trim()) return;
    handleAnalyzeDictation(dictationText);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dictationTrigger]);

  const handleSave = async () => {
    setSaving(true);
    setSaveMsg("");
    try {
      const res = await fetch(`${API_BASE_URL}hms/users/data/context/rheumatology-intake/save`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ patient_id: patientId, doctor_id: doctorId, rheumatologyIntake: intake }),
      });
      const json = await res.json();
      if (!res.ok || json?.status !== "success") throw new Error(json?.detail || json?.message || "Save failed");
      setSaveMsg("✅ Intake saved");
      window.dispatchEvent(new Event("refreshRheumatologyIntakeHistory"));
      announceRheumContextUpdate("intake");
    } catch (err) {
      console.error("Rheumatology intake save failed:", err);
      setSaveMsg(`❌ ${err.message || "Save failed"}`);
    } finally {
      setSaving(false);
      setTimeout(() => setSaveMsg(""), 3000);
    }
  };

  return (
    <Box sx={{ ...card, overflow: "hidden" }}>
      {/* Header */}
      <Box sx={{ px: 3, py: 2.5, borderBottom: `1px solid ${C.fog}`, background: C.ghost, display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 1.5 }}>
        <Box>
          <Typography sx={{ ...os({ fontSize: 14, color: C.ink, letterSpacing: "0.02em" }) }}>
            Rheumatology Intake
          </Typography>
          <Typography sx={{ ...os({ fontSize: 11, color: C.ash, mt: 0.4 }) }}>
            {patientName ? `First-visit structured history — ${patientName}` : "First-visit structured history"}
          </Typography>
        </Box>
        <Chip label="Module 1 · Intake Agent" size="small" sx={{ background: C.black, color: C.white, fontWeight: 300, fontSize: 10, letterSpacing: "0.04em", borderRadius: "2px", height: 22 }} />
      </Box>

      {/* Known context prefill */}
      {(context.known_diagnosis || context.current_medications) && (
        <Box sx={{ px: 3, pt: 2, display: "flex", gap: 2, flexWrap: "wrap" }}>
          {context.known_diagnosis && (
            <Box sx={{ flex: "1 1 260px", p: 1.5, borderRadius: "2px", background: C.ghost, border: `1px solid ${C.fog}` }}>
              <Typography sx={{ ...os({ fontSize: 10, color: C.silver, textTransform: "uppercase", letterSpacing: "0.07em", mb: 0.5 }) }}>Known Diagnosis</Typography>
              <Typography sx={{ ...os({ fontSize: 12, color: C.charcoal }) }}>{context.known_diagnosis}</Typography>
            </Box>
          )}
          {context.current_medications && (
            <Box sx={{ flex: "1 1 260px", p: 1.5, borderRadius: "2px", background: C.ghost, border: `1px solid ${C.fog}` }}>
              <Typography sx={{ ...os({ fontSize: 10, color: C.silver, textTransform: "uppercase", letterSpacing: "0.07em", mb: 0.5 }) }}>Current Medications</Typography>
              <Typography sx={{ ...os({ fontSize: 12, color: C.charcoal }) }}>{context.current_medications}</Typography>
            </Box>
          )}
        </Box>
      )}

      {/* Dictation source — comes from the main Clinical Dictation panel, no re-dictation needed here */}
      <Box sx={{ px: 3, pt: 2.5 }}>
        <Box sx={{
          display: "flex", alignItems: "center", justifyContent: "space-between", gap: 2,
          p: 1.5, borderRadius: "2px", background: C.ghost, border: `1px solid ${C.fog}`,
        }}>
          <Box sx={{ minWidth: 0 }}>
            <Typography sx={{ ...os({ fontSize: 10, color: C.silver, textTransform: "uppercase", letterSpacing: "0.07em", mb: 0.5 }) }}>
              Source Dictation
            </Typography>
            <Typography sx={{
              ...os({ fontSize: 12, color: dictationText ? C.charcoal : C.ash }),
              overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
            }}>
              {dictationText ? dictationText : "No dictation recorded yet — use Clinical Dictation on the Clinical tab."}
            </Typography>
          </Box>
          <Box
            component="button"
            type="button"
            onClick={() => handleAnalyzeDictation(dictationText)}
            disabled={extracting || !dictationText?.trim()}
            sx={{ ...actionButton, minWidth: 140, flexShrink: 0 }}
          >
            {extracting ? <RefreshRounded sx={{ fontSize: 15, animation: "spin 1s linear infinite" }} /> : <AutoAwesomeRounded sx={{ fontSize: 15 }} />}
            {extracting ? "Analyzing..." : "Re-extract"}
          </Box>
        </Box>
      </Box>

      {intake.suspected_patterns?.length > 0 && (
        <Box sx={{ mx: 3, mt: 2, p: 2, borderRadius: "2px", background: C.ghost, border: `1px solid ${C.fog}` }}>
          <Typography sx={{ ...os({ fontSize: 10, color: C.silver, textTransform: "uppercase", letterSpacing: "0.07em", mb: 0.75 }) }}>
            Suspected Patterns — not a diagnosis, for review only
          </Typography>
          {intake.suspected_patterns.map((p, i) => (
            <Typography key={i} sx={{ ...os({ fontSize: 12, color: C.charcoal, mb: 0.5 }) }}>• {p}</Typography>
          ))}
        </Box>
      )}

      {/* Structured fields */}
      <Box sx={{ p: 3, display: "grid", gridTemplateColumns: { xs: "1fr", md: "1fr 1fr" }, gap: 2, columnGap: 3 }}>
        <Field label="Chief Complaint">
          <input style={inputSx} value={intake.chief_complaint} onChange={(e) => updateField("chief_complaint", e.target.value)} />
        </Field>
        <Field label="Current Symptoms">
          <input style={inputSx} value={intake.current_symptoms} onChange={(e) => updateField("current_symptoms", e.target.value)} />
        </Field>
        <Field label="Onset">
          <input style={inputSx} value={intake.onset} onChange={(e) => updateField("onset", e.target.value)} />
        </Field>

        <Box sx={{ gridColumn: { md: "1 / -1" } }}>
          <Field label="History of Present Illness">
            <textarea style={{ ...inputSx, minHeight: 70, resize: "vertical" }} value={intake.history_of_present_illness} onChange={(e) => updateField("history_of_present_illness", e.target.value)} />
          </Field>
        </Box>

        <Field label="Progression">
          <select style={inputSx} value={intake.progression} onChange={(e) => updateField("progression", e.target.value)}>
            <option value="">—</option>
            {SELECT_OPTIONS.progression.map((o) => <option key={o} value={o}>{o}</option>)}
          </select>
        </Field>
        <Field label="Morning Stiffness (minutes)">
          <input type="number" min={0} style={inputSx} value={intake.morning_stiffness_minutes} onChange={(e) => updateField("morning_stiffness_minutes", e.target.value)} />
        </Field>

        <Field label="Joint Distribution">
          <select style={inputSx} value={intake.joint_distribution} onChange={(e) => updateField("joint_distribution", e.target.value)}>
            <option value="">—</option>
            {SELECT_OPTIONS.joint_distribution.map((o) => <option key={o} value={o}>{o}</option>)}
          </select>
        </Field>
        <Field label="Joint Size">
          <select style={inputSx} value={intake.joint_size} onChange={(e) => updateField("joint_size", e.target.value)}>
            <option value="">—</option>
            {SELECT_OPTIONS.joint_size.map((o) => <option key={o} value={o}>{o}</option>)}
          </select>
        </Field>
        <Field label="Symmetry">
          <select style={inputSx} value={intake.joint_symmetry} onChange={(e) => updateField("joint_symmetry", e.target.value)}>
            <option value="">—</option>
            {SELECT_OPTIONS.joint_symmetry.map((o) => <option key={o} value={o}>{o}</option>)}
          </select>
        </Field>
        <Field label="Axial Involvement">
          <select style={inputSx} value={intake.axial_involvement} onChange={(e) => updateField("axial_involvement", e.target.value)}>
            <option value="">—</option>
            {SELECT_OPTIONS.axial_involvement.map((o) => <option key={o} value={o}>{o}</option>)}
          </select>
        </Field>

        <ListField label="Affected Joints" value={intake.affected_joints} onChange={(v) => updateField("affected_joints", v)} />
        <ListField label="Extra-articular Symptoms" value={intake.extra_articular_symptoms} onChange={(v) => updateField("extra_articular_symptoms", v)} />

        <Field label="Previous Autoimmune Disease">
          <input style={inputSx} value={intake.previous_autoimmune_disease} onChange={(e) => updateField("previous_autoimmune_disease", e.target.value)} />
        </Field>
        <Field label="Family History">
          <input style={inputSx} value={intake.family_history} onChange={(e) => updateField("family_history", e.target.value)} />
        </Field>

        <Field label="Previous Medications Tried">
          <input style={inputSx} value={intake.previous_medications} onChange={(e) => updateField("previous_medications", e.target.value)} />
        </Field>
        <Field label="Steroid Exposure">
          <Box sx={{ display: "flex", gap: 1 }}>
            <select style={{ ...inputSx, width: 110, flexShrink: 0 }} value={intake.steroid_exposure?.has_used || ""} onChange={(e) => updateField("steroid_exposure", { ...intake.steroid_exposure, has_used: e.target.value })}>
              <option value="">—</option>
              <option value="Yes">Yes</option>
              <option value="No">No</option>
            </select>
            <input style={inputSx} placeholder="Dose / duration / route" value={intake.steroid_exposure?.detail || ""} onChange={(e) => updateField("steroid_exposure", { ...intake.steroid_exposure, detail: e.target.value })} />
          </Box>
        </Field>

        <ListField label="Comorbidities" value={intake.comorbidities} onChange={(v) => updateField("comorbidities", v)} />
        <Field label="Functional Limitations">
          <input style={inputSx} value={intake.functional_limitations} onChange={(e) => updateField("functional_limitations", e.target.value)} />
        </Field>

        <Box sx={{ gridColumn: { md: "1 / -1" } }}>
          <Field label="Pregnancy / Reproductive Considerations">
            <input style={inputSx} value={intake.pregnancy_reproductive_considerations} onChange={(e) => updateField("pregnancy_reproductive_considerations", e.target.value)} />
          </Field>
        </Box>
      </Box>

      {/* Footer */}
      <Box sx={{ px: 3, py: 2, borderTop: `1px solid ${C.fog}`, background: C.ghost, display: "flex", alignItems: "center", justifyContent: "flex-end", gap: 1.5 }}>
        {saveMsg && <Typography sx={{ ...os({ fontSize: 12, color: saveMsg.includes("✅") ? "#2e7d32" : "#d32f2f" }) }}>{saveMsg}</Typography>}
        <Box component="button" type="button" onClick={handleSave} disabled={saving} sx={{ ...actionButton, minWidth: 160 }}>
          <SaveRounded sx={{ fontSize: 15 }} /> {saving ? "Saving..." : "Save Intake"}
        </Box>
      </Box>

      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </Box>
  );
}