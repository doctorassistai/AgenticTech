import React, { useState, useEffect } from "react";
import {
  Box, Typography, TextField, Select, MenuItem, FormControl, InputLabel,
  Checkbox, FormControlLabel, FormGroup, RadioGroup, Radio,
  Table, TableHead, TableBody, TableRow, TableCell, TableContainer,
  Button, Snackbar, Alert, IconButton
} from "@mui/material";
import {
  SaveRounded, LocalHospitalRounded, CloseRounded, UploadFileRounded,
  MicRounded, StopRounded,
} from "@mui/icons-material";
import { motion } from "framer-motion";

import {
  C, FONT, FW_LIGHT, FW_NORMAL, inputSx, fieldLabelSx, flagNoteSx,
  sectionHeaderSx, saveBtnSx, outlineBtnSx, thSx, tdSx,
} from "./surgical-oncology/shared/designTokens";
import {
  SectionBox, FG, FieldLabel, FlagNote, ROInput, Sel, CbxGroup, RdoGroup,
  StatusBadge, SubTabBar,
} from "./surgical-oncology/shared/FormComponents";
import {
  saveLabResults, parseLabReportPdf,
} from "./surgical-oncology/shared/api";
import AnaesthesiaHistoryAccordion from "./AnaesthesiaHistoryAccordion";
import {
  getActiveAnaesthesiaRecord, createAnaesthesiaRecord, getAnaesthesiaRecords,
  saveAnaesthesiaSection, linkAnaesthesiaToBooking, completeAnaesthesiaRecord,
  structureAnaesthesiaChecklist, structureAnaesthesiaProcedure
} from "./shared/api";
//import { anaesthesiaBookingData } from "./anaesthesiaRecordSampleData";

// TEMP — meeting demo only.
const DEMO_MODE = true;

const API_BASE_URL = import.meta.env.VITE_BACKEND_URL || "https://doctorassist.ai/api/";

const safeMerge = (prev, incoming) => {
  const next = { ...prev };
  Object.entries(incoming || {}).forEach(([k, v]) => {
    const incomingEmpty = v === undefined || v === null || v === "" || (Array.isArray(v) && v.length === 0);
    if (!incomingEmpty) {
      if (Array.isArray(next[k]) && Array.isArray(v)) {
        next[k] = Array.from(new Set([...next[k], ...v]));
      } else {
        next[k] = v;
      }
    }
  });
  return next;
};

// ─── OT Checklist ─────────────────────────────────────────────────────────────

const MAIN_TABS = [
  { key: "checklist", label: "Anaesthesia Checklist", part: "Part A" },
  { key: "procedure", label: "Procedure", part: "Part B" },
];

// ─────────────────────────────────────────────────────────────────────────────
// ANAESTHESIA CHECKLIST (Part A)
// ─────────────────────────────────────────────────────────────────────────────
const ChecklistRow = ({ field, label, remarkField, remarkPlaceholder = "Remarks", data, set }) => (
  <TableRow sx={{ "&:hover": { background: C.bgSecondary } }}>
    <TableCell sx={tdSx}>{label}</TableCell>
    <TableCell sx={tdSx}>
      <RadioGroup row value={data[field] || ""} onChange={(e) => set(field, e.target.value)}>
        <FormControlLabel value="Yes" control={<Radio size="small" sx={{ color: C.border, "&.Mui-checked": { color: C.black }, p: 0.4 }} />} label={<Typography sx={{ fontSize: 13, fontFamily: FONT }}>Yes</Typography>} />
        <FormControlLabel value="No" control={<Radio size="small" sx={{ color: C.border, "&.Mui-checked": { color: C.black }, p: 0.4 }} />} label={<Typography sx={{ fontSize: 13, fontFamily: FONT }}>No</Typography>} />
      </RadioGroup>
    </TableCell>
    <TableCell sx={tdSx}>
      {remarkField && (
        <TextField
          size="small"
          placeholder={remarkPlaceholder}
          value={data[remarkField] || ""}
          onChange={(e) => set(remarkField, e.target.value)}
          sx={{ ...inputSx, width: "100%" }}
        />
      )}
    </TableCell>
  </TableRow>
);

const AnaesthesiaChecklistTab = ({ data, onChange, onSave }) => {
  const set = (key, value) => onChange({ ...data, [key]: value });

  // ── Speech-to-text transcribe + AI autofill
  const [isRecording, setIsRecording] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [transcript, setTranscript] = useState("");
  const [isAutofilling, setIsAutofilling] = useState(false);
  const mediaRecorderRef = React.useRef(null);
  const audioChunksRef = React.useRef([]);

  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      mediaRecorderRef.current = new MediaRecorder(stream);
      audioChunksRef.current = [];
      mediaRecorderRef.current.ondataavailable = e => {
        if (e.data.size > 0) audioChunksRef.current.push(e.data);
      };
      mediaRecorderRef.current.start();
      setIsRecording(true);
    } catch (err) {
      console.error("Error accessing microphone:", err);
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
          const res = await fetch(`${API_BASE_URL}hms/users/ai/elevenlabs/api/transcribe_labs`, { method: "POST", body: formData });
          const data = await res.json();
          console.log("ElevenLabs API Response:", data);
          const transcribedText = data.text || data.transcription || "";

          if (transcribedText) {
            console.log("Transcribed Text:", transcribedText);
            setTranscript(prev => prev ? prev + " " + transcribedText : transcribedText);
          }
        } catch (err) {
          console.error("Error processing audio:", err);
          alert("Error transcribing data.");
        } finally {
          setIsProcessing(false);
        }
      };
      mediaRecorderRef.current.stop();
      mediaRecorderRef.current.stream.getTracks().forEach(track => track.stop());
    }
  };

  const handleAutofill = async () => {
    if (!transcript) return;
    setIsAutofilling(true);
    try {
      const llmData = await structureAnaesthesiaChecklist(transcript);
      console.log("LLM Structured Data (Anaesthesia Checklist):", llmData);
      if (llmData.status === "success" && llmData.data) {
        onChange(safeMerge(data, llmData.data));
      }
    } catch (err) {
      console.error("Error structuring data:", err);
      alert("Error structuring data.");
    } finally {
      setIsAutofilling(false);
    }
  };

  return (
    <Box>
      <SectionBox title="Speech-to-Text Transcript">
        <TextField
          label="Transcript"
          value={transcript}
          size="small"
          multiline
          rows={4}
          onChange={e => setTranscript(e.target.value)}
          sx={inputSx}
          fullWidth
        />
        <Box sx={{ display: "flex", justifyContent: "flex-end", gap: 1.5, mt: 1.5 }}>
          <Button
            variant="contained"
            color={isRecording ? "error" : "primary"}
            onClick={isRecording ? stopRecording : startRecording}
            disabled={isProcessing || isAutofilling}
            sx={{ fontFamily: FONT, textTransform: "none", borderRadius: 1, boxShadow: "none", background: isRecording ? "#cf1322" : C.black, color: C.white, "&:hover": { background: isRecording ? "#a8071a" : "#333" } }}
            startIcon={isRecording ? <StopRounded /> : <MicRounded />}
          >
            {isProcessing ? "Processing..." : isRecording ? "Stop Recording" : "Start Recording"}
          </Button>
          <Button
            variant="contained"
            onClick={handleAutofill}
            disabled={isAutofilling || !transcript}
            sx={{ fontFamily: FONT, textTransform: "none", borderRadius: 1, boxShadow: "none", background: C.black, color: C.white, "&:hover": { background: "#333" } }}
          >
            {isAutofilling ? "Autofilling..." : "AI Autofill"}
          </Button>
        </Box>
      </SectionBox>

      <SectionBox title="Sign In — Before Induction of Anaesthesia">
        <TableContainer>
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell sx={{ ...thSx, width: "50%" }}>Verification Item</TableCell>
                <TableCell sx={thSx}>Status</TableCell>
                <TableCell sx={thSx}>Remarks</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              <ChecklistRow field="signin_consent" remarkField="signin_consent_remark" label="Anaesthesia consent obtained" data={data} set={set} />
              <ChecklistRow field="signin_machine" remarkField="signin_machine_remark" label="Anaesthesia Machine Check" data={data} set={set} />
              <ChecklistRow field="signin_oximeter" remarkField="signin_oximeter_remark" label="Pulse Oximeter on patient and functioning" data={data} set={set} />
              <ChecklistRow field="signin_airway" remarkField="signin_airway_remark" label="Difficult airway anticipated" data={data} set={set} />
              <ChecklistRow field="signin_aspiration" remarkField="signin_aspiration_remark" label="Aspiration risk" data={data} set={set} />
              <ChecklistRow field="signin_starvation" remarkField="signin_starvation_remark" label="Adequate starvation" remarkPlaceholder="Hours NPO" data={data} set={set} />
              <ChecklistRow field="signin_allergy" remarkField="signin_allergy_remark" label="Any Known Allergy?" remarkPlaceholder="Specify allergy" data={data} set={set} />
            </TableBody>
          </Table>
        </TableContainer>
      </SectionBox>

      <SectionBox title="Time Out — Before Skin Incision">
        <Box sx={{ mb: 2 }}>
          <FieldLabel>Anticipated Critical Events — From Anaesthesia Team</FieldLabel>
          <TextField
            value={data.timeout_anaesthesia_events || ""}
            onChange={(e) => set("timeout_anaesthesia_events", e.target.value)}
            multiline
            rows={3}
            sx={inputSx}
            fullWidth
            placeholder="Critical events / concerns"
          />
        </Box>
        <TableContainer>
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell sx={{ ...thSx, width: "50%" }}>Verification Item</TableCell>
                <TableCell sx={thSx}>Status</TableCell>
                <TableCell sx={thSx}>Remarks</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              <ChecklistRow field="timeout_antibiotic" remarkField="timeout_antibiotic_remark" label="Antibiotic Prophylaxis given" remarkPlaceholder="Drug / Dose / Time" data={data} set={set} />
              <ChecklistRow field="timeout_throat" remarkField="timeout_throat_remark" label="Throat pack inserted" data={data} set={set} />
            </TableBody>
          </Table>
        </TableContainer>
      </SectionBox>

      <SectionBox title="Sign Out — Before Patient Leaves OT">
        <Box>
          <FieldLabel>Post Op Care Concerns — Anaesthesia Team</FieldLabel>
          <TextField
            value={data.signout_concerns || ""}
            onChange={(e) => set("signout_concerns", e.target.value)}
            multiline
            rows={3}
            sx={inputSx}
            fullWidth
            placeholder="Post-op care concerns"
          />
        </Box>
      </SectionBox>

      <SectionBox title="Before Extubation">
        <TableContainer>
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell sx={{ ...thSx, width: "50%" }}>Verification Item</TableCell>
                <TableCell sx={thSx}>Status</TableCell>
                <TableCell sx={thSx}>Remarks</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              <ChecklistRow field="extubation_throat" remarkField="extubation_throat_remark" label="Throat pack removed before extubation" data={data} set={set} />
            </TableBody>
          </Table>
        </TableContainer>
      </SectionBox>

      <Button sx={saveBtnSx} onClick={() => onSave("anaesthesia.checklist", data)}>
        <SaveRounded sx={{ mr: 0.5, fontSize: 14 }} />
        Save Checklist
      </Button>
    </Box>
  );
};

