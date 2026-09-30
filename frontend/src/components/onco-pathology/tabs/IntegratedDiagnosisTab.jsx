import React, { useMemo, useRef, useState } from "react";
import { Box, Button, CircularProgress, IconButton, TextField, Typography } from "@mui/material";
import {
  AddRounded,
  AutoAwesomeRounded,
  DeleteOutlineRounded,
  FactCheckRounded,
  MicRounded,
  SaveRounded,
  StopRounded,
  VisibilityRounded,
} from "@mui/icons-material";
import { C, FONT, FW_LIGHT, FW_NORMAL, inputSx, outlineBtnSx, saveBtnSx } from "../../shared/designTokens";
import { FG, FieldLabel, FlagNote, ROInput, SectionBox, Sel } from "../../shared/FormComponents";
import { getCase, getPatientCases, structureIntegration } from "../shared/api";
import { coerceEnum } from "../shared/transcribeMerge";
import {
  COMPANION_RELATION_OPTIONS,
  CONCORDANCE_OPTIONS,
  EMPTY_INTEGRATION,
  integrationEvidence,
  integrationOutstanding,
  makeCompanionCase,
  mergeIntegrationExtraction,
  syncIntegration,
} from "../shared/integrationModel";
import { completeAncillaryResults } from "../shared/microscopyModel";
import { validateIntegrationCompleteness } from "../shared/capValidation";
import CapValidationDialog from "../CapValidationDialog";
import PathologyTable from "../PathologyTable";
import PriorCaseDialog from "../PriorCaseDialog";

const API_BASE_URL = import.meta.env.VITE_BACKEND_URL || "https://doctorassist.ai/api/";

const shortId = (id) => (id ? String(id).slice(-6) : "");
const readOnlyValue = (value) => (value === 0 ? "0" : value || "Not recorded");

const SubHeading = ({ children }) => (
  <Typography sx={{ fontFamily: FONT, fontSize: 11, textTransform: "uppercase", letterSpacing: "0.14em", color: C.textMuted, mt: 2.5, mb: 1 }}>
    {children}
  </Typography>
);

const TextArea = ({ label, value, onChange, rows = 2, placeholder = "" }) => (
  <TextField
    label={label}
    value={value || ""}
    onChange={(event) => onChange(event.target.value)}
    placeholder={placeholder}
    multiline
    minRows={rows}
    fullWidth
    sx={inputSx}
  />
);

const LineField = ({ label, value, onChange, type = "text", placeholder = "" }) => (
  <TextField
    label={label}
    value={value || ""}
    onChange={(event) => onChange(event.target.value)}
    type={type}
    placeholder={placeholder}
    fullWidth
    sx={inputSx}
    InputLabelProps={type === "datetime-local" ? { shrink: true } : undefined}
  />
);

const SourceValue = ({ label, value }) => <ROInput label={label} value={readOnlyValue(value)} />;

/**
 * Integrated Diagnosis — where every stream converges.
 *
 * This tab exists because synthesising a case is not microscope work. Morphology
 * comes from Microscopy, marker readings from the Staining + Microscopy join,
 * sequencing from Molecular, and cytologic diagnoses from Cytopathology. Each
 * stays authoritative in its own tab; this tab reads them all and records the
 * pathologist's combined interpretation, concordance and confirmation.
 *
 * Nothing here is derived by software except the readiness warnings. Every field
 * is the pathologist's own words.
 */
