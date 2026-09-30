// tabs/RegistrationTab.jsx — Microbiology Tab 1: Specimen registration & accession
//
// Creates / edits the microbiology case (the case_register section). One document
// per case; on first save with no active case the workflow creates the case, on
// later saves it writes case_register through the whitelisted section endpoint.
//
// The tab owns its local form state (no model/normalize layer — this module is
// greenfield). Specimen IDs are compact client-minted UUID tokens; no barcode.

import React, { useState, useEffect, useMemo, useRef } from "react";
import {
  Box, Typography, TextField, Button, IconButton, CircularProgress,
  Table, TableHead, TableBody, TableRow, TableCell, TablePagination,
} from "@mui/material";
import {
  AddRounded, DeleteOutlineRounded, MicRounded, StopRounded, AutoAwesomeRounded,
} from "@mui/icons-material";
import {
  C, FONT, FW_NORMAL, inputSx, saveBtnSx, outlineBtnSx,
} from "../../shared/designTokens";
import {
  SectionBox, FG, FieldLabel, Sel, CbxGroup, RdoGroup,
} from "../../shared/FormComponents";
import {
  CASE_TYPES, PRIORITY_OPTIONS, YES_NO_UNKNOWN_OPTIONS, YES_NO_OPTIONS,
  ADEQUATE_OPTIONS, SPECIMEN_TYPE_OPTIONS, TRANSPORT_MEDIUM_OPTIONS,
  ALL_ORDERED_TESTS, testsForCaseType,
} from "../constants";
import { getPatientInfo } from "../../shared/api";
import { structureRegistration, TRANSCRIBE_URL } from "../shared/api";
import PriorMicrobiologyDialog from "../PriorMicrobiologyDialog";
import { formatShortDate, microCaseDate, specimenSummary, principalMicroFinding } from "../shared/caseHistory";

const gridSx = {
  display: "grid",
  gridTemplateColumns: { xs: "1fr", lg: "repeat(3, minmax(0, 1fr))" },
  gap: 2,
};

