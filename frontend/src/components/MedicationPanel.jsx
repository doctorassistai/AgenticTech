import React, { useState, useEffect } from "react";
import {
  Box,
  Typography,
  Stack,
  TextField,
  IconButton,
  Grid,
  Paper,
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
import VisibilityOffIcon from "@mui/icons-material/VisibilityOff";
import CloseIcon from "@mui/icons-material/Close";

// ─── Design Tokens ────────────────────────────────────────────────────────────
const FONT = '"Open Sans", sans-serif';
const FW = 300;

import { THEMES } from "../dashboard/themes";

const themeName = localStorage.getItem("theme") || "PurpleWhite";
const theme = THEMES[themeName] || THEMES.PurpleWhite;
const C = {
  // Text
  black: theme.text,
  ink: theme.text,
  charcoal: theme.textSec,
  smoke: theme.textSec,
  ash: theme.textMuted,
  silver: theme.textMuted,

  // Borders
  mist: theme.border,

  // Backgrounds
  fog: theme.bgTert,
  ghost: theme.bgAlt,
  white: theme.bg,
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

const dangerBtn = {
  ...btnBase,
  background: "transparent",
  color: "#c0392b",
  padding: "6px 14px",
  border: `1px solid #f0c0bb`,
  "&:hover": { background: "#fff5f5", borderColor: "#c0392b" },
};

// Dropdown options
const frequencyOptions = ["Once daily", "Twice daily", "Three times daily", "Four times daily", "Every 6 hours", "Every 8 hours", "Every 12 hours", "Every morning", "Every evening", "As needed", "daily", "twice daily"];
const durationOptions = ["7 days", "10 days", "14 days", "21 days", "28 days", "30 days", "60 days", "90 days", "Ongoing", "Until finished", "short-term", "long-term"];
const routeOptions = ["Oral", "Sublingual", "Topical", "Inhalation", "Injection", "Intravenous", "Intramuscular", "Subcutaneous", "Rectal", "Transdermal", "oral", "intravenous"];
const dosageFormOptions = ["Tablet", "Capsule", "Liquid", "Cream", "Ointment", "Inhaler", "Injection", "Patch", "Suppository", "Drops", "tablet", "intravenous"];
const categoryOptions = ["Analgesic", "Antiplatelet", "Statin", "Beta blocker", "Diuretic", "Antibiotic", "Antihypertensive", "Antidiabetic", "Anticoagulant", "NSAID", "analgesic", "antiplatelet", "statin", "beta blocker", "diuretic"];

const defaultVisibleColumns = [
  { key: "medication", label: "Medication", editable: true },
  { key: "brand_name", label: "Brand", editable: true },
  { key: "generic_name", label: "Generic", editable: true },
  { key: "category", label: "Category", editable: true },
  { key: "strength", label: "Strength", editable: true },
  { key: "dosage_form", label: "Form", editable: true },
  { key: "route", label: "Route", editable: true },
  { key: "dosage_instructions", label: "Instructions", editable: true },
];

const allAvailableColumns = [
  { key: "medication", label: "Medication", editable: true },
  { key: "brand_name", label: "Brand Name", editable: true },
  { key: "generic_name", label: "Generic Name", editable: true },
  { key: "category", label: "Category", editable: true },
  { key: "strength", label: "Strength", editable: true },
  { key: "dosage_form", label: "Dosage Form", editable: true },
  { key: "route", label: "Route", editable: true },
  { key: "follow_up", label: "Follow-up", editable: true },
  { key: "standard_frequency_options", label: "Frequency Options", editable: true },
  { key: "standard_duration_options", label: "Duration Options", editable: true },
  { key: "special_instructions", label: "Special Instructions", editable: true },
  { key: "dosage_instructions", label: "Dosage Instructions", editable: true },
  { key: "quantity", label: "Quantity", editable: true },
  { key: "refills", label: "Refills", editable: true },
];

// ─── Tiny reusable button ─────────────────────────────────────────────────────
const Btn = ({ children, onClick, variant = "ghost", disabled, icon, sx = {} }) => {
  const style = variant === "primary" ? primaryBtn : variant === "danger" ? dangerBtn : ghostBtn;
  return (
    <Box component="button" onClick={onClick} disabled={disabled}
      sx={{ ...style, ...sx }}>
      {icon && <Box sx={{ display: "flex", alignItems: "center", "& svg": { fontSize: 15 } }}>{icon}</Box>}
      {children}
    </Box>
  );
};

// ─── Section label ────────────────────────────────────────────────────────────
const Label = ({ children }) => (
  <Typography sx={{ ...os({ fontSize: 10, color: C.silver, textTransform: "uppercase", letterSpacing: "0.09em", mb: 1 }) }}>
    {children}
  </Typography>
);

export default function MedicationPanel({ data, metadata, onSave, diagnosisText }) {
const API_BASE_URL = import.meta.env.VITE_BACKEND_URL || "https://doctorassist.ai/api/";
  const searchParams = new URLSearchParams(window.location.search);
  const doctorIdFromURL = searchParams.get("doctor_id");
  const patientIdFromURL = searchParams.get("patient_id");
  const doctor_id = metadata?.doctor_id || doctorIdFromURL;
  const patient_id = metadata?.patient_id || patientIdFromURL;

  if (!data) return null;

  const { prescriptions = [], safety_alerts = [], safe_rx, evidence_at_bedside, overall_analysis } = data;

  const normalizedIssues = safe_rx?.issues_found?.map(issue =>
    typeof issue === "string" ? { medication: "Medication", issue } : { medication: issue.medication || "Medication", issue: issue.issue || "" }
  ) || [];

  const formattedAlerts = (safety_alerts || []).map(alert => {
    let severity = alert.severity || "moderate";
    if (severity === "high") severity = "danger";
    if (severity === "low") severity = "safe";
    return {
      medication: alert.medication || "Medication Alert",
      severity,
      alert: alert.alert || alert.description || alert.issue || alert.interaction || alert.contraindication || "",
      reason: alert.reason || alert.category || alert.type || "",
      references: alert.references || [],
    };
  });

  const formatDisplayValue = (key, value) => {
    if (!value) return "—";
    if (Array.isArray(value)) value = value.join(", ");
    value = String(value);
    if (key === "medication" || key === "brand_name") return value.toUpperCase();
    return value.toLowerCase().replace(/\b\w/g, char => char.toUpperCase());
  };

  const [editableRows, setEditableRows] = useState([]);
  const [savedRows, setSavedRows] = useState([]);
  const [editingRow, setEditingRow] = useState(null);
  const [isEditing, setIsEditing] = useState(false);
  const [visibleColumns, setVisibleColumns] = useState(defaultVisibleColumns);
  const pdfRef = React.useRef();
  const [previewOpen, setPreviewOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [doctorInfo, setDoctorInfo] = useState(null);
  const [patientInfo, setPatientInfo] = useState(null);

  useEffect(() => {
    const fetchDoctorInfo = async () => {
      try {
        const response = await fetch(`${API_BASE_URL}hms/users/data/context/get-doctor-info?sys_user_id=${doctor_id}`);
        const d = await response.json();
        setDoctorInfo(d);
      } catch (error) { console.error("Error fetching doctor info:", error); }
    };
    if (doctor_id) fetchDoctorInfo();
  }, [doctor_id]);

  useEffect(() => {
    const fetchPatientInfo = async () => {
      try {
        const response = await fetch(`${API_BASE_URL}hms/users/data/context/get-patient-info?patient_id=${patient_id}`);
        const result = await response.json();
        setPatientInfo({ patient_name: result.patient_name || "", age: result.age || "", gender: result.gender || "", hms_id: result.hms_id || "" });
      } catch (error) { console.error("Error fetching patient info:", error); }
    };
    if (patient_id) fetchPatientInfo();
  }, [patient_id]);

  useEffect(() => {
    setEditableRows(prescriptions.map(pres => ({
      ...pres,
      standard_frequency_options: Array.isArray(pres.standard_frequency_options) ? pres.standard_frequency_options.join(", ") : pres.standard_frequency_options || "",
      standard_duration_options: Array.isArray(pres.standard_duration_options) ? pres.standard_duration_options.join(", ") : pres.standard_duration_options || "",
    })));
    setSavedRows(prescriptions);
  }, [data]);

  const updateCell = (index, key, value) => {
    const updated = [...editableRows];
    updated[index][key] = value;
    setEditableRows(updated);
  };

  const downloadPDF = () => {
    setTimeout(() => {
      if (!pdfRef.current) return;
      const isLandscape = visibleColumns.length > 6;
      html2pdf().set({
        margin: 8,
        filename: `Prescription_${metadata?.patient_id}.pdf`,
        image: { type: "jpeg", quality: 0.98 },
        html2canvas: { scale: 2 },
        jsPDF: { unit: "mm", format: "a4", orientation: isLandscape ? "landscape" : "portrait" },
      }).from(pdfRef.current).save();
    }, 0);
  };

  const addMedication = () => {
    const newRow = { medication: "", brand_name: "", generic_name: "", category: "", strength: "", dosage_form: "", route: "", follow_up: "", standard_frequency_options: "", standard_duration_options: "", special_instructions: "", dosage_instructions: "", quantity: "", refills: "" };
    setEditableRows([...editableRows, newRow]);
    setEditingRow(editableRows.length);
    setIsEditing(true);
  };

  const removeMedication = (index) => {
    setEditableRows(editableRows.filter((_, i) => i !== index));
    if (editingRow === index) setEditingRow(null);
  };

  const handleSave = () => {
    const formattedRows = editableRows.map(row => ({
      ...row,
      standard_frequency_options: row.standard_frequency_options ? row.standard_frequency_options.split(",").map(s => s.trim()).filter(s => s) : [],
      standard_duration_options: row.standard_duration_options ? row.standard_duration_options.split(",").map(s => s.trim()).filter(s => s) : [],
    }));
    setSavedRows(formattedRows);
    setIsEditing(false);
    setEditingRow(null);
    onSave?.({ prescriptions: formattedRows });
  };

  const toggleEditRow = (index) => {
    setEditingRow(editingRow === index ? null : index);
    setIsEditing(true);
  };

  const cancelEdit = () => {
    setEditableRows(savedRows.map(pres => ({
      ...pres,
      standard_frequency_options: Array.isArray(pres.standard_frequency_options) ? pres.standard_frequency_options.join(", ") : pres.standard_frequency_options || "",
      standard_duration_options: Array.isArray(pres.standard_duration_options) ? pres.standard_duration_options.join(", ") : pres.standard_duration_options || "",
    })));
    setIsEditing(false);
    setEditingRow(null);
  };

  const toggleColumnVisibility = (columnKey) => {
    if (visibleColumns.some(col => col.key === columnKey)) {
      setVisibleColumns(visibleColumns.filter(col => col.key !== columnKey));
    } else {
      const columnToAdd = allAvailableColumns.find(col => col.key === columnKey);
      if (columnToAdd) setVisibleColumns([...visibleColumns, columnToAdd]);
    }
  };

  const getFieldValue = (row, key) => {
    if (key === "standard_frequency_options" || key === "standard_duration_options") {
      return Array.isArray(row[key]) ? row[key].join(", ") : row[key] || "";
    }
    return row[key] || "";
  };

  const displayRows = isEditing ? editableRows : savedRows;

  const severityStyle = {
    danger: { bg: "#fff5f5", border: "#f5c6c6", dot: "#c0392b", label: "Danger" },
    moderate: { bg: "#fffbf0", border: "#f5dfa0", dot: "#b8860b", label: "Moderate" },
    safe: { bg: "#f5fff8", border: "#b8e8c8", dot: "#27ae60", label: "Safe" },
  };

  return (
    <Box sx={{ fontFamily: FONT, fontWeight: FW }}>
      <link href="https://fonts.googleapis.com/css2?family=Open+Sans:wght@300;400;600&display=swap" rel="stylesheet" />

      {/* ─── Top bar ───────────────────────────────────────────────────────── */}
      <Box sx={{ ...card, p: 2.5, mb: 2.5, display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 1.5 }}>
        <Box sx={{ display: "flex", alignItems: "center", gap: 1.5 }}>
          <Box sx={{ width: 36, height: 36, background: C.black, borderRadius: "2px", display: "flex", alignItems: "center", justifyContent: "center" }}>
            <LocalPharmacyIcon sx={{ color: C.white, fontSize: 18 }} />
          </Box>
          <Box>
            <Typography sx={{ ...os({ fontSize: 14, color: C.ink }) }}>Medication Management</Typography>
            <Typography sx={{ ...os({ fontSize: 11, color: C.ash }) }}>{displayRows.length} prescription{displayRows.length !== 1 ? "s" : ""}</Typography>
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

      {/* ─── Safety Alerts ─────────────────────────────────────────────────── */}
      {formattedAlerts.length > 0 && (
        <Box sx={{ ...card, mb: 2.5, overflow: "hidden" }}>
          <Box sx={{ px: 2.5, py: 2, borderBottom: `1px solid ${C.fog}`, display: "flex", alignItems: "center", gap: 1 }}>
            <WarningIcon sx={{ fontSize: 16, color: C.smoke }} />
            <Typography sx={{ ...os({ fontSize: 13, color: C.ink }) }}>Safety Alerts</Typography>
            <Box sx={{ ml: "auto", background: C.ghost, border: `1px solid ${C.fog}`, borderRadius: "2px", px: 1.5, py: 0.3 }}>
              <Typography sx={{ ...os({ fontSize: 11, color: C.ash }) }}>{formattedAlerts.length} alert{formattedAlerts.length !== 1 ? "s" : ""}</Typography>
            </Box>
          </Box>
          <Box sx={{ p: 2.5, display: "grid", gridTemplateColumns: { xs: "1fr", md: "1fr 1fr" }, gap: 1.5 }}>
            {formattedAlerts.map((alert, index) => {
              const s = severityStyle[alert.severity] || severityStyle.moderate;
              return (
                <Box key={index} sx={{ p: 2, borderRadius: "3px", background: s.bg, border: `1px solid ${s.border}`, borderLeft: `3px solid ${s.dot}` }}>
                  <Box sx={{ display: "flex", alignItems: "center", gap: 1, mb: 1 }}>
                    <Box sx={{ width: 6, height: 6, borderRadius: "50%", background: s.dot, flexShrink: 0 }} />
                    <Typography sx={{ ...os({ fontSize: 12, color: C.ink, fontWeight: 400 }) }}>{alert.medication}</Typography>
                    <Box sx={{ ml: "auto", background: `${s.dot}18`, border: `1px solid ${s.dot}40`, borderRadius: "2px", px: 1, py: 0.2 }}>
                      <Typography sx={{ ...os({ fontSize: 10, color: s.dot, letterSpacing: "0.06em" }) }}>{s.label.toUpperCase()}</Typography>
                    </Box>
                  </Box>
                  <Typography sx={{ ...os({ fontSize: 12, color: C.charcoal, lineHeight: 1.5, mb: 0.5 }) }}>{alert.alert}</Typography>
                  {alert.reason && <Typography sx={{ ...os({ fontSize: 11, color: C.ash }) }}>{alert.reason}</Typography>}
                  {alert.references?.length > 0 && (
                    <Typography sx={{ ...os({ fontSize: 10, color: C.silver, mt: 0.5 }) }}>Ref: {alert.references.join(", ")}</Typography>
                  )}
                </Box>
              );
            })}
          </Box>
        </Box>
      )}

      {/* ─── Medications Table ─────────────────────────────────────────────── */}
      <Box sx={{ ...card, mb: 2.5, overflow: "hidden" }}>
        {/* Table header */}
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
            <Typography sx={{ ...os({ fontSize: 13, color: C.ash, mb: 0.5 }) }}>No medications added</Typography>
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
                    <TableRow
                      sx={{
                        background: isEditing ? (index % 2 === 0 ? C.white : "#fafafa") : (index % 2 === 0 ? C.white : C.ghost),
                        "&:hover": { background: C.ghost },
                        transition: "background 0.12s",
                        "& td": { borderBottom: `1px solid ${C.fog}`, py: 1.5, px: 2 },
                      }}
                    >
                      {visibleColumns.map((col) => (
                        <TableCell key={col.key}>
                          {isEditing && col.editable ? (
                            <TextField
                              size="small"
                              variant="outlined"
                              value={getFieldValue(row, col.key)}
                              onChange={(e) => updateCell(index, col.key, e.target.value)}
                              placeholder={col.label}
                              fullWidth
                              sx={{
                                "& .MuiOutlinedInput-root": {
                                  fontFamily: FONT, fontWeight: FW, fontSize: 12,
                                  background: C.white, borderRadius: "2px",
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
                                <IconButton size="small" onClick={() => toggleEditRow(index)}
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
                        </Stack>
                      </TableCell>
                    </TableRow>

                    {/* Expanded details row */}
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
                                  .filter(col => !visibleColumns.some(vc => vc.key === col.key))
                                  .map((col) => (
                                    <Grid item xs={12} sm={6} md={4} key={col.key}>
                                      <TextField
                                        label={col.label}
                                        size="small"
                                        fullWidth
                                        value={getFieldValue(row, col.key)}
                                        onChange={(e) => updateCell(index, col.key, e.target.value)}
                                        select={col.key === "category" || col.key === "route" || col.key === "dosage_form"}
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
                                      >
                                        {col.key === "category" && categoryOptions.map(opt => <MenuItem key={opt} value={opt} sx={{ fontFamily: FONT, fontWeight: FW, fontSize: 12 }}>{opt}</MenuItem>)}
                                        {col.key === "route" && routeOptions.map(opt => <MenuItem key={opt} value={opt} sx={{ fontFamily: FONT, fontWeight: FW, fontSize: 12 }}>{opt}</MenuItem>)}
                                        {col.key === "dosage_form" && dosageFormOptions.map(opt => <MenuItem key={opt} value={opt} sx={{ fontFamily: FONT, fontWeight: FW, fontSize: 12 }}>{opt}</MenuItem>)}
                                      </TextField>
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

      {/* ─── SafeRx Analysis ───────────────────────────────────────────────── */}
      {safe_rx && (
        <Box sx={{ ...card, mb: 2.5, overflow: "hidden" }}>
          <Box sx={{ px: 2.5, py: 2, borderBottom: `1px solid ${C.fog}`, display: "flex", alignItems: "center", gap: 1, background: C.ghost }}>
            <CheckCircleIcon sx={{ fontSize: 15, color: C.smoke }} />
            <Typography sx={{ ...os({ fontSize: 13, color: C.ink }) }}>SafeRx Analysis</Typography>
          </Box>
          <Box sx={{ p: 2.5 }}>
            {safe_rx.principles && (
              <Box sx={{ mb: 2 }}>
                <Label>Principles Applied</Label>
                <Typography sx={{ ...os({ fontSize: 13, color: C.charcoal, lineHeight: 1.6 }) }}>{safe_rx.principles}</Typography>
              </Box>
            )}
            {safe_rx.dose_personalization && (
              <Box sx={{ mb: 2 }}>
                <Label>Dose Personalization</Label>
                <Box sx={{ display: "flex", flexWrap: "wrap", gap: 1 }}>
                  {Object.entries(safe_rx.dose_personalization).map(([key, value]) => {
                    if (key === "references") return null;
                    const displayValue = typeof value === "object" ? JSON.stringify(value, null, 2) : value;
                    const isOk = displayValue === "no adjustment required";
                    return (
                      <Box key={key} sx={{ px: 1.5, py: 0.5, borderRadius: "2px", border: `1px solid ${isOk ? "#b8e8c8" : "#f5dfa0"}`, background: isOk ? "#f5fff8" : "#fffbf0" }}>
                        <Typography sx={{ ...os({ fontSize: 11, color: isOk ? "#27ae60" : "#b8860b" }) }}>
                          {key.replace(/_/g, " ")}: {displayValue}
                        </Typography>
                      </Box>
                    );
                  })}
                </Box>
              </Box>
            )}
            {safe_rx.antibiotics_analysis && typeof safe_rx.antibiotics_analysis === "object" && (
              <Box sx={{ mb: 2 }}>
                <Label>Antibiotics Analysis</Label>
                {Object.entries(safe_rx.antibiotics_analysis).filter(([k]) => k !== "references").map(([key, value]) => (
                  <Typography key={key} sx={{ ...os({ fontSize: 12, color: C.charcoal, mb: 0.5 }) }}>
                    <Box component="span" sx={{ color: C.smoke, mr: 0.5 }}>{key.replace(/_/g, " ")}:</Box> {value}
                  </Typography>
                ))}
              </Box>
            )}
            {normalizedIssues.length > 0 && (
              <Box>
                <Label>Issues Found</Label>
                <Stack spacing={1}>
                  {normalizedIssues.map((issue, idx) => (
                    <Box key={idx} sx={{ p: 1.5, borderRadius: "3px", background: "#fffbf0", border: `1px solid #f5dfa0`, borderLeft: "3px solid #b8860b" }}>
                      <Typography sx={{ ...os({ fontSize: 12, color: C.charcoal }) }}>
                        <Box component="span" sx={{ fontWeight: 400, color: C.ink, mr: 0.5 }}>{issue.medication}:</Box>
                        {issue.issue}
                      </Typography>
                    </Box>
                  ))}
                </Stack>
              </Box>
            )}
          </Box>
        </Box>
      )}

      {/* ─── Overall Analysis ──────────────────────────────────────────────── */}
      {overall_analysis && (
        <Box sx={{ ...card, mb: 2.5 }}>
          <Box sx={{ px: 2.5, py: 2, borderBottom: `1px solid ${C.fog}`, background: C.ghost }}>
            <Typography sx={{ ...os({ fontSize: 13, color: C.ink }) }}>Overall Clinical Assessment</Typography>
          </Box>
          <Box sx={{ p: 2.5 }}>
            <Typography sx={{ ...os({ fontSize: 13, color: C.charcoal, lineHeight: 1.7 }) }}>{overall_analysis}</Typography>
          </Box>
        </Box>
      )}

      {/* ─── Prescribing physician footer ──────────────────────────────────── */}
      {metadata && doctorInfo?.name && (
        <Box sx={{ px: 2.5, py: 2, border: `1px solid ${C.fog}`, borderRadius: "3px", background: C.ghost, display: "flex", gap: 1 }}>
          <Typography sx={{ ...os({ fontSize: 12, color: C.ash }) }}>Prescribing Physician:</Typography>
          <Typography sx={{ ...os({ fontSize: 12, color: C.ink, fontWeight: 400 }) }}>Dr. {doctorInfo.name}</Typography>
        </Box>
      )}

      {/* ─── Hidden PDF ref ────────────────────────────────────────────────── */}
      <div style={{ position: "absolute", left: "-9999px" }}>
        <PrescriptionPDF
          ref={pdfRef}
          rows={displayRows}
          columns={visibleColumns}
          metadata={metadata}
          doctorInfo={doctorInfo}
          patientInfo={patientInfo}
          safeRx={safe_rx}
          evidence={evidence_at_bedside}
          overallAnalysis={overall_analysis}
          safetyAlerts={safety_alerts}
          diagnosisText={diagnosisText}
        />
      </div>

      {/* ─── Column Settings Dialog ────────────────────────────────────────── */}
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
                    <Checkbox
                      checked={visibleColumns.some(col => col.key === column.key)}
                      onChange={() => toggleColumnVisibility(column.key)}
                      size="small"
                      sx={{ color: C.mist, "&.Mui-checked": { color: C.black }, p: 0.5 }}
                    />
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

      {/* ─── PDF Preview Dialog ────────────────────────────────────────────── */}
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
            metadata={metadata}
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

    const pdfColumns = columns.map(col => ({ key: col.key, label: col.label }));
    const formattedDate = new Date().toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });

    const formattedDoctorName = doctorInfo?.name ? `Dr. ${doctorInfo.name.toUpperCase()}` : "DR. __________________";
    const formattedSpecialization = doctorInfo?.specialization ? doctorInfo.specialization.toUpperCase() : "________________";

    const formatDisplayValue = (key, value) => {
      if (!value) return "—";
      if (Array.isArray(value)) value = value.join(", ");
      value = String(value);
      if (key === "medication" || key === "brand_name") return value.toUpperCase();
      return value.toLowerCase().replace(/\b\w/g, char => char.toUpperCase());
    };

    return (
      <div ref={ref} style={{ width: "100%", display: "flex", justifyContent: "center", backgroundColor: "#ffffff" }}>
        <div style={{
          width: "100%", maxWidth: "792px", padding: "40px 50px",
          fontFamily: "'Open Sans', 'Segoe UI', Arial, sans-serif", fontWeight: 300,
          color: "#0a0a0a", border: "1px solid #e8e8e8", borderRadius: "4px", margin: "20px",
        }}>
          {/* Header */}
          <div style={{ textAlign: "center", marginBottom: "28px", paddingBottom: "20px", borderBottom: "2px solid #0a0a0a" }}>
            <div style={{ fontSize: "9px", fontWeight: 600, letterSpacing: "0.16em", color: "#7a7a7a", marginBottom: "6px", textTransform: "uppercase" }}>
              Clinical Prescription
            </div>
            <div style={{ fontSize: "22px", fontWeight: 600, letterSpacing: "0.04em", color: "#0a0a0a" }}>
              {(doctorInfo?.hospital_name || "Hospital Name").toUpperCase()}
            </div>
          </div>

          {/* Patient + Doctor grid */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "32px", marginBottom: "24px" }}>
            <div>
              <div style={{ fontSize: "10px", fontWeight: 600, letterSpacing: "0.1em", color: "#7a7a7a", textTransform: "uppercase", marginBottom: "10px", borderBottom: "1px solid #e8e8e8", paddingBottom: "6px" }}>
                Patient Information
              </div>
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
              <div style={{ fontSize: "10px", fontWeight: 600, letterSpacing: "0.1em", color: "#7a7a7a", textTransform: "uppercase", marginBottom: "10px", borderBottom: "1px solid #e8e8e8", paddingBottom: "6px" }}>
                Prescribing Physician
              </div>
              {[
                ["Name", formattedDoctorName],
                ["Specialization", formattedSpecialization],
              ].map(([label, value]) => (
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
              <div style={{ fontSize: "10px", fontWeight: 600, letterSpacing: "0.1em", color: "#7a7a7a", textTransform: "uppercase", marginBottom: "10px", borderBottom: "1px solid #e8e8e8", paddingBottom: "6px" }}>
                Clinical Diagnosis
              </div>
              <div style={{ border: "1px solid #e8e8e8", borderRadius: "3px", padding: "10px 14px", fontSize: "12px", lineHeight: 1.6, background: "#f2f2f2", color: "#1a1a1a" }}>
                {diagnosisText}
              </div>
            </div>
          )}

          {/* Medications table */}
          <div>
            <div style={{ fontSize: "10px", fontWeight: 600, letterSpacing: "0.1em", color: "#7a7a7a", textTransform: "uppercase", marginBottom: "10px", borderBottom: "1px solid #e8e8e8", paddingBottom: "6px" }}>
              Prescribed Medications
            </div>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "11px" }}>
              <thead>
                <tr style={{ background: "#0a0a0a" }}>
                  {pdfColumns.map(col => (
                    <th key={col.key} style={{ padding: "8px 10px", textAlign: "left", color: "#ffffff", fontWeight: 400, fontSize: "10px", letterSpacing: "0.06em", textTransform: "uppercase", borderBottom: "none" }}>
                      {col.label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((row, index) => (
                  <tr key={index} style={{ background: index % 2 === 0 ? "#ffffff" : "#f2f2f2" }}>
                    {pdfColumns.map(col => (
                      <td key={col.key} style={{ padding: "7px 10px", borderBottom: "1px solid #e8e8e8", color: "#1a1a1a", fontSize: "11px" }}>
                        {formatDisplayValue(col.key, row[col.key])}
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