// ─────────────────────────────────────────────────────────────────────────────
// LAB ORDER PANEL (shown on Anaesthesia Checklist tab, below Save Checklist)
// ─────────────────────────────────────────────────────────────────────────────
const LabOrderPanel = ({ bookingId, bookingData, doctorId, onSaved }) => {
  const labOrder = bookingData?.doctors_note?.labOrder || bookingData?.anaesthesia?.pi?.labOrder;
  const existingResults = bookingData?.doctors_note?.labResults || bookingData?.anaesthesia?.pi?.labResults;

  // Local state for the values the anaesthesia doctor fills in
  const [values, setValues] = useState({});
  const [isSaved, setIsSaved] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [pdfStatus, setPdfStatus] = useState(""); // feedback string after PDF parse
  const [isParsing, setIsParsing] = useState(false);

  // Sync state when data loads from backend (e.g. on reload)
  useEffect(() => {
    if (existingResults?.values) {
      const map = {};
      existingResults.values.forEach(v => { map[v.key] = v.value; });
      setValues(map);
      setIsSaved(!!existingResults.approved);
    }
  }, [existingResults]);

  // If no order has been sent yet, don't render the panel
  if (!labOrder || !["sent", "approved"].includes(labOrder.status)) return null;

  const fields = labOrder.fields || [];

  const handlePdfUpload = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = ""; // reset so same file can be re-uploaded
    setIsParsing(true);
    setPdfStatus("Parsing PDF…");
    try {
      const res = await parseLabReportPdf(file, fields.map(f => ({ key: f.key, label: f.label, unit: f.unit })));
      const matches = res.matches || [];
      const unmatched = res.unmatched || [];
      setValues(prev => {
        const next = { ...prev };
        matches.forEach(m => { next[m.key] = m.value; });
        return next;
      });
      setPdfStatus(
        matches.length > 0
          ? `✅ ${matches.length} field${matches.length > 1 ? "s" : ""} matched from PDF.${unmatched.length > 0 ? ` ${unmatched.length} not found — please enter manually.` : " All fields matched."
          }`
          : "⚠️ No fields could be matched automatically. Please enter values manually."
      );
    } catch (err) {
      console.error("[LabOrderPanel] PDF parse error:", err);
      setPdfStatus("⚠️ PDF parsing failed. Please enter values manually.");
    } finally {
      setIsParsing(false);
    }
  };

  const handleSave = async () => {
    if (!bookingId) return;
    setIsSaving(true);
    try {
      const valuesToSave = fields.map(f => ({
        key: f.key,
        value: values[f.key] || "",
        flag: "", // flag computation is done on display side
      }));
      await saveLabResults(bookingId, {
        approved: true,
        approvedAt: new Date().toISOString(),
        approvedBy: doctorId,
        values: valuesToSave,
      });
      setIsSaved(true);
      onSaved?.();
    } catch (err) {
      console.error("[LabOrderPanel] saveLabResults error:", err);
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <Box sx={{ mt: 3, pt: 3, borderTop: `2px solid ${C.border}` }}>
      {/* Header */}
      <Box sx={{ display: "flex", alignItems: "center", justifyContent: "space-between", mb: 2, flexWrap: "wrap", gap: 1 }}>
        <Box>
          <Typography sx={{ fontSize: 10, textTransform: "uppercase", letterSpacing: "0.12em", color: C.textMuted, fontFamily: FONT, mb: 0.25 }}>Pre-Induction</Typography>
          <Typography sx={{ fontSize: 15, fontFamily: FONT, fontWeight: FW_NORMAL, color: C.textPrimary }}>Lab Investigation Order</Typography>
          <Typography sx={{ fontSize: 11, fontFamily: FONT, color: C.textMuted, mt: 0.25 }}>Sent by Surgery team · {labOrder.sentAt ? new Date(labOrder.sentAt).toLocaleDateString() : ""}</Typography>
        </Box>
        <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
          {isSaved && (
            <Box sx={{ px: 1.5, py: 0.4, background: "#e6f7ee", border: "1px solid #52c41a", fontSize: 11, fontFamily: FONT, color: "#389e0d" }}>
              ✅ Saved
            </Box>
          )}
          {/* PDF upload */}
          <Button
            component="label"
            sx={{ ...outlineBtnSx, mt: 0, display: "flex", gap: 0.5 }}
            disabled={isParsing}
          >
            <UploadFileRounded sx={{ fontSize: 14 }} />
            {isParsing ? "Parsing…" : "Upload PDF Report"}
            <input type="file" accept="application/pdf" hidden onChange={handlePdfUpload} />
          </Button>
        </Box>
      </Box>

      {/* PDF parse feedback */}
      {pdfStatus && (
        <Alert
          severity={pdfStatus.startsWith("✅") ? "success" : "warning"}
          icon={false}
          sx={{ mb: 1.5, fontFamily: FONT, fontSize: 12, borderRadius: 0, border: `1px solid ${C.border}` }}
        >
          {pdfStatus}
        </Alert>
      )}

      {/* Fields table */}
      <TableContainer>
        <Table size="small">
          <TableHead>
            <TableRow>
              {["Test", "Unit", "Reference Range", "Surgery Pre-fill", "Enter Value"].map(h => (
                <TableCell key={h} sx={thSx}>{h}</TableCell>
              ))}
            </TableRow>
          </TableHead>
          <TableBody>
            {fields.map(f => (
              <TableRow key={f.key} sx={{ "&:hover": { background: C.bgSecondary } }}>
                <TableCell sx={tdSx}>
                  <Typography sx={{ fontSize: 12, fontFamily: FONT }}>{f.label}</Typography>
                  {f.isCustom && <Typography sx={{ fontSize: 10, color: C.textMuted, fontFamily: FONT }}>Custom</Typography>}
                </TableCell>
                <TableCell sx={tdSx}>{f.unit || "—"}</TableCell>
                <TableCell sx={tdSx}>{f.range || "—"}</TableCell>
                <TableCell sx={{ ...tdSx, color: C.textMuted, fontStyle: f.surgeryValue ? "normal" : "italic" }}>
                  {f.surgeryValue || "—"}
                </TableCell>
                <TableCell sx={tdSx}>
                  <TextField
                    size="small"
                    placeholder="Enter value"
                    value={values[f.key] || ""}
                    onChange={e => setValues(prev => ({ ...prev, [f.key]: e.target.value }))}
                    sx={{ ...inputSx, width: 130 }}
                  />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </TableContainer>

      {/* Save button */}
      <Box sx={{ mt: 2 }}>
        <Button sx={saveBtnSx} onClick={handleSave} disabled={isSaving}>
          <SaveRounded sx={{ mr: 0.5, fontSize: 14 }} />
          {isSaving ? "Saving…" : isSaved ? "Update Lab Results" : "Save Lab Results"}
        </Button>
        <Typography sx={{ fontSize: 11, fontFamily: FONT, color: C.textMuted, mt: 0.75 }}>
          Saving will mark the lab results as approved and notify the Surgery team.
        </Typography>
      </Box>
    </Box>
  );
};

// ─────────────────────────────────────────────────────────────────────────────
// PROCEDURE (Part B) - 6 Sub Tabs
// ─────────────────────────────────────────────────────────────────────────────

// ─────────────────────────────────────────────────────────────────────────────
// REUSABLE TRANSCRIBE PANEL (voice → transcript → AI structure → autofill)
// Used by every Procedure (Part B) sub-tab. `section` selects the backend prompt
// (mm | ga | reg | mac | io | eo); `onAutofill(data)` receives the structured JSON
// (flat sections shallow-merge; nested `reg` deep-merges — handled by the caller).
// ─────────────────────────────────────────────────────────────────────────────
const TranscribePanel = ({ section, onAutofill }) => {
  const [isRecording, setIsRecording] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [transcript, setTranscript] = useState("");
  const [isAutofilling, setIsAutofilling] = useState(false);
  const mediaRecorderRef = React.useRef(null);
  const audioChunksRef = React.useRef([]);

  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      mediaRecorderRef.current = new MediaRecorder(stream);
      audioChunksRef.current = [];
      mediaRecorderRef.current.ondataavailable = e => {
        if (e.data.size > 0) audioChunksRef.current.push(e.data);
      };
      mediaRecorderRef.current.start();
      setIsRecording(true);
    } catch (err) {
      console.error("Error accessing microphone:", err);
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
          const res = await fetch(`${API_BASE_URL}hms/users/ai/elevenlabs/api/transcribe_labs`, { method: "POST", body: formData });
          const data = await res.json();
          const transcribedText = data.text || data.transcription || "";
          if (transcribedText) setTranscript(prev => (prev ? `${prev} ${transcribedText}` : transcribedText));
        } catch (err) {
          console.error("Error processing audio:", err);
          alert("Error transcribing data.");
        } finally {
          setIsProcessing(false);
        }
      };
      mediaRecorderRef.current.stop();
      mediaRecorderRef.current.stream.getTracks().forEach(track => track.stop());
    }
  };

  const handleAutofill = async () => {
    if (!transcript) return;
    setIsAutofilling(true);
    try {
      const llmData = await structureAnaesthesiaProcedure(transcript, section);
      console.log(`LLM Structured Data (procedure: ${section}):`, llmData);
      if (llmData.status === "success" && llmData.data) {
        onAutofill(llmData.data);
      }
    } catch (err) {
      console.error("Error structuring data:", err);
      alert("Error structuring data.");
    } finally {
      setIsAutofilling(false);
    }
  };

  return (
    <SectionBox title="Speech-to-Text Transcript">
      <TextField
        label="Transcript"
        value={transcript}
        size="small"
        multiline
        rows={4}
        onChange={e => setTranscript(e.target.value)}
        sx={inputSx}
        fullWidth
        placeholder="Dictate the details for this section, then tap AI Autofill to populate the fields below."
      />
      <Box sx={{ display: "flex", justifyContent: "flex-end", gap: 1.5, mt: 1.5 }}>
        <Button
          variant="contained"
          color={isRecording ? "error" : "primary"}
          onClick={isRecording ? stopRecording : startRecording}
          disabled={isProcessing || isAutofilling}
          sx={{ fontFamily: FONT, textTransform: "none", borderRadius: 1, boxShadow: "none", background: isRecording ? "#cf1322" : C.black, color: C.white, "&:hover": { background: isRecording ? "#a8071a" : "#333" } }}
          startIcon={isRecording ? <StopRounded /> : <MicRounded />}
        >
          {isProcessing ? "Processing..." : isRecording ? "Stop Recording" : "Start Recording"}
        </Button>
        <Button
          variant="contained"
          onClick={handleAutofill}
          disabled={isAutofilling || !transcript}
          sx={{ fontFamily: FONT, textTransform: "none", borderRadius: 1, boxShadow: "none", background: C.black, color: C.white, "&:hover": { background: "#333" } }}
        >
          {isAutofilling ? "Autofilling..." : "AI Autofill"}
        </Button>
      </Box>
    </SectionBox>
  );
};

const DEFAULT_INTRA_OP_MONITORING = {
  "O2 (FiO2 %)": [{ time: "", value: "" }, { time: "", value: "" }],
  "N2O / Air": [{ time: "", value: "" }, { time: "", value: "" }],
  "Inhalation Agent": [{ time: "", value: "" }, { time: "", value: "" }],
  "IV Fluid": [{ time: "", value: "" }, { time: "", value: "" }],
  "Urine Output (ml)": [{ time: "", value: "" }, { time: "", value: "" }],
  "Blood Products": [{ time: "", value: "" }, { time: "", value: "" }],
};

