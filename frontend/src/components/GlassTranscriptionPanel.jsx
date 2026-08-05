import React, { useRef, useState, useEffect } from "react";
import {
  Menu,
  MenuItem,
  Typography,
  Box,
  TextareaAutosize,
  CircularProgress,
} from "@mui/material";
import { Mic, Stop, AutoFixHigh, GraphicEq } from "@mui/icons-material";
import FetchIcon from "@mui/icons-material/CloudDownloadOutlined";
import UploadFileIcon from "@mui/icons-material/UploadFile";

// ─── Design Tokens ────────────────────────────────────────────────────────────
const FONT = '"Open Sans", sans-serif';
const FW = 300;

import { THEMES } from "../dashboard/themes";

// Inside your component
const themeName = localStorage.getItem("theme") || "PurpleWhite";
const theme = THEMES[themeName] || THEMES.PurpleWhite;

const C = {
  // Backgrounds
  white: theme.bg,
  ghost: theme.bgAlt,
  fog: theme.bgTert,

  // Text
  black: theme.text,
  ink: theme.text,
  charcoal: theme.textSec,
  smoke: theme.textSec,
  ash: theme.textMuted,
  silver: theme.textMuted,

  // Borders
  mist: theme.border,

  // Accent
  accent: theme.accent,
};

const os = (extra = {}) => ({ fontFamily: FONT, fontWeight: FW, ...extra });

// ─── Button component ─────────────────────────────────────────────────────────
const Btn = ({ children, onClick, disabled, variant = "ghost", active, icon, sx = {} }) => {
  const base = {
    fontFamily: FONT,
    fontWeight: 400,
    fontSize: 12,
    letterSpacing: "0.04em",
    textTransform: "none",
    borderRadius: "2px",
    cursor: disabled ? "not-allowed" : "pointer",
    display: "inline-flex",
    alignItems: "center",
    gap: "6px",
    transition: "all 0.15s ease",
    border: "none",
    outline: "none",
    opacity: disabled ? 0.4 : 1,
    pointerEvents: disabled ? "none" : "auto",
  };

  const styles = {
    primary: { ...base, background: C.black, color: C.white, padding: "7px 16px", "&:hover": { background: C.charcoal } },
    ghost: { ...base, background: "transparent", color: C.charcoal, padding: "6px 14px", border: `1px solid ${C.mist}`, "&:hover": { borderColor: C.smoke, background: C.ghost } },
    active: { ...base, background: C.ink, color: C.white, padding: "6px 14px", border: `1px solid ${C.ink}` },
    danger: { ...base, background: "transparent", color: "#c0392b", padding: "6px 14px", border: `1px solid #f5c6c6`, "&:hover": { background: "#fff5f5" } },
  };

  const picked = active ? styles.active : (styles[variant] || styles.ghost);

  return (
    <Box component="button" onClick={onClick} disabled={disabled}
      sx={{ ...picked, ...sx }}>
      {icon && <Box sx={{ display: "flex", alignItems: "center", "& svg": { fontSize: 14 } }}>{icon}</Box>}
      {children}
    </Box>
  );
};

const TREATMENT_OBJECTIVES = [
  "Symptom relief", "Disease control", "Curative", "Palliative", "Preventive", "Rehabilitation",
];

const extractClinicalOutputs = (data) => {
  if (!data || typeof data !== "object") return null;
  const summary = data.clinical_summary;
  if (!summary) return null;
  return {
    clinical_summary: summary,
    medications: Array.isArray(summary.medications) ? summary.medications : [],
    treatment_plan: Array.isArray(summary.treatment_plan) ? summary.treatment_plan : [],
    investigation_orders: Array.isArray(summary.investigation_orders) ? summary.investigation_orders : [],
  };
};

