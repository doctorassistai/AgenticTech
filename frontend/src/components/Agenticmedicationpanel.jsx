import React, { useState, useEffect } from "react";
import {
  Box,
  Typography,
  Stack,
  TextField,
  IconButton,
  Grid,
  Chip,
  MenuItem,
  Tooltip,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Checkbox,
  FormControlLabel,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Collapse,
} from "@mui/material";
import html2pdf from "html2pdf.js";
import AddIcon from "@mui/icons-material/Add";
import SaveIcon from "@mui/icons-material/Save";
import DeleteIcon from "@mui/icons-material/Delete";
import EditIcon from "@mui/icons-material/Edit";
import WarningIcon from "@mui/icons-material/Warning";
import CheckCircleIcon from "@mui/icons-material/CheckCircle";
import LocalPharmacyIcon from "@mui/icons-material/LocalPharmacy";
import MedicationIcon from "@mui/icons-material/Medication";
import SettingsIcon from "@mui/icons-material/Settings";
import VisibilityIcon from "@mui/icons-material/Visibility";
import CloseIcon from "@mui/icons-material/Close";
import InfoOutlinedIcon from "@mui/icons-material/InfoOutlined";
import ExpandMoreRoundedIcon from "@mui/icons-material/ExpandMoreRounded";
import ExpandLessRoundedIcon from "@mui/icons-material/ExpandLessRounded";

// ─── Design Tokens (matches DoctorDashboard) ──────────────────────────────────
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

const card = {
  background: C.white,
  border: `1px solid ${C.fog}`,
  borderRadius: "4px",
  boxShadow: "0 1px 3px rgba(0,0,0,0.06)",
};

const btnBase = {
  fontFamily: FONT,
  fontWeight: 400,
  fontSize: 12,
  letterSpacing: "0.04em",
  textTransform: "none",
  borderRadius: "2px",
  cursor: "pointer",
  display: "inline-flex",
  alignItems: "center",
  gap: "6px",
  transition: "all 0.15s ease",
  border: "none",
  outline: "none",
};

const primaryBtn = {
  ...btnBase,
  background: C.black,
  color: C.white,
  padding: "7px 16px",
  "&:hover": { background: C.charcoal },
  "&:disabled": { opacity: 0.4, cursor: "not-allowed" },
};

const ghostBtn = {
  ...btnBase,
  background: "transparent",
  color: C.charcoal,
  padding: "6px 14px",
  border: `1px solid ${C.mist}`,
  "&:hover": { borderColor: C.smoke, background: C.ghost },
};

// ─── Column definitions ───────────────────────────────────────────────────────
const defaultVisibleColumns = [
  { key: "medication", label: "Medication" },
  { key: "brand_name", label: "Brand" },
  { key: "generic_name", label: "Generic" },
  { key: "category", label: "Category" },
  { key: "strength", label: "Strength" },
  { key: "dosage_form", label: "Form" },
  { key: "route", label: "Route" },
  { key: "dosage_instructions", label: "Instructions" },
];

const allAvailableColumns = [
  { key: "medication", label: "Medication" },
  { key: "brand_name", label: "Brand Name" },
  { key: "generic_name", label: "Generic Name" },
  { key: "category", label: "Category" },
  { key: "strength", label: "Strength" },
  { key: "dosage_form", label: "Dosage Form" },
  { key: "route", label: "Route" },
  { key: "frequency", label: "Frequency" },
  { key: "duration", label: "Duration" },
  { key: "follow_up", label: "Follow-up" },
  { key: "standard_frequency_options", label: "Frequency Options" },
  { key: "standard_duration_options", label: "Duration Options" },
  { key: "special_instructions", label: "Special Instructions" },
  { key: "dosage_instructions", label: "Dosage Instructions" },
  { key: "quantity", label: "Quantity" },
  { key: "refills", label: "Refills" },
];

// ─── Helpers ──────────────────────────────────────────────────────────────────
const formatDisplayValue = (key, value) => {
  if (!value) return "—";
  if (Array.isArray(value)) value = value.join(", ");
  value = String(value);
  if (key === "medication" || key === "brand_name") return value.toUpperCase();
  return value.toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());
};

const getFieldValue = (row, key) => {
  if (key === "standard_frequency_options" || key === "standard_duration_options") {
    return Array.isArray(row[key]) ? row[key].join(", ") : row[key] || "";
  }
  return row[key] || "";
};

// A dose-personalization / adjustment string counts as a genuine "no issue"
// state if it says either "no adjustment" (real medication, nothing to
// adjust) OR "not applicable" (the dictation-only gate short-circuited
// because no medication was dictated at all — see backend A5-empty branch).
// Both are informational/neutral, never a warning.
const isAdjustmentOk = (val) => /no adjustment|not applicable/i.test(val || "");

// ─── Severity config ──────────────────────────────────────────────────────────
const severityStyle = {
  danger:   { bg: "#fff5f5", border: "#f5c6c6", dot: "#c0392b", label: "Danger" },
  high:     { bg: "#fff5f5", border: "#f5c6c6", dot: "#c0392b", label: "High" },
  critical: { bg: "#fff5f5", border: "#f5c6c6", dot: "#c0392b", label: "Critical" },
  moderate: { bg: "#fffbf0", border: "#f5dfa0", dot: "#b8860b", label: "Moderate" },
  medium:   { bg: "#fffbf0", border: "#f5dfa0", dot: "#b8860b", label: "Moderate" },
  low:      { bg: "#f5fff8", border: "#b8e8c8", dot: "#27ae60", label: "Low" },
  safe:     { bg: "#f5fff8", border: "#b8e8c8", dot: "#27ae60", label: "Safe" },
};
const getSeverity = (s) => severityStyle[(s || "").toLowerCase()] || severityStyle.moderate;

// ─── Tiny reusable button ─────────────────────────────────────────────────────
const Btn = ({ children, onClick, variant = "ghost", disabled, icon, sx = {} }) => {
  const style = variant === "primary" ? primaryBtn : ghostBtn;
  return (
    <Box component="button" onClick={onClick} disabled={disabled} sx={{ ...style, ...sx }}>
      {icon && <Box sx={{ display: "flex", alignItems: "center", "& svg": { fontSize: 15 } }}>{icon}</Box>}
      {children}
    </Box>
  );
};

