// tabs/GrossingBenchTab.jsx — Grossing Bench with Speech-to-Text + AI Autofill
//
// Second tab of Onco-Pathology workflow. Structured gross examination: specimen
// receipt & fixation, measurements, tumor description, margins, lymph nodes.
// Mic → transcribe → LLM structure → merge (pattern from OTRecord Post-Op tab).
//
// Ported from templates/pathology_pp.html #grossing (1466–1734), which called
// /process-dictation + /grossing_bench/save. New backend: POST /grossing/structure
// returns { status, data: {container_type, fixative_used, ...} }, then frontend
// merges into state, then saveSection(caseId, "grossing", data).

import React, { useState, useEffect, useRef } from "react";
import { Box, Typography, TextField, Button, CircularProgress } from "@mui/material";
import { SaveRounded, MicRounded, StopRounded, AutoAwesomeRounded, FactCheckRounded } from "@mui/icons-material";
import {
  C, FONT, FW_LIGHT, FW_NORMAL, inputSx, saveBtnSx, outlineBtnSx,
} from "../../shared/designTokens";
import { SectionBox, FG, FieldLabel, FlagNote, Sel } from "../../shared/FormComponents";
import {
  CONTAINER_TYPES, FIXATIVES, GROSS_COLORS, CONSISTENCIES, TUMOR_CONFIGURATIONS,
} from "../constants";
import { safeMerge } from "../shared/transcribeMerge";
import { validateGrossingCAP } from "../shared/capValidation";
import CapValidationDialog from "../CapValidationDialog";

// Dropdown fields whose LLM free-text must be snapped to a canonical option
// (MUI <Select> renders blank if the value isn't an exact option match).
const ENUM_FIELDS = {
  container_type: CONTAINER_TYPES,
  fixative_used: FIXATIVES,
  color: GROSS_COLORS,
  consistency: CONSISTENCIES,
  tumor_configuration: TUMOR_CONFIGURATIONS,
};

const API_BASE_URL = import.meta.env.VITE_BACKEND_URL || "https://doctorassist.ai/api/";
const PATH_BASE = `${API_BASE_URL}hms/users/data/onco-pathology`;

const EMPTY = {
  // Specimen Receipt & Fixation
  container_type: "", fixative_used: "", fixation_date: "", fixation_time: "", fixation_duration: "",
  // Measurements & Physical Characteristics
  length_cm: "", width_cm: "", depth_cm: "", weight_g: "",
  color: "", consistency: "",
  // Tumor/Lesion Description
  tumor_greatest_dimension: "", additional_dimensions: "", tumor_configuration: "",
  tumor_location: "", gross_description: "",
  // Margins
  proximal_margin: "", distal_margin: "", radial_margin: "", other_margins: "",
  // Lymph Nodes
  total_lymph_nodes: "", lymph_node_stations: "", lymph_node_description: "",
};

// Number-only fields — LLM free-text ("22 hours", "4.5 cm") is stripped to a
// bare number so the <input type="number"> doesn't reject it.
const NUMBER_FIELDS = [
  "fixation_duration", "length_cm", "width_cm", "depth_cm", "weight_g",
  "tumor_greatest_dimension", "proximal_margin", "distal_margin", "radial_margin",
  "total_lymph_nodes",
];

// Back-compat: older cases stored a single `fixation_start` datetime. Split it
// into the new date + time fields so previously-saved data still loads.
const withFixationSplit = (data) => {
  const d = { ...(data || {}) };
  if (d.fixation_start && !d.fixation_date && !d.fixation_time) {
    const dt = new Date(d.fixation_start);
    if (!isNaN(dt.getTime())) {
      const pad = (n) => String(n).padStart(2, "0");
      d.fixation_date = `${dt.getFullYear()}-${pad(dt.getMonth() + 1)}-${pad(dt.getDate())}`;
      d.fixation_time = `${pad(dt.getHours())}:${pad(dt.getMinutes())}`;
    }
    delete d.fixation_start;
  }
  return d;
};