// ─── Recording pulse animation ────────────────────────────────────────────────
const RecordingDot = () => (
  <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
    <Box sx={{
      width: 7, height: 7, borderRadius: "50%", background: "#c0392b",
      animation: "recpulse 1.2s ease-in-out infinite",
      "@keyframes recpulse": {
        "0%, 100%": { opacity: 1 },
        "50%": { opacity: 0.3 },
      },
    }} />
    <Typography sx={{ ...os({ fontSize: 12, color: "#c0392b", letterSpacing: "0.06em" }) }}>
      RECORDING
    </Typography>
  </Box>
);

// ─── Main Component ───────────────────────────────────────────────────────────
export default function GlassTranscriptionPanel({
  onTranscribe,
  doctorId,
  patientId,
  reloadingNode,
  treatmentObjective,
  onTreatmentObjectiveChange,
  externalTranscript,
  onTranscriptChange,
}) {
  const API_BASE_URL =
  window.PATIENT_WIDGET_API ||
  "https://doctorassist.ai/api/";
  const fileInputRef = useRef(null);
  const mediaRecorder = useRef(null);
  const audioChunks = useRef([]);

  const [recording, setRecording] = useState(false);
  const [processing, setProcessing] = useState(false);
  const [transcript, setTranscript] = useState(externalTranscript || "");
  const [mode, setMode] = useState("normal");
  const [objectiveAnchor, setObjectiveAnchor] = useState(null);
  const [showContinuePlan, setShowContinuePlan] = useState(false);







useEffect(() => {
  const checkLatestAppointment = async () => {
    if (!patientId || !doctorId) return;

    try {
      const res = await fetch(
        `${API_BASE_URL}hms/users/doctors/appointment/latest?patient_id=${patientId}&doctor_id=${doctorId}`
      );

      const data = await res.json();

      setShowContinuePlan(data?.is_follow_up === true);

    } catch (err) {
      console.error(err);
      setShowContinuePlan(false);
    }
  };

  checkLatestAppointment();
}, [patientId, doctorId]);

  useEffect(() => {
    if (externalTranscript !== undefined && externalTranscript !== transcript) {
      setTranscript(externalTranscript);
    }
  }, [externalTranscript]);

useEffect(() => {
  setTranscript("");

  window.DOCTOR_ASSIST_DATA =
    window.DOCTOR_ASSIST_DATA || {};

  window.DOCTOR_ASSIST_DATA.transcript = "";

  if (onTranscriptChange) {
    onTranscriptChange("");
  }
}, [patientId]);
useEffect(() => {
  const handler = (e) => {
    const plan = e.detail;

    if (!plan) return;

    console.log("🧾 Received Treatment Plan → injecting into textarea");

    setTranscript((prev) => {
      const newValue = prev.trim()
        ? `${prev}\n\n${plan}`
        : plan;

      // 🔥 sync global state also
      window.DOCTOR_ASSIST_DATA = window.DOCTOR_ASSIST_DATA || {};
      window.DOCTOR_ASSIST_DATA.transcript = newValue;
      window.dispatchEvent(
        new Event(
          "doctorassist-transcript-update"
        )
      );
      if (onTranscriptChange) {
        onTranscriptChange(newValue);
      }

      return newValue;
    });
  };

  window.addEventListener("treatment-approved", handler);

  return () => window.removeEventListener("treatment-approved", handler);
}, []);

 useEffect(() => {

  const syncTranscript = () => {

    const globalText =
      window.DOCTOR_ASSIST_DATA?.transcript || "";

    setTranscript((prev) => {

      // Don't overwrite user edits
      if (
        prev &&
        prev !== globalText
      ) {
        return prev;
      }

      return globalText;
    });
  };

  // Initial load only
  syncTranscript();

  // Listen for updates
  window.addEventListener(
    "doctorassist-transcript-update",
    syncTranscript
  );

  return () => {

    window.removeEventListener(
      "doctorassist-transcript-update",
      syncTranscript
    );
  };

}, []);

  // ─── Save conversation ──────────────────────────────────────────────────────
  const saveConversation = async (text) => {
    if (!text.trim()) return;
    try {
      await fetch(`${API_BASE_URL}conversation/savew`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ patient_id: patientId, message: { text, sender: "doctor", timestamp: new Date().toISOString() } }),
      });
    } catch (err) { console.error("Failed to save conversation:", err); }
  };


