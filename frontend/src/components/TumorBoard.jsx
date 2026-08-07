// TumorBoard.jsx — Rethemed to Doctorassist.AI brand + Care Pathway Plan feature
// Care Pathway workflow: Generate -> review popup -> "Continue" -> plan appears as
// a DRAFT card in the section -> doctor can Edit the draft -> doctor Approves ->
// once approved, the plan is locked and can no longer be edited.
//
// NEW: Care Pathway Dictation — a second entry point under the "Generate Care
// Pathway Plan" button. Doctor can dictate/type notes (reusing the same
// transcription endpoint as the recommendation box below), then click
// "Process" to feed those notes into the same generate -> review -> draft flow.
//
// NEW: Imaging Studies tab — a top-level tab bar now separates the existing
// Tumor Board workflow from a new "Imaging Studies" tab that renders the
// DICOM Imaging Viewer for the patient (same component used elsewhere in the
// app), so radiology review lives alongside tumor board collaboration.
import React, { useState, useEffect, useRef } from "react";
import {
  Box,
  Typography,
  Button,
  Chip,
  Card,
  CardContent,
  Divider,
  Avatar,
  Alert,
  Snackbar,
  IconButton,
  Tooltip,
  CircularProgress,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  TextField,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
  FormHelperText,
  Checkbox,
  FormControlLabel,
  Tabs,
  Tab,
} from "@mui/material";
import {
  Mic,
  Stop,
  SendRounded,
  GroupRounded,
  PersonRounded,
  ThumbUpRounded,
  CommentRounded,
  MedicalServicesRounded,
  AccessTimeRounded,
  AutoAwesome as AutoAwesomeIcon,
  Share as ReferIcon,
  AccountTreeRounded,
  CheckCircleRounded,
  CancelRounded,
  ChevronRightRounded,
  CloseRounded,
  WarningAmberRounded,
  FlagRounded,
  ScienceRounded,
  EditRounded,
  LockRounded,
  ImageRounded,
  ArticleRounded,
  HistoryRounded,
} from "@mui/icons-material";
import { motion, AnimatePresence } from "framer-motion";
import RecommendationPopup from "./RecommendationPopup";
import DICOMViewer from "./DICOMViewer";
// import ChatPanel from "./ChatPanel";

// ─── BRAND TOKENS (matching Doctorassist.AI site) ───────────────────────────
const FONT = '"Open Sans", sans-serif';
const FW_LIGHT = 300;
const FW_NORMAL = 400;
const FW_MEDIUM = 500;

// From the site: --accent: #000000; minimal black/white with teal brand gradient
const BRAND_GRADIENT = "linear-gradient(135deg, #0ddcd5 0%, #0a88a7 50%, #04eb83 100%)";
const BRAND_GRADIENT_ALT = "linear-gradient(135deg, #0a3cff 0%, #1ccfc9 50%, #3fb6ff 100%)";

const C = {
  black:      "#000000",
  white:      "#ffffff",
  bgPrimary:  "#ffffff",
  bgSecondary:"#fafafa",
  bgTertiary: "#f5f5f5",
  textPrimary:"#000000",
  textSecond: "#444444",
  textMuted:  "#888888",
  border:     "#e0e0e0",
  borderStrong:"#000000",
};

const API_BASE_URL = window.PATIENT_WIDGET_API || "https://doctorassist.ai/api/";

const oncologySpecialties = [
  "Medical Oncology","Chemotherapy","Immunotherapy","Targeted therapy",
  "Hormone therapy","Precision oncology","Radiation Oncology",
  "External beam radiotherapy","Brachytherapy","Stereotactic radiosurgery",
  "Surgical Oncology","Curative surgery","Cytoreductive surgery",
  "Reconstructive surgery","Breast Oncology","Thoracic Oncology",
  "Gastrointestinal Oncology","Gynecologic Oncology","Urologic Oncology",
  "Head and Neck Oncology","Neuro-oncology","Pediatric Oncology",
  "Hematologic Oncology","Imaging Oncology","Pathology","Histopathology",
  "Cytology","Molecular pathology","Molecular Oncology","Biomarker Analysis",
  "Nuclear Medicine","Interventional Oncology","Ablation therapies",
  "Embolization","Research Oncology","Palliative Oncology","Pain Management",
  "Rehabilitation Oncology","Nutritional Oncology","Psycho-oncology",
  "Preventive Oncology","Cancer Screening Programs","Genetic Counseling",
];

const PREDEFINED_DOCTORS = [
  { id: "doc_001", name: "Sarah Johnson",   speciality: "Medical Oncology" },
  { id: "doc_002", name: "Michael Chen",    speciality: "Radiation Oncology" },
  { id: "doc_003", name: "Emily Rodriguez", speciality: "Surgical Oncology" },
  { id: "doc_004", name: "David Kim",       speciality: "Hematologic Oncology" },
  { id: "doc_005", name: "Lisa Patel",      speciality: "Pediatric Oncology" },
  { id: "doc_006", name: "James Wilson",    speciality: "Neuro-oncology" },
  { id: "doc_007", name: "Maria Garcia",    speciality: "Breast Oncology" },
  { id: "doc_008", name: "Robert Taylor",   speciality: "Thoracic Oncology" },
];

// ─── SHARED SX HELPERS ───────────────────────────────────────────────────────
const labelStyle = {
  fontSize: "0.65rem",
  textTransform: "uppercase",
  letterSpacing: "0.2em",
  color: C.textMuted,
  fontFamily: FONT,
  fontWeight: FW_NORMAL,
};

const squareAvatar = {
  width: 40,
  height: 40,
  borderRadius: 0,
  background: C.black,
  color: C.white,
  fontSize: 14,
  fontWeight: FW_NORMAL,
  fontFamily: FONT,
};

const brandSquareAvatar = {
  ...squareAvatar,
  background: BRAND_GRADIENT,
};

// ─── MAIN TAB BAR (Tumor Board vs Imaging Studies) ──────────────────────────
const mainTabSx = {
  minHeight: 44,
  "& .MuiTab-root": {
    textTransform: "none",
    fontWeight: FW_NORMAL,
    fontFamily: FONT,
    fontSize: 12.5,
    minHeight: 44,
    color: C.textMuted,
    letterSpacing: "0.04em",
    "&.Mui-selected": { color: C.textPrimary, fontWeight: FW_NORMAL },
  },
  "& .MuiTabs-indicator": { background: C.black, height: 2 },
};

// ─── STATUS STYLES (care pathway steps) ──────────────────────────────────────
const STATUS_STYLES = {
  pending:     { label: "Pending",     color: "#666666", bg: "#f0f0f0", border: "#d5d5d5" },
  on_hold:     { label: "On Hold",     color: "#9a6300", bg: "#fff6e5", border: "#f0dca8" },
  in_progress: { label: "In Progress", color: "#0a6e88", bg: "#e8f7f8", border: "#a9e2e8" },
  completed:   { label: "Completed",   color: "#0a7a45", bg: "#e9f9f0", border: "#a9e6c4" },
  cancelled:   { label: "Cancelled",   color: "#a12525", bg: "#fdeeee", border: "#f0bcbc" },
};
const getStatusStyle = status => STATUS_STYLES[status] || STATUS_STYLES.pending;

// ─── STATUS STYLES (care pathway PLAN — draft vs approved) ──────────────────
const PLAN_STATUS_STYLES = {
  draft:    { label: "Draft — Pending Approval", color: "#9a6300", bg: "#fff6e5", border: "#f0dca8" },
  approved: { label: "Approved",                 color: "#0a7a45", bg: "#e9f9f0", border: "#a9e6c4" },
};
const getPlanStatusStyle = status => PLAN_STATUS_STYLES[status] || PLAN_STATUS_STYLES.draft;

const MODALITY_LABELS = {
  investigation: "Investigation",
  chemotherapy: "Chemotherapy",
  radiation: "Radiation",
  surgery: "Surgery",
  supportive_care: "Supportive Care",
  immunotherapy: "Immunotherapy",
  targeted_therapy: "Targeted Therapy",
};

const MODALITY_OPTIONS = Object.keys(MODALITY_LABELS);
const STEP_STATUS_OPTIONS = Object.keys(STATUS_STYLES);

// ─── REFER PATIENT POPUP ─────────────────────────────────────────────────────
const ReferPatientPopup = ({
  open, onClose,
  fromDoctorId, fromDoctorName, fromDoctorSpeciality,
  patientId, patientName, onSubmit,
}) => {
  const [selectedDoctorId, setSelectedDoctorId] = useState("");
  const [reason, setReason]                     = useState("");
  const [submitting, setSubmitting]             = useState(false);
  const [errors, setErrors]                     = useState({});

  const validate = () => {
    const e = {};
    if (!selectedDoctorId) e.selectedDoctorId = "Please select a doctor to refer to";
    if (!reason.trim())   e.reason = "Please provide a reason for referral";
    if (reason.trim().length < 10) e.reason = "Please provide a more detailed reason (minimum 10 characters)";
    return e;
  };

  const handleSubmit = async () => {
    const ve = validate();
    if (Object.keys(ve).length > 0) { setErrors(ve); return; }
    setSubmitting(true);
    const sel = PREDEFINED_DOCTORS.find(d => d.id === selectedDoctorId);
    await onSubmit({
      from_doctor_id: fromDoctorId, to_doctor_id: selectedDoctorId,
      patient_id: patientId, reason: reason.trim(),
      from_doctor_name: fromDoctorName, from_doctor_speciality: fromDoctorSpeciality,
      to_doctor_name: sel?.name || "", to_doctor_speciality: sel?.speciality || "",
      patient_name: patientName,
    });
    setSubmitting(false);
  };

  const handleClose = () => {
    if (!submitting) { setSelectedDoctorId(""); setReason(""); setErrors({}); onClose(); }
  };

  return (
    <Dialog open={open} onClose={handleClose} maxWidth="sm" fullWidth
      PaperProps={{
        sx: {
          borderRadius: 0,
          background: C.bgPrimary,
          border: `1px solid ${C.borderStrong}`,
          boxShadow: "4px 4px 0px #000",
        }
      }}
    >
      {/* Title bar */}
      <DialogTitle sx={{
        pb: 1.5, pt: 2, px: 2.5,
        borderBottom: `1px solid ${C.border}`,
        display: "flex", alignItems: "center", gap: 1.5,
        background: C.bgSecondary,
      }}>
        <Box sx={{ width: 32, height: 32, background: C.black, display: "flex", alignItems: "center", justifyContent: "center" }}>
          <ReferIcon sx={{ fontSize: 18, color: C.white }} />
        </Box>
        <Box>
          <Typography sx={{ ...labelStyle, mb: 0.25 }}>Action</Typography>
          <Typography sx={{ fontSize: 16, fontWeight: FW_NORMAL, fontFamily: FONT, color: C.textPrimary, letterSpacing: "-0.01em" }}>
            Refer Patient
          </Typography>
        </Box>
      </DialogTitle>

      <DialogContent sx={{ pt: 3, px: 2.5 }}>
        {/* From doctor */}
        <Box sx={{ mb: 3 }}>
          <Typography sx={{ ...labelStyle, mb: 1 }}>Referring Doctor</Typography>
          <Box sx={{ p: 1.5, background: C.bgSecondary, border: `1px solid ${C.border}` }}>
            <Box sx={{ display: "flex", alignItems: "center", gap: 1.5 }}>
              <Avatar sx={brandSquareAvatar}><MedicalServicesRounded sx={{ fontSize: 18 }} /></Avatar>
              <Box>
                <Typography sx={{ fontSize: 14, fontWeight: FW_NORMAL, fontFamily: FONT, color: C.textPrimary }}>
                  Dr. {fromDoctorName}
                </Typography>
                <Typography sx={{ fontSize: 12, color: C.textMuted, fontFamily: FONT }}>
                  {fromDoctorSpeciality || "Oncology Specialist"}
                </Typography>
              </Box>
            </Box>
          </Box>
        </Box>

        {/* Patient */}
        {patientName && (
          <Box sx={{ mb: 3 }}>
            <Typography sx={{ ...labelStyle, mb: 1 }}>Patient</Typography>
            <Box sx={{ p: 1.5, background: C.bgSecondary, border: `1px solid ${C.border}` }}>
              <Typography sx={{ fontSize: 14, fontFamily: FONT, color: C.textPrimary }}>{patientName}</Typography>
            </Box>
          </Box>
        )}

        {/* To doctor */}
        <FormControl fullWidth sx={{ mb: 2.5 }} error={!!errors.selectedDoctorId}>
          <InputLabel sx={{ fontFamily: FONT, fontSize: 13 }}>Refer to Doctor *</InputLabel>
          <Select value={selectedDoctorId}
            onChange={e => { setSelectedDoctorId(e.target.value); setErrors({ ...errors, selectedDoctorId: "" }); }}
            label="Refer to Doctor *"
            sx={{
              fontFamily: FONT, borderRadius: 0,
              "& .MuiOutlinedInput-notchedOutline": { borderColor: C.border, borderRadius: 0 },
              "&:hover .MuiOutlinedInput-notchedOutline": { borderColor: C.black },
              "&.Mui-focused .MuiOutlinedInput-notchedOutline": { borderColor: C.black, borderWidth: 1 },
            }}
          >
            {PREDEFINED_DOCTORS.map(doc => (
              <MenuItem key={doc.id} value={doc.id} sx={{ fontFamily: FONT }}>
                <Box>
                  <Typography sx={{ fontSize: 13, fontWeight: FW_NORMAL }}>Dr. {doc.name}</Typography>
                  <Typography sx={{ fontSize: 11, color: C.textMuted }}>{doc.speciality}</Typography>
                </Box>
              </MenuItem>
            ))}
          </Select>
          {errors.selectedDoctorId && <FormHelperText sx={{ fontFamily: FONT }}>{errors.selectedDoctorId}</FormHelperText>}
        </FormControl>

        {/* Reason */}
        <TextField fullWidth multiline rows={4}
          label="Reason for Referral *"
          placeholder="Provide detailed clinical reasoning, patient history, current condition, and specific consultation needs..."
          value={reason}
          onChange={e => { setReason(e.target.value); setErrors({ ...errors, reason: "" }); }}
          error={!!errors.reason}
          helperText={errors.reason}
          sx={{
            mt: 1,
            "& .MuiOutlinedInput-root": {
              borderRadius: 0, fontFamily: FONT, fontSize: 13,
              "& fieldset": { borderColor: C.border },
              "&:hover fieldset": { borderColor: C.black },
              "&.Mui-focused fieldset": { borderColor: C.black, borderWidth: 1 },
            },
            "& .MuiInputLabel-root": { fontFamily: FONT, fontSize: 13 },
          }}
        />
      </DialogContent>

      <DialogActions sx={{ p: 2.5, pt: 2, gap: 1, borderTop: `1px solid ${C.border}`, background: C.bgSecondary }}>
        <Button onClick={handleClose} disabled={submitting} sx={{
          textTransform: "none", fontFamily: FONT, fontWeight: FW_LIGHT,
          color: C.textSecond, borderRadius: 0, fontSize: 13,
          "&:hover": { background: C.bgTertiary },
        }}>
          Cancel
        </Button>
        <Button onClick={handleSubmit} disabled={submitting} variant="contained" sx={{
          background: C.black, textTransform: "none", fontFamily: FONT,
          fontWeight: FW_NORMAL, fontSize: 13, borderRadius: 0,
          border: `1px solid ${C.black}`,
          "&:hover": { background: C.white, color: C.black },
          "&.Mui-disabled": { background: C.bgTertiary, color: C.textMuted },
        }}>
          {submitting ? <CircularProgress size={16} sx={{ mr: 1, color: C.white }} /> : <ReferIcon sx={{ mr: 0.5, fontSize: 16 }} />}
          {submitting ? "Sending..." : "Send Referral"}
        </Button>
      </DialogActions>
    </Dialog>
  );
};

