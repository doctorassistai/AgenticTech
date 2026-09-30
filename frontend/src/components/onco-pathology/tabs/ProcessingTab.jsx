import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  Box,
  Button,
  CircularProgress,
  IconButton,
  TextField,
  Typography,
} from "@mui/material";
import {
  AddRounded,
  AutoAwesomeRounded,
  CheckRounded,
  DeleteOutlineRounded,
  FactCheckRounded,
  MicRounded,
  SaveRounded,
  StopRounded,
  UploadFileRounded,
  WarningAmberRounded,
} from "@mui/icons-material";
import {
  C,
  FONT,
  FW_LIGHT,
  FW_NORMAL,
  inputSx,
  outlineBtnSx,
  saveBtnSx,
} from "../../shared/designTokens";
import { FG, FieldLabel, FlagNote, SectionBox, Sel } from "../../shared/FormComponents";
import { structureProcessing, verifyProcessingCassetteImage } from "../shared/api";
import {
  DECAL_AGENT_OPTIONS,
  EMBEDDING_MEDIUM_OPTIONS,
  PROCESSING_PROTOCOL_OPTIONS,
  PROCESSING_QUALITY_OPTIONS,
  PROCESSING_STATUS_OPTIONS,
  VERIFICATION_OPTIONS,
  YES_NO_OPTIONS,
  grossingCassettes,
  isCellBlockEntry,
  makeBlock,
  makeRun,
  mergeProcessingExtraction,
  syncProcessing,
} from "../shared/processingModel";
import { coerceDateTime, coerceEnum, coerceNumber } from "../shared/transcribeMerge";
import { validateProcessingCompleteness } from "../shared/capValidation";
import CapValidationDialog from "../CapValidationDialog";
import Code128Barcode from "../shared/Code128Barcode";
import BypassVerificationControl from "../shared/BypassVerificationControl";
import { makeBypassRecord, verificationState } from "../shared/barcodeVerification";

const API_BASE_URL = import.meta.env.VITE_BACKEND_URL || "https://doctorassist.ai/api/";

const readOnlyValue = (value) => value || "Not recorded";

const SourceValue = ({ label, value }) => (
  <Box>
    <FieldLabel>{label}</FieldLabel>
    <TextField value={readOnlyValue(value)} size="small" fullWidth InputProps={{ readOnly: true }} sx={inputSx} />
  </Box>
);

const LineField = ({ label, value, onChange, placeholder }) => (
  <Box>
    <FieldLabel>{label}</FieldLabel>
    <TextField
      value={value || ""}
      onChange={(event) => onChange(event.target.value)}
      size="small"
      fullWidth
      placeholder={placeholder}
      sx={inputSx}
    />
  </Box>
);

const DateTimeField = ({ label, value, onChange }) => (
  <Box>
    <FieldLabel>{label}</FieldLabel>
    <TextField
      type="datetime-local"
      value={value || ""}
      onChange={(event) => onChange(event.target.value)}
      size="small"
      fullWidth
      InputLabelProps={{ shrink: true }}
      sx={inputSx}
    />
  </Box>
);

const TextArea = ({ label, value, onChange, placeholder, rows = 2 }) => (
  <Box>
    <FieldLabel>{label}</FieldLabel>
    <TextField
      value={value || ""}
      onChange={(event) => onChange(event.target.value)}
      size="small"
      fullWidth
      multiline
      minRows={rows}
      placeholder={placeholder}
      sx={inputSx}
    />
  </Box>
);

// Header for a repeatable item. `onRemove` is optional: runs and blocks are
// removable; cassette cards are derived from Grossing and are not.
const ItemHeader = ({ title, subtitle, onRemove }) => (
  <Box sx={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 1, mb: 1.5 }}>
    <Box>
      <Typography sx={{ fontFamily: FONT, fontSize: 13, fontWeight: FW_NORMAL }}>{title}</Typography>
      {subtitle && (
        <Typography sx={{ fontFamily: FONT, fontSize: 11, fontWeight: FW_LIGHT, color: C.textMuted }}>
          {subtitle}
        </Typography>
      )}
    </Box>
    {onRemove && (
      <IconButton size="small" onClick={onRemove} title={`Remove ${title}`} sx={{ color: C.textSecond }}>
        <DeleteOutlineRounded fontSize="small" />
      </IconButton>
    )}
  </Box>
);