// ─── Add to Skill ─────────────────────────────────────────────
const addToSkill = async () => {
  if (!transcript.trim()) {
    return alert("No text to add to skill");
  }

  try {
    setProcessing(true);

    const res = await fetch(`${API_BASE_URL}hms/users/data/context/skills/save-raw`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
         doctor_id: doctorId,
        patient_id: patientId,
        transcript: transcript   // 👈 your textarea content
      }),
    });

    const data = await res.json();

    if (data.status === "success") {
      alert("Skill created successfully ✅");
    } else {
      alert("Failed to create skill");
    }
  } catch (err) {
    console.error("Add to skill failed:", err);
    alert("Error creating skill");
  } finally {
    setProcessing(false);
  }
};
const loadPreviousTreatmentPlan = async () => {
  try {
    setProcessing(true);

    const res = await fetch(
      `${API_BASE_URL}hms/users/data/context/documentation/latest-treatment-plan?patient_id=${patientId}&doctor_id=${doctorId}`
    );

    const data = await res.json();

    const plan =
      data?.treatment_plan?.processed_treatment_plan?.doctor_content ||
      "";

    if (!plan.trim()) {
      alert("No previous treatment plan found");
      return;
    }

    setTranscript(plan);

    window.DOCTOR_ASSIST_DATA =
      window.DOCTOR_ASSIST_DATA || {};

    window.DOCTOR_ASSIST_DATA.transcript = plan;

    window.dispatchEvent(
      new Event("doctorassist-transcript-update")
    );

    onTranscriptChange?.(plan);

  } catch (err) {
    console.error(err);
    alert("Failed to load treatment plan");
  } finally {
    setProcessing(false);
  }
};
  // ─── Fetch latest ───────────────────────────────────────────────────────────
  const fetchLatestData = async () => {
    try {
      setProcessing(true);
      const url = mode === "normal"
        ? `${API_BASE_URL}hms/users/data/context/dictation/latest?patient_id=${patientId}&doctor_id=${doctorId}`
        : `${API_BASE_URL}hms/users/data/context/conversation/latest?patient_id=${patientId}&doctor_id=${doctorId}`;
      const res = await fetch(url);
      if (!res.ok) throw new Error("Server error");
      const json = await res.json();
      const latest = json?.latest_conversation || json?.latest_dictation || null;
      const latestText = Array.isArray(latest?.text) ? latest.text.join("\n") : latest?.text || "";
      if (latestText.trim()) {
        setTranscript(latestText);
        if (onTranscriptChange) onTranscriptChange(latestText);
      } else {
        alert("No latest data found");
      }
    } catch (err) {
      console.error("Fetch latest failed:", err);
      alert("Failed to fetch latest");
    } finally {
      setProcessing(false);
    }
  };

  // ─── Analyze ────────────────────────────────────────────────────────────────
  const analyzeTranscript = async (text) => {
    if (!text.trim()) return null;
    try {
      const res = await fetch(`${API_BASE_URL}hms/users/cm/storage/analyze-transcript/`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ transcript: text, specialty: "none", consultation_type: "none", patient_id: patientId, doctor_id: doctorId, type_of_conversation: "dictation" }),
      });
      if (!res.ok) return null;
      const json = await res.json();
      if (!json?.data?.clinical_summary) return null;
      return extractClinicalOutputs(json.data);
    } catch (err) {
      console.error("Analyze transcript failed:", err);
      return null;
    }
  };

  // ─── Process typed ──────────────────────────────────────────────────────────
  const processTypedText = async () => {
    if (!transcript.trim()) return alert("Please enter or dictate text first");
    setProcessing(true);
    try {
      const analyzed = await analyzeTranscript(transcript);
      try {

      const response = await fetch(
      `${API_BASE_URL}hms/users/data/context/verify-transcription`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          tag: "transcription",
          doctor_id: doctorId,
          patient_id: patientId,
          transcript: transcript,
        }),
      }
    );

    const data = await response.json();

    console.log("verify-transcription response:", data);

    } catch (verifyErr) {

      // IMPORTANT
      // should NOT block transcribe flow
      console.error(
        "Verify transcription failed:",
        verifyErr
      );
    }

      await onTranscribe?.({ dictation: transcript, output_json: analyzed });
      if (mode === "conversation") await saveConversation(transcript);
    } catch { }
    setProcessing(false);
  };

  // ─── Recording ──────────────────────────────────────────────────────────────
  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      mediaRecorder.current = new MediaRecorder(stream);
      audioChunks.current = [];
      mediaRecorder.current.ondataavailable = (e) => { if (e.data.size > 0) audioChunks.current.push(e.data); };
      mediaRecorder.current.start();
      setRecording(true);
    } catch { alert("Microphone permission is required."); }
  };

  const stopRecording = () => {
    if (!mediaRecorder.current) return;
    mediaRecorder.current.onstop = processAudio;
    mediaRecorder.current.stop();
    mediaRecorder.current.stream.getTracks().forEach((t) => t.stop());
    setRecording(false);
  };

  // ─── Audio flow ─────────────────────────────────────────────────────────────
  const processAudio = async () => {
    if (!audioChunks.current.length) return;
    setProcessing(true);
    try {
      const blob = new Blob(audioChunks.current, { type: "audio/webm" });
      audioChunks.current = [];
      const formData = new FormData();
      formData.append("file", blob);
      const res = await fetch(`${API_BASE_URL}hms/users/ai/elevenlabs/api/transcribe_labs`, { method: "POST", body: formData });
      const data = await res.json();
      const text = data?.text || "";
      setTranscript((prev) => {
      const newValue = prev.trim() ? `${prev}\n${text}` : text;
      window.DOCTOR_ASSIST_DATA = window.DOCTOR_ASSIST_DATA || {};
      window.DOCTOR_ASSIST_DATA.transcript = newValue;
      window.dispatchEvent(
        new Event(
          "doctorassist-transcript-update"
        )
      );
      if (onTranscriptChange) {
        onTranscriptChange(newValue);
      }
      return newValue;
    });

    } catch { alert("Transcription failed"); }
    setProcessing(false);
  };
