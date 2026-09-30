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
import { FG, FieldLabel, FlagNote, SectionBox, Sel, SubTabBar } from "../../shared/FormComponents";
import { structureStaining, verifyStainingSlideImage } from "../shared/api";
import {
  CONTROL_RESULT_OPTIONS,
  FISH_SIGNAL_QUALITY_OPTIONS,
  HE_APPEARANCE_OPTIONS,
  REPEAT_WORK_TYPES,
  REQUESTED_WORK_TYPES,
  SPECIAL_STAIN_TYPE_OPTIONS,
  STAIN_MODALITY_OPTIONS,
  STAIN_QUALITY_OPTIONS,
  STAIN_STATUS_OPTIONS,
  WORK_TYPE_OPTIONS,
  YES_NO_OPTIONS,
  controlAccepted,
  isStainQualityProblem,
  makeStainRecord,
  makeStainRecordFromRequest,
  mergeStainingExtraction,
  modalityForIntendedUse,
  modalityKey,
  openRequestItems,
  sectioningSlides,
  stainTargetOf,
  stainTechnicalOutcomeOf,
  syncStaining,
  withModality,
} from "../shared/stainingModel";
import { completeAncillaryResults } from "../shared/microscopyModel";
import { coerceDateTime, coerceEnum, coerceNumber } from "../shared/transcribeMerge";
import { validateStainingCompleteness } from "../shared/capValidation";
import CapValidationDialog from "../CapValidationDialog";
import PathologyTable from "../PathologyTable";
import BypassVerificationControl from "../shared/BypassVerificationControl";
import { makeBypassRecord, verificationState } from "../shared/barcodeVerification";

const API_BASE_URL = import.meta.env.VITE_BACKEND_URL || "https://doctorassist.ai/api/";

const readOnlyValue = (value) => value || "Not recorded";

// Slide IDs are compact SLD-<token> values; the tail is enough to tell two
// slides apart in a dropdown. The full ID is always shown on the stain card.
const shortId = (id) => (id ? String(id).slice(-6) : "");

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

// Groups the long stain card into the bench steps: order, run, control, result.
const SubHeading = ({ children }) => (
  <Typography
    sx={{
      fontFamily: FONT,
      fontSize: 11,
      letterSpacing: "0.08em",
      textTransform: "uppercase",
      color: C.textMuted,
      mt: 2,
      mb: 1,
    }}
  >
    {children}
  </Typography>
);

// One stain-order card owns one dictation area. The order is already anchored to
// a slide + sub-workflow (the technologist picked them before creating it), so
// the transcript and the autofill never need to name a slide or route a fact —
// everything lands on this order's own fields. `locked` mirrors the surrounding
// fieldset, so an order whose slide barcode is not yet verified cannot be
// dictated into.
const RecordDictation = ({
  locked,
  transcript,
  onTranscript,
  isRecording,
  transcribing,
  autofilling,
  busyElsewhere,
  onToggleRecording,
  onAutofill,
  dictation,
}) => {
  const recordingDisabled = locked || transcribing || autofilling || busyElsewhere;
  const autofillDisabled = locked || isRecording || !transcript.trim() || transcribing || autofilling || busyElsewhere;
  return (
    <Box sx={{ border: `1px solid ${C.border}`, background: C.bgSecondary, p: 1.5, mb: 2 }}>
      <FieldLabel>Dictation for This Order</FieldLabel>
      <TextField
        value={transcript}
        onChange={(event) => onTranscript(event.target.value)}
        size="small"
        fullWidth
        multiline
        minRows={3}
        placeholder="Describe this stain run — platform, run/batch, technician, marker / probe details, control, quality, outcome. The transcript is structured into the empty fields of this order only."
        sx={inputSx}
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
          onClick={onToggleRecording}
          disabled={recordingDisabled}
        >
          {isRecording ? <StopRounded sx={{ mr: 0.75, fontSize: 16 }} /> : <MicRounded sx={{ mr: 0.75, fontSize: 16 }} />}
          {transcribing ? "Processing..." : isRecording ? "Stop Recording" : "Start Recording"}
        </Button>
        <Button sx={outlineBtnSx} onClick={onAutofill} disabled={autofillDisabled}>
          {autofilling ? <CircularProgress size={14} sx={{ mr: 1, color: C.black }} /> : <AutoAwesomeRounded sx={{ mr: 0.75, fontSize: 16 }} />}
          AI Autofill Empty Fields
        </Button>
      </Box>
      {dictation?.structured_at && (
        <FlagNote>
          Last structured {dictation.structured_at} — {dictation.review_status}
        </FlagNote>
      )}
      <FlagNote>
        Dictation is scoped to this order's own fields. It fills only blanks and placeholder defaults (Ordered /
        Not run / No), never overwrites a recorded value, and never writes identity, lineage or repeat/restain links.
      </FlagNote>
    </Box>
  );
};

// The shared record-level field options a technologist can dictate against.
const STAIN_DICTATION_FLAT_ENUM = {
  status: STAIN_STATUS_OPTIONS,
  control_result: CONTROL_RESULT_OPTIONS,
  quality_result: STAIN_QUALITY_OPTIONS,
  repeat_required: YES_NO_OPTIONS,
};

const STAIN_DICTATION_FLAT_TEXT = [
  "ordered_by",
  "diagnostic_question",
  "platform_id",
  "run_batch_id",
  "technician",
  "protocol",
  "protocol_version",
  "control_note",
  "quality_note",
  "repeat_reason",
  "source_report_ref",
  "checked_by",
  "comments",
];

const STAIN_DICTATION_FLAT_DATETIME = ["order_datetime", "stain_datetime", "result_datetime", "check_datetime"];