const Label = ({ children }) => (
  <Typography sx={{ ...os({ fontSize: 10, color: C.silver, textTransform: "uppercase", letterSpacing: "0.09em", mb: 1 }) }}>
    {children}
  </Typography>
);

// ─── Collapsible alert section ────────────────────────────────────────────────
const CollapseSection = ({ title, count, children, defaultOpen = false }) => {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <Box sx={{ border: `1px solid ${C.fog}`, borderRadius: "2px", overflow: "hidden", mb: 1.5 }}>
      <Box onClick={() => setOpen((v) => !v)}
        sx={{ px: 2.5, py: 1.5, display: "flex", alignItems: "center", justifyContent: "space-between", cursor: "pointer", background: C.ghost, "&:hover": { background: C.fog } }}>
        <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
          <Typography sx={{ ...os({ fontSize: 13, color: C.ink }) }}>{title}</Typography>
          {count !== undefined && (
            <Box sx={{ px: 1, py: 0.25, background: C.ink, borderRadius: "2px" }}>
              <Typography sx={{ ...os({ fontSize: 10, color: C.white }) }}>{count}</Typography>
            </Box>
          )}
        </Box>
        {open ? <ExpandLessRoundedIcon sx={{ fontSize: 16, color: C.ash }} /> : <ExpandMoreRoundedIcon sx={{ fontSize: 16, color: C.ash }} />}
      </Box>
      <Collapse in={open}>
        <Box sx={{ p: 2.5 }}>{children}</Box>
      </Collapse>
    </Box>
  );
};