// ─── Upload handwritten document ────────────────────────────
const uploadHandwrittenDocument = async (event) => {

  const selectedFile = event.target.files?.[0];

  if (!selectedFile) return;

  try {

    setProcessing(true);

    const formData = new FormData();

    formData.append("file", selectedFile);
    formData.append("doctor_id", doctorId);
    formData.append("patient_id", patientId);
    formData.append("upload_mode", "handwritten");

    // optional
    formData.append("doc_type", "handwritten_notes");

    const res = await fetch(
      `${API_BASE_URL}hms/users/speciality/proxy/upload/handwritten`,
      {
        method: "POST",
        body: formData,
      }
    );

    if (!res.ok) {
      throw new Error("Upload failed");
    }

    const data = await res.json();

    console.log("✅ Handwritten Parse Result:", data);

    let parsedText =
  data?.parsed_result?.full_markdown || "";

// cleanup markdown
parsedText = parsedText
  .replace(/^\*\s+/gm, "")
  .replace(/\*\*/g, "");

    if (!parsedText.trim()) {
      alert("No text extracted");
      return;
    }

    // inject into textarea
    setTranscript((prev) => {

      const newValue = prev.trim()
        ? `${prev}\n\n${parsedText}`
        : parsedText;

      // sync global state
      window.DOCTOR_ASSIST_DATA =
        window.DOCTOR_ASSIST_DATA || {};

      window.DOCTOR_ASSIST_DATA.transcript =
        newValue;

      window.dispatchEvent(
        new Event(
          "doctorassist-transcript-update"
        )
      );

      if (onTranscriptChange) {
        onTranscriptChange(newValue);
      }

      return newValue;
    });

  } catch (err) {

    console.error(err);

    alert("Failed to upload handwritten document");

  } finally {

    setProcessing(false);

    // reset input
    event.target.value = "";

  }
};
  // ─── Char count ─────────────────────────────────────────────────────────────
  const charCount = transcript.length;
  const wordCount = transcript.trim() ? transcript.trim().split(/\s+/).length : 0;

  // ─── Render ──────────────────────────────────────────────────────────────────
  return (
    <Box sx={{ fontFamily: FONT, fontWeight: FW }}>
      <link href="https://fonts.googleapis.com/css2?family=Open+Sans:wght@300;400;600&display=swap" rel="stylesheet" />

      {/* ─── Mode switch ──────────────────────────────────────────────────── */}
      <Box sx={{ display: "flex", alignItems: "center", gap: 1, mb: 2 }}>
        <Typography sx={{ ...os({ fontSize: 11, color: C.ash, textTransform: "uppercase", letterSpacing: "0.08em", mr: 1 }) }}>
          Mode
        </Typography>
        {["normal", "conversation"].map((m) => (
          <Btn key={m} onClick={() => setMode(m)} active={mode === m}
            sx={{ px: 2, py: 0.75, fontSize: 11, letterSpacing: "0.04em" }}>
            {m.charAt(0).toUpperCase() + m.slice(1)}
          </Btn>
        ))}
      </Box>

      {/* ─── Action bar ───────────────────────────────────────────────────── */}
      <Box sx={{ display: "flex", gap: 1, mb: 2, flexWrap: "wrap", alignItems: "center" }}>
        <Btn
          onClick={fetchLatestData}
          disabled={processing || recording}
          icon={<FetchIcon />}
        >
          Fetch Latest
        </Btn>

       {showContinuePlan && (
  <Btn
    onClick={loadPreviousTreatmentPlan}
    disabled={processing || recording}
  >
    Continue Previous Plan
  </Btn>
)} 
<Btn
  onClick={() => fileInputRef.current?.click()}
  disabled={processing || recording}
  icon={<UploadFileIcon />}
>
  Upload Notes
</Btn>

<input
  ref={fileInputRef}
  type="file"
  accept=".pdf,.png,.jpg,.jpeg"
  hidden
  onChange={uploadHandwrittenDocument}
/>
        <Btn
          onClick={recording ? stopRecording : startRecording}
          variant={recording ? "danger" : "ghost"}
          icon={recording ? <Stop /> : <Mic />}
          active={recording}
        >
          {recording ? "Stop" : "Record"}
        </Btn>

        <Btn
          onClick={processTypedText}
          variant="primary"
          disabled={processing || recording || reloadingNode === "ALL" || !transcript.trim()}
          icon={processing ? null : <AutoFixHigh />}
        >
          {processing ? (
            <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
              <CircularProgress size={12} sx={{ color: C.white }} />
              Processing...
            </Box>
          ) : "Transcribe"}
        </Btn>
<Btn
  onClick={addToSkill}
  variant="ghost"
  disabled={processing || recording || !transcript.trim()}
>
  Add to Skill
</Btn>
        {/* Divider */}
        <Box sx={{ flex: 1 }} />

        {recording && <RecordingDot />}

        {/* Stats */}
        {transcript.trim() && (
          <Box sx={{ display: "flex", gap: 1.5, alignItems: "center" }}>
            <Typography sx={{ ...os({ fontSize: 10, color: C.silver }) }}>{wordCount} words</Typography>
            <Box sx={{ width: 1, height: 12, background: C.fog }} />
            <Typography sx={{ ...os({ fontSize: 10, color: C.silver }) }}>{charCount} chars</Typography>
          </Box>
        )}
      </Box>

      {/* ─── Textarea ─────────────────────────────────────────────────────── */}
      <Box sx={{ position: "relative" }}>
        <Box sx={{
          border: `1px solid ${recording ? C.charcoal : C.fog}`,
          borderRadius: "3px",
          background: C.white,
          transition: "border-color 0.15s",
          overflow: "hidden",
          "&:focus-within": { borderColor: C.charcoal },
        }}>
          {/* Textarea top bar */}
          <Box sx={{ px: 2, py: 1, borderBottom: `1px solid ${C.fog}`, background: C.ghost, display: "flex", alignItems: "center", gap: 1 }}>
            <GraphicEq sx={{ fontSize: 14, color: C.ash }} />
            <Typography sx={{ ...os({ fontSize: 11, color: C.ash }) }}>
              {mode === "normal" ? "Clinical Dictation" : "Conversation"}
            </Typography>
            {recording && (
              <Box sx={{ ml: "auto", display: "flex", alignItems: "center", gap: 0.75 }}>
                <Box sx={{
                  width: 6, height: 6, borderRadius: "50%", background: "#c0392b",
                  animation: "recpulse 1.2s ease-in-out infinite",
                  "@keyframes recpulse": { "0%, 100%": { opacity: 1 }, "50%": { opacity: 0.3 } },
                }} />
                <Typography sx={{ ...os({ fontSize: 10, color: "#c0392b", letterSpacing: "0.06em" }) }}>LIVE</Typography>
              </Box>
            )}
          </Box>

          <TextareaAutosize
            disabled={processing}
            minRows={7}
            value={transcript}
            onChange={(e) => {
              const newValue = e.target.value;
              setTranscript(newValue);
              window.DOCTOR_ASSIST_DATA = window.DOCTOR_ASSIST_DATA || {};
              window.DOCTOR_ASSIST_DATA.transcript = newValue;
              window.dispatchEvent(
                new Event(
                  "doctorassist-transcript-update"
                )
              );
              if (onTranscriptChange) onTranscriptChange(newValue);
            }}
            placeholder="Type clinical notes or click Record to dictate..."
            style={{
              width: "100%",
              boxSizing: "border-box",
              border: "none",
              background: "transparent",
              resize: "vertical",
              outline: "none",
              fontFamily: FONT,
              fontWeight: FW,
              fontSize: 13,
              color: C.ink,
              lineHeight: 1.7,
              padding: "16px",
              opacity: processing ? 0.4 : 1,
              transition: "opacity 0.15s",
            }}
          />
        </Box>

        {/* Processing overlay */}
        {processing && (
          <Box sx={{
            position: "absolute",
            inset: 0,
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            gap: 1.5,
            background: "rgba(255,255,255,0.82)",
            borderRadius: "3px",
            backdropFilter: "blur(2px)",
          }}>
            <CircularProgress size={28} thickness={2} sx={{ color: C.charcoal }} />
            <Typography sx={{ ...os({ fontSize: 12, color: C.ash, letterSpacing: "0.04em" }) }}>
              Processing dictation...
            </Typography>
          </Box>
        )}
      </Box>

      {/* ─── Helper text ──────────────────────────────────────────────────── */}
      <Box sx={{ mt: 1.5, display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 1 }}>
        <Typography sx={{ ...os({ fontSize: 11, color: C.silver }) }}>
          {mode === "normal"
            ? "Dictation will be analysed and populate clinical documentation fields."
            : "Conversation mode — exchange will be saved as a clinical dialogue."}
        </Typography>
        {transcript.trim() && (
          <Box component="button"
            onClick={() => { setTranscript(""); if (onTranscriptChange) onTranscriptChange(""); }}
            sx={{ background: "none", border: "none", cursor: "pointer", fontFamily: FONT, fontWeight: FW, fontSize: 11, color: C.silver, letterSpacing: "0.04em", "&:hover": { color: C.charcoal }, p: 0 }}>
            Clear
          </Box>
        )}
      </Box>
    </Box>
  );
}