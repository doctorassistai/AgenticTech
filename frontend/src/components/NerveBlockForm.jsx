import React, { useState, useRef, useEffect } from "react";
import { Box, Typography } from "@mui/material";
import { LocalHospital, SaveRounded, CheckCircleRounded, ErrorRounded, AutoAwesomeRounded } from "@mui/icons-material";

/**
 * NerveBlockForm
 * ------------------------------------------------------------------
 * Standalone NCG-KCDO Nerve Block Pain Management form (v2.0).
 * Rendered inside ProcedureNotes.jsx ONLY when the procedure dropdown
 * there is set to "Nerve Block". Self-contained: fetches/saves on its
 * own to the pain-management endpoint, then dispatches
 * "refreshPainManagementHistory" so PainManagementHistoryPanel (Data
 * tab) picks up the new record.
 *
 * v2.1: adds Voice Dictation -> Fill Fields, mirroring the pattern used
 * in PainManagementNewFollowUp.jsx and PalliativeAssessmentForm.jsx.
 * Dictation targets the free-text/scored procedure fields (approach,
 * drug/concentration/volume, procedure description, complications, pre/
 * post pain scores, pre/post activity) via a new backend route:
 *   POST {API}hms/users/data/context/pain-management/nerve-block/extract-fields
 * (mirrors .../pain-management/extract-fields used by the New/Follow Up
 * form, and .../palliative-assessment/extract-fields used by the
 * palliative form.)
 * ------------------------------------------------------------------
 */

const API_BASE_URL = import.meta.env.VITE_BACKEND_URL;
const TRANSCRIBE_URL = `${API_BASE_URL}hms/users/ai/elevenlabs/api/transcribe_labs`;
const EXTRACT_URL = `${API_BASE_URL}hms/users/data/context/pain-management/nerve-block/extract-fields`;
const SAVE_URL = `${API_BASE_URL}hms/users/data/context/pain-management/nerve-block/save`;
const HISTORY_URL = (patientId, doctorId) =>
  `${API_BASE_URL}hms/users/data/context/pain-management/nerve-block/history/${patientId}/${doctorId}`;
// Keys that voice dictation is allowed to auto-fill
const DICTATION_KEYS = [
  "approach", "drugUsed", "concentration", "volume", "contrastUsed", "contrastVolume",
  "procedureDescription", "complications", "prePainScore", "postPainScore",
  "prePerfActivity", "postProcedureActivity",
  "prePulse", "preBP", "postPulse", "postBP",
];
const SIDE_EFFECT_OPTS = ["None", "Vomiting", "Sedation/Drowsiness", "Constipation", "Hallucinations", "Pruritus", "Urinary Retention", "Others"];
const FOLLOWUP_AFTER_OPTS = ["1 day", "2 days", "1 week", "10 days", "20 days", "1 month", "3 months", "Others"];
// Maps a "Follow Up After" choice to a concrete date, counted from today.
// "Others" is left alone since it has no fixed duration — doctor picks manually.
const FOLLOWUP_AFTER_TO_DAYS = {
  "1 day": 1,
  "2 days": 2,
  "1 week": 7,
  "10 days": 10,
  "20 days": 20,
  "1 month": 30,
  "3 months": 90,
};

const computeFollowUpDate = (label) => {
  const days = FOLLOWUP_AFTER_TO_DAYS[label];
  if (!days) return null; // "Others" or unrecognized — don't touch the date field
  const d = new Date();
  d.setDate(d.getDate() + days);
  // format as YYYY-MM-DD for the <input type="date">
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
};
// ─── Design tokens (mirrors DoctorDashboard.jsx) ─────────────────────────
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

// ─── Generic field primitives ────────────────────────────────────────────
const FieldLabel = ({ children }) => (
  <Typography sx={{ ...os({ fontSize: 11, color: C.ash, textTransform: "uppercase", letterSpacing: "0.06em", mb: 0.75 }) }}>
    {children}
  </Typography>
);

