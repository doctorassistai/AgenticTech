// tabs/CaseRegistryTab.jsx - Case Registry and Specimen Accessioning

import React, { useState, useEffect, useRef, useCallback, useMemo } from "react";
import {
  Box, Typography, TextField, Button, IconButton, CircularProgress,
  Table, TableBody, TableCell, TableHead, TablePagination, TableRow,
} from "@mui/material";
import {
  SaveRounded, UploadFileRounded, AutoAwesomeRounded, DescriptionRounded,
  CheckCircleRounded, CloseRounded, FactCheckRounded,
} from "@mui/icons-material";
import {
  C, FONT, FW_NORMAL, inputSx, saveBtnSx, outlineBtnSx,
} from "../../surgical-oncology/shared/designTokens";
import {
  SectionBox, FieldLabel, Sel, CbxGroup,
} from "../../surgical-oncology/shared/FormComponents";
import {
  CASE_REASON_OPTIONS,
  DEPARTMENTS,
  PATIENT_STATUS_OPTIONS,
  PRIORITY_OPTIONS,
  REQUESTED_TEST_OPTIONS,
  SEX_OPTIONS,
} from "../constants";
import {
  autofillClinicalContext, getClinicalContextHistory, getPatientInfo, uploadDocument,
  processReferralLetters,
} from "../shared/api";
import { getDoctorInfo } from "../../shared/api";
import {
  CLINICAL_HISTORY_FIELDS,
  makeSpecimen,
  normalizeCaseRegistry,
  referralOutputToPatch,
  serializeCaseRegistry,
} from "../shared/caseRegistryModel";import { formatShortDate, priorCaseDate, priorCaseDiagnosis } from "../shared/caseHistory";
import { reportPreview } from "../shared/reportMarkdown";
import PriorCaseDialog from "../PriorCaseDialog";
import ReportDialog from "../ReportDialog";
import TreatmentDetailDialog from "../TreatmentDetailDialog";
import SpecimenAccessioningSection from "./SpecimenAccessioningSection";

const gridSx = {
  display: "grid",
  gridTemplateColumns: { xs: "1fr", lg: "repeat(2, minmax(0, 1fr))" },
  gap: 2,
};

const hasPopulatedValue = (value) => (
  Array.isArray(value) ? value.length > 0 : String(value || "").trim().length > 0
);

const mergePopulated = (current, patch) => {
  const next = { ...current };
  Object.entries(patch || {}).forEach(([key, value]) => {
    if (hasPopulatedValue(value) && !hasPopulatedValue(current?.[key])) {
      next[key] = value;
    }
  });
  return next;
};

const normalizeRequestedTests = (tests) => {
  if (!Array.isArray(tests)) return [];
  return tests.filter((test) => String(test || "").trim()).map((test) => {
    const normalized = String(test || "").trim().toLowerCase();
    return REQUESTED_TEST_OPTIONS.find((option) =>
      option.toLowerCase() === normalized
      || option.toLowerCase().includes(normalized)
      || normalized.includes(option.toLowerCase())
    ) || test;
  }).filter(Boolean);
};

const EMPTY_HISTORY = {
  confirmed_diagnoses: [],
  imaging_studies: [],
  treatments: [],
};

// Only the imaging Modality cell still needs this: `parameters` is a list, and an
// empty one should read "Not available" like every other blank history cell.
const formatHistoryValue = (value) => {
  if (value === null || value === undefined || value === "") return "Not available";
  if (Array.isArray(value)) {
    const formatted = value.map(formatHistoryValue).filter((item) => item !== "Not available");
    return formatted.length ? formatted.join(", ") : "Not available";
  }
  return String(value);
};

const HISTORY_ROWS_PER_PAGE_OPTIONS = [5, 10, 25];

const historyPanelSx = { border: `1px solid ${C.border}`, background: C.white, mb: 1.5 };

const historyPanelTitleSx = {
  px: 1.5,
  py: 1,
  fontSize: 11,
  fontFamily: FONT,
  fontWeight: FW_NORMAL,
  textTransform: "uppercase",
  letterSpacing: "0.1em",
  borderBottom: `1px solid ${C.border}`,
};

const historyPaginationSx = {
  borderTop: `1px solid ${C.border}`,
  ".MuiTablePagination-toolbar": { minHeight: 36, px: 1.5 },
  ".MuiTablePagination-selectLabel, .MuiTablePagination-displayedRows": {
    fontSize: 10,
    fontFamily: FONT,
    fontWeight: FW_NORMAL,
    textTransform: "uppercase",
    letterSpacing: "0.08em",
    color: C.textSecond,
  },
  ".MuiTablePagination-select": { fontSize: 11, fontFamily: FONT, color: C.textSecond },
  ".MuiTablePagination-selectIcon": { color: C.black },
  ".MuiIconButton-root": { borderRadius: 0, color: C.black, p: 0.5 },
  ".MuiIconButton-root.Mui-disabled": { color: C.textMuted },
};

const historyThSx = {
  fontSize: 10,
  fontFamily: FONT,
  fontWeight: FW_NORMAL,
  textTransform: "uppercase",
  letterSpacing: "0.08em",
  color: C.textSecond,
  borderBottom: `1px solid ${C.border}`,
  whiteSpace: "nowrap",
};

const historyTdSx = {
  fontSize: 11.5,
  fontFamily: FONT,
  color: C.textSecond,
  verticalAlign: "top",
  borderBottom: `1px solid ${C.border}`,
};

