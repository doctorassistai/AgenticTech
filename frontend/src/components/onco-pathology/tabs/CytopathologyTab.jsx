import React, { useEffect, useMemo, useRef, useState } from "react";
import { Box, Button, CircularProgress, IconButton, TextField, Typography } from "@mui/material";
import { AddRounded, AutoAwesomeRounded, CheckRounded, CloseRounded, DeleteOutlineRounded, FactCheckRounded, LightbulbRounded, MicRounded, SaveRounded, StopRounded } from "@mui/icons-material";
import { C, FONT, FW_LIGHT, FW_NORMAL, inputSx, outlineBtnSx, saveBtnSx, sectionHeaderSx } from "../../shared/designTokens";
import { CbxGroup, FG, FieldLabel, FlagNote, SectionBox, Sel } from "../../shared/FormComponents";
import ClinicalPosturePanel from "../ClinicalPosturePanel";
import { getClinicalPosture, recommendCytopathology, structureCytopathology } from "../shared/api";
import {
  ADEQUACY_OPTIONS,
  ANCILLARY_TEST_OPTIONS,
  BACKGROUND_OPTIONS,
  COLLECTION_METHOD_OPTIONS,
  CYTOLOGY_SPECIMEN_TYPES,
  PREPARATION_METHOD_OPTIONS,
  REPORTING_SYSTEM_OPTIONS,
  REPORT_STATUS_OPTIONS,
  ROSE_RESULT_OPTIONS,
  YES_NO_OPTIONS,
  cytologySpecimens,
  caseRegistrySpecimens,
  cytologyAncillaryWork,
  diagnosticCategoriesFor,
  hasMeaningfulCytologyContent,
  makeCellBlockId,
  makeCytologyImage,
  makeCytologyRecord,
  mergeCytopathologyExtraction,
  mergeCytopathologyReport,
  syncCytopathology,
} from "../shared/cytopathologyModel";
import { tabApplicability } from "../shared/caseClass";
import { validateCytopathologyCompleteness } from "../shared/capValidation";
import CapValidationDialog from "../CapValidationDialog";
import SlideImageViewer from "../SlideImageViewer";

const API_BASE_URL = import.meta.env.VITE_BACKEND_URL || "https://doctorassist.ai/api/";

// A long dictation used to report the same "fields were filled" message whether it
// filled thirty fields or two. This says what actually landed, and what did not.
const autofillNotice = (label, { filled, unmatched }, failedGroups = []) => {
  const parts = [`Dictation filled ${filled.length} ${label} field${filled.length === 1 ? "" : "s"}.`];
  if (unmatched.length) {
    parts.push(
      `${unmatched.length} spoken value${unmatched.length === 1 ? " was" : "s were"} not applied — either you had `
      + "already recorded that field, or the value matched no dropdown option. Set those manually.",
    );
  }
  if (failedGroups.length) {
    parts.push(
      `${failedGroups.length} extraction pass${failedGroups.length === 1 ? "" : "es"} failed `
      + `(${failedGroups.join("; ")}) — re-run, or fill those fields manually.`,
    );
  }
  parts.push("Confirm every value before sign-off.");
  return parts.join(" ");
};

const LineField = ({ label, value, onChange, type = "text", placeholder }) => (
  <Box>
    <FieldLabel>{label}</FieldLabel>
    <TextField type={type} value={value || ""} onChange={(event) => onChange(event.target.value)} size="small" fullWidth placeholder={placeholder} InputLabelProps={type === "datetime-local" ? { shrink: true } : undefined} sx={inputSx} />
  </Box>
);

const TextArea = ({ label, value, onChange, placeholder, rows = 2 }) => (
  <Box>
    <FieldLabel>{label}</FieldLabel>
    <TextField value={value || ""} onChange={(event) => onChange(event.target.value)} size="small" fullWidth multiline minRows={rows} placeholder={placeholder} sx={inputSx} />
  </Box>
);

const SourceValue = ({ label, value }) => (
  <Box>
    <FieldLabel>{label}</FieldLabel>
    <TextField value={value || "Not recorded"} size="small" fullWidth InputProps={{ readOnly: true }} sx={inputSx} />
  </Box>
);

// A bordered sub-card with an uppercase header bar, used to group the fields that
// belong to one stage of a cytology record. Nested inside the record card for a
// two-level hierarchy.
const RecordSection = ({ title, children }) => (
  <Box sx={{ border: `1px solid ${C.border}`, mb: 2, background: C.white }}>
    <Box sx={sectionHeaderSx}>{title}</Box>
    <Box sx={{ p: 2.5 }}>{children}</Box>
  </Box>
);

const ItemHeader = ({ title, subtitle, onRemove }) => (
  <Box sx={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 1, mb: 1.5 }}>
    <Box>
      <Typography sx={{ fontFamily: FONT, fontSize: 13, fontWeight: FW_NORMAL }}>{title}</Typography>
      {subtitle && <Typography sx={{ fontFamily: FONT, fontSize: 11, color: C.textMuted }}>{subtitle}</Typography>}
    </Box>
    {onRemove && <IconButton size="small" title="Remove cytology record" onClick={onRemove} sx={{ color: C.textSecond }}><DeleteOutlineRounded fontSize="small" /></IconButton>}
  </Box>
);