export default function ProcessingTab({
  caseId,
  accessionId,
  initialData,
  grossing,
  cytopathology,
  caseRegister,
  patientId,
  doctorId,
  doctorName,
  hospitalId,
  onSave,
}) {
  const [processing, setProcessing] = useState(() => syncProcessing(initialData, grossing, cytopathology));
  const [notice, setNotice] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [cassetteUploadId, setCassetteUploadId] = useState("");
  const [bypassCassetteId, setBypassCassetteId] = useState("");
  const [bypassReason, setBypassReason] = useState("");
  const [validationOpen, setValidationOpen] = useState(false);
  const [validationResults, setValidationResults] = useState([]);
  const [transcript, setTranscript] = useState("");
  const [isRecording, setIsRecording] = useState(false);
  const [isTranscribing, setIsTranscribing] = useState(false);
  const [isAutofilling, setIsAutofilling] = useState(false);
  const mediaRecorderRef = useRef(null);
  const audioChunksRef = useRef([]);

  useEffect(() => {
    setProcessing(syncProcessing(initialData, grossing, cytopathology));
    setNotice("");
    setCassetteUploadId("");
    setBypassCassetteId("");
    setBypassReason("");
    setTranscript("");
    setIsRecording(false);
    setIsTranscribing(false);
    setIsAutofilling(false);
  }, [caseId]); // eslint-disable-line react-hooks/exhaustive-deps

  // Grossing cassette lookup — the human-readable label and tissue are shown from
  // Grossing at render time; Processing stores only the cassette_id reference.
  const sourceCassettes = useMemo(() => grossingCassettes(grossing), [grossing]);
  const cassetteInfo = useMemo(() => {
    const map = new Map();
    sourceCassettes.forEach((cassette) => map.set(cassette.cassette_id, cassette));
    return map;
  }, [sourceCassettes]);

  // Cell-block lookup, same principle: the description is read from the cytology
  // record at render time and never copied into the processing entry.
  const cellBlockInfo = useMemo(() => {
    const map = new Map();
    (Array.isArray(cytopathology?.records) ? cytopathology.records : []).forEach((record) => {
      if (record?.cell_block_id) map.set(record.cell_block_id, record);
    });
    return map;
  }, [cytopathology]);

  // Accessioned specimen lookup — the per-specimen fixation-start (Tab 1) anchors
  // each cassette's computed fixation duration.
  const registrySpecimens = useMemo(
    () => (Array.isArray(caseRegister?.specimens) ? caseRegister.specimens : []),
    [caseRegister]
  );
  const registrySpecimenById = useMemo(
    () => new Map(registrySpecimens.map((specimen) => [specimen.specimen_id, specimen])),
    [registrySpecimens]
  );

  const update = (updater) => setProcessing((current) => updater(current));

  const addRun = () => update((current) => ({ ...current, runs: [...current.runs, makeRun()] }));

  const updateRun = (runId, key, value) => update((current) => {
    const runs = current.runs.map((run) => (run.run_id === runId ? { ...run, [key]: value } : run));
    // Recording a run's start default-fills the fixation-end (time removed from
    // formalin / loaded into the processor) for its cassettes that do not yet
    // have one. The field stays editable for cassettes that leave formalin at a
    // different time.
    if (key === "start_datetime" && value) {
      return {
        ...current,
        runs,
        cassettes: current.cassettes.map((cassette) => (
          cassette.run_id === runId && !cassette.fixation_end_datetime
            ? { ...cassette, fixation_end_datetime: value }
            : cassette
        )),
      };
    }
    return { ...current, runs };
  });

  const updateRunTechnician = (runId, value) => update((current) => ({
    ...current,
    runs: current.runs.map((run) => (run.run_id === runId
      ? { ...run, technician: { ...run.technician, name: value } }
      : run)),
  }));

  // Removing a run clears the reference on any cassette that pointed at it, so no
  // cassette is left holding a dangling run_id.
  const removeRun = (runId) => update((current) => ({
    ...current,
    runs: current.runs.filter((run) => run.run_id !== runId),
    cassettes: current.cassettes.map((cassette) => (cassette.run_id === runId ? { ...cassette, run_id: "" } : cassette)),
  }));

  const updateCassette = (cassetteId, key, value) => update((current) => ({
    ...current,
    cassettes: current.cassettes.map((cassette) => {
      if (cassette.cassette_id !== cassetteId) return cassette;
      const next = { ...cassette, [key]: value };
      // Assigning a cassette to a run with a recorded start default-fills its
      // fixation-end when not yet set (they usually leave formalin together).
      if (key === "run_id" && value && !cassette.fixation_end_datetime) {
        const run = current.runs.find((item) => item.run_id === value);
        if (run?.start_datetime) next.fixation_end_datetime = run.start_datetime;
      }
      return next;
    }),
  }));

  const handleCassetteVerificationUpload = async (cassette, event) => {
    const file = event.target.files?.[0];
    if (!file || !cassette) return;
    setCassetteUploadId(cassette.cassette_id);
    setNotice("");
    try {
      const response = await verifyProcessingCassetteImage({
        file,
        caseId,
        accessionId,
        specimenId: cassette.parent_specimen_id,
        cassetteId: cassette.cassette_id,
        patientId,
        doctorId,
        hospitalId,
      });
      const verification = response.verification;
      if (!verification) throw new Error("Verification response is missing");
      update((current) => ({
        ...current,
        cassettes: current.cassettes.map((item) => (item.cassette_id === cassette.cassette_id
          ? {
            ...item,
            received: verification.result === "matched"
              ? "Verified"
              : verification.result === "mismatch"
                ? "Mismatch"
                : "Not verified",
            cassette_verifications: [
              ...(item.cassette_verifications || []),
              {
                ...verification,
                verified_by: {
                  staff_id: doctorId || "",
                  name: doctorName || "",
                },
              },
            ],
          }
          : item)),
      }));

      if (verification.result === "matched") {
        setNotice("Cassette barcode matched the selected Grossing cassette.");
      } else if (verification.result === "mismatch") {
        setNotice("Cassette barcode does not match the selected Grossing cassette. Processing remains locked for this cassette.");
      } else {
        setNotice("No barcode could be read from the image. Processing remains locked for this cassette.");
      }
    } catch (error) {
      console.error("[ProcessingTab] cassette verification:", error);
      setNotice(error.message || "Cassette barcode verification failed.");
    } finally {
      setCassetteUploadId("");
      event.target.value = "";
    }
  };

  // Doctor's escape hatch when the cassette barcode cannot be machine-verified:
  // the bypass is appended to the same verification list (recorded honestly as
  // NOT verified, with who, when and why) and unlocks this cassette for
  // processing. Cell blocks never hit this path — they have no barcode gate.
  const bypassCassetteVerification = (cassette) => {
    const reason = bypassReason.trim();
    if (!reason || !cassette) return;
    const bypass = makeBypassRecord({ staff_id: doctorId || "", name: doctorName || "" }, reason);
    update((current) => ({
      ...current,
      cassettes: current.cassettes.map((item) => (item.cassette_id === cassette.cassette_id
        ? {
          ...item,
          received: "Bypassed",
          cassette_verifications: [
            ...(item.cassette_verifications || []),
            { ...bypass, cassette_id: cassette.cassette_id },
          ],
        }
        : item)),
    }));
    setBypassCassetteId("");
    setBypassReason("");
    setNotice("Cassette barcode verification bypassed. Processing is unlocked — the record is saved as not verified.");
  };

  // Setting an embedding medium for the first time auto-seeds one block (the
  // one-block-per-cassette default); further blocks are added manually for 1:N.
  const setEmbeddingMedium = (cassetteId, value) => update((current) => ({
    ...current,
    cassettes: current.cassettes.map((cassette) => {
      if (cassette.cassette_id !== cassetteId) return cassette;
      const next = { ...cassette, embedding_medium: value };
      if (value && (cassette.blocks || []).length === 0) next.blocks = [makeBlock()];
      return next;
    }),
  }));

  const addBlock = (cassetteId) => update((current) => ({
    ...current,
    cassettes: current.cassettes.map((cassette) => (cassette.cassette_id === cassetteId
      ? { ...cassette, blocks: [...(cassette.blocks || []), makeBlock()] }
      : cassette)),
  }));

  const updateBlock = (cassetteId, blockId, key, value) => update((current) => ({
    ...current,
    cassettes: current.cassettes.map((cassette) => (cassette.cassette_id === cassetteId
      ? { ...cassette, blocks: (cassette.blocks || []).map((block) => (block.block_id === blockId ? { ...block, [key]: value } : block)) }
      : cassette)),
  }));

  const removeBlock = (cassetteId, blockId) => update((current) => ({
    ...current,
    cassettes: current.cassettes.map((cassette) => (cassette.cassette_id === cassetteId
      ? { ...cassette, blocks: (cassette.blocks || []).filter((block) => block.block_id !== blockId) }
      : cassette)),
  }));

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
      console.error("[ProcessingTab] microphone:", error);
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
        console.error("[ProcessingTab] transcription:", error);
        setNotice("Processing dictation transcription failed.");
      } finally {
        setIsTranscribing(false);
      }
    };
    mediaRecorderRef.current.stop();
    mediaRecorderRef.current.stream.getTracks().forEach((track) => track.stop());
  };

  // Dictation is advisory: it fills only EMPTY fields. Run facts land on the
  // first run (a new run is created when none exists); a cassette entry with a
  // stated label routes to that cassette, and an unlabelled entry (batch-level
  // facts) is applied to every cassette. Nothing already entered is clobbered.
  const handleAutofill = async () => {
    if (!transcript.trim()) return;
    setIsAutofilling(true);
    setNotice("");
    try {
      const response = await structureProcessing(transcript);
      if (response.status !== "success" || !response.data) throw new Error("No structured data returned");
      const reviewedAt = new Date().toISOString();
      const data = response.data;

      const patchRun = data.run
        ? {
          processor_machine_id: data.run.processor_machine_id || "",
          batch_run_id: data.run.batch_run_id || "",
          protocol: coerceEnum(data.run.protocol, PROCESSING_PROTOCOL_OPTIONS),
          protocol_other: data.run.protocol_other || "",
          technician: data.run.technician_name ? { name: data.run.technician_name } : undefined,
          status: coerceEnum(data.run.status, PROCESSING_STATUS_OPTIONS),
          start_datetime: coerceDateTime(data.run.start_datetime),
          end_datetime: coerceDateTime(data.run.end_datetime),
        }
        : null;

      const patchCassettes = (data.cassettes || []).map((entry) => ({
        label: entry.label || "",
        decalcification_required: coerceEnum(entry.decalcification_required, YES_NO_OPTIONS),
        decalcification_agent: coerceEnum(entry.decalcification_agent, DECAL_AGENT_OPTIONS),
        decalcification_agent_other: entry.decalcification_agent_other || "",
        special_handling: entry.special_handling || "",
        embedding_medium: coerceEnum(entry.embedding_medium, EMBEDDING_MEDIUM_OPTIONS),
        embedding_orientation: entry.embedding_orientation || "",
        embedded_by: entry.embedded_by || "",
        processing_quality: coerceEnum(entry.processing_quality, PROCESSING_QUALITY_OPTIONS),
        reprocessing_required: coerceEnum(entry.reprocessing_required, YES_NO_OPTIONS),
        tissue_or_cassette_issue: entry.tissue_or_cassette_issue || "",
        corrective_action: entry.corrective_action || "",
        ready_for_sectioning: coerceEnum(entry.ready_for_sectioning, YES_NO_OPTIONS),
        fixation_end_datetime: coerceDateTime(entry.fixation_end_datetime),
        decal_start_datetime: coerceDateTime(entry.decal_start_datetime),
        decal_end_datetime: coerceDateTime(entry.decal_end_datetime),
        embedding_datetime: coerceDateTime(entry.embedding_datetime),
        comments: entry.comments || "",
        // How many blocks this cassette yielded ("two blocks" → "2"). It is a
        // routing-only fact, consumed by the merge to mint blocks — never stored.
        block_count: coerceNumber(entry.block_count),
      }));

      update((current) => {
        // Route a stated cassette label to that cassette; an unlabelled batch
        // entry is applied to every cassette by mergeProcessingExtraction.
        const labelToId = new Map();
        current.cassettes.forEach((cassette) => {
          const info = cassetteInfo.get(cassette.cassette_id);
          const label = isCellBlockEntry(cassette) ? null : info?.label || "";
          if (!label) return;
          labelToId.set(label.toLowerCase().replace(/[^a-z0-9]/g, ""), cassette.cassette_id);
        });

        const merged = mergeProcessingExtraction(
          current,
          { run: patchRun, cassettes: patchCassettes },
          labelToId
        );
        return {
          ...merged,
          dictation: {
            transcript,
            structured_at: reviewedAt,
            review_status: "accepted",
            reviewed_by: doctorName || doctorId || "",
            reviewed_at: reviewedAt,
          },
        };
      });
      setNotice("Dictation fields were applied to empty Processing fields on verified cassettes.");
    } catch (error) {
      console.error("[ProcessingTab] structure:", error);
      setNotice("Processing dictation structuring failed.");
    } finally {
      setIsAutofilling(false);
    }
  };

  const handleValidate = () => {
    setValidationResults(validateProcessingCompleteness(processing, registrySpecimens));
    setValidationOpen(true);
  };

  const handleSubmit = async () => {
    setIsSaving(true);
    try {
      await onSave("processing", processing);
    } finally {
      setIsSaving(false);
    }
  };

  if (sourceCassettes.length === 0) {
    return (
      <Box sx={{ border: `1px solid ${C.border}`, background: C.bgSecondary, p: 3, fontFamily: FONT }}>
        <Typography sx={{ fontFamily: FONT, fontSize: 14, fontWeight: FW_NORMAL, mb: 0.5 }}>
          No Grossing cassettes are available to process.
        </Typography>
        <Typography sx={{ fontFamily: FONT, fontSize: 12, color: C.textMuted }}>
          Document and save cassettes in the Grossing Bench before tissue processing and embedding.
        </Typography>
      </Box>
    );
  }

  const expected = processing.cassettes.length;
  const received = processing.cassettes.filter((cassette) => cassette.received === "Verified").length;
  const mismatched = processing.cassettes.filter((cassette) => cassette.received === "Mismatch").length;
  const bypassedCount = processing.cassettes.filter((cassette) => cassette.received === "Bypassed").length;
  const blockCount = processing.cassettes.reduce((sum, cassette) => sum + (cassette.blocks || []).length, 0);
  const runOptions = [
    { value: "", label: "— Unassigned —" },
    ...processing.runs.map((run, index) => ({ value: run.run_id, label: run.batch_run_id || `Run ${index + 1}` })),
  ];
  const busy = isSaving || !!cassetteUploadId || isRecording || isTranscribing || isAutofilling;

  return (
    <Box sx={{ fontFamily: FONT }}>
      <SectionBox title="Cassette Intake and Reconciliation">
        <FG cols={5}>
          <SourceValue label="Cassettes Expected (from Grossing)" value={String(expected)} />
          <SourceValue label="Verified Received" value={String(received)} />
          <SourceValue label="Barcode / Label Mismatches" value={String(mismatched)} />
          <SourceValue label="Bypassed (Not Verified)" value={String(bypassedCount)} />
          <SourceValue label="Blocks Generated" value={String(blockCount)} />
        </FG>
        <FlagNote>
          Expected, received, and block counts are computed by the software from the Grossing cassette list and the
          per-cassette verification below — not entered by hand.
        </FlagNote>
      </SectionBox>

      <SectionBox title="Speech-to-Text Processing Dictation">
        <TextArea label="Transcript" value={transcript} onChange={setTranscript} rows={3} />
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
            disabled={isTranscribing || isAutofilling}
          >
            {isRecording ? <StopRounded sx={{ mr: 0.75, fontSize: 16 }} /> : <MicRounded sx={{ mr: 0.75, fontSize: 16 }} />}
            {isTranscribing ? "Processing..." : isRecording ? "Stop Recording" : "Start Recording"}
          </Button>
          <Button sx={outlineBtnSx} onClick={handleAutofill} disabled={busy || !transcript.trim()}>
            {isAutofilling ? <CircularProgress size={14} sx={{ mr: 1, color: C.black }} /> : <AutoAwesomeRounded sx={{ mr: 0.75, fontSize: 16 }} />}
            AI Autofill Empty Fields
          </Button>
        </Box>
      </SectionBox>

      <SectionBox title="Processing Runs">
        <Box sx={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 2, mb: 1.5, flexWrap: "wrap" }}>
          <Typography sx={{ fontFamily: FONT, fontSize: 12, color: C.textSecond }}>
            Runs defined: {processing.runs.length}
          </Typography>
          <Button sx={outlineBtnSx} onClick={addRun}>
            <AddRounded sx={{ mr: 0.75, fontSize: 16 }} /> Add Run
          </Button>
        </Box>
        {processing.runs.map((run, index) => (
          <Box key={run.run_id} sx={{ border: `1px solid ${C.border}`, p: 2, mb: 1.5, background: C.white }}>
            <ItemHeader title={`Run ${index + 1}`} subtitle={run.run_id} onRemove={() => removeRun(run.run_id)} />
            <FG cols={2}>
              <LineField label="Processor / Machine ID" value={run.processor_machine_id} onChange={(value) => updateRun(run.run_id, "processor_machine_id", value)} />
              <LineField label="Batch / Run Number" value={run.batch_run_id} onChange={(value) => updateRun(run.run_id, "batch_run_id", value)} />
              <Box>
                <FieldLabel>Processing Protocol</FieldLabel>
                <Sel label="Processing Protocol" options={PROCESSING_PROTOCOL_OPTIONS} value={run.protocol} onChange={(value) => updateRun(run.run_id, "protocol", value)} />
              </Box>
              {run.protocol === "Other" && (
                <LineField label="Other Protocol" value={run.protocol_other} onChange={(value) => updateRun(run.run_id, "protocol_other", value)} />
              )}
              <LineField label="Technician" value={run.technician?.name} onChange={(value) => updateRunTechnician(run.run_id, value)} />
              <Box>
                <FieldLabel>Run Status</FieldLabel>
                <Sel label="Run Status" options={PROCESSING_STATUS_OPTIONS} value={run.status} onChange={(value) => updateRun(run.run_id, "status", value)} />
              </Box>
              <DateTimeField label="Start Date and Time" value={run.start_datetime} onChange={(value) => updateRun(run.run_id, "start_datetime", value)} />
              <DateTimeField label="End Date and Time" value={run.end_datetime} onChange={(value) => updateRun(run.run_id, "end_datetime", value)} />
            </FG>
          </Box>
        ))}
        {processing.runs.length === 0 && (
          <FlagNote>No processing run defined yet. Add a run, then assign cassettes to it below.</FlagNote>
        )}
      </SectionBox>

      <SectionBox title="Per-Cassette Processing, Embedding and Blocks">
        {processing.cassettes.map((cassette) => {
          const isCellBlock = isCellBlockEntry(cassette);
          const cytologyRecord = isCellBlock ? cellBlockInfo.get(cassette.cassette_id) : null;
          const info = cassetteInfo.get(cassette.cassette_id);
          const label = isCellBlock
            ? `Cell block${cytologyRecord?.specimen_type ? ` · ${cytologyRecord.specimen_type}` : ""}`
            : info?.label || "Unlabelled";
          const { latest: verification, matched, bypassed, failed, unlocked } = verificationState(cassette.cassette_verifications);
          // A cell block has no grossing cassette to photograph or scan against —
          // it was embedded from a cytology pellet, not cut at the bench — so the
          // image/barcode gate does not apply and must not lock it forever.
          const cassetteLocked = !unlocked && !isCellBlock;
          const decodedValues = (verification?.decoded_barcodes || []).map((item) => item.value).filter(Boolean);
          const strongAcid = cassette.decalcification_required === "Yes" && /hcl|formic/i.test(cassette.decalcification_agent || "");
          const fixationStart = registrySpecimenById.get(cassette.parent_specimen_id)?.fixation_start_datetime || "";
          const fixationEnd = cassette.fixation_end_datetime || "";
          const fixationHours = (() => {
            if (!fixationStart || !fixationEnd) return null;
            const start = new Date(fixationStart).getTime();
            const end = new Date(fixationEnd).getTime();
            if (!Number.isFinite(start) || !Number.isFinite(end)) return null;
            return Math.round(((end - start) / 3600000) * 10) / 10;
          })();
          const fixationNote = (() => {
            if (fixationHours === null) return "";
            if (fixationHours < 0) return "Fixation end precedes fixation start — check the recorded times.";
            let note = `Fixation duration: ${fixationHours} h.`;
            if (fixationHours < 6) note += " Under 6 hours — inadequate nuclear detail for optimal interpretation.";
            if (fixationHours > 72) note += " Over 72 hours — prolonged fixation may reduce antigenicity for IHC markers.";
            if (fixationHours >= 6 && fixationHours < 12) note += " CAP recommends ≥12 h for optimal IHC.";
            return note;
          })();
          const fixationOutOfRange = fixationHours !== null && (fixationHours < 0 || fixationHours < 6 || fixationHours > 72);
          return (
            <Box
              key={cassette.cassette_id}
              sx={{
                border: `1px solid ${failed ? "#cf1322" : bypassed ? "#b76e00" : matched ? C.black : C.border}`,
                p: 2,
                mb: 1.5,
                background: C.white,
              }}
            >
              <ItemHeader title={isCellBlock ? label : `Cassette ${label}`} subtitle={cassette.cassette_id} />
              <FG cols={2}>
                <SourceValue label="Parent Specimen ID" value={cassette.parent_specimen_id} />
                <SourceValue
                  label={isCellBlock ? "Cell block (from Cytopathology)" : "Tissue (from Grossing)"}
                  value={isCellBlock ? cytologyRecord?.cell_block_description : info?.tissue_description}
                />
                <SourceValue label="Received at Processing" value={cassette.received} />
              </FG>

              {isCellBlock ? (
                <Box sx={{ border: `1px solid ${C.border}`, background: C.bgSecondary, p: 1.5, mb: 2 }}>
                  <Typography sx={{ fontFamily: FONT, fontSize: 11.5, color: C.textSecond }}>
                    Cassette barcode verification does not apply. This block was embedded from a cytology cell block
                    ({cassette.cassette_id}) rather than cut at the grossing bench, so there is no grossing cassette to
                    photograph or scan against. From here on it is processed, sectioned and stained like any other block.
                  </Typography>
                </Box>
              ) : (
              <Box sx={{ border: `1px solid ${failed ? "#cf1322" : C.border}`, background: C.bgSecondary, p: 1.5, mb: 2 }}>
                <Box sx={{ display: "flex", alignItems: "center", gap: 1, flexWrap: "wrap" }}>
                  <Button component="label" sx={outlineBtnSx} disabled={!!cassetteUploadId}>
                    {cassetteUploadId === cassette.cassette_id
                      ? <CircularProgress size={14} sx={{ mr: 1, color: C.black }} />
                      : <UploadFileRounded sx={{ mr: 0.75, fontSize: 16 }} />}
                    {verification ? "Upload New Cassette Image" : "Upload Cassette Image"}
                    <input
                      hidden
                      type="file"
                      accept="image/*"
                      onChange={(event) => handleCassetteVerificationUpload(cassette, event)}
                    />
                  </Button>
                  {matched && (
                    <Typography sx={{ display: "flex", alignItems: "center", gap: 0.5, fontFamily: FONT, fontSize: 11, color: C.black }}>
                      <CheckRounded sx={{ fontSize: 16 }} /> Barcode matched
                    </Typography>
                  )}
                  {failed && (
                    <Typography sx={{ display: "flex", alignItems: "center", gap: 0.5, fontFamily: FONT, fontSize: 11, color: "#cf1322" }}>
                      <WarningAmberRounded sx={{ fontSize: 16 }} />
                      {verification.result === "mismatch" ? "Barcode mismatch" : "Barcode not found"}
                    </Typography>
                  )}
                </Box>
                {decodedValues.length > 0 && failed && (
                  <Typography sx={{ fontFamily: FONT, fontSize: 10.5, color: C.textSecond, mt: 0.75, wordBreak: "break-all" }}>
                    Read from image: {decodedValues.join(", ")}
                  </Typography>
                )}
                {verification?.image?.file_url && (
                  <Button
                    component="a"
                    href={verification.image.file_url}
                    target="_blank"
                    rel="noreferrer"
                    sx={{ ...outlineBtnSx, mt: 1, px: 1.5, py: 0.5 }}
                  >
                    View Verification Image
                  </Button>
                )}
                {!matched && (
                  <BypassVerificationControl
                    bypassed={bypassed}
                    bypassedBy={verification?.bypassed_by}
                    bypassedAt={verification?.bypassed_at}
                    bypassReason={verification?.reason}
                    open={bypassCassetteId === cassette.cassette_id}
                    reason={bypassReason}
                    onReasonChange={setBypassReason}
                    onConfirm={() => bypassCassetteVerification(cassette)}
                    onCancel={() => { setBypassCassetteId(""); setBypassReason(""); }}
                    onOpen={() => { setBypassCassetteId(cassette.cassette_id); setBypassReason(""); }}
                    busy={!!cassetteUploadId}
                  />
                )}
              </Box>
              )}

              {cassetteLocked && (
                <Box sx={{ border: "1px solid #cf1322", background: "#fff1f0", p: 1.5, mb: 2 }}>
                  <Typography sx={{ display: "flex", alignItems: "center", gap: 0.75, fontFamily: FONT, fontSize: 12, color: "#cf1322" }}>
                    <WarningAmberRounded sx={{ fontSize: 17 }} />
                    Upload a matching cassette barcode image to unlock processing for this cassette, or bypass the verification.
                  </Typography>
                </Box>
              )}

              <Box
                component="fieldset"
                disabled={cassetteLocked}
                sx={{ border: 0, p: 0, m: 0, minWidth: 0, opacity: cassetteLocked ? 0.55 : 1 }}
              >
                <FG cols={2}>
                  <Box>
                    <FieldLabel>Processing Run</FieldLabel>
                    <Sel label="Processing Run" options={runOptions} value={cassette.run_id} onChange={(value) => updateCassette(cassette.cassette_id, "run_id", value)} />
                  </Box>
                  <DateTimeField label="Fixation End (time removed from formalin)" value={cassette.fixation_end_datetime} onChange={(value) => updateCassette(cassette.cassette_id, "fixation_end_datetime", value)} />
                </FG>

                {fixationNote && (
                  <Box sx={{ borderLeft: `3px solid ${fixationOutOfRange ? "#cf1322" : C.borderStrong}`, pl: 1.5, py: 0.75, mb: 1.5 }}>
                    <Typography sx={{ fontFamily: FONT, fontSize: 11, color: fixationOutOfRange ? "#cf1322" : C.textSecond }}>
                      {fixationNote}
                    </Typography>
                  </Box>
                )}

              <FG cols={2}>
                <Box>
                  <FieldLabel>Decalcification Required</FieldLabel>
                  <Sel label="Decalcification Required" options={YES_NO_OPTIONS} value={cassette.decalcification_required} onChange={(value) => updateCassette(cassette.cassette_id, "decalcification_required", value)} />
                </Box>
                {cassette.decalcification_required === "Yes" && (
                  <Box>
                    <FieldLabel>Decalcification Agent</FieldLabel>
                    <Sel label="Decalcification Agent" options={DECAL_AGENT_OPTIONS} value={cassette.decalcification_agent} onChange={(value) => updateCassette(cassette.cassette_id, "decalcification_agent", value)} />
                  </Box>
                )}
                {cassette.decalcification_required === "Yes" && cassette.decalcification_agent === "Other" && (
                  <LineField label="Other Decalcification Agent" value={cassette.decalcification_agent_other} onChange={(value) => updateCassette(cassette.cassette_id, "decalcification_agent_other", value)} />
                )}
                {cassette.decalcification_required === "Yes" && (
                  <DateTimeField label="Decalcification Start" value={cassette.decal_start_datetime} onChange={(value) => updateCassette(cassette.cassette_id, "decal_start_datetime", value)} />
                )}
                {cassette.decalcification_required === "Yes" && (
                  <DateTimeField label="Decalcification End" value={cassette.decal_end_datetime} onChange={(value) => updateCassette(cassette.cassette_id, "decal_end_datetime", value)} />
                )}
              </FG>
              {strongAcid && (
                <FlagNote>
                  Strong-acid decalcification (HCl / formic acid) may impair IHC, ISH, and molecular studies — confirm
                  downstream testing needs.
                </FlagNote>
              )}

              <TextArea label="Special Handling" value={cassette.special_handling} onChange={(value) => updateCassette(cassette.cassette_id, "special_handling", value)} placeholder="e.g. mega-cassette, delicate fragments, orientation-critical" />

              <FG cols={2}>
                <Box>
                  <FieldLabel>Embedding Medium</FieldLabel>
                  <Sel label="Embedding Medium" options={EMBEDDING_MEDIUM_OPTIONS} value={cassette.embedding_medium} onChange={(value) => setEmbeddingMedium(cassette.cassette_id, value)} />
                </Box>
                <DateTimeField label="Embedding Date and Time" value={cassette.embedding_datetime} onChange={(value) => updateCassette(cassette.cassette_id, "embedding_datetime", value)} />
                <LineField label="Embedded By" value={cassette.embedded_by} onChange={(value) => updateCassette(cassette.cassette_id, "embedded_by", value)} />
                <TextArea label="Embedding Orientation" value={cassette.embedding_orientation} onChange={(value) => updateCassette(cassette.cassette_id, "embedding_orientation", value)} placeholder="e.g. embed on edge, face-down, all fragments in one plane" />
              </FG>

              <Box sx={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 2, mt: 1, mb: 1, flexWrap: "wrap" }}>
                <FieldLabel>Blocks ({(cassette.blocks || []).length})</FieldLabel>
                <Button sx={{ ...outlineBtnSx, px: 1.5, py: 0.5 }} onClick={() => addBlock(cassette.cassette_id)}>
                  <AddRounded sx={{ mr: 0.5, fontSize: 15 }} /> Add Block
                </Button>
              </Box>
              {(cassette.blocks || []).map((block, blockIndex) => (
                <Box key={block.block_id} sx={{ border: `1px solid ${C.border}`, p: 1.5, mb: 1, background: C.bgSecondary }}>
                  <ItemHeader title={`Block ${blockIndex + 1}`} subtitle={block.block_id} onRemove={() => removeBlock(cassette.cassette_id, block.block_id)} />
                  <Box sx={{ mb: 1.5 }}>
                    <FieldLabel>Block Barcode</FieldLabel>
                    <Code128Barcode value={block.block_id} accessionId={accessionId} />
                  </Box>
                  <Box>
                    <FieldLabel>Block Barcode Verification</FieldLabel>
                    <Sel label="Barcode Verification" options={VERIFICATION_OPTIONS} value={block.barcode_verified} onChange={(value) => updateBlock(cassette.cassette_id, block.block_id, "barcode_verified", value)} />
                  </Box>
                </Box>
              ))}
              {(cassette.blocks || []).length === 0 && (
                <FlagNote>No block generated yet. A block is added automatically when an embedding medium is set; add more for 1:N mapping.</FlagNote>
              )}

              <FG cols={2}>
                <Box>
                  <FieldLabel>Processing Quality</FieldLabel>
                  <Sel label="Processing Quality" options={PROCESSING_QUALITY_OPTIONS} value={cassette.processing_quality} onChange={(value) => updateCassette(cassette.cassette_id, "processing_quality", value)} />
                </Box>
                <Box>
                  <FieldLabel>Reprocessing Required</FieldLabel>
                  <Sel label="Reprocessing Required" options={YES_NO_OPTIONS} value={cassette.reprocessing_required} onChange={(value) => updateCassette(cassette.cassette_id, "reprocessing_required", value)} />
                </Box>
              </FG>
              <TextArea label="Tissue / Cassette Issue" value={cassette.tissue_or_cassette_issue} onChange={(value) => updateCassette(cassette.cassette_id, "tissue_or_cassette_issue", value)} placeholder="Record any processing or quality problem observed" />
              <TextArea label="Corrective Action" value={cassette.corrective_action} onChange={(value) => updateCassette(cassette.cassette_id, "corrective_action", value)} />
              <FG cols={2}>
                <Box>
                  <FieldLabel>Ready for Sectioning</FieldLabel>
                  <Sel label="Ready for Sectioning" options={YES_NO_OPTIONS} value={cassette.ready_for_sectioning} onChange={(value) => updateCassette(cassette.cassette_id, "ready_for_sectioning", value)} />
                </Box>
              </FG>
                <TextArea label="Comments" value={cassette.comments} onChange={(value) => updateCassette(cassette.cassette_id, "comments", value)} />
              </Box>
            </Box>
          );
        })}
      </SectionBox>

      {notice && (
        <Box sx={{ border: `1px solid ${C.border}`, background: C.bgSecondary, p: 1.5, mb: 2.5 }}>
          <Typography sx={{ fontFamily: FONT, fontSize: 12, color: C.textSecond }}>{notice}</Typography>
        </Box>
      )}

      <Box sx={{ display: "flex", gap: 1.5, flexWrap: "wrap" }}>
        <Button sx={outlineBtnSx} onClick={handleValidate}>
          <FactCheckRounded sx={{ mr: 0.75, fontSize: 16 }} /> Review Reconciliation
        </Button>
        <Button sx={saveBtnSx} onClick={handleSubmit} disabled={busy}>
          {isSaving ? <CircularProgress size={14} sx={{ mr: 1, color: C.white }} /> : <SaveRounded sx={{ mr: 0.75, fontSize: 16 }} />}
          Save Processing
        </Button>
      </Box>

      <CapValidationDialog
        open={validationOpen}
        onClose={() => setValidationOpen(false)}
        title="Processing Reconciliation Review"
        results={validationResults}
      />
    </Box>
  );
}