// Row actions sit in a trailing column of their own rather than under the text
// they act on, so rows stay one line tall and the buttons line up down the table.
// `width: "1%"` must stay a string: MUI's sx treats a unitless width <= 1 as a
// percentage, so `width: 1` means 100% and hands the whole table to this column.
const historyActionTdSx = {
  ...historyTdSx,
  whiteSpace: "nowrap",
  textAlign: "right",
  width: "1%",
};

const historyActionBtnSx = { ...outlineBtnSx, mt: 0, py: 0.4, px: 1.5, fontSize: 10 };

// A long cell needs both a line clamp and a width bound: the clamp hides the
// overflow but leaves the text's intrinsic width at its full unwrapped length, so
// on its own it makes auto table layout hand this column most of the table and
// squeeze the rest. `title` keeps the full text reachable on hover.
function ClampedText({ text, lines = 2, width = 340 }) {
  return (
    <Typography
      title={text}
      sx={{
        fontSize: 11.5,
        fontFamily: FONT,
        color: C.textSecond,
        maxWidth: width,
        display: "-webkit-box",
        WebkitLineClamp: lines,
        WebkitBoxOrient: "vertical",
        overflow: "hidden",
      }}
    >
      {text}
    </Typography>
  );
}

// Shown only past the smallest page size, so short tables stay clean. Gating on
// the smallest option rather than the current one keeps the control reachable
// after the user picks 25 for a 10-row table.
function HistoryPagination({ count, page, rowsPerPage, onPageChange, onRowsPerPageChange }) {
  if (count <= HISTORY_ROWS_PER_PAGE_OPTIONS[0]) return null;
  return (
    <TablePagination
      component="div"
      count={count}
      page={page}
      onPageChange={(event, newPage) => onPageChange(newPage)}
      rowsPerPage={rowsPerPage}
      onRowsPerPageChange={(event) => onRowsPerPageChange(parseInt(event.target.value, 10))}
      rowsPerPageOptions={HISTORY_ROWS_PER_PAGE_OPTIONS}
      sx={historyPaginationSx}
    />
  );
}

function ConfirmedDiagnoses({ items, loading }) {
  return (
    <Box sx={historyPanelSx}>
      <Typography sx={historyPanelTitleSx}>Confirmed Diagnoses</Typography>
      <Box sx={{ px: 1.5, py: 1.25 }}>
        {items.length ? items.map((item) => (
          <Typography key={item} sx={{ fontSize: 11.5, fontFamily: FONT, color: C.textSecond, mb: 0.4 }}>
            {item}
          </Typography>
        )) : (
          <Typography sx={{ fontSize: 11.5, fontFamily: FONT, color: C.textMuted }}>
            {loading ? "Loading history..." : "No documented diagnoses."}
          </Typography>
        )}
      </Box>
    </Box>
  );
}