// ─── AUTO-EXPANDING TEXTAREA ─────────────────────────────────────────────────
const AutoExpandTextarea = React.forwardRef(({ value, onChange, placeholder, disabled }, ref) => {
  const textareaRef = useRef(null);
  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
      textareaRef.current.style.height = `${textareaRef.current.scrollHeight}px`;
    }
  }, [value]);
  React.useImperativeHandle(ref, () => textareaRef.current);

  return (
    <textarea
      ref={textareaRef}
      value={value}
      onChange={onChange}
      placeholder={placeholder}
      disabled={disabled}
      rows={4}
      style={{
        width: "100%",
        padding: "14px 16px",
        border: `1px solid ${C.border}`,
        borderRadius: 0,
        background: C.bgPrimary,
        fontFamily: FONT,
        fontSize: "13px",
        fontWeight: FW_LIGHT,
        resize: "none",
        outline: "none",
        transition: "border-color 0.15s ease",
        overflow: "hidden",
        lineHeight: "1.7",
        minHeight: "120px",
        color: C.textPrimary,
      }}
      onFocus={e  => { e.target.style.borderColor = C.black; }}
      onBlur={e   => { e.target.style.borderColor = C.border; }}
    />
  );
});
AutoExpandTextarea.displayName = "AutoExpandTextarea";

// ─── VOICE TRANSCRIPTION ─────────────────────────────────────────────────────
const VoiceTranscription = ({ onTranscript, aiGeneratedText, onAiTextClear }) => {
  const mediaRecorder  = useRef(null);
  const audioChunks    = useRef([]);
  const [recording, setRecording]           = useState(false);
  const [processing, setProcessing]         = useState(false);
  const [transcript, setTranscript]         = useState("");
  const [generatingAI, setGeneratingAI]     = useState(false);
  const [popupOpen, setPopupOpen]           = useState(false);
  const [aiRecommendationData, setAiRecommendationData] = useState(null);
  const [isGenerating, setIsGenerating]     = useState(false);

  useEffect(() => {
    if (aiGeneratedText) {
      setTranscript(prev => prev.trim() ? `${prev}\n\n\n${aiGeneratedText}` : aiGeneratedText);
      if (onAiTextClear) onAiTextClear();
    }
  }, [aiGeneratedText, onAiTextClear]);

  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      mediaRecorder.current = new MediaRecorder(stream);
      audioChunks.current = [];
      mediaRecorder.current.ondataavailable = e => { if (e.data.size > 0) audioChunks.current.push(e.data); };
      mediaRecorder.current.start();
      setRecording(true);
    } catch { alert("Microphone permission is required."); }
  };

  const stopRecording = () => {
    if (!mediaRecorder.current) return;
    mediaRecorder.current.onstop = processAudio;
    mediaRecorder.current.stop();
    mediaRecorder.current.stream.getTracks().forEach(t => t.stop());
    setRecording(false);
  };

  const processAudio = async () => {
    if (!audioChunks.current.length) return;
    setProcessing(true);
    try {
      const blob = new Blob(audioChunks.current, { type: "audio/webm" });
      audioChunks.current = [];
      const formData = new FormData();
      formData.append("file", blob);
      const res  = await fetch(`${API_BASE_URL}hms/users/ai/elevenlabs/api/transcribe_labs`, { method: "POST", body: formData });
      const data = await res.json();
      const text = data?.text || "";
      setTranscript(prev => prev.trim() ? `${prev}\n${text}` : text);
    } catch { alert("Transcription failed"); }
    setProcessing(false);
  };

  const handleSubmit = () => {
    if (transcript.trim()) { onTranscript(transcript); setTranscript(""); }
  };

  const handleGenerateAI = async () => {
    setPopupOpen(true);
    setIsGenerating(true);
    setGeneratingAI(true);
    try {
      if (window.generateAIRecommendation) {
        const result = await window.generateAIRecommendation();
        if (result?.success) setAiRecommendationData(result);
        else setPopupOpen(false);
      }
    } catch { setPopupOpen(false); }
    finally { setIsGenerating(false); setGeneratingAI(false); }
  };

  const handleAcceptAI = finalRecommendation => {
    setTranscript(prev => `${prev}${prev.trim() ? "\n\n" : ""}${finalRecommendation}`);
    setPopupOpen(false); setAiRecommendationData(null); setIsGenerating(false);
  };
  const handleRejectAI = () => { setPopupOpen(false); setAiRecommendationData(null); setIsGenerating(false); };

  // Shared button base
  const btnBase = {
    borderRadius: 0,
    textTransform: "none",
    fontFamily: FONT,
    fontWeight: FW_LIGHT,
    fontSize: 12,
    px: 2,
    py: 0.75,
    letterSpacing: "0.02em",
    transition: "all 0.15s",
  };

  return (
    <Box sx={{ mb: 0 }}>
      {/* Section label */}
      <Box sx={{ display: "flex", alignItems: "center", justifyContent: "space-between", mb: 2, flexWrap: "wrap", gap: 1.5 }}>
        <Box>
          <Typography sx={{ ...labelStyle, mb: 0.5 }}>Your Input</Typography>
          <Typography sx={{ fontSize: 15, fontWeight: FW_NORMAL, fontFamily: FONT, color: C.textPrimary, letterSpacing: "-0.01em" }}>
            Share Your Recommendation
          </Typography>
        </Box>
        <Box sx={{ display: "flex", gap: 1, flexWrap: "wrap" }}>
          {/* Record */}
          <Button variant="contained" onClick={recording ? stopRecording : startRecording} sx={{
            ...btnBase,
            background: recording ? "#000" : C.black,
            color: C.white,
            border: `1px solid ${recording ? "#444" : C.black}`,
            "&:hover": { background: C.white, color: C.black },
          }}>
            {recording
              ? <><Stop sx={{ mr: 0.5, fontSize: 15 }} />Stop Recording</>
              : <><Mic  sx={{ mr: 0.5, fontSize: 15 }} />Start Recording</>
            }
          </Button>

          {/* Generate AI */}
          <Button variant="contained" onClick={handleGenerateAI} disabled={generatingAI} sx={{
            ...btnBase,
            background: C.black,
            color: C.white,
            border: `1px solid ${C.black}`,
            "&:hover": { background: C.white, color: C.black },
            "&.Mui-disabled": { background: C.bgTertiary, color: C.textMuted },
          }}>
            <AutoAwesomeIcon sx={{ mr: 0.5, fontSize: 15 }} />
            {generatingAI ? "Generating..." : "Generate AI"}
          </Button>

          {/* Post */}
          <Button variant="outlined" onClick={handleSubmit} disabled={!transcript.trim() || processing} sx={{
            ...btnBase,
            borderColor: C.black,
            color: C.black,
            background: C.white,
            "&:hover": { background: C.black, color: C.white },
            "&.Mui-disabled": { borderColor: C.border, color: C.textMuted },
          }}>
            <SendRounded sx={{ mr: 0.5, fontSize: 15 }} />
            Post Recommendation
          </Button>
        </Box>
      </Box>

      {/* Recording indicator */}
      {recording && (
        <Box sx={{
          display: "flex", alignItems: "center", gap: 1, mb: 1.5,
          px: 1.5, py: 0.75,
          border: `1px solid ${C.border}`,
          background: C.bgSecondary,
          width: "fit-content",
        }}>
          <Box sx={{
            width: 7, height: 7, borderRadius: "50%", background: C.black,
            animation: "tbPulse 1.4s infinite",
            "@keyframes tbPulse": {
              "0%,100%": { opacity: 1 },
              "50%": { opacity: 0.3 },
            },
          }} />
          <Typography sx={{ color: C.textPrimary, fontSize: 11, fontFamily: FONT, fontWeight: FW_LIGHT, letterSpacing: "0.05em" }}>
            Recording in progress — speak clearly
          </Typography>
        </Box>
      )}

      {/* Textarea */}
      <Box sx={{ position: "relative" }}>
        <AutoExpandTextarea
          value={transcript}
          onChange={e => setTranscript(e.target.value)}
          placeholder="Type your recommendation or click 'Start Recording' to speak. Share your clinical insights, treatment suggestions, or case observations..."
          disabled={processing}
        />
        {processing && (
          <Box sx={{
            position: "absolute", inset: 0, display: "flex", alignItems: "center",
            justifyContent: "center", background: "rgba(255,255,255,0.75)",
          }}>
            <CircularProgress size={28} sx={{ color: C.black }} />
          </Box>
        )}
      </Box>

      {/* AI Popup */}
      <RecommendationPopup
        open={popupOpen}
        onClose={() => { if (!generatingAI) { setPopupOpen(false); setAiRecommendationData(null); setIsGenerating(false); } }}
        recommendationData={aiRecommendationData}
        onAccept={handleAcceptAI}
        onReject={handleRejectAI}
        loading={generatingAI}
        isGenerating={isGenerating}
      />
    </Box>
  );
};

// ─── CARE PATHWAY DICTATION (new) ────────────────────────────────────────────
// Sits directly under the "Generate Care Pathway Plan" button. Doctor can
// record/type notes (reusing the same transcription endpoint as the
// recommendation box below), then click "Process" to feed those notes into
// the same generate -> review -> draft flow.
// There's no separate action button here — this is a controlled input only.
// The single "Generate Care Pathway Plan" button reads this text and decides
// which endpoint to call:
//   - empty  -> generate-care-pathway (unchanged, original behavior)
//   - filled -> process-tumor-board (dictation gets processed instead)
const CarePathwayDictation = ({ value, onTextChange, disabled, onGenerate, generating }) => {
  const mediaRecorder = useRef(null);
  const audioChunks   = useRef([]);
  const [recording, setRecording]       = useState(false);
  const [transcribing, setTranscribing] = useState(false);

  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      mediaRecorder.current = new MediaRecorder(stream);
      audioChunks.current = [];
      mediaRecorder.current.ondataavailable = e => { if (e.data.size > 0) audioChunks.current.push(e.data); };
      mediaRecorder.current.start();
      setRecording(true);
    } catch { alert("Microphone permission is required."); }
  };

  const stopRecording = () => {
    if (!mediaRecorder.current) return;
    mediaRecorder.current.onstop = processAudio;
    mediaRecorder.current.stop();
    mediaRecorder.current.stream.getTracks().forEach(t => t.stop());
    setRecording(false);
  };

  const processAudio = async () => {
    if (!audioChunks.current.length) return;
    setTranscribing(true);
    try {
      const blob = new Blob(audioChunks.current, { type: "audio/webm" });
      audioChunks.current = [];
      const formData = new FormData();
      formData.append("file", blob);
      const res  = await fetch(`${API_BASE_URL}hms/users/ai/elevenlabs/api/transcribe_labs`, { method: "POST", body: formData });
      const data = await res.json();
      const transcribedText = data?.text || "";
      onTextChange(value.trim() ? `${value}\n${transcribedText}` : transcribedText);
    } catch { alert("Transcription failed"); }
    setTranscribing(false);
  };

  const btnBase = {
    borderRadius: 0,
    textTransform: "none",
    fontFamily: FONT,
    fontWeight: FW_LIGHT,
    fontSize: 12,
    px: 2,
    py: 0.75,
    letterSpacing: "0.02em",
    transition: "all 0.15s",
  };

  return (
    <Box sx={{ width: "100%" }}>
      {/* Section label + record action */}
      <Box sx={{ display: "flex", alignItems: "center", justifyContent: "space-between", mb: 1.5, flexWrap: "wrap", gap: 1.5 }}>
        <Box>
          <Typography sx={{ ...labelStyle, mb: 0.5 }}>Dictate (optional)</Typography>
          <Typography sx={{ fontSize: 14, fontWeight: FW_NORMAL, fontFamily: FONT, color: C.textPrimary, letterSpacing: "-0.01em" }}>
            Care Pathway Dictation
          </Typography>
        </Box>
        <Box sx={{ display: "flex", gap: 1, flexWrap: "wrap" }}>
          {/* Record */}
          <Button
            variant="contained"
            onClick={recording ? stopRecording : startRecording}
            disabled={disabled}
            sx={{
              ...btnBase,
              background: C.black,
              color: C.white,
              border: `1px solid ${C.black}`,
              "&:hover": { background: C.white, color: C.black },
              "&.Mui-disabled": { background: C.bgTertiary, color: C.textMuted },
            }}
          >
            {recording
              ? <><Stop sx={{ mr: 0.5, fontSize: 15 }} />Stop Recording</>
              : <><Mic  sx={{ mr: 0.5, fontSize: 15 }} />Start Recording</>
            }
          </Button>

          {/* Generate Care Pathway Plan — sits beside this section's Start Recording button */}
          {onGenerate && (
            <Button
              variant="contained"
              onClick={onGenerate}
              disabled={generating || disabled}
              sx={{
                ...btnBase,
                background: C.black,
                color: C.white,
                border: `1px solid ${C.black}`,
                "&:hover": { background: C.white, color: C.black },
                "&.Mui-disabled": { background: C.bgTertiary, color: C.textMuted },
              }}
            >
              {generating
                ? <CircularProgress size={14} sx={{ mr: 0.75, color: "inherit" }} />
                : <AccountTreeRounded sx={{ mr: 0.5, fontSize: 15 }} />
              }
              {generating ? "Generating..." : "Generate Care Pathway Plan"}
            </Button>
          )}
        </Box>
      </Box>

      {/* Recording indicator */}
      {recording && (
        <Box sx={{
          display: "flex", alignItems: "center", gap: 1, mb: 1.5,
          px: 1.5, py: 0.75,
          border: `1px solid ${C.border}`,
          background: C.bgSecondary,
          width: "fit-content",
        }}>
          <Box sx={{
            width: 7, height: 7, borderRadius: "50%", background: C.black,
            animation: "tbPulse 1.4s infinite",
          }} />
          <Typography sx={{ color: C.textPrimary, fontSize: 11, fontFamily: FONT, fontWeight: FW_LIGHT, letterSpacing: "0.05em" }}>
            Recording in progress — speak clearly
          </Typography>
        </Box>
      )}

      {/* Textarea */}
      <Box sx={{ position: "relative" }}>
        <AutoExpandTextarea
          value={value}
          onChange={e => onTextChange(e.target.value)}
          placeholder="Dictate or type notes here to process instead of generating from scratch — additional context, patient preferences, treatment constraints. Leave empty to just generate the care pathway plan directly."
          disabled={transcribing || disabled}
        />
        {transcribing && (
          <Box sx={{
            position: "absolute", inset: 0, display: "flex", alignItems: "center",
            justifyContent: "center", background: "rgba(255,255,255,0.75)",
          }}>
            <CircularProgress size={24} sx={{ color: C.black }} />
          </Box>
        )}
      </Box>
    </Box>
  );
};

