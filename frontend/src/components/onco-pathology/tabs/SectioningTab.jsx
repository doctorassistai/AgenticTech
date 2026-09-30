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
import { verifySectioningBlockImage, structureSectioning } from "../shared/api";
import {
  BLOCK_STATUS_OPTIONS,
  SECTIONING_REASON_OPTIONS,
  SECTION_QUALITY_OPTIONS,
  SLIDE_INTENDED_USE_OPTIONS,
  SLIDE_TYPE_OPTIONS,
  VERIFICATION_OPTIONS,
  YES_NO_OPTIONS,
  allSlides,
  blockStatusMap,
  intendedUseForReason,
  isQualityProblem,
  makeSectioningEvent,
  makeSectioningEventFromRequest,
  makeSlide,
  mergeSectioningExtraction,
  openSectioningRequests,
  processingBlocks,
  syncSectioning,
} from "../shared/sectioningModel";
import { coerceDateTime, coerceEnum, coerceNumber } from "../shared/transcribeMerge";
import { validateSectioningCompleteness } from "../shared/capValidation";
import CapValidationDialog from "../CapValidationDialog";
import PathologyTable from "../PathologyTable";
import Code128Barcode from "../shared/Code128Barcode";
import BypassVerificationControl from "../shared/BypassVerificationControl";
import { makeBypassRecord, verificationState } from "../shared/barcodeVerification";

const API_BASE_URL = import.meta.env.VITE_BACKEND_URL || "https://doctorassist.ai/api/";

const readOnlyValue = (value) => value || "Not recorded";

// Block IDs are compact BLK-<token> values; the tail is enough to tell two
// blocks apart in a dropdown. The full ID is always shown on the event card.
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

// One event card owns one dictation area. The event is already anchored to its
// block (the technologist picked it before cutting), so the transcript and the
// autofill never need to name a cassette or route a fact — everything lands on
// this event's own empty fields. `locked` mirrors the surrounding fieldset, so
// an event whose block barcode is not yet verified cannot be dictated into.
const EventDictation = ({
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
      <FieldLabel>Dictation for This Cut</FieldLabel>
      <TextField
        value={transcript}
        onChange={(event) => onTranscript(event.target.value)}
        size="small"
        fullWidth
        multiline
        minRows={3}
        placeholder="Describe this cut — section thickness, levels, slides produced, quality, block state. The transcript is structured into the empty fields of this event only."
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
        Dictation is scoped to this event's own fields. It fills only what is empty, never overwrites a recorded value,
        and never creates slides, blocks, barcodes or identifiers.
      </FlagNote>
    </Box>
  );
};

// Turn one event's structured dictation response into a patch, coercing free
// text onto the event's canonical options / bare numbers / datetimes before the
// model merge writes it (same stance as ProcessingTab: coercion here, fill-empty
// merge in the model). The expected slide/curl count is routed to the field the
// event's output material actually uses, mirroring the hand-entered UI.
const sectioningDictationPatch = (event, data) => {
  const source = data || {};
  const patch = {};
  const copyText = (key) => {
    if (typeof source[key] === "string" && source[key].trim()) patch[key] = source[key].trim();
  };
  [
    "requested_by",
    "diagnostic_question",
    "special_instructions",
    "microtome_id",
    "level_interval",
    "sectioned_by",
    "quality_note",
    "recut_reason",
    "comments",
  ].forEach(copyText);
  const curls = event.output_material_type === "Tissue curls / scrolls";
  if (curls) copyText("output_container");

  const snapEnum = (key, options) => {
    const value = coerceEnum(source[key], options);
    if (value) patch[key] = value;
  };
  snapEnum("section_quality", SECTION_QUALITY_OPTIONS);
  snapEnum("tissue_adequately_represented", YES_NO_OPTIONS);
  snapEnum("block_status", BLOCK_STATUS_OPTIONS);

  const bareNumber = (key) => {
    const value = coerceNumber(source[key]);
    if (value !== "") patch[key] = value;
  };
  ["thickness_um", "levels_requested", "levels_cut"].forEach(bareNumber);
  const count = coerceNumber(source.expected_slide_count);
  if (count !== "") patch[curls ? "output_quantity" : "expected_slide_count"] = count;

  const datetime = (key) => {
    const value = coerceDateTime(source[key]);
    if (value) patch[key] = value;
  };
  datetime("request_datetime");
  datetime("sectioning_datetime");

  return patch;
};

