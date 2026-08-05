import React, { useState, useEffect } from "react";
import {
  Box,
  Typography,
  TextField,
  Checkbox,
  Button,
  IconButton,
  Table,
  TableHead,
  TableBody,
  TableRow,
  TableCell,
  TableContainer,
  Dialog,
  DialogTitle,
  DialogContent,
  CircularProgress,
  TablePagination
} from "@mui/material";
import { CloseRounded } from "@mui/icons-material";

import { C, FONT, FW_BOLD, FW_NORMAL, thSx, tdSx, inputSx, saveBtnSx, outlineBtnSx } from "./shared/designTokens";
import { SectionBox } from "./shared/FormComponents";
import { request, API_BASE_URL, CONTEXT_BASE, getDoctorInfo } from "./shared/api";

// ─── Component-Specific Embedded APIs ──────────────────────────────────


export function getInvestigations(patientId, doctorId) {
  return request(`${CONTEXT_BASE}/oncology-investigations/${patientId}?doctor_id=${doctorId || ""}`);
}

export function getCompletedInvestigationDocuments(patientId, doctorId) {
  return request(`${CONTEXT_BASE}/oncology-investigations/all-completed-documents`, {
    method: "POST",
    body: JSON.stringify({ patient_id: patientId, doctor_id: doctorId }),
  });
}

export function createInvestigation(payload) {
  return request(`${CONTEXT_BASE}/oncology-investigations`, {
    method: "POST",
    body: JSON.stringify(payload)
  });
}

export function generateInvestigationSuggestion(payload) {
  return request(`${CONTEXT_BASE}/oncology-investigations/generate-suggestion`, {
    method: "POST",
    body: JSON.stringify(payload)
  });
}