// ─── RECOMMENDATION CARD ─────────────────────────────────────────────────────
const RecommendationCard = ({ recommendation, isCurrentDoctor = false, doctorNames = {} }) => {
  const [expanded, setExpanded] = useState(false);
  const text           = recommendation.doctor_recommendation || recommendation.text;
  const shouldTruncate = text && text.length > 200 && !expanded;
  const displayText    = shouldTruncate ? text.substring(0, 200) + "..." : text;
  const resolvedName   = doctorNames[recommendation.doctor_id] || recommendation.doctor_name;
  const initials       = (resolvedName || "D")[0].toUpperCase();

  return (
    <Card sx={{
      mb: 0,
      background: C.bgPrimary,
      borderRadius: 0,
      boxShadow: "none",
      border: `1px solid ${C.border}`,
      borderBottom: "none",
      transition: "border-color 0.15s",
      "&:last-of-type": { borderBottom: `1px solid ${C.border}` },
      "&:hover": { borderColor: C.borderStrong, zIndex: 1, position: "relative" },
    }}>
      <CardContent sx={{ p: 2 }}>
        {/* Header */}
        <Box sx={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", mb: 1.5 }}>
          <Box sx={{ display: "flex", alignItems: "center", gap: 1.5 }}>
            <Avatar sx={{
              width: 36, height: 36, borderRadius: 0,
              background: C.black,
              fontSize: 13, fontWeight: FW_NORMAL, fontFamily: FONT,
            }}>
              {initials}
            </Avatar>
            <Box>
              <Box sx={{ display: "flex", alignItems: "center", gap: 1, flexWrap: "wrap" }}>
                <Typography sx={{ fontSize: 13, fontWeight: FW_NORMAL, fontFamily: FONT, color: C.textPrimary }}>
                  {resolvedName ? `Dr. ${resolvedName}` : "Loading..."}
                </Typography>
                {isCurrentDoctor && (
                  <Box sx={{
                    px: 0.75, py: 0.1,
                    background: C.black, color: C.white,
                    fontSize: 9, fontFamily: FONT, fontWeight: FW_NORMAL,
                    textTransform: "uppercase", letterSpacing: "0.12em",
                    lineHeight: 1.8,
                  }}>
                    You
                  </Box>
                )}
              </Box>
              <Box sx={{ display: "flex", alignItems: "center", gap: 1.5, mt: 0.4 }}>
                <Typography sx={{
                  fontSize: 10, fontFamily: FONT, fontWeight: FW_NORMAL,
                  color: C.textMuted, textTransform: "uppercase", letterSpacing: "0.08em",
                }}>
                  {recommendation.speciality || "Oncology"}
                </Typography>
                <Box sx={{ display: "flex", alignItems: "center", gap: 0.4 }}>
                  <AccessTimeRounded sx={{ fontSize: 10, color: C.textMuted }} />
                  <Typography sx={{ fontSize: 10, color: C.textMuted, fontFamily: FONT }}>
                    {new Date(recommendation.created_at).toLocaleString()}
                  </Typography>
                </Box>
              </Box>
            </Box>
          </Box>
        </Box>

        {/* Body */}
        <Typography sx={{
          fontSize: 13, fontFamily: FONT, fontWeight: FW_LIGHT,
          lineHeight: 1.75, color: C.textSecond, whiteSpace: "pre-wrap", mb: 1,
        }}>
          {displayText}
        </Typography>

        {text && text.length > 200 && (
          <Button onClick={() => setExpanded(!expanded)} sx={{
            fontSize: 11, textTransform: "none", color: C.textMuted,
            fontFamily: FONT, p: 0, minWidth: "auto",
            "&:hover": { background: "transparent", color: C.textPrimary, textDecoration: "underline" },
          }}>
            {expanded ? "Show less" : "Read more"}
          </Button>
        )}
      </CardContent>
    </Card>
  );
};

// ─── CASE BRIEF HISTORY ITEM (past generated presentations) ─────────────────
const CaseBriefHistoryItem = ({ item }) => {
  const [expanded, setExpanded] = useState(false);
  const text = item.presentation || "";
  const shouldTruncate = text.length > 200 && !expanded;
  const displayText = shouldTruncate ? text.substring(0, 200) + "..." : text;

  return (
    <Card sx={{
      mb: 0, background: C.bgPrimary, borderRadius: 0, boxShadow: "none",
      border: `1px solid ${C.border}`, borderBottom: "none",
      "&:last-of-type": { borderBottom: `1px solid ${C.border}` },
      "&:hover": { borderColor: C.borderStrong, zIndex: 1, position: "relative" },
    }}>
      <CardContent sx={{ p: 2 }}>
        <Box sx={{ display: "flex", alignItems: "center", justifyContent: "space-between", mb: 1, flexWrap: "wrap", gap: 0.75 }}>
          <Typography sx={{ fontSize: 10.5, fontFamily: FONT, fontWeight: FW_NORMAL, color: C.textMuted, textTransform: "uppercase", letterSpacing: "0.06em" }}>
            Case Brief
          </Typography>
          <Box sx={{ display: "flex", alignItems: "center", gap: 0.4 }}>
            <AccessTimeRounded sx={{ fontSize: 11, color: C.textMuted }} />
            <Typography sx={{ fontSize: 10.5, color: C.textMuted, fontFamily: FONT }}>
              {item.generated_at ? new Date(item.generated_at).toLocaleString() : "Unknown date"}
            </Typography>
          </Box>
        </Box>
        <Typography sx={{
          fontSize: 12.5, fontFamily: FONT, fontWeight: FW_LIGHT,
          lineHeight: 1.75, color: C.textSecond, whiteSpace: "pre-wrap", mb: 1,
        }}>
          {displayText}
        </Typography>
        {text.length > 200 && (
          <Button onClick={() => setExpanded(!expanded)} sx={{
            fontSize: 11, textTransform: "none", color: C.textMuted,
            fontFamily: FONT, p: 0, minWidth: "auto",
            "&:hover": { background: "transparent", color: C.textPrimary, textDecoration: "underline" },
          }}>
            {expanded ? "Show less" : "Read more"}
          </Button>
        )}
      </CardContent>
    </Card>
  );
};

// ─── SECTION HEADER ──────────────────────────────────────────────────────────
const SectionHeader = ({ count, label, countSuffix }) => (
  <Box sx={{ display: "flex", alignItems: "center", justifyContent: "space-between", mb: 0, px: 0, py: 1.25, borderBottom: `1px solid ${C.borderStrong}` }}>
    <Typography sx={{ ...labelStyle }}>
      {label}
    </Typography>
    <Typography sx={{ ...labelStyle }}>
      {count} {countSuffix || (count === 1 ? "recommendation" : "recommendations")}
    </Typography>
  </Box>
);

// ─── CARE PATHWAY STEP ROW (clickable) ───────────────────────────────────────
const CarePathwayStepRow = ({ step, onClick, isLast }) => {
  const status = getStatusStyle(step.status);
  return (
    <Box
      onClick={() => onClick(step)}
      sx={{
        display: "flex",
        alignItems: "center",
        gap: 1.5,
        px: 1.75,
        py: 1.5,
        border: `1px solid ${C.border}`,
        borderBottom: isLast ? `1px solid ${C.border}` : "none",
        background: C.bgPrimary,
        cursor: "pointer",
        transition: "background 0.15s, border-color 0.15s",
        "&:hover": { background: C.bgSecondary, borderColor: C.borderStrong, position: "relative", zIndex: 1 },
      }}
    >
      {/* Step number badge */}
      <Box sx={{
        width: 26, height: 26, flexShrink: 0,
        border: `1px solid ${C.black}`,
        display: "flex", alignItems: "center", justifyContent: "center",
        fontSize: 11, fontFamily: FONT, fontWeight: FW_NORMAL, color: C.black,
      }}>
        {step.step_number}
      </Box>

      {/* Main info */}
      <Box sx={{ flex: 1, minWidth: 0 }}>
        <Box sx={{ display: "flex", alignItems: "center", gap: 0.75, flexWrap: "wrap" }}>
          <Typography sx={{ fontSize: 13, fontWeight: FW_NORMAL, fontFamily: FONT, color: C.textPrimary }}>
            {step.phase_name}
          </Typography>
          {step.is_urgent && (
            <Box sx={{ display: "flex", alignItems: "center", gap: 0.3, color: "#a12525" }}>
              <FlagRounded sx={{ fontSize: 12 }} />
              <Typography sx={{ fontSize: 9.5, fontFamily: FONT, fontWeight: FW_NORMAL, textTransform: "uppercase", letterSpacing: "0.08em" }}>
                Urgent
              </Typography>
            </Box>
          )}
        </Box>
        <Typography sx={{ fontSize: 11.5, color: C.textMuted, fontFamily: FONT, fontWeight: FW_LIGHT, mt: 0.25 }} noWrap>
          {step.treatment_name}
        </Typography>
      </Box>

      {/* Modality chip */}
      <Chip
        label={MODALITY_LABELS[step.modality] || step.modality}
        size="small"
        sx={{
          display: { xs: "none", sm: "flex" },
          borderRadius: 0, fontFamily: FONT, fontSize: 10.5, fontWeight: FW_NORMAL,
          height: 22, border: `1px solid ${C.border}`, background: C.bgSecondary, color: C.textSecond,
        }}
      />

      {/* Status chip */}
      <Box sx={{
        px: 1, py: 0.4,
        border: `1px solid ${status.border}`,
        background: status.bg, color: status.color,
        fontSize: 10, fontFamily: FONT, fontWeight: FW_NORMAL,
        textTransform: "uppercase", letterSpacing: "0.06em",
        flexShrink: 0, whiteSpace: "nowrap",
      }}>
        {status.label}
      </Box>

      <ChevronRightRounded sx={{ fontSize: 18, color: C.textMuted, flexShrink: 0 }} />
    </Box>
  );
};

// ─── STEP DETAIL DIALOG ──────────────────────────────────────────────────────
const StepDetailDialog = ({ step, open, onClose }) => {
  if (!step) return null;
  const status = getStatusStyle(step.status);

  const DetailRow = ({ label, children }) => (
    <Box sx={{ mb: 2 }}>
      <Typography sx={{ ...labelStyle, mb: 0.6 }}>{label}</Typography>
      {children}
    </Box>
  );

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth
      PaperProps={{ sx: { borderRadius: 0, background: C.bgPrimary, border: `1px solid ${C.borderStrong}`, boxShadow: "4px 4px 0px #000" } }}
    >
      <DialogTitle sx={{
        pb: 1.5, pt: 2, px: 2.5, borderBottom: `1px solid ${C.border}`,
        display: "flex", alignItems: "flex-start", justifyContent: "space-between", background: C.bgSecondary,
      }}>
        <Box sx={{ display: "flex", alignItems: "center", gap: 1.5 }}>
          <Box sx={{
            width: 32, height: 32, border: `1px solid ${C.black}`,
            display: "flex", alignItems: "center", justifyContent: "center", fontSize: 13, fontFamily: FONT,
          }}>
            {step.step_number}
          </Box>
          <Box>
            <Typography sx={{ ...labelStyle, mb: 0.25 }}>{MODALITY_LABELS[step.modality] || step.modality}</Typography>
            <Typography sx={{ fontSize: 16, fontWeight: FW_NORMAL, fontFamily: FONT, color: C.textPrimary, letterSpacing: "-0.01em" }}>
              {step.phase_name}
            </Typography>
          </Box>
        </Box>
        <IconButton onClick={onClose} size="small" sx={{ borderRadius: 0, color: C.textMuted }}>
          <CloseRounded sx={{ fontSize: 18 }} />
        </IconButton>
      </DialogTitle>

      <DialogContent sx={{ pt: 3, px: 2.5, pb: 2.5 }}>
        <Box sx={{ display: "flex", gap: 1, mb: 3, flexWrap: "wrap" }}>
          <Box sx={{
            px: 1.25, py: 0.5, border: `1px solid ${status.border}`, background: status.bg, color: status.color,
            fontSize: 10.5, fontFamily: FONT, fontWeight: FW_NORMAL, textTransform: "uppercase", letterSpacing: "0.06em",
          }}>
            {status.label}
          </Box>
          {step.is_urgent && (
            <Box sx={{
              px: 1.25, py: 0.5, border: "1px solid #f0bcbc", background: "#fdeeee", color: "#a12525",
              fontSize: 10.5, fontFamily: FONT, fontWeight: FW_NORMAL, textTransform: "uppercase", letterSpacing: "0.06em",
              display: "flex", alignItems: "center", gap: 0.4,
            }}>
              <FlagRounded sx={{ fontSize: 12 }} /> Urgent
            </Box>
          )}
        </Box>

        <DetailRow label="Treatment">
          <Typography sx={{ fontSize: 13.5, fontFamily: FONT, fontWeight: FW_NORMAL, color: C.textPrimary }}>
            {step.treatment_name}
          </Typography>
        </DetailRow>

        <DetailRow label="Detailed Plan">
          <Typography sx={{ fontSize: 13, fontFamily: FONT, fontWeight: FW_LIGHT, color: C.textSecond, lineHeight: 1.7 }}>
            {step.detailed_plan}
          </Typography>
        </DetailRow>

        <Box sx={{ display: "flex", gap: 3, mb: 2, flexWrap: "wrap" }}>
          <DetailRow label="Timing">
            <Typography sx={{ fontSize: 12.5, fontFamily: FONT, color: C.textSecond }}>{step.sequence_timing}</Typography>
          </DetailRow>
          <DetailRow label="Duration">
            <Typography sx={{ fontSize: 12.5, fontFamily: FONT, color: C.textSecond }}>{step.estimated_duration}</Typography>
          </DetailRow>
          <DetailRow label="Responsible Specialty">
            <Typography sx={{ fontSize: 12.5, fontFamily: FONT, color: C.textSecond }}>{step.responsible_specialty}</Typography>
          </DetailRow>
        </Box>

        {step.monitoring_before_starting?.length > 0 && (
          <DetailRow label="Monitoring Before Starting">
            <Box sx={{ display: "flex", flexDirection: "column", gap: 0.5 }}>
              {step.monitoring_before_starting.map((m, i) => (
                <Typography key={i} sx={{ fontSize: 12.5, fontFamily: FONT, color: C.textSecond }}>• {m}</Typography>
              ))}
            </Box>
          </DetailRow>
        )}

        <DetailRow label="Rationale">
          <Typography sx={{ fontSize: 13, fontFamily: FONT, fontWeight: FW_LIGHT, color: C.textSecond, lineHeight: 1.7 }}>
            {step.rationale}
          </Typography>
        </DetailRow>

        <DetailRow label="Guideline Support">
          <Typography sx={{ fontSize: 12.5, fontFamily: FONT, color: C.textSecond, fontStyle: "italic" }}>
            {step.guideline_support}
          </Typography>
        </DetailRow>

        {step.contributing_doctors?.length > 0 && (
          <DetailRow label="Contributing Specialties">
            <Box sx={{ display: "flex", gap: 0.75, flexWrap: "wrap" }}>
              {step.contributing_doctors.map((d, i) => (
                <Chip key={i} label={d} size="small" sx={{
                  borderRadius: 0, fontFamily: FONT, fontSize: 11, height: 24,
                  border: `1px solid ${C.border}`, background: C.bgSecondary, color: C.textSecond,
                }} />
              ))}
            </Box>
          </DetailRow>
        )}

        {step.status_reason && (
          <Box sx={{ mt: 1, p: 1.5, background: C.bgSecondary, border: `1px solid ${C.border}` }}>
            <Typography sx={{ fontSize: 11.5, fontFamily: FONT, color: C.textMuted, lineHeight: 1.6 }}>
              {step.status_reason}
            </Typography>
          </Box>
        )}
      </DialogContent>
    </Dialog>
  );
};