// ─── Main Component ───────────────────────────────────────────────────────────
export default function AgenticMedicationPanel({ data, patientId, doctorId, diagnosisText,onSave }) {
  const API_BASE_URL = import.meta.env.VITE_BACKEND_URL || "https://doctorassist.ai/api/";

  const [editableRows, setEditableRows] = useState([]);
  const [savedRows, setSavedRows] = useState([]);
  const [editingRow, setEditingRow] = useState(null);
  const [isEditing, setIsEditing] = useState(false);
  const [visibleColumns, setVisibleColumns] = useState(defaultVisibleColumns);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [doctorInfo, setDoctorInfo] = useState(null);
  const [patientInfo, setPatientInfo] = useState(null);
  const pdfRef = React.useRef();

  // ─── Fetch doctor/patient info ────────────────────────────────────────────
  useEffect(() => {
    const fetchDoctorInfo = async () => {
      try {
        const res = await fetch(`${API_BASE_URL}hms/users/data/context/get-doctor-info?sys_user_id=${doctorId}`);
        const d = await res.json();
        setDoctorInfo(d);
      } catch {}
    };
    if (doctorId) fetchDoctorInfo();
  }, [doctorId]);

  useEffect(() => {
    const fetchPatientInfo = async () => {
      try {
        const res = await fetch(`${API_BASE_URL}hms/users/data/context/get-patient-info?patient_id=${patientId}`);
        const result = await res.json();
        setPatientInfo({ patient_name: result.patient_name || "", age: result.age || "", gender: result.gender || "", hms_id: result.hms_id || "" });
      } catch {}
    };
    if (patientId) fetchPatientInfo();
  }, [patientId]);

  // ─── Normalize data ───────────────────────────────────────────────────────
  useEffect(() => {
    if (!data) return;
    const prescriptions = data.prescriptions || [];
    const rows = prescriptions.map((p) => ({
      ...p,
      standard_frequency_options: Array.isArray(p.standard_frequency_options) ? p.standard_frequency_options.join(", ") : p.standard_frequency_options || "",
      standard_duration_options: Array.isArray(p.standard_duration_options) ? p.standard_duration_options.join(", ") : p.standard_duration_options || "",
    }));
    setEditableRows(rows);
    setSavedRows(rows);
  }, [data]);

  if (!data) return null;

  const safety = data.safety || {};
  const alerts = safety.alerts || [];
  const safeRx = safety.safe_rx || {};
  const doseP = safeRx.dose_personalization || {};
  const evidence = safety.evidence_at_bedside || {};
  const overallAnalysis = safety.overall_analysis || "";
  const dataLimitations = safety.data_limitations || "";
  const interactionMatrix = safety.interaction_matrix || [];

  const displayRows = isEditing ? editableRows : savedRows;

  // The backend's dictation-only gate (MedScript A1 → route_after_extraction)
  // returns an EXPLICIT empty result — medications_found=false, total_medications=0
  // — when the doctor's dictation contained no medication. In that branch,
  // safe_rx / evidence_at_bedside are filled with explanatory placeholder text
  // ("No medications were found...", "Not applicable — no medications dictated.")
  // rather than a real safety analysis. Those panels must not be presented as if
  // a genuine safety review happened, so they are gated on medicationsFound below.
  const medicationsFound =
    data.medications_found !== false && (data.total_medications ?? displayRows.length) > 0;

  // ─── Table actions ────────────────────────────────────────────────────────
  const updateCell = (index, key, value) => {
    const updated = [...editableRows];
    updated[index][key] = value;
    setEditableRows(updated);
  };

  const addMedication = () => {
    const newRow = { medication: "", brand_name: "", generic_name: "", category: "", strength: "", dosage_form: "", route: "", frequency: "", duration: "", follow_up: "", standard_frequency_options: "", standard_duration_options: "", special_instructions: "", dosage_instructions: "", quantity: "", refills: "" };
    setEditableRows([...editableRows, newRow]);
    setEditingRow(editableRows.length);
    setIsEditing(true);
  };

  const removeMedication = (index) => {
    setEditableRows(editableRows.filter((_, i) => i !== index));
    if (editingRow === index) setEditingRow(null);
  };

  const handleSave = () => {
    const formatted = editableRows.map((row) => ({
      ...row,
      standard_frequency_options: row.standard_frequency_options ? row.standard_frequency_options.split(",").map((s) => s.trim()).filter(Boolean) : [],
      standard_duration_options: row.standard_duration_options ? row.standard_duration_options.split(",").map((s) => s.trim()).filter(Boolean) : [],
    }));
    setSavedRows(formatted.map((r) => ({
      ...r,
      standard_frequency_options: Array.isArray(r.standard_frequency_options) ? r.standard_frequency_options.join(", ") : r.standard_frequency_options,
      standard_duration_options: Array.isArray(r.standard_duration_options) ? r.standard_duration_options.join(", ") : r.standard_duration_options,
    })));
    if (onSave) {
      onSave({
        ...data,
        prescriptions: formatted
      });
    }
    setIsEditing(false);
    setEditingRow(null);
  };

  const cancelEdit = () => {
    setEditableRows(savedRows);
    setIsEditing(false);
    setEditingRow(null);
  };

  const toggleColumnVisibility = (key) => {
    if (visibleColumns.some((c) => c.key === key)) {
      setVisibleColumns(visibleColumns.filter((c) => c.key !== key));
    } else {
      const col = allAvailableColumns.find((c) => c.key === key);
      if (col) setVisibleColumns([...visibleColumns, col]);
    }
  };

  const downloadPDF = () => {
    setTimeout(() => {
      if (!pdfRef.current) return;
      html2pdf().set({
        margin: 8,
        filename: `Prescription_${patientId}.pdf`,
        image: { type: "jpeg", quality: 0.98 },
        html2canvas: { scale: 2 },
        jsPDF: { unit: "mm", format: "a4", orientation: visibleColumns.length > 6 ? "landscape" : "portrait" },
      }).from(pdfRef.current).save();
    }, 0);
  };

  // ─── Render ───────────────────────────────────────────────────────────────
  return (
    <Box sx={{ fontFamily: FONT, fontWeight: FW }}>
      <link href="https://fonts.googleapis.com/css2?family=Open+Sans:wght@300;400;600&display=swap" rel="stylesheet" />

      {/* ── Top bar ────────────────────────────────────────────────────── */}
      <Box sx={{ ...card, p: 2.5, mb: 2.5, display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 1.5 }}>
        <Box sx={{ display: "flex", alignItems: "center", gap: 1.5 }}>
          <Box sx={{ width: 36, height: 36, background: C.black, borderRadius: "2px", display: "flex", alignItems: "center", justifyContent: "center" }}>
            <LocalPharmacyIcon sx={{ color: C.white, fontSize: 18 }} />
          </Box>
          <Box>
            <Typography sx={{ ...os({ fontSize: 14, color: C.ink }) }}>Medication Management</Typography>
            <Typography sx={{ ...os({ fontSize: 11, color: C.ash }) }}>
              {displayRows.length} prescription{displayRows.length !== 1 ? "s" : ""}
              {data.extraction_notes && ` · ${data.extraction_notes}`}
            </Typography>
          </Box>
        </Box>
        <Stack direction="row" spacing={1} flexWrap="wrap">
          <Btn icon={<SettingsIcon />} onClick={() => setSettingsOpen(true)}>Columns</Btn>
          <Btn icon={<AddIcon />} onClick={addMedication}>Add</Btn>
          <Btn icon={<VisibilityIcon />} onClick={() => setPreviewOpen(true)}>Preview</Btn>
          <Btn icon={<SaveIcon />} onClick={downloadPDF}>Download PDF</Btn>
          {isEditing ? (
            <>
              <Btn onClick={cancelEdit}>Cancel</Btn>
              <Btn variant="primary" icon={<SaveIcon />} onClick={handleSave}>Save</Btn>
            </>
          ) : (
            <Btn variant="primary" icon={<EditIcon />} onClick={() => setIsEditing(true)}>Edit All</Btn>
          )}
        </Stack>
      </Box>

      {/* ── No-medications banner ─────────────────────────────────────────
          Shown only when the backend gate explicitly reports that the
          dictation contained no medication (medications_found === false).
          This replaces the misleading "empty SafeRx / Evidence" panels
          that used to render placeholder text as if an analysis ran. ── */}
      {!medicationsFound && displayRows.length === 0 && (
        <Box sx={{ ...card, mb: 2.5, px: 2.5, py: 2, display: "flex", gap: 1.5, alignItems: "flex-start" }}>
          <InfoOutlinedIcon sx={{ fontSize: 16, color: C.ash, mt: 0.2, flexShrink: 0 }} />
          <Box>
            <Typography sx={{ ...os({ fontSize: 12, color: C.ink, mb: 0.25 }) }}>
              No medications were dictated in this note
            </Typography>
            <Typography sx={{ ...os({ fontSize: 12, color: C.ash, lineHeight: 1.5 }) }}>
              {overallAnalysis ||
                "No medication safety analysis was performed, since none was requested in this dictation. Prior medication history (if any) is used only to cross-check newly prescribed drugs and is not shown here as a new prescription."}
            </Typography>
          </Box>
        </Box>
      )}

      {/* ── Safety Alerts ──────────────────────────────────────────────── */}
      {alerts.length > 0 && (
        <Box sx={{ ...card, mb: 2.5, overflow: "hidden" }}>
          <Box sx={{ px: 2.5, py: 2, borderBottom: `1px solid ${C.fog}`, display: "flex", alignItems: "center", gap: 1 }}>
            <WarningIcon sx={{ fontSize: 16, color: C.smoke }} />
            <Typography sx={{ ...os({ fontSize: 13, color: C.ink }) }}>Safety Alerts</Typography>
            <Box sx={{ ml: "auto", background: C.ghost, border: `1px solid ${C.fog}`, borderRadius: "2px", px: 1.5, py: 0.3 }}>
              <Typography sx={{ ...os({ fontSize: 11, color: C.ash }) }}>{alerts.length} alert{alerts.length !== 1 ? "s" : ""}</Typography>
            </Box>
          </Box>
          <Box sx={{ p: 2.5, display: "grid", gridTemplateColumns: { xs: "1fr", md: "1fr 1fr" }, gap: 1.5 }}>
            {alerts.map((alert, index) => {
              const s = getSeverity(alert.severity);
              return (
                <Box key={index} sx={{ p: 2, borderRadius: "3px", background: s.bg, border: `1px solid ${s.border}`, borderLeft: `3px solid ${s.dot}` }}>
                  <Box sx={{ display: "flex", alignItems: "center", gap: 1, mb: 1 }}>
                    <Box sx={{ width: 6, height: 6, borderRadius: "50%", background: s.dot, flexShrink: 0 }} />
                    <Typography sx={{ ...os({ fontSize: 12, color: C.ink, fontWeight: 400 }) }}>
                      {alert.medication || (alert.alert_type ? alert.alert_type.replace(/_/g, " ") : "Alert")}
                    </Typography>
                    <Box sx={{ ml: "auto", background: `${s.dot}18`, border: `1px solid ${s.dot}40`, borderRadius: "2px", px: 1, py: 0.2 }}>
                      <Typography sx={{ ...os({ fontSize: 10, color: s.dot, letterSpacing: "0.06em" }) }}>{s.label.toUpperCase()}</Typography>
                    </Box>
                  </Box>
                  <Typography sx={{ ...os({ fontSize: 12, color: C.charcoal, lineHeight: 1.5, mb: 0.5 }) }}>{alert.alert}</Typography>
                  {alert.reason && <Typography sx={{ ...os({ fontSize: 11, color: C.ash, mb: 0.5 }) }}>{alert.reason}</Typography>}
                  {alert.recommendation && (
                    <Box sx={{ mt: 1, pt: 1, borderTop: `1px solid ${s.border}` }}>
                      <Typography sx={{ ...os({ fontSize: 10, color: C.silver, textTransform: "uppercase", letterSpacing: "0.06em", mb: 0.25 }) }}>Recommendation</Typography>
                      <Typography sx={{ ...os({ fontSize: 12, color: C.charcoal }) }}>{alert.recommendation}</Typography>
                    </Box>
                  )}
                </Box>
              );
            })}
          </Box>
        </Box>
      )}

      {/* ── Medications Table ───────────────────────────────────────────── */}
      <Box sx={{ ...card, mb: 2.5, overflow: "hidden" }}>
        <Box sx={{ px: 2.5, py: 2, borderBottom: `1px solid ${C.fog}`, display: "flex", alignItems: "center", justifyContent: "space-between", background: C.ghost }}>
          <Box sx={{ display: "flex", alignItems: "center", gap: 1.5 }}>
            <MedicationIcon sx={{ fontSize: 16, color: C.smoke }} />
            <Typography sx={{ ...os({ fontSize: 13, color: C.ink }) }}>Current Medications</Typography>
          </Box>
          <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
            <Box sx={{ width: 7, height: 7, borderRadius: "50%", background: isEditing ? "#b8860b" : C.charcoal }} />
            <Typography sx={{ ...os({ fontSize: 10, color: C.ash, letterSpacing: "0.06em" }) }}>
              {isEditing ? "EDITING" : "VIEW"}
            </Typography>
          </Box>
        </Box>

        {displayRows.length === 0 ? (
          <Box sx={{ py: 8, textAlign: "center" }}>
            <Box sx={{ width: 48, height: 48, background: C.ghost, border: `1px solid ${C.fog}`, borderRadius: "4px", display: "flex", alignItems: "center", justifyContent: "center", mx: "auto", mb: 2 }}>
              <MedicationIcon sx={{ fontSize: 22, color: C.silver }} />
            </Box>
            <Typography sx={{ ...os({ fontSize: 13, color: C.ash, mb: 0.5 }) }}>No medications extracted</Typography>
            <Typography sx={{ ...os({ fontSize: 11, color: C.silver }) }}>Click "Add" to start prescribing</Typography>
          </Box>
        ) : (
          <Box sx={{ overflowX: "auto" }}>
            <Table size="small" sx={{ minWidth: 700 }}>
              <TableHead>
                <TableRow sx={{ background: C.black, "& th": { borderBottom: "none", py: 1.5, px: 2 } }}>
                  {visibleColumns.map((col) => (
                    <TableCell key={col.key} sx={{ minWidth: 110 }}>
                      <Typography sx={{ ...os({ fontSize: 10, color: C.white, textTransform: "uppercase", letterSpacing: "0.08em", fontWeight: 400 }) }}>
                        {col.label}
                      </Typography>
                    </TableCell>
                  ))}
                  <TableCell sx={{ width: 90, textAlign: "center" }}>
                    <Typography sx={{ ...os({ fontSize: 10, color: C.white, textTransform: "uppercase", letterSpacing: "0.08em", fontWeight: 400 }) }}>
                      Actions
                    </Typography>
                  </TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {displayRows.map((row, index) => (
                  <React.Fragment key={index}>
                    <TableRow sx={{
                      background: index % 2 === 0 ? C.white : C.ghost,
                      "&:hover": { background: C.fog },
                      transition: "background 0.12s",
                      "& td": { borderBottom: `1px solid ${C.fog}`, py: 1.5, px: 2 },
                    }}>
                      {visibleColumns.map((col) => (
                        <TableCell key={col.key}>
                          {isEditing ? (
                            <TextField
                              size="small" variant="outlined"
                              value={getFieldValue(editableRows[index] || row, col.key)}
                              onChange={(e) => updateCell(index, col.key, e.target.value)}
                              placeholder={col.label} fullWidth
                              sx={{
                                "& .MuiOutlinedInput-root": {
                                  fontFamily: FONT, fontWeight: FW, fontSize: 12, background: C.white, borderRadius: "2px",
                                  "& fieldset": { borderColor: C.mist },
                                  "&:hover fieldset": { borderColor: C.smoke },
                                  "&.Mui-focused fieldset": { borderColor: C.charcoal, borderWidth: 1 },
                                },
                                "& .MuiOutlinedInput-input": { py: 0.75, fontSize: 12, fontFamily: FONT, fontWeight: FW },
                              }}
                            />
                          ) : (
                            <Typography sx={{ ...os({ fontSize: 12, color: col.key === "medication" ? C.ink : C.charcoal, fontWeight: col.key === "medication" ? 400 : FW }) }}>
                              {formatDisplayValue(col.key, getFieldValue(row, col.key))}
                            </Typography>
                          )}
                        </TableCell>
                      ))}
                      <TableCell>
                        <Stack direction="row" spacing={0.5} justifyContent="center">
                          {isEditing && (
                            <>
                              <Tooltip title="Expand details" arrow>
                                <IconButton size="small" onClick={() => setEditingRow(editingRow === index ? null : index)}
                                  sx={{ width: 28, height: 28, border: `1px solid ${editingRow === index ? C.charcoal : C.fog}`, borderRadius: "2px", background: editingRow === index ? C.black : "transparent", color: editingRow === index ? C.white : C.smoke, "&:hover": { background: C.black, color: C.white }, transition: "all 0.12s" }}>
                                  <EditIcon sx={{ fontSize: 13 }} />
                                </IconButton>
                              </Tooltip>
                              <Tooltip title="Remove" arrow>
                                <IconButton size="small" onClick={() => removeMedication(index)}
                                  sx={{ width: 28, height: 28, border: `1px solid ${C.fog}`, borderRadius: "2px", color: "#c0392b", "&:hover": { background: "#fff5f5", borderColor: "#f5c6c6" }, transition: "all 0.12s" }}>
                                  <DeleteIcon sx={{ fontSize: 13 }} />
                                </IconButton>
                              </Tooltip>
                            </>
                          )}
                          {/* Show alert indicator if medication has alerts */}
                          {!isEditing && row.has_safety_alert && (
                            <Tooltip title={`${row.max_alert_severity || "alert"}`} arrow>
                              <Box sx={{ width: 8, height: 8, borderRadius: "50%", background: getSeverity(row.max_alert_severity).dot, mt: 1 }} />
                            </Tooltip>
                          )}
                        </Stack>
                      </TableCell>
                    </TableRow>

                    {/* Expanded row */}
                    {isEditing && editingRow === index && (
                      <TableRow sx={{ "& td": { borderBottom: `1px solid ${C.fog}`, p: 0 } }}>
                        <TableCell colSpan={visibleColumns.length + 1}>
                          <Collapse in={editingRow === index}>
                            <Box sx={{ p: 2.5, background: C.ghost, borderTop: `1px solid ${C.fog}` }}>
                              <Typography sx={{ ...os({ fontSize: 11, color: C.ash, textTransform: "uppercase", letterSpacing: "0.08em", mb: 2 }) }}>
                                Additional Details
                              </Typography>
                              <Grid container spacing={2}>
                                {allAvailableColumns
                                  .filter((col) => !visibleColumns.some((vc) => vc.key === col.key))
                                  .map((col) => (
                                    <Grid item xs={12} sm={6} md={4} key={col.key}>
                                      <TextField
                                        label={col.label} size="small" fullWidth
                                        value={getFieldValue(editableRows[index] || {}, col.key)}
                                        onChange={(e) => updateCell(index, col.key, e.target.value)}
                                        multiline={col.key === "special_instructions" || col.key === "dosage_instructions"}
                                        rows={col.key === "special_instructions" || col.key === "dosage_instructions" ? 2 : 1}
                                        sx={{
                                          "& .MuiOutlinedInput-root": {
                                            fontFamily: FONT, fontWeight: FW, fontSize: 12, background: C.white, borderRadius: "2px",
                                            "& fieldset": { borderColor: C.mist },
                                            "&:hover fieldset": { borderColor: C.smoke },
                                            "&.Mui-focused fieldset": { borderColor: C.charcoal, borderWidth: 1 },
                                          },
                                          "& .MuiInputLabel-root": { fontFamily: FONT, fontWeight: FW, fontSize: 12, color: C.ash, "&.Mui-focused": { color: C.charcoal } },
                                          "& .MuiOutlinedInput-input": { fontSize: 12, fontFamily: FONT, fontWeight: FW },
                                        }}
                                      />
                                    </Grid>
                                  ))}
                              </Grid>
                            </Box>
                          </Collapse>
                        </TableCell>
                      </TableRow>
                    )}
                  </React.Fragment>
                ))}
              </TableBody>
            </Table>
          </Box>
        )}
      </Box>

      {/* ── Interaction Matrix ──────────────────────────────────────────── */}
      {interactionMatrix.length > 0 && (
        <Box sx={{ ...card, mb: 2.5, overflow: "hidden" }}>
          <Box sx={{ px: 2.5, py: 2, borderBottom: `1px solid ${C.fog}`, display: "flex", alignItems: "center", gap: 1, background: C.ghost }}>
            <WarningIcon sx={{ fontSize: 15, color: C.smoke }} />
            <Typography sx={{ ...os({ fontSize: 13, color: C.ink }) }}>Drug Interaction Matrix</Typography>
            <Box sx={{ ml: "auto", background: C.ghost, border: `1px solid ${C.fog}`, borderRadius: "2px", px: 1.5, py: 0.3 }}>
              <Typography sx={{ ...os({ fontSize: 11, color: C.ash }) }}>{interactionMatrix.length}</Typography>
            </Box>
          </Box>
          <Box sx={{ p: 2.5 }}>
            {interactionMatrix.map((row, i) => {
              const s = getSeverity(row.severity);
              return (
                <Box key={i} sx={{ py: 1.5, borderBottom: i < interactionMatrix.length - 1 ? `1px solid ${C.fog}` : "none", display: "flex", gap: 2, flexWrap: "wrap", alignItems: "flex-start" }}>
                  <Box sx={{ flex: 1 }}>
                    <Typography sx={{ ...os({ fontSize: 13, color: C.ink }) }}>{row.drug_a} ↔ {row.drug_b}</Typography>
                    {row.effect && <Typography sx={{ ...os({ fontSize: 12, color: C.smoke, mt: 0.25 }) }}>{row.effect}</Typography>}
                    {row.clinical_action && <Typography sx={{ ...os({ fontSize: 12, color: C.ash, mt: 0.25 }) }}>Action: {row.clinical_action}</Typography>}
                  </Box>
                  <Box sx={{ px: 1.5, py: 0.5, background: s.bg, border: `1px solid ${s.border}`, borderRadius: "2px" }}>
                    <Typography sx={{ ...os({ fontSize: 10, color: s.dot, letterSpacing: "0.06em" }) }}>{s.label.toUpperCase()}</Typography>
                  </Box>
                </Box>
              );
            })}
          </Box>
        </Box>
      )}

      {/* ── SafeRx Analysis ──────────────────────────────────────────────
          Only shown when the backend actually ran a safety analysis, i.e.
          medicationsFound is true. When no medication was dictated, the
          backend still fills safe_rx.principles / dose_personalization
          with explanatory placeholder text — rendering that here would
          look like a completed analysis instead of "nothing to analyze". */}
      {medicationsFound && (safeRx.principles || safeRx.issues_found?.length > 0 || doseP.renal_adjustment || doseP.hepatic_adjustment) && (
        <Box sx={{ ...card, mb: 2.5, overflow: "hidden" }}>
          <Box sx={{ px: 2.5, py: 2, borderBottom: `1px solid ${C.fog}`, display: "flex", alignItems: "center", gap: 1, background: C.ghost }}>
            <CheckCircleIcon sx={{ fontSize: 15, color: C.smoke }} />
            <Typography sx={{ ...os({ fontSize: 13, color: C.ink }) }}>SafeRx Analysis</Typography>
          </Box>
          <Box sx={{ p: 2.5 }}>
            {safeRx.principles && (
              <Box sx={{ mb: 2 }}>
                <Label>Principles Applied</Label>
                <Typography sx={{ ...os({ fontSize: 13, color: C.charcoal, lineHeight: 1.6 }) }}>{safeRx.principles}</Typography>
              </Box>
            )}

            {/* Dose personalisation pills */}
            {(doseP.renal_adjustment || doseP.hepatic_adjustment || doseP.weight_adjustment) && (
              <Box sx={{ mb: 2 }}>
                <Label>Dose Personalisation</Label>
                <Box sx={{ display: "flex", flexWrap: "wrap", gap: 1 }}>
                  {[
                    { key: "renal_adjustment", label: "Renal" },
                    { key: "hepatic_adjustment", label: "Hepatic" },
                    { key: "weight_adjustment", label: "Weight" },
                  ].map(({ key, label }) => {
                    const val = doseP[key];
                    if (!val) return null;
                    const isOk = isAdjustmentOk(val);
                    return (
                      <Box key={key} sx={{ px: 1.5, py: 0.5, borderRadius: "2px", border: `1px solid ${isOk ? "#b8e8c8" : "#f5dfa0"}`, background: isOk ? "#f5fff8" : "#fffbf0" }}>
                        <Typography sx={{ ...os({ fontSize: 11, color: isOk ? "#27ae60" : "#b8860b" }) }}>
                          {label}: {val}
                        </Typography>
                      </Box>
                    );
                  })}
                </Box>
              </Box>
            )}

            {/* Antibiotic stewardship */}
            {safeRx.antibiotics_analysis && safeRx.antibiotics_analysis !== "none" && (
              <Box sx={{ mb: 2 }}>
                <Label>Antibiotic Stewardship</Label>
                <Typography sx={{ ...os({ fontSize: 13, color: C.charcoal }) }}>{safeRx.antibiotics_analysis}</Typography>
              </Box>
            )}

            {/* Issues found */}
            {safeRx.issues_found?.length > 0 && (
              <Box>
                <Label>Issues Found</Label>
                <Stack spacing={1}>
                  {safeRx.issues_found.map((issue, idx) => (
                    <Box key={idx} sx={{ p: 1.5, borderRadius: "3px", background: "#fffbf0", border: `1px solid #f5dfa0`, borderLeft: "3px solid #b8860b" }}>
                      <Typography sx={{ ...os({ fontSize: 12, color: C.charcoal }) }}>{typeof issue === "string" ? issue : issue.issue}</Typography>
                    </Box>
                  ))}
                </Stack>
              </Box>
            )}
          </Box>
        </Box>
      )}

      {/* ── Evidence at Bedside ─────────────────────────────────────────
          Same reasoning as SafeRx above — only render when a real
          medication safety analysis actually ran. */}
      {medicationsFound && evidence.summary && (
        <Box sx={{ ...card, mb: 2.5, overflow: "hidden" }}>
          <Box sx={{ px: 2.5, py: 2, borderBottom: `1px solid ${C.fog}`, background: C.ghost }}>
            <Typography sx={{ ...os({ fontSize: 13, color: C.ink }) }}>Evidence at Bedside</Typography>
          </Box>
          <Box sx={{ p: 2.5 }}>
            <Typography sx={{ ...os({ fontSize: 13, color: C.charcoal, lineHeight: 1.7, mb: evidence.guidelines?.length > 0 ? 2 : 0 }) }}>
              {evidence.summary}
            </Typography>
            {evidence.guidelines?.length > 0 && (
              <>
                <Label>Clinical Guidelines</Label>
                {evidence.guidelines.map((g, i) => (
                  <Box key={i} sx={{ py: 1, borderBottom: `1px solid ${C.fog}` }}>
                    <Typography sx={{ ...os({ fontSize: 12, color: C.ink }) }}>{g.guideline}</Typography>
                    <Box sx={{ display: "flex", gap: 1, mt: 0.5 }}>
                      {g.medication && <Typography sx={{ ...os({ fontSize: 11, color: C.ash }) }}>{g.medication}</Typography>}
                      {g.source && <Typography sx={{ ...os({ fontSize: 11, color: C.silver }) }}>· {g.source}</Typography>}
                      {g.year && <Typography sx={{ ...os({ fontSize: 11, color: C.silver }) }}>· {g.year}</Typography>}
                    </Box>
                  </Box>
                ))}
              </>
            )}
          </Box>
        </Box>
      )}

      {/* ── Overall Analysis ────────────────────────────────────────────
          Kept visible even when no medications were dictated — the backend
          fills this with a clear explanatory sentence in that case (see the
          no-medications banner above too), so this is safe to always show. */}
      {overallAnalysis && (
        <Box sx={{ ...card, mb: 2.5 }}>
          <Box sx={{ px: 2.5, py: 2, borderBottom: `1px solid ${C.fog}`, background: C.ghost }}>
            <Typography sx={{ ...os({ fontSize: 13, color: C.ink }) }}>Overall Clinical Assessment</Typography>
          </Box>
          <Box sx={{ p: 2.5 }}>
            <Typography sx={{ ...os({ fontSize: 13, color: C.charcoal, lineHeight: 1.7 }) }}>{overallAnalysis}</Typography>
          </Box>
        </Box>
      )}

      {/* ── Data Limitations ────────────────────────────────────────────── */}
      {dataLimitations && (
        <Box sx={{ px: 2.5, py: 2, border: `1px solid ${C.fog}`, borderRadius: "3px", background: C.ghost, display: "flex", gap: 1.5, alignItems: "flex-start", mb: 2.5 }}>
          <InfoOutlinedIcon sx={{ fontSize: 15, color: C.ash, mt: 0.2, flexShrink: 0 }} />
          <Box>
            <Typography sx={{ ...os({ fontSize: 10, color: C.silver, textTransform: "uppercase", letterSpacing: "0.07em", mb: 0.25 }) }}>Data Limitations</Typography>
            <Typography sx={{ ...os({ fontSize: 12, color: C.smoke }) }}>{dataLimitations}</Typography>
          </Box>
        </Box>
      )}

      {/* ── Prescribing physician footer ─────────────────────────────────── */}
      {doctorInfo?.name && (
        <Box sx={{ px: 2.5, py: 2, border: `1px solid ${C.fog}`, borderRadius: "3px", background: C.ghost, display: "flex", gap: 1 }}>
          <Typography sx={{ ...os({ fontSize: 12, color: C.ash }) }}>Prescribing Physician:</Typography>
          <Typography sx={{ ...os({ fontSize: 12, color: C.ink, fontWeight: 400 }) }}>Dr. {doctorInfo.name}</Typography>
        </Box>
      )}

      {/* ── Hidden PDF ──────────────────────────────────────────────────── */}
      {displayRows.length > 0 && (
        <div style={{ position: "absolute", left: "-9999px" }}>
          <PrescriptionPDF
            ref={pdfRef}
            rows={displayRows}
            columns={visibleColumns}
            metadata={{ doctor_id: doctorId, patient_id: patientId }}
            doctorInfo={doctorInfo}
            patientInfo={patientInfo}
            diagnosisText={diagnosisText}
          />
        </div>
      )}

      {/* ── Column Settings Dialog ──────────────────────────────────────── */}
      <Dialog open={settingsOpen} onClose={() => setSettingsOpen(false)} maxWidth="sm" fullWidth
        PaperProps={{ sx: { borderRadius: "4px", boxShadow: "0 8px 24px rgba(0,0,0,0.1)", border: `1px solid ${C.fog}` } }}>
        <DialogTitle sx={{ px: 3, py: 2.5, borderBottom: `1px solid ${C.fog}`, background: C.ghost }}>
          <Box sx={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
              <SettingsIcon sx={{ fontSize: 16, color: C.smoke }} />
              <Typography sx={{ ...os({ fontSize: 14, color: C.ink }) }}>Customize Columns</Typography>
            </Box>
            <IconButton size="small" onClick={() => setSettingsOpen(false)}
              sx={{ width: 28, height: 28, border: `1px solid ${C.fog}`, borderRadius: "2px", color: C.ash, "&:hover": { background: C.fog } }}>
              <CloseIcon sx={{ fontSize: 14 }} />
            </IconButton>
          </Box>
        </DialogTitle>
        <DialogContent sx={{ p: 3 }}>
          <Typography sx={{ ...os({ fontSize: 12, color: C.ash, mb: 2 }) }}>Select which columns to display in the medication table.</Typography>
          <Grid container spacing={1.5}>
            {allAvailableColumns.map((column) => (
              <Grid item xs={6} sm={4} key={column.key}>
                <FormControlLabel
                  control={
                    <Checkbox checked={visibleColumns.some((c) => c.key === column.key)}
                      onChange={() => toggleColumnVisibility(column.key)} size="small"
                      sx={{ color: C.mist, "&.Mui-checked": { color: C.black }, p: 0.5 }} />
                  }
                  label={<Typography sx={{ ...os({ fontSize: 12, color: C.charcoal }) }}>{column.label}</Typography>}
                />
              </Grid>
            ))}
          </Grid>
        </DialogContent>
        <DialogActions sx={{ px: 3, py: 2, borderTop: `1px solid ${C.fog}`, gap: 1 }}>
          <Btn onClick={() => { setVisibleColumns(defaultVisibleColumns); setSettingsOpen(false); }}>Reset</Btn>
          <Btn onClick={() => setSettingsOpen(false)}>Cancel</Btn>
          <Btn variant="primary" onClick={() => setSettingsOpen(false)}>Apply</Btn>
        </DialogActions>
      </Dialog>

      {/* ── PDF Preview Dialog ───────────────────────────────────────────── */}
      <Dialog open={previewOpen} onClose={() => setPreviewOpen(false)} maxWidth="lg" fullWidth
        PaperProps={{ sx: { borderRadius: "4px", boxShadow: "0 8px 24px rgba(0,0,0,0.1)", border: `1px solid ${C.fog}` } }}>
        <DialogTitle sx={{ px: 3, py: 2.5, borderBottom: `1px solid ${C.fog}`, background: C.ghost }}>
          <Box sx={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <Typography sx={{ ...os({ fontSize: 14, color: C.ink }) }}>Prescription Preview</Typography>
            <IconButton size="small" onClick={() => setPreviewOpen(false)}
              sx={{ width: 28, height: 28, border: `1px solid ${C.fog}`, borderRadius: "2px", color: C.ash, "&:hover": { background: C.fog } }}>
              <CloseIcon sx={{ fontSize: 14 }} />
            </IconButton>
          </Box>
        </DialogTitle>
        <DialogContent dividers sx={{ bgcolor: C.ghost, p: 3 }}>
          <PrescriptionPDF
            rows={displayRows}
            columns={visibleColumns}
            metadata={{ doctor_id: doctorId, patient_id: patientId }}
            doctorInfo={doctorInfo}
            patientInfo={patientInfo}
            diagnosisText={diagnosisText}
          />
        </DialogContent>
        <DialogActions sx={{ px: 3, py: 2, borderTop: `1px solid ${C.fog}`, gap: 1 }}>
          <Btn onClick={() => setPreviewOpen(false)}>Close</Btn>
          <Btn variant="primary" icon={<SaveIcon />} onClick={downloadPDF}>Download PDF</Btn>
        </DialogActions>
      </Dialog>
    </Box>
  );
}

// ─── Prescription PDF ─────────────────────────────────────────────────────────
const PrescriptionPDF = React.forwardRef(
  ({ rows, columns, metadata, doctorInfo, patientInfo, diagnosisText }, ref) => {
    if (!rows?.length || !columns?.length) return null;

    const formattedDate = new Date().toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });
    const formattedDoctorName = doctorInfo?.name ? `Dr. ${doctorInfo.name.toUpperCase()}` : "DR. __________________";
    const formattedSpecialization = doctorInfo?.specialization ? doctorInfo.specialization.toUpperCase() : "________________";

    const formatDisplayValue = (key, value) => {
      if (!value) return "—";
      if (Array.isArray(value)) value = value.join(", ");
      value = String(value);
      if (key === "medication" || key === "brand_name") return value.toUpperCase();
      return value.toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());
    };

    return (
      <div ref={ref} style={{ width: "100%", display: "flex", justifyContent: "center", backgroundColor: "#ffffff" }}>
        <div style={{ width: "100%", maxWidth: "792px", padding: "40px 50px", fontFamily: "'Open Sans', 'Segoe UI', Arial, sans-serif", fontWeight: 300, color: "#0a0a0a", border: "1px solid #e8e8e8", borderRadius: "4px", margin: "20px" }}>
          {/* Header */}
          <div style={{ textAlign: "center", marginBottom: "28px", paddingBottom: "20px", borderBottom: "2px solid #0a0a0a" }}>
            <div style={{ fontSize: "9px", fontWeight: 600, letterSpacing: "0.16em", color: "#7a7a7a", marginBottom: "6px", textTransform: "uppercase" }}>Clinical Prescription</div>
            <div style={{ fontSize: "22px", fontWeight: 600, letterSpacing: "0.04em", color: "#0a0a0a" }}>
              {(doctorInfo?.hospital_name || "Hospital Name").toUpperCase()}
            </div>
          </div>

          {/* Patient + Doctor grid */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "32px", marginBottom: "24px" }}>
            <div>
              <div style={{ fontSize: "10px", fontWeight: 600, letterSpacing: "0.1em", color: "#7a7a7a", textTransform: "uppercase", marginBottom: "10px", borderBottom: "1px solid #e8e8e8", paddingBottom: "6px" }}>Patient Information</div>
              {[
                ["Patient Name", patientInfo?.patient_name || "________________"],
                ["Patient ID", patientInfo?.hms_id || metadata?.patient_id || "________"],
                ["Age / Sex", `${patientInfo?.age || "__"} / ${patientInfo?.gender || "___"}`],
                ["Date", formattedDate],
              ].map(([label, value]) => (
                <div key={label} style={{ display: "flex", gap: "8px", marginBottom: "5px", fontSize: "12px" }}>
                  <span style={{ color: "#7a7a7a", minWidth: "90px" }}>{label}:</span>
                  <span style={{ color: "#1a1a1a" }}>{value}</span>
                </div>
              ))}
            </div>
            <div>
              <div style={{ fontSize: "10px", fontWeight: 600, letterSpacing: "0.1em", color: "#7a7a7a", textTransform: "uppercase", marginBottom: "10px", borderBottom: "1px solid #e8e8e8", paddingBottom: "6px" }}>Prescribing Physician</div>
              {[["Name", formattedDoctorName], ["Specialization", formattedSpecialization]].map(([label, value]) => (
                <div key={label} style={{ display: "flex", gap: "8px", marginBottom: "5px", fontSize: "12px" }}>
                  <span style={{ color: "#7a7a7a", minWidth: "90px" }}>{label}:</span>
                  <span style={{ color: "#1a1a1a", fontWeight: 400 }}>{value}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Diagnosis */}
          {diagnosisText && (
            <div style={{ marginBottom: "24px" }}>
              <div style={{ fontSize: "10px", fontWeight: 600, letterSpacing: "0.1em", color: "#7a7a7a", textTransform: "uppercase", marginBottom: "10px", borderBottom: "1px solid #e8e8e8", paddingBottom: "6px" }}>Clinical Diagnosis</div>
              <div style={{ border: "1px solid #e8e8e8", borderRadius: "3px", padding: "10px 14px", fontSize: "12px", lineHeight: 1.6, background: "#f2f2f2", color: "#1a1a1a" }}>{diagnosisText}</div>
            </div>
          )}

          {/* Medications table */}
          <div>
            <div style={{ fontSize: "10px", fontWeight: 600, letterSpacing: "0.1em", color: "#7a7a7a", textTransform: "uppercase", marginBottom: "10px", borderBottom: "1px solid #e8e8e8", paddingBottom: "6px" }}>Prescribed Medications</div>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "11px" }}>
              <thead>
                <tr style={{ background: "#0a0a0a" }}>
                  {columns.map((col) => (
                    <th key={col.key} style={{ padding: "8px 10px", textAlign: "left", color: "#ffffff", fontWeight: 400, fontSize: "10px", letterSpacing: "0.06em", textTransform: "uppercase" }}>
                      {col.label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((row, index) => (
                  <tr key={index} style={{ background: index % 2 === 0 ? "#ffffff" : "#f2f2f2" }}>
                    {columns.map((col) => (
                      <td key={col.key} style={{ padding: "7px 10px", borderBottom: "1px solid #e8e8e8", color: "#1a1a1a", fontSize: "11px" }}>
                        {formatDisplayValue(col.key, getFieldValue(row, col.key))}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Signature */}
          <div style={{ marginTop: "40px", paddingTop: "20px", borderTop: "1px solid #e8e8e8", display: "grid", gridTemplateColumns: "1fr 1fr", gap: "40px" }}>
            <div>
              <div style={{ height: "40px", borderBottom: "1px solid #0a0a0a", marginBottom: "8px" }} />
              <div style={{ fontSize: "12px", color: "#1a1a1a", fontWeight: 400 }}>{formattedDoctorName}</div>
              <div style={{ fontSize: "11px", color: "#7a7a7a" }}>{formattedSpecialization}</div>
            </div>
            <div>
              <div style={{ height: "40px", border: "1px dashed #d4d4d4", borderRadius: "3px", marginBottom: "8px", display: "flex", alignItems: "center", justifyContent: "center" }}>
                <span style={{ fontSize: "10px", color: "#a8a8a8", letterSpacing: "0.06em" }}>HOSPITAL STAMP</span>
              </div>
              <div style={{ fontSize: "11px", color: "#7a7a7a", textAlign: "center" }}>Valid for 30 days from date of issue</div>
            </div>
          </div>
        </div>
      </div>
    );
  }
);