export default function GrossingBenchTab({ caseId, initialData, onSave }) {
  const [f, setF] = useState({ ...EMPTY, ...withFixationSplit(initialData) });
  const [isSaving, setIsSaving] = useState(false);

  // CAP validation (derived on demand, shown in a modal — no persistence)
  const [capOpen, setCapOpen] = useState(false);
  const [capResults, setCapResults] = useState([]);
  const handleValidateCAP = () => {
    setCapResults(validateGrossingCAP(f));
    setCapOpen(true);
  };

  // Speech-to-text + autofill state (mic → transcribe → LLM structure → merge)
  const [isRecording, setIsRecording] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [transcript, setTranscript] = useState("");
  const [isAutofilling, setIsAutofilling] = useState(false);
  const mediaRecorderRef = useRef(null);
  const audioChunksRef = useRef([]);

  const set = (key) => (val) => setF((prev) => ({ ...prev, [key]: val }));
  const onInput = (key) => (e) => set(key)(e.target.value);

  // ─── Re-merge when loaded case changes ────────────────────────────────────
  useEffect(() => {
    setF({ ...EMPTY, ...withFixationSplit(initialData) });
  }, [caseId]); // eslint-disable-line react-hooks/exhaustive-deps

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
      console.error("[GrossingBenchTab] mic error:", err);
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
          console.error("[GrossingBenchTab] transcribe error:", err);
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
      const llmRes = await fetch(`${PATH_BASE}/grossing/structure`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: transcript }),
      });
      const llmData = await llmRes.json();
      if (llmData.status === "success" && llmData.data) {
        // Skip empty LLM values, union-merge arrays, snap dropdown values to
        // their canonical option, strip units from number fields (shared helper).
        setF((prev) => safeMerge(prev, llmData.data, ENUM_FIELDS, NUMBER_FIELDS));
      }
    } catch (err) {
      console.error("[GrossingBenchTab] structure error:", err);
      alert("Error structuring data.");
    } finally {
      setIsAutofilling(false);
    }
  };

  // ─── Save ─────────────────────────────────────────────────────────────────
  const handleSubmit = async () => {
    setIsSaving(true);
    try {
      await onSave("grossing", { ...f });
    } finally {
      setIsSaving(false);
    }
  };

  const busy = isRecording || isProcessing || isAutofilling;

  return (
    <Box sx={{ fontFamily: FONT }}>
      {/* Speech-to-Text Transcript */}
      <SectionBox title="Speech-to-Text Grossing Dictation">
        <FieldLabel>Transcript</FieldLabel>
        <TextField
          value={transcript}
          onChange={(e) => setTranscript(e.target.value)}
          size="small"
          fullWidth
          multiline
          minRows={4}
          placeholder="Dictate or type your grossing description here..."
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
          Click "AI Autofill" to extract specimen details from the transcript and populate the
          fields below automatically.
        </FlagNote>
      </SectionBox>

      {/* Specimen Receipt & Fixation */}
      <SectionBox title="Specimen Receipt & Fixation">
        <FG cols={2}>
          <Box>
            <FieldLabel>Container Type</FieldLabel>
            <Sel
              label="Container Type"
              options={CONTAINER_TYPES}
              value={f.container_type}
              onChange={set("container_type")}
            />
          </Box>
          <Box>
            <FieldLabel>Fixative Used</FieldLabel>
            <Sel
              label="Fixative"
              options={FIXATIVES}
              value={f.fixative_used}
              onChange={set("fixative_used")}
            />
          </Box>
          <Box>
            <FieldLabel>Fixation Start Date</FieldLabel>
            <TextField
              type="date"
              value={f.fixation_date}
              onChange={onInput("fixation_date")}
              size="small"
              fullWidth
              InputLabelProps={{ shrink: true }}
              sx={inputSx}
            />
          </Box>
          <Box>
            <FieldLabel>Fixation Start Time</FieldLabel>
            <TextField
              type="time"
              value={f.fixation_time}
              onChange={onInput("fixation_time")}
              size="small"
              fullWidth
              InputLabelProps={{ shrink: true }}
              sx={inputSx}
            />
          </Box>
          <Box>
            <FieldLabel>Fixation Duration (hours)</FieldLabel>
            <TextField
              type="number"
              value={f.fixation_duration}
              onChange={onInput("fixation_duration")}
              size="small"
              fullWidth
              placeholder="e.g. 12"
              sx={inputSx}
            />
            <FlagNote>Adequate fixation: 6-72 hours for IHC quality</FlagNote>
          </Box>
        </FG>
      </SectionBox>

      {/* Measurements & Physical Characteristics */}
      <SectionBox title="Measurements & Physical Characteristics">
        <FG cols={2}>
          <Box>
            <FieldLabel>Length (cm)</FieldLabel>
            <TextField
              type="number"
              step="0.1"
              value={f.length_cm}
              onChange={onInput("length_cm")}
              size="small"
              fullWidth
              sx={inputSx}
            />
          </Box>
          <Box>
            <FieldLabel>Width (cm)</FieldLabel>
            <TextField
              type="number"
              step="0.1"
              value={f.width_cm}
              onChange={onInput("width_cm")}
              size="small"
              fullWidth
              sx={inputSx}
            />
          </Box>
          <Box>
            <FieldLabel>Depth/Thickness (cm)</FieldLabel>
            <TextField
              type="number"
              step="0.1"
              value={f.depth_cm}
              onChange={onInput("depth_cm")}
              size="small"
              fullWidth
              sx={inputSx}
            />
          </Box>
          <Box>
            <FieldLabel>Weight (grams)</FieldLabel>
            <TextField
              type="number"
              value={f.weight_g}
              onChange={onInput("weight_g")}
              size="small"
              fullWidth
              sx={inputSx}
            />
          </Box>
          <Box>
            <FieldLabel>Color</FieldLabel>
            <Sel
              label="Color"
              options={GROSS_COLORS}
              value={f.color}
              onChange={set("color")}
            />
          </Box>
          <Box>
            <FieldLabel>Consistency</FieldLabel>
            <Sel
              label="Consistency"
              options={CONSISTENCIES}
              value={f.consistency}
              onChange={set("consistency")}
            />
          </Box>
        </FG>
      </SectionBox>

      {/* Tumor/Lesion Description */}
      <SectionBox title="Tumor/Lesion Description (CAP Core Elements)">
        <FG cols={2}>
          <Box>
            <FieldLabel>Tumor Size - Greatest Dimension (cm)</FieldLabel>
            <TextField
              type="number"
              step="0.1"
              value={f.tumor_greatest_dimension}
              onChange={onInput("tumor_greatest_dimension")}
              size="small"
              fullWidth
              sx={inputSx}
            />
            <FlagNote>Measured on fixed specimen</FlagNote>
          </Box>
          <Box>
            <FieldLabel>Additional Dimensions (cm)</FieldLabel>
            <TextField
              value={f.additional_dimensions}
              onChange={onInput("additional_dimensions")}
              size="small"
              fullWidth
              placeholder="e.g. 4.5 x 3.2"
              sx={inputSx}
            />
          </Box>
          <Box>
            <FieldLabel>Tumor Configuration</FieldLabel>
            <Sel
              label="Configuration"
              options={TUMOR_CONFIGURATIONS}
              value={f.tumor_configuration}
              onChange={set("tumor_configuration")}
            />
          </Box>
          <Box>
            <FieldLabel>Location/Quadrant</FieldLabel>
            <TextField
              value={f.tumor_location}
              onChange={onInput("tumor_location")}
              size="small"
              fullWidth
              placeholder="e.g. sigmoid colon, 20 cm from anal verge"
              sx={inputSx}
            />
          </Box>
        </FG>
        <Box sx={{ mt: 2 }}>
          <FieldLabel>Gross Description (Free Text)</FieldLabel>
          <TextField
            value={f.gross_description}
            onChange={onInput("gross_description")}
            size="small"
            fullWidth
            multiline
            minRows={3}
            placeholder="Detailed narrative description of the gross specimen appearance..."
            sx={inputSx}
          />
        </Box>
      </SectionBox>

      {/* Margins (CAP Required) */}
      <SectionBox title="Margins (CAP Required)">
        <FlagNote>Measure closest distance from tumor to each margin. Record in centimeters.</FlagNote>
        <FG cols={2}>
          <Box>
            <FieldLabel>Proximal Margin (cm)</FieldLabel>
            <TextField
              type="number"
              step="0.1"
              value={f.proximal_margin}
              onChange={onInput("proximal_margin")}
              size="small"
              fullWidth
              sx={inputSx}
            />
          </Box>
          <Box>
            <FieldLabel>Distal Margin (cm)</FieldLabel>
            <TextField
              type="number"
              step="0.1"
              value={f.distal_margin}
              onChange={onInput("distal_margin")}
              size="small"
              fullWidth
              sx={inputSx}
            />
          </Box>
          <Box>
            <FieldLabel>Radial/Circumferential Margin (cm)</FieldLabel>
            <TextField
              type="number"
              step="0.1"
              value={f.radial_margin}
              onChange={onInput("radial_margin")}
              size="small"
              fullWidth
              sx={inputSx}
            />
          </Box>
          <Box>
            <FieldLabel>Other Margins</FieldLabel>
            <TextField
              value={f.other_margins}
              onChange={onInput("other_margins")}
              size="small"
              fullWidth
              placeholder="e.g. superior/inferior"
              sx={inputSx}
            />
          </Box>
        </FG>
      </SectionBox>

      {/* Lymph Nodes (CAP Core Element) */}
      <SectionBox title="Lymph Nodes (CAP Core Element)">
        <FG cols={2}>
          <Box>
            <FieldLabel>Total Lymph Nodes Harvested</FieldLabel>
            <TextField
              type="number"
              value={f.total_lymph_nodes}
              onChange={onInput("total_lymph_nodes")}
              size="small"
              fullWidth
              sx={inputSx}
            />
            <FlagNote>Minimum 12 nodes recommended for colon cancer staging</FlagNote>
          </Box>
          <Box>
            <FieldLabel>Lymph Node Stations/Groups</FieldLabel>
            <TextField
              value={f.lymph_node_stations}
              onChange={onInput("lymph_node_stations")}
              size="small"
              fullWidth
              placeholder="e.g. pericolic, inferior mesenteric"
              sx={inputSx}
            />
          </Box>
        </FG>
        <Box sx={{ mt: 2 }}>
          <FieldLabel>Lymph Node Description</FieldLabel>
          <TextField
            value={f.lymph_node_description}
            onChange={onInput("lymph_node_description")}
            size="small"
            fullWidth
            multiline
            minRows={2}
            placeholder="Describe size, appearance, suspicious nodes..."
            sx={inputSx}
          />
        </Box>
      </SectionBox>

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
          Save Grossing
        </Button>
      </Box>

      <CapValidationDialog open={capOpen} onClose={() => setCapOpen(false)} title="Grossing CAP Validation" results={capResults} />
    </Box>
  );
}