// ─── CARE PATHWAY GENERATE POPUP (review before it becomes a draft) ─────────
const CarePathwayPopup = ({ open, onClose, loading, planData, errorMessage, onContinue, onDecline, onStepClick }) => {
  const plan = planData?.care_pathway_plan;

  return (
    <Dialog open={open} onClose={loading ? undefined : onClose} maxWidth="md" fullWidth
      PaperProps={{ sx: { borderRadius: 0, background: C.bgPrimary, border: `1px solid ${C.borderStrong}`, boxShadow: "4px 4px 0px #000" } }}
    >
      <DialogTitle sx={{
        pb: 1.5, pt: 2, px: 2.5, borderBottom: `1px solid ${C.border}`,
        display: "flex", alignItems: "center", justifyContent: "space-between", background: C.bgSecondary,
      }}>
        <Box sx={{ display: "flex", alignItems: "center", gap: 1.5 }}>
          <Box sx={{ width: 32, height: 32, background: C.black, display: "flex", alignItems: "center", justifyContent: "center" }}>
            <AccountTreeRounded sx={{ fontSize: 18, color: C.white }} />
          </Box>
          <Box>
            <Typography sx={{ ...labelStyle, mb: 0.25 }}>AI Generated</Typography>
            <Typography sx={{ fontSize: 16, fontWeight: FW_NORMAL, fontFamily: FONT, color: C.textPrimary, letterSpacing: "-0.01em" }}>
              Care Pathway Plan
            </Typography>
          </Box>
        </Box>
        {!loading && (
          <IconButton onClick={onClose} size="small" sx={{ borderRadius: 0, color: C.textMuted }}>
            <CloseRounded sx={{ fontSize: 18 }} />
          </IconButton>
        )}
      </DialogTitle>

      <DialogContent sx={{ pt: 3, px: 2.5, pb: 2.5 }}>
        {loading && (
          <Box sx={{ display: "flex", flexDirection: "column", alignItems: "center", py: 8, gap: 2 }}>
            <CircularProgress size={28} sx={{ color: C.black }} />
            <Typography sx={{ fontSize: 12.5, color: C.textMuted, fontFamily: FONT, fontWeight: FW_LIGHT }}>
              Synthesizing specialist opinions into a care pathway...
            </Typography>
          </Box>
        )}

        {!loading && errorMessage && (
          <Alert severity="error" sx={{ borderRadius: 0, fontFamily: FONT, fontSize: 13 }}>
            {errorMessage}
          </Alert>
        )}

        {!loading && !errorMessage && plan && (
          <>
            {/* Patient / diagnosis summary */}
            <Box sx={{ mb: 3, p: 2, background: C.bgSecondary, border: `1px solid ${C.border}` }}>
              <Box sx={{ display: "flex", justifyContent: "space-between", flexWrap: "wrap", gap: 2 }}>
                <Box>
                  <Typography sx={{ ...labelStyle, mb: 0.5 }}>Primary Diagnosis</Typography>
                  <Typography sx={{ fontSize: 14, fontWeight: FW_NORMAL, fontFamily: FONT, color: C.textPrimary }}>
                    {plan.primary_diagnosis}
                  </Typography>
                  <Typography sx={{ fontSize: 12, color: C.textMuted, fontFamily: FONT, mt: 0.25 }}>
                    Stage {plan.cancer_stage} · {plan.patient_age}y, {plan.patient_sex}
                  </Typography>
                </Box>
                <Box sx={{ textAlign: "right" }}>
                  <Typography sx={{ ...labelStyle, mb: 0.5 }}>Treatment Intent</Typography>
                  <Box sx={{
                    display: "inline-block", px: 1.25, py: 0.5, background: C.black, color: C.white,
                    fontSize: 11, fontFamily: FONT, fontWeight: FW_NORMAL, textTransform: "capitalize",
                  }}>
                    {plan.overall_treatment_intent}
                  </Box>
                  <Typography sx={{ fontSize: 11, color: C.textMuted, fontFamily: FONT, mt: 0.75 }}>
                    Confidence: {Math.round((plan.confidence_score || 0) * 100)}%
                  </Typography>
                </Box>
              </Box>
            </Box>

            {/* Safety flags */}
            {plan.safety_flags?.length > 0 && (
              <Alert
                severity="warning"
                icon={<WarningAmberRounded sx={{ fontSize: 18 }} />}
                sx={{ borderRadius: 0, mb: 2.5, fontFamily: FONT, fontSize: 12.5, alignItems: "flex-start" }}
              >
                {plan.safety_flags.map((f, i) => <Box key={i} sx={{ mb: i < plan.safety_flags.length - 1 ? 0.5 : 0 }}>{f}</Box>)}
              </Alert>
            )}

            {/* MDT basis */}
            <Typography sx={{ fontSize: 12, color: C.textSecond, fontFamily: FONT, fontWeight: FW_LIGHT, lineHeight: 1.7, mb: 2.5 }}>
              {plan.mdt_basis_summary}
            </Typography>

            {/* Steps */}
            <Typography sx={{ ...labelStyle, mb: 1 }}>
              Treatment Steps ({plan.total_steps}) — click a row for full detail
            </Typography>
            <Box sx={{ mb: 1 }}>
              {plan.steps.map((step, idx) => (
                <CarePathwayStepRow
                  key={step.step_number}
                  step={step}
                  onClick={onStepClick}
                  isLast={idx === plan.steps.length - 1}
                />
              ))}
            </Box>

            <Typography sx={{ fontSize: 11.5, color: C.textMuted, fontFamily: FONT, fontWeight: FW_LIGHT, mt: 2 }}>
              This is a preview only. Continue to add it as a draft — you'll be able to edit it before final approval.
            </Typography>
          </>
        )}
      </DialogContent>

      {!loading && !errorMessage && plan && (
        <DialogActions sx={{ p: 2.5, pt: 2, gap: 1, borderTop: `1px solid ${C.border}`, background: C.bgSecondary }}>
          <Button onClick={onDecline} sx={{
            textTransform: "none", fontFamily: FONT, fontWeight: FW_LIGHT,
            color: "#a12525", borderRadius: 0, fontSize: 13,
            "&:hover": { background: "#fdeeee" },
          }}>
            <CancelRounded sx={{ mr: 0.5, fontSize: 16 }} />
            Decline
          </Button>
          <Button onClick={onContinue} variant="contained" sx={{
            background: C.black, textTransform: "none", fontFamily: FONT,
            fontWeight: FW_NORMAL, fontSize: 13, borderRadius: 0,
            border: `1px solid ${C.black}`,
            "&:hover": { background: C.white, color: C.black },
          }}>
            <ChevronRightRounded sx={{ mr: 0.5, fontSize: 16 }} />
            Continue
          </Button>
        </DialogActions>
      )}
    </Dialog>
  );
};

// ─── EDIT CARE PATHWAY DIALOG ────────────────────────────────────────────────
const fieldSx = {
  "& .MuiOutlinedInput-root": {
    borderRadius: 0, fontFamily: FONT, fontSize: 12.5,
    "& fieldset": { borderColor: C.border },
    "&:hover fieldset": { borderColor: C.black },
    "&.Mui-focused fieldset": { borderColor: C.black, borderWidth: 1 },
  },
  "& .MuiInputLabel-root": { fontFamily: FONT, fontSize: 12.5 },
};

const EditCarePathwayDialog = ({ open, onClose, plan, onSave }) => {
  const [draft, setDraft] = useState(null);

  useEffect(() => {
    if (open && plan) setDraft(JSON.parse(JSON.stringify(plan)));
  }, [open, plan]);

  if (!draft) return null;

  const updateTop = (field, value) => setDraft(prev => ({ ...prev, [field]: value }));

  const updateStep = (idx, field, value) => {
    setDraft(prev => {
      const steps = [...prev.steps];
      steps[idx] = { ...steps[idx], [field]: value };
      return { ...prev, steps };
    });
  };

  const updateStepList = (idx, field, value) => {
    const arr = value.split(",").map(s => s.trim()).filter(Boolean);
    updateStep(idx, field, arr);
  };

  const handleSave = () => {
    onSave(draft);
  };

  return (
    <Dialog open={open} onClose={onClose} maxWidth="md" fullWidth
      PaperProps={{ sx: { borderRadius: 0, background: C.bgPrimary, border: `1px solid ${C.borderStrong}`, boxShadow: "4px 4px 0px #000" } }}
    >
      <DialogTitle sx={{
        pb: 1.5, pt: 2, px: 2.5, borderBottom: `1px solid ${C.border}`,
        display: "flex", alignItems: "center", justifyContent: "space-between", background: C.bgSecondary,
      }}>
        <Box sx={{ display: "flex", alignItems: "center", gap: 1.5 }}>
          <Box sx={{ width: 32, height: 32, background: C.black, display: "flex", alignItems: "center", justifyContent: "center" }}>
            <EditRounded sx={{ fontSize: 18, color: C.white }} />
          </Box>
          <Box>
            <Typography sx={{ ...labelStyle, mb: 0.25 }}>Draft</Typography>
            <Typography sx={{ fontSize: 16, fontWeight: FW_NORMAL, fontFamily: FONT, color: C.textPrimary, letterSpacing: "-0.01em" }}>
              Edit Care Pathway Plan
            </Typography>
          </Box>
        </Box>
        <IconButton onClick={onClose} size="small" sx={{ borderRadius: 0, color: C.textMuted }}>
          <CloseRounded sx={{ fontSize: 18 }} />
        </IconButton>
      </DialogTitle>

      <DialogContent sx={{ pt: 3, px: 2.5, pb: 2.5 }}>
        {/* Top-level fields */}
        <Typography sx={{ ...labelStyle, mb: 1.25 }}>Plan Summary</Typography>
        <Box sx={{ display: "flex", gap: 1.5, flexWrap: "wrap", mb: 2 }}>
          <TextField
            label="Primary Diagnosis" value={draft.primary_diagnosis || ""}
            onChange={e => updateTop("primary_diagnosis", e.target.value)}
            sx={{ ...fieldSx, flex: "1 1 260px" }}
          />
          <TextField
            label="Cancer Stage" value={draft.cancer_stage || ""}
            onChange={e => updateTop("cancer_stage", e.target.value)}
            sx={{ ...fieldSx, flex: "1 1 120px" }}
          />
          <TextField
            label="Patient Age" value={draft.patient_age || ""}
            onChange={e => updateTop("patient_age", e.target.value)}
            sx={{ ...fieldSx, flex: "1 1 100px" }}
          />
          <TextField
            label="Patient Sex" value={draft.patient_sex || ""}
            onChange={e => updateTop("patient_sex", e.target.value)}
            sx={{ ...fieldSx, flex: "1 1 100px" }}
          />
          <TextField
            label="Overall Treatment Intent" value={draft.overall_treatment_intent || ""}
            onChange={e => updateTop("overall_treatment_intent", e.target.value)}
            sx={{ ...fieldSx, flex: "1 1 200px" }}
          />
        </Box>
        <TextField
          fullWidth multiline rows={3}
          label="MDT Basis Summary" value={draft.mdt_basis_summary || ""}
          onChange={e => updateTop("mdt_basis_summary", e.target.value)}
          sx={{ ...fieldSx, mb: 3 }}
        />

        <Divider sx={{ mb: 2.5 }} />

        {/* Steps */}
        <Typography sx={{ ...labelStyle, mb: 1.5 }}>
          Treatment Steps ({draft.steps?.length || 0})
        </Typography>

        <Box sx={{ display: "flex", flexDirection: "column", gap: 2.5 }}>
          {draft.steps?.map((step, idx) => (
            <Box key={step.step_number ?? idx} sx={{ p: 2, border: `1px solid ${C.border}`, background: C.bgSecondary }}>
              <Box sx={{ display: "flex", alignItems: "center", gap: 1, mb: 1.5 }}>
                <Box sx={{
                  width: 22, height: 22, border: `1px solid ${C.black}`, flexShrink: 0,
                  display: "flex", alignItems: "center", justifyContent: "center", fontSize: 10.5, fontFamily: FONT,
                }}>
                  {step.step_number}
                </Box>
                <Typography sx={{ fontSize: 12, fontWeight: FW_NORMAL, fontFamily: FONT, color: C.textPrimary }}>
                  Step {step.step_number}
                </Typography>
              </Box>

              <Box sx={{ display: "flex", gap: 1.5, flexWrap: "wrap", mb: 1.5 }}>
                <TextField
                  label="Phase Name" value={step.phase_name || ""}
                  onChange={e => updateStep(idx, "phase_name", e.target.value)}
                  sx={{ ...fieldSx, flex: "1 1 200px", background: C.bgPrimary }}
                />
                <TextField
                  label="Treatment Name" value={step.treatment_name || ""}
                  onChange={e => updateStep(idx, "treatment_name", e.target.value)}
                  sx={{ ...fieldSx, flex: "1 1 200px", background: C.bgPrimary }}
                />
                <FormControl sx={{ ...fieldSx, flex: "1 1 160px", background: C.bgPrimary }}>
                  <InputLabel>Modality</InputLabel>
                  <Select
                    value={step.modality || ""}
                    label="Modality"
                    onChange={e => updateStep(idx, "modality", e.target.value)}
                    sx={{ fontFamily: FONT, fontSize: 12.5, borderRadius: 0 }}
                  >
                    {MODALITY_OPTIONS.map(m => (
                      <MenuItem key={m} value={m} sx={{ fontFamily: FONT, fontSize: 12.5 }}>
                        {MODALITY_LABELS[m]}
                      </MenuItem>
                    ))}
                  </Select>
                </FormControl>
                <FormControl sx={{ ...fieldSx, flex: "1 1 160px", background: C.bgPrimary }}>
                  <InputLabel>Status</InputLabel>
                  <Select
                    value={step.status || "pending"}
                    label="Status"
                    onChange={e => updateStep(idx, "status", e.target.value)}
                    sx={{ fontFamily: FONT, fontSize: 12.5, borderRadius: 0 }}
                  >
                    {STEP_STATUS_OPTIONS.map(s => (
                      <MenuItem key={s} value={s} sx={{ fontFamily: FONT, fontSize: 12.5 }}>
                        {STATUS_STYLES[s].label}
                      </MenuItem>
                    ))}
                  </Select>
                </FormControl>
              </Box>

              <TextField
                fullWidth multiline rows={2}
                label="Detailed Plan" value={step.detailed_plan || ""}
                onChange={e => updateStep(idx, "detailed_plan", e.target.value)}
                sx={{ ...fieldSx, mb: 1.5, background: C.bgPrimary }}
              />

              <Box sx={{ display: "flex", gap: 1.5, flexWrap: "wrap", mb: 1.5 }}>
                <TextField
                  label="Sequence / Timing" value={step.sequence_timing || ""}
                  onChange={e => updateStep(idx, "sequence_timing", e.target.value)}
                  sx={{ ...fieldSx, flex: "1 1 180px", background: C.bgPrimary }}
                />
                <TextField
                  label="Estimated Duration" value={step.estimated_duration || ""}
                  onChange={e => updateStep(idx, "estimated_duration", e.target.value)}
                  sx={{ ...fieldSx, flex: "1 1 180px", background: C.bgPrimary }}
                />
                <TextField
                  label="Responsible Specialty" value={step.responsible_specialty || ""}
                  onChange={e => updateStep(idx, "responsible_specialty", e.target.value)}
                  sx={{ ...fieldSx, flex: "1 1 180px", background: C.bgPrimary }}
                />
              </Box>

              <TextField
                fullWidth multiline rows={2}
                label="Rationale" value={step.rationale || ""}
                onChange={e => updateStep(idx, "rationale", e.target.value)}
                sx={{ ...fieldSx, mb: 1.5, background: C.bgPrimary }}
              />

              <TextField
                fullWidth
                label="Guideline Support" value={step.guideline_support || ""}
                onChange={e => updateStep(idx, "guideline_support", e.target.value)}
                sx={{ ...fieldSx, mb: 1.5, background: C.bgPrimary }}
              />

              <TextField
                fullWidth
                label="Monitoring Before Starting (comma separated)"
                value={(step.monitoring_before_starting || []).join(", ")}
                onChange={e => updateStepList(idx, "monitoring_before_starting", e.target.value)}
                sx={{ ...fieldSx, mb: 1.5, background: C.bgPrimary }}
              />

              <TextField
                fullWidth
                label="Contributing Specialties (comma separated)"
                value={(step.contributing_doctors || []).join(", ")}
                onChange={e => updateStepList(idx, "contributing_doctors", e.target.value)}
                sx={{ ...fieldSx, mb: 1, background: C.bgPrimary }}
              />

              <FormControlLabel
                control={
                  <Checkbox
                    checked={!!step.is_urgent}
                    onChange={e => updateStep(idx, "is_urgent", e.target.checked)}
                    sx={{ color: C.textMuted, "&.Mui-checked": { color: "#a12525" } }}
                  />
                }
                label={
                  <Typography sx={{ fontSize: 12, fontFamily: FONT, color: C.textSecond }}>
                    Mark as urgent
                  </Typography>
                }
              />
            </Box>
          ))}
        </Box>
      </DialogContent>

      <DialogActions sx={{ p: 2.5, pt: 2, gap: 1, borderTop: `1px solid ${C.border}`, background: C.bgSecondary }}>
        <Button onClick={onClose} sx={{
          textTransform: "none", fontFamily: FONT, fontWeight: FW_LIGHT,
          color: C.textSecond, borderRadius: 0, fontSize: 13,
          "&:hover": { background: C.bgTertiary },
        }}>
          Cancel
        </Button>
        <Button onClick={handleSave} variant="contained" sx={{
          background: C.black, textTransform: "none", fontFamily: FONT,
          fontWeight: FW_NORMAL, fontSize: 13, borderRadius: 0,
          border: `1px solid ${C.black}`,
          "&:hover": { background: C.white, color: C.black },
        }}>
          <CheckCircleRounded sx={{ mr: 0.5, fontSize: 16 }} />
          Save Changes
        </Button>
      </DialogActions>
    </Dialog>
  );
};