export function uploadInvestigationFile(patientId, doctorId, investigationId, file) {
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


// ─── Standard Pre-Op Lab Fields ───────────────────────────────────────────────
export const STANDARD_LAB_FIELDS = [
  { key: "blood_group", label: "Blood Group and RH Type", unit: "", range: "", category: "Haematology" },
  { key: "cbc", label: "CBC (Complete Blood Count)", unit: "", range: "", category: "Haematology" },
  { key: "hb", label: "Haemoglobin (Hb)", unit: "g/dL", range: "12–18", category: "Haematology" },
  { key: "pcv", label: "PCV / Haematocrit", unit: "%", range: "36–52", category: "Haematology" },
  { key: "wbc", label: "WBC Count", unit: "×10³/µL", range: "4–11", category: "Haematology" },
  { key: "tlc", label: "Total Leucocyte Count (TLC)", unit: "×10³/µL", range: "4–11", category: "Haematology" },
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
  { key: "alp", label: "Alkaline Phosphatase (ALP)", unit: "U/L", range: "44–147", category: "Liver" },
  { key: "albumin", label: "Serum Albumin", unit: "g/dL", range: "3.5–5.0", category: "Liver" },
  { key: "rbs", label: "Random Blood Sugar", unit: "mg/dL", range: "<180", category: "Metabolic" },
  { key: "fbs", label: "FBS (Fasting Blood Sugar)", unit: "mg/dL", range: "70–100", category: "Metabolic" },
  { key: "ppbs", label: "PPBS (Post Prandial)", unit: "mg/dL", range: "<140", category: "Metabolic" },
  { key: "hba1c", label: "HbA1c", unit: "%", range: "<7.0", category: "Metabolic" },
  { key: "calcium", label: "Serum Calcium", unit: "mg/dL", range: "8.5–10.5", category: "Metabolic" },
  { key: "lipid_profile", label: "Lipid Profile", unit: "", range: "", category: "Metabolic" },
  { key: "ecg", label: "ECG Result", unit: "", range: "", category: "Cardiac" },
  { key: "echo_lvef", label: "Echo LVEF", unit: "%", range: ">55", category: "Cardiac" },
  { key: "bnp", label: "BNP", unit: "pg/mL", range: "<100", category: "Cardiac" },
  { key: "tsh", label: "TSH", unit: "µIU/mL", range: "0.4–4.0", category: "Thyroid" },
  { key: "free_t3", label: "Free T3", unit: "pg/mL", range: "2.0–4.4", category: "Thyroid" },
  { key: "free_t4", label: "Free T4", unit: "ng/dL", range: "0.93–1.7", category: "Thyroid" },
  { key: "crp", label: "CRP", unit: "mg/L", range: "<10", category: "Inflammatory" },
  { key: "procalcitonin", label: "Procalcitonin", unit: "ng/mL", range: "<0.15", category: "Inflammatory" },
  { key: "abg", label: "Arterial Blood Gas (ABG)", unit: "", range: "", category: "Respiratory" },
  { key: "hiv", label: "HIV", unit: "", range: "Negative", category: "Virology" },
  { key: "hbsag", label: "HBsAg", unit: "", range: "Negative", category: "Virology" },
  { key: "hcv", label: "HCV", unit: "", range: "Negative", category: "Virology" },
  { key: "psa", label: "Sr. PSA", unit: "ng/mL", range: "<4.0", category: "Oncology / Tumor Markers" },
  { key: "ca125", label: "CA 125", unit: "U/mL", range: "<35", category: "Oncology / Tumor Markers" },
  { key: "ca19_9", label: "CA 19.9", unit: "U/mL", range: "<37", category: "Oncology / Tumor Markers" },
  { key: "cea", label: "CEA", unit: "ng/mL", range: "<3.0", category: "Oncology / Tumor Markers" },
  { key: "afp", label: "AFP", unit: "ng/mL", range: "<10", category: "Oncology / Tumor Markers" },
  { key: "pap_smear", label: "PAP Smear", unit: "", range: "", category: "Pathology / Cytology" },
  { key: "hpv_dna", label: "HPV DNA", unit: "", range: "", category: "Pathology / Cytology" },
  { key: "cytology", label: "Cytology (Brush/Fluid)", unit: "", range: "", category: "Pathology / Cytology" },
  { key: "fnac", label: "FNAC", unit: "", range: "", category: "Pathology / Cytology" },
  { key: "biopsy", label: "Biopsy (Punch/Excision)", unit: "", range: "", category: "Pathology / Cytology" },
];

// ─── Standard Radiology Fields ──────────────────────────────────────────────────
export const STANDARD_RAD_FIELDS = [
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
  { key: "echo_2d", label: "2D Echo" },
  { key: "pft", label: "PFT (Pulmonary Function Test)" },
  { key: "stress_test", label: "Stress Test" },
];

export const LAB_CATEGORIES = ["Haematology", "Renal", "Liver", "Metabolic", "Cardiac", "Thyroid", "Inflammatory", "Respiratory", "Virology", "Oncology / Tumor Markers", "Pathology / Cytology"];

const parseUTC = (dateStr) => {
  if (!dateStr) return new Date(NaN);
  let str = String(dateStr);
  if (!str.endsWith("Z") && !str.match(/[+-]\d{2}:?\d{2}$/)) {
    str = str.replace(" ", "T") + "Z";
  }
  return new Date(str);
};

const orderContextLabel = (inv) => {
  const ctx = inv?.order_context;
  if (ctx && typeof ctx === "object") return ctx.label || ctx.procedure || ctx.cycle || "—";
  if (typeof ctx === "string" && ctx) return ctx;
  return "—";
};

export const PendingInvestigationRow = ({ inv, formattedDate, patientId, doctorId, onUploadComplete }) => {
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
      await uploadInvestigationFile(patientId, doctorId, inv.id, file);
      setMessage({ type: 'success', text: 'Uploaded' });
      if (onUploadComplete) onUploadComplete(inv.id);
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

  return (
    <TableRow sx={{ "&:hover": { background: C.bgPrimary } }}>
      <TableCell sx={tdSx}>{formattedDate}</TableCell>
      <TableCell sx={tdSx}>{inv.id !== undefined ? inv.id : "—"}</TableCell>
      <TableCell sx={tdSx}>{(inv.investigation || inv.investigation_type || "").includes("radiology") ? "Radiology" : "Lab"}</TableCell>
      <TableCell sx={tdSx}>{orderContextLabel(inv)}</TableCell>
      <TableCell sx={{ ...tdSx, cursor: isIndLong ? "pointer" : "default" }} onClick={() => isIndLong && setIndExpanded(!indExpanded)}>
        {dispInd}
      </TableCell>
      <TableCell sx={{ ...tdSx, cursor: isParamLong ? "pointer" : "default" }} onClick={() => isParamLong && setParamExpanded(!paramExpanded)}>
        {dispParam}
      </TableCell>
      <TableCell sx={tdSx}>
        <Typography sx={{ fontSize: 12, color: inv.status === 'completed' ? '#389e0d' : '#d46b08' }}>
          {inv.status ? inv.status.charAt(0).toUpperCase() + inv.status.slice(1) : "Pending"}
        </Typography>
      </TableCell>
      <TableCell sx={{ ...tdSx, minWidth: 200 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <Button component="label" size="small" sx={{ ...outlineBtnSx, mt: 0, py: 0.4, px: 1, fontSize: 10, maxWidth: 120, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', display: 'inline-block' }}>
            {file ? file.name : "Choose File"}
            <input type="file" hidden onChange={(e) => { setFile(e.target.files[0]); setMessage(null); }} accept=".pdf,.doc,.docx,.jpg,.jpeg,.png" />
          </Button>
          <Button size="small" onClick={handleUpload} disabled={isUploading} sx={{ ...outlineBtnSx, mt: 0, py: 0.4, px: 1, fontSize: 10 }}>
            {isUploading ? <CircularProgress size={10} sx={{ mr: 0.5 }} /> : null}
            Upload
          </Button>
        </Box>
        {message && <Typography sx={{ fontSize: 10, mt: 0.5, color: message.type === 'error' ? '#c62828' : '#2e7d32' }}>{message.text}</Typography>}
      </TableCell>
    </TableRow>
  );
};

export const CompletedInvestigationRow = ({ inv, formattedDate, doctorName, onViewValues }) => {
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

  return (
    <TableRow sx={{ "&:hover": { background: C.bgPrimary } }}>
      <TableCell sx={tdSx}>{formattedDate}</TableCell>
      <TableCell sx={tdSx}>{inv.id !== undefined && inv.id !== null ? inv.id : "—"}</TableCell>
      <TableCell sx={tdSx}>{doctorName || "—"}</TableCell>
      <TableCell sx={tdSx}>{(inv.investigation || inv.investigation_type || "").includes("radiology") ? "Radiology" : "Lab"}</TableCell>
      <TableCell sx={tdSx}>{orderContextLabel(inv)}</TableCell>
      <TableCell sx={{ ...tdSx, cursor: isIndLong ? "pointer" : "default" }} onClick={() => isIndLong && setIndExpanded(!indExpanded)}>
        {dispInd}
      </TableCell>
      <TableCell sx={{ ...tdSx, cursor: isParamLong ? "pointer" : "default" }} onClick={() => isParamLong && setParamExpanded(!paramExpanded)}>
        {dispParam}
      </TableCell>
      <TableCell sx={tdSx}>
        <Typography sx={{ fontSize: 12, color: '#389e0d' }}>Completed</Typography>
      </TableCell>
      <TableCell sx={tdSx}>
        {hasValues ? (
          <Button size="small" sx={{ ...outlineBtnSx, mt: 0, py: 0.4, px: 1, fontSize: 10 }} onClick={() => onViewValues(inv)}>
            View Values
          </Button>
        ) : "—"}
      </TableCell>
    </TableRow>
  );
};

export const CompletedInvestigationsTable = ({ completedInvestigations, doctorNamesMap = {} }) => {
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
              <TableCell sx={thSx}>Date</TableCell>
              <TableCell sx={thSx}>ID</TableCell>
              <TableCell sx={thSx}>Doctor</TableCell>
              <TableCell sx={thSx}>Investigation</TableCell>
              <TableCell sx={thSx}>Ordered For</TableCell>
              <TableCell sx={thSx}>Clinical Indication</TableCell>
              <TableCell sx={thSx}>Parameters</TableCell>
              <TableCell sx={thSx}>Status</TableCell>
              <TableCell sx={thSx}>Action</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {isEmpty ? (
              <TableRow>
                <TableCell colSpan={9} sx={{ ...tdSx, textAlign: "center", py: 2, color: "#888" }}>No completed investigations.</TableCell>
              </TableRow>
            ) : (
              completedInvestigations
                .slice(page * rowsPerPage, page * rowsPerPage + rowsPerPage)
                .map((inv, idx) => {
                  const d = parseUTC(inv.date_of_order);
                  const formattedDate = isNaN(d) ? inv.date_of_order : d.toLocaleString();
                  const docName = doctorNamesMap[inv.doctor_id] || inv.doctor_id;
                  return <CompletedInvestigationRow key={inv.document_id || inv._id || idx} inv={inv} formattedDate={formattedDate} doctorName={docName} onViewValues={(i) => setValuesDialog({ open: true, inv: i })} />;
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
        />
      )}

      <Dialog open={valuesDialog.open} onClose={closeValues} maxWidth="md" fullWidth>
        <DialogTitle sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: C.bgSecondary, borderBottom: `1px solid ${C.border}`, py: 1.5 }}>
          <Typography sx={{ fontFamily: FONT, fontWeight: FW_NORMAL, fontSize: 16 }}>Extracted Values</Typography>
          <IconButton onClick={closeValues} size="small"><CloseRounded /></IconButton>
        </DialogTitle>
        <DialogContent sx={{ p: 3, fontFamily: FONT }}>
          {valuesDialog.inv && (
            <TableContainer sx={{ border: `1px solid ${C.border}`, borderRadius: 1 }}>
              <Table size="small">
                <TableHead sx={{ background: C.bgSecondary }}>
                  <TableRow>
                    <TableCell sx={thSx}>Parameter</TableCell>
                    <TableCell sx={thSx}>Date</TableCell>
                    <TableCell sx={thSx}>Content</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {(valuesDialog.inv.parameterwise_content || []).length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={3} sx={{ ...tdSx, textAlign: "center", py: 2, color: "#888" }}>No extracted values.</TableCell>
                    </TableRow>
                  ) : (
                    (valuesDialog.inv.parameterwise_content || []).map((p, i) => (
                      <TableRow key={i}>
                        <TableCell sx={tdSx}>{p.parameter_name || "—"}</TableCell>
                        <TableCell sx={tdSx}>{p.date || "—"}</TableCell>
                        <TableCell sx={{ ...tdSx, whiteSpace: "pre-wrap" }}>{p.content || "—"}</TableCell>
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

const EMPTY_OBJ = {};

export const LabInvestigations = ({
  patientId,
  doctorId,
  currentBookingId,
  department = "surgical",
  hospitalId = "",
  currentProcedure = "",
  bookingData = EMPTY_OBJ,
  orderContext = null,
  onChange
}) => {
  const [labOrderFields, setLabOrderFields] = useState(
    STANDARD_LAB_FIELDS.map(f => ({ ...f, selected: false, surgeryValue: "" }))
  );
  const [customLabFields, setCustomLabFields] = useState([]);
  const [labOrderStatus, setLabOrderStatus] = useState("none");
  const [newField, setNewField] = useState({ label: "", unit: "", range: "" });
  const [clinicalIndication, setClinicalIndication] = useState("");

  const [radClinicalIndication, setRadClinicalIndication] = useState("");
  const [radOrderStatus, setRadOrderStatus] = useState("none");
  const [radOrderFields, setRadOrderFields] = useState(
    STANDARD_RAD_FIELDS.map(f => ({ ...f, selected: false }))
  );
  const [customRadFields, setCustomRadFields] = useState([]);
  const [newRadField, setNewRadField] = useState({ label: "" });

  const [investigationSuggestion, setInvestigationSuggestion] = useState(null);
  const [generatingSuggestions, setGeneratingSuggestions] = useState(false);

  const [investigationsHistory, setInvestigationsHistory] = useState([]);
  const [completedDocuments, setCompletedDocuments] = useState([]);
  const [invViewDialog, setInvViewDialog] = useState({ open: false, data: null });
  const [invPage, setInvPage] = useState(0);
  const [invRowsPerPage, setInvRowsPerPage] = useState(5);
  const [doctorNamesMap, setDoctorNamesMap] = useState({});

  const fetchInvestigations = () => {
    if (patientId) {
      getInvestigations(patientId, doctorId)
        .then(res => {
          if (res && res.data) {
            setInvestigationsHistory(res.data);
          }
        })
        .catch(err => console.error("Failed to fetch investigations:", err));
    }
  };

  const fetchCompletedDocuments = () => {
    if (patientId) {
      getCompletedInvestigationDocuments(patientId, doctorId)
        .then(res => {
          if (res && res.data) {
            setCompletedDocuments(res.data);
          }
        })
        .catch(err => console.error("Failed to fetch completed documents:", err));
    }
  };

  const refreshInvestigations = () => {
    fetchInvestigations();
    fetchCompletedDocuments();
  };

  useEffect(() => {
    fetchInvestigations();
    fetchCompletedDocuments();
  }, [patientId, doctorId]);

  useEffect(() => {
    const allItems = [...investigationsHistory, ...completedDocuments];
    if (!allItems.length) return;
    const ids = [...new Set(allItems.map(inv => inv.doctor_id).filter(Boolean))];
    const missing = ids.filter(id => !doctorNamesMap[id]);
    if (missing.length > 0) {
      Promise.all(
        missing.map(id =>
          getDoctorInfo(id)
            .then(res => ({ id, name: res?.doctor?.name || id }))
            .catch(() => ({ id, name: id }))
        )
      ).then(results => {
        setDoctorNamesMap(prev => {
          const next = { ...prev };
          results.forEach(r => next[r.id] = r.name);
          return next;
        });
      });
    }
  }, [investigationsHistory, completedDocuments]);

  useEffect(() => {
    const bookingViralMarkers = bookingData?.booking?.viralMarkers || bookingData?.viralMarkers || [];
    let suggestions = {};
    if (department === "anaesthesia") {
      suggestions = bookingData?.investigationSuggestion || bookingData?.anaesthesia?.investigationSuggestion || bookingData?.pac?.investigationSuggestion || {};
    } else if (department === "surgical") {
      suggestions = bookingData?.doctors_note?.investigationSuggestion || {};
    } else if (department === "medical") {
      suggestions = bookingData?.investigationSuggestion || {};
    } else if (department === "radiation") {
      suggestions = bookingData?.suggestion || {};
    } else {
      suggestions = bookingData?.anaesthesia?.investigationSuggestion || bookingData?.doctors_note?.investigationSuggestion || bookingData?.investigationSuggestion || bookingData?.suggestion || {};
    }

    if (Object.keys(suggestions).length > 0) {
      setInvestigationSuggestion(suggestions);
    }
    const suggestedLabTests = suggestions.labTests || [];
    const suggestedRadTests = suggestions.radTests || [];

    if (suggestions.labClinicalIndication) {
      if (!clinicalIndication) setClinicalIndication(suggestions.labClinicalIndication);
    }
    if (suggestions.radClinicalIndication) {
      if (!radClinicalIndication) setRadClinicalIndication(suggestions.radClinicalIndication);
    }

    setLabOrderFields(STANDARD_LAB_FIELDS.map(f => {
      let isSelected = false;
      if (bookingViralMarkers.includes("HIV") && f.key === "hiv") isSelected = true;
      if (bookingViralMarkers.includes("HBsAg") && f.key === "hbsag") isSelected = true;
      if (bookingViralMarkers.includes("HCV") && f.key === "hcv") isSelected = true;

      if (suggestedLabTests.includes(f.label)) isSelected = true;

      return {
        ...f,
        selected: isSelected,
        surgeryValue: ""
      };
    }));

    setRadOrderFields(STANDARD_RAD_FIELDS.map(f => ({
      ...f,
      selected: suggestedRadTests.includes(f.label)
    })));
  }, [bookingData]);

  // Bubble up state whenever investigation details change
  useEffect(() => {
    if (onChange) {
      onChange({
        investigationSuggestion,
        labOrder: {
          status: labOrderStatus,
          fields: [
            ...labOrderFields.filter(f => f.selected).map(({ key, label, unit, range, category, surgeryValue }) => ({ key, label, unit, range, category, surgeryValue })),
            ...customLabFields.map(f => ({ ...f, isCustom: true }))
          ]
        },
        radOrder: {
          status: radOrderStatus,
          fields: [
            ...radOrderFields.filter(f => f.selected).map(({ key, label }) => ({ key, label })),
            ...customRadFields.map(f => ({ ...f, isCustom: true }))
          ]
        },
        clinicalIndication,
        radClinicalIndication,
      });
    }
  }, [
    labOrderFields,
    customLabFields,
    labOrderStatus,
    radOrderFields,
    customRadFields,
    radOrderStatus,
    clinicalIndication,
    radClinicalIndication,
    investigationSuggestion
  ]);

  const handleGenerateSuggestions = async () => {
    if (department === "surgical" && !currentBookingId) return;
    setGeneratingSuggestions(true);
    try {
      const payload = {
        patient_id: patientId,
        department,
        booking_id: currentBookingId || null,
        doctor_id: doctorId || null,
        hospital_id: hospitalId || null
      };
      const res = await generateInvestigationSuggestion(payload);
      const suggestions = res.data;
      if (suggestions) {
        setInvestigationSuggestion(suggestions);
        if (suggestions.labClinicalIndication) {
          setClinicalIndication(suggestions.labClinicalIndication);
        }
        if (suggestions.radClinicalIndication) {
          setRadClinicalIndication(suggestions.radClinicalIndication);
        }
        setLabOrderFields(prev => prev.map(f => ({
          ...f,
          selected: f.selected || (suggestions.labTests || []).includes(f.label)
        })));
        setRadOrderFields(prev => prev.map(f => ({
          ...f,
          selected: f.selected || (suggestions.radTests || []).includes(f.label)
        })));
      }
    } catch (err) {
      console.error("Failed to generate suggestions manually:", err);
    } finally {
      setGeneratingSuggestions(false);
    }
  };

  const labHistory = investigationsHistory.filter(inv => {
    const type = inv.investigation || inv.investigation_type || "";
    return type.includes("labinvestigation") || (!type.includes("radiology") && type.startsWith("investigation"));
  });
  const labPending = labHistory.filter(inv => !inv.document_id);

  const radHistory = investigationsHistory.filter(inv => {
    const type = inv.investigation || inv.investigation_type || "";
    return type.includes("radiology");
  });
  const radPending = radHistory.filter(inv => !inv.document_id);

  const allPending = [...labPending, ...radPending].sort((a, b) => parseUTC(b.date_of_order) - parseUTC(a.date_of_order));

  const historyMapByDocId = investigationsHistory.reduce((acc, inv) => {
    if (inv.document_id != null) acc[inv.document_id] = inv;
    return acc;
  }, {});
  
  const historyMapById = investigationsHistory.reduce((acc, inv) => {
    if (inv.id !== undefined) acc[inv.id] = inv;
    return acc;
  }, {});

  const allCompleted = [...completedDocuments]
    .map(doc => {
      const match = historyMapById[doc.id] || historyMapByDocId[doc.document_id] || {};
      return {
        ...doc,
        id: doc.id !== undefined ? doc.id : match.id,
        order_context: doc.order_context || match.order_context
      };
    })
    .sort((a, b) => parseUTC(b.date_of_order) - parseUTC(a.date_of_order));

  return (
    <Box>
      {/* ── Pre-Induction Investigations ── */}
      <SectionBox title="Pre-Induction Investigations">
        <Box sx={{ mb: 3 }}>
          <Box sx={{ display: "flex", alignItems: "center", justifyContent: "space-between", mb: 1 }}>
            <Typography sx={{ fontSize: 10, textTransform: "uppercase", letterSpacing: "0.1em", color: C.textMuted, fontFamily: FONT }}>Clinical Indication</Typography>
            <Button
              size="small"
              onClick={handleGenerateSuggestions}
              disabled={generatingSuggestions || (department === "surgical" && !currentBookingId)}
              sx={{ ...outlineBtnSx, py: 0.2, px: 1, fontSize: 10 }}
            >
              {generatingSuggestions ? <CircularProgress size={12} sx={{ mr: 0.5, color: C.black }} /> : "AI Suggest Investigations"}
            </Button>
          </Box>
          <TextField
            fullWidth
            multiline
            rows={2}
            placeholder="LLM suggested indications..."
            value={clinicalIndication}
            onChange={(e) => setClinicalIndication(e.target.value)}
            sx={inputSx}
          />
        </Box>
        {LAB_CATEGORIES.map(cat => {
          const fields = labOrderFields.filter(f => f.category === cat);
          return (
            <Box key={cat} sx={{ mb: 2 }}>
              <Typography sx={{ fontSize: 10, textTransform: "uppercase", letterSpacing: "0.1em", color: C.textMuted, fontFamily: FONT, mb: 1 }}>{cat}</Typography>
              <Box sx={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))", gap: 1 }}>
                {fields.map(f => (
                  <Box key={f.key} sx={{ display: "flex", alignItems: "center", gap: 1, border: `1px solid ${f.selected ? C.black : C.border}`, px: 1, py: 0.5, background: f.selected ? "#fafafa" : C.white, transition: "all 0.15s" }}>
                    <Checkbox size="small" checked={f.selected}
                      onChange={e => setLabOrderFields(prev => prev.map(x => x.key === f.key ? { ...x, selected: e.target.checked } : x))}
                      sx={{ color: C.border, "&.Mui-checked": { color: C.black }, p: 0.3 }} />
                    <Typography sx={{ fontSize: 12, fontFamily: FONT, flex: 1, color: f.selected ? C.textPrimary : C.textMuted }}>
                      {f.label}{f.unit ? ` (${f.unit})` : ""}
                    </Typography>
                    {f.selected && (
                      <TextField
                        size="small" placeholder="Pre-fill value" value={f.surgeryValue}
                        onChange={e => setLabOrderFields(prev => prev.map(x => x.key === f.key ? { ...x, surgeryValue: e.target.value } : x))}
                        sx={{ ...inputSx, width: 110 }}
                      />
                    )}
                  </Box>
                ))}
              </Box>
            </Box>
          );
        })}

        {customLabFields.length > 0 && (
          <Box sx={{ mb: 2 }}>
            <Typography sx={{ fontSize: 10, textTransform: "uppercase", letterSpacing: "0.1em", color: C.textMuted, fontFamily: FONT, mb: 1 }}>Custom Fields</Typography>
            <Box sx={{ display: "flex", flexDirection: "column", gap: 1 }}>
              {customLabFields.map((f, i) => (
                <Box key={f.key} sx={{ display: "flex", alignItems: "center", gap: 1, border: `1px solid ${C.black}`, px: 1, py: 0.5, background: "#fafafa" }}>
                  <Typography sx={{ fontSize: 12, fontFamily: FONT, flex: 1 }}>
                    {f.label}{f.unit ? ` (${f.unit})` : ""}{f.range ? ` — Ref: ${f.range}` : ""}
                  </Typography>
                  <TextField
                    size="small" placeholder="Pre-fill value" value={f.surgeryValue}
                    onChange={e => setCustomLabFields(prev => prev.map(x => x.key === f.key ? { ...x, surgeryValue: e.target.value } : x))}
                    sx={{ ...inputSx, width: 110 }}
                  />
                  <IconButton size="small" onClick={() => setCustomLabFields(prev => prev.filter((_, j) => j !== i))} sx={{ color: C.textMuted }}>
                    <CloseRounded sx={{ fontSize: 14 }} />
                  </IconButton>
                </Box>
              ))}
            </Box>
          </Box>
        )}

        <Box sx={{ border: `1px dashed ${C.border}`, p: 1.5, mt: 1 }}>
          <Typography sx={{ fontSize: 10, textTransform: "uppercase", letterSpacing: "0.1em", color: C.textMuted, fontFamily: FONT, mb: 1 }}>Add Custom Field</Typography>
          <Box sx={{ display: "flex", gap: 1, flexWrap: "wrap", alignItems: "flex-end" }}>
            <TextField label="Field Name *" size="small" value={newField.label}
              onChange={e => setNewField(p => ({ ...p, label: e.target.value }))}
              sx={{ ...inputSx, minWidth: 160 }} />
            <TextField label="Unit" size="small" value={newField.unit}
              onChange={e => setNewField(p => ({ ...p, unit: e.target.value }))}
              sx={{ ...inputSx, width: 100 }} placeholder="e.g., mg/dL" />
            <TextField label="Reference Range" size="small" value={newField.range}
              onChange={e => setNewField(p => ({ ...p, range: e.target.value }))}
              sx={{ ...inputSx, width: 140 }} placeholder="e.g., <1.5 or 3–6" />
            <Button sx={outlineBtnSx} disabled={!newField.label.trim()}
              onClick={() => {
                const uid = Math.random().toString(36).slice(2, 10);
                setCustomLabFields(prev => [...prev, {
                  key: `custom_${uid}`, label: newField.label.trim(), unit: newField.unit.trim(),
                  range: newField.range.trim(), isCustom: true, category: "Custom", surgeryValue: ""
                }]);
                setNewField({ label: "", unit: "", range: "" });
              }}>
              Add Field
            </Button>
          </Box>
        </Box>

        <Box sx={{ mt: 2, display: "flex", alignItems: "center", gap: 2 }}>
          <Button sx={saveBtnSx} onClick={() => {
            const payload = {
              patient_id: patientId,
              doctor_id: doctorId,
              investigation_type: "labinvestigation",
              investigation: "labinvestigation",
              clinical_indication: clinicalIndication,
              order_context: orderContext || {
                type: "procedure",
                label: currentProcedure,
                booking_id: currentBookingId || "",
              },
              parameters: [
                ...labOrderFields.filter(f => f.selected).map(f => f.label + (f.surgeryValue ? ` (${f.surgeryValue})` : '')),
                ...customLabFields.map(f => f.label)
              ]
            };
            createInvestigation(payload)
              .then(res => {
                if (res && res.status === "success") {
                  setLabOrderStatus("sent");
                  fetchInvestigations();
                }
              })
              .catch(err => console.error("Failed to send order:", err));
          }}>
            Send Order
          </Button>
          {labOrderStatus === "sent" && <Typography sx={{ fontSize: 12, color: "#389e0d", fontFamily: FONT }}>✅ Order Sent Successfully</Typography>}
        </Box>
      </SectionBox>

      {/* ── Radiology Investigation ── */}
      <SectionBox title="Radiology Investigation">
        <Box sx={{ mb: 3 }}>
          <Box sx={{ display: "flex", alignItems: "center", justifyContent: "space-between", mb: 1 }}>
            <Typography sx={{ fontSize: 10, textTransform: "uppercase", letterSpacing: "0.1em", color: C.textMuted, fontFamily: FONT }}>Clinical Indication</Typography>
          </Box>
          <TextField
            fullWidth
            multiline
            rows={2}
            placeholder="LLM suggested indications for radiology..."
            value={radClinicalIndication}
            onChange={(e) => setRadClinicalIndication(e.target.value)}
            sx={inputSx}
          />
        </Box>
        <Typography sx={{ fontSize: 10, textTransform: "uppercase", letterSpacing: "0.1em", color: C.textMuted, fontFamily: FONT, mb: 1 }}>Radiology Selection</Typography>
        <Box sx={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))", gap: 1, mb: 2 }}>
          {radOrderFields.map(f => (
            <Box key={f.key} sx={{ display: "flex", alignItems: "center", gap: 1, border: `1px solid ${f.selected ? C.black : C.border}`, px: 1, py: 0.5, background: f.selected ? "#fafafa" : C.white, transition: "all 0.15s" }}>
              <Checkbox size="small" checked={f.selected}
                onChange={e => setRadOrderFields(prev => prev.map(x => x.key === f.key ? { ...x, selected: e.target.checked } : x))}
                sx={{ color: C.border, "&.Mui-checked": { color: C.black }, p: 0.3 }} />
              <Typography sx={{ fontSize: 12, fontFamily: FONT, flex: 1, color: f.selected ? C.textPrimary : C.textMuted }}>
                {f.label}
              </Typography>
            </Box>
          ))}
        </Box>

        {customRadFields.length > 0 && (
          <Box sx={{ mb: 2 }}>
            <Typography sx={{ fontSize: 10, textTransform: "uppercase", letterSpacing: "0.1em", color: C.textMuted, fontFamily: FONT, mb: 1 }}>Custom Fields</Typography>
            <Box sx={{ display: "flex", flexDirection: "column", gap: 1 }}>
              {customRadFields.map((f, i) => (
                <Box key={f.key} sx={{ display: "flex", alignItems: "center", gap: 1, border: `1px solid ${C.black}`, px: 1, py: 0.5, background: "#fafafa" }}>
                  <Typography sx={{ fontSize: 12, fontFamily: FONT, flex: 1 }}>
                    {f.label}
                  </Typography>
                  <IconButton size="small" onClick={() => setCustomRadFields(prev => prev.filter(x => x.key !== f.key))}>
                    <CloseRounded sx={{ fontSize: 14 }} />
                  </IconButton>
                </Box>
              ))}
            </Box>
          </Box>
        )}

        <Box sx={{ border: `1px dashed ${C.border}`, p: 1.5, mt: 1 }}>
          <Typography sx={{ fontSize: 10, textTransform: "uppercase", letterSpacing: "0.1em", color: C.textMuted, fontFamily: FONT, mb: 1 }}>Add Custom Radiology</Typography>
          <Box sx={{ display: "flex", gap: 1, flexWrap: "wrap", alignItems: "flex-end" }}>
            <TextField label="Investigation Name *" size="small" value={newRadField.label}
              onChange={e => setNewRadField({ label: e.target.value })}
              sx={{ ...inputSx, minWidth: 200 }} />
            <Button sx={outlineBtnSx} disabled={!newRadField.label.trim()}
              onClick={() => {
                const uid = Math.random().toString(36).slice(2, 10);
                setCustomRadFields(prev => [...prev, {
                  key: `custom_rad_${uid}`, label: newRadField.label.trim()
                }]);
                setNewRadField({ label: "" });
              }}>
              Add Field
            </Button>
          </Box>
        </Box>

        <Box sx={{ mt: 2, display: "flex", alignItems: "center", gap: 2 }}>
          <Button sx={saveBtnSx} onClick={() => {
            const payload = {
              patient_id: patientId,
              doctor_id: doctorId,
              investigation_type: "radiology",
              investigation: "radiology",
              clinical_indication: radClinicalIndication,
              order_context: orderContext || {
                type: "procedure",
                label: currentProcedure,
                booking_id: currentBookingId || "",
              },
              parameters: [
                ...radOrderFields.filter(f => f.selected).map(f => f.label),
                ...customRadFields.map(f => f.label)
              ]
            };
            createInvestigation(payload)
              .then(res => {
                if (res && res.status === "success") {
                  setRadOrderStatus("sent");
                  fetchInvestigations();
                }
              })
              .catch(err => console.error("Failed to send radiology order:", err));
          }}>
            Send Order
          </Button>
          {radOrderStatus === "sent" && <Typography sx={{ fontSize: 12, color: "#389e0d", fontFamily: FONT }}>✅ Order Sent Successfully</Typography>}
        </Box>
      </SectionBox>

      {/* ── Investigations Overview ── */}
      <SectionBox title="Investigations Overview">
        <Box sx={{ mb: 4 }}>
          <Typography sx={{ fontSize: 13, fontWeight: FW_BOLD, mb: 1, fontFamily: FONT }}>Pending Investigations</Typography>
          <TableContainer sx={{ border: `1px solid ${C.border}`, borderRadius: 1 }}>
            <Table size="small">
              <TableHead sx={{ background: C.bgSecondary }}>
                <TableRow>
                  <TableCell sx={thSx}>Date</TableCell>
                  <TableCell sx={thSx}>ID</TableCell>
                  <TableCell sx={thSx}>Investigation</TableCell>
                  <TableCell sx={thSx}>Ordered For</TableCell>
                  <TableCell sx={thSx}>Clinical Indication</TableCell>
                  <TableCell sx={thSx}>Parameters</TableCell>
                  <TableCell sx={thSx}>Status</TableCell>
                  <TableCell sx={thSx}>Action</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {allPending.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={8} sx={{ ...tdSx, textAlign: "center", py: 2, color: "#888" }}>No pending investigations.</TableCell>
                  </TableRow>
                ) : (
                  allPending
                    .slice(invPage * invRowsPerPage, invPage * invRowsPerPage + invRowsPerPage)
                    .map((inv, idx) => {
                      const d = parseUTC(inv.date_of_order);
                      const formattedDate = isNaN(d) ? inv.date_of_order : d.toLocaleString();
                      return <PendingInvestigationRow key={inv._id || idx} inv={inv} formattedDate={formattedDate} patientId={patientId} doctorId={doctorId} onUploadComplete={refreshInvestigations} />;
                    }))}
              </TableBody>
            </Table>
          </TableContainer>
          <TablePagination
            component="div"
            count={allPending.length}
            page={invPage}
            onPageChange={(e, newPage) => setInvPage(newPage)}
            rowsPerPage={invRowsPerPage}
            onRowsPerPageChange={(e) => {
              setInvRowsPerPage(parseInt(e.target.value, 10));
              setInvPage(0);
            }}
            rowsPerPageOptions={[5, 10, 25]}
          />
        </Box>

        <Box sx={{ mt: 4 }}>
          <Typography sx={{ fontSize: 13, fontWeight: FW_BOLD, mb: 1, fontFamily: FONT }}>Completed Investigations</Typography>
          <CompletedInvestigationsTable
            completedInvestigations={allCompleted}
            doctorNamesMap={doctorNamesMap}
          />
        </Box>
      </SectionBox>

      {/* Investigation View Dialog */}
      <Dialog open={invViewDialog.open} onClose={() => setInvViewDialog({ open: false, data: null })} maxWidth="md" fullWidth>
        <DialogTitle sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: C.bgSecondary, borderBottom: `1px solid ${C.border}`, py: 1.5 }}>
          <Typography sx={{ fontFamily: FONT, fontWeight: FW_NORMAL, fontSize: 16 }}>Order Details</Typography>
          <IconButton onClick={() => setInvViewDialog({ open: false, data: null })} size="small"><CloseRounded /></IconButton>
        </DialogTitle>
        <DialogContent sx={{ p: 3, fontFamily: FONT }}>
          {invViewDialog.data && (
            <Box>
              <Typography sx={{ fontSize: 12, fontWeight: FW_BOLD, mb: 1 }}>Clinical Indication:</Typography>
              <Typography sx={{ fontSize: 13, mb: 3 }}>{invViewDialog.data.clinical_indication || "None provided"}</Typography>

              <Typography sx={{ fontSize: 12, fontWeight: FW_BOLD, mb: 1 }}>Ordered Fields:</Typography>
              <Table size="small" sx={{ border: `1px solid ${C.border}` }}>
                <TableHead sx={{ background: C.bgSecondary }}>
                  <TableRow>
                    <TableCell sx={thSx}>Field</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {Array.isArray(invViewDialog.data.parameters) ? (
                    (invViewDialog.data.parameters || []).map((p, i) => (
                      <TableRow key={i}>
                        <TableCell sx={tdSx}>{typeof p === 'string' ? p : p.label}</TableCell>
                      </TableRow>
                    ))
                  ) : (
                    <TableRow>
                      <TableCell sx={tdSx}>
                        {typeof invViewDialog.data.parameters === 'string'
                          ? invViewDialog.data.parameters
                          : "No fields recorded"}
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </Box>
          )}
        </DialogContent>
      </Dialog>
    </Box>
  );
};

export default LabInvestigations;
