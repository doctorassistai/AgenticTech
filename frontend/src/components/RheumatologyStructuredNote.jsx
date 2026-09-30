import React, { useState, useEffect, useCallback } from "react";
import { Box, Typography, Chip } from "@mui/material";
import { RefreshRounded, SaveRounded, AutoAwesomeRounded } from "@mui/icons-material";
import { THEMES } from "../dashboard/themes";
import { announceRheumContextUpdate, subscribeRheumContextUpdate } from "../dashboard/rheumatologyContextBus";

const API_BASE_URL = import.meta.env.VITE_BACKEND_URL;

const themeName = localStorage.getItem("theme") || "PurpleWhite";
const theme = THEMES[themeName] || THEMES.PurpleWhite;
const FONT = '"Open Sans", sans-serif';
const FW = 300;

const C = {
  white: theme.bg, ghost: theme.bgAlt, fog: theme.bgTert,
  black: theme.text, ink: theme.text, charcoal: theme.textSec,
  smoke: theme.textSec, ash: theme.textMuted, silver: theme.textMuted,
  mist: theme.border, border: theme.borderStr,
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

// ─── MUST match NOTE_SECTION_KEYS / NOTE_SECTION_LABELS in
// rheumatology_structured_note_api.py exactly ────────────────────────────
const NOTE_SECTIONS = [
  ["chief_complaint", "Chief Complaint"],
  ["history_of_present_illness", "History of Present Illness"],
  ["pain_characteristics", "Pain Characteristics"],
  ["joint_wise_symptoms", "Joint-wise Symptoms"],
  ["morning_stiffness", "Morning Stiffness"],
  ["extra_articular_symptoms", "Extra-articular Symptoms"],
  ["past_medical_history", "Past Medical History"],
  ["family_history", "Family History"],
  ["medication_history", "Medication History"],
  ["previous_rheumatology_treatment", "Previous Rheumatology Treatment"],
  ["examination_findings", "Examination Findings"],
  ["laboratory_results", "Laboratory Results"],
  ["imaging_findings", "Imaging Findings"],
  ["disease_activity", "Disease Activity"],
  ["assessment", "Assessment"],
  ["differential_diagnosis", "Differential Diagnosis"],
  ["treatment_plan", "Treatment Plan"],
  ["followup_plan", "Follow-up Plan"],
];

const EMPTY_NOTE = Object.fromEntries(NOTE_SECTIONS.map(([key]) => [key, ""]));

export default function RheumatologyStructuredNote({ doctorId, patientId, patientName }) {
  const [additionalDictation, setAdditionalDictation] = useState("");
  const [note, setNote] = useState(EMPTY_NOTE);
  const [contextPreview, setContextPreview] = useState(null);
  const [generating, setGenerating] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState("");
  const [hasData, setHasData] = useState(false);

  const loadContext = useCallback(async () => {
    if (!patientId || !doctorId) return;
    try {
      const res = await fetch(`${API_BASE_URL}hms/users/data/context/rheumatology-structured-note/context-preview/${patientId}/${doctorId}`);
      const json = await res.json();
      if (json?.status === "success") {
        setContextPreview(json.data);
        setHasData(Boolean(json.has_data));
      }
    } catch (err) {
      console.error("Failed to load structured note context preview:", err);
    }
  }, [patientId, doctorId]);

  useEffect(() => {
    loadContext();
    return subscribeRheumContextUpdate(loadContext);
  }, [loadContext]);

  const updateField = (key, value) => setNote((prev) => ({ ...prev, [key]: value }));

  const handleGenerate = async () => {
    setGenerating(true);
    try {
      const res = await fetch(`${API_BASE_URL}hms/users/data/context/rheumatology-structured-note/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ doctor_id: doctorId, patient_id: patientId, additional_dictation: additionalDictation }),
      });
      const json = await res.json();
      if (json?.status === "success") {
        setNote((prev) => ({ ...prev, ...json.finaloutput }));
      } else {
        console.error("Structured note generate failed:", json?.detail);
      }
    } catch (err) {
      console.error("Structured note generate failed:", err);
    } finally {
      setGenerating(false);
    }
  };

  const handleSave = async () => {
    setSaving(true);
    setSaveMsg("");
    try {
      const res = await fetch(`${API_BASE_URL}hms/users/data/context/rheumatology-structured-note/save`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          patient_id: patientId,
          doctor_id: doctorId,
          structuredNote: note,
          additionalDictation: additionalDictation,
        }),
      });
      const json = await res.json();
      if (!res.ok || json?.status !== "success") throw new Error(json?.detail || json?.message || "Save failed");
      setSaveMsg("✅ Structured note saved");
      window.dispatchEvent(new Event("refreshRheumatologyStructuredNoteHistory"));
      announceRheumContextUpdate("structured-note");
    } catch (err) {
      console.error("Structured note save failed:", err);
      setSaveMsg(`❌ ${err.message || "Save failed"}`);
    } finally {
      setSaving(false);
      setTimeout(() => setSaveMsg(""), 3000);
    }
  };

  const hasContext = hasData;

  return (
    <Box sx={{ ...card, overflow: "hidden" }}>
      <Box sx={{ px: 3, py: 2.5, borderBottom: `1px solid ${C.fog}`, background: C.ghost, display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 1.5 }}>
        <Box>
          <Typography sx={{ ...os({ fontSize: 14, color: C.ink, letterSpacing: "0.02em" }) }}>
            AI-Generated Structured Note
          </Typography>
          <Typography sx={{ ...os({ fontSize: 11, color: C.ash, mt: 0.4 }) }}>
            {patientName ? `Standardized rheumatology note — ${patientName}` : "Standardized rheumatology note"}
          </Typography>
        </Box>
        <Chip label="Structured Note" size="small" sx={{ background: C.black, color: C.white, fontWeight: 300, fontSize: 10, letterSpacing: "0.04em", borderRadius: "2px", height: 22 }} />
      </Box>

      {contextPreview && (
        <Box sx={{ mx: 3, mt: 2, p: 1.5, borderRadius: "2px", background: C.ghost, border: `1px solid ${C.fog}`, display: "flex", flexWrap: "wrap", gap: 0.75 }}>
          <Typography sx={{ ...os({ fontSize: 10, color: C.silver, textTransform: "uppercase", letterSpacing: "0.07em", mr: 1, alignSelf: "center" }) }}>Sources found</Typography>
          {[
            ["Intake", contextPreview.intake],
            ["Joint Map", contextPreview.joint_map],
            ["Differential", contextPreview.differential],
            ["Imaging", contextPreview.imaging],
            ["Manifestations", contextPreview.manifestations],
            ["Medications", contextPreview.current_medications?.length > 0],
          ].map(([label, present]) => (
            <Chip
              key={label}
              label={label}
              size="small"
             sx={{
  fontSize: 10, height: 20, borderRadius: "2px",
  background: (typeof present === "boolean" ? present : Object.keys(present || {}).length > 0) ? C.black : "transparent",
  color: (typeof present === "boolean" ? present : Object.keys(present || {}).length > 0) ? C.white : C.silver,
  border: `1px solid ${(typeof present === "boolean" ? present : Object.keys(present || {}).length > 0) ? C.black : C.mist}`,
}}
            />
          ))}
        </Box>
      )}

      {/* Additional dictation top-up */}
      <Box sx={{ px: 3, pt: 2.5 }}>
        <Typography sx={{ ...os({ fontSize: 10, color: C.ash, textTransform: "uppercase", letterSpacing: "0.07em", mb: 0.75 }) }}>
          Additional Findings (optional)
        </Typography>
        <textarea
          placeholder="Anything not yet captured by prior modules — a rash noticed today, dry eyes, a family member's diagnosis mentioned today..."
          value={additionalDictation}
          onChange={(e) => setAdditionalDictation(e.target.value)}
          style={{ ...inputSx, minHeight: 70, resize: "vertical" }}
        />
        <Box sx={{ display: "flex", justifyContent: "flex-end", mt: 1.5 }}>
          <Box component="button" type="button" onClick={handleGenerate} disabled={generating || !hasContext && !additionalDictation.trim()} sx={{ ...actionButton, minWidth: 220 }}>
            {generating ? <RefreshRounded sx={{ fontSize: 15, animation: "spin 1s linear infinite" }} /> : <AutoAwesomeRounded sx={{ fontSize: 15 }} />}
            {generating ? "Generating..." : "Generate Structured Note"}
          </Box>
        </Box>
      </Box>

      {/* Editable sections */}
      <Box sx={{ p: 3, display: "grid", gridTemplateColumns: { xs: "1fr", lg: "1fr 1fr" }, gap: 2, columnGap: 3 }}>
        {NOTE_SECTIONS.map(([key, label]) => (
          <Field key={key} label={label}>
            <textarea
              style={{ ...inputSx, minHeight: 64, resize: "vertical" }}
              value={note[key] || ""}
              onChange={(e) => updateField(key, e.target.value)}
            />
          </Field>
        ))}
      </Box>

      {/* Footer */}
      <Box sx={{ px: 3, py: 2, borderTop: `1px solid ${C.fog}`, background: C.ghost, display: "flex", alignItems: "center", justifyContent: "flex-end", gap: 1.5 }}>
        {saveMsg && <Typography sx={{ ...os({ fontSize: 12, color: saveMsg.includes("✅") ? "#2e7d32" : "#d32f2f" }) }}>{saveMsg}</Typography>}
        <Box component="button" type="button" onClick={handleSave} disabled={saving} sx={{ ...actionButton, minWidth: 160 }}>
          <SaveRounded sx={{ fontSize: 15 }} /> {saving ? "Saving..." : "Save Note"}
        </Box>
      </Box>

      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </Box>
  );
}