// ─── APPROVE CONFIRMATION DIALOG (final warning before locking the plan) ────
const ApprovePathwayConfirmDialog = ({ open, onClose, onConfirm, saving }) => (
  <Dialog open={open} onClose={saving ? undefined : onClose} maxWidth="xs" fullWidth
    PaperProps={{ sx: { borderRadius: 0, background: C.bgPrimary, border: `1px solid ${C.borderStrong}`, boxShadow: "4px 4px 0px #000" } }}
  >
    <DialogTitle sx={{
      pb: 1.5, pt: 2, px: 2.5, borderBottom: `1px solid ${C.border}`,
      display: "flex", alignItems: "center", gap: 1.5, background: C.bgSecondary,
    }}>
      <Box sx={{ width: 32, height: 32, background: "#a12525", display: "flex", alignItems: "center", justifyContent: "center" }}>
        <WarningAmberRounded sx={{ fontSize: 18, color: C.white }} />
      </Box>
      <Box>
        <Typography sx={{ ...labelStyle, mb: 0.25 }}>Confirm</Typography>
        <Typography sx={{ fontSize: 16, fontWeight: FW_NORMAL, fontFamily: FONT, color: C.textPrimary, letterSpacing: "-0.01em" }}>
          Approve Care Pathway Plan
        </Typography>
      </Box>
    </DialogTitle>

    <DialogContent sx={{ pt: 3, px: 2.5, pb: 1 }}>
      <Alert severity="warning" icon={<WarningAmberRounded sx={{ fontSize: 18 }} />} sx={{ borderRadius: 0, fontFamily: FONT, fontSize: 13, mb: 1 }}>
        Once approved, this plan will be locked. No further edits will be possible.
      </Alert>
      <Typography sx={{ fontSize: 12.5, color: C.textSecond, fontFamily: FONT, fontWeight: FW_LIGHT, lineHeight: 1.7 }}>
        Are you sure you want to approve this care pathway plan? This action cannot be undone.
      </Typography>
    </DialogContent>

    <DialogActions sx={{ p: 2.5, pt: 2, gap: 1, borderTop: `1px solid ${C.border}`, background: C.bgSecondary }}>
      <Button onClick={onClose} disabled={saving} sx={{
        textTransform: "none", fontFamily: FONT, fontWeight: FW_LIGHT,
        color: C.textSecond, borderRadius: 0, fontSize: 13,
        "&:hover": { background: C.bgTertiary },
      }}>
        Cancel
      </Button>
      <Button onClick={onConfirm} disabled={saving} variant="contained" sx={{
        background: "#a12525", textTransform: "none", fontFamily: FONT,
        fontWeight: FW_NORMAL, fontSize: 13, borderRadius: 0,
        border: `1px solid #a12525`,
        "&:hover": { background: C.white, color: "#a12525" },
        "&.Mui-disabled": { background: C.bgTertiary, color: C.textMuted },
      }}>
        {saving ? <CircularProgress size={16} sx={{ mr: 1, color: "inherit" }} /> : <LockRounded sx={{ mr: 0.5, fontSize: 16 }} />}
        {saving ? "Approving..." : "Yes, Approve & Lock"}
      </Button>
    </DialogActions>
  </Dialog>
);