const ProcedureTab = ({ onSave, getSection }) => {
  const [sub, setSub] = useState(0);
  const SUBS = ["Mode & Monitoring", "General Anaesthesia", "Regional Anaesthesia", "MAC / Local", "Intra-op / Fluids", "End Op / Post-op"];

  // ── Mode & Monitoring state
  const [mm, setMm] = useState({ modeAnaesthesia: "", monitors: [], ivTiming: "", ivType: "", centralSite: [], centralSize: [], centralAttempts: "", centralIssues: "", artSite: [], artLaterality: "", artSize: [], artTechnique: "", artAttempts: "", artOperators: "", intraOpMonitoring: DEFAULT_INTRA_OP_MONITORING, ...(getSection("mm") || {}) });
  const smm = (k, v) => setMm(p => ({ ...p, [k]: v }));

  // ── General Anaesthesia state
  const [ga, setGa] = useState({ inductionAgents: [], inductionDetails: "", airwayDevice: [], airwaySize: "", airwayAttempts: "", opioids: [], opioidDetails: "", relaxants: [], relaxantDetails: "", maintenanceMode: [], maintenanceDetails: "", nmMonitoring: "", reversalDetails: "", ...(getSection("ga") || {}) });
  const sga = (k, v) => setGa(p => ({ ...p, [k]: v }));

  // ── Regional Anaesthesia state
  const [reg, setReg] = useState({
    showSpinal: false, showEpidural: false, showCSE: false, showPNB: false, showFascial: false, showIVRA: false, showOther: false,
    otherDetails: "",
    spinal: { posture: "", needleType: "", needleSize: "", site: "", approach: "", attempts: "", operators: "", timing: [], startTime: "", endTime: "", la: "", concentration: "", volume: "", adjuvants: "", catheter: "", blockExtent: "", complications: [] },
    epidural: { posture: "", needleType: "", needleSize: "", site: [], insertionDetails: "", approach: "", technique: "", depthSpace: "", catheterDepth: "", attempts: "", operators: "", timing: [], startTime: "", endTime: "", la: "", concentration: "", volume: "", loadingDose: "", infusion: "", adjuvants: "", complications: [] },
    raTiming: "",
    pnb: { nerve: [], posture: "", laterality: "", technique: [], needleType: "", needleSize: "", site: "", timing: [], startTime: "", endTime: "", la: "", concentration: "", volume: "", adjuvants: "", catheter: "", blockExtent: "", blockExtentDetails: "", complications: "", comments: "" },
    fascial: { block: [], laterality: "", posture: "", usg: "", needleType: "", needleSize: "", timing: [], startTime: "", endTime: "", la: "", concentration: "", volume: "", adjuvants: "", catheter: "", blockExtent: "", blockExtentDetails: "", complications: "" },
    ivra: { limb: "", duration: "", la: "", concentration: "", volume: "", adjuvants: "", blockExtent: "", complications: "", tourniquet: "" },
    ...(getSection("reg") || {}),
  });
  const sreg = (path, v) => setReg(p => {
    const parts = path.split(".");
    if (parts.length === 1) return { ...p, [path]: v };
    return { ...p, [parts[0]]: { ...p[parts[0]], [parts[1]]: v } };
  });

  // ── MAC / Local state
  const [mac, setMac] = useState({ laDrug: "", laConc: "", laVolume: "", laRoute: [], additiveDrug: "", additiveConc: "", additiveVolume: "", propofol: "", ketamine: "", midazolam: "", fentanyl: "", dexmedetomidine: "", ramsay: "", oxygenSupp: "", complications: [], ...(getSection("mac") || {}) });
  const smac = (k, v) => setMac(p => ({ ...p, [k]: v }));

  // ── Intra-op state
  const [io, setIo] = useState({
    patientPosition: [], pressureAreas: "", eyesShut: "", normothermia: [], tempMonitoring: [],
    ivFluids: { ringerLactate: "", normalSaline: "", dns: "", dextrose5: "", dextrose10: "", plasmalyte: "", gelofusine: "", albumin20: "", albumin5: "", mannitol20: "", drl1: "", drl2: "", others: "" },
    bloodProducts: [
      { product: "Whole Blood", checked: false, volume: "", bagNo: "", reaction: "", details: "" },
      { product: "Packed Cells", checked: false, volume: "", bagNo: "", reaction: "", details: "" },
      { product: "FFP", checked: false, volume: "", bagNo: "", reaction: "", details: "" },
      { product: "Cryoprecipitate", checked: false, volume: "", bagNo: "", reaction: "", details: "" },
      { product: "Random Donor Platelets", checked: false, volume: "", bagNo: "", reaction: "", details: "" },
      { product: "Single Donor Platelets", checked: false, volume: "", bagNo: "", reaction: "", details: "" },
      { product: "Tranexamic Acid", checked: false, volume: "", bagNo: "", reaction: "", details: "" },
      { product: "Others", checked: false, volume: "", bagNo: "", reaction: "", details: "" },
    ],
    bloodLoss: "", urineOutput: "", otherLosses: "",
    complications: [], complicationDetails: "",
    ...(getSection("io") || {}),
  });
  const sio = (k, v) => setIo(p => ({ ...p, [k]: v }));
  const sivf = (k, v) => setIo(p => ({ ...p, ivFluids: { ...p.ivFluids, [k]: v } }));
  const sbp = (i, k, v) => setIo(p => { const a = [...p.bloodProducts]; a[i] = { ...a[i], [k]: v }; return { ...p, bloodProducts: a }; });

  // ── End Op state
  const [eo, setEo] = useState({
    reversalTime: "", reversalDrug: [], reversalDose: "", extubation: "", postOpVent: "",
    vasoactiveDrugs: [], postExtubComps: [], patientCondition: "", pr: "", bp: "", spo2: "", rr: "", temperature: "",
    airwayAdjunct: "", monitorLevel: "", oxygenSupp: "", npoHours: "", ivfRate: "", analgesics: "",
    antiemetics: "", chronicMeds: "", investigations: [], otherComments: "",
    ...(getSection("eo") || {}),
  });
  const seo = (k, v) => setEo(p => ({ ...p, [k]: v }));

  const sanitizeTime = (val) => {
    if (!val || typeof val !== "string") return val;
    const ampmMatch = val.trim().match(/^(\d{1,2}):(\d{2})(?::\d{2})?\s*(AM|PM)?$/i);
    if (ampmMatch) {
      let hours = parseInt(ampmMatch[1], 10);
      const minutes = ampmMatch[2];
      const ampm = ampmMatch[3];
      if (ampm) {
        if (ampm.toUpperCase() === "PM" && hours < 12) hours += 12;
        if (ampm.toUpperCase() === "AM" && hours === 12) hours = 0;
      }
      return `${String(hours).padStart(2, "0")}:${minutes}`;
    }
    return val;
  };

  const sanitizeNum = (val) => {
    if (typeof val === "number") return String(val);
    if (!val || typeof val !== "string") return val;
    const match = val.match(/\d+(\.\d+)?/);
    return match ? match[0] : "";
  };

  // ── AI-autofill merge handlers (one per sub-tab). Flat sections shallow-merge;
  //    `reg` deep-merges nested block objects so defaults aren't wiped (which would
  //    turn controlled inputs into uncontrolled ones).
  const fillMm = d => {
    const cleaned = { ...d };
    if (cleaned.intraOpMonitoring && typeof cleaned.intraOpMonitoring === "object") {
      const sanitizedMonitoring = {};
      Object.entries(cleaned.intraOpMonitoring).forEach(([k, rows]) => {
        if (Array.isArray(rows)) {
          sanitizedMonitoring[k] = rows.map(r => ({ ...r, time: sanitizeTime(r.time) }));
        }
      });
      cleaned.intraOpMonitoring = sanitizedMonitoring;
    }
    ["centralAttempts", "artAttempts", "artOperators"].forEach(k => { if (cleaned[k] !== undefined) cleaned[k] = sanitizeNum(cleaned[k]); });
    setMm(p => safeMerge(p, cleaned));
  };

  const fillGa = d => {
    const cleaned = { ...d };
    if (cleaned.timeInduction) cleaned.timeInduction = sanitizeTime(cleaned.timeInduction);
    ["vt", "rr", "peep", "airwayPressure", "etco2", "airwayAttempts", "airwayOperators"].forEach(k => { if (cleaned[k] !== undefined) cleaned[k] = sanitizeNum(cleaned[k]); });
    setGa(p => safeMerge(p, cleaned));
  };

  const fillMac = d => setMac(p => safeMerge(p, d));

  const fillEo = d => {
    const cleaned = { ...d };
    if (cleaned.reversalTime) cleaned.reversalTime = sanitizeTime(cleaned.reversalTime);
    ["ivfRate", "npoHours", "pr", "spo2", "rr", "temperature"].forEach(k => {
      if (cleaned[k] !== undefined) cleaned[k] = sanitizeNum(cleaned[k]);
    });
    setEo(p => safeMerge(p, cleaned));
  };

  const NESTED_REG_KEYS = ["spinal", "epidural", "pnb", "fascial", "ivra"];
  const fillReg = d => setReg(p => {
    const next = { ...p };
    Object.entries(d || {}).forEach(([k, v]) => {
      const incomingEmpty = v === undefined || v === null || v === "" || (Array.isArray(v) && v.length === 0);
      if (incomingEmpty) return;

      if (NESTED_REG_KEYS.includes(k) && v && typeof v === "object" && !Array.isArray(v)) {
        const blk = { ...v };
        if (blk.startTime) blk.startTime = sanitizeTime(blk.startTime);
        if (blk.endTime) blk.endTime = sanitizeTime(blk.endTime);
        ["attempts", "operators"].forEach(key => { if (blk[key] !== undefined) blk[key] = sanitizeNum(blk[key]); });
        next[k] = safeMerge(p[k], blk);
      } else {
        if (Array.isArray(next[k]) && Array.isArray(v)) {
          next[k] = Array.from(new Set([...next[k], ...v]));
        } else {
          next[k] = v;
        }
      }
    });
    return next;
  });
  const NESTED_IO_KEYS = ["ivFluids"];
  const fillIo = d => setIo(p => {
    const next = { ...p };
    Object.entries(d || {}).forEach(([k, v]) => {
      const incomingEmpty = v === undefined || v === null || v === "" || (Array.isArray(v) && v.length === 0);
      if (incomingEmpty) return;

      if (k === "ivFluids" && v && typeof v === "object" && !Array.isArray(v)) {
        next.ivFluids = safeMerge(p.ivFluids, v);
      } else if (k === "bloodProducts" && Array.isArray(v)) {
        // Merge incoming products onto the fixed template rows by product name.
        next.bloodProducts = p.bloodProducts.map(row => {
          const match = v.find(x => x.product === row.product);
          if (match) {
             const mergedRow = { ...row, checked: true };
             Object.entries(match).forEach(([mK, mV]) => {
               if (mV !== undefined && mV !== null && mV !== "") mergedRow[mK] = mV;
             });
             return mergedRow;
          }
          return row;
        });
      } else if (!NESTED_IO_KEYS.includes(k)) {
        if (Array.isArray(next[k]) && Array.isArray(v)) {
          next[k] = Array.from(new Set([...next[k], ...v]));
        } else {
          next[k] = v;
        }
      }
    });
    return next;
  });

  return (
    <Box>
      <SubTabBar tabs={SUBS} active={sub} onSelect={setSub} />

      {/* ── Sub-tab 0: Mode & Monitoring */}
      {sub === 0 && (
        <Box>
          <TranscribePanel section="mm" onAutofill={fillMm} />
          <SectionBox title="Mode of Anaesthesia">
            <RdoGroup label="Mode (Select One)" options={["General", "Regional", "Both (General + Regional)", "MAC"]} value={mm.modeAnaesthesia} onChange={v => smm("modeAnaesthesia", v)} />
          </SectionBox>
          <SectionBox title="Intra-operative Monitoring">
            <TableContainer>
              <Table size="small">
                <TableHead>
                  <TableRow>{["Particulars", "Time", "Value", "Time", "Value"].map((h, i) => <TableCell key={i} sx={thSx}>{h}</TableCell>)}</TableRow>
                </TableHead>
                <TableBody>
                  {["O2 (FiO2 %)", "N2O / Air", "Inhalation Agent", "IV Fluid", "Urine Output (ml)", "Blood Products"].map(row => {
                    const rowData = mm.intraOpMonitoring?.[row] || [{ time: "", value: "" }, { time: "", value: "" }];
                    return (
                      <TableRow key={row}>
                        <TableCell sx={tdSx}>{row}</TableCell>
                        {[0, 1].map(p => (
                          <React.Fragment key={p}>
                            <TableCell sx={tdSx}>
                              <TextField
                                type="time"
                                size="small"
                                value={rowData[p]?.time || ""}
                                onChange={(e) => {
                                  const newRowData = [...rowData];
                                  newRowData[p] = { ...newRowData[p], time: e.target.value };
                                  smm("intraOpMonitoring", { ...mm.intraOpMonitoring, [row]: newRowData });
                                }}
                                sx={{ ...inputSx, width: 110 }}
                                InputLabelProps={{ shrink: true }}
                              />
                            </TableCell>
                            <TableCell sx={tdSx}>
                              <TextField
                                size="small"
                                value={rowData[p]?.value || ""}
                                onChange={(e) => {
                                  const newRowData = [...rowData];
                                  newRowData[p] = { ...newRowData[p], value: e.target.value };
                                  smm("intraOpMonitoring", { ...mm.intraOpMonitoring, [row]: newRowData });
                                }}
                                sx={{ ...inputSx, width: 110 }}
                                placeholder="Value"
                              />
                            </TableCell>
                          </React.Fragment>
                        ))}
                      </TableRow>
                    );
                  })}
                  <TableRow>
                    <TableCell sx={tdSx}>Monitors Connected</TableCell>
                    <TableCell colSpan={4} sx={tdSx}>
                      <CbxGroup options={["ECG", "NIBP", "SpO2", "EtCO2", "Temp", "Pulse", "BP (Arterial)", "Others"]} value={mm.monitors} onChange={v => smm("monitors", v)} />
                    </TableCell>
                  </TableRow>
                </TableBody>
              </Table>
            </TableContainer>
          </SectionBox>
          <SectionBox title="IV Access">
            <FG cols={3}>
              <RdoGroup label="Timing" options={["Pre-Induction", "Post-Induction"]} value={mm.ivTiming} onChange={v => smm("ivTiming", v)} />
              <RdoGroup label="Type" options={["Peripheral", "Central"]} value={mm.ivType} onChange={v => smm("ivType", v)} />
              {mm.ivType === "Central" && (
                <>
                  <CbxGroup label="Site" options={["Internal Jugular Vein", "Subclavian Vein", "Femoral Vein"]} value={mm.centralSite} onChange={v => smm("centralSite", v)} />
                  <CbxGroup label="Size" options={["5F", "7F", "Others"]} value={mm.centralSize} onChange={v => smm("centralSize", v)} />
                  <TextField label="No of Attempts" value={mm.centralAttempts} type="number" size="small" onChange={e => smm("centralAttempts", e.target.value)} sx={inputSx} fullWidth />
                  <Box sx={{ gridColumn: "1/-1" }}>
                    <TextField label="Issues, if any" value={mm.centralIssues} size="small" multiline rows={2} onChange={e => smm("centralIssues", e.target.value)} sx={inputSx} fullWidth />
                  </Box>
                </>
              )}
            </FG>
          </SectionBox>
          <SectionBox title="Arterial Line">
            <FG cols={3}>
              <CbxGroup label="Site" options={["Radial", "Dorsalis Pedis", "Femoral"]} value={mm.artSite} onChange={v => smm("artSite", v)} />
              <RdoGroup label="Laterality" options={["Right", "Left"]} value={mm.artLaterality} onChange={v => smm("artLaterality", v)} />
              <CbxGroup label="Size (G)" options={["20G", "22G", "24G"]} value={mm.artSize} onChange={v => smm("artSize", v)} />
              <RdoGroup label="Technique" options={["Standard Canula", "Seldinger"]} value={mm.artTechnique} onChange={v => smm("artTechnique", v)} />
              <TextField label="No of Attempts" value={mm.artAttempts} type="number" size="small" onChange={e => smm("artAttempts", e.target.value)} sx={inputSx} fullWidth />
              <TextField label="No of Operators" value={mm.artOperators} type="number" size="small" onChange={e => smm("artOperators", e.target.value)} sx={inputSx} fullWidth />
              <Box sx={{ gridColumn: "1/-1" }}>
                <TextField label="Issues, if any" value={mm.artIssues} size="small" multiline rows={2} onChange={e => smm("artIssues", e.target.value)} sx={inputSx} fullWidth />
              </Box>
            </FG>
          </SectionBox>
          <Button sx={saveBtnSx} onClick={() => onSave("anaesthesia.mm", mm)}><SaveRounded sx={{ mr: 0.5, fontSize: 14 }} />Save Mode & Monitoring</Button>
        </Box>
      )}

      {/* ── Sub-tab 1: General Anaesthesia */}
      {sub === 1 && (
        <Box>
          <TranscribePanel section="ga" onAutofill={fillGa} />
          <SectionBox title="Induction">
            <FG cols={3}>
              <TextField label="Time of Induction" type="time" size="small" value={ga.timeInduction || ""} onChange={e => sga("timeInduction", e.target.value)} sx={inputSx} fullWidth InputLabelProps={{ shrink: true }} />
              <RdoGroup label="Preoxygenation" options={["Yes", "No"]} value={ga.preoxygenation} onChange={v => sga("preoxygenation", v)} />
              <RdoGroup label="Induction" options={["Intravenous", "Inhalational"]} value={ga.induction} onChange={v => sga("induction", v)} />
              <Box sx={{ gridColumn: "1/-1" }}>
                <CbxGroup label="Intubation Response Prevention" options={["Opioids", "NTG", "Lignocaine", "Esmolol", "Labetalol", "Other"]} value={ga.intubRespPrev} onChange={v => sga("intubRespPrev", v)} />
              </Box>
            </FG>
            <Box sx={{ mt: 1.5 }}>
              <Typography sx={{ fontSize: 11, fontFamily: FONT, color: C.textMuted, mb: 0.5, letterSpacing: "0.05em", textTransform: "uppercase" }}>IV Opioids</Typography>
              <FG cols={4}>
                <TextField label="Fentanyl Dose (mcg)" size="small" value={ga.ivOpioidFentanyl || ""} onChange={e => sga("ivOpioidFentanyl", e.target.value)} sx={inputSx} fullWidth />
                <TextField label="Morphine Dose (mg)" size="small" value={ga.ivOpioidMorphine || ""} onChange={e => sga("ivOpioidMorphine", e.target.value)} sx={inputSx} fullWidth />
                <TextField label="Tramadol Dose (mg)" size="small" value={ga.ivOpioidTramadol || ""} onChange={e => sga("ivOpioidTramadol", e.target.value)} sx={inputSx} fullWidth />
                <TextField label="Other (Specify & Dose)" size="small" value={ga.ivOpioidOther || ""} onChange={e => sga("ivOpioidOther", e.target.value)} sx={inputSx} fullWidth />
              </FG>
            </Box>
            <Box sx={{ mt: 1.5 }}>
              <Typography sx={{ fontSize: 11, fontFamily: FONT, color: C.textMuted, mb: 0.5, letterSpacing: "0.05em", textTransform: "uppercase" }}>IV Induction Agent</Typography>
              <FG cols={5}>
                <TextField label="Propofol (mg)" size="small" value={ga.ivInductionPropofol || ""} onChange={e => sga("ivInductionPropofol", e.target.value)} sx={inputSx} fullWidth />
                <TextField label="Ketamine (mg)" size="small" value={ga.ivInductionKetamine || ""} onChange={e => sga("ivInductionKetamine", e.target.value)} sx={inputSx} fullWidth />
                <TextField label="Etomidate (mg)" size="small" value={ga.ivInductionEtomidate || ""} onChange={e => sga("ivInductionEtomidate", e.target.value)} sx={inputSx} fullWidth />
                <TextField label="Thiopentone (mg)" size="small" value={ga.ivInductionThiopentone || ""} onChange={e => sga("ivInductionThiopentone", e.target.value)} sx={inputSx} fullWidth />
                <TextField label="Other (Specify & Dose)" size="small" value={ga.ivInductionOther || ""} onChange={e => sga("ivInductionOther", e.target.value)} sx={inputSx} fullWidth />
              </FG>
            </Box>
            <FG cols={2} sx={{ mt: 1.5 }}>
              <CbxGroup label="Carrier Gas Composition" options={["Air + O2", "N2O + O2"]} value={ga.carrierGas} onChange={v => sga("carrierGas", v)} />
              <CbxGroup label="Inhalation Agent" options={["Isoflurane", "Sevoflurane"]} value={ga.inhalationAgent} onChange={v => sga("inhalationAgent", v)} />
            </FG>
            <Box sx={{ mt: 1.5 }}>
              <Typography sx={{ fontSize: 11, fontFamily: FONT, color: C.textMuted, mb: 0.5, letterSpacing: "0.05em", textTransform: "uppercase" }}>Muscle Relaxant 1 - Intubation</Typography>
              <FG cols={5}>
                <TextField label="Succinyl Choline (mg)" size="small" value={ga.mr1Succ || ""} onChange={e => sga("mr1Succ", e.target.value)} sx={inputSx} fullWidth />
                <TextField label="Rocuronium (mg)" size="small" value={ga.mr1Roc || ""} onChange={e => sga("mr1Roc", e.target.value)} sx={inputSx} fullWidth />
                <TextField label="Vecuronium (mg)" size="small" value={ga.mr1Vec || ""} onChange={e => sga("mr1Vec", e.target.value)} sx={inputSx} fullWidth />
                <TextField label="Atracurium (mg)" size="small" value={ga.mr1Atr || ""} onChange={e => sga("mr1Atr", e.target.value)} sx={inputSx} fullWidth />
                <TextField label="Cis-Atracurium (mg)" size="small" value={ga.mr1Cis || ""} onChange={e => sga("mr1Cis", e.target.value)} sx={inputSx} fullWidth />
              </FG>
            </Box>
            <Box sx={{ mt: 1.5 }}>
              <Typography sx={{ fontSize: 11, fontFamily: FONT, color: C.textMuted, mb: 0.5, letterSpacing: "0.05em", textTransform: "uppercase" }}>Muscle Relaxant 2 - Maintenance</Typography>
              <FG cols={5}>
                <TextField label="Succinyl Choline (mg)" size="small" value={ga.mr2Succ || ""} onChange={e => sga("mr2Succ", e.target.value)} sx={inputSx} fullWidth />
                <TextField label="Rocuronium (mg)" size="small" value={ga.mr2Roc || ""} onChange={e => sga("mr2Roc", e.target.value)} sx={inputSx} fullWidth />
                <TextField label="Vecuronium (mg)" size="small" value={ga.mr2Vec || ""} onChange={e => sga("mr2Vec", e.target.value)} sx={inputSx} fullWidth />
                <TextField label="Atracurium (mg)" size="small" value={ga.mr2Atr || ""} onChange={e => sga("mr2Atr", e.target.value)} sx={inputSx} fullWidth />
                <TextField label="Cis-Atracurium (mg)" size="small" value={ga.mr2Cis || ""} onChange={e => sga("mr2Cis", e.target.value)} sx={inputSx} fullWidth />
              </FG>
            </Box>
          </SectionBox>

          <SectionBox title="Airway & Intubation">
            <Box sx={{ mb: 1.5 }}>
              <CbxGroup label="Airway and Oxygen Delivery Devices" options={["ETT Standard", "ETT Preformed", "Double Lumen", "With Bronchial Blocker", "SGD Supreme", "SGD AuraGain", "SGD iGel", "SGD ProSeal", "Face Mask", "Nasal Prongs", "Hudson Mask", "Rigid Bronchoscope", "Tracheostomy Tube", "Others"]} value={ga.airwayDevice} onChange={v => sga("airwayDevice", v)} />
            </Box>
            <FG cols={3}>
              <RdoGroup label="Mode of Intubation" options={["Awake", "GA + Muscle Relaxant", "GA + Spont. Ventilation", "Pre-Op Tracheostomy (LA)", "Not Applicable"]} value={ga.intubationMode} onChange={v => sga("intubationMode", v)} />
              <CbxGroup label="Method of Intubation" options={["Video Laryngoscope - C Blade", "Video Laryngoscope - D Blade", "Standard Laryngoscope", "Flexible Bronchoscope", "Others"]} value={ga.intubationMethod} onChange={v => sga("intubationMethod", v)} />
              <RdoGroup label="CL Grade" options={["1", "2A", "2B", "3", "4"]} value={ga.clGrade} onChange={v => sga("clGrade", v)} />
              <RdoGroup label="POGO (%)" options={["0", "25", "50", "75", "100"]} value={ga.pogo} onChange={v => sga("pogo", v)} />
              <CbxGroup label="Adjuncts" options={["Bougie", "Stylet", "Others"]} value={ga.adjuncts} onChange={v => sga("adjuncts", v)} />
              <TextField label="Number of Attempts" type="number" size="small" value={ga.airwayAttempts || ""} onChange={e => sga("airwayAttempts", e.target.value)} sx={inputSx} fullWidth />
              <TextField label="Number of Operators" type="number" size="small" value={ga.airwayOperators || ""} onChange={e => sga("airwayOperators", e.target.value)} sx={inputSx} fullWidth />
            </FG>
            <Box sx={{ mt: 1.5 }}>
              <CbxGroup label="Complications" options={["Desaturation < 90%", "Significant trauma", "Aspiration of stomach contents", "Aspiration of blood", "Others"]} value={ga.airwayComplications} onChange={v => sga("airwayComplications", v)} />
            </Box>
          </SectionBox>

          <SectionBox title="Maintenance & Ventilation">
            <FG cols={3}>
              <RdoGroup label="Inhalational Maintenance" options={["O2 + N2O + Volatile", "O2 + Air + Volatile"]} value={ga.maintInhalational} onChange={v => sga("maintInhalational", v)} />
              <CbxGroup label="TIVA / Inhalation Details" options={["Propofol", "Dexmedetomidine", "Remifentanil", "Others"]} value={ga.maintTiva} onChange={v => sga("maintTiva", v)} />
              <CbxGroup label="Breathing System" options={["Circle Absorber", "Jackson Rees", "Magill's", "Bains"]} value={ga.breathingSystem} onChange={v => sga("breathingSystem", v)} />
              <Box sx={{ gridColumn: "1/-1" }}>
                <CbxGroup label="Ventilator Mode" options={["Spontaneous", "Pressure Support", "Volume Control", "Pressure Control", "Others"]} value={ga.ventMode} onChange={v => sga("ventMode", v)} />
              </Box>
            </FG>
            <Box sx={{ mt: 1.5 }}>
              <Typography sx={{ fontSize: 11, fontFamily: FONT, color: C.textMuted, mb: 0.5, letterSpacing: "0.05em", textTransform: "uppercase" }}>Non-Opioid Analgesic Drugs</Typography>
              <FG cols={3}>
                <TextField label="Paracetamol (mg)" size="small" value={ga.nonOpioidPara || ""} onChange={e => sga("nonOpioidPara", e.target.value)} sx={inputSx} fullWidth />
                <TextField label="Diclofenac (mg)" size="small" value={ga.nonOpioidDiclo || ""} onChange={e => sga("nonOpioidDiclo", e.target.value)} sx={inputSx} fullWidth />
                <TextField label="Others (Specify & Dose)" size="small" value={ga.nonOpioidOther || ""} onChange={e => sga("nonOpioidOther", e.target.value)} sx={inputSx} fullWidth />
              </FG>
            </Box>
            <Box sx={{ mt: 1.5 }}>
              <Typography sx={{ fontSize: 11, fontFamily: FONT, color: C.textMuted, mb: 0.5, letterSpacing: "0.05em", textTransform: "uppercase" }}>Antiemetic Drugs</Typography>
              <FG cols={4}>
                <TextField label="Metoclopramide (mg)" size="small" value={ga.antiemeticMetoclo || ""} onChange={e => sga("antiemeticMetoclo", e.target.value)} sx={inputSx} fullWidth />
                <TextField label="Ondansetron (mg)" size="small" value={ga.antiemeticOndan || ""} onChange={e => sga("antiemeticOndan", e.target.value)} sx={inputSx} fullWidth />
                <TextField label="Dexamethasone (mg)" size="small" value={ga.antiemeticDexa || ""} onChange={e => sga("antiemeticDexa", e.target.value)} sx={inputSx} fullWidth />
                <TextField label="Others (Specify & Dose)" size="small" value={ga.antiemeticOther || ""} onChange={e => sga("antiemeticOther", e.target.value)} sx={inputSx} fullWidth />
              </FG>
            </Box>
          </SectionBox>

          <SectionBox title="Ventilation Settings">
            <FG cols={3}>
              <TextField label="Tidal Volume / Preset Pressure" size="small" value={ga.vt || ""} onChange={e => sga("vt", e.target.value)} sx={inputSx} fullWidth placeholder="ml or cmH2O" />
              <TextField label="Rate / Minute" type="number" size="small" value={ga.rr || ""} onChange={e => sga("rr", e.target.value)} sx={inputSx} fullWidth placeholder="Breaths/min" />
              <TextField label="I:E Ratio" size="small" value={ga.ieRatio || ""} onChange={e => sga("ieRatio", e.target.value)} sx={inputSx} fullWidth placeholder="e.g., 1:2" />
              <TextField label="PEEP (cm H2O)" type="number" size="small" value={ga.peep || ""} onChange={e => sga("peep", e.target.value)} sx={inputSx} fullWidth />
              <TextField label="Airway Pressure (cm H2O)" type="number" size="small" value={ga.airwayPressure || ""} onChange={e => sga("airwayPressure", e.target.value)} sx={inputSx} fullWidth />
              <TextField label="EtCO2 (mm Hg)" type="number" size="small" value={ga.etco2 || ""} onChange={e => sga("etco2", e.target.value)} sx={inputSx} fullWidth />
              <RdoGroup label="Gas Scavenging" options={["Yes", "No"]} value={ga.gasScavenging} onChange={v => sga("gasScavenging", v)} />
            </FG>
          </SectionBox>
          <Button sx={saveBtnSx} onClick={() => onSave("anaesthesia.ga", ga)}><SaveRounded sx={{ mr: 0.5, fontSize: 14 }} />Save General Anaesthesia</Button>
        </Box>
      )}

      {/* ── Sub-tab 2: Regional Anaesthesia */}
      {sub === 2 && (
        <Box>
          <TranscribePanel section="reg" onAutofill={fillReg} />
          <SectionBox title="Select Regional Block Type(s)">
            <Box sx={{ display: "flex", flexWrap: "wrap", gap: 1 }}>
              {[["showSpinal", "Spinal"], ["showEpidural", "Epidural"], ["showCSE", "CSE"], ["showPNB", "Peripheral Nerve Block"], ["showFascial", "Fascial Plane Block"], ["showIVRA", "IVRA"], ["showOther", "Others"]].map(([key, label]) => (
                <Box key={key} onClick={() => sreg(key, !reg[key])}
                  sx={{ px: 2, py: 0.7, border: `1px solid ${reg[key] ? C.black : C.border}`, background: reg[key] ? C.black : C.white, color: reg[key] ? C.white : C.textSecond, fontSize: 12, fontFamily: FONT, cursor: "pointer", transition: "all 0.15s", "&:hover": { borderColor: C.black } }}>
                  {label}
                </Box>
              ))}
            </Box>
            {reg.showOther && (
              <Box sx={{ mt: 2 }}>
                <TextField label="Other (Specify)" value={reg.otherDetails || ""} size="small" onChange={e => sreg("otherDetails", e.target.value)} sx={inputSx} fullWidth />
              </Box>
            )}
            <Box sx={{ mt: 2 }}>
              <RdoGroup label="Regional Anaesthesia Timing" options={["Asleep", "Awake"]} value={reg.raTiming} onChange={v => sreg("raTiming", v)} />
            </Box>
          </SectionBox>

          {reg.showSpinal && (
            <SectionBox title="1. Spinal Anaesthesia">
              <FG cols={3}>
                <RdoGroup label="Posture" options={["Lateral", "Sitting"]} value={reg.spinal.posture} onChange={v => sreg("spinal.posture", v)} />
                <TextField label="Needle Type" value={reg.spinal.needleType} size="small" onChange={e => sreg("spinal.needleType", e.target.value)} sx={inputSx} fullWidth />
                <TextField label="Size" value={reg.spinal.needleSize} size="small" onChange={e => sreg("spinal.needleSize", e.target.value)} sx={inputSx} fullWidth />
                <RdoGroup label="Site of Insertion" options={["L3-L4", "L4-L5", "Others"]} value={reg.spinal.site} onChange={v => sreg("spinal.site", v)} />
                <RdoGroup label="Approach" options={["Median", "Paramedian"]} value={reg.spinal.approach} onChange={v => sreg("spinal.approach", v)} />
                <TextField label="No of Attempts" value={reg.spinal.attempts} type="number" size="small" onChange={e => sreg("spinal.attempts", e.target.value)} sx={inputSx} fullWidth />
                <TextField label="No of Operators" value={reg.spinal.operators} type="number" size="small" onChange={e => sreg("spinal.operators", e.target.value)} sx={inputSx} fullWidth />
                <Box sx={{ gridColumn: "1/-1" }}>
                  <CbxGroup label="Time" options={["Start of Surgery", "End of Surgery"]} value={reg.spinal.timing} onChange={v => sreg("spinal.timing", v)} />
                  {(reg.spinal.timing || []).length > 0 && (
                    <Box sx={{ display: "flex", gap: 2, mt: 1 }}>
                      {reg.spinal.timing.includes("Start of Surgery") && (
                        <TextField label="Start Time" type="time" value={reg.spinal.startTime || ""} size="small" onChange={e => sreg("spinal.startTime", e.target.value)} sx={{ ...inputSx, minWidth: 160 }} InputLabelProps={{ shrink: true }} />
                      )}
                      {reg.spinal.timing.includes("End of Surgery") && (
                        <TextField label="End Time" type="time" value={reg.spinal.endTime || ""} size="small" onChange={e => sreg("spinal.endTime", e.target.value)} sx={{ ...inputSx, minWidth: 160 }} InputLabelProps={{ shrink: true }} />
                      )}
                    </Box>
                  )}
                </Box>
                <TextField label="Local Anaesthetic" value={reg.spinal.la} size="small" onChange={e => sreg("spinal.la", e.target.value)} sx={inputSx} fullWidth />
                <TextField label="Concentration (%)" value={reg.spinal.concentration} size="small" onChange={e => sreg("spinal.concentration", e.target.value)} sx={inputSx} fullWidth />
                <TextField label="Volume (ml)" value={reg.spinal.volume} size="small" onChange={e => sreg("spinal.volume", e.target.value)} sx={inputSx} fullWidth />
                <Box sx={{ gridColumn: "1/-1" }}><TextField label="Adjuvants (Drug and Dose)" value={reg.spinal.adjuvants} size="small" multiline rows={2} onChange={e => sreg("spinal.adjuvants", e.target.value)} sx={inputSx} fullWidth /></Box>

                <Box sx={{ display: "flex", gap: 2 }}>
                  <RdoGroup label="Spinal Catheter" options={["Yes", "No"]} value={reg.spinal.catheter} onChange={v => sreg("spinal.catheter", v)} />
                  {reg.spinal.catheter === "Yes" && <TextField label="Catheter Details" value={reg.spinal.catheterDetails || ""} size="small" onChange={e => sreg("spinal.catheterDetails", e.target.value)} sx={{ ...inputSx, flex: 1 }} />}
                </Box>
                <Box sx={{ display: "flex", gap: 2, gridColumn: "span 2" }}>
                  <RdoGroup label="Extent of Block" options={["Checked", "Not checked"]} value={reg.spinal.blockExtent} onChange={v => sreg("spinal.blockExtent", v)} />
                  {reg.spinal.blockExtent === "Checked" && <TextField label="Details" value={reg.spinal.blockExtentDetails || ""} size="small" onChange={e => sreg("spinal.blockExtentDetails", e.target.value)} sx={{ ...inputSx, flex: 1 }} />}
                </Box>

                <Box sx={{ gridColumn: "1/-1" }}>
                  <CbxGroup label="Complications" options={["No action", "Inadequate", "High Spinal", "Total Spinal", "Severe hypotension", "Others"]} value={reg.spinal.complications} onChange={v => sreg("spinal.complications", v)} />
                </Box>
              </FG>
            </SectionBox>
          )}

          {reg.showEpidural && (
            <SectionBox title="2. Epidural Anaesthesia">
              <FG cols={3}>
                <RdoGroup label="Posture" options={["Lateral", "Sitting"]} value={reg.epidural.posture} onChange={v => sreg("epidural.posture", v)} />
                <TextField label="Needle Type" value={reg.epidural.needleType} size="small" onChange={e => sreg("epidural.needleType", e.target.value)} sx={inputSx} fullWidth />
                <TextField label="Size" value={reg.epidural.needleSize} size="small" onChange={e => sreg("epidural.needleSize", e.target.value)} sx={inputSx} fullWidth />
                <CbxGroup label="Site of Insertion" options={["Lumbar", "Thoracic", "Others"]} value={reg.epidural.site} onChange={v => sreg("epidural.site", v)} />
                <Box sx={{ gridColumn: "1/-1" }}><TextField label="Insertion Details" value={reg.epidural.insertionDetails} size="small" multiline rows={2} onChange={e => sreg("epidural.insertionDetails", e.target.value)} sx={inputSx} fullWidth /></Box>
                <RdoGroup label="Approach" options={["Median", "Paramedian"]} value={reg.epidural.approach} onChange={v => sreg("epidural.approach", v)} />
                <Box sx={{ gridColumn: "1/-1" }}>
                  <RdoGroup label="Technique" options={["Intermittent LOR - Air", "Intermittent LOR - Saline", "Continuous Saline", "Hanging drop", "Others"]} value={reg.epidural.technique} onChange={v => sreg("epidural.technique", v)} row={false} />
                  <FlagNote>Single choice possible</FlagNote>
                </Box>
                <TextField label="Depth of Epidural Space (cm)" value={reg.epidural.depthSpace} size="small" onChange={e => sreg("epidural.depthSpace", e.target.value)} sx={inputSx} fullWidth />
                <TextField label="Depth of Catheter Insertion (cm)" value={reg.epidural.catheterDepth} size="small" onChange={e => sreg("epidural.catheterDepth", e.target.value)} sx={inputSx} fullWidth />
                <TextField label="No of Attempts" value={reg.epidural.attempts} type="number" size="small" onChange={e => sreg("epidural.attempts", e.target.value)} sx={inputSx} fullWidth />
                <TextField label="No of Operators" value={reg.epidural.operators} type="number" size="small" onChange={e => sreg("epidural.operators", e.target.value)} sx={inputSx} fullWidth />
                <Box sx={{ gridColumn: "1/-1" }}>
                  <CbxGroup label="Time" options={["Start of Surgery", "End of Surgery"]} value={reg.epidural.timing} onChange={v => sreg("epidural.timing", v)} />
                  {(reg.epidural.timing || []).length > 0 && (
                    <Box sx={{ display: "flex", gap: 2, mt: 1 }}>
                      {reg.epidural.timing.includes("Start of Surgery") && (
                        <TextField label="Start Time" type="time" value={reg.epidural.startTime || ""} size="small" onChange={e => sreg("epidural.startTime", e.target.value)} sx={{ ...inputSx, minWidth: 160 }} InputLabelProps={{ shrink: true }} />
                      )}
                      {reg.epidural.timing.includes("End of Surgery") && (
                        <TextField label="End Time" type="time" value={reg.epidural.endTime || ""} size="small" onChange={e => sreg("epidural.endTime", e.target.value)} sx={{ ...inputSx, minWidth: 160 }} InputLabelProps={{ shrink: true }} />
                      )}
                    </Box>
                  )}
                </Box>

                <Box sx={{ gridColumn: "1/-1", mt: 1, p: 1, border: `1px solid ${C.border}`, borderRadius: 1 }}>
                  <Typography sx={{ fontSize: 12, fontWeight: 500, fontFamily: FONT, mb: 1 }}>Test Dose</Typography>
                  <FG cols={3}>
                    <Box sx={{ display: "flex", gap: 1 }}>
                      <Checkbox size="small" checked={!!reg.epidural.testIntrathecal} onChange={e => sreg("epidural.testIntrathecal", e.target.checked)} />
                      <TextField label="For Intrathecal (Drug & Dose)" size="small" value={reg.epidural.testIntrathecalDetails || ""} onChange={e => sreg("epidural.testIntrathecalDetails", e.target.value)} sx={inputSx} fullWidth />
                    </Box>
                    <Box sx={{ display: "flex", gap: 1 }}>
                      <Checkbox size="small" checked={!!reg.epidural.testIntravascular} onChange={e => sreg("epidural.testIntravascular", e.target.checked)} />
                      <TextField label="For Intravascular (Drug & Dose)" size="small" value={reg.epidural.testIntravascularDetails || ""} onChange={e => sreg("epidural.testIntravascularDetails", e.target.value)} sx={inputSx} fullWidth />
                    </Box>
                    <Box sx={{ display: "flex", gap: 1 }}>
                      <Checkbox size="small" checked={!!reg.epidural.testPositive} onChange={e => sreg("epidural.testPositive", e.target.checked)} />
                      <TextField label="Positive Details" size="small" value={reg.epidural.testPositiveDetails || ""} onChange={e => sreg("epidural.testPositiveDetails", e.target.value)} sx={inputSx} fullWidth />
                    </Box>
                    <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
                      <Checkbox size="small" checked={!!reg.epidural.testNegative} onChange={e => sreg("epidural.testNegative", e.target.checked)} />
                      <Typography sx={{ fontSize: 12, fontFamily: FONT }}>Negative</Typography>
                    </Box>
                  </FG>
                </Box>

                <TextField label="Local Anaesthetic" value={reg.epidural.la} size="small" onChange={e => sreg("epidural.la", e.target.value)} sx={inputSx} fullWidth />
                <TextField label="Concentration (%)" value={reg.epidural.concentration} size="small" onChange={e => sreg("epidural.concentration", e.target.value)} sx={inputSx} fullWidth />
                <TextField label="Volume (ml)" value={reg.epidural.volume} size="small" onChange={e => sreg("epidural.volume", e.target.value)} sx={inputSx} fullWidth />
                <TextField label="Loading Dose" value={reg.epidural.loadingDose} size="small" onChange={e => sreg("epidural.loadingDose", e.target.value)} sx={inputSx} fullWidth />
                <TextField label="Infusion" value={reg.epidural.infusion} size="small" onChange={e => sreg("epidural.infusion", e.target.value)} sx={inputSx} fullWidth />
                <Box sx={{ gridColumn: "1/-1" }}><TextField label="Adjuvants (Drug and Dose)" value={reg.epidural.adjuvants} size="small" multiline rows={2} onChange={e => sreg("epidural.adjuvants", e.target.value)} sx={inputSx} fullWidth /></Box>

                <Box sx={{ display: "flex", gap: 2, gridColumn: "1/-1" }}>
                  <RdoGroup label="Extent of Block" options={["Checked", "Not checked"]} value={reg.epidural.blockExtent} onChange={v => sreg("epidural.blockExtent", v)} />
                  {reg.epidural.blockExtent === "Checked" && <TextField label="Details" value={reg.epidural.blockExtentDetails || ""} size="small" onChange={e => sreg("epidural.blockExtentDetails", e.target.value)} sx={{ ...inputSx, flex: 1, mt: 2 }} />}
                </Box>

                <Box sx={{ gridColumn: "1/-1" }}><CbxGroup label="Complications" options={["None", "Inadequate", "Intravascular injection", "Dural puncture", "High block", "Others"]} value={reg.epidural.complications} onChange={v => sreg("epidural.complications", v)} /></Box>
              </FG>
            </SectionBox>
          )}

          {reg.showCSE && (
            <SectionBox title="3. Combined Spinal Epidural (CSE)">
              <FG cols={1}>
                <RdoGroup label="Technique" options={["Spinal followed by Epidural", "Epidural followed by Spinal"]} value={reg.cseTechnique} onChange={v => sreg("cseTechnique", v)} />
              </FG>
              <Typography sx={{ mt: 1, fontSize: 11, fontFamily: FONT, color: C.textMuted }}>* Please also open both Spinal and Epidural sections above to fill in the respective details.</Typography>
            </SectionBox>
          )}

          {reg.showPNB && (
            <SectionBox title="4. Peripheral Nerve Block">
              <Box sx={{ mb: 1.5 }}>
                <CbxGroup label="Name of Block" options={["Brachial Plexus - Interscalene", "Brachial Plexus - Supraclavicular", "Brachial Plexus - Axillary", "Other Upper Limb", "Femoral", "Sciatic", "Other Lower Limb", "Others"]} value={reg.pnb.nerve || []} onChange={v => sreg("pnb.nerve", v)} />
                <FlagNote>Multiple choice possible</FlagNote>
              </Box>
              <FG cols={3}>
                <RdoGroup label="Posture" options={["Lateral", "Sitting"]} value={reg.pnb.posture} onChange={v => sreg("pnb.posture", v)} />
                <RdoGroup label="Laterality" options={["Right", "Left", "Bilateral"]} value={reg.pnb.laterality} onChange={v => sreg("pnb.laterality", v)} />
                <CbxGroup label="Technique" options={["USG Guided", "Nerve Stimulator Guided", "Landmark Technique"]} value={reg.pnb.technique || []} onChange={v => sreg("pnb.technique", v)} />
                <TextField label="Needle Type" value={reg.pnb.needleType} size="small" onChange={e => sreg("pnb.needleType", e.target.value)} sx={inputSx} fullWidth />
                <TextField label="Size" value={reg.pnb.needleSize} size="small" onChange={e => sreg("pnb.needleSize", e.target.value)} sx={inputSx} fullWidth />
                <TextField label="Site of Insertion" value={reg.pnb.site} size="small" onChange={e => sreg("pnb.site", e.target.value)} sx={inputSx} fullWidth />
                <Box sx={{ gridColumn: "1/-1" }}>
                  <CbxGroup label="Time" options={["Start of Surgery", "End of Surgery"]} value={reg.pnb.timing} onChange={v => sreg("pnb.timing", v)} />
                  {(reg.pnb.timing || []).length > 0 && (
                    <Box sx={{ display: "flex", gap: 2, mt: 1 }}>
                      {reg.pnb.timing.includes("Start of Surgery") && (
                        <TextField label="Start Time" type="time" value={reg.pnb.startTime || ""} size="small" onChange={e => sreg("pnb.startTime", e.target.value)} sx={{ ...inputSx, minWidth: 160 }} InputLabelProps={{ shrink: true }} />
                      )}
                      {reg.pnb.timing.includes("End of Surgery") && (
                        <TextField label="End Time" type="time" value={reg.pnb.endTime || ""} size="small" onChange={e => sreg("pnb.endTime", e.target.value)} sx={{ ...inputSx, minWidth: 160 }} InputLabelProps={{ shrink: true }} />
                      )}
                    </Box>
                  )}
                </Box>
                <TextField label="Local Anaesthetic" value={reg.pnb.la} size="small" onChange={e => sreg("pnb.la", e.target.value)} sx={inputSx} fullWidth />
                <TextField label="Concentration (%)" value={reg.pnb.concentration} size="small" onChange={e => sreg("pnb.concentration", e.target.value)} sx={inputSx} fullWidth />
                <TextField label="Volume (ml)" value={reg.pnb.volume} size="small" onChange={e => sreg("pnb.volume", e.target.value)} sx={inputSx} fullWidth />
                <Box sx={{ gridColumn: "1/-1" }}><TextField label="Adjuvants (Drug, Concentration, Volume)" value={reg.pnb.adjuvants} size="small" multiline rows={2} onChange={e => sreg("pnb.adjuvants", e.target.value)} sx={inputSx} fullWidth /></Box>
                <RdoGroup label="Catheter" options={["Yes", "No"]} value={reg.pnb.catheter} onChange={v => sreg("pnb.catheter", v)} />
                <Box sx={{ display: "flex", gap: 2, gridColumn: "span 2" }}>
                  <RdoGroup label="Extent of Block" options={["Checked", "Not checked"]} value={reg.pnb.blockExtent} onChange={v => sreg("pnb.blockExtent", v)} />
                  {reg.pnb.blockExtent === "Checked" && <TextField label="Details" value={reg.pnb.blockExtentDetails || ""} size="small" onChange={e => sreg("pnb.blockExtentDetails", e.target.value)} sx={{ ...inputSx, flex: 1 }} />}
                </Box>
                <Box sx={{ gridColumn: "1/-1" }}><TextField label="Complications" value={reg.pnb.complications} size="small" multiline rows={2} onChange={e => sreg("pnb.complications", e.target.value)} sx={inputSx} fullWidth placeholder="Complications if any" /></Box>
                <Box sx={{ gridColumn: "1/-1" }}><TextField label="Any Other Comments" value={reg.pnb.comments} size="small" multiline rows={2} onChange={e => sreg("pnb.comments", e.target.value)} sx={inputSx} fullWidth /></Box>
              </FG>
            </SectionBox>
          )}

          {reg.showFascial && (
            <SectionBox title="5. Fascial Plane Block">
              <Box sx={{ mb: 1.5 }}>
                <CbxGroup label="Name of Fascial Block" options={["Thoracic", "Abdominal", "Others"]} value={reg.fascial.block || []} onChange={v => sreg("fascial.block", v)} />
                <FlagNote>Multiple choice possible with details of each option</FlagNote>
              </Box>
              <FG cols={3}>
                <RdoGroup label="Laterality" options={["Right", "Left", "Bilateral"]} value={reg.fascial.laterality} onChange={v => sreg("fascial.laterality", v)} />
                <RdoGroup label="Posture" options={["Lateral", "Sitting"]} value={reg.fascial.posture} onChange={v => sreg("fascial.posture", v)} />
                <RdoGroup label="USG Guided" options={["Yes", "No"]} value={reg.fascial.usg} onChange={v => sreg("fascial.usg", v)} />
                <TextField label="Needle Type" value={reg.fascial.needleType} size="small" onChange={e => sreg("fascial.needleType", e.target.value)} sx={inputSx} fullWidth />
                <TextField label="Size" value={reg.fascial.needleSize} size="small" onChange={e => sreg("fascial.needleSize", e.target.value)} sx={inputSx} fullWidth />
                <Box sx={{ gridColumn: "1/-1" }}>
                  <CbxGroup label="Time" options={["Start of Surgery", "End of Surgery"]} value={reg.fascial.timing} onChange={v => sreg("fascial.timing", v)} />
                  {(reg.fascial.timing || []).length > 0 && (
                    <Box sx={{ display: "flex", gap: 2, mt: 1 }}>
                      {reg.fascial.timing.includes("Start of Surgery") && (
                        <TextField label="Start Time" type="time" value={reg.fascial.startTime || ""} size="small" onChange={e => sreg("fascial.startTime", e.target.value)} sx={{ ...inputSx, minWidth: 160 }} InputLabelProps={{ shrink: true }} />
                      )}
                      {reg.fascial.timing.includes("End of Surgery") && (
                        <TextField label="End Time" type="time" value={reg.fascial.endTime || ""} size="small" onChange={e => sreg("fascial.endTime", e.target.value)} sx={{ ...inputSx, minWidth: 160 }} InputLabelProps={{ shrink: true }} />
                      )}
                    </Box>
                  )}
                </Box>
                <TextField label="Local Anaesthetic" value={reg.fascial.la} size="small" onChange={e => sreg("fascial.la", e.target.value)} sx={inputSx} fullWidth />
                <TextField label="Concentration (%)" value={reg.fascial.concentration} size="small" onChange={e => sreg("fascial.concentration", e.target.value)} sx={inputSx} fullWidth />
                <TextField label="Volume (ml)" value={reg.fascial.volume} size="small" onChange={e => sreg("fascial.volume", e.target.value)} sx={inputSx} fullWidth />
                <Box sx={{ gridColumn: "1/-1" }}><TextField label="Adjuvants (Drug, Concentration, Volume)" value={reg.fascial.adjuvants} size="small" multiline rows={2} onChange={e => sreg("fascial.adjuvants", e.target.value)} sx={inputSx} fullWidth /></Box>
                <RdoGroup label="Catheter" options={["Yes", "No"]} value={reg.fascial.catheter} onChange={v => sreg("fascial.catheter", v)} />
                <Box sx={{ display: "flex", gap: 2, gridColumn: "span 2" }}>
                  <RdoGroup label="Extent of Block" options={["Checked", "Not checked"]} value={reg.fascial.blockExtent} onChange={v => sreg("fascial.blockExtent", v)} />
                  {reg.fascial.blockExtent === "Checked" && <TextField label="Details" value={reg.fascial.blockExtentDetails || ""} size="small" onChange={e => sreg("fascial.blockExtentDetails", e.target.value)} sx={{ ...inputSx, flex: 1 }} />}
                </Box>
                <Box sx={{ gridColumn: "1/-1" }}><TextField label="Complications" value={reg.fascial.complications} size="small" multiline rows={2} onChange={e => sreg("fascial.complications", e.target.value)} sx={inputSx} fullWidth placeholder="Complications if any" /></Box>
              </FG>
            </SectionBox>
          )}

          {reg.showIVRA && (
            <SectionBox title="6. IVRA (Bier's Block)">
              <FG cols={3}>
                <RdoGroup label="Site" options={["Upper", "Lower"]} value={reg.ivra.limb} onChange={v => sreg("ivra.limb", v)} />
                <TextField label="Duration (minutes)" value={reg.ivra.duration} type="number" size="small" onChange={e => sreg("ivra.duration", e.target.value)} sx={inputSx} fullWidth />
                <TextField label="Local Anaesthetic Name" value={reg.ivra.la} size="small" onChange={e => sreg("ivra.la", e.target.value)} sx={inputSx} fullWidth />
                <TextField label="Concentration (%)" value={reg.ivra.concentration} size="small" onChange={e => sreg("ivra.concentration", e.target.value)} sx={inputSx} fullWidth />
                <TextField label="Volume (ml)" value={reg.ivra.volume} size="small" onChange={e => sreg("ivra.volume", e.target.value)} sx={inputSx} fullWidth />
                <Box sx={{ gridColumn: "1/-1" }}><TextField label="Adjuvants (Drug, Concentration, Volume)" value={reg.ivra.adjuvants} size="small" multiline rows={2} onChange={e => sreg("ivra.adjuvants", e.target.value)} sx={inputSx} fullWidth /></Box>
                <TextField label="Extent of Block" value={reg.ivra.blockExtent} size="small" onChange={e => sreg("ivra.blockExtent", e.target.value)} sx={inputSx} fullWidth placeholder="Block details" />
                <TextField label="Tourniquet Details" value={reg.ivra.tourniquet} size="small" onChange={e => sreg("ivra.tourniquet", e.target.value)} sx={inputSx} fullWidth />
                <Box sx={{ gridColumn: "1/-1" }}><TextField label="Complications" value={reg.ivra.complications} size="small" multiline rows={2} onChange={e => sreg("ivra.complications", e.target.value)} sx={inputSx} fullWidth placeholder="Complications if any" /></Box>
              </FG>
            </SectionBox>
          )}

          <Button sx={saveBtnSx} onClick={() => onSave("anaesthesia.reg", reg)}><SaveRounded sx={{ mr: 0.5, fontSize: 14 }} />Save Regional Anaesthesia</Button>
        </Box>
      )}

      {/* ── Sub-tab 3: MAC / Local */}
      {sub === 3 && (
        <Box>
          <TranscribePanel section="mac" onAutofill={fillMac} />
          <SectionBox title="Local Anaesthetic">
            <FG cols={3}>
              <TextField label="Drug Name" value={mac.laDrug} size="small" onChange={e => smac("laDrug", e.target.value)} sx={inputSx} fullWidth />
              <TextField label="Concentration (%)" value={mac.laConc} size="small" onChange={e => smac("laConc", e.target.value)} sx={inputSx} fullWidth />
              <TextField label="Volume (ml)" value={mac.laVolume} size="small" onChange={e => smac("laVolume", e.target.value)} sx={inputSx} fullWidth />
              <CbxGroup label="Route" options={["Infiltration", "Topical Application", "Others"]} value={mac.laRoute} onChange={v => smac("laRoute", v)} />
            </FG>
          </SectionBox>
          <SectionBox title="Additives">
            <FG cols={3}>
              <TextField label="Name of Drug" value={mac.additiveDrug} size="small" onChange={e => smac("additiveDrug", e.target.value)} sx={inputSx} fullWidth />
              <TextField label="Concentration (%)" value={mac.additiveConc} size="small" onChange={e => smac("additiveConc", e.target.value)} sx={inputSx} fullWidth />
              <TextField label="Volume (ml)" value={mac.additiveVolume} size="small" onChange={e => smac("additiveVolume", e.target.value)} sx={inputSx} fullWidth />
            </FG>
          </SectionBox>
          <SectionBox title="Sedatives">
            <FlagNote>Multiple choice possible</FlagNote>
            <Box sx={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 2, mt: 1.5 }}>
              {[["Propofol", "propofol", "mg"], ["Ketamine", "ketamine", "mg"], ["Midazolam", "midazolam", "mg"], ["Fentanyl", "fentanyl", "mcg"], ["Dexmedetomidine", "dexmedetomidine", "mcg"]].map(([label, key, unit]) => (
                <Box key={key} sx={{ display: "flex", alignItems: "center", gap: 1 }}>
                  <Typography sx={{ fontSize: 12, fontFamily: FONT, minWidth: 120 }}>{label}</Typography>
                  <TextField value={mac[key]} size="small" placeholder={`Dose (${unit})`} onChange={e => smac(key, e.target.value)} sx={{ ...inputSx, flex: 1 }} />
                </Box>
              ))}
            </Box>
          </SectionBox>
          <SectionBox title="Monitoring & Complications">
            <FG cols={3}>
              <Sel label="Ramsay Sedation Scale" value={mac.ramsay} onChange={v => smac("ramsay", v)}
                options={["1 - Anxious/agitated", "2 - Cooperative/oriented", "3 - Responds to commands", "4 - Asleep/brisk response", "5 - Asleep/sluggish response", "6 - No response"]} />
              <RdoGroup label="Oxygen Supplementation" options={["No", "Nasal Prongs", "Face Mask", "Others"]} value={mac.oxygenSupp} onChange={v => smac("oxygenSupp", v)} />
              <Box sx={{ gridColumn: "1/-1" }}><CbxGroup label="Complications" options={["Emergency Airway intervention needed", "Conversion to GA", "Others"]} value={mac.complications} onChange={v => smac("complications", v)} /></Box>
            </FG>
          </SectionBox>
          <Button sx={saveBtnSx} onClick={() => onSave("anaesthesia.mac", mac)}><SaveRounded sx={{ mr: 0.5, fontSize: 14 }} />Save MAC / Local</Button>
        </Box>
      )}

      {/* ── Sub-tab 4: Intra-op / Fluids */}
      {sub === 4 && (
        <Box>
          <TranscribePanel section="io" onAutofill={fillIo} />
          <SectionBox title="Patient Position & Warming">
            <FG cols={3}>
              <Box sx={{ gridColumn: "1/-1" }}>
                <CbxGroup label="Patient Position" options={["Supine", "Supine with extension of head", "Supine with Lithotomy", "Trendelenberg", "Reverse Trendelenberg", "Prone", "Semi Prone", "Right Lateral", "Left Lateral", "Others"]} value={io.patientPosition} onChange={v => sio("patientPosition", v)} />
              </Box>
              <RdoGroup label="Pressure Areas Padded" options={["Yes", "No"]} value={io.pressureAreas} onChange={v => sio("pressureAreas", v)} />
              <RdoGroup label="Eyes Shut and Taped" options={["Yes", "No"]} value={io.eyesShut} onChange={v => sio("eyesShut", v)} />
              <Box sx={{ gridColumn: "1/-1" }}>
                <CbxGroup label="Maintenance of Normothermia" options={["None", "Inline Fluid Warmer", "Warming Blanket", "Warming Mattress", "Others"]} value={io.normothermia} onChange={v => sio("normothermia", v)} />
              </Box>
              <CbxGroup label="Temperature Monitoring" options={["None", "Skin", "Nasopharyngeal", "Oro-esophageal", "Other core"]} value={io.tempMonitoring} onChange={v => sio("tempMonitoring", v)} />
            </FG>
          </SectionBox>

          <SectionBox title="IV Fluids">
            <TableContainer>
              <Table size="small">
                <TableHead><TableRow><TableCell sx={thSx}>Fluid Type</TableCell><TableCell sx={thSx}>Volume (ml)</TableCell></TableRow></TableHead>
                <TableBody>
                  {[["Ringer Lactate", "ringerLactate"], ["Normal Saline", "normalSaline"], ["Dextrose Normal Saline", "dns"], ["5% Dextrose", "dextrose5"], ["10% Dextrose", "dextrose10"], ["Plasmalyte", "plasmalyte"], ["Gelofusine", "gelofusine"], ["Albumin 20%", "albumin20"], ["Albumin 5%", "albumin5"], ["Mannitol 20%", "mannitol20"], ["1% DRL", "drl1"], ["2% DRL", "drl2"], ["Others", "others"]].map(([label, key]) => (
                    <TableRow key={key} sx={{ "&:hover": { background: C.bgSecondary } }}>
                      <TableCell sx={tdSx}>{label}</TableCell>
                      <TableCell sx={tdSx}><TextField type="number" size="small" placeholder="ml" value={io.ivFluids[key]} onChange={e => sivf(key, e.target.value)} sx={{ ...inputSx, width: 120 }} /></TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TableContainer>
          </SectionBox>

          <SectionBox title="Blood / Blood Products / Coagulation Products">
            <FlagNote>Multiple choice possible. Mention Volume, Bag No, Reaction for each.</FlagNote>
            <Box sx={{ mt: 1, overflowX: "auto" }}>
              <Table size="small">
                <TableHead>
                  <TableRow>{["Product", "Volume (ml)", "Bag No", "Reaction", "Reaction Details"].map(h => <TableCell key={h} sx={thSx}>{h}</TableCell>)}</TableRow>
                </TableHead>
                <TableBody>
                  {io.bloodProducts.map((bp, i) => (
                    <TableRow key={bp.product} sx={{ "&:hover": { background: C.bgSecondary } }}>
                      <TableCell sx={tdSx}>
                        <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
                          <Checkbox size="small" checked={bp.checked} onChange={e => sbp(i, "checked", e.target.checked)} sx={{ color: C.border, "&.Mui-checked": { color: C.black }, p: 0.4 }} />
                          <Typography sx={{ fontSize: 12, fontFamily: FONT }}>{bp.product}</Typography>
                        </Box>
                      </TableCell>
                      <TableCell sx={tdSx}><TextField type="number" size="small" placeholder="ml" value={bp.volume} onChange={e => sbp(i, "volume", e.target.value)} sx={{ ...inputSx, width: 90 }} disabled={!bp.checked} /></TableCell>
                      <TableCell sx={tdSx}><TextField size="small" placeholder="Bag#" value={bp.bagNo} onChange={e => sbp(i, "bagNo", e.target.value)} sx={{ ...inputSx, width: 90 }} disabled={!bp.checked} /></TableCell>
                      <TableCell sx={tdSx}>
                        <RadioGroup row value={bp.reaction} onChange={e => sbp(i, "reaction", e.target.value)}>
                          {["Yes", "No"].map(v => <FormControlLabel key={v} value={v} control={<Radio size="small" sx={{ color: C.border, "&.Mui-checked": { color: C.black }, p: 0.4 }} />} label={<Typography sx={{ fontSize: 11, fontFamily: FONT }}>{v}</Typography>} disabled={!bp.checked} />)}
                        </RadioGroup>
                      </TableCell>
                      <TableCell sx={tdSx}><TextField size="small" placeholder="Details if yes" value={bp.details} onChange={e => sbp(i, "details", e.target.value)} sx={{ ...inputSx, width: 160 }} disabled={!bp.checked || bp.reaction !== "Yes"} /></TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </Box>
          </SectionBox>

          <SectionBox title="Total Output">
            <FG cols={3}>
              <TextField label="Blood Loss (ml)" value={io.bloodLoss} type="number" size="small" onChange={e => sio("bloodLoss", e.target.value)} sx={inputSx} fullWidth />
              <TextField label="Urine Output (ml)" value={io.urineOutput} type="number" size="small" onChange={e => sio("urineOutput", e.target.value)} sx={inputSx} fullWidth />
              <TextField label="Other Losses" value={io.otherLosses} size="small" onChange={e => sio("otherLosses", e.target.value)} sx={inputSx} fullWidth placeholder="Specify" />
            </FG>
          </SectionBox>

          <SectionBox title="Intra-Operative Complications">
            <Box>
              <CbxGroup label="Complications" options={["Airway related", "Cardiovascular", "Respiratory", "Haemorrhagic", "CNS", "Dyselectrolytemia", "Other Metabolic", "Others"]} value={io.complications} onChange={v => sio("complications", v)} />
              <FlagNote>Multiple option, details of each option</FlagNote>
            </Box>
            <Box sx={{ mt: 1.5 }}>
              <TextField label="Details of Complications" value={io.complicationDetails} size="small" multiline rows={3} onChange={e => sio("complicationDetails", e.target.value)} sx={inputSx} fullWidth placeholder="Describe each complication" />
            </Box>
          </SectionBox>
          <Button sx={saveBtnSx} onClick={() => onSave("anaesthesia.io", io)}><SaveRounded sx={{ mr: 0.5, fontSize: 14 }} />Save Intra-op / Fluids</Button>
        </Box>
      )}

      {/* ── Sub-tab 5: End Op / Post-op */}
      {sub === 5 && (
        <Box>
          <TranscribePanel section="eo" onAutofill={fillEo} />
          <SectionBox title="End Op Notes">
            <FG cols={3}>
              <TextField label="Reversal at Time" value={eo.reversalTime} type="time" size="small" onChange={e => seo("reversalTime", e.target.value)} sx={inputSx} fullWidth InputLabelProps={{ shrink: true }} />
              <CbxGroup label="Reversal Drug" options={["Neostigmine + Glycopyrrolate", "Sugamadex", "None"]} value={eo.reversalDrug} onChange={v => seo("reversalDrug", v)} />
              <TextField label="Reversal Dose" value={eo.reversalDose} size="small" onChange={e => seo("reversalDose", e.target.value)} sx={inputSx} fullWidth placeholder="Dose details" />
              <RdoGroup label="Extubation" options={["Uneventful", "Needed Reintubation", "Not Extubated"]} value={eo.extubation} onChange={v => seo("extubation", v)} />
              <RdoGroup label="Post Op Ventilation" options={["No", "Planned", "Unplanned"]} value={eo.postOpVent} onChange={v => seo("postOpVent", v)} />
              <Box sx={{ gridColumn: "1/-1" }}>
                <CbxGroup label="Vasoactive Drugs at End of Surgery" options={["Adrenaline", "Nor-Adrenaline", "Dobutamine", "Vasopressin", "Amiodarone", "NTG", "Labetalol", "Esmolol", "Others"]} value={eo.vasoactiveDrugs} onChange={v => seo("vasoactiveDrugs", v)} />
                <FlagNote>With infusion rates. Multiple choice possible.</FlagNote>
              </Box>
              <Box sx={{ gridColumn: "1/-1" }}>
                <CbxGroup label="Post Extubation Complications" options={["Laryngospasm", "Bronchospasm", "Upper airway obstruction", "Hypoventilation", "Hypopnoea", "Others"]} value={eo.postExtubComps} onChange={v => seo("postExtubComps", v)} />
              </Box>
            </FG>
          </SectionBox>

          <SectionBox title="End Op Vital Parameters">
            <FG cols={3}>
              <Box sx={{ gridColumn: "1/-1" }}>
                <RdoGroup label="Patient Condition" options={["Patient fully awake and obeys commands", "Patient sleepy but unobstructed airway", "Sedated on Ventilator support"]} value={eo.patientCondition} onChange={v => seo("patientCondition", v)} />
              </Box>
              <TextField label="PR (bpm)" value={eo.pr} type="number" size="small" onChange={e => seo("pr", e.target.value)} sx={inputSx} fullWidth />
              <TextField label="BP (mmHg)" value={eo.bp} size="small" onChange={e => seo("bp", e.target.value)} sx={inputSx} fullWidth placeholder="e.g., 120/80" />
              <TextField label="SpO2 (%)" value={eo.spo2} type="number" size="small" onChange={e => seo("spo2", e.target.value)} sx={inputSx} fullWidth />
              <TextField label="RR (breaths/min)" value={eo.rr} type="number" size="small" onChange={e => seo("rr", e.target.value)} sx={inputSx} fullWidth />
              <TextField label="Temperature (°C)" value={eo.temperature} type="number" size="small" onChange={e => seo("temperature", e.target.value)} sx={inputSx} fullWidth />
              <Box sx={{ gridColumn: "1/-1" }}>
                <RdoGroup label="Patient Shifted With Airway Adjunct" options={["Endotracheal Tube", "Tracheostomy Tube", "Oropharyngeal Airway", "Nasopharyngeal Airway", "None of the above"]} value={eo.airwayAdjunct} onChange={v => seo("airwayAdjunct", v)} />
                <FlagNote>Single choice possible</FlagNote>
              </Box>
              <RdoGroup label="Level of Post Op Monitoring" options={["Routine", "High Dependency", "Intensive Care"]} value={eo.monitorLevel} onChange={v => seo("monitorLevel", v)} />
            </FG>
          </SectionBox>

          <SectionBox title="Post Operative Advice">
            <FG cols={3}>
              <RdoGroup label="Oxygen Supplementation" options={["Yes", "No"]} value={eo.oxygenSupp} onChange={v => seo("oxygenSupp", v)} />
              <TextField label="NPO For (Hours)" value={eo.npoHours} type="number" size="small" onChange={e => seo("npoHours", e.target.value)} sx={inputSx} fullWidth />
              <TextField label="IVF Maintenance (ml/hour)" value={eo.ivfRate} type="number" size="small" onChange={e => seo("ivfRate", e.target.value)} sx={inputSx} fullWidth />
              <Box sx={{ gridColumn: "1/-1" }}><TextField label="Analgesics Orders" value={eo.analgesics} size="small" multiline rows={2} onChange={e => seo("analgesics", e.target.value)} sx={inputSx} fullWidth placeholder="Analgesic protocol" /></Box>
              <Box sx={{ gridColumn: "1/-1" }}><TextField label="Antiemetics Given" value={eo.antiemetics} size="small" multiline rows={2} onChange={e => seo("antiemetics", e.target.value)} sx={inputSx} fullWidth /></Box>
              <Box sx={{ gridColumn: "1/-1" }}><TextField label="Pre-op Chronic Medications" value={eo.chronicMeds} size="small" multiline rows={2} onChange={e => seo("chronicMeds", e.target.value)} sx={inputSx} fullWidth placeholder="Continue/Stop medications" /></Box>
              <Box sx={{ gridColumn: "1/-1" }}>
                <CbxGroup label="Investigations" options={["CBC", "Electrolytes", "Biochemistry", "Coagulation", "TEG", "X-ray", "ECG", "Others"]} value={eo.investigations} onChange={v => seo("investigations", v)} />
              </Box>
              <Box sx={{ gridColumn: "1/-1" }}><TextField label="Other Comments" value={eo.otherComments} size="small" multiline rows={3} onChange={e => seo("otherComments", e.target.value)} sx={inputSx} fullWidth placeholder="Additional post-op instructions" /></Box>
            </FG>
          </SectionBox>
          <Button sx={saveBtnSx} onClick={() => onSave("anaesthesia.eo", eo)}><SaveRounded sx={{ mr: 0.5, fontSize: 14 }} />Save End Op / Post-op</Button>
        </Box>
      )}
    </Box>
  );
};

// ─────────────────────────────────────────────────────────────────────────────
// MAIN RECORD COMPONENT
// ─────────────────────────────────────────────────────────────────────────────
const AnaesthesiaRecord = ({ patientId, doctorId, doctorName, demoBookingData }) => {
  const [activeTab, setActiveTab] = useState(0);
  const [recordId, setRecordId] = useState(null);
  const [recordData, setRecordData] = useState(null);
  const [history, setHistory] = useState([]);
  const [isLoading, setIsLoading] = useState(false);
  const [snackbar, setSnackbar] = useState({ open: false, message: "", severity: "success" });
  const defaultChecklist = {
    signin_consent: "", signin_consent_remark: "",
    signin_machine: "", signin_machine_remark: "",
    signin_oximeter: "", signin_oximeter_remark: "",
    signin_airway: "", signin_airway_remark: "",
    signin_aspiration: "", signin_aspiration_remark: "",
    signin_starvation: "", signin_starvation_remark: "",
    signin_allergy: "", signin_allergy_remark: "",
    timeout_anaesthesia_events: "",
    timeout_antibiotic: "", timeout_antibiotic_remark: "",
    timeout_throat: "", timeout_throat_remark: "",
    signout_concerns: "",
    extubation_throat: "", extubation_throat_remark: "",
  };

  const [checklistData, setChecklistData] = useState(defaultChecklist);

  useEffect(() => {
    const fetchRecord = async () => {
      if (!patientId || !doctorId) return;
      setIsLoading(true);
      try {
        // Fetch active record or create one if missing
        const activeRes = await getActiveAnaesthesiaRecord(patientId);
        let currentRecordId = null;
        if (activeRes?.status === "success" && activeRes.data) {
          currentRecordId = activeRes.data.record_id;
          setRecordId(currentRecordId);
          setRecordData(activeRes.data);
          setChecklistData({ ...defaultChecklist, ...(activeRes.data.checklist || {}) });
        } else {
          // Auto-create
          const createRes = await createAnaesthesiaRecord(patientId, doctorId);
          if (createRes?.status === "success") {
            currentRecordId = createRes.record_id;
            setRecordId(currentRecordId);
            setRecordData({});
            setChecklistData(defaultChecklist);
          }
        }

        // Fetch history
        const histRes = await getAnaesthesiaRecords(patientId);
        if (histRes?.status === "success") {
          setHistory(histRes.data || []);
        }

        // Record & history loaded directly from active record in MongoDB

      } catch (err) {
        console.error("Error fetching anaesthesia record:", err);
      } finally {
        setIsLoading(false);
      }
    };
    fetchRecord();
  }, [patientId, doctorId]);

  const getSection = (key) => {
    // We map keys like "anaesthesia.mm" to "mm" since the new API stores them at the root of the record
    const parts = key.split(".");
    const sectionName = parts[parts.length - 1];
    return recordData?.[sectionName] || null;
  };

  const handleSave = async (tabKey, data) => {
    if (!recordId) {
      setSnackbar({ open: true, message: "No active anaesthesia record found.", severity: "error" });
      return;
    }

    const parts = tabKey.split(".");
    const sectionPath = parts[parts.length - 1]; // e.g., "checklist", "mm", "ga"

    try {
      const res = await saveAnaesthesiaSection(recordId, sectionPath, data);
      if (res?.status === "success") {
        setSnackbar({ open: true, message: "Saved successfully", severity: "success" });
      } else {
        throw new Error("Save failed");
      }
    } catch (err) {
      console.error("Save error:", err);
      setSnackbar({ open: true, message: "Failed to save.", severity: "error" });
    }
  };

  const handleCompleteRecord = async () => {
    if (!recordId) return;
    try {
      await completeAnaesthesiaRecord(recordId);
      setSnackbar({ open: true, message: "Anaesthesia record marked as completed.", severity: "success" });
      // Reset state for a new record to be created
      setRecordId(null);
      setRecordData(null);
      setChecklistData(defaultChecklist);
      // Wait a moment then fetch again to auto-create the next record
      setTimeout(() => {
        window.location.reload(); // simple reset for demo purposes
      }, 1000);
    } catch (err) {
      console.error("Error completing record:", err);
      setSnackbar({ open: true, message: "Failed to complete record.", severity: "error" });
    }
  };

  return (
    <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.35 }}>
      <Box sx={{ background: C.bgPrimary, border: `1px solid ${C.border}`, fontFamily: FONT }}>

        {/* Header */}
        <Box sx={{ display: "flex", alignItems: "center", justifyContent: "space-between", px: 2.5, py: 2, background: C.bgSecondary, borderBottom: `1px solid ${C.borderStrong}`, flexWrap: "wrap", gap: 2 }}>
          <Box sx={{ display: "flex", alignItems: "center", gap: 2 }}>
            <Box sx={{ width: 44, height: 44, background: C.black, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
              <LocalHospitalRounded sx={{ fontSize: 24, color: C.white }} />
            </Box>
            <Box>
              <Typography sx={{ fontSize: "0.6rem", textTransform: "uppercase", letterSpacing: "0.2em", color: C.textMuted, fontFamily: FONT, mb: 0.25 }}>Surgical Oncology</Typography>
              <Typography sx={{ fontSize: 20, fontWeight: FW_LIGHT, fontFamily: FONT, color: C.textPrimary, letterSpacing: "-0.02em" }}>Anaesthesia Record</Typography>
            </Box>
          </Box>
          <Box sx={{ display: "flex", alignItems: "center", gap: 1.5 }}>
            <Box sx={{ px: 1.5, py: 0.5, border: `1px solid ${C.border}`, background: C.white, fontSize: 11, fontFamily: FONT, color: C.textMuted }}>NCG-KCDO Module v3.0</Box>
          </Box>
        </Box>

        {/* Layout: Sub-sidebar + Content */}
        <Box sx={{ display: "flex", minHeight: "65vh" }}>
          <Box sx={{ width: 240, borderRight: `1px solid ${C.border}`, background: C.bgSecondary, flexShrink: 0 }}>
            {MAIN_TABS.map((tab, i) => (
              <Box key={tab.key} onClick={() => setActiveTab(i)}
                sx={{
                  px: 2.5, py: 1.75, borderBottom: `1px solid ${C.border}`,
                  borderLeft: activeTab === i ? `3px solid ${C.black}` : "3px solid transparent",
                  background: activeTab === i ? C.black : "transparent", cursor: "pointer", transition: "all 0.15s",
                  "&:hover": { background: activeTab === i ? C.black : C.white },
                }}>
                <Typography sx={{ fontSize: 9, textTransform: "uppercase", letterSpacing: "0.12em", color: activeTab === i ? "rgba(255,255,255,0.7)" : C.textMuted, fontFamily: FONT, mb: 0.25 }}>{tab.part}</Typography>
                <Typography sx={{ fontSize: 13, fontFamily: FONT, color: activeTab === i ? C.white : C.textSecond, fontWeight: activeTab === i ? FW_NORMAL : FW_LIGHT }}>{tab.label}</Typography>
              </Box>
            ))}
          </Box>

          {/* Content */}
          <Box sx={{ flex: 1, p: 3, overflowX: "auto", overflowY: "auto", maxHeight: "80vh", position: "relative" }}>
            {isLoading && (
              <Box sx={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0, background: "rgba(255,255,255,0.4)", backdropFilter: "blur(5px)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 50 }}>
                <Box sx={{ background: C.white, p: "32px 48px", borderRadius: 1, boxShadow: "0 10px 30px rgba(0,0,0,0.1)", textAlign: "center", border: `1px solid ${C.border}` }}>
                  <Typography sx={{ fontSize: 18, fontFamily: FONT, fontWeight: FW_NORMAL, mb: 1.5 }}>Loading Record...</Typography>
                  <Typography sx={{ fontSize: 13, fontFamily: FONT, color: C.textSecond }}>Please wait while we fetch the details.</Typography>
                </Box>
              </Box>
            )}

            <Box sx={{ filter: isLoading ? "blur(3px)" : "none", pointerEvents: isLoading ? "none" : "auto" }}>
              <Box sx={{ mb: 2 }}>
                <AnaesthesiaHistoryAccordion history={history} currentRecordId={recordId} title="Past Anaesthesia Records" />
              </Box>
              {activeTab === 0 && (
                <>
                  <AnaesthesiaChecklistTab data={checklistData} onChange={setChecklistData} onSave={handleSave} />
                  {/* Lab record hidden — panel preserved below, just not rendered.
                  <LabOrderPanel
                    bookingId={currentBookingId}
                    bookingData={currentBookingData}
                    doctorId={doctorId}
                    onSaved={() => setSnackbar({ open: true, message: "Lab results saved and approved.", severity: "success" })}
                  />
                  */}
                </>
              )}
              {activeTab === 1 && <ProcedureTab getSection={getSection} onSave={handleSave} />}

              {recordId && (
                <Box sx={{ mt: 5, pt: 3, borderTop: `2px solid ${C.border}`, display: "flex", justifyContent: "flex-end" }}>
                  <Button variant="contained" onClick={handleCompleteRecord} sx={{ fontFamily: FONT, textTransform: "none", borderRadius: 1, boxShadow: "none", px: 4, py: 1, background: "#cf1322", color: C.white, "&:hover": { background: "#a8071a" }, fontSize: 14, fontWeight: FW_NORMAL }}>
                    Complete Record
                  </Button>
                </Box>
              )}
            </Box>
          </Box>
        </Box>
      </Box>
      <Snackbar open={snackbar.open} autoHideDuration={4000}
        onClose={() => setSnackbar(p => ({ ...p, open: false }))}
        anchorOrigin={{ vertical: "top", horizontal: "center" }}>
        <Alert severity={snackbar.severity} sx={{ width: '100%', fontFamily: FONT }}>
          {snackbar.message}
        </Alert>
      </Snackbar>
    </motion.div>
  );
};

export default AnaesthesiaRecord;