const SuggestionRow = ({ title, reason, source, confidence, status, onAccept, onDismiss }) => (
  <Box sx={{ borderTop: `1px solid ${C.border}`, py: 1.5, "&:first-of-type": { borderTop: 0 } }}>
    <Box sx={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 2, flexWrap: "wrap" }}>
      <Box sx={{ minWidth: 0, flex: 1 }}>
        <Typography sx={{ fontFamily: FONT, fontSize: 13, fontWeight: FW_NORMAL }}>{title}</Typography>
        {reason && <Typography sx={{ fontFamily: FONT, fontSize: 12, color: C.textSecond, mt: 0.5 }}>{reason}</Typography>}
        <Typography sx={{ fontFamily: FONT, fontSize: 11, color: C.textMuted, mt: 0.75 }}>{source || "Source not supplied"} | Confidence: {confidence || "Moderate"}</Typography>
      </Box>
      {status === "Suggested" ? (
        <Box sx={{ display: "flex", gap: 1, flexShrink: 0 }}>
          <Button sx={{ ...outlineBtnSx, px: 1.5, py: 0.5 }} onClick={onAccept}><CheckRounded sx={{ mr: 0.5, fontSize: 15 }} /> Accept</Button>
          <Button sx={{ ...outlineBtnSx, px: 1.5, py: 0.5 }} onClick={onDismiss}><CloseRounded sx={{ mr: 0.5, fontSize: 15 }} /> Dismiss</Button>
        </Box>
      ) : <Typography sx={{ fontFamily: FONT, fontSize: 11, color: C.textSecond }}>{status}</Typography>}
    </Box>
  </Box>
);

const SUGGESTION_GROUPS = [
  ["reporting_system_suggestions", "Reporting System Suggestions"],
  ["adequacy_action_suggestions", "Adequacy / Repeat Collection Suggestions"],
  ["ancillary_test_suggestions", "Cell Block and Ancillary Test Suggestions"],
  // Only populated when the clinical posture records an actual prior exposure —
  // treatment-related atypia is a real trap in cytology, but only when there was
  // treatment.
  ["therapy_related_suggestions", "Prior-Therapy Considerations"],
  ["reporting_suggestions", "Report Draft Suggestions"],
];

const SPREAD_FIELDS = [
  ["local_extent_recorded", "Local extent"],
  ["regional_spread_recorded", "Regional spread"],
  ["distant_spread_recorded", "Distant spread"],
  ["consistency_with_expected_pattern", "Versus expected pattern"],
];

const RecommendationPanel = ({ run, canGenerate, isGenerating, onGenerate, onAccept, onDismiss }) => (
  <Box sx={{ mt: 2, borderTop: `1px solid ${C.border}`, pt: 1.5 }}>
    <Box sx={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 2, flexWrap: "wrap", mb: run ? 2 : 0 }}>
      <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}><LightbulbRounded sx={{ fontSize: 18, color: C.black }} /><Typography sx={{ fontFamily: FONT, fontSize: 12, color: C.textSecond }}>Advisory record review; no image scoring or auto-application</Typography></Box>
      <Button sx={outlineBtnSx} onClick={onGenerate} disabled={!canGenerate || isGenerating}>{isGenerating ? <CircularProgress size={14} sx={{ mr: 1, color: C.black }} /> : <AutoAwesomeRounded sx={{ mr: 0.75, fontSize: 16 }} />} Review Cytology With AI</Button>
    </Box>
    {!canGenerate && <Typography sx={{ fontFamily: FONT, fontSize: 11, color: C.textMuted }}>Record meaningful adequacy, ROSE, cellularity, morphology, reporting system, or diagnosis before starting review.</Typography>}
    {run && <>
      <Box sx={{ border: `1px solid ${C.border}`, background: C.bgSecondary, p: 1.5, mb: 2 }}>
        <Typography sx={{ fontFamily: FONT, fontSize: 12, fontWeight: FW_NORMAL }}>Cytopathology record review</Typography>
        <Typography sx={{ fontFamily: FONT, fontSize: 11, color: C.textMuted, mt: 0.5 }}>Mode {run.assistant_mode || "cytology_record_review"} | Engine {run.engine_version || ""} | {run.review_status || "Requires clinician review"}</Typography>
        {(run.case_summary || "").trim() && <Typography sx={{ fontFamily: FONT, fontSize: 11, color: C.textSecond, mt: 0.5 }}>{run.case_summary}</Typography>}
        {(run.source_families || []).map((source) => <Typography key={source} sx={{ fontFamily: FONT, fontSize: 11, color: C.textSecond, mt: 0.5 }}>{source}</Typography>)}
        {(run.missing_information || []).length > 0 && <FlagNote>Missing information: {run.missing_information.join("; ")}</FlagNote>}
        {(run.warnings || []).length > 0 && <FlagNote>{run.warnings.join(" ")}</FlagNote>}
      </Box>
      {/* An effusion, washing or node aspirate can itself be the evidence of
          spread, so cytology carries the spread read-out too. Read-only. */}
      {run.spread_assessment && (
        <Box sx={{ border: `1px solid ${C.border}`, p: 1.5, mb: 2 }}>
          <FieldLabel>What The Recorded Material Establishes About Spread</FieldLabel>
          <Box sx={{ display: "flex", flexWrap: "wrap", gap: 3, mt: 0.75 }}>
            {SPREAD_FIELDS.map(([key, label]) => (
              <Box key={key}>
                <Typography sx={{ fontFamily: FONT, fontSize: 10, letterSpacing: "0.08em", textTransform: "uppercase", color: C.textMuted }}>{label}</Typography>
                <Typography sx={{ fontFamily: FONT, fontSize: 13, mt: 0.25 }}>{run.spread_assessment[key] || "Cannot assess"}</Typography>
              </Box>
            ))}
          </Box>
          {run.spread_assessment.explanation && (
            <Typography sx={{ fontFamily: FONT, fontSize: 12, color: C.textSecond, lineHeight: 1.7, mt: 1 }}>{run.spread_assessment.explanation}</Typography>
          )}
        </Box>
      )}
      {SUGGESTION_GROUPS.map(([key, heading]) => {
        const items = run[key] || [];
        if (!items.length) return null;
        return <Box key={key} sx={{ mb: 2 }}><FieldLabel>{heading}</FieldLabel>{items.map((suggestion) => <SuggestionRow key={suggestion.suggestion_id} title={suggestion.item} reason={suggestion.reason} source={suggestion.source_name} confidence={suggestion.confidence} status={suggestion.review_status} onAccept={() => onAccept(key, suggestion.suggestion_id, "Accepted")} onDismiss={() => onDismiss(key, suggestion.suggestion_id, "Dismissed")} />)}</Box>;
      })}
    </>}
  </Box>
);