const TextInput = ({ label, value, onChange, placeholder, multiline }) => (
  <Box sx={{ mb: 2 }}>
    <FieldLabel>{label}</FieldLabel>
    {multiline ? (
      <textarea
        value={value || ""}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        style={{ width: "100%", minHeight: 60, padding: "9px 12px", border: `1px solid ${C.mist}`, borderRadius: 2, fontFamily: FONT, fontSize: 13, fontWeight: 300, color: C.ink, resize: "vertical", outline: "none", boxSizing: "border-box" }}
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

const ChoiceGroup = ({ label, options, value, onChange, multi = true }) => {
  const selected = Array.isArray(value) ? value : value ? [value] : [];
  const toggle = (opt) => {
    if (multi) {
      const next = selected.includes(opt) ? selected.filter((o) => o !== opt) : [...selected, opt];
      onChange(next);
    } else {
      onChange(selected[0] === opt ? "" : opt);
    }
  };
  return (
    <Box sx={{ mb: 2 }}>
      {label && <FieldLabel>{label}</FieldLabel>}
      <Box sx={{ display: "flex", flexWrap: "wrap", gap: 1 }}>
        {options.map((opt) => {
          const isSel = selected.includes(opt);
          return (
            <Box
              key={opt}
              component="button"
              type="button"
              onClick={() => toggle(opt)}
              sx={{
                px: 1.5, py: 0.6, fontSize: 12, fontFamily: FONT, fontWeight: 300,
                borderRadius: "2px", cursor: "pointer", letterSpacing: "0.01em",
                border: `1px solid ${isSel ? C.black : C.mist}`,
                background: isSel ? C.black : C.white,
                color: isSel ? C.white : C.charcoal,
                transition: "all 0.12s",
                "&:hover": { borderColor: C.charcoal },
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

const RadioRow = ({ label, options, value, onChange }) => (
  <Box sx={{ mb: 2 }}>
    <FieldLabel>{label}</FieldLabel>
    <Box sx={{ display: "flex", gap: 1 }}>
      {options.map((opt) => (
        <Box
          key={opt}
          component="button"
          type="button"
          onClick={() => onChange(opt)}
          sx={{
            px: 1.75, py: 0.6, fontSize: 12, fontFamily: FONT, fontWeight: 300,
            borderRadius: "2px", cursor: "pointer",
            border: `1px solid ${value === opt ? C.black : C.mist}`,
            background: value === opt ? C.black : C.white,
            color: value === opt ? C.white : C.charcoal,
            "&:hover": { borderColor: C.charcoal },
          }}
        >
          {opt}
        </Box>
      ))}
    </Box>
  </Box>
);

const PainScoreInput = ({ value, onChange }) => (
  <Box sx={{ mb: 2 }}>
    <FieldLabel>Pain Score (0–10, Numeric Rating Scale)</FieldLabel>
    <Box sx={{ display: "flex", gap: 0.75, flexWrap: "wrap" }}>
      {Array.from({ length: 11 }, (_, i) => i).map((n) => (
        <Box
          key={n}
          component="button"
          type="button"
          onClick={() => onChange(n)}
          sx={{
            width: 30, height: 30, borderRadius: "2px", cursor: "pointer",
            fontFamily: FONT, fontSize: 12,
            border: `1px solid ${value === n ? C.black : C.mist}`,
            background: value === n ? C.black : C.white,
            color: value === n ? C.white : C.charcoal,
            "&:hover": { borderColor: C.charcoal },
          }}
        >
          {n}
        </Box>
      ))}
    </Box>
  </Box>
);

const Grid2 = ({ children }) => (
  <Box sx={{ display: "grid", gridTemplateColumns: { xs: "1fr", sm: "1fr 1fr" }, gap: { xs: 0, sm: 2.5 } }}>{children}</Box>
);
const Grid3 = ({ children }) => (
  <Box sx={{ display: "grid", gridTemplateColumns: { xs: "1fr", sm: "1fr 1fr 1fr" }, gap: { xs: 0, sm: 2.5 } }}>{children}</Box>
);

const SubSection = ({ title, children }) => (
  <Box sx={{ mb: 3 }}>
    <Typography sx={{ ...os({ fontSize: 12, color: C.ink, mb: 1.5, pb: 0.75, borderBottom: `1px solid ${C.fog}`, letterSpacing: "0.03em" }) }}>
      {title}
    </Typography>
    {children}
  </Box>
);

// ─── Option lists ─────────────────────────────────────────────────────────
const CHRONIC_DISEASE_OPTS = ["COPD", "Epilepsy", "Asthma", "HT", "DM", "IHD", "Others", "None"];
const PERFORMANCE_SCALE_TYPE = ["Karnofsky", "ECOG"];
const KARNOFSKY_OPTS = [">80% Normal activity, no special care", "50–70% Unable to work, lives at home", "<50% Needs Hospital Care"];
const ECOG_OPTS = ["0", "1", "2", "3", "4"];
const NERVE_BLOCK_OPTS = ["Diagnostic Celiac plexus block", "Neurolytic Celiac Plexus block", "Glassopharyngeal Nerve block", "Mandibular Nerve Block", "Maxillary nerve block", "Stellate Ganglion block", "Sphenopalatine ganglion block", "Intercostal nerve blocks", "Superior hypogastric plexus block", "Ganglion impar block", "Neurolytic epidural block", "Subarachnoid Neurolytic Block", "Intrathecal morphine pump", "Epidural morphine", "Epidural steroids", "Lumbar sympathetic block", "Peripheral nerve blocks", "Trigger Joint Injections", "Joint Injections", "Fascial plane blocks", "Other blocks"];
const IMAGE_GUIDANCE_OPTS = ["USG", "Fluroscopy", "CT scan", "Landmark"];
const POST_PROCEDURE_ACTIVITY_OPTS = ["Worsened", "No change", "Improved"];

// ══════════════════════════════════════════════════════════════════════
//  MAIN COMPONENT
// ══════════════════════════════════════════════════════════════════════
export default function NerveBlockForm({ doctorId, patientId, patientName, initialData }) {
  const [nerveBlockForm, setNerveBlockForm] = useState(initialData || {});
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState(null);
// ── Pre-fill editable form from the most recent saved nerve block record ──
  useEffect(() => {
    if (!doctorId || !patientId) return;
    let cancelled = false;
    const loadLatestNerveBlock = async () => {
      try {
        const res = await fetch(HISTORY_URL(patientId, doctorId));
        const json = await res.json();
        if (cancelled) return;
        if (json.status === "success" && Array.isArray(json.data) && json.data.length > 0) {
          const latest = json.data.find(
            (r) => r.nerve_block_form && Object.keys(r.nerve_block_form).length > 0
          );
          if (latest) {
            setNerveBlockForm((prev) => ({ ...latest.nerve_block_form, ...prev }));
          }
        }
      } catch (err) {
        console.error("Failed to load nerve block history:", err);
      }
    };
    loadLatestNerveBlock();
    return () => { cancelled = true; };
  }, [doctorId, patientId]);
  const setNerve = (key) => (val) => setNerveBlockForm((prev) => ({ ...prev, [key]: val }));
  const handleFollowUpAfterChange = (val) => {
  setNerveBlockForm((prev) => {
    const computed = computeFollowUpDate(val);
    return {
      ...prev,
      followUpAfter: val,
      ...(computed ? { followUpDate: computed } : {}),
    };
  });
};

  // ─── Voice dictation (Procedure Details + Pre/Post scores & activity) ──
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
        body: JSON.stringify({ doctor_id: doctorId, patient_id: patientId, dictation: transcript }),
      });
      const json = await res.json();
console.log("Nerve block extract response:", json);   // ADD THIS
const extracted = json?.finaloutput ?? json?.data ?? json ?? {};
console.log("Extracted fields:", extracted);           // ADD THIS
      setNerveBlockForm((prev) => {
        const next = { ...prev };
        DICTATION_KEYS.forEach((k) => {
          if (extracted[k] !== undefined && extracted[k] !== null && extracted[k] !== "") next[k] = extracted[k];
        });
        return next;
      });
      setFillSuccess(true);
      setTimeout(() => setFillSuccess(false), 2000);
    } catch (err) {
      console.error("Nerve block field extraction failed:", err);
      setExtractError("Failed to extract fields from dictation. Please fill manually.");
    } finally {
      setExtracting(false);
    }
  };

  const handleSave = async () => {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(SAVE_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          doctor_id: doctorId,
          patient_id: patientId,
          nerveBlockForm,
          saved_at: new Date().toISOString(),
        }),
      });
      const json = await res.json();
      if (!res.ok || json.status !== "success") {
        throw new Error(json.detail || json.message || "Failed to save nerve block record");
      }
      window.dispatchEvent(new Event("refreshPainManagementHistory"));
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    } catch (err) {
      console.error("Nerve block save failed:", err);
      setError(err.message || "Failed to save nerve block record");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Box sx={{ ...sectionCard }}>
      {/* Header */}
      <Box sx={{ px: { xs: 2.5, sm: 3 }, pt: { xs: 2.5, sm: 3 }, pb: 1.5, display: "flex", alignItems: "center", gap: 1.5, borderBottom: `1px solid ${C.fog}` }}>
        <LocalHospital sx={{ fontSize: 18, color: C.smoke }} />
        <Box>
          <Typography sx={{ ...os({ fontSize: 14, color: C.ink, letterSpacing: "0.02em" }) }}>Nerve Block</Typography>
          <Typography sx={{ ...os({ fontSize: 11, color: C.ash, mt: 0.3 }) }}>
            {patientName ? `${patientName} — ` : ""}NCG-KCDO Nerve Block Pain Management Form (v2.0)
          </Typography>
        </Box>
      </Box>

      <Box sx={{ p: { xs: 2, sm: 3 } }}>
        <SubSection title="General Details">
          <Grid3>
            <TextInput label="Case Number" value={nerveBlockForm.caseNumber} onChange={setNerve("caseNumber")} />
            <TextInput label="Phone Number" value={nerveBlockForm.phone} onChange={setNerve("phone")} />
            <RadioRow label="Consent Taken" options={["Yes", "No"]} value={nerveBlockForm.consentTaken} onChange={setNerve("consentTaken")} />
          </Grid3>
          <Grid2>
            <RadioRow label="Service" options={["OPD", "Ward"]} value={nerveBlockForm.service} onChange={setNerve("service")} />
            <RadioRow label="Disease Status" options={["Curative", "Palliative", "Disease Free Interval"]} value={nerveBlockForm.diseaseStatus} onChange={setNerve("diseaseStatus")} />
          </Grid2>
          <ChoiceGroup label="Pre-Existing Chronic Disease" options={CHRONIC_DISEASE_OPTS} value={nerveBlockForm.chronicDisease} onChange={setNerve("chronicDisease")} />
        </SubSection>

        <SubSection title="Procedure Details">
          <ChoiceGroup label="Name of the Block" options={NERVE_BLOCK_OPTS} value={nerveBlockForm.nameOfBlock} onChange={setNerve("nameOfBlock")} multi={false} />
          <TextInput label="Approach / Procedure" value={nerveBlockForm.approach} onChange={setNerve("approach")} multiline />
          <Grid3>
            <DateInput label="Date of Procedure" value={nerveBlockForm.dateOfProcedure} onChange={setNerve("dateOfProcedure")} />
            <TextInput label="Performed By" value={nerveBlockForm.performedBy} onChange={setNerve("performedBy")} />
            <TextInput label="Assisted By" value={nerveBlockForm.assistedBy} onChange={setNerve("assistedBy")} />
          </Grid3>
          <Grid3>
            <TextInput label="Drug Used" value={nerveBlockForm.drugUsed} onChange={setNerve("drugUsed")} />
            <TextInput label="Concentration" value={nerveBlockForm.concentration} onChange={setNerve("concentration")} />
            <NumberInput label="Volume" value={nerveBlockForm.volume} onChange={setNerve("volume")} unit="ml" />
          </Grid3>
          <Grid3>
            <ChoiceGroup label="Image Guidance" options={IMAGE_GUIDANCE_OPTS} value={nerveBlockForm.imageGuidance} onChange={setNerve("imageGuidance")} multi={false} />
            <TextInput label="Contrast Used" value={nerveBlockForm.contrastUsed} onChange={setNerve("contrastUsed")} />
            <NumberInput label="Contrast Volume" value={nerveBlockForm.contrastVolume} onChange={setNerve("contrastVolume")} unit="ml" />
          </Grid3>
        </SubSection>

        {/* ── Voice Dictation ─────────────────────────────────────────── */}
        <Box sx={{ mb: 3, p: 2.5, border: `1px solid ${C.fog}`, borderRadius: "4px", background: C.ghost }}>
          <style>{`
            @keyframes micPulse { 0% { box-shadow: 0 0 0 0 rgba(220,38,38,0.45); } 70% { box-shadow: 0 0 0 12px rgba(220,38,38,0); } 100% { box-shadow: 0 0 0 0 rgba(220,38,38,0); } }
            @keyframes blinkDot { 0%,100% { opacity: 1; } 50% { opacity: 0.3; } }
          `}</style>
          <Typography sx={{ ...os({ fontSize: 12, color: C.ink, mb: 1.5, letterSpacing: "0.03em" }) }}>
            Voice Dictation — Procedure Notes &amp; Outcome
          </Typography>
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
            Speak about: approach/technique, drug used with concentration and volume, contrast used
            (if any), a description of the procedure, immediate complications, pre- and post-procedure
            pain scores (0–10), pre-procedure activity level, and how activity changed after the
            procedure (worsened / no change / improved).
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
        </Box>

        <SubSection title="Pre-Procedure">
          <Grid3>
            <NumberInput label="Pulse" value={nerveBlockForm.prePulse} onChange={setNerve("prePulse")} unit="/min" />
            <TextInput label="BP" value={nerveBlockForm.preBP} onChange={setNerve("preBP")} placeholder="mm/Hg" />
            <Box />
          </Grid3>
          <PainScoreInput value={nerveBlockForm.prePainScore} onChange={setNerve("prePainScore")} />
          <TextInput label="Procedure Description" value={nerveBlockForm.procedureDescription} onChange={setNerve("procedureDescription")} multiline />
        </SubSection>

        <SubSection title="Post-Procedure">
          <Grid2>
            <NumberInput label="Pulse" value={nerveBlockForm.postPulse} onChange={setNerve("postPulse")} unit="/min" />
            <TextInput label="BP" value={nerveBlockForm.postBP} onChange={setNerve("postBP")} placeholder="mm/Hg" />
          </Grid2>
          <PainScoreInput value={nerveBlockForm.postPainScore} onChange={setNerve("postPainScore")} />
        </SubSection>

        <SubSection title="Immediate Complications">
          <TextInput label="Immediate Complications" value={nerveBlockForm.complications} onChange={setNerve("complications")} multiline />
        </SubSection>

        <SubSection title="Status Change">
          <TextInput label="Pre-Procedure Activity" value={nerveBlockForm.prePerfActivity} onChange={setNerve("prePerfActivity")} />
          <Grid2>
            <ChoiceGroup label="Performance Scale" options={PERFORMANCE_SCALE_TYPE} value={nerveBlockForm.perfScaleType} onChange={setNerve("perfScaleType")} multi={false} />
            <ChoiceGroup
              label="Performance Status"
              options={nerveBlockForm.perfScaleType === "ECOG" ? ECOG_OPTS : KARNOFSKY_OPTS}
              value={nerveBlockForm.perfStatus} onChange={setNerve("perfStatus")} multi={false}
            />
          </Grid2>
          <ChoiceGroup label="Post Procedure Activity" options={POST_PROCEDURE_ACTIVITY_OPTS} value={nerveBlockForm.postProcedureActivity} onChange={setNerve("postProcedureActivity")} multi={false} />
        </SubSection>
        <SubSection title="Side Effects & Follow Up">
  <ChoiceGroup label="Side Effects" options={SIDE_EFFECT_OPTS} value={nerveBlockForm.sideEffects} onChange={setNerve("sideEffects")} />
  <TextInput label="Advice" value={nerveBlockForm.advice} onChange={setNerve("advice")} multiline />
  <Grid2>
    <ChoiceGroup
      label="Follow Up After"
      options={FOLLOWUP_AFTER_OPTS}
      value={nerveBlockForm.followUpAfter}
      onChange={handleFollowUpAfterChange}
      multi={false}
    />
    <DateInput label="Follow Up Date" value={nerveBlockForm.followUpDate} onChange={setNerve("followUpDate")} />
  </Grid2>
</SubSection>
      </Box>

      {/* Footer */}
      <Box sx={{ px: { xs: 2.5, sm: 3 }, py: 2, borderTop: `1px solid ${C.fog}`, background: C.ghost, display: "flex", alignItems: "center", justifyContent: "space-between", gap: 2, flexWrap: "wrap" }}>
        <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
          {error && (
            <>
              <ErrorRounded sx={{ fontSize: 15, color: "#d32f2f" }} />
              <Typography sx={{ ...os({ fontSize: 12, color: "#d32f2f" }) }}>{error}</Typography>
            </>
          )}
        </Box>
        <Box component="button" type="button" onClick={handleSave} disabled={saving} sx={{ ...actionButton, minWidth: 160 }}>
          {saved ? (<><CheckCircleRounded sx={{ fontSize: 15 }} /> Saved</>) : saving ? "Saving..." : (<><SaveRounded sx={{ fontSize: 15 }} /> Save Nerve Block</>)}
        </Box>
      </Box>
    </Box>
  );
}