import React, { useState, useEffect, useRef, useMemo } from "react";
import {
  Box,
  Typography,
  Button,
  Radio,
  RadioGroup as MuiRadioGroup,
  FormControlLabel,
  Checkbox,
  TextField,
  Select,
  MenuItem,
  IconButton,
  Autocomplete,
  Table,
  TableHead,
  TableBody,
  TableRow,
  TableCell,
  TableContainer,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  TablePagination,
  Accordion,
  AccordionSummary,
  AccordionDetails,
  Grid
} from "@mui/material";
import { Add, Delete, Remove, Print, UploadFile, CloseRounded, ExpandMoreRounded, WarningAmberRounded, Mic, Stop } from "@mui/icons-material";
import { workflowToOPRecord, opRecordToWorkflow } from "./chemoCrosswalk";
import ClinicalSummaryTab from "./ClinicalSummaryTab";
import DischargeSummary from "./Dischargesummary";
import DICOMViewer from "./DICOMViewer";
import StructuredNotePanel from "./structurenoteview";
import TumorBoardCommonElement from "./TumorBoardCommonElement";
import { LabInvestigations } from "./LabInvestigations";
import PatientReferralsTab from "./PatientReferralsTab";
import ProtocolMasterTab from "./OPProtocolMasterTab";
import RadioTherapyOverview from "./RadioTherapyOverview";
import SurgeryOverview from "./SurgeryOverview";
const API_BASE_URL = import.meta.env.VITE_BACKEND_URL || "https://doctorassist.ai/api/";

function uploadInvestigationFile(patientId, doctorId, investigationId, file) {
  const formData = new FormData();
  formData.append("doctor_id", doctorId);
  formData.append("patient_id", patientId);
  formData.append("investigation_id", investigationId);
  formData.append("file", file);

  return fetch(`${API_BASE_URL}hms/users/cm/storage/oncology-investigations/upload-file-url`, {
    method: "POST",
    body: formData,
  }).then(async r => {
    if (!r.ok) {
      const errorData = await r.json().catch(() => ({ detail: "Unknown error" }));
      throw new Error(errorData.detail || `Upload failed (${r.status})`);
    }
    return r.json();
  });
}

// ─── BRAND TOKENS (matching Doctorassist.AI / TumorBoard) ──────────
const FONT = '"Open Sans", sans-serif';
const FW_LIGHT = 300;
const FW_NORMAL = 400;
const FW_MEDIUM = 500;

const C = {
  black: "#000000",
  white: "#ffffff",
  bgPrimary: "#ffffff",
  bgSecondary: "#fafafa",
  bgTertiary: "#f5f5f5",
  textPrimary: "#000000",
  textSecond: "#444444",
  textMuted: "#888888",
  border: "#e0e0e0",
  borderStrong: "#000000",
};

// ─── REUSABLE VOICE DICTATION & TRANSCRIPTION PANEL ─────────────────────────
const VoiceDictationPanel = ({
  title = "Voice Dictation & AI Auto-fill",
  placeholder = "Type or dictate notes here. Use the buttons below to start voice dictation or run AI auto-fill.",
  transcript = "",
  setTranscript,
  onAutofill,
  isAutofilling = false,
  autofillSuccess = false,
}) => {
  const [isRecording, setIsRecording] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const mediaRecorderRef = useRef(null);
  const audioChunksRef = useRef([]);

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

          if (transcribedText) {
            setTranscript(prev => prev ? prev + " " + transcribedText : transcribedText);
          }
        } catch (err) {
          console.error("Error processing audio:", err);
          alert("Error transcribing voice input.");
        } finally {
          setIsProcessing(false);
        }
      };
      mediaRecorderRef.current.stop();
      mediaRecorderRef.current.stream.getTracks().forEach(track => track.stop());
    }
  };

  return (
    <Box sx={{ mb: 2, p: 2, background: C.white, border: `1px solid ${C.border}` }}>
      <Typography sx={{ fontSize: 13, fontWeight: FW_MEDIUM, mb: 1.5, fontFamily: FONT }}>{title}</Typography>
      <TextField
        fullWidth
        multiline
        rows={3}
        size="small"
        placeholder={placeholder}
        value={transcript}
        onChange={e => setTranscript(e.target.value)}
        sx={{ ...inputStyle, mb: 1 }}
      />
      <Box sx={{ display: 'flex', gap: 1.5, flexWrap: 'wrap', alignItems: 'center', mt: 0.5 }}>
        <Button
          variant="contained"
          size="small"
          startIcon={isRecording ? <Stop /> : <Mic />}
          onClick={isRecording ? stopRecording : startRecording}
          disabled={isProcessing || isAutofilling}
          sx={{
            textTransform: 'none',
            fontFamily: FONT,
            background: isRecording ? '#d32f2f' : C.black,
            color: C.white,
            boxShadow: 'none',
            '&:hover': { background: isRecording ? '#b71c1c' : '#333', boxShadow: 'none' }
          }}
        >
          {isProcessing ? "Transcribing..." : isRecording ? "Stop Dictation" : "Start Dictation"}
        </Button>

        {onAutofill && (
          <Button
            variant="outlined"
            size="small"
            onClick={onAutofill}
            disabled={isAutofilling || isRecording || isProcessing || !transcript?.trim()}
            sx={{
              textTransform: 'none',
              fontFamily: FONT,
              borderColor: C.black,
              color: C.black,
              '&:hover': { background: C.bgSecondary, borderColor: C.black }
            }}
          >
            {isAutofilling ? "Extracting…" : "✦ AI Auto-fill Fields"}
          </Button>
        )}

        {autofillSuccess && (
          <Typography sx={{ fontSize: 12, color: '#389e0d', fontFamily: FONT, fontWeight: FW_MEDIUM }}>
            ✓ Fields auto-filled successfully
          </Typography>
        )}
      </Box>
    </Box>
  );
};

const DoctorNameResolver = ({ doctorId, fallback }) => {
  const [name, setName] = useState("");
  const [loading, setLoading] = useState(!!doctorId);


  useEffect(() => {
    if (!doctorId) {
      setLoading(false);
      return;
    }
    const fetchDoc = async () => {
      try {
        const res = await fetch(`${API_BASE_URL}hms/users/doctors/get_doctor/${doctorId}`);
        if (res.ok) {
          const json = await res.json();
          const docData = json?.data || json?.doctor || json;
          const resolvedName = docData?.name || docData?.doctor_name || `${docData?.first_name || ""} ${docData?.last_name || ""}`.trim();
          if (resolvedName && resolvedName.trim() !== "") {
            setName(resolvedName);
          }
        }
      } catch (err) {
        console.error("Failed to fetch doctor name", err);
      } finally {
        setLoading(false);
      }
    };
    fetchDoc();
  }, [doctorId]);

  if (loading) return <Typography component="span" sx={{ fontSize: 12.5, fontStyle: "italic", color: C.textMuted }}>Loading...</Typography>;
  return name || fallback;
};

const recordTh = {
  fontFamily: FONT, fontSize: 10, fontWeight: 700, padding: '8px 12px',
  border: `1px solid ${C.borderStrong}`, background: '#f5f5f5', textAlign: 'left', textTransform: 'uppercase', width: '25%', color: C.textPrimary
};
const recordTd = {
  fontFamily: FONT, fontSize: 13, fontWeight: 400, padding: '8px 12px',
  border: `1px solid ${C.borderStrong}`, color: C.textPrimary, width: '25%', verticalAlign: 'top', wordBreak: 'break-word'
};

const RenderImportSection = ({ sectionName, sectionData }) => {
  if (!sectionData) return null;

  if (Array.isArray(sectionData) && sectionData.length > 0 && typeof sectionData[0] === 'object') {
    const columns = Object.keys(sectionData[0]).map(k => ({ key: k, label: k.replace(/([A-Z])/g, ' $1').toUpperCase() }));
    return (
      <Box sx={{ mb: 2 }}>
        <Typography sx={{ fontSize: 13, fontWeight: 700, mb: 1, fontFamily: FONT, color: C.textPrimary, textTransform: 'uppercase' }}>
          {sectionName.replace(/_/g, " ")}
        </Typography>
        <Box component="table" sx={{ width: "100%", borderCollapse: "collapse", background: C.white, border: `1px solid ${C.borderStrong}` }}>
          <Box component="thead">
            <Box component="tr" sx={{ borderBottom: `1px solid ${C.borderStrong}` }}>
              {columns.map(col => (
                <Box component="th" key={col.key} sx={{ ...recordTh, width: 'auto' }}>{col.label}</Box>
              ))}
            </Box>
          </Box>
          <Box component="tbody">
            {sectionData.map((row, rIdx) => (
              <Box component="tr" key={rIdx} sx={{ borderBottom: rIdx === sectionData.length - 1 ? 'none' : `1px solid ${C.borderStrong}` }}>
                {columns.map(col => (
                  <Box component="td" key={col.key} sx={{ ...recordTd, width: 'auto' }}>
                    {typeof row[col.key] === "object" ? (
                      <Typography sx={{ margin: 0, whiteSpace: "pre-wrap", fontFamily: FONT, fontSize: 12.5 }}>
                        {Array.isArray(row[col.key]) ? row[col.key].join(", ") : JSON.stringify(row[col.key], null, 2)}
                      </Typography>
                    ) : (
                      String(row[col.key] || '—')
                    )}
                  </Box>
                ))}
              </Box>
            ))}
          </Box>
        </Box>
      </Box>
    );
  } else if (typeof sectionData === 'object' && !Array.isArray(sectionData) && Object.keys(sectionData).length > 0) {
    const filteredEntries = Object.entries(sectionData);
    const rows = [];
    for (let i = 0; i < filteredEntries.length; i += 2) {
      rows.push([filteredEntries[i], filteredEntries[i + 1]]);
    }
    return (
      <Box sx={{ display: "flex", flexDirection: "column", mb: 2 }}>
        <Typography sx={{ fontSize: 13, fontWeight: 700, mb: 1, fontFamily: FONT, color: C.textPrimary, textTransform: 'uppercase' }}>
          {sectionName.replace(/_/g, " ")}
        </Typography>
        <Box component="table" sx={{ width: "100%", borderCollapse: "collapse", background: C.white, border: `1px solid ${C.borderStrong}` }}>
          <Box component="tbody">
            {rows.map((row, rIdx) => (
              <Box component="tr" key={rIdx} sx={{ borderBottom: `1px solid ${C.borderStrong}` }}>
                <Box component="th" sx={{ ...recordTh }}>{row[0][0].replace(/([A-Z])/g, ' $1')}</Box>
                <Box component="td" sx={{ ...recordTd }}>
                  {typeof row[0][1] === "object" ? (
                    <Typography sx={{ margin: 0, whiteSpace: "pre-wrap", fontFamily: FONT, fontSize: 12.5 }}>
                      {Array.isArray(row[0][1]) ? row[0][1].join(", ") : JSON.stringify(row[0][1], null, 2)}
                    </Typography>
                  ) : (
                    (row[0][0].toLowerCase().includes("surgeon") || row[0][0].toLowerCase().includes("doctor") || row[0][0].toLowerCase().includes("technician")) && String(row[0][1]).startsWith("DOC-") ? (
                      <DoctorNameResolver doctorId={row[0][1]} fallback={String(row[0][1])} />
                    ) : (
                      String(row[0][1])
                    )
                  )}
                </Box>
                {row[1] ? (
                  <>
                    <Box component="th" sx={{ ...recordTh }}>{row[1][0].replace(/([A-Z])/g, ' $1')}</Box>
                    <Box component="td" sx={{ ...recordTd }}>
                      {typeof row[1][1] === "object" ? (
                        <Typography sx={{ margin: 0, whiteSpace: "pre-wrap", fontFamily: FONT, fontSize: 12.5 }}>
                          {Array.isArray(row[1][1]) ? row[1][1].join(", ") : JSON.stringify(row[1][1], null, 2)}
                        </Typography>
                      ) : (
                        (row[1][0].toLowerCase().includes("surgeon") || row[1][0].toLowerCase().includes("doctor") || row[1][0].toLowerCase().includes("technician")) && String(row[1][1]).startsWith("DOC-") ? (
                          <DoctorNameResolver doctorId={row[1][1]} fallback={String(row[1][1])} />
                        ) : (
                          String(row[1][1])
                        )
                      )}
                    </Box>
                  </>
                ) : (
                  <>
                    <Box component="th" sx={{ ...recordTh, background: "transparent" }}></Box>
                    <Box component="td" sx={{ ...recordTd, borderLeft: 'none' }}></Box>
                  </>
                )}
              </Box>
            ))}
          </Box>
        </Box>
      </Box>
    );
  }
  return null;
};

const labelStyle = {
  fontSize: "0.65rem",
  textTransform: "uppercase",
  letterSpacing: "0.2em",
  color: C.textMuted,
  fontFamily: FONT,
  fontWeight: FW_NORMAL,
};

const inputStyle = {
  fontFamily: FONT,
  fontSize: "13px",
  fontWeight: FW_LIGHT,
  borderRadius: 0,
  "& .MuiOutlinedInput-root": {
    borderRadius: 0,
    background: C.bgPrimary,
    "& fieldset": { borderColor: C.border },
    "&:hover fieldset": { borderColor: C.textMuted },
    "&.Mui-focused fieldset": { borderColor: C.black, borderWidth: "1px" },
  },
  "& .MuiInputBase-input": {
    padding: "9px 12px",
    height: "auto",
  }
};

const btnStyle = {
  fontFamily: FONT,
  fontWeight: FW_MEDIUM,
  textTransform: "none",
  borderRadius: 0,
  boxShadow: "none",
  "&:hover": { boxShadow: "none" }
};

const STANDARD_LAB_FIELDS = [
  { key: "hb", label: "Haemoglobin (Hb)", unit: "g/dL", range: "12–18", category: "Haematology" },
  { key: "pcv", label: "PCV / Haematocrit", unit: "%", range: "36–52", category: "Haematology" },
  { key: "wbc", label: "WBC Count", unit: "×10³/µL", range: "4–11", category: "Haematology" },
  { key: "platelets", label: "Platelets", unit: "×10³/µL", range: "150–400", category: "Haematology" },
  { key: "inr", label: "PT / INR", unit: "", range: "<1.5", category: "Haematology" },
  { key: "aptt", label: "aPTT", unit: "sec", range: "25–35", category: "Haematology" },
  { key: "creatinine", label: "Serum Creatinine", unit: "mg/dL", range: "0.6–1.2", category: "Renal" },
  { key: "blood_urea", label: "Blood Urea", unit: "mg/dL", range: "7–20", category: "Renal" },
  { key: "sodium", label: "Serum Na⁺", unit: "mEq/L", range: "136–145", category: "Renal" },
  { key: "potassium", label: "Serum K⁺", unit: "mEq/L", range: "3.5–5.0", category: "Renal" },
  { key: "bilirubin", label: "Total Bilirubin", unit: "mg/dL", range: "0.2–1.2", category: "Liver" },
  { key: "sgot", label: "SGOT / AST", unit: "U/L", range: "<40", category: "Liver" },
  { key: "sgpt", label: "SGPT / ALT", unit: "U/L", range: "<40", category: "Liver" },
  { key: "albumin", label: "Serum Albumin", unit: "g/dL", range: "3.5–5.0", category: "Liver" },
  { key: "rbs", label: "Random Blood Sugar", unit: "mg/dL", range: "<180", category: "Metabolic" },
  { key: "hba1c", label: "HbA1c", unit: "%", range: "<7.0", category: "Metabolic" },
  { key: "calcium", label: "Serum Calcium", unit: "mg/dL", range: "8.5–10.5", category: "Metabolic" },
  { key: "ecg", label: "ECG Result", unit: "", range: "", category: "Cardiac" },
  { key: "echo_lvef", label: "Echo LVEF", unit: "%", range: ">55", category: "Cardiac" },
  { key: "bnp", label: "BNP", unit: "pg/mL", range: "<100", category: "Cardiac" },
  { key: "hiv", label: "HIV", unit: "", range: "Negative", category: "Virology" },
  { key: "hbsag", label: "HBsAg", unit: "", range: "Negative", category: "Virology" },
  { key: "hcv", label: "HCV", unit: "", range: "Negative", category: "Virology" },
];

const STANDARD_RAD_FIELDS = [
  { key: "ct_scan", label: "CT Scan (Computed Tomography)" },
  { key: "mri", label: "MRI (Magnetic Resonance Imaging)" },
  { key: "pet_scan", label: "PET Scan (Positron Emission Tomography)" },
  { key: "pet_ct", label: "PET-CT" },
  { key: "xray", label: "X-Ray" },
  { key: "usg", label: "Ultrasound (USG)" },
  { key: "mammography", label: "Mammography" },
  { key: "bone_scan", label: "Bone Scan" },
  { key: "spect_scan", label: "SPECT Scan" },
  { key: "fluoroscopy", label: "Fluoroscopy" },
  { key: "angiography", label: "Angiography" },
];

const LAB_CATEGORIES = ["Haematology", "Renal", "Liver", "Metabolic", "Cardiac", "Virology"];

const MOCK_NURSES = [
  "Nurse Priya Sharma",
  "Nurse Anjali Nair",
  "Nurse Sunita Patel",
  "Nurse Meera Krishnan",
  "Nurse Kavitha Reddy",
  "Nurse Deepa Menon",
  "Nurse Lakshmi Iyer",
  "Nurse Ritu Gupta",
];

const STANDARD_TEST_OPTIONS = [
  // Complete Blood Count (CBC)
  { label: "Hemoglobin", group: "Complete Blood Count (CBC)" },
  { label: "White blood cell count", group: "Complete Blood Count (CBC)" },
  { label: "Absolute Neutrophil Count (ANC)", group: "Complete Blood Count (CBC)" },
  { label: "Platelet count", group: "Complete Blood Count (CBC)" },
  { label: "Lymphocytes", group: "Complete Blood Count (CBC)" },
  // Kidney Function
  { label: "Serum creatinine", group: "Kidney Function" },
  { label: "eGFR", group: "Kidney Function" },
  { label: "Creatinine clearance", group: "Kidney Function" },
  { label: "Blood urea nitrogen (BUN)", group: "Kidney Function" },
  // Liver Function
  { label: "AST", group: "Liver Function" },
  { label: "ALT", group: "Liver Function" },
  { label: "Bilirubin", group: "Liver Function" },
  { label: "Alkaline phosphatase", group: "Liver Function" },
  { label: "Albumin", group: "Liver Function" },
  // Electrolytes
  { label: "Sodium", group: "Electrolytes" },
  { label: "Potassium", group: "Electrolytes" },
  { label: "Calcium", group: "Electrolytes" },
  { label: "Magnesium", group: "Electrolytes" },
  { label: "Phosphate", group: "Electrolytes" }
];

// ─── REUSABLE UI COMPONENTS ──────────────────────────────────────

const SectionHeader = ({ num, title, note, action }) => (
  <Box sx={{ display: "flex", alignItems: "center", gap: 1.5, background: C.black, color: C.white, p: "10px 20px" }}>
    {num && (
      <Typography sx={{ fontSize: 11, fontWeight: FW_MEDIUM, letterSpacing: "0.06em", color: C.textMuted }}>
        {num}
      </Typography>
    )}
    <Typography sx={{ fontSize: 14.5, fontWeight: FW_MEDIUM, letterSpacing: "0.02em", textTransform: "uppercase", m: 0 }}>
      {title}
    </Typography>
    {note && (
      <Typography sx={{ ml: "auto", fontSize: 10.5, color: C.textMuted, fontWeight: FW_LIGHT, letterSpacing: "0.02em" }}>
        {note}
      </Typography>
    )}
    {action && (
      <Box sx={{ ml: note ? 2 : "auto" }}>
        {action}
      </Box>
    )}
  </Box>
);


const FieldLine = ({ label, value }) => (
  <Box sx={{ display: "flex", gap: 1.5 }}>
    <Typography sx={{ fontSize: 12.5, fontWeight: 600, color: C.textSecond, minWidth: 170, fontFamily: FONT, flexShrink: 0 }}>
      {label}
    </Typography>
    <Typography sx={{ fontSize: 12.5, color: C.textPrimary, fontFamily: FONT }}>
      {value}
    </Typography>
  </Box>
);

const invThSx = { fontFamily: FONT, fontSize: 10, fontWeight: 600, color: '#000', textTransform: 'uppercase', py: 1.5, px: 2, borderBottom: `1px solid ${C.border}`, whiteSpace: "nowrap" };

const invTdSx = { fontFamily: FONT, fontSize: 13, color: '#000', py: 1.5, px: 2, borderBottom: `1px solid ${C.border}`, verticalAlign: "top" };

const ExpandableTextCell = ({ text, maxLen = 50 }) => {
  const [expanded, setExpanded] = useState(false);
  const value = text || "—";
  const isLong = value.length > maxLen;
  const display = expanded || !isLong ? value : value.slice(0, maxLen) + "...";
  return (
    <TableCell
      sx={{
        ...invTdSx,
        maxWidth: 220,
        cursor: isLong ? "pointer" : "default",
        whiteSpace: expanded ? "pre-wrap" : "normal",
        wordBreak: "break-word",
        "&:hover": isLong ? { background: C.bgSecondary } : {},
      }}
      onClick={() => isLong && setExpanded(v => !v)}
      title={isLong ? (expanded ? "Click to collapse" : "Click to expand") : value}
    >
      {display}
    </TableCell>
  );
};

const getCycleNumberForDate = (dateStr, dbCycles) => {
  if (!dateStr || !dbCycles || Object.keys(dbCycles).length === 0) return null;
  const targetDate = new Date(dateStr);
  if (isNaN(targetDate)) return null;

  let matchedCycle = null;
  const cycles = Object.keys(dbCycles)
    .sort((a, b) => Number(a) - Number(b))
    .map(key => {
      let d = new Date(dbCycles[key]?.cycle_admin?.cycleDate1 || dbCycles[key]?.regimen?.startDate);
      if (isNaN(d)) d = new Date(dbCycles[key]?.pre_chemo?.date);
      return { cycleNum: key, date: d };
    })
    .filter(c => !isNaN(c.date));

  if (cycles.length === 0) return null;

  // Set time to 00:00:00 for date-only comparison
  const tDate = new Date(targetDate.getFullYear(), targetDate.getMonth(), targetDate.getDate());

  for (let i = 0; i < cycles.length; i++) {
    const cDate = new Date(cycles[i].date.getFullYear(), cycles[i].date.getMonth(), cycles[i].date.getDate());
    if (cDate <= tDate) {
      matchedCycle = cycles[i].cycleNum;
    }
  }

  // If the investigation was ordered before the first cycle date, default it to Cycle 1
  if (!matchedCycle && cycles.length > 0) {
    matchedCycle = cycles[0].cycleNum;
  }

  return matchedCycle;
};

// The ONE field the table reads is order_context.label.
const orderContextLabel = (inv) => {
  const ctx = inv?.order_context;
  if (ctx && typeof ctx === "object") return ctx.label || ctx.procedure || ctx.cycle || "—";
  if (typeof ctx === "string" && ctx) return ctx;
  return "—";
};

const PendingInvestigationRow = ({ inv, formattedDate, patientId, doctorId, onUploadComplete, dbCycles }) => {
  const [indExpanded, setIndExpanded] = useState(false);
  const [paramExpanded, setParamExpanded] = useState(false);
  const [file, setFile] = useState(null);
  const [isUploading, setIsUploading] = useState(false);
  const [message, setMessage] = useState(null);

  const handleUpload = async () => {
    if (!file) {
      setMessage({ type: 'error', text: 'Please select a file' });
      return;
    }
    setIsUploading(true);
    setMessage(null);
    try {
      const invId = inv.id !== undefined && inv.id !== null ? inv.id : inv._id;
      await uploadInvestigationFile(patientId, doctorId, invId, file);
      setMessage({ type: 'success', text: 'Uploaded' });
      if (onUploadComplete) onUploadComplete(invId);
    } catch (err) {
      setMessage({ type: 'error', text: err.message || 'Upload failed' });
    } finally {
      setIsUploading(false);
    }
  };

  const indication = inv.clinical_indication || "None provided";
  const isIndLong = indication.length > 50;
  const dispInd = indExpanded ? indication : (isIndLong ? indication.substring(0, 50) + "..." : indication);

  const paramsStr = Array.isArray(inv.parameters)
    ? inv.parameters.map(p => typeof p === 'string' ? p : p.label).join(", ")
    : (typeof inv.parameters === 'string' ? inv.parameters : "None");
  const isParamLong = paramsStr.length > 50;
  const dispParam = paramExpanded ? paramsStr : (isParamLong ? paramsStr.substring(0, 50) + "..." : paramsStr);

  const inferredCycle = getCycleNumberForDate(inv.date_of_order, dbCycles);
  const baseInvType = (inv.investigation || inv.investigation_type || "").includes("radiology") ? "Radiology" : "Lab";
  const displayInvType = baseInvType;

  return (
    <TableRow sx={{ "&:hover td": { background: C.bgSecondary } }}>
      <TableCell sx={{ ...invTdSx, whiteSpace: "nowrap", verticalAlign: "top" }}>{formattedDate}</TableCell>
      <TableCell sx={{ ...invTdSx, verticalAlign: "top" }}>{inv.id !== undefined && inv.id !== null ? inv.id : "—"}</TableCell>
      <TableCell sx={{ ...invTdSx, verticalAlign: "top", whiteSpace: "nowrap" }}>{displayInvType}</TableCell>
      <TableCell sx={{ ...invTdSx, verticalAlign: "top" }}>{orderContextLabel(inv)}</TableCell>
      <TableCell sx={{ ...invTdSx, verticalAlign: "top", cursor: isIndLong ? "pointer" : "default" }} onClick={() => isIndLong && setIndExpanded(!indExpanded)}>
        {dispInd}
      </TableCell>
      <TableCell sx={{ ...invTdSx, verticalAlign: "top" }}>
        <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5 }}>
          {Array.isArray(inv.parameters) ? (
            inv.parameters.map((p, i) => (
              <Box key={i} sx={{ background: C.bgSecondary, border: `1px solid ${C.border}`, borderRadius: 1, px: 1, py: 0.25, fontSize: 11, color: C.textMain }}>
                {typeof p === 'string' ? p : p.label}
              </Box>
            ))
          ) : (
            <Typography sx={{ fontSize: 12, color: C.textMain }}>{typeof inv.parameters === 'string' ? inv.parameters : "None"}</Typography>
          )}
        </Box>
      </TableCell>
      <TableCell sx={invTdSx}>
        <Typography sx={{ fontSize: 12, color: C.black, fontWeight: FW_MEDIUM, fontFamily: FONT }}>
          {inv.status ? inv.status.charAt(0).toUpperCase() + inv.status.slice(1) : "Pending"}
        </Typography>
      </TableCell>
      <TableCell sx={invTdSx}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <Button component="label" size="small" sx={{ ...btnStyle, border: `1px solid ${C.black}`, color: C.black, background: C.white, mt: 0, py: 0.4, px: 1, fontSize: 10, "&:hover": { background: C.bgSecondary } }}>
            Choose File
            <input type="file" hidden onChange={(e) => {
              setFile(e.target.files[0]);
              setMessage(null);
            }} />
          </Button>
          <Button
            size="small"
            disabled={!file || isUploading}
            onClick={handleUpload}
            sx={{ ...btnStyle, border: `1px solid ${file && !isUploading ? C.black : C.border}`, color: file && !isUploading ? C.white : C.textMuted, background: file && !isUploading ? C.black : C.bgSecondary, mt: 0, py: 0.4, px: 1, fontSize: 10 }}
          >
            {isUploading ? 'Uploading...' : 'Upload'}
          </Button>
        </Box>
        {file && <Typography sx={{ fontSize: 10, color: C.textMuted, mt: 0.5, fontFamily: FONT }}>{file.name}</Typography>}
        {message && <Typography sx={{ fontSize: 10, color: message.type === 'error' ? 'red' : 'green', mt: 0.5, fontFamily: FONT }}>{message.text}</Typography>}
      </TableCell>
    </TableRow>
  );
};

const CompletedInvestigationRow = ({ inv, formattedDate, onViewValues, dbCycles }) => {
  const [indExpanded, setIndExpanded] = useState(false);
  const [paramExpanded, setParamExpanded] = useState(false);

  const indication = inv.clinical_indication || "None provided";
  const isIndLong = indication.length > 50;
  const dispInd = indExpanded ? indication : (isIndLong ? indication.substring(0, 50) + "..." : indication);

  const paramsStr = Array.isArray(inv.parameters)
    ? inv.parameters.map(p => typeof p === 'string' ? p : p.label).join(", ")
    : (typeof inv.parameters === 'string' ? inv.parameters : "None");
  const isParamLong = paramsStr.length > 50;
  const dispParam = paramExpanded ? paramsStr : (isParamLong ? paramsStr.substring(0, 50) + "..." : paramsStr);

  const hasValues = Array.isArray(inv.parameterwise_content) && inv.parameterwise_content.length > 0;

  const inferredCycle = getCycleNumberForDate(inv.date_of_order, dbCycles);
  const baseInvType = (inv.investigation || inv.investigation_type || "").includes("radiology") ? "Radiology" : "Lab";
  const displayInvType = baseInvType;

  return (
    <TableRow sx={{ "&:hover td": { background: C.bgSecondary } }}>
      <TableCell sx={{ ...invTdSx, whiteSpace: "nowrap", verticalAlign: "top" }}>{formattedDate}</TableCell>
      <TableCell sx={{ ...invTdSx, verticalAlign: "top" }}>{inv.id !== undefined && inv.id !== null ? inv.id : "—"}</TableCell>
      <TableCell sx={{ ...invTdSx, verticalAlign: "top", whiteSpace: "nowrap" }}>{displayInvType}</TableCell>
      <TableCell sx={{ ...invTdSx, verticalAlign: "top" }}>{orderContextLabel(inv)}</TableCell>
      <TableCell sx={{ ...invTdSx, verticalAlign: "top", cursor: isIndLong ? "pointer" : "default" }} onClick={() => isIndLong && setIndExpanded(!indExpanded)}>
        {dispInd}
      </TableCell>
      <TableCell sx={{ ...invTdSx, verticalAlign: "top" }}>
        <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5 }}>
          {Array.isArray(inv.parameters) ? (
            inv.parameters.map((p, i) => (
              <Box key={i} sx={{ background: C.bgSecondary, border: `1px solid ${C.border}`, borderRadius: 1, px: 1, py: 0.25, fontSize: 11, color: C.textMain }}>
                {typeof p === 'string' ? p : p.label}
              </Box>
            ))
          ) : (
            <Typography sx={{ fontSize: 12, color: C.textMain }}>{typeof inv.parameters === 'string' ? inv.parameters : "None"}</Typography>
          )}
        </Box>
      </TableCell>
      <TableCell sx={invTdSx}>
        <Typography sx={{ fontSize: 12, color: '#389e0d', fontWeight: FW_MEDIUM, fontFamily: FONT }}>Completed</Typography>
      </TableCell>
      <TableCell sx={invTdSx}>
        {hasValues ? (
          <Button size="small" sx={{ ...btnStyle, border: `1px solid ${C.black}`, color: C.black, background: C.white, mt: 0, py: 0.4, px: 1, fontSize: 10, "&:hover": { background: C.bgSecondary } }} onClick={() => onViewValues(inv)}>
            View Values
          </Button>
        ) : (
          <Button size="small" sx={{ ...btnStyle, border: `1px solid ${C.black}`, color: C.black, background: C.white, mt: 0, py: 0.4, px: 1, fontSize: 10, "&:hover": { background: C.bgSecondary } }}>
            View Doc
          </Button>
        )}
      </TableCell>
    </TableRow>
  );
};

const CompletedInvestigationsTable = ({ completedInvestigations, dbCycles }) => {
  const [page, setPage] = useState(0);
  const [rowsPerPage, setRowsPerPage] = useState(5);
  const [valuesDialog, setValuesDialog] = useState({ open: false, inv: null });
  const isEmpty = !completedInvestigations || completedInvestigations.length === 0;

  const closeValues = () => setValuesDialog({ open: false, inv: null });

  return (
    <Box>
      <TableContainer sx={{ border: `1px solid ${C.border}`, borderRadius: 1 }}>
        <Table size="small">
          <TableHead sx={{ background: C.bgSecondary }}>
            <TableRow>
              {["Date", "ID", "Investigation", "Ordered For", "Clinical Indication", "Parameters", "Status", "Action"].map(h => (
                <TableCell key={h} sx={invThSx}>{h}</TableCell>
              ))}
            </TableRow>
          </TableHead>
          <TableBody>
            {isEmpty ? (
              <TableRow>
                <TableCell colSpan={8} sx={{ ...invTdSx, textAlign: "center", py: 2, color: "#888" }}>No completed investigations.</TableCell>
              </TableRow>
            ) : (
              completedInvestigations
                .slice(page * rowsPerPage, page * rowsPerPage + rowsPerPage)
                .map((inv, idx) => {
                  const d = new Date(inv.date_of_order);
                  const formattedDate = isNaN(d) ? inv.date_of_order : d.toLocaleString();
                  return <CompletedInvestigationRow key={inv.document_id || inv._id || idx} inv={inv} formattedDate={formattedDate} onViewValues={(i) => setValuesDialog({ open: true, inv: i })} dbCycles={dbCycles} />;
                })
            )}
          </TableBody>
        </Table>
      </TableContainer>
      {!isEmpty && completedInvestigations.length > rowsPerPage && (
        <TablePagination
          component="div"
          count={completedInvestigations.length}
          page={page}
          onPageChange={(e, newPage) => setPage(newPage)}
          rowsPerPage={rowsPerPage}
          onRowsPerPageChange={(e) => {
            setRowsPerPage(parseInt(e.target.value, 10));
            setPage(0);
          }}
          rowsPerPageOptions={[5, 10, 25]}
          sx={{ color: C.black, ".MuiTablePagination-selectIcon": { color: C.black } }}
        />
      )}

      <Dialog open={valuesDialog.open} onClose={closeValues} maxWidth="md" fullWidth>
        <DialogTitle sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: C.bgSecondary, borderBottom: `1px solid ${C.border}`, py: 1.5 }}>
          <Typography sx={{ fontFamily: FONT, fontWeight: FW_MEDIUM, fontSize: 16, color: C.black }}>Extracted Values</Typography>
          <IconButton onClick={closeValues} size="small"><CloseRounded /></IconButton>
        </DialogTitle>
        <DialogContent sx={{ p: 3, fontFamily: FONT }}>
          {valuesDialog.inv && (
            <TableContainer sx={{ border: `1px solid ${C.black}`, borderRadius: 0, background: C.white }}>
              <Table size="small">
                <TableHead>
                  <TableRow>
                    <TableCell sx={invThSx}>Parameter</TableCell>
                    <TableCell sx={invThSx}>Date</TableCell>
                    <TableCell sx={invThSx}>Content</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {(valuesDialog.inv.parameterwise_content || []).length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={3} sx={{ ...invTdSx, textAlign: "center", color: C.textMuted }}>No extracted values.</TableCell>
                    </TableRow>
                  ) : (
                    (valuesDialog.inv.parameterwise_content || []).map((p, i) => (
                      <TableRow key={i}>
                        <TableCell sx={invTdSx}>{p.parameter_name || "—"}</TableCell>
                        <TableCell sx={invTdSx}>{p.date || "—"}</TableCell>
                        <TableCell sx={{ ...invTdSx, whiteSpace: "pre-wrap" }}>{p.content || "—"}</TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </TableContainer>
          )}
        </DialogContent>
      </Dialog>
    </Box>
  );
};

const DEMO_OTP_CODES = ["1234", "123456", "0000", "999999"];

const ApprovalCard = ({ title, name, onNameChange, signed, onToggleSign, namePlaceholder = "Enter name", options }) => {
  const [otpStep, setOtpStep] = useState(null); // null, "send", "enter"
  const [otpInput, setOtpInput] = useState("");
  const [otpError, setOtpError] = useState("");
  const [otpSending, setOtpSending] = useState(false);

  const handleSignClick = () => {
    if (signed) {
      onToggleSign();
    } else {
      setOtpStep("send");
      setOtpInput("");
      setOtpError("");
    }
  };

  const closeOtpDialog = () => {
    setOtpStep(null);
    setOtpInput("");
    setOtpError("");
    setOtpSending(false);
  };

  const handleSendOtp = () => {
    setOtpSending(true);
    setTimeout(() => {
      setOtpSending(false);
      setOtpStep("enter");
    }, 1200);
  };

  const handleVerifyOtp = () => {
    if (DEMO_OTP_CODES.includes(otpInput.trim())) {
      onToggleSign();
      closeOtpDialog();
    } else {
      setOtpError("Invalid OTP. Please try again.");
    }
  };

  return (
    <Box sx={{
      flex: 1,
      minWidth: 220,
      border: `1px solid ${signed ? "#81c784" : C.border}`,
      background: signed ? "#e8f5e9" : C.bgSecondary,
      p: 2,
      borderRadius: 1,
      transition: "all 0.2s ease"
    }}>
      <Typography sx={{ fontSize: 11, fontWeight: FW_MEDIUM, letterSpacing: "0.06em", textTransform: "uppercase", color: signed ? "#2e7d32" : C.textMuted, mb: 1.5, fontFamily: FONT }}>
        {title} {signed && "✓ (Signed)"}
      </Typography>
      {options && options.length > 0 ? (
        <Autocomplete
          freeSolo
          forcePopupIcon={true}
          openOnFocus
          options={options}
          value={name || ""}
          onChange={(e, newValue) => onNameChange(newValue || "")}
          onInputChange={(e, newInputValue) => onNameChange(newInputValue || "")}
          renderInput={(params) => (
            <TextField
              {...params}
              fullWidth
              size="small"
              placeholder={namePlaceholder}
              sx={{ ...inputStyle, mb: 1.5, background: C.white }}
              inputProps={{
                ...params.inputProps,
                autoComplete: 'new-password',
                name: `nurse_field_${Math.random()}`,
              }}
            />
          )}
        />
      ) : (
        <TextField
          fullWidth
          size="small"
          placeholder={namePlaceholder}
          value={name || ""}
          onChange={e => onNameChange(e.target.value)}
          sx={{ ...inputStyle, mb: 1.5, background: C.white }}
        />
      )}
      <Button
        fullWidth
        onClick={handleSignClick}
        disabled={!name}
        sx={{
          ...btnStyle,
          py: 1.5,
          border: `1px ${signed ? "solid #4caf50" : "dashed " + C.border}`,
          background: signed ? "#c8e6c9" : C.white,
          color: signed ? "#1b5e20" : C.textMuted,
          fontWeight: signed ? 600 : "normal",
          fontStyle: signed ? "normal" : "italic",
          fontSize: 14,
          minHeight: 48,
          "&:hover": { background: signed ? "#a5d6a7" : C.bgSecondary, borderColor: signed ? "#388e3c" : C.black },
        }}
      >
        {signed ? "✓ Signed" : "Click to Sign"}
      </Button>

      {/* OTP Dialog */}
      <Dialog open={!!otpStep} onClose={closeOtpDialog} maxWidth="xs" fullWidth>
        <DialogTitle sx={{ fontFamily: FONT, fontWeight: 600, fontSize: 16 }}>
          Authorize Signature
        </DialogTitle>
        <DialogContent dividers>
          {otpStep === "send" ? (
            <Typography sx={{ fontFamily: FONT, fontSize: 14, color: C.textSecond }}>
              A one-time password will be sent to <b>{name}</b> to confirm authorization. Click "Send OTP" to proceed.
            </Typography>
          ) : (
            <Box>
              <Typography sx={{ fontFamily: FONT, fontSize: 14, color: C.textSecond, mb: 2 }}>
                An OTP has been sent to <b>{name}</b>. Enter the code below to complete authorization.
              </Typography>
              <TextField
                fullWidth
                size="small"
                label="Enter OTP"
                value={otpInput}
                onChange={e => { setOtpInput(e.target.value); setOtpError(""); }}
                onKeyDown={e => { if (e.key === "Enter") handleVerifyOtp(); }}
                error={!!otpError}
                helperText={otpError || " "}
                sx={inputStyle}
              />
              <Typography sx={{ fontSize: 11, color: C.textMuted, mt: 1 }}>
                (Demo codes: {DEMO_OTP_CODES.join(", ")})
              </Typography>
            </Box>
          )}
        </DialogContent>
        <DialogActions sx={{ p: 2 }}>
          <Button onClick={closeOtpDialog} sx={{ fontFamily: FONT, textTransform: "none", color: C.textSecond }}>
            Cancel
          </Button>
          {otpStep === "send" ? (
            <Button
              variant="contained"
              onClick={handleSendOtp}
              disabled={otpSending}
              sx={{ ...btnStyle, background: C.black, color: C.white, px: 3, "&:hover": { background: "#333" } }}
            >
              {otpSending ? "Sending…" : "Send OTP"}
            </Button>
          ) : (
            <Button
              variant="contained"
              onClick={handleVerifyOtp}
              disabled={!otpInput.trim()}
              sx={{ ...btnStyle, background: "#4caf50", color: C.white, px: 3, "&:hover": { background: "#43a047" } }}
            >
              Verify & Sign
            </Button>
          )}
        </DialogActions>
      </Dialog>
    </Box>
  );
};


const ApprovalsSection = ({ cards }) => (
  <Box sx={{ mt: 3, mx: "20px", mb: 2 }}>
    <Box sx={{ display: "flex", alignItems: "center", justifyContent: "space-between", background: C.black, color: C.white, p: "10px 20px" }}>
      <Typography sx={{ fontSize: 14.5, fontWeight: FW_MEDIUM, letterSpacing: "0.02em", textTransform: "uppercase", m: 0, fontFamily: FONT }}>
        Approvals
      </Typography>
      <Typography sx={{ fontSize: 12, fontWeight: FW_NORMAL, color: C.white, fontFamily: FONT }}>
        E-Signature
      </Typography>
    </Box>
    <Box sx={{ border: `1px solid ${C.border}`, borderTop: "none", background: C.white, p: 2, display: "flex", gap: 2, flexWrap: "wrap" }}>
      {cards.map((card) => (
        <ApprovalCard key={card.title} {...card} />
      ))}
    </Box>
  </Box>
);

const normalizeDrugName = (name) => String(name || "").trim().toLowerCase().replace(/[^a-z0-9]+/g, " ").replace(/\s+/g, " ").trim();

const isPositiveReaction = (val) => {
  const v = String(val || "").trim().toLowerCase();
  if (!v || v === "-" || v === "—" || v === "no" || v === "n" || v === "none" || v === "nil" || v === "n/a" || v === "na") return false;
  return true;
};

const formatReactionDetail = (val) => {
  const v = String(val || "").trim();
  if (!v) return "Reaction reported";
  const lower = v.toLowerCase();
  if (lower === "yes" || lower === "y") return "Reaction reported during infusion";
  return v;
};

const drugNamesMatch = (a, b) => {
  const na = normalizeDrugName(a);
  const nb = normalizeDrugName(b);
  if (!na || !nb) return false;
  if (na === nb) return true;
  if (na.includes(nb) || nb.includes(na)) return true;
  const ta = na.split(" ").filter(Boolean);
  const tb = nb.split(" ").filter(Boolean);
  return ta.some(t => t.length >= 4 && tb.includes(t)) || tb.some(t => t.length >= 4 && ta.includes(t));
};

const pickCanonicalDrugName = (names = []) => {
  const cleaned = [...new Set((names || []).map(n => String(n || "").trim()).filter(Boolean))];
  if (cleaned.length === 0) return "—";
  // Prefer longer/more complete spelling (Paclitaxel over Paclitaxe)
  return cleaned.sort((a, b) => b.length - a.length || a.localeCompare(b))[0];
};

const extractCycleDrugEntries = (cycleObj = {}) => {
  const admin = cycleObj.admin || {};
  const prep = cycleObj.prep || {};
  const regimen = cycleObj.regimen || {};
  const entries = [];
  (admin.adminDrugs || []).forEach(d => {
    if (d?.name) entries.push({ name: d.name, reaction: d.infusionReaction, source: "admin" });
  });
  (regimen.drugs || []).forEach(d => {
    if (d?.name) entries.push({ name: d.name, reaction: "", source: "regimen" });
  });
  if (prep.drugName) entries.push({ name: prep.drugName, reaction: "", source: "prep" });
  return entries;
};

const severityFromGrade = (grade) => {
  const g = parseInt(grade, 10);
  if (g >= 4) return "critical";
  if (g === 3) return "high";
  if (g === 2) return "moderate";
  if (g === 1) return "low";
  return "info";
};

const collectPastAdverseEventsForCurrentDrugs = (dbCycles, currentCycle, currentDrugs = []) => {
  if (!dbCycles || !currentCycle || currentCycle <= 1) return [];

  let currentNames = (currentDrugs || []).map(d => d?.name).filter(Boolean);
  if (currentNames.length === 0) {
    currentNames = extractCycleDrugEntries(dbCycles[String(currentCycle)] || {}).map(d => d.name);
  }
  if (currentNames.length === 0) {
    for (let c = 1; c < currentCycle; c++) {
      extractCycleDrugEntries(dbCycles[String(c)] || {}).forEach(d => {
        if (d.name) currentNames.push(d.name);
      });
    }
  }
  currentNames = [...new Set(currentNames.filter(Boolean))];
  if (currentNames.length === 0) return [];

  const alerts = [];

  for (let cycleNum = 1; cycleNum < currentCycle; cycleNum++) {
    const cycleObj = dbCycles[String(cycleNum)] || {};
    const post = cycleObj.post_chemo || {};
    const cycleAdmin = cycleObj.cycle_admin || {};
    const cycleDrugs = extractCycleDrugEntries(cycleObj);

    const matchedRawNames = cycleDrugs
      .map(d => d.name)
      .filter(n => currentNames.some(cn => drugNamesMatch(cn, n)));
    const drugLabel = pickCanonicalDrugName(matchedRawNames);
    const hasSameDrug = matchedRawNames.length > 0;
    if (!hasSameDrug) continue;

    // 1) Infusion reactions (one row per unique drug in cycle)
    const reactionByDrug = new Map();
    cycleDrugs.forEach(d => {
      if (!currentNames.some(cn => drugNamesMatch(cn, d.name))) return;
      if (!isPositiveReaction(d.reaction)) return;
      const key = normalizeDrugName(d.name);
      if (!reactionByDrug.has(key)) reactionByDrug.set(key, d);
    });
    reactionByDrug.forEach(d => {
      alerts.push({
        cycleNum,
        drug: pickCanonicalDrugName([d.name]),
        type: "Infusion reaction",
        detail: formatReactionDetail(d.reaction),
        severity: "high",
        category: "infusion",
      });
    });

    // 2) Structured toxicities (preferred over legacy free-text)
    const toxicities = Array.isArray(post.toxicities) ? post.toxicities : [];
    const structuredEvents = [];
    toxicities.forEach((tox) => {
      const eventName = tox?.event || tox?.description || "";
      const hasEvent = !!(eventName || tox?.grade || tox?.system);
      if (!hasEvent) return;
      structuredEvents.push({
        cycleNum,
        drug: drugLabel,
        type: "Toxicity",
        event: eventName || "Adverse event",
        grade: tox.grade || "",
        system: tox.system || "",
        attribution: tox.attribution || "",
        detail: [
          eventName || "Adverse event",
          tox.grade ? `Grade ${tox.grade}` : "",
          tox.system || "",
          tox.attribution && tox.attribution !== "unrelated" ? tox.attribution : "",
        ].filter(Boolean).join(" · "),
        severity: severityFromGrade(tox.grade),
        category: "toxicity",
      });
    });

    if (structuredEvents.length > 0) {
      alerts.push(...structuredEvents);
    } else if (post.adverseEvents) {
      // 3) Legacy free-text only if no structured toxicity exists
      alerts.push({
        cycleNum,
        drug: drugLabel,
        type: "Toxicity",
        event: String(post.adverseEvents),
        grade: "",
        system: "",
        attribution: "",
        detail: String(post.adverseEvents),
        severity: "moderate",
        category: "toxicity",
      });
    }

    // 4) Incomplete chemo reason
    if (cycleAdmin.cycleCompleted === "not-completed" && cycleAdmin.notCompletedReason) {
      alerts.push({
        cycleNum,
        drug: drugLabel,
        type: "Not completed",
        detail: String(cycleAdmin.notCompletedReason),
        severity: "high",
        category: "incomplete",
      });
    }
  }

  // Sort: most recent cycle first, then severity
  const severityRank = { critical: 0, high: 1, moderate: 2, low: 3, info: 4 };
  return alerts.sort((a, b) => {
    if (b.cycleNum !== a.cycleNum) return b.cycleNum - a.cycleNum;
    return (severityRank[a.severity] ?? 9) - (severityRank[b.severity] ?? 9);
  });
};

const groupAlertsByCycle = (alerts = []) => {
  const map = new Map();
  alerts.forEach(a => {
    if (!map.has(a.cycleNum)) map.set(a.cycleNum, []);
    map.get(a.cycleNum).push(a);
  });
  return [...map.entries()]
    .sort((a, b) => b[0] - a[0])
    .map(([cycleNum, items]) => ({ cycleNum, items }));
};

const severityStyle = (severity) => {
  if (severity === "critical") return { bg: "#111", color: "#fff", label: "Critical" };
  if (severity === "high") return { bg: "#000", color: "#fff", label: "High" };
  if (severity === "moderate") return { bg: "#444", color: "#fff", label: "Moderate" };
  if (severity === "low") return { bg: "#e0e0e0", color: "#000", label: "Low" };
  return { bg: "#f5f5f5", color: "#444", label: "Info" };
};

// ─── Automated dosing helpers (BSA / BMI / CrCl / AUC) ────────────────
const calcBSA = (heightCm, weightKg) => {
  const h = parseFloat(heightCm);
  const w = parseFloat(weightKg);
  if (!h || !w || h <= 0 || w <= 0) return null;
  return 0.007184 * Math.pow(h, 0.725) * Math.pow(w, 0.425); // DuBois
};

const calcBMI = (heightCm, weightKg) => {
  const h = parseFloat(heightCm);
  const w = parseFloat(weightKg);
  if (!h || !w || h <= 0 || w <= 0) return null;
  return w / Math.pow(h / 100, 2);
};

// Cockcroft–Gault creatinine clearance (mL/min)
const calcCrCl = ({ age, weightKg, creatinineMgDl, gender }) => {
  const a = parseFloat(age);
  const w = parseFloat(weightKg);
  const cr = parseFloat(creatinineMgDl);
  if (!a || !w || !cr || a <= 0 || w <= 0 || cr <= 0) return null;
  const sexFactor = String(gender || "").toLowerCase().startsWith("f") ? 0.85 : 1;
  return ((140 - a) * w * sexFactor) / (72 * cr);
};

// Calvert: Carboplatin dose (mg) = AUC × (GFR + 25); GFR ≈ CrCl
const calcCalvertDose = (auc, gfr) => {
  const a = parseFloat(auc);
  const g = parseFloat(gfr);
  if (!a || a <= 0 || g === null || g === undefined || isNaN(g) || g < 0) return null;
  return a * (g + 25);
};

const formatDoseMg = (n) => (n === null || n === undefined || isNaN(n) ? null : Math.round(n));

const hasValue = (value) => {
  if (value === null || value === undefined) return false;
  if (typeof value === "string" && value.trim() === "") return false;
  if (Array.isArray(value) && value.length === 0) return false;
  if (typeof value === "object" && !Array.isArray(value) && Object.keys(value).length === 0) return false;
  return true;
};

// ─── Chemotherapy Regimen Schedule Helpers ─────────────────────────────
const parseDDMMYYYY = (str) => {
  if (!str) return null;
  const parts = String(str).split(/[-/]/);
  if (parts.length !== 3) return null;
  const [d, m, y] = parts.map(p => parseInt(p, 10));
  if (!d || !m || !y) return null;
  const date = new Date(y, m - 1, d);
  return isNaN(date) ? null : date;
};

const formatDateDisplay = (date) => {
  if (!date) return "—";
  return date.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
};

const computeCycleSchedule = (startDateStr, plannedCycles, daysBetween) => {
  const start = parseDDMMYYYY(startDateStr);
  const cycles = parseInt(plannedCycles) || 0;
  const interval = parseInt(daysBetween) || 0;
  if (!start || !cycles) return [];
  const schedule = [];
  for (let i = 0; i < cycles; i++) {
    const d = new Date(start);
    d.setDate(d.getDate() + i * interval);
    schedule.push({ cycleNum: i + 1, date: d });
  }
  return schedule;
};

const computeDrugDose = ({ unit, dose, height, weight, age, gender, creatinine, aucTarget }) => {
  const doseVal = parseFloat(dose);
  const bsa = calcBSA(height, weight);
  const bmi = calcBMI(height, weight);
  const crcl = calcCrCl({ age, weightKg: weight, creatinineMgDl: creatinine, gender });
  const u = String(unit || "").toLowerCase();

  if (u === "m2" || u === "mg/m2" || u === "bsa") {
    if (!doseVal || !bsa) return { totalMg: null, method: "BSA (mg/m²)", formula: "Need dose + Ht/Wt", bsa, bmi, crcl };
    const total = doseVal * bsa;
    return {
      totalMg: formatDoseMg(total),
      method: "BSA (DuBois)",
      formula: `${doseVal} mg/m² × ${Number(bsa.toFixed(3))} m² = ${formatDoseMg(total)} mg`,
      bsa, bmi, crcl,
    };
  }
  if (u === "kg" || u === "mg/kg") {
    const w = parseFloat(weight);
    if (!doseVal || !w) return { totalMg: null, method: "Weight (mg/kg)", formula: "Need dose + weight", bsa, bmi, crcl };
    const total = doseVal * w;
    return {
      totalMg: formatDoseMg(total),
      method: "Weight-based",
      formula: `${doseVal} mg/kg × ${w} kg = ${formatDoseMg(total)} mg`,
      bsa, bmi, crcl,
    };
  }
  if (u === "auc" || u === "calvert") {
    const auc = parseFloat(aucTarget || dose);
    if (!auc || crcl === null) {
      return {
        totalMg: null,
        method: "Calvert (AUC)",
        formula: "Need AUC target + age, weight, creatinine, gender",
        bsa, bmi, crcl,
      };
    }
    const total = calcCalvertDose(auc, crcl);
    return {
      totalMg: formatDoseMg(total),
      method: "Calvert AUC",
      formula: `AUC ${auc} × (CrCl ${crcl.toFixed(1)} + 25) = ${formatDoseMg(total)} mg`,
      bsa, bmi, crcl,
    };
  }
  if (u === "mg" || u === "flat" || u === "fixed") {
    if (!doseVal) return { totalMg: null, method: "Fixed (mg)", formula: "Need dose", bsa, bmi, crcl };
    return {
      totalMg: formatDoseMg(doseVal),
      method: "Fixed dose",
      formula: `${formatDoseMg(doseVal)} mg (flat dose)`,
      bsa, bmi, crcl,
    };
  }
  if (u === "mcg") {
    if (!doseVal) return { totalMg: null, method: "mcg", formula: "Need dose", bsa, bmi, crcl };
    return { totalMg: doseVal / 1000, method: "mcg → mg", formula: `${doseVal} mcg`, bsa, bmi, crcl };
  }
  if (u === "ml") {
    return { totalMg: null, method: "Volume (ml)", formula: doseVal ? `${doseVal} ml` : "—", bsa, bmi, crcl };
  }
  return { totalMg: null, method: "—", formula: "—", bsa, bmi, crcl };
};

const FieldRow = ({ label, tag, nested = false, hidden = false, children }) => {
  if (hidden) return null;
  return (
    <Box sx={{
      display: "grid",
      gridTemplateColumns: { xs: "1fr", md: "280px 1fr" },
      gap: 2,
      borderBottom: `1px solid ${C.border}`,
      p: "16px 20px",
      alignItems: "start",
      background: nested ? C.bgSecondary : "transparent",
      pl: nested ? { xs: "20px", md: "36px" } : "20px"
    }}>
      <Box sx={{ pt: 1 }}>
        <Typography sx={{ fontSize: 12.5, color: C.textPrimary, lineHeight: 1.5 }}>{label}</Typography>
        {tag && <Typography sx={{ display: "inline-block", mt: 0.5, fontSize: 9.5, letterSpacing: "0.08em", textTransform: "uppercase", color: C.textMuted }}>{tag}</Typography>}
      </Box>
      <Box sx={{ minWidth: 0 }}>
        {children}
      </Box>
    </Box>
  );
};

const CustomRadio = ({ label, value, checked, onChange }) => (
  <FormControlLabel
    value={value}
    control={<Radio size="small" sx={{ color: C.border, "&.Mui-checked": { color: C.black } }} />}
    label={<Typography sx={{ fontSize: 12.5, fontFamily: FONT, color: checked ? C.black : C.textSecond }}>{label}</Typography>}
    checked={checked}
    onChange={onChange}
    sx={{
      m: 0, mr: 1, mb: 1, pr: 2,
      border: `1px solid ${checked ? C.black : C.border}`,
      background: checked ? C.bgSecondary : C.white,
      transition: "all 0.2s",
      cursor: "pointer",
      pointerEvents: "auto",
    }}
  />
);

const CustomCheckbox = ({ label, checked, onChange }) => (
  <FormControlLabel
    control={<Checkbox size="small" checked={checked} onChange={onChange} sx={{ color: C.border, "&.Mui-checked": { color: C.black } }} />}
    label={<Typography sx={{ fontSize: 12.5, fontFamily: FONT, color: checked ? C.black : C.textSecond }}>{label}</Typography>}
    sx={{ m: 0, mr: 1, mb: 1, pr: 2, border: `1px solid ${checked ? C.black : C.border}`, background: checked ? C.bgSecondary : C.white }}
  />
);

const PROTOCOL_HISTORY_COLUMNS = [
  { label: "Intent", field: "treatmentIntent" },
  { label: "Protocol", field: "selectedProtocol" },
  { label: "Interval", field: "intervalDetails" },
  { label: "Start Date", field: "startDate" },
  { label: "Details", field: "protocolDetails" },
  { label: "Adjustments", field: "doseAdjustments" },
  { label: "Concurrent Therapy", field: "concurrentTherapy" }
];

const ProtocolHistoryTable = ({ dbCycles, completedCycles }) => {
  const [expanded, setExpanded] = useState(false);

  if (!completedCycles || completedCycles === 0 || !dbCycles) return null;

  const rows = Array.from({ length: completedCycles }, (_, i) => {
    const cycleNum = i + 1;
    let cycleData = dbCycles[String(cycleNum)]?.regimen || {};
    return { cycleNum, data: cycleData };
  });

  return (
    <Box sx={{ mb: 3 }}>
      <Button
        fullWidth
        onClick={() => setExpanded(!expanded)}
        sx={{
          justifyContent: "space-between",
          textTransform: "none",
          background: C.white,
          border: `1px solid ${C.border}`,
          borderRadius: expanded ? "4px 4px 0 0" : "4px",
          color: C.textSecond,
          px: 2,
          py: 1.5,
          "&:hover": { background: C.bgSecondary }
        }}
      >
        <Typography sx={{ fontSize: 13, fontWeight: FW_MEDIUM, color: C.textSecond }}>
          {expanded ? "▼" : "▶"} View Previous Cycles ({completedCycles} completed)
        </Typography>
        <Typography sx={{ fontSize: 11, color: C.textMuted }}>
          {expanded ? "Click to collapse" : "Click to expand"}
        </Typography>
      </Button>
      {expanded && (
        <Box sx={{ border: `1px solid ${C.border}`, borderTop: "none", borderRadius: "0 0 4px 4px", overflowX: "auto", background: C.white }}>
          <Box component="table" sx={{ width: "100%", borderCollapse: "collapse", tableLayout: "fixed" }}>
            <Box component="thead">
              <Box component="tr" sx={{ background: C.bgSecondary }}>
                <Box component="th" sx={{ textAlign: "left", p: "8px 12px", fontSize: 10, textTransform: "uppercase", letterSpacing: "0.08em", fontWeight: 600, color: C.textMuted, borderBottom: `1px solid ${C.border}` }}>Cycle</Box>
                {PROTOCOL_HISTORY_COLUMNS.map(c => (
                  <Box key={c.field} component="th" sx={{ textAlign: "left", p: "8px 12px", fontSize: 10, textTransform: "uppercase", letterSpacing: "0.08em", fontWeight: 600, color: C.textMuted, borderBottom: `1px solid ${C.border}` }}>
                    {c.label}
                  </Box>
                ))}
              </Box>
            </Box>
            <Box component="tbody">
              {rows.map(row => (
                <Box component="tr" key={row.cycleNum}>
                  <Box component="td" sx={{ p: "8px 12px", fontSize: 12, borderBottom: `1px solid ${C.bgSecondary}`, fontWeight: FW_MEDIUM, color: C.black }}>{row.cycleNum}</Box>
                  {PROTOCOL_HISTORY_COLUMNS.map(c => (
                    <Box component="td" key={c.field} sx={{ p: "8px 12px", fontSize: 12, borderBottom: `1px solid ${C.bgSecondary}`, whiteSpace: "pre-wrap", wordWrap: "break-word", color: C.textPrimary }}>
                      {row.data[c.field] || "—"}
                    </Box>
                  ))}
                </Box>
              ))}
            </Box>
          </Box>
        </Box>
      )}
    </Box>
  );
};

const DRUG_HISTORY_COLUMNS = [
  { label: "Drug Name", field: "name" },
  { label: "Type", field: "type" },
  { label: "Dose", field: "dose" },
  { label: "Unit", field: "unit" },
  { label: "Max Dose", field: "maxDose" },
  { label: "Route", field: "route" },
  { label: "Admin Type", field: "adminType" },
  { label: "Frequency", field: "frequency" },
  { label: "Diluent", field: "diluent" },
  { label: "Volume(ml)", field: "volume" },
  { label: "Duration", field: "duration" },
  { label: "Instructions", field: "instructions" }
];

const DrugHistoryTable = ({ dbCycles, completedCycles }) => {
  const [expanded, setExpanded] = useState(false);

  if (!completedCycles || completedCycles === 0 || !dbCycles) return null;

  const rows = [];
  Array.from({ length: completedCycles }, (_, i) => {
    const cycleNum = i + 1;
    const cycleObj = dbCycles[String(cycleNum)] || {};

    let drugs = cycleObj.regimen?.drugs;

    // Fallback for legacy cycles created before the rich drugs array existed
    if (!drugs || drugs.length === 0) {
      const legacyName = cycleObj.prep?.drugName;
      const legacyDose = cycleObj.prep?.dosePerSqm;
      if (legacyName || legacyDose) {
        drugs = [{
          name: legacyName || "",
          dose: legacyDose || "",
        }];
      } else {
        drugs = [];
      }
    }

    drugs.forEach((drug, index) => {
      rows.push({ cycleNum, data: drug, index });
    });
  });

  if (rows.length === 0) return null;

  return (
    <Box sx={{ mb: 3 }}>
      <Button
        fullWidth
        onClick={() => setExpanded(!expanded)}
        sx={{
          justifyContent: "space-between",
          textTransform: "none",
          background: C.white,
          border: `1px solid ${C.border}`,
          borderRadius: expanded ? "4px 4px 0 0" : "4px",
          color: C.textSecond,
          px: 2,
          py: 1.5,
          "&:hover": { background: C.bgSecondary }
        }}
      >
        <Typography sx={{ fontSize: 13, fontWeight: FW_MEDIUM, color: C.textSecond }}>
          {expanded ? "▼" : "▶"} View Previous Cycles' Drugs ({rows.length} drugs across {completedCycles} cycles)
        </Typography>
        <Typography sx={{ fontSize: 11, color: C.textMuted }}>
          {expanded ? "Click to collapse" : "Click to expand"}
        </Typography>
      </Button>
      {expanded && (
        <Box sx={{ border: `1px solid ${C.border}`, borderTop: "none", borderRadius: "0 0 4px 4px", overflowX: "auto", background: C.white }}>
          <Box component="table" sx={{ width: "100%", borderCollapse: "collapse", tableLayout: "fixed" }}>
            <Box component="thead">
              <Box component="tr" sx={{ background: C.bgSecondary }}>
                <Box component="th" sx={{ textAlign: "left", p: "8px 12px", fontSize: 10, textTransform: "uppercase", letterSpacing: "0.08em", fontWeight: 600, color: C.textMuted, borderBottom: `1px solid ${C.border}` }}>Cycle</Box>
                {DRUG_HISTORY_COLUMNS.map(c => (
                  <Box key={c.field} component="th" sx={{ textAlign: "left", p: "8px 12px", fontSize: 10, textTransform: "uppercase", letterSpacing: "0.08em", fontWeight: 600, color: C.textMuted, borderBottom: `1px solid ${C.border}` }}>
                    {c.label}
                  </Box>
                ))}
              </Box>
            </Box>
            <Box component="tbody">
              {rows.map(row => (
                <Box component="tr" key={`${row.cycleNum}-${row.index}`}>
                  <Box component="td" sx={{ p: "8px 12px", fontSize: 12, borderBottom: `1px solid ${C.bgSecondary}`, fontWeight: FW_MEDIUM, color: C.black }}>{row.cycleNum}</Box>
                  {DRUG_HISTORY_COLUMNS.map(c => (
                    <Box component="td" key={c.field} sx={{ p: "8px 12px", fontSize: 12, borderBottom: `1px solid ${C.bgSecondary}`, whiteSpace: "pre-wrap", wordWrap: "break-word", color: C.textPrimary }}>
                      {row.data[c.field] || "—"}
                    </Box>
                  ))}
                </Box>
              ))}
            </Box>
          </Box>
        </Box>
      )}
    </Box>
  );
};

const PRE_CHEMO_HISTORY_COLUMNS = [
  { label: "Consultant", field: "consultant" },
  { label: "Labs", field: "labs" },
  { label: "Venous Access", field: "venousAccess" },
  { label: "Consent", field: "consent" },
  { label: "Safety Verified", field: "safetyVerified" },
  { label: "Emergency Meds", field: "emergencyMeds" }
];

const PreChemoHistoryTable = ({ dbCycles, completedCycles }) => {
  const [expanded, setExpanded] = useState(false);
  if (!completedCycles || completedCycles === 0 || !dbCycles) return null;

  const rows = [];
  Array.from({ length: completedCycles }, (_, i) => {
    const cycleNum = i + 1;
    const preC = dbCycles[String(cycleNum)]?.pre_chemo || {};
    const det = dbCycles[String(cycleNum)]?.details || {};

    const cons = det.consultants || {};
    let consultantName = det.consultantName || "";
    if (!consultantName) {
      let consultants = [];
      if (cons.drA) consultants.push("Dr. A");
      if (cons.drB) consultants.push("Dr. B");
      if (cons.drC) consultants.push("Dr. C");
      consultantName = consultants.join(", ");
    }

    if (preC.currentLabs || preC.venousAccess || preC.informedConsent) {
      rows.push({
        cycleNum,
        data: {
          consultant: consultantName || "—",
          labs: preC.currentLabs || "—",
          venousAccess: preC.venousAccess || "—",
          consent: preC.informedConsent ? "Yes" : "No",
          safetyVerified: preC.safetyVerified || "—",
          emergencyMeds: preC.emergencyMeds || "—"
        }
      });
    }
  });

  if (rows.length === 0) return null;

  return (
    <Box sx={{ mb: 3 }}>
      <Button
        fullWidth onClick={() => setExpanded(!expanded)}
        sx={{ justifyContent: "space-between", textTransform: "none", background: C.white, border: `1px solid ${C.border}`, borderRadius: expanded ? "4px 4px 0 0" : "4px", color: C.textSecond, px: 2, py: 1.5, "&:hover": { background: C.bgSecondary } }}
      >
        <Typography sx={{ fontSize: 13, fontWeight: FW_MEDIUM, color: C.textSecond }}>{expanded ? "▼" : "▶"} View Previous Cycles' Pre-Chemotherapy Evaluation</Typography>
        <Typography sx={{ fontSize: 11, color: C.textMuted }}>{expanded ? "Click to collapse" : "Click to expand"}</Typography>
      </Button>
      {expanded && (
        <Box sx={{ border: `1px solid ${C.border}`, borderTop: "none", borderRadius: "0 0 4px 4px", overflowX: "auto", background: C.white }}>
          <Box component="table" sx={{ width: "100%", borderCollapse: "collapse", tableLayout: "fixed" }}>
            <Box component="thead">
              <Box component="tr" sx={{ background: C.bgSecondary }}>
                <Box component="th" sx={{ textAlign: "left", p: "8px 12px", fontSize: 10, textTransform: "uppercase", letterSpacing: "0.08em", fontWeight: 600, color: C.textMuted, borderBottom: `1px solid ${C.border}` }}>Cycle</Box>
                {PRE_CHEMO_HISTORY_COLUMNS.map(c => <Box key={c.field} component="th" sx={{ textAlign: "left", p: "8px 12px", fontSize: 10, textTransform: "uppercase", letterSpacing: "0.08em", fontWeight: 600, color: C.textMuted, borderBottom: `1px solid ${C.border}` }}>{c.label}</Box>)}
              </Box>
            </Box>
            <Box component="tbody">
              {rows.map((row, idx) => (
                <Box component="tr" key={`${row.cycleNum}-${idx}`}>
                  <Box component="td" sx={{ p: "8px 12px", fontSize: 12, borderBottom: `1px solid ${C.bgSecondary}`, fontWeight: FW_MEDIUM, color: C.black }}>{row.cycleNum}</Box>
                  {PRE_CHEMO_HISTORY_COLUMNS.map(c => <Box component="td" key={c.field} sx={{ p: "8px 12px", fontSize: 12, borderBottom: `1px solid ${C.bgSecondary}`, whiteSpace: "pre-wrap", wordWrap: "break-word", color: C.textPrimary }}>{row.data[c.field] || "—"}</Box>)}
                </Box>
              ))}
            </Box>
          </Box>
        </Box>
      )}
    </Box>
  );
};

const DRUG_PREP_HISTORY_COLUMNS = [
  { label: "Calc. BSA", field: "bsa" },
  { label: "Calc. Dose", field: "calcDose" },
  { label: "Pharmacy Verif.", field: "pharmacy" },
  { label: "Nurse Verif.", field: "nurse" },
  { label: "PPE", field: "ppe" },
  { label: "Labeling", field: "labeling" }
];

const DrugPrepHistoryTable = ({ dbCycles, completedCycles, globalHeight, globalWeight }) => {
  const [expanded, setExpanded] = useState(false);
  if (!completedCycles || completedCycles === 0 || !dbCycles) return null;

  const rows = [];
  Array.from({ length: completedCycles }, (_, i) => {
    const cycleNum = i + 1;
    const prep = dbCycles[String(cycleNum)]?.prep || {};
    const pre_chemo = dbCycles[String(cycleNum)]?.pre_chemo || {};
    let bsa = "—";
    const h = parseFloat(pre_chemo.height || globalHeight);
    const w = parseFloat(pre_chemo.weight || globalWeight);
    if (h && w) {
      bsa = (0.007184 * Math.pow(h, 0.725) * Math.pow(w, 0.425)).toFixed(2);
    }

    if (prep.pharmacyVerification || prep.nurseVerification || prep.labelingDetails) {
      rows.push({
        cycleNum,
        data: {
          bsa: bsa,
          calcDose: (prep.drugName && prep.dosePerSqm) ? `${prep.drugName} ${prep.dosePerSqm}` : "—",
          pharmacy: prep.pharmacyVerification ? "Yes" : "No",
          nurse: prep.nurseVerification ? "Yes" : "No",
          ppe: prep.prepPPE ? "Yes" : "No",
          labeling: prep.labelingDetails || "—"
        }
      });
    }
  });

  if (rows.length === 0) return null;

  return (
    <Box sx={{ mb: 3 }}>
      <Button
        fullWidth onClick={() => setExpanded(!expanded)}
        sx={{ justifyContent: "space-between", textTransform: "none", background: C.white, border: `1px solid ${C.border}`, borderRadius: expanded ? "4px 4px 0 0" : "4px", color: C.textSecond, px: 2, py: 1.5, "&:hover": { background: C.bgSecondary } }}
      >
        <Typography sx={{ fontSize: 13, fontWeight: FW_MEDIUM, color: C.textSecond }}>{expanded ? "▼" : "▶"} View Previous Cycles' Drug Preparation</Typography>
        <Typography sx={{ fontSize: 11, color: C.textMuted }}>{expanded ? "Click to collapse" : "Click to expand"}</Typography>
      </Button>
      {expanded && (
        <Box sx={{ border: `1px solid ${C.border}`, borderTop: "none", borderRadius: "0 0 4px 4px", overflowX: "auto", background: C.white }}>
          <Box component="table" sx={{ width: "100%", borderCollapse: "collapse", tableLayout: "fixed" }}>
            <Box component="thead">
              <Box component="tr" sx={{ background: C.bgSecondary }}>
                <Box component="th" sx={{ textAlign: "left", p: "8px 12px", fontSize: 10, textTransform: "uppercase", letterSpacing: "0.08em", fontWeight: 600, color: C.textMuted, borderBottom: `1px solid ${C.border}` }}>Cycle</Box>
                {DRUG_PREP_HISTORY_COLUMNS.map(c => <Box key={c.field} component="th" sx={{ textAlign: "left", p: "8px 12px", fontSize: 10, textTransform: "uppercase", letterSpacing: "0.08em", fontWeight: 600, color: C.textMuted, borderBottom: `1px solid ${C.border}` }}>{c.label}</Box>)}
              </Box>
            </Box>
            <Box component="tbody">
              {rows.map((row, idx) => (
                <Box component="tr" key={`${row.cycleNum}-${idx}`}>
                  <Box component="td" sx={{ p: "8px 12px", fontSize: 12, borderBottom: `1px solid ${C.bgSecondary}`, fontWeight: FW_MEDIUM, color: C.black }}>{row.cycleNum}</Box>
                  {DRUG_PREP_HISTORY_COLUMNS.map(c => <Box component="td" key={c.field} sx={{ p: "8px 12px", fontSize: 12, borderBottom: `1px solid ${C.bgSecondary}`, whiteSpace: "pre-wrap", wordWrap: "break-word", color: C.textPrimary }}>{row.data[c.field] || "—"}</Box>)}
                </Box>
              ))}
            </Box>
          </Box>
        </Box>
      )}
    </Box>
  );
};


const DOSE_MOD_HISTORY_COLUMNS = [
  { label: "Drug Name", field: "drugName" },
  { label: "Planned Dose", field: "dose" },
  { label: "Modified?", field: "doseModified" },
  { label: "Modified Dose", field: "modifiedDose" },
  { label: "Reasons", field: "reasons" },
];

const DoseModificationHistoryTable = ({ dbCycles, completedCycles }) => {
  const [expanded, setExpanded] = useState(false);
  if (!completedCycles || completedCycles === 0 || !dbCycles) return null;

  const rows = [];
  Array.from({ length: completedCycles }, (_, i) => {
    const cycleNum = i + 1;
    const cycleObj = dbCycles[String(cycleNum)] || {};
    const prep = cycleObj.prep || {};

    // Collect drug objects from prep.drugPreparations, prep.drugs, adminDrugs, or regimen drugs
    let prepDrugList = [];

    if (Array.isArray(prep.drugPreparations) && prep.drugPreparations.length > 0) {
      prepDrugList = prep.drugPreparations;
    } else if (Array.isArray(prep.drugs) && prep.drugs.length > 0) {
      prepDrugList = prep.drugs;
    } else if (prep.drugName) {
      prepDrugList = [{
        drugName: prep.drugName,
        dose: prep.dosePerSqm || prep.dose,
        whetherMod: prep.doseModified,
        modDose: prep.modifiedDose,
        modReasons: prep.modReasons
      }];
    }

    // Fallback: Resolve drugs from cycle_admin or regimen if prep list is empty
    if (prepDrugList.length === 0) {
      const fallbackDrugs = (cycleObj?.cycle_admin?.adminDrugs && cycleObj.cycle_admin.adminDrugs.length > 0)
        ? cycleObj.cycle_admin.adminDrugs
        : (cycleObj?.regimen?.drugs && cycleObj.regimen.drugs.length > 0)
            ? cycleObj.regimen.drugs
            : [];

      prepDrugList = fallbackDrugs.map(d => ({
        drugName: d.name || d.drugName,
        dose: d.dose || d.plannedDose || "—",
        whetherMod: d.whetherMod || d.doseModified || "no",
        modDose: d.modDose || d.modifiedDose || "—"
      }));
    }

    prepDrugList.forEach(item => {
      const name = item.drugName || item.name;
      if (!name) return;

      const reasonsObj = item.modReasons || prep.modReasons || {};
      const reasons = typeof reasonsObj === "object" 
        ? Object.keys(reasonsObj).filter(k => reasonsObj[k]).join(", ") 
        : (typeof reasonsObj === "string" ? reasonsObj : "");

      rows.push({
        cycleNum,
        data: {
          drugName: name,
          dose: item.dose || item.dosePerSqm || "—",
          doseModified: item.whetherMod || item.doseModified || "no",
          modifiedDose: item.modDose || item.modifiedDose || "—",
          reasons: reasons || "—"
        }
      });
    });
  });

  if (rows.length === 0) return null;

  return (
    <Box sx={{ mb: 3 }}>
      <Button
        fullWidth onClick={() => setExpanded(!expanded)}
        sx={{ justifyContent: "space-between", textTransform: "none", background: C.white, border: `1px solid ${C.border}`, borderRadius: expanded ? "4px 4px 0 0" : "4px", color: C.textSecond, px: 2, py: 1.5, "&:hover": { background: C.bgSecondary } }}
      >
        <Typography sx={{ fontSize: 13, fontWeight: FW_MEDIUM, color: C.textSecond }}>{expanded ? "▼" : "▶"} View Previous Cycles' Dose Modifications</Typography>
        <Typography sx={{ fontSize: 11, color: C.textMuted }}>{expanded ? "Click to collapse" : "Click to expand"}</Typography>
      </Button>
      {expanded && (
        <Box sx={{ border: `1px solid ${C.border}`, borderTop: "none", borderRadius: "0 0 4px 4px", overflowX: "auto", background: C.white }}>
          <Box component="table" sx={{ width: "100%", borderCollapse: "collapse", tableLayout: "fixed" }}>
            <Box component="thead">
              <Box component="tr" sx={{ background: C.bgSecondary }}>
                <Box component="th" sx={{ textAlign: "left", p: "8px 12px", fontSize: 10, textTransform: "uppercase", letterSpacing: "0.08em", fontWeight: 600, color: C.textMuted, borderBottom: `1px solid ${C.border}` }}>Cycle</Box>
                {DOSE_MOD_HISTORY_COLUMNS.map(c => <Box key={c.field} component="th" sx={{ textAlign: "left", p: "8px 12px", fontSize: 10, textTransform: "uppercase", letterSpacing: "0.08em", fontWeight: 600, color: C.textMuted, borderBottom: `1px solid ${C.border}` }}>{c.label}</Box>)}
              </Box>
            </Box>
            <Box component="tbody">
              {rows.map((row, idx) => (
                <Box component="tr" key={`${row.cycleNum}-${idx}`}>
                  <Box component="td" sx={{ p: "8px 12px", fontSize: 12, borderBottom: `1px solid ${C.bgSecondary}`, fontWeight: FW_MEDIUM, color: C.black }}>{row.cycleNum}</Box>
                  {DOSE_MOD_HISTORY_COLUMNS.map(c => <Box component="td" key={c.field} sx={{ p: "8px 12px", fontSize: 12, borderBottom: `1px solid ${C.bgSecondary}`, whiteSpace: "pre-wrap", wordWrap: "break-word", color: C.textPrimary }}>{row.data[c.field] || "—"}</Box>)}
                </Box>
              ))}
            </Box>
          </Box>
        </Box>
      )}
    </Box>
  );
};

const TREATMENT_DETAILS_HISTORY_COLUMNS = [
  { label: "Date", field: "date" },
  { label: "Place", field: "place" },
  { label: "Ward", field: "ward" },
  { label: "Route", field: "route" },
  { label: "Total Dose", field: "totalDose" },
  { label: "Safety", field: "safety" },
  { label: "Pre-Meds", field: "preMeds" }
];

const TreatmentDetailsHistoryTable = ({ dbCycles, completedCycles }) => {
  const [expanded, setExpanded] = useState(false);
  if (!completedCycles || completedCycles === 0 || !dbCycles) return null;

  const rows = [];
  Array.from({ length: completedCycles }, (_, i) => {
    const cycleNum = i + 1;
    const admin = dbCycles[String(cycleNum)]?.admin || {};
    const cycleAdmin = dbCycles[String(cycleNum)]?.cycle_admin || {};

    const placeObj = admin.placeOfTreatment || {};
    const places = Object.keys(placeObj).filter(k => placeObj[k]).join(", ");

    let safetyArr = [];
    if (admin.patientIdConfirmed) safetyArr.push("ID");
    if (admin.regimenConfirmed) safetyArr.push("Regimen");

    if (cycleAdmin.cycleDate1 || places || admin.adminRoute || admin.totalDose) {
      rows.push({
        cycleNum,
        data: {
          date: cycleAdmin.cycleDate1 || "—",
          place: places || "—",
          ward: admin.wardType || "—",
          route: admin.adminRoute || "—",
          totalDose: admin.totalDose || "—",
          safety: safetyArr.join(", ") || "—",
          preMeds: admin.preMedication || "—"
        }
      });
    }
  });

  if (rows.length === 0) return null;

  return (
    <Box sx={{ mb: 3 }}>
      <Button
        fullWidth onClick={() => setExpanded(!expanded)}
        sx={{ justifyContent: "space-between", textTransform: "none", background: C.white, border: `1px solid ${C.border}`, borderRadius: expanded ? "4px 4px 0 0" : "4px", color: C.textSecond, px: 2, py: 1.5, "&:hover": { background: C.bgSecondary } }}
      >
        <Typography sx={{ fontSize: 13, fontWeight: FW_MEDIUM, color: C.textSecond }}>{expanded ? "▼" : "▶"} View Previous Cycles' Treatment Details</Typography>
        <Typography sx={{ fontSize: 11, color: C.textMuted }}>{expanded ? "Click to collapse" : "Click to expand"}</Typography>
      </Button>
      {expanded && (
        <Box sx={{ border: `1px solid ${C.border}`, borderTop: "none", borderRadius: "0 0 4px 4px", overflowX: "auto", background: C.white }}>
          <Box component="table" sx={{ width: "100%", borderCollapse: "collapse", tableLayout: "fixed" }}>
            <Box component="thead">
              <Box component="tr" sx={{ background: C.bgSecondary }}>
                <Box component="th" sx={{ textAlign: "left", p: "8px 12px", fontSize: 10, textTransform: "uppercase", letterSpacing: "0.08em", fontWeight: 600, color: C.textMuted, borderBottom: `1px solid ${C.border}` }}>Cycle</Box>
                {TREATMENT_DETAILS_HISTORY_COLUMNS.map(c => <Box key={c.field} component="th" sx={{ textAlign: "left", p: "8px 12px", fontSize: 10, textTransform: "uppercase", letterSpacing: "0.08em", fontWeight: 600, color: C.textMuted, borderBottom: `1px solid ${C.border}` }}>{c.label}</Box>)}
              </Box>
            </Box>
            <Box component="tbody">
              {rows.map((row, idx) => (
                <Box component="tr" key={`${row.cycleNum}-${idx}`}>
                  <Box component="td" sx={{ p: "8px 12px", fontSize: 12, borderBottom: `1px solid ${C.bgSecondary}`, fontWeight: FW_MEDIUM, color: C.black }}>{row.cycleNum}</Box>
                  {TREATMENT_DETAILS_HISTORY_COLUMNS.map(c => <Box component="td" key={c.field} sx={{ p: "8px 12px", fontSize: 12, borderBottom: `1px solid ${C.bgSecondary}`, whiteSpace: "pre-wrap", wordWrap: "break-word", color: C.textPrimary }}>{row.data[c.field] || "—"}</Box>)}
                </Box>
              ))}
            </Box>
          </Box>
        </Box>
      )}
    </Box>
  );
};

const AssessmentHistoryTable = ({ dbCycles, completedCycles, globalHeight, globalWeight, globalGender, globalAge }) => {
  const [expanded, setExpanded] = useState(false);
  if (!completedCycles || completedCycles === 0 || !dbCycles) return null;

  const isFemale = globalGender?.trim().toLowerCase() === "female";
  const ageStr = String(globalAge || "").trim();
  const ageNum = parseInt(ageStr, 10);
  const isAgeValid = !ageStr || (!isNaN(ageNum) && ageNum >= 10 && ageNum <= 45);
  const showLmp = isFemale && isAgeValid;

  const columns = [
    { label: "Height (cm)", field: "height" },
    { label: "Weight (kg)", field: "weight" },
    { label: "BSA (m²)", field: "bsa" },
    { label: "BMI", field: "bmi" },
    { label: "Creatinine", field: "serumCreatinine" },
    { label: "CrCl/eGFR", field: "crcl" },
    { label: "ECOG", field: "ecog" }
  ];
  if (showLmp) {
    columns.push({ label: "LMP Date", field: "lmpDate" });
  }

  const rows = [];
  Array.from({ length: completedCycles }, (_, i) => {
    const cycleNum = i + 1;
    const pre_chemo = dbCycles[String(cycleNum)]?.pre_chemo || {};
    const assess = dbCycles[String(cycleNum)]?.assessment || {};
    const det = dbCycles[String(cycleNum)]?.details || {};

    const h = parseFloat(pre_chemo.height || globalHeight);
    const w = parseFloat(pre_chemo.weight || globalWeight);
    let bsa = "—";
    let bmi = "—";
    if (h && w) {
      bsa = (0.007184 * Math.pow(h, 0.725) * Math.pow(w, 0.425)).toFixed(2);
      bmi = (w / Math.pow(h / 100, 2)).toFixed(1);
    }

    const cr = parseFloat(assess.serumCreatinine);
    let crcl = "—";
    if (globalAge && w && cr && globalGender) {
      const a = parseFloat(globalAge);
      const sexFactor = String(globalGender || "").toLowerCase().startsWith("f") ? 0.85 : 1;
      crcl = (((140 - a) * w * sexFactor) / (72 * cr)).toFixed(1);
    }

    let ecogVal = assess.performanceStatus ? assess.performanceStatus.replace("ecog-", "") : "—";
    if (ecogVal !== "—") {
      ecogVal = ECOG_MAP[ecogVal] || ecogVal;
    }

    rows.push({
      cycleNum,
      data: {
        height: pre_chemo.height || globalHeight || "—",
        weight: pre_chemo.weight || globalWeight || "—",
        bsa,
        bmi,
        serumCreatinine: assess.serumCreatinine ? `${assess.serumCreatinine} mg/dL` : "—",
        crcl: crcl !== "—" ? `${crcl} mL/min` : "—",
        ecog: ecogVal,
        lmpDate: det.lmpDate || "—"
      }
    });
  });

  if (rows.length === 0) return null;

  return (
    <Box sx={{ mb: 3 }}>
      <Button
        fullWidth onClick={() => setExpanded(!expanded)}
        sx={{ justifyContent: "space-between", textTransform: "none", background: C.white, border: `1px solid ${C.border}`, borderRadius: expanded ? "4px 4px 0 0" : "4px", color: C.textSecond, px: 2, py: 1.5, "&:hover": { background: C.bgSecondary } }}
      >
        <Typography sx={{ fontSize: 13, fontWeight: FW_MEDIUM, color: C.textSecond }}>{expanded ? "▼" : "▶"} View Previous Cycles' Patient Assessment</Typography>
        <Typography sx={{ fontSize: 11, color: C.textMuted }}>{expanded ? "Click to collapse" : "Click to expand"}</Typography>
      </Button>
      {expanded && (
        <Box sx={{ border: `1px solid ${C.border}`, borderTop: "none", borderRadius: "0 0 4px 4px", overflowX: "auto", background: C.white }}>
          <Box component="table" sx={{ width: "100%", borderCollapse: "collapse" }}>
            <Box component="thead">
              <Box component="tr" sx={{ background: C.bgSecondary }}>
                <Box component="th" sx={{ textAlign: "left", p: "8px 12px", fontSize: 10, textTransform: "uppercase", letterSpacing: "0.08em", fontWeight: 600, color: C.textMuted, borderBottom: `1px solid ${C.border}` }}>Cycle</Box>
                {columns.map(c => <Box key={c.field} component="th" sx={{ textAlign: "left", p: "8px 12px", fontSize: 10, textTransform: "uppercase", letterSpacing: "0.08em", fontWeight: 600, color: C.textMuted, borderBottom: `1px solid ${C.border}` }}>{c.label}</Box>)}
              </Box>
            </Box>
            <Box component="tbody">
              {rows.map((row, idx) => (
                <Box component="tr" key={`${row.cycleNum}-${idx}`}>
                  <Box component="td" sx={{ p: "8px 12px", fontSize: 12, borderBottom: `1px solid ${C.bgSecondary}`, fontWeight: FW_MEDIUM, color: C.black }}>{row.cycleNum}</Box>
                  {columns.map(c => <Box component="td" key={c.field} sx={{ p: "8px 12px", fontSize: 12, borderBottom: `1px solid ${C.bgSecondary}`, whiteSpace: "pre-wrap", wordWrap: "break-word", color: C.textPrimary }}>{row.data[c.field] || "—"}</Box>)}
                </Box>
              ))}
            </Box>
          </Box>
        </Box>
      )}
    </Box>
  );
};

const AllergyHistoryTable = ({ dbCycles, completedCycles }) => {
  const [expanded, setExpanded] = useState(false);
  if (!completedCycles || completedCycles === 0 || !dbCycles) return null;

  const rows = [];
  Array.from({ length: completedCycles }, (_, i) => {
    const cycleNum = i + 1;
    const assess = dbCycles[String(cycleNum)]?.assessment;
    if (assess && assess.allergyStatus) {
      rows.push({
        cycleNum,
        data: {
          allergy: (assess.allergyStatus || "").toLowerCase() === "y" || (assess.allergyStatus || "").toLowerCase() === "yes" ? "Yes" : "No",
          drug: assess.allergyDrug || "—",
          type: assess.allergyType || "—",
          severity: assess.allergySeverity || "—",
          checked: assess.interactionCheckSource || "—"
        }
      });
    }
  });

  if (rows.length === 0) return null;

  return (
    <Box sx={{ mb: 3 }}>
      <Button
        fullWidth onClick={() => setExpanded(!expanded)}
        sx={{ justifyContent: "space-between", textTransform: "none", background: C.white, border: `1px solid ${C.border}`, borderRadius: expanded ? "4px 4px 0 0" : "4px", color: C.textSecond, px: 2, py: 1.5, "&:hover": { background: C.bgSecondary } }}
      >
        <Typography sx={{ fontSize: 13, fontWeight: FW_MEDIUM, color: C.textSecond }}>{expanded ? "▼" : "▶"} View Previous Cycles' Allergic Reactions</Typography>
        <Typography sx={{ fontSize: 11, color: C.textMuted }}>{expanded ? "Click to collapse" : "Click to expand"}</Typography>
      </Button>
      {expanded && (
        <Box sx={{ border: `1px solid ${C.border}`, borderTop: "none", borderRadius: "0 0 4px 4px", overflowX: "auto", background: C.white }}>
          <Box component="table" sx={{ width: "100%", borderCollapse: "collapse", tableLayout: "fixed" }}>
            <Box component="thead">
              <Box component="tr" sx={{ background: C.bgSecondary }}>
                <Box component="th" sx={{ textAlign: "left", p: "8px 12px", fontSize: 10, textTransform: "uppercase", letterSpacing: "0.08em", fontWeight: 600, color: C.textMuted, borderBottom: `1px solid ${C.border}`, width: "60px" }}>Cycle</Box>
                <Box component="th" sx={{ textAlign: "left", p: "8px 12px", fontSize: 10, textTransform: "uppercase", letterSpacing: "0.08em", fontWeight: 600, color: C.textMuted, borderBottom: `1px solid ${C.border}` }}>Allergy</Box>
                <Box component="th" sx={{ textAlign: "left", p: "8px 12px", fontSize: 10, textTransform: "uppercase", letterSpacing: "0.08em", fontWeight: 600, color: C.textMuted, borderBottom: `1px solid ${C.border}` }}>Drug Name</Box>
                <Box component="th" sx={{ textAlign: "left", p: "8px 12px", fontSize: 10, textTransform: "uppercase", letterSpacing: "0.08em", fontWeight: 600, color: C.textMuted, borderBottom: `1px solid ${C.border}` }}>Type</Box>
                <Box component="th" sx={{ textAlign: "left", p: "8px 12px", fontSize: 10, textTransform: "uppercase", letterSpacing: "0.08em", fontWeight: 600, color: C.textMuted, borderBottom: `1px solid ${C.border}` }}>Severity</Box>
                <Box component="th" sx={{ textAlign: "left", p: "8px 12px", fontSize: 10, textTransform: "uppercase", letterSpacing: "0.08em", fontWeight: 600, color: C.textMuted, borderBottom: `1px solid ${C.border}` }}>Interaction Checked</Box>
              </Box>
            </Box>
            <Box component="tbody">
              {rows.map((row, idx) => (
                <Box component="tr" key={`${row.cycleNum}-${idx}`}>
                  <Box component="td" sx={{ p: "8px 12px", fontSize: 12, borderBottom: `1px solid ${C.bgSecondary}`, fontWeight: FW_MEDIUM, color: C.black }}>{row.cycleNum}</Box>
                  <Box component="td" sx={{ p: "8px 12px", fontSize: 12, borderBottom: `1px solid ${C.bgSecondary}`, color: C.textPrimary }}>{row.data.allergy}</Box>
                  <Box component="td" sx={{ p: "8px 12px", fontSize: 12, borderBottom: `1px solid ${C.bgSecondary}`, color: C.textPrimary }}>{row.data.drug}</Box>
                  <Box component="td" sx={{ p: "8px 12px", fontSize: 12, borderBottom: `1px solid ${C.bgSecondary}`, color: C.textPrimary }}>{row.data.type}</Box>
                  <Box component="td" sx={{ p: "8px 12px", fontSize: 12, borderBottom: `1px solid ${C.bgSecondary}`, color: C.textPrimary }}>{row.data.severity}</Box>
                  <Box component="td" sx={{ p: "8px 12px", fontSize: 12, borderBottom: `1px solid ${C.bgSecondary}`, color: C.textPrimary }}>{row.data.checked}</Box>
                </Box>
              ))}
            </Box>
          </Box>
        </Box>
      )}
    </Box>
  );
};

const BaselineInvestigationsHistoryTable = ({ dbCycles, completedCycles }) => {
  const [expanded, setExpanded] = useState(false);
  if (!completedCycles || completedCycles === 0 || !dbCycles) return null;

  const rows = [];
  Array.from({ length: completedCycles }, (_, i) => {
    const cycleNum = i + 1;
    const assess = dbCycles[String(cycleNum)]?.assessment;
    if (assess && assess.baselineLabs) {
      try {
        const parsed = JSON.parse(assess.baselineLabs);
        if (Array.isArray(parsed)) {
          rows.push({
            cycleNum,
            tests: parsed
          });
        } else {
          rows.push({ cycleNum, tests: [{ testName: assess.baselineLabs, remarks: "", value: "" }] });
        }
      } catch (e) {
        rows.push({ cycleNum, tests: [{ testName: assess.baselineLabs, remarks: "", value: "" }] });
      }
    }
  });

  if (rows.length === 0) return null;

  return (
    <Box sx={{ mb: 3 }}>
      <Button
        fullWidth onClick={() => setExpanded(!expanded)}
        sx={{ justifyContent: "space-between", textTransform: "none", background: C.white, border: `1px solid ${C.border}`, borderRadius: expanded ? "4px 4px 0 0" : "4px", color: C.textSecond, px: 2, py: 1.5, "&:hover": { background: C.bgSecondary } }}
      >
        <Typography sx={{ fontSize: 13, fontWeight: FW_MEDIUM, color: C.textSecond }}>{expanded ? "▼" : "▶"} View Previous Cycles' Baseline Investigations</Typography>
        <Typography sx={{ fontSize: 11, color: C.textMuted }}>{expanded ? "Click to collapse" : "Click to expand"}</Typography>
      </Button>
      {expanded && (
        <Box sx={{ border: `1px solid ${C.border}`, borderTop: "none", borderRadius: "0 0 4px 4px", overflowX: "auto", background: C.white }}>
          <Box component="table" sx={{ width: "100%", borderCollapse: "collapse", tableLayout: "fixed" }}>
            <Box component="thead">
              <Box component="tr" sx={{ background: C.bgSecondary }}>
                <Box component="th" sx={{ textAlign: "left", p: "8px 12px", fontSize: 10, textTransform: "uppercase", letterSpacing: "0.08em", fontWeight: 600, color: C.textMuted, borderBottom: `1px solid ${C.border}`, borderRight: `1px solid ${C.border}`, width: "60px" }}>Cycle</Box>
                <Box component="th" sx={{ textAlign: "left", p: "8px 12px", fontSize: 10, textTransform: "uppercase", letterSpacing: "0.08em", fontWeight: 600, color: C.textMuted, borderBottom: `1px solid ${C.border}`, borderRight: `1px solid ${C.border}`, width: "35%" }}>Test Name</Box>
                <Box component="th" sx={{ textAlign: "left", p: "8px 12px", fontSize: 10, textTransform: "uppercase", letterSpacing: "0.08em", fontWeight: 600, color: C.textMuted, borderBottom: `1px solid ${C.border}`, borderRight: `1px solid ${C.border}`, width: "35%" }}>Remarks / Instructions</Box>
                <Box component="th" sx={{ textAlign: "left", p: "8px 12px", fontSize: 10, textTransform: "uppercase", letterSpacing: "0.08em", fontWeight: 600, color: C.textMuted, borderBottom: `1px solid ${C.border}`, width: "20%" }}>Result Value</Box>
              </Box>
            </Box>
            <Box component="tbody">
              {rows.map((row, idx) => (
                row.tests.map((test, tIdx) => (
                  <Box component="tr" key={`${row.cycleNum}-${tIdx}`}>
                    {tIdx === 0 && (
                      <Box component="td" rowSpan={row.tests.length} sx={{ p: "8px 12px", fontSize: 12, borderBottom: `1px solid ${C.border}`, borderRight: `1px solid ${C.border}`, fontWeight: FW_MEDIUM, color: C.black, verticalAlign: "top" }}>
                        {row.cycleNum}
                      </Box>
                    )}
                    <Box component="td" sx={{ p: "8px 12px", fontSize: 12, borderBottom: tIdx === row.tests.length - 1 ? `1px solid ${C.border}` : `1px solid ${C.bgSecondary}`, borderRight: `1px solid ${C.border}`, color: C.textPrimary, verticalAlign: "top" }}>{test.testName || "—"}</Box>
                    <Box component="td" sx={{ p: "8px 12px", fontSize: 12, borderBottom: tIdx === row.tests.length - 1 ? `1px solid ${C.border}` : `1px solid ${C.bgSecondary}`, borderRight: `1px solid ${C.border}`, color: C.textPrimary, verticalAlign: "top" }}>{test.remarks || "—"}</Box>
                    <Box component="td" sx={{ p: "8px 12px", fontSize: 12, borderBottom: tIdx === row.tests.length - 1 ? `1px solid ${C.border}` : `1px solid ${C.bgSecondary}`, color: C.textPrimary, verticalAlign: "top" }}>{test.value || "—"}</Box>
                  </Box>
                ))
              ))}
            </Box>
          </Box>
        </Box>
      )}
    </Box>
  );
};

const VitalsHistoryTable = ({ dbCycles, completedCycles }) => {
  const [expanded, setExpanded] = useState(false);
  if (!completedCycles || completedCycles === 0 || !dbCycles) return null;

  const rows = [];
  Array.from({ length: completedCycles }, (_, i) => {
    const cycleNum = i + 1;
    const admin = dbCycles[String(cycleNum)]?.admin || {};
    const vitals = admin.vitals || {};
    const legacyVitals = dbCycles[String(cycleNum)]?.pre_chemo?.vitals;

    let hasVitals = false;
    let pre = { phase: "Pre-Treatment", temp: "-", pulse: "-", bp: "-", rr: "-", spo2: "-", pain: "-" };
    let during = { phase: "During Treatment", temp: "-", pulse: "-", bp: "-", rr: "-", spo2: "-", pain: "-" };
    let post = { phase: "Post-Treatment", temp: "-", pulse: "-", bp: "-", rr: "-", spo2: "-", pain: "-" };

    if (vitals.tempPre || vitals.pulsePre || vitals.bpPre || vitals.rrPre || vitals.spo2Pre || vitals.painPre) {
      pre = { ...pre, temp: vitals.tempPre || "-", pulse: vitals.pulsePre || "-", bp: vitals.bpPre || "-", rr: vitals.rrPre || "-", spo2: vitals.spo2Pre || "-", pain: vitals.painPre || "-" };
      hasVitals = true;
    }
    if (vitals.tempDuring || vitals.pulseDuring || vitals.bpDuring || vitals.rrDuring || vitals.spo2During || vitals.painDuring) {
      during = { ...during, temp: vitals.tempDuring || "-", pulse: vitals.pulseDuring || "-", bp: vitals.bpDuring || "-", rr: vitals.rrDuring || "-", spo2: vitals.spo2During || "-", pain: vitals.painDuring || "-" };
      hasVitals = true;
    }
    if (vitals.tempPost || vitals.pulsePost || vitals.bpPost || vitals.rrPost || vitals.spo2Post || vitals.painPost) {
      post = { ...post, temp: vitals.tempPost || "-", pulse: vitals.pulsePost || "-", bp: vitals.bpPost || "-", rr: vitals.rrPost || "-", spo2: vitals.spo2Post || "-", pain: vitals.painPost || "-" };
      hasVitals = true;
    }

    if (!hasVitals && legacyVitals && typeof legacyVitals === 'string') {
      const tempMatch = legacyVitals.match(/Temperature:\s*([\d.]+)/i);
      const pulseMatch = legacyVitals.match(/(?:Heart rate|Pulse):\s*([\d]+)/i);
      const bpMatch = legacyVitals.match(/Blood pressure:\s*([\d/]+)/i);

      pre = {
        ...pre,
        temp: tempMatch ? tempMatch[1] : "-",
        pulse: pulseMatch ? pulseMatch[1] : "-",
        bp: bpMatch ? bpMatch[1] : "-"
      };
      hasVitals = true;
    }

    if (hasVitals) {
      rows.push({ cycleNum, pre, during, post });
    }
  });

  if (rows.length === 0) return null;

  const cellStyle = { p: "8px 12px", fontSize: 12, borderBottom: `1px solid ${C.bgSecondary}`, whiteSpace: "pre-wrap", wordWrap: "break-word", color: C.textPrimary };
  const thStyle = { textAlign: "left", p: "8px 12px", fontSize: 10, textTransform: "uppercase", letterSpacing: "0.08em", fontWeight: 600, color: C.textMuted, borderBottom: `1px solid ${C.border}` };

  return (
    <Box sx={{ mb: 3 }}>
      <Button
        fullWidth onClick={() => setExpanded(!expanded)}
        sx={{ justifyContent: "space-between", textTransform: "none", background: C.white, border: `1px solid ${C.border}`, borderRadius: expanded ? "4px 4px 0 0" : "4px", color: C.textSecond, px: 2, py: 1.5, "&:hover": { background: C.bgSecondary } }}
      >
        <Typography sx={{ fontSize: 13, fontWeight: FW_MEDIUM, color: C.textSecond }}>{expanded ? "▼" : "▶"} View Previous Cycles' Vitals</Typography>
        <Typography sx={{ fontSize: 11, color: C.textMuted }}>{expanded ? "Click to collapse" : "Click to expand"}</Typography>
      </Button>
      {expanded && (
        <Box sx={{ border: `1px solid ${C.border}`, borderTop: "none", borderRadius: "0 0 4px 4px", overflowX: "auto", background: C.white }}>
          <Box component="table" sx={{ width: "100%", borderCollapse: "collapse", minWidth: 600 }}>
            <Box component="thead">
              <Box component="tr" sx={{ background: C.bgSecondary }}>
                <Box component="th" sx={{ ...thStyle, borderRight: `1px solid ${C.border}` }}>Cycle</Box>
                <Box component="th" sx={{ ...thStyle, borderRight: `1px solid ${C.border}` }}>Phase</Box>
                <Box component="th" sx={thStyle}>Temp (°F)</Box>
                <Box component="th" sx={thStyle}>Pulse</Box>
                <Box component="th" sx={thStyle}>BP</Box>
                <Box component="th" sx={thStyle}>Resp Rate</Box>
                <Box component="th" sx={thStyle}>SpO2 (%)</Box>
                <Box component="th" sx={thStyle}>Pain Score</Box>
              </Box>
            </Box>
            <Box component="tbody">
              {rows.map((row) => (
                <React.Fragment key={row.cycleNum}>
                  <Box component="tr">
                    <Box component="td" rowSpan={3} sx={{ p: "8px 12px", fontSize: 12, borderBottom: `1px solid ${C.border}`, fontWeight: FW_MEDIUM, color: C.black, borderRight: `1px solid ${C.border}`, verticalAlign: "top" }}>{row.cycleNum}</Box>
                    <Box component="td" sx={{ ...cellStyle, borderRight: `1px solid ${C.border}` }}>{row.pre.phase}</Box>
                    <Box component="td" sx={cellStyle}>{row.pre.temp}</Box>
                    <Box component="td" sx={cellStyle}>{row.pre.pulse}</Box>
                    <Box component="td" sx={cellStyle}>{row.pre.bp}</Box>
                    <Box component="td" sx={cellStyle}>{row.pre.rr}</Box>
                    <Box component="td" sx={cellStyle}>{row.pre.spo2}</Box>
                    <Box component="td" sx={cellStyle}>{row.pre.pain}</Box>
                  </Box>
                  <Box component="tr">
                    <Box component="td" sx={{ ...cellStyle, borderRight: `1px solid ${C.border}` }}>{row.during.phase}</Box>
                    <Box component="td" sx={cellStyle}>{row.during.temp}</Box>
                    <Box component="td" sx={cellStyle}>{row.during.pulse}</Box>
                    <Box component="td" sx={cellStyle}>{row.during.bp}</Box>
                    <Box component="td" sx={cellStyle}>{row.during.rr}</Box>
                    <Box component="td" sx={cellStyle}>{row.during.spo2}</Box>
                    <Box component="td" sx={cellStyle}>{row.during.pain}</Box>
                  </Box>
                  <Box component="tr">
                    <Box component="td" sx={{ ...cellStyle, borderBottom: `1px solid ${C.border}`, borderRight: `1px solid ${C.border}` }}>{row.post.phase}</Box>
                    <Box component="td" sx={{ ...cellStyle, borderBottom: `1px solid ${C.border}` }}>{row.post.temp}</Box>
                    <Box component="td" sx={{ ...cellStyle, borderBottom: `1px solid ${C.border}` }}>{row.post.pulse}</Box>
                    <Box component="td" sx={{ ...cellStyle, borderBottom: `1px solid ${C.border}` }}>{row.post.bp}</Box>
                    <Box component="td" sx={{ ...cellStyle, borderBottom: `1px solid ${C.border}` }}>{row.post.rr}</Box>
                    <Box component="td" sx={{ ...cellStyle, borderBottom: `1px solid ${C.border}` }}>{row.post.spo2}</Box>
                    <Box component="td" sx={{ ...cellStyle, borderBottom: `1px solid ${C.border}` }}>{row.post.pain}</Box>
                  </Box>
                </React.Fragment>
              ))}
            </Box>
          </Box>
        </Box>
      )}
    </Box>
  );
};

const ADMIN_DRUG_HISTORY_COLUMNS = [
  { label: "Drug Name", field: "name" },
  { label: "Instructions", field: "instructions" },
  { label: "Dose", field: "dose" },
  { label: "Given", field: "given" },
  { label: "Start Time", field: "startTime" },
  { label: "End Time", field: "endTime" },
  { label: "Not Given Reason", field: "notGivenReason" },
  { label: "Infusion Rxn", field: "infusionReaction" },
];

const AdministeredDrugsHistoryTable = ({ dbCycles, completedCycles }) => {
  const [expanded, setExpanded] = useState(false);
  if (!completedCycles || completedCycles === 0 || !dbCycles) return null;

  const rows = [];
  Array.from({ length: completedCycles }, (_, i) => {
    const cycleNum = i + 1;
    const admin = dbCycles[String(cycleNum)]?.admin || {};
    let drugs = admin.adminDrugs || [];

    // Fallback for older cycles
    if (!drugs || drugs.length === 0) {
      if (admin.startTime || admin.endTime) {
        drugs = [{
          name: dbCycles[String(cycleNum)]?.prep?.drugName || "Primary Drug",
          dose: dbCycles[String(cycleNum)]?.prep?.dosePerSqm || "",
          given: "yes",
          startTime: admin.startTime || "-",
          endTime: admin.endTime || "-",
          infusionReaction: "-"
        }];
      }
    }
    drugs.forEach((drug, idx) => rows.push({ cycleNum, data: drug, idx }));
  });

  if (rows.length === 0) return null;

  return (
    <Box sx={{ mb: 3 }}>
      <Button
        fullWidth onClick={() => setExpanded(!expanded)}
        sx={{ justifyContent: "space-between", textTransform: "none", background: C.white, border: `1px solid ${C.border}`, borderRadius: expanded ? "4px 4px 0 0" : "4px", color: C.textSecond, px: 2, py: 1.5, "&:hover": { background: C.bgSecondary } }}
      >
        <Typography sx={{ fontSize: 13, fontWeight: FW_MEDIUM, color: C.textSecond }}>{expanded ? "▼" : "▶"} View Previous Cycles' Administered Drugs</Typography>
        <Typography sx={{ fontSize: 11, color: C.textMuted }}>{expanded ? "Click to collapse" : "Click to expand"}</Typography>
      </Button>
      {expanded && (
        <Box sx={{ border: `1px solid ${C.border}`, borderTop: "none", borderRadius: "0 0 4px 4px", overflowX: "auto", background: C.white }}>
          <Box component="table" sx={{ width: "100%", borderCollapse: "collapse", tableLayout: "fixed" }}>
            <Box component="thead">
              <Box component="tr" sx={{ background: C.bgSecondary }}>
                <Box component="th" sx={{ textAlign: "left", p: "8px 12px", fontSize: 10, textTransform: "uppercase", letterSpacing: "0.08em", fontWeight: 600, color: C.textMuted, borderBottom: `1px solid ${C.border}` }}>Cycle</Box>
                {ADMIN_DRUG_HISTORY_COLUMNS.map(c => <Box key={c.field} component="th" sx={{ textAlign: "left", p: "8px 12px", fontSize: 10, textTransform: "uppercase", letterSpacing: "0.08em", fontWeight: 600, color: C.textMuted, borderBottom: `1px solid ${C.border}` }}>{c.label}</Box>)}
              </Box>
            </Box>
            <Box component="tbody">
              {rows.map((row, idx) => (
                <Box component="tr" key={`${row.cycleNum}-${idx}`}>
                  <Box component="td" sx={{ p: "8px 12px", fontSize: 12, borderBottom: `1px solid ${C.bgSecondary}`, fontWeight: FW_MEDIUM, color: C.black }}>{row.cycleNum}</Box>
                  {ADMIN_DRUG_HISTORY_COLUMNS.map(c => <Box component="td" key={c.field} sx={{ p: "8px 12px", fontSize: 12, borderBottom: `1px solid ${C.bgSecondary}`, whiteSpace: "pre-wrap", wordWrap: "break-word", color: C.textPrimary }}>{row.data[c.field] || "—"}</Box>)}
                </Box>
              ))}
            </Box>
          </Box>
        </Box>
      )}
    </Box>
  );
};

const TOXICITY_HISTORY_COLUMNS = [
  { label: "Grading Sys", field: "gradingSystem" },
  { label: "System", field: "system" },
  { label: "Adverse Event", field: "event" },
  { label: "Onset Date", field: "onset" },
  { label: "Resolution Date", field: "resolutionDate" },
  { label: "Severity/Grade", field: "grade" },
  { label: "Management", field: "managementPlace" },
  { label: "Attribution", field: "attribution" },
];

const ToxicityHistoryTable = ({ dbCycles, completedCycles, currentPartD, currentCycle, forceExpanded }) => {
  const [expanded, setExpanded] = useState(forceExpanded || false);

  const rows = [];
  if (dbCycles && completedCycles > 0) {
    Array.from({ length: completedCycles }, (_, i) => {
      const cycleNum = i + 1;
      const post = dbCycles[String(cycleNum)]?.post_chemo || {};
      let toxicities = post.toxicities || [];

      if (!toxicities || toxicities.length === 0) {
        // Check for legacy adverseEvents string
        if (post.adverseEvents) {
          toxicities = [{
            event: "Legacy Record",
            description: post.adverseEvents,
            grade: "-",
            onset: "-",
            managementPlace: "-"
          }];
        }
      }

      toxicities.forEach((tox, idx) => {
        rows.push({ cycleNum, data: { ...tox }, idx });
      });
    });
  }

  if (currentPartD && currentPartD.toxicities && currentCycle) {
    currentPartD.toxicities.forEach((tox, idx) => {
      if (tox.event || tox.system) {
        rows.push({ cycleNum: `${currentCycle} (Current)`, data: { ...tox }, idx });
      }
    });
  }

  if (rows.length === 0) {
    if (forceExpanded) {
      return (
        <Box sx={{ p: 2, border: `1px solid ${C.border}`, background: C.bgSecondary, mb: 2 }}>
          <Typography sx={{ fontSize: 12.5, color: C.textMuted, fontFamily: FONT }}>
            No toxicities recorded across cycles.
          </Typography>
        </Box>
      );
    }
    return null;
  }

  return (
    <Box sx={{ mb: 3 }}>
      {!forceExpanded && (
        <Button
          fullWidth onClick={() => setExpanded(!expanded)}
          sx={{ justifyContent: "space-between", textTransform: "none", background: C.white, border: `1px solid ${C.border}`, borderRadius: expanded ? "4px 4px 0 0" : "4px", color: C.textSecond, px: 2, py: 1.5, "&:hover": { background: C.bgSecondary } }}
        >
          <Typography sx={{ fontSize: 13, fontWeight: FW_MEDIUM, color: C.textSecond }}>{expanded ? "▼" : "▶"} View Previous Cycles' Toxicities</Typography>
          <Typography sx={{ fontSize: 11, color: C.textMuted }}>{expanded ? "Click to collapse" : "Click to expand"}</Typography>
        </Button>
      )}
      {(expanded || forceExpanded) && (
        <Box sx={{ border: forceExpanded ? `1px solid ${C.black}` : `1px solid ${C.border}`, borderTop: forceExpanded ? `1px solid ${C.black}` : "none", borderRadius: forceExpanded ? 0 : "0 0 4px 4px", overflowX: "auto", background: C.white }}>
          <Box component="table" sx={{ width: "100%", borderCollapse: "collapse", tableLayout: "fixed" }}>
            <Box component="thead">
              <Box component="tr" sx={{ background: C.bgSecondary }}>
                <Box component="th" sx={{ textAlign: "left", p: "8px 12px", fontSize: 10, textTransform: "uppercase", letterSpacing: "0.08em", fontWeight: 600, color: C.textMuted, borderBottom: `1px solid ${C.border}` }}>Cycle</Box>
                {TOXICITY_HISTORY_COLUMNS.map(c => <Box key={c.field} component="th" sx={{ textAlign: "left", p: "8px 12px", fontSize: 10, textTransform: "uppercase", letterSpacing: "0.08em", fontWeight: 600, color: C.textMuted, borderBottom: `1px solid ${C.border}` }}>{c.label}</Box>)}
              </Box>
            </Box>
            <Box component="tbody">
              {rows.map((row, idx) => (
                <Box component="tr" key={`${row.cycleNum}-${idx}`}>
                  <Box component="td" sx={{ p: "8px 12px", fontSize: 12, borderBottom: `1px solid ${C.bgSecondary}`, fontWeight: FW_MEDIUM, color: C.black }}>{row.cycleNum}</Box>
                  {TOXICITY_HISTORY_COLUMNS.map(c => <Box component="td" key={c.field} sx={{ p: "8px 12px", fontSize: 12, borderBottom: `1px solid ${C.bgSecondary}`, whiteSpace: "pre-wrap", wordWrap: "break-word", color: C.textPrimary }}>{row.data[c.field] || "—"}</Box>)}
                </Box>
              ))}
            </Box>
          </Box>
        </Box>
      )}
    </Box>
  );
};

const POSTPONE_HISTORY_COLUMNS = [
  { label: "Postponed", field: "isPostponed" },
  { label: "From Date", field: "fromDate" },
  { label: "Until Date", field: "untilDate" },
  { label: "Days Blocked", field: "days" },
  { label: "Reason", field: "reason" },
];

const PostponeHistoryTable = ({ dbCycles, completedCycles }) => {
  const [expanded, setExpanded] = useState(false);

  const rows = [];
  if (dbCycles && completedCycles > 0) {
    Array.from({ length: completedCycles }, (_, i) => {
      const cycleNum = i + 1;
      const post = dbCycles[String(cycleNum)]?.post_chemo || {};

      if (post.postponeTreatment === "yes") {
        rows.push({
          cycleNum,
          data: {
            isPostponed: "Yes",
            fromDate: post.postponeFromDate || "—",
            untilDate: post.postponeUntilDate || "—",
            days: post.postponeDays || "—",
            reason: post.postponeReason || "—"
          }
        });
      }
    });
  }

  if (rows.length === 0) return null;

  return (
    <Box sx={{ mb: 3 }}>
      <Button
        fullWidth onClick={() => setExpanded(!expanded)}
        sx={{ justifyContent: "space-between", textTransform: "none", background: C.white, border: `1px solid ${C.border}`, borderRadius: expanded ? "4px 4px 0 0" : "4px", color: C.textSecond, px: 2, py: 1.5, "&:hover": { background: C.bgSecondary } }}
      >
        <Typography sx={{ fontSize: 13, fontWeight: FW_MEDIUM, color: C.textSecond }}>{expanded ? "▼" : "▶"} View Previous Cycles' Postpone Details</Typography>
        <Typography sx={{ fontSize: 11, color: C.textMuted }}>{expanded ? "Click to collapse" : "Click to expand"}</Typography>
      </Button>
      {expanded && (
        <Box sx={{ border: `1px solid ${C.border}`, borderTop: "none", borderRadius: "0 0 4px 4px", overflowX: "auto", background: C.white }}>
          <Box component="table" sx={{ width: "100%", borderCollapse: "collapse", tableLayout: "fixed" }}>
            <Box component="thead">
              <Box component="tr" sx={{ background: C.bgSecondary }}>
                <Box component="th" sx={{ textAlign: "left", p: "8px 12px", fontSize: 10, textTransform: "uppercase", letterSpacing: "0.08em", fontWeight: 600, color: C.textMuted, borderBottom: `1px solid ${C.border}`, width: 60 }}>Cycle</Box>
                {POSTPONE_HISTORY_COLUMNS.map(c => <Box key={c.field} component="th" sx={{ textAlign: "left", p: "8px 12px", fontSize: 10, textTransform: "uppercase", letterSpacing: "0.08em", fontWeight: 600, color: C.textMuted, borderBottom: `1px solid ${C.border}` }}>{c.label}</Box>)}
              </Box>
            </Box>
            <Box component="tbody">
              {rows.map((row, idx) => (
                <Box component="tr" key={`${row.cycleNum}-${idx}`}>
                  <Box component="td" sx={{ p: "8px 12px", fontSize: 12, borderBottom: `1px solid ${C.bgSecondary}`, fontWeight: FW_MEDIUM, color: C.black }}>{row.cycleNum}</Box>
                  {POSTPONE_HISTORY_COLUMNS.map(c => <Box component="td" key={c.field} sx={{ p: "8px 12px", fontSize: 12, borderBottom: `1px solid ${C.bgSecondary}`, whiteSpace: "pre-wrap", wordWrap: "break-word", color: C.textPrimary }}>{row.data[c.field] || "—"}</Box>)}
                </Box>
              ))}
            </Box>
          </Box>
        </Box>
      )}
    </Box>
  );
};

const COMPLETION_STATUS_HISTORY_COLUMNS = [
  { label: "Status", field: "status" },
  { label: "Doctor Notes", field: "notes" }
];

const POST_CHEMO_HISTORY_COLUMNS = [
  { label: "Monitoring", field: "monitoringPeriod" },
  { label: "Nadir Labs", field: "nadirLabs" },
  { label: "Side Effect Mgt", field: "sideEffectMgt" },
  { label: "Response Criteria", field: "responseCriteria" },
  { label: "Tumor Board", field: "tumorBoardReviewDetails" }
];

const PostChemoHistoryTable = ({ completedCycles, dbCycles }) => {
  const [expanded, setExpanded] = useState(false);
  if (!completedCycles) return null;

  const rows = [];
  Array.from({ length: completedCycles }, (_, i) => {
    const cycleNum = i + 1;
    const post = dbCycles[String(cycleNum)]?.post_chemo || {};
    const response = dbCycles[String(cycleNum)]?.response || {};

    if (post.monitoringPeriod || post.nadirLabs || post.sideEffectMgt || response.responseCriteria || response.tumorBoardReviewDetails) {
      rows.push({
        cycleNum,
        data: {
          monitoringPeriod: post.monitoringPeriod || "—",
          nadirLabs: post.nadirLabs || "—",
          sideEffectMgt: post.sideEffectMgt || "—",
          responseCriteria: response.responseCriteria || "—",
          tumorBoardReviewDetails: response.tumorBoardReviewDetails || "—"
        }
      });
    }
  });

  if (rows.length === 0) return null;

  return (
    <Box sx={{ mb: 3 }}>
      <Button
        fullWidth onClick={() => setExpanded(!expanded)}
        sx={{ justifyContent: "space-between", textTransform: "none", background: C.white, border: `1px solid ${C.border}`, borderRadius: expanded ? "4px 4px 0 0" : "4px", color: C.textSecond, px: 2, py: 1.5, "&:hover": { background: C.bgSecondary } }}
      >
        <Typography sx={{ fontSize: 13, fontWeight: FW_MEDIUM, color: C.textSecond }}>{expanded ? "▼" : "▶"} View Previous Cycles' Post-Chemo & Response</Typography>
        <Typography sx={{ fontSize: 11, color: C.textMuted }}>{expanded ? "Click to collapse" : "Click to expand"}</Typography>
      </Button>
      {expanded && (
        <Box sx={{ border: `1px solid ${C.border}`, borderTop: "none", borderRadius: "0 0 4px 4px", overflowX: "auto", background: C.white }}>
          <Box component="table" sx={{ width: "100%", borderCollapse: "collapse", tableLayout: "fixed" }}>
            <Box component="thead">
              <Box component="tr" sx={{ background: C.bgSecondary }}>
                <Box component="th" sx={{ textAlign: "left", p: "8px 12px", fontSize: 10, textTransform: "uppercase", letterSpacing: "0.08em", fontWeight: 600, color: C.textMuted, borderBottom: `1px solid ${C.border}` }}>Cycle</Box>
                {POST_CHEMO_HISTORY_COLUMNS.map(c => <Box key={c.field} component="th" sx={{ textAlign: "left", p: "8px 12px", fontSize: 10, textTransform: "uppercase", letterSpacing: "0.08em", fontWeight: 600, color: C.textMuted, borderBottom: `1px solid ${C.border}` }}>{c.label}</Box>)}
              </Box>
            </Box>
            <Box component="tbody">
              {rows.map(row => (
                <Box component="tr" key={row.cycleNum}>
                  <Box component="td" sx={{ p: "8px 12px", fontSize: 12, borderBottom: `1px solid ${C.bgSecondary}`, fontWeight: FW_MEDIUM, color: C.black }}>{row.cycleNum}</Box>
                  {POST_CHEMO_HISTORY_COLUMNS.map(c => <Box component="td" key={c.field} sx={{ p: "8px 12px", fontSize: 12, borderBottom: `1px solid ${C.bgSecondary}`, color: C.textPrimary }}>{row.data[c.field]}</Box>)}
                </Box>
              ))}
            </Box>
          </Box>
        </Box>
      )}
    </Box>
  );
};

const formatMonitorCell = (checked, ...details) => {
  if (!checked) return "—";
  const text = details.filter(Boolean).join(" | ");
  return text ? `Yes — ${text}` : "Yes";
};

const ORGAN_SPECIFIC_HISTORY_COLUMNS = [
  { label: "Cardiac", field: "cardiac" },
  { label: "Pulmonary", field: "pulmonary" },
  { label: "Neurological", field: "neuro" },
  { label: "Audiology", field: "audio" }
];

const OrganSpecificMonitoringHistoryTable = ({ dbCycles, completedCycles, currentPartD, currentCycle }) => {
  const [expanded, setExpanded] = useState(true);
  const cycleCount = Math.max(completedCycles || 0, currentCycle || 0, 1);
  const cycles = dbCycles || {};
  const activeCycle = parseInt(currentCycle, 10) || null;

  const rows = Array.from({ length: cycleCount }, (_, i) => {
    const cycleNum = i + 1;
    const post = cycles[String(cycleNum)]?.post_chemo || {};
    // Only overlay live form values onto the cycle currently being edited
    const src = (activeCycle && cycleNum === activeCycle && currentPartD)
      ? { ...post, ...currentPartD }
      : post;
    return {
      cycleNum,
      data: {
        cardiac: formatMonitorCell(src.organCardiac, src.echoDetails, src.lvef ? `LVEF ${src.lvef}%` : ""),
        pulmonary: formatMonitorCell(src.organPulmonary, src.pulmonaryTests),
        neuro: formatMonitorCell(src.organNeuro, src.neuroAssessment),
        audio: formatMonitorCell(src.organAudio, src.audioTests)
      }
    };
  });

  return (
    <Box sx={{ mb: 3 }}>
      <Button
        fullWidth onClick={() => setExpanded(!expanded)}
        sx={{ justifyContent: "space-between", textTransform: "none", background: C.white, border: `1px solid ${C.border}`, borderRadius: expanded ? "4px 4px 0 0" : "4px", color: C.textSecond, px: 2, py: 1.5, "&:hover": { background: C.bgSecondary } }}
      >
        <Typography sx={{ fontSize: 13, fontWeight: FW_MEDIUM, color: C.textSecond }}>{expanded ? "▼" : "▶"} View Previous Cycles' Organ-Specific Monitoring</Typography>
        <Typography sx={{ fontSize: 11, color: C.textMuted }}>{expanded ? "Click to collapse" : "Click to expand"}</Typography>
      </Button>
      {expanded && (
        <Box sx={{ border: `1px solid ${C.border}`, borderTop: "none", borderRadius: "0 0 4px 4px", overflowX: "auto", background: C.white }}>
          <Box component="table" sx={{ width: "100%", borderCollapse: "collapse", tableLayout: "fixed" }}>
            <Box component="thead">
              <Box component="tr" sx={{ background: C.bgSecondary }}>
                <Box component="th" sx={{ textAlign: "left", p: "8px 12px", fontSize: 10, textTransform: "uppercase", letterSpacing: "0.08em", fontWeight: 600, color: C.textMuted, borderBottom: `1px solid ${C.border}` }}>Cycle</Box>
                {ORGAN_SPECIFIC_HISTORY_COLUMNS.map(c => <Box key={c.field} component="th" sx={{ textAlign: "left", p: "8px 12px", fontSize: 10, textTransform: "uppercase", letterSpacing: "0.08em", fontWeight: 600, color: C.textMuted, borderBottom: `1px solid ${C.border}` }}>{c.label}</Box>)}
              </Box>
            </Box>
            <Box component="tbody">
              {rows.map((row, idx) => (
                <Box component="tr" key={`${row.cycleNum}-${idx}`}>
                  <Box component="td" sx={{ p: "8px 12px", fontSize: 12, borderBottom: `1px solid ${C.bgSecondary}`, fontWeight: FW_MEDIUM, color: C.black }}>{row.cycleNum}</Box>
                  {ORGAN_SPECIFIC_HISTORY_COLUMNS.map(c => <Box component="td" key={c.field} sx={{ p: "8px 12px", fontSize: 12, borderBottom: `1px solid ${C.bgSecondary}`, whiteSpace: "pre-wrap", wordWrap: "break-word", color: C.textPrimary }}>{row.data[c.field] || "—"}</Box>)}
                </Box>
              ))}
            </Box>
          </Box>
        </Box>
      )}
    </Box>
  );
};

const TREATMENT_SPECIFIC_HISTORY_COLUMNS = [
  { label: "Urine Protein", field: "urineProtein" },
  { label: "Thyroid Function", field: "thyroid" },
  { label: "Blood Glucose", field: "glucose" },
  { label: "ECG/QTc", field: "ecg" }
];

const TreatmentSpecificParametersHistoryTable = ({ dbCycles, completedCycles, currentPartD, currentCycle }) => {
  const [expanded, setExpanded] = useState(true);
  const cycleCount = Math.max(completedCycles || 0, currentCycle || 0, 1);
  const cycles = dbCycles || {};
  const activeCycle = parseInt(currentCycle, 10) || null;

  const rows = Array.from({ length: cycleCount }, (_, i) => {
    const cycleNum = i + 1;
    const post = cycles[String(cycleNum)]?.post_chemo || {};
    // Only overlay live form values onto the cycle currently being edited
    const src = (activeCycle && cycleNum === activeCycle && currentPartD)
      ? { ...post, ...currentPartD }
      : post;
    return {
      cycleNum,
      data: {
        urineProtein: formatMonitorCell(src.trtUrineProtein, src.urineProteinDetails),
        thyroid: formatMonitorCell(src.trtThyroid, src.thyroidDetails),
        glucose: formatMonitorCell(src.trtGlucose, src.glucoseDetails),
        ecg: formatMonitorCell(src.trtEcg, src.ecgDetails)
      }
    };
  });

  return (
    <Box sx={{ mb: 3 }}>
      <Button
        fullWidth onClick={() => setExpanded(!expanded)}
        sx={{ justifyContent: "space-between", textTransform: "none", background: C.white, border: `1px solid ${C.border}`, borderRadius: expanded ? "4px 4px 0 0" : "4px", color: C.textSecond, px: 2, py: 1.5, "&:hover": { background: C.bgSecondary } }}
      >
        <Typography sx={{ fontSize: 13, fontWeight: FW_MEDIUM, color: C.textSecond }}>{expanded ? "▼" : "▶"} View Previous Cycles' Treatment-Specific Parameters</Typography>
        <Typography sx={{ fontSize: 11, color: C.textMuted }}>{expanded ? "Click to collapse" : "Click to expand"}</Typography>
      </Button>
      {expanded && (
        <Box sx={{ border: `1px solid ${C.border}`, borderTop: "none", borderRadius: "0 0 4px 4px", overflowX: "auto", background: C.white }}>
          <Box component="table" sx={{ width: "100%", borderCollapse: "collapse", tableLayout: "fixed" }}>
            <Box component="thead">
              <Box component="tr" sx={{ background: C.bgSecondary }}>
                <Box component="th" sx={{ textAlign: "left", p: "8px 12px", fontSize: 10, textTransform: "uppercase", letterSpacing: "0.08em", fontWeight: 600, color: C.textMuted, borderBottom: `1px solid ${C.border}` }}>Cycle</Box>
                {TREATMENT_SPECIFIC_HISTORY_COLUMNS.map(c => <Box key={c.field} component="th" sx={{ textAlign: "left", p: "8px 12px", fontSize: 10, textTransform: "uppercase", letterSpacing: "0.08em", fontWeight: 600, color: C.textMuted, borderBottom: `1px solid ${C.border}` }}>{c.label}</Box>)}
              </Box>
            </Box>
            <Box component="tbody">
              {rows.map((row, idx) => (
                <Box component="tr" key={`${row.cycleNum}-${idx}`}>
                  <Box component="td" sx={{ p: "8px 12px", fontSize: 12, borderBottom: `1px solid ${C.bgSecondary}`, fontWeight: FW_MEDIUM, color: C.black }}>{row.cycleNum}</Box>
                  {TREATMENT_SPECIFIC_HISTORY_COLUMNS.map(c => <Box component="td" key={c.field} sx={{ p: "8px 12px", fontSize: 12, borderBottom: `1px solid ${C.bgSecondary}`, whiteSpace: "pre-wrap", wordWrap: "break-word", color: C.textPrimary }}>{row.data[c.field] || "—"}</Box>)}
                </Box>
              ))}
            </Box>
          </Box>
        </Box>
      )}
    </Box>
  );
};

const CompletionStatusHistoryTable = ({ dbCycles, completedCycles }) => {
  const [expanded, setExpanded] = useState(false);
  if (!completedCycles || completedCycles === 0 || !dbCycles) return null;

  const rows = [];
  Array.from({ length: completedCycles }, (_, i) => {
    const cycleNum = i + 1;
    const cycleAdmin = dbCycles[String(cycleNum)]?.cycle_admin || {};

    if (cycleAdmin.cycleCompleted || cycleAdmin.remarks || cycleAdmin.notCompletedReason) {
      rows.push({
        cycleNum,
        data: {
          status: cycleAdmin.cycleCompleted === "completed"
            ? "Completed as planned"
            : (cycleAdmin.cycleCompleted === "not-completed"
              ? `Not completed${cycleAdmin.notCompletedReason ? ` — ${cycleAdmin.notCompletedReason}` : ""}`
              : "—"),
          notes: cycleAdmin.remarks || "—"
        }
      });
    }
  });

  if (rows.length === 0) return null;

  return (
    <Box sx={{ mb: 3 }}>
      <Button
        fullWidth onClick={() => setExpanded(!expanded)}
        sx={{ justifyContent: "space-between", textTransform: "none", background: C.white, border: `1px solid ${C.border}`, borderRadius: expanded ? "4px 4px 0 0" : "4px", color: C.textSecond, px: 2, py: 1.5, "&:hover": { background: C.bgSecondary } }}
      >
        <Typography sx={{ fontSize: 13, fontWeight: FW_MEDIUM, color: C.textSecond }}>{expanded ? "▼" : "▶"} View Previous Cycles' Completion Status</Typography>
        <Typography sx={{ fontSize: 11, color: C.textMuted }}>{expanded ? "Click to collapse" : "Click to expand"}</Typography>
      </Button>
      {expanded && (
        <Box sx={{ border: `1px solid ${C.border}`, borderTop: "none", borderRadius: "0 0 4px 4px", overflowX: "auto", background: C.white }}>
          <Box component="table" sx={{ width: "100%", borderCollapse: "collapse", tableLayout: "fixed" }}>
            <Box component="thead">
              <Box component="tr" sx={{ background: C.bgSecondary }}>
                <Box component="th" sx={{ textAlign: "left", p: "8px 12px", fontSize: 10, textTransform: "uppercase", letterSpacing: "0.08em", fontWeight: 600, color: C.textMuted, borderBottom: `1px solid ${C.border}` }}>Cycle</Box>
                {COMPLETION_STATUS_HISTORY_COLUMNS.map(c => <Box key={c.field} component="th" sx={{ textAlign: "left", p: "8px 12px", fontSize: 10, textTransform: "uppercase", letterSpacing: "0.08em", fontWeight: 600, color: C.textMuted, borderBottom: `1px solid ${C.border}` }}>{c.label}</Box>)}
              </Box>
            </Box>
            <Box component="tbody">
              {rows.map((row, idx) => (
                <Box component="tr" key={`${row.cycleNum}-${idx}`}>
                  <Box component="td" sx={{ p: "8px 12px", fontSize: 12, borderBottom: `1px solid ${C.bgSecondary}`, fontWeight: FW_MEDIUM, color: C.black }}>{row.cycleNum}</Box>
                  {COMPLETION_STATUS_HISTORY_COLUMNS.map(c => <Box component="td" key={c.field} sx={{ p: "8px 12px", fontSize: 12, borderBottom: `1px solid ${C.bgSecondary}`, whiteSpace: "pre-wrap", wordWrap: "break-word", color: C.textPrimary }}>{row.data[c.field] || "—"}</Box>)}
                </Box>
              ))}
            </Box>
          </Box>
        </Box>
      )}
    </Box>
  );
};



const DISCHARGE_HISTORY_COLUMNS = [
  { label: "Tolerated Well", field: "tolerated" },
  { label: "Symptoms to Watch", field: "symptoms" },
  { label: "Discharge Meds", field: "meds" },
  { label: "Follow-up Clinic", field: "followUpDoc" },
  { label: "Follow-up Delivery", field: "followUpDaycare" },
  { label: "Emergency Contact", field: "emergencyContact" }
];

const DischargeHistoryTable = ({ dbCycles, completedCycles }) => {
  const [expanded, setExpanded] = useState(false);
  if (!completedCycles || completedCycles === 0 || !dbCycles) return null;

  const rows = [];
  if (completedCycles > 0) {
    const cycleNum = completedCycles;
    const comp = dbCycles[String(cycleNum)]?.completion || {};
    const det = dbCycles[String(cycleNum)]?.details || {};

    const meds = (comp.dischargeDrugs || []).map(d => `${d.name || ""} ${d.dosage || ""} ${d.days ? "(" + d.days + " days)" : ""}`).filter(s => s.trim().length > 2).join(", ");

    const symptomsObj = comp.watchSymptoms || {};
    const symptoms = Object.keys(symptomsObj).filter(k => symptomsObj[k]).join(", ");

    if (comp.toleratedWell || symptoms || meds || comp.followUpSchedule || comp.followUpDaycare || det.emergencyContact) {
      rows.push({
        cycleNum,
        data: {
          tolerated: comp.toleratedWell || "—",
          symptoms: symptoms || "—",
          meds: meds || "—",
          followUpDoc: comp.followUpSchedule || "—",
          followUpDaycare: comp.followUpDaycare || "—",
          emergencyContact: det.emergencyContact || "—"
        }
      });
    }
  }

  if (rows.length === 0) return null;

  return (
    <Box sx={{ mb: 3 }}>
      <Button
        fullWidth onClick={() => setExpanded(!expanded)}
        sx={{ justifyContent: "space-between", textTransform: "none", background: C.white, border: `1px solid ${C.border}`, borderRadius: expanded ? "4px 4px 0 0" : "4px", color: C.textSecond, px: 2, py: 1.5, "&:hover": { background: C.bgSecondary } }}
      >
        <Typography sx={{ fontSize: 13, fontWeight: FW_MEDIUM, color: C.textSecond }}>{expanded ? "▼" : "▶"} View Last Cycle's Discharge Details</Typography>
        <Typography sx={{ fontSize: 11, color: C.textMuted }}>{expanded ? "Click to collapse" : "Click to expand"}</Typography>
      </Button>
      {expanded && (
        <Box sx={{ border: `1px solid ${C.border}`, borderTop: "none", borderRadius: "0 0 4px 4px", overflowX: "auto", background: C.white }}>
          <Box component="table" sx={{ width: "100%", borderCollapse: "collapse", tableLayout: "fixed" }}>
            <Box component="thead">
              <Box component="tr" sx={{ background: C.bgSecondary }}>
                <Box component="th" sx={{ textAlign: "left", p: "8px 12px", fontSize: 10, textTransform: "uppercase", letterSpacing: "0.08em", fontWeight: 600, color: C.textMuted, borderBottom: `1px solid ${C.border}` }}>Cycle</Box>
                {DISCHARGE_HISTORY_COLUMNS.map(c => <Box key={c.field} component="th" sx={{ textAlign: "left", p: "8px 12px", fontSize: 10, textTransform: "uppercase", letterSpacing: "0.08em", fontWeight: 600, color: C.textMuted, borderBottom: `1px solid ${C.border}` }}>{c.label}</Box>)}
              </Box>
            </Box>
            <Box component="tbody">
              {rows.map((row, idx) => (
                <Box component="tr" key={`${row.cycleNum}-${idx}`}>
                  <Box component="td" sx={{ p: "8px 12px", fontSize: 12, borderBottom: `1px solid ${C.bgSecondary}`, fontWeight: FW_MEDIUM, color: C.black }}>{row.cycleNum}</Box>
                  {DISCHARGE_HISTORY_COLUMNS.map(c => <Box component="td" key={c.field} sx={{ p: "8px 12px", fontSize: 12, borderBottom: `1px solid ${C.bgSecondary}`, whiteSpace: "pre-wrap", wordWrap: "break-word", color: C.textPrimary }}>{row.data[c.field] || "—"}</Box>)}
                </Box>
              ))}
            </Box>
          </Box>
        </Box>
      )}
    </Box>
  );
};

// ─── CLEARANCE SUMMARY HELPERS ───────────────────────────────────────────────────────────────

// Minimal black-and-white status tokens.
const ClearanceRow = ({ label, value, cycleData, level = "normal", note = "" }) => {
  const isMulti = cycleData && Array.isArray(cycleData) && cycleData.length > 0;

  if (isMulti) {
    return (
      <Box component="tr" sx={{ borderBottom: `1px solid ${C.bgSecondary}` }}>
        <Box component="td" sx={{
          width: "20%", minWidth: 190, p: "9px 12px", fontSize: 12.5,
          background: C.bgSecondary, color: C.textSecond,
          fontWeight: FW_MEDIUM, verticalAlign: "top",
          borderRight: `1px solid ${C.border}`
        }}>
          {label}
        </Box>
        {cycleData.map((d, idx) => {
          const isMissing = d.value === null || d.value === "" || d.value === undefined;
          const valueWeight = (d.level === "red" || d.level === "amber") ? FW_MEDIUM : FW_NORMAL;
          return (
            <Box component="td" key={idx} sx={{
              p: "9px 12px", fontSize: 12.5,
              color: isMissing ? C.textMuted : C.textPrimary,
              fontWeight: valueWeight,
              verticalAlign: "top",
              borderRight: idx < cycleData.length - 1 ? `1px solid ${C.bgSecondary}` : 'none'
            }}>
              {isMissing ? "Not recorded" : d.value}
              {d.note && <Typography component="span" sx={{ fontSize: 11, color: C.textMuted, ml: 1, display: "block" }}>({d.note})</Typography>}
            </Box>
          );
        })}
      </Box>
    );
  }

  // Fallback for single value
  const isMissing = value === null || value === "" || value === undefined;
  const valueWeight = (level === "red" || level === "amber") ? FW_MEDIUM : FW_NORMAL;
  return (
    <Box component="tr" sx={{ borderBottom: `1px solid ${C.bgSecondary}` }}>
      <Box component="td" sx={{
        width: "20%", minWidth: 190, p: "9px 12px", fontSize: 12.5,
        background: C.bgSecondary, color: C.textSecond,
        fontWeight: FW_MEDIUM, verticalAlign: "top",
        borderRight: `1px solid ${C.border}`
      }}>
        {label}
      </Box>
      <Box component="td" colSpan={100} sx={{
        p: "9px 12px", fontSize: 12.5,
        color: isMissing ? C.textMuted : C.textPrimary,
        fontWeight: valueWeight,
        verticalAlign: "top"
      }}>
        {isMissing ? "Not recorded" : value}
        {note && <Typography component="span" sx={{ fontSize: 11, color: C.textMuted, ml: 1 }}>({note})</Typography>}
      </Box>
    </Box>
  );
};

// A full-width section divider row inside the clearance table.
const ClearanceSubHeader = ({ title, colSpan = 2 }) => (
  <Box component="tr">
    <Box component="td" colSpan={colSpan} sx={{
      p: "6px 12px",
      background: C.bgTertiary,
      fontSize: 10,
      fontWeight: 600,
      textTransform: "uppercase",
      letterSpacing: "0.12em",
      color: C.textMuted,
      borderBottom: `1px solid ${C.border}`,
      borderTop: `1px solid ${C.border}`,
    }}>
      {title}
    </Box>
  </Box>
);

// ─── Lifetime dose limits for cumulative-dose flagging (Section G) ────────────────────────────
const LIFETIME_LIMITS = {
  "doxorubicin": { limit: 550, unit: "mg/m²", note: "Cardiotoxicity risk above 550 mg/m²" },
  "epirubicin": { limit: 900, unit: "mg/m²", note: "Cardiotoxicity risk above 900 mg/m²" },
  "bleomycin": { limit: 400, unit: "units", note: "Pulmonary toxicity above 400 units" },
  "oxaliplatin": { limit: 850, unit: "mg/m²", note: "Cumulative neuropathy risk" },
  "cisplatin": { limit: 300, unit: "mg/m²", note: "Nephrotoxicity/ototoxicity risk" },
  "carboplatin": { limit: null, unit: "", note: "Track AUC-based cumulative dosing" },
};

// ECOG labels for human-readable display
const ECOG_MAP = {
  "0": "Fully active (ECOG 0)",
  "1": "Mild restriction (ECOG 1)",
  "2": "Ambulatory, unable to work (ECOG 2)",
  "3": "Limited self-care (ECOG 3)",
  "4": "Bedbound (ECOG 4)",
};

const COMMON_ADVERSE_EVENTS = [
  "Nausea", "Vomiting", "Diarrhea", "Constipation", "Fatigue",
  "Neutropenia", "Anemia", "Thrombocytopenia", "Febrile Neutropenia",
  "Peripheral Neuropathy", "Alopecia", "Rash", "Mucositis / Stomatitis",
  "Hepatotoxicity", "Nephrotoxicity", "Cardiotoxicity", "Infusion Reaction",
  "Pain", "Anorexia / Appetite Loss"
];

// ─── CLEARANCE SUMMARY CARD ──────────────────────────────────────────────────────────────────

const ClearanceSummaryCard = ({ formData, treatment, dbCycles, labOrderFields, labHistory, activeEditCycle }) => {
  const [expanded, setExpanded] = useState(false);

  const cycle = activeEditCycle || 1;
  const cyclesArr = Array.from({ length: cycle }, (_, i) => i + 1);
  const numColumns = cyclesArr.length + 1;

  // ── Flag-level helpers for individual rows ───────────────────────────
  const labLevel = (val, redLow, redHigh, amberLow, amberHigh) => {
    const n = parseFloat(val);
    if (!n && n !== 0) return "normal";
    if (redLow !== null && n < redLow) return "red";
    if (redHigh !== null && n > redHigh) return "red";
    if (amberLow !== null && n < amberLow) return "amber";
    if (amberHigh !== null && n > amberHigh) return "amber";
    return "normal";
  };
  const vitalLevel = (val, redLow, redHigh, amberLow, amberHigh) => labLevel(val, redLow, redHigh, amberLow, amberHigh);
  const parseVital = (val) => parseFloat(val) || null;
  const parseBP = (val) => {
    if (!val) return { systolic: null, diastolic: null };
    const parts = String(val).split("/");
    return { systolic: parseFloat(parts[0]) || null, diastolic: parseFloat(parts[1]) || null };
  };

  // Helper to extract a single lab value for a specific cycle from labHistory or labOrderFields
  const getCycleLabVal = (cNum, key) => {
    if (cNum === cycle) {
      const field = labOrderFields?.find(f => f.key === key);
      if (field?.selected && field?.surgeryValue) return field.surgeryValue;
    }
    if (labHistory && labHistory.length > 0) {
      for (let i = 0; i < labHistory.length; i++) {
        const inv = labHistory[i];
        if (inv.status !== "completed") continue;
        const inferred = getCycleNumberForDate(inv.date_of_order, dbCycles);
        if (String(inferred) === String(cNum) || (cNum === cycle && !inferred)) {
          const params = inv.parameters || [];
          const match = params.find(p => {
            const pKey = (p.key || "").toLowerCase();
            const pLabel = (p.label || "").toLowerCase();
            const target = key.toLowerCase().replace(/_/g, " ");
            if (pKey === key || pKey.includes(target) || pLabel === target || pLabel.includes(target)) return true;
            if (key === "sodium" && (pLabel.includes("na+") || pLabel.includes("na⁺") || pKey.includes("na"))) return true;
            if (key === "potassium" && (pLabel.includes("k+") || pLabel.includes("k⁺") || pKey.includes("k"))) return true;
            return false;
          });
          if (match) {
            let val = match.value || match.result || match.content;
            if (val && typeof val === "string" && val.includes("|")) {
              const parts = val.split("|").map(s => s.trim());
              if (parts.length >= 2) return parts[1];
            }
            if (val) return val;
          }
        }
      }
    }
    return null;
  };

  const getCycleANC = (cNum) => {
    if (labHistory && labHistory.length > 0) {
      for (let i = 0; i < labHistory.length; i++) {
        const inv = labHistory[i];
        if (inv.status !== "completed") continue;
        const inferred = getCycleNumberForDate(inv.date_of_order, dbCycles);
        if (String(inferred) === String(cNum) || (cNum === cycle && !inferred)) {
          const params = inv.parameters || [];
          const match = params.find(p => {
            const label = (p.label || p.key || "").toLowerCase();
            return label.includes("absolute neutrophil") || label.includes("anc");
          });
          if (match) {
            let val = match.value || match.result || match.content;
            if (val && typeof val === "string" && val.includes("|")) {
              const parts = val.split("|").map(s => s.trim());
              if (parts.length >= 2) return parts[1];
            }
            if (val) return val;
          }
        }
      }
    }
    return null;
  };

  const extractCycleData = (extractorFn) => {
    let prevW = null;
    let prevB = null;
    return cyclesArr.map((cNum) => {
      let source;
      if (cNum === cycle) {
        source = {
          overview: formData?.overview || {},
          partC: formData?.partC || {},
          partD: formData?.partD || {},
          partA: formData?.partA || {}
        };
      } else {
        const dbC = dbCycles?.[String(cNum)] || {};
        source = {
          overview: {
            height: dbC.assessment?.height || dbC.pre_chemo?.height || "",
            weight: dbC.assessment?.weight || dbC.pre_chemo?.weight || "",
            ecog: dbC.assessment?.performanceStatus?.replace("ecog-", "") || ""
          },
          partC: {
            tempPre: dbC.admin?.vitals?.tempPre || "",
            pulsePre: dbC.admin?.vitals?.pulsePre || "",
            bpPre: dbC.admin?.vitals?.bpPre || "",
            rrPre: dbC.admin?.vitals?.rrPre || "",
            spo2Pre: dbC.admin?.vitals?.spo2Pre || "",
            painPre: dbC.admin?.vitals?.painPre || ""
          },
          partD: {
            toxicities: dbC.post_chemo?.toxicities || [],
            postponeTreatment: dbC.post_chemo?.postponeTreatment || "",
            postponeReason: dbC.post_chemo?.postponeReason || ""
          },
          partA: { drugs: [] }
        };
      }

      const res = extractorFn(cNum, source, prevW, prevB);

      const h = parseFloat(source.overview.height);
      const w = parseFloat(source.overview.weight);
      const bsa = (h && w) ? (0.007184 * Math.pow(h, 0.725) * Math.pow(w, 0.425)).toFixed(2) : null;
      prevW = w || null;
      prevB = bsa || null;

      return res;
    });
  };

  const heightData = extractCycleData((cNum, src) => {
    const val = src.overview.height;
    return { value: val ? `${val} cm` : null, level: !val ? "red" : "normal" };
  });

  const weightData = extractCycleData((cNum, src) => {
    const val = src.overview.weight;
    return { value: val ? `${val} kg` : null, level: !val ? "red" : "normal" };
  });

  const bsaData = extractCycleData((cNum, src) => {
    const h = parseFloat(src.overview.height);
    const w = parseFloat(src.overview.weight);
    const bsa = (h && w) ? (0.007184 * Math.pow(h, 0.725) * Math.pow(w, 0.425)).toFixed(2) : null;
    return { value: bsa ? `${bsa} m²` : null, level: !bsa ? "red" : "normal" };
  });

  const weightChangeData = extractCycleData((cNum, src, prevW) => {
    const w = parseFloat(src.overview.weight);
    if (cNum === 1 || !w || !prevW) return { value: cNum === 1 ? "—" : "No previous weight", level: "normal" };
    const pct = (((w - prevW) / prevW) * 100).toFixed(1);
    return {
      value: `${pct > 0 ? "+" : ""}${pct}%`,
      level: parseFloat(pct) < -5 ? "amber" : "normal",
      note: `Previous: ${prevW} kg`
    };
  });

  const bsaChangeData = extractCycleData((cNum, src, prevW, prevB) => {
    const h = parseFloat(src.overview.height);
    const w = parseFloat(src.overview.weight);
    const bsa = (h && w) ? (0.007184 * Math.pow(h, 0.725) * Math.pow(w, 0.425)).toFixed(2) : null;
    if (cNum === 1 || !bsa || !prevB) return { value: cNum === 1 ? "—" : null, level: "normal" };
    const delta = (parseFloat(bsa) - parseFloat(prevB)).toFixed(2);
    return {
      value: `Δ ${delta} m²`,
      level: Math.abs(delta) > 0.1 ? "amber" : "normal",
      note: `Previous: ${prevB} m²`
    };
  });

  const ecogData = extractCycleData((cNum, src) => {
    let e = src.overview.ecog;
    if (e && !isNaN(e)) e = String(parseInt(e));
    const ecogNum = parseInt(e);
    const ecogLevel = ecogNum >= 4 ? "red" : ecogNum === 3 ? "amber" : !e ? "red" : "normal";
    return { value: e ? (ECOG_MAP[e] || `ECOG ${e}`) : null, level: ecogLevel };
  });

  const tempData = extractCycleData((cNum, src) => {
    const v = src.partC.tempPre;
    return { value: v ? `${v} °C` : null, level: vitalLevel(v, null, 37.5, null, null) };
  });

  const pulseData = extractCycleData((cNum, src) => {
    const v = src.partC.pulsePre;
    return { value: v ? `${v} bpm` : null, level: vitalLevel(v, 50, 110, null, null) };
  });

  const bpData = extractCycleData((cNum, src) => {
    const v = src.partC.bpPre;
    const bp = parseBP(v);
    return { value: v ? `${v} mmHg` : null, level: (bp.systolic && (bp.systolic > 160 || bp.systolic < 90) ? "amber" : "normal") };
  });

  const rrData = extractCycleData((cNum, src) => {
    const v = src.partC.rrPre;
    return { value: v ? `${v} /min` : null, level: vitalLevel(v, null, 24, null, null) };
  });

  const spo2Data = extractCycleData((cNum, src) => {
    const v = src.partC.spo2Pre;
    const spo2Num = parseVital(v);
    return { value: v ? `${v}%` : null, level: (spo2Num && spo2Num < 92 ? "red" : spo2Num && spo2Num <= 94 ? "amber" : "normal") };
  });

  const painData = extractCycleData((cNum, src) => {
    const v = src.partC.painPre;
    return { value: v ? `${v}/10` : null, level: vitalLevel(v, null, null, null, 7) };
  });

  const hbData = cyclesArr.map(cNum => {
    const v = getCycleLabVal(cNum, "hb");
    return { value: v ? `${v} g/dL` : null, level: labLevel(v, 8, null, 10, null) };
  });
  const wbcData = cyclesArr.map(cNum => {
    const v = getCycleLabVal(cNum, "wbc");
    return { value: v ? `${v} ×10³/µL` : null, level: labLevel(v, 2.0, null, 3.5, null) };
  });
  const ancData = cyclesArr.map(cNum => {
    const v = getCycleANC(cNum);
    return { value: v ? `${v} ×10³/µL` : null, level: labLevel(v, 1.5, null, 2.0, null) };
  });
  const plateletData = cyclesArr.map(cNum => {
    const v = getCycleLabVal(cNum, "platelets");
    return { value: v ? `${v} ×10³/µL` : null, level: labLevel(v, 75, null, 100, null) };
  });

  const creatData = cyclesArr.map(cNum => {
    const v = getCycleLabVal(cNum, "creatinine");
    return { value: v ? `${v} mg/dL` : null, level: labLevel(v, null, 2.0, null, 1.5) };
  });
  const ureaData = cyclesArr.map(cNum => {
    const v = getCycleLabVal(cNum, "blood_urea");
    return { value: v ? `${v} mg/dL` : null, level: labLevel(v, null, null, null, 50) };
  });
  const naData = cyclesArr.map(cNum => {
    const v = getCycleLabVal(cNum, "sodium");
    const naNum = parseFloat(v);
    return { value: v ? `${v} mEq/L` : null, level: (naNum && (naNum < 130 || naNum > 150)) ? "amber" : "normal" };
  });
  const kData = cyclesArr.map(cNum => {
    const v = getCycleLabVal(cNum, "potassium");
    const kNum = parseFloat(v);
    return { value: v ? `${v} mEq/L` : null, level: (kNum && (kNum < 3.0 || kNum > 5.5)) ? "amber" : "normal" };
  });

  const sgotData = cyclesArr.map(cNum => {
    const v = getCycleLabVal(cNum, "sgot");
    return { value: v ? `${v} U/L` : null, level: labLevel(v, null, 200, null, 120) };
  });
  const sgptData = cyclesArr.map(cNum => {
    const v = getCycleLabVal(cNum, "sgpt");
    return { value: v ? `${v} U/L` : null, level: labLevel(v, null, 200, null, 120) };
  });
  const biliData = cyclesArr.map(cNum => {
    const v = getCycleLabVal(cNum, "bilirubin");
    return { value: v ? `${v} mg/dL` : null, level: labLevel(v, null, 3.0, null, 1.5) };
  });
  const albData = cyclesArr.map(cNum => {
    const v = getCycleLabVal(cNum, "albumin");
    return { value: v ? `${v} g/dL` : null, level: labLevel(v, null, null, 3.0, null) };
  });

  const lvefData = cyclesArr.map(cNum => {
    const v = getCycleLabVal(cNum, "echo_lvef");
    return { value: v ? `${v}%` : null, level: labLevel(v, 50, null, 55, null) };
  });
  const ecgData = cyclesArr.map(cNum => {
    const v = getCycleLabVal(cNum, "ecg");
    return { value: v || null, level: "normal" };
  });

  const anthracyclines = ["doxorubicin", "epirubicin", "daunorubicin", "idarubicin", "trastuzumab"];
  const hasAnthracycline = (formData?.partA?.drugs || []).some(d => anthracyclines.some(a => (d.name || "").toLowerCase().includes(a)));
  const showCardiac = lvefData.some(d => d.value) || ecgData.some(d => d.value) || hasAnthracycline;

  const prevToxData = cyclesArr.map(cNum => {
    if (cNum === 1) return { value: "—", level: "normal" };
    let prevToxicities = [];
    if (cNum === cycle) {
      prevToxicities = dbCycles?.[String(cycle - 1)]?.post_chemo?.toxicities || [];
    } else {
      prevToxicities = dbCycles?.[String(cNum - 1)]?.post_chemo?.toxicities || [];
    }
    const grade3PlusTox = prevToxicities.filter(t => t.grade === "3" || t.grade === "4");

    if (prevToxicities.length === 0) {
      return { value: null, level: "red", note: `No toxicity assessment for Cycle ${cNum - 1}` };
    }

    const value = grade3PlusTox.length > 0
      ? `${grade3PlusTox.length} event(s): ${grade3PlusTox.map(t => `${t.event || t.system} (Gr ${t.grade})`).join(", ")}`
      : "None";
    const level = grade3PlusTox.some(t => t.grade === "4") ? "red" : grade3PlusTox.length > 0 ? "amber" : "normal";
    return { value, level };
  });

  const postponeData = cyclesArr.map(cNum => {
    if (cNum === 1) return { value: "—", level: "normal" };
    let postponed = false;
    let reason = "";
    if (cNum === cycle) {
      postponed = dbCycles?.[String(cycle - 1)]?.post_chemo?.postponeTreatment === "yes";
      reason = dbCycles?.[String(cycle - 1)]?.post_chemo?.postponeReason || "";
    } else {
      postponed = dbCycles?.[String(cNum - 1)]?.post_chemo?.postponeTreatment === "yes";
      reason = dbCycles?.[String(cNum - 1)]?.post_chemo?.postponeReason || "";
    }
    return {
      value: postponed ? `Yes — ${reason || "no reason"}` : "No",
      level: postponed ? "amber" : "normal"
    };
  });

  const currentToxData = cyclesArr.map(cNum => {
    let currentToxicities = [];
    if (cNum === cycle) {
      currentToxicities = formData?.partD?.toxicities?.filter(t => t.event || t.system) || [];
    } else {
      currentToxicities = dbCycles?.[String(cNum)]?.post_chemo?.toxicities?.filter(t => t.event || t.system) || [];
    }
    if (currentToxicities.length === 0) return { value: "None", level: "normal" };

    const value = currentToxicities.map(t => `${t.event || t.system}${t.grade ? " (Gr " + t.grade + ")" : ""}`).join(", ");
    const level = currentToxicities.some(t => t.grade === "4") ? "red" : currentToxicities.some(t => t.grade === "3") ? "amber" : "normal";
    return { value, level };
  });

  const surgeryData = formData?.surgery_import || {};
  const hasSurgery = Object.keys(surgeryData).length > 0;

  let surgeryDate = null;
  let surgeryDaysAgo = null;
  let surgeryWoundInfo = "";
  if (hasSurgery) {
    Object.entries(surgeryData).forEach(([secName, secData]) => {
      if (typeof secData === "object" && !Array.isArray(secData)) {
        Object.entries(secData).forEach(([k, v]) => {
          if (!surgeryDate && k.toLowerCase().includes("date") && v) surgeryDate = v;
          if (k.toLowerCase().includes("wound") || k.toLowerCase().includes("complication") || k.toLowerCase().includes("drain") || k.toLowerCase().includes("stoma")) {
            if (v) surgeryWoundInfo += (surgeryWoundInfo ? ", " : "") + `${k}: ${v}`;
          }
        });
      }
    });
    if (surgeryDate) {
      const d = new Date(surgeryDate);
      if (!isNaN(d)) surgeryDaysAgo = Math.floor((new Date() - d) / 86400000);
    }
  }

  const surgeryHistoryData = cyclesArr.map(() => {
    if (!hasSurgery) return { value: "No surgery on file", level: "normal" };
    const val = surgeryDate ? `${surgeryDate}${surgeryDaysAgo !== null ? " (" + surgeryDaysAgo + " days ago)" : ""}` : "Date not recorded";
    const level = surgeryDaysAgo !== null && surgeryDaysAgo < 14 ? "red" : surgeryDaysAgo !== null && surgeryDaysAgo < 21 ? "amber" : "normal";
    return { value: val, level };
  });

  const surgeryWoundData = cyclesArr.map(() => {
    return { value: surgeryWoundInfo || null, level: "normal" };
  });

  return (
    <Box sx={{ mb: 3, border: `1px solid ${C.border}`, fontFamily: FONT }}>
      {/* ── Header row — always visible ─── */}
      <Box sx={{
        display: "flex", justifyContent: "space-between", alignItems: "center",
        background: C.black, color: C.white, px: 2, py: 1.5
      }}>
        <Box>
          <Typography sx={{ fontSize: 10, letterSpacing: "0.15em", color: "rgba(255,255,255,0.6)", textTransform: "uppercase" }}>
            Pre-Cycle Clearance Summary
          </Typography>
          <Typography sx={{ fontSize: 13, fontWeight: FW_MEDIUM, color: C.white }}>
            {formData?.overview?.patientName || "—"} · Cycle {cycle} of {treatment?.plannedCycles || "?"}
            {formData?.partA?.protocolName ? ` · ${formData?.partA?.protocolName}` : ""}
          </Typography>
        </Box>
        <Button onClick={() => setExpanded(e => !e)}
          sx={{ color: C.white, fontSize: 11, textTransform: "none", minWidth: 0 }}>
          {expanded ? "▼ Collapse" : "▶ Expand"}
        </Button>
      </Box>

      {/* ── Collapsible body ─── */}
      {expanded && (
        <Box sx={{ overflowX: "auto" }}>
          <Box component="table" sx={{ width: "100%", borderCollapse: "collapse", minWidth: 600 }}>
            <Box component="thead">
              <Box component="tr" sx={{ background: C.bgTertiary }}>
                <Box component="th" sx={{ p: "8px 12px", textAlign: "left", fontSize: 11, fontWeight: 600, color: C.textSecond, borderBottom: `1px solid ${C.border}`, borderRight: `1px solid ${C.border}` }}>
                  Parameter
                </Box>
                {cyclesArr.map(cNum => (
                  <Box key={cNum} component="th" sx={{ p: "8px 12px", textAlign: "left", fontSize: 11, fontWeight: 600, color: C.textSecond, borderBottom: `1px solid ${C.border}`, borderRight: cNum < cyclesArr.length ? `1px solid ${C.border}` : 'none' }}>
                    Cycle {cNum}
                  </Box>
                ))}
              </Box>
            </Box>
            <Box component="tbody">

              {/* ═══ SECTION A — Anthropometry & Performance ═══ */}
              <ClearanceSubHeader title="A — Anthropometry & Performance" colSpan={numColumns} />
              <ClearanceRow label="Height" cycleData={heightData} />
              <ClearanceRow label="Weight" cycleData={weightData} />
              <ClearanceRow label="BSA (calculated)" cycleData={bsaData} />
              {cycle > 1 && <ClearanceRow label="Weight change vs last cycle" cycleData={weightChangeData} />}
              {cycle > 1 && <ClearanceRow label="BSA change vs last cycle" cycleData={bsaChangeData} />}
              <ClearanceRow label="ECOG Performance Status" cycleData={ecogData} />

              {/* ═══ SECTION B — Today's Vitals (Pre-Treatment) ═══ */}
              <ClearanceSubHeader title="B — Vitals (Pre-Treatment)" colSpan={numColumns} />
              <ClearanceRow label="Temperature" cycleData={tempData} />
              <ClearanceRow label="Pulse" cycleData={pulseData} />
              <ClearanceRow label="Blood Pressure" cycleData={bpData} />
              <ClearanceRow label="Respiratory Rate" cycleData={rrData} />
              <ClearanceRow label="SpO₂" cycleData={spo2Data} />
              <ClearanceRow label="Pain Score" cycleData={painData} />

              {/* ═══ SECTION C — Laboratory Parameters ═══ */}
              <ClearanceSubHeader title="C — Haematology" colSpan={numColumns} />
              <ClearanceRow label="Haemoglobin (Hb)" cycleData={hbData} />
              <ClearanceRow label="WBC Count" cycleData={wbcData} />
              <ClearanceRow label="ANC" cycleData={ancData} />
              <ClearanceRow label="Platelets" cycleData={plateletData} />

              <ClearanceSubHeader title="C — Renal Function" colSpan={numColumns} />
              <ClearanceRow label="Serum Creatinine" cycleData={creatData} />
              <ClearanceRow label="Blood Urea / BUN" cycleData={ureaData} />
              <ClearanceRow label="Serum Na⁺" cycleData={naData} />
              <ClearanceRow label="Serum K⁺" cycleData={kData} />

              <ClearanceSubHeader title="C — Liver Function" colSpan={numColumns} />
              <ClearanceRow label="SGOT / AST" cycleData={sgotData} />
              <ClearanceRow label="SGPT / ALT" cycleData={sgptData} />
              <ClearanceRow label="Total Bilirubin" cycleData={biliData} />
              <ClearanceRow label="Serum Albumin" cycleData={albData} />

              {showCardiac && (
                <>
                  <ClearanceSubHeader title="C — Cardiac" colSpan={numColumns} />
                  <ClearanceRow label="Echo LVEF" cycleData={lvefData} />
                  <ClearanceRow label="ECG Result" cycleData={ecgData} />
                </>
              )}

              {/* ═══ SECTION D — Toxicity from Previous Cycle ═══ */}
              {cycle > 1 && (
                <>
                  <ClearanceSubHeader title="D — Toxicity" colSpan={numColumns} />
                  <ClearanceRow label="Grade 3+ Tox from Prev Cycle" cycleData={prevToxData} />
                  <ClearanceRow label="Previous Cycle Postponement" cycleData={postponeData} />
                  <ClearanceRow label="Ongoing Current Toxicities" cycleData={currentToxData} />
                </>
              )}

              {/* ═══ SECTION E — Surgery & Radiation History ═══ */}
              <ClearanceSubHeader title="E — Surgery & Radiation History" colSpan={numColumns} />
              <ClearanceRow label="History" cycleData={surgeryHistoryData} />
              {hasSurgery && surgeryWoundInfo && (
                <ClearanceRow label="Wound Status / Complications" cycleData={surgeryWoundData} />
              )}

              {/* ═══ SECTION F — Safety Checks ═══ */}
              <ClearanceSubHeader title="F — Safety Checks" colSpan={numColumns + 1} />
              <ClearanceRow
                label="Allergy Status"
                value={
                  (formData?.overview?.allergyStatus || formData?.allergyStatus) === "yes"
                    ? `ALLERGY FLAGGED: ${formData?.overview?.allergyDrug || "unknown"} — ${formData?.overview?.allergyType || ""} (Severity: ${formData?.overview?.allergySeverity || "unknown"})`
                    : (formData?.overview?.allergyStatus || formData?.allergyStatus) === "no" ? "No known drug allergies" : null
                }
                level={(formData?.overview?.allergyStatus || formData?.allergyStatus) === "yes" ? "red" : !(formData?.overview?.allergyStatus || formData?.allergyStatus) ? "red" : "normal"}
              />
              <ClearanceRow
                label="Interaction Check"
                value={formData?.overview?.allergyInteractionChecked || ((formData?.overview?.allergyStatus || formData?.allergyStatus) === "no" ? "N/A" : null)}
                level={(formData?.overview?.allergyStatus || formData?.allergyStatus) === "yes" && !formData?.overview?.allergyInteractionChecked ? "amber" : "normal"}
              />

              {/* ═══ SECTION G — Cumulative Doses (Optional/Dynamic) ═══ */}
              {treatment?.cumulativeDoses && treatment.cumulativeDoses.length > 0 && (
                <>
                  <ClearanceSubHeader title="G — Cumulative Doses" colSpan={numColumns + 1} />
                  {treatment.cumulativeDoses.map((cd, idx) => (
                    <ClearanceRow
                      key={idx}
                      label={cd.name}
                      value={`${cd.total} mg total`}
                      level={cd.level || "normal"}
                      note={cd.note || ""}
                    />
                  ))}
                </>
              )}

            </Box>
          </Box>
        </Box>
      )}
    </Box>
  );
};

const ChemoRegimenSummaryCard = ({ data, loading, error, onDownloadPDF }) => {
  if (loading) {
    return (
      <Box sx={{ mb: 3, p: 2.5, border: `1px solid ${C.border}`, background: C.bgSecondary, textAlign: "center" }}>
        <Typography sx={{ fontSize: 12.5, color: C.textMuted, fontFamily: FONT, fontStyle: "italic" }}>
          Loading chemotherapy regimen...
        </Typography>
      </Box>
    );
  }
  if (error) {
    return (
      <Box sx={{ mb: 3, p: 2.5, border: `1px solid ${C.border}`, background: C.bgSecondary }}>
        <Typography sx={{ fontSize: 12.5, color: C.textMuted, fontFamily: FONT, fontStyle: "italic" }}>
          {error}
        </Typography>
      </Box>
    );
  }
  if (!data) return null;

  const cycleSchedule = computeCycleSchedule(data.startDate, data.plannedCycles, data.daysBetweenCycles);
  const drugNamesJoined = (data.drugSchedule || []).map(d => d.name).filter(Boolean).join(", ") || "—";

  return (
    <Box sx={{ mb: 3, border: `1px solid ${C.border}` }}>
      <Box sx={{
        display: "flex", justifyContent: "space-between", alignItems: "center",
        background: C.black, color: C.white, px: 2, py: 1.5, flexWrap: "wrap", gap: 1
      }}>
        <Box>
          <Typography sx={{ fontSize: 10, letterSpacing: "0.15em", color: "rgba(255,255,255,0.6)", textTransform: "uppercase" }}>
            Chemotherapy Regimen Summary
          </Typography>
          <Typography sx={{ fontSize: 13, fontWeight: FW_MEDIUM, color: C.white }}>
            {data.protocolName || data.selectedProtocol || "—"}
            {data.treatmentIntent ? ` · ${data.treatmentIntent} Intent` : ""}
          </Typography>
        </Box>
        <Button
          onClick={onDownloadPDF}
          startIcon={<Print sx={{ fontSize: 16 }} />}
          sx={{ ...btnStyle, border: `1px solid ${C.white}`, color: C.white, fontSize: 11.5, px: 1.75, "&:hover": { background: "rgba(255,255,255,0.1)" } }}
        >
          Download / Print PDF
        </Button>
      </Box>

      <Box component="table" sx={{ width: "100%", borderCollapse: "collapse" }}>
        <Box component="tbody">
          <ClearanceSubHeader title="Protocol Overview" />
          <ClearanceRow label="Treatment Intent" value={data.treatmentIntent} />
          <ClearanceRow label="Selected Protocol" value={data.selectedProtocol} />
          <ClearanceRow label="Type of Chemotherapy" value={data.typeOfChemotherapy} />
          <ClearanceRow label="Start Date" value={data.startDate} />
          <ClearanceRow label="Planned Cycles" value={data.plannedCycles ? `${data.plannedCycles} cycles` : null} />
          <ClearanceRow label="Days Between Cycles" value={data.daysBetweenCycles ? `Every ${data.daysBetweenCycles} days` : null} />
          <ClearanceRow label="Protocol Details" value={data.protocolDetails} />
          <ClearanceRow label="Dose Adjustments" value={data.doseAdjustments} />
          <ClearanceRow label="Concurrent Therapy" value={data.concurrentTherapy} />
          {data.reasonForChange && <ClearanceRow label="Reason for Change" value={data.reasonForChange} />}
          {data.protocolMasterRef && <ClearanceRow label="Protocol Master Ref" value={data.protocolMasterRef} />}
        </Box>
      </Box>

      {data.drugSchedule?.length > 0 && (
        <Box sx={{ p: 2, borderTop: `1px solid ${C.border}` }}>
          <Typography sx={{ fontSize: 11, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.1em", color: C.textMuted, mb: 1 }}>
            Drug Schedule (Per Cycle)
          </Typography>
          <TableContainer sx={{ border: `1px solid ${C.border}` }}>
            <Table size="small">
              <TableHead sx={{ background: C.bgSecondary }}>
                <TableRow>
                  {["Drug", "Dose", "Route", "Day", "Admin Type", "Duration"].map(h => (
                    <TableCell key={h} sx={invThSx}>{h}</TableCell>
                  ))}
                </TableRow>
              </TableHead>
              <TableBody>
                {data.drugSchedule.map((drug, i) => (
                  <TableRow key={i}>
                    <TableCell sx={invTdSx}>{drug.name || "—"}</TableCell>
                    <TableCell sx={invTdSx}>{drug.dose ? `${drug.dose} ${drug.unit || ""}`.trim() : "—"}</TableCell>
                    <TableCell sx={invTdSx}>{drug.route || "—"}</TableCell>
                    <TableCell sx={invTdSx}>Day {drug.day || "—"}</TableCell>
                    <TableCell sx={invTdSx}>{drug.adminType || "—"}</TableCell>
                    <TableCell sx={invTdSx}>{drug.duration ? `${drug.duration} min` : "—"}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>
        </Box>
      )}

      {cycleSchedule.length > 0 && (
        <Box sx={{ p: 2, borderTop: `1px solid ${C.border}` }}>
          <Typography sx={{ fontSize: 11, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.1em", color: C.textMuted, mb: 1 }}>
            Projected Cycle Dates
          </Typography>
          <TableContainer sx={{ border: `1px solid ${C.border}` }}>
            <Table size="small">
              <TableHead sx={{ background: C.bgSecondary }}>
                <TableRow>
                  <TableCell sx={invThSx}>Cycle</TableCell>
                  <TableCell sx={invThSx}>Planned Date</TableCell>
                  <TableCell sx={invThSx}>Drugs</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {cycleSchedule.map(c => (
                  <TableRow key={c.cycleNum}>
                    <TableCell sx={invTdSx}>Cycle {c.cycleNum}</TableCell>
                    <TableCell sx={invTdSx}>{formatDateDisplay(c.date)}</TableCell>
                    <TableCell sx={invTdSx}>{drugNamesJoined}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>
        </Box>
      )}

      <Box sx={{ p: 2, borderTop: `1px solid ${C.border}`, display: "flex", flexWrap: "wrap", gap: 3 }}>
        {data.premedications?.length > 0 && (
          <Box sx={{ minWidth: 200 }}>
            <Typography sx={{ fontSize: 10.5, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.08em", color: C.textMuted, mb: 0.5 }}>Premedications</Typography>
            <Typography sx={{ fontSize: 12.5, color: C.textPrimary, fontFamily: FONT }}>{data.premedications.join(", ")}</Typography>
          </Box>
        )}
        {data.hydration?.length > 0 && (
          <Box sx={{ minWidth: 200 }}>
            <Typography sx={{ fontSize: 10.5, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.08em", color: C.textMuted, mb: 0.5 }}>Hydration</Typography>
            <Typography sx={{ fontSize: 12.5, color: C.textPrimary, fontFamily: FONT }}>{data.hydration.join(", ")}</Typography>
          </Box>
        )}
        {data.supportiveCare?.length > 0 && (
          <Box sx={{ minWidth: 200 }}>
            <Typography sx={{ fontSize: 10.5, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.08em", color: C.textMuted, mb: 0.5 }}>Supportive Care</Typography>
            <Typography sx={{ fontSize: 12.5, color: C.textPrimary, fontFamily: FONT }}>{data.supportiveCare.join(", ")}</Typography>
          </Box>
        )}
        {data.laboratoryRequirements?.length > 0 && (
          <Box sx={{ minWidth: 200 }}>
            <Typography sx={{ fontSize: 10.5, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.08em", color: C.textMuted, mb: 0.5 }}>Laboratory Requirements</Typography>
            <Typography sx={{ fontSize: 12.5, color: C.textPrimary, fontFamily: FONT }}>{data.laboratoryRequirements.join(", ")}</Typography>
          </Box>
        )}
        {data.references?.length > 0 && (
          <Box sx={{ minWidth: 200 }}>
            <Typography sx={{ fontSize: 10.5, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.08em", color: C.textMuted, mb: 0.5 }}>References</Typography>
            <Typography sx={{ fontSize: 12.5, color: C.textPrimary, fontFamily: FONT }}>{data.references.join(", ")}</Typography>
          </Box>
        )}
      </Box>

      {data.safetyFlags?.length > 0 && (
        <Box sx={{ p: 2, borderTop: `1px solid ${C.border}`, background: "#fff8f8" }}>
          <Typography sx={{ fontSize: 10.5, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.08em", color: "#c62828", mb: 0.5 }}>⚠ Safety Flags</Typography>
          {data.safetyFlags.map((f, i) => (
            <Typography key={i} sx={{ fontSize: 12.5, color: "#c62828", fontFamily: FONT }}>• {f}</Typography>
          ))}
        </Box>
      )}
    </Box>
  );
};

const getInitialFormData = (patientId) => ({
  surgery_import: {},
  overview: {
    patientName: "", patientId: patientId || "", patientAge: "", patientGender: "", patientDiagnosis: "", registrationDate: "",
    height: "", weight: "", lmpDate: "", bsa: "", serumCreatinine: "", ecog: "",
    tbPastDecision: "", tbFollowed: "", tbNotFollowedReason: "", tbAssign: "", tbScheduleDate: "", tbQuestion: "",
    tumorBoardPlanData: null,
    allergy: "", allergies: [],
    preInvCBC: false, preInvCreatinine: false, preInvLFT: false, preInvEcho: false, preInvOther: false, preInvOtherText: "",
    baselineInvestigations: [{ id: 1, testName: "", remarks: "" }]
  },
  partA: {
    intent: "", chemoType: "", protocolName: "", startDate: "", cycles: "", daysBetween: "", protocolDetails: "", doseAdjustments: "", concurrentTherapy: "", specialInstructions: "", reasonForChange: "", protocolMasterRef: "",
    drugs: [{ id: 1, name: "", type: "", dose: "", unit: "", maxDose: "", route: "", adminType: "", frequency: "", diluent: "", volume: "", duration: "", instructions: "" }]
  },
  partB: {
    consultantDrA: false, consultantDrB: false, consultantDrC: false,
    consentTaken: "", consentDate: "", consentDocumentName: "", consentDocumentUrl: "", safetyVerified: "",
    docOngoingTox: "", docProceed: "", treatmentDecision: "", treatmentDecisionJustification: "", docReasonTolerance: false, docReasonProgression: false, docReasonChoice: false,
    postponeFromDate: "", postponeUntilDate: "", postponeDays: "", postponeReassessmentPlan: "",
    drugPreparations: [{ id: 1, drugName: "", dose: "", doseUnit: "m2", whetherMod: "", modDose: "", modDoseUnit: "mg", modReasonComorb: false, modReasonTox: false, modReasonPerf: false, modReasonNutri: false, modReasonGen: false, modReasonOther: false }],
    medDrugName: "", medDose: "", medDoseUnit: "m2", medModDose: "", medModDoseUnit: "mg", medWhetherMod: "", medModReasonComorb: false, medModReasonTox: false, medModReasonPerf: false, medModReasonNutri: false, medModReasonGen: false, medModReasonOther: false,
    currentLabs: "", venousAccess: "", emergencyMeds: "", pharmacyVerification: false, nurseVerification: false, prepPPE: false, labelingDetails: "",
    approvalDoctorName: "", approvalDoctorSigned: false
  },
  partC: {
    planDate: new Date().toISOString().split('T')[0],
    placeOfTreatmentCasualty: false, placeOfTreatmentDaycare: false, placeOfTreatmentInjectionRoom: false, placeOfTreatmentIR: false, placeOfTreatmentPaediatric: false, placeOfTreatmentWard: false, placeOfTreatmentOther: false,
    wardType: "",
    tempPre: "", tempDuring: "", tempPost: "",
    pulsePre: "", pulseDuring: "", pulsePost: "",
    bpPre: "", bpDuring: "", bpPost: "",
    rrPre: "", rrDuring: "", rrPost: "",
    spo2Pre: "", spo2During: "", spo2Post: "",
    drugs: [{ id: 1, name: "", instructions: "", dose: "", given: "", startTime: "", endTime: "", notGivenReason: "", infusionReaction: "" }],
    cycleCompleted: "", cycleNotCompletedReason: "", doctorNotes: "",
    adminRoute: "", adminRouteNotes: "", totalDose: "", patientIdConfirmed: false, regimenConfirmed: false, preMedication: "",
    approvalPreparedNurseName: "", approvalPreparedNurseSigned: false,
    approvalVerifiedNurseName: "", approvalVerifiedNurseSigned: false
  },
  partD: {
    toxicities: [{ id: 1, cycleDay: "", gradingSystem: "", system: "", event: "", description: "", onset: "", grade: "", managementPlace: "", attribution: "" }],
    postponeTreatment: "", postponeReason: "", postponeDays: "", postponeFromDate: "", postponeUntilDate: "",
    monitoringPeriod: "", nadirLabs: "", sideEffectMgt: "",
    interimImaging: "", responseCriteria: "", tumorBoardReview: ""
  },
  partE: {
    tolerated: "", watchPain: false, watchMotions: false, watchConstipation: false, watchVomiting: false, watchWBC: false, watchMouth: false, watchIndigestion: false, watchFever: false,
    dischargeDrugs: [{ id: 1, remarks: "", name: "", route: "", dosage: "", days: "", source: "manual" }],
    followUpDoctor: "", followUpDaycare: "", emergencyContact: "",
    dischargePreparedBy: "",
    endOfResponseTreatment: "", endOfResponseDate: "",
    totalCyclesCompleted: "", cumulativeDoses: "", treatmentOutcomes: "", residualToxicity: "",
    treatmentCompletionStatus: "", treatmentNotCompletedReason: "", treatmentNotCompletedNotes: "",
    auditPeriod: "", dosingAccuracy: "", adverseEventRate: "", protocolAdherence: "", incidentReview: "",
    toxicitySummaryText: "",
  },
  partF: {
    overallAssessment: "", recommendations: "", physicianSignature: "", signatureDate: "", physicianSigned: false,
    dischargePreparedBy: "",
    toxicitySummaryText: "",
    treatmentCompletionStatus: "",
    treatmentNotCompletedReason: "",
    treatmentNotCompletedNotes: "",
    endOfResponseTreatment: "",
    endOfResponseDate: "",
  }
});

// ─── CHEMOTHERAPY WORKFLOW (Main Component) ──────────────────────────────────────────────────

const OPRecord = ({ doctorId, patientId, doctorSpeciality, doctorName, hospitalId = "" }) => {
  const [activeTab, setActiveTab] = useState("overview");
  const [currentTreatmentId, setCurrentTreatmentId] = useState(null);
  const [currentTreatmentStatus, setCurrentTreatmentStatus] = useState("active");
  const [treatmentHistory, setTreatmentHistory] = useState([]);

  // Consultation Summary state
  const [consultationSummary, setConsultationSummary] = useState([]);
  const [loadingConsultationSummary, setLoadingConsultationSummary] = useState(false);
  const [structuredNoteExpanded, setStructuredNoteExpanded] = useState(false);
  // Localized Save states
  const [isSavingAssessment, setIsSavingAssessment] = useState(false);
  const [isSavingAllergicReaction, setIsSavingAllergicReaction] = useState(false);
  const [isSavingPreChemo, setIsSavingPreChemo] = useState(false);

  const [labOrderFields, setLabOrderFields] = useState(
    STANDARD_LAB_FIELDS.map(f => ({ ...f, selected: false, surgeryValue: "" }))
  );
  const [customLabFields, setCustomLabFields] = useState([]);
  const [labOrderStatus, setLabOrderStatus] = useState("none");
  const [newField, setNewField] = useState({ label: "", unit: "", range: "" });
  const [isGeneratingAI, setIsGeneratingAI] = useState(false);
  const [clinicalIndication, setClinicalIndication] = useState("");
  const [investigationsHistory, setInvestigationsHistory] = useState([]);
  const [completedDocuments, setCompletedDocuments] = useState([]);
  const [pendingInvPage, setPendingInvPage] = useState(0);
  const [pendingInvRowsPerPage, setPendingInvRowsPerPage] = useState(5);
  const [completedInvPage, setCompletedInvPage] = useState(0);
  const [completedInvRowsPerPage, setCompletedInvRowsPerPage] = useState(5);
  const [radClinicalIndication, setRadClinicalIndication] = useState("");
  const [radOrderStatus, setRadOrderStatus] = useState("none");
  const [radOrderFields, setRadOrderFields] = useState(
    STANDARD_RAD_FIELDS.map(f => ({ ...f, selected: false }))
  );
  const [customRadFields, setCustomRadFields] = useState([]);
  const [newRadField, setNewRadField] = useState({ label: "", unit: "", range: "" });

  const generateAISuggestions = async () => {
    if (!patientId) return;
    setIsGeneratingAI(true);
    try {
      const payload = {
        patient_id: patientId,
        doctor_id: doctorId,
        hospital_id: hospitalId || ""
      };

      const res = await fetch(`${API_BASE_URL}hms/users/data/context/chemo/generate-investigation-suggestion`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      const resData = await res.json();

      if (resData.status === "success" && resData.data) {
        const { clinicalIndication, labTests, radTests } = resData.data;

        if (clinicalIndication) {
          setClinicalIndication(clinicalIndication);
          setRadClinicalIndication(clinicalIndication);
        }

        if (Array.isArray(labTests)) {
          setLabOrderFields(prev => prev.map(f => ({
            ...f,
            selected: f.selected || labTests.includes(f.label)
          })));
        }

        if (Array.isArray(radTests)) {
          setRadOrderFields(prev => prev.map(f => ({
            ...f,
            selected: f.selected || radTests.includes(f.label)
          })));
        }
      }
    } catch (err) {
      console.error("Failed to generate AI suggestions", err);
    } finally {
      setIsGeneratingAI(false);
    }
  };

  const fetchInvestigations = async () => {
    if (patientId) {
      try {
        const res = await fetch(`${API_BASE_URL}hms/users/data/context/oncology-investigations/${patientId}`);
        const json = await res.json();

        if (json && json.data && Array.isArray(json.data)) {
          let history = json.data;

          // Collect unique doctor IDs
          const doctorIds = [...new Set(history.map(inv => inv.doctor_id).filter(Boolean))];

          // Fetch names for those we don't know
          const doctorNamePromises = doctorIds.map(async (docId) => {
            if (docId === doctorId && (fetchedDoctorName || doctorName)) {
              return { id: docId, name: fetchedDoctorName || doctorName };
            }
            try {
              const dRes = await fetch(`${API_BASE_URL}hms/users/doctors/get_doctor/${docId}`);
              const dJson = await dRes.json();
              const docData = dJson?.data || dJson?.doctor || dJson;
              const name = docData?.name || docData?.doctor_name || `${docData?.first_name || ""} ${docData?.last_name || ""}`.trim();
              return { id: docId, name: name || docId };
            } catch (e) {
              return { id: docId, name: docId };
            }
          });

          const doctorNames = await Promise.all(doctorNamePromises);
          const docMap = {};
          doctorNames.forEach(d => { docMap[d.id] = d.name; });

          // Populate the history objects with the resolved doctor_name
          history = history.map(inv => ({
            ...inv,
            doctor_name: inv.doctor_name || docMap[inv.doctor_id] || inv.doctor_id
          }));

          setInvestigationsHistory(history);
        }
      } catch (err) {
        console.error("Failed to fetch investigations:", err);
      }
      if (patientId && doctorId) {
        fetch(`${API_BASE_URL}hms/users/data/context/oncology-investigations/completed-documents`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ patient_id: patientId, doctor_id: doctorId })
        })
          .then(res => res.json())
          .then(res => {
            if (res && res.data) {
              setCompletedDocuments(res.data);
            }
          })
          .catch(err => console.error("Failed to fetch completed documents:", err));
      }
    }
  };

  useEffect(() => {
    fetchInvestigations();
  }, [patientId, doctorId]);

  const myInvestigations = investigationsHistory.filter(inv => inv && inv.doctor_id === doctorId);

  const labHistory = myInvestigations.filter(inv => {
    const type = inv.investigation || inv.investigation_type || "";
    return type.includes("labinvestigation") || (!type.includes("radiology") && type.startsWith("investigation"));
  });

  const getInvestigationLabel = (inv) => {
    const type = inv.investigation || inv.investigation_type || "";
    if (type.includes("radiology")) return "Radiology";
    return "Lab";
  };

  const formatInvParams = (params) => {
    if (Array.isArray(params)) return params.map(p => (typeof p === "string" ? p : p?.label)).filter(Boolean).join(", ");
    if (typeof params === "string") return params;
    return "—";
  };

  const isInvCompleted = (inv) => inv.document_id || (inv.status || "").toLowerCase() === "completed";

  const pendingInvestigations = myInvestigations.filter(inv => !isInvCompleted(inv));

  const idByDocumentId = investigationsHistory.reduce((acc, inv) => {
    if (inv.document_id != null && inv.id !== undefined) acc[inv.document_id] = inv.id;
    return acc;
  }, {});
  const allCompleted = [...completedDocuments]
    .map(doc => ({ ...doc, id: doc.id !== undefined ? doc.id : idByDocumentId[doc.document_id] }))
    .sort((a, b) => new Date(b.date_of_order) - new Date(a.date_of_order));

  const completedInvestigations = myInvestigations.filter(inv => isInvCompleted(inv));

  // Form State Architecture
  const [formData, setFormData] = useState(getInitialFormData(patientId));

  // Treatment metadata from the shared chemotherapy record.
  // Tracks which cycle is current, how many are planned/completed, etc.
  // OPRecord reads this on load and uses currentCycle to target the correct
  // cycle slot when saving cycle-scoped data (details, regimen, prep, etc.).
  const [treatment, setTreatment] = useState({
    plannedCycles: 6,
    currentCycle: 1,
    completedCycles: 0,
    status: "cycle_1_in_progress",
    treatmentCompleted: false
  });

  // Store raw database cycles for rendering history tables
  const [dbCycles, setDbCycles] = useState({});
  const [rawDbData, setRawDbData] = useState({});
  const [activeEditCycle, setActiveEditCycle] = useState(null);

  // Tracks whether a save is in progress (disables buttons, shows feedback)
  const [isSaving, setIsSaving] = useState(false);

  const [fetchedDoctorName, setFetchedDoctorName] = useState(doctorName || "");
  const [actualHospitalId, setActualHospitalId] = useState(hospitalId || "");
  const [allDoctorsList, setAllDoctorsList] = useState([]);
  const [clearedConsultant, setClearedConsultant] = useState(false);
  const [pastAdverseAlertOpen, setPastAdverseAlertOpen] = useState(false);
  const [pastAdverseAlerts, setPastAdverseAlerts] = useState([]);
  const pastAdverseAckRef = useRef({});

  // -- Toxicity Summary (AI-generated narrative for discharge) --
  const [toxicitySummaryLoading, setToxicitySummaryLoading] = useState(false);
  const [toxicitySummaryError, setToxicitySummaryError] = useState(null);

  // -- Lab Upload UI State & Logic --
  const [labUploadLoading, setLabUploadLoading] = useState(false);
  const [labUploadError, setLabUploadError] = useState(null);
  const labFileInputRef = useRef(null);

  // -- Chemotherapy Regimen Summary (Doctor's Notes tab) --
  const [chemoRegimenData, setChemoRegimenData] = useState(null);
  const [chemoRegimenLoading, setChemoRegimenLoading] = useState(false);
  const [chemoRegimenError, setChemoRegimenError] = useState(null);

  const handleLabFileUpload = async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;

    setLabUploadLoading(true);
    setLabUploadError(null);

    try {
      // Dynamically load pdf.js via script tag to avoid Vite build errors
      const pdfjsLib = await new Promise((resolve, reject) => {
        if (window.pdfjsLib) return resolve(window.pdfjsLib);
        const script = document.createElement("script");
        script.src = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js";
        script.onload = () => {
          window.pdfjsLib.GlobalWorkerOptions.workerSrc = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js";
          resolve(window.pdfjsLib);
        };
        script.onerror = reject;
        document.body.appendChild(script);
      });

      const arrayBuffer = await file.arrayBuffer();
      const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
      let fullText = "";

      for (let i = 1; i <= pdf.numPages; i++) {
        const page = await pdf.getPage(i);
        const textContent = await page.getTextContent();
        const pageText = textContent.items.map(item => item.str).join(" ");
        fullText += pageText + "\n";
      }

      console.log("Extracted PDF Text:", fullText);

      // If no text layer is found, fallback to OCR using Tesseract.js
      if (!fullText.trim()) {
        console.log("No text layer found. Running OCR...");

        const Tesseract = await new Promise((resolve, reject) => {
          if (window.Tesseract) return resolve(window.Tesseract);
          const script = document.createElement("script");
          script.src = "https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/tesseract.min.js";
          script.onload = () => resolve(window.Tesseract);
          script.onerror = reject;
          document.body.appendChild(script);
        });

        for (let i = 1; i <= pdf.numPages; i++) {
          const page = await pdf.getPage(i);
          const scale = 2.0; // Higher scale for better OCR accuracy
          const viewport = page.getViewport({ scale });
          const canvas = document.createElement("canvas");
          canvas.width = viewport.width;
          canvas.height = viewport.height;
          const context = canvas.getContext("2d");

          await page.render({ canvasContext: context, viewport }).promise;

          // Process canvas with Tesseract
          const { data: { text } } = await Tesseract.recognize(canvas, 'eng');
          fullText += text + "\n";
        }
        console.log("OCR Extracted Text:", fullText);
      }

      if (!fullText.trim()) {
        setLabUploadError("Could not extract text or OCR from this PDF.");
        return;
      }

      const tests = [];
      const rules = [
        { name: "Hemoglobin", regex: /HEMOGLOBIN.*?([\d.]+)/i, unit: "g/dL" },
        { name: "White blood cell count", regex: /TOTAL WBC COUNT.*?([\d.]+)/i, unit: "cells/cumm" },
        { name: "Absolute Neutrophil Count (ANC)", regex: /NEUTROPHIL#.*?([\d.]+)/i, unit: "10^3/uL" },
        { name: "Platelet count", regex: /PLATELET COUNT.*?([\d.]+)/i, unit: "lakhs/cumm" },
        { name: "Lymphocytes", regex: /LYMPHOCYTE#.*?([\d.]+)/i, unit: "10^3/uL" },
        { name: "Eosinophils", regex: /EOSINOPHIL#.*?([\d.]+)/i, unit: "10^3/uL" },
        { name: "Monocytes", regex: /MONOCYTE#.*?([\d.]+)/i, unit: "10^3/uL" },
        { name: "RBC Count", regex: /RBC COUNT.*?([\d.]+)/i, unit: "millions/cumm" },
        { name: "PCV", regex: /PCV.*?([\d.]+)/i, unit: "%" },
        { name: "MCV", regex: /MCV.*?([\d.]+)/i, unit: "fL" },
        { name: "MCH", regex: /MCH.*?([\d.]+)/i, unit: "pg" },
        { name: "APTT Test", regex: /APTT TEST.*?([\d.]+)/i, unit: "Secs" },
        { name: "PT INR", regex: /PT INR.*?([\d.]+)/i, unit: "" }
      ];

      rules.forEach(rule => {
        const match = fullText.match(rule.regex);
        if (match) {
          const finalValue = rule.unit ? `${match[1]} ${rule.unit}` : match[1];
          tests.push({
            id: Date.now() + Math.random(),
            testName: rule.name,
            value: finalValue,
            remarks: "Extracted from report"
          });
        }
      });

      if (tests.length > 0) {
        setFormData(prev => {
          let currentLabs = [...(prev.overview.baselineInvestigations || [])];

          if (currentLabs.length === 1 && !currentLabs[0].testName && !currentLabs[0].value && !currentLabs[0].remarks) {
            currentLabs = [];
          }

          tests.forEach(newTest => {
            // Find an existing ordered test that matches the name (ignoring whatever placeholder value it has)
            const existingIdx = currentLabs.findIndex(
              lab => lab.testName && lab.testName.toLowerCase().trim() === newTest.testName.toLowerCase().trim()
            );

            if (existingIdx >= 0) {
              currentLabs[existingIdx].value = newTest.value;
            } else {
              currentLabs.push(newTest);
            }
          });

          return {
            ...prev,
            overview: { ...prev.overview, baselineInvestigations: currentLabs }
          };
        });
      } else {
        setLabUploadError("Could not detect any standard lab tests in this report.");
      }

    } catch (err) {
      console.error("PDF parsing error:", err);
      setLabUploadError("Failed to read the PDF. Please try again.");
    } finally {
      setLabUploadLoading(false);
      if (labFileInputRef.current) labFileInputRef.current.value = "";
    }
  };

  const [safetyWarningsA, setSafetyWarningsA] = useState(null);
  const [safetyCheckLoadingA, setSafetyCheckLoadingA] = useState(false);
  const [safetyCheckErrorA, setSafetyCheckErrorA] = useState(null);

  const [safetyWarningsB, setSafetyWarningsB] = useState(null);
  const [safetyCheckLoadingB, setSafetyCheckLoadingB] = useState(false);
  const [safetyCheckErrorB, setSafetyCheckErrorB] = useState(null);

  // ── Part C Section 3: Drug Admin Risk Check ──────────────────────────────────
  const [drugAdminWarnings, setDrugAdminWarnings] = useState(null);
  const [drugAdminWarnLoading, setDrugAdminWarnLoading] = useState(false);
  const [drugAdminWarnError, setDrugAdminWarnError] = useState(null);
  const drugAdminCheckedDrugsRef = useRef([]);

  const runSafetyCheckAPI = async (drugs) => {
    let allergies = "";
    if (formData.overview.allergy === "yes") {
      if (Array.isArray(formData.overview.allergies) && formData.overview.allergies.length > 0) {
        allergies = formData.overview.allergies
          .map(a => `${a.drug || ""} - ${a.type || ""} - ${a.severity || ""}`.trim())
          .filter(Boolean)
          .join("; ");
      } else {
        allergies = `${formData.overview.allergyDrug || ""} - ${formData.overview.allergyType || ""} - ${formData.overview.allergySeverity || ""}`.trim();
      }
    }
    const toxicities = [];
    if (dbCycles) {
      Object.entries(dbCycles).forEach(([cycleNum, cycleData]) => {
        if (cycleData.toxicities && cycleData.toxicities.length > 0) {
          cycleData.toxicities.forEach(tox => {
            toxicities.push(`Cycle ${cycleNum}: ${tox.adverseEvent} (Grade ${tox.grade})`);
          });
        }
      });
    }
    const payload = {
      prescribed_drugs: drugs,
      allergies: allergies,
      toxicities: toxicities.join("\n")
    };
    const res = await fetch(`${API_BASE_URL}hms/users/data/context/check-drug-safety`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
    const json = await res.json();
    if (!res.ok) {
      console.error("[OPRecord] /check-drug-safety API Error (HTTP " + res.status + "):", json);
    }
    return json;
  };

  const runInteractionCheckAPI = async (drugs) => {
    let allergies = "";
    if (formData.overview.allergy === "yes") {
      if (Array.isArray(formData.overview.allergies) && formData.overview.allergies.length > 0) {
        allergies = formData.overview.allergies
          .map(a => `${a.drug || ""} - ${a.type || ""} - ${a.severity || ""}`.trim())
          .filter(Boolean)
          .join("; ");
      } else {
        allergies = `${formData.overview.allergyDrug || ""} - ${formData.overview.allergyType || ""} - ${formData.overview.allergySeverity || ""}`.trim();
      }
    }
    const toxicities = [];
    if (dbCycles) {
      Object.entries(dbCycles).forEach(([cycleNum, cycleData]) => {
        if (cycleData.toxicities && cycleData.toxicities.length > 0) {
          cycleData.toxicities.forEach(tox => {
            toxicities.push(`Cycle ${cycleNum}: ${tox.adverseEvent} (Grade ${tox.grade})`);
          });
        }
      });
    }
    const payload = {
      prescribed_drugs: drugs,
      allergies: allergies,
      toxicities: toxicities.join("\n")
    };
    const res = await fetch(`${API_BASE_URL}hms/users/data/context/check-drug-interactions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
    const json = await res.json();
    if (!res.ok) {
      console.error("[OPRecord] /check-drug-interactions API Error (HTTP " + res.status + "):", json);
    }
    return json;
  };

  // Deterministic Client-Side Allergy Conflict Check
  const getDeterministicAllergyConflicts = (prescribedDrugs) => {
    if (formData.overview.allergy !== "yes") return [];
    
    let allergyList = [];
    if (Array.isArray(formData.overview.allergies) && formData.overview.allergies.length > 0) {
      allergyList = formData.overview.allergies;
    } else if (formData.overview.allergyDrug) {
      allergyList = [{
        drug: formData.overview.allergyDrug,
        type: formData.overview.allergyType,
        severity: formData.overview.allergySeverity
      }];
    }
    
    if (allergyList.length === 0) return [];
    
    const conflicts = [];
    (prescribedDrugs || []).forEach(d => {
      const drugName = (typeof d === "string" ? d : (d.name || d.drugName || "")).trim().toLowerCase();
      if (!drugName) return;

      allergyList.forEach(a => {
        const allergyDrug = (a.drug || "").trim().toLowerCase();
        if (!allergyDrug) return;

        if (drugName === allergyDrug || drugName.includes(allergyDrug) || allergyDrug.includes(drugName)) {
          conflicts.push({
            prescribedDrug: typeof d === "string" ? d : (d.name || d.drugName),
            allergyDrug: a.drug,
            type: a.type || "Allergic Reaction",
            severity: a.severity || "Unspecified"
          });
        }
      });
    });

    return conflicts;
  };

  const checkDrugSafetyA = async () => {
    setSafetyCheckLoadingA(true);
    setSafetyCheckErrorA(null);
    setSafetyWarningsA(null);
    try {
      const drugs = formData.partA.drugs ? formData.partA.drugs.map(d => d.name).filter(Boolean) : [];
      if (drugs.length === 0) {
        setSafetyCheckErrorA("No drugs prescribed to check.");
        return;
      }
      const json = drugs.length > 1 ? await runInteractionCheckAPI(drugs) : await runSafetyCheckAPI(drugs);
      if (json.status === "success") {
        setSafetyWarningsA(json.data);
      } else {
        console.error("[OPRecord] Part A Safety Check / Interaction Check failed:", json);
        setSafetyCheckErrorA(json.detail || "Could not check safety.");
      }
    } catch (err) {
      console.error("[OPRecord] Part A Network Error during safety check:", err);
      setSafetyCheckErrorA("Network error while checking drug safety.");
    } finally {
      setSafetyCheckLoadingA(false);
    }
  };

  const checkDrugSafetyB = async () => {
    setSafetyCheckLoadingB(true);
    setSafetyCheckErrorB(null);
    setSafetyWarningsB(null);
    try {
      const drugs = (formData.partB.drugPreparations || [])
        .map(d => d.drugName)
        .filter(name => name && name.trim() !== "");
      if (drugs.length === 0) {
        setSafetyCheckErrorB("No drugs prescribed to check.");
        return;
      }
      const json = await runSafetyCheckAPI(drugs);
      if (json.status === "success") {
        setSafetyWarningsB(json.data);
      } else {
        console.error("[OPRecord] Part B Safety Check failed:", json);
        setSafetyCheckErrorB(json.detail || "Could not check safety.");
      }
    } catch (err) {
      console.error("[OPRecord] Part B Network Error during safety check:", err);
      setSafetyCheckErrorB("Network error while checking drug safety.");
    } finally {
      setSafetyCheckLoadingB(false);
    }
  };

  const checkDrugAdminRisks = async () => {
    const drugs = (formData.partC.drugs || [])
      .map(d => ({ name: d.name?.trim(), dose: d.dose?.trim() }))
      .filter(d => d.name);
    if (drugs.length === 0) {
      alert("No drugs added to Section 3 yet. Add at least one drug before checking risks.");
      return;
    }
    setDrugAdminWarnLoading(true);
    setDrugAdminWarnError(null);
    setDrugAdminWarnings(null);
    try {
      const res = await fetch(
        `${API_BASE_URL}hms/users/data/context/chemo-drug-admin-risk-check`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            drugs,
            clinical_summary: consultationSummary || ""
          })
        }
      );
      const json = await res.json();
      if (json.status === "success") {
        setDrugAdminWarnings(json.data);
        drugAdminCheckedDrugsRef.current = drugs.map(d => d.name);
      } else {
        setDrugAdminWarnError(json.detail || "Risk check failed. Please try again.");
      }
    } catch (err) {
      console.error("Drug admin risk check failed:", err);
      setDrugAdminWarnError("Network error during risk check.");
    } finally {
      setDrugAdminWarnLoading(false);
    }
  };

  useEffect(() => {
    const delayDebounceFn = setTimeout(() => {
      const drugs = (formData.partB.drugPreparations || []).map(d => d.drugName).filter(n => n && n.trim() !== "");
      if (drugs.length > 0) {
        checkDrugSafetyB();
      } else {
        setSafetyWarningsB(null);
        setSafetyCheckErrorB(null);
      }
    }, 1200);
    return () => clearTimeout(delayDebounceFn);
  }, [formData.partB.drugPreparations]);

  useEffect(() => {
    const delayDebounceFn = setTimeout(() => {
      if (formData.partA.drugs && formData.partA.drugs.some(d => d.name && d.name.trim() !== "")) {
        checkDrugSafetyA();
      } else {
        setSafetyWarningsA(null);
        setSafetyCheckErrorA(null);
      }
    }, 1200);
    return () => clearTimeout(delayDebounceFn);
  }, [formData.partA.drugs]);

  // const [regimenSuggestion, setRegimenSuggestion] = useState(null);
  // const [regimenSuggestLoading, setRegimenSuggestLoading] = useState(false);
  // const [regimenSuggestError, setRegimenSuggestError] = useState(null);
  // const [protocolDialogOpen, setProtocolDialogOpen] = useState(false);
  // const [protocolDetailOpen, setProtocolDetailOpen] = useState(false);
  // const [protocolDetailLoading, setProtocolDetailLoading] = useState(false);
  // const [protocolDetailData, setProtocolDetailData] = useState(null);     // full protocol_master doc
  // const [protocolAdaptation, setProtocolAdaptation] = useState(null);     // { clinicalContext, llmOutput, adaptedRegimen }
  // const [protocolDetailError, setProtocolDetailError] = useState(null);

  // const mergedProtocolView = useMemo(() => {
  //   const master = protocolDetailData || {};
  //   const adapted = protocolAdaptation?.adaptedRegimen || {};
  //   if (Object.keys(master).length === 0 && Object.keys(adapted).length === 0) return null;

  //   return {
  //     protocolName: adapted.selectedProtocol || master.protocol_name,
  //     displayName: master.display_name,
  //     protocolId: master.protocol_id,
  //     diseaseSites: master.disease_sites,
  //     histology: master.histology,
  //     treatmentIntent: adapted.treatmentIntent || (Array.isArray(master.intent) ? master.intent.join(", ") : master.intent),
  //     regimenType: master.regimen_type,
  //     standardCycles: adapted.plannedCycles || master.standard_cycles,
  //     cycleIntervalDays: adapted.daysBetweenCycles || master.cycle_interval_days,
  //     version: master.version,
  //     status: master.status,
  //     startDate: adapted.startDate,
  //     concurrentTherapy: adapted.concurrentTherapy,
  //     reasonForChange: adapted.reasonForChange,
  //     safetyFlags: adapted.safetyFlags,
  //     drugSchedule: (adapted.drugs && adapted.drugs.length > 0) ? adapted.drugs : master.drug_schedule,
  //     premedications: master.premedications,
  //     hydration: master.hydration,
  //     supportiveCare: master.supportive_care,
  //     laboratoryRequirements: master.laboratory_requirements,
  //     references: master.references,
  //     doseAdjustmentRules: master.dose_adjustment_rules,
  //     doseAdjustments: adapted.doseAdjustments,
  //   };
  // }, [protocolDetailData, protocolAdaptation]);
  // const [protocolList, setProtocolList] = useState([]);
  // const [protocolLoading, setProtocolLoading] = useState(false);
  // const [protocolSearch, setProtocolSearch] = useState("");
  // const [protocolSelecting, setProtocolSelecting] = useState(null);
  const [isPrefillingDoctorNote, setIsPrefillingDoctorNote] = useState(false);
  const [doctorNoteTranscript, setDoctorNoteTranscript] = useState("");
  const [isDictatingDoctorNote, setIsDictatingDoctorNote] = useState(false);
  const [interimTranscript, setInterimTranscript] = useState("");
  const [doctorNoteFillSuccess, setDoctorNoteFillSuccess] = useState(false);
  const doctorNoteRecognitionRef = useRef(null);
  const isDictatingRef = useRef(false);

  const startDoctorNoteDictation = () => {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) {
      alert("Speech recognition is not supported in this browser. Please use Google Chrome.");
      return;
    }

    // Clear transcript once when the user intentionally starts
    setDoctorNoteTranscript("");
    setInterimTranscript("");
    setDoctorNoteFillSuccess(false);
    isDictatingRef.current = true;
    setIsDictatingDoctorNote(true);

    const startRecognition = () => {
      const recognition = new SpeechRecognition();
      recognition.continuous = true;
      recognition.interimResults = true;
      recognition.lang = 'en-US';

      recognition.onresult = (event) => {
        let finalText = "";
        let interimText = "";
        for (let i = event.resultIndex; i < event.results.length; ++i) {
          if (event.results[i].isFinal) {
            finalText += event.results[i][0].transcript + " ";
          } else {
            interimText += event.results[i][0].transcript;
          }
        }
        if (finalText) setDoctorNoteTranscript((prev) => prev + finalText);
        setInterimTranscript(interimText);
      };

      recognition.onerror = (event) => {
        console.error("Speech recognition error:", event.error);
        if (event.error === 'not-allowed') {
          alert("Microphone access was denied. Please allow microphone access in your browser settings.");
          isDictatingRef.current = false;
          setIsDictatingDoctorNote(false);
          setInterimTranscript("");
        }
        // 'no-speech' and 'network' errors — let onend handle the restart
      };

      recognition.onend = () => {
        setInterimTranscript("");
        if (isDictatingRef.current) {
          // Auto-restart to keep recording through natural pauses / silence
          try { startRecognition(); } catch (e) { console.warn("Recognition restart failed:", e); }
        } else {
          setIsDictatingDoctorNote(false);
        }
      };

      recognition.start();
      doctorNoteRecognitionRef.current = recognition;
    };

    startRecognition();
  };

  const stopDoctorNoteDictation = () => {
    isDictatingRef.current = false;
    setInterimTranscript("");
    if (doctorNoteRecognitionRef.current) {
      doctorNoteRecognitionRef.current.stop();
    }
  };

  const processDoctorNoteDictation = async () => {
    if (!doctorNoteTranscript.trim()) {
      alert("Please type or dictate some notes before using AI auto-fill.");
      return;
    }
    setIsPrefillingDoctorNote(true);
    setDoctorNoteFillSuccess(false);
    try {
      const res = await fetch(`${API_BASE_URL}hms/users/data/context/chemo-doctor-note-structure`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: doctorNoteTranscript })
      });
      if (res.ok) {
        const json = await res.json();
        if (json.status === "success" && json.data) {
          const d = json.data;
          // Only fill fields that are currently empty — never overwrite existing data
          if (d.currentLabs && !formData.partB.currentLabs) handleUpdate("partB", "currentLabs", d.currentLabs);
          if (d.docOngoingTox && !formData.partB.docOngoingTox) handleUpdate("partB", "docOngoingTox", d.docOngoingTox);
          if (d.treatmentDecision && !formData.partB.treatmentDecision) {
            handleUpdate("partB", "treatmentDecision", d.treatmentDecision);
            handleUpdate("partB", "docProceed", d.treatmentDecision === "continue" ? "yes" : "no");
          }
          if (d.treatmentDecisionJustification && !formData.partB.treatmentDecisionJustification)
            handleUpdate("partB", "treatmentDecisionJustification", d.treatmentDecisionJustification);
          if (d.docReasonTolerance && !formData.partB.docReasonTolerance) handleUpdate("partB", "docReasonTolerance", d.docReasonTolerance);
          if (d.docReasonProgression && !formData.partB.docReasonProgression) handleUpdate("partB", "docReasonProgression", d.docReasonProgression);
          if (d.docReasonChoice && !formData.partB.docReasonChoice) handleUpdate("partB", "docReasonChoice", d.docReasonChoice);
          if (d.venousAccess && !formData.partB.venousAccess) handleUpdate("partB", "venousAccess", d.venousAccess);
          if (d.safetyVerified && !formData.partB.safetyVerified) handleUpdate("partB", "safetyVerified", d.safetyVerified);
          if (d.emergencyMeds && !formData.partB.emergencyMeds) handleUpdate("partB", "emergencyMeds", d.emergencyMeds);
          if (d.consultantName && !formData.partB.consultantName) handleUpdate("partB", "consultantName", d.consultantName);
          if (d.postponeFromDate && !formData.partB.postponeFromDate) handleUpdate("partB", "postponeFromDate", d.postponeFromDate);
          if (d.postponeUntilDate && !formData.partB.postponeUntilDate) handleUpdate("partB", "postponeUntilDate", d.postponeUntilDate);
          if (d.postponeDays && !formData.partB.postponeDays) handleUpdate("partB", "postponeDays", d.postponeDays);
          if (d.postponeReassessmentPlan && !formData.partB.postponeReassessmentPlan) handleUpdate("partB", "postponeReassessmentPlan", d.postponeReassessmentPlan);
          if (d.patientConsent && !formData.partB.patientConsent) handleUpdate("partB", "patientConsent", d.patientConsent);

          if (Array.isArray(d.drugPreparations) && d.drugPreparations.length > 0) {
            const newPreps = d.drugPreparations.map(prep => ({
              id: Date.now() + Math.random(),
              drugName: prep.drugName || "",
              dose: "", // Let them calculate it later
              doseUnit: "m2",
              whetherMod: prep.whetherMod === "yes" ? "yes" : "no",
              modDose: prep.modDose ? prep.modDose.replace(/[^0-9.]/g, '') : "",
              modDoseUnit: "mg",
              modReasonTox: prep.modReasonTox || false,
              modReasonComorb: prep.modReasonComorb || false,
              modReasonPerf: prep.modReasonPerf || false,
              modReasonNutri: prep.modReasonNutri || false,
              modReasonGen: prep.modReasonGen || false,
              modReasonOther: false
            }));
            const currentPreps = formData.partB.drugPreparations || [];
            if (currentPreps.length === 1 && !currentPreps[0].drugName && !currentPreps[0].modDose) {
                handleUpdate("partB", "drugPreparations", newPreps);
            } else {
                handleUpdate("partB", "drugPreparations", [...currentPreps, ...newPreps]);
            }
          }

          if (Array.isArray(d.drugs) && d.drugs.length > 0) {
            const newDrugs = d.drugs.map(drug => ({
              id: Date.now() + Math.random(),
              name: drug.name || "",
              type: "Systemic",
              dose: drug.dose ? drug.dose.replace(/[^0-9.]/g, '') : "",
              unit: drug.unit || "",
              maxDose: "",
              route: drug.route || "",
              adminType: "",
              frequency: drug.frequency || "",
              diluent: "",
              volume: "",
              duration: "",
              instructions: drug.instructions || ""
            }));
            const currentDrugs = formData.partA.drugs || [];
            if (currentDrugs.length === 1 && !currentDrugs[0].name && !currentDrugs[0].dose) {
                handleUpdate("partA", "drugs", newDrugs);
            } else {
                handleUpdate("partA", "drugs", [...currentDrugs, ...newDrugs]);
            }
          }

          // Transcript is intentionally kept so the user can see what was processed
          setDoctorNoteFillSuccess(true);
          setTimeout(() => setDoctorNoteFillSuccess(false), 4000);
        } else {
          alert(json.message || "AI could not extract data from the provided text.");
        }
      } else {
        const errJson = await res.json().catch(() => ({}));
        alert(errJson.detail || "Error reaching the AI auto-fill endpoint.");
      }
    } catch (err) {
      console.error("Failed to process doctor note:", err);
      alert("Network error while processing. Please check your connection.");
    } finally {
      setIsPrefillingDoctorNote(false);
    }
  };

  const handlePrefillDoctorNote = async () => {
    setIsPrefillingDoctorNote(true);
    try {
      const res = await fetch(`${API_BASE_URL}hms/users/data/context/doctor-note-extraction/${patientId}`);
      if (res.ok) {
        const json = await res.json();
        if (json.status === "success" && json.data) {
          const d = json.data;
          if (d.currentLabs) handleUpdate("partB", "currentLabs", d.currentLabs);
          if (d.docOngoingTox) handleUpdate("partB", "docOngoingTox", d.docOngoingTox);
          if (d.treatmentDecision) {
            handleUpdate("partB", "treatmentDecision", d.treatmentDecision);
            handleUpdate("partB", "docProceed", d.treatmentDecision === "continue" ? "yes" : "no");
          }
          if (d.treatmentDecisionJustification) handleUpdate("partB", "treatmentDecisionJustification", d.treatmentDecisionJustification);
        } else {
          alert(json.message || "No dictation data found");
        }
      }
    } catch (err) {
      console.error("Failed to prefill doctor note:", err);
      alert("Error fetching dictation data.");
    } finally {
      setIsPrefillingDoctorNote(false);
    }
  };

  // ── Nurse's Note Dictation & AI Auto-fill State ─────────────────────────────
  const [nurseNoteTranscript, setNurseNoteTranscript] = useState("");
  const [isPrefillingNurseNote, setIsPrefillingNurseNote] = useState(false);
  const [nurseNoteFillSuccess, setNurseNoteFillSuccess] = useState(false);

  const processNurseNoteDictation = async () => {
    if (!nurseNoteTranscript.trim()) {
      alert("Please type or dictate some notes before using AI auto-fill.");
      return;
    }
    setIsPrefillingNurseNote(true);
    setNurseNoteFillSuccess(false);
    try {
      const res = await fetch(`${API_BASE_URL}hms/users/data/context/chemo-nurse-note-structure`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: nurseNoteTranscript })
      });
      if (res.ok) {
        const json = await res.json();
        if (json.status === "success" && json.data) {
          const d = json.data;
          if (d.planDate && !formData.partC.planDate) handleUpdate("partC", "planDate", d.planDate);
          if (d.placeOfTreatmentCasualty) handleUpdate("partC", "placeOfTreatmentCasualty", true);
          if (d.placeOfTreatmentDaycare) handleUpdate("partC", "placeOfTreatmentDaycare", true);
          if (d.placeOfTreatmentWard) handleUpdate("partC", "placeOfTreatmentWard", true);
          if (d.placeOfTreatmentOther) handleUpdate("partC", "placeOfTreatmentOther", true);
          if (d.wardType && !formData.partC.wardType) handleUpdate("partC", "wardType", d.wardType);
          if (d.adminRoute && !formData.partC.adminRoute) handleUpdate("partC", "adminRoute", d.adminRoute);
          if (d.adminRouteNotes && !formData.partC.adminRouteNotes) handleUpdate("partC", "adminRouteNotes", d.adminRouteNotes);
          if (d.patientIdConfirmed) handleUpdate("partC", "patientIdConfirmed", true);
          if (d.regimenConfirmed) handleUpdate("partC", "regimenConfirmed", true);
          if (d.preMedication && !formData.partC.preMedication) handleUpdate("partC", "preMedication", d.preMedication);
          
          // Vitals Pre
          if (d.tempPre && !formData.partC.tempPre) handleUpdate("partC", "tempPre", d.tempPre);
          if (d.pulsePre && !formData.partC.pulsePre) handleUpdate("partC", "pulsePre", d.pulsePre);
          if (d.bpPre && !formData.partC.bpPre) handleUpdate("partC", "bpPre", d.bpPre);
          if (d.rrPre && !formData.partC.rrPre) handleUpdate("partC", "rrPre", d.rrPre);
          if (d.spo2Pre && !formData.partC.spo2Pre) handleUpdate("partC", "spo2Pre", d.spo2Pre);
          if (d.painPre && !formData.partC.painPre) handleUpdate("partC", "painPre", d.painPre);
          
          // Vitals During
          if (d.tempDuring && !formData.partC.tempDuring) handleUpdate("partC", "tempDuring", d.tempDuring);
          if (d.pulseDuring && !formData.partC.pulseDuring) handleUpdate("partC", "pulseDuring", d.pulseDuring);
          if (d.bpDuring && !formData.partC.bpDuring) handleUpdate("partC", "bpDuring", d.bpDuring);
          if (d.rrDuring && !formData.partC.rrDuring) handleUpdate("partC", "rrDuring", d.rrDuring);
          if (d.spo2During && !formData.partC.spo2During) handleUpdate("partC", "spo2During", d.spo2During);
          if (d.painDuring && !formData.partC.painDuring) handleUpdate("partC", "painDuring", d.painDuring);

          // Vitals Post
          if (d.tempPost && !formData.partC.tempPost) handleUpdate("partC", "tempPost", d.tempPost);
          if (d.pulsePost && !formData.partC.pulsePost) handleUpdate("partC", "pulsePost", d.pulsePost);
          if (d.bpPost && !formData.partC.bpPost) handleUpdate("partC", "bpPost", d.bpPost);
          if (d.rrPost && !formData.partC.rrPost) handleUpdate("partC", "rrPost", d.rrPost);
          if (d.spo2Post && !formData.partC.spo2Post) handleUpdate("partC", "spo2Post", d.spo2Post);
          if (d.painPost && !formData.partC.painPost) handleUpdate("partC", "painPost", d.painPost);

          if (d.cycleCompleted && !formData.partC.cycleCompleted) handleUpdate("partC", "cycleCompleted", d.cycleCompleted);
          if (d.cycleNotCompletedReason && !formData.partC.cycleNotCompletedReason) handleUpdate("partC", "cycleNotCompletedReason", d.cycleNotCompletedReason);
          if (d.doctorNotes && !formData.partC.doctorNotes) handleUpdate("partC", "doctorNotes", d.doctorNotes);

          if (Array.isArray(d.drugs) && d.drugs.length > 0) {
            const newDrugs = d.drugs.map(drug => ({
              id: Date.now() + Math.random(),
              name: drug.name || "",
              dose: drug.dose ? drug.dose.replace(/[^0-9.]/g, '') : "",
              diluent: drug.diluent || "",
              instructions: drug.instructions || "",
              given: "", startTime: "", endTime: "", notGivenReason: "", infusionReaction: ""
            }));
            const currentDrugs = formData.partC.drugs || [];
            if (currentDrugs.length === 1 && !currentDrugs[0].name && !currentDrugs[0].dose) {
                handleUpdate("partC", "drugs", newDrugs);
            } else {
                handleUpdate("partC", "drugs", [...currentDrugs, ...newDrugs]);
            }
          }

          setNurseNoteFillSuccess(true);
          setTimeout(() => setNurseNoteFillSuccess(false), 4000);
        } else {
          alert(json.message || "AI could not extract data from the provided text.");
        }
      } else {
        const errJson = await res.json().catch(() => ({}));
        alert(errJson.detail || "Error reaching the AI auto-fill endpoint.");
      }
    } catch (err) {
      console.error("Failed to process nurse note:", err);
      alert("Network error while processing. Please check your connection.");
    } finally {
      setIsPrefillingNurseNote(false);
    }
  };

  // ── Toxicity Assessment Dictation & AI Auto-fill State ─────────────────────
  const [toxicityTranscript, setToxicityTranscript] = useState("");
  const [isPrefillingToxicity, setIsPrefillingToxicity] = useState(false);
  const [toxicityFillSuccess, setToxicityFillSuccess] = useState(false);

  const processToxicityDictation = async () => {
    if (!toxicityTranscript.trim()) {
      alert("Please type or dictate some notes before using AI auto-fill.");
      return;
    }
    setIsPrefillingToxicity(true);
    setToxicityFillSuccess(false);
    try {
      const res = await fetch(`${API_BASE_URL}hms/users/data/context/chemo-toxicity-structure`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: toxicityTranscript })
      });
      if (res.ok) {
        const json = await res.json();
        if (json.status === "success" && json.data) {
          const d = json.data;
          let filledSomething = false;

          // 1. Toxicity Rows
          if (Array.isArray(d.toxicities) && d.toxicities.length > 0) {
            d.toxicities.forEach(t => {
              handleArrayAction("partD", "toxicities", "add", {
                id: Date.now() + Math.random(),
                cycleDay: "",
                gradingSystem: t.gradingSystem || "ctcae5",
                system: t.system || "",
                event: t.event || "",
                description: "",
                onset: t.onset || "",
                resolutionDate: t.resolutionDate || "",
                grade: t.grade || "",
                managementPlace: t.managementPlace || "",
                attribution: t.attribution || "",
              });
            });
            filledSomething = true;
          }

          // 2. Post-Chemo Management
          if (d.postChemoManagement) {
            const pcm = d.postChemoManagement;
            if (pcm.hydrationNotes && !formData.partD.monitoringPeriod) { handleUpdate("partD", "monitoringPeriod", pcm.hydrationNotes); filledSomething = true; }
            if (pcm.antiemetics && !formData.partD.sideEffectMgt) { handleUpdate("partD", "sideEffectMgt", pcm.antiemetics); filledSomething = true; }
            if (pcm.dischargeAdvice && !formData.partD.nadirLabs) { handleUpdate("partD", "nadirLabs", pcm.dischargeAdvice); filledSomething = true; }
          }

          // 3. Response Assessment
          if (d.responseAssessment) {
            const ra = d.responseAssessment;
            if (ra.recistResponse && !formData.partD.responseCriteria) { handleUpdate("partD", "responseCriteria", "recist"); filledSomething = true; }
            if (ra.radiologicResponseNotes && !formData.partD.interimImaging) { handleUpdate("partD", "interimImaging", ra.radiologicResponseNotes); filledSomething = true; }
            if (ra.clinicalResponseNotes && !formData.partD.tumorBoardReviewDetails) {
              handleUpdate("partD", "tumorBoardReviewDetails", ra.clinicalResponseNotes);
              filledSomething = true;
            }
          }

          // 4. Organ-Specific Monitoring
          if (d.organSpecificMonitoring) {
            const osm = d.organSpecificMonitoring;
            if (osm.cardiacLvef) {
              handleUpdate("partD", "organCardiac", true);
              handleUpdate("partD", "lvef", osm.cardiacLvef);
              filledSomething = true;
            }
            if (osm.pulmonaryNotes) {
              handleUpdate("partD", "organPulmonary", true);
              handleUpdate("partD", "pulmonaryTests", osm.pulmonaryNotes);
              filledSomething = true;
            }
            if (osm.neuroScore) {
              handleUpdate("partD", "organNeuro", true);
              handleUpdate("partD", "neuroAssessment", osm.neuroScore);
              filledSomething = true;
            }
          }

          // 5. Treatment-Specific Monitoring
          if (d.treatmentSpecificMonitoring) {
            const tsm = d.treatmentSpecificMonitoring;
            if (tsm.nephrotoxMonitoring) {
              handleUpdate("partD", "trtUrineProtein", true);
              handleUpdate("partD", "urineProteinDetails", tsm.nephrotoxMonitoring);
              filledSomething = true;
            }
            if (tsm.cardiotoxMonitoring) {
              handleUpdate("partD", "trtEcg", true);
              handleUpdate("partD", "ecgDetails", tsm.cardiotoxMonitoring);
              filledSomething = true;
            }
          }

          if (filledSomething) {
            setToxicityFillSuccess(true);
            setTimeout(() => setToxicityFillSuccess(false), 4000);
          } else {
            alert("No monitoring data or toxicity events extracted from the provided text.");
          }
        } else {
          alert(json.message || "AI could not extract toxicity data from the provided text.");
        }
      } else {
        const errJson = await res.json().catch(() => ({}));
        alert(errJson.detail || "Error reaching the AI auto-fill endpoint.");
      }
    } catch (err) {
      console.error("Failed to process toxicity dictation:", err);
      alert("Network error while processing. Please check your connection.");
    } finally {
      setIsPrefillingToxicity(false);
    }
  };

  // ── Discharge On Treatment (Part E) Dictation & AI Auto-fill State ───────────
  const [partETranscript, setPartETranscript] = useState("");
  const [isPrefillingPartE, setIsPrefillingPartE] = useState(false);
  const [partEFillSuccess, setPartEFillSuccess] = useState(false);

  const processPartEDictation = async () => {
    if (!partETranscript.trim()) {
      alert("Please type or dictate some notes before using AI auto-fill.");
      return;
    }
    setIsPrefillingPartE(true);
    setPartEFillSuccess(false);
    try {
      const res = await fetch(`${API_BASE_URL}hms/users/data/context/chemo-discharge-treatment-structure`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: partETranscript })
      });
      if (res.ok) {
        const json = await res.json();
        if (json.status === "success" && json.data) {
          const d = json.data;
          let filledSomething = false;

          if (d.tolerated && !formData.partE.tolerated) { handleUpdate("partE", "tolerated", d.tolerated); filledSomething = true; }
          
          if (d.watchPain !== undefined && !formData.partE.watchPain) { handleUpdate("partE", "watchPain", d.watchPain); filledSomething = true; }
          if (d.watchMotions !== undefined && !formData.partE.watchMotions) { handleUpdate("partE", "watchMotions", d.watchMotions); filledSomething = true; }
          if (d.watchConstipation !== undefined && !formData.partE.watchConstipation) { handleUpdate("partE", "watchConstipation", d.watchConstipation); filledSomething = true; }
          if (d.watchVomiting !== undefined && !formData.partE.watchVomiting) { handleUpdate("partE", "watchVomiting", d.watchVomiting); filledSomething = true; }
          if (d.watchWBC !== undefined && !formData.partE.watchWBC) { handleUpdate("partE", "watchWBC", d.watchWBC); filledSomething = true; }
          if (d.watchMouth !== undefined && !formData.partE.watchMouth) { handleUpdate("partE", "watchMouth", d.watchMouth); filledSomething = true; }
          if (d.watchIndigestion !== undefined && !formData.partE.watchIndigestion) { handleUpdate("partE", "watchIndigestion", d.watchIndigestion); filledSomething = true; }
          if (d.watchFever !== undefined && !formData.partE.watchFever) { handleUpdate("partE", "watchFever", d.watchFever); filledSomething = true; }
          
          if (d.followUpDoctor && !formData.partE.followUpDoctor) { handleUpdate("partE", "followUpDoctor", d.followUpDoctor); filledSomething = true; }
          if (d.followUpDaycare && !formData.partE.followUpDaycare) { handleUpdate("partE", "followUpDaycare", d.followUpDaycare); filledSomething = true; }
          if (d.emergencyContact && !formData.partE.emergencyContact) { handleUpdate("partE", "emergencyContact", d.emergencyContact); filledSomething = true; }
          if (d.treatmentCompletionStatus && !formData.partE.treatmentCompletionStatus) { handleUpdate("partE", "treatmentCompletionStatus", d.treatmentCompletionStatus); filledSomething = true; }
          if (d.treatmentNotCompletedReason && !formData.partE.treatmentNotCompletedReason) { handleUpdate("partE", "treatmentNotCompletedReason", d.treatmentNotCompletedReason); filledSomething = true; }
          if (d.toxicitySummaryText && !formData.partE.toxicitySummaryText) { handleUpdate("partE", "toxicitySummaryText", d.toxicitySummaryText); filledSomething = true; }

          if (d.endOfResponseTreatment && !formData.partE.endOfResponseTreatment) { handleUpdate("partE", "endOfResponseTreatment", d.endOfResponseTreatment); filledSomething = true; }
          if (d.endOfResponseDate && !formData.partE.endOfResponseDate) { handleUpdate("partE", "endOfResponseDate", d.endOfResponseDate); filledSomething = true; }
          if (d.treatmentOutcomes && !formData.partE.treatmentOutcomes) { handleUpdate("partE", "treatmentOutcomes", d.treatmentOutcomes); filledSomething = true; }
          if (d.residualToxicity && !formData.partE.residualToxicity) { handleUpdate("partE", "residualToxicity", d.residualToxicity); filledSomething = true; }

          if (d.auditPeriod && !formData.partE.auditPeriod) { handleUpdate("partE", "auditPeriod", d.auditPeriod); filledSomething = true; }
          if (d.dosingAccuracy && !formData.partE.dosingAccuracy) { handleUpdate("partE", "dosingAccuracy", d.dosingAccuracy); filledSomething = true; }
          if (d.adverseEventRate && !formData.partE.adverseEventRate) { handleUpdate("partE", "adverseEventRate", d.adverseEventRate); filledSomething = true; }
          if (d.protocolAdherence && !formData.partE.protocolAdherence) { handleUpdate("partE", "protocolAdherence", d.protocolAdherence); filledSomething = true; }
          if (d.incidentReview && !formData.partE.incidentReview) { handleUpdate("partE", "incidentReview", d.incidentReview); filledSomething = true; }

          if (Array.isArray(d.dischargeDrugs) && d.dischargeDrugs.length > 0) {
            const newDrugs = d.dischargeDrugs.map(drug => ({
              id: Date.now() + Math.random(),
              name: drug.name || "",
              route: drug.route || "",
              dosage: drug.dosage || "",
              days: drug.days || "",
              remarks: drug.remarks || "",
              source: "manual"
            }));
            
            // If there's only one empty drug, overwrite it, else append
            const currentDrugs = formData.partE.dischargeDrugs || [];
            if (currentDrugs.length === 1 && !currentDrugs[0].name && !currentDrugs[0].dosage) {
                handleUpdate("partE", "dischargeDrugs", newDrugs);
            } else {
                handleUpdate("partE", "dischargeDrugs", [...currentDrugs, ...newDrugs]);
            }
            filledSomething = true;
          }

          if (filledSomething) {
            setPartEFillSuccess(true);
            setTimeout(() => setPartEFillSuccess(false), 4000);
          } else {
            alert("No data extracted from the provided text.");
          }
        } else {
          alert(json.message || "AI could not extract data from the provided text.");
        }
      } else {
        const errJson = await res.json().catch(() => ({}));
        alert(errJson.detail || "Error reaching the AI auto-fill endpoint.");
      }
    } catch (err) {
      console.error("Failed to process dictation:", err);
      alert("Network error while processing. Please check your connection.");
    } finally {
      setIsPrefillingPartE(false);
    }
  };
  // const fetchRegimenSuggestion = async () => {
  //   setRegimenSuggestLoading(true);
  //   setRegimenSuggestError(null);
  //   try {
  //     const res = await fetch(`${API_BASE_URL}hms/users/data/context/extract-regimen-fields`, {
  //       method: "POST",
  //       headers: { "Content-Type": "application/json" },
  //       body: JSON.stringify({ patientId })
  //     });
  //     const json = await res.json();
  //     if (json.status === "success") {
  //       setRegimenSuggestion(json.data || null);
  //     } else {
  //       setRegimenSuggestError(json.detail || "Could not extract regimen fields.");
  //     }
  //   } catch (err) {
  //     console.error("[OPRecord] Regimen suggestion failed:", err);
  //     setRegimenSuggestError("Network error while fetching suggestion.");
  //   } finally {
  //     setRegimenSuggestLoading(false);
  //   }
  // };

  // const openProtocolBrowser = async () => {
  //   setProtocolDialogOpen(true);
  //   setProtocolLoading(true);
  //   try {
  //     const res = await fetch(
  //       `${API_BASE_URL}hms/users/data/protocol_master/protocol-master/list?patient_id=${patientId}`
  //     );
  //     const json = await res.json();
  //     console.log("Protocol Master list:", json);
  //     if (json.status === "success") setProtocolList(json.data);
  //   } catch (err) {
  //     console.error("Failed to load protocol list:", err);
  //   } finally {
  //     setProtocolLoading(false);
  //   }
  // };

  // const viewProtocolDetail = async (protocolId) => {
  //   setProtocolDetailOpen(true);
  //   setProtocolDetailLoading(true);
  //   setProtocolDetailError(null);
  //   setProtocolDetailData(null);
  //   setProtocolAdaptation(null);
  //   try {
  //     const [detailRes, selectRes] = await Promise.all([
  //       fetch(`${API_BASE_URL}hms/users/data/protocol_master/protocol-master/${protocolId}`).then(r => r.json()),
  //       fetch(`${API_BASE_URL}hms/users/data/protocol_master/protocol-master/select`, {
  //         method: "POST",
  //         headers: { "Content-Type": "application/json" },
  //         body: JSON.stringify({ patientId, doctorId, protocolId })
  //       }).then(r => r.json())
  //     ]);

  //     // DEBUG — inspect raw backend payloads
  //     console.log("[Protocol Master] /protocol-master/:id →", detailRes);
  //     console.log("[Protocol Master] /protocol-master/select →", selectRes);
  //     console.log("[Protocol Master] adaptedRegimen →", selectRes?.adaptedRegimen);

  //     if (detailRes.status === "success") setProtocolDetailData(detailRes.data);
  //     if (selectRes.status === "success") {
  //       setProtocolAdaptation(selectRes);
  //     } else {
  //       setProtocolDetailError(selectRes.detail || "Could not run LLM adaptation.");
  //     }
  //   } catch (err) {
  //     console.error("Protocol detail fetch failed:", err);
  //     setProtocolDetailError("Network error loading protocol details.");
  //   } finally {
  //     setProtocolDetailLoading(false);
  //   }
  // };

  // const applyProtocolData = (s) => {
  //   const formatDateForInput = (dateStr) => {
  //     if (!dateStr) return dateStr;
  //     const parts = dateStr.split('-');
  //     if (parts.length === 3 && parts[0].length === 2 && parts[1].length === 2 && parts[2].length === 4) {
  //       return `${parts[2]}-${parts[1]}-${parts[0]}`;
  //     }
  //     return dateStr;
  //   };
  //   setFormData(prev => ({
  //     ...prev,
  //     partA: {
  //       ...prev.partA,
  //       intent: s.treatmentIntent || prev.partA.intent,
  //       protocolName: s.selectedProtocol || prev.partA.protocolName,
  //       chemoType: s.typeOfChemotherapy || s.chemoType || prev.partA.chemoType,
  //       startDate: formatDateForInput(s.startDate) || prev.partA.startDate,
  //       cycles: s.plannedCycles ? String(s.plannedCycles) : prev.partA.cycles,
  //       daysBetween: s.daysBetweenCycles ? String(s.daysBetweenCycles) : prev.partA.daysBetween,
  //       protocolDetails: s.protocolDetails || prev.partA.protocolDetails,
  //       doseAdjustments: s.doseAdjustments || prev.partA.doseAdjustments,
  //       concurrentTherapy: s.concurrentTherapy || prev.partA.concurrentTherapy,
  //       protocolMasterRef: s.protocolMasterRef || prev.partA.protocolMasterRef,
  //       drugs: (s.drugs && s.drugs.length > 0)
  //         ? s.drugs.map((d, i) => ({ id: Date.now() + i, ...d }))
  //         : prev.partA.drugs
  //     }
  //   }));
  //   setProtocolDialogOpen(false);
  //   setProtocolDetailOpen(false);
  // };

  // const applyRegimenSuggestion = () => {
  //   const s = regimenSuggestion;
  //   if (!s) return;
  //   setFormData(prev => ({
  //     ...prev,
  //     partA: {
  //       ...prev.partA,
  //       intent: s.treatmentIntent || prev.partA.intent,
  //       protocolName: s.selectedProtocol || prev.partA.protocolName,
  //       startDate: s.startDate || prev.partA.startDate,
  //       cycles: s.plannedCycles ? String(s.plannedCycles) : prev.partA.cycles,
  //       daysBetween: s.daysBetweenCycles ? String(s.daysBetweenCycles) : prev.partA.daysBetween,
  //       protocolDetails: s.protocolDetails || prev.partA.protocolDetails,
  //       doseAdjustments: s.doseAdjustments || prev.partA.doseAdjustments,
  //       concurrentTherapy: s.concurrentTherapy || prev.partA.concurrentTherapy,
  //       reasonForChange: s.reasonForChange || prev.partA.reasonForChange,
  //       protocolMasterRef: s.protocolMasterRef || prev.partA.protocolMasterRef,
  //       drugs: (s.drugs && s.drugs.length > 0) ? s.drugs.map((d, i) => ({ id: Date.now() + i, ...d })) : prev.partA.drugs
  //     }
  //   }));
  // };

  const handlePrintBaselineOrder = () => {
    const printWindow = window.open('', '_blank', 'width=800,height=800');
    if (!printWindow) return;

    const patientName = formData.overview?.patientName || "Unknown Patient";
    const patientAge = formData.overview?.patientAge || "";
    const patientGender = formData.overview?.patientGender || "";
    const patientId = formData.overview?.patientId || "";
    const date = new Date().toLocaleDateString();
    const docName = fetchedDoctorName || doctorName || "Doctor";

    let testsHtml = "";
    const tests = formData.overview?.baselineInvestigations || [];
    if (tests.length > 0) {
      testsHtml = tests.map(t => `
        <tr>
          <td style="padding: 10px; border: 1px solid #ddd;">${t.testName || ""}</td>
          <td style="padding: 10px; border: 1px solid #ddd;">${t.remarks || ""}</td>
        </tr>
      `).join("");
    } else {
      testsHtml = `<tr><td colspan="2" style="padding: 10px; border: 1px solid #ddd; text-align: center;">No tests added.</td></tr>`;
    }

    const html = `
      <html>
        <head>
          <title>Baseline Investigation Order</title>
          <style>
            body { font-family: Arial, sans-serif; padding: 40px; color: #333; }
            .header { text-align: center; border-bottom: 2px solid #333; padding-bottom: 20px; margin-bottom: 30px; }
            .header h1 { margin: 0; font-size: 24px; text-transform: uppercase; letter-spacing: 1px; }
            .patient-details { display: flex; justify-content: space-between; margin-bottom: 30px; background: #f9f9f9; padding: 15px; border-radius: 4px; }
            .patient-details div { font-size: 14px; line-height: 1.6; }
            table { width: 100%; border-collapse: collapse; margin-top: 20px; }
            th { background: #f0f0f0; padding: 12px; text-align: left; border: 1px solid #ddd; font-weight: bold; }
            .footer { margin-top: 50px; text-align: right; font-size: 14px; display: flex; justify-content: space-between; align-items: flex-end; }
            .signature { border-top: 1px solid #333; padding-top: 5px; width: 200px; text-align: center; }
          </style>
        </head>
        <body>
          <div class="header">
            <h1>Investigation Order</h1>
            <div style="font-size: 14px; color: #666; margin-top: 5px;">Dr. ${docName}</div>
          </div>
          <div class="patient-details">
            <div>
              <strong>Patient Name:</strong> ${patientName}<br/>
              <strong>Age / Gender:</strong> ${patientAge} / ${patientGender}<br/>
              <strong>Patient ID:</strong> ${patientId}
            </div>
            <div>
              <strong>Date:</strong> ${date}
            </div>
          </div>
          <h3>Requested Tests</h3>
          <table>
            <thead>
              <tr>
                <th style="width: 40%">Test Name</th>
                <th style="width: 60%">Remarks / Instructions</th>
              </tr>
            </thead>
            <tbody>
              ${testsHtml}
            </tbody>
          </table>
          <div class="footer">
            <div style="text-align: left; color: #666; font-size: 12px;">Printed via DrAssist</div>
            <div class="signature">Doctor's Signature</div>
          </div>
          <script>
            window.onload = () => {
              window.print();
              setTimeout(() => window.close(), 500);
            };
          </script>
        </body>
      </html>
    `;

    printWindow.document.write(html);
    printWindow.document.close();
  };

  const handleDownloadRegimenPDF = () => {
    if (!chemoRegimenData) return;
    const printWindow = window.open('', '_blank', 'width=850,height=1000');
    if (!printWindow) return;

    const data = chemoRegimenData;
    const patientName = formData.overview?.patientName || "Unknown Patient";
    const patientAge = formData.overview?.patientAge || "";
    const patientGender = formData.overview?.patientGender || "";
    const pId = formData.overview?.patientId || patientId || "";
    const docName = fetchedDoctorName || doctorName || "Doctor";
    const today = new Date().toLocaleDateString('en-GB', { day: '2-digit', month: 'long', year: 'numeric' });

    const cycleSchedule = computeCycleSchedule(data.startDate, data.plannedCycles, data.daysBetweenCycles);
    const drugNamesJoined = (data.drugSchedule || []).map(d => d.name).filter(Boolean).join(", ") || "—";

    const drugRows = (data.drugSchedule || []).map(d => `
      <tr>
        <td>${d.name || "—"}</td>
        <td>${d.dose ? `${d.dose} ${d.unit || ""}`.trim() : "—"}</td>
        <td>${d.route || "—"}</td>
        <td>Day ${d.day || "—"}</td>
        <td>${d.adminType || "—"}</td>
        <td>${d.duration ? `${d.duration} min` : "—"}</td>
      </tr>
    `).join("");

    const cycleRows = cycleSchedule.map(c => `
      <tr>
        <td>Cycle ${c.cycleNum}</td>
        <td>${formatDateDisplay(c.date)}</td>
        <td>${drugNamesJoined}</td>
      </tr>
    `).join("");

    const listItem = (arr) => (arr && arr.length ? arr.map(x => `<li>${x}</li>`).join("") : `<li style="color:#999;">None specified</li>`);

    const html = `
      <html>
        <head>
          <title>Chemotherapy Treatment Plan - ${patientName}</title>
          <meta charset="utf-8" />
          <style>
            * { box-sizing: border-box; }
            body { font-family: 'Segoe UI', Arial, sans-serif; padding: 48px; color: #1a1a1a; line-height: 1.5; }
            .header { text-align: center; border-bottom: 3px solid #000; padding-bottom: 18px; margin-bottom: 28px; }
            .header h1 { margin: 0; font-size: 22px; letter-spacing: 1px; text-transform: uppercase; }
            .header .sub { font-size: 12px; color: #666; margin-top: 4px; letter-spacing: 0.5px; }
            .meta-bar { display: flex; justify-content: space-between; background: #f7f7f7; border: 1px solid #ddd; padding: 14px 18px; margin-bottom: 24px; font-size: 12.5px; }
            .meta-bar div { line-height: 1.7; }
            .meta-bar b { color: #000; }
            .section-title { font-size: 12px; font-weight: 700; text-transform: uppercase; letter-spacing: 1px; background: #000; color: #fff; padding: 7px 14px; margin: 26px 0 0 0; }
            table { width: 100%; border-collapse: collapse; margin-bottom: 6px; }
            th { background: #f0f0f0; padding: 9px 12px; text-align: left; border: 1px solid #ccc; font-size: 11px; text-transform: uppercase; letter-spacing: 0.4px; }
            td { padding: 9px 12px; border: 1px solid #ddd; font-size: 12.5px; }
            .info-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 0; border: 1px solid #ddd; border-top: none; }
            .info-row { display: contents; }
            .info-label { background: #fafafa; padding: 9px 14px; font-size: 11px; font-weight: 600; color: #555; border-top: 1px solid #ddd; border-right: 1px solid #ddd; text-transform: uppercase; letter-spacing: 0.3px; }
            .info-value { padding: 9px 14px; font-size: 12.5px; border-top: 1px solid #ddd; }
            .two-col { display: flex; gap: 24px; margin-top: 10px; }
            .two-col > div { flex: 1; }
            .list-box { border: 1px solid #ddd; padding: 10px 16px; font-size: 12px; }
            .list-box ul { margin: 6px 0 0 0; padding-left: 18px; }
            .footer { margin-top: 50px; display: flex; justify-content: space-between; align-items: flex-end; font-size: 11.5px; color: #555; }
            .signature { border-top: 1px solid #333; padding-top: 6px; width: 220px; text-align: center; }
            .disclaimer { margin-top: 30px; font-size: 10.5px; color: #888; border-top: 1px dashed #ccc; padding-top: 10px; }
            .safety { margin-top: 16px; padding: 12px 16px; background: #fff4f4; border: 1px solid #e57373; font-size: 12px; color: #b71c1c; }
          </style>
        </head>
        <body>
          <div class="header">
            <h1>Chemotherapy Treatment Plan</h1>
            <div class="sub">Prepared by Dr. ${docName}${doctorSpeciality ? ` · ${doctorSpeciality}` : ""}</div>
          </div>

          <div class="meta-bar">
            <div>
              <div><b>Patient Name:</b> ${patientName}</div>
              <div><b>Age / Gender:</b> ${patientAge || "—"} / ${patientGender || "—"}</div>
              <div><b>Patient ID:</b> ${pId}</div>
            </div>
            <div style="text-align:right;">
              <div><b>Date Prepared:</b> ${today}</div>
              <div><b>Protocol:</b> ${data.protocolName || data.selectedProtocol || "—"}</div>
              <div><b>Treatment Intent:</b> ${data.treatmentIntent || "—"}</div>
            </div>
          </div>

          <div class="section-title">Protocol Overview</div>
          <div class="info-grid">
            <div class="info-row">
              <div class="info-label">Selected Protocol</div><div class="info-value">${data.selectedProtocol || "—"}</div>
              <div class="info-label">Type of Chemotherapy</div><div class="info-value">${data.typeOfChemotherapy || "—"}</div>
            </div>
            <div class="info-row">
              <div class="info-label">Start Date</div><div class="info-value">${data.startDate || "—"}</div>
              <div class="info-label">Planned Cycles</div><div class="info-value">${data.plannedCycles || "—"}</div>
            </div>
            <div class="info-row">
              <div class="info-label">Cycle Interval</div><div class="info-value">Every ${data.daysBetweenCycles || "—"} days</div>
              <div class="info-label">Protocol Reference</div><div class="info-value">${data.protocolMasterRef || "—"}</div>
            </div>
            <div class="info-row">
              <div class="info-label">Protocol Details</div><div class="info-value" style="grid-column: span 3;">${data.protocolDetails || "—"}</div>
            </div>
            <div class="info-row">
              <div class="info-label">Dose Adjustments</div><div class="info-value">${data.doseAdjustments || "None"}</div>
              <div class="info-label">Concurrent Therapy</div><div class="info-value">${data.concurrentTherapy || "None"}</div>
            </div>
          </div>

          <div class="section-title">Drug Schedule (Per Cycle)</div>
          <table>
            <thead><tr><th>Drug</th><th>Dose</th><th>Route</th><th>Day</th><th>Admin Type</th><th>Duration</th></tr></thead>
            <tbody>${drugRows || `<tr><td colspan="6" style="text-align:center;color:#999;">No drug schedule available</td></tr>`}</tbody>
          </table>

          <div class="section-title">Projected Cycle Schedule</div>
          <table>
            <thead><tr><th style="width:15%">Cycle</th><th style="width:25%">Planned Date</th><th>Drugs</th></tr></thead>
            <tbody>${cycleRows || `<tr><td colspan="3" style="text-align:center;color:#999;">Not enough data to project schedule</td></tr>`}</tbody>
          </table>

          <div class="two-col">
            <div class="list-box">
              <b>Premedications</b>
              <ul>${listItem(data.premedications)}</ul>
            </div>
            <div class="list-box">
              <b>Laboratory Requirements</b>
              <ul>${listItem(data.laboratoryRequirements)}</ul>
            </div>
          </div>
          <div class="two-col">
            <div class="list-box">
              <b>Hydration</b>
              <ul>${listItem(data.hydration)}</ul>
            </div>
            <div class="list-box">
              <b>Supportive Care</b>
              <ul>${listItem(data.supportiveCare)}</ul>
            </div>
          </div>

          ${data.safetyFlags?.length ? `
          <div class="safety">
            <b>⚠ Safety Flags:</b>
            <ul>${listItem(data.safetyFlags)}</ul>
          </div>` : ""}

          <div class="footer">
            <div>
              Generated via DoctorAssist.AI EMR<br/>
              This document is intended for patient reference and clinical continuity.
            </div>
            <div class="signature">Dr. ${docName}<br/>Attending Physician</div>
          </div>

          <div class="disclaimer">
            This treatment plan is subject to change based on clinical response, laboratory results, and physician discretion at each visit. Please bring this document to every chemotherapy session.
          </div>

          <script>
            window.onload = () => {
              window.print();
            };
          </script>
        </body>
      </html>
    `;

    printWindow.document.write(html);
    printWindow.document.close();
  };

  useEffect(() => {
    if (!doctorId) return;
    const fetchDocName = async () => {
      try {
        const res = await fetch(`${API_BASE_URL}hms/users/doctors/get_doctor/${doctorId}`);
        if (res.ok) {
          const json = await res.json();
          const docData = json?.data || json?.doctor || json;
          const name = docData?.name || docData?.doctor_name || `${docData?.first_name || ""} ${docData?.last_name || ""}`.trim();
          if (name) {
            setFetchedDoctorName(name);
          }
          if (docData?.hospital_id) {
            setActualHospitalId(docData.hospital_id);
          }
        }
      } catch (e) {
        console.error("Failed to fetch doctor name", e);
      }
    };
    fetchDocName();
  }, [doctorId]);

  useEffect(() => {
    const fetchAllDoctors = async () => {
      if (!actualHospitalId) return;
      try {
        const res = await fetch(`${API_BASE_URL}hms/users/data/context/get_doctors_by_hospital/${actualHospitalId}`);
        if (res.ok) {
          const json = await res.json();
          if (Array.isArray(json)) {
            setAllDoctorsList(json);
          } else if (json.data && Array.isArray(json.data)) {
            setAllDoctorsList(json.data);
          }
        }
      } catch (e) {
        console.error("Failed to fetch all doctors", e);
      }
    };
    fetchAllDoctors();
  }, [actualHospitalId]);

  // ─── SAVE TO SHARED CHEMOTHERAPY RECORD ─────────────────────────────
  // Uses "refetch-before-save" pattern to avoid overwriting data that
  // ChemotherapyWorkflow may have written since OPRecord last loaded.
  //
  // Flow:
  //   1. GET latest record from DB
  //   2. Translate local partA…F → canonical via opRecordToWorkflow()
  //   3. Deep-merge translated data into the fetched record
  //   4. POST merged result to save-chemotherapy-record
  const saveFormData = async (overrideStatus = null, silent = false) => {
    if (!patientId || !doctorId) {
      alert("Patient ID and Doctor ID are required to save.");
      return;
    }

    setIsSaving(true);
    try {
      // Step 1: Refetch the latest record from the database
      let existingData = {};
      let existingTreatment = { ...treatment };
      try {
        let url = `${API_BASE_URL}hms/users/data/context/get-chemotherapy-record?patientId=${patientId}&doctorId=${doctorId}&hospitalId=${hospitalId}`;
        if (currentTreatmentId) url += `&treatmentId=${currentTreatmentId}`;
        const getRes = await fetch(url);
        if (getRes.ok) {
          const getResult = await getRes.json();
          existingData = getResult.data?.data || getResult.data || {};
          if (getResult.data?.treatment && Object.keys(getResult.data.treatment).length > 0) {
            existingTreatment = getResult.data.treatment;
          }
        }
      } catch (fetchErr) {
        // If refetch fails, proceed with what we have — better to save
        // than to lose the user's work
        console.warn("[OPRecord] Refetch before save failed, proceeding:", fetchErr);
      }

      // Step 2: Translate OPRecord's partA…F into canonical DB shape
      const formDataWithDoc = {
        ...formData,
        partB: {
          ...formData.partB,
          consultantName: formData.partB.consultantName || fetchedDoctorName || doctorName || ""
        }
      };

      const { formData: translatedData, treatmentUpdates } = opRecordToWorkflow(
        formDataWithDoc,
        existingTreatment,
        existingData,
        activeEditCycle || existingTreatment.currentCycle || treatment.currentCycle || 1
      );

      // Step 3: Deep-merge — OPRecord's translated sections overwrite the
      // corresponding sections in the DB, but sections OPRecord doesn't
      // touch (like cycle_admin data from ChemotherapyWorkflow) are preserved.
      const mergedData = { ...existingData };

      // Merge patient-scoped sections (flat)
      ["summary", "assessment", "completion", "qa", "final_summary"].forEach(section => {
        if (translatedData[section]) {
          mergedData[section] = {
            ...(existingData[section] || {}),
            ...translatedData[section]
          };
        }
      });

      // Merge cycle-scoped sections (nested under cycles[N])
      if (translatedData.cycles) {
        mergedData.cycles = { ...(existingData.cycles || {}) };
        Object.keys(translatedData.cycles).forEach(cycleKey => {
          mergedData.cycles[cycleKey] = { ...(mergedData.cycles[cycleKey] || {}) };
          const translatedCycle = translatedData.cycles[cycleKey];
          Object.keys(translatedCycle).forEach(section => {
            // Don't overwrite cycle_admin — that's ChemotherapyWorkflow's territory
            if (section === "cycle_admin" && mergedData.cycles[cycleKey][section]) {
              // Merge carefully: OPRecord fields + existing Workflow fields
              mergedData.cycles[cycleKey][section] = {
                ...(mergedData.cycles[cycleKey][section] || {}),
                ...translatedCycle[section]
              };
            } else {
              mergedData.cycles[cycleKey][section] = {
                ...(mergedData.cycles[cycleKey][section] || {}),
                ...translatedCycle[section]
              };
            }
          });
        });
      }

      // Step 3b: Merge treatment updates (e.g., plannedCycles from partA)
      const mergedTreatment = {
        ...existingTreatment,
        ...treatmentUpdates
      };

      // Step 3c: Physically delete any cycles that are strictly greater than the new plannedCycles
      // (The user has already passed a window.confirm warning in the UI before reducing the number)
      if (mergedTreatment.plannedCycles) {
        const planned = parseInt(mergedTreatment.plannedCycles);

        if (mergedData.cycles) {
          Object.keys(mergedData.cycles).forEach(cycleKey => {
            if (parseInt(cycleKey) > planned) {
              delete mergedData.cycles[cycleKey];
            }
          });
        }

        // Cap completedCycles at plannedCycles, but do NOT auto-mark overall treatment complete.
        // Overall completion is a clinical decision on Discharge (On Treatment).
        if ((mergedTreatment.completedCycles || 0) >= planned) {
          mergedTreatment.completedCycles = planned;
          mergedTreatment.currentCycle = planned;
          const explicitStatus = formData?.partE?.treatmentCompletionStatus;
          if (explicitStatus === "completed") {
            mergedTreatment.status = "all_cycles_completed";
            mergedTreatment.treatmentCompleted = true;
          } else if (explicitStatus === "not-completed") {
            mergedTreatment.status = "treatment_not_completed";
            mergedTreatment.treatmentCompleted = false;
          } else {
            // All cycles done, awaiting discharge decision
            mergedTreatment.status = mergedTreatment.status === "all_cycles_completed" || mergedTreatment.treatmentCompleted
              ? mergedTreatment.status
              : "awaiting_treatment_completion_decision";
            // Keep treatmentCompleted only if already explicitly completed; never force true here
            if (mergedTreatment.status !== "all_cycles_completed") {
              mergedTreatment.treatmentCompleted = false;
            }
          }
        }
      }

      // Step 4: POST the merged result
      const saveRes = await fetch(
        `${API_BASE_URL}hms/users/data/context/save-chemotherapy-record`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            doctorId,
            patientId,
            hospitalId: actualHospitalId || hospitalId || "",
            treatmentId: currentTreatmentId,
            status: overrideStatus || currentTreatmentStatus,
            formData: mergedData,
            treatment: mergedTreatment
          })
        }
      );

      if (saveRes.ok) {
        const result = await saveRes.json();
        if (result.treatmentId) {
          setCurrentTreatmentId(result.treatmentId);
        }

        // Update local state with the latest merged data so UI stays in sync when switching cycles
        setTreatment(mergedTreatment);
        setRawDbData(mergedData);
        if (mergedData.cycles) {
          setDbCycles(mergedData.cycles);
        }
        if (!silent) alert("OP Record saved successfully!");
      } else {
        if (!silent) alert("Failed to save OP Record. Please try again.");
      }
    } catch (err) {
      console.error("[OPRecord] Save failed:", err);
      if (!silent) alert("An error occurred while saving. Please try again.");
    } finally {
      setIsSaving(false);
    }
  };

  const handleUpdate = (tab, field, value) => {
    setFormData(prev => ({
      ...prev,
      [tab]: {
        ...prev[tab],
        [field]: value
      }
    }));
  };

  const populateLatestLabs = () => {
    let labs = allCompleted.filter(inv =>
      !(inv.investigation || inv.investigation_type || "").toLowerCase().includes("radiology") &&
      Array.isArray(inv.parameterwise_content) &&
      inv.parameterwise_content.length > 0
    );

    if (activeEditCycle) {
      const cycleLabs = labs.filter(inv => String(getCycleNumberForDate(inv.date_of_order, dbCycles)) === String(activeEditCycle));
      if (cycleLabs.length > 0) {
        labs = cycleLabs;
      }
    }

    if (labs.length === 0) {
      alert("No extracted lab values found for this cycle.");
      return;
    }

    const latestLab = labs[0];
    const extractedText = latestLab.parameterwise_content.map(p => {
      const name = p.parameter_name || "Unknown";
      const val = p.content || p.value_and_unit || "—";
      return `${name}: ${val}`;
    }).filter(Boolean).join("\n");

    const existing = formData.partB.currentLabs || "";
    const newText = existing ? existing + "\n\n" + extractedText : extractedText;
    handleUpdate("partB", "currentLabs", newText);
  };

  const generateFinalSummary = () => {
    let assessment = "";

    // 1. Patient Demographics & Diagnosis
    const ageGender = [];
    if (formData.overview?.patientAge) ageGender.push(`${formData.overview.patientAge}-year-old`);
    if (formData.overview?.patientGender) ageGender.push(formData.overview.patientGender);
    const demographicStr = ageGender.length > 0 ? `This is a ${ageGender.join(" ")} patient` : "The patient";

    if (formData.overview?.patientDiagnosis) {
      assessment += `${demographicStr} diagnosed with ${formData.overview.patientDiagnosis}. `;
    } else {
      assessment += `${demographicStr}. `;
    }

    if (formData.overview?.diseaseStatus) {
      assessment += `Current disease status: ${formData.overview.diseaseStatus}. `;
    }

    // 2. Treatment Regimen & Progress
    const completedCycles = Object.keys(dbCycles || {}).length;
    const totalCycles = formData.partA?.cycles || "planned";
    const regimen = formData.partA?.protocolName || formData.partA?.regimenName || "chemotherapy";

    if (completedCycles > 0) {
      assessment += `\n\nTreatment Course:\nThe patient has successfully completed ${completedCycles} out of ${totalCycles} cycles of ${regimen}. `;

      const cycleDetails = [];
      Object.keys(dbCycles || {}).sort((a, b) => parseInt(a) - parseInt(b)).forEach(cycleNum => {
        const cData = dbCycles[cycleNum];
        const date = cData.overview?.date || cData.overview?.visitDate || cData.regimen?.startDate || "Date not specified";
        const toxicity = cData.toxicity?.observedToxicities || [];
        let toxString = "No toxicities reported";
        if (Array.isArray(toxicity) && toxicity.length > 0) {
          const toxItems = toxicity.map(t => {
            let s = t.name || "Unknown";
            if (t.grade) s += ` (Grade ${t.grade})`;
            return s;
          }).filter(Boolean);
          if (toxItems.length > 0) toxString = toxItems.join(", ");
        }
        cycleDetails.push(`  • Cycle ${cycleNum} (${date}): Toxicities - ${toxString}`);
      });
      if (cycleDetails.length > 0) {
        assessment += `\nCycle-by-cycle summary:\n${cycleDetails.join("\n")}\n`;
      }
    }

    // 3. Overall Toxicities Summary
    const toxicities = [];
    Object.values(dbCycles || {}).forEach(cycle => {
      const tox = cycle.toxicity?.observedToxicities || [];
      if (Array.isArray(tox)) {
        tox.forEach(t => {
          if (t.name && !toxicities.includes(t.name)) toxicities.push(t.name);
        });
      }
    });
    if (toxicities.length > 0) {
      assessment += `During the course of treatment, the following toxicities were noted: ${toxicities.join(", ")}. `;
    }

    // 4. Imaging & Response
    if (formData.partD?.interimImaging || formData.partD?.responseCriteria || formData.partD?.tumorBoardReview === "yes") {
      assessment += `\n\nResponse Assessment:\n`;
      if (formData.partD?.interimImaging) {
        assessment += `Interim imaging details: ${formData.partD.interimImaging} `;
      }
      if (formData.partD?.responseCriteria) {
        assessment += `(Criteria used: ${formData.partD.responseCriteria.toUpperCase()}). `;
      }
      if (formData.partD?.tumorBoardReview === "yes" && formData.partD?.tumorBoardReviewDetails) {
        assessment += `\nTumor Board Review: ${formData.partD.tumorBoardReviewDetails}.`;
      }
    }

    // Recommendations
    let recommendation = "";

    if (formData.overview?.intentOfTreatment) {
      recommendation += `Treatment Intent: ${formData.overview.intentOfTreatment}\n\n`;
    }

    if (formData.partB?.futureCarePlan) {
      recommendation += `Future Care Plan:\n${formData.partB.futureCarePlan}\n\n`;
    }

    recommendation += `Recommendations:\n- Continue follow-up as per standard oncology guidelines.\n- Monitor for any delayed toxicities or recurrence.\n- Recommend routine surveillance imaging as clinically indicated.`;

    if (formData.partF?.endOfResponseDate) {
      recommendation += `\n\nEnd of treatment response date: ${formData.partF.endOfResponseDate}`;
    }

    handleUpdate("partF", "overallAssessment", assessment.trim());
    handleUpdate("partF", "recommendations", recommendation.trim());
  };

  const handleArrayUpdate = (tab, field, index, key, value) => {
    setFormData(prev => {
      const newArray = [...prev[tab][field]];
      newArray[index] = { ...newArray[index], [key]: value };
      return { ...prev, [tab]: { ...prev[tab], [field]: newArray } };
    });
  };

  const handleArrayAction = (tab, field, action, payload) => {
    setFormData(prev => {
      const newArray = [...prev[tab][field]];
      if (action === "add") newArray.push(payload);
      if (action === "remove") newArray.splice(payload, 1);
      return { ...prev, [tab]: { ...prev[tab], [field]: newArray } };
    });
  };

  // ─── TOXICITY SUMMARY (AI-generated via backend LLM) ─────────────────
  // Calls the /generate-toxicity-summary endpoint which reads toxicities
  // from the RadiationTherapyWorkflow and generates a clinical narrative.
  const fetchToxicitySummary = async () => {
    if (!patientId) return;
    setToxicitySummaryLoading(true);
    setToxicitySummaryError(null);
    try {
      const res = await fetch(`${API_BASE_URL}hms/users/data/context/generate-chemo-toxicity-summary`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ patientId })
      });
      const json = await res.json();
      if (json.status === "success" && json.summary) {
        handleUpdate("partE", "toxicitySummaryText", json.summary);
      } else {
        setToxicitySummaryError(json.detail || "Could not generate toxicity summary.");
      }
    } catch (err) {
      console.error("[OPRecord] Toxicity summary fetch failed:", err);
      setToxicitySummaryError("Network error while generating toxicity summary.");
    } finally {
      setToxicitySummaryLoading(false);
    }
  };

  // ─── AUTO-POPULATE ────────────────────────────────────────────────
  useEffect(() => {
    const autoPopulate = async () => {
      if (!formData.overview.patientId) return;
      try {
        const res = await fetch(`${API_BASE_URL}hms/users/data/context/get-patient-info?patient_id=${formData.overview.patientId}`);
        if (res.ok) {
          const data = await res.json();
          setFormData(prev => ({
            ...prev,
            overview: {
              ...prev.overview,
              patientName: prev.overview.patientName || data.patient_name || "",
              patientAge: prev.overview.patientAge || data.age?.toString() || "",
              patientGender: prev.overview.patientGender || (data.gender || "").toLowerCase(),
              patientDiagnosis: prev.overview.patientDiagnosis || data.diagnosis || data.disease_name || ""
            }
          }));
        }
      } catch (err) {
        console.error("[OPRecord] autoPopulate fetch:", err);
      }
    };

    const timer = setTimeout(() => {
      autoPopulate();
    }, 500);
    return () => clearTimeout(timer);
  }, [formData.overview.patientId]);

  useEffect(() => {
    if (patientId && formData.overview.patientId !== patientId) {
      handleUpdate("overview", "patientId", patientId);
    }
  }, [patientId]);

  // Fetch Tumor Board Plan
  useEffect(() => {
    const loadTumorBoardPlan = async () => {
      if (!patientId) return;
      try {
        const tbRes = await fetch(`${API_BASE_URL}hms/users/data/context/get-tumor-board-plan?patientId=${patientId}`);
        if (tbRes.ok) {
          const tbJson = await tbRes.json();
          if (tbJson.status === "success" && tbJson.data) {
            setFormData(prev => {
              let newTbPastDecision = prev.overview.tbPastDecision;
              if (!newTbPastDecision && tbJson.data.care_pathway_plan?.mdt_basis_summary) {
                newTbPastDecision = tbJson.data.care_pathway_plan.mdt_basis_summary;
              }

              return {
                ...prev,
                overview: {
                  ...prev.overview,
                  tumorBoardPlanData: tbJson.data,
                  tbPastDecision: newTbPastDecision
                }
              };
            });
          }
        }
      } catch (err) {
        console.error("Failed to load tumor board plan:", err);
      }
    };
    loadTumorBoardPlan();
  }, [patientId]);

  // Fetch Surgery Summary
  useEffect(() => {
    const loadSurgerySummary = async () => {
      if (!patientId) return;
      try {
        const res = await fetch(`${API_BASE_URL}hms/users/data/context/get-patient-surgery-summary-oprecord?patientId=${patientId}`);
        if (res.ok) {
          const json = await res.json();
          if (json.status === "success" && json.data) {
            setFormData(prev => ({
              ...prev,
              surgery_import: json.data
            }));
          }
        }
      } catch (err) {
        console.error("Failed to load surgery summary:", err);
      }
    };
    loadSurgerySummary();
  }, [patientId]);

  // ─── LOAD PROTOCOL MASTER PREFILL ───────────────────────────────
  useEffect(() => {
    const loadProtocolMasterPrefill = async () => {
      if (!patientId || activeTab !== "partA") return;
      console.log(`[Protocol Master Prefill] Fetching prefill data for patient ${patientId}...`);
      try {
        const url = `${API_BASE_URL}hms/users/data/context/protocol-master/prefill/${patientId}?doctor_id=${doctorId || ""}&department=${encodeURIComponent(doctorSpeciality || "")}&encounter_type=chemotherapy`;
        const res = await fetch(url);
        if (res.ok) {
          const json = await res.json();
          console.log("[Protocol Master Prefill] API Response:", json);
          if (json.status === "success" && json.data) {
            console.log("[Protocol Master Prefill] Successfully received data, merging with form...");
            setFormData(prev => {
              const newPartA = { ...prev.partA };
              const prefill = json.data;

              const fields = [
                "intent", "chemoType", "protocolName", "startDate", "cycles", "daysBetween",
                "protocolDetails", "doseAdjustments", "concurrentTherapy",
                "reasonForChange", "protocolMasterRef"
              ];

              let updated = false;
              fields.forEach(field => {
                if (prefill[field] && (!newPartA[field] || String(newPartA[field]).trim() === "")) {
                  newPartA[field] = prefill[field];
                  updated = true;
                }
              });


              if (updated) {
                console.log("[Protocol Master Prefill] Form data updated with prefill values.");
                return { ...prev, partA: newPartA };
              }
              console.log("[Protocol Master Prefill] No empty fields to update.");
              return prev;
            });
          }
        }
      } catch (err) {
        console.error("[Protocol Master Prefill] Failed to load prefill:", err);
      }
    };
    loadProtocolMasterPrefill();
  }, [patientId, doctorId, activeTab]);

  // ─── LOAD EXISTING CHEMOTHERAPY RECORD ─────────────────────────────
  // Fetches the shared chemotherapy record from the database on mount.
  // If data exists (from a prior OPRecord save or ChemotherapyWorkflow save),
  // it uses workflowToOPRecord() to convert the canonical DB shape back into
  // OPRecord's partA…F form fields.
  useEffect(() => {
    const loadChemoRecord = async () => {
      if (!patientId || !doctorId) return;
      try {
        let url = `${API_BASE_URL}hms/users/data/context/get-chemotherapy-record?patientId=${patientId}&doctorId=${doctorId}&hospitalId=${hospitalId}`;
        if (currentTreatmentId) {
          url += `&treatmentId=${currentTreatmentId}`;
        }
        const res = await fetch(url);
        if (!res.ok) return;

        const result = await res.json();
        const dbData = result.data || {};
        const dbTreatment = result.treatment || {};

        if (result.treatmentId) setCurrentTreatmentId(result.treatmentId);
        if (result.treatmentStatus) setCurrentTreatmentStatus(result.treatmentStatus);

        // Only hydrate if the DB actually has data
        if (Object.keys(dbData).length === 0) {
          setRawDbData({});
          setDbCycles({});
          return;
        }
        setRawDbData(dbData);

        // Store the treatment metadata (needed for cycle targeting on save)
        if (Object.keys(dbTreatment).length > 0) {
          setTreatment(dbTreatment);
        }

        // Store raw cycles for history tables
        if (dbData.cycles) {
          const cycles = { ...dbData.cycles };
          if (cycles["1"]) {
            cycles["1"] = {
              ...cycles["1"],
              assessment: { ...(dbData.assessment || {}), ...(cycles["1"].assessment || {}) },
              details: { ...(dbData.details || {}), ...(cycles["1"].details || {}) },
              regimen: { ...(dbData.regimen || {}), ...(cycles["1"].regimen || {}) },
              pre_chemo: { ...(dbData.pre_chemo || {}), ...(cycles["1"].pre_chemo || {}) },
              prep: { ...(dbData.prep || {}), ...(cycles["1"].prep || {}) },
              admin: { ...(dbData.admin || {}), ...(cycles["1"].admin || {}) },
              cycle_admin: { ...(dbData.cycle_admin || {}), ...(cycles["1"].cycle_admin || {}) },
              post_chemo: { ...(dbData.post_chemo || {}), ...(cycles["1"].post_chemo || {}) },
              response: { ...(dbData.response || {}), ...(cycles["1"].response || {}) },
              completion: { ...(dbData.completion || {}), ...(cycles["1"].completion || {}) },
              qa: { ...(dbData.qa || {}), ...(cycles["1"].qa || {}) },
              final_summary: { ...(dbData.final_summary || {}), ...(cycles["1"].final_summary || {}) }
            };
          }
          setDbCycles(cycles);
        }

        // Convert canonical DB shape → OPRecord's partA…F shape
        const editCycleNum = activeEditCycle || dbTreatment.currentCycle || 1;
        if (!activeEditCycle) setActiveEditCycle(editCycleNum);

        const opData = workflowToOPRecord(dbData, dbTreatment, editCycleNum);

        // Merge into formData, preserving any fields that the crosswalk
        // doesn't cover (defensive — avoids losing data)
        setFormData(prev => {
          const merged = { ...prev };
          Object.keys(opData).forEach(section => {
            const mergedSection = {
              ...prev[section],
              ...opData[section]
            };

            // Protect demographics from being wiped by empty strings in the chemo record
            if (section === "overview") {
              mergedSection.patientName = opData[section].patientName || prev[section].patientName;
              mergedSection.patientAge = opData[section].patientAge || prev[section].patientAge;
              mergedSection.patientGender = opData[section].patientGender || prev[section].patientGender;
              mergedSection.patientDiagnosis = opData[section].patientDiagnosis || prev[section].patientDiagnosis;
            }

            merged[section] = mergedSection;
          });
          return merged;
        });

        console.log("[OPRecord] Loaded existing chemotherapy record");
      } catch (err) {
        console.error("[OPRecord] Failed to load chemotherapy record:", err);
      }
    };
    loadChemoRecord();
  }, [patientId, doctorId, hospitalId, currentTreatmentId]);

  // Fetch Treatment History
  useEffect(() => {
    const fetchHistory = async () => {
      if (!patientId || !doctorId) return;
      try {
        const res = await fetch(`${API_BASE_URL}hms/users/data/context/get-patient-chemotherapy-history?patientId=${patientId}&doctorId=${doctorId}`);
        if (res.ok) {
          const data = await res.json();
          let hist = data.history || [];

          // Filter out empty/dummy records without a start date
          hist = hist.filter(h =>
            h.startDate && h.startDate !== "Unknown Date" && h.startDate.trim() !== ""
          );

          // Sort descending by startDate (newest first)
          hist.sort((a, b) => new Date(b.startDate || 0) - new Date(a.startDate || 0));

          setTreatmentHistory(hist);
        }
      } catch (err) {
        console.error("Failed to fetch treatment history", err);
      }
    };
    fetchHistory();
  }, [patientId, doctorId, currentTreatmentId]);

  // Fetch Consultation Summary (from Dictation)
  useEffect(() => {
    const fetchConsultationSummary = async () => {
      if (!patientId) return;
      setLoadingConsultationSummary(true);
      try {
        const res = await fetch(`${API_BASE_URL}hms/users/data/context/get_dictation_by_patient?patient_id=${patientId}&department=${encodeURIComponent(doctorSpeciality || "")}&encounter_type=chemotherapy`);
        if (res.ok) {
          const json = await res.json();
          if (json.status === "success" && json.data && json.data.length > 0) {
            const latestDictation = json.data[0];
            let transcriptText = "";

            if (latestDictation.conversation) {
              const conv = latestDictation.conversation;
              if (Array.isArray(conv) && conv.length > 0) {
                transcriptText = conv[0].text || "";
              } else if (typeof conv === 'object') {
                transcriptText = conv.text || "";
              } else if (typeof conv === 'string') {
                transcriptText = conv;
              }
            } else if (latestDictation.raw_data) {
              const raw = latestDictation.raw_data;
              if (Array.isArray(raw) && raw.length > 0) {
                transcriptText = raw[0].content || "";
              }
            }

            setConsultationSummary(transcriptText);
          }
        }
      } catch (err) {
        console.error("Failed to fetch dictation for summary", err);
      } finally {
        setLoadingConsultationSummary(false);
      }
    };
    fetchConsultationSummary();
  }, [patientId]);

  // Fetch Chemotherapy Regimen Summary (for Doctor's Notes tab)
  useEffect(() => {
    const fetchChemoRegimen = async () => {
      if (!patientId || !doctorId) return;
      setChemoRegimenLoading(true);
      setChemoRegimenError(null);
      try {
        const res = await fetch(
          `${API_BASE_URL}hms/users/data/context/chemotherapy-regimen/${patientId}/${doctorId}`
        );
        const json = await res.json();
        if (json.status === "success" && json.data) {
          setChemoRegimenData(json.data);
        } else {
          setChemoRegimenData(null);
          setChemoRegimenError(json.message || "No regimen data found for this patient.");
        }
      } catch (err) {
        console.error("Failed to fetch chemotherapy regimen:", err);
        setChemoRegimenError("Network error while fetching regimen data.");
      } finally {
        setChemoRegimenLoading(false);
      }
    };
    fetchChemoRegimen();
  }, [patientId, doctorId]);


  // Handle cycle switching
  useEffect(() => {
    if (activeEditCycle && Object.keys(rawDbData).length > 0) {
      const opData = workflowToOPRecord(rawDbData, treatment, activeEditCycle);
      setFormData(prev => {
        const merged = { ...prev };
        Object.keys(opData).forEach(section => {
          const mergedSection = {
            ...prev[section],
            ...opData[section]
          };

          // Protect demographics from being wiped by empty strings in the chemo record
          if (section === "overview") {
            mergedSection.patientName = opData[section].patientName || prev[section].patientName;
            mergedSection.patientAge = opData[section].patientAge || prev[section].patientAge;
            mergedSection.patientGender = opData[section].patientGender || prev[section].patientGender;
            mergedSection.patientDiagnosis = opData[section].patientDiagnosis || prev[section].patientDiagnosis;
          }
          
          merged[section] = mergedSection;

          // Discharge / overall treatment completion is treatment-level, not cycle-level.
          // Preserve any in-progress discharge decision when switching cycles.
          if (section === "partE") {
            merged.partE = {
              ...merged.partE,
              treatmentCompletionStatus: prev.partE?.treatmentCompletionStatus || opData.partE?.treatmentCompletionStatus || "",
              treatmentNotCompletedReason: prev.partE?.treatmentNotCompletedReason || opData.partE?.treatmentNotCompletedReason || "",
              treatmentNotCompletedNotes: prev.partE?.treatmentNotCompletedNotes || opData.partE?.treatmentNotCompletedNotes || "",
            };
          }
        });
        return merged;
      });
    }
  }, [activeEditCycle, rawDbData, treatment]);

  // Determine how many cycles to show in history tables
  // We filter out any "ghost" cycles from the DB that are strictly greater than planned AND completed cycles.
  const planned = parseInt(formData?.partA?.cycles) || treatment.plannedCycles || 1;
  const validDbKeys = Object.keys(rawDbData?.cycles || {}).map(Number).filter(k => k <= planned || k <= (treatment.completedCycles || 0));
  const displayCycles = Math.max(treatment.completedCycles || 0, validDbKeys.length);

  const currentCycleForAlerts = activeEditCycle || treatment?.currentCycle || 1;
  const currentPlanDrugs = [
    ...(formData.partA?.drugs || []),
    ...(formData.partC?.drugs || []),
    ...(formData.partB?.medDrugName ? [{ name: formData.partB.medDrugName }] : []),
  ];
  const pastAdverseEventsForCurrentDrugs = collectPastAdverseEventsForCurrentDrugs(
    dbCycles,
    currentCycleForAlerts,
    currentPlanDrugs
  );

  useEffect(() => {
    if (activeTab !== "partD") return;
    if (!pastAdverseEventsForCurrentDrugs.length) {
      setPastAdverseAlerts([]);
      setPastAdverseAlertOpen(false);
      return;
    }
    const signature = pastAdverseEventsForCurrentDrugs
      .map(a => `${a.cycleNum}|${normalizeDrugName(a.drug)}|${a.type}|${a.detail}`)
      .join("||");
    const ackKey = `${patientId || "p"}|${currentCycleForAlerts}|${signature}`;
    setPastAdverseAlerts(pastAdverseEventsForCurrentDrugs);
    if (!pastAdverseAckRef.current[ackKey]) {
      setPastAdverseAlertOpen(true);
    }
  }, [activeTab, patientId, currentCycleForAlerts, dbCycles, formData.partA?.drugs, formData.partB?.medDrugName, formData.partC?.drugs]);

  // Prefill Discharge Completion (partF) from prior Discharge / cycle fields
  useEffect(() => {
    if (activeTab !== "partF") return;
    setFormData(prev => {
      const e = prev.partE || {};
      const f = prev.partF || {};
      const nextF = { ...f };
      let changed = false;
      const fill = (key, fromVal) => {
        if ((!f[key] || String(f[key]).trim() === "") && fromVal) {
          nextF[key] = fromVal;
          changed = true;
        }
      };
      fill("dischargePreparedBy", e.dischargePreparedBy || fetchedDoctorName || doctorName || "");
      fill("toxicitySummaryText", e.toxicitySummaryText || "");
      fill("treatmentCompletionStatus", e.treatmentCompletionStatus || "");
      fill("treatmentNotCompletedReason", e.treatmentNotCompletedReason || "");
      fill("treatmentNotCompletedNotes", e.treatmentNotCompletedNotes || "");
      fill("endOfResponseTreatment", e.endOfResponseTreatment || "");
      fill("endOfResponseDate", e.endOfResponseDate || "");
      if (!nextF.physicianSignature && (fetchedDoctorName || doctorName)) {
        nextF.physicianSignature = fetchedDoctorName || doctorName;
        changed = true;
      }
      if (!changed) return prev;
      return { ...prev, partF: nextF };
    });
  }, [activeTab, formData.partE, fetchedDoctorName, doctorName]);

  // ─── SIDEBAR RENDERING ────────────────────────────────────────────
  const navItems = [
    { id: "overview", label: "Overview & Dashboard" },
    { id: "partA", label: "Protocol Master" },
    { id: "partB", label: "Doctor's Notes" },
    { id: "partC", label: "Nurse's Notes" },
    { id: "partD", label: "Toxicity Monitoring" },
    { id: "imaging", label: "Imaging Studies" },
    { id: "partE", label: "Discharge (On Treatment)" },
    { id: "partF", label: "Discharge (Completion)" },
    { id: "totalDischarge", label: "Comprehensive Discharge Summary" },
  ];

  // const PROTOCOL_DICTIONARY = {
  //   "FOLFOX": [
  //     { id: 1, name: "Oxaliplatin", type: "systemic", dose: "85", unit: "m2", maxDose: "", route: "iv", adminType: "infusion", frequency: "od", diluent: "d5", volume: "250", duration: "120", instructions: "Given concurrently with Leucovorin" },
  //     { id: 2, name: "Leucovorin", type: "systemic", dose: "400", unit: "m2", maxDose: "", route: "iv", adminType: "infusion", frequency: "od", diluent: "d5", volume: "250", duration: "120", instructions: "Given concurrently with Oxaliplatin" },
  //     { id: 3, name: "Fluorouracil (Bolus)", type: "systemic", dose: "400", unit: "m2", maxDose: "", route: "iv", adminType: "bolus", frequency: "od", diluent: "ns", volume: "50", duration: "stat", instructions: "Give over 5 mins" },
  //     { id: 4, name: "Fluorouracil (Infusion)", type: "systemic", dose: "2400", unit: "m2", maxDose: "", route: "iv", adminType: "infusion", frequency: "od", diluent: "ns", volume: "500", duration: "46", instructions: "Continuous infusion over 46 hours via pump" }
  //   ],
  //   "CHOP": [
  //     { id: 1, name: "Cyclophosphamide", type: "systemic", dose: "750", unit: "m2", maxDose: "", route: "iv", adminType: "infusion", frequency: "od", diluent: "ns", volume: "250", duration: "60", instructions: "" },
  //     { id: 2, name: "Doxorubicin", type: "systemic", dose: "50", unit: "m2", maxDose: "", route: "iv", adminType: "bolus", frequency: "od", diluent: "ns", volume: "50", duration: "15", instructions: "Push slowly" },
  //     { id: 3, name: "Vincristine", type: "systemic", dose: "1.4", unit: "m2", maxDose: "2", route: "iv", adminType: "bolus", frequency: "od", diluent: "ns", volume: "50", duration: "10", instructions: "Max dose 2mg" },
  //     { id: 4, name: "Prednisolone", type: "systemic", dose: "100", unit: "mg", maxDose: "", route: "oral", adminType: "bolus", frequency: "od", diluent: "", volume: "", duration: "", instructions: "Days 1-5" }
  //   ],
  //   "AC-T": [
  //     { id: 1, name: "Doxorubicin", type: "systemic", dose: "60", unit: "m2", maxDose: "", route: "iv", adminType: "bolus", frequency: "od", diluent: "ns", volume: "50", duration: "15", instructions: "" },
  //     { id: 2, name: "Cyclophosphamide", type: "systemic", dose: "600", unit: "m2", maxDose: "", route: "iv", adminType: "infusion", frequency: "od", diluent: "ns", volume: "250", duration: "60", instructions: "" }
  //   ]
  // };

  return (
    <Box sx={{ display: "flex", flexDirection: "column", height: "calc(100vh - 80px)", background: C.bgTertiary, border: `1px solid ${C.border}` }}>

      {/* ── HEADER ── */}
      <Box sx={{ display: "flex", justifyContent: "space-between", alignItems: "center", p: "16px 24px", background: C.white, borderBottom: `1px solid ${C.border}` }}>
        <Box>
          <Typography sx={{ fontSize: 18, fontWeight: FW_NORMAL, fontFamily: FONT, color: C.black }}>Medical Oncology Record Module</Typography>
          <Typography sx={{ fontSize: 11, color: C.textMuted, mt: 0.5 }}>NCG-KCDO Electronic Medical Record</Typography>
        </Box>
      </Box>

      {(() => {
        const isPostponed = formData.partB?.treatmentDecision === "postpone" || formData.partD?.postponeTreatment === "yes";
        if (!isPostponed) return null;

        let postponeReason = "Not specified";
        let postponeFromDate = "Not specified";
        let postponeUntilDate = "Not specified";
        let postponeDays = "Not specified";

        if (formData.partB?.treatmentDecision === "postpone") {
          postponeReason = formData.partB?.treatmentDecisionJustification || "Not specified";
          postponeFromDate = formData.partB?.postponeFromDate || "Not specified";
          postponeUntilDate = formData.partB?.postponeUntilDate || "Not specified";
          postponeDays = formData.partB?.postponeDays || "Not specified";
        } else if (formData.partD?.postponeTreatment === "yes") {
          postponeReason = formData.partD?.postponeReason || "Not specified";
          postponeFromDate = formData.partD?.postponeFromDate || "Not specified";
          postponeUntilDate = formData.partD?.postponeUntilDate || "Not specified";
          postponeDays = formData.partD?.postponeDays || "Not specified";
        }

        return (
          <Box sx={{ m: 2, mb: 0, p: 2, background: "#fff1f0", border: `1px solid #ffa39e`, borderRadius: "4px", display: "flex", gap: 2, alignItems: "center" }}>
            <Box sx={{ width: 4, minHeight: 50, alignSelf: "stretch", background: "#f5222d", borderRadius: "2px" }} />
            <Box sx={{ flex: 1 }}>
              <Typography sx={{ fontSize: 14, fontWeight: 700, color: "#cf1322", mb: 1.5, letterSpacing: "0.02em" }}>
                TREATMENT POSTPONED
              </Typography>
              <Box sx={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
                <Box>
                  <Typography sx={{ fontSize: 10.5, color: C.textMuted, textTransform: "uppercase", mb: 0.25, fontWeight: 600, letterSpacing: "0.05em" }}>Reason to Postpone</Typography>
                  <Typography sx={{ fontSize: 13, color: C.black, fontWeight: 500 }}>{postponeReason}</Typography>
                </Box>
                <Box>
                  <Typography sx={{ fontSize: 10.5, color: C.textMuted, textTransform: "uppercase", mb: 0.25, fontWeight: 600, letterSpacing: "0.05em" }}>Cycle / Reference Date</Typography>
                  <Typography sx={{ fontSize: 13, color: C.black, fontWeight: 500 }}>{postponeFromDate}</Typography>
                </Box>
                <Box>
                  <Typography sx={{ fontSize: 10.5, color: C.textMuted, textTransform: "uppercase", mb: 0.25, fontWeight: 600, letterSpacing: "0.05em" }}>Postpone Until / Resume Date</Typography>
                  <Typography sx={{ fontSize: 13, color: C.black, fontWeight: 500 }}>{postponeUntilDate}</Typography>
                </Box>
                <Box>
                  <Typography sx={{ fontSize: 10.5, color: C.textMuted, textTransform: "uppercase", mb: 0.25, fontWeight: 600, letterSpacing: "0.05em" }}>Blocked Duration</Typography>
                  <Typography sx={{ fontSize: 13, color: C.black, fontWeight: 500 }}>
                    {postponeDays !== "Not specified" && postponeDays !== "" ? `${postponeDays} days` : "Not specified"}
                  </Typography>
                </Box>
              </Box>
            </Box>
          </Box>
        );
      })()}

      <Box sx={{ display: "flex", flex: 1, overflow: "hidden", minHeight: 0 }}>
        {/* ── LEFT SIDEBAR ── */}
        <Box sx={{ width: 280, borderRight: `1px solid ${C.border}`, background: C.bgSecondary, overflowY: "auto", display: "flex", flexDirection: "column" }}>
          <Typography sx={{ ...labelStyle, p: "24px 20px 8px" }}>Medical Oncology EMR</Typography>
          <Box sx={{ flex: 1 }}>
            {navItems.map((item) => {
              const active = activeTab === item.id;
              return (
                <Box
                  key={item.id}
                  onClick={() => setActiveTab(item.id)}
                  sx={{
                    p: "12px 20px",
                    cursor: "pointer",
                    borderLeft: `3px solid ${active ? C.black : "transparent"}`,
                    background: active ? C.white : "transparent",
                    transition: "all 0.2s",
                  }}
                >
                  <Typography sx={{ fontSize: 12.5, fontWeight: active ? FW_MEDIUM : FW_NORMAL, color: active ? C.black : C.textSecond }}>
                    {item.label}
                  </Typography>
                </Box>
              );
            })}
          </Box>
        </Box>

        {/* ── RIGHT CONTENT PANEL ── */}
        <Box sx={{ flex: 1, overflowY: "auto", background: C.white, display: "flex", flexDirection: "column", minHeight: 0 }}>

          {/* ── CYCLE SELECTOR UI ── */}
          <Box sx={{ display: "flex", alignItems: "center", gap: 1.5, p: "12px 24px", background: C.bgSecondary, borderBottom: `1px solid ${C.border}` }}>
            <Typography sx={{ fontSize: 12, color: C.textMuted, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.05em" }}>
              Cycle
            </Typography>
            {treatment && treatment.plannedCycles > 0 && Array.from({ length: treatment.plannedCycles }, (_, i) => {
              const cycleNum = i + 1;
              const isViewing = cycleNum === activeEditCycle;
              const isCompleted = cycleNum <= treatment.completedCycles;
              const isCurrent = cycleNum === treatment.currentCycle;
              const isLocked = !isCompleted && !isCurrent;

              return (
                <Box
                  key={cycleNum}
                  onClick={async () => {
                    if (!isLocked && cycleNum !== activeEditCycle) {
                      await saveFormData(null, true);
                      setActiveEditCycle(cycleNum);
                    }
                  }}
                  sx={{
                    width: 36, height: 36, borderRadius: 1, display: "flex", alignItems: "center", justifyContent: "center",
                    fontSize: 13, fontWeight: isViewing ? 700 : 400,
                    cursor: isLocked ? "not-allowed" : "pointer",
                    border: isViewing ? `2px solid ${C.black}` : isCompleted ? `1px solid #6bd68f` : `1px solid ${C.border}`,
                    background: isViewing ? C.black : isCompleted ? "#f0faf3" : C.white,
                    color: isViewing ? C.white : isLocked ? C.border : C.textPrimary,
                    opacity: isLocked ? 0.5 : 1,
                    transition: "all 0.2s"
                  }}
                  title={isCompleted ? `Cycle ${cycleNum} — Completed` : isCurrent ? `Cycle ${cycleNum} — Current` : `Cycle ${cycleNum} — Locked`}
                >
                  {cycleNum}
                </Box>
              );
            })}

            <Box sx={{ display: "flex", gap: 0.5, ml: 1 }}>
              <Button
                variant="outlined"
                size="small"
                sx={{ minWidth: 28, width: 28, height: 28, p: 0, borderColor: C.border, color: C.textSecond, "&:hover": { background: C.bgTertiary } }}
                onClick={() => {
                  const newCycles = Math.max(1, (treatment?.plannedCycles || 5) - 1);
                  setTreatment(prev => ({ ...prev, plannedCycles: newCycles }));
                  setFormData(prev => ({ ...prev, partA: { ...prev.partA, cycles: String(newCycles) }, partB: { ...prev.partB, docPlannedCycles: String(newCycles) } }));
                }}
                disabled={treatment?.plannedCycles <= 1}
                title="Decrease Planned Cycles"
              >
                -
              </Button>
              <Button
                variant="outlined"
                size="small"
                sx={{ minWidth: 28, width: 28, height: 28, p: 0, borderColor: C.border, color: C.textSecond, "&:hover": { background: C.bgTertiary } }}
                onClick={() => {
                  const newCycles = (treatment?.plannedCycles || 5) + 1;
                  setTreatment(prev => {
                    const updates = { plannedCycles: newCycles };
                    // If treatment was previously marked as fully completed, un-complete it
                    const wasCompleted = (prev.completedCycles || 0) >= (prev.plannedCycles || 1) || prev.status === "all_cycles_completed" || prev.treatmentCompleted;
                    if (wasCompleted && (prev.completedCycles || 0) < newCycles) {
                      updates.currentCycle = (prev.completedCycles || 0) + 1;
                      updates.status = `cycle_${updates.currentCycle}_in_progress`;
                      updates.treatmentCompleted = false;
                    }
                    return { ...prev, ...updates };
                  });
                  setFormData(prev => ({ ...prev, partA: { ...prev.partA, cycles: String(newCycles) }, partB: { ...prev.partB, docPlannedCycles: String(newCycles) } }));
                }}
                title="Increase Planned Cycles"
              >
                +
              </Button>
            </Box>

            <Box sx={{ ml: "auto", display: "flex", alignItems: "center", gap: 1 }}>
              {activeTab === "cycle" && activeEditCycle && (
                <Typography sx={{ fontSize: 11, color: C.textMuted }}>
                  {activeEditCycle <= (treatment?.completedCycles || 0) || activeEditCycle === treatment?.currentCycle
                    ? `Editing Cycle ${activeEditCycle}`
                    : `Cycle ${activeEditCycle}`
                  }
                </Typography>
              )}
            </Box>
          </Box>

          <Box sx={{ flex: 1, p: 3, pb: 10, position: "relative" }}>

            {/* TAB: OVERVIEW & DASHBOARD */}
            {activeTab === "overview" && (
              <Box>
                <Box sx={{ display: "flex", justifyContent: "space-between", alignItems: "center", mb: 2, px: 3, pt: 2 }}>
                  <Typography variant="h6" sx={{ fontWeight: 600, color: C.textMain }}>
                    Chemotherapy Dashboard
                  </Typography>
                  <Button
                    variant="contained"
                    size="small"
                    sx={{ background: C.black, color: C.white }}
                    onClick={() => {
                      if (window.confirm("Are you sure you want to start a new line of therapy? This will clear the current form.")) {
                        setCurrentTreatmentId(null);
                        setCurrentTreatmentStatus("active");
                        setRawDbData({});
                        setDbCycles({});
                        setTreatment({});
                        setFormData(prev => {
                          const initial = getInitialFormData(patientId);
                          initial.overview.patientName = prev.overview.patientName;
                          initial.overview.patientAge = prev.overview.patientAge;
                          initial.overview.patientGender = prev.overview.patientGender;
                          initial.overview.patientDiagnosis = prev.overview.patientDiagnosis;
                          return initial;
                        });
                      }
                    }}
                  >
                    Start New Line of Therapy
                  </Button>
                </Box>

                {/* CONSULTATION SUMMARY */}
                <Box sx={{ px: 3, mb: 3 }}>
                  <SectionHeader title="Consultation Summary" />
                  <Box sx={{
                    p: 2,
                    border: `1px solid ${C.border}`,
                    borderRadius: 1,
                    background: C.white,
                    minHeight: '80px'
                  }}>
                    {loadingConsultationSummary ? (
                      <Typography sx={{ fontSize: 13, color: C.textMuted, fontStyle: 'italic' }}>Loading consultation summary...</Typography>
                    ) : typeof consultationSummary === 'string' && consultationSummary.length > 0 ? (
                      <Typography sx={{ fontSize: 13, color: C.textSecond, whiteSpace: 'pre-wrap' }}>
                        {consultationSummary}
                      </Typography>
                    ) : consultationSummary && consultationSummary.length > 0 ? (
                      <Typography sx={{ fontSize: 13, color: C.textSecond, whiteSpace: 'pre-wrap' }}>
                        {consultationSummary.text || "No summary available."}
                      </Typography>
                    ) : (
                      <Typography sx={{ fontSize: 13, color: C.textMuted, fontStyle: 'italic' }}>
                        No consultation summary available yet. Please use voice dictation to generate one.
                      </Typography>
                    )}
                  </Box>
                </Box>

                {/* PROTOCOL SUMMARY TABLE */}
                {Object.keys(dbCycles).length > 0 && (
                  <Box sx={{ px: 3, mb: 3 }}>
                    <SectionHeader title="Protocol Summary" />
                    <Box sx={{
                      p: 2,
                      border: `1px solid ${C.border}`,
                      borderRadius: 1,
                      background: C.white,
                      overflowX: 'auto'
                    }}>
                      <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 600 }}>
                        <thead>
                          <tr style={{ background: C.bgSecondary, borderBottom: `2px solid ${C.border}`, fontSize: 13, color: C.textSecond, textAlign: "left" }}>
                            <th style={{ padding: "10px", width: "15%", fontWeight: 600 }}>Cycle</th>
                            <th style={{ padding: "10px", width: "20%", fontWeight: 600 }}>Planned Date</th>
                            <th style={{ padding: "10px", width: "20%", fontWeight: 600 }}>Completion Date</th>
                            <th style={{ padding: "10px", width: "45%", fontWeight: 600 }}>Drugs Involved</th>
                          </tr>
                        </thead>
                        <tbody>
                          {Object.keys(dbCycles).sort((a, b) => Number(a) - Number(b)).map(cycNum => {
                            const cyc = dbCycles[cycNum];
                            const regimen = cyc?.regimen || {};
                            const cycleAdmin = cyc?.cycle_admin || {};
                            
                            // 1. Resolve baseline Cycle 1 date for planning (prioritize actual admin date cycleDate1)
                            const cycle1Obj = dbCycles?.["1"] || dbCycles?.[1] || {};
                            const cycle1AdminDate = cycle1Obj?.cycle_admin?.cycleDate1;
                            const cycle1RegimenDate = cycle1Obj?.regimen?.startDate || cycle1Obj?.cycle_admin?.planDate;
                            const cycle1AnchorDate = cycle1AdminDate || cycle1RegimenDate || formData?.partA?.startDate;

                            const intervalDays = parseInt(cyc?.regimen?.daysBetween || formData?.partA?.daysBetween || 0);

                            // 2. PLANNED DATE FOR CYCLE N:
                            let plannedDate = "Not specified";

                            if (String(cycNum) === "1") {
                              plannedDate = cycle1AnchorDate || "Not specified";
                            } else {
                              if (cyc?.cycle_admin?.planDate) {
                                plannedDate = cyc.cycle_admin.planDate;
                              } else if (cyc?.cycle_admin?.cycleDate1) {
                                plannedDate = cyc.cycle_admin.cycleDate1;
                              } else if (cycle1AnchorDate && intervalDays > 0) {
                                let parsedDate = new Date(cycle1AnchorDate);
                                if (isNaN(parsedDate)) parsedDate = parseDDMMYYYY(cycle1AnchorDate);
                                if (parsedDate && !isNaN(parsedDate)) {
                                  const cycleOffset = Number(cycNum) - 1;
                                  const planned = new Date(parsedDate);
                                  planned.setDate(planned.getDate() + (cycleOffset * intervalDays));
                                  const yyyy = planned.getFullYear();
                                  const mm = String(planned.getMonth() + 1).padStart(2, '0');
                                  const dd = String(planned.getDate()).padStart(2, '0');
                                  plannedDate = `${yyyy}-${mm}-${dd}`;
                                }
                              }
                            }

                            // 3. COMPLETION DATE:
                            const isCompleted = cyc?.cycle_admin?.cycleCompleted === "completed" 
                              || cyc?.cycle_admin?.cycleCompleted === "yes" 
                              || (String(cycNum) === String(activeEditCycle || treatment?.currentCycle || 1) && formData?.partC?.cycleCompleted === "completed");

                            let completionDate = "Not completed";
                            if (isCompleted) {
                              completionDate = cyc?.cycle_admin?.cycleDate1 || plannedDate || "Completed";
                              // Guard: Planned Date must never be later than Completion Date!
                              if (plannedDate !== "Not specified" && new Date(plannedDate) > new Date(completionDate)) {
                                plannedDate = completionDate;
                              }
                            }

                            // Resolve drugs from the most specific context first (adminDrugs > regimen.drugs > form master drugs)
                            const drugsList = (cyc?.cycle_admin?.adminDrugs && cyc.cycle_admin.adminDrugs.length > 0)
                              ? cyc.cycle_admin.adminDrugs
                              : (cyc?.regimen?.drugs && cyc.regimen.drugs.length > 0)
                                  ? cyc.regimen.drugs
                                  : (formData?.partA?.drugs || []);
                            
                            const drugs = drugsList.map(d => d.name).filter(Boolean).join(", ") || "No drugs listed";

                            return (
                              <tr key={cycNum} style={{ borderBottom: `1px solid ${C.border}`, fontSize: 13, color: C.textMain }}>
                                <td style={{ padding: "10px", fontWeight: 600 }}>Cycle {cycNum}</td>
                                <td style={{ padding: "10px" }}>{plannedDate}</td>
                                <td style={{ padding: "10px" }}>{completionDate}</td>
                                <td style={{ padding: "10px", whiteSpace: "pre-wrap" }}>{drugs}</td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </Box>
                  </Box>
                )}


                {treatmentHistory.length > 0 && (
                  <>
                    <SectionHeader title="Treatment History" />
                    <Box sx={{ px: 3, pb: 3, pt: 1 }}>
                      <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 2 }}>
                        {treatmentHistory.map((hist, idx) => (
                          <Box key={idx} sx={{ width: { xs: '100%', sm: 'calc(50% - 8px)', md: 'calc(33.333% - 11px)' } }}>
                            <Box
                              sx={{
                                p: 2,
                                border: `1px solid ${currentTreatmentId === hist.treatmentId ? C.primary : C.border}`,
                                borderRadius: 1,
                                background: currentTreatmentId === hist.treatmentId ? `${C.primary}10` : C.white,
                                cursor: "pointer",
                                "&:hover": { borderColor: C.primary, boxShadow: "0 2px 8px rgba(0,0,0,0.05)" },
                                transition: "all 0.2s ease",
                                height: '100%'
                              }}
                              onClick={() => {
                                setCurrentTreatmentId(hist.treatmentId);
                                setCurrentTreatmentStatus(hist.status);
                              }}
                            >
                              <Typography sx={{ fontWeight: 600, color: C.textMain }}>{hist.protocolName || "Unknown Protocol"}</Typography>
                              <Typography sx={{ fontSize: 12, color: C.textSecond, mt: 0.5 }}>
                                Started: {hist.startDate} &bull; Cycles: {hist.cycles}
                              </Typography>
                              <Box sx={{ display: 'inline-block', mt: 1, px: 1, py: 0.25, borderRadius: 1, fontSize: 11, background: hist.status === 'completed' ? C.bgTertiary : `${C.primary}20`, color: hist.status === 'completed' ? C.textSecond : C.primary }}>
                                {hist.status === 'completed' ? "Completed" : "Active"}
                              </Box>
                            </Box>
                          </Box>
                        ))}
                      </Box>
                    </Box>
                  </>
                )}

                <SectionHeader title="Patient Information" />
                <FieldRow label="Patient Name">
                  <TextField fullWidth size="small" sx={inputStyle} placeholder="Enter patient name" value={formData.overview.patientName} onChange={e => handleUpdate("overview", "patientName", e.target.value)} />
                </FieldRow>
                <FieldRow label="MRN / Patient ID">
                  <TextField fullWidth size="small" sx={inputStyle} placeholder="Enter medical record number" value={formData.overview.patientId} onChange={e => handleUpdate("overview", "patientId", e.target.value)} />
                </FieldRow>
                <FieldRow label="Age">
                  <TextField type="number" fullWidth size="small" sx={inputStyle} placeholder="Years" value={formData.overview.patientAge} onChange={e => handleUpdate("overview", "patientAge", e.target.value)} />
                </FieldRow>
                <FieldRow label="Gender">
                  <Select fullWidth size="small" sx={inputStyle} displayEmpty value={formData.overview.patientGender} onChange={e => handleUpdate("overview", "patientGender", e.target.value)}>
                    <MenuItem value=""><em>Select gender</em></MenuItem>
                    <MenuItem value="male">Male</MenuItem>
                    <MenuItem value="female">Female</MenuItem>
                    <MenuItem value="other">Other</MenuItem>
                  </Select>
                </FieldRow>
                <FieldRow label="Diagnosis">
                  <TextField fullWidth size="small" sx={inputStyle} placeholder="Primary diagnosis" value={formData.overview.patientDiagnosis} onChange={e => handleUpdate("overview", "patientDiagnosis", e.target.value)} />
                </FieldRow>
                <FieldRow label="Date of Registration">
                  <TextField type="date" fullWidth size="small" sx={inputStyle} value={formData.overview.registrationDate} onChange={e => handleUpdate("overview", "registrationDate", e.target.value)} />
                </FieldRow>

                <SectionHeader title="Patient Assessment" />
                <Box sx={{ px: 3, pt: 3 }}>
                  <AssessmentHistoryTable
                    dbCycles={dbCycles}
                    completedCycles={displayCycles}
                    globalHeight={formData.overview.height}
                    globalWeight={formData.overview.weight}
                    globalGender={formData.overview.patientGender}
                    globalAge={formData.overview.patientAge}
                  />
                </Box>
                <FieldRow label="Height / Length (cm)">
                  <TextField type="number" fullWidth size="small" sx={inputStyle} placeholder="cm" value={formData.overview.height} onChange={e => handleUpdate("overview", "height", e.target.value)} />
                </FieldRow>
                <FieldRow label="Weight (kg)">
                  <TextField type="number" fullWidth size="small" sx={inputStyle} placeholder="kg" value={formData.overview.weight} onChange={e => handleUpdate("overview", "weight", e.target.value)} />
                </FieldRow>
                {(() => {
                  const isFemale = formData.overview.patientGender?.trim().toLowerCase() === "female";
                  const ageStr = String(formData.overview.patientAge || "").trim();
                  const ageNum = parseInt(ageStr, 10);
                  const isAgeValid = !ageStr || (!isNaN(ageNum) && ageNum >= 10 && ageNum <= 45);
                  return isFemale && isAgeValid;
                })() && (
                    <FieldRow label="LMP Date" tag="Only for female patients aged 10-45">
                      <TextField type="date" fullWidth size="small" sx={inputStyle} value={formData.overview.lmpDate} onChange={e => handleUpdate("overview", "lmpDate", e.target.value)} />
                    </FieldRow>
                  )}
                <FieldRow label="BSA / BMI" tag="Auto from Height & Weight">
                  <Box sx={{ ...inputStyle, p: "8.5px 14px", backgroundColor: C.bgSecondary, color: C.textSecond }}>
                    {(() => {
                      const bsa = calcBSA(formData.overview.height, formData.overview.weight);
                      const bmi = calcBMI(formData.overview.height, formData.overview.weight);
                      if (bsa && bmi) {
                        return `BSA ${bsa.toFixed(2)} m² (DuBois) · BMI ${bmi.toFixed(1)} kg/m²`;
                      }
                      return "Enter Height (cm) and Weight (kg) to auto-calculate BSA & BMI";
                    })()}
                  </Box>
                </FieldRow>
                <FieldRow label="Serum Creatinine (mg/dL)" tag="For CrCl / AUC dosing">
                  <TextField
                    type="number"
                    fullWidth
                    size="small"
                    sx={inputStyle}
                    placeholder="e.g. 0.9"
                    value={formData.overview.serumCreatinine || ""}
                    onChange={e => handleUpdate("overview", "serumCreatinine", e.target.value)}
                  />
                </FieldRow>
                <FieldRow label="CrCl / eGFR (mL/min)" tag="Cockcroft–Gault auto">
                  <Box sx={{ ...inputStyle, p: "8.5px 14px", backgroundColor: C.bgSecondary, color: C.textSecond }}>
                    {(() => {
                      const crcl = calcCrCl({
                        age: formData.overview.patientAge,
                        weightKg: formData.overview.weight,
                        creatinineMgDl: formData.overview.serumCreatinine,
                        gender: formData.overview.patientGender,
                      });
                      if (crcl !== null) {
                        return `CrCl ≈ ${crcl.toFixed(1)} mL/min (Cockcroft–Gault) · used as GFR for Calvert AUC`;
                      }
                      return "Need Age, Weight, Gender, Creatinine to auto-calculate CrCl/GFR";
                    })()}
                  </Box>
                </FieldRow>
                <FieldRow label="ECOG Performance Status">
                  <Select fullWidth size="small" sx={inputStyle} displayEmpty value={formData.overview.ecog} onChange={e => handleUpdate("overview", "ecog", e.target.value)}>
                    <MenuItem value=""><em>Select ECOG</em></MenuItem>
                    <MenuItem value="0">0 - Fully active</MenuItem>
                    <MenuItem value="1">1 - Restricted in strenuous activity</MenuItem>
                    <MenuItem value="2">2 - Ambulatory, up &gt;50% of waking hours</MenuItem>
                    <MenuItem value="3">3 - Capable of only limited self-care</MenuItem>
                    <MenuItem value="4">4 - Completely disabled</MenuItem>
                    <MenuItem value="5">5 - Dead</MenuItem>
                  </Select>
                </FieldRow>

                {/* SAVE PATIENT ASSESSMENT BUTTON */}
                <Box sx={{ display: 'flex', justifyContent: 'flex-end', px: 3, pb: 3 }}>
                  <Button
                    variant="contained"
                    disabled={isSavingAssessment}
                    onClick={async () => {
                      setIsSavingAssessment(true);
                      await saveFormData(null, true);
                      setIsSavingAssessment(false);
                      alert("Patient Assessment saved successfully!");
                    }}
                    sx={{ ...btnStyle, background: C.black, color: C.white, "&:hover": { background: "#222" }, minWidth: 150 }}
                  >
                    {isSavingAssessment ? "Saving..." : "Save Patient Assessment"}
                  </Button>
                </Box>

                <Box sx={{ px: 3, mb: 3 }}>
                  <Button
                    fullWidth
                    onClick={() => setStructuredNoteExpanded(v => !v)}
                    sx={{
                      justifyContent: "space-between",
                      textTransform: "none",
                      background: C.black,
                      color: C.white,
                      borderRadius: structuredNoteExpanded ? "4px 4px 0 0" : "4px",
                      px: 2.5,
                      py: 1.5,
                      "&:hover": { background: "#222" }
                    }}
                  >
                    <Typography sx={{ fontSize: 14.5, fontWeight: FW_MEDIUM, letterSpacing: "0.02em", textTransform: "uppercase", color: C.white, fontFamily: FONT }}>
                      Clinical Structured Note
                    </Typography>
                    <Typography sx={{ fontSize: 13, color: C.white, fontFamily: FONT }}>
                      {structuredNoteExpanded ? "▲ Collapse" : "▼ Expand"}
                    </Typography>
                  </Button>
                  {structuredNoteExpanded && (
                    <Box sx={{ border: `1px solid ${C.border}`, borderTop: "none", borderRadius: "0 0 4px 4px", background: C.white, p: 2 }}>
                      <StructuredNotePanel
                        doctorId={doctorId}
                        patientId={patientId}

                      />
                    </Box>
                  )}
                </Box>
                <SectionHeader title="Tumor Board" />

                <Box sx={{ mx: 3 }}>
                  <TumorBoardCommonElement
                    patientId={patientId}
                    doctorId={doctorId}
                    planData={formData.overview.tumorBoardPlanData}
                    tbFollowed={formData.overview.tbFollowed}
                    onTbFollowedChange={(v) => handleUpdate("overview", "tbFollowed", v)}
                    tbNotFollowedReason={formData.overview.tbNotFollowedReason}
                    onTbNotFollowedReasonChange={(v) => handleUpdate("overview", "tbNotFollowedReason", v)}
                    assignTb={formData.overview.tbAssign}
                    onAssignTbChange={(v) => handleUpdate("overview", "tbAssign", v)}
                    scheduleDate={formData.overview.tbScheduleDate}
                    onScheduleDateChange={(v) => handleUpdate("overview", "tbScheduleDate", v)}
                    question={formData.overview.tbQuestion}
                    onQuestionChange={(v) => handleUpdate("overview", "tbQuestion", v)}
                    onSaveData={() => saveFormData(null, true)}
                  />
                </Box>

                <SectionHeader 
                  title="Allergic Reaction" 
                  action={
                    formData.overview.allergy === "yes" ? (
                      <Button
                        variant="outlined"
                        size="small"
                        onClick={() => {
                          const currentAllergies = formData.overview.allergies || [];
                          handleUpdate("overview", "allergies", [
                            ...currentAllergies,
                            { id: Date.now(), drug: "", type: "", severity: "", interactionChecked: "" }
                          ]);
                        }}
                        sx={{ textTransform: "none", borderColor: C.white, color: C.white, "&:hover": { borderColor: C.white, bgcolor: "rgba(255,255,255,0.1)" } }}
                      >
                        + Add Allergy
                      </Button>
                    ) : null
                  }
                />
                <Box sx={{ px: 3, pt: 2 }}>
                  <AllergyHistoryTable dbCycles={dbCycles} completedCycles={treatment?.completedCycles || 0} />
                </Box>
                <Box sx={{ p: 3, pb: 1, display: 'flex', alignItems: 'center' }}>
                  <Typography sx={{ fontSize: 13, fontWeight: FW_MEDIUM, mr: 2 }}>Patient has known baseline allergies?</Typography>
                  <Select
                    size="small"
                    sx={{ ...inputStyle, width: 120 }}
                    value={formData.overview.allergy || ""}
                    displayEmpty
                    onChange={e => handleUpdate("overview", "allergy", e.target.value)}
                  >
                    <MenuItem value=""><em>Select...</em></MenuItem>
                    <MenuItem value="yes">Yes</MenuItem>
                    <MenuItem value="no">No</MenuItem>
                  </Select>
                </Box>
                
                {formData.overview.allergy === "yes" && (
                  <Box sx={{ px: 3, pb: 3, overflowX: "auto" }}>
                    <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 800 }}>
                      <thead>
                        <tr style={{ background: C.bgSecondary, border: `1px solid ${C.border}`, fontSize: 12.5, fontWeight: FW_MEDIUM }}>
                          <th style={{ padding: "8px 12px", textAlign: "left", width: "25%", fontWeight: FW_MEDIUM }}>Name of the Drug</th>
                          <th style={{ padding: "8px 12px", textAlign: "left", width: "25%", fontWeight: FW_MEDIUM }}>Type of Allergic Reaction</th>
                          <th style={{ padding: "8px 12px", textAlign: "left", width: "15%", fontWeight: FW_MEDIUM }}>Severity Level</th>
                          <th style={{ padding: "8px 12px", textAlign: "left", width: "20%", fontWeight: FW_MEDIUM }}>Interaction Checked<br /><span style={{ fontSize: 9.5, fontWeight: FW_NORMAL, color: C.textMuted }}>MedScape / UpToDate / Any other</span></th>
                          <th style={{ padding: "8px 8px", textAlign: "center", width: "6%", fontWeight: FW_MEDIUM }}>Action</th>
                        </tr>
                      </thead>
                      <tbody>
                        {formData.overview.allergies && formData.overview.allergies.length > 0 ? (
                          formData.overview.allergies.map((allergy, index) => (
                            <tr key={allergy.id || index} style={{ border: `1px solid ${C.border}` }}>
                              <td style={{ padding: "12px", verticalAlign: "top" }}>
                                <Autocomplete
                                  freeSolo
                                  options={["Paclitaxel", "Carboplatin", "Doxorubicin", "Cyclophosphamide", "Fluorouracil", "Trastuzumab", "Cisplatin", "Oxaliplatin", "Docetaxel", "Rituximab", "Pembrolizumab", "Nivolumab", "Ondansetron", "Dexamethasone", "Aprepitant"]}
                                  value={allergy.drug || ""}
                                  onChange={(event, newValue) => {
                                    handleArrayUpdate("overview", "allergies", index, "drug", newValue || "");
                                  }}
                                  onInputChange={(event, newInputValue) => {
                                    handleArrayUpdate("overview", "allergies", index, "drug", newInputValue || "");
                                  }}
                                  renderInput={(params) => (
                                    <TextField
                                      {...params}
                                      placeholder="Drug causing reaction"
                                      size="small"
                                      sx={{ ...inputStyle, m: 0 }}
                                    />
                                  )}
                                />
                              </td>
                              <td style={{ padding: "12px", verticalAlign: "top" }}>
                                <TextField fullWidth multiline size="small" sx={{ ...inputStyle, m: 0 }} placeholder="Description, e.g., Skin reaction" value={allergy.type || ""} onChange={e => handleArrayUpdate("overview", "allergies", index, "type", e.target.value)} />
                              </td>
                              <td style={{ padding: "12px", verticalAlign: "top" }}>
                                <Select
                                  fullWidth
                                  size="small"
                                  sx={{ ...inputStyle, m: 0 }}
                                  value={allergy.severity || ""}
                                  displayEmpty
                                  onChange={e => handleArrayUpdate("overview", "allergies", index, "severity", e.target.value)}
                                >
                                  <MenuItem value=""><em>Select...</em></MenuItem>
                                  <MenuItem value="mild">Mild</MenuItem>
                                  <MenuItem value="moderate">Moderate</MenuItem>
                                  <MenuItem value="severe">Severe</MenuItem>
                                </Select>
                              </td>
                              <td style={{ padding: "12px", verticalAlign: "top" }}>
                                <Select
                                  fullWidth
                                  size="small"
                                  sx={{ ...inputStyle, m: 0 }}
                                  value={allergy.interactionChecked || ""}
                                  displayEmpty
                                  onChange={e => handleArrayUpdate("overview", "allergies", index, "interactionChecked", e.target.value)}
                                >
                                  <MenuItem value=""><em>Select source...</em></MenuItem>
                                  <MenuItem value="Medscape">Medscape</MenuItem>
                                  <MenuItem value="UpToDate">UpToDate</MenuItem>
                                  <MenuItem value="Any other">Any other</MenuItem>
                                </Select>
                              </td>
                              <td style={{ padding: "12px 8px", verticalAlign: "top", textAlign: "center" }}>
                                <IconButton
                                  size="small"
                                  color="error"
                                  onClick={() => {
                                    const newAllergies = [...formData.overview.allergies];
                                    newAllergies.splice(index, 1);
                                    handleUpdate("overview", "allergies", newAllergies);
                                  }}
                                  sx={{ mt: 0.5 }}
                                >
                                  <Delete fontSize="small" />
                                </IconButton>
                              </td>
                            </tr>
                          ))
                        ) : (
                          <tr>
                            <td colSpan="5" style={{ padding: "16px", textAlign: "center", color: C.textMuted, fontSize: 13 }}>
                              No allergies added. Click "Add Allergy" to add one.
                            </td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                  </Box>
                )}

                {/* SAVE ALLERGIC REACTION BUTTON */}
                <Box sx={{ display: 'flex', justifyContent: 'flex-end', px: 3, pb: 3 }}>
                  <Button
                    variant="contained"
                    disabled={isSavingAllergicReaction}
                    onClick={async () => {
                      setIsSavingAllergicReaction(true);
                      await saveFormData(null, true);
                      setIsSavingAllergicReaction(false);
                      alert("Allergic Reaction saved successfully!");
                    }}
                    sx={{ ...btnStyle, background: C.black, color: C.white, "&:hover": { background: "#222" }, minWidth: 150 }}
                  >
                    {isSavingAllergicReaction ? "Saving..." : "Save Allergic Reaction"}
                  </Button>
                </Box>

                {/* ── Investigations ── */}
                <LabInvestigations
                  patientId={patientId}
                  doctorId={doctorId}
                  currentBookingId={currentTreatmentId}
                  department="medical"
                  hospitalId={hospitalId || ""}
                  currentProcedure={`Cycle ${activeEditCycle || treatment?.currentCycle || 1}`}
                  bookingData={{}}
                  orderContext={{
                    type: "cycle",
                    label: `Cycle ${activeEditCycle || treatment?.currentCycle || 1}`,
                    cycle_no: activeEditCycle || treatment?.currentCycle || 1
                  }}
                />
              </Box>
            )}

            {/* TAB: CT PART A */}
            {activeTab === "partA" && (
              <ProtocolMasterTab
                formData={formData}
                setFormData={setFormData}
                handleUpdate={handleUpdate}
                dbCycles={dbCycles}
                treatment={treatment}
                setTreatment={setTreatment}
                patientId={patientId}
                doctorId={doctorId}
                SectionHeader={SectionHeader}
                FieldRow={FieldRow}
                CustomRadio={CustomRadio}
                ProtocolHistoryTable={ProtocolHistoryTable}
                FieldLine={FieldLine}
                btnStyle={btnStyle}
                inputStyle={inputStyle}
                invThSx={invThSx}
                invTdSx={invTdSx}
                C={C}
                FONT={FONT}
                FW_MEDIUM={FW_MEDIUM}
              />
            )}
            {/* TAB: CT PART B */}
            {activeTab === "partB" && (
              <Box>

                {/* ─── CHEMOTHERAPY REGIMEN SUMMARY ───────────────────── */}
                <ChemoRegimenSummaryCard
                  data={chemoRegimenData}
                  loading={chemoRegimenLoading}
                  error={chemoRegimenError}
                  onDownloadPDF={handleDownloadRegimenPDF}
                />
                {/* ─── CLEARANCE SUMMARY ─────────────────────────────── */}
                <ClearanceSummaryCard
                  formData={formData}
                  treatment={treatment}
                  dbCycles={dbCycles}
                  labOrderFields={labOrderFields}
                  labHistory={labHistory}
                  activeEditCycle={activeEditCycle}
                />
                {/* ─────────────────────────────────────────────────────── */}

                <Box sx={{ mb: 3 }}>
                  <SurgeryOverview patientId={patientId} />
                </Box>

                <Box sx={{ mb: 3 }}>
                  <RadioTherapyOverview patientId={patientId} />
                </Box>

                <VoiceDictationPanel
                  title="Doctor's Note / Voice Dictation"
                  placeholder="Type or dictate your notes here. Use the buttons below to start voice dictation or run AI auto-fill."
                  transcript={doctorNoteTranscript}
                  setTranscript={setDoctorNoteTranscript}
                  onAutofill={processDoctorNoteDictation}
                  isAutofilling={isPrefillingDoctorNote}
                  autofillSuccess={doctorNoteFillSuccess}
                />

                <SectionHeader
                  num="Section 1"
                  title="Pre-Chemotherapy Evaluation"
                />
                <Box sx={{ px: 3, pt: 3 }}>

                  <PreChemoHistoryTable dbCycles={dbCycles} completedCycles={treatment?.completedCycles || 0} />
                </Box>
                <FieldRow label="Name of the Consultant">
                  <Autocomplete
                    freeSolo
                    options={allDoctorsList.filter(doc => {
                      const reqSpec = doctorSpeciality || "";
                      if (!reqSpec) return true;
                      return (doc.specialization || "").toLowerCase() === reqSpec.toLowerCase();
                    }).map(doc => doc.name)}
                    value={formData.partB.consultantName || (clearedConsultant ? "" : (fetchedDoctorName || doctorName || ""))}
                    onChange={(e, newValue) => {
                      const val = newValue || "";
                      handleUpdate("partB", "consultantName", val);
                      if (!formData.partB.approvalDoctorSigned) handleUpdate("partB", "approvalDoctorName", val);
                      setClearedConsultant(!val);
                    }}
                    onInputChange={(e, newInputValue) => {
                      const val = newInputValue || "";
                      handleUpdate("partB", "consultantName", val);
                      if (!formData.partB.approvalDoctorSigned) handleUpdate("partB", "approvalDoctorName", val);
                      setClearedConsultant(!val);
                    }}
                    renderInput={(params) => (
                      <TextField
                        {...params}
                        fullWidth
                        size="small"
                        sx={{ ...inputStyle, backgroundColor: C.bgSecondary }}
                        placeholder="Select or type consultant name"
                      />
                    )}
                  />
                </FieldRow>

                <FieldRow label="Current Lab Results">
                  <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                    <TextField fullWidth multiline rows={2} sx={inputStyle} placeholder="CBC, LFT, RFT, tumor markers" value={formData.partB.currentLabs} onChange={e => handleUpdate("partB", "currentLabs", e.target.value)} />
                    <Button
                      variant="outlined"
                      size="small"
                      onClick={populateLatestLabs}
                      sx={{ alignSelf: 'flex-start', textTransform: 'none', fontFamily: FONT, color: C.black, borderColor: C.border, '&:hover': { background: C.bgSecondary, borderColor: C.black } }}
                    >
                      ✦ Populate from Latest Labs
                    </Button>
                  </Box>
                </FieldRow>
                <FieldRow label="Ongoing Toxicity / Tolerance">
                  <TextField fullWidth multiline rows={2} sx={inputStyle} placeholder="Describe any ongoing toxicities or tolerance issues" value={formData.partB.docOngoingTox} onChange={e => handleUpdate("partB", "docOngoingTox", e.target.value)} />
                </FieldRow>
                <FieldRow label="Treatment Decision" tag="Continue / Modify / Change / Postpone">
                  <Box sx={{ display: "flex", flexDirection: "column", gap: 1.5 }}>
                    <Box sx={{ display: "flex", gap: 1, flexWrap: "wrap" }}>
                      {[
                        { value: "continue", label: "Continue" },
                        { value: "modify", label: "Modify" },
                        { value: "change", label: "Change" },
                        { value: "postpone", label: "Postpone" },
                      ].map(opt => (
                        <CustomRadio
                          key={opt.value}
                          label={opt.label}
                          value={opt.value}
                          checked={(formData.partB.treatmentDecision || (formData.partB.docProceed === "yes" ? "continue" : formData.partB.docProceed === "no" ? "" : "")) === opt.value}
                          onChange={() => {
                            handleUpdate("partB", "treatmentDecision", opt.value);
                            handleUpdate("partB", "docProceed", opt.value === "continue" ? "yes" : "no");
                            if (opt.value === "continue") {
                              handleUpdate("partB", "treatmentDecisionJustification", "");
                              handleUpdate("partB", "postponeFromDate", "");
                              handleUpdate("partB", "postponeUntilDate", "");
                              handleUpdate("partB", "postponeDays", "");
                              handleUpdate("partB", "postponeReassessmentPlan", "");
                              handleUpdate("partB", "docReasonTolerance", false);
                              handleUpdate("partB", "docReasonProgression", false);
                              handleUpdate("partB", "docReasonChoice", false);
                            } else if (opt.value === "postpone") {
                              const cycleDate =
                                formData.partC?.planDate ||
                                dbCycles?.[String(activeEditCycle || treatment?.currentCycle || 1)]?.cycle_admin?.cycleDate1 ||
                                "";
                              if (cycleDate && !formData.partB.postponeFromDate) {
                                handleUpdate("partB", "postponeFromDate", cycleDate);
                              }
                            }
                          }}
                        />
                      ))}
                    </Box>
                    {["modify", "change"].includes(formData.partB.treatmentDecision) && (
                      <Box sx={{ p: 1.5, background: C.bgSecondary, border: `1px solid ${C.border}` }}>
                        <Typography sx={{ fontSize: 12, color: C.textSecond, mb: 1, fontWeight: FW_MEDIUM, fontFamily: FONT }}>
                          Justification required for {formData.partB.treatmentDecision}:
                        </Typography>
                        <TextField
                          fullWidth
                          multiline
                          rows={3}
                          size="small"
                          required
                          sx={{ ...inputStyle, m: 0, background: C.white }}
                          placeholder={
                            formData.partB.treatmentDecision === "modify"
                              ? "Describe what will be modified and why (dose, schedule, supportive care, etc.)"
                              : "Describe the regimen/protocol change and clinical justification"
                          }
                          value={formData.partB.treatmentDecisionJustification || ""}
                          onChange={e => handleUpdate("partB", "treatmentDecisionJustification", e.target.value)}
                        />
                      </Box>
                    )}
                    {formData.partB.treatmentDecision === "postpone" && (() => {
                      const cycleRefDate =
                        formData.partC?.planDate ||
                        dbCycles?.[String(activeEditCycle || treatment?.currentCycle || 1)]?.cycle_admin?.cycleDate1 ||
                        "";
                      const fromDate = formData.partB.postponeFromDate || cycleRefDate || "";
                      const untilDate = formData.partB.postponeUntilDate || "";
                      let calculatedDays = "";
                      if (fromDate && untilDate) {
                        const start = new Date(fromDate);
                        const end = new Date(untilDate);
                        if (!isNaN(start) && !isNaN(end) && end >= start) {
                          calculatedDays = String(Math.round((end - start) / (1000 * 60 * 60 * 24)));
                        }
                      }
                      const displayDays = formData.partB.postponeDays || calculatedDays;
                      return (
                        <Box sx={{ p: 1.5, background: C.bgSecondary, border: `1px solid ${C.border}`, display: "flex", flexDirection: "column", gap: 1.5 }}>
                          <Box sx={{ display: "grid", gridTemplateColumns: { xs: "1fr", md: "1fr 1fr 1fr" }, gap: 1.5 }}>
                            <Box>
                              <Typography sx={{ fontSize: 11, color: C.textMuted, fontFamily: FONT, mb: 0.75, textTransform: "uppercase", letterSpacing: "0.06em" }}>
                                Reference Date
                              </Typography>
                              <TextField
                                type="date"
                                fullWidth
                                size="small"
                                sx={{ ...inputStyle, m: 0, background: C.white }}
                                value={fromDate}
                                onChange={e => {
                                  handleUpdate("partB", "postponeFromDate", e.target.value);
                                  if (e.target.value && untilDate) {
                                    const s = new Date(e.target.value);
                                    const en = new Date(untilDate);
                                    if (!isNaN(s) && !isNaN(en) && en >= s) {
                                      handleUpdate("partB", "postponeDays", String(Math.round((en - s) / (1000 * 60 * 60 * 24))));
                                    }
                                  }
                                }}
                              />
                            </Box>
                            <Box>
                              <Typography sx={{ fontSize: 11, color: C.textMuted, fontFamily: FONT, mb: 0.75, textTransform: "uppercase", letterSpacing: "0.06em" }}>
                                Postpone Date
                              </Typography>
                              <TextField
                                type="date"
                                fullWidth
                                size="small"
                                sx={{ ...inputStyle, m: 0, background: C.white }}
                                value={untilDate}
                                onChange={e => {
                                  handleUpdate("partB", "postponeUntilDate", e.target.value);
                                  if (fromDate && e.target.value) {
                                    const s = new Date(fromDate);
                                    const en = new Date(e.target.value);
                                    if (!isNaN(s) && !isNaN(en) && en >= s) {
                                      handleUpdate("partB", "postponeDays", String(Math.round((en - s) / (1000 * 60 * 60 * 24))));
                                    }
                                  }
                                }}
                              />
                            </Box>
                            <Box>
                              <Typography sx={{ fontSize: 11, color: C.textMuted, fontFamily: FONT, mb: 0.75, textTransform: "uppercase", letterSpacing: "0.06em" }}>
                                Blocked Duration (Days)
                              </Typography>
                              <TextField
                                type="number"
                                fullWidth
                                size="small"
                                sx={{ ...inputStyle, m: 0, background: C.white }}
                                placeholder="Auto from dates"
                                value={displayDays}
                                onChange={e => handleUpdate("partB", "postponeDays", e.target.value)}
                              />
                            </Box>
                          </Box>
                          {(fromDate && untilDate && displayDays !== "") && (
                            <Typography sx={{ fontSize: 12, fontFamily: FONT, color: C.textPrimary, fontWeight: FW_MEDIUM }}>
                              Treatment postponed for {displayDays} day{displayDays === "1" ? "" : "s"}
                              {fromDate && untilDate ? ` (${fromDate} → ${untilDate})` : ""}.
                            </Typography>
                          )}
                          <Box>
                            <Typography sx={{ fontSize: 11, color: C.textMuted, fontFamily: FONT, mb: 0.75, textTransform: "uppercase", letterSpacing: "0.06em" }}>
                              Reason to Postpone
                            </Typography>
                            <TextField
                              fullWidth
                              multiline
                              rows={2}
                              size="small"
                              sx={{ ...inputStyle, m: 0, background: C.white }}
                              placeholder="Describe why treatment is postponed and expected duration"
                              value={formData.partB.treatmentDecisionJustification || ""}
                              onChange={e => handleUpdate("partB", "treatmentDecisionJustification", e.target.value)}
                            />
                          </Box>
                          <Box>
                            <Typography sx={{ fontSize: 11, color: C.textMuted, fontFamily: FONT, mb: 0.75, textTransform: "uppercase", letterSpacing: "0.06em" }}>
                              Re-assessment Plan
                            </Typography>
                            <TextField
                              fullWidth
                              multiline
                              rows={2}
                              size="small"
                              sx={{ ...inputStyle, m: 0, background: C.white }}
                              placeholder="Describe the re-assessment plan"
                              value={formData.partB.postponeReassessmentPlan || ""}
                              onChange={e => handleUpdate("partB", "postponeReassessmentPlan", e.target.value)}
                            />
                          </Box>
                          <Box sx={{ mt: 0.5, display: "flex", gap: 1, flexWrap: "wrap" }}>
                            <CustomCheckbox label="Intolerance" checked={formData.partB.docReasonTolerance} onChange={e => handleUpdate("partB", "docReasonTolerance", e.target.checked)} />
                            <CustomCheckbox label="Disease Progression" checked={formData.partB.docReasonProgression} onChange={e => handleUpdate("partB", "docReasonProgression", e.target.checked)} />
                            <CustomCheckbox label="Patient Choice" checked={formData.partB.docReasonChoice} onChange={e => handleUpdate("partB", "docReasonChoice", e.target.checked)} />
                          </Box>
                        </Box>
                      );
                    })()}
                  </Box>
                </FieldRow>
                <FieldRow label="Venous Access">
                  <Select fullWidth size="small" sx={inputStyle} displayEmpty value={formData.partB.venousAccess} onChange={e => handleUpdate("partB", "venousAccess", e.target.value)}>
                    <MenuItem value=""><em>Select access</em></MenuItem>
                    <MenuItem value="peripheral">Peripheral Line</MenuItem>
                    <MenuItem value="picc">PICC</MenuItem>
                    <MenuItem value="port">Port</MenuItem>
                  </Select>
                </FieldRow>
                <FieldRow label="Patient Consent Taken" tag="Signed consent">
                  <Box sx={{ display: "flex", flexDirection: "column", gap: 1.5 }}>
                    <Box sx={{ display: "flex", gap: 1 }}>
                      <CustomRadio
                        label="Yes"
                        value="yes"
                        checked={formData.partB.consentTaken === "yes"}
                        onChange={() => handleUpdate("partB", "consentTaken", "yes")}
                      />
                      <CustomRadio
                        label="No"
                        value="no"
                        checked={formData.partB.consentTaken === "no"}
                        onChange={() => {
                          handleUpdate("partB", "consentTaken", "no");
                          handleUpdate("partB", "consentDate", "");
                          handleUpdate("partB", "consentDocumentName", "");
                          handleUpdate("partB", "consentDocumentUrl", "");
                        }}
                      />
                    </Box>
                    {formData.partB.consentTaken === "yes" && (
                      <Box sx={{ p: 1.5, background: C.bgSecondary, border: `1px solid ${C.border}`, display: "flex", flexDirection: "column", gap: 1.5 }}>
                        <Box>
                          <Typography sx={{ fontSize: 11, color: C.textMuted, fontFamily: FONT, mb: 0.75, textTransform: "uppercase", letterSpacing: "0.06em" }}>
                            Consent Date
                          </Typography>
                          <TextField
                            type="date"
                            fullWidth
                            size="small"
                            sx={{ ...inputStyle, m: 0, background: C.white }}
                            value={formData.partB.consentDate || ""}
                            onChange={e => handleUpdate("partB", "consentDate", e.target.value)}
                          />
                        </Box>
                        <Box>
                          <Typography sx={{ fontSize: 11, color: C.textMuted, fontFamily: FONT, mb: 0.75, textTransform: "uppercase", letterSpacing: "0.06em" }}>
                            Upload Signed Consent Document
                          </Typography>
                          <Box sx={{ display: "flex", gap: 1, alignItems: "center", flexWrap: "wrap" }}>
                            <Button
                              component="label"
                              size="small"
                              startIcon={<UploadFile sx={{ fontSize: 16 }} />}
                              sx={{
                                ...btnStyle,
                                border: `1px solid ${C.black}`,
                                color: C.black,
                                background: C.white,
                                px: 1.5,
                                py: 0.6,
                                "&:hover": { background: C.bgTertiary },
                              }}
                            >
                              Choose File
                              <input
                                type="file"
                                hidden
                                accept=".pdf,.png,.jpg,.jpeg,.doc,.docx,image/*"
                                onChange={e => {
                                  const file = e.target.files?.[0];
                                  if (!file) return;
                                  handleUpdate("partB", "consentDocumentName", file.name);
                                  // Local preview URL for this session; persisted name is kept in formData
                                  try {
                                    const url = URL.createObjectURL(file);
                                    handleUpdate("partB", "consentDocumentUrl", url);
                                  } catch (_) {
                                    handleUpdate("partB", "consentDocumentUrl", "");
                                  }
                                  e.target.value = "";
                                }}
                              />
                            </Button>
                            {formData.partB.consentDocumentName ? (
                              <Box sx={{ display: "flex", alignItems: "center", gap: 1, flexWrap: "wrap" }}>
                                <Typography sx={{ fontSize: 12, fontFamily: FONT, color: C.textPrimary }}>
                                  {formData.partB.consentDocumentName}
                                </Typography>
                                {formData.partB.consentDocumentUrl && (
                                  <Button
                                    size="small"
                                    sx={{ ...btnStyle, border: `1px solid ${C.border}`, px: 1, py: 0.3, fontSize: 11 }}
                                    onClick={() => {
                                      const url = formData.partB.consentDocumentUrl;
                                      if (url.startsWith("data:")) {
                                        fetch(url)
                                          .then(res => res.blob())
                                          .then(blob => {
                                            const blobUrl = URL.createObjectURL(blob);
                                            window.open(blobUrl, "_blank");
                                          });
                                      } else {
                                        window.open(url, "_blank");
                                      }
                                    }}
                                  >
                                    View
                                  </Button>
                                )}
                                <Button
                                  size="small"
                                  sx={{ ...btnStyle, border: `1px solid ${C.border}`, px: 1, py: 0.3, fontSize: 11, color: C.textMuted }}
                                  onClick={() => {
                                    handleUpdate("partB", "consentDocumentName", "");
                                    handleUpdate("partB", "consentDocumentUrl", "");
                                  }}
                                >
                                  Remove
                                </Button>
                              </Box>
                            ) : (
                              <Typography sx={{ fontSize: 12, fontFamily: FONT, color: C.textMuted }}>
                                No document uploaded
                              </Typography>
                            )}
                          </Box>
                        </Box>
                      </Box>
                    )}
                  </Box>
                </FieldRow>
                <FieldRow label="Systemic Therapy Safety Checklist Verified">
                  <Box sx={{ display: "flex", gap: 1 }}>
                    <CustomRadio label="Yes" value="yes" checked={formData.partB.safetyVerified === "yes"} onChange={() => handleUpdate("partB", "safetyVerified", "yes")} />
                    <CustomRadio label="No" value="no" checked={formData.partB.safetyVerified === "no"} onChange={() => handleUpdate("partB", "safetyVerified", "no")} />
                  </Box>
                </FieldRow>
                <FieldRow label="Emergency Medications Prepared">
                  <TextField fullWidth multiline rows={2} sx={inputStyle} placeholder="List emergency medications" value={formData.partB.emergencyMeds} onChange={e => handleUpdate("partB", "emergencyMeds", e.target.value)} />
                </FieldRow>

                {/* SAVE PRE-CHEMO EVALUATION BUTTON */}
                <Box sx={{ display: 'flex', justifyContent: 'flex-end', px: 3, pb: 3 }}>
                  <Button
                    variant="contained"
                    disabled={isSavingPreChemo}
                    onClick={async () => {
                      setIsSavingPreChemo(true);
                      await saveFormData(null, true);
                      setIsSavingPreChemo(false);
                      alert("Pre-Chemotherapy Evaluation saved successfully!");
                    }}
                    sx={{ ...btnStyle, background: C.black, color: C.white, "&:hover": { background: "#222" }, minWidth: 150 }}
                  >
                    {isSavingPreChemo ? "Saving..." : "Save Pre-Chemo Evaluation"}
                  </Button>
                </Box>

                <SectionHeader
                  num="Section 2"
                  title="Drug Preparation and Verification"
                  action={
                    <Button
                      variant="outlined" size="small"
                      startIcon={<Add fontSize="small" />}
                      sx={{
                        borderColor: C.white,
                        color: C.white,
                        textTransform: "none",
                        "&:hover": { background: "rgba(255,255,255,0.1)", borderColor: C.white }
                      }}
                      onClick={() => {
                        setFormData(prev => ({
                          ...prev,
                          partB: {
                            ...prev.partB,
                            drugPreparations: [
                              ...(prev.partB.drugPreparations || []),
                              { id: Date.now(), drugName: "", dose: "", doseUnit: "m2", whetherMod: "no", modDose: "", modDoseUnit: "mg", modReasonComorb: false, modReasonTox: false, modReasonPerf: false, modReasonNutri: false, modReasonGen: false, modReasonOther: false }
                            ]
                          }
                        }));
                      }}
                    >
                      Add New Drug
                    </Button>
                  }
                />
                <Box sx={{ px: 3, pt: 3 }}>
                  <DoseModificationHistoryTable dbCycles={dbCycles} completedCycles={treatment?.completedCycles || 0} />
                  <Box sx={{ mt: 2 }}>
                    <DrugPrepHistoryTable dbCycles={dbCycles} completedCycles={treatment?.completedCycles || 0} globalHeight={formData.overview.height} globalWeight={formData.overview.weight} />
                  </Box>
                </Box>

                {formData.partB.drugPreparations.map((drug, dIndex) => (
                  <Box key={drug.id} sx={{ mb: 3, pb: 3, borderBottom: dIndex < formData.partB.drugPreparations.length - 1 ? `1px dashed ${C.border}` : 'none' }}>
                    <Box sx={{ display: "flex", justifyContent: "space-between", alignItems: "center", px: 3, mb: 1 }}>
                      <Typography sx={{ fontSize: 13, fontWeight: FW_MEDIUM, color: C.black }}>Drug {dIndex + 1}</Typography>
                      {formData.partB.drugPreparations.length > 1 && (
                        <Button
                          size="small"
                          sx={{ color: C.red, minWidth: 'auto', p: '2px 8px', textTransform: "none" }}
                          onClick={() => {
                            setFormData(prev => ({
                              ...prev,
                              partB: {
                                ...prev.partB,
                                drugPreparations: prev.partB.drugPreparations.filter((_, i) => i !== dIndex)
                              }
                            }));
                          }}
                        >
                          Remove
                        </Button>
                      )}
                    </Box>

                    <FieldRow label="Drug Name">
                      <Autocomplete
                        freeSolo
                        options={[
                          "Paclitaxel", "Carboplatin", "Docetaxel", "Cyclophosphamide",
                          "Doxorubicin", "Epirubicin", "Fluorouracil", "Oxaliplatin",
                          "Irinotecan", "Gemcitabine", "Cisplatin", "Pemetrexed",
                          "Etoposide", "Bevacizumab", "Trastuzumab", "Rituximab",
                          "Pembrolizumab", "Nivolumab", "Nab-Paclitaxel", "Capecitabine", "Olaparib"
                        ]}
                        value={drug.drugName}
                        onChange={(e, newValue) => {
                          const updated = [...formData.partB.drugPreparations];
                          updated[dIndex].drugName = newValue;
                          setFormData(prev => ({ ...prev, partB: { ...prev.partB, drugPreparations: updated } }));
                        }}
                        onInputChange={(e, newInputValue) => {
                          const updated = [...formData.partB.drugPreparations];
                          updated[dIndex].drugName = newInputValue;
                          setFormData(prev => ({ ...prev, partB: { ...prev.partB, drugPreparations: updated } }));
                        }}
                        renderInput={(params) => <TextField {...params} size="small" sx={inputStyle} placeholder="Select or type drug name" />}
                      />
                    </FieldRow>
                    <FieldRow label="Dose Basis" tag="BSA / Weight / AUC / Fixed">
                      <Select
                        fullWidth
                        size="small"
                        sx={inputStyle}
                        displayEmpty
                        value={drug.doseUnit || "m2"}
                        onChange={e => {
                          const updated = [...formData.partB.drugPreparations];
                          updated[dIndex].doseUnit = e.target.value;
                          setFormData(prev => ({ ...prev, partB: { ...prev.partB, drugPreparations: updated } }));
                        }}
                      >
                        <MenuItem value="m2">mg/m² (BSA)</MenuItem>
                        <MenuItem value="kg">mg/kg (Weight)</MenuItem>
                        <MenuItem value="auc">AUC / Calvert (Carboplatin)</MenuItem>
                        <MenuItem value="mg">Fixed mg</MenuItem>
                      </Select>
                    </FieldRow>
                    <FieldRow label={(drug.doseUnit || "m2") === "auc" ? "Target AUC" : "Planned Dose"}>
                      <TextField
                        type="number"
                        fullWidth
                        size="small"
                        sx={inputStyle}
                        placeholder={(drug.doseUnit || "m2") === "auc" ? "e.g. 5 (AUC)" : "e.g. 175"}
                        value={drug.dose}
                        onChange={e => {
                          const updated = [...formData.partB.drugPreparations];
                          updated[dIndex].dose = e.target.value;
                          setFormData(prev => ({ ...prev, partB: { ...prev.partB, drugPreparations: updated } }));
                        }}
                      />
                    </FieldRow>

                    <FieldRow label="Dose Modification Required?">
                      <Box sx={{ display: "flex", gap: 1 }}>
                        <CustomRadio label="Yes" value="yes" checked={drug.whetherMod === "yes"} onChange={() => {
                          const updated = [...formData.partB.drugPreparations];
                          updated[dIndex].whetherMod = "yes";
                          setFormData(prev => ({ ...prev, partB: { ...prev.partB, drugPreparations: updated } }));
                        }} />
                        <CustomRadio label="No" value="no" checked={drug.whetherMod === "no"} onChange={() => {
                          const updated = [...formData.partB.drugPreparations];
                          updated[dIndex].whetherMod = "no";
                          setFormData(prev => ({ ...prev, partB: { ...prev.partB, drugPreparations: updated } }));
                        }} />
                      </Box>
                    </FieldRow>
                    {drug.whetherMod === "yes" && (
                      <Box sx={{ px: 3, pb: 2 }}>
                        <Box sx={{ display: "flex", flexDirection: "column", gap: 2, p: 2, background: C.bgSecondary, border: `1px solid ${C.border}`, borderRadius: 1 }}>
                          <Box sx={{ display: "flex", gap: 1 }}>
                            <Box sx={{ flex: 1.5 }}>
                              <FieldRow label="Modified Unit">
                                <Select
                                  fullWidth
                                  size="small"
                                  sx={inputStyle}
                                  displayEmpty
                                  value={drug.modDoseUnit || "mg"}
                                  onChange={e => {
                                    const updated = [...formData.partB.drugPreparations];
                                    updated[dIndex].modDoseUnit = e.target.value;
                                    setFormData(prev => ({ ...prev, partB: { ...prev.partB, drugPreparations: updated } }));
                                  }}
                                >
                                  <MenuItem value="m2">mg/m² (BSA)</MenuItem>
                                  <MenuItem value="kg">mg/kg (Weight)</MenuItem>
                                  <MenuItem value="auc">AUC / Calvert (Carboplatin)</MenuItem>
                                  <MenuItem value="mg">Fixed mg</MenuItem>
                                </Select>
                              </FieldRow>
                            </Box>
                            <Box sx={{ flex: 1.5 }}>
                              <FieldRow label={(drug.modDoseUnit || "mg") === "auc" ? "Modified AUC" : "Modified Dose"}>
                                <TextField type="number" fullWidth size="small" sx={{ ...inputStyle, m: 0 }} value={drug.modDose} onChange={e => {
                                  const updated = [...formData.partB.drugPreparations];
                                  updated[dIndex].modDose = e.target.value;
                                  setFormData(prev => ({ ...prev, partB: { ...prev.partB, drugPreparations: updated } }));
                                }} />
                              </FieldRow>
                            </Box>
                          </Box>
                          <FieldRow label="Reason(s) for Modification">
                            <Box sx={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 1 }}>
                              <CustomCheckbox label="Co-morbidities" checked={drug.modReasonComorb} onChange={e => {
                                const updated = [...formData.partB.drugPreparations];
                                updated[dIndex].modReasonComorb = e.target.checked;
                                setFormData(prev => ({ ...prev, partB: { ...prev.partB, drugPreparations: updated } }));
                              }} />
                              <CustomCheckbox label="Toxicity" checked={drug.modReasonTox} onChange={e => {
                                const updated = [...formData.partB.drugPreparations];
                                updated[dIndex].modReasonTox = e.target.checked;
                                setFormData(prev => ({ ...prev, partB: { ...prev.partB, drugPreparations: updated } }));
                              }} />
                              <CustomCheckbox label="Performance Status" checked={drug.modReasonPerf} onChange={e => {
                                const updated = [...formData.partB.drugPreparations];
                                updated[dIndex].modReasonPerf = e.target.checked;
                                setFormData(prev => ({ ...prev, partB: { ...prev.partB, drugPreparations: updated } }));
                              }} />
                              <CustomCheckbox label="Nutritional Status" checked={drug.modReasonNutri} onChange={e => {
                                const updated = [...formData.partB.drugPreparations];
                                updated[dIndex].modReasonNutri = e.target.checked;
                                setFormData(prev => ({ ...prev, partB: { ...prev.partB, drugPreparations: updated } }));
                              }} />
                              <CustomCheckbox label="General Condition" checked={drug.modReasonGen} onChange={e => {
                                const updated = [...formData.partB.drugPreparations];
                                updated[dIndex].modReasonGen = e.target.checked;
                                setFormData(prev => ({ ...prev, partB: { ...prev.partB, drugPreparations: updated } }));
                              }} />
                              <CustomCheckbox label="Other" checked={drug.modReasonOther} onChange={e => {
                                const updated = [...formData.partB.drugPreparations];
                                updated[dIndex].modReasonOther = e.target.checked;
                                setFormData(prev => ({ ...prev, partB: { ...prev.partB, drugPreparations: updated } }));
                              }} />
                            </Box>
                          </FieldRow>
                        </Box>
                      </Box>
                    )}

                    <FieldRow label="Calculated Dose" tag="Auto by BSA / AUC / Wt rules">
                      <Box sx={{ ...inputStyle, p: 1.25, backgroundColor: C.bgSecondary, color: C.textPrimary }}>
                        {(() => {
                          const unit = drug.whetherMod === "yes" && drug.modDose 
                            ? (drug.modDoseUnit || "mg") 
                            : (drug.doseUnit || "m2");
                          const doseInput = drug.whetherMod === "yes" && drug.modDose
                            ? drug.modDose
                            : drug.dose;
                          const result = computeDrugDose({
                            unit,
                            dose: doseInput,
                            height: formData.overview.height,
                            weight: formData.overview.weight,
                            age: formData.overview.patientAge,
                            gender: formData.overview.patientGender,
                            creatinine: formData.overview.serumCreatinine,
                            aucTarget: doseInput,
                          });
                          const drugNameStr = drug.drugName || "Drug";
                          if (result.formula && result.formula !== "—" && !result.formula.startsWith("Need")) {
                            return (
                              <Box>
                                <Typography sx={{ fontSize: 13, fontFamily: FONT, fontWeight: FW_MEDIUM }}>
                                  {drugNameStr}: {result.totalMg != null ? `${result.totalMg} mg` : result.formula}
                                </Typography>
                                <Typography sx={{ fontSize: 11, color: C.textMuted, fontFamily: FONT, mt: 0.5 }}>
                                  {result.method} · {result.formula}
                                  {result.bsa ? ` · BSA ${result.bsa.toFixed(2)} m²` : ""}
                                  {result.bmi ? ` · BMI ${result.bmi.toFixed(1)}` : ""}
                                  {result.crcl != null ? ` · CrCl ${result.crcl.toFixed(1)} mL/min` : ""}
                                </Typography>
                              </Box>
                            );
                          }
                          return result.formula || "— (Enter drug, dose basis, and required parameters)";
                        })()}
                      </Box>
                    </FieldRow>
                  </Box>
                ))}

                {/* REAL-TIME CLIENT-SIDE ALLERGY CONFLICT WARNING (Part B) */}
                {(() => {
                  const conflicts = getDeterministicAllergyConflicts(formData.partB.drugPreparations);
                  if (conflicts.length === 0) return null;
                  return (
                    <Box sx={{ mx: 3, mt: 2, mb: 1, p: 2, border: "2px solid #d32f2f", background: "#ffebee", borderRadius: 1 }}>
                      <Typography sx={{ fontSize: 13, fontWeight: "bold", color: "#d32f2f", mb: 1, display: "flex", alignItems: "center", gap: 1 }}>
                        🚨 CRITICAL PATIENT SAFETY ALERT: DRUG ALLERGY CONFLICT
                      </Typography>
                      {conflicts.map((c, i) => (
                        <Typography key={i} sx={{ fontSize: 12.5, color: "#b71c1c", mb: 0.5, fontWeight: 500 }}>
                          • Patient has a documented allergy to <strong>{c.allergyDrug}</strong> ({c.type}, Severity: {c.severity}), which is prepared in this cycle as <strong>{c.prescribedDrug}</strong>.
                        </Typography>
                      ))}
                    </Box>
                  );
                })()}

                {/* AI SAFETY CHECK BANNER (Part B) */}
                <Box sx={{ display: "flex", justifyContent: "flex-end", px: 3, pt: 1, pb: 1 }}>
                  <Button
                    variant="outlined" size="small"
                    sx={{ borderColor: C.black, color: C.black, textTransform: "none", "&:hover": { background: C.bgSecondary } }}
                    onClick={checkDrugSafetyB}
                    disabled={safetyCheckLoadingB}
                  >
                    {safetyCheckLoadingB ? "Checking safety..." : "Check Drug Safety (AI)"}
                  </Button>
                </Box>
                {safetyCheckErrorB && (
                  <Box sx={{ mx: 3, mb: 2, p: 1.5, border: "1px solid #d32f2f", background: "#fdecea", fontSize: 13, color: "#d32f2f" }}>
                    {safetyCheckErrorB}
                  </Box>
                )}
                {safetyWarningsB && !safetyWarningsB.is_safe && (
                  <Box sx={{ mx: 3, mb: 2, p: 2, border: "1px solid #ff9800", background: "#fff3e0" }}>
                    <Typography sx={{ fontSize: 13, fontWeight: 600, color: "#e65100", mb: 1 }}>
                      ⚠ Drug Safety Warning (AI)
                    </Typography>
                    {safetyWarningsB.warnings?.map((w, i) => (
                      <Typography key={i} sx={{ fontSize: 12, color: "#e65100", mb: 0.5 }}>• {w}</Typography>
                    ))}
                    {safetyWarningsB.alternative_suggestions && (
                      <Box sx={{ mt: 1 }}>
                        <Typography sx={{ fontSize: 12, color: "#e65100", fontWeight: 500 }}>
                          Suggested Alternatives: {safetyWarningsB.alternative_suggestions}
                        </Typography>
                        {safetyWarningsB.alternative_drug_names?.length > 0 && (
                          <Box sx={{ display: "flex", gap: 1, mt: 1, flexWrap: "wrap" }}>
                            {safetyWarningsB.alternative_drug_names.map((altDrug, idx) => (
                              <Button
                                key={idx}
                                size="small"
                                variant="outlined"
                                sx={{ textTransform: "none", borderColor: "#e65100", color: "#e65100", "&:hover": { backgroundColor: "rgba(230, 81, 0, 0.08)" } }}
                                onClick={() => {
                                  handleUpdate("partB", "medDrugName", altDrug);

                                  // Also update Current Medication Details (Part A) to save the doctor from typing it twice
                                  let replaced = false;

                                  if (safetyWarningsB.drugs_to_replace && safetyWarningsB.drugs_to_replace.length > 0) {
                                    safetyWarningsB.drugs_to_replace.forEach(drugToReplace => {
                                      const index = formData.partA.drugs.findIndex(d => d.name?.toLowerCase().trim() === drugToReplace.toLowerCase().trim());
                                      if (index !== -1 && !replaced) {
                                        handleArrayUpdate("partA", "drugs", index, "name", altDrug);
                                        replaced = true;
                                      }
                                    });
                                  }

                                  const allergyDrug = formData.overview.allergyDrug?.toLowerCase().trim();
                                  if (!replaced && allergyDrug) {
                                    const index = formData.partA.drugs.findIndex(d => d.name?.toLowerCase().trim() === allergyDrug);
                                    if (index !== -1) {
                                      handleArrayUpdate("partA", "drugs", index, "name", altDrug);
                                      replaced = true;
                                    }
                                  }

                                  // If we didn't replace an existing drug, fill an empty row or add a new one
                                  if (!replaced) {
                                    const emptyIndex = formData.partA.drugs.findIndex(d => !d.name || d.name.trim() === "");
                                    if (emptyIndex !== -1) {
                                      handleArrayUpdate("partA", "drugs", emptyIndex, "name", altDrug);
                                    } else {
                                      handleArrayAction("partA", "drugs", "add", { id: Date.now(), name: altDrug, type: "", dose: "", unit: "", maxDose: "", route: "", adminType: "", frequency: "", diluent: "", volume: "", duration: "", instructions: "" });
                                    }
                                  }

                                  setSafetyWarningsB(null);
                                  setSafetyCheckErrorB(null);
                                }}
                              >
                                Use {altDrug}
                              </Button>
                            ))}
                          </Box>
                        )}
                      </Box>
                    )}
                  </Box>
                )}
                {safetyWarningsB && safetyWarningsB.is_safe && (
                  <Box sx={{ mx: 3, mb: 2, p: 1.5, border: "1px solid #4caf50", background: "#e8f5e9", fontSize: 13, color: "#2e7d32" }}>
                    ✓ AI Safety Check: No contraindications found based on documented allergies and toxicities.
                  </Box>
                )}

                <FieldRow label="Safety Checks">
                  <Box sx={{ display: "flex", gap: 1, flexWrap: "wrap", flexDirection: "column" }}>
                    <CustomCheckbox label="Pharmacy Verification Completed" checked={formData.partB.pharmacyVerification} onChange={e => handleUpdate("partB", "pharmacyVerification", e.target.checked)} />
                    <CustomCheckbox label="Nurse Verification Completed" checked={formData.partB.nurseVerification} onChange={e => handleUpdate("partB", "nurseVerification", e.target.checked)} />
                    <CustomCheckbox label="Preparation with PPE under Laminar Airflow" checked={formData.partB.prepPPE} onChange={e => handleUpdate("partB", "prepPPE", e.target.checked)} />
                  </Box>
                </FieldRow>
                <FieldRow label="Labeling Details">
                  <TextField fullWidth multiline rows={2} sx={inputStyle} placeholder="Patient ID, drug, dilution, route, schedule" value={formData.partB.labelingDetails} onChange={e => handleUpdate("partB", "labelingDetails", e.target.value)} />
                </FieldRow>

                <SectionHeader
                  num="Section 3"
                  title="Current Medication Details"
                  action={
                    <Button variant="outlined" size="small" sx={{ borderColor: C.white, color: C.white, "&:hover": { borderColor: C.white, background: "rgba(255,255,255,0.1)" } }} startIcon={<Add />} onClick={() => handleArrayAction("partA", "drugs", "add", { id: Date.now(), name: "", type: "", dose: "", unit: "", maxDose: "", route: "", adminType: "", frequency: "", diluent: "", volume: "", duration: "", instructions: "" })}>
                      Add Drug
                    </Button>
                  }
                />
                <Box sx={{ px: 3, pt: 3 }}>
                  <DrugHistoryTable dbCycles={dbCycles} completedCycles={treatment?.completedCycles || 0} />
                </Box>
                <FieldRow label="Automated Dosing Parameters" tag="Used for BSA / AUC / Wt calculations">
                  <Box sx={{ border: `1px solid ${C.border}`, background: C.bgSecondary, p: "12px 14px" }}>
                    {(() => {
                      const bsa = calcBSA(formData.overview.height, formData.overview.weight);
                      const bmi = calcBMI(formData.overview.height, formData.overview.weight);
                      const crcl = calcCrCl({
                        age: formData.overview.patientAge,
                        weightKg: formData.overview.weight,
                        creatinineMgDl: formData.overview.serumCreatinine,
                        gender: formData.overview.patientGender,
                      });
                      return (
                        <Box sx={{ display: "grid", gridTemplateColumns: { xs: "1fr", md: "1fr 1fr" }, gap: 1 }}>
                          <Typography sx={{ fontSize: 12.5, fontFamily: FONT }}>
                            Height: {formData.overview.height || "—"} cm · Weight: {formData.overview.weight || "—"} kg
                          </Typography>
                          <Typography sx={{ fontSize: 12.5, fontFamily: FONT }}>
                            Age: {formData.overview.patientAge || "—"} · Gender: {formData.overview.patientGender || "—"}
                          </Typography>
                          <Typography sx={{ fontSize: 12.5, fontFamily: FONT, fontWeight: FW_MEDIUM }}>
                            BSA: {bsa ? `${bsa.toFixed(2)} m² (DuBois)` : "—"} · BMI: {bmi ? bmi.toFixed(1) : "—"}
                          </Typography>
                          <Typography sx={{ fontSize: 12.5, fontFamily: FONT, fontWeight: FW_MEDIUM }}>
                            Creatinine: {formData.overview.serumCreatinine || "—"} mg/dL · CrCl/GFR: {crcl != null ? `${crcl.toFixed(1)} mL/min` : "—"}
                          </Typography>
                          <Typography sx={{ fontSize: 11, color: C.textMuted, fontFamily: FONT, gridColumn: "1 / -1" }}>
                            Rules: mg/m² uses BSA · mg/kg uses weight · AUC uses Calvert (AUC × (CrCl+25)) · Fixed mg as entered
                          </Typography>
                        </Box>
                      );
                    })()}
                  </Box>
                </FieldRow>
                <FieldRow
                  label="Drug Interaction Checking"
                  tag="From Allergic Reaction"
                >
                  <Box sx={{ border: `1px solid ${C.border}`, background: C.bgSecondary, p: "12px 14px" }}>
                    {formData.overview.allergy === "yes" && formData.overview.allergies?.length > 0 ? (
                      formData.overview.allergies.map((allergy, idx) => (
                        <Box key={allergy.id || idx} sx={{ mb: idx < formData.overview.allergies.length - 1 ? 1.5 : 0, pb: idx < formData.overview.allergies.length - 1 ? 1.5 : 0, borderBottom: idx < formData.overview.allergies.length - 1 ? `1px solid ${C.border}` : 'none' }}>
                          <Typography sx={{ fontSize: 13, fontFamily: FONT, color: C.textPrimary, fontWeight: FW_MEDIUM, mb: 0.5 }}>
                            Drug: {allergy.drug || "—"}
                            {allergy.type ? ` · Reaction: ${allergy.type}` : ""}
                            {allergy.severity ? ` · Severity: ${allergy.severity}` : ""}
                          </Typography>
                          <Typography sx={{ fontSize: 13, fontFamily: FONT, color: C.textPrimary, fontWeight: FW_MEDIUM }}>
                            {allergy.interactionChecked
                              ? `Interaction checked via: ${allergy.interactionChecked}`
                              : "Interaction source not selected"}
                          </Typography>
                        </Box>
                      ))
                    ) : formData.overview.allergy === "no" ? (
                      <Typography sx={{ fontSize: 13, fontFamily: FONT, color: C.textPrimary, fontWeight: FW_MEDIUM }}>
                        No known drug allergies
                      </Typography>
                    ) : (
                      <Typography sx={{ fontSize: 13, fontFamily: FONT, color: C.textPrimary, fontWeight: FW_MEDIUM }}>
                        Allergic reaction not recorded in Overview
                      </Typography>
                    )}
                    <Typography sx={{ mt: 0.75, fontSize: 11, color: C.textMuted, fontFamily: FONT }}>
                      Checks for potential drug interactions between chemotherapy drugs and other medications the patient may be taking.
                    </Typography>
                  </Box>
                </FieldRow>
                <Box sx={{ p: 3, overflowX: "auto" }}>
                  <Box sx={{ minWidth: 1350, display: "flex", flexDirection: "column", gap: 1 }}>
                    {/* Table Header */}
                    <Box sx={{ display: "flex", gap: 1, p: 1, background: C.bgSecondary, border: `1px solid ${C.border}`, fontWeight: FW_MEDIUM, fontSize: 12.5 }}>
                      <Box sx={{ flex: 2 }}>Drug Name</Box>
                      <Box sx={{ flex: 1.5 }}>Type</Box>
                      <Box sx={{ flex: 1 }}>Dose</Box>
                      <Box sx={{ flex: 1.5 }}>Unit</Box>
                      <Box sx={{ flex: 1.5 }}>Calc. Dose</Box>
                      <Box sx={{ flex: 1 }}>Max Dose</Box>
                      <Box sx={{ flex: 1.5 }}>Route</Box>
                      <Box sx={{ flex: 1.5 }}>Admin Type</Box>
                      <Box sx={{ flex: 1.5 }}>Frequency</Box>
                      <Box sx={{ flex: 1.5 }}>Diluent</Box>
                      <Box sx={{ flex: 1 }}>Volume(ml)</Box>
                      <Box sx={{ flex: 1 }}>Duration</Box>
                      <Box sx={{ flex: 2 }}>Instructions</Box>
                      <Box sx={{ width: 40 }}></Box>
                    </Box>
                    {/* Table Rows */}
                    {formData.partA.drugs.map((drug, index) => {
                      const result = computeDrugDose({
                        unit: drug.unit,
                        dose: drug.dose,
                        height: formData.overview.height,
                        weight: formData.overview.weight,
                        age: formData.overview.patientAge,
                        gender: formData.overview.patientGender,
                        creatinine: formData.overview.serumCreatinine,
                        aucTarget: drug.dose,
                      });
                      const calculatedDose = result.totalMg != null
                        ? `${result.totalMg} mg`
                        : (result.formula && !String(result.formula).startsWith("Need") ? result.formula : (result.formula || "—"));

                      const isOral = drug.route === "oral" || drug.route === "po" || drug.adminType === "oral";

                      return (
                        <Box key={drug.id} sx={{ display: "flex", gap: 1, alignItems: "center" }}>
                          <Box sx={{ flex: 2 }}>
                            <Autocomplete
                              freeSolo
                              options={[
                                "Paclitaxel", "Carboplatin", "Docetaxel", "Cyclophosphamide",
                                "Doxorubicin", "Epirubicin", "Fluorouracil", "Oxaliplatin",
                                "Irinotecan", "Gemcitabine", "Cisplatin", "Pemetrexed",
                                "Etoposide", "Bevacizumab", "Trastuzumab", "Rituximab",
                                "Pembrolizumab", "Nivolumab", "Nab-Paclitaxel", "Capecitabine", "Olaparib"
                              ]}
                              value={drug.name || ""}
                              onChange={(e, newValue) => handleArrayUpdate("partA", "drugs", index, "name", newValue || "")}
                              onInputChange={(e, newInputValue) => handleArrayUpdate("partA", "drugs", index, "name", newInputValue || "")}
                              renderInput={(params) => <TextField {...params} size="small" sx={{ ...inputStyle, m: 0 }} placeholder="Drug" />}
                            />
                          </Box>
                          <Box sx={{ flex: 1.5 }}>
                            <Select fullWidth size="small" sx={{ ...inputStyle, m: 0 }} displayEmpty value={drug.type} onChange={e => handleArrayUpdate("partA", "drugs", index, "type", e.target.value)}>
                              <MenuItem value=""><em>Select</em></MenuItem>
                              <MenuItem value="pre">Pre-Systemic</MenuItem>
                              <MenuItem value="systemic">Systemic</MenuItem>
                              <MenuItem value="post">Post-Systemic</MenuItem>
                            </Select>
                          </Box>
                          <Box sx={{ flex: 1 }}><TextField type="number" fullWidth size="small" sx={{ ...inputStyle, m: 0 }} value={drug.dose} onChange={e => handleArrayUpdate("partA", "drugs", index, "dose", e.target.value)} placeholder={drug.unit === "auc" ? "AUC" : "Dose"} /></Box>
                          <Box sx={{ flex: 1.5 }}>
                            <Select fullWidth size="small" sx={{ ...inputStyle, m: 0 }} displayEmpty value={drug.unit} onChange={e => handleArrayUpdate("partA", "drugs", index, "unit", e.target.value)}>
                              <MenuItem value=""><em>-</em></MenuItem>
                              <MenuItem value="m2">mg/m²</MenuItem>
                              <MenuItem value="kg">mg/kg</MenuItem>
                              <MenuItem value="auc">AUC</MenuItem>
                              <MenuItem value="mg">mg (flat)</MenuItem>
                              <MenuItem value="mcg">mcg</MenuItem>
                              <MenuItem value="ml">ml</MenuItem>
                            </Select>
                          </Box>
                          <Box sx={{ flex: 1.5 }}>
                            <Box sx={{ ...inputStyle, m: 0, p: 1, backgroundColor: C.bgSecondary, color: C.textPrimary, fontSize: 11, minHeight: 40, display: "flex", alignItems: "center" }} title={result.formula || ""}>
                              {calculatedDose}
                            </Box>
                          </Box>
                          <Box sx={{ flex: 1 }}><TextField type="number" fullWidth size="small" sx={{ ...inputStyle, m: 0 }} value={drug.maxDose} onChange={e => handleArrayUpdate("partA", "drugs", index, "maxDose", e.target.value)} /></Box>
                          <Box sx={{ flex: 1.5 }}>
                            <Select
                              fullWidth size="small" sx={{ ...inputStyle, m: 0 }} displayEmpty
                              value={drug.route}
                              onChange={e => {
                                const newRoute = e.target.value;
                                handleArrayUpdate("partA", "drugs", index, "route", newRoute);
                                if (newRoute === "oral") {
                                  handleArrayUpdate("partA", "drugs", index, "adminType", "oral");
                                  handleArrayUpdate("partA", "drugs", index, "diluent", "");
                                  handleArrayUpdate("partA", "drugs", index, "volume", "");
                                  handleArrayUpdate("partA", "drugs", index, "duration", "");
                                }
                              }}
                            >
                              <MenuItem value=""><em>Route</em></MenuItem>
                              <MenuItem value="iv">Intravenous</MenuItem><MenuItem value="oral">Per Oral</MenuItem><MenuItem value="sc">Subcutaneous</MenuItem>
                            </Select>
                          </Box>
                          <Box sx={{ flex: 1.5 }}>
                            <Select fullWidth size="small" sx={{ ...inputStyle, m: 0 }} displayEmpty value={drug.adminType} onChange={e => handleArrayUpdate("partA", "drugs", index, "adminType", e.target.value)}>
                              <MenuItem value=""><em>Type</em></MenuItem>
                              <MenuItem value="oral">Oral</MenuItem><MenuItem value="bolus">Bolus</MenuItem><MenuItem value="infusion">Infusion</MenuItem>
                            </Select>
                          </Box>
                          <Box sx={{ flex: 1.5 }}>
                            <Select fullWidth size="small" sx={{ ...inputStyle, m: 0 }} displayEmpty value={drug.frequency} onChange={e => handleArrayUpdate("partA", "drugs", index, "frequency", e.target.value)}>
                              <MenuItem value=""><em>Freq</em></MenuItem>
                              <MenuItem value="od">Once Daily</MenuItem><MenuItem value="bd">Twice Daily</MenuItem>
                            </Select>
                          </Box>
                          <Box sx={{ flex: 1.5 }}>
                            <TextField disabled={isOral} fullWidth size="small" sx={{ ...inputStyle, m: 0, opacity: isOral ? 0.5 : 1 }} placeholder={isOral ? "N/A" : "Diluent (e.g. NS)"} value={isOral ? "" : (drug.diluent || "")} onChange={e => handleArrayUpdate("partA", "drugs", index, "diluent", e.target.value)} />
                          </Box>
                          <Box sx={{ flex: 1 }}><TextField disabled={isOral} type="number" fullWidth size="small" sx={{ ...inputStyle, m: 0, opacity: isOral ? 0.5 : 1 }} placeholder={isOral ? "N/A" : "Vol(ml)"} value={isOral ? "" : (drug.volume || "")} onChange={e => handleArrayUpdate("partA", "drugs", index, "volume", e.target.value)} /></Box>
                          <Box sx={{ flex: 1 }}>
                            <TextField disabled={isOral} fullWidth size="small" sx={{ ...inputStyle, m: 0, opacity: isOral ? 0.5 : 1 }} placeholder={isOral ? "N/A" : "Duration (e.g. 180 min)"} value={isOral ? "" : (drug.duration || "")} onChange={e => handleArrayUpdate("partA", "drugs", index, "duration", e.target.value)} />
                          </Box>
                          <Box sx={{ flex: 2 }}><TextField fullWidth size="small" sx={{ ...inputStyle, m: 0 }} value={drug.instructions} onChange={e => handleArrayUpdate("partA", "drugs", index, "instructions", e.target.value)} /></Box>
                          <Box sx={{ width: 40, display: "flex", justifyContent: "center" }}>
                            <IconButton size="small" sx={{ color: C.black }} onClick={() => handleArrayAction("partA", "drugs", "remove", index)}><Delete fontSize="small" /></IconButton>
                          </Box>
                        </Box>
                      );
                    })}
                  </Box>
                </Box>

                {/* REAL-TIME CLIENT-SIDE ALLERGY CONFLICT WARNING (Part A) */}
                {(() => {
                  const conflicts = getDeterministicAllergyConflicts(formData.partA.drugs);
                  if (conflicts.length === 0) return null;
                  return (
                    <Box sx={{ mx: 3, mt: 2, p: 2, border: "2px solid #d32f2f", background: "#ffebee", borderRadius: 1 }}>
                      <Typography sx={{ fontSize: 13, fontWeight: "bold", color: "#d32f2f", mb: 1, display: "flex", alignItems: "center", gap: 1 }}>
                        🚨 CRITICAL PATIENT SAFETY ALERT: DRUG ALLERGY CONFLICT
                      </Typography>
                      {conflicts.map((c, i) => (
                        <Typography key={i} sx={{ fontSize: 12.5, color: "#b71c1c", mb: 0.5, fontWeight: 500 }}>
                          • Patient has a documented allergy to <strong>{c.allergyDrug}</strong> ({c.type}, Severity: {c.severity}), which is currently included in the prescribed protocol as <strong>{c.prescribedDrug}</strong>.
                        </Typography>
                      ))}
                    </Box>
                  );
                })()}

                {/* AI SAFETY CHECK BANNER (Part A) */}
                <Box sx={{ display: "flex", justifyContent: "flex-end", px: 3, pt: 1 }}>
                  <Button
                    variant="outlined" size="small"
                    sx={{ borderColor: C.black, color: C.black, textTransform: "none", "&:hover": { background: C.bgSecondary } }}
                    onClick={checkDrugSafetyA}
                    disabled={safetyCheckLoadingA}
                  >
                    {safetyCheckLoadingA ? "Checking safety..." : "Check Drug Safety (AI)"}
                  </Button>
                </Box>
                {safetyCheckErrorA && (
                  <Box sx={{ mx: 3, mt: 1, p: 1.5, border: "1px solid #d32f2f", background: "#fdecea", fontSize: 13, color: "#d32f2f" }}>
                    {safetyCheckErrorA}
                  </Box>
                )}
                {safetyWarningsA && !safetyWarningsA.is_safe && (
                  <Box sx={{ mx: 3, mt: 1, p: 2, border: "1px solid #ff9800", background: "#fff3e0" }}>
                    <Typography sx={{ fontSize: 13, fontWeight: 600, color: "#e65100", mb: 1 }}>
                      ⚠ Drug Safety Warning (AI)
                    </Typography>
                    {safetyWarningsA.warnings?.map((w, i) => (
                      <Typography key={i} sx={{ fontSize: 12, color: "#e65100", mb: 0.5 }}>• {w}</Typography>
                    ))}
                    {safetyWarningsA.alternative_suggestions && (
                      <Box sx={{ mt: 1 }}>
                        <Typography sx={{ fontSize: 12, color: "#e65100", fontWeight: 500 }}>
                          Suggested Alternatives: {safetyWarningsA.alternative_suggestions}
                        </Typography>
                        {safetyWarningsA.alternative_drug_names?.length > 0 && (
                          <Box sx={{ display: "flex", gap: 1, mt: 1, flexWrap: "wrap" }}>
                            {safetyWarningsA.alternative_drug_names.map((altDrug, idx) => (
                              <Button
                                key={idx}
                                size="small"
                                variant="outlined"
                                sx={{ textTransform: "none", borderColor: "#e65100", color: "#e65100", "&:hover": { backgroundColor: "rgba(230, 81, 0, 0.08)" } }}
                                onClick={() => {
                                  let replaced = false;

                                  if (safetyWarningsA.drugs_to_replace && safetyWarningsA.drugs_to_replace.length > 0) {
                                    safetyWarningsA.drugs_to_replace.forEach(drugToReplace => {
                                      const index = formData.partA.drugs.findIndex(d => d.name?.toLowerCase().trim() === drugToReplace.toLowerCase().trim());
                                      if (index !== -1 && !replaced) {
                                        handleArrayUpdate("partA", "drugs", index, "name", altDrug);
                                        replaced = true;
                                      }
                                    });
                                  }

                                  const allergyDrug = formData.overview.allergyDrug?.toLowerCase().trim();
                                  if (!replaced && allergyDrug) {
                                    const index = formData.partA.drugs.findIndex(d => d.name?.toLowerCase().trim() === allergyDrug);
                                    if (index !== -1) {
                                      handleArrayUpdate("partA", "drugs", index, "name", altDrug);
                                      replaced = true;
                                    }
                                  }
                                  if (!replaced) {
                                    handleArrayAction("partA", "drugs", "add", { id: Date.now(), name: altDrug, type: "", dose: "", unit: "", maxDose: "", route: "", adminType: "", frequency: "", diluent: "", volume: "", duration: "", instructions: "" });
                                  }

                                  // Also update Drug Preparation (Part B) to save the doctor from typing it twice
                                  const partBDrug = formData.partB.medDrugName?.toLowerCase().trim();
                                  if (partBDrug) {
                                    const matchAllergy = allergyDrug && partBDrug === allergyDrug;
                                    const matchToReplace = safetyWarningsA.drugs_to_replace?.some(d => d.toLowerCase().trim() === partBDrug);
                                    if (matchAllergy || matchToReplace) {
                                      handleUpdate("partB", "medDrugName", altDrug);
                                    }
                                  }

                                  setSafetyWarningsA(null);
                                  setSafetyCheckErrorA(null);
                                }}
                              >
                                Use {altDrug}
                              </Button>
                            ))}
                          </Box>
                        )}
                      </Box>
                    )}
                  </Box>
                )}
                {safetyWarningsA && safetyWarningsA.is_safe && (
                  <Box sx={{ mx: 3, mt: 1, p: 1.5, border: "1px solid #4caf50", background: "#e8f5e9", fontSize: 13, color: "#2e7d32" }}>
                    ✓ AI Safety Check: No contraindications found based on documented allergies and toxicities.
                  </Box>
                )}

                <ApprovalsSection
                  cards={[
                    {
                      title: "Doctor",
                      name: formData.partB.approvalDoctorName || fetchedDoctorName || doctorName || "",
                      onNameChange: (v) => handleUpdate("partB", "approvalDoctorName", v),
                      signed: !!formData.partB.approvalDoctorSigned,
                      onToggleSign: () => {
                        if (!formData.partB.approvalDoctorName && (fetchedDoctorName || doctorName)) {
                          handleUpdate("partB", "approvalDoctorName", fetchedDoctorName || doctorName);
                        }
                        handleUpdate("partB", "approvalDoctorSigned", !formData.partB.approvalDoctorSigned);
                      },
                      namePlaceholder: "Doctor name",
                    },
                  ]}
                />
              </Box>
            )}

            {/* TAB: CT PART C (Nurse's Notes) */}
            {activeTab === "partC" && (
              <Box>
                <VoiceDictationPanel
                  title="Nurse's Note / Voice Dictation"
                  placeholder="Type or dictate nursing notes here. Use the buttons below to start voice dictation or run AI auto-fill."
                  transcript={nurseNoteTranscript}
                  setTranscript={setNurseNoteTranscript}
                  onAutofill={processNurseNoteDictation}
                  isAutofilling={isPrefillingNurseNote}
                  autofillSuccess={nurseNoteFillSuccess}
                />

                {/* ─── PATIENT REFERRAL SECTION ─────────────────────────── */}
                <Box sx={{ mb: 2 }}>
                  <PatientReferralsTab
                    patientId={patientId}
                    doctorId={doctorId}
                    doctorName={fetchedDoctorName || doctorName}
                    hospitalId={actualHospitalId || hospitalId}
                  />
                </Box>

                <SectionHeader num="Section 1" title="Treatment Details" />
                <Box sx={{ px: 3, pt: 3 }}>
                  <TreatmentDetailsHistoryTable dbCycles={dbCycles} completedCycles={treatment?.completedCycles || 0} />
                </Box>

                <FieldRow label="Plan Date">
                  <TextField type="date" fullWidth size="small" sx={inputStyle} placeholder="Auto Populate" value={formData.partC.planDate} onChange={e => handleUpdate("partC", "planDate", e.target.value)} />
                </FieldRow>
                <FieldRow label="Place of Treatment">
                  <Box sx={{ display: "flex", gap: 1, flexWrap: "wrap" }}>
                    <CustomCheckbox label="Casualty" checked={formData.partC.placeOfTreatmentCasualty} onChange={e => handleUpdate("partC", "placeOfTreatmentCasualty", e.target.checked)} />
                    <CustomCheckbox label="Daycare" checked={formData.partC.placeOfTreatmentDaycare} onChange={e => handleUpdate("partC", "placeOfTreatmentDaycare", e.target.checked)} />
                    <CustomCheckbox label="Ward" checked={formData.partC.placeOfTreatmentWard} onChange={e => handleUpdate("partC", "placeOfTreatmentWard", e.target.checked)} />
                    <CustomCheckbox label="Other" checked={formData.partC.placeOfTreatmentOther} onChange={e => handleUpdate("partC", "placeOfTreatmentOther", e.target.checked)} />
                  </Box>
                </FieldRow>
                <FieldRow label="General / Private">
                  <Box sx={{ display: "flex", gap: 1 }}>
                    <CustomRadio label="General" value="general" checked={formData.partC.wardType === "general"} onChange={() => handleUpdate("partC", "wardType", "general")} />
                    <CustomRadio label="Private" value="private" checked={formData.partC.wardType === "private"} onChange={() => handleUpdate("partC", "wardType", "private")} />
                  </Box>
                </FieldRow>
                <FieldRow label="Administration Route">
                  <Box sx={{ display: "flex", flexDirection: "column", gap: 1.5, width: "100%" }}>
                    <Select fullWidth size="small" sx={inputStyle} displayEmpty value={formData.partC.adminRoute} onChange={e => handleUpdate("partC", "adminRoute", e.target.value)}>
                      <MenuItem value=""><em>Select Route</em></MenuItem>
                      <MenuItem value="IV">Intravenous (IV)</MenuItem>
                      <MenuItem value="Oral">Oral</MenuItem>
                      <MenuItem value="SC">Subcutaneous (SC)</MenuItem>
                      <MenuItem value="IM">Intramuscular (IM)</MenuItem>
                      <MenuItem value="Mixed">Mixed (IV + Oral)</MenuItem>
                    </Select>
                    {(formData.partC.adminRoute === "Mixed" || formData.partC.adminRoute === "Mixed (IV + Oral)") && (
                      <TextField
                        fullWidth
                        size="small"
                        sx={inputStyle}
                        placeholder="Specify routes (e.g., Paclitaxel IV + Capecitabine Oral)"
                        value={formData.partC.adminRouteNotes || ""}
                        onChange={e => handleUpdate("partC", "adminRouteNotes", e.target.value)}
                      />
                    )}
                  </Box>
                </FieldRow>
                <FieldRow label="Total Dose">
                  <Box sx={{ ...inputStyle, p: 1, backgroundColor: C.ghost, color: C.smoke }}>
                    {(() => {
                      const h = parseFloat(formData.overview.height);
                      const w = parseFloat(formData.overview.weight);
                      const bsa = (h && w) ? (0.007184 * Math.pow(h, 0.725) * Math.pow(w, 0.425)) : 0;

                      if (!formData.partA.drugs || formData.partA.drugs.length === 0 || !formData.partA.drugs[0].name) {
                        return "— (Enter drugs in Section 3 to auto-calculate)";
                      }

                      const doses = formData.partA.drugs.map(drug => {
                        let calc = "";
                        let formula = "";
                        const doseVal = parseFloat(drug.dose);
                        if (!isNaN(doseVal)) {
                          if (drug.unit === "m2" && bsa > 0) {
                            calc = Math.round(doseVal * bsa) + " mg";
                            formula = `(${doseVal} mg/m² × ${bsa.toFixed(2)} m²)`;
                          }
                          else if (drug.unit === "kg" && w > 0) {
                            calc = Math.round(doseVal * w) + " mg";
                            formula = `(${doseVal} mg/kg × ${w} kg)`;
                          }
                          else {
                            calc = `${doseVal} ${drug.unit || ""}`.trim();
                          }
                        }
                        return drug.name && calc ? `${drug.name}: ${calc} ${formula}`.trim() : "";
                      }).filter(Boolean);

                      return doses.length > 0 ? doses.join("  |  ") : "—";
                    })()}
                  </Box>
                </FieldRow>
                <FieldRow label="Safety Confirmations">
                  <Box sx={{ display: "flex", gap: 1, flexWrap: "wrap", flexDirection: "column" }}>
                    <CustomCheckbox label="Patient ID Confirmed" checked={formData.partC.patientIdConfirmed} onChange={e => handleUpdate("partC", "patientIdConfirmed", e.target.checked)} />
                    <CustomCheckbox label="Regimen Confirmed" checked={formData.partC.regimenConfirmed} onChange={e => handleUpdate("partC", "regimenConfirmed", e.target.checked)} />
                  </Box>
                </FieldRow>
                <FieldRow label="Pre-medications Administered">
                  <TextField fullWidth multiline rows={2} sx={inputStyle} placeholder="List pre-medications" value={formData.partC.preMedication} onChange={e => handleUpdate("partC", "preMedication", e.target.value)} />
                </FieldRow>

                <SectionHeader num="Section 2" title="Vital Sign Monitoring" />
                <Box sx={{ px: 3, pt: 3 }}>
                  <VitalsHistoryTable dbCycles={dbCycles} completedCycles={treatment?.completedCycles || 0} />
                </Box>
                <Box sx={{ p: 3, pt: 0, overflowX: "auto" }}>
                  <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 800 }}>
                    <thead>
                      <tr style={{ background: C.bgSecondary, border: `1px solid ${C.border}`, fontSize: 12.5, fontWeight: FW_MEDIUM }}>
                        <th style={{ padding: "8px 12px", textAlign: "left", width: "16%", fontWeight: FW_MEDIUM }}>Phase</th>
                        <th style={{ padding: "8px 12px", textAlign: "left", width: "14%", fontWeight: FW_MEDIUM }}>Temp (°F)</th>
                        <th style={{ padding: "8px 12px", textAlign: "left", width: "14%", fontWeight: FW_MEDIUM }}>Pulse (bpm)</th>
                        <th style={{ padding: "8px 12px", textAlign: "left", width: "14%", fontWeight: FW_MEDIUM }}>BP (mmHg)</th>
                        <th style={{ padding: "8px 12px", textAlign: "left", width: "14%", fontWeight: FW_MEDIUM }}>Resp Rate</th>
                        <th style={{ padding: "8px 12px", textAlign: "left", width: "14%", fontWeight: FW_MEDIUM }}>SpO2 (%)</th>
                        <th style={{ padding: "8px 12px", textAlign: "left", width: "14%", fontWeight: FW_MEDIUM }}>Pain (0-10)</th>
                      </tr>
                    </thead>
                    <tbody>
                      {[
                        { id: 'Pre', label: 'Pre-Treatment' },
                        { id: 'During', label: 'During Treatment' },
                        { id: 'Post', label: 'Post-Treatment' }
                      ].map((phase) => (
                        <tr key={phase.id} style={{ borderBottom: `1px solid ${C.border}`, borderLeft: `1px solid ${C.border}`, borderRight: `1px solid ${C.border}` }}>
                          <td style={{ padding: "12px", fontWeight: FW_MEDIUM, color: C.textSecond }}>
                            {phase.label}
                          </td>
                          <td style={{ padding: "12px" }}>
                            <TextField fullWidth size="small" sx={{ ...inputStyle, m: 0 }} placeholder="Auto" value={formData.partC[`temp${phase.id}`] || ""} onChange={e => handleUpdate("partC", `temp${phase.id}`, e.target.value)} />
                          </td>
                          <td style={{ padding: "12px" }}>
                            <TextField fullWidth size="small" sx={{ ...inputStyle, m: 0 }} placeholder="Auto" value={formData.partC[`pulse${phase.id}`] || ""} onChange={e => handleUpdate("partC", `pulse${phase.id}`, e.target.value)} />
                          </td>
                          <td style={{ padding: "12px" }}>
                            <TextField fullWidth size="small" sx={{ ...inputStyle, m: 0 }} placeholder="Auto" value={formData.partC[`bp${phase.id}`] || ""} onChange={e => handleUpdate("partC", `bp${phase.id}`, e.target.value)} />
                          </td>
                          <td style={{ padding: "12px" }}>
                            <TextField fullWidth size="small" sx={{ ...inputStyle, m: 0 }} placeholder="Auto" value={formData.partC[`rr${phase.id}`] || ""} onChange={e => handleUpdate("partC", `rr${phase.id}`, e.target.value)} />
                          </td>
                          <td style={{ padding: "12px" }}>
                            <TextField fullWidth size="small" sx={{ ...inputStyle, m: 0 }} placeholder="Auto" value={formData.partC[`spo2${phase.id}`] || ""} onChange={e => handleUpdate("partC", `spo2${phase.id}`, e.target.value)} />
                          </td>
                          <td style={{ padding: "12px" }}>
                            <TextField fullWidth size="small" sx={{ ...inputStyle, m: 0 }} placeholder="Auto" value={formData.partC[`pain${phase.id}`] || ""} onChange={e => handleUpdate("partC", `pain${phase.id}`, e.target.value)} />
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </Box>

                {(() => {
                  // Derived: detect if drug list changed since last risk check
                  const currentDrugNames = (formData.partC.drugs || []).map(d => d.name?.trim()).filter(Boolean);
                  const recheckNeeded = drugAdminWarnings !== null &&
                    JSON.stringify(currentDrugNames) !== JSON.stringify(drugAdminCheckedDrugsRef.current);

                  // Risk level helpers
                  const riskColor = { high: '#d32f2f', caution: '#e65100', safe: '#2e7d32' };
                  const riskBg = { high: '#fdecea', caution: '#fff3e0', safe: '#e8f5e9' };
                  const riskBorder = { high: '#d32f2f', caution: '#ff9800', safe: '#4caf50' };
                  const riskLabel = { high: '🔴 HIGH RISK', caution: '🟡 CAUTION', safe: '🟢 SAFE' };

                  return (
                    <>
                      <SectionHeader
                        num="Section 3"
                        title="Systemic Therapy Drug Administration"
                        action={
                          <Box sx={{ display: 'flex', gap: 1, alignItems: 'center' }}>
                            <Button
                              variant="outlined"
                              size="small"
                              sx={{ borderColor: C.white, color: C.white, textTransform: 'none', fontFamily: FONT, '&:hover': { borderColor: C.white, background: 'rgba(255,255,255,0.1)' } }}
                              startIcon={<Add />}
                              onClick={() => handleArrayAction("partC", "drugs", "add", { id: Date.now(), name: "", instructions: "", dose: "", diluent: "", given: "", startTime: "", endTime: "", notGivenReason: "", infusionReaction: "" })}
                            >
                              Log Drug Admin
                            </Button>
                            <Button
                              variant="outlined"
                              size="small"
                              startIcon={<WarningAmberRounded sx={{ fontSize: 16 }} />}
                              onClick={checkDrugAdminRisks}
                              disabled={drugAdminWarnLoading}
                              sx={{ borderColor: '#ffcc02', color: '#ffcc02', textTransform: 'none', fontFamily: FONT, '&:hover': { background: 'rgba(255,204,2,0.1)', borderColor: '#ffcc02' }, '&.Mui-disabled': { borderColor: 'rgba(255,255,255,0.3)', color: 'rgba(255,255,255,0.4)' } }}
                            >
                              {drugAdminWarnLoading ? 'Checking Risks…' : 'Check Drug Risks (AI)'}
                            </Button>
                          </Box>
                        }
                      />

                      {/* Recheck banner — appears when drug list changed after last check */}
                      {recheckNeeded && (
                        <Box sx={{ mx: 3, mt: 2, p: 1.5, background: '#fff8e1', border: '1px solid #ff9800', borderRadius: 1, display: 'flex', alignItems: 'center', gap: 1.5 }}>
                          <WarningAmberRounded sx={{ color: '#e65100', fontSize: 18, flexShrink: 0 }} />
                          <Typography sx={{ fontSize: 12.5, color: '#e65100', fontFamily: FONT, flex: 1 }}>
                            Drug list has changed since the last risk check. Please recheck before administering.
                          </Typography>
                          <Button
                            size="small"
                            variant="outlined"
                            onClick={checkDrugAdminRisks}
                            disabled={drugAdminWarnLoading}
                            sx={{ borderColor: '#e65100', color: '#e65100', textTransform: 'none', fontFamily: FONT, flexShrink: 0, '&:hover': { background: 'rgba(230,81,0,0.08)' } }}
                          >
                            Recheck Now
                          </Button>
                        </Box>
                      )}

                      {/* Inline error if check fails */}
                      {drugAdminWarnError && (
                        <Box sx={{ mx: 3, mt: 2, p: 1.5, background: '#fdecea', border: '1px solid #d32f2f', borderRadius: 1 }}>
                          <Typography sx={{ fontSize: 12.5, color: '#d32f2f', fontFamily: FONT }}>{drugAdminWarnError}</Typography>
                        </Box>
                      )}

                      {/* ── Inline Drug Risk Assessment Results (above table) ── */}
                      {drugAdminWarnings && (() => {
                        const results = drugAdminWarnings.results || [];
                        const allSafe = results.every(r => r.risk_level === 'safe');
                        return (
                          <Box sx={{ mx: 3, mt: 2, mb: 1 }}>
                            <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 1.5 }}>
                              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                                <WarningAmberRounded sx={{ color: allSafe ? '#2e7d32' : '#e65100', fontSize: 18 }} />
                                <Typography sx={{ fontSize: 13, fontWeight: FW_MEDIUM, fontFamily: FONT, color: C.black }}>Drug Administration Risk Assessment</Typography>
                              </Box>
                              <Typography sx={{ fontSize: 11, color: C.textMuted, fontFamily: FONT, fontStyle: 'italic' }}>Based on patient's clinical summary</Typography>
                            </Box>
                            {allSafe ? (
                              <Box sx={{ p: 1.75, background: '#e8f5e9', border: '1px solid #4caf50', borderRadius: 1, display: 'flex', alignItems: 'center', gap: 1.5 }}>
                                <Typography sx={{ fontSize: 18 }}>✓</Typography>
                                <Box>
                                  <Typography sx={{ fontSize: 13, fontWeight: FW_MEDIUM, color: '#2e7d32', fontFamily: FONT }}>No significant risks identified</Typography>
                                  <Typography sx={{ fontSize: 11.5, color: '#2e7d32', fontFamily: FONT, mt: 0.25 }}>All drugs appear safe for this patient based on the available clinical summary.</Typography>
                                </Box>
                              </Box>
                            ) : (
                              <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.25 }}>
                                {results.map((r, i) => (
                                  <Box key={i} sx={{ border: `1px solid ${riskBorder[r.risk_level] || C.border}`, borderRadius: 1, background: riskBg[r.risk_level] || C.white, overflow: 'hidden' }}>
                                    <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', px: 2, py: 1, borderBottom: `1px solid ${riskBorder[r.risk_level] || C.border}22` }}>
                                      <Typography sx={{ fontSize: 13, fontWeight: FW_MEDIUM, color: riskColor[r.risk_level] || C.textPrimary, fontFamily: FONT }}>{r.drug}</Typography>
                                      <Typography sx={{ fontSize: 11, fontWeight: 700, color: riskColor[r.risk_level] || C.textPrimary, fontFamily: FONT, letterSpacing: '0.05em' }}>{riskLabel[r.risk_level] || r.risk_level?.toUpperCase()}</Typography>
                                    </Box>
                                    <Box sx={{ px: 2, py: 1, display: 'flex', flexDirection: 'column', gap: 0.75 }}>
                                      {r.reason && <Typography sx={{ fontSize: 12, color: C.textPrimary, fontFamily: FONT }}>{r.reason}</Typography>}
                                      {/* Always show test dose block for caution/high — even if LLM left it empty */}
                                      {(r.risk_level === 'caution' || r.risk_level === 'high') && (
                                        <Box sx={{ p: 1, background: 'rgba(0,0,0,0.04)', borderRadius: 1, borderLeft: `3px solid ${riskColor[r.risk_level]}` }}>
                                          <Typography sx={{ fontSize: 10.5, fontWeight: 700, color: riskColor[r.risk_level], fontFamily: FONT, mb: 0.4, letterSpacing: '0.04em', textTransform: 'uppercase' }}>⚕ Test Dose / Administration Guidance</Typography>
                                          <Typography sx={{ fontSize: 11.5, color: C.textPrimary, fontFamily: FONT }}>
                                            {r.test_dose_instruction || "Observe the patient for a minimum of 15 minutes before proceeding with the full infusion. Monitor for hypersensitivity signs: rash, urticaria, hypotension, dyspnoea, or rigors."}
                                          </Typography>
                                        </Box>
                                      )}
                                    </Box>
                                  </Box>
                                ))}
                                {drugAdminWarnings.overall_summary && (
                                  <Box sx={{ p: 1.25, background: C.bgSecondary, border: `1px solid ${C.border}`, borderRadius: 1 }}>
                                    <Typography sx={{ fontSize: 11.5, color: C.textSecond, fontFamily: FONT, fontStyle: 'italic' }}>{drugAdminWarnings.overall_summary}</Typography>
                                  </Box>
                                )}
                              </Box>
                            )}
                          </Box>
                        );
                      })()}

                      <Box sx={{ px: 3, pt: 3 }}>
                        <AdministeredDrugsHistoryTable dbCycles={dbCycles} completedCycles={treatment?.completedCycles || 0} />
                      </Box>
                      <Box sx={{ p: 3, overflowX: "auto" }}>
                        <Box sx={{ minWidth: 1000, display: "flex", flexDirection: "column", gap: 1 }}>
                          {/* Table Header */}
                          <Box sx={{ display: "flex", gap: 1, p: 1, background: C.bgSecondary, border: `1px solid ${C.border}`, fontWeight: FW_MEDIUM, fontSize: 12.5 }}>
                            <Box sx={{ flex: 1.5 }}>Drug Name</Box>
                            <Box sx={{ flex: 2 }}>Special Instructions</Box>
                            <Box sx={{ flex: 1 }}>Dose</Box>
                            <Box sx={{ flex: 1 }}>Diluent</Box>
                            <Box sx={{ flex: 1 }}>Given</Box>
                            <Box sx={{ flex: 1 }}>Starting Time</Box>
                            <Box sx={{ flex: 1 }}>Ending Time</Box>
                            <Box sx={{ flex: 1.5 }}>Not Given Reason</Box>
                            <Box sx={{ flex: 1 }}>Infusion Rxn</Box>
                            <Box sx={{ width: 40 }}></Box>
                          </Box>
                          {/* Rows */}
                          {formData.partC.drugs.map((drug, index) => (
                            <Box key={drug.id} sx={{ display: "flex", gap: 1, alignItems: "center" }}>
                              <Box sx={{ flex: 1.5 }}><TextField fullWidth size="small" sx={{ ...inputStyle, m: 0 }} placeholder="Auto Populate" value={drug.name} onChange={e => handleArrayUpdate("partC", "drugs", index, "name", e.target.value)} /></Box>
                              <Box sx={{ flex: 2 }}><TextField fullWidth size="small" sx={{ ...inputStyle, m: 0 }} placeholder="From Protocol" value={drug.instructions} onChange={e => handleArrayUpdate("partC", "drugs", index, "instructions", e.target.value)} /></Box>
                              <Box sx={{ flex: 1 }}><TextField fullWidth size="small" sx={{ ...inputStyle, m: 0 }} placeholder="From Notes" value={drug.dose} onChange={e => handleArrayUpdate("partC", "drugs", index, "dose", e.target.value)} /></Box>
                              <Box sx={{ flex: 1 }}><TextField fullWidth size="small" sx={{ ...inputStyle, m: 0 }} placeholder="Diluent" value={drug.diluent || ""} onChange={e => handleArrayUpdate("partC", "drugs", index, "diluent", e.target.value)} /></Box>
                              <Box sx={{ flex: 1 }}>
                                <Select fullWidth size="small" sx={{ ...inputStyle, m: 0 }} displayEmpty value={drug.given} onChange={e => handleArrayUpdate("partC", "drugs", index, "given", e.target.value)}>
                                  <MenuItem value=""><em>-</em></MenuItem>
                                  <MenuItem value="yes">Yes</MenuItem><MenuItem value="no">No</MenuItem>
                                </Select>
                              </Box>
                              <Box sx={{ flex: 1 }}><TextField type="time" fullWidth size="small" sx={{ ...inputStyle, m: 0 }} value={drug.startTime} onChange={e => handleArrayUpdate("partC", "drugs", index, "startTime", e.target.value)} /></Box>
                              <Box sx={{ flex: 1 }}><TextField type="time" fullWidth size="small" sx={{ ...inputStyle, m: 0 }} value={drug.endTime} onChange={e => handleArrayUpdate("partC", "drugs", index, "endTime", e.target.value)} /></Box>
                              <Box sx={{ flex: 1.5 }}><TextField fullWidth size="small" sx={{ ...inputStyle, m: 0 }} placeholder="Reason" value={drug.notGivenReason} onChange={e => handleArrayUpdate("partC", "drugs", index, "notGivenReason", e.target.value)} /></Box>
                              <Box sx={{ flex: 1 }}>
                                <Select fullWidth size="small" sx={{ ...inputStyle, m: 0 }} displayEmpty value={drug.infusionReaction} onChange={e => handleArrayUpdate("partC", "drugs", index, "infusionReaction", e.target.value)}>
                                  <MenuItem value=""><em>-</em></MenuItem>
                                  <MenuItem value="yes">Yes</MenuItem><MenuItem value="no">No</MenuItem>
                                </Select>
                              </Box>
                              <Box sx={{ width: 40, display: "flex", justifyContent: "center" }}>
                                <IconButton size="small" sx={{ color: C.black }} onClick={() => handleArrayAction("partC", "drugs", "remove", index)}><Delete fontSize="small" /></IconButton>
                              </Box>
                            </Box>
                          ))}
                        </Box>
                      </Box>


                    </>
                  );
                })()}

                <SectionHeader num="Section 4" title="Completion Status" />
                <Box sx={{ px: 3, pt: 3 }}>
                  <CompletionStatusHistoryTable dbCycles={dbCycles} completedCycles={treatment?.completedCycles || 0} />
                </Box>
                <FieldRow label="Status of Completion of Cycle">
                  <Box sx={{ display: "flex", flexDirection: "column", gap: 1.5 }}>
                    <Box sx={{ display: "flex", gap: 1 }}>
                      <CustomRadio
                        label="Completed as planned"
                        value="completed"
                        checked={formData.partC.cycleCompleted === "completed"}
                        onChange={() => {
                          handleUpdate("partC", "cycleCompleted", "completed");
                          handleUpdate("partC", "cycleNotCompletedReason", "");
                        }}
                      />
                      <CustomRadio
                        label="Not completed"
                        value="not-completed"
                        checked={formData.partC.cycleCompleted === "not-completed"}
                        onChange={() => handleUpdate("partC", "cycleCompleted", "not-completed")}
                      />
                    </Box>
                    {formData.partC.cycleCompleted === "not-completed" && (
                      <Select
                        fullWidth
                        size="small"
                        sx={inputStyle}
                        displayEmpty
                        value={formData.partC.cycleNotCompletedReason || ""}
                        onChange={e => handleUpdate("partC", "cycleNotCompletedReason", e.target.value)}
                      >
                        <MenuItem value=""><em>Select justification...</em></MenuItem>
                        <MenuItem value="Hypersensitivity / infusion reaction">Hypersensitivity / infusion reaction</MenuItem>
                        <MenuItem value="Severe toxicity">Severe toxicity</MenuItem>
                        <MenuItem value="Patient refused / declined">Patient refused / declined</MenuItem>
                        <MenuItem value="Venous access / line issue">Venous access / line issue</MenuItem>
                        <MenuItem value="Clinical deterioration">Clinical deterioration</MenuItem>
                        <MenuItem value="Drug / equipment unavailability">Drug / equipment unavailability</MenuItem>
                        <MenuItem value="Incomplete dose delivery">Incomplete dose delivery</MenuItem>
                        <MenuItem value="Protocol hold / medical decision">Protocol hold / medical decision</MenuItem>
                        <MenuItem value="Other">Other</MenuItem>
                      </Select>
                    )}
                  </Box>
                </FieldRow>
                <FieldRow label="Doctor Notes">
                  <TextField fullWidth multiline rows={3} sx={inputStyle} placeholder="Open text box and link to EMR" value={formData.partC.doctorNotes} onChange={e => handleUpdate("partC", "doctorNotes", e.target.value)} />
                </FieldRow>

                <ApprovalsSection
                  cards={[
                    {
                      title: "Prepared by Nurse",
                      name: formData.partC.approvalPreparedNurseName || "",
                      onNameChange: (v) => handleUpdate("partC", "approvalPreparedNurseName", v),
                      signed: !!formData.partC.approvalPreparedNurseSigned,
                      onToggleSign: () => handleUpdate("partC", "approvalPreparedNurseSigned", !formData.partC.approvalPreparedNurseSigned),
                      namePlaceholder: "Nurse name",
                      options: MOCK_NURSES,
                    },
                    {
                      title: "Verified & Administered by Nurse",
                      name: formData.partC.approvalVerifiedNurseName || "",
                      onNameChange: (v) => handleUpdate("partC", "approvalVerifiedNurseName", v),
                      signed: !!formData.partC.approvalVerifiedNurseSigned,
                      onToggleSign: () => handleUpdate("partC", "approvalVerifiedNurseSigned", !formData.partC.approvalVerifiedNurseSigned),
                      namePlaceholder: "Nurse name",
                      options: MOCK_NURSES,
                    },
                  ]}
                />

                <Box sx={{ mt: 4, mb: 2, mx: "20px", p: 2.5, backgroundColor: "rgba(0,0,0,0.02)", border: `1px solid ${C.border}`, borderRadius: "6px", textAlign: "center" }}>
                  <Typography sx={{ fontSize: 13.5, color: C.textPrimary, fontWeight: FW_MEDIUM }}>
                    Please proceed to the <strong>Cycle Admin</strong> module under the Chemotherapy Procedural tab to complete the administration checklist and finalize this cycle.
                  </Typography>
                </Box>

              </Box>
            )}

            {/* TAB: CT PART D (Toxicity Monitoring) */}
            {activeTab === "partD" && (
              <Box>
                <VoiceDictationPanel
                  title="Toxicity Assessment / Voice Dictation"
                  placeholder="Type or dictate toxicity and adverse events here (e.g. 'Grade 2 Nausea started yesterday, managed at home'). Use AI auto-fill to populate the table."
                  transcript={toxicityTranscript}
                  setTranscript={setToxicityTranscript}
                  onAutofill={processToxicityDictation}
                  isAutofilling={isPrefillingToxicity}
                  autofillSuccess={toxicityFillSuccess}
                />
                <SectionHeader
                  title="Toxicity Assessment"
                  action={
                    <Button variant="outlined" size="small" sx={{ borderColor: C.white, color: C.white, "&:hover": { borderColor: C.white, background: "rgba(255,255,255,0.1)" } }} startIcon={<Add />} onClick={() => handleArrayAction("partD", "toxicities", "add", { id: Date.now(), cycleDay: "", gradingSystem: "", system: "", event: "", description: "", onset: "", grade: "", managementPlace: "", attribution: "", postponeTreatment: "", postponeReason: "", postponeDays: "" })}>
                      Add Toxicity Row
                    </Button>
                  }
                />
                {pastAdverseEventsForCurrentDrugs.length > 0 && (
                  <Box sx={{ px: 3, pt: 2 }}>
                    <Box sx={{ border: `1px solid ${C.black}`, background: C.bgSecondary, p: 2 }}>
                      <Box sx={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 2, flexWrap: "wrap" }}>
                        <Box sx={{ display: "flex", gap: 1.25, alignItems: "flex-start", minWidth: 0, flex: 1 }}>
                          <WarningAmberRounded sx={{ color: C.black, mt: 0.2 }} />
                          <Box>
                            <Typography sx={{ fontSize: 13.5, fontWeight: FW_MEDIUM, fontFamily: FONT, color: C.black }}>
                              Prior adverse events with current drug(s)
                            </Typography>
                            <Typography sx={{ fontSize: 12, fontFamily: FONT, color: C.textSecond, mt: 0.4 }}>
                              {pastAdverseEventsForCurrentDrugs.length} event{pastAdverseEventsForCurrentDrugs.length > 1 ? "s" : ""} across{" "}
                              {groupAlertsByCycle(pastAdverseEventsForCurrentDrugs).length} prior cycle
                              {groupAlertsByCycle(pastAdverseEventsForCurrentDrugs).length > 1 ? "s" : ""}. Review before documenting toxicity for cycle {currentCycleForAlerts}.
                            </Typography>
                            <Box sx={{ display: "flex", gap: 1, flexWrap: "wrap", mt: 1 }}>
                              {[...new Set(pastAdverseEventsForCurrentDrugs.map(a => a.drug).filter(Boolean))].slice(0, 4).map(drug => (
                                <Box key={drug} sx={{ px: 1, py: 0.3, border: `1px solid ${C.black}`, background: C.white, fontSize: 11, fontFamily: FONT }}>
                                  {drug}
                                </Box>
                              ))}
                            </Box>
                          </Box>
                        </Box>
                        <Button
                          size="small"
                          sx={{ ...btnStyle, color: C.white, background: C.black, border: `1px solid ${C.black}`, whiteSpace: "nowrap", px: 1.5, "&:hover": { background: "#222" } }}
                          onClick={() => setPastAdverseAlertOpen(true)}
                        >
                          Review details
                        </Button>
                      </Box>
                    </Box>
                  </Box>
                )}
                <Box sx={{ px: 3, pt: 3 }}>
                  <ToxicityHistoryTable dbCycles={dbCycles} completedCycles={treatment?.completedCycles || 0} />
                </Box>
                <Box sx={{ p: 3, overflowX: "auto" }}>
                  <Box sx={{ minWidth: 1000, display: "flex", flexDirection: "column", gap: 1 }}>
                    {/* Table Header */}
                    <Box sx={{ display: "flex", gap: 1, p: 1, background: C.bgSecondary, border: `1px solid ${C.border}`, fontWeight: FW_MEDIUM, fontSize: 12.5 }}>
                      <Box sx={{ flex: 1.2 }}>Grading Sys</Box>
                      <Box sx={{ flex: 1.2 }}>System</Box>
                      <Box sx={{ flex: 1.5 }}>Adverse Event</Box>
                      <Box sx={{ flex: 1.2 }}>Onset Date</Box>
                      <Box sx={{ flex: 1.2 }}>Resolution Date</Box>
                      <Box sx={{ flex: 1 }}>Severity/Grade</Box>
                      <Box sx={{ flex: 1.2 }}>Management</Box>
                      <Box sx={{ flex: 1.2 }}>Attribution</Box>
                      <Box sx={{ width: 40 }}></Box>
                    </Box>
                    {/* Rows */}
                    {formData.partD.toxicities.map((tox, index) => (
                      <Box key={tox.id} sx={{ display: "flex", gap: 1, alignItems: "flex-start" }}>
                        <Box sx={{ flex: 1.2 }}>
                          <Select fullWidth size="small" sx={{ ...inputStyle, m: 0 }} displayEmpty value={tox.gradingSystem} onChange={e => handleArrayUpdate("partD", "toxicities", index, "gradingSystem", e.target.value)}>
                            <MenuItem value=""><em>-</em></MenuItem>
                            <MenuItem value="who">WHO</MenuItem><MenuItem value="ctcae5">CTCAE 5.0</MenuItem>
                          </Select>
                        </Box>
                        <Box sx={{ flex: 1.2 }}><TextField fullWidth size="small" sx={{ ...inputStyle, m: 0 }} placeholder="System" value={tox.system} onChange={e => handleArrayUpdate("partD", "toxicities", index, "system", e.target.value)} /></Box>
                        <Box sx={{ flex: 1.5 }}>
                          <Autocomplete
                            freeSolo
                            options={COMMON_ADVERSE_EVENTS}
                            size="small"
                            inputValue={tox.event || ""}
                            onInputChange={(e, newInputValue) => handleArrayUpdate("partD", "toxicities", index, "event", newInputValue)}
                            renderInput={(params) => <TextField {...params} sx={{ ...inputStyle, m: 0 }} placeholder="Event" />}
                          />
                        </Box>
                        <Box sx={{ flex: 1.2 }}><TextField type="date" fullWidth size="small" sx={{ ...inputStyle, m: 0 }} value={tox.onset} onChange={e => handleArrayUpdate("partD", "toxicities", index, "onset", e.target.value)} /></Box>
                        <Box sx={{ flex: 1.2 }}><TextField type="date" fullWidth size="small" sx={{ ...inputStyle, m: 0 }} value={tox.resolutionDate || ""} onChange={e => handleArrayUpdate("partD", "toxicities", index, "resolutionDate", e.target.value)} /></Box>
                        <Box sx={{ flex: 1 }}>
                          <Select fullWidth size="small" sx={{ ...inputStyle, m: 0 }} displayEmpty value={tox.grade} onChange={e => handleArrayUpdate("partD", "toxicities", index, "grade", e.target.value)}>
                            <MenuItem value=""><em>-</em></MenuItem>
                            <MenuItem value="0">0</MenuItem><MenuItem value="1">1</MenuItem><MenuItem value="2">2</MenuItem><MenuItem value="3">3</MenuItem><MenuItem value="4">4</MenuItem><MenuItem value="5">5</MenuItem>
                          </Select>
                        </Box>
                        <Box sx={{ flex: 1.2 }}>
                          <Select fullWidth size="small" sx={{ ...inputStyle, m: 0 }} displayEmpty value={tox.managementPlace} onChange={e => handleArrayUpdate("partD", "toxicities", index, "managementPlace", e.target.value)}>
                            <MenuItem value=""><em>-</em></MenuItem>
                            <MenuItem value="home">Home</MenuItem><MenuItem value="local-opd">Local Hospital OPD</MenuItem><MenuItem value="primary-opd">Primary Center OPD</MenuItem><MenuItem value="local-hosp">Local Hosp - Inpatient</MenuItem><MenuItem value="primary-hosp">Primary - Inpatient</MenuItem>
                          </Select>
                        </Box>
                        <Box sx={{ flex: 1.2 }}>
                          <Select fullWidth size="small" sx={{ ...inputStyle, m: 0 }} displayEmpty value={tox.attribution || ""} onChange={e => handleArrayUpdate("partD", "toxicities", index, "attribution", e.target.value)}>
                            <MenuItem value=""><em>-</em></MenuItem>
                            <MenuItem value="unrelated">Unrelated</MenuItem><MenuItem value="possible">Possible</MenuItem><MenuItem value="probable">Probable</MenuItem><MenuItem value="definite">Definite</MenuItem>
                          </Select>
                        </Box>
                        <Box sx={{ width: 40, display: "flex", justifyContent: "center", pt: 1 }}>
                          <IconButton size="small" sx={{ color: C.black }} onClick={() => handleArrayAction("partD", "toxicities", "remove", index)}><Delete fontSize="small" /></IconButton>
                        </Box>
                      </Box>
                    ))}
                  </Box>
                </Box>
                <Box sx={{ px: 3, pt: 2 }}>
                  <PostponeHistoryTable dbCycles={dbCycles} completedCycles={treatment?.completedCycles || 0} />
                </Box>
                <FieldRow label="Postpone Treatment" tag="Block time between cycle & postpone dates">
                  <Box sx={{ display: "flex", flexDirection: "column", gap: 1.5 }}>
                    <Box sx={{ display: "flex", gap: 1 }}>
                      <CustomRadio
                        label="Yes"
                        value="yes"
                        checked={formData.partD.postponeTreatment === "yes"}
                        onChange={() => {
                          handleUpdate("partD", "postponeTreatment", "yes");
                          const cycleDate =
                            formData.partC?.planDate ||
                            dbCycles?.[String(activeEditCycle || treatment?.currentCycle || 1)]?.cycle_admin?.cycleDate1 ||
                            "";
                          if (cycleDate && !formData.partD.postponeFromDate) {
                            handleUpdate("partD", "postponeFromDate", cycleDate);
                          }
                        }}
                      />
                      <CustomRadio
                        label="No"
                        value="no"
                        checked={formData.partD.postponeTreatment === "no"}
                        onChange={() => {
                          handleUpdate("partD", "postponeTreatment", "no");
                          handleUpdate("partD", "postponeReason", "");
                          handleUpdate("partD", "postponeDays", "");
                          handleUpdate("partD", "postponeFromDate", "");
                          handleUpdate("partD", "postponeUntilDate", "");
                        }}
                      />
                    </Box>
                    {formData.partD.postponeTreatment === "yes" && (() => {
                      const cycleRefDate =
                        formData.partC?.planDate ||
                        dbCycles?.[String(activeEditCycle || treatment?.currentCycle || 1)]?.cycle_admin?.cycleDate1 ||
                        "";
                      const fromDate = formData.partD.postponeFromDate || cycleRefDate || "";
                      const untilDate = formData.partD.postponeUntilDate || "";
                      let calculatedDays = "";
                      if (fromDate && untilDate) {
                        const start = new Date(fromDate);
                        const end = new Date(untilDate);
                        if (!isNaN(start) && !isNaN(end) && end >= start) {
                          calculatedDays = String(Math.round((end - start) / (1000 * 60 * 60 * 24)));
                        }
                      }
                      const displayDays = formData.partD.postponeDays || calculatedDays;
                      return (
                        <Box sx={{ p: 1.5, background: C.bgSecondary, border: `1px solid ${C.border}`, display: "flex", flexDirection: "column", gap: 1.5 }}>
                          <Box sx={{ display: "grid", gridTemplateColumns: { xs: "1fr", md: "1fr 1fr 1fr" }, gap: 1.5 }}>
                            <Box>
                              <Typography sx={{ fontSize: 11, color: C.textMuted, fontFamily: FONT, mb: 0.75, textTransform: "uppercase", letterSpacing: "0.06em" }}>
                                Cycle / Reference Date
                              </Typography>
                              <TextField
                                type="date"
                                fullWidth
                                size="small"
                                sx={{ ...inputStyle, m: 0, background: C.white }}
                                value={fromDate}
                                onChange={e => {
                                  handleUpdate("partD", "postponeFromDate", e.target.value);
                                  if (e.target.value && untilDate) {
                                    const s = new Date(e.target.value);
                                    const en = new Date(untilDate);
                                    if (!isNaN(s) && !isNaN(en) && en >= s) {
                                      handleUpdate("partD", "postponeDays", String(Math.round((en - s) / (1000 * 60 * 60 * 24))));
                                    }
                                  }
                                }}
                              />
                            </Box>
                            <Box>
                              <Typography sx={{ fontSize: 11, color: C.textMuted, fontFamily: FONT, mb: 0.75, textTransform: "uppercase", letterSpacing: "0.06em" }}>
                                Postpone Until / Resume Date
                              </Typography>
                              <TextField
                                type="date"
                                fullWidth
                                size="small"
                                sx={{ ...inputStyle, m: 0, background: C.white }}
                                value={untilDate}
                                onChange={e => {
                                  handleUpdate("partD", "postponeUntilDate", e.target.value);
                                  if (fromDate && e.target.value) {
                                    const s = new Date(fromDate);
                                    const en = new Date(e.target.value);
                                    if (!isNaN(s) && !isNaN(en) && en >= s) {
                                      handleUpdate("partD", "postponeDays", String(Math.round((en - s) / (1000 * 60 * 60 * 24))));
                                    }
                                  }
                                }}
                              />
                            </Box>
                            <Box>
                              <Typography sx={{ fontSize: 11, color: C.textMuted, fontFamily: FONT, mb: 0.75, textTransform: "uppercase", letterSpacing: "0.06em" }}>
                                Blocked Duration (Days)
                              </Typography>
                              <TextField
                                type="number"
                                fullWidth
                                size="small"
                                sx={{ ...inputStyle, m: 0, background: C.white }}
                                placeholder="Auto from dates"
                                value={displayDays}
                                onChange={e => handleUpdate("partD", "postponeDays", e.target.value)}
                              />
                            </Box>
                          </Box>
                          {(fromDate && untilDate && displayDays !== "") && (
                            <Typography sx={{ fontSize: 12, fontFamily: FONT, color: C.textPrimary, fontWeight: FW_MEDIUM }}>
                              Treatment blocked for {displayDays} day{displayDays === "1" ? "" : "s"}
                              {fromDate && untilDate ? ` (${fromDate} → ${untilDate})` : ""}.
                            </Typography>
                          )}
                          <Box>
                            <Typography sx={{ fontSize: 11, color: C.textMuted, fontFamily: FONT, mb: 0.75, textTransform: "uppercase", letterSpacing: "0.06em" }}>
                              Reason to Postpone
                            </Typography>
                            <TextField
                              fullWidth
                              multiline
                              rows={2}
                              size="small"
                              sx={{ ...inputStyle, m: 0, background: C.white }}
                              placeholder="Enter reason for postponement"
                              value={formData.partD.postponeReason || ""}
                              onChange={e => handleUpdate("partD", "postponeReason", e.target.value)}
                            />
                          </Box>
                        </Box>
                      );
                    })()}
                  </Box>
                </FieldRow>

                <SectionHeader title="Post-Chemo Management" />

                <PostChemoHistoryTable completedCycles={treatment?.completedCycles || 0} dbCycles={dbCycles} />
                <FieldRow label="Monitoring Period">
                  <TextField fullWidth size="small" sx={inputStyle} placeholder="e.g. 24h, 48h, 7 days" value={formData.partD.monitoringPeriod} onChange={e => handleUpdate("partD", "monitoringPeriod", e.target.value)} />
                </FieldRow>
                <FieldRow label="Nadir Labs">
                  <TextField fullWidth multiline rows={2} sx={inputStyle} placeholder="Enter nadir lab values" value={formData.partD.nadirLabs} onChange={e => handleUpdate("partD", "nadirLabs", e.target.value)} />
                </FieldRow>
                <FieldRow label="Side Effect Management Plan">
                  <TextField fullWidth multiline rows={2} sx={inputStyle} placeholder="Management steps for side effects" value={formData.partD.sideEffectMgt} onChange={e => handleUpdate("partD", "sideEffectMgt", e.target.value)} />
                </FieldRow>

                <SectionHeader title="Response Assessment" />
                <FieldRow label="Interim Imaging Details">
                  <Box sx={{ display: "flex", flexDirection: "column", gap: 2, width: "100%" }}>
                    <TextField fullWidth multiline rows={2} sx={inputStyle} placeholder="Details of imaging" value={formData.partD.interimImaging} onChange={e => handleUpdate("partD", "interimImaging", e.target.value)} />
                  </Box>
                </FieldRow>
                <FieldRow label="Response Criteria">
                  <Select fullWidth size="small" sx={inputStyle} displayEmpty value={formData.partD.responseCriteria} onChange={e => handleUpdate("partD", "responseCriteria", e.target.value)}>
                    <MenuItem value=""><em>Select criteria</em></MenuItem>
                    <MenuItem value="recist">RECIST</MenuItem>
                    <MenuItem value="imrecist">imRECIST</MenuItem>
                    <MenuItem value="who">WHO</MenuItem>
                    <MenuItem value="other">Other</MenuItem>
                  </Select>
                </FieldRow>
                <FieldRow label="Tumor Board Review Required">
                  <Box sx={{ display: "flex", flexDirection: "column", gap: 2, width: "100%" }}>
                    <Box sx={{ display: "flex", gap: 1 }}>
                      <CustomRadio label="Yes" value="yes" checked={formData.partD.tumorBoardReview === "yes"} onChange={() => handleUpdate("partD", "tumorBoardReview", "yes")} />
                      <CustomRadio label="No" value="no" checked={formData.partD.tumorBoardReview === "no"} onChange={() => handleUpdate("partD", "tumorBoardReview", "no")} />
                    </Box>
                    {formData.partD.tumorBoardReview === "yes" && (
                      <Box sx={{ width: "100%" }}>
                        <TextField fullWidth multiline rows={3} size="small" sx={inputStyle} placeholder="Enter details of tumor board review" value={formData.partD.tumorBoardReviewDetails || ""} onChange={e => handleUpdate("partD", "tumorBoardReviewDetails", e.target.value)} />
                      </Box>
                    )}
                  </Box>
                </FieldRow>

                <SectionHeader title="Organ-Specific Monitoring" />
                <Box sx={{ px: 3, pt: 3, mb: 0 }}>
                  <OrganSpecificMonitoringHistoryTable
                    dbCycles={dbCycles}
                    completedCycles={treatment?.completedCycles || 0}
                    currentPartD={formData.partD}
                    currentCycle={activeEditCycle || treatment?.currentCycle || 1}
                  />
                </Box>
                <Box sx={{ p: 3, pt: 2, display: "grid", gridTemplateColumns: "1fr 1fr", gap: 3 }}>
                  {[
                    {
                      id: "organCardiac", label: "Cardiac Monitoring", details: [
                        { id: "echoDetails", placeholder: "Echocardiogram details" },
                        { id: "lvef", placeholder: "LVEF (%)" }
                      ]
                    },
                    {
                      id: "organPulmonary", label: "Pulmonary Monitoring", details: [
                        { id: "pulmonaryTests", placeholder: "Pulmonary Function Tests (e.g., bleomycin)" }
                      ]
                    },
                    {
                      id: "organNeuro", label: "Neurological Monitoring", details: [
                        { id: "neuroAssessment", placeholder: "Neuropathy assessment" }
                      ]
                    },
                    {
                      id: "organAudio", label: "Audiology Monitoring", details: [
                        { id: "audioTests", placeholder: "Hearing tests" }
                      ]
                    }
                  ].map((item, idx) => (
                    <Box key={idx} sx={{
                      border: `1px solid ${formData.partD[item.id] ? C.black : C.border}`,
                      p: 2.5,
                      borderRadius: 1.5,
                      background: formData.partD[item.id] ? C.bgSecondary : C.white,
                      display: "flex",
                      flexDirection: "column",
                      transition: "all 0.2s ease",
                      "&:hover": { borderColor: C.black, boxShadow: "0 2px 12px rgba(0,0,0,0.05)" }
                    }}>
                      <CustomCheckbox label={item.label} checked={formData.partD[item.id]} onChange={e => handleUpdate("partD", item.id, e.target.checked)} />
                      {formData.partD[item.id] && (
                        <Box sx={{ mt: 2.5, display: "flex", gap: 2, flexDirection: item.details.length > 1 ? "row" : "column" }}>
                          {item.details.map((detail, dIdx) => (
                            <TextField
                              key={dIdx}
                              fullWidth size="small"
                              sx={{ ...inputStyle, m: 0, background: C.white, "& .MuiOutlinedInput-root": { borderRadius: 1 } }}
                              placeholder={detail.placeholder}
                              value={formData.partD[detail.id] || ""}
                              onChange={e => handleUpdate("partD", detail.id, e.target.value)}
                            />
                          ))}
                        </Box>
                      )}
                    </Box>
                  ))}
                </Box>

                <SectionHeader title="Treatment-Specific Parameters" />
                <Box sx={{ px: 3, pt: 3, mb: 0 }}>
                  <TreatmentSpecificParametersHistoryTable
                    dbCycles={dbCycles}
                    completedCycles={treatment?.completedCycles || 0}
                    currentPartD={formData.partD}
                    currentCycle={activeEditCycle || treatment?.currentCycle || 1}
                  />
                </Box>
                <Box sx={{ p: 3, pt: 2, display: "grid", gridTemplateColumns: "1fr 1fr", gap: 3 }}>
                  {[
                    { id: "trtUrineProtein", label: "Urine protein (e.g. bevacizumab)", detailId: "urineProteinDetails", placeholder: "Urine protein details" },
                    { id: "trtThyroid", label: "Thyroid function (immune checkpoint inhibitors)", detailId: "thyroidDetails", placeholder: "Thyroid function details" },
                    { id: "trtGlucose", label: "Blood glucose (high-dose steroids)", detailId: "glucoseDetails", placeholder: "Blood glucose details" },
                    { id: "trtEcg", label: "ECG/QTc interval (certain targeted therapies)", detailId: "ecgDetails", placeholder: "ECG/QTc interval details" }
                  ].map((item, idx) => (
                    <Box key={idx} sx={{
                      border: `1px solid ${formData.partD[item.id] ? C.black : C.border}`,
                      p: 2.5,
                      borderRadius: 1.5,
                      background: formData.partD[item.id] ? C.bgSecondary : C.white,
                      display: "flex",
                      flexDirection: "column",
                      transition: "all 0.2s ease",
                      "&:hover": { borderColor: C.black, boxShadow: "0 2px 12px rgba(0,0,0,0.05)" }
                    }}>
                      <CustomCheckbox label={item.label} checked={formData.partD[item.id]} onChange={e => handleUpdate("partD", item.id, e.target.checked)} />
                      {formData.partD[item.id] && (
                        <Box sx={{ mt: 2.5 }}>
                          <TextField
                            fullWidth size="small"
                            sx={{ ...inputStyle, m: 0, background: C.white, "& .MuiOutlinedInput-root": { borderRadius: 1 } }}
                            placeholder={item.placeholder}
                            value={formData.partD[item.detailId] || ""}
                            onChange={e => handleUpdate("partD", item.detailId, e.target.value)}
                          />
                        </Box>
                      )}
                    </Box>
                  ))}
                </Box>

              </Box>
            )}

            {/* TAB: IMAGING STUDIES */}
            {activeTab === "imaging" && (
              <Box>
                <SectionHeader title="DICOM IMAGING STUDIES" />
                <Box sx={{ background: C.white, border: `1px solid ${C.border}`, p: 0, mb: 4, minHeight: 400 }}>
                  <DICOMViewer patientId={patientId} />
                </Box>
              </Box>
            )}

            {/* TAB: CT PART E (Discharge On Treatment) */}
            {activeTab === "partE" && (
              <Box>
                <VoiceDictationPanel 
                  transcript={partETranscript}
                  setTranscript={setPartETranscript}
                  isAutofilling={isPrefillingPartE}
                  onAutofill={processPartEDictation}
                  success={partEFillSuccess}
                  placeholder="Dictate discharge instructions, medications, follow-up advice, and completion status..."
                  tooltip="e.g., 'Patient tolerated well. Watch for pain. Discharge meds: Paracetamol 500mg PO TDS for 3 days. Follow up with Dr. Smith in daycare next week. Cycle is completed.'"
                />

                <SectionHeader title="Primary Details (Summary)" />
                <Box sx={{ mt: 2, mb: 3 }}>
                  <ClinicalSummaryTab patientId={patientId} doctorId={doctorId} />
                </Box>

                {/* ── Section 1: Treatment Sessions — All Cycles (Requirement A & 8.1) ── */}
                <SectionHeader title="Treatment Sessions — All Cycles" />
                <Box sx={{ p: 3, overflowX: "auto" }}>
                  <Box sx={{ minWidth: 700, display: "flex", flexDirection: "column", gap: 1 }}>
                    {/* Table Header */}
                    <Box sx={{ display: "flex", gap: 1, p: 1, background: C.bgSecondary, border: `1px solid ${C.border}`, fontWeight: FW_MEDIUM, fontSize: 12.5 }}>
                      <Box sx={{ flex: 1 }}>Cycle No</Box>
                      <Box sx={{ flex: 1.5 }}>Completion Date</Box>
                      <Box sx={{ flex: 3 }}>Drugs Administered</Box>
                      <Box sx={{ flex: 1 }}>Status</Box>
                    </Box>
                    {/* Rows */}
                    {Array.from({ length: parseInt(formData.partA.cycles) || treatment?.plannedCycles || 1 }).map((_, i) => {
                      const cycleNum = i + 1;
                      const cData = dbCycles[String(cycleNum)] || {};
                      let cDate = cData.cycle_admin?.cycleDate1 || cData.regimen?.startDate || "";
                      let cStatus = cData.cycle_admin?.cycleCompleted || "";
                      if (cStatus === "not-completed") cStatus = "cancelled";

                      const adminDrugs = cData.admin?.adminDrugs || [];
                      const givenDrugsStr = adminDrugs.filter(d => d.given === "yes" && d.name).map(d => `${d.name} (${d.dose})`).join(", ");

                      return (
                        <Box key={cycleNum} sx={{ display: "flex", gap: 1, alignItems: "center", p: 1, borderBottom: `1px solid ${C.ghost}` }}>
                          <Box sx={{ flex: 1, fontSize: 13, fontWeight: FW_MEDIUM }}>Cycle {cycleNum}</Box>
                          <Box sx={{ flex: 1.5, fontSize: 13, color: C.smoke }}>{cDate || "— (Not started)"}</Box>
                          <Box sx={{ flex: 3, fontSize: 13, color: C.smoke }}>{givenDrugsStr || "—"}</Box>
                          <Box sx={{ flex: 1, fontSize: 13, color: cStatus === "completed" ? "green" : cStatus === "cancelled" ? "red" : C.smoke }}>
                            {cStatus === "completed" ? "Completed" : cStatus === "cancelled" ? "Not Completed / Cancelled" : "—"}
                          </Box>
                        </Box>
                      );
                    })}
                  </Box>
                </Box>



                {/* ── Section 2: Toxicity Summary — All Cycles (Requirement 8.2) ── */}
                <SectionHeader title="Toxicity Summary — All Cycles" />
                <Box sx={{ px: 3, pt: 3, mb: 2 }}>
                  <ToxicityHistoryTable
                    dbCycles={dbCycles}
                    completedCycles={treatment?.completedCycles || (parseInt(formData.partA.cycles) > 1 ? parseInt(formData.partA.cycles) - 1 : 0)}
                    currentPartD={formData.partD}
                    currentCycle={parseInt(formData.partA.cycles) || 1}
                  />
                </Box>
                <Box sx={{ px: 3, pb: 3 }}>
                  <Box sx={{ display: "flex", alignItems: "center", gap: 2, mb: 2 }}>
                    <Button
                      variant="outlined"
                      size="small"
                      disabled={toxicitySummaryLoading || !patientId}
                      onClick={fetchToxicitySummary}
                      sx={{
                        ...btnStyle,
                        border: `1px solid ${C.black}`,
                        color: C.black,
                        px: 2.5,
                        "&:hover": { background: C.bgSecondary, borderColor: C.black },
                        "&.Mui-disabled": { borderColor: C.border, color: C.textMuted }
                      }}
                    >
                      {toxicitySummaryLoading ? "Generating…" : "✦ Generate AI Toxicity Summary"}
                    </Button>
                    {toxicitySummaryError && (
                      <Typography sx={{ fontSize: 12, color: "#c62828", fontFamily: FONT }}>
                        {toxicitySummaryError}
                      </Typography>
                    )}
                  </Box>
                  <TextField
                    fullWidth
                    multiline
                    rows={4}
                    size="small"
                    sx={{ ...inputStyle, m: 0 }}
                    placeholder="AI-generated toxicity narrative will appear here. You can also type or edit manually."
                    value={formData.partE.toxicitySummaryText || ""}
                    onChange={e => handleUpdate("partE", "toxicitySummaryText", e.target.value)}
                  />
                </Box>

                <SectionHeader title="Last Cycle's Discharge Details" />
                <Box sx={{ px: 3, pt: 3, mb: 2 }}>
                  <DischargeHistoryTable dbCycles={dbCycles} completedCycles={treatment?.completedCycles || 0} />
                </Box>
                <FieldRow label="Tolerated Systemic Therapy Well">
                  <Box sx={{ display: "flex", gap: 1 }}>
                    <CustomRadio label="Yes" value="yes" checked={formData.partE.tolerated === "yes"} onChange={() => handleUpdate("partE", "tolerated", "yes")} />
                    <CustomRadio label="No" value="no" checked={formData.partE.tolerated === "no"} onChange={() => handleUpdate("partE", "tolerated", "no")} />
                  </Box>
                </FieldRow>

                <SectionHeader title="Advice on Discharge" />

                <Box sx={{ p: 3, display: "flex", flexDirection: "column", gap: 3 }}>

                  {/* A. Symptoms Section */}
                  <Box sx={{ border: `1px solid ${C.border}`, borderRadius: 2, overflow: 'hidden' }}>
                    <Box sx={{ background: C.bgSecondary, p: 2, borderBottom: `1px solid ${C.border}`, display: "flex", alignItems: "center", gap: 1 }}>
                      <WarningAmberRounded sx={{ fontSize: 20, color: C.primary }} />
                      <Typography sx={{ fontWeight: FW_MEDIUM, fontSize: 14, color: C.black }}>Symptoms & Conditions to Watch</Typography>
                    </Box>
                    <Box sx={{ p: 2.5, display: "flex", gap: 3, flexWrap: "wrap", alignItems: "center", background: C.white }}>
                      <CustomCheckbox label="Pain" checked={formData.partE.watchPain} onChange={e => handleUpdate("partE", "watchPain", e.target.checked)} />
                      <CustomCheckbox label="Loose Motions" checked={formData.partE.watchMotions} onChange={e => handleUpdate("partE", "watchMotions", e.target.checked)} />
                      <CustomCheckbox label="Fever" checked={formData.partE.watchFever} onChange={e => handleUpdate("partE", "watchFever", e.target.checked)} />
                      <CustomCheckbox label="Vomiting" checked={formData.partE.watchVomiting} onChange={e => handleUpdate("partE", "watchVomiting", e.target.checked)} />
                      <CustomCheckbox label="Mouth Ulcer" checked={formData.partE.watchMouth} onChange={e => handleUpdate("partE", "watchMouth", e.target.checked)} />
                    </Box>
                  </Box>

                  {/* B. Discharge Medications Section */}
                  <Box sx={{ border: `1px solid ${C.border}`, borderRadius: 2, overflow: 'hidden' }}>
                    <Box sx={{ background: C.black, p: 2, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                      <Typography sx={{ fontWeight: FW_MEDIUM, fontSize: 14, color: C.white }}>Discharge Medications</Typography>
                      <Box sx={{ display: "flex", gap: 1.5 }}>
                        <Button
                          variant="outlined"
                          size="small"
                          sx={{ borderColor: "rgba(255,255,255,0.3)", color: C.white, fontSize: 12, py: 0.5, "&:hover": { borderColor: C.white, background: "rgba(255,255,255,0.1)" } }}
                          onClick={() => {
                            const currentNames = formData.partE.dischargeDrugs.map(d => d.name?.toLowerCase());
                            const protocolDrugs = formData.partA.drugs || [];
                            const newDrugs = [];
                            protocolDrugs.forEach(pd => {
                              if (pd.name && !currentNames.includes(pd.name.toLowerCase())) {
                                newDrugs.push({
                                  id: Date.now() + Math.random(),
                                  name: pd.name,
                                  route: pd.route || "",
                                  dosage: pd.dose && pd.unit ? `${pd.dose} ${pd.unit}`.trim() : "",
                                  days: "",
                                  remarks: "",
                                  source: "protocol"
                                });
                              }
                            });
                            if (newDrugs.length > 0) {
                              handleUpdate("partE", "dischargeDrugs", [...formData.partE.dischargeDrugs, ...newDrugs]);
                            }
                          }}
                        >
                          Re-fill from Protocol
                        </Button>
                        <Button variant="outlined" size="small" sx={{ borderColor: "rgba(255,255,255,0.3)", color: C.white, fontSize: 12, py: 0.5, "&:hover": { borderColor: C.white, background: "rgba(255,255,255,0.1)" } }} startIcon={<Add sx={{ fontSize: 16 }} />} onClick={() => handleArrayAction("partE", "dischargeDrugs", "add", { id: Date.now(), remarks: "", name: "", route: "", dosage: "", days: "", source: "manual" })}>
                          Add Med
                        </Button>
                      </Box>
                    </Box>
                    <Box sx={{ overflowX: "auto", background: C.white }}>
                      <Box sx={{ minWidth: 800, display: "flex", flexDirection: "column" }}>
                        {/* Table Header */}
                        <Box sx={{ display: "flex", gap: 1, p: 2, background: C.bgSecondary, borderBottom: `1px solid ${C.border}`, fontWeight: FW_MEDIUM, fontSize: 12.5, color: C.smoke }}>
                          <Box sx={{ flex: 1.5 }}>Drug Name</Box>
                          <Box sx={{ flex: 1 }}>Route</Box>
                          <Box sx={{ flex: 1 }}>Dosage</Box>
                          <Box sx={{ flex: 1 }}>No of Days</Box>
                          <Box sx={{ flex: 1.5 }}>Remarks / Source</Box>
                          <Box sx={{ width: 40 }}></Box>
                        </Box>
                        {/* Rows */}
                        {formData.partE.dischargeDrugs.map((drug, index) => (
                          <Box key={drug.id} sx={{ display: "flex", gap: 1, alignItems: "center", p: 1.5, borderBottom: index < formData.partE.dischargeDrugs.length - 1 ? `1px dashed ${C.ghost}` : 'none' }}>
                            <Box sx={{ flex: 1.5 }}><TextField fullWidth size="small" sx={{ ...inputStyle, m: 0, '& .MuiOutlinedInput-root': { borderRadius: 1 } }} placeholder="Drug Name" value={drug.name} onChange={e => handleArrayUpdate("partE", "dischargeDrugs", index, "name", e.target.value)} /></Box>
                            <Box sx={{ flex: 1 }}>
                              <Select fullWidth size="small" sx={{ ...inputStyle, m: 0, '& .MuiOutlinedInput-root': { borderRadius: 1 } }} value={drug.route || ""} displayEmpty onChange={e => handleArrayUpdate("partE", "dischargeDrugs", index, "route", e.target.value)}>
                                <MenuItem value=""><em>Select...</em></MenuItem>
                                <MenuItem value="oral">Oral</MenuItem>
                                <MenuItem value="iv">IV</MenuItem>
                                <MenuItem value="im">IM</MenuItem>
                                <MenuItem value="sc">SC</MenuItem>
                                <MenuItem value="topical">Topical</MenuItem>
                              </Select>
                            </Box>
                            <Box sx={{ flex: 1 }}><TextField fullWidth size="small" sx={{ ...inputStyle, m: 0, '& .MuiOutlinedInput-root': { borderRadius: 1 } }} placeholder="Dosage" value={drug.dosage} onChange={e => handleArrayUpdate("partE", "dischargeDrugs", index, "dosage", e.target.value)} /></Box>
                            <Box sx={{ flex: 1 }}>
                              <Select fullWidth size="small" sx={{ ...inputStyle, m: 0, '& .MuiOutlinedInput-root': { borderRadius: 1 } }} value={drug.days || ""} displayEmpty onChange={e => handleArrayUpdate("partE", "dischargeDrugs", index, "days", e.target.value)}>
                                <MenuItem value=""><em>Select...</em></MenuItem>
                                {[...Array(30)].map((_, i) => <MenuItem key={i + 1} value={String(i + 1)}>{i + 1} days</MenuItem>)}
                                <MenuItem value="ongoing">Ongoing</MenuItem>
                              </Select>
                            </Box>
                            <Box sx={{ flex: 1.5, display: "flex", flexDirection: "column", gap: 0.5, position: 'relative' }}>
                              <TextField fullWidth size="small" sx={{ ...inputStyle, m: 0, '& .MuiOutlinedInput-root': { borderRadius: 1 } }} placeholder="Remarks (Optional)" value={drug.remarks || ""} onChange={e => handleArrayUpdate("partE", "dischargeDrugs", index, "remarks", e.target.value)} />
                              {drug.source === "protocol" && <Typography sx={{ position: 'absolute', top: -8, right: 4, fontSize: 9, background: C.primary, color: C.white, px: 0.5, borderRadius: 0.5, fontWeight: FW_MEDIUM, zIndex: 10 }}>PROTOCOL</Typography>}
                            </Box>
                            <Box sx={{ width: 40, display: "flex", justifyContent: "center" }}>
                              <IconButton size="small" sx={{ color: '#d32f2f', '&:hover': { background: 'rgba(211,47,47,0.1)' } }} onClick={() => handleArrayAction("partE", "dischargeDrugs", "remove", index)}><Delete fontSize="small" /></IconButton>
                            </Box>
                          </Box>
                        ))}
                      </Box>
                    </Box>
                  </Box>

                  {/* Follow Ups and Emergency grouped */}
                  <Box sx={{ display: "flex", gap: 2, flexWrap: "wrap", mt: 1 }}>
                    <Box sx={{ flex: 1, minWidth: 220, border: `1px solid ${C.border}`, borderRadius: 2, p: 2.5, background: C.bgSecondary }}>
                      <Typography sx={{ fontSize: 13, color: C.black, fontWeight: FW_MEDIUM, mb: 1.5 }}>Follow up date for Chemotherapy Clinic</Typography>
                      <TextField type="date" fullWidth size="small" sx={{ ...inputStyle, m: 0, '& .MuiOutlinedInput-root': { background: C.white } }} value={formData.partE.followUpDoctor} onChange={e => handleUpdate("partE", "followUpDoctor", e.target.value)} />
                    </Box>
                    <Box sx={{ flex: 1, minWidth: 220, border: `1px solid ${C.border}`, borderRadius: 2, p: 2.5, background: C.bgSecondary }}>
                      <Typography sx={{ fontSize: 13, color: C.black, fontWeight: FW_MEDIUM, mb: 1.5 }}>Follow up date for Chemotherapy Delivery</Typography>
                      <TextField type="date" fullWidth size="small" sx={{ ...inputStyle, m: 0, '& .MuiOutlinedInput-root': { background: C.white } }} value={formData.partE.followUpDaycare} onChange={e => handleUpdate("partE", "followUpDaycare", e.target.value)} />
                    </Box>
                    <Box sx={{ flex: 1, minWidth: 220, border: `1px solid ${C.border}`, borderRadius: 2, p: 2.5, background: C.bgSecondary }}>
                      <Typography sx={{ fontSize: 13, color: C.black, fontWeight: FW_MEDIUM, mb: 1.5 }}>Emergency Contact</Typography>
                      <TextField fullWidth size="small" sx={{ ...inputStyle, m: 0, '& .MuiOutlinedInput-root': { background: C.white } }} placeholder="E.g., +91 9876543210" value={formData.partE.emergencyContact || ""} onChange={e => handleUpdate("partE", "emergencyContact", e.target.value)} />
                    </Box>
                  </Box>
                </Box>

                <SectionHeader title="Tests Recommended" />
                <Box sx={{ p: 3 }}>
                  <TableContainer sx={{ border: `1px solid ${C.black}`, borderRadius: 0, mb: 1, background: C.white }}>
                    <Table size="small">
                      <TableHead>
                        <TableRow>
                          {["Investigation", "Clinical Indication", "Parameters"].map(h => (
                            <TableCell key={h} sx={invThSx}>{h}</TableCell>
                          ))}
                        </TableRow>
                      </TableHead>
                      <TableBody>
                        {(() => {
                          const grouped = {};

                          pendingInvestigations.forEach(inv => {
                            const label = getInvestigationLabel(inv);
                            const paramsStr = formatInvParams(inv.parameters);

                            // Skip completely empty parameters or placeholder
                            if (!paramsStr || paramsStr.trim() === "" || paramsStr.trim() === "—") return;

                            if (!grouped[label]) {
                              grouped[label] = {
                                investigation: label,
                                parameters: new Set(),
                                indication: null
                              };
                            }

                            // Merge parameters (split by comma, trim, filter)
                            paramsStr.split(",").map(p => p.trim()).filter(Boolean).forEach(p => {
                              grouped[label].parameters.add(p);
                            });

                            // Keep the first valid non-empty indication
                            const ind = inv.clinical_indication?.trim();
                            if (!grouped[label].indication && ind && ind !== "" && ind !== "—") {
                              grouped[label].indication = ind;
                            }
                          });

                          const uniqueValidInvs = Object.values(grouped).map(group => ({
                            label: group.investigation,
                            parameters: Array.from(group.parameters).join(", "),
                            indication: group.indication || "—"
                          }));

                          if (uniqueValidInvs.length === 0) {
                            return (
                              <TableRow>
                                <TableCell colSpan={3} sx={{ ...invTdSx, textAlign: "center", color: C.textMuted }}>No tests recommended at this time.</TableCell>
                              </TableRow>
                            );
                          }

                          return uniqueValidInvs.map((inv, idx) => (
                            <TableRow key={idx} sx={{ "&:hover td": { background: C.bgSecondary } }}>
                              <TableCell sx={invTdSx}>{inv.label}</TableCell>
                              <TableCell sx={invTdSx}>{inv.indication}</TableCell>
                              <TableCell sx={invTdSx}>{inv.parameters}</TableCell>
                            </TableRow>
                          ));
                        })()}
                      </TableBody>
                    </Table>
                  </TableContainer>
                </Box>

                <SectionHeader title="Treatment Completion Status" />
                <FieldRow label="Overall Treatment Completion" tag="Manual clinical decision — not auto-set by cycle admin">
                  <Box sx={{ display: "flex", flexDirection: "column", gap: 1.5, position: "relative", zIndex: 20 }}>
                    {(treatment?.completedCycles || 0) >= (treatment?.plannedCycles || 1) && !formData.partE.treatmentCompletionStatus && (
                      <Typography sx={{ fontSize: 12, color: C.textSecond, fontFamily: FONT, p: 1.25, background: C.bgSecondary, border: `1px solid ${C.border}` }}>
                        All planned cycles are finished. Please select whether overall treatment was completed as planned or not completed.
                      </Typography>
                    )}
                    <Box sx={{ display: "flex", gap: 1, flexWrap: "wrap" }}>
                      <CustomRadio
                        label="Completed as planned"
                        value="completed"
                        checked={formData.partE.treatmentCompletionStatus === "completed"}
                        onChange={() => {
                          handleUpdate("partE", "treatmentCompletionStatus", "completed");
                          handleUpdate("partE", "treatmentNotCompletedReason", "");
                          handleUpdate("partE", "treatmentNotCompletedNotes", "");
                          setTreatment(prev => ({
                            ...prev,
                            treatmentCompleted: true,
                            status: "all_cycles_completed",
                          }));
                        }}
                      />
                      <CustomRadio
                        label="Not completed"
                        value="not-completed"
                        checked={formData.partE.treatmentCompletionStatus === "not-completed"}
                        onChange={() => {
                          handleUpdate("partE", "treatmentCompletionStatus", "not-completed");
                          setTreatment(prev => ({
                            ...prev,
                            treatmentCompleted: false,
                            status: "treatment_not_completed",
                          }));
                        }}
                      />
                    </Box>
                    {formData.partE.treatmentCompletionStatus === "not-completed" && (
                      <Box sx={{ p: 1.5, background: C.bgSecondary, border: `1px solid ${C.border}` }}>
                        <Typography sx={{ fontSize: 12, color: C.textSecond, mb: 1, fontWeight: FW_MEDIUM, fontFamily: FONT }}>
                          Justification for incomplete treatment
                        </Typography>
                        <Select
                          fullWidth
                          size="small"
                          sx={{ ...inputStyle, m: 0, mb: 1.5, background: C.white }}
                          displayEmpty
                          value={formData.partE.treatmentNotCompletedReason || ""}
                          onChange={e => handleUpdate("partE", "treatmentNotCompletedReason", e.target.value)}
                        >
                          <MenuItem value=""><em>Select justification...</em></MenuItem>
                          <MenuItem value="Disease progression">Disease progression</MenuItem>
                          <MenuItem value="Unacceptable toxicity">Unacceptable toxicity</MenuItem>
                          <MenuItem value="Patient declined further treatment">Patient declined further treatment</MenuItem>
                          <MenuItem value="Comorbidities / clinical deterioration">Comorbidities / clinical deterioration</MenuItem>
                          <MenuItem value="Death">Death</MenuItem>
                          <MenuItem value="Lost to follow-up">Lost to follow-up</MenuItem>
                          <MenuItem value="Switched to alternative therapy">Switched to alternative therapy</MenuItem>
                          <MenuItem value="Financial / access constraints">Financial / access constraints</MenuItem>
                          <MenuItem value="Protocol hold / medical decision">Protocol hold / medical decision</MenuItem>
                          <MenuItem value="Other">Other</MenuItem>
                        </Select>
                        <TextField
                          fullWidth
                          multiline
                          rows={2}
                          size="small"
                          sx={{ ...inputStyle, m: 0, background: C.white }}
                          placeholder="Additional notes / clinical justification (optional unless Other)"
                          value={formData.partE.treatmentNotCompletedNotes || ""}
                          onChange={e => handleUpdate("partE", "treatmentNotCompletedNotes", e.target.value)}
                        />
                      </Box>
                    )}
                    {formData.partE.treatmentCompletionStatus === "completed" && (
                      <Typography sx={{ fontSize: 12, color: C.textMuted, fontFamily: FONT }}>
                        Treatment marked as completed as planned.
                      </Typography>
                    )}
                  </Box>
                </FieldRow>

                <FieldRow label="End of Response to Treatment">
                  <Select fullWidth size="small" sx={inputStyle} displayEmpty value={formData.partE.endOfResponseTreatment || ""} onChange={e => handleUpdate("partE", "endOfResponseTreatment", e.target.value)}>
                    <MenuItem value=""><em>Select response...</em></MenuItem>
                    <MenuItem value="Complete Response">Complete Response</MenuItem>
                    <MenuItem value="Partial Response">Partial Response</MenuItem>
                    <MenuItem value="Stable Disease">Stable Disease</MenuItem>
                    <MenuItem value="Progressive Disease">Progressive Disease</MenuItem>
                    <MenuItem value="Not Assessed">Not Assessed</MenuItem>
                  </Select>
                </FieldRow>
                <FieldRow label="End of Treatment Response Date">
                  <TextField type="date" fullWidth size="small" sx={inputStyle} value={formData.partE.endOfResponseDate || ""} onChange={e => handleUpdate("partE", "endOfResponseDate", e.target.value)} />
                </FieldRow>

                <FieldRow label="Cumulative Doses">
                  <Box sx={{ ...inputStyle, p: 1, backgroundColor: C.ghost, color: C.smoke, minHeight: 40 }}>
                    {(() => {
                      const cycles = parseInt(treatment?.completedCycles || 0);
                      if (!cycles || isNaN(cycles)) {
                        return "— (No completed cycles recorded to auto-calculate)";
                      }

                      const h = parseFloat(formData.overview.height);
                      const w = parseFloat(formData.overview.weight);
                      const bsa = (h && w) ? (0.007184 * Math.pow(h, 0.725) * Math.pow(w, 0.425)) : 0;

                      if (!formData.partA.drugs || formData.partA.drugs.length === 0 || !formData.partA.drugs[0].name) {
                        return "— (No drugs defined in Part A Plan)";
                      }

                      const doses = formData.partA.drugs.map(drug => {
                        let perCycleNum = 0;
                        const doseVal = parseFloat(drug.dose);
                        if (!isNaN(doseVal)) {
                          if (drug.unit === "m2" && bsa > 0) {
                            perCycleNum = Math.round(doseVal * bsa);
                          }
                          else if (drug.unit === "kg" && w > 0) {
                            perCycleNum = Math.round(doseVal * w);
                          }
                          else {
                            perCycleNum = doseVal;
                          }
                        }

                        if (perCycleNum > 0 && drug.name) {
                          const total = perCycleNum * cycles;
                          let unitStr = (drug.unit === "m2" || drug.unit === "kg") ? "mg" : (drug.unit || "");
                          return `${drug.name}: ${total} ${unitStr}`.trim() + ` (${perCycleNum} ${unitStr}/cycle × ${cycles} cycles)`;
                        }
                        return "";
                      }).filter(Boolean);

                      return doses.length > 0 ? doses.join("\n") : "—";
                    })()}
                  </Box>
                </FieldRow>
                <FieldRow label="Treatment Outcomes">
                  <TextField fullWidth multiline rows={2} sx={inputStyle} placeholder="Describe outcomes" value={formData.partE.treatmentOutcomes} onChange={e => handleUpdate("partE", "treatmentOutcomes", e.target.value)} />
                </FieldRow>
                <FieldRow label="Residual Toxicity">
                  <TextField fullWidth multiline rows={2} sx={inputStyle} placeholder="Any persistent toxicity?" value={formData.partE.residualToxicity} onChange={e => handleUpdate("partE", "residualToxicity", e.target.value)} />
                </FieldRow>



                <SectionHeader title="Quality Assurance / Audit" />
                <FieldRow label="Audit Period">
                  <TextField fullWidth size="small" sx={inputStyle} placeholder="e.g. Q1 2026" value={formData.partE.auditPeriod} onChange={e => handleUpdate("partE", "auditPeriod", e.target.value)} />
                </FieldRow>
                <FieldRow label="Dosing Accuracy Audit">
                  <TextField fullWidth multiline rows={2} sx={inputStyle} placeholder="Findings on dosing accuracy" value={formData.partE.dosingAccuracy} onChange={e => handleUpdate("partE", "dosingAccuracy", e.target.value)} />
                </FieldRow>
                <FieldRow label="Adverse Event Rate">
                  <TextField fullWidth size="small" sx={inputStyle} placeholder="e.g. 5%" value={formData.partE.adverseEventRate} onChange={e => handleUpdate("partE", "adverseEventRate", e.target.value)} />
                </FieldRow>
                <FieldRow label="Protocol Adherence (%)">
                  <TextField fullWidth size="small" sx={inputStyle} placeholder="e.g. 98%" value={formData.partE.protocolAdherence} onChange={e => handleUpdate("partE", "protocolAdherence", e.target.value)} />
                </FieldRow>
                <FieldRow label="Incident Review">
                  <TextField fullWidth multiline rows={2} sx={inputStyle} placeholder="Details of any incidents" value={formData.partE.incidentReview} onChange={e => handleUpdate("partE", "incidentReview", e.target.value)} />
                </FieldRow>
              </Box>
            )}

            {/* TAB: CT PART F (Discharge Completion) */}
            {activeTab === "partF" && (
              <Box>
                <SectionHeader title="Treatment Sessions — All Cycles" />
                <Box sx={{ p: 3, overflowX: "auto" }}>
                  <Box sx={{ minWidth: 700, display: "flex", flexDirection: "column", gap: 1 }}>
                    <Box sx={{ display: "flex", gap: 1, p: 1, background: C.bgSecondary, border: `1px solid ${C.border}`, fontWeight: FW_MEDIUM, fontSize: 12.5 }}>
                      <Box sx={{ flex: 1 }}>Cycle No</Box>
                      <Box sx={{ flex: 1.5 }}>Completion Date</Box>
                      <Box sx={{ flex: 3 }}>Drugs Administered</Box>
                      <Box sx={{ flex: 1 }}>Status</Box>
                    </Box>
                    {Array.from({ length: parseInt(formData.partA.cycles) || treatment?.plannedCycles || treatment?.completedCycles || 1 }).map((_, i) => {
                      const cycleNum = i + 1;
                      const cData = dbCycles[String(cycleNum)] || {};
                      const cDate = cData.cycle_admin?.cycleDate1 || cData.regimen?.startDate || "";
                      let cStatus = cData.cycle_admin?.cycleCompleted || "";
                      if (cStatus === "not-completed") cStatus = "cancelled";
                      const adminDrugs = cData.admin?.adminDrugs || [];
                      const givenDrugsStr = adminDrugs.filter(d => d.given === "yes" && d.name).map(d => `${d.name}${d.dose ? ` (${d.dose})` : ""}`).join(", ");
                      const regimenDrugs = (cData.regimen?.drugs || []).map(d => d.name).filter(Boolean).join(", ");
                      return (
                        <Box key={cycleNum} sx={{ display: "flex", gap: 1, alignItems: "center", p: 1, borderBottom: `1px solid ${C.border}` }}>
                          <Box sx={{ flex: 1, fontSize: 13, fontWeight: FW_MEDIUM }}>Cycle {cycleNum}</Box>
                          <Box sx={{ flex: 1.5, fontSize: 13, color: C.textMuted }}>{cDate || "— (Not started)"}</Box>
                          <Box sx={{ flex: 3, fontSize: 13, color: C.textSecond }}>{givenDrugsStr || regimenDrugs || "—"}</Box>
                          <Box sx={{ flex: 1, fontSize: 13, color: cStatus === "completed" ? "green" : cStatus === "cancelled" ? "red" : C.textMuted }}>
                            {cStatus === "completed" ? "Completed" : cStatus === "cancelled" ? "Not Completed / Cancelled" : "—"}
                          </Box>
                        </Box>
                      );
                    })}
                  </Box>
                </Box>

                <SectionHeader title="Discharge Prepared By" />
                <FieldRow label="Name of Doctor who prepared discharge">
                  <TextField
                    fullWidth
                    size="small"
                    sx={inputStyle}
                    placeholder="Doctor name"
                    value={formData.partF.dischargePreparedBy || ""}
                    onChange={e => handleUpdate("partF", "dischargePreparedBy", e.target.value)}
                  />
                </FieldRow>

                <SectionHeader title="Toxicity Summary — Entire Course" />
                <Box sx={{ px: 3, pt: 3, mb: 2 }}>
                  <ToxicityHistoryTable
                    dbCycles={dbCycles}
                    completedCycles={Math.max(
                      treatment?.completedCycles || 0,
                      parseInt(formData.partA.cycles) || treatment?.plannedCycles || 0
                    )}
                    currentPartD={formData.partD}
                    currentCycle={parseInt(formData.partA.cycles) || treatment?.currentCycle || 1}
                    forceExpanded
                  />
                </Box>
                <Box sx={{ px: 3, pb: 3 }}>
                  <Typography sx={{ fontSize: 12, color: C.textMuted, mb: 1, fontFamily: FONT }}>
                    Full narrative of toxicities encountered across all cycles (prefilled from Discharge On Treatment when available)
                  </Typography>
                  <TextField
                    fullWidth
                    multiline
                    rows={4}
                    size="small"
                    sx={{ ...inputStyle, m: 0 }}
                    placeholder="Entire summary of toxicity encountered during treatment"
                    value={formData.partF.toxicitySummaryText || ""}
                    onChange={e => handleUpdate("partF", "toxicitySummaryText", e.target.value)}
                  />
                </Box>

                <SectionHeader title="Treatment Completion Status" />
                <FieldRow label="Overall Treatment Completion" tag="Mark completion of treatment">
                  <Box sx={{ display: "flex", flexDirection: "column", gap: 1.5 }}>
                    <Box sx={{ display: "flex", gap: 1, flexWrap: "wrap" }}>
                      <CustomRadio
                        label="Completed as planned"
                        value="completed"
                        checked={formData.partF.treatmentCompletionStatus === "completed"}
                        onChange={() => {
                          handleUpdate("partF", "treatmentCompletionStatus", "completed");
                          handleUpdate("partF", "treatmentNotCompletedReason", "");
                          handleUpdate("partF", "treatmentNotCompletedNotes", "");
                          handleUpdate("partE", "treatmentCompletionStatus", "completed");
                          handleUpdate("partE", "treatmentNotCompletedReason", "");
                          handleUpdate("partE", "treatmentNotCompletedNotes", "");
                          setTreatment(prev => ({
                            ...prev,
                            treatmentCompleted: true,
                            status: "all_cycles_completed",
                          }));
                        }}
                      />
                      <CustomRadio
                        label="Not completed"
                        value="not-completed"
                        checked={formData.partF.treatmentCompletionStatus === "not-completed"}
                        onChange={() => {
                          handleUpdate("partF", "treatmentCompletionStatus", "not-completed");
                          handleUpdate("partE", "treatmentCompletionStatus", "not-completed");
                          setTreatment(prev => ({
                            ...prev,
                            treatmentCompleted: false,
                            status: "treatment_not_completed",
                          }));
                        }}
                      />
                    </Box>
                    {formData.partF.treatmentCompletionStatus === "not-completed" && (
                      <Box sx={{ p: 1.5, background: C.bgSecondary, border: `1px solid ${C.border}` }}>
                        <Typography sx={{ fontSize: 12, color: C.textSecond, mb: 1, fontWeight: FW_MEDIUM, fontFamily: FONT }}>
                          Justification for incomplete treatment
                        </Typography>
                        <Select
                          fullWidth
                          size="small"
                          sx={{ ...inputStyle, m: 0, mb: 1.5, background: C.white }}
                          displayEmpty
                          value={formData.partF.treatmentNotCompletedReason || ""}
                          onChange={e => {
                            handleUpdate("partF", "treatmentNotCompletedReason", e.target.value);
                            handleUpdate("partE", "treatmentNotCompletedReason", e.target.value);
                          }}
                        >
                          <MenuItem value=""><em>Select justification...</em></MenuItem>
                          <MenuItem value="Disease progression">Disease progression</MenuItem>
                          <MenuItem value="Unacceptable toxicity">Unacceptable toxicity</MenuItem>
                          <MenuItem value="Patient declined further treatment">Patient declined further treatment</MenuItem>
                          <MenuItem value="Comorbidities / clinical deterioration">Comorbidities / clinical deterioration</MenuItem>
                          <MenuItem value="Death">Death</MenuItem>
                          <MenuItem value="Lost to follow-up">Lost to follow-up</MenuItem>
                          <MenuItem value="Switched to alternative therapy">Switched to alternative therapy</MenuItem>
                          <MenuItem value="Financial / access constraints">Financial / access constraints</MenuItem>
                          <MenuItem value="Protocol hold / medical decision">Protocol hold / medical decision</MenuItem>
                          <MenuItem value="Other">Other</MenuItem>
                        </Select>
                        <TextField
                          fullWidth
                          multiline
                          rows={2}
                          size="small"
                          sx={{ ...inputStyle, m: 0, background: C.white }}
                          placeholder="Additional notes / clinical justification (optional unless Other)"
                          value={formData.partF.treatmentNotCompletedNotes || ""}
                          onChange={e => {
                            handleUpdate("partF", "treatmentNotCompletedNotes", e.target.value);
                            handleUpdate("partE", "treatmentNotCompletedNotes", e.target.value);
                          }}
                        />
                      </Box>
                    )}
                  </Box>
                </FieldRow>

                <FieldRow label="End of Response to Treatment">
                  <Select
                    fullWidth
                    size="small"
                    sx={inputStyle}
                    displayEmpty
                    value={formData.partF.endOfResponseTreatment || ""}
                    onChange={e => {
                      handleUpdate("partF", "endOfResponseTreatment", e.target.value);
                      handleUpdate("partE", "endOfResponseTreatment", e.target.value);
                    }}
                  >
                    <MenuItem value=""><em>Select response...</em></MenuItem>
                    <MenuItem value="Complete Response">Complete Response</MenuItem>
                    <MenuItem value="Partial Response">Partial Response</MenuItem>
                    <MenuItem value="Stable Disease">Stable Disease</MenuItem>
                    <MenuItem value="Progressive Disease">Progressive Disease</MenuItem>
                    <MenuItem value="Not Assessed">Not Assessed</MenuItem>
                  </Select>
                </FieldRow>
                <FieldRow label="End of Treatment Response Date">
                  <TextField
                    type="date"
                    fullWidth
                    size="small"
                    sx={inputStyle}
                    value={formData.partF.endOfResponseDate || ""}
                    onChange={e => {
                      handleUpdate("partF", "endOfResponseDate", e.target.value);
                      handleUpdate("partE", "endOfResponseDate", e.target.value);
                    }}
                  />
                </FieldRow>

                <SectionHeader
                  title="Final Summary"
                  action={
                    <Button
                      variant="contained"
                      size="small"
                      onClick={generateFinalSummary}
                      sx={{
                        bgcolor: C.white,
                        color: C.black,
                        '&:hover': { bgcolor: C.bgSecondary },
                        textTransform: 'none',
                        fontWeight: 600
                      }}
                    >
                      ✨ Auto-Populate Summary
                    </Button>
                  }
                />
                <FieldRow label="Overall Assessment">
                  <TextField fullWidth multiline minRows={6} sx={inputStyle} placeholder="Provide a comprehensive overall assessment of the patient's treatment journey" value={formData.partF.overallAssessment} onChange={e => handleUpdate("partF", "overallAssessment", e.target.value)} />
                </FieldRow>
                <FieldRow label="Recommendations & Plan">
                  <TextField fullWidth multiline minRows={6} sx={inputStyle} placeholder="List final recommendations and future care plan" value={formData.partF.recommendations} onChange={e => handleUpdate("partF", "recommendations", e.target.value)} />
                </FieldRow>
                <ApprovalsSection
                  cards={[
                    {
                      title: "Physician",
                      name: formData.partF.physicianSignature || "",
                      onNameChange: (v) => handleUpdate("partF", "physicianSignature", v),
                      signed: !!formData.partF.physicianSigned,
                      onToggleSign: () => {
                        const newSigned = !formData.partF.physicianSigned;
                        handleUpdate("partF", "physicianSigned", newSigned);
                        if (newSigned && !formData.partF.signatureDate) {
                          const today = new Date().toISOString().split('T')[0];
                          handleUpdate("partF", "signatureDate", today);
                        }
                      },
                      namePlaceholder: "Type name to electronically sign",
                    }
                  ]}
                />
                <FieldRow label="Signature Date">
                  <TextField type="date" fullWidth size="small" sx={inputStyle} value={formData.partF.signatureDate} onChange={e => handleUpdate("partF", "signatureDate", e.target.value)} />
                </FieldRow>

                <Box sx={{ p: 4, textAlign: "center" }}>
                  {currentTreatmentStatus === "completed" ? (
                    <Button
                      variant="contained"
                      sx={{ ...btnStyle, background: C.red, color: C.white, px: 4, py: 1.5 }}
                      onClick={() => {
                        if (window.confirm("Are you sure you want to unlock this treatment? It will become the active line of therapy again.")) {
                          setCurrentTreatmentStatus("active");
                          setTimeout(() => saveFormData("active"), 100);
                        }
                      }}
                    >
                      Unlock / Re-open Treatment
                    </Button>
                  ) : (
                    <Button
                      variant="contained"
                      sx={{ ...btnStyle, background: C.black, color: C.white, px: 4, py: 1.5 }}
                      onClick={() => {
                        if (window.confirm("Are you sure you want to finalize and complete this chemotherapy treatment? Future visits will require a new treatment line.")) {
                          setCurrentTreatmentStatus("completed");
                          setTimeout(() => saveFormData("completed"), 100);
                        }
                      }}
                    >
                      Save Final Discharge Summary
                    </Button>
                  )}
                </Box>
              </Box>
            )}
            {activeTab === "totalDischarge" && (
              <DischargeSummary
                patientId={patientId}
                doctorId={doctorId}
              />
            )}
          </Box>
        </Box>
      </Box>

      {/* ── FOOTER ── */}
      <Box sx={{ display: "flex", justifyContent: "flex-end", alignItems: "center", p: "12px 24px", background: C.white, borderTop: `1px solid ${C.border}` }}>
        <Button variant="contained" sx={{ ...btnStyle, background: C.black, color: C.white, px: 4, py: 1 }} onClick={() => saveFormData()} disabled={isSaving}>
          {isSaving ? "Saving..." : "Save Changes"}
        </Button>
      </Box>

      <Dialog
        open={pastAdverseAlertOpen}
        onClose={() => setPastAdverseAlertOpen(false)}
        maxWidth="md"
        fullWidth
      >
        <DialogTitle sx={{ display: "flex", justifyContent: "space-between", alignItems: "center", background: C.black, color: C.white, py: 1.5, px: 2.5 }}>
          <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
            <WarningAmberRounded sx={{ color: C.white }} />
            <Typography sx={{ fontFamily: FONT, fontWeight: FW_MEDIUM, fontSize: 16 }}>
              Past Adverse Event Alert
            </Typography>
          </Box>
          <IconButton onClick={() => setPastAdverseAlertOpen(false)} size="small" sx={{ color: C.white }}>
            <CloseRounded />
          </IconButton>
        </DialogTitle>
        <DialogContent sx={{ p: 0, fontFamily: FONT }}>
          {(() => {
            const alerts = pastAdverseAlerts.length ? pastAdverseAlerts : pastAdverseEventsForCurrentDrugs;
            const grouped = groupAlertsByCycle(alerts);
            const uniqueDrugs = [...new Set(alerts.map(a => a.drug).filter(Boolean))];
            const highCount = alerts.filter(a => a.severity === "high" || a.severity === "critical").length;
            return (
              <Box>
                <Box sx={{ p: 2.5, borderBottom: `1px solid ${C.border}`, background: C.bgSecondary }}>
                  <Typography sx={{ fontSize: 13, color: C.textPrimary, fontWeight: FW_MEDIUM, mb: 0.75 }}>
                    Review prior events before documenting toxicity for cycle {currentCycleForAlerts}
                  </Typography>
                  <Typography sx={{ fontSize: 12, color: C.textSecond, mb: 1.5 }}>
                    {alerts.length} unique event{alerts.length > 1 ? "s" : ""} found across {grouped.length} prior cycle{grouped.length > 1 ? "s" : ""}
                    {highCount > 0 ? ` · ${highCount} high/critical` : ""}.
                  </Typography>
                  <Box sx={{ display: "flex", gap: 1, flexWrap: "wrap" }}>
                    {uniqueDrugs.map(drug => (
                      <Box key={drug} sx={{ px: 1.25, py: 0.4, border: `1px solid ${C.black}`, background: C.white, fontSize: 11.5, fontFamily: FONT, fontWeight: FW_MEDIUM }}>
                        {drug}
                      </Box>
                    ))}
                  </Box>
                </Box>

                <Box sx={{ p: 2.5, maxHeight: 420, overflowY: "auto", display: "flex", flexDirection: "column", gap: 1.5 }}>
                  {grouped.map(({ cycleNum, items }) => (
                    <Box key={cycleNum} sx={{ border: `1px solid ${C.border}`, background: C.white }}>
                      <Box sx={{ px: 1.5, py: 1, background: C.black, color: C.white, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                        <Typography sx={{ fontSize: 12.5, fontWeight: FW_MEDIUM, fontFamily: FONT }}>
                          Cycle {cycleNum}
                        </Typography>
                        <Typography sx={{ fontSize: 11, fontFamily: FONT, opacity: 0.85 }}>
                          {items.length} event{items.length > 1 ? "s" : ""}
                        </Typography>
                      </Box>
                      <Box sx={{ display: "flex", flexDirection: "column" }}>
                        {items.map((a, idx) => {
                          const sev = severityStyle(a.severity);
                          return (
                            <Box
                              key={`${cycleNum}-${idx}`}
                              sx={{
                                display: "grid",
                                gridTemplateColumns: { xs: "1fr", sm: "140px 1fr auto" },
                                gap: 1,
                                alignItems: "start",
                                px: 1.5,
                                py: 1.25,
                                borderTop: idx === 0 ? "none" : `1px solid ${C.border}`,
                              }}
                            >
                              <Box>
                                <Typography sx={{ fontSize: 12.5, fontWeight: FW_MEDIUM, fontFamily: FONT, color: C.black }}>
                                  {a.drug || "—"}
                                </Typography>
                                <Typography sx={{ fontSize: 11, color: C.textMuted, fontFamily: FONT, mt: 0.25 }}>
                                  {a.type}
                                </Typography>
                              </Box>
                              <Typography sx={{ fontSize: 12.5, fontFamily: FONT, color: C.textPrimary, lineHeight: 1.45 }}>
                                {a.detail || "—"}
                              </Typography>
                              <Box
                                sx={{
                                  justifySelf: { xs: "start", sm: "end" },
                                  px: 1,
                                  py: 0.35,
                                  background: sev.bg,
                                  color: sev.color,
                                  fontSize: 10.5,
                                  fontFamily: FONT,
                                  fontWeight: FW_MEDIUM,
                                  letterSpacing: "0.04em",
                                  textTransform: "uppercase",
                                  whiteSpace: "nowrap",
                                }}
                              >
                                {sev.label}
                              </Box>
                            </Box>
                          );
                        })}
                      </Box>
                    </Box>
                  ))}
                </Box>
              </Box>
            );
          })()}
        </DialogContent>
        <DialogActions sx={{ px: 2.5, py: 1.5, borderTop: `1px solid ${C.border}` }}>
          <Button
            sx={{ ...btnStyle, border: `1px solid ${C.border}`, color: C.textSecond, px: 2 }}
            onClick={() => setPastAdverseAlertOpen(false)}
          >
            Close
          </Button>
          <Button
            sx={{ ...btnStyle, background: C.black, color: C.white, px: 3, "&:hover": { background: "#222" } }}
            onClick={() => {
              const alerts = pastAdverseAlerts.length ? pastAdverseAlerts : pastAdverseEventsForCurrentDrugs;
              const signature = alerts
                .map(a => `${a.cycleNum}|${normalizeDrugName(a.drug)}|${a.type}|${a.detail}`)
                .join("||");
              const ackKey = `${patientId || "p"}|${currentCycleForAlerts}|${signature}`;
              pastAdverseAckRef.current[ackKey] = true;
              setPastAdverseAlertOpen(false);
            }}
          >
            Acknowledged
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
};

export default OPRecord;