// Prior pathology cases for this patient, moved here from the workflow's
// top-of-page PathologyHistoryAccordion. View opens a read-only dialog rather
// than calling switchCase(), so the case being worked on is never displaced.
function PriorPathologyCases({ cases, loading }) {
  const [page, setPage] = useState(0);
  const [rowsPerPage, setRowsPerPage] = useState(HISTORY_ROWS_PER_PAGE_OPTIONS[0]);
  // The case is kept while the dialog fades out, so its content does not blank
  // during the close transition.
  const [viewer, setViewer] = useState({ open: false, caseDoc: null });

  useEffect(() => { setPage(0); }, [cases.length]);

  const visibleCases = cases.slice(page * rowsPerPage, page * rowsPerPage + rowsPerPage);

  return (
    <Box sx={historyPanelSx}>
      <Typography sx={historyPanelTitleSx}>Previous Pathology Cases</Typography>
      <Box sx={{ overflowX: "auto" }}>
        <Table size="small" sx={{ minWidth: 620 }}>
          <TableHead>
            <TableRow>
              {["Date", "Accession ID", "Final Diagnosis", "Status"].map((label) => (
                <TableCell key={label} sx={historyThSx}>{label}</TableCell>
              ))}
              <TableCell sx={{ ...historyThSx, textAlign: "right" }}>Action</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {visibleCases.length ? visibleCases.map((item) => (
              <TableRow key={item.case_id}>
                <TableCell sx={historyTdSx}>{formatShortDate(priorCaseDate(item))}</TableCell>
                <TableCell sx={historyTdSx}>{item.accession_id || "—"}</TableCell>
                <TableCell sx={historyTdSx}>{priorCaseDiagnosis(item) || "Not reported"}</TableCell>
                <TableCell sx={historyTdSx}>{item.status || "Accessioned"}</TableCell>
                <TableCell sx={historyActionTdSx}>
                  <Button
                    size="small"
                    sx={historyActionBtnSx}
                    onClick={() => setViewer({ open: true, caseDoc: item })}
                  >
                    View
                  </Button>
                </TableCell>
              </TableRow>
            )) : (
              <TableRow>
                <TableCell colSpan={5} sx={{ fontSize: 11.5, fontFamily: FONT, color: C.textMuted, borderBottom: 0 }}>
                  {loading ? "Loading pathology cases..." : "No previous pathology cases."}
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </Box>
      <HistoryPagination
        count={cases.length}
        page={page}
        rowsPerPage={rowsPerPage}
        onPageChange={setPage}
        onRowsPerPageChange={(value) => { setRowsPerPage(value); setPage(0); }}
      />
      <PriorCaseDialog
        open={viewer.open}
        caseDoc={viewer.caseDoc}
        onClose={() => setViewer((prev) => ({ ...prev, open: false }))}
      />
    </Box>
  );
}

// Completed radiology, from the same projection as the other history tables.
// Study is the investigation type parsed server-side out of the
// `{type}_{timestamp}_{doctor}` slug; the modalities actually ordered come from
// `parameters`. The stored report is markdown, so the cell carries a preview and
// the whole thing opens in ReportDialog.
function PreviousImagingStudies({ rows, loading }) {
  const [page, setPage] = useState(0);
  const [rowsPerPage, setRowsPerPage] = useState(HISTORY_ROWS_PER_PAGE_OPTIONS[0]);
  const [viewer, setViewer] = useState({ open: false, title: "", subtitle: "", markdown: "" });

  useEffect(() => { setPage(0); }, [rows.length]);

  const visibleRows = rows.slice(page * rowsPerPage, page * rowsPerPage + rowsPerPage);

  return (
    <Box sx={historyPanelSx}>
      <Typography sx={historyPanelTitleSx}>Previous Imaging Studies</Typography>
      <Box sx={{ overflowX: "auto" }}>
        <Table size="small" sx={{ minWidth: 620 }}>
          <TableHead>
            <TableRow>
              {["Date", "Study", "Modality", "Clinical Indication", "Report"].map((label) => (
                <TableCell key={label} sx={historyThSx}>{label}</TableCell>
              ))}
              <TableCell sx={{ ...historyThSx, textAlign: "right" }}>Action</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {visibleRows.length ? visibleRows.map((row, index) => {
              const modality = formatHistoryValue(row?.modality);
              const preview = reportPreview(row?.report);
              return (
                <TableRow key={`imaging-${page * rowsPerPage + index}`}>
                  <TableCell sx={historyTdSx}>{formatShortDate(row?.date)}</TableCell>
                  <TableCell sx={historyTdSx}>{row?.study || "—"}</TableCell>
                  <TableCell sx={historyTdSx}>{modality}</TableCell>
                  <TableCell sx={historyTdSx}>
                    <ClampedText text={formatHistoryValue(row?.indication)} lines={3} width={320} />
                  </TableCell>
                  <TableCell sx={{ ...historyTdSx, minWidth: 220 }}>
                    {preview ? <ClampedText text={preview} lines={2} width={340} /> : "Not available"}
                  </TableCell>
                  <TableCell sx={historyActionTdSx}>
                    {preview && (
                      <Button
                        size="small"
                        sx={historyActionBtnSx}
                        onClick={() => setViewer({
                          open: true,
                          title: modality !== "Not available" ? modality : (row?.study || "Report"),
                          subtitle: formatShortDate(row?.date),
                          markdown: row?.report || "",
                        })}
                      >
                        View
                      </Button>
                    )}
                  </TableCell>
                </TableRow>
              );
            }) : (
              <TableRow>
                <TableCell colSpan={6} sx={{ fontSize: 11.5, fontFamily: FONT, color: C.textMuted, borderBottom: 0 }}>
                  {loading ? "Loading history..." : "No imaging studies available."}
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </Box>
      <HistoryPagination
        count={rows.length}
        page={page}
        rowsPerPage={rowsPerPage}
        onPageChange={setPage}
        onRowsPerPageChange={(value) => { setRowsPerPage(value); setPage(0); }}
      />
      <ReportDialog
        open={viewer.open}
        title={viewer.title}
        subtitle={viewer.subtitle}
        markdown={viewer.markdown}
        onClose={() => setViewer((prev) => ({ ...prev, open: false }))}
      />
    </Box>
  );
}

// Completed and in-progress treatment across the four oncology collections, one
// row per record. `summary` and `details` arrive presentation-ready from the
// backend: details is a flat [{label, value}] list, so no nested record is ever
// stringified into a cell.
function PreviousTreatments({ rows, loading }) {
  const [page, setPage] = useState(0);
  const [rowsPerPage, setRowsPerPage] = useState(HISTORY_ROWS_PER_PAGE_OPTIONS[0]);
  const [viewer, setViewer] = useState({ open: false, row: null });

  useEffect(() => { setPage(0); }, [rows.length]);

  const visibleRows = rows.slice(page * rowsPerPage, page * rowsPerPage + rowsPerPage);

  return (
    <Box sx={historyPanelSx}>
      <Typography sx={historyPanelTitleSx}>Previous Surgery / Chemotherapy / Radiotherapy</Typography>
      <Box sx={{ overflowX: "auto" }}>
        <Table size="small" sx={{ minWidth: 620 }}>
          <TableHead>
            <TableRow>
              {["Date", "Treatment", "Intent", "Status", "Details"].map((label) => (
                <TableCell key={label} sx={historyThSx}>{label}</TableCell>
              ))}
              <TableCell sx={{ ...historyThSx, textAlign: "right" }}>Action</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {visibleRows.length ? visibleRows.map((row, index) => (
              <TableRow key={`treatment-${page * rowsPerPage + index}`}>
                <TableCell sx={historyTdSx}>{formatShortDate(row?.date)}</TableCell>
                <TableCell sx={{ ...historyTdSx, whiteSpace: "nowrap" }}>{row?.treatment_type || "—"}</TableCell>
                <TableCell sx={historyTdSx}>{row?.intent || "—"}</TableCell>
                <TableCell sx={historyTdSx}>{row?.status || "—"}</TableCell>
                <TableCell sx={{ ...historyTdSx, minWidth: 240 }}>
                  {row?.summary || "Not available"}
                </TableCell>
                <TableCell sx={historyActionTdSx}>
                  {(row?.details || []).length > 0 && (
                    <Button
                      size="small"
                      sx={historyActionBtnSx}
                      onClick={() => setViewer({ open: true, row })}
                    >
                      View
                    </Button>
                  )}
                </TableCell>
              </TableRow>
            )) : (
              <TableRow>
                <TableCell colSpan={6} sx={{ fontSize: 11.5, fontFamily: FONT, color: C.textMuted, borderBottom: 0 }}>
                  {loading ? "Loading history..." : "No treatment history available."}
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </Box>
      <HistoryPagination
        count={rows.length}
        page={page}
        rowsPerPage={rowsPerPage}
        onPageChange={setPage}
        onRowsPerPageChange={(value) => { setRowsPerPage(value); setPage(0); }}
      />
      <TreatmentDetailDialog
        open={viewer.open}
        row={viewer.row}
        onClose={() => setViewer((prev) => ({ ...prev, open: false }))}
      />
    </Box>
  );
}

export default function CaseRegistryTab({
  patientId,
  doctorId,
  doctorName,
  hospitalId,
  newCaseMode,
  caseId,
  accessionId,
  initialData,
  cases,
  casesLoading,
  seedSpecimenType,
  onSeedConsumed,
  onSave,
}) {
  const [f, setF] = useState(() => normalizeCaseRegistry(initialData, patientId));
  const [isSaving, setIsSaving] = useState(false);
  const [isAutofilling, setIsAutofilling] = useState(false);
  const [isExtracting, setIsExtracting] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [photoUploadId, setPhotoUploadId] = useState("");
  const [uploadedFile, setUploadedFile] = useState(null);
  const [notice, setNotice] = useState("");
  const [clinicalHistory, setClinicalHistory] = useState({
    data: EMPTY_HISTORY,
    warnings: [],
    loading: false,
    error: "",
  });
  const fileInputRef = useRef(null);

  const setCaseDetail = (key) => (value) => setF((prev) => ({
    ...prev,
    case_details: { ...prev.case_details, [key]: value },
  }));
  const setPatient = (key) => (value) => setF((prev) => ({
    ...prev,
    patient: { ...prev.patient, [key]: value },
  }));
  const setClinical = (key) => (value) => setF((prev) => ({
    ...prev,
    clinical_context: { ...prev.clinical_context, [key]: value },
  }));
  const input = (setter) => (event) => setter(event.target.value);
  const setSpecimens = (updater) => setF((prev) => ({
    ...prev,
    specimens: typeof updater === "function" ? updater(prev.specimens) : updater,
  }));

  useEffect(() => {
    setF(normalizeCaseRegistry(initialData, patientId));
    setUploadedFile(null);
    setNotice("");
  }, [caseId]); // eslint-disable-line react-hooks/exhaustive-deps

  // Another tab (currently Cytopathology) can ask for a specimen of a given type
  // to be started here, because Case Registry is the only place a specimen_id is
  // minted. It appends an empty specimen pre-typed and nothing more — the
  // accessioning details are still the user's to enter.
  useEffect(() => {
    if (!seedSpecimenType) return;
    setF((prev) => ({
      ...prev,
      specimens: [...prev.specimens, { ...makeSpecimen(prev.specimens.length), specimen_type: seedSpecimenType }],
    }));
    setNotice(`A new ${seedSpecimenType} specimen was added below. Complete its accessioning details and save.`);
    if (onSeedConsumed) onSeedConsumed();
  }, [seedSpecimenType]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!patientId || (caseId && !newCaseMode)) return;
    let cancelled = false;
    getPatientInfo(patientId)
      .then((info) => {
        if (cancelled || !info) return;
        setF((prev) => ({
          ...prev,
          case_details: {
            ...prev.case_details,
            department: prev.case_details.department || info.department || "",
            ordering_clinician:
              prev.case_details.ordering_clinician || info.ordering_clinician || "",
            patient_status: prev.case_details.patient_status || info.patient_status || "",
          },
          patient: {
            ...prev.patient,
            patient_id: patientId,
            patient_name: prev.patient.patient_name || info.patient_name || "",
            mrn: prev.patient.mrn || info.mrn || "",
            dob: prev.patient.dob || info.dob || "",
            sex: prev.patient.sex || (info.sex || "").toLowerCase(),
          },
          clinical_context: {
            ...prev.clinical_context,
            relevant_family_history:
              prev.clinical_context.relevant_family_history || info.family_history || "",
          },
          data_provenance: {
            ...prev.data_provenance,
            patient_demographics: {
              source_type: "HMS patient record",
              imported_at: new Date().toISOString(),
              review_status: "auto-populated",
            },
            patient_family_history: {
              source_type: "HMS patient record",
              imported_at: new Date().toISOString(),
              review_status: "auto-populated",
            },
          },
        }));
      })
      .catch((err) => console.error("[CaseRegistryTab] patient info:", err));

    return () => { cancelled = true; };
  }, [patientId, caseId]);

  useEffect(() => {
    if (!doctorId || (caseId && !newCaseMode)) return;
    let cancelled = false;
    getDoctorInfo(doctorId)
      .then((response) => {
        const doctor = response?.doctor;
        if (cancelled || !doctor) return;
        const clinician = {
          doctor_id: doctor.doctor_id || doctorId,
          sys_user_id: doctor.sys_user_id || "",
          name: doctor.name || doctorName || "",
          email: doctor.email || "",
          phone_number: doctor.phone_number || "",
          specialization: doctor.specialization || "",
          registration_number:
            doctor.registration_number || doctor.registeration_number || "",
          hospital_id: doctor.hospital_id || hospitalId || "",
          hospital_name: doctor.hospital_name || "",
        };
        setF((prev) => ({
          ...prev,
          case_details: {
            ...prev.case_details,
            accessioning_clinician: clinician,
          },
          data_provenance: {
            ...prev.data_provenance,
            accessioning_clinician: {
              source_type: "doctor directory",
              source_id: clinician.doctor_id,
              imported_at: new Date().toISOString(),
              review_status: "auto-populated",
            },
          },
        }));
      })
      .catch((err) => console.error("[CaseRegistryTab] doctor info:", err));

    return () => { cancelled = true; };
  }, [doctorId, doctorName, hospitalId, caseId]);

  useEffect(() => {
    if (!patientId) {
      setClinicalHistory({
        data: EMPTY_HISTORY,
        warnings: [],
        loading: false,
        error: "",
      });
      return undefined;
    }
    let cancelled = false;
    setClinicalHistory({
      data: EMPTY_HISTORY,
      warnings: [],
      loading: true,
      error: "",
    });
    getClinicalContextHistory(patientId, doctorId)
      .then((response) => {
        if (cancelled) return;
        setClinicalHistory({
          data: {
            confirmed_diagnoses: response?.data?.confirmed_diagnoses || [],
            imaging_studies: response?.data?.imaging_studies || [],
            treatments: response?.data?.treatments || [],
          },
          warnings: response?.warnings || [],
          loading: false,
          error: "",
        });
      })
      .catch((err) => {
        console.error("[CaseRegistryTab] clinical history:", err);
        if (cancelled) return;
        setClinicalHistory((prev) => ({ ...prev, loading: false, error: "Clinical history could not be loaded." }));
      });
    return () => { cancelled = true; };
  }, [patientId, doctorId, caseId]);

  const handleClinicalAutofill = useCallback(async () => {
    if (!patientId) return;
    setIsAutofilling(true);
    setNotice("");
    try {
      const response = await autofillClinicalContext(patientId, doctorId);
      const patch = { ...(response?.data || {}) };
      CLINICAL_HISTORY_FIELDS.forEach((key) => { delete patch[key]; });
      patch.requested_tests = normalizeRequestedTests(patch.requested_tests);
      const hasSuggestions = Object.values(patch).some(hasPopulatedValue);
      if (!hasSuggestions) {
        setNotice("No pathology-relevant clinical context was available for autofill.");
        return;
      }
      setF((prev) => ({
        ...prev,
        clinical_context: mergePopulated(prev.clinical_context, patch),
        data_provenance: {
          ...prev.data_provenance,
          clinical_context_autofill: {
            source_type: "AI synthesis of existing clinical records",
            sources: response?.sources || {},
            source_warnings: response?.warnings || [],
            generated_at: new Date().toISOString(),
            review_status: "requires review",
          },
        },
      }));
      setNotice("Clinical context suggestions were autofilled into empty fields. Review them before saving.");
    } catch (err) {
      console.error("[CaseRegistryTab] clinical context autofill:", err);
      setNotice("Clinical context autofill failed.");
    } finally {
      setIsAutofilling(false);
    }
  }, [patientId, doctorId]);

  const handleFilePick = () => fileInputRef.current?.click();

  const handleFileChange = async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    setIsUploading(true);
    setNotice("");
    try {
      const response = await uploadDocument({
        file, doctorId, patientId, hospitalId, docType: "referral",
      });
      setUploadedFile({
        name: file.name,
        url: response.file_url,
        documentId: response.document?.document_id,
      });
      setNotice("Referral uploaded and available for structured extraction.");
    } catch (err) {
      console.error("[CaseRegistryTab] upload:", err);
      setNotice("Referral upload failed.");
    } finally {
      setIsUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const handleExtract = useCallback(async () => {
    if (!patientId) return;
    setIsExtracting(true);
    setNotice("");
    try {
      const response = await processReferralLetters(patientId);
      const result = (response?.results || []).find((item) => item?.llm_output?.overall_summary);
      if (!result) {
        setNotice("No extractable referral letter was found.");
        return;
      }

      const patch = referralOutputToPatch(result.llm_output);
      patch.clinical_context.requested_tests = normalizeRequestedTests(
        patch.clinical_context.requested_tests
      );

      setF((prev) => ({
        ...prev,
        case_details: mergePopulated(prev.case_details, patch.case_details),
        clinical_context: mergePopulated(prev.clinical_context, patch.clinical_context),
        data_provenance: {
          ...prev.data_provenance,
          referral_extraction: {
            source_type: "referral document AI extraction",
            document_id: result.document_id || uploadedFile?.documentId || "",
            source_file: result.file_name || uploadedFile?.name || "",
            extracted_at: result.processed_at || new Date().toISOString(),
            review_status: "requires review",
          },
        },
      }));
      setNotice("Referral fields were extracted as suggestions. Review them before saving.");
    } catch (err) {
      console.error("[CaseRegistryTab] extract:", err);
      setNotice("Referral extraction failed.");
    } finally {
      setIsExtracting(false);
    }
  }, [patientId, uploadedFile]);

  const handlePhotoUpload = async (specimenId, file, event) => {
    if (!file) return;
    setPhotoUploadId(specimenId);
    setNotice("");
    try {
      const response = await uploadDocument({
        file,
        doctorId,
        patientId,
        hospitalId,
        docType: "specimen_receipt_photo",
        remarks: `Pathology case ${caseId || "new"}; specimen ${specimenId}`,
      });
      setSpecimens((current) => current.map((specimen) =>
        specimen.specimen_id === specimenId
          ? {
            ...specimen,
            receipt_photo: {
              document_id: response.document?.document_id || "",
              file_name: file.name,
              file_url: response.file_url,
              uploaded_at: response.document?.uploaded_at || new Date().toISOString(),
            },
          }
          : specimen
      ));
      setNotice("Specimen receipt photo uploaded.");
    } catch (err) {
      console.error("[CaseRegistryTab] receipt photo:", err);
      setNotice("Specimen receipt photo upload failed.");
    } finally {
      setPhotoUploadId("");
      if (event?.target) event.target.value = "";
    }
  };

  // The case being worked on is not "previous"; every other case for the
  // patient is, including signed-out ones.
  const priorCases = useMemo(
    () => (cases || []).filter((item) => item?.case_id && item.case_id !== caseId),
    [cases, caseId]
  );

  const completenessWarnings = useMemo(() => {
    const warnings = [];
    if (!f.case_details.request_datetime) warnings.push("Pathology request date and time is missing.");
    if (!f.case_details.ordering_clinician) warnings.push("Ordering clinician is missing.");
    if (!f.clinical_context.reason) warnings.push("Reason for the pathology request is missing.");
    if (!f.clinical_context.summary) warnings.push("Clinical indication summary is missing.");
    f.specimens.forEach((specimen, index) => {
      const label = specimen.part_label || index + 1;
      if (!specimen.specimen_type && specimen.received_datetime) {
        warnings.push(`Specimen ${label} has a receipt time but no specimen type.`);
      }
      if (specimen.patient_specimen_label_verification === "Discrepancy"
          && !specimen.integrity_discrepancy_reason) {
        warnings.push(`Specimen ${label} has an unresolved label discrepancy.`);
      }
      if (["Inadequate", "Compromised"].includes(specimen.specimen_integrity)
          && !specimen.integrity_discrepancy_reason) {
        warnings.push(`Specimen ${label} requires an integrity reason.`);
      }
    });
    return warnings;
  }, [f]);

  const handleSubmit = async () => {
    setIsSaving(true);
    try {
      const confirmedAt = new Date().toISOString();
      const confirmedProvenance = Object.fromEntries(
        Object.entries(f.data_provenance || {}).map(([key, value]) => {
          if (value?.review_status !== "requires review") return [key, value];
          return [key, {
            ...value,
            review_status: "confirmed_on_save",
            reviewed_by: doctorName || doctorId || "",
            reviewed_at: confirmedAt,
          }];
        })
      );
      const payload = serializeCaseRegistry({
        ...f,
        data_provenance: {
          ...confirmedProvenance,
          last_confirmation: {
            confirmed_by: doctorName || doctorId || "",
            confirmed_at: confirmedAt,
            source_tab: "case_register",
          },
        },
      }, patientId);
      await onSave("case-register", payload);
    } finally {
      setIsSaving(false);
    }
  };

  const busy = isAutofilling || isExtracting || isUploading || !!photoUploadId;

  return (
    <Box sx={{ fontFamily: FONT }}>
      <Box sx={{ border: `1px solid ${C.border}`, background: C.bgSecondary, p: 2.5, mb: 2.5 }}>
        <Box sx={{ display: "flex", alignItems: "center", gap: 1, mb: 1.5 }}>
          <AutoAwesomeRounded sx={{ fontSize: 18, color: C.black }} />
          <Typography sx={{ fontSize: 13, fontWeight: FW_NORMAL, fontFamily: FONT, textTransform: "uppercase", letterSpacing: "0.1em" }}>
            Referral and Clinical Sources
          </Typography>
        </Box>
        <Box sx={{ display: "flex", alignItems: "center", gap: 1.5, flexWrap: "wrap" }}>
          <input ref={fileInputRef} type="file" accept="application/pdf" style={{ display: "none" }} onChange={handleFileChange} />
          <Button sx={outlineBtnSx} onClick={handleFilePick} disabled={isUploading}>
            {isUploading
              ? <CircularProgress size={14} sx={{ mr: 1, color: C.black }} />
              : <UploadFileRounded sx={{ mr: 0.75, fontSize: 16 }} />}
            Upload Referral
          </Button>
          <Button sx={outlineBtnSx} onClick={handleExtract} disabled={busy}>
            {isExtracting
              ? <CircularProgress size={14} sx={{ mr: 1, color: C.black }} />
              : <DescriptionRounded sx={{ mr: 0.75, fontSize: 16 }} />}
            Extract Structured Fields
          </Button>
          <Button sx={outlineBtnSx} onClick={handleClinicalAutofill} disabled={busy}>
            {isAutofilling
              ? <CircularProgress size={14} sx={{ mr: 1, color: C.black }} />
              : <AutoAwesomeRounded sx={{ mr: 0.75, fontSize: 16 }} />}
            AI Autofill Clinical Context
          </Button>
          {uploadedFile && (
            <Box sx={{ display: "flex", alignItems: "center", gap: 0.5, minWidth: 0 }}>
              <CheckCircleRounded sx={{ fontSize: 15, color: C.black }} />
              <Typography sx={{ fontSize: 11, color: C.textSecond, fontFamily: FONT, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: 260 }}>
                {uploadedFile.name}
              </Typography>
            </Box>
          )}
        </Box>
      </Box>

      <SectionBox title="Pathology Request">
        <Box sx={gridSx}>
          <Box>
            <FieldLabel>Accession ID</FieldLabel>
            <TextField value={accessionId || ""} size="small" fullWidth InputProps={{ readOnly: true }} placeholder="Assigned when the case is created" sx={inputSx} />
          </Box>
          <Box>
            <FieldLabel>Request Date and Time</FieldLabel>
            <TextField type="datetime-local" value={f.case_details.request_datetime} onChange={input(setCaseDetail("request_datetime"))} size="small" fullWidth InputLabelProps={{ shrink: true }} sx={inputSx} />
          </Box>
          <Box>
            <FieldLabel>Priority</FieldLabel>
            <Sel label="Priority" options={PRIORITY_OPTIONS} value={f.case_details.priority} onChange={setCaseDetail("priority")} />
          </Box>
          <Box>
            <FieldLabel>Patient Status</FieldLabel>
            <Sel label="Patient Status" options={PATIENT_STATUS_OPTIONS} value={f.case_details.patient_status} onChange={setCaseDetail("patient_status")} />
          </Box>
          <Box>
            <FieldLabel>Ordering / Referring Clinician</FieldLabel>
            <TextField value={f.case_details.ordering_clinician} onChange={input(setCaseDetail("ordering_clinician"))} size="small" fullWidth sx={inputSx} />
          </Box>
          <Box>
            <FieldLabel>Clinician Contact</FieldLabel>
            <TextField value={f.case_details.referring_clinician_contact} onChange={input(setCaseDetail("referring_clinician_contact"))} size="small" fullWidth placeholder="Phone or email" sx={inputSx} />
          </Box>
          <Box>
            <FieldLabel>Referring Department</FieldLabel>
            <Sel label="Department" options={DEPARTMENTS} value={f.case_details.department} onChange={setCaseDetail("department")} />
          </Box>
        </Box>
      </SectionBox>

      <SectionBox title="Patient Demographics">
        <Box sx={gridSx}>
          <Box>
            <FieldLabel>Patient Name</FieldLabel>
            <TextField value={f.patient.patient_name} onChange={input(setPatient("patient_name"))} size="small" fullWidth sx={inputSx} />
          </Box>
          <Box>
            <FieldLabel>Medical Record Number</FieldLabel>
            <TextField value={f.patient.mrn} onChange={input(setPatient("mrn"))} size="small" fullWidth sx={inputSx} />
          </Box>
          <Box>
            <FieldLabel>Date of Birth</FieldLabel>
            <TextField type="date" value={f.patient.dob} onChange={input(setPatient("dob"))} size="small" fullWidth InputLabelProps={{ shrink: true }} sx={inputSx} />
          </Box>
          <Box>
            <FieldLabel>Sex</FieldLabel>
            <Sel label="Sex" options={SEX_OPTIONS} value={f.patient.sex} onChange={setPatient("sex")} />
          </Box>
        </Box>
      </SectionBox>

      <SectionBox title="Accessioning Clinician">
        <Box sx={gridSx}>
          <Box>
            <FieldLabel>Name</FieldLabel>
            <TextField value={f.case_details.accessioning_clinician?.name || ""} size="small" fullWidth InputProps={{ readOnly: true }} placeholder="Auto-populated" sx={inputSx} />
          </Box>
          <Box>
            <FieldLabel>Specialization</FieldLabel>
            <TextField value={f.case_details.accessioning_clinician?.specialization || ""} size="small" fullWidth InputProps={{ readOnly: true }} placeholder="Auto-populated" sx={inputSx} />
          </Box>
          <Box>
            <FieldLabel>Phone</FieldLabel>
            <TextField value={f.case_details.accessioning_clinician?.phone_number || ""} size="small" fullWidth InputProps={{ readOnly: true }} placeholder="Not available" sx={inputSx} />
          </Box>
          <Box>
            <FieldLabel>Email</FieldLabel>
            <TextField value={f.case_details.accessioning_clinician?.email || ""} size="small" fullWidth InputProps={{ readOnly: true }} placeholder="Not available" sx={inputSx} />
          </Box>
          <Box>
            <FieldLabel>Hospital</FieldLabel>
            <TextField value={f.case_details.accessioning_clinician?.hospital_name || ""} size="small" fullWidth InputProps={{ readOnly: true }} placeholder="Not available" sx={inputSx} />
          </Box>
          <Box>
            <FieldLabel>Registration Number</FieldLabel>
            <TextField value={f.case_details.accessioning_clinician?.registration_number || ""} size="small" fullWidth InputProps={{ readOnly: true }} placeholder="Not available" sx={inputSx} />
          </Box>
        </Box>
      </SectionBox>

      <SectionBox title="Clinical Context">
        <Box sx={gridSx}>
          <Box>
            <FieldLabel>Reason</FieldLabel>
            <Sel label="Reason" options={CASE_REASON_OPTIONS} value={f.clinical_context.reason} onChange={setClinical("reason")} />
          </Box>
          {f.clinical_context.reason === "other" && (
            <Box>
              <FieldLabel>Other Reason</FieldLabel>
              <TextField value={f.clinical_context.reason_other} onChange={input(setClinical("reason_other"))} size="small" fullWidth sx={inputSx} />
            </Box>
          )}
          <Box>
            <FieldLabel>Suspected Primary Site</FieldLabel>
            <TextField value={f.clinical_context.suspected_primary_site} onChange={input(setClinical("suspected_primary_site"))} size="small" fullWidth sx={inputSx} />
          </Box>
          <Box>
            <FieldLabel>Suspected Sub-site</FieldLabel>
            <TextField value={f.clinical_context.suspected_sub_site} onChange={input(setClinical("suspected_sub_site"))} size="small" fullWidth sx={inputSx} />
          </Box>
          <Box>
            <FieldLabel>Known Clinical Stage</FieldLabel>
            <TextField value={f.clinical_context.clinical_stage} onChange={input(setClinical("clinical_stage"))} size="small" fullWidth placeholder="For example: cT2N1M0" sx={inputSx} />
          </Box>
          <Box sx={{ gridColumn: { lg: "1 / -1" } }}>
            <CbxGroup label="Requested Tests" options={REQUESTED_TEST_OPTIONS} value={f.clinical_context.requested_tests} onChange={setClinical("requested_tests")} />
          </Box>
          <Box sx={{ gridColumn: { lg: "1 / -1" } }}>
            <FieldLabel>Clinical Indication Summary</FieldLabel>
            <TextField value={f.clinical_context.summary} onChange={input(setClinical("summary"))} size="small" fullWidth multiline minRows={4} placeholder="Clinical presentation, provisional diagnosis and the pathology question" sx={inputSx} />
          </Box>
          <Box>
            <FieldLabel>Relevant Family History</FieldLabel>
            <TextField value={f.clinical_context.relevant_family_history} onChange={input(setClinical("relevant_family_history"))} size="small" fullWidth multiline minRows={2} sx={inputSx} />
          </Box>
          <Box>
            <FieldLabel>Relevant Imaging Note / Report Reference</FieldLabel>
            <TextField value={f.clinical_context.relevant_imaging_note} onChange={input(setClinical("relevant_imaging_note"))} size="small" fullWidth multiline minRows={2} sx={inputSx} />
          </Box>
          <Box>
            <FieldLabel>Current Medications</FieldLabel>
            <TextField value={f.clinical_context.current_medications} onChange={input(setClinical("current_medications"))} size="small" fullWidth multiline minRows={2} sx={inputSx} />
          </Box>
          <Box>
            <FieldLabel>Tumor Marker Results</FieldLabel>
            <TextField value={f.clinical_context.tumor_marker_results} onChange={input(setClinical("tumor_marker_results"))} size="small" fullWidth multiline minRows={2} sx={inputSx} />
          </Box>
        </Box>
      </SectionBox>

      <SectionBox title="Clinical History">
        {clinicalHistory.error && (
          <Typography sx={{ fontSize: 11.5, color: C.textSecond, fontFamily: FONT, mb: 1.5 }}>
            {clinicalHistory.error}
          </Typography>
        )}
        {!clinicalHistory.error && clinicalHistory.warnings.length > 0 && (
          <Typography sx={{ fontSize: 11, color: C.textMuted, fontFamily: FONT, mb: 1.5 }}>
            Some clinical history sources were unavailable; available records are shown below.
          </Typography>
        )}
        <ConfirmedDiagnoses
          items={clinicalHistory.data.confirmed_diagnoses || []}
          loading={clinicalHistory.loading}
        />
        <PriorPathologyCases cases={priorCases} loading={!!casesLoading} />
        <PreviousImagingStudies
          rows={clinicalHistory.data.imaging_studies || []}
          loading={clinicalHistory.loading}
        />
        <PreviousTreatments
          rows={clinicalHistory.data.treatments || []}
          loading={clinicalHistory.loading}
        />
      </SectionBox>

      <SpecimenAccessioningSection
        specimens={f.specimens}
        setSpecimens={setSpecimens}
        accessionId={accessionId}
        photoUploadId={photoUploadId}
        onPhotoUpload={handlePhotoUpload}
      />

      {completenessWarnings.length > 0 && (
        <Box sx={{ border: `1px solid ${C.border}`, background: C.bgSecondary, p: 2, mb: 2 }}>
          <Box sx={{ display: "flex", alignItems: "center", gap: 1, mb: 1 }}>
            <FactCheckRounded sx={{ fontSize: 17, color: C.black }} />
            <Typography sx={{ fontSize: 11, fontFamily: FONT, fontWeight: FW_NORMAL, textTransform: "uppercase", letterSpacing: "0.1em" }}>
              Completeness Checks
            </Typography>
          </Box>
          {completenessWarnings.map((warning) => (
            <Typography key={warning} sx={{ fontSize: 11.5, color: C.textSecond, fontFamily: FONT, mb: 0.4 }}>
              {warning}
            </Typography>
          ))}
        </Box>
      )}

      {notice && (
        <Box sx={{ display: "flex", alignItems: "center", gap: 1, mb: 2, px: 1.5, py: 1, border: `1px solid ${C.border}`, background: C.bgSecondary }}>
          <Typography sx={{ fontSize: 12, color: C.textSecond, fontFamily: FONT, flex: 1 }}>{notice}</Typography>
          <IconButton size="small" onClick={() => setNotice("")} sx={{ color: C.textMuted, p: 0.25 }}>
            <CloseRounded sx={{ fontSize: 15 }} />
          </IconButton>
        </Box>
      )}

      <Box sx={{ display: "flex", justifyContent: "flex-start" }}>
        <Button sx={saveBtnSx} onClick={handleSubmit} disabled={isSaving || busy}>
          {isSaving
            ? <CircularProgress size={14} sx={{ mr: 1, color: C.white }} />
            : <SaveRounded sx={{ mr: 0.75, fontSize: 16 }} />}
          {caseId ? "Save Case and Accessioning" : "Create Pathology Case"}
        </Button>
      </Box>
    </Box>
  );
}