// Turn one stain order's structured dictation response into a merge patch split
// into `flat` (record-level keys) and `detail` (the keys of the order's own
// he / special / ihc / fish group), coercing free text onto canonical options,
// bare numbers and datetimes before the model merge writes it. The sub-workflow
// is known — the technologist set it when adding the order — so the detail keys
// are chosen deterministically here, never by the LLM routing.
const stainingDictationPatch = (record, data) => {
  const source = data || {};
  const rawRecord = source.record || {};
  const rawDetail = source.detail || {};
  const flat = {};
  const detail = {};

  STAIN_DICTATION_FLAT_TEXT.forEach((key) => {
    if (typeof rawRecord[key] === "string" && rawRecord[key].trim()) flat[key] = rawRecord[key].trim();
  });
  Object.entries(STAIN_DICTATION_FLAT_ENUM).forEach(([key, options]) => {
    const value = coerceEnum(rawRecord[key], options);
    if (value) flat[key] = value;
  });
  STAIN_DICTATION_FLAT_DATETIME.forEach((key) => {
    const value = coerceDateTime(rawRecord[key]);
    if (value) flat[key] = value;
  });

  const text = (key) => {
    if (typeof rawDetail[key] === "string" && rawDetail[key].trim()) detail[key] = rawDetail[key].trim();
  };
  const snap = (key, options) => {
    const value = coerceEnum(rawDetail[key], options);
    if (value) detail[key] = value;
  };
  const number = (key) => {
    const value = coerceNumber(rawDetail[key]);
    if (value !== "") detail[key] = value;
  };

  if (record.modality === "IHC") {
    ["marker", "clone", "vendor", "dilution", "lot"].forEach(text);
    snap("negative_control_result", CONTROL_RESULT_OPTIONS);
  } else if (record.modality === "FISH") {
    ["gene_target", "probe_kit", "vendor", "catalog_number", "lot", "hybridization_protocol"].forEach(text);
    snap("signal_quality", FISH_SIGNAL_QUALITY_OPTIONS);
    ["cells_counted", "signal_ratio", "copy_number"].forEach(number);
  } else if (record.modality === "Special stain") {
    snap("stain_type", SPECIAL_STAIN_TYPE_OPTIONS);
    ["stain_type_other", "reagent_lot"].forEach(text);
  } else if (record.modality === "H&E") {
    snap("appearance", HE_APPEARANCE_OPTIONS);
  }

  return { flat, detail };
};

// The plan keeps H&E, special stains, IHC and FISH as separate sub-workflows
// rather than one large form, so the card list is filtered by modality.
const MODALITY_TABS = ["All", ...STAIN_MODALITY_OPTIONS];