// ─── Previous microbiology cases (history table) ─────────────────────────────
// Read-only projection of the patient's prior case documents (the hook already
// loads them via getPatientCases). The table shows major info only; View opens
// PriorMicrobiologyDialog over the full document. Mirrors onco-pathology's
// PriorPathologyCases, paginated with MUI TablePagination.

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
function ClampedText({ text, lines = 2, width = 300 }) {
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

// Prior microbiology cases for this patient. View opens a read-only dialog
// rather than calling switchCase(), so the case being worked on is never
// displaced. The case being worked on is not "previous"; every other case for
// the patient is, including signed-out ones.
function PreviousMicrobiologyCases({ cases = [], casesLoading = false, caseId }) {
  const [page, setPage] = useState(0);
  const [rowsPerPage, setRowsPerPage] = useState(HISTORY_ROWS_PER_PAGE_OPTIONS[0]);
  // The case is kept while the dialog fades out, so its content does not blank
  // during the close transition.
  const [viewer, setViewer] = useState({ open: false, caseDoc: null });

  const priorCases = useMemo(
    () => (cases || []).filter((item) => item?.case_id && item.case_id !== caseId),
    [cases, caseId]
  );

  useEffect(() => { setPage(0); }, [priorCases.length]);

  const visibleCases = priorCases.slice(page * rowsPerPage, page * rowsPerPage + rowsPerPage);

  return (
    <Box sx={historyPanelSx}>
      <Typography sx={historyPanelTitleSx}>Previous Microbiology Cases</Typography>
      <Box sx={{ overflowX: "auto" }}>
        <Table size="small" sx={{ minWidth: 820 }}>
          <TableHead>
            <TableRow>
              {["Date", "Case Type", "Specimens", "Status", "Principal Finding"].map((label) => (
                <TableCell key={label} sx={historyThSx}>{label}</TableCell>
              ))}
              <TableCell sx={{ ...historyThSx, textAlign: "right" }}>Action</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {visibleCases.length ? visibleCases.map((item) => (
              <TableRow key={item.case_id}>
                <TableCell sx={historyTdSx}>{formatShortDate(microCaseDate(item))}</TableCell>
                <TableCell sx={historyTdSx}>{item.case_register?.case_type || "—"}</TableCell>
                <TableCell sx={historyTdSx}>{specimenSummary(item) || "—"}</TableCell>
                <TableCell sx={historyTdSx}>{item.status || "—"}</TableCell>
                <TableCell sx={historyTdSx}>
                  <ClampedText text={principalMicroFinding(item) || "Not reported"} />
                </TableCell>
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
                <TableCell colSpan={6} sx={{ fontSize: 11.5, fontFamily: FONT, color: C.textMuted, borderBottom: 0 }}>
                  {casesLoading ? "Loading microbiology cases..." : "No previous microbiology cases."}
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </Box>
      <HistoryPagination
        count={priorCases.length}
        page={page}
        rowsPerPage={rowsPerPage}
        onPageChange={setPage}
        onRowsPerPageChange={(value) => { setRowsPerPage(value); setPage(0); }}
      />
      <PriorMicrobiologyDialog
        open={viewer.open}
        caseDoc={viewer.caseDoc}
        onClose={() => setViewer((prev) => ({ ...prev, open: false }))}
      />
    </Box>
  );
}

// Compact UUID-derived token, scoped per case row. Mirrors onco-pathology's
// makeUid; short enough for specimen labels, unique enough for row identity.
const makeUid = (prefix) => {
  const uuid = globalThis.crypto?.randomUUID?.();
  const token = uuid
    ? parseInt(uuid.replace(/-/g, "").slice(0, 8), 16).toString(36).toUpperCase().padStart(7, "0")
    : `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`.toUpperCase().slice(-7);
  return `${prefix}-${token}`;
};

const blankSpecimen = () => ({
  specimen_id: makeUid("SPEC"),
  specimen_type: "",
  site_of_collection: "",
  collection_datetime: "",
  transport_medium: "",
  received_datetime: "",
  quality: {
    volume_adequate: "",
    labelling_match: "",
    container_intact: "",
    rejection_met: "No",
    rejection_reason: "",
    rejection_notified: "No",
  },
  tests_ordered: [],
});

// Blank registration shape. Merge-with-defaults (not a separate normalize model)
// so a saved case_register hydrates back into a fully-shaped form.
const blankForm = () => ({
  schema_version: "1.0",
  case_type: "",
  request: {
    requesting_clinician: "",
    requesting_department: "",
    request_datetime: "",
    priority: "Routine",
    patient_status: "",
    ward_or_opd: "",
  },
  patient: {
    patient_id: "",
    patient_name: "",
    mrn: "",
    dob: "",
    sex: "",
  },
  clinical_context: {
    presenting_complaint: "",
    relevant_history: "",
    antibiotics_started: "No",
    antibiotic_name: "",
    antibiotic_start_date: "",
  },
  specimens: [],
});

const hydrate = (data = {}, patientId = "") => {
  const base = blankForm();
  const src = data && typeof data === "object" ? data : {};
  const patient = { ...base.patient, ...(src.patient || {}) };
  if (patientId) patient.patient_id = patientId;
  const request = { ...base.request, ...(src.request || {}) };
  const ctx = { ...base.clinical_context, ...(src.clinical_context || {}) };
  const rawSpecimens = Array.isArray(src.specimens) ? src.specimens : [];
  const specimens = rawSpecimens.map((s) => {
    const specimen = { ...blankSpecimen(), ...s };
    specimen.quality = { ...blankSpecimen().quality, ...(s.quality || {}) };
    specimen.tests_ordered = Array.isArray(s.tests_ordered) ? s.tests_ordered : [];
    return specimen;
  });
  return {
    ...base,
    ...src,
    schema_version: "1.0",
    request,
    patient,
    clinical_context: ctx,
    specimens,
  };
};

const fmtSex = (v) => {
  if (!v) return "";
  const s = String(v).toLowerCase();
  if (s.startsWith("m")) return "Male";
  if (s.startsWith("f")) return "Female";
  return v;
};

// ─── Specimen dictation autofill ─────────────────────────────────────────────
// One transcript may describe several specimens. The AI response is a suggestion:
// each entry is applied only into EMPTY fields of the right row (a row that
// already carries that specimen type, else the first blank row), and a specimen
// with no home gets a new row appended. Nothing already entered is overwritten,
// nothing is ever cleared, and tests are union-added (never removed).

// A datetime-local input only accepts YYYY-MM-DDTHH:MM. Normalize whatever the
// model returned into that shape; return "" when it isn't a datetime at all, so
// a malformed value is dropped (left for manual entry) rather than written.
const toDateTimeLocal = (value) => {
  const m = String(value ?? "").trim().match(/^(\d{4})-(\d{1,2})-(\d{1,2})T(\d{1,2}):(\d{2})$/);
  if (!m) return "";
  return `${m[1]}-${m[2].padStart(2, "0")}-${m[3].padStart(2, "0")}T${m[4].padStart(2, "0")}:${m[5]}`;
};

const VALID_TEST_KEYS = new Set(ALL_ORDERED_TESTS.map((t) => t.value));

// Snap free-text dictation to a real dropdown option (normalized exact match,
// then a contained-substring fallback). Returns "" when nothing matches so a
// <Select> never receives an out-of-range value.
const coerceEnum = (value, options) => {
  const canon = (s) => String(s ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");
  const target = canon(value);
  if (!target) return "";
  return (
    options.find((o) => canon(o) === target)
    || options.find((o) => {
      const c = canon(o);
      return c.length >= 3 && (target.includes(c) || c.includes(target));
    })
    || ""
  );
};

// Can this entry actually put at least one value into a row? (Keeps a dictation
// that resolved to nothing — e.g. an unlistable specimen type with no other
// detail — from swallowing a blank row or spawning an empty one.)
const usableEntry = (entry) => {
  const text = (k) => entry[k] !== undefined && entry[k] !== null && String(entry[k]).trim() !== "";
  return coerceEnum(entry.specimen_type, SPECIMEN_TYPE_OPTIONS) !== ""
    || text("site_of_collection")
    || coerceEnum(entry.transport_medium, TRANSPORT_MEDIUM_OPTIONS) !== ""
    || toDateTimeLocal(entry.collection_datetime) !== ""
    || toDateTimeLocal(entry.received_datetime) !== ""
    || (Array.isArray(entry.tests_ordered) && entry.tests_ordered.some((t) => VALID_TEST_KEYS.has(t)));
};

const mergeSpecimens = (rows, incoming) => {
  const next = rows.map((s) => ({
    ...s,
    quality: { ...s.quality },
    tests_ordered: Array.isArray(s.tests_ordered) ? [...s.tests_ordered] : [],
  }));
  const used = new Set();
  let applied = 0;
  let created = 0;

  const rowHasWork = (row, entry) => {
    const fieldKeys = [
      "specimen_type", "site_of_collection", "transport_medium",
      "collection_datetime", "received_datetime",
    ];
    const hasScalarWork = fieldKeys.some((k) => {
      if (row[k] || entry[k] === undefined || entry[k] === null) return false;
      return String(entry[k]).trim() !== "";
    });
    const hasTestWork = (Array.isArray(entry.tests_ordered) ? entry.tests_ordered : [])
      .some((t) => VALID_TEST_KEYS.has(t) && !row.tests_ordered.includes(t));
    return hasScalarWork || hasTestWork;
  };

  incoming.forEach((entry) => {
    if (!usableEntry(entry)) return;

    // 1. an unused row already carrying this specimen type that still has room;
    // 2. otherwise the first unused, not-yet-typed row;
    // 3. otherwise a new row is added for this dictated specimen.
    let target = -1;
    const type = coerceEnum(entry.specimen_type, SPECIMEN_TYPE_OPTIONS);
    if (type) {
      target = next.findIndex((r, i) => !used.has(i) && r.specimen_type === type && rowHasWork(r, entry));
    }
    if (target === -1) {
      target = next.findIndex((r, i) => !used.has(i) && !r.specimen_type);
    }
    if (target === -1) {
      next.push(blankSpecimen());
      target = next.length - 1;
      created += 1;
    }
    used.add(target);
    const row = next[target];

    const take = (key, value) => {
      if (row[key] || value === undefined || value === null || String(value).trim() === "") return;
      row[key] = String(value).trim();
      applied += 1;
    };
    const takeEnum = (key, value, options) => {
      if (row[key]) return;
      const snap = coerceEnum(value, options);
      if (!snap) return;
      row[key] = snap;
      applied += 1;
    };
    const takeDate = (key, value) => {
      if (row[key]) return;
      const v = toDateTimeLocal(value);
      if (!v) return;
      row[key] = v;
      applied += 1;
    };

    takeEnum("specimen_type", type, SPECIMEN_TYPE_OPTIONS);
    take("site_of_collection", entry.site_of_collection);
    takeEnum("transport_medium", entry.transport_medium, TRANSPORT_MEDIUM_OPTIONS);
    takeDate("collection_datetime", entry.collection_datetime);
    takeDate("received_datetime", entry.received_datetime);

    (Array.isArray(entry.tests_ordered) ? entry.tests_ordered : []).forEach((t) => {
      if (VALID_TEST_KEYS.has(t) && !row.tests_ordered.includes(t)) {
        row.tests_ordered.push(t);
        applied += 1;
      }
    });
  });

  return { rows: next, applied, created };
};

export default function RegistrationTab({
  patientId,
  doctorId,
  doctorName,
  caseId,
  initialData,
  cases = [],
  casesLoading = false,
  onSave,
}) {
  const [f, setF] = useState(() => hydrate(initialData, patientId));
  const [isSaving, setIsSaving] = useState(false);
  const [notice, setNotice] = useState("");
  const [transcript, setTranscript] = useState("");
  const [isRecording, setIsRecording] = useState(false);
  const [isTranscribing, setIsTranscribing] = useState(false);
  const [isAutofilling, setIsAutofilling] = useState(false);
  const mediaRecorderRef = useRef(null);
  const audioChunksRef = useRef([]);
  // Latest form snapshot for the async autofill handler to read current rows.
  const fRef = useRef(f);
  fRef.current = f;

  // No rehydrate-on-`initialData` effect here: the workflow mounts this tab under
  // a `key` derived from the active case, so a case switch/creation remounts the
  // component and the useState initializer re-hydrates from the fresh initialData.
  // Watching initialData identity instead would wipe the form on unrelated parent
  // re-renders (initialData is a fresh `{}` while no case exists).

  // Patient profile prefill (read-only): name / MRN / DOB / sex from the HMS
  // patient_users record via the shared getPatientInfo helper. Fills empty fields
  // only — never overwrites a patient already saved on the case.
  useEffect(() => {
    if (!patientId) return;
    let cancelled = false;
    getPatientInfo(patientId)
      .then((info) => {
        if (cancelled || !info) return;
        setF((prev) => ({
          ...prev,
          patient: {
            ...prev.patient,
            patient_id: patientId,
            patient_name: prev.patient.patient_name || info.patient_name || info.name || "",
            mrn: prev.patient.mrn || info.mrn || info.hms_id || "",
            dob: prev.patient.dob || info.date_of_birth || info.dob || "",
            sex: prev.patient.sex || (info.gender ? fmtSex(info.gender) : ""),
          },
        }));
      })
      .catch((err) => console.error("[RegistrationTab] patient info:", err));
    return () => { cancelled = true; };
  }, [patientId]);

  const setGroup = (group) => (patch) =>
    setF((prev) => ({ ...prev, [group]: { ...prev[group], ...patch } }));

  const setPatient = setGroup("patient");
  const setRequest = setGroup("request");
  const setContext = setGroup("clinical_context");

  const setSpecimen = (index, patch) =>
    setF((prev) => {
      const specimens = prev.specimens.map((s, i) => (i === index ? { ...s, ...patch } : s));
      return { ...prev, specimens };
    });

  const setSpecimenQuality = (index, patch) =>
    setF((prev) => {
      const specimens = prev.specimens.map((s, i) =>
        i === index ? { ...s, quality: { ...s.quality, ...patch } } : s
      );
      return { ...prev, specimens };
    });

  const addSpecimen = () =>
    setF((prev) => ({ ...prev, specimens: [...prev.specimens, blankSpecimen()] }));

  const removeSpecimen = (index) =>
    setF((prev) => ({ ...prev, specimens: prev.specimens.filter((_, i) => i !== index) }));

  const setTests = (index, value) => setSpecimen(index, { tests_ordered: value });

  const availableTests = testsForCaseType(f.case_type);

  // The case-type filter flattens the catalogue, so re-cluster the offered tests
  // back into their catalogue groups for display. Order follows the catalogue.
  const availableTestGroups = useMemo(() => {
    const groups = [];
    availableTests.forEach((t) => {
      let g = groups.find((x) => x.label === t.group);
      if (!g) {
        g = { label: t.group, tests: [] };
        groups.push(g);
      }
      g.tests.push({ value: t.value, label: t.label });
    });
    return groups;
  }, [availableTests]);

  // ─── Specimen dictation (speech-to-text + AI autofill) ─────────────────────
  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      mediaRecorderRef.current = new MediaRecorder(stream);
      audioChunksRef.current = [];
      mediaRecorderRef.current.ondataavailable = (event) => {
        if (event.data.size > 0) audioChunksRef.current.push(event.data);
      };
      mediaRecorderRef.current.start();
      setIsRecording(true);
    } catch (error) {
      console.error("[RegistrationTab] microphone:", error);
      setNotice("Microphone access is unavailable.");
    }
  };

  const stopRecording = () => {
    if (!mediaRecorderRef.current || !isRecording) return;
    mediaRecorderRef.current.onstop = async () => {
      setIsRecording(false);
      setIsTranscribing(true);
      const audioBlob = new Blob(audioChunksRef.current, { type: "audio/webm" });
      audioChunksRef.current = [];
      try {
        const formData = new FormData();
        formData.append("file", audioBlob, "recording.webm");
        const response = await fetch(TRANSCRIBE_URL, { method: "POST", body: formData });
        if (!response.ok) throw new Error(`Transcription failed (${response.status})`);
        const data = await response.json();
        const text = data.text || data.transcription || "";
        if (text) setTranscript((current) => (current ? `${current} ${text}` : text));
        else setNotice("Nothing was heard — try again.");
      } catch (error) {
        console.error("[RegistrationTab] transcription:", error);
        setNotice("Specimen dictation transcription failed.");
      } finally {
        setIsTranscribing(false);
      }
    };
    mediaRecorderRef.current.stop();
    mediaRecorderRef.current.stream.getTracks().forEach((track) => track.stop());
  };

  const handleAutofill = async () => {
    const text = transcript.trim();
    if (!text || isAutofilling) return;
    setIsAutofilling(true);
    setNotice("");
    try {
      const response = await structureRegistration(text);
      const incoming = Array.isArray(response?.data?.specimens) ? response.data.specimens : [];
      if (incoming.length === 0) {
        setNotice("No specimen details were recognised in the dictation.");
        return;
      }
      const { rows, applied, created } = mergeSpecimens(fRef.current.specimens, incoming);
      setF((prev) => ({ ...prev, specimens: rows }));
      if (applied === 0 && created === 0) {
        setNotice("Dictation matched only fields that are already filled — nothing was overwritten.");
      } else {
        setNotice(
          `Applied ${applied} dictated value${applied === 1 ? "" : "s"} to empty specimen fields`
          + (created > 0 ? ` — added ${created} new specimen row${created === 1 ? "" : "s"}` : "") + "."
        );
      }
    } catch (error) {
      console.error("[RegistrationTab] structure:", error);
      setNotice("Specimen dictation structuring failed.");
    } finally {
      setIsAutofilling(false);
    }
  };

  const busy = isRecording || isTranscribing || isAutofilling;

  const handleSave = async () => {
    if (!f.case_type) { setNotice("Select a case type before saving."); return; }
    if (f.specimens.length === 0) { setNotice("Add at least one specimen."); return; }
    setNotice("");
    setIsSaving(true);
    try {
      await onSave("registration", f);
    } catch (err) {
      console.error("[RegistrationTab] save error:", err);
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <Box>
      {/* ─── Previous microbiology cases (history) ────────────────────────── */}
      <PreviousMicrobiologyCases cases={cases} casesLoading={casesLoading} caseId={caseId} />

      {/* ─── Case type (drives downstream tab activation) ─────────────────── */}
      <SectionBox title="Case Type">
        <FG cols={2}>
          <Box>
            <FieldLabel>Case type</FieldLabel>
            <Sel
              label="Case type"
              options={CASE_TYPES}
              value={f.case_type}
              onChange={(v) => setF((prev) => ({ ...prev, case_type: v }))}
            />
          </Box>
        </FG>
        <Typography sx={{ fontSize: 12, color: C.textMuted, fontFamily: FONT }}>
          The case type activates the relevant analytical tracks (culture, molecular, serology,
          mycobacteriology, parasitology, mycology, virology, anaerobic) and suppresses the rest.
        </Typography>
      </SectionBox>

      {/* ─── Patient & request context ────────────────────────────────────── */}
      <SectionBox title="Patient & Request">
        <Box sx={gridSx}>
          <Box>
            <FieldLabel>Patient Name</FieldLabel>
            <TextField value={f.patient.patient_name} size="small" fullWidth InputProps={{ readOnly: true }} placeholder="Auto-populated" sx={inputSx} />
          </Box>
          <Box>
            <FieldLabel>MRD</FieldLabel>
            <TextField value={f.patient.mrn} size="small" fullWidth InputProps={{ readOnly: true }} placeholder="Auto-populated" sx={inputSx} />
          </Box>
          <Box>
            <FieldLabel>DOB</FieldLabel>
            <TextField value={f.patient.dob} size="small" fullWidth InputProps={{ readOnly: true }} placeholder="Auto-populated" sx={inputSx} />
          </Box>
          <Box>
            <FieldLabel>Sex</FieldLabel>
            <TextField value={f.patient.sex} size="small" fullWidth InputProps={{ readOnly: true }} placeholder="Auto-populated" sx={inputSx} />
          </Box>
          <Box>
            <FieldLabel>Patient status</FieldLabel>
            <Sel label="IP / OP" options={["IP", "OP"]} value={f.request.patient_status} onChange={(v) => setRequest({ patient_status: v })} />
          </Box>
          <Box>
            <FieldLabel>Ward / OPD</FieldLabel>
            <TextField size="small" fullWidth sx={inputSx} placeholder="e.g. Ward 4B, Room 12" value={f.request.ward_or_opd} onChange={(e) => setRequest({ ward_or_opd: e.target.value })} />
          </Box>
        </Box>

        <Box sx={{ ...gridSx, mt: 2 }}>
          <Box>
            <FieldLabel>Requesting clinician</FieldLabel>
            <TextField size="small" fullWidth sx={inputSx} placeholder={doctorName || "Clinician name"} value={f.request.requesting_clinician} onChange={(e) => setRequest({ requesting_clinician: e.target.value })} />
          </Box>
          <Box>
            <FieldLabel>Requesting department</FieldLabel>
            <TextField size="small" fullWidth sx={inputSx} placeholder="e.g. Medicine / ICU" value={f.request.requesting_department} onChange={(e) => setRequest({ requesting_department: e.target.value })} />
          </Box>
          <Box>
            <FieldLabel>Request datetime</FieldLabel>
            <TextField size="small" fullWidth type="datetime-local" sx={inputSx} value={f.request.request_datetime} onChange={(e) => setRequest({ request_datetime: e.target.value })} InputLabelProps={{ shrink: true }} />
          </Box>
          <Box>
            <FieldLabel>Priority</FieldLabel>
            <Sel label="Priority" options={PRIORITY_OPTIONS} value={f.request.priority} onChange={(v) => setRequest({ priority: v })} />
          </Box>
        </Box>
      </SectionBox>

      {/* ─── Clinical context ─────────────────────────────────────────────── */}
      <SectionBox title="Clinical Context">
        <FG cols={2}>
          <Box>
            <FieldLabel>Presenting complaint</FieldLabel>
            <TextField size="small" fullWidth multiline rows={2} sx={inputSx} value={f.clinical_context.presenting_complaint} onChange={(e) => setContext({ presenting_complaint: e.target.value })} />
          </Box>
          <Box>
            <FieldLabel>Relevant history</FieldLabel>
            <TextField size="small" fullWidth multiline rows={2} sx={inputSx} value={f.clinical_context.relevant_history} onChange={(e) => setContext({ relevant_history: e.target.value })} />
          </Box>
        </FG>

        <Box sx={{ border: `1px solid ${C.border}`, p: 2, mb: 0 }}>
          <Typography sx={{ fontSize: 11, textTransform: "uppercase", letterSpacing: "0.12em", color: C.textSecond, fontFamily: FONT, mb: 1 }}>
            Empirical antibiotics already started <Typography component="span" sx={{ fontFamily: FONT, fontSize: 10, color: C.textMuted, textTransform: "none", letterSpacing: 0 }}>(critical for culture interpretation — CLSI M47)</Typography>
          </Typography>
          <RdoGroup label="" options={YES_NO_UNKNOWN_OPTIONS} value={f.clinical_context.antibiotics_started} onChange={(v) => setContext({ antibiotics_started: v })} row />
          {(f.clinical_context.antibiotics_started === "Yes" || f.clinical_context.antibiotics_started === "Unknown") && (
            <Box sx={{ ...gridSx, mt: 1.5 }}>
              <Box>
                <FieldLabel>Antibiotic name</FieldLabel>
                <TextField size="small" fullWidth sx={inputSx} value={f.clinical_context.antibiotic_name} onChange={(e) => setContext({ antibiotic_name: e.target.value })} />
              </Box>
              <Box>
                <FieldLabel>Start date</FieldLabel>
                <TextField size="small" fullWidth type="date" sx={inputSx} value={f.clinical_context.antibiotic_start_date} onChange={(e) => setContext({ antibiotic_start_date: e.target.value })} InputLabelProps={{ shrink: true }} />
              </Box>
            </Box>
          )}
        </Box>
      </SectionBox>

      {/* ─── Specimen table ───────────────────────────────────────────────── */}
      <SectionBox title="Specimens">
        {/* Speech-to-text specimen dictation — fills empty fields only */}
        <Box sx={{ border: `1px solid ${C.border}`, background: C.bgSecondary, p: 2, mb: 2.5 }}>
          <Typography sx={{ fontSize: 11, textTransform: "uppercase", letterSpacing: "0.12em", color: C.textSecond, fontFamily: FONT, mb: 1 }}>
            Speech-to-text specimen dictation
          </Typography>
          <TextField
            multiline
            minRows={3}
            fullWidth
            size="small"
            placeholder='Dictate or type the specimen details, e.g. "midstream urine from ward 4B, collected 8 am, gram stain and aerobic culture; blood culture…". Autofill fills empty specimen fields only — nothing already entered is overwritten or cleared.'
            value={transcript}
            onChange={(e) => setTranscript(e.target.value)}
            sx={{ ...inputSx, background: C.white }}
          />
          <Box sx={{ display: "flex", gap: 1.5, mt: 1.5, flexWrap: "wrap", alignItems: "center" }}>
            <Button
              sx={{
                ...outlineBtnSx,
                background: isRecording ? "#cf1322" : C.white,
                color: isRecording ? C.white : C.black,
                borderColor: isRecording ? "#cf1322" : C.black,
                "&:hover": { background: isRecording ? "#a8071a" : C.bgTertiary },
              }}
              onClick={isRecording ? stopRecording : startRecording}
              disabled={isTranscribing || isAutofilling}
            >
              {isRecording ? <StopRounded sx={{ mr: 0.75, fontSize: 16 }} /> : <MicRounded sx={{ mr: 0.75, fontSize: 16 }} />}
              {isTranscribing ? "Transcribing..." : isRecording ? "Stop Recording" : "Start Recording"}
            </Button>
            <Button sx={outlineBtnSx} onClick={handleAutofill} disabled={busy || !transcript.trim()}>
              {isAutofilling ? <CircularProgress size={14} sx={{ mr: 1, color: C.black }} /> : <AutoAwesomeRounded sx={{ mr: 0.75, fontSize: 16 }} />}
              AI Autofill Empty Specimen Fields
            </Button>
          </Box>
        </Box>

        {f.specimens.length === 0 && (
          <Typography sx={{ fontSize: 12, color: C.textMuted, fontFamily: FONT, mb: 1.5 }}>
            No specimens added yet. Each specimen submitted in this request is a separate row.
          </Typography>
        )}

        {f.specimens.map((sp, i) => (
          <Box key={sp.specimen_id} sx={{ border: `1px solid ${C.border}`, mb: 2, background: C.bgSecondary }}>
            <Box sx={{ px: 2, py: 1, display: "flex", alignItems: "center", justifyContent: "space-between", borderBottom: `1px solid ${C.border}` }}>
              <Typography sx={{ fontFamily: FONT, fontSize: 11, letterSpacing: "0.08em", textTransform: "uppercase", color: C.textSecond }}>
                Specimen {i + 1}
              </Typography>
              <Box sx={{ display: "flex", alignItems: "center", gap: 1.5 }}>
                <Typography sx={{ fontFamily: FONT, fontSize: 10, color: C.textMuted }}>{sp.specimen_id}</Typography>
                <IconButton size="small" onClick={() => removeSpecimen(i)} sx={{ color: C.textSecond, "&:hover": { color: C.black } }}><DeleteOutlineRounded fontSize="small" /></IconButton>
              </Box>
            </Box>

            <Box sx={{ p: 2 }}>
              <Box sx={gridSx}>
                <Box>
                  <FieldLabel>Specimen type</FieldLabel>
                  <Sel label="Specimen type" options={SPECIMEN_TYPE_OPTIONS} value={sp.specimen_type} onChange={(v) => setSpecimen(i, { specimen_type: v })} />
                </Box>
                <Box>
                  <FieldLabel>Site of collection</FieldLabel>
                  <TextField size="small" fullWidth sx={inputSx} placeholder="e.g. right knee joint / port-A line" value={sp.site_of_collection} onChange={(e) => setSpecimen(i, { site_of_collection: e.target.value })} />
                </Box>
                <Box>
                  <FieldLabel>Transport medium / device</FieldLabel>
                  <Sel label="Transport medium" options={TRANSPORT_MEDIUM_OPTIONS} value={sp.transport_medium} onChange={(v) => setSpecimen(i, { transport_medium: v })} />
                </Box>
                <Box>
                  <FieldLabel>Collection datetime</FieldLabel>
                  <TextField size="small" fullWidth type="datetime-local" sx={inputSx} value={sp.collection_datetime} onChange={(e) => setSpecimen(i, { collection_datetime: e.target.value })} InputLabelProps={{ shrink: true }} />
                </Box>
                <Box>
                  <FieldLabel>Received datetime</FieldLabel>
                  <TextField size="small" fullWidth type="datetime-local" sx={inputSx} value={sp.received_datetime} onChange={(e) => setSpecimen(i, { received_datetime: e.target.value })} InputLabelProps={{ shrink: true }} />
                </Box>
              </Box>

              {/* Specimen quality check at receipt */}
              <Box sx={{ mt: 2, border: `1px solid ${C.border}`, p: 2, background: C.white }}>
                <Typography sx={{ fontSize: 11, textTransform: "uppercase", letterSpacing: "0.12em", color: C.textSecond, fontFamily: FONT, mb: 1 }}>
                  Specimen quality check at receipt
                </Typography>
                <Box sx={{ display: "grid", gridTemplateColumns: { xs: "1fr", md: "repeat(3, 1fr)" }, gap: 2 }}>
                  <Box>
                    <FieldLabel>Volume adequate</FieldLabel>
                    <Sel label="Volume adequate" options={ADEQUATE_OPTIONS} value={sp.quality.volume_adequate} onChange={(v) => setSpecimenQuality(i, { volume_adequate: v })} />
                  </Box>
                  <Box>
                    <FieldLabel>Labelling match</FieldLabel>
                    <Sel label="Labelling match" options={YES_NO_OPTIONS} value={sp.quality.labelling_match} onChange={(v) => setSpecimenQuality(i, { labelling_match: v })} />
                  </Box>
                  <Box>
                    <FieldLabel>Container intact</FieldLabel>
                    <Sel label="Container intact" options={YES_NO_OPTIONS} value={sp.quality.container_intact} onChange={(v) => setSpecimenQuality(i, { container_intact: v })} />
                  </Box>
                </Box>
                <Box sx={{ mt: 1.5 }}>
                  <RdoGroup label="Rejection criteria met" options={YES_NO_OPTIONS} value={sp.quality.rejection_met} onChange={(v) => setSpecimenQuality(i, { rejection_met: v })} row />
                  {sp.quality.rejection_met === "Yes" && (
                    <Box sx={{ ...gridSx, mt: 1 }}>
                      <Box>
                        <FieldLabel>Rejection reason</FieldLabel>
                        <TextField size="small" fullWidth multiline rows={2} sx={inputSx} value={sp.quality.rejection_reason} onChange={(e) => setSpecimenQuality(i, { rejection_reason: e.target.value })} />
                      </Box>
                      <Box>
                        <FieldLabel>Clinician notified</FieldLabel>
                        <Sel label="Notified" options={YES_NO_OPTIONS} value={sp.quality.rejection_notified} onChange={(v) => setSpecimenQuality(i, { rejection_notified: v })} />
                      </Box>
                    </Box>
                  )}
                </Box>
              </Box>

              {/* Ordered tests, filtered by case type */}
              <Box sx={{ mt: 2 }}>
                <FieldLabel>Tests ordered</FieldLabel>
                {availableTests.length > 0 ? (
                  <Box sx={{ display: "flex", flexDirection: "column", gap: 1.25 }}>
                    {availableTestGroups.map((g) => (
                      <CbxGroup
                        key={g.label}
                        label={g.label}
                        options={g.tests}
                        value={sp.tests_ordered}
                        onChange={(v) => setTests(i, v)}
                      />
                    ))}
                  </Box>
                ) : (
                  <Typography sx={{ fontSize: 12, color: C.textMuted, fontFamily: FONT }}>
                    No tests available for this case type yet.
                  </Typography>
                )}
              </Box>
            </Box>
          </Box>
        ))}

        <Button onClick={addSpecimen} sx={{ ...outlineBtnSx, px: 2.5 }}>
          <AddRounded sx={{ mr: 0.75, fontSize: 18 }} /> Add Specimen
        </Button>
      </SectionBox>

      {notice && (
        <Box sx={{ mb: 2, px: 2, py: 1.25, border: `1px solid ${C.border}`, background: C.bgTertiary }}>
          <Typography sx={{ fontSize: 12.5, fontFamily: FONT, color: C.textSecond }}>{notice}</Typography>
        </Box>
      )}

      <Box sx={{ display: "flex", justifyContent: "flex-end", gap: 1.5, pb: 1 }}>
        <Button onClick={handleSave} disabled={isSaving} sx={{ ...saveBtnSx, px: 4 }}>
          {isSaving ? "Saving…" : caseId ? "Save Registration" : "Create Case"}
        </Button>
      </Box>
    </Box>
  );
}