export default function IntegratedDiagnosisTab({
  caseId,
  accessionId,
  patientId,
  initialData,
  caseRegister,
  microscopyData,
  stainingData,
  molecularData,
  cytopathologyData,
  doctorId,
  doctorName,
  onSave,
}) {
  const [integration, setIntegration] = useState(() => syncIntegration(initialData, { caseId }));
  const [isSaving, setIsSaving] = useState(false);
  const [notice, setNotice] = useState("");
  const [validationOpen, setValidationOpen] = useState(false);
  const [validationResults, setValidationResults] = useState([]);

  // Speech-to-text dictation for the integrated assessment. One microphone and
  // one structure run at a time; the tab is remounted per case, so the staged
  // transcript never leaks across cases.
  const [transcript, setTranscript] = useState("");
  const [isRecording, setIsRecording] = useState(false);
  const [isTranscribing, setIsTranscribing] = useState(false);
  const [isAutofilling, setIsAutofilling] = useState(false);
  const mediaRecorderRef = useRef(null);
  const audioChunksRef = useRef([]);

  // Companion-case browsing. Existing endpoints only: list the patient's cases,
  // then load one in full for read-only viewing.
  const [companionOptions, setCompanionOptions] = useState([]);
  const [companionLoading, setCompanionLoading] = useState(false);
  const [viewedCase, setViewedCase] = useState(null);

  const ancillaryResults = useMemo(
    () => completeAncillaryResults(stainingData, microscopyData),
    [stainingData, microscopyData],
  );
  const evidence = useMemo(
    () => integrationEvidence({
      microscopy: microscopyData,
      molecular: molecularData,
      cytopathology: cytopathologyData,
      ancillaryResults,
    }),
    [microscopyData, molecularData, cytopathologyData, ancillaryResults],
  );
  const outstanding = useMemo(
    () => integrationOutstanding({
      staining: stainingData,
      molecular: molecularData,
      cytopathology: cytopathologyData,
      ancillaryResults,
    }),
    [stainingData, molecularData, cytopathologyData, ancillaryResults],
  );

  const set = (key) => (value) => setIntegration((current) => ({ ...current, [key]: value }));
  const companionCases = integration.companion_cases || [];

  const loadCompanionOptions = async () => {
    if (!patientId) {
      setNotice("No patient is loaded, so other cases cannot be listed.");
      return;
    }
    setCompanionLoading(true);
    try {
      const result = await getPatientCases(patientId);
      const others = (result.cases || []).filter((entry) => entry.case_id && entry.case_id !== caseId);
      setCompanionOptions(others);
      setNotice(others.length
        ? `${others.length} other case(s) found for this patient.`
        : "This patient has no other pathology case to link.");
    } catch (error) {
      console.error("[IntegratedDiagnosisTab] case list:", error);
      setNotice("Unable to list this patient's other cases.");
    } finally {
      setCompanionLoading(false);
    }
  };

  const addCompanion = (entry) => {
    if (companionCases.some((link) => link.case_id === entry.case_id)) {
      setNotice("That case is already linked.");
      return;
    }
    setIntegration((current) => ({
      ...current,
      companion_cases: [...(current.companion_cases || []), {
        ...makeCompanionCase(),
        case_id: entry.case_id,
        accession_id: entry.accession_id || "",
      }],
    }));
    setNotice("Case linked. Record how it relates to this case.");
  };

  const updateCompanion = (linkId, key, value) => setIntegration((current) => ({
    ...current,
    companion_cases: (current.companion_cases || []).map((link) => (
      link.link_id === linkId ? { ...link, [key]: value } : link
    )),
  }));

  const removeCompanion = (linkId) => setIntegration((current) => ({
    ...current,
    companion_cases: (current.companion_cases || []).filter((link) => link.link_id !== linkId),
  }));

  const viewCompanion = async (companionCaseId) => {
    setCompanionLoading(true);
    try {
      const result = await getCase(companionCaseId);
      const doc = result.data && result.data.case_id ? result.data : null;
      if (!doc) {
        setNotice("That case could not be loaded. It may have been removed.");
        return;
      }
      setViewedCase(doc);
    } catch (error) {
      console.error("[IntegratedDiagnosisTab] companion case:", error);
      setNotice("Unable to load the linked case.");
    } finally {
      setCompanionLoading(false);
    }
  };

  const confirmNow = () => setIntegration((current) => ({
    ...current,
    confirmed_by: doctorName || doctorId || current.confirmed_by,
    confirmation_datetime: new Date().toISOString().slice(0, 16),
  }));

  const handleValidate = () => {
    setValidationResults(validateIntegrationCompleteness(integration, {
      evidence,
      outstanding,
      caseRegister,
    }));
    setValidationOpen(true);
  };

  const handleSave = async () => {
    setIsSaving(true);
    setNotice("");
    try {
      await onSave("integration", integration);
      setNotice("Integrated diagnosis saved successfully.");
    } catch (error) {
      console.error("[IntegratedDiagnosisTab] save:", error);
      setNotice("Integrated diagnosis save failed.");
    } finally {
      setIsSaving(false);
    }
  };

  // ─── Dictation: audio → transcribe_labs → structure → fill empty fields ──
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
      console.error("[IntegratedDiagnosisTab] microphone:", error);
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
        const response = await fetch(`${API_BASE_URL}hms/users/ai/elevenlabs/api/transcribe_labs`, {
          method: "POST",
          body: formData,
        });
        if (!response.ok) throw new Error(`Transcription failed (${response.status})`);
        const data = await response.json();
        const text = data.text || data.transcription || "";
        if (text) setTranscript((current) => (current ? `${current} ${text}` : text));
      } catch (error) {
        console.error("[IntegratedDiagnosisTab] transcription:", error);
        setNotice("Integrated diagnosis dictation transcription failed.");
      } finally {
        setIsTranscribing(false);
      }
    };
    mediaRecorderRef.current.stop();
    mediaRecorderRef.current.stream.getTracks().forEach((track) => track.stop());
  };

  // Dictation is advisory: the LLM structures the transcript into the flat
  // synthesis fields, and mergeIntegrationExtraction writes each value into a
  // field only if it is currently empty. A recorded value is never overwritten,
  // and confirmation identity / companion links are never touched. Nothing is
  // persisted until the pathologist presses Save.
  const handleAutofill = async () => {
    if (!transcript.trim()) return;
    setIsAutofilling(true);
    setNotice("");
    try {
      const response = await structureIntegration(transcript);
      if (response.status !== "success" || !response.data) throw new Error("No structured data returned");
      const reviewedAt = new Date().toISOString();
      const patch = {
        ...response.data,
        overall_concordance: coerceEnum(response.data.overall_concordance, CONCORDANCE_OPTIONS),
      };
      const before = integration;
      setIntegration((current) => ({
        ...mergeIntegrationExtraction(current, patch),
        dictation: {
          transcript,
          structured_at: reviewedAt,
          review_status: "Filled empty synthesis fields only — review before saving",
          reviewed_by: doctorName || doctorId || "",
          reviewed_at: reviewedAt,
        },
      }));
      const filled = Object.entries(patch).filter(([key, value]) => {
        if (value === "" || value === null || value === undefined) return false;
        return String(mergeIntegrationExtraction(before, { [key]: value })[key] ?? "")
          !== String(before[key] ?? "");
      }).map(([key]) => key);
      setNotice(filled.length > 0
        ? `Filled ${filled.length} empty field${filled.length === 1 ? "" : "s"} (${filled.join(", ")}). Review them before saving.`
        : "Nothing new to fill — the dictated fields already hold recorded values.");
    } catch (error) {
      console.error("[IntegratedDiagnosisTab] structure:", error);
      setNotice("Integrated diagnosis dictation structuring failed.");
    } finally {
      setIsAutofilling(false);
    }
  };

  const busy = isSaving || companionLoading || isRecording || isTranscribing || isAutofilling;
  const hasEvidence = evidence.reviews.length || evidence.ancillary.length
    || evidence.molecular.length || evidence.cytology.length;

  return (
    <Box sx={{ fontFamily: FONT }}>
      <Box sx={{ display: "flex", justifyContent: "space-between", alignItems: "center", mb: 2, flexWrap: "wrap", gap: 1 }}>
        <Box>
          <Typography sx={{ fontFamily: FONT, fontSize: 21, fontWeight: FW_LIGHT }}>Integrated Diagnosis</Typography>
          <Typography sx={{ fontFamily: FONT, fontSize: 12, color: C.textMuted }}>
            Combine morphology, ancillary readings, molecular results and cytology into one confirmed diagnosis
          </Typography>
        </Box>
        <Box sx={{ display: "flex", gap: 1, flexWrap: "wrap" }}>
          <Button sx={outlineBtnSx} onClick={handleValidate}>
            <FactCheckRounded sx={{ mr: 0.75, fontSize: 16 }} />Validate
          </Button>
          <Button sx={saveBtnSx} onClick={handleSave} disabled={busy}>
            {isSaving
              ? <CircularProgress size={15} sx={{ mr: 1, color: C.white }} />
              : <SaveRounded sx={{ mr: 0.75, fontSize: 16 }} />}
            Save Integrated Diagnosis
          </Button>
        </Box>
      </Box>
      {notice && (
        <Box sx={{ border: `1px solid ${C.border}`, background: C.bgSecondary, p: 1.5, mb: 2.5 }}>
          <Typography sx={{ fontFamily: FONT, fontSize: 12, color: C.textSecond }}>{notice}</Typography>
        </Box>
      )}

      {/* ─── Evidence: read-only projections from every stream ───────────── */}
      <SectionBox title="Evidence On This Case">
        <FG cols={4}>
          <SourceValue label="Confirmed Reviews" value={String(evidence.reviews.length)} />
          <SourceValue label="Ancillary Readings" value={String(evidence.ancillary.length)} />
          <SourceValue label="Reported Molecular" value={String(evidence.molecular.length)} />
          <SourceValue label="Cytology Diagnoses" value={String(evidence.cytology.length)} />
        </FG>

        <SubHeading>Microscopy — confirmed reviews</SubHeading>
        <PathologyTable
          rowId={(row) => row.microscopy_id}
          rows={evidence.reviews}
          columns={[
            { key: "review_cycle", label: "Cycle", width: "1fr" },
            { key: "diagnosis", label: "Diagnosis", width: "1.6fr", render: (row) => row.primary_diagnosis || row.histologic_diagnosis || "Not recorded" },
            { key: "grade", label: "Grade", width: "0.8fr", muted: true, render: (row) => row.histologic_grade || "—" },
            { key: "report_status", label: "Report", width: "0.8fr", muted: true },
            { key: "reporting_pathologist", label: "Pathologist", width: "1fr", muted: true },
          ]}
          emptyMessage="No microscopy review has been marked Final or Addendum."
        />

        <SubHeading>Special stains, IHC and FISH/ISH — pathologist readings</SubHeading>
        <PathologyTable
          rowId={(row) => row.result_id}
          rows={evidence.ancillary}
          columns={[
            { key: "marker", label: "Marker", width: "1fr" },
            { key: "modality", label: "Work", width: "0.8fr", muted: true },
            { key: "interpretation", label: "Call", width: "1fr", render: (row) => (row.interpretability === "Not interpretable" ? "Not interpretable" : row.interpretation) },
            { key: "score", label: "Score", width: "0.9fr", muted: true, render: (row) => [row.intensity, row.percent_positive && `${row.percent_positive}%`, row.score].filter(Boolean).join(" · ") || "—" },
            { key: "diagnostic_contribution", label: "Contribution", width: "1.4fr", muted: true },
          ]}
          emptyMessage="No ancillary reading has been recorded in Microscopy."
        />

        <SubHeading>Molecular — reported orders</SubHeading>
        <PathologyTable
          rowId={(row) => row.test_order_id}
          rows={evidence.molecular}
          columns={[
            { key: "test_type", label: "Test", width: "1.2fr" },
            { key: "findings", label: "Reported Findings", width: "1.8fr", render: (row) => row.actionable_findings || row.final_report || "Not recorded" },
            { key: "returned", label: "Returned For Integration", width: "1.1fr", muted: true, render: (row) => row.returned_for_integrated_diagnosis || "No" },
            { key: "reviewed_by", label: "Reviewer", width: "1fr", muted: true },
          ]}
          emptyMessage="No molecular order has been reported."
        />

        <SubHeading>Cytopathology — cytologic diagnoses</SubHeading>
        <PathologyTable
          rowId={(row) => row.cytology_id}
          rows={evidence.cytology}
          columns={[
            { key: "specimen_type", label: "Specimen", width: "1.1fr" },
            { key: "reporting_system", label: "System", width: "1.1fr", muted: true },
            { key: "diagnostic_category", label: "Category", width: "1.3fr" },
            { key: "cytologic_diagnosis", label: "Diagnosis", width: "1.6fr", muted: true },
            { key: "report_status", label: "Report", width: "0.8fr", muted: true },
          ]}
          emptyMessage="No cytology record carries a diagnostic category."
        />

        <FlagNote>
          Every row above is a projection from the tab that owns it and is read-only here. Morphology is edited in
          Microscopy, marker readings in Microscopy against the Staining record, sequencing in Molecular, and cytologic
          diagnoses in Cytopathology.
        </FlagNote>
      </SectionBox>

      {/* ─── Related cases in other accessions ───────────────────────────── */}
      <SectionBox title="Related Cases">
        <FlagNote>
          Cytology and histology on the same lesion are separate accessions in a real laboratory, so a related specimen
          is a linked case rather than a section of this one. A linked case is read-only here; it is never merged in.
        </FlagNote>
        <Box sx={{ display: "flex", gap: 1.5, flexWrap: "wrap", mb: 1.5, mt: 1.5 }}>
          <Button sx={outlineBtnSx} onClick={loadCompanionOptions} disabled={busy}>
            {companionLoading
              ? <CircularProgress size={14} sx={{ mr: 1, color: C.black }} />
              : <AddRounded sx={{ mr: 0.75, fontSize: 16 }} />}
            Find this patient's other cases
          </Button>
        </Box>
        {companionOptions.length > 0 && (
          <PathologyTable
            rowId={(row) => row.case_id}
            rows={companionOptions}
            columns={[
              { key: "accession_id", label: "Accession", width: "1.2fr", render: (row) => row.accession_id || shortId(row.case_id) },
              { key: "status", label: "Status", width: "1fr", muted: true },
              { key: "created_at", label: "Created", width: "1.2fr", muted: true, render: (row) => String(row.created_at || "").slice(0, 10) },
              {
                key: "actions",
                label: "",
                width: "0.8fr",
                align: "right",
                render: (row) => (
                  <Button sx={{ ...outlineBtnSx, px: 1.5, py: 0.25, fontSize: 11 }} onClick={() => addCompanion(row)}>Link</Button>
                ),
              },
            ]}
            emptyMessage="No other case."
          />
        )}

        {companionCases.length === 0 ? (
          <Typography sx={{ fontFamily: FONT, fontSize: 12.5, color: C.textMuted, mt: 1.5 }}>
            No related case is linked.
          </Typography>
        ) : companionCases.map((link) => (
          <Box key={link.link_id} sx={{ border: `1px solid ${C.border}`, p: 2, mt: 1.5, background: C.white }}>
            <Box sx={{ display: "flex", justifyContent: "space-between", alignItems: "center", mb: 1.5 }}>
              <Typography sx={{ fontFamily: FONT, fontSize: 13, fontWeight: FW_NORMAL }}>
                {link.accession_id || shortId(link.case_id)}
              </Typography>
              <Box sx={{ display: "flex", gap: 0.5 }}>
                <IconButton size="small" title="View this case" onClick={() => viewCompanion(link.case_id)} disabled={busy || !link.case_id}>
                  <VisibilityRounded sx={{ fontSize: 17 }} />
                </IconButton>
                <IconButton size="small" title="Remove link" onClick={() => removeCompanion(link.link_id)}>
                  <DeleteOutlineRounded sx={{ fontSize: 17 }} />
                </IconButton>
              </Box>
            </Box>
            <FG cols={2}>
              <Sel
                label="Relation To This Case"
                options={COMPANION_RELATION_OPTIONS}
                value={link.relation}
                onChange={(value) => updateCompanion(link.link_id, "relation", value)}
              />
              <LineField
                label="Note"
                value={link.note}
                onChange={(value) => updateCompanion(link.link_id, "note", value)}
                placeholder="e.g. EBUS-FNA of the same hilar node, same session"
              />
            </FG>
          </Box>
        ))}
      </SectionBox>

      {/* ─── The pathologist's synthesis ─────────────────────────────────── */}
      <SectionBox title="Speech-to-Text Integrated Assessment Dictation">
        <TextArea
          label="Transcript"
          value={transcript}
          onChange={setTranscript}
          rows={4}
          placeholder="Dictate the integrated assessment — how each stream (morphology, special stains / IHC / FISH, molecular, cytology, clinical / imaging) contributed, any conflict and its resolution, and the final integrated diagnosis."
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
            disabled={isTranscribing || isAutofilling || isSaving}
          >
            {isRecording ? <StopRounded sx={{ mr: 0.75, fontSize: 16 }} /> : <MicRounded sx={{ mr: 0.75, fontSize: 16 }} />}
            {isTranscribing ? "Processing..." : isRecording ? "Stop Recording" : "Start Recording"}
          </Button>
          <Button sx={outlineBtnSx} onClick={handleAutofill} disabled={isRecording || isTranscribing || isAutofilling || !transcript.trim()}>
            {isAutofilling ? <CircularProgress size={14} sx={{ mr: 1, color: C.black }} /> : <AutoAwesomeRounded sx={{ mr: 0.75, fontSize: 16 }} />}
            AI Autofill Empty Fields
          </Button>
        </Box>
        <FlagNote>
          Dictation is structured into the currently-empty synthesis fields below. It never overwrites a recorded value and
          never touches who confirmed the case or when. The filled fields and a dictation record are saved together when you
          press Save Integrated Diagnosis.
        </FlagNote>
      </SectionBox>

      <SectionBox title="Integrated Assessment">
        {!hasEvidence && (
          <FlagNote>
            Nothing has been recorded upstream yet. Complete a microscopy review, an ancillary reading, a molecular
            report or a cytology diagnosis before integrating the case.
          </FlagNote>
        )}
        <FG cols={2}>
          <TextArea label="Contribution From Morphology" value={integration.morphology_contribution} onChange={set("morphology_contribution")} />
          <TextArea label="Contribution From Special Stains / IHC / FISH" value={integration.ancillary_contribution} onChange={set("ancillary_contribution")} />
          <TextArea label="Contribution From Molecular Findings" value={integration.molecular_contribution} onChange={set("molecular_contribution")} />
          <TextArea label="Contribution From Cytology" value={integration.cytology_contribution} onChange={set("cytology_contribution")} />
        </FG>
        <Box sx={{ mb: 2 }}><TextArea label="Clinical and Imaging Contribution" value={integration.clinical_imaging_contribution} onChange={set("clinical_imaging_contribution")} /></Box>
        <FG cols={2}>
          <Sel label="Overall Concordance" options={CONCORDANCE_OPTIONS} value={integration.overall_concordance} onChange={set("overall_concordance")} />
          <TextArea label="Conflicting Findings and Resolution" value={integration.conflict_resolution} onChange={set("conflict_resolution")} />
        </FG>
        <Box sx={{ mb: 2 }}><TextArea label="Final Integrated Diagnosis" value={integration.final_integrated_diagnosis} onChange={set("final_integrated_diagnosis")} rows={3} /></Box>
        <FG cols={2}>
          <TextArea label="Remaining Uncertainty" value={integration.remaining_uncertainty} onChange={set("remaining_uncertainty")} />
          <TextArea label="Named Pending Tests" value={integration.pending_tests} onChange={set("pending_tests")} />
        </FG>
        <FG cols={3}>
          <LineField label="Confirmed By" value={integration.confirmed_by} onChange={set("confirmed_by")} />
          <LineField label="Confirmation Date and Time" value={integration.confirmation_datetime} onChange={set("confirmation_datetime")} type="datetime-local" />
          <Box sx={{ display: "flex", alignItems: "flex-end" }}>
            <Button sx={outlineBtnSx} onClick={confirmNow}>Confirm as me, now</Button>
          </Box>
        </FG>

        {outstanding.open_staining.length + outstanding.open_molecular.length > 0 && (
          <FlagNote>
            Still open: {outstanding.open_staining.length} staining record(s) and {outstanding.open_molecular.length}{" "}
            molecular order(s). Resolve them, or name them under pending tests.
          </FlagNote>
        )}
        {outstanding.unread_stains.length > 0 && (
          <FlagNote>
            {outstanding.unread_stains.length} completed stain(s) were returned to the pathologist but have no
            interpretation in Microscopy.
          </FlagNote>
        )}
        {outstanding.unreturned_molecular.length > 0 && (
          <FlagNote>
            {outstanding.unreturned_molecular.length} reported molecular order(s) have not been marked as returned for
            integrated diagnosis in Molecular.
          </FlagNote>
        )}
        {outstanding.unsigned_cytology.length > 0 && (
          <FlagNote>
            {outstanding.unsigned_cytology.length} cytology record(s) carry a diagnostic category but are not Final or
            Amended.
          </FlagNote>
        )}
        <FlagNote>
          This is the diagnosis the Synoptic Report, TNM Staging and Final Diagnosis all read. Sign-out requires it to be
          confirmed.
        </FlagNote>
      </SectionBox>

      <CapValidationDialog
        open={validationOpen}
        onClose={() => setValidationOpen(false)}
        results={validationResults}
        title="Integrated Diagnosis Review"
      />
      <PriorCaseDialog open={!!viewedCase} caseDoc={viewedCase} onClose={() => setViewedCase(null)} />
    </Box>
  );
}