export default function CytopathologyTab({ caseId, initialData, caseRegister, processing, sectioning, staining, molecular, doctorId, doctorName, onAccessionSpecimen, onSave }) {
  const applicability = tabApplicability(caseRegister);
  const specimens = useMemo(() => cytologySpecimens(caseRegister), [caseRegister]);
  const registrySpecimens = useMemo(() => caseRegistrySpecimens(caseRegister), [caseRegister]);
  // Read-only lineage sources: a cell block's downstream work is traced through
  // Processing → Sectioning → Staining / Molecular rather than typed in here.
  const lineageSources = useMemo(
    () => ({ processing, sectioning, staining, molecular }),
    [processing, sectioning, staining, molecular],
  );
  const [cytology, setCytology] = useState(() => syncCytopathology(initialData, caseRegister));
  const [selectedSpecimenId, setSelectedSpecimenId] = useState("");
  const [notice, setNotice] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const [validationOpen, setValidationOpen] = useState(false);
  const [validationResults, setValidationResults] = useState([]);
  // Dictation → transcribe → structure → autofill, held per record (mirroring the
  // review transcripts in MicroscopyTab). One microphone and one structure run at
  // a time, but each record card keeps its own editable transcript.
  const mediaRecorderRef = useRef(null);
  const audioChunksRef = useRef([]);
  const [transcripts, setTranscripts] = useState({});
  const [recordingId, setRecordingId] = useState("");
  const [autofillId, setAutofillId] = useState("");
  const [isTranscribing, setIsTranscribing] = useState(false);
  // Deterministic clinical posture, derived server-side from the patient record.
  // Treatment-related atypia is a recognised cytology pitfall, so knowing whether
  // this patient actually had therapy matters before interpreting atypia.
  const [posture, setPosture] = useState(null);

  useEffect(() => {
    setCytology(syncCytopathology(initialData, caseRegister));
    setSelectedSpecimenId("");
    setNotice("");
    setTranscripts({});
    setRecordingId("");
    setAutofillId("");
    setIsTranscribing(false);
  }, [caseId]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!caseId) return;
    let cancelled = false;
    getClinicalPosture(caseId)
      .then((response) => { if (!cancelled && response?.data) setPosture(response.data); })
      .catch(() => {}); // Never block cytology work on an unavailable posture.
    return () => { cancelled = true; };
  }, [caseId]);

  const records = cytology.records || [];
  const specimenById = useMemo(() => new Map(registrySpecimens.map((specimen) => [specimen.specimen_id, specimen])), [registrySpecimens]);
  const incompatibleRecords = records.filter((record) => record.specimen_id && !specimens.some((specimen) => specimen.specimen_id === record.specimen_id));
  const update = (fn) => setCytology((current) => fn(current));
  const updateRecord = (id, key, value) => update((current) => ({ ...current, records: current.records.map((record) => record.cytology_id === id ? { ...record, [key]: value } : record) }));
  const addRecord = () => {
    if (!selectedSpecimenId) { setNotice("Select an accessioned specimen before adding a cytology record."); return; }
    const record = makeCytologyRecord(doctorName || doctorId || "");
    record.specimen_id = selectedSpecimenId;
    update((current) => ({ ...current, records: [...current.records, record] }));
    setSelectedSpecimenId("");
    setNotice("");
  };
  const removeRecord = (id) => {
    update((current) => ({ ...current, records: current.records.filter((record) => record.cytology_id !== id) }));
    // Drop the record's transcript and any in-flight work with it.
    setTranscripts((prev) => { const next = { ...prev }; delete next[id]; return next; });
    if (recordingId === id) {
      try { mediaRecorderRef.current?.stop?.(); mediaRecorderRef.current?.stream?.getTracks().forEach((track) => track.stop()); } catch (error) { /* best effort */ }
      setRecordingId("");
    }
    if (autofillId === id) setAutofillId("");
  };

  // Record-level slide images. Purely additive — an empty list stores nothing and
  // no completeness check reads it, so a cytology slide that is never digitised
  // costs a lab nothing. Mirrors the Microscopy handlers one level up.
  const addRecordImage = (id) => update((current) => ({
    ...current,
    records: current.records.map((record) => (
      record.cytology_id === id
        ? { ...record, images: [...(record.images || []), makeCytologyImage()] }
        : record
    )),
  }));
  const updateRecordImage = (id, imageId, key, value) => update((current) => ({
    ...current,
    records: current.records.map((record) => (
      record.cytology_id === id
        ? { ...record, images: (record.images || []).map((image) => (
          image.image_id === imageId ? { ...image, [key]: value } : image
        )) }
        : record
    )),
  }));
  const removeRecordImage = (id, imageId) => update((current) => ({
    ...current,
    records: current.records.map((record) => (
      record.cytology_id === id
        ? { ...record, images: (record.images || []).filter((image) => image.image_id !== imageId) }
        : record
    )),
  }));

  // ─── Dictation ────────────────────────────────────────────────────────────
  // Per record card: the pathologist views the slide image, dictates the read,
  // and "AI Autofill Empty Fields" structures the transcript into the record's
  // empty fields. Mirrors the MicroscopyTab handlers one record at a time.
  const startRecording = async (record) => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      mediaRecorderRef.current = new MediaRecorder(stream);
      audioChunksRef.current = [];
      mediaRecorderRef.current.ondataavailable = (event) => {
        if (event.data.size > 0) audioChunksRef.current.push(event.data);
      };
      mediaRecorderRef.current.start();
      setRecordingId(record.cytology_id);
    } catch (error) {
      console.error("[CytopathologyTab] microphone:", error);
      setNotice("Microphone access is unavailable.");
    }
  };

  const stopRecording = () => {
    if (!mediaRecorderRef.current || !recordingId) return;
    const id = recordingId;
    mediaRecorderRef.current.onstop = async () => {
      setRecordingId("");
      setIsTranscribing(true);
      const audioBlob = new Blob(audioChunksRef.current, { type: "audio/webm" });
      audioChunksRef.current = [];
      try {
        const formData = new FormData();
        formData.append("file", audioBlob, "recording.webm");
        const response = await fetch(`${API_BASE_URL}hms/users/ai/elevenlabs/api/transcribe_labs`, {
          method: "POST",
          body: formData,
        });
        if (!response.ok) throw new Error(`Transcription failed (${response.status})`);
        const data = await response.json();
        const text = data.text || data.transcription || "";
        if (text) setTranscripts((prev) => ({ ...prev, [id]: [prev[id], text].filter(Boolean).join(" ") }));
      } catch (error) {
        console.error("[CytopathologyTab] transcription:", error);
        setNotice("Cytopathology dictation transcription failed.");
      } finally {
        setIsTranscribing(false);
      }
    };
    mediaRecorderRef.current.stop();
    mediaRecorderRef.current.stream.getTracks().forEach((track) => track.stop());
  };

  // Extraction fills fields the pathologist left empty. It never overwrites a
  // recorded value, never writes identity or lineage, and remains a suggestion.
  const autofillRecord = async (record) => {
    const id = record.cytology_id;
    const transcript = transcripts[id] || "";
    if (!transcript.trim()) return;
    setAutofillId(id);
    setNotice("");
    try {
      const response = await structureCytopathology(transcript);
      if (response.status !== "success" || !response.data) throw new Error("No structured data returned");
      const structuredAt = new Date().toISOString();
      const before = record;
      const after = mergeCytopathologyExtraction(before, response.data);
      const report = mergeCytopathologyReport(before, after, response.data);
      update((current) => ({
        ...current,
        records: current.records.map((entry) => (entry.cytology_id === id
          ? {
            ...after,
            dictation: {
              transcript,
              structured_at: structuredAt,
              review_status: "Applied to empty fields; requires pathologist confirmation",
              reviewed_by: doctorName || doctorId || "",
              reviewed_at: structuredAt,
            },
          }
          : entry)),
      }));
      setNotice(autofillNotice("cytology record", report, response.failed_groups));
    } catch (error) {
      console.error("[CytopathologyTab] dictation structuring:", error);
      setNotice("Cytopathology dictation structuring failed.");
    } finally {
      setAutofillId("");
    }
  };

  const handleGenerate = async (record) => {
    if (!caseId) return;
    setIsGenerating(true); setNotice("");
    try {
      const response = await recommendCytopathology(caseId, record.cytology_id, { records: [record] });
      if (response.status !== "success" || !response.data) throw new Error("No recommendations returned");
      update((current) => ({ ...current, recommendation_runs: [...(current.recommendation_runs || []), response.data].slice(-20) }));
      setNotice("Advisory cytopathology suggestions generated for clinician review.");
    } catch (error) {
      console.error("[CytopathologyTab] recommendations:", error);
      setNotice("Cytopathology recommendation generation failed.");
    } finally { setIsGenerating(false); }
  };

  const reviewSuggestion = (runId, collectionKey, suggestionId, decision) => {
    const reviewedAt = new Date().toISOString();
    const reviewer = doctorName || doctorId || "";
    update((current) => {
      const runs = current.recommendation_runs || [];
      return { ...current, recommendation_runs: runs.map((run) => {
        if (run.recommendation_run_id !== runId) return run;
        const collection = (run[collectionKey] || []).map((item) => item.suggestion_id === suggestionId ? { ...item, review_status: decision, reviewed_by: reviewer, reviewed_at: reviewedAt } : item);
        const hasUnreviewed = SUGGESTION_GROUPS.some(([key]) => (key === collectionKey ? collection : (run[key] || [])).some((item) => item.review_status === "Suggested"));
        return { ...run, [collectionKey]: collection, review_status: hasUnreviewed ? "Requires clinician review" : "Reviewed" };
      }) };
    });
  };

  const handleValidate = () => { setValidationResults(validateCytopathologyCompleteness(cytology, registrySpecimens)); setValidationOpen(true); };
  const handleSubmit = async () => { setIsSaving(true); try { await onSave("cytopathology", cytology); } finally { setIsSaving(false); } };
  const busy = isSaving || isGenerating || isTranscribing || !!autofillId || !!recordingId;

  return (
    <Box sx={{ fontFamily: FONT }}>
      <SectionBox title="Cytology Specimen Worklist">
        <FG cols={4}>
          <SourceValue label="Cytology Records" value={String(records.length)} />
          <SourceValue label="Adequate" value={String(records.filter((record) => record.adequacy === "Adequate").length)} />
          <SourceValue label="Inadequate / Unsatisfactory" value={String(records.filter((record) => ["Inadequate", "Unsatisfactory"].includes(record.adequacy)).length)} />
          <SourceValue label="Final / Amended Reports" value={String(records.filter((record) => ["Final", "Amended"].includes(record.report_status)).length)} />
        </FG>
        {specimens.length === 0 ? (
          <>
            <FlagNote>{applicability.cytopathology.reason}</FlagNote>
            <Box sx={{ display: "flex", gap: 1.5, flexWrap: "wrap", mt: 1.5 }}>
              {["Fine-needle aspiration", "Fluid / effusion", "Brushings / washings", "Bone marrow"].map((type) => (
                <Button key={type} sx={outlineBtnSx} onClick={() => onAccessionSpecimen && onAccessionSpecimen(type)} disabled={!onAccessionSpecimen}>
                  <AddRounded sx={{ mr: 0.75, fontSize: 16 }} /> Accession {type.toLowerCase()}
                </Button>
              ))}
            </Box>
            <Typography sx={{ fontFamily: FONT, fontSize: 11.5, color: C.textMuted, mt: 1.5 }}>
              This opens Case Registry with the specimen started; a specimen_id is only ever minted there. Cytology
              containers are the vial, tube, syringe or slide holder the material arrived in — they never reach the
              grossing bench. Histology blocks and tissue biopsies belong in the microscopy workflow.
            </Typography>
          </>
        ) : (
          <FG cols={3}>
            <Box><FieldLabel>Accessioned Specimen for New Cytology Record</FieldLabel><Sel label="Specimen" options={[{ value: "", label: "- Select specimen -" }, ...specimens.map((specimen) => ({ value: specimen.specimen_id, label: `${specimen.specimen_id} | ${specimen.specimen_type || "specimen"} | ${specimen.anatomic_site || "site not recorded"}` }))]} value={selectedSpecimenId} onChange={setSelectedSpecimenId} /></Box>
            <Box sx={{ display: "flex", alignItems: "flex-end" }}><Button sx={outlineBtnSx} onClick={addRecord}><AddRounded sx={{ mr: 0.75, fontSize: 16 }} /> Add Cytology Record</Button></Box>
          </FG>
        )}
        {incompatibleRecords.length > 0 && <FlagNote>{incompatibleRecords.length} existing cytology record(s) are linked to a non-cytology Case Registry specimen. They remain visible for correction, but new records cannot use those specimens.</FlagNote>}
      </SectionBox>

      {/* Case-level treatment context, derived from the patient record rather
          than by the model. Shown once for the case, above the per-record cards. */}
      <ClinicalPosturePanel posture={posture} caseId={caseId} onRefreshed={setPosture} />

      {records.map((record, index) => {
        const source = specimenById.get(record.specimen_id) || {};
        const categories = diagnosticCategoriesFor(record.reporting_system);
        const canReview = hasMeaningfulCytologyContent(record);
        // Ancillary work on this record's cell block, traced through the real
        // lineage rather than typed in. Derived on every render, never stored.
        const work = cytologyAncillaryWork(record, lineageSources);
        const latestRun = [...(cytology.recommendation_runs || [])].reverse().find((run) => run.focus_cytology_id === record.cytology_id || run.cytology_id === record.cytology_id)
          || (index === 0 ? [...(cytology.recommendation_runs || [])].reverse().find((run) => !run.focus_cytology_id && !run.cytology_id) : null);
        return (
          <Box key={record.cytology_id} sx={{ border: `1px solid ${C.border}`, p: 2, mb: 2, background: C.white }}>
            <ItemHeader title={`${index + 1}. ${record.specimen_type || "Cytology record"}`} subtitle={`${record.cytology_id} | Specimen ${record.specimen_id || "not linked"}`} onRemove={() => removeRecord(record.cytology_id)} />

            {/* The slide imaging + dictation panel leads the record card: the
                pathologist views the digitised smear / cell-block slide, dictates
                the read, and AI Autofill fills the empty record fields below. */}
            <RecordSection title="Cytology Slide Imaging and Dictation">
              <Box
                sx={{
                  display: "grid",
                  gridTemplateColumns: { xs: "1fr", lg: "repeat(2, minmax(0, 1fr))" },
                  gap: 2.5,
                  alignItems: "stretch",
                }}
              >
                <SlideImageViewer
                  title={`${record.specimen_type || "Cytology"} slides`}
                  subtitle={[source.anatomic_site, source.sub_site].filter(Boolean).join(" / ") || "Site not recorded"}
                  images={record.images || []}
                  onAdd={() => addRecordImage(record.cytology_id)}
                  onUpdate={(imageId, key, value) => updateRecordImage(record.cytology_id, imageId, key, value)}
                  onRemove={(imageId) => removeRecordImage(record.cytology_id, imageId)}
                />
                <Box
                  sx={{
                    border: `1px solid ${C.border}`,
                    p: 1.5,
                    background: C.white,
                    height: "100%",
                    boxSizing: "border-box",
                  }}
                >
                  <FieldLabel>Cytology Dictation</FieldLabel>
                  <TextField
                    value={transcripts[record.cytology_id] || ""}
                    onChange={(event) => setTranscripts((prev) => ({ ...prev, [record.cytology_id]: event.target.value }))}
                    size="small"
                    fullWidth
                    multiline
                    minRows={11}
                    maxRows={11}
                    placeholder="Describe what you see on the slide; the transcript is structured into the empty record fields only."
                    sx={inputSx}
                  />
                  <Box
                    sx={{
                      display: "flex",
                      gap: 1.5,
                      mt: 1.5,
                      pt: 1.5,
                      borderTop: `1px solid ${C.border}`,
                      flexWrap: "wrap",
                    }}
                  >
                    <Button
                      sx={{
                        ...outlineBtnSx,
                        px: 2,
                        background: recordingId === record.cytology_id ? "#cf1322" : C.white,
                        color: recordingId === record.cytology_id ? C.white : C.black,
                        borderColor: recordingId === record.cytology_id ? "#cf1322" : C.black,
                        "&:hover": { background: recordingId === record.cytology_id ? "#a8071a" : C.bgTertiary },
                      }}
                      onClick={recordingId === record.cytology_id ? stopRecording : () => startRecording(record)}
                      disabled={isTranscribing || !!autofillId || (!!recordingId && recordingId !== record.cytology_id)}
                    >
                      {recordingId === record.cytology_id ? <StopRounded sx={{ mr: 0.75, fontSize: 16 }} /> : <MicRounded sx={{ mr: 0.75, fontSize: 16 }} />}
                      {isTranscribing ? "Processing..." : recordingId === record.cytology_id ? "Stop Recording" : "Start Recording"}
                    </Button>
                    <Button
                      sx={{ ...outlineBtnSx, px: 2 }}
                      onClick={() => autofillRecord(record)}
                      disabled={busy || !(transcripts[record.cytology_id] || "").trim()}
                    >
                      {autofillId === record.cytology_id
                        ? <CircularProgress size={14} sx={{ mr: 1, color: C.black }} />
                        : <AutoAwesomeRounded sx={{ mr: 0.75, fontSize: 16 }} />}
                      AI Autofill Empty Fields
                    </Button>
                  </Box>
                  {record.dictation?.structured_at && (
                    <FlagNote>
                      Last structured {record.dictation.structured_at} — {record.dictation.review_status}
                    </FlagNote>
                  )}
                  <FlagNote>
                    Optional — nothing here is saved until an image or transcript is added, and no completeness check
                    depends on it. A scanned smear or cell-block slide renders in the shared WSI viewer; a microscopy
                    photograph or external link is stored as a reference only. Extraction never overwrites a value you
                    already recorded, and never writes identity, lineage, links or a diagnosis of its own.
                  </FlagNote>
                </Box>
              </Box>
            </RecordSection>

            <RecordSection title="Accession and preparation">
              <FG cols={4}>
                <SourceValue label="Patient ID" value={caseRegister?.patient?.patient_id} />
                <SourceValue label="Anatomic Site" value={source.anatomic_site} />
                <SourceValue label="Sub-site" value={source.sub_site} />
                <SourceValue label="Laterality" value={source.laterality} />
                <SourceValue label="Procedure / Imaging Guidance" value={[source.procedure, source.imaging_guidance_used].filter(Boolean).join(" | ")} />
                <Box><FieldLabel>Cytology Specimen Type</FieldLabel><Sel label="Specimen Type" options={CYTOLOGY_SPECIMEN_TYPES} value={record.specimen_type} onChange={(value) => updateRecord(record.cytology_id, "specimen_type", value)} /></Box>
                {record.specimen_type === "Other" && <LineField label="Other Specimen Type" value={record.specimen_type_other} onChange={(value) => updateRecord(record.cytology_id, "specimen_type_other", value)} />}
                <Box><FieldLabel>Collection Method</FieldLabel><Sel label="Collection Method" options={COLLECTION_METHOD_OPTIONS} value={record.collection_method} onChange={(value) => updateRecord(record.cytology_id, "collection_method", value)} /></Box>
                {record.collection_method === "Other" && <LineField label="Other Collection Method" value={record.collection_method_other} onChange={(value) => updateRecord(record.cytology_id, "collection_method_other", value)} />}
                <SourceValue label="Imaging Guidance Used" value={source.imaging_guidance_used} />
                <LineField label="Fluid Volume (mL)" value={record.fluid_volume_ml} onChange={(value) => updateRecord(record.cytology_id, "fluid_volume_ml", value)} />
                <LineField label="Smears / Slides Received" value={record.smears_received} onChange={(value) => updateRecord(record.cytology_id, "smears_received", value)} />
                <Box><FieldLabel>Preparation Method</FieldLabel><Sel label="Preparation Method" options={PREPARATION_METHOD_OPTIONS} value={record.preparation_method} onChange={(value) => updateRecord(record.cytology_id, "preparation_method", value)} /></Box>
                {record.preparation_method === "Other" && <LineField label="Other Preparation Method" value={record.preparation_method_other} onChange={(value) => updateRecord(record.cytology_id, "preparation_method_other", value)} />}
                <LineField label="Fixation" value={record.fixation} onChange={(value) => updateRecord(record.cytology_id, "fixation", value)} />
                <LineField label="Stain Used" value={record.stain_used} onChange={(value) => updateRecord(record.cytology_id, "stain_used", value)} />
                <SourceValue label="Imaging Report Reference" value={source.imaging_report_reference} />
              </FG>
              <TextArea label="Gross Appearance" value={record.gross_appearance} onChange={(value) => updateRecord(record.cytology_id, "gross_appearance", value)} />
            </RecordSection>

            <RecordSection title="Adequacy and ROSE">
              <FG cols={4}>
                <Box><FieldLabel>Adequacy</FieldLabel><Sel label="Adequacy" options={ADEQUACY_OPTIONS} value={record.adequacy} onChange={(value) => updateRecord(record.cytology_id, "adequacy", value)} /></Box>
                <Box><FieldLabel>ROSE Performed</FieldLabel><Sel label="ROSE" options={["Yes", "No"]} value={record.rose_performed} onChange={(value) => updateRecord(record.cytology_id, "rose_performed", value)} /></Box>
                <LineField label="ROSE Passes Assessed" value={record.rose_passes} onChange={(value) => updateRecord(record.cytology_id, "rose_passes", value)} />
                <Box><FieldLabel>ROSE Result</FieldLabel><Sel label="ROSE Result" options={ROSE_RESULT_OPTIONS} value={record.rose_result} onChange={(value) => updateRecord(record.cytology_id, "rose_result", value)} /></Box>
                <Box><FieldLabel>Repeat Collection Recommended</FieldLabel><Sel label="Repeat Collection" options={YES_NO_OPTIONS} value={record.repeat_collection_recommended} onChange={(value) => updateRecord(record.cytology_id, "repeat_collection_recommended", value)} /></Box>
              </FG>
              <FG cols={2}>
                <TextArea label="Adequacy Reason" value={record.adequacy_reason} onChange={(value) => updateRecord(record.cytology_id, "adequacy_reason", value)} />
                <TextArea label="ROSE Additional-Pass Recommendation" value={record.rose_additional_pass_recommendation} onChange={(value) => updateRecord(record.cytology_id, "rose_additional_pass_recommendation", value)} />
              </FG>
            </RecordSection>

            <RecordSection title="Findings and diagnosis">
              <FG cols={3}>
                <LineField label="Cellularity" value={record.cellularity} onChange={(value) => updateRecord(record.cytology_id, "cellularity", value)} placeholder="Scant, moderate, abundant" />
                <Box><FieldLabel>Malignant / Suspicious Cells Identified</FieldLabel><Sel label="Suspicious Cells" options={["", "Yes", "No"]} value={record.malignant_or_suspicious_cells} onChange={(value) => updateRecord(record.cytology_id, "malignant_or_suspicious_cells", value)} /></Box>
                <Box><FieldLabel>Report Status</FieldLabel><Sel label="Report Status" options={REPORT_STATUS_OPTIONS} value={record.report_status} onChange={(value) => updateRecord(record.cytology_id, "report_status", value)} /></Box>
              </FG>
              <Box sx={{ mb: 1.5 }}><CbxGroup label="Background Findings" options={BACKGROUND_OPTIONS} value={record.background_findings || []} onChange={(value) => updateRecord(record.cytology_id, "background_findings", value)} /></Box>
              {record.background_findings?.includes("Other") && <Box sx={{ mb: 1.5 }}><LineField label="Other Background Finding" value={record.background_other} onChange={(value) => updateRecord(record.cytology_id, "background_other", value)} /></Box>}
              <Box sx={{ mb: 2 }}><TextArea label="Cytomorphologic Findings" value={record.cytomorphologic_findings} onChange={(value) => updateRecord(record.cytology_id, "cytomorphologic_findings", value)} rows={3} /></Box>
              <FG cols={4}>
                <Box><FieldLabel>Reporting System</FieldLabel><Sel label="Reporting System" options={REPORTING_SYSTEM_OPTIONS} value={record.reporting_system} onChange={(value) => updateRecord(record.cytology_id, "reporting_system", value)} /></Box>
                <LineField label="System Version" value={record.reporting_system_version} onChange={(value) => updateRecord(record.cytology_id, "reporting_system_version", value)} />
                <Box><FieldLabel>Diagnostic Category</FieldLabel><Sel label="Diagnostic Category" options={["", ...categories]} value={record.diagnostic_category} onChange={(value) => updateRecord(record.cytology_id, "diagnostic_category", value)} /></Box>
                <LineField label="Category / Diagnosis Other" value={record.diagnostic_category_other} onChange={(value) => updateRecord(record.cytology_id, "diagnostic_category_other", value)} />
              </FG>
              <Box sx={{ mb: 2 }}><TextArea label="Cytologic Diagnosis" value={record.cytologic_diagnosis} onChange={(value) => updateRecord(record.cytology_id, "cytologic_diagnosis", value)} rows={3} /></Box>
              <FG cols={3}>
                <LineField label="Reviewed By" value={record.reviewed_by} onChange={(value) => updateRecord(record.cytology_id, "reviewed_by", value)} />
                <LineField label="Report Date and Time" type="datetime-local" value={record.report_datetime} onChange={(value) => updateRecord(record.cytology_id, "report_datetime", value)} />
                <LineField label="Prior Pathology Reference" value={record.prior_pathology_reference} onChange={(value) => updateRecord(record.cytology_id, "prior_pathology_reference", value)} />
              </FG>
              <FG cols={2}><TextArea label="Diagnostic Question" value={record.diagnostic_question} onChange={(value) => updateRecord(record.cytology_id, "diagnostic_question", value)} /><TextArea label="Imaging / Pathology Correlation" value={record.imaging_correlation} onChange={(value) => updateRecord(record.cytology_id, "imaging_correlation", value)} /></FG>
              <Box sx={{ mb: 1.5 }} />
              <TextArea label="Cytology Comments" value={record.comments} onChange={(value) => updateRecord(record.cytology_id, "comments", value)} />
            </RecordSection>

            <RecordSection title="Cell block and ancillary testing">
              <FG cols={2}>
                <Box><FieldLabel>Cell Block Available</FieldLabel><Sel label="Cell Block" options={YES_NO_OPTIONS} value={record.cell_block_available} onChange={(value) => { updateRecord(record.cytology_id, "cell_block_available", value); if (value === "Yes" && !record.cell_block_id) updateRecord(record.cytology_id, "cell_block_id", makeCellBlockId()); }} /></Box>
                <LineField label="Cell Block ID" value={record.cell_block_id} onChange={(value) => updateRecord(record.cytology_id, "cell_block_id", value)} />
              </FG>
              <Box sx={{ mb: 1.5 }}><TextArea label="Cell Block Description" value={record.cell_block_description} onChange={(value) => updateRecord(record.cytology_id, "cell_block_description", value)} /></Box>
              {record.cell_block_available === "Yes" && (
                <Box sx={{ border: `1px solid ${C.border}`, background: C.bgSecondary, p: 1.5, mb: 1.5 }}>
                  {record.cell_block_id ? (
                    <>
                      <FG cols={4}>
                        <SourceValue label="Blocks Cut" value={String(work.blocks.length)} />
                        <SourceValue label="Slides Cut" value={String(work.slides.length)} />
                        <SourceValue label="Stains / IHC" value={String(work.stains.length)} />
                        <SourceValue label="Molecular Orders" value={String(work.molecularOrders.length)} />
                      </FG>
                      <Typography sx={{ fontFamily: FONT, fontSize: 11.5, color: C.textSecond }}>
                        {work.blocks.length
                          ? `Traced through this cell block: ${[
                            work.stains.map((stain) => stain.ihc?.marker || stain.special?.stain_type || stain.modality).filter(Boolean).join(", "),
                            work.molecularOrders.map((order) => order.test_type).filter(Boolean).join(", "),
                          ].filter(Boolean).join(" · ") || "blocks cut, no stain or molecular order yet"}.`
                          : "This cell block appears in Processing but no block has been embedded from it yet. Work through Processing, Sectioning and Staining to use it."}
                      </Typography>
                    </>
                  ) : (
                    <Typography sx={{ fontFamily: FONT, fontSize: 11.5, color: "#cf1322" }}>
                      A cell block is marked available but has no cell-block ID. The ID is what routes it into Processing —
                      without it the block cannot be sectioned, stained or read.
                    </Typography>
                  )}
                </Box>
              )}
              <Box sx={{ mb: 1.5 }}><CbxGroup label="Ancillary Tests Requested" options={ANCILLARY_TEST_OPTIONS} value={record.ancillary_tests_requested || []} onChange={(value) => updateRecord(record.cytology_id, "ancillary_tests_requested", value)} /></Box>
              {record.ancillary_tests_requested?.includes("Other") && <Box sx={{ mb: 1.5 }}><LineField label="Other Ancillary Test" value={record.ancillary_other} onChange={(value) => updateRecord(record.cytology_id, "ancillary_other", value)} /></Box>}
              <RecommendationPanel
                run={latestRun}
                canGenerate={canReview}
                isGenerating={isGenerating}
                onGenerate={() => handleGenerate(record)}
                onAccept={(key, suggestionId, decision) => latestRun && reviewSuggestion(latestRun.recommendation_run_id, key, suggestionId, decision)}
                onDismiss={(key, suggestionId, decision) => latestRun && reviewSuggestion(latestRun.recommendation_run_id, key, suggestionId, decision)}
              />
            </RecordSection>
          </Box>
        );
      })}
      {records.length === 0 && <FlagNote>No cytology record has been added yet. Choose an accessioned specimen above.</FlagNote>}

      {notice && <Box sx={{ border: `1px solid ${C.border}`, background: C.bgSecondary, p: 1.5, mb: 2.5 }}><Typography sx={{ fontFamily: FONT, fontSize: 12, color: C.textSecond }}>{notice}</Typography></Box>}
      <Box sx={{ display: "flex", gap: 1.5, flexWrap: "wrap" }}>
        <Button sx={outlineBtnSx} onClick={handleValidate}><FactCheckRounded sx={{ mr: 0.75, fontSize: 16 }} /> Review Reconciliation</Button>
        <Button sx={saveBtnSx} onClick={handleSubmit} disabled={busy}>{isSaving ? <CircularProgress size={14} sx={{ mr: 1, color: C.white }} /> : <SaveRounded sx={{ mr: 0.75, fontSize: 16 }} />} Save Cytopathology</Button>
      </Box>
      <CapValidationDialog open={validationOpen} onClose={() => setValidationOpen(false)} title="Cytopathology Reconciliation Review" results={validationResults} />
    </Box>
  );
}