// ─── CARE PATHWAY PLAN CARD (draft or approved, shown under recommendations) ─
const CarePathwayPlanCard = ({ plan, status, onStepClick, onEdit, onApprove }) => {
  const planStatus = getPlanStatusStyle(status);
  const isDraft = status === "draft";

  return (
    <Card sx={{
      mb: 2.5, background: C.bgPrimary, borderRadius: 0, boxShadow: "none",
      border: `1px solid ${C.border}`, transition: "border-color 0.15s",
      "&:hover": { borderColor: C.borderStrong },
    }}>
      <CardContent sx={{ p: 0 }}>
        {/* Header */}
        <Box sx={{ p: 2, borderBottom: `1px solid ${C.border}`, background: C.bgSecondary }}>
          <Box sx={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: 1.5 }}>
            <Box sx={{ display: "flex", alignItems: "center", gap: 1.5 }}>
              <Box sx={{ width: 36, height: 36, background: C.black, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                <AccountTreeRounded sx={{ fontSize: 18, color: C.white }} />
              </Box>
              <Box>
                <Typography sx={{ fontSize: 13.5, fontWeight: FW_NORMAL, fontFamily: FONT, color: C.textPrimary }}>
                  {plan.primary_diagnosis}
                </Typography>
                <Typography sx={{ fontSize: 11, color: C.textMuted, fontFamily: FONT, mt: 0.2 }}>
                  Stage {plan.cancer_stage} · {plan.overall_treatment_intent} intent · {plan.total_steps ?? plan.steps?.length} steps
                </Typography>
              </Box>
            </Box>

            <Box sx={{ display: "flex", alignItems: "center", gap: 1, flexWrap: "wrap" }}>
              {/* Status badge */}
              <Box sx={{
                px: 1, py: 0.4, background: planStatus.bg, color: planStatus.color, border: `1px solid ${planStatus.border}`,
                fontSize: 10, fontFamily: FONT, fontWeight: FW_NORMAL, textTransform: "uppercase", letterSpacing: "0.06em",
                display: "flex", alignItems: "center", gap: 0.4, whiteSpace: "nowrap",
              }}>
                {isDraft ? <WarningAmberRounded sx={{ fontSize: 12 }} /> : <LockRounded sx={{ fontSize: 12 }} />}
                {planStatus.label}
              </Box>

              {/* Edit + Approve — only while draft */}
              {isDraft && (
                <>
                  <Button
                    onClick={onEdit}
                    size="small"
                    variant="outlined"
                    sx={{
                      borderRadius: 0, textTransform: "none", fontFamily: FONT, fontWeight: FW_NORMAL,
                      fontSize: 11.5, px: 1.25, py: 0.4, borderColor: C.black, color: C.black,
                      "&:hover": { background: C.black, color: C.white },
                    }}
                  >
                    <EditRounded sx={{ mr: 0.5, fontSize: 14 }} />
                    Edit
                  </Button>
                  <Button
                    onClick={onApprove}
                    size="small"
                    variant="contained"
                    sx={{
                      borderRadius: 0, textTransform: "none", fontFamily: FONT, fontWeight: FW_NORMAL,
                      fontSize: 11.5, px: 1.25, py: 0.4, background: C.black, color: C.white,
                      border: `1px solid ${C.black}`,
                      "&:hover": { background: C.white, color: C.black },
                    }}
                  >
                    <CheckCircleRounded sx={{ mr: 0.5, fontSize: 14 }} />
                    Approve
                  </Button>
                </>
              )}
            </Box>
          </Box>
        </Box>

        {/* Steps as rows */}
        <Box sx={{ p: 2 }}>
          {plan.steps.map((step, idx) => (
            <CarePathwayStepRow key={step.step_number ?? idx} step={step} onClick={onStepClick} isLast={idx === plan.steps.length - 1} />
          ))}
        </Box>
      </CardContent>
    </Card>
  );
};

// ─── REGENERATE PLAN WARNING (shown when an approved plan already exists) ───
const RegeneratePlanWarningDialog = ({ open, onClose, onConfirm }) => (
  <Dialog open={open} onClose={onClose} maxWidth="xs" fullWidth
    PaperProps={{ sx: { borderRadius: 0, background: C.bgPrimary, border: `1px solid ${C.borderStrong}`, boxShadow: "4px 4px 0px #000" } }}
  >
    <DialogTitle sx={{
      pb: 1.5, pt: 2, px: 2.5, borderBottom: `1px solid ${C.border}`,
      display: "flex", alignItems: "center", gap: 1.5, background: C.bgSecondary,
    }}>
      <Box sx={{ width: 32, height: 32, background: "#9a6300", display: "flex", alignItems: "center", justifyContent: "center" }}>
        <WarningAmberRounded sx={{ fontSize: 18, color: C.white }} />
      </Box>
      <Box>
        <Typography sx={{ ...labelStyle, mb: 0.25 }}>Warning</Typography>
        <Typography sx={{ fontSize: 16, fontWeight: FW_NORMAL, fontFamily: FONT, color: C.textPrimary, letterSpacing: "-0.01em" }}>
          Generate a New Care Pathway Plan?
        </Typography>
      </Box>
    </DialogTitle>

    <DialogContent sx={{ pt: 3, px: 2.5, pb: 1 }}>
      <Alert severity="warning" icon={<WarningAmberRounded sx={{ fontSize: 18 }} />} sx={{ borderRadius: 0, fontFamily: FONT, fontSize: 13, mb: 1 }}>
        An approved care pathway plan already exists for this patient.
      </Alert>
      <Typography sx={{ fontSize: 12.5, color: C.textSecond, fontFamily: FONT, fontWeight: FW_LIGHT, lineHeight: 1.7 }}>
        Generating a new plan will require approval from all doctors again before it replaces the current approved plan. The existing plan will remain active and locked until the new one is fully approved. Do you want to continue?
      </Typography>
    </DialogContent>

    <DialogActions sx={{ p: 2.5, pt: 2, gap: 1, borderTop: `1px solid ${C.border}`, background: C.bgSecondary }}>
      <Button onClick={onClose} sx={{
        textTransform: "none", fontFamily: FONT, fontWeight: FW_LIGHT,
        color: C.textSecond, borderRadius: 0, fontSize: 13,
        "&:hover": { background: C.bgTertiary },
      }}>
        Cancel
      </Button>
      <Button onClick={onConfirm} variant="contained" sx={{
        background: C.black, textTransform: "none", fontFamily: FONT,
        fontWeight: FW_NORMAL, fontSize: 13, borderRadius: 0,
        border: `1px solid ${C.black}`,
        "&:hover": { background: C.white, color: C.black },
      }}>
        <ChevronRightRounded sx={{ mr: 0.5, fontSize: 16 }} />
        OK, Continue
      </Button>
    </DialogActions>
  </Dialog>
);

// ─── APPROVED TUMOR BOARD PLAN (fetched from backend, shows approval progress) ─
const ApprovedTumorBoardPlanCard = ({ data, doctorNames, onStepClick, currentDoctorId, onEdit, onApprove }) => {
  const plan = data.care_pathway_plan;
  const approvals = data.doctor_approvals || [];
  const approvedCount = approvals.filter(a => a.status === "approved").length;
  const pendingApprovals = approvals.filter(a => a.status !== "approved");
  const totalCount = approvals.length;
  const ownApproval = approvals.find(a => a.doctor_id === currentDoctorId);
  const isPendingForCurrentDoctor = ownApproval && ownApproval.status !== "approved";

  return (
    <Card sx={{
      mb: 2.5, background: C.bgPrimary, borderRadius: 0, boxShadow: "none",
      border: `1px solid ${C.border}`,
    }}>
      <CardContent sx={{ p: 0 }}>
        {/* Header */}
        <Box sx={{ p: 2, borderBottom: `1px solid ${C.border}`, background: C.bgSecondary }}>
          <Box sx={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: 1.5 }}>
            <Box sx={{ display: "flex", alignItems: "center", gap: 1.5 }}>
              <Box sx={{ width: 36, height: 36, background: C.black, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                <AccountTreeRounded sx={{ fontSize: 18, color: C.white }} />
              </Box>
              <Box>
                <Typography sx={{ fontSize: 13.5, fontWeight: FW_NORMAL, fontFamily: FONT, color: C.textPrimary }}>
                  {plan.primary_diagnosis}
                </Typography>
                <Typography sx={{ fontSize: 11, color: C.textMuted, fontFamily: FONT, mt: 0.2 }}>
                  Stage {plan.cancer_stage} · {plan.overall_treatment_intent} intent · {plan.total_steps ?? plan.steps?.length} steps
                </Typography>
              </Box>
            </Box>

            <Box sx={{ display: "flex", alignItems: "center", gap: 1, flexWrap: "wrap" }}>
              {isPendingForCurrentDoctor ? (
                <>
                  <Box sx={{
                    px: 1, py: 0.4, background: "#fff6e5", color: "#9a6300", border: "1px solid #f0dca8",
                    fontSize: 10, fontFamily: FONT, fontWeight: FW_NORMAL, textTransform: "uppercase", letterSpacing: "0.06em",
                    display: "flex", alignItems: "center", gap: 0.4, whiteSpace: "nowrap",
                  }}>
                    <WarningAmberRounded sx={{ fontSize: 12 }} />
                    Your Approval Pending
                  </Box>
                  <Button
                    onClick={onEdit}
                    size="small"
                    variant="outlined"
                    sx={{
                      borderRadius: 0, textTransform: "none", fontFamily: FONT, fontWeight: FW_NORMAL,
                      fontSize: 11.5, px: 1.25, py: 0.4, borderColor: C.black, color: C.black,
                      "&:hover": { background: C.black, color: C.white },
                    }}
                  >
                    <EditRounded sx={{ mr: 0.5, fontSize: 14 }} />
                    Edit
                  </Button>
                  <Button
                    onClick={onApprove}
                    size="small"
                    variant="contained"
                    sx={{
                      borderRadius: 0, textTransform: "none", fontFamily: FONT, fontWeight: FW_NORMAL,
                      fontSize: 11.5, px: 1.25, py: 0.4, background: C.black, color: C.white,
                      border: `1px solid ${C.black}`,
                      "&:hover": { background: C.white, color: C.black },
                    }}
                  >
                    <CheckCircleRounded sx={{ mr: 0.5, fontSize: 14 }} />
                    Approve
                  </Button>
                </>
              ) : (
                <Box sx={{
                  px: 1, py: 0.4, background: "#e9f9f0", color: "#0a7a45", border: "1px solid #a9e6c4",
                  fontSize: 10, fontFamily: FONT, fontWeight: FW_NORMAL, textTransform: "uppercase", letterSpacing: "0.06em",
                  display: "flex", alignItems: "center", gap: 0.4, whiteSpace: "nowrap",
                }}>
                  <LockRounded sx={{ fontSize: 12 }} />
                  You Approved
                </Box>
              )}
            </Box>
          </Box>
        </Box>

        {/* Approval progress */}
        <Box sx={{ p: 2, borderBottom: `1px solid ${C.border}` }}>
          <Box sx={{ display: "flex", alignItems: "center", justifyContent: "space-between", mb: 1.5, flexWrap: "wrap", gap: 1 }}>
            <Typography sx={{ ...labelStyle }}>Approval Status</Typography>
            <Typography sx={{ fontSize: 11.5, fontFamily: FONT, fontWeight: FW_NORMAL, color: pendingApprovals.length > 0 ? "#9a6300" : "#0a7a45" }}>
              {approvedCount} of {totalCount} doctors approved
              {pendingApprovals.length > 0 ? ` — ${pendingApprovals.length} pending` : " — all approved"}
            </Typography>
          </Box>

          <Box sx={{ display: "flex", flexDirection: "column", gap: 0.75 }}>
            {approvals.map((a, idx) => {
              const isApproved = a.status === "approved";
              const name = doctorNames[a.doctor_id] || a.doctor_name;
              return (
                <Box key={a.doctor_id || idx} sx={{
                  display: "flex", alignItems: "center", justifyContent: "space-between",
                  px: 1.25, py: 0.75, border: `1px solid ${C.border}`, background: C.bgSecondary,
                }}>
                  <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
                    <Avatar sx={{ width: 24, height: 24, borderRadius: 0, background: C.black, fontSize: 10, fontFamily: FONT }}>
                      {(name || "D")[0].toUpperCase()}
                    </Avatar>
                    <Box>
                      <Typography sx={{ fontSize: 12, fontFamily: FONT, fontWeight: FW_NORMAL, color: C.textPrimary }}>
                        {name ? `Dr. ${name}` : "Loading..."}
                      </Typography>
                      <Typography sx={{ fontSize: 10, fontFamily: FONT, color: C.textMuted }}>
                        {a.speciality}
                      </Typography>
                    </Box>
                  </Box>
                  <Box sx={{
                    px: 0.9, py: 0.3,
                    background: isApproved ? "#e9f9f0" : "#fff6e5",
                    color: isApproved ? "#0a7a45" : "#9a6300",
                    border: `1px solid ${isApproved ? "#a9e6c4" : "#f0dca8"}`,
                    fontSize: 9.5, fontFamily: FONT, fontWeight: FW_NORMAL,
                    textTransform: "uppercase", letterSpacing: "0.06em",
                  }}>
                    {isApproved ? "Approved" : "Pending"}
                  </Box>
                </Box>
              );
            })}
          </Box>
        </Box>

        {/* Steps as rows */}
        <Box sx={{ p: 2 }}>
          {plan.steps.map((step, idx) => (
            <CarePathwayStepRow key={step.step_number ?? idx} step={step} onClick={onStepClick} isLast={idx === plan.steps.length - 1} />
          ))}
        </Box>
      </CardContent>
    </Card>
  );
};

// ─── MAIN TUMORBOARD ─────────────────────────────────────────────────────────
const TumorBoard = ({ doctorId, patientId, doctorSpeciality, doctorName, patientName }) => {
  const [allRecommendations, setAllRecommendations] = useState([]);
  const [loading, setLoading]     = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [snackbar, setSnackbar]   = useState({ open: false, message: "", severity: "success" });
  const [hospitalId, setHospitalId] = useState("");
  const [referPopupOpen, setReferPopupOpen] = useState(false);
  const [aiGeneratedText, setAiGeneratedText] = useState(null);
  const [generatingAI, setGeneratingAI] = useState(false);
  const [fetchedSpeciality, setFetchedSpeciality] = useState("");

  // ── Top-level page tab: Tumor Board vs Imaging Studies ──
  const [mainTumorTab, setMainTumorTab] = useState(0); // 0 = Tumor Board, 1 = Imaging Studies

  // ── Care pathway state ──
  const [carePathwayPopupOpen, setCarePathwayPopupOpen]   = useState(false);
  const [carePathwayLoading, setCarePathwayLoading]       = useState(false);
  const [carePathwayData, setCarePathwayData]             = useState(null);
  const [carePathwayError, setCarePathwayError]           = useState("");
  // pathwayPlans: [{ id, status: 'draft' | 'approved', plan: {...} }]
  const [pathwayPlans, setPathwayPlans]                   = useState([]);
  const [viewingStep, setViewingStep]                     = useState(null);
  const [editingPathwayId, setEditingPathwayId]           = useState(null);
  const [editDialogOpen, setEditDialogOpen]               = useState(false);
  const [approveConfirmId, setApproveConfirmId]           = useState(null);
  const [approvingPlan, setApprovingPlan]                 = useState(false);
  const [approvedTumorBoardPlan, setApprovedTumorBoardPlan] = useState(null);
  const [approvedPlanLoading, setApprovedPlanLoading]     = useState(false);
  const [doctorNames, setDoctorNames]                     = useState({}); // doctor_id -> name
  const [editApprovedPlanOpen, setEditApprovedPlanOpen]   = useState(false);
  const [approveOwnConfirmOpen, setApproveOwnConfirmOpen] = useState(false);
  const [approvingOwnPlan, setApprovingOwnPlan]           = useState(false);
  const [regenerateWarningOpen, setRegenerateWarningOpen] = useState(false);
  // ── Care pathway dictation state (new) ──
  // Controlled text for the dictation box, now rendered inside the
  // VoiceTranscription "Your Input" section, directly under its button row.
  // If this is empty when Generate is clicked, we call generate-care-pathway
  // as before. If it has content, we call process-tumor-board instead.
  const [dictationText, setDictationText]                 = useState("");

  // ── Case Brief & Salient Points state ──
  const [caseBriefLoading, setCaseBriefLoading]           = useState(false);
  const [caseBriefText, setCaseBriefText]                 = useState("");
  const [caseBriefMeta, setCaseBriefMeta]                 = useState(null);
  const [caseBriefError, setCaseBriefError]               = useState("");
  const [caseBriefHistory, setCaseBriefHistory]           = useState([]);
  const [caseBriefHistoryOpen, setCaseBriefHistoryOpen]   = useState(false);
  const [caseBriefHistoryLoading, setCaseBriefHistoryLoading] = useState(false);

  // ── Ask About Patient (RAG Q&A) state ──
  const [patientQuestion, setPatientQuestion]             = useState("");
  const [patientAnswer, setPatientAnswer]                 = useState("");
  const [patientAnswerLoading, setPatientAnswerLoading]   = useState(false);
  const [patientAnswerError, setPatientAnswerError]       = useState("");
  const [patientQaAskedAt, setPatientQaAskedAt]           = useState(null);

   const effectiveSpeciality = doctorSpeciality || fetchedSpeciality;

  const isOncology = oncologySpecialties.some(
    spec => effectiveSpeciality?.toLowerCase().includes(spec.toLowerCase())
  );
 console.log("🔍 [TumorBoard] effectiveSpeciality:", effectiveSpeciality, "| isOncology:", isOncology);

  useEffect(() => {
    const fetchHospitalInfo = async () => {
      if (!doctorId) return;
      try {
        const res  = await fetch(`${API_BASE_URL}hms/users/data/get-doctor-info/${doctorId}`);
        const data = await res.json();
        if (data?.hospital_id) setHospitalId(data.hospital_id);
      } catch (err) { console.error("Failed to fetch hospital info:", err); }
    };
    fetchHospitalInfo();
  }, [doctorId]);

useEffect(() => {
  const fetchDoctorSpeciality = async () => {
    if (!doctorId || doctorSpeciality) return;

    try {
      const url = `${API_BASE_URL}hms/users/doctors/get_doctor/${doctorId}`;
      console.log("🔍 [TumorBoard] fetching:", url);

      const res = await fetch(url);
      const data = await res.json();

      console.log("🔍 [TumorBoard] get_doctor raw response:", data);

      if (data?.status === "success" && data?.doctor?.specialization) {
        setFetchedSpeciality(data.doctor.specialization);
      } else {
        console.log(
          "🔍 [TumorBoard] no specialization in response — isOncology will be false"
        );
      }
    } catch (err) {
      console.error("Failed to fetch doctor speciality:", err);
    }
  };

  fetchDoctorSpeciality();
}, [doctorId, doctorSpeciality]);

  useEffect(() => {
    if (isOncology && hospitalId && patientId) fetchRecommendations();
  }, [doctorId, patientId, isOncology, hospitalId]);

  useEffect(() => {
    if (isOncology && patientId && doctorId) fetchApprovedTumorBoardPlan();
  }, [doctorId, patientId, isOncology]);

  useEffect(() => {
    if (isOncology && patientId) fetchCaseBriefHistory();
  }, [patientId, isOncology]);

  // Resolve names for every doctor_id we currently know about (recommendations + approvals)
  useEffect(() => {
    const ids = new Set();
    allRecommendations.forEach(r => { if (r.doctor_id) ids.add(r.doctor_id); });
    (approvedTumorBoardPlan?.doctor_approvals || []).forEach(a => { if (a.doctor_id) ids.add(a.doctor_id); });

    const missing = Array.from(ids).filter(id => !doctorNames[id]);
    if (missing.length === 0) return;

    let cancelled = false;
    (async () => {
      const entries = await Promise.all(missing.map(async id => [id, await fetchDoctorName(id)]));
      if (cancelled) return;
      setDoctorNames(prev => {
        const next = { ...prev };
        entries.forEach(([id, name]) => { if (name) next[id] = name; });
        return next;
      });
    })();

    return () => { cancelled = true; };
  }, [allRecommendations, approvedTumorBoardPlan]);

  const fetchRecommendations = async () => {
    setLoading(true);
    try {
      const res  = await fetch(`${API_BASE_URL}hms/users/data/latest_doctor_recommendations/${hospitalId}/${patientId}`);
      const data = await res.json();
      const sorted = (data?.data || []).sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
      setAllRecommendations(sorted);
    } catch (err) {
      console.error("Failed to fetch recommendations:", err);
      setSnackbar({ open: true, message: "Failed to load recommendations", severity: "error" });
    } finally { setLoading(false); }
  };

  // Resolve a doctor's display name from their id
  const fetchDoctorName = async id => {
    if (!id) return "";
    try {
      const res  = await fetch(`${API_BASE_URL}hms/users/speciality/users/patient/get_doctor_details`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ doctor_id: id }),
      });
      const data = await res.json();
      console.log("🔍 [TumorBoard] get_doctor_details raw response for", id, ":", data);
      const name =
        data?.doctor?.name ||
        data?.doctor?.doctor_name ||
        data?.doctor?.full_name ||
        data?.data?.name ||
        data?.data?.doctor_name ||
        data?.data?.full_name ||
        data?.name ||
        data?.doctor_name ||
        data?.full_name ||
        "";
      if (!name) console.warn("🔍 [TumorBoard] could not resolve a name field for", id, "— check the logged shape above");
      return name;
    } catch (err) {
      console.error("Failed to fetch doctor name for", id, err);
      return "";
    }
  };

  // Fetch the current doctor's view of the tumor board plan + approval progress
  const fetchApprovedTumorBoardPlan = async () => {
    if (!patientId || !doctorId) return;
    setApprovedPlanLoading(true);
    try {
      const res  = await fetch(`${API_BASE_URL}hms/users/data/context/get-tumor-board-plan-by-doctor/${patientId}/${doctorId}`);
      const data = await res.json();
      if (res.ok && data?.data) setApprovedTumorBoardPlan(data.data);
    } catch (err) {
      console.error("Failed to fetch tumor board plan:", err);
    } finally {
      setApprovedPlanLoading(false);
    }
  };

  // ── Case Brief & Salient Points handlers ──

  // GET /tumor-board-presentation/{patient_id} — same prefix as the POST workflow below
  const fetchCaseBriefHistory = async () => {
    if (!patientId) return;
    setCaseBriefHistoryLoading(true);
    try {
      const res  = await fetch(`${API_BASE_URL}hms/users/orchestration/tumor-board-presentation/${patientId}`);
      const data = await res.json();
      if (res.ok && data?.status === "success") {
        const list = Array.isArray(data.presentations)
          ? data.presentations
          : (data.presentations ? [data.presentations] : []);
        setCaseBriefHistory(list);

        // If nothing is currently displayed, show the most recent stored brief
        if (list.length > 0) {
          setCaseBriefText(prev => prev || list[0].presentation || "");
          setCaseBriefMeta(prev => prev || {
            doctor_id: list[0].doctor_id,
            patient_id: list[0].patient_id,
            summary_id: list[0].summary_id,
            clinical_summary_truncated: list[0].clinical_summary_truncated,
            timeline_truncated: list[0].timeline_truncated,
            generated_at: list[0].generated_at,
          });
        }
      }
      // 404 (no presentations yet) is expected for a patient with none — stay silent
    } catch (err) {
      console.error("Failed to fetch case brief history:", err);
    } finally {
      setCaseBriefHistoryLoading(false);
    }
  };

  // POST /tumor-board-presentation-workflow — generates + persists a new case brief
  const handleGenerateCaseBrief = async () => {
    if (!doctorId || !patientId) {
      setSnackbar({ open: true, message: "Missing doctor or patient information", severity: "warning" });
      return;
    }
    setCaseBriefLoading(true);
    setCaseBriefError("");
    try {
      const res  = await fetch(`${API_BASE_URL}hms/users/orchestration/tumor-board-presentation-workflow`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ doctor_id: doctorId, patient_id: patientId }),
      });
      const data = await res.json();

      if (res.ok && data?.status === "success" && data?.presentation) {
        setCaseBriefText(data.presentation);
        setCaseBriefMeta({
          ...(data.metadata || {}),
          generated_at: data.metadata?.generated_at || new Date().toISOString(),
        });
        setSnackbar({ open: true, message: "Case brief generated successfully", severity: "success" });
        // Pull the freshly persisted record back from the backend
        await fetchCaseBriefHistory();
      } else {
        const msg = data?.detail || data?.message || "Failed to generate case brief.";
        setCaseBriefError(msg);
        setSnackbar({ open: true, message: msg, severity: "error" });
      }
    } catch (err) {
      console.error("Failed to generate case brief:", err);
      setCaseBriefError("Network error. Failed to generate case brief.");
      setSnackbar({ open: true, message: "Network error. Failed to generate case brief.", severity: "error" });
    } finally {
      setCaseBriefLoading(false);
    }
  };

  // POST /patient-rag/search — backend auto-builds the RAG index on first
  // call for this patient (see search_patient_rag), so there's no separate
  // "build" step needed here; the doctor just asks and gets an answer.
  const handleAskPatientQuestion = async () => {
    if (!doctorId || !patientId) {
      setSnackbar({ open: true, message: "Missing doctor or patient information", severity: "warning" });
      return;
    }
    if (!patientQuestion.trim()) {
      setSnackbar({ open: true, message: "Please enter a question", severity: "warning" });
      return;
    }
    setPatientAnswerLoading(true);
    setPatientAnswerError("");
    try {
      const res  = await fetch(`${API_BASE_URL}hms/users/speciality/patient-rag/search`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          doctor_id: doctorId,
          patient_id: patientId,
          question: patientQuestion.trim(),
          top_k: 5,
        }),
      });
      const data = await res.json();
      if (res.ok && data?.answer) {
        setPatientAnswer(data.answer);
        setPatientQaAskedAt(new Date().toISOString());
      } else {
        const msg = data?.message || data?.detail || "Could not find an answer for that question.";
        setPatientAnswerError(msg);
      }
    } catch (err) {
      console.error("Failed to search patient RAG:", err);
      setPatientAnswerError("Network error. Failed to get an answer.");
    } finally {
      setPatientAnswerLoading(false);
    }
  };

  // Open/close the edit dialog for the fetched (backend) plan — current doctor's own copy
  const handleEditApprovedPlan = () => setEditApprovedPlanOpen(true);
  const handleCloseEditApprovedPlan = () => setEditApprovedPlanOpen(false);

  const handleSaveEditedApprovedPlan = updatedPlan => {
    setApprovedTumorBoardPlan(prev => (prev ? { ...prev, care_pathway_plan: updatedPlan } : prev));
    setSnackbar({ open: true, message: "Changes saved locally. Approve to confirm this version.", severity: "success" });
    setEditApprovedPlanOpen(false);
  };

  // Approve the plan as the current doctor
  const handleRequestApproveOwnPlan = () => setApproveOwnConfirmOpen(true);
  const handleCloseApproveOwnConfirm = () => {
    if (approvingOwnPlan) return;
    setApproveOwnConfirmOpen(false);
  };

  const handleConfirmApproveOwnPlan = async () => {
    if (!patientId || !doctorId) return;
    setApprovingOwnPlan(true);
    try {
      const res  = await fetch(`${API_BASE_URL}hms/users/data/context/approve-tumor-board-plan/${patientId}/${doctorId}`, {
        method: "PUT",
      });
      const data = await res.json();
      if (res.ok) {
        setSnackbar({ open: true, message: "Plan approved successfully", severity: "success" });
        setApproveOwnConfirmOpen(false);
        fetchApprovedTumorBoardPlan();
      } else {
        setSnackbar({ open: true, message: data.message || "Failed to approve plan", severity: "error" });
      }
    } catch (err) {
      console.error("Failed to approve tumor board plan:", err);
      setSnackbar({ open: true, message: "Network error. Failed to approve plan.", severity: "error" });
    } finally {
      setApprovingOwnPlan(false);
    }
  };

  const handleSaveRecommendation = async text => {
    if (!text.trim()) { setSnackbar({ open: true, message: "Please enter a recommendation", severity: "warning" }); return; }
    setSubmitting(true);
    try {
      const res = await fetch(`${API_BASE_URL}hms/users/data/save-doctors-recommendation`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ doctor_id: doctorId, patient_id: patientId, hospital_id: hospitalId, speciality: doctorSpeciality, doctor_recommendation: text.trim() }),
      });
      const data = await res.json();
      if (res.ok && data.message === "Doctor's recommendation saved successfully.") {
        setSnackbar({ open: true, message: "Recommendation posted successfully", severity: "success" });
        await fetchRecommendations();
      } else {
        setSnackbar({ open: true, message: data.message || "Failed to post recommendation", severity: "error" });
      }
    } catch { setSnackbar({ open: true, message: "Network error. Please try again.", severity: "error" }); }
    finally { setSubmitting(false); }
  };

  const handleReferPatient = async referralData => {
    try {
      const res = await fetch(`${API_BASE_URL}hms/users/data/refer-patient`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ from_doctor_id: referralData.from_doctor_id, to_doctor_id: referralData.to_doctor_id, patient_id: referralData.patient_id, reason: referralData.reason }),
      });
      const data = await res.json();
      if (res.ok) {
        setSnackbar({ open: true, message: `Patient referred to Dr. ${referralData.to_doctor_name}`, severity: "success" });
        setReferPopupOpen(false);
      } else {
        setSnackbar({ open: true, message: data.message || "Failed to refer patient", severity: "error" });
      }
    } catch { setSnackbar({ open: true, message: "Network error. Failed to refer patient", severity: "error" }); }
  };

  const generateAIRecommendation = async () => {
    if (!doctorId || !patientId || !hospitalId) {
      setSnackbar({ open: true, message: "Missing required information to generate recommendation", severity: "warning" });
      throw new Error("Missing required information");
    }
    try {
      const res  = await fetch(`${API_BASE_URL}hms/users/ai-legacy/generate-tumor-board-recommendation`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ patient_id: patientId, doctor_id: doctorId, hospital_id: hospitalId }),
      });
      const data = await res.json();
      if (data.success) return data;
      setSnackbar({ open: true, message: data.message || "Failed to generate recommendation", severity: "error" });
      throw new Error(data.message || "Failed to generate recommendation");
    } catch (err) {
      setSnackbar({ open: true, message: "Network error. Failed to generate recommendation", severity: "error" });
      throw err;
    }
  };

  useEffect(() => {
    window.generateAIRecommendation = generateAIRecommendation;
    return () => { delete window.generateAIRecommendation; };
  }, [doctorId, patientId, hospitalId]);

  const handleAiTextClear = () => setAiGeneratedText(null);

  // ── Care pathway handlers ──

  // Single entry point from the "Generate Care Pathway Plan" button.
  // Checks for an existing approved plan first (regenerate warning gate),
  // then branches purely on whether there's dictation text:
  //   - no dictation text -> generate-care-pathway (original behavior)
  //   - dictation text present -> process-tumor-board (dictation flow)
  const handleGenerateButtonClick = () => {
    if (approvedTumorBoardPlan?.care_pathway_plan) {
      setRegenerateWarningOpen(true);
      return;
    }
    runCarePathwayGeneration();
  };

  const handleCloseRegenerateWarning = () => setRegenerateWarningOpen(false);

  const handleConfirmRegeneratePlan = () => {
    setRegenerateWarningOpen(false);
    runCarePathwayGeneration();
  };

  // Central dispatcher: decides which endpoint to call based on dictationText.
  const runCarePathwayGeneration = () => {
    if (dictationText.trim()) {
      handleProcessTumorBoard(dictationText.trim());
    } else {
      handleOpenCarePathway();
    }
  };

  const handleOpenCarePathway = async () => {
    if (!doctorId || !patientId) {
      setSnackbar({ open: true, message: "Missing doctor or patient information", severity: "warning" });
      return;
    }
    setCarePathwayPopupOpen(true);
    setCarePathwayLoading(true);
    setCarePathwayError("");
    setCarePathwayData(null);
    try {
      const res = await fetch(`${API_BASE_URL}hms/users/ai-legacy/generate-care-pathway`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ patient_id: patientId, requested_by_doctor_id: doctorId }),
      });
      const data = await res.json();
      if (res.ok && data.success && data.care_pathway_plan) {
        setCarePathwayData(data);
      } else {
        setCarePathwayError(data.message || "Failed to generate care pathway plan.");
      }
    } catch (err) {
      console.error("Failed to generate care pathway:", err);
      setCarePathwayError("Network error. Failed to generate care pathway plan.");
    } finally {
      setCarePathwayLoading(false);
    }
  };

  // Called instead of handleOpenCarePathway whenever the doctor has dictated
  // or typed notes into the Care Pathway Dictation box. Feeds into the exact
  // same review-popup -> Continue/Decline -> draft flow, just from a
  // different backend endpoint that processes the dictated notes directly
  // into a care pathway plan.
  const handleProcessTumorBoard = async dictatedText => {
    if (!doctorId || !patientId) {
      setSnackbar({ open: true, message: "Missing doctor or patient information", severity: "warning" });
      return;
    }
    setCarePathwayPopupOpen(true);
    setCarePathwayLoading(true);
    setCarePathwayError("");
    setCarePathwayData(null);
    try {
      const res = await fetch(`${API_BASE_URL}hms/users/ai-legacy/generate-care-pathway-from-dictation`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          patient_id: patientId,
          doctor_id: doctorId,
          dictation: dictatedText,
        }),
      });
      const data = await res.json();
      if (res.ok && data.success && data.care_pathway_plan) {
        setCarePathwayData(data);
      } else {
        setCarePathwayError(data.message || "Failed to process dictated notes.");
      }
    } catch (err) {
      console.error("Failed to process dictated notes:", err);
      setCarePathwayError("Network error. Failed to process dictated notes.");
    } finally {
      setCarePathwayLoading(false);
    }
  };

  const handleCloseCarePathway = () => {
    if (carePathwayLoading) return;
    setCarePathwayPopupOpen(false);
    setCarePathwayData(null);
    setCarePathwayError("");
  };

  // "Continue" — moves the generated plan into the section as a DRAFT.
  // No approval has happened yet; the doctor can still edit it.
  const handleContinueCarePathway = () => {
    if (!carePathwayData?.care_pathway_plan) return;
    const newEntry = {
      id: `${patientId}_${Date.now()}`,
      status: "draft",
      plan: carePathwayData.care_pathway_plan,
    };
    setPathwayPlans(prev => [newEntry, ...prev]);
    setSnackbar({ open: true, message: "Care pathway plan added as a draft. Review, edit, then approve.", severity: "info" });
    setCarePathwayPopupOpen(false);
    setCarePathwayData(null);
    setDictationText("");
  };

  const handleDeclineCarePathway = () => {
    setSnackbar({ open: true, message: "Care pathway plan declined", severity: "info" });
    setCarePathwayPopupOpen(false);
    setCarePathwayData(null);
    setCarePathwayError("");
    setDictationText("");
  };

  // Open the edit dialog for a given draft plan
  const handleOpenEditPathway = id => {
    setEditingPathwayId(id);
    setEditDialogOpen(true);
  };

  const handleCloseEditPathway = () => {
    setEditDialogOpen(false);
    setEditingPathwayId(null);
  };

  // Persist edits back into the matching draft entry (only allowed while draft)
  const handleSaveEditedPathway = updatedPlan => {
    setPathwayPlans(prev => prev.map(entry => (
      entry.id === editingPathwayId && entry.status === "draft"
        ? { ...entry, plan: updatedPlan }
        : entry
    )));
    setSnackbar({ open: true, message: "Care pathway plan updated", severity: "success" });
    handleCloseEditPathway();
  };

  // Build the doctor_approvals array: current doctor = approved, every other
  // doctor who posted a recommendation on this case = pending
  const buildDoctorApprovals = () => {
    const map = new Map();

    allRecommendations.forEach(rec => {
      if (rec.doctor_id && rec.doctor_id !== doctorId) {
        map.set(rec.doctor_id, {
          doctor_id: rec.doctor_id,
          doctor_name: rec.doctor_name || "",
          speciality: rec.speciality || "",
          status: "pending",
        });
      }
    });

    map.set(doctorId, {
      doctor_id: doctorId,
      doctor_name: doctorName || "",
      speciality: doctorSpeciality || fetchedSpeciality || "",
      status: "approved",
    });

    return Array.from(map.values());
  };

  // Step 1: user clicks "Approve" on the card -> opens the warning dialog
  const handleRequestApprovePathway = id => setApproveConfirmId(id);

  const handleCloseApproveConfirm = () => {
    if (approvingPlan) return;
    setApproveConfirmId(null);
  };

  // Step 2: user confirms in the dialog -> save to backend, then lock locally
  const handleConfirmApprovePathway = async () => {
    const entry = pathwayPlans.find(p => p.id === approveConfirmId);
    if (!entry) { setApproveConfirmId(null); return; }

    setApprovingPlan(true);
    try {
      const payload = {
        patient_id: patientId,
        hospital_id: hospitalId,
        approved_by_doctor_id: doctorId,
        care_pathway_plan: entry.plan,
        doctor_approvals: buildDoctorApprovals(),
      };

      const res  = await fetch(`${API_BASE_URL}hms/users/data/context/save-tumor-board-plan`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json();

      if (res.ok && (data.success || data.status === "success")) {
        // Remove the local draft — the approved plan now lives on the backend
        setPathwayPlans(prev => prev.filter(p => p.id !== entry.id));
        setSnackbar({ open: true, message: "Care pathway plan approved and saved.", severity: "success" });
        setApproveConfirmId(null);
        fetchApprovedTumorBoardPlan();
      } else {
        setSnackbar({ open: true, message: data.message || "Failed to save approved plan", severity: "error" });
      }
    } catch (err) {
      console.error("Failed to save approved care pathway plan:", err);
      setSnackbar({ open: true, message: "Network error. Failed to save approved plan.", severity: "error" });
    } finally {
      setApprovingPlan(false);
    }
  };

  const otherRecs   = allRecommendations.filter(r => r.doctor_id !== doctorId);
  const currentRecs = allRecommendations.filter(r => r.doctor_id === doctorId);

  const editingPathwayEntry = pathwayPlans.find(p => p.id === editingPathwayId);
  const pendingApprovalsCount = (approvedTumorBoardPlan?.doctor_approvals || []).filter(a => a.status !== "approved").length;

  if (!isOncology) return null;

  return (
    <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.35 }}>
      <Box sx={{
        background: C.bgPrimary,
        border: `1px solid ${C.border}`,
        fontFamily: FONT,
      }}>

        {/* ── Page header bar ── */}
        <Box sx={{
          px: 2.5, py: 2,
          background: C.bgSecondary,
          borderBottom: `1px solid ${C.borderStrong}`,
        }}>
          <Box sx={{
            display: "flex", alignItems: "center", justifyContent: "space-between",
            flexWrap: "wrap", gap: 2,
          }}>
            <Box sx={{ display: "flex", alignItems: "center", gap: 2 }}>
              {/* Square icon block */}
              <Box sx={{ width: 44, height: 44, background: C.black, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                <GroupRounded sx={{ fontSize: 24, color: C.white }} />
              </Box>
              <Box>
                <Typography sx={{ ...labelStyle, mb: 0.25 }}>Oncology</Typography>
                <Typography sx={{
                  fontSize: 20, fontWeight: FW_LIGHT, fontFamily: FONT,
                  color: C.textPrimary, letterSpacing: "-0.02em",
                }}>
                  Tumor Board
                </Typography>
              </Box>
            </Box>

            <Box sx={{ display: "flex", alignItems: "center", gap: 1.5, flexWrap: "wrap" }}>
              {/* Doctor pill */}
              {doctorName && (
                <Box sx={{ display: "flex", alignItems: "center", gap: 1.5, px: 1.5, py: 1, border: `1px solid ${C.border}`, background: C.bgPrimary }}>
                  <Avatar sx={{ ...squareAvatar, width: 28, height: 28, fontSize: 11 }}>
                    <MedicalServicesRounded sx={{ fontSize: 14 }} />
                  </Avatar>
                  <Box>
                    <Typography sx={{ fontSize: 12, fontWeight: FW_NORMAL, fontFamily: FONT, color: C.textPrimary }}>
                      Dr. {doctorName}
                    </Typography>
                    <Typography sx={{ fontSize: 10, color: C.textMuted, fontFamily: FONT }}>
                      {doctorSpeciality || "Oncology Specialist"}
                    </Typography>
                  </Box>
                </Box>
              )}
            </Box>
          </Box>
        </Box>

        {/* ── Top-level tabs: Tumor Board vs Imaging Studies ── */}
        <Tabs
          value={mainTumorTab}
          onChange={(_, v) => setMainTumorTab(v)}
          variant="scrollable"
          scrollButtons="auto"
          allowScrollButtonsMobile
          sx={{ ...mainTabSx, px: 2.5, background: C.bgSecondary, borderBottom: `1px solid ${C.border}` }}
        >
          <Tab icon={<GroupRounded sx={{ fontSize: 16 }} />} iconPosition="start" label="Tumor Board" />
          <Tab icon={<ImageRounded sx={{ fontSize: 16 }} />} iconPosition="start" label="Imaging Studies" />
          <Tab icon={<AccountTreeRounded sx={{ fontSize: 16 }} />} iconPosition="start" label="Care Pathway Plan" />
        </Tabs>

        {/* ═══ TUMOR BOARD TAB CONTENT ═══════════════════════════════════════ */}
        {mainTumorTab === 0 && (
          <>
            {/* ── Case Brief & Salient Points ── */}
            <Box sx={{ px: 2.5, pt: 2.5, pb: 0 }}>
              <Box sx={{ display: "flex", alignItems: "center", justifyContent: "space-between", mb: 2, flexWrap: "wrap", gap: 1.5 }}>
                <Box>
                  <Typography sx={{ ...labelStyle, mb: 0.5 }}>AI Generated</Typography>
                  <Typography sx={{ fontSize: 15, fontWeight: FW_NORMAL, fontFamily: FONT, color: C.textPrimary, letterSpacing: "-0.01em" }}>
                    Case Brief & Salient Points
                  </Typography>
                </Box>
                <Box sx={{ display: "flex", gap: 1, flexWrap: "wrap" }}>
                  {caseBriefHistory.length > 1 && (
                    <Button
                      variant="outlined"
                      onClick={() => setCaseBriefHistoryOpen(o => !o)}
                      disabled={caseBriefHistoryLoading}
                      sx={{
                        borderRadius: 0, textTransform: "none", fontFamily: FONT, fontWeight: FW_LIGHT,
                        fontSize: 12, px: 2, py: 0.75, borderColor: C.black, color: C.black,
                        "&:hover": { background: C.black, color: C.white },
                      }}
                    >
                      <HistoryRounded sx={{ mr: 0.5, fontSize: 15 }} />
                      {caseBriefHistoryOpen ? "Hide History" : `History (${caseBriefHistory.length})`}
                    </Button>
                  )}
                  <Button
                    variant="contained"
                    onClick={handleGenerateCaseBrief}
                    disabled={caseBriefLoading}
                    sx={{
                      borderRadius: 0, textTransform: "none", fontFamily: FONT, fontWeight: FW_LIGHT,
                      fontSize: 12, px: 2, py: 0.75, background: C.black, color: C.white,
                      border: `1px solid ${C.black}`,
                      "&:hover": { background: C.white, color: C.black },
                      "&.Mui-disabled": { background: C.bgTertiary, color: C.textMuted },
                    }}
                  >
                    {caseBriefLoading
                      ? <CircularProgress size={14} sx={{ mr: 0.75, color: "inherit" }} />
                      : <ArticleRounded sx={{ mr: 0.5, fontSize: 15 }} />
                    }
                    {caseBriefLoading ? "Generating..." : "Generate Case Brief & Salient Points"}
                  </Button>
                </Box>
              </Box>

              {/* Loading state — only full-block when nothing has ever loaded */}
              {caseBriefLoading && !caseBriefText && (
                <Box sx={{ display: "flex", flexDirection: "column", alignItems: "center", py: 5, gap: 1.5, border: `1px solid ${C.border}` }}>
                  <CircularProgress size={22} sx={{ color: C.black }} />
                  <Typography sx={{ fontSize: 12, color: C.textMuted, fontFamily: FONT, fontWeight: FW_LIGHT }}>
                    Compiling the case brief from the patient record...
                  </Typography>
                </Box>
              )}

              {/* Error state — only if nothing to show */}
              {!caseBriefLoading && caseBriefError && !caseBriefText && (
                <Alert severity="error" sx={{ borderRadius: 0, fontFamily: FONT, fontSize: 13 }}>
                  {caseBriefError}
                </Alert>
              )}

              {/* Empty state — nothing generated yet, no error */}
              {!caseBriefLoading && !caseBriefError && !caseBriefText && !caseBriefHistoryLoading && (
                <Box sx={{ textAlign: "center", py: 4, px: 2, border: `1px solid ${C.border}` }}>
                  <Typography sx={{ fontSize: 12.5, color: C.textMuted, fontFamily: FONT, fontWeight: FW_LIGHT }}>
                    No case brief generated yet — click "Generate Case Brief & Salient Points" above.
                  </Typography>
                </Box>
              )}

              {/* Current case brief */}
              {caseBriefText && (
                <Card sx={{ mb: 0, background: C.bgPrimary, borderRadius: 0, boxShadow: "none", border: `1px solid ${C.border}` }}>
                  <CardContent sx={{ p: 2 }}>
                    <Box sx={{ display: "flex", alignItems: "center", justifyContent: "space-between", mb: 1.5, flexWrap: "wrap", gap: 1 }}>
                      <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
                        <Box sx={{ width: 28, height: 28, background: C.black, display: "flex", alignItems: "center", justifyContent: "center" }}>
                          <ArticleRounded sx={{ fontSize: 15, color: C.white }} />
                        </Box>
                        <Typography sx={{ fontSize: 12.5, fontWeight: FW_NORMAL, fontFamily: FONT, color: C.textPrimary }}>
                          Presented Case Summary
                        </Typography>
                      </Box>
                      {caseBriefMeta?.generated_at && (
                        <Box sx={{ display: "flex", alignItems: "center", gap: 0.4 }}>
                          <AccessTimeRounded sx={{ fontSize: 12, color: C.textMuted }} />
                          <Typography sx={{ fontSize: 10.5, color: C.textMuted, fontFamily: FONT }}>
                            {new Date(caseBriefMeta.generated_at).toLocaleString()}
                          </Typography>
                        </Box>
                      )}
                    </Box>

                    <Typography sx={{
                      fontSize: 13, fontFamily: FONT, fontWeight: FW_LIGHT,
                      lineHeight: 1.8, color: C.textSecond, whiteSpace: "pre-wrap",
                    }}>
                      {caseBriefText}
                    </Typography>

                    {(caseBriefMeta?.clinical_summary_truncated || caseBriefMeta?.timeline_truncated) && (
                      <Typography sx={{ fontSize: 10.5, color: C.textMuted, fontFamily: FONT, fontStyle: "italic", mt: 1.5 }}>
                      </Typography>
                    )}
                  </CardContent>
                </Card>
              )}

              {/* History list */}
              {caseBriefHistoryOpen && caseBriefHistory.length > 0 && (
                <Box sx={{ mt: 2 }}>
                  <Typography sx={{ ...labelStyle, mb: 1 }}>Previous Case Briefs</Typography>
                  {caseBriefHistory.map((item, idx) => (
                    <CaseBriefHistoryItem key={item._id || `${item.generated_at}_${idx}`} item={item} />
                  ))}
                </Box>
              )}
            </Box>

            <Box sx={{ mx: 2.5, my: 3, height: 1, background: C.border }} />

            {/* ── Ask About Patient (RAG Q&A) ── */}
            <Box sx={{ px: 2.5, pb: 0 }}>
              <Box sx={{ mb: 2 }}>
                <Typography sx={{ ...labelStyle, mb: 0.5 }}>AI Generated</Typography>
                <Typography sx={{ fontSize: 15, fontWeight: FW_NORMAL, fontFamily: FONT, color: C.textPrimary, letterSpacing: "-0.01em" }}>
                  Ask About This Patient
                </Typography>
              </Box>

              <Box sx={{ display: "flex", gap: 1, alignItems: "flex-start", flexWrap: "wrap" }}>
                <TextField
                  fullWidth
                  placeholder="Example: Give histopathology details for patient"
                  value={patientQuestion}
                  onChange={e => setPatientQuestion(e.target.value)}
                  onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleAskPatientQuestion(); } }}
                  disabled={patientAnswerLoading}
                  sx={{
                    flex: "1 1 320px",
                    "& .MuiOutlinedInput-root": {
                      borderRadius: 0, fontFamily: FONT, fontSize: 13,
                      "& fieldset": { borderColor: C.border },
                      "&:hover fieldset": { borderColor: C.black },
                      "&.Mui-focused fieldset": { borderColor: C.black, borderWidth: 1 },
                    },
                  }}
                />
                <Button
                  variant="contained"
                  onClick={handleAskPatientQuestion}
                  disabled={patientAnswerLoading}
                  sx={{
                    borderRadius: 0, textTransform: "none", fontFamily: FONT, fontWeight: FW_LIGHT,
                    fontSize: 12.5, px: 2.5, py: 1.1, background: C.black, color: C.white,
                    border: `1px solid ${C.black}`,
                    "&:hover": { background: C.white, color: C.black },
                    "&.Mui-disabled": { background: C.bgTertiary, color: C.textMuted },
                  }}
                >
                  {patientAnswerLoading
                    ? <CircularProgress size={14} sx={{ mr: 0.75, color: "inherit" }} />
                    : <SendRounded sx={{ mr: 0.5, fontSize: 15 }} />
                  }
                  {patientAnswerLoading ? "Searching..." : "Ask"}
                </Button>
              </Box>

              {/* Loading (first ask) */}
              {patientAnswerLoading && !patientAnswer && (
                <Box sx={{ display: "flex", flexDirection: "column", alignItems: "center", py: 5, gap: 1.5, mt: 2, border: `1px solid ${C.border}` }}>
                  <CircularProgress size={22} sx={{ color: C.black }} />
                  <Typography sx={{ fontSize: 12, color: C.textMuted, fontFamily: FONT, fontWeight: FW_LIGHT }}>
                    Searching the patient record for an answer...
                  </Typography>
                </Box>
              )}

              {/* Error */}
              {!patientAnswerLoading && patientAnswerError && (
                <Alert severity="error" sx={{ borderRadius: 0, fontFamily: FONT, fontSize: 13, mt: 2 }}>
                  {patientAnswerError}
                </Alert>
              )}

              {/* Answer */}
              {!patientAnswerLoading && patientAnswer && (
                <Card sx={{ mt: 2, mb: 0, background: C.bgPrimary, borderRadius: 0, boxShadow: "none", border: `1px solid ${C.border}` }}>
                  <CardContent sx={{ p: 2 }}>
                    <Box sx={{ display: "flex", alignItems: "center", justifyContent: "space-between", mb: 1.5, flexWrap: "wrap", gap: 1 }}>
                      <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
                        <Box sx={{ width: 28, height: 28, background: C.black, display: "flex", alignItems: "center", justifyContent: "center" }}>
                          <CommentRounded sx={{ fontSize: 15, color: C.white }} />
                        </Box>
                        <Typography sx={{ fontSize: 12.5, fontWeight: FW_NORMAL, fontFamily: FONT, color: C.textPrimary }}>
                          Answer
                        </Typography>
                      </Box>
                      {patientQaAskedAt && (
                        <Box sx={{ display: "flex", alignItems: "center", gap: 0.4 }}>
                          <AccessTimeRounded sx={{ fontSize: 12, color: C.textMuted }} />
                          <Typography sx={{ fontSize: 10.5, color: C.textMuted, fontFamily: FONT }}>
                            {new Date(patientQaAskedAt).toLocaleString()}
                          </Typography>
                        </Box>
                      )}
                    </Box>
                    <Typography sx={{
                      fontSize: 13, fontFamily: FONT, fontWeight: FW_LIGHT,
                      lineHeight: 1.8, color: C.textSecond, whiteSpace: "pre-wrap",
                    }}>
                      {patientAnswer}
                    </Typography>
                  </CardContent>
                </Card>
              )}

              {/* Empty state */}
              {!patientAnswerLoading && !patientAnswerError && !patientAnswer && (
                <Box sx={{ textAlign: "center", py: 3, px: 2, mt: 2, border: `1px solid ${C.border}` }}>
                  <Typography sx={{ fontSize: 12, color: C.textMuted, fontFamily: FONT, fontWeight: FW_LIGHT }}>
                    Ask a question about this patient's records — e.g. histopathology, staging, or treatment history.
                  </Typography>
                </Box>
              )}
            </Box>

            <Box sx={{ mx: 2.5, my: 3, height: 1, background: C.border }} />

            {/* ── Care Team Discussion (chat) ── */}
            {/* <Box sx={{ px: 2.5, pt: 2.5, pb: 0 }}>
              <ChatPanel
                patientId={patientId}
                doctorId={doctorId}
                doctorName={doctorName}
                doctorSpeciality={doctorSpeciality}
              />
            </Box> */}

            {/* ── Divider between chat and feed ── */}
            <Box sx={{ mx: 2.5, my: 3, height: 1, background: C.border }} />

            {/* ── Loading full-page spinner ── */}
            {loading && allRecommendations.length === 0 && (
              <Box sx={{ display: "flex", justifyContent: "center", py: 8 }}>
                <CircularProgress size={24} sx={{ color: C.black }} />
              </Box>
            )}

            {/* ── Empty state ── */}
            {!loading && allRecommendations.length === 0 && pathwayPlans.length === 0 && !approvedTumorBoardPlan?.care_pathway_plan && (
              <Box sx={{ textAlign: "center", py: 8, px: 2, borderBottom: `1px solid ${C.border}` }}>
                <Box sx={{ width: 56, height: 56, border: `1px solid ${C.border}`, margin: "0 auto 1.25rem", display: "flex", alignItems: "center", justifyContent: "center" }}>
                  <GroupRounded sx={{ fontSize: 28, color: C.textMuted }} />
                </Box>
                <Typography sx={{ fontSize: 14, color: C.textMuted, fontFamily: FONT, fontWeight: FW_LIGHT, mb: 0.5 }}>
                  No recommendations yet
                </Typography>
                <Typography sx={{ fontSize: 12, color: C.textMuted, fontFamily: FONT, fontWeight: FW_LIGHT }}>
                  Be the first to share a recommendation, generate one with AI, or build a care pathway plan
                </Typography>
              </Box>
            )}

            {/* ── Care Pathway Plans (draft + approved) ── */}
            {pathwayPlans.length > 0 && (
              <Box sx={{ px: 2.5, pt: 2.5, pb: 0 }}>
                <SectionHeader count={pathwayPlans.length} label="Care Pathway Plans" countSuffix={pathwayPlans.length === 1 ? "plan" : "plans"} />
                <Box sx={{ mt: 2 }}>
                  {pathwayPlans.map(entry => (
                    <CarePathwayPlanCard
                      key={entry.id}
                      plan={entry.plan}
                      status={entry.status}
                      onStepClick={setViewingStep}
                      onEdit={() => handleOpenEditPathway(entry.id)}
                      onApprove={() => handleRequestApprovePathway(entry.id)}
                    />
                  ))}
                </Box>
              </Box>
            )}

            {/* ── Other doctors' recommendations ── */}
            {!loading && otherRecs.length > 0 && (
              <Box sx={{ px: 2.5, pt: 2.5, pb: 0 }}>
                <SectionHeader count={otherRecs.length} label="Other Doctors' Recommendations" />
                <Box>
                  {otherRecs.map((rec, idx) => (
                    <RecommendationCard
                      key={`other_${rec.doctor_id + rec.created_at + idx}`}
                      recommendation={rec}
                      isCurrentDoctor={false}
                      doctorNames={doctorNames}
                    />
                  ))}
                </Box>
              </Box>
            )}

            {/* ── Your recommendations ── */}
            {!loading && currentRecs.length > 0 && (
              <Box sx={{ px: 2.5, pt: otherRecs.length > 0 ? 3 : 2.5, pb: 0 }}>
                <SectionHeader count={currentRecs.length} label="Your Recommendations" />
                <Box>
                  {currentRecs.map((rec, idx) => (
                    <RecommendationCard
                      key={`my_${rec.doctor_id + rec.created_at + idx}`}
                      recommendation={rec}
                      isCurrentDoctor={true}
                      doctorNames={doctorNames}
                    />
                  ))}
                </Box>
              </Box>
            )}

            {/* ── Divider between feed and recommendation input ── */}
            <Box sx={{ mx: 2.5, my: 3, height: 1, background: C.border }} />

            {/* ── Recommendation input section ── */}
            <Box sx={{ px: 2.5, pb: 2.5 }}>
              <VoiceTranscription
                onTranscript={handleSaveRecommendation}
                aiGeneratedText={aiGeneratedText}
                onAiTextClear={handleAiTextClear}
              />
            </Box>
          </>
        )}

        {/* ═══ IMAGING STUDIES TAB CONTENT ═══════════════════════════════════ */}
        {mainTumorTab === 1 && (
          <Box sx={{ p: 2.5 }}>
            <Box sx={{ border: `1px solid ${C.border}`, minHeight: 500, background: C.bgPrimary }}>
              <DICOMViewer patientId={patientId} doctorId={doctorId} />
            </Box>
          </Box>
        )}

        {/* ═══ CARE PATHWAY PLAN TAB CONTENT ══════════════════════════════════ */}
        {mainTumorTab === 2 && (
          <Box sx={{ px: 2.5, py: 2.5 }}>
            <CarePathwayDictation
              value={dictationText}
              onTextChange={setDictationText}
              disabled={carePathwayLoading}
              onGenerate={handleGenerateButtonClick}
              generating={carePathwayLoading}
            />

            <Box sx={{ my: 3, height: 1, background: C.border }} />

            {approvedTumorBoardPlan?.care_pathway_plan ? (
              <>
                <SectionHeader
                  count={pendingApprovalsCount}
                  label="Approved Care Pathway Plan"
                  countSuffix={pendingApprovalsCount === 1 ? "doctor pending approval" : "doctors pending approval"}
                />
                <Box sx={{ mt: 2, mb: 3 }}>
                  <ApprovedTumorBoardPlanCard
                    data={approvedTumorBoardPlan}
                    doctorNames={doctorNames}
                    onStepClick={setViewingStep}
                    currentDoctorId={doctorId}
                    onEdit={handleEditApprovedPlan}
                    onApprove={handleRequestApproveOwnPlan}
                  />
                </Box>
              </>
            ) : (
              <Typography sx={{ fontSize: 12.5, color: C.textMuted, fontFamily: FONT, textAlign: "center", py: 4 }}>
                No approved care pathway plan yet — dictate notes above or click "Generate Care Pathway Plan" to create one.
              </Typography>
            )}

            <Box sx={{ my: 3, height: 1, background: C.border }} />

            {/* <ChatPanel
              patientId={patientId}
              doctorId={doctorId}
              doctorName={doctorName}
              doctorSpeciality={doctorSpeciality}
            /> */}
          </Box>
        )}

        {/* ── Refer popup ── */}
        <ReferPatientPopup
          open={referPopupOpen}
          onClose={() => setReferPopupOpen(false)}
          fromDoctorId={doctorId}
          fromDoctorName={doctorName}
          fromDoctorSpeciality={doctorSpeciality}
          patientId={patientId}
          patientName={patientName}
          onSubmit={handleReferPatient}
        />

        {/* ── Regenerate plan warning (shown when an approved plan already exists) ── */}
        <RegeneratePlanWarningDialog
          open={regenerateWarningOpen}
          onClose={handleCloseRegenerateWarning}
          onConfirm={handleConfirmRegeneratePlan}
        />

        {/* ── Care pathway generate/review popup ── */}
        <CarePathwayPopup
          open={carePathwayPopupOpen}
          onClose={handleCloseCarePathway}
          loading={carePathwayLoading}
          planData={carePathwayData}
          errorMessage={carePathwayError}
          onContinue={handleContinueCarePathway}
          onDecline={handleDeclineCarePathway}
          onStepClick={setViewingStep}
        />

        {/* ── Edit draft care pathway plan dialog ── */}
        <EditCarePathwayDialog
          open={editDialogOpen}
          onClose={handleCloseEditPathway}
          plan={editingPathwayEntry?.plan}
          onSave={handleSaveEditedPathway}
        />

        {/* ── Approve confirmation (final warning before locking) ── */}
        <ApprovePathwayConfirmDialog
          open={!!approveConfirmId}
          onClose={handleCloseApproveConfirm}
          onConfirm={handleConfirmApprovePathway}
          saving={approvingPlan}
        />

        {/* ── Edit the fetched plan before approving your own copy ── */}
        <EditCarePathwayDialog
          open={editApprovedPlanOpen}
          onClose={handleCloseEditApprovedPlan}
          plan={approvedTumorBoardPlan?.care_pathway_plan}
          onSave={handleSaveEditedApprovedPlan}
        />

        {/* ── Confirm approving the plan as the current doctor ── */}
        <ApprovePathwayConfirmDialog
          open={approveOwnConfirmOpen}
          onClose={handleCloseApproveOwnConfirm}
          onConfirm={handleConfirmApproveOwnPlan}
          saving={approvingOwnPlan}
        />

        {/* ── Step detail dialog (shared by popup + plan cards) ── */}
        <StepDetailDialog
          step={viewingStep}
          open={!!viewingStep}
          onClose={() => setViewingStep(null)}
        />

        {/* ── Snackbar ── */}
        <Snackbar
          open={snackbar.open}
          autoHideDuration={4000}
          onClose={() => setSnackbar({ ...snackbar, open: false })}
          anchorOrigin={{ vertical: "bottom", horizontal: "center" }}
        >
          <Alert severity={snackbar.severity} sx={{
            borderRadius: 0,
            border: `1px solid ${snackbar.severity === "error" ? "#f44336" : snackbar.severity === "warning" ? "#ff9800" : C.black}`,
            fontFamily: FONT,
            fontSize: 13,
            fontWeight: FW_LIGHT,
            "& .MuiAlert-icon": { fontSize: 18 },
          }}>
            {snackbar.message}
          </Alert>
        </Snackbar>
      </Box>
    </motion.div>
  );
};

export default TumorBoard;