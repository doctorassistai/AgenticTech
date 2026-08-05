// tabs/SynopticReportTab.jsx — Schema-Driven Synoptic Report Builder
//
// Third tab of Onco-Pathology workflow. Renders CAP-compliant synoptic fields
// dynamically from a per-site schema (user-owned). Features: Import-from-Gross
// (declarative mapping), Voice dictation → LLM structure → merge, Save via
// onSave("synoptic", data).
//
// Ported from templates/pathology_pp.html #synoptic (1735–2026), which hardcoded
// the colorectal field list. This version consumes synoptic/schemaRegistry.js
// so the user can add new sites (breast, prostate, lung) without touching this file.

import React, { useState, useEffect, useRef } from "react";
import { Box, Typography, TextField, Button, CircularProgress } from "@mui/material";
import { SaveRounded, MicRounded, StopRounded, AutoAwesomeRounded, DownloadRounded, FactCheckRounded } from "@mui/icons-material";
import {
  C, FONT, FW_LIGHT, FW_NORMAL, inputSx, saveBtnSx, outlineBtnSx,
} from "../../shared/designTokens";
import { SectionBox, FG, FieldLabel, FlagNote, Sel } from "../../shared/FormComponents";
import { getSynopticSchema, DEFAULT_SITE } from "../synoptic/schemaRegistry";
import { safeMerge } from "../shared/transcribeMerge";
import { validateSynopticCAP } from "../shared/capValidation";
import CapValidationDialog from "../CapValidationDialog";

// Build { fieldKey: optionList } from a schema's select fields, so AI-autofill
// can snap free-text dictation to the exact <Select> option (else it renders blank).
const buildEnumFields = (schema) => {
  const map = {};
  schema.sections.forEach((sec) => {
    sec.fields.forEach((fld) => {
      if (fld.type === "select" && Array.isArray(fld.options)) map[fld.key] = fld.options;
    });
  });
  return map;
};

// Collect number-field keys so AI-autofill strips units ("4.5 cm" → "4.5")
// before they hit the <input type="number">.
const buildNumberFields = (schema) => {
  const keys = [];
  schema.sections.forEach((sec) => {
    sec.fields.forEach((fld) => {
      if (fld.type === "number") keys.push(fld.key);
    });
  });
  return keys;
};

const API_BASE_URL = import.meta.env.VITE_BACKEND_URL || "https://doctorassist.ai/api/";
const PATH_BASE = `${API_BASE_URL}hms/users/data/onco-pathology`;

export default function SynopticReportTab({ caseId, initialData, grossingData, onSave }) {
  // ─── Schema + State ────────────────────────────────────────────────────────
  // Default to colorectal; user can extend schemaRegistry.js to support more sites.
  const schema = getSynopticSchema(initialData?.site || DEFAULT_SITE);
  const [f, setF] = useState(() => {
    const empty = {};
    schema.sections.forEach(sec => {
      sec.fields.forEach(fld => { empty[fld.key] = ""; });
    });
    return { ...empty, ...(initialData || {}) };
  });
  const [isSaving, setIsSaving] = useState(false);

  // CAP validation (derived on demand, shown in a modal — no persistence).
  // Checklist completeness is driven by the site schema's `required` flags.
  const [capOpen, setCapOpen] = useState(false);
  const [capResults, setCapResults] = useState([]);
  const handleValidateCAP = () => {
    setCapResults(validateSynopticCAP(schema, f));
    setCapOpen(true);
  };

  // Speech-to-text + autofill state (mic → transcribe → LLM structure → merge)
  const [isRecording, setIsRecording] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [transcript, setTranscript] = useState("");
  const [isAutofilling, setIsAutofilling] = useState(false);
  const [isImporting, setIsImporting] = useState(false);
  const mediaRecorderRef = useRef(null);
  const audioChunksRef = useRef([]);

  const set = (key) => (val) => setF((prev) => ({ ...prev, [key]: val }));
  const onInput = (key) => (e) => set(key)(e.target.value);

  // ─── Re-merge when loaded case changes ────────────────────────────────────
  useEffect(() => {
    const empty = {};
    schema.sections.forEach(sec => {
      sec.fields.forEach(fld => { empty[fld.key] = ""; });
    });
    setF({ ...empty, ...(initialData || {}) });
  }, [caseId]); // eslint-disable-line react-hooks/exhaustive-deps

  // ─── Import from Gross ─────────────────────────────────────────────────────
  // Uses declarative `fromGross` hints in the schema to map grossing fields.
  const handleImportFromGross = () => {
    if (!grossingData) {
      alert("No grossing data available for this case.");
      return;
    }
    setIsImporting(true);
    try {
      setF((prev) => {
        const next = { ...prev };
        schema.sections.forEach(sec => {
          sec.fields.forEach(fld => {
            if (fld.fromGross && grossingData[fld.fromGross]) {
              next[fld.key] = grossingData[fld.fromGross];
            }
          });
        });
        return next;
      });
      alert("✔ Imported data from grossing bench successfully.");
    } finally {
      setIsImporting(false);
    }
  };

  // ─── Mic → transcribe (ElevenLabs) ────────────────────────────────────────
  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      mediaRecorderRef.current = new MediaRecorder(stream);
      audioChunksRef.current = [];
      mediaRecorderRef.current.ondataavailable = (e) => {
        if (e.data.size > 0) audioChunksRef.current.push(e.data);
      };
      mediaRecorderRef.current.start();
      setIsRecording(true);
    } catch (err) {
      console.error("[SynopticReportTab] mic error:", err);
      alert("Microphone access denied or not available.");
    }
  };

  const stopRecording = () => {
    if (mediaRecorderRef.current && isRecording) {
      mediaRecorderRef.current.onstop = async () => {
        setIsRecording(false);
        setIsProcessing(true);
        const audioBlob = new Blob(audioChunksRef.current, { type: "audio/webm" });
        audioChunksRef.current = [];

        try {
          const formData = new FormData();
          formData.append("file", audioBlob, "recording.webm");
          const res = await fetch(`${API_BASE_URL}hms/users/ai/elevenlabs/api/transcribe_labs`, {
            method: "POST",
            body: formData,
          });
          const data = await res.json();
          const transcribedText = data.text || data.transcription || "";
          if (transcribedText) {
            setTranscript((prev) => (prev ? `${prev} ${transcribedText}` : transcribedText));
          }
        } catch (err) {
          console.error("[SynopticReportTab] transcribe error:", err);
          alert("Error transcribing audio.");
        } finally {
          setIsProcessing(false);
        }
      };
      mediaRecorderRef.current.stop();
      mediaRecorderRef.current.stream.getTracks().forEach((track) => track.stop());
    }
  };

  // ─── Autofill from transcript (LLM structure) ─────────────────────────────
  const handleAutofill = async () => {
    if (!transcript) return;
    setIsAutofilling(true);
    try {
      const llmRes = await fetch(`${PATH_BASE}/synoptic/structure`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: transcript }),
      });
      const llmData = await llmRes.json();
      if (llmData.status === "success" && llmData.data) {
        // Skip empty LLM values, union-merge arrays, snap dropdown values to
        // their schema option (shared helper — see AnaesthesiaRecord safeMerge).
        setF((prev) => safeMerge(prev, llmData.data, buildEnumFields(schema), buildNumberFields(schema)));
      }
    } catch (err) {
      console.error("[SynopticReportTab] structure error:", err);
      alert("Error structuring data.");
    } finally {
      setIsAutofilling(false);
    }
  };

  // ─── Save ─────────────────────────────────────────────────────────────────
  const handleSubmit = async () => {
    setIsSaving(true);
    try {
      await onSave("synoptic", { ...f });
    } finally {
      setIsSaving(false);
    }
  };

  const busy = isRecording || isProcessing || isAutofilling || isImporting;

  // ─── Render field by type ──────────────────────────────────────────────────
  const renderField = (field) => {
    const common = { value: f[field.key] || "", size: "small", fullWidth: true };
    switch (field.type) {
      case "select":
        return (
          <Sel
            label={field.label}
            options={field.options}
            value={f[field.key] || ""}
            onChange={set(field.key)}
          />
        );
      case "textarea":
        return (
          <TextField
            {...common}
            multiline
            minRows={field.rows || 3}
            placeholder={field.placeholder}
            onChange={onInput(field.key)}
            sx={inputSx}
          />
        );
      case "number":
        return (
          <TextField
            {...common}
            type="number"
            inputProps={{ step: field.step, min: field.min }}
            placeholder={field.placeholder}
            onChange={onInput(field.key)}
            sx={inputSx}
          />
        );
      default: // text
        return (
          <TextField
            {...common}
            placeholder={field.placeholder}
            onChange={onInput(field.key)}
            sx={inputSx}
          />
        );
    }
  };

  return (
    <Box sx={{ fontFamily: FONT }}>
      {/* AI Panel */}
      <Box sx={{ border: `1px solid ${C.border}`, background: C.bgSecondary, p: 2.5, mb: 2.5 }}>
        <Box sx={{ display: "flex", alignItems: "center", gap: 1, mb: 1 }}>
          <AutoAwesomeRounded sx={{ fontSize: 18, color: C.black }} />
          <Typography sx={{ fontSize: 13, fontWeight: FW_NORMAL, fontFamily: FONT, textTransform: "uppercase", letterSpacing: "0.1em" }}>
            AI-Powered Synoptic Report Generation
          </Typography>
        </Box>
        <Typography sx={{ fontSize: 12, color: C.textSecond, fontFamily: FONT, mb: 1.75 }}>
          Import measurements from grossing, or dictate your findings and let AI structure them.
        </Typography>
        <Box sx={{ display: "flex", gap: 1.5, flexWrap: "wrap" }}>
          <Button sx={outlineBtnSx} onClick={handleImportFromGross} disabled={busy}>
            {isImporting ? (
              <CircularProgress size={14} sx={{ mr: 1, color: C.black }} />
            ) : (
              <DownloadRounded sx={{ mr: 0.75, fontSize: 16 }} />
            )}
            Import from Gross
          </Button>
        </Box>
      </Box>

      {/* Speech-to-Text Dictation */}
      <SectionBox title="Voice Dictation (Optional)">
        <FieldLabel>Synoptic Dictation Transcript</FieldLabel>
        <TextField
          value={transcript}
          onChange={(e) => setTranscript(e.target.value)}
          size="small"
          fullWidth
          multiline
          minRows={4}
          placeholder="Dictate or type your synoptic findings here..."
          sx={inputSx}
        />
        <Box sx={{ display: "flex", gap: 1.5, mt: 1.5, flexWrap: "wrap" }}>
          <Button
            sx={{
              ...outlineBtnSx,
              background: isRecording ? "#cf1322" : C.white,
              color: isRecording ? C.white : C.black,
              borderColor: isRecording ? "#cf1322" : C.black,
              "&:hover": { background: isRecording ? "#a8071a" : C.bgTertiary },
            }}
            onClick={isRecording ? stopRecording : startRecording}
            disabled={isProcessing || isAutofilling}
          >
            {isRecording ? <StopRounded sx={{ mr: 0.75, fontSize: 16 }} /> : <MicRounded sx={{ mr: 0.75, fontSize: 16 }} />}
            {isProcessing ? "Processing..." : isRecording ? "Stop Recording" : "Start Recording"}
          </Button>
          <Button sx={outlineBtnSx} onClick={handleAutofill} disabled={busy || !transcript}>
            {isAutofilling ? (
              <CircularProgress size={14} sx={{ mr: 1, color: C.black }} />
            ) : (
              <AutoAwesomeRounded sx={{ mr: 0.75, fontSize: 16 }} />
            )}
            AI Autofill
          </Button>
        </Box>
        <FlagNote>
          Click "AI Autofill" to extract synoptic fields from the transcript and populate the
          form below automatically.
        </FlagNote>
      </SectionBox>

      {/* Dynamic Synoptic Sections (Schema-Driven) */}
      <Box sx={{ mb: 2, px: 2, py: 1.5, border: `1px solid ${C.border}`, background: C.bgSecondary }}>
        <Typography sx={{ fontSize: 14, fontWeight: FW_NORMAL, fontFamily: FONT, color: C.textPrimary }}>
          {schema.title}
        </Typography>
        <Typography sx={{ fontSize: 11, color: C.textMuted, fontFamily: FONT, mt: 0.25 }}>
          Version {schema.version} • Site: {schema.site}
        </Typography>
      </Box>

      {schema.sections.map((section) => (
        <SectionBox key={section.id} title={section.title}>
          {section.note && (
            <FlagNote style={{ marginBottom: "1rem" }}>{section.note}</FlagNote>
          )}
          <FG cols={2}>
            {section.fields.map((field) => (
              <Box key={field.key}>
                <FieldLabel>
                  {field.label}
                  {field.required && <span style={{ color: "#cf1322", marginLeft: 4 }}>*</span>}
                </FieldLabel>
                {renderField(field)}
              </Box>
            ))}
          </FG>
        </SectionBox>
      ))}

      {/* Save / CAP Validation */}
      <Box sx={{ display: "flex", justifyContent: "flex-start", gap: 1.5, flexWrap: "wrap" }}>
        <Button sx={outlineBtnSx} onClick={handleValidateCAP}>
          <FactCheckRounded sx={{ mr: 0.75, fontSize: 16 }} />
          Validate CAP
        </Button>
        <Button sx={saveBtnSx} onClick={handleSubmit} disabled={isSaving}>
          {isSaving ? (
            <CircularProgress size={14} sx={{ mr: 1, color: C.white }} />
          ) : (
            <SaveRounded sx={{ mr: 0.75, fontSize: 16 }} />
          )}
          Save Synoptic Report
        </Button>
      </Box>

      <CapValidationDialog open={capOpen} onClose={() => setCapOpen(false)} title="Synoptic CAP Validation" results={capResults} />
    </Box>
  );
}