export default function StainingTab({
  caseId,
  accessionId,
  initialData,
  sectioning,
  grossing,
  microscopy,
  patientId,
  doctorId,
  doctorName,
  hospitalId,
  onSave,
}) {
  // Stainable slides come from Sectioning; Staining stores only references
  // (slide_id / event_id / block / specimen) into that lineage. The destination
  // (intended use), level and label state are read from here, never re-asked.
  const slides = useMemo(() => sectioningSlides(sectioning, grossing), [sectioning, grossing]);

  const [staining, setStaining] = useState(() => syncStaining(initialData, sectioningSlides(sectioning, grossing)));
  const [selectedSlideId, setSelectedSlideId] = useState("");
  const [selectedModality, setSelectedModality] = useState("");
  const [activeModality, setActiveModality] = useState(0);
  const [selectedRequestItemId, setSelectedRequestItemId] = useState("");
  const [slideUploadStainId, setSlideUploadStainId] = useState("");
  const [bypassStainId, setBypassStainId] = useState("");
  const [bypassReason, setBypassReason] = useState("");
  const [notice, setNotice] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [validationOpen, setValidationOpen] = useState(false);
  const [validationResults, setValidationResults] = useState([]);
  // Per-order dictation. One recorder at a time; transcripts are keyed by the
  // stain order they were recorded into, so an autofill never needs the LLM to
  // decide which order, slide or sub-workflow a fact belongs to.
  const [recordTranscripts, setRecordTranscripts] = useState({});
  const [recordingStainId, setRecordingStainId] = useState("");
  const [transcribingStainId, setTranscribingStainId] = useState("");
  const [autofillingStainId, setAutofillingStainId] = useState("");
  const mediaRecorderRef = useRef(null);
  const audioChunksRef = useRef([]);

  useEffect(() => {
    setStaining(syncStaining(initialData, slides));
    setSelectedSlideId("");
    setSelectedModality("");
    setSelectedRequestItemId("");
    setBypassStainId("");
    setBypassReason("");
    setNotice("");
    setRecordTranscripts({});
    setRecordingStainId("");
    setTranscribingStainId("");
    setAutofillingStainId("");
  }, [caseId]); // eslint-disable-line react-hooks/exhaustive-deps

  const slideInfo = useMemo(() => {
    const map = new Map();
    slides.forEach((slide) => map.set(slide.slide_id, slide));
    return map;
  }, [slides]);

  const slideLabel = (slide) => {
    if (!slide) return "Unknown slide";
    const parts = [`Cassette ${slide.cassette_label || "Unlabelled"}`, `Slide ${shortId(slide.slide_id)}`];
    if (slide.level) parts.push(`Level ${slide.level}`);
    if (slide.intended_use) parts.push(slide.intended_use);
    return parts.join(" · ");
  };

  const records = staining.records;
  const slideAlreadyStained = (slideId) => records.some((record) => record.slide_id === slideId);

  // Pathologist requests waiting for a bench order, and the confirmed
  // interpretations coming back the other way. Both are read-only here: the
  // request belongs to Microscopy, and so does the interpretation.
  const openItems = useMemo(() => openRequestItems(microscopy, staining, slides), [microscopy, staining, slides]);
  const sectioningPendingItems = openItems.filter((item) => item.needs_new_section);
  const interpretationByStain = useMemo(() => new Map(
    completeAncillaryResults(staining, microscopy).map((item) => [item.stain_id, item]),
  ), [staining, microscopy]);

  const update = (updater) => setStaining((current) => updater(current));

  // Picking a slide defaults the sub-workflow from its Sectioning intended use.
  const chooseSlide = (slideId) => {
    setSelectedSlideId(slideId);
    setSelectedModality(modalityForIntendedUse(slideInfo.get(slideId)?.intended_use || ""));
  };

  const addRecord = () => {
    const slide = slideInfo.get(selectedSlideId);
    if (!slide) {
      setNotice("Select a slide before adding a stain order.");
      return;
    }
    // One slide carries one stain: once stained the section is consumed, so a new
    // marker needs a new section cut in Sectioning.
    if (slideAlreadyStained(slide.slide_id)) {
      setNotice("This slide already carries a stain and cannot take another. Cut a fresh section in Sectioning.");
      return;
    }
    const modality = selectedModality || modalityForIntendedUse(slide.intended_use);
    if (!modality) {
      setNotice("This slide carries no staining destination from Sectioning. Choose a sub-workflow before adding the order.");
      return;
    }
    setNotice("");
    update((current) => ({
      ...current,
      records: [...current.records, withModality(makeStainRecord(slide, doctorName || doctorId || ""), modality)],
    }));
  };

  // One click from the pathologist's request to the bench order: the marker,
  // sub-workflow, diagnostic question and request link are carried over so the
  // target is never retyped and the result can be returned to the review that
  // asked for it.
  const addRecordFromRequest = (item) => {
    // The worklist already worked out which free section can carry this marker.
    // A slide the technologist selected is honoured only if it is still unstained.
    const selected = slideInfo.get(selectedSlideId);
    const slide = (selected && !slideAlreadyStained(selected.slide_id) ? selected : null)
      || slideInfo.get(item.available_slide_id);
    if (!slide) {
      setNotice(`Stain order cannot be created for ${item.target || item.modality}. No released unstained slide is available; this request is awaiting Sectioning.`);
      return;
    }
    setNotice("");
    setSelectedRequestItemId(item.request_item_id);
    setSelectedSlideId("");
    update((current) => ({
      ...current,
      records: [...current.records, makeStainRecordFromRequest(slide, item, doctorName || doctorId || "")],
    }));
  };

  const updateRecord = (stainId, key, value) => update((current) => ({
    ...current,
    records: current.records.map((record) => (record.stain_id === stainId ? { ...record, [key]: value } : record)),
  }));

  const handleSlideVerificationUpload = async (record, inputEvent) => {
    const input = inputEvent.target;
    const file = input.files?.[0];
    if (!file || !record) return;
    setSlideUploadStainId(record.stain_id);
    setNotice("");
    try {
      const response = await verifyStainingSlideImage({
        file,
        caseId,
        accessionId,
        stainId: record.stain_id,
        eventId: record.event_id,
        specimenId: record.parent_specimen_id,
        blockId: record.parent_block_id,
        slideId: record.slide_id,
        patientId,
        doctorId,
        hospitalId,
      });
      const verification = response.verification;
      if (!verification) throw new Error("Verification response is missing");
      update((current) => ({
        ...current,
        records: current.records.map((item) => (item.stain_id === record.stain_id
          ? {
            ...item,
            slide_verifications: [
              ...(item.slide_verifications || []),
              {
                ...verification,
                verified_by: { staff_id: doctorId || "", name: doctorName || "" },
              },
            ],
          }
          : item)),
      }));
      if (verification.result === "matched") {
        setNotice("Slide barcode matched the selected Sectioning slide.");
      } else if (verification.result === "mismatch") {
        setNotice("Slide barcode does not match the selected slide. Staining remains locked for this order.");
      } else {
        setNotice("No barcode could be read from the image. Staining remains locked for this order.");
      }
    } catch (error) {
      console.error("[StainingTab] slide verification:", error);
      setNotice(error.message || "Slide barcode verification failed.");
    } finally {
      setSlideUploadStainId("");
      input.value = "";
    }
  };

  // Doctor's escape hatch when the slide barcode cannot be machine-verified: the
  // bypass is appended to the same verification list (recorded honestly as NOT
  // verified, with who, when and why) and unlocks this stain order.
  const bypassSlideVerification = (record) => {
    const reason = bypassReason.trim();
    if (!reason || !record) return;
    const bypass = makeBypassRecord({ staff_id: doctorId || "", name: doctorName || "" }, reason);
    update((current) => ({
      ...current,
      records: current.records.map((item) => (item.stain_id === record.stain_id
        ? {
          ...item,
          slide_verifications: [
            ...(item.slide_verifications || []),
            { ...bypass, stain_id: record.stain_id },
          ],
        }
        : item)),
    }));
    setBypassStainId("");
    setBypassReason("");
    setNotice("Slide barcode verification bypassed. Staining is unlocked — the record is saved as not verified.");
  };

  // Writes into the record's active sub-workflow group (he / special / ihc / fish).
  const updateDetail = (stainId, key, value) => update((current) => ({
    ...current,
    records: current.records.map((record) => {
      if (record.stain_id !== stainId) return record;
      const group = modalityKey(record.modality);
      if (!group) return record;
      return { ...record, [group]: { ...(record[group] || {}), [key]: value } };
    }),
  }));

  const setModality = (stainId, modality) => update((current) => ({
    ...current,
    records: current.records.map((record) => (record.stain_id === stainId ? withModality(record, modality) : record)),
  }));

  const setRecordTranscript = (stainId, valueOrUpdater) => setRecordTranscripts((current) => ({
    ...current,
    [stainId]: typeof valueOrUpdater === "function"
      ? valueOrUpdater(current[stainId] || "")
      : valueOrUpdater,
  }));

  const removeRecord = (stainId) => {
    if (recordingStainId === stainId) stopRecording();
    update((current) => ({
      ...current,
      records: current.records.filter((record) => record.stain_id !== stainId),
    }));
    setRecordTranscripts((current) => {
      if (!(stainId in current)) return current;
      const next = { ...current };
      delete next[stainId];
      return next;
    });
  };

  // ─── Per-order dictation ──────────────────────────────────────────────────
  const startRecording = async (stainId) => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      mediaRecorderRef.current = new MediaRecorder(stream);
      audioChunksRef.current = [];
      mediaRecorderRef.current.ondataavailable = (event) => {
        if (event.data.size > 0) audioChunksRef.current.push(event.data);
      };
      mediaRecorderRef.current.start();
      setRecordingStainId(stainId);
    } catch (error) {
      console.error("[StainingTab] microphone:", error);
      setNotice("Microphone access is unavailable.");
    }
  };

  const stopRecording = () => {
    const stainId = recordingStainId;
    if (!mediaRecorderRef.current || !stainId) return;
    mediaRecorderRef.current.onstop = async () => {
      setRecordingStainId("");
      setTranscribingStainId(stainId);
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
        if (text) setRecordTranscript(stainId, (current) => (current ? `${current} ${text}` : text));
      } catch (error) {
        console.error("[StainingTab] transcription:", error);
        setNotice("Staining dictation transcription failed.");
      } finally {
        setTranscribingStainId("");
      }
    };
    mediaRecorderRef.current.stop();
    mediaRecorderRef.current.stream.getTracks().forEach((track) => track.stop());
  };

  // Dictation is advisory: it fills only EMPTY fields and placeholder defaults
  // (status "Ordered", control "Not run", repeat/return "No") of this ONE order,
  // and never touches a value the technologist already recorded. The LLM
  // structures the transcript; the routing (which order, which sub-workflow)
  // was decided by the technologist before recording.
  const autofillRecord = async (record) => {
    const text = recordTranscripts[record.stain_id] || "";
    if (!text.trim()) return;
    setAutofillingStainId(record.stain_id);
    setNotice("");
    try {
      const response = await structureStaining(text, record.modality, stainTargetOf(record) || "");
      if (response.status !== "success" || !response.data) throw new Error("No structured data returned");
      const reviewedAt = new Date().toISOString();
      const patch = stainingDictationPatch(record, response.data);
      const group = modalityKey(record.modality);
      // Report against the render-time record so the notice says what actually landed.
      const afterRecord = mergeStainingExtraction(record, patch);
      const filled = [];
      Object.entries(patch.flat).forEach(([key, value]) => {
        if (value !== "" && String(afterRecord[key] ?? "") !== String(record[key] ?? "")) filled.push(key);
      });
      Object.entries(patch.detail).forEach(([key, value]) => {
        const before = group ? record[group]?.[key] : undefined;
        const after = group ? afterRecord[group]?.[key] : undefined;
        if (value !== "" && String(after ?? "") !== String(before ?? "")) filled.push(`${group || ""}.${key}`);
      });
      update((current) => ({
        ...current,
        records: current.records.map((item) => (item.stain_id === record.stain_id
          ? {
            ...mergeStainingExtraction(item, patch),
            dictation: {
              transcript: text,
              structured_at: reviewedAt,
              review_status: "Applied to empty/placeholder fields only — confirm before saving",
              reviewed_by: doctorName || doctorId || "",
              reviewed_at: reviewedAt,
            },
          }
          : item)),
      }));
      setNotice(filled.length > 0
        ? `Applied ${filled.length} dictated field${filled.length === 1 ? "" : "s"} to this stain order (${filled.join(", ")}).`
        : "Nothing new to fill — the dictated fields already hold recorded values.");
    } catch (error) {
      console.error("[StainingTab] structure:", error);
      setNotice("Staining dictation structuring failed.");
    } finally {
      setAutofillingStainId("");
    }
  };

  const handleValidate = () => {
    setValidationResults(validateStainingCompleteness(staining, slides, [...interpretationByStain.values()]));
    setValidationOpen(true);
  };

  const handleSubmit = async () => {
    setIsSaving(true);
    try {
      await onSave("staining", staining);
    } finally {
      setIsSaving(false);
    }
  };

  if (slides.length === 0) {
    return (
      <Box sx={{ border: `1px solid ${C.border}`, background: C.bgSecondary, p: 3, fontFamily: FONT }}>
        <Typography sx={{ fontFamily: FONT, fontSize: 14, fontWeight: FW_NORMAL, mb: 0.5 }}>
          No slides are available to stain.
        </Typography>
        <Typography sx={{ fontFamily: FONT, fontSize: 12, color: C.textMuted }}>
          Cut the blocks and record the slides in Sectioning before staining.
        </Typography>
      </Box>
    );
  }

  // ─── Derived counts: software, not AI, and never hand-entered ──────────────
  const releasedSlides = slides.filter((slide) => slide.released);
  const orderedSlideIds = new Set(records.map((record) => record.slide_id));
  const completed = records.filter((record) => record.status === "Completed");
  const controlsPassed = records.filter((record) => controlAccepted(record)).length;
  const holdOrRepeat = records.filter((record) => record.status === "QC hold" || record.repeat_required === "Yes").length;
  const returned = records.filter((record) => record.returned_to_microscopy === "Yes").length;

  const modalityCounts = records.reduce((counts, record) => {
    const key = record.modality || "Unassigned";
    counts[key] = (counts[key] || 0) + 1;
    return counts;
  }, {});
  const modalitySummary = Object.entries(modalityCounts)
    .map(([modality, count]) => `${modality}: ${count}`)
    .join(" | ");

  // Deterministic technical summary for the Microscopy handoff — assembled from
  // the records, never written by the model, and never a diagnostic reading:
  // what is handed over is that the run completed on an accepted control.
  const handoffSummary = completed
    .filter((record) => controlAccepted(record))
    .map((record) => [
      `${stainTargetOf(record) || record.modality}`,
      stainTechnicalOutcomeOf(record),
      interpretationByStain.get(record.stain_id)?.interpretation ? "interpreted" : "awaiting reading",
    ].filter(Boolean).join(": "))
    .join(" | ");

  const latestStatusBySlide = new Map();
  records.forEach((record) => {
    if (record.slide_id && record.status) latestStatusBySlide.set(record.slide_id, record.status);
  });

  const slideOptions = [
    { value: "", label: "— Select a slide —" },
    ...slides.map((slide) => ({
      value: slide.slide_id,
      label: [
        slideLabel(slide),
        slide.released ? "" : " (not released)",
        slide.label_verified === "Verified" ? "" : " (label unverified)",
        // A stained slide is consumed; it is shown so the inventory stays honest,
        // but ordering a second stain on it is refused.
        records.some((record) => record.slide_id === slide.slide_id) ? " (already stained)" : "",
      ].join(""),
    })),
  ];

  const activeModalityName = MODALITY_TABS[activeModality];
  const visibleRecords = records.filter((record) => (
    activeModalityName === "All" || record.modality === activeModalityName
  ));

  // A repeat / restain points back at the run it replaces, within the same
  // sub-workflow, so the failed attempt is kept rather than overwritten.
  const repeatOptions = (record) => [
    { value: "", label: "— Not linked —" },
    ...records
      .filter((item) => item.stain_id !== record.stain_id && item.modality === record.modality)
      .map((item) => ({
        value: item.stain_id,
        label: `${stainTargetOf(item) || item.modality} · Slide ${shortId(item.slide_id)} · ${item.status || "Ordered"}`,
      })),
  ];

  const busy = isSaving || !!recordingStainId || !!transcribingStainId || !!autofillingStainId;

  // ─── Sub-workflow specific technical fields ───────────────────────────────
  // Everything here is laboratory execution. Percentage, intensity, pattern,
  // localization, score and the positive / negative / equivocal call are
  // pathologist judgements and are entered in Microscopy against this stain_id.
  const renderDetail = (record) => {
    const set = (key) => (value) => updateDetail(record.stain_id, key, value);

    if (record.modality === "H&E") {
      return (
        <>
          <SubHeading>H&amp;E Stain Quality</SubHeading>
          <FG cols={3}>
            <Sel label="Stain Appearance" options={HE_APPEARANCE_OPTIONS} value={record.he?.appearance} onChange={set("appearance")} />
          </FG>
          <FlagNote>
            Only the stain itself is judged here. The morphologic reading of the slide belongs to Microscopy.
          </FlagNote>
        </>
      );
    }

    if (record.modality === "Special stain") {
      const special = record.special || {};
      return (
        <>
          <SubHeading>Special Stain Applied</SubHeading>
          <FG cols={3}>
            <Sel label="Stain Type" options={SPECIAL_STAIN_TYPE_OPTIONS} value={special.stain_type} onChange={set("stain_type")} />
            {special.stain_type === "Other" && (
              <LineField label="Stain Type (Other)" value={special.stain_type_other} onChange={set("stain_type_other")} />
            )}
            <LineField label="Reagent Lot" value={special.reagent_lot} onChange={set("reagent_lot")} />
          </FG>
          <FlagNote>
            What the stain demonstrates is read in Microscopy. Record here only what was applied and whether the run was
            technically sound.
          </FlagNote>
        </>
      );
    }

    if (record.modality === "IHC") {
      const ihc = record.ihc || {};
      return (
        <>
          <SubHeading>Marker and Antibody</SubHeading>
          <FG cols={3}>
            <LineField label="Marker / Target" value={ihc.marker} onChange={set("marker")} placeholder="e.g. CK7, ER, HER2, PD-L1, MLH1" />
            <LineField label="Clone" value={ihc.clone} onChange={set("clone")} />
            <LineField label="Vendor" value={ihc.vendor} onChange={set("vendor")} />
            <LineField label="Dilution" value={ihc.dilution} onChange={set("dilution")} />
            <LineField label="Antibody Lot" value={ihc.lot} onChange={set("lot")} />
            <Sel label="Negative Control Result" options={CONTROL_RESULT_OPTIONS} value={ihc.negative_control_result} onChange={set("negative_control_result")} />
          </FG>
          <FlagNote>
            Percentage, intensity, pattern, localization, marker score and the final interpretation are recorded by the
            pathologist in Microscopy against this stain.
          </FlagNote>
        </>
      );
    }

    if (record.modality === "FISH") {
      const fish = record.fish || {};
      return (
        <>
          <SubHeading>Probe and Target</SubHeading>
          <FG cols={3}>
            <LineField label="Gene / Target" value={fish.gene_target} onChange={set("gene_target")} placeholder="e.g. HER2/ERBB2, ALK, MYC" />
            <LineField label="Probe Kit" value={fish.probe_kit} onChange={set("probe_kit")} />
            <LineField label="Vendor" value={fish.vendor} onChange={set("vendor")} />
            <LineField label="Catalog Number" value={fish.catalog_number} onChange={set("catalog_number")} />
            <LineField label="Probe Lot" value={fish.lot} onChange={set("lot")} />
            <LineField label="Hybridization Protocol / Version" value={fish.hybridization_protocol} onChange={set("hybridization_protocol")} />
          </FG>

          <SubHeading>Signal Counting Performed by the Laboratory</SubHeading>
          <FG cols={3}>
            <LineField label="Cells Counted" value={fish.cells_counted} onChange={set("cells_counted")} placeholder="e.g. 20" />
            <LineField label="Signal Ratio" value={fish.signal_ratio} onChange={set("signal_ratio")} placeholder="e.g. 2.4" />
            <LineField label="Average Copy Number" value={fish.copy_number} onChange={set("copy_number")} />
            <Sel label="Technical Signal Quality" options={FISH_SIGNAL_QUALITY_OPTIONS} value={fish.signal_quality} onChange={set("signal_quality")} />
          </FG>
          <FlagNote>
            Signals are counted at the microscope by the observer; the software counts nothing and scores no image. The
            amplified / rearranged call and the criteria version applied are recorded by the pathologist in Microscopy.
            Molecular displays this same record read-only — it is never entered twice.
          </FlagNote>
        </>
      );
    }

    return (
      <FlagNote>
        No sub-workflow selected. Choose H&amp;E, special stain, IHC, or FISH so the right technical fields apply.
      </FlagNote>
    );
  };

  // The pathologist's confirmed reading, shown read-only so the bench can see the
  // outcome of its work without owning or duplicating it.
  const renderInterpretation = (record) => {
    const reading = interpretationByStain.get(record.stain_id);
    if (!reading) {
      return record.status === "Completed" && controlAccepted(record) ? (
        <FlagNote>
          Returned to Microscopy and awaiting the pathologist&apos;s reading. No interpretation has been recorded yet.
        </FlagNote>
      ) : null;
    }
    return (
      <>
        <SubHeading>Pathologist Interpretation (Read-Only, From Microscopy)</SubHeading>
        <FG cols={4}>
          <SourceValue label="Interpretation" value={reading.interpretation} />
          <SourceValue
            label="Score"
            value={[reading.intensity, reading.percent_positive && `${reading.percent_positive}%`, reading.score]
              .filter(Boolean).join(" · ")}
          />
          <SourceValue label="Control Accepted for Interpretation" value={reading.control_accepted_for_interpretation} />
          <SourceValue label="Reviewed By" value={reading.reviewed_by} />
        </FG>
        <FlagNote>
          Recorded in {reading.professional_interpretation_source}. Edit it in Microscopy — this tab never holds a second
          copy of the reading.
        </FlagNote>
      </>
    );
  };

  return (
    <Box sx={{ fontFamily: FONT }}>
      <SectionBox title="Slide Inventory and Stain Tracking">
        <FG cols={4}>
          <SourceValue label="Slides From Sectioning" value={String(slides.length)} />
          <SourceValue label="Released for Staining" value={String(releasedSlides.length)} />
          <SourceValue label="Slides With a Stain Order" value={String(orderedSlideIds.size)} />
          <SourceValue label="Stain Orders" value={String(records.length)} />
        </FG>
        <FG cols={4}>
          <SourceValue label="Completed" value={String(completed.length)} />
          <SourceValue label="Controls Accepted" value={String(controlsPassed)} />
          <SourceValue label="QC Hold or Repeat Pending" value={String(holdOrRepeat)} />
          <SourceValue label="Returned to Microscopy" value={String(returned)} />
        </FG>
        <FlagNote>
          Slide identity, run and batch tracking, counts, timestamps and control-result storage are handled
          deterministically from the Sectioning slide list and the stain records — not hand-entered totals, and not
          produced by AI. This tab is the laboratory record: it holds what was applied and whether the run was
          technically valid. The pathologist&apos;s reading of each stain is recorded in Microscopy.
        </FlagNote>

        <Box sx={{ border: `1px solid ${C.border}`, mt: 1.5 }}>
          {slides.map((slide) => (
            <Box
              key={slide.slide_id}
              sx={{
                display: "grid",
                gridTemplateColumns: "1.8fr 1fr 0.8fr 1fr",
                gap: 1.5,
                px: 1.5,
                py: 1,
                borderTop: `1px solid ${C.border}`,
                "&:first-of-type": { borderTop: 0 },
                background: C.white,
              }}
            >
              <Typography sx={{ fontFamily: FONT, fontSize: 12 }}>{slideLabel(slide)}</Typography>
              <Typography sx={{ fontFamily: FONT, fontSize: 12, color: C.textSecond }}>
                {slide.released ? "Released by Sectioning" : "Not released"}
              </Typography>
              <Typography sx={{ fontFamily: FONT, fontSize: 12, color: C.textSecond }}>
                {records.filter((record) => record.slide_id === slide.slide_id).length} stain(s)
              </Typography>
              <Typography sx={{ fontFamily: FONT, fontSize: 12, color: C.textSecond }}>
                {latestStatusBySlide.get(slide.slide_id) || "No stain ordered"}
              </Typography>
            </Box>
          ))}
        </Box>

        {modalitySummary && <FlagNote>Stain orders by sub-workflow — {modalitySummary}</FlagNote>}
        {handoffSummary && (
          <FlagNote>Completed on an accepted control — {handoffSummary}</FlagNote>
        )}
      </SectionBox>

      <SectionBox title="Open Requests From Microscopy">
        {sectioningPendingItems.length > 0 && (
          <FlagNote>
            {sectioningPendingItems.length} requested stain{sectioningPendingItems.length === 1 ? "" : "s"} cannot be ordered yet:
            no released unstained slide is available. Sectioning must cut and release the requested section first.
          </FlagNote>
        )}
        <PathologyTable
          rowId={(row) => row.request_item_id}
          selectedId={selectedRequestItemId}
          rows={openItems}
          columns={[
            { key: "modality", label: "Sub-Workflow", width: "0.9fr" },
            { key: "target", label: "Requested Target", width: "1fr" },
            { key: "purpose", label: "Purpose", width: "1.4fr", muted: true },
            { key: "diagnostic_question", label: "Diagnostic Question", width: "1.6fr", muted: true },
            { key: "priority", label: "Priority", width: "0.6fr", muted: true },
            {
              key: "section",
              label: "Section",
              width: "1.2fr",
              muted: true,
              render: (row) => (row.needs_new_section
                ? "No slide available — Sectioning pending"
                : `Slide ${shortId(row.available_slide_id)} free`),
            },
            {
              key: "actions",
              label: "",
              width: "1fr",
              align: "right",
              render: (row) => (
                <Button
                  sx={{ ...outlineBtnSx, px: 1.25, py: 0.3, fontSize: 11 }}
                  onClick={(event) => { event.stopPropagation(); addRecordFromRequest(row); }}
                >
                  Create stain order
                </Button>
              ),
            },
          ]}
          emptyMessage="No pathologist request is waiting for a stain order."
        />
        <FlagNote>
          Requests are raised by the pathologist in Microscopy. Each marker needs its own unstained section — a stained
          slide is consumed and cannot take a second stain — so a row shows the free slide it will use, or says the
          section must be cut in Sectioning first. Creating the order carries the marker, sub-workflow, diagnostic
          question and request link over, so the completed run can be returned to the review that asked for it.
        </FlagNote>
      </SectionBox>

      <SectionBox title="Stain Orders">
        <Box sx={{ display: "flex", alignItems: "flex-end", gap: 1.5, mb: 2, flexWrap: "wrap" }}>
          <Box sx={{ minWidth: 320, flex: 1 }}>
            <FieldLabel>Slide to Stain</FieldLabel>
            <Sel label="Slide" options={slideOptions} value={selectedSlideId} onChange={chooseSlide} />
          </Box>
          <Box sx={{ minWidth: 200 }}>
            <FieldLabel>Sub-Workflow</FieldLabel>
            <Sel label="Sub-Workflow" options={STAIN_MODALITY_OPTIONS} value={selectedModality} onChange={setSelectedModality} />
          </Box>
          <Button sx={outlineBtnSx} onClick={addRecord}>
            <AddRounded sx={{ mr: 0.75, fontSize: 16 }} /> Add Stain Order
          </Button>
        </Box>
        <FlagNote>
          The sub-workflow is defaulted from the slide&apos;s intended use recorded in Sectioning, so the destination is
          never re-asked. Each stain is its own record — one IHC marker or one FISH probe per slide — and a repeat or
          restain is a new record linked to the run it replaces, so the earlier attempt stays on the record.
        </FlagNote>

        <Box sx={{ mt: 2 }}>
          <SubTabBar
            tabs={MODALITY_TABS.map((tab) => (tab === "All"
              ? `All (${records.length})`
              : `${tab} (${modalityCounts[tab] || 0})`))}
            active={activeModality}
            onSelect={setActiveModality}
          />
        </Box>

        {visibleRecords.map((record) => {
          const slide = slideInfo.get(record.slide_id);
          const index = records.indexOf(record);
          const isRepeat = REPEAT_WORK_TYPES.includes(record.work_type);
          return (
            <Box key={record.stain_id} sx={{ border: `1px solid ${C.border}`, p: 2, mt: 1.5, background: C.white }}>
              <ItemHeader
                title={`${index + 1}. ${record.modality || "No sub-workflow"} — ${stainTargetOf(record) || "target not recorded"}`}
                subtitle={`${record.stain_id} | slide ${record.slide_id} | block ${record.parent_block_id}`}
                onRemove={() => removeRecord(record.stain_id)}
              />

              <FG cols={4}>
                <SourceValue label="Parent Block ID" value={record.parent_block_id} />
                <SourceValue label="Parent Specimen ID" value={record.parent_specimen_id} />
                <SourceValue label="Slide Intended Use (Sectioning)" value={slide?.intended_use} />
                <SourceValue label="Slide Level" value={slide?.level} />
              </FG>
              <SourceValue label="Diagnostic Question Recorded at Sectioning" value={slide?.sectioning_question} />

              {!slide?.released && (
                <FlagNote>
                  This slide is not marked Ready for Staining in Sectioning. Confirm the cut is complete and released
                  before it goes on a stainer.
                </FlagNote>
              )}
              {slide && slide.label_verified !== "Verified" && (
                <FlagNote>
                  The slide label was not verified against its parent block in Sectioning. Verify slide identity before
                  staining.
                </FlagNote>
              )}
              {slide?.intended_use === "Unstained reserve" && (
                <FlagNote>
                  This slide was held back as an unstained reserve. Staining it consumes tissue kept for molecular or
                  later work.
                </FlagNote>
              )}

              {(() => {
                const { latest: verification, matched, bypassed, failed, unlocked } = verificationState(record.slide_verifications);
                const decodedValues = (verification?.decoded_barcodes || []).map((item) => item.value).filter(Boolean);
                return (
                  <>
                    <Box sx={{ border: `1px solid ${failed ? "#cf1322" : bypassed ? "#b76e00" : C.border}`, background: C.bgSecondary, p: 1.5, mb: 2 }}>
                      <Box sx={{ display: "flex", alignItems: "center", gap: 1, flexWrap: "wrap" }}>
                        <Button component="label" sx={outlineBtnSx} disabled={!!slideUploadStainId}>
                          {slideUploadStainId === record.stain_id
                            ? <CircularProgress size={14} sx={{ mr: 1, color: C.black }} />
                            : <UploadFileRounded sx={{ mr: 0.75, fontSize: 16 }} />}
                          {verification ? "Upload New Slide Image" : "Upload Slide Image"}
                          <input
                            hidden
                            type="file"
                            accept="image/*"
                            onChange={(event) => handleSlideVerificationUpload(record, event)}
                          />
                        </Button>
                        {matched && (
                          <Typography sx={{ display: "flex", alignItems: "center", gap: 0.5, fontFamily: FONT, fontSize: 11, color: C.black }}>
                            <CheckRounded sx={{ fontSize: 16 }} /> Barcode matched
                          </Typography>
                        )}
                        {failed && (
                          <Typography sx={{ display: "flex", alignItems: "center", gap: 0.5, fontFamily: FONT, fontSize: 11, color: "#cf1322" }}>
                            <WarningAmberRounded sx={{ fontSize: 17 }} />
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
                          open={bypassStainId === record.stain_id}
                          reason={bypassReason}
                          onReasonChange={setBypassReason}
                          onConfirm={() => bypassSlideVerification(record)}
                          onCancel={() => { setBypassStainId(""); setBypassReason(""); }}
                          onOpen={() => { setBypassStainId(record.stain_id); setBypassReason(""); }}
                          busy={!!slideUploadStainId}
                        />
                      )}
                    </Box>
                    {!unlocked && (
                      <Box sx={{ border: "1px solid #cf1322", background: "#fff1f0", p: 1.5, mb: 2 }}>
                        <Typography sx={{ display: "flex", alignItems: "center", gap: 0.75, fontFamily: FONT, fontSize: 12, color: "#cf1322" }}>
                          <WarningAmberRounded sx={{ fontSize: 17 }} />
                          Upload a matching slide barcode image to unlock staining for this order, or bypass the verification.
                        </Typography>
                      </Box>
                    )}
                    <Box
                      component="fieldset"
                      disabled={!unlocked}
                      sx={{ border: 0, p: 0, m: 0, minWidth: 0, opacity: unlocked ? 1 : 0.55 }}
                    >

              <RecordDictation
                locked={!unlocked}
                transcript={recordTranscripts[record.stain_id] || ""}
                onTranscript={(value) => setRecordTranscript(record.stain_id, value)}
                isRecording={recordingStainId === record.stain_id}
                transcribing={transcribingStainId === record.stain_id}
                autofilling={autofillingStainId === record.stain_id}
                busyElsewhere={(!!recordingStainId && recordingStainId !== record.stain_id)
                  || (!!transcribingStainId && transcribingStainId !== record.stain_id)
                  || (!!autofillingStainId && autofillingStainId !== record.stain_id)}
                onToggleRecording={() => (recordingStainId === record.stain_id ? stopRecording() : startRecording(record.stain_id))}
                onAutofill={() => autofillRecord(record)}
                dictation={record.dictation}
              />

              <SubHeading>Order</SubHeading>
              <FG cols={3}>
                <Sel label="Sub-Workflow" options={STAIN_MODALITY_OPTIONS} value={record.modality} onChange={(value) => setModality(record.stain_id, value)} />
                <Sel label="Work Type" options={WORK_TYPE_OPTIONS} value={record.work_type} onChange={(value) => updateRecord(record.stain_id, "work_type", value)} />
                <LineField label="Ordered / Requested By" value={record.ordered_by} onChange={(value) => updateRecord(record.stain_id, "ordered_by", value)} />
                <DateTimeField label="Order Date and Time" value={record.order_datetime} onChange={(value) => updateRecord(record.stain_id, "order_datetime", value)} />
                <SourceValue
                  label="Microscopy Request"
                  value={record.request_id ? `${shortId(record.request_id)} · item ${shortId(record.request_item_id)}` : ""}
                />
                <SourceValue label="Originating Microscopy Review" value={record.originating_review_id ? shortId(record.originating_review_id) : ""} />
                {isRepeat && (
                  <Sel label="Repeat Of" options={repeatOptions(record)} value={record.repeat_of_stain_id} onChange={(value) => updateRecord(record.stain_id, "repeat_of_stain_id", value)} />
                )}
              </FG>
              <TextArea
                label="Diagnostic Question for This Stain"
                value={record.diagnostic_question}
                onChange={(value) => updateRecord(record.stain_id, "diagnostic_question", value)}
                placeholder="What this stain is meant to resolve — carried over from the pathologist's request when there was one"
              />
              {!record.request_id && REQUESTED_WORK_TYPES.includes(record.work_type) && (
                <FlagNote>
                  {record.work_type} work has no linked pathologist request, so the completed result has no review to go
                  back to. Create it from the request worklist above, or record the originating request in Microscopy.
                </FlagNote>
              )}

              <SubHeading>Run and Execution</SubHeading>
              <FG cols={3}>
                <Sel label="Status" options={STAIN_STATUS_OPTIONS} value={record.status} onChange={(value) => updateRecord(record.stain_id, "status", value)} />
                <LineField label="Stainer / Platform ID" value={record.platform_id} onChange={(value) => updateRecord(record.stain_id, "platform_id", value)} />
                <LineField label="Run / Batch ID" value={record.run_batch_id} onChange={(value) => updateRecord(record.stain_id, "run_batch_id", value)} />
                <LineField label="Technician" value={record.technician} onChange={(value) => updateRecord(record.stain_id, "technician", value)} />
                <DateTimeField label="Stain Date and Time" value={record.stain_datetime} onChange={(value) => updateRecord(record.stain_id, "stain_datetime", value)} />
                <LineField label="Protocol" value={record.protocol} onChange={(value) => updateRecord(record.stain_id, "protocol", value)} placeholder="Validated protocol name" />
                <LineField label="Protocol Version" value={record.protocol_version} onChange={(value) => updateRecord(record.stain_id, "protocol_version", value)} />
              </FG>

              <SubHeading>Control and Quality</SubHeading>
              <FG cols={3}>
                <Sel label="Control Result" options={CONTROL_RESULT_OPTIONS} value={record.control_result} onChange={(value) => updateRecord(record.stain_id, "control_result", value)} />
                <Sel label="Stain Quality" options={STAIN_QUALITY_OPTIONS} value={record.quality_result} onChange={(value) => updateRecord(record.stain_id, "quality_result", value)} />
                <Sel label="Repeat Required" options={YES_NO_OPTIONS} value={record.repeat_required} onChange={(value) => updateRecord(record.stain_id, "repeat_required", value)} />
              </FG>
              {record.control_result === "Fail" && (
                <TextArea
                  label="Control Failure Note"
                  value={record.control_note}
                  onChange={(value) => updateRecord(record.stain_id, "control_note", value)}
                  placeholder="What failed on the control and what was checked"
                />
              )}
              {isStainQualityProblem(record.quality_result) && (
                <TextArea label="Quality Issue Note" value={record.quality_note} onChange={(value) => updateRecord(record.stain_id, "quality_note", value)} />
              )}
              {record.repeat_required === "Yes" && (
                <LineField label="Repeat Reason" value={record.repeat_reason} onChange={(value) => updateRecord(record.stain_id, "repeat_reason", value)} />
              )}
              {!controlAccepted(record) && (
                <FlagNote>
                  The control for this stain has not been accepted. The run must not be released for interpretation until
                  a passing control is recorded — repeat or restain instead.
                </FlagNote>
              )}

              {renderDetail(record)}

              <SubHeading>Technical Completion and Return to Microscopy</SubHeading>
              <FG cols={3}>
                <DateTimeField label="Completion Date and Time" value={record.result_datetime} onChange={(value) => updateRecord(record.stain_id, "result_datetime", value)} />
                <LineField
                  label="Source Report Reference"
                  value={record.source_report_ref}
                  onChange={(value) => updateRecord(record.stain_id, "source_report_ref", value)}
                  placeholder="External or reference-lab report, if any"
                />
                <LineField label="Technical Check By" value={record.checked_by} onChange={(value) => updateRecord(record.stain_id, "checked_by", value)} />
                <DateTimeField label="Technical Check Date and Time" value={record.check_datetime} onChange={(value) => updateRecord(record.stain_id, "check_datetime", value)} />
                <Sel label="Returned to Microscopy" options={YES_NO_OPTIONS} value={record.returned_to_microscopy} onChange={(value) => updateRecord(record.stain_id, "returned_to_microscopy", value)} />
                <DateTimeField label="Return Date and Time" value={record.returned_datetime} onChange={(value) => updateRecord(record.stain_id, "returned_datetime", value)} />
              </FG>
              <TextArea label="Comments" value={record.comments} onChange={(value) => updateRecord(record.stain_id, "comments", value)} />

              {renderInterpretation(record)}
                    </Box>
                  </>
                );
              })()}
            </Box>
          );
        })}

        {records.length === 0 && (
          <FlagNote>No stain order recorded yet. Select a released slide above and add the first stain.</FlagNote>
        )}
        {records.length > 0 && visibleRecords.length === 0 && (
          <FlagNote>No {activeModalityName} order recorded on this case yet.</FlagNote>
        )}
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
          {isSaving
            ? <CircularProgress size={14} sx={{ mr: 1, color: C.white }} />
            : <SaveRounded sx={{ mr: 0.75, fontSize: 16 }} />}
          Save Staining
        </Button>
      </Box>

      <CapValidationDialog
        open={validationOpen}
        onClose={() => setValidationOpen(false)}
        title="Staining Reconciliation Review"
        results={validationResults}
      />
    </Box>
  );
}