export default function SectioningTab({
  caseId,
  accessionId,
  initialData,
  processing,
  grossing,
  microscopy,
  staining,
  molecular,
  patientId,
  doctorId,
  doctorName,
  hospitalId,
  onSave,
}) {
  // Cuttable block inventory comes from Processing; Sectioning stores only
  // references (block_id / cassette_id / specimen_id) into that lineage.
  const blocks = useMemo(() => processingBlocks(processing, grossing), [processing, grossing]);

  const [sectioning, setSectioning] = useState(() => syncSectioning(initialData, processingBlocks(processing, grossing)));
  const [selectedBlockId, setSelectedBlockId] = useState("");
  const [notice, setNotice] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [blockUploadEventId, setBlockUploadEventId] = useState("");
  const [bypassEventId, setBypassEventId] = useState("");
  const [bypassReason, setBypassReason] = useState("");
  const [validationOpen, setValidationOpen] = useState(false);
  const [validationResults, setValidationResults] = useState([]);
  // Per-event dictation. One recorder at a time; transcripts are keyed by the
  // event they were recorded into, so an autofill never needs the LLM to decide
  // which event or block a fact belongs to.
  const [transcripts, setTranscripts] = useState({});
  const [recordingEventId, setRecordingEventId] = useState("");
  const [transcribingEventId, setTranscribingEventId] = useState("");
  const [autofillingEventId, setAutofillingEventId] = useState("");
  const mediaRecorderRef = useRef(null);
  const audioChunksRef = useRef([]);

  useEffect(() => {
    setSectioning(syncSectioning(initialData, blocks));
    setSelectedBlockId("");
    setBlockUploadEventId("");
    setBypassEventId("");
    setBypassReason("");
    setNotice("");
    setTranscripts({});
    setRecordingEventId("");
    setTranscribingEventId("");
    setAutofillingEventId("");
  }, [caseId]); // eslint-disable-line react-hooks/exhaustive-deps

  const blockInfo = useMemo(() => {
    const map = new Map();
    blocks.forEach((block) => map.set(block.block_id, block));
    return map;
  }, [blocks]);

  const blockLabel = (block) =>
    `Cassette ${block?.cassette_label || "Unlabelled"} · Block ${shortId(block?.block_id)}`;

  const events = sectioning.events;
  const statusByBlock = useMemo(() => blockStatusMap(events), [events]);
  const slides = useMemo(() => allSlides(events), [events]);
  // Pathologist requests that still need tissue cut, with the number of sections
  // missing. A stained slide is consumed, so each requested marker needs its own
  // fresh section — the count is derived, never typed.
  const openRequests = useMemo(
    () => openSectioningRequests(microscopy, sectioning, staining, molecular),
    [microscopy, sectioning, staining, molecular],
  );

  const update = (updater) => setSectioning((current) => updater(current));

  const addEvent = () => {
    const block = blockInfo.get(selectedBlockId);
    if (!block) {
      setNotice("Select a block before adding a sectioning event.");
      return;
    }
    setNotice("");
    update((current) => ({
      ...current,
      events: [...current.events, makeSectioningEvent(block, doctorName || doctorId || "")],
    }));
  };

  // One click from the pathologist's request to the cutting event: the reason,
  // diagnostic question and request link come across, so the slide produced can
  // be traced back to the question that asked for it.
  const addEventFromRequest = (request) => {
    const block = blockInfo.get(selectedBlockId) || blockInfo.get(request.preferred_block_id);
    if (!block) {
      setNotice("Select the block to cut — the request does not name one that still exists.");
      return;
    }
    setNotice("");
    update((current) => ({
      ...current,
      events: [...current.events, makeSectioningEventFromRequest(block, request, doctorName || doctorId || "")],
    }));
  };

  const updateEvent = (eventId, key, value) => update((current) => ({
    ...current,
    events: current.events.map((event) => (event.event_id === eventId ? { ...event, [key]: value } : event)),
  }));

  const handleBlockVerificationUpload = async (sectioningEvent, inputEvent) => {
    const input = inputEvent.target;
    const file = input.files?.[0];
    if (!file || !sectioningEvent) return;
    setBlockUploadEventId(sectioningEvent.event_id);
    setNotice("");
    try {
      const response = await verifySectioningBlockImage({
        file,
        caseId,
        accessionId,
        eventId: sectioningEvent.event_id,
        specimenId: sectioningEvent.parent_specimen_id,
        cassetteId: sectioningEvent.cassette_id,
        blockId: sectioningEvent.block_id,
        patientId,
        doctorId,
        hospitalId,
      });
      const verification = response.verification;
      if (!verification) throw new Error("Verification response is missing");
      update((current) => ({
        ...current,
        events: current.events.map((item) => (item.event_id === sectioningEvent.event_id
          ? {
            ...item,
            block_verifications: [
              ...(item.block_verifications || []),
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
        setNotice("Block barcode matched the selected Processing block.");
      } else if (verification.result === "mismatch") {
        setNotice("Block barcode does not match the selected Processing block. This sectioning event remains locked.");
      } else {
        setNotice("No barcode could be read from the image. This sectioning event remains locked.");
      }
    } catch (error) {
      console.error("[SectioningTab] block verification:", error);
      setNotice(error.message || "Block barcode verification failed.");
    } finally {
      setBlockUploadEventId("");
      input.value = "";
    }
  };

  // Doctor's escape hatch when the block barcode cannot be machine-verified: the
  // bypass is appended to the same verification list (recorded honestly as NOT
  // verified, with who, when and why) and unlocks this sectioning event.
  const bypassEventVerification = (sectioningEvent) => {
    const reason = bypassReason.trim();
    if (!reason || !sectioningEvent) return;
    const bypass = makeBypassRecord({ staff_id: doctorId || "", name: doctorName || "" }, reason);
    update((current) => ({
      ...current,
      events: current.events.map((item) => (item.event_id === sectioningEvent.event_id
        ? {
          ...item,
          block_verifications: [
            ...(item.block_verifications || []),
            { ...bypass, event_id: sectioningEvent.event_id },
          ],
        }
        : item)),
    }));
    setBypassEventId("");
    setBypassReason("");
    setNotice("Block barcode verification bypassed. Sectioning is unlocked — the record is saved as not verified.");
  };

  // Changing the reason re-points any slide that still carries the old default
  // destination; slides the technologist set by hand are left alone.
  const setReason = (eventId, value) => update((current) => ({
    ...current,
    events: current.events.map((event) => {
      if (event.event_id !== eventId) return event;
      const previousDefault = intendedUseForReason(event.reason);
      const nextDefault = intendedUseForReason(value);
      return {
        ...event,
        reason: value,
        slides: (event.slides || []).map((slide) => (
          slide.intended_use === previousDefault ? { ...slide, intended_use: nextDefault } : slide
        )),
      };
    }),
  }));

  // Accepts either a plain string or a function updater over the current
  // transcript, so an appended transcription can build on what is already there.
  const setTranscript = (eventId, valueOrUpdater) => setTranscripts((current) => ({
    ...current,
    [eventId]: typeof valueOrUpdater === "function"
      ? valueOrUpdater(current[eventId] || "")
      : valueOrUpdater,
  }));

  const addSlide = (eventId) => update((current) => ({
    ...current,
    events: current.events.map((event) => (event.event_id === eventId
      ? { ...event, slides: [...(event.slides || []), makeSlide(event)] }
      : event)),
  }));

  const updateSlide = (eventId, slideId, key, value) => update((current) => ({
    ...current,
    events: current.events.map((event) => (event.event_id === eventId
      ? { ...event, slides: (event.slides || []).map((slide) => (slide.slide_id === slideId ? { ...slide, [key]: value } : slide)) }
      : event)),
  }));

  const removeSlide = (eventId, slideId) => update((current) => ({
    ...current,
    events: current.events.map((event) => (event.event_id === eventId
      ? { ...event, slides: (event.slides || []).filter((slide) => slide.slide_id !== slideId) }
      : event)),
  }));

  // ─── Per-event dictation ──────────────────────────────────────────────────
  const startRecording = async (eventId) => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      mediaRecorderRef.current = new MediaRecorder(stream);
      audioChunksRef.current = [];
      mediaRecorderRef.current.ondataavailable = (event) => {
        if (event.data.size > 0) audioChunksRef.current.push(event.data);
      };
      mediaRecorderRef.current.start();
      setRecordingEventId(eventId);
    } catch (error) {
      console.error("[SectioningTab] microphone:", error);
      setNotice("Microphone access is unavailable.");
    }
  };

  const stopRecording = () => {
    const eventId = recordingEventId;
    if (!mediaRecorderRef.current || !eventId) return;
    mediaRecorderRef.current.onstop = async () => {
      setRecordingEventId("");
      setTranscribingEventId(eventId);
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
        if (text) setTranscript(eventId, (current) => (current ? `${current} ${text}` : text));
      } catch (error) {
        console.error("[SectioningTab] transcription:", error);
        setNotice("Sectioning dictation transcription failed.");
      } finally {
        setTranscribingEventId("");
      }
    };
    mediaRecorderRef.current.stop();
    mediaRecorderRef.current.stream.getTracks().forEach((track) => track.stop());
  };

  // Dictation is advisory: it fills only EMPTY fields of this one event, and it
  // never creates slides or blocks — the event is already anchored to a block the
  // technologist picked. The LLM structures the transcript; the routing decision
  // (which event) was made by the user before recording.
  const autofillEvent = async (event) => {
    const text = transcripts[event.event_id] || "";
    if (!text.trim()) return;
    setAutofillingEventId(event.event_id);
    setNotice("");
    try {
      const response = await structureSectioning(text);
      if (response.status !== "success" || !response.data) throw new Error("No structured data returned");
      const reviewedAt = new Date().toISOString();
      const patch = sectioningDictationPatch(event, response.data);
      const empty = (value) => value === "" || value === null || value === undefined;
      // Report against the render-time event so the notice says what actually landed.
      const after = mergeSectioningExtraction(event, patch);
      const filled = Object.entries(patch)
        .filter(([key, value]) => value !== "" && empty(event[key]) && !empty(after[key]) && String(after[key]) !== String(event[key]))
        .map(([key]) => key);
      update((current) => ({
        ...current,
        events: current.events.map((item) => (item.event_id === event.event_id
          ? {
            ...mergeSectioningExtraction(item, patch),
            dictation: {
              transcript: text,
              structured_at: reviewedAt,
              review_status: "Applied to empty fields only — confirm before saving",
              reviewed_by: doctorName || doctorId || "",
              reviewed_at: reviewedAt,
            },
          }
          : item)),
      }));
      setNotice(filled.length > 0
        ? `Applied ${filled.length} dictated field${filled.length === 1 ? "" : "s"} to empty fields of this sectioning event (${filled.join(", ")}).`
        : "Nothing new to fill — the dictated fields already have recorded values.");
    } catch (error) {
      console.error("[SectioningTab] structure:", error);
      setNotice("Sectioning dictation structuring failed.");
    } finally {
      setAutofillingEventId("");
    }
  };

  const removeEvent = (eventId) => {
    if (recordingEventId === eventId) stopRecording();
    update((current) => ({
      ...current,
      events: current.events.filter((event) => event.event_id !== eventId),
    }));
    setTranscripts((current) => {
      if (!(eventId in current)) return current;
      const next = { ...current };
      delete next[eventId];
      return next;
    });
  };

  const handleValidate = () => {
    setValidationResults(validateSectioningCompleteness(sectioning, blocks));
    setValidationOpen(true);
  };

  const handleSubmit = async () => {
    setIsSaving(true);
    try {
      await onSave("sectioning", sectioning);
    } finally {
      setIsSaving(false);
    }
  };

  if (blocks.length === 0) {
    return (
      <Box sx={{ border: `1px solid ${C.border}`, background: C.bgSecondary, p: 3, fontFamily: FONT }}>
        <Typography sx={{ fontFamily: FONT, fontSize: 14, fontWeight: FW_NORMAL, mb: 0.5 }}>
          No blocks are available to section.
        </Typography>
        <Typography sx={{ fontFamily: FONT, fontSize: 12, color: C.textMuted }}>
          Embed the cassettes and generate blocks in Processing &amp; Embedding before microtomy.
        </Typography>
      </Box>
    );
  }

  // ─── Derived counts (software, not AI, and never hand-entered) ─────────────
  const releasedBlocks = blocks.filter((block) => block.released_for_sectioning).length;
  const cutBlockIds = new Set(events.map((event) => event.block_id));
  const readySlides = slides.filter((slide) => slide.ready_for_staining === "Yes");
  const verifiedSlides = slides.filter((slide) => slide.label_verified === "Verified").length;
  const unstainedReserve = slides.filter((slide) => slide.intended_use === "Unstained reserve").length;
  const pendingRecuts = events.filter((event) => event.recut_required === "Yes").length;

  // Staining destination is derived from each slide's intended use, not re-entered.
  const destinationCounts = readySlides.reduce((counts, slide) => {
    const key = slide.intended_use || "Unassigned";
    counts[key] = (counts[key] || 0) + 1;
    return counts;
  }, {});
  const destinationSummary = Object.entries(destinationCounts)
    .map(([use, count]) => `${use}: ${count}`)
    .join(" | ");

  const blockOptions = [
    { value: "", label: "— Select a block —" },
    ...blocks.map((block) => ({
      value: block.block_id,
      label: `${blockLabel(block)}${block.released_for_sectioning ? "" : " (not released)"}${statusByBlock.get(block.block_id) === "Exhausted" ? " (exhausted)" : ""}`,
    })),
  ];
  const busy = isSaving || !!blockUploadEventId || !!recordingEventId || !!transcribingEventId || !!autofillingEventId;

  return (
    <Box sx={{ fontFamily: FONT }}>
      <SectionBox title="Block Inventory and Slide Handoff">
        <FG cols={4}>
          <SourceValue label="Blocks from Processing" value={String(blocks.length)} />
          <SourceValue label="Released for Sectioning" value={String(releasedBlocks)} />
          <SourceValue label="Blocks Sectioned" value={String(cutBlockIds.size)} />
          <SourceValue label="Sectioning Events" value={String(events.length)} />
        </FG>
        <FG cols={4}>
          <SourceValue label="Slides Produced" value={String(slides.length)} />
          <SourceValue label="Labels Verified" value={String(verifiedSlides)} />
          <SourceValue label="Unstained Slides Reserved" value={String(unstainedReserve)} />
          <SourceValue label="Recuts Pending" value={String(pendingRecuts)} />
        </FG>
        <FlagNote>
          Slide IDs, barcodes, counts, and the Staining handoff are computed by the software from the block list and the
          per-event slide records — not entered by hand.
        </FlagNote>

        <Box sx={{ border: `1px solid ${C.border}`, mt: 1.5 }}>
          {blocks.map((block) => {
            const blockEvents = events.filter((event) => event.block_id === block.block_id);
            const status = statusByBlock.get(block.block_id) || "Not recorded";
            return (
              <Box
                key={block.block_id}
                sx={{
                  display: "grid",
                  gridTemplateColumns: "1.4fr 1fr 0.8fr 1fr",
                  gap: 1.5,
                  px: 1.5,
                  py: 1,
                  borderTop: `1px solid ${C.border}`,
                  "&:first-of-type": { borderTop: 0 },
                  background: C.white,
                }}
              >
                <Typography sx={{ fontFamily: FONT, fontSize: 12 }}>{blockLabel(block)}</Typography>
                <Typography sx={{ fontFamily: FONT, fontSize: 12, color: C.textSecond }}>
                  {block.released_for_sectioning ? "Released by Processing" : "Not released"}
                </Typography>
                <Typography sx={{ fontFamily: FONT, fontSize: 12, color: C.textSecond }}>
                  {blockEvents.length} event(s)
                </Typography>
                <Typography sx={{ fontFamily: FONT, fontSize: 12, color: C.textSecond }}>
                  Tissue: {status}
                </Typography>
              </Box>
            );
          })}
        </Box>

        {readySlides.length > 0 && (
          <FlagNote>Ready for Staining — {destinationSummary}</FlagNote>
        )}
      </SectionBox>

      <SectionBox title="Sectioning Events">
        <Box sx={{ display: "flex", alignItems: "flex-end", gap: 1.5, mb: 2, flexWrap: "wrap" }}>
          <Box sx={{ minWidth: 300, flex: 1 }}>
            <FieldLabel>Block to Section</FieldLabel>
            <Sel label="Block" options={blockOptions} value={selectedBlockId} onChange={setSelectedBlockId} />
          </Box>
          <Button sx={outlineBtnSx} onClick={addEvent}>
            <AddRounded sx={{ mr: 0.75, fontSize: 16 }} /> Add Sectioning Event
          </Button>
        </Box>
        <FlagNote>
          Each cut is its own event. Add a new event for deeper levels, a recut, or IHC / molecular cuts so earlier work
          and its diagnostic question stay on the record.
        </FlagNote>

        <Box sx={{ mt: 2 }}>
          <FieldLabel>Open Requests From Microscopy</FieldLabel>
          <PathologyTable
            rowId={(row) => row.request_id}
            rows={openRequests}
            columns={[
              { key: "request_type", label: "Requested", width: "0.9fr" },
              { key: "reason", label: "Cut As", width: "0.8fr", muted: true },
              { key: "targets", label: "Targets", width: "1.1fr", muted: true },
              { key: "material", label: "Material", width: "1.1fr", muted: true, render: (row) => row.required_material || "Unstained slides" },
              { key: "diagnostic_question", label: "Diagnostic Question", width: "1.4fr", muted: true },
              {
                key: "slides_needed",
                label: "Material Needed",
                width: "0.8fr",
                align: "right",
                render: (row) => (row.slides_available
                  ? `${row.slides_needed} (${row.slides_available} unstained available)`
                  : String(row.slides_needed)),
              },
              { key: "priority", label: "Priority", width: "0.6fr", muted: true },
              {
                key: "block",
                label: "Preferred Block",
                width: "0.9fr",
                muted: true,
                render: (row) => (row.preferred_block_id
                  ? blockLabel(blockInfo.get(row.preferred_block_id))
                  : "Lab to choose"),
              },
              {
                key: "actions",
                label: "",
                width: "1fr",
                align: "right",
                render: (row) => (
                  <Button
                    sx={{ ...outlineBtnSx, px: 1.25, py: 0.3, fontSize: 11 }}
                    onClick={(clickEvent) => { clickEvent.stopPropagation(); addEventFromRequest(row); }}
                  >
                    Prepare {row.slides_needed} {row.required_material === "Tissue curls / scrolls" ? "curl" : "section"}{row.slides_needed === 1 ? "" : "s"}
                  </Button>
                ),
              },
            ]}
            emptyMessage="No pathologist request is waiting for tissue to be cut."
          />
          <FlagNote>
            A stained slide is consumed — it carries one stain and cannot be reused — so every requested marker needs its
            own fresh section. Whole-block, extracted DNA/RNA, blood, plasma and marrow molecular requests do not appear
            here. Only unstained-slide or tissue-curl requests are shown; suitable existing material is used first, and
            the event creates only the remaining material with the diagnostic question and request link.
          </FlagNote>
        </Box>

        {events.map((event, index) => {
          const block = blockInfo.get(event.block_id);
          const eventSlides = event.slides || [];
          const { latest: verification, matched, bypassed, failed, unlocked } = verificationState(event.block_verifications);
          const eventLocked = !unlocked;
          const decodedValues = (verification?.decoded_barcodes || []).map((item) => item.value).filter(Boolean);
          const priorExhausted = events
            .slice(0, index)
            .some((prior) => prior.block_id === event.block_id && prior.block_status === "Exhausted");
          return (
            <Box key={event.event_id} sx={{ border: `1px solid ${failed ? "#cf1322" : bypassed ? "#b76e00" : matched ? C.black : C.border}`, p: 2, mt: 1.5, background: C.white }}>
              <ItemHeader
                title={`${index + 1}. ${event.reason || "Sectioning"} — ${blockLabel(block)}`}
                subtitle={`${event.event_id} | Block ${event.block_id}`}
                onRemove={() => removeEvent(event.event_id)}
              />

              <Box sx={{ border: `1px solid ${failed ? "#cf1322" : C.border}`, background: C.bgSecondary, p: 1.5, mb: 2 }}>
                <Box sx={{ display: "flex", alignItems: "center", gap: 1, flexWrap: "wrap" }}>
                  <Button component="label" sx={outlineBtnSx} disabled={!!blockUploadEventId}>
                    {blockUploadEventId === event.event_id
                      ? <CircularProgress size={14} sx={{ mr: 1, color: C.black }} />
                      : <UploadFileRounded sx={{ mr: 0.75, fontSize: 16 }} />}
                    {verification ? "Upload New Block Image" : "Upload Block Image"}
                    <input
                      hidden
                      type="file"
                      accept="image/*"
                      onChange={(inputEvent) => handleBlockVerificationUpload(event, inputEvent)}
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
                    open={bypassEventId === event.event_id}
                    reason={bypassReason}
                    onReasonChange={setBypassReason}
                    onConfirm={() => bypassEventVerification(event)}
                    onCancel={() => { setBypassEventId(""); setBypassReason(""); }}
                    onOpen={() => { setBypassEventId(event.event_id); setBypassReason(""); }}
                    busy={!!blockUploadEventId}
                  />
                )}
              </Box>

              {eventLocked && (
                <Box sx={{ border: "1px solid #cf1322", background: "#fff1f0", p: 1.5, mb: 2 }}>
                  <Typography sx={{ display: "flex", alignItems: "center", gap: 0.75, fontFamily: FONT, fontSize: 12, color: "#cf1322" }}>
                    <WarningAmberRounded sx={{ fontSize: 17 }} />
                    Upload a matching block barcode image to unlock this sectioning event, or bypass the verification.
                  </Typography>
                </Box>
              )}

              <Box
                component="fieldset"
                disabled={eventLocked}
                sx={{ border: 0, p: 0, m: 0, minWidth: 0, opacity: eventLocked ? 0.55 : 1 }}
              >

              <EventDictation
                locked={eventLocked}
                transcript={transcripts[event.event_id] || ""}
                onTranscript={(value) => setTranscript(event.event_id, value)}
                isRecording={recordingEventId === event.event_id}
                transcribing={transcribingEventId === event.event_id}
                autofilling={autofillingEventId === event.event_id}
                busyElsewhere={(!!recordingEventId && recordingEventId !== event.event_id)
                  || (!!transcribingEventId && transcribingEventId !== event.event_id)
                  || (!!autofillingEventId && autofillingEventId !== event.event_id)}
                onToggleRecording={() => (recordingEventId === event.event_id ? stopRecording() : startRecording(event.event_id))}
                onAutofill={() => autofillEvent(event)}
                dictation={event.dictation}
              />

              <FG cols={2}>
                <SourceValue label="Parent Block ID" value={event.block_id} />
                <SourceValue label="Parent Specimen ID" value={event.parent_specimen_id} />
                <SourceValue label="Output Material" value={event.output_material_type} />
                <Box>
                  <FieldLabel>Sectioning Reason</FieldLabel>
                  <Sel label="Sectioning Reason" options={SECTIONING_REASON_OPTIONS} value={event.reason} onChange={(value) => setReason(event.event_id, value)} />
                </Box>
                <LineField label="Requested By" value={event.requested_by} onChange={(value) => updateEvent(event.event_id, "requested_by", value)} />
                <DateTimeField label="Request Date and Time" value={event.request_datetime} onChange={(value) => updateEvent(event.event_id, "request_datetime", value)} />
              </FG>
              <TextArea
                label="Diagnostic Question"
                value={event.diagnostic_question}
                onChange={(value) => updateEvent(event.event_id, "diagnostic_question", value)}
                placeholder="Why this cut was asked for — e.g. confirm invasion at the deep edge, assess a focus seen on level 1"
              />
              <TextArea label="Special Instructions" value={event.special_instructions} onChange={(value) => updateEvent(event.event_id, "special_instructions", value)} />

              {event.request_id && (
                <FG cols={2}>
                  <SourceValue label="Microscopy Request" value={shortId(event.request_id)} />
                  <SourceValue label="Originating Microscopy Review" value={shortId(event.originating_microscopy_id)} />
                </FG>
              )}

              {!block?.released_for_sectioning && (
                <FlagNote>
                  This block is not marked Ready for Sectioning in Processing &amp; Embedding. Confirm the tissue is
                  properly processed and embedded before cutting.
                </FlagNote>
              )}
              {priorExhausted && (
                <FlagNote>
                  This block was already recorded as Exhausted on an earlier event. No further tissue should be
                  available to cut.
                </FlagNote>
              )}

              <FG cols={3}>
                <LineField label="Section Thickness (µm)" value={event.thickness_um} onChange={(value) => updateEvent(event.event_id, "thickness_um", value)} placeholder="e.g. 4" />
                <LineField label="Microtome ID" value={event.microtome_id} onChange={(value) => updateEvent(event.event_id, "microtome_id", value)} />
                <Box>
                  <FieldLabel>Slide Type</FieldLabel>
                  <Sel label="Slide Type" options={SLIDE_TYPE_OPTIONS} value={event.slide_type} onChange={(value) => updateEvent(event.event_id, "slide_type", value)} />
                </Box>
                <LineField label="Levels Requested" value={event.levels_requested} onChange={(value) => updateEvent(event.event_id, "levels_requested", value)} />
                <LineField label="Levels Cut" value={event.levels_cut} onChange={(value) => updateEvent(event.event_id, "levels_cut", value)} />
                <LineField label="Level Interval / Depth" value={event.level_interval} onChange={(value) => updateEvent(event.event_id, "level_interval", value)} placeholder="e.g. every 50 µm" />
                <LineField label="Sectioned By" value={event.sectioned_by} onChange={(value) => updateEvent(event.event_id, "sectioned_by", value)} />
                <DateTimeField label="Sectioning Date and Time" value={event.sectioning_datetime} onChange={(value) => updateEvent(event.event_id, "sectioning_datetime", value)} />
                <LineField
                  label={event.output_material_type === "Tissue curls / scrolls" ? "Curls / Scrolls Required" : "Expected Slide Count"}
                  value={event.output_material_type === "Tissue curls / scrolls" ? event.output_quantity : event.expected_slide_count}
                  onChange={(value) => updateEvent(event.event_id, event.output_material_type === "Tissue curls / scrolls" ? "output_quantity" : "expected_slide_count", value)}
                />
                {event.output_material_type === "Tissue curls / scrolls" && (
                  <LineField label="Output Tube / Container" value={event.output_container} onChange={(value) => updateEvent(event.event_id, "output_container", value)} placeholder="Tube or container identifier" />
                )}
              </FG>

              {event.output_material_type === "Unstained slides" && <Box sx={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 2, mt: 1, mb: 1, flexWrap: "wrap" }}>
                <FieldLabel>
                  Slides Produced ({eventSlides.length}
                  {event.expected_slide_count ? ` of ${event.expected_slide_count} expected` : ""})
                </FieldLabel>
                <Button sx={{ ...outlineBtnSx, px: 1.5, py: 0.5 }} onClick={() => addSlide(event.event_id)}>
                  <AddRounded sx={{ mr: 0.5, fontSize: 15 }} /> Add Slide
                </Button>
              </Box>}
              {eventSlides.map((slide, slideIndex) => (
                <Box key={slide.slide_id} sx={{ border: `1px solid ${C.border}`, p: 1.5, mb: 1, background: C.bgSecondary }}>
                  <ItemHeader
                    title={`Slide ${slideIndex + 1}`}
                    subtitle={`${slide.slide_id} | from block ${slide.parent_block_id}`}
                    onRemove={() => removeSlide(event.event_id, slide.slide_id)}
                  />
                  <Box sx={{ mb: 1.5 }}>
                    <FieldLabel>Slide Barcode</FieldLabel>
                    <Code128Barcode value={slide.slide_id} accessionId={accessionId} />
                  </Box>
                  <FG cols={3}>
                    <LineField label="Level" value={slide.level} onChange={(value) => updateSlide(event.event_id, slide.slide_id, "level", value)} placeholder="e.g. L1" />
                    <Box>
                      <FieldLabel>Intended Use / Stain</FieldLabel>
                      <Sel label="Intended Use" options={SLIDE_INTENDED_USE_OPTIONS} value={slide.intended_use} onChange={(value) => updateSlide(event.event_id, slide.slide_id, "intended_use", value)} />
                    </Box>
                    <Box>
                      <FieldLabel>Slide Label Verification</FieldLabel>
                      <Sel label="Label Verification" options={VERIFICATION_OPTIONS} value={slide.label_verified} onChange={(value) => updateSlide(event.event_id, slide.slide_id, "label_verified", value)} />
                    </Box>
                  </FG>
                </Box>
              ))}
              {eventSlides.length === 0 && (
                <FlagNote>
                  No slide recorded yet. Add one slide per section cut — each gets its own ID and barcode, and carries
                  this block as its parent.
                </FlagNote>
              )}

              <FG cols={2}>
                <Box>
                  <FieldLabel>Section Quality</FieldLabel>
                  <Sel label="Section Quality" options={SECTION_QUALITY_OPTIONS} value={event.section_quality} onChange={(value) => updateEvent(event.event_id, "section_quality", value)} />
                </Box>
                <Box>
                  <FieldLabel>Tissue Adequately Represented</FieldLabel>
                  <Sel label="Tissue Adequately Represented" options={YES_NO_OPTIONS} value={event.tissue_adequately_represented} onChange={(value) => updateEvent(event.event_id, "tissue_adequately_represented", value)} />
                </Box>
              </FG>
              {isQualityProblem(event.section_quality) && (
                <TextArea label="Section Quality Note" value={event.quality_note} onChange={(value) => updateEvent(event.event_id, "quality_note", value)} placeholder="Describe the artefact and what was tried" />
              )}

              <FG cols={2}>
                <Box>
                  <FieldLabel>Recut Required</FieldLabel>
                  <Sel label="Recut Required" options={YES_NO_OPTIONS} value={event.recut_required} onChange={(value) => updateEvent(event.event_id, "recut_required", value)} />
                </Box>
                {event.recut_required === "Yes" && (
                  <LineField label="Recut Reason" value={event.recut_reason} onChange={(value) => updateEvent(event.event_id, "recut_reason", value)} />
                )}
                <Box>
                  <FieldLabel>Block Status After Cutting</FieldLabel>
                  <Sel label="Block Status" options={BLOCK_STATUS_OPTIONS} value={event.block_status} onChange={(value) => updateEvent(event.event_id, "block_status", value)} />
                </Box>
                <Box>
                  <FieldLabel>Ready for Staining</FieldLabel>
                  <Sel label="Ready for Staining" options={YES_NO_OPTIONS} value={event.ready_for_staining} onChange={(value) => updateEvent(event.event_id, "ready_for_staining", value)} />
                </Box>
              </FG>
              {event.block_status === "Exhausted" && (
                <FlagNote>
                  Block recorded as exhausted — no further levels, special stains, IHC, or molecular studies can be cut
                  from it. Confirm the tissue needed for pending studies has already been taken.
                </FlagNote>
              )}
              <TextArea label="Sectioning Comments" value={event.comments} onChange={(value) => updateEvent(event.event_id, "comments", value)} />
              </Box>
            </Box>
          );
        })}
        {events.length === 0 && (
          <FlagNote>No sectioning event recorded yet. Select a block above and add the first cut.</FlagNote>
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
          {isSaving ? <CircularProgress size={14} sx={{ mr: 1, color: C.white }} /> : <SaveRounded sx={{ mr: 0.75, fontSize: 16 }} />}
          Save Sectioning
        </Button>
      </Box>

      <CapValidationDialog
        open={validationOpen}
        onClose={() => setValidationOpen(false)}
        title="Sectioning Reconciliation Review"
        results={validationResults}
      />
    </Box>
  );
}
