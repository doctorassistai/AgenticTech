import React, { useEffect, useMemo, useRef, useState } from "react";
import { Box, Button, CircularProgress, IconButton, TextField, Typography } from "@mui/material";
import {
  AddRounded,
  AutoAwesomeRounded,
  CheckRounded,
  CloseRounded,
  DeleteOutlineRounded,
  FactCheckRounded,
  LightbulbRounded,
  MicRounded,
  SaveRounded,
  ScienceRounded,
  StopRounded,
} from "@mui/icons-material";
import { C, FONT, FW_LIGHT, FW_NORMAL, inputSx, outlineBtnSx, saveBtnSx, sectionHeaderSx } from "../../shared/designTokens";
import { FG, FieldLabel, FlagNote, SectionBox, Sel } from "../../shared/FormComponents";
import ClinicalPosturePanel from "../ClinicalPosturePanel";
import { getClinicalPosture, recommendMicroscopy, structureMicroscopy } from "../shared/api";
import {
  ADEQUACY_OPTIONS,
  COMPARISON_STATUS_OPTIONS,
  DIAGNOSTIC_LOOP_STATUS_OPTIONS,
  DISCORDANCE_OPTIONS,
  GRADE_SYSTEM_OPTIONS,
  IHC_INTENSITY_OPTIONS,
  IHC_PATTERN_OPTIONS,
  IHC_SCORING_SYSTEM_OPTIONS,
  INTERPRETABILITY_OPTIONS,
  MALIGNANCY_OPTIONS,
  MARGIN_STATUS_OPTIONS,
  REPORT_STATUS_OPTIONS,
  REQUEST_PRIORITY_OPTIONS,
  REQUEST_TYPE_OPTIONS,
  MOLECULAR_MATERIAL_OPTIONS,
  RESULT_COMPARISON_OPTIONS,
  REVIEW_CYCLE_OPTIONS,
  SECOND_OPINION_STATUS_OPTIONS,
  SLIDE_QUALITY_OPTIONS,
  SUPPORTS_OPTIONS,
  TISSUE_RESERVATION_OPTIONS,
  TUMOR_PRESENT_OPTIONS,
  YES_NO_OPTIONS,
  ancillaryRequestStatus,
  interpretationOptionsFor,
  isRequestOpen,
  makeAncillaryRequest,
  makeAncillaryResult,
  makeMicroscopyImage,
  makeMicroscopyReview,
  makeRequestItem,
  mergeAncillaryResultExtraction,
  mergeMicroscopyExtraction,
  mergeReport,
  microscopyBlocks,
  microscopyMolecular,
  microscopySectioningEvents,
  microscopySlides,
  microscopySpecimens,
  microscopyStains,
  pendingAncillaryWork,
  requestSlideAvailability,
  reviewCycleForModality,
  syncMicroscopy,
} from "../shared/microscopyModel";
import { validateMicroscopyCompleteness } from "../shared/capValidation";
import CapValidationDialog from "../CapValidationDialog";
import PathologyTable from "../PathologyTable";
import SlideImageViewer from "../SlideImageViewer";

const API_BASE_URL = import.meta.env.VITE_BACKEND_URL || "https://doctorassist.ai/api/";

// Lineage IDs are <PREFIX>-<uuid>; the tail is enough to tell two items apart in
// a table. The full ID stays on the record.
const shortId = (id) => (id ? String(id).slice(-6) : "");

const requestTypeForModality = (modality) => ({
  "Special stain": "Special stain",
  IHC: "IHC",
  FISH: "FISH/ISH",
  Molecular: "Molecular test",
}[modality] || "Other");

const requestTypeForSuggestion = (suggestion = {}) => {
  const text = `${suggestion.next_workflow || ""} ${suggestion.item || ""}`.toLowerCase();
  if (text.includes("molecular") || text.includes("sequenc") || text.includes("fusion")) return "Molecular test";
  if (text.includes("fish") || text.includes("ish")) return "FISH/ISH";
  if (text.includes("ihc") || text.includes("immuno")) return "IHC";
  if (text.includes("special stain") || text.includes("stain")) return "Special stain";
  if (text.includes("level") || text.includes("recut") || text.includes("section")) return "Additional levels";
  return "Other";
};

const resultOutcomeRecorded = (result = {}) => !!String(result.interpretation || "").trim()
  || (result.interpretability === "Not interpretable"
    && !!String(result.interpretability_note || "").trim()
    && ["Yes", "No"].includes(result.repeat_or_additional_work_required));

const readOnlyValue = (value) => (value === 0 ? "0" : value || "Not recorded");

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

const SourceValue = ({ label, value }) => (
  <Box>
    <FieldLabel>{label}</FieldLabel>
    <TextField value={readOnlyValue(value)} size="small" fullWidth InputProps={{ readOnly: true }} sx={inputSx} />
  </Box>
);

const LineField = ({ label, value, onChange, placeholder, type = "text" }) => (
  <Box>
    <FieldLabel>{label}</FieldLabel>
    <TextField
      type={type}
      value={value ?? ""}
      onChange={(event) => onChange(event.target.value)}
      size="small"
      fullWidth
      placeholder={placeholder}
      InputLabelProps={type === "datetime-local" ? { shrink: true } : undefined}
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

// A bordered sub-card with an uppercase header bar. The review form's field groups
// are rendered as these cards so each stage reads as one section. The review form
// is shared between Primary Microscopy and Microscopy Review, so the sections apply
// to both modes unchanged.
const RecordSection = ({ title, children }) => (
  <Box sx={{ border: `1px solid ${C.border}`, mb: 2, background: C.white }}>
    <Box sx={sectionHeaderSx}>{title}</Box>
    <Box sx={{ p: 2.5 }}>{children}</Box>
  </Box>
);

const ItemHeader = ({ title, subtitle, onRemove, removeTitle }) => (
  <Box sx={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 1, mb: 1.5 }}>
    <Box>
      <Typography sx={{ fontFamily: FONT, fontSize: 13, fontWeight: FW_NORMAL }}>{title}</Typography>
      {subtitle && (
        <Typography sx={{ fontFamily: FONT, fontSize: 11, fontWeight: FW_LIGHT, color: C.textMuted }}>
          {subtitle}
        </Typography>
      )}
    </Box>
    {onRemove && (
      <IconButton size="small" onClick={onRemove} title={removeTitle || "Remove"} sx={{ color: C.textSecond }}>
        <DeleteOutlineRounded fontSize="small" />
      </IconButton>
    )}
  </Box>
);

const RowButton = ({ children, onClick, disabled }) => (
  <Button
    sx={{ ...outlineBtnSx, px: 1.25, py: 0.3, fontSize: 11 }}
    onClick={(event) => { event.stopPropagation(); onClick(); }}
    disabled={disabled}
  >
    {children}
  </Button>
);

const SuggestionRow = ({ item, onReview, onAddTest }) => {
  const status = item.review_status || item.status || "Suggested";
  return (
    <Box sx={{ borderTop: `1px solid ${C.border}`, py: 1.25 }}>
      <Box sx={{ display: "flex", justifyContent: "space-between", gap: 2, flexWrap: "wrap" }}>
        <Box sx={{ flex: 1, minWidth: 0 }}>
          {/* A routed next step says where the work is carried out. */}
          {item.next_workflow && (
            <Typography
              component="span"
              sx={{
                fontFamily: FONT, fontSize: 10, letterSpacing: "0.08em", textTransform: "uppercase",
                border: `1px solid ${C.borderStrong}`, px: 0.75, py: 0.25, mr: 1, color: C.textSecond,
              }}
            >
              {item.next_workflow}
            </Typography>
          )}
          <Typography component="span" sx={{ fontFamily: FONT, fontSize: 13 }}>{item.item || item.title || "Microscopy suggestion"}</Typography>
          {item.reason && (
            <Typography sx={{ fontFamily: FONT, fontSize: 12, color: C.textSecond, mt: 0.5 }}>{item.reason}</Typography>
          )}
          <Typography sx={{ fontFamily: FONT, fontSize: 11, color: C.textMuted, mt: 0.5 }}>
            {item.source_name || item.source || "Source not supplied"} | Confidence: {item.confidence || "Moderate"}
          </Typography>
        </Box>
        {status === "Suggested" ? (
          <Box sx={{ display: "flex", gap: 1, flexShrink: 0 }}>
            {onAddTest && (
              <Button sx={{ ...outlineBtnSx, px: 1.25, py: 0.4 }} onClick={() => onAddTest(item)}>
                <AddRounded sx={{ mr: 0.5, fontSize: 15 }} />Add test
              </Button>
            )}
            <Button sx={{ ...outlineBtnSx, px: 1.25, py: 0.4 }} onClick={() => onReview(item.suggestion_id, "Accepted")}>
              <CheckRounded sx={{ mr: 0.5, fontSize: 15 }} />Accept
            </Button>
            <Button sx={{ ...outlineBtnSx, px: 1.25, py: 0.4 }} onClick={() => onReview(item.suggestion_id, "Dismissed")}>
              <CloseRounded sx={{ mr: 0.5, fontSize: 15 }} />Dismiss
            </Button>
          </Box>
        ) : (
          <Typography sx={{ fontFamily: FONT, fontSize: 11, color: C.textSecond, flexShrink: 0 }}>{status}</Typography>
        )}
      </Box>
    </Box>
  );
};

// A plain read-only list, for the narrative output that is not accepted or
// dismissed (major findings, unsupported elements, what is still needed).
const PlainList = ({ label, items }) => (
  (items || []).length > 0 ? (
    <Box sx={{ mb: 2 }}>
      <FieldLabel>{label}</FieldLabel>
      {items.map((entry, index) => (
        <Box key={`${label}-${index}`} sx={{ display: "flex", gap: 1, borderTop: `1px solid ${C.border}`, py: 0.9 }}>
          <Typography sx={{ fontFamily: FONT, fontSize: 12, color: C.textMuted, flexShrink: 0 }}>—</Typography>
          <Typography sx={{ fontFamily: FONT, fontSize: 13, color: C.textSecond }}>{entry}</Typography>
        </Box>
      ))}
    </Box>
  ) : null
);

// Reviewable suggestion buckets. `reviewSuggestion` and the run-level review
// roll-up both iterate this list, so a new bucket only has to be added here.
// Next steps come first: they are the practical worklist.
const SUGGESTION_GROUPS = [
  ["next_step_suggestions", "Recommended Next Steps"],
  ["diagnostic_suggestions", "Diagnostic Suggestions"],
  // Driven by the deterministic clinical posture: only populated when the patient
  // record shows an actual prior chemotherapy or radiotherapy exposure.
  ["therapy_related_suggestions", "Prior-Therapy Considerations"],
  ["discordance_suggestions", "Concordance and Discordance Flags"],
  ["reporting_suggestions", "Reporting Completeness Suggestions"],
];
const TEST_SUGGESTION_GROUP = ["ancillary_test_suggestions", "Suggested Tests"];
const ALL_SUGGESTION_GROUPS = [...SUGGESTION_GROUPS, TEST_SUGGESTION_GROUP];

export default function MicroscopyTab({
  caseId,
  initialData,
  caseRegister,
  processing,
  sectioning,
  staining,
  molecular,
  grossing,
  doctorId,
  doctorName,
  mode = "primary",
  onSave,
}) {
  const isReviewMode = mode === "review";
  const isAncillaryMode = mode === "ancillary";
  // ─── Upstream inventory (references only; nothing is copied in) ────────────
  const specimens = useMemo(() => microscopySpecimens(caseRegister), [caseRegister]);
  const blocks = useMemo(() => microscopyBlocks(processing, grossing, sectioning), [processing, grossing, sectioning]);
  const slides = useMemo(() => microscopySlides(sectioning, grossing), [sectioning, grossing]);
  const stains = useMemo(() => microscopyStains(staining), [staining]);
  const molecularOrders = useMemo(() => microscopyMolecular(molecular), [molecular]);
  const sectioningEvents = useMemo(() => microscopySectioningEvents(sectioning), [sectioning]);
  const sources = useMemo(
    () => ({ specimens, blocks, slides, stains, molecular: molecularOrders, sectioningEvents }),
    [specimens, blocks, slides, stains, molecularOrders, sectioningEvents],
  );

  const [microscopy, setMicroscopy] = useState(() => syncMicroscopy(initialData, sources));
  const [selectedSpecimenId, setSelectedSpecimenId] = useState("");
  const [selectedBlockId, setSelectedBlockId] = useState("");
  const [selectedSlideId, setSelectedSlideId] = useState("");
  const [activeReviewId, setActiveReviewId] = useState("");
  const [activeRequestId, setActiveRequestId] = useState("");
  const [activeResultId, setActiveResultId] = useState("");
  const [expandedResultId, setExpandedResultId] = useState("");
  const [reviewTranscript, setReviewTranscript] = useState("");
  const [resultTranscript, setResultTranscript] = useState("");
  const [recordingTarget, setRecordingTarget] = useState("");
  const [isTranscribing, setIsTranscribing] = useState(false);
  const [autofillTarget, setAutofillTarget] = useState("");
  const [notice, setNotice] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const [lastRecommendationFocusId, setLastRecommendationFocusId] = useState("");
  const [validationOpen, setValidationOpen] = useState(false);
  const [validationResults, setValidationResults] = useState([]);
  // Draft of a manually added request in Primary Microscopy; null = the inline form is closed.
  const [manualDraft, setManualDraft] = useState(null);
  const mediaRecorderRef = useRef(null);
  const audioChunksRef = useRef([]);
  const reviewWorkspaceRef = useRef(null);
  const requestsRef = useRef(null);
  const returnedWorkRef = useRef(null);
  const assistantRef = useRef(null);

  useEffect(() => {
    setMicroscopy(syncMicroscopy(initialData, sources));
    setSelectedSpecimenId("");
    setSelectedBlockId("");
    setSelectedSlideId("");
    setActiveReviewId("");
    setActiveRequestId("");
    setActiveResultId("");
    setExpandedResultId("");
    setReviewTranscript("");
    setResultTranscript("");
    setManualDraft(null);
    setNotice("");
  }, [caseId]); // eslint-disable-line react-hooks/exhaustive-deps

  const reviews = microscopy.reviews || [];
  const requests = microscopy.ancillary_requests || [];
  const results = microscopy.ancillary_results || [];
  const visibleReviews = useMemo(() => {
    const primaryCycles = new Set(["Initial H&E", "Deeper levels"]);
    return reviews.filter((review) => (isReviewMode
      ? !primaryCycles.has(review.review_cycle)
      : primaryCycles.has(review.review_cycle)));
  }, [reviews, isReviewMode]);

  const specimenById = useMemo(() => new Map(specimens.map((item) => [item.specimen_id, item])), [specimens]);
  const blockById = useMemo(() => new Map(blocks.map((item) => [item.block_id, item])), [blocks]);
  const slideById = useMemo(() => new Map(slides.map((item) => [item.slide_id, item])), [slides]);
  const stainById = useMemo(() => new Map(stains.map((item) => [item.stain_id, item])), [stains]);

  // A stained slide is consumed — it carries one stain and cannot be reused — so a
  // request may only name slides that are still unstained. Those spare slides
  // (unstained reserves, or slides cut for the request) are what lets a request go
  // straight to the bench without another trip to Sectioning.
  const usedSlideIds = useMemo(
    () => new Set(stains.map((stain) => stain.slide_id).filter(Boolean)),
    [stains],
  );
  const availableSlides = useMemo(
    () => slides.filter((slide) => !usedSlideIds.has(slide.slide_id)),
    [slides, usedSlideIds],
  );
  const requestContext = useMemo(
    () => ({ stains, molecularOrders, sectioningEvents, results, availableSlides }),
    [stains, molecularOrders, sectioningEvents, results, availableSlides],
  );
  const pendingWork = useMemo(() => pendingAncillaryWork(microscopy, sources), [microscopy, sources]);

  const activeReview = visibleReviews.find((review) => review.microscopy_id === activeReviewId) || null;
  const activeRequest = requests.find((request) => request.request_id === activeRequestId) || null;
  const activeResult = results.find((result) => result.result_id === activeResultId) || null;

  const assistantModeForReview = (reviewCycle = "") => {
    if (reviewCycle === "Integrated review") return "integrated_review";
    if (["Post-special stain", "Post-IHC", "Post-FISH/ISH"].includes(reviewCycle)) {
      return "post_ancillary_correlation";
    }
    return "initial_morphology";
  };
  const focusedAssistantMode = assistantModeForReview(activeReview?.review_cycle);
  const assistantButtonLabel = focusedAssistantMode === "integrated_review"
    ? "Review Integrated Diagnosis With AI"
    : focusedAssistantMode === "post_ancillary_correlation"
      ? "Correlate Ancillary Result With AI"
      : "Review Morphology With AI";

  const focusSection = (ref) => {
    const scroll = () => ref.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    if (typeof requestAnimationFrame === "function") requestAnimationFrame(scroll);
    else scroll();
  };

  const specimenLabel = (id) => {
    const specimen = specimenById.get(id);
    if (!specimen) return id ? shortId(id) : "Unlinked";
    return [`Part ${specimen.part_label}`, specimen.specimen_type, specimen.anatomic_site]
      .filter(Boolean)
      .join(" · ");
  };
  const blockLabel = (id) => {
    const block = blockById.get(id);
    if (!block) return id ? shortId(id) : "—";
    return `${block.cassette_label || "Unlabelled"} · ${shortId(block.block_id)}`;
  };
  const slideLabel = (id) => {
    const slide = slideById.get(id);
    if (!slide) return id ? shortId(id) : "Panel review";
    return [`Slide ${shortId(slide.slide_id)}`, slide.level && `Level ${slide.level}`, slide.intended_use]
      .filter(Boolean)
      .join(" · ");
  };
  const resultTargetLabel = (result) => {
    const stain = stainById.get(result.stain_id);
    return stain ? `${stain.target || stain.modality}` : shortId(result.stain_id);
  };
  const resultModality = (result) => stainById.get(result?.stain_id)?.modality || "";

  // ─── Filtered inventory: each selected parent reveals only its children ───
  const visibleBlocks = blocks.filter((block) => block.specimen_id === selectedSpecimenId);
  const visibleSlides = slides.filter((slide) => slide.block_id === selectedBlockId);

  const update = (updater) => setMicroscopy((current) => updater(current));

  const updateReview = (id, key, value) => update((current) => ({
    ...current,
    reviews: current.reviews.map((review) => (review.microscopy_id === id ? { ...review, [key]: value } : review)),
  }));
  const patchReview = (id, patch) => update((current) => ({
    ...current,
    reviews: current.reviews.map((review) => (review.microscopy_id === id ? { ...review, ...patch } : review)),
  }));
  const updateRequest = (id, key, value) => update((current) => ({
    ...current,
    ancillary_requests: current.ancillary_requests.map((request) => (
      request.request_id === id ? { ...request, [key]: value } : request
    )),
  }));
  const updateRequestItem = (requestId, itemId, key, value) => update((current) => ({
    ...current,
    ancillary_requests: current.ancillary_requests.map((request) => (
      request.request_id === requestId
        ? {
          ...request,
          requested_items: request.requested_items.map((item) => (
            item.request_item_id === itemId ? { ...item, [key]: value } : item
          )),
        }
        : request
    )),
  }));
  const updateResult = (id, key, value) => update((current) => ({
    ...current,
    ancillary_results: current.ancillary_results.map((result) => (
      result.result_id === id ? { ...result, [key]: value } : result
    )),
  }));
  const patchResult = (id, patch) => update((current) => ({
    ...current,
    ancillary_results: current.ancillary_results.map((result) => (
      result.result_id === id ? { ...result, ...patch } : result
    )),
  }));

  // ─── Reviews ──────────────────────────────────────────────────────────────
  const startSlideReview = () => {
    const slide = slideById.get(selectedSlideId);
    if (!slide) {
      setNotice("Select a slide in the inventory before starting a review.");
      return;
    }
    const review = {
      ...makeMicroscopyReview(doctorName || doctorId || ""),
      specimen_id: slide.specimen_id,
      block_id: slide.block_id,
      slide_id: slide.slide_id,
    };
    update((current) => ({ ...current, reviews: [...current.reviews, review] }));
    setActiveReviewId(review.microscopy_id);
    setReviewTranscript("");
    setNotice("");
  };

  const removeReview = (id) => {
    update((current) => ({
      ...current,
      reviews: current.reviews.filter((review) => review.microscopy_id !== id),
      // An interpretation belongs to the cycle that recorded it; unlink rather
      // than silently delete the pathologist's observation.
      ancillary_results: current.ancillary_results.map((result) => (
        result.microscopy_id === id ? { ...result, microscopy_id: "" } : result
      )),
      ancillary_requests: current.ancillary_requests.map((request) => (
        request.originating_microscopy_id === id ? { ...request, originating_microscopy_id: "" } : request
      )),
    }));
    if (activeReviewId === id) setActiveReviewId("");
  };

  const addImage = () => {
    if (!activeReview) return;
    patchReview(activeReview.microscopy_id, { images: [...(activeReview.images || []), makeMicroscopyImage()] });
  };
  const updateImage = (imageId, key, value) => {
    if (!activeReview) return;
    patchReview(activeReview.microscopy_id, {
      images: (activeReview.images || []).map((image) => (image.image_id === imageId ? { ...image, [key]: value } : image)),
    });
  };
  const removeImage = (imageId) => {
    if (!activeReview) return;
    patchReview(activeReview.microscopy_id, {
      images: (activeReview.images || []).filter((image) => image.image_id !== imageId),
    });
  };

  // ─── Ancillary requests ───────────────────────────────────────────────────
  const addSuggestedTest = (suggestion) => {
    if (!activeReview) {
      setNotice("Select the review cycle that needs additional work before adding a suggested test.");
      return;
    }
    const target = String(suggestion.item || "").trim();
    if (!target) return;
    const requestType = requestTypeForSuggestion(suggestion);
    const purpose = String(suggestion.reason || "Suggested from the recorded review").trim();
    update((current) => {
      const existing = current.ancillary_requests.find((request) => request.originating_microscopy_id === activeReview.microscopy_id
        && request.request_type === requestType
        && request.cancelled !== "Yes");
      if (existing) {
        const duplicate = (existing.requested_items || []).some((item) => String(item.target || "").trim().toLowerCase() === target.toLowerCase());
        if (duplicate) return current;
        return {
          ...current,
          ancillary_requests: current.ancillary_requests.map((request) => (request.request_id === existing.request_id
            ? { ...request, requested_items: [...(request.requested_items || []), { ...makeRequestItem(target), purpose }] }
            : request)),
        };
      }
      const request = makeAncillaryRequest(activeReview, doctorName || doctorId || "");
      request.request_type = requestType;
      request.requested_items = [{ ...makeRequestItem(target), purpose }];
      return { ...current, ancillary_requests: [...current.ancillary_requests, request] };
    });
    reviewSuggestion(suggestion.suggestion_id, "Accepted");
    setNotice(`${target} added to the Ancillary Work request queue.`);
    focusSection(requestsRef);
  };

  const addRequestItem = (requestId) => update((current) => ({
    ...current,
    ancillary_requests: current.ancillary_requests.map((request) => (
      request.request_id === requestId
        ? { ...request, requested_items: [...request.requested_items, makeRequestItem()] }
        : request
    )),
  }));

  const removeRequestItem = (requestId, itemId) => update((current) => ({
    ...current,
    ancillary_requests: current.ancillary_requests.map((request) => (
      request.request_id === requestId
        ? { ...request, requested_items: request.requested_items.filter((item) => item.request_item_id !== itemId) }
        : request
    )),
  }));

  const removeRequest = (requestId) => {
    update((current) => ({
      ...current,
      ancillary_requests: current.ancillary_requests.filter((request) => request.request_id !== requestId),
      reviews: current.reviews.map((review) => ({
        ...review,
        linked_request_ids: (review.linked_request_ids || []).filter((id) => id !== requestId),
      })),
      ancillary_results: current.ancillary_results.map((result) => (
        result.request_id === requestId ? { ...result, request_id: "" } : result
      )),
    }));
    if (activeRequestId === requestId) setActiveRequestId("");
  };

  // ─── Manual request creation (Primary Microscopy) ──────────────────────────
  // The doctor can raise an additional-work request without an AI review or even
  // a selected review cycle. Only the table's columns are captured here — Type,
  // Requested, Specimen, Preferred Block, Priority — and Status stays derived
  // ("Requested" until the laboratory picks it up). Everything else on the
  // request (diagnostic question, further items, materials, cancellation) is
  // completed later in Ancillary Work.
  const openManualRequest = () => setManualDraft({
    request_type: "",
    requested: "",
    source_specimen_id: "",
    preferred_block_id: "",
    priority: "Routine",
  });
  const cancelManualRequest = () => setManualDraft(null);
  const canAddManualRequest = () => !!manualDraft?.request_type
    && !!manualDraft?.requested?.trim()
    && !!manualDraft?.source_specimen_id;

  const addManualRequest = async () => {
    if (!canAddManualRequest()) return;
    const request = makeAncillaryRequest({}, doctorName || doctorId || "");
    request.request_type = manualDraft.request_type;
    request.priority = manualDraft.priority;
    // A request without a live source_specimen_id is dropped by syncMicroscopy,
    // so the specimen is mandatory here.
    request.source_specimen_id = manualDraft.source_specimen_id;
    request.preferred_block_id = manualDraft.preferred_block_id || "";
    request.requested_items = [{ ...makeRequestItem(manualDraft.requested.trim()) }];
    const target = request.requested_items[0].target;
    // Persist immediately so the new request is not lost if the doctor leaves the
    // tab before pressing Save, and mirror it into local state so the row appears
    // without waiting on the parent refetch.
    const next = {
      ...microscopy,
      ancillary_requests: [...(microscopy.ancillary_requests || []), request],
    };
    setMicroscopy(next);
    setManualDraft(null);
    setIsSaving(true);
    setNotice("");
    focusSection(requestsRef);
    try {
      await onSave("microscopy", next);
      setNotice(`${request.request_type} request added for ${target} and saved. Complete the remaining details in Ancillary Work.`);
    } catch (error) {
      console.error("[MicroscopyTab] save after manual request:", error);
      setNotice(`${request.request_type} request added for ${target}, but the save failed — press Save to retry.`);
    } finally {
      setIsSaving(false);
    }
  };

  // ─── Interpreting returned laboratory work ────────────────────────────────
  // Creates (or reuses) the review cycle the returned stained slide belongs in,
  // seeds one interpretation record for it, and links the review to the technical
  // record. Only staining work arrives here — molecular results are interpreted
  // in Molecular and reach the diagnosis through Integrated Diagnosis.
  const interpretWork = (item) => {
    const cycle = reviewCycleForModality(item.modality);
    const specimenId = item.specimen_id
      || requests.find((request) => request.request_id === item.request_id)?.source_specimen_id
      || slideById.get(item.slide_id)?.specimen_id
      || blockById.get(item.block_id)?.specimen_id
      || selectedSpecimenId
      || specimens[0]?.specimen_id
      || "";
    if (!specimenId) {
      setNotice("This work cannot be linked to an accessioned specimen. Check the case lineage first.");
      return;
    }
    const existing = reviews.find((review) => review.review_cycle === cycle
      && review.specimen_id === specimenId
      && (!item.request_id || (review.linked_request_ids || []).includes(item.request_id)));

    const review = existing || {
      ...makeMicroscopyReview(doctorName || doctorId || ""),
      review_cycle: cycle,
      specimen_id: specimenId,
      block_id: blockById.has(item.block_id) ? item.block_id : "",
      slide_id: slideById.has(item.slide_id) ? item.slide_id : "",
      linked_request_ids: item.request_id ? [item.request_id] : [],
    };
    const result = makeAncillaryResult({
      microscopyId: review.microscopy_id,
      requestId: item.request_id || "",
      requestItemId: item.request_item_id || "",
      stainId: item.id,
      reviewer: doctorName || doctorId || "",
    });

    update((current) => {
      const withLink = (target) => ({
        ...target,
        linked_stain_ids: Array.from(new Set([...(target.linked_stain_ids || []), item.id])),
      });
      return {
        ...current,
        reviews: existing
          ? current.reviews.map((entry) => (entry.microscopy_id === review.microscopy_id ? withLink(entry) : entry))
          : [...current.reviews, withLink(review)],
        ancillary_results: [...current.ancillary_results, result],
      };
    });
    setActiveReviewId(review.microscopy_id);
    setActiveResultId(result.result_id);
    setExpandedResultId("");
    setResultTranscript("");
    setNotice(`${item.target || item.modality} added to the ${cycle} review for interpretation.`);
    focusSection(returnedWorkRef);
  };

  const createFollowUpRequest = (result) => {
    const review = reviews.find((item) => item.microscopy_id === result.microscopy_id);
    if (!review) {
      setNotice("Link this result to a review cycle before creating follow-up work.");
      return;
    }
    const sourceRequest = requests.find((item) => item.request_id === result.request_id);
    const request = {
      ...makeAncillaryRequest(review, doctorName || doctorId || ""),
      request_type: sourceRequest?.request_type || requestTypeForModality(resultModality(result)),
      diagnostic_question: result.interpretability_note || review.diagnostic_question || "",
      source_specimen_id: sourceRequest?.source_specimen_id || review.specimen_id || "",
      preferred_block_id: sourceRequest?.preferred_block_id || review.block_id || "",
      requested_items: [{
        ...makeRequestItem(resultTargetLabel(result)),
        purpose: "Repeat or alternative work after an uninterpretable result",
      }],
    };
    update((current) => ({
      ...current,
      ancillary_requests: [...current.ancillary_requests, request],
      reviews: current.reviews.map((item) => (item.microscopy_id === review.microscopy_id
        ? { ...item, linked_request_ids: Array.from(new Set([...(item.linked_request_ids || []), request.request_id])) }
        : item)),
      ancillary_results: current.ancillary_results.map((item) => (item.result_id === result.result_id
        ? { ...item, repeat_or_additional_work_required: "Yes", follow_up_request_id: request.request_id }
        : item)),
    }));
    setActiveRequestId(request.request_id);
    setNotice("Follow-up request created and linked to the uninterpretable result.");
    focusSection(requestsRef);
  };

  const removeResult = (resultId) => {
    update((current) => ({
      ...current,
      ancillary_results: current.ancillary_results.filter((result) => result.result_id !== resultId),
    }));
    if (activeResultId === resultId) setActiveResultId("");
  };

  // ─── Dictation ────────────────────────────────────────────────────────────
  const startRecording = async (target) => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      mediaRecorderRef.current = new MediaRecorder(stream);
      audioChunksRef.current = [];
      mediaRecorderRef.current.ondataavailable = (event) => {
        if (event.data.size > 0) audioChunksRef.current.push(event.data);
      };
      mediaRecorderRef.current.start();
      setRecordingTarget(target);
    } catch (error) {
      console.error("[MicroscopyTab] microphone:", error);
      setNotice("Microphone access is unavailable.");
    }
  };

  const stopRecording = () => {
    const target = recordingTarget;
    if (!mediaRecorderRef.current || !target) return;
    mediaRecorderRef.current.onstop = async () => {
      setRecordingTarget("");
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
        if (!text) return;
        const append = (current) => (current ? `${current} ${text}` : text);
        if (target === "result") setResultTranscript(append);
        else setReviewTranscript(append);
      } catch (error) {
        console.error("[MicroscopyTab] transcription:", error);
        setNotice("Microscopy dictation transcription failed.");
      } finally {
        setIsTranscribing(false);
      }
    };
    mediaRecorderRef.current.stop();
    mediaRecorderRef.current.stream.getTracks().forEach((track) => track.stop());
  };

  // Extraction fills fields the pathologist left empty. It never overwrites a
  // recorded value, never writes identity or lineage, and remains a suggestion.
  const autofillReview = async () => {
    if (!activeReview || !reviewTranscript.trim()) return;
    setAutofillTarget("review");
    setNotice("");
    try {
      const response = await structureMicroscopy(reviewTranscript, "morphology", {
        review_cycle: activeReview.review_cycle,
      });
      if (response.status !== "success" || !response.data) throw new Error("No structured data returned");
      const structuredAt = new Date().toISOString();
      const report = mergeReport(activeReview, mergeMicroscopyExtraction(activeReview, response.data), response.data);
      update((current) => ({
        ...current,
        reviews: current.reviews.map((review) => (review.microscopy_id === activeReview.microscopy_id
          ? {
            ...mergeMicroscopyExtraction(review, response.data),
            dictation: {
              transcript: reviewTranscript,
              structured_at: structuredAt,
              review_status: "Applied to empty fields; requires pathologist confirmation",
              reviewed_by: doctorName || doctorId || "",
              reviewed_at: structuredAt,
            },
          }
          : review)),
      }));
      setNotice(autofillNotice("morphology", report, response.failed_groups));
    } catch (error) {
      console.error("[MicroscopyTab] morphology structuring:", error);
      setNotice("Microscopy dictation structuring failed.");
    } finally {
      setAutofillTarget("");
    }
  };

  const autofillResult = async () => {
    if (!activeResult || !resultTranscript.trim()) return;
    const modality = resultModality(activeResult);
    setAutofillTarget("result");
    setNotice("");
    try {
      const response = await structureMicroscopy(resultTranscript, "marker", {
        modality,
        target: resultTargetLabel(activeResult),
      });
      if (response.status !== "success" || !response.data) throw new Error("No structured data returned");
      const report = mergeReport(
        activeResult,
        mergeAncillaryResultExtraction(activeResult, response.data, modality),
        response.data,
      );
      update((current) => ({
        ...current,
        ancillary_results: current.ancillary_results.map((result) => (
          result.result_id === activeResult.result_id
            ? mergeAncillaryResultExtraction(result, response.data, modality)
            : result
        )),
      }));
      setNotice(autofillNotice("observation", report, response.failed_groups));
    } catch (error) {
      console.error("[MicroscopyTab] marker structuring:", error);
      setNotice("Marker dictation structuring failed.");
    } finally {
      setAutofillTarget("");
    }
  };

  // ─── AI assistant, validation, save ───────────────────────────────────────
  const latestRun = microscopy.recommendation_runs?.length
    ? microscopy.recommendation_runs[microscopy.recommendation_runs.length - 1]
    : null;

  // The deterministic clinical posture — treatment state, radiotherapy field
  // relationship, imaging on record. Derived server-side in Python from the
  // patient's own records, never by the model, and shown whether or not the
  // assistant has been run: the treatment context is useful on its own.
  const [posture, setPosture] = useState(null);
  useEffect(() => {
    if (!caseId) return;
    let cancelled = false;
    getClinicalPosture(caseId)
      .then((response) => {
        if (!cancelled && response?.data) setPosture(response.data);
      })
      // Silent: an unavailable posture must never block microscopy work. The
      // advisory run reports the gap in its own warnings.
      .catch(() => {});
    return () => { cancelled = true; };
  }, [caseId]);

  // The open review cycle is passed as the focus so the summary and the next
  // steps are written about the cycle being dictated, with the rest of the case
  // as background. The assistant is advisory: it writes nothing into the form.
  const handleGenerate = async () => {
    if (!caseId) return;
    setIsGenerating(true);
    setNotice("");
    try {
      const response = await recommendMicroscopy(
        caseId,
        microscopy,
        activeReviewId,
        activeReview?.review_cycle || "",
      );
      if (response.status !== "success" || !response.data) throw new Error("No recommendations returned");
      update((current) => ({
        ...current,
        recommendation_runs: [...(current.recommendation_runs || []), response.data].slice(-20),
      }));
      setLastRecommendationFocusId(activeReviewId);
      setNotice("AI assistant reviewed the recorded findings. Every suggestion needs your confirmation.");
    } catch (error) {
      console.error("[MicroscopyTab] recommendations:", error);
      setNotice("AI assistant review failed.");
    } finally {
      setIsGenerating(false);
    }
  };

  const reviewSuggestion = (suggestionId, status) => {
    const reviewedAt = new Date().toISOString();
    const reviewer = doctorName || doctorId || "";
    update((current) => ({
      ...current,
      recommendation_runs: (current.recommendation_runs || []).map((run) => {
        const next = { ...run };
        ALL_SUGGESTION_GROUPS.forEach(([key]) => {
          next[key] = (run[key] || []).map((item) => (item.suggestion_id === suggestionId
            ? { ...item, review_status: status, reviewed_by: reviewer, reviewed_at: reviewedAt }
            : item));
        });
        const hasUnreviewed = ALL_SUGGESTION_GROUPS.some(([key]) => (next[key] || [])
          .some((item) => (item.review_status || "Suggested") === "Suggested"));
        next.review_status = hasUnreviewed ? "Requires clinician review" : "Reviewed";
        return next;
      }),
    }));
  };

  const handleValidate = () => {
    setValidationResults(validateMicroscopyCompleteness(microscopy, sources));
    setValidationOpen(true);
  };

  const handleSave = async () => {
    setIsSaving(true);
    setNotice("");
    try {
      await onSave("microscopy", microscopy);
      setNotice("Microscopy saved successfully.");
    } catch (error) {
      console.error("[MicroscopyTab] save:", error);
      setNotice("Microscopy save failed.");
    } finally {
      setIsSaving(false);
    }
  };

  // ─── Derived counts (software, never hand-entered) ─────────────────────────
  const openRequests = requests.filter((request) => isRequestOpen(request, requestContext));
  const interpretedCount = results.filter(resultOutcomeRecorded).length;
  const busy = isSaving || isGenerating || !!autofillTarget || isTranscribing || !!recordingTarget;
  const recording = !!recordingTarget;

  if (specimens.length === 0) {
    return (
      <Box sx={{ border: `1px solid ${C.border}`, background: C.bgSecondary, p: 3, fontFamily: FONT }}>
        <Typography sx={{ fontFamily: FONT, fontSize: 14, fontWeight: FW_NORMAL, mb: 0.5 }}>
          No accessioned specimen on this case.
        </Typography>
        <Typography sx={{ fontFamily: FONT, fontSize: 12, color: C.textMuted }}>
          Register the specimen in Case Registry, then work through Grossing, Processing, Sectioning and Staining
          before microscopy.
        </Typography>
      </Box>
    );
  }

  // ─── Renderers ────────────────────────────────────────────────────────────
  const renderReviewForm = (review) => {
    const set = (key) => (value) => updateReview(review.microscopy_id, key, value);
    const isPostAncillary = review.review_cycle !== "Initial H&E" && review.review_cycle !== "Deeper levels";
    const reviewResults = results.filter((result) => result.microscopy_id === review.microscopy_id);

    return (
      <>
        <RecordSection title="Slide and Adequacy">
          <FG cols={3}>
            <Sel label="Review Cycle" options={REVIEW_CYCLE_OPTIONS} value={review.review_cycle} onChange={set("review_cycle")} />
            <Sel label="Slide Quality" options={SLIDE_QUALITY_OPTIONS} value={review.slide_quality} onChange={set("slide_quality")} />
            <Sel label="Diagnostic Adequacy" options={ADEQUACY_OPTIONS} value={review.diagnostic_adequacy} onChange={set("diagnostic_adequacy")} />
          </FG>
          <FG cols={3}>
            <SourceValue label="Specimen" value={specimenLabel(review.specimen_id)} />
            <SourceValue label="Block" value={blockLabel(review.block_id)} />
            <SourceValue label="Slide" value={review.slide_id ? slideLabel(review.slide_id) : "Panel-level review"} />
          </FG>
        </RecordSection>

        <RecordSection title="Morphology">
          <FG cols={3}>
            <Sel label="Tumor Present" options={TUMOR_PRESENT_OPTIONS} value={review.tumor_present} onChange={set("tumor_present")} />
            <Sel label="Malignancy Assessment" options={MALIGNANCY_OPTIONS} value={review.malignancy_assessment} onChange={set("malignancy_assessment")} />
            <LineField label="Microscopic Tumor Size" value={review.microscopic_tumor_size} onChange={set("microscopic_tumor_size")} />
          </FG>
          <FG cols={2}>
            <TextArea label="Histologic Diagnosis" value={review.histologic_diagnosis} onChange={set("histologic_diagnosis")} />
            <TextArea label="Architecture / Growth Pattern" value={review.architecture} onChange={set("architecture")} />
          </FG>
          <FG cols={3}>
            <LineField label="WHO Type" value={review.who_type} onChange={set("who_type")} />
            <LineField label="WHO Subtype" value={review.who_subtype} onChange={set("who_subtype")} />
            <LineField label="Classification / Version" value={review.classification_version} onChange={set("classification_version")} />
            <Sel label="Grading System" options={GRADE_SYSTEM_OPTIONS} value={review.grading_system} onChange={set("grading_system")} />
            <LineField label="Histologic Grade" value={review.histologic_grade} onChange={set("histologic_grade")} />
            <LineField label="Mitotic Count" value={review.mitotic_count} onChange={set("mitotic_count")} placeholder="e.g. 12 per 2 mm²" />
          </FG>
          <FG cols={3}>
            <LineField label="Mitotic Counting Method" value={review.mitotic_method} onChange={set("mitotic_method")} />
            <LineField label="Necrosis Percent" value={review.necrosis_percent} onChange={set("necrosis_percent")} type="number" />
            <LineField label="TIL Percent" value={review.til_percent} onChange={set("til_percent")} type="number" />
          </FG>
          <FG cols={3}>
            <TextArea label="Cellular Features" value={review.cellular_features} onChange={set("cellular_features")} />
            <TextArea label="Nuclear Features" value={review.nuclear_features} onChange={set("nuclear_features")} />
            <TextArea label="Cytoplasmic Features" value={review.cytoplasmic_features} onChange={set("cytoplasmic_features")} />
          </FG>
          <FG cols={2}>
            <TextArea label="Depth / Extent of Invasion" value={review.invasion_extent} onChange={set("invasion_extent")} />
            <TextArea label="Necrosis Description" value={review.necrosis} onChange={set("necrosis")} />
          </FG>
        </RecordSection>

        <RecordSection title="Spread, Margins and Response">
          <FG cols={4}>
            <Sel label="Margin Status" options={MARGIN_STATUS_OPTIONS} value={review.margin_status} onChange={set("margin_status")} />
            <LineField label="Margin Distance" value={review.margin_distance} onChange={set("margin_distance")} />
            <Sel label="Lymphovascular Invasion" options={YES_NO_OPTIONS} value={review.lymphovascular_invasion} onChange={set("lymphovascular_invasion")} />
            <Sel label="Perineural Invasion" options={YES_NO_OPTIONS} value={review.perineural_invasion} onChange={set("perineural_invasion")} />
          </FG>
          <FG cols={4}>
            <LineField label="Lymph Nodes Examined" value={review.lymph_nodes_examined} onChange={set("lymph_nodes_examined")} type="number" />
            <LineField label="Lymph Nodes Positive" value={review.lymph_nodes_positive} onChange={set("lymph_nodes_positive")} type="number" />
            <LineField label="Largest Nodal Metastasis" value={review.largest_nodal_metastasis} onChange={set("largest_nodal_metastasis")} />
            <Sel label="Extranodal Extension" options={YES_NO_OPTIONS} value={review.extranodal_extension} onChange={set("extranodal_extension")} />
          </FG>
          <FG cols={3}>
            <TextArea label="Background / Adjacent Tissue" value={review.background_findings} onChange={set("background_findings")} />
            <TextArea label="Treatment Effect / Regression" value={review.treatment_effect} onChange={set("treatment_effect")} />
            <TextArea label="Organ-Specific Findings" value={review.organ_specific_findings} onChange={set("organ_specific_findings")} />
          </FG>
        </RecordSection>

        <RecordSection title="Working Diagnosis and Diagnostic Question">
          <FG cols={2}>
            <TextArea label="Morphology-Only Working Diagnosis" value={review.morphology_working_diagnosis} onChange={set("morphology_working_diagnosis")} />
            <TextArea label="Working Classification" value={review.working_classification} onChange={set("working_classification")} />
          </FG>
          <FG cols={3}>
            <LineField label="Suspected Lineage" value={review.suspected_lineage} onChange={set("suspected_lineage")} />
            <TextArea label="Differential Diagnosis" value={review.differential_diagnosis} onChange={set("differential_diagnosis")} />
            <TextArea label="Primary Diagnosis" value={review.primary_diagnosis} onChange={set("primary_diagnosis")} />
          </FG>
          <FG cols={2}>
            <TextArea label="Supporting Morphology" value={review.supporting_morphology} onChange={set("supporting_morphology")} />
            <TextArea label="Opposing Morphology" value={review.opposing_morphology} onChange={set("opposing_morphology")} />
          </FG>
          <TextArea
            label="Diagnostic Question for Additional Work"
            value={review.diagnostic_question}
            onChange={set("diagnostic_question")}
            placeholder="What the next levels, stains, IHC or molecular test must resolve"
          />
        </RecordSection>

        {(isPostAncillary || reviewResults.length > 0) && (
          <RecordSection title="Panel Interpretation">
            <FG cols={3}>
              <Sel label="Supports Working Diagnosis" options={SUPPORTS_OPTIONS} value={review.supports_working_diagnosis} onChange={set("supports_working_diagnosis")} />
              <Sel label="Morphology-Ancillary Concordance" options={DISCORDANCE_OPTIONS} value={review.discordance_status} onChange={set("discordance_status")} />
              <SourceValue
                label="Markers Interpreted in This Cycle"
                value={`${reviewResults.filter(resultOutcomeRecorded).length} of ${reviewResults.length}`}
              />
            </FG>
            <TextArea
              label="Panel Interpretation"
              value={review.panel_interpretation}
              onChange={set("panel_interpretation")}
              placeholder="What the panel as a whole shows — the marker-by-marker detail is recorded below"
              rows={3}
            />
            <TextArea label="Discordance Explanation and Resolution" value={review.discordance_explanation} onChange={set("discordance_explanation")} />
          </RecordSection>
        )}

        <RecordSection title="Correlation and Prior Pathology">
          <FG cols={2}>
            <TextArea label="Gross-Microscopy Concordance" value={review.gross_microscopy_concordance} onChange={set("gross_microscopy_concordance")} />
            <TextArea label="Imaging-Pathology Concordance" value={review.imaging_pathology_concordance} onChange={set("imaging_pathology_concordance")} />
          </FG>
          <FG cols={3}>
            <LineField label="Matched Previous Case / Report" value={review.prior_case_reference} onChange={set("prior_case_reference")} />
            <Sel label="Prior-Current Comparison" options={COMPARISON_STATUS_OPTIONS} value={review.comparison_status} onChange={set("comparison_status")} />
            <TextArea label="Comparison Explanation" value={review.comparison_explanation} onChange={set("comparison_explanation")} />
          </FG>
        </RecordSection>

        <RecordSection title="Report Status and Sign-off">
          <FG cols={3}>
            <Sel label="Report Status" options={REPORT_STATUS_OPTIONS} value={review.report_status} onChange={set("report_status")} />
            <Sel label="Diagnostic-Loop Status" options={DIAGNOSTIC_LOOP_STATUS_OPTIONS} value={review.diagnostic_loop_status} onChange={set("diagnostic_loop_status")} />
            <LineField label="Reporting Pathologist" value={review.reporting_pathologist} onChange={set("reporting_pathologist")} />
          </FG>
          <FG cols={3}>
            <LineField label="Reviewed By" value={review.reviewed_by} onChange={set("reviewed_by")} />
            <LineField label="Review Date and Time" value={review.review_datetime} onChange={set("review_datetime")} type="datetime-local" />
            <Sel label="Second Opinion Requested" options={YES_NO_OPTIONS} value={review.second_opinion_requested} onChange={set("second_opinion_requested")} />
          </FG>
          <FG cols={3}>
            <LineField label="Second Opinion Institution" value={review.second_opinion_institution} onChange={set("second_opinion_institution")} />
            <Sel label="Second Opinion Status" options={SECOND_OPINION_STATUS_OPTIONS} value={review.second_opinion_status} onChange={set("second_opinion_status")} />
            <Sel
              label="Previous Review in the Loop"
              options={[{ value: "", label: "— Not linked —" }, ...reviews
                .filter((item) => item.microscopy_id !== review.microscopy_id)
                .map((item) => ({ value: item.microscopy_id, label: `${item.review_cycle} · ${shortId(item.microscopy_id)}` }))]}
              value={review.previous_review_id}
              onChange={set("previous_review_id")}
            />
          </FG>
          <FG cols={2}>
            <TextArea label="Slide Annotations" value={review.annotations} onChange={set("annotations")} />
            <TextArea label="Comments" value={review.comments} onChange={set("comments")} />
          </FG>
        </RecordSection>
      </>
    );
  };

  const renderResultForm = (result) => {
    const modality = resultModality(result);
    const stain = stainById.get(result.stain_id) || null;
    const set = (key) => (value) => updateResult(result.result_id, key, value);
    const controlAcceptable = stain ? stain.control_accepted : true;
    const isNotInterpretable = result.interpretability === "Not interpretable";
    const showDetailedFields = expandedResultId === result.result_id;
    const linkedReview = reviews.find((review) => review.microscopy_id === result.microscopy_id);
    const handleInterpretabilityChange = (value) => {
      if (value !== "Not interpretable") {
        patchResult(result.result_id, { interpretability: value });
        return;
      }
      patchResult(result.result_id, {
        interpretability: value,
        pattern: "",
        localization: "",
        intensity: "",
        percent_positive: "",
        scoring_system: "Not applicable",
        scoring_system_version: "",
        score: "",
        interpretation: "",
        result_description: "",
        diagnostic_contribution: "",
        repeat_or_additional_work_required: "",
        follow_up_request_id: "",
      });
      setExpandedResultId("");
    };

    return (
      <Box sx={{ border: `1px solid ${C.border}`, p: 2, mt: 1.5, background: C.white }}>
        <ItemHeader
          title={`${resultTargetLabel(result)} — pathologist interpretation`}
          subtitle={`${result.result_id} | stain ${result.stain_id}`}
          onRemove={() => removeResult(result.result_id)}
          removeTitle="Remove interpretation"
        />
        {linkedReview && !isAncillaryMode && (
          <Box sx={{ display: "flex", justifyContent: "flex-end", mb: 1.5 }}>
            <Button
              sx={{ ...outlineBtnSx, px: 2, py: 0.5 }}
              onClick={() => { setActiveReviewId(linkedReview.microscopy_id); focusSection(reviewWorkspaceRef); }}
            >
              Continue to {linkedReview.review_cycle} review
            </Button>
          </Box>
        )}

        <SubHeading>Laboratory Record (Read-Only)</SubHeading>
        {stain ? (
          <>
            <FG cols={4}>
              <SourceValue label="Sub-Workflow" value={stain.modality} />
              <SourceValue label="Target Applied" value={stain.target} />
              <SourceValue label="Technical Control" value={stain.control_result} />
              <SourceValue label="Technical Quality" value={stain.quality_result} />
            </FG>
            <FG cols={4}>
              <SourceValue label="Clone / Probe" value={stain.clone || stain.probe_kit} />
              <SourceValue label="Lot" value={stain.lot} />
              <SourceValue label="Platform" value={stain.platform_id} />
              <SourceValue label="Returned by Lab" value={stain.returned_to_microscopy} />
            </FG>
            {modality === "FISH" && (
              <FG cols={4}>
                <SourceValue label="Cells Counted (Lab)" value={stain.cells_counted} />
                <SourceValue label="Signal Ratio (Lab)" value={stain.signal_ratio} />
                <SourceValue label="Copy Number (Lab)" value={stain.copy_number} />
                <SourceValue label="Technical Signal Quality" value={stain.signal_quality} />
              </FG>
            )}
          </>
        ) : (
          <FlagNote>
            The staining record this interpretation refers to no longer exists. Remove the interpretation, or restore the
            stain in Staining.
          </FlagNote>
        )}
        <FlagNote>
          These values belong to the laboratory record and are shown for context only. They are edited in Staining,
          never here.
        </FlagNote>

        <SubHeading>Interpretability</SubHeading>
        <FG cols={3}>
          <Sel label="Control Accepted for Interpretation" options={YES_NO_OPTIONS} value={result.control_accepted_for_interpretation} onChange={set("control_accepted_for_interpretation")} />
          <Sel label="Slide / Result Interpretable" options={INTERPRETABILITY_OPTIONS} value={result.interpretability} onChange={handleInterpretabilityChange} />
          <Sel
            label="Recorded in Review Cycle"
            options={[{ value: "", label: "— Not linked —" }, ...reviews.map((item) => ({
              value: item.microscopy_id,
              label: `${item.review_cycle} · ${shortId(item.microscopy_id)}`,
            }))]}
            value={result.microscopy_id}
            onChange={set("microscopy_id")}
          />
        </FG>
        <TextArea
          label={isNotInterpretable ? "Why This Result Is Not Interpretable" : "Interpretability Note"}
          value={result.interpretability_note}
          onChange={set("interpretability_note")}
          placeholder={isNotInterpretable
            ? "Record the control, tissue, artefact or quality problem that prevents a reliable call"
            : "Optional: background, artefact or internal-control issue that affects the reading"}
        />
        {!controlAcceptable && (
          <FlagNote>
            The laboratory control for this stain has not passed. A technically invalid run must not be scored — request
            a repeat or restain instead.
          </FlagNote>
        )}
        {controlAcceptable && result.control_accepted_for_interpretation === "No" && (
          <FlagNote>
            The run passed technically but you have not accepted it for interpretation. Record the reason and request
            repeat or alternative work below.
          </FlagNote>
        )}

        {isNotInterpretable ? (
          <Box sx={{ border: `1px solid ${C.border}`, background: C.bgSecondary, p: 2, mt: 1.5 }}>
            <Typography sx={{ fontFamily: FONT, fontSize: 12, fontWeight: FW_NORMAL, mb: 1 }}>
              No marker call or score should be recorded for an uninterpretable result.
            </Typography>
            <FG cols={2}>
              <Sel
                label="Repeat or Alternative Work Required"
                options={YES_NO_OPTIONS}
                value={result.repeat_or_additional_work_required}
                onChange={(value) => patchResult(result.result_id, {
                  repeat_or_additional_work_required: value,
                  follow_up_request_id: value === "Yes" ? result.follow_up_request_id : "",
                })}
              />
              <LineField label="Review Date and Time" value={result.review_datetime} onChange={set("review_datetime")} type="datetime-local" />
            </FG>
            {result.repeat_or_additional_work_required === "Yes" && (
              <>
                <Sel
                  label="Follow-Up Request"
                  options={[{ value: "", label: "— Not linked —" }, ...requests.map((request) => ({
                    value: request.request_id,
                    label: `${request.request_type} · ${shortId(request.request_id)}`,
                  }))]}
                  value={result.follow_up_request_id}
                  onChange={set("follow_up_request_id")}
                />
                {!result.follow_up_request_id && (
                  <Button sx={{ ...outlineBtnSx, px: 2, py: 0.5, mt: 1.5 }} onClick={() => createFollowUpRequest(result)}>
                    <ScienceRounded sx={{ mr: 0.75, fontSize: 16 }} />Create and link follow-up request
                  </Button>
                )}
              </>
            )}
            {result.repeat_or_additional_work_required === "No" && (
              <TextArea
                label="Why No Further Work Can Be Performed"
                value={result.comments}
                onChange={set("comments")}
                placeholder="For example: tissue exhausted, no alternative block, or the diagnosis can proceed without this result"
              />
            )}
            <FG cols={2}>
              <LineField label="Reviewed By" value={result.reviewed_by} onChange={set("reviewed_by")} />
              <SourceValue label="Outcome" value="Not interpretable — no diagnostic call recorded" />
            </FG>
          </Box>
        ) : result.interpretability === "Interpretable" ? (
          <>
            <SubHeading>Pathologist Call</SubHeading>
            <FG cols={2}>
              <Sel
                label="Interpretation"
                options={interpretationOptionsFor(modality)}
                value={result.interpretation}
                onChange={set("interpretation")}
              />
              <LineField label="Review Date and Time" value={result.review_datetime} onChange={set("review_datetime")} type="datetime-local" />
            </FG>
            <TextArea
              label="Diagnostic Contribution"
              value={result.diagnostic_contribution}
              onChange={set("diagnostic_contribution")}
              placeholder="How this result changes the differential or supports the diagnosis"
            />
            <Button
              sx={{ ...outlineBtnSx, px: 2, py: 0.5, mb: 1.5 }}
              onClick={() => setExpandedResultId(showDetailedFields ? "" : result.result_id)}
            >
              {showDetailedFields ? "Hide detailed observation and scoring" : "Add detailed observation or scoring"}
            </Button>
          </>
        ) : (
          <FlagNote>Select whether the returned slide or result is interpretable before recording a call.</FlagNote>
        )}

        {!isNotInterpretable && result.interpretability === "Interpretable" && showDetailedFields && modality === "IHC" && (
          <>
            <SubHeading>Observation and Score</SubHeading>
            <FG cols={3}>
              <Sel label="Pattern" options={IHC_PATTERN_OPTIONS} value={result.pattern} onChange={set("pattern")} />
              <LineField label="Localization" value={result.localization} onChange={set("localization")} placeholder="e.g. tumour cells, stroma, internal control" />
              <Sel label="Intensity" options={IHC_INTENSITY_OPTIONS} value={result.intensity} onChange={set("intensity")} />
              <LineField label="Percent Positive Cells" value={result.percent_positive} onChange={set("percent_positive")} placeholder="0-100" />
              <Sel label="Scoring System" options={IHC_SCORING_SYSTEM_OPTIONS} value={result.scoring_system} onChange={set("scoring_system")} />
              <LineField label="Scoring System Version" value={result.scoring_system_version} onChange={set("scoring_system_version")} placeholder="Approved local guideline version" />
            </FG>
            <LineField label="Score" value={result.score} onChange={set("score")} placeholder="Score on the system named above" />
            {result.scoring_system && result.scoring_system !== "Not applicable" && !result.scoring_system_version && (
              <FlagNote>
                A scoring system is named with no guideline version. The score cannot be reproduced without it —
                thresholds are institution-approved and are never derived by the software.
              </FlagNote>
            )}
          </>
        )}

        {!isNotInterpretable && result.interpretability === "Interpretable" && showDetailedFields && modality === "Special stain" && (
          <>
            <SubHeading>Observation</SubHeading>
            <FG cols={2}>
              <LineField label="Localization" value={result.localization} onChange={set("localization")} />
              <Sel label="Pattern" options={IHC_PATTERN_OPTIONS} value={result.pattern} onChange={set("pattern")} />
            </FG>
            <TextArea label="Descriptive Result" value={result.result_description} onChange={set("result_description")} />
          </>
        )}

        {!isNotInterpretable && result.interpretability === "Interpretable" && showDetailedFields && modality === "FISH" && (
          <>
            <SubHeading>Reviewed Signal Data and Call</SubHeading>
            <FG cols={2}>
              <LineField label="Criteria / Version Applied" value={result.scoring_system_version} onChange={set("scoring_system_version")} placeholder="e.g. ASCO/CAP HER2 FISH criteria, edition" />
              <LineField label="Reviewed Ratio / Copy Number" value={result.score} onChange={set("score")} placeholder="The value you accepted after review" />
            </FG>
            <TextArea label="Signal Review Note" value={result.result_description} onChange={set("result_description")} />
          </>
        )}

        {!isNotInterpretable && result.interpretability === "Interpretable" && showDetailedFields && (
          <FG cols={2}>
            <LineField label="Previous Result Reference" value={result.previous_result_ref} onChange={set("previous_result_ref")} placeholder="Prior accession or report reference" />
            <Sel label="Comparison" options={RESULT_COMPARISON_OPTIONS} value={result.comparison} onChange={set("comparison")} />
          </FG>
        )}
        {!isNotInterpretable && result.interpretability === "Interpretable" && (
          <>
            <SubHeading>Follow-Up and Sign-Off</SubHeading>
            <FG cols={3}>
              <Sel label="Repeat or Additional Work Required" options={YES_NO_OPTIONS} value={result.repeat_or_additional_work_required} onChange={set("repeat_or_additional_work_required")} />
              <Sel
                label="Follow-Up Request"
                options={[{ value: "", label: "— Not linked —" }, ...requests.map((request) => ({
                  value: request.request_id,
                  label: `${request.request_type} · ${shortId(request.request_id)}`,
                }))]}
                value={result.follow_up_request_id}
                onChange={set("follow_up_request_id")}
              />
              <LineField label="Reviewed By" value={result.reviewed_by} onChange={set("reviewed_by")} />
            </FG>
            <TextArea label="Comments" value={result.comments} onChange={set("comments")} />
          </>
        )}

        {!isNotInterpretable && result.interpretability === "Interpretable" && showDetailedFields && (
          <>
            <SubHeading>Marker Dictation</SubHeading>
            <TextArea label="Transcript" value={resultTranscript} onChange={setResultTranscript} rows={2} />
            <Box sx={{ display: "flex", gap: 1.5, mt: 1.5, flexWrap: "wrap" }}>
          <Button
            sx={{
              ...outlineBtnSx,
              px: 2,
              background: recordingTarget === "result" ? "#cf1322" : C.white,
              color: recordingTarget === "result" ? C.white : C.black,
              borderColor: recordingTarget === "result" ? "#cf1322" : C.black,
              "&:hover": { background: recordingTarget === "result" ? "#a8071a" : C.bgTertiary },
            }}
            onClick={recordingTarget === "result" ? stopRecording : () => startRecording("result")}
            disabled={isTranscribing || !!autofillTarget || (recording && recordingTarget !== "result")}
          >
            {recordingTarget === "result" ? <StopRounded sx={{ mr: 0.75, fontSize: 16 }} /> : <MicRounded sx={{ mr: 0.75, fontSize: 16 }} />}
            {isTranscribing ? "Processing..." : recordingTarget === "result" ? "Stop" : "Dictate Observation"}
          </Button>
          <Button sx={{ ...outlineBtnSx, px: 2 }} onClick={autofillResult} disabled={busy || !resultTranscript.trim()}>
            {autofillTarget === "result"
              ? <CircularProgress size={14} sx={{ mr: 1, color: C.black }} />
              : <AutoAwesomeRounded sx={{ mr: 0.75, fontSize: 16 }} />}
            AI Autofill Empty Fields
          </Button>
            </Box>
          </>
        )}
      </Box>
    );
  };

  return (
    <Box sx={{ fontFamily: FONT }}>
      <Box sx={{ display: "flex", justifyContent: "space-between", alignItems: "center", mb: 2, flexWrap: "wrap", gap: 1 }}>
        <Box>
          <Typography sx={{ fontFamily: FONT, fontSize: 21, fontWeight: FW_LIGHT }}>
            {isAncillaryMode ? "Ancillary Work" : isReviewMode ? "Microscopy Review" : "Primary Microscopy"}
          </Typography>
          <Typography sx={{ fontFamily: FONT, fontSize: 12, color: C.textMuted }}>
            {isAncillaryMode
              ? "Track additional-work requests, laboratory progress and results returned for interpretation"
              : isReviewMode
              ? "Review returned ancillary work, correlate findings and complete the diagnostic loop"
              : "Initial H&E morphology review, working diagnosis and additional-work requests"}
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
            {isAncillaryMode ? "Save Ancillary Work" : isReviewMode ? "Save Microscopy Review" : "Save Primary Microscopy"}
          </Button>
        </Box>
      </Box>
      {notice && (
        <Box sx={{ border: `1px solid ${C.border}`, background: C.bgSecondary, p: 1.5, mb: 2.5 }}>
          <Typography sx={{ fontFamily: FONT, fontSize: 12, color: C.textSecond }}>{notice}</Typography>
        </Box>
      )}

      {/* ─── Case material: pick the physical item to review ─────────────── */}
      <SectionBox title="Case Material" style={{ display: isReviewMode || isAncillaryMode ? "none" : undefined }}>
        <FG cols={6}>
          <SourceValue label="Specimens" value={String(specimens.length)} />
          <SourceValue label="Blocks" value={String(blocks.length)} />
          <SourceValue label="Slides" value={String(slides.length)} />
          <SourceValue label="Review Cycles" value={String(reviews.length)} />
          <SourceValue label="Open Requests" value={String(openRequests.length)} />
          <SourceValue label="Awaiting Interpretation" value={String(pendingWork.length)} />
        </FG>

        <FieldLabel>Specimens</FieldLabel>
        <PathologyTable
          rowId={(row) => row.specimen_id}
          selectedId={selectedSpecimenId}
          onSelect={(id) => {
            setSelectedSpecimenId(id === selectedSpecimenId ? "" : id);
            setSelectedBlockId("");
            setSelectedSlideId("");
          }}
          rows={specimens}
          columns={[
            { key: "part_label", label: "Part", width: "0.5fr" },
            { key: "specimen_type", label: "Specimen Type", width: "1.2fr" },
            { key: "anatomic_site", label: "Site", width: "1.2fr", render: (row) => [row.anatomic_site, row.sub_site].filter(Boolean).join(" / ") },
            { key: "laterality", label: "Laterality", width: "0.8fr", muted: true },
            { key: "blocks", label: "Blocks", width: "0.5fr", align: "right", muted: true, render: (row) => String(blocks.filter((block) => block.specimen_id === row.specimen_id).length) },
            { key: "slides", label: "Slides", width: "0.5fr", align: "right", muted: true, render: (row) => String(slides.filter((slide) => slide.specimen_id === row.specimen_id).length) },
            { key: "reviews", label: "Reviews", width: "0.6fr", align: "right", muted: true, render: (row) => String(reviews.filter((review) => review.specimen_id === row.specimen_id).length) },
          ]}
          emptyMessage="No accessioned specimen."
        />

        {selectedSpecimenId && (
          <Box sx={{ mt: 2 }}>
            <FieldLabel>Blocks (selected specimen)</FieldLabel>
            <PathologyTable
              rowId={(row) => row.block_id}
              selectedId={selectedBlockId}
              onSelect={(id) => { setSelectedBlockId(id === selectedBlockId ? "" : id); setSelectedSlideId(""); }}
              rows={visibleBlocks}
              columns={[
                { key: "cassette_label", label: "Cassette", width: "1fr" },
                { key: "block_id", label: "Block", width: "0.8fr", muted: true, render: (row) => shortId(row.block_id) },
                { key: "specimen", label: "Specimen", width: "1.2fr", muted: true, render: (row) => specimenLabel(row.specimen_id) },
                { key: "block_status", label: "Tissue", width: "0.9fr", muted: true, render: (row) => row.block_status || "Not recorded" },
                { key: "slides", label: "Slides", width: "0.5fr", align: "right", muted: true, render: (row) => String(slides.filter((slide) => slide.block_id === row.block_id).length) },
              ]}
              emptyMessage="No block embedded for the selected specimen yet."
              maxHeight={220}
            />
          </Box>
        )}

        {selectedBlockId && (
          <Box sx={{ mt: 2 }}>
            <FieldLabel>Slides (selected block)</FieldLabel>
            <PathologyTable
              rowId={(row) => row.slide_id}
              selectedId={selectedSlideId}
              onSelect={(id) => setSelectedSlideId(id === selectedSlideId ? "" : id)}
              rows={visibleSlides}
              columns={[
                { key: "slide_id", label: "Slide", width: "0.7fr", render: (row) => shortId(row.slide_id) },
                { key: "cassette_label", label: "Cassette", width: "0.9fr", muted: true },
                { key: "level", label: "Level", width: "0.5fr", muted: true },
                { key: "intended_use", label: "Intended Use", width: "1fr", muted: true },
                {
                  key: "stain",
                  label: "Stain Applied",
                  width: "1.2fr",
                  muted: true,
                  render: (row) => {
                    const applied = stains.filter((stain) => stain.slide_id === row.slide_id);
                    if (!applied.length) return "No stain recorded";
                    return applied.map((stain) => `${stain.target || stain.modality} (${stain.status})`).join(", ");
                  },
                },
                {
                  key: "reviewed",
                  label: "Reviewed",
                  width: "0.7fr",
                  align: "right",
                  muted: true,
                  render: (row) => {
                    const count = reviews.filter((review) => review.slide_id === row.slide_id).length;
                    return count ? `${count}×` : "No";
                  },
                },
              ]}
              emptyMessage="No slide cut from the selected block yet. Record the cut in Sectioning first."
              maxHeight={260}
            />
          </Box>
        )}

        <Box sx={{ display: "flex", gap: 1.5, mt: 2, flexWrap: "wrap" }}>
          <Button sx={outlineBtnSx} onClick={startSlideReview} disabled={!selectedSlideId}>
            <AddRounded sx={{ mr: 0.75, fontSize: 16 }} />Start review on selected slide
          </Button>
        </Box>
        <FlagNote>
          Pick the physical item from the inventory above; the review is then recorded against that specimen, block and
          slide by reference. Counts, stain state and tissue status are read from Sectioning and Staining, not entered here.
        </FlagNote>
      </SectionBox>

      {/* ─── Review workspace ───────────────────────────────────────────── */}
      <SectionBox
        title={isReviewMode ? "Post-Ancillary Review Workspace" : "Primary Review Workspace"}
        style={{ display: isAncillaryMode ? "none" : undefined }}
      >
        <Box ref={reviewWorkspaceRef}>
        <FieldLabel>Review Cycles Recorded</FieldLabel>
        <PathologyTable
          rowId={(row) => row.microscopy_id}
          selectedId={activeReviewId}
          onSelect={(id) => { setActiveReviewId(id === activeReviewId ? "" : id); setReviewTranscript(""); }}
          rows={visibleReviews}
          columns={[
            { key: "review_cycle", label: "Cycle", width: "1fr" },
            { key: "scope", label: "Scope", width: "1.2fr", muted: true, render: (row) => (row.slide_id ? slideLabel(row.slide_id) : "Panel review") },
            { key: "specimen", label: "Specimen", width: "1.2fr", muted: true, render: (row) => specimenLabel(row.specimen_id) },
            { key: "markers", label: "Markers", width: "0.6fr", align: "right", muted: true, render: (row) => String(results.filter((result) => result.microscopy_id === row.microscopy_id).length) },
            { key: "report_status", label: "Report", width: "0.9fr", muted: true },
            { key: "reviewed_by", label: "Reviewer", width: "1fr", muted: true },
            {
              key: "actions",
              label: "",
              width: "0.6fr",
              align: "right",
              render: (row) => (
                <IconButton
                  size="small"
                  title="Remove review cycle"
                  onClick={(event) => { event.stopPropagation(); removeReview(row.microscopy_id); }}
                  sx={{ color: C.textSecond }}
                >
                  <DeleteOutlineRounded fontSize="small" />
                </IconButton>
              ),
            },
          ]}
          emptyMessage={isReviewMode
            ? "No post-ancillary review recorded yet. Interpret returned work below to start one."
            : "No primary review recorded yet. Select a slide above and start the initial H&E review."}
        />

        {activeReview && (
          <Box sx={{ mt: 2.5 }}>
            <Box
              sx={{
                display: "grid",
                gridTemplateColumns: { xs: "1fr", lg: "repeat(2, minmax(0, 1fr))" },
                gap: 2.5,
                alignItems: "stretch",
              }}
            >
              <SlideImageViewer
                title={activeReview.slide_id ? slideLabel(activeReview.slide_id) : "Panel-level review"}
                subtitle={specimenLabel(activeReview.specimen_id)}
                images={activeReview.images || []}
                onAdd={addImage}
                onUpdate={updateImage}
                onRemove={removeImage}
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
                <FieldLabel>Morphology Dictation</FieldLabel>
                <TextField
                  value={reviewTranscript}
                  onChange={(event) => setReviewTranscript(event.target.value)}
                  size="small"
                  fullWidth
                  multiline
                  minRows={22}
                  maxRows={22}
                  placeholder="Describe what you see; the transcript is structured into the empty fields only."
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
                      background: recordingTarget === "review" ? "#cf1322" : C.white,
                      color: recordingTarget === "review" ? C.white : C.black,
                      borderColor: recordingTarget === "review" ? "#cf1322" : C.black,
                      "&:hover": { background: recordingTarget === "review" ? "#a8071a" : C.bgTertiary },
                    }}
                    onClick={recordingTarget === "review" ? stopRecording : () => startRecording("review")}
                    disabled={isTranscribing || !!autofillTarget || (recording && recordingTarget !== "review")}
                  >
                    {recordingTarget === "review" ? <StopRounded sx={{ mr: 0.75, fontSize: 16 }} /> : <MicRounded sx={{ mr: 0.75, fontSize: 16 }} />}
                    {isTranscribing ? "Processing..." : recordingTarget === "review" ? "Stop Recording" : "Start Recording"}
                  </Button>
                  <Button sx={{ ...outlineBtnSx, px: 2 }} onClick={autofillReview} disabled={busy || !reviewTranscript.trim()}>
                    {autofillTarget === "review"
                      ? <CircularProgress size={14} sx={{ mr: 1, color: C.black }} />
                      : <AutoAwesomeRounded sx={{ mr: 0.75, fontSize: 16 }} />}
                    AI Autofill Empty Fields
                  </Button>
                </Box>
                {activeReview.dictation?.structured_at && (
                  <FlagNote>
                    Last structured {activeReview.dictation.structured_at} — {activeReview.dictation.review_status}
                  </FlagNote>
                )}
                <FlagNote>
                  Extraction never overwrites a value you already recorded, and never writes identity, lineage, links or
                  a diagnosis of its own.
                </FlagNote>
              </Box>
            </Box>

            <Box sx={{ mt: 2.5 }}>{renderReviewForm(activeReview)}</Box>

            <Box sx={{ border: `1px solid ${C.border}`, mt: 2.5, p: 2, background: C.bgSecondary }}>
              <Typography sx={{ fontFamily: FONT, fontSize: 12, fontWeight: FW_NORMAL, textTransform: "uppercase", letterSpacing: "0.08em" }}>
                AI Review for This Session
              </Typography>
              <FlagNote>
                The assistant reads this selected review cycle in context. Its output is advisory and never changes a
                diagnosis or laboratory record automatically.
              </FlagNote>
              <Button sx={{ ...outlineBtnSx, px: 2, mt: 1.5 }} onClick={handleGenerate} disabled={busy || !caseId}>
                {isGenerating
                  ? <CircularProgress size={14} sx={{ mr: 1, color: C.black }} />
                  : <LightbulbRounded sx={{ mr: 0.75, fontSize: 16 }} />}
                {assistantButtonLabel}
              </Button>

              {lastRecommendationFocusId === activeReview.microscopy_id && latestRun && (
                <Box sx={{ border: `1px solid ${C.border}`, background: C.bgSecondary, p: 1.5, mt: 2 }}>
                  <FieldLabel>Suggested Tests</FieldLabel>
                  {(latestRun.ancillary_test_suggestions || []).length === 0 ? (
                    <Typography sx={{ fontFamily: FONT, fontSize: 12, color: C.textMuted }}>
                      No additional test was suggested for this review session.
                    </Typography>
                  ) : (
                    latestRun.ancillary_test_suggestions.map((item) => (
                      <SuggestionRow
                        key={item.suggestion_id}
                        item={item}
                        onReview={reviewSuggestion}
                        onAddTest={addSuggestedTest}
                      />
                    ))
                  )}
                </Box>
              )}

              <Box sx={{ display: "flex", justifyContent: "flex-end", mt: 2, pt: 1.5, borderTop: `1px solid ${C.border}` }}>
                <Button sx={saveBtnSx} onClick={handleSave} disabled={busy}>
                  {isSaving
                    ? <CircularProgress size={15} sx={{ mr: 1, color: C.white }} />
                    : <SaveRounded sx={{ mr: 0.75, fontSize: 16 }} />}
                  {isAncillaryMode ? "Save Ancillary Work" : isReviewMode ? "Save Microscopy Review" : "Save Primary Microscopy"}
                </Button>
              </Box>
            </Box>
          </Box>
        )}
        </Box>
      </SectionBox>

      {/* ─── Ancillary requests ─────────────────────────────────────────── */}
      <SectionBox title="Ancillary Requests">
        <Box ref={requestsRef}>
        {!isAncillaryMode && !manualDraft && (
          <Box sx={{ display: "flex", justifyContent: "flex-end", mb: 1.5 }}>
            <Button sx={outlineBtnSx} onClick={openManualRequest}>
              <ScienceRounded sx={{ mr: 0.75, fontSize: 16 }} />Request additional work
            </Button>
          </Box>
        )}

        {!isAncillaryMode && manualDraft && (
          <Box sx={{ border: `1px solid ${C.border}`, p: 2, mb: 2, background: C.white }}>
            <SubHeading>New Request</SubHeading>
            <FG cols={3}>
              <Sel
                label="Type"
                options={REQUEST_TYPE_OPTIONS}
                value={manualDraft.request_type}
                onChange={(value) => setManualDraft((draft) => ({ ...draft, request_type: value }))}
              />
              <LineField
                label="Requested"
                value={manualDraft.requested}
                placeholder="e.g. CD20, HER2, deeper levels"
                onChange={(value) => setManualDraft((draft) => ({ ...draft, requested: value }))}
              />
              <Sel
                label="Priority"
                options={REQUEST_PRIORITY_OPTIONS}
                value={manualDraft.priority}
                onChange={(value) => setManualDraft((draft) => ({ ...draft, priority: value }))}
              />
            </FG>
            <FG cols={2}>
              <Sel
                label="Specimen"
                options={specimens.map((specimen) => ({ value: specimen.specimen_id, label: specimenLabel(specimen.specimen_id) }))}
                value={manualDraft.source_specimen_id}
                onChange={(value) => setManualDraft((draft) => ({ ...draft, source_specimen_id: value, preferred_block_id: "" }))}
              />
              <Sel
                label="Preferred Block"
                options={[
                  { value: "", label: "— Laboratory to choose —" },
                  ...blocks
                    .filter((block) => !manualDraft.source_specimen_id || block.specimen_id === manualDraft.source_specimen_id)
                    .map((block) => ({ value: block.block_id, label: `${blockLabel(block.block_id)}${block.block_status ? ` · ${block.block_status}` : ""}` })),
                ]}
                value={manualDraft.preferred_block_id}
                onChange={(value) => setManualDraft((draft) => ({ ...draft, preferred_block_id: value }))}
              />
            </FG>
            <FlagNote>
              Only the basic request is captured here — status is derived and reads "Requested" until the
              laboratory picks the work up. Diagnostic question, extra requested items, materials and
              cancellation are completed in Ancillary Work.
            </FlagNote>
            <Box sx={{ display: "flex", justifyContent: "flex-end", gap: 1.5, mt: 1.5 }}>
              <Button sx={outlineBtnSx} onClick={cancelManualRequest}>Cancel</Button>
              <Button sx={saveBtnSx} onClick={addManualRequest} disabled={!canAddManualRequest()}>Add request</Button>
            </Box>
          </Box>
        )}
        <PathologyTable
          rowId={(row) => row.request_id}
          selectedId={isAncillaryMode ? activeRequestId : ""}
          onSelect={(id) => {
            if (isAncillaryMode) setActiveRequestId(id === activeRequestId ? "" : id);
          }}
          rows={requests}
          columns={[
            { key: "request_type", label: "Type", width: "0.9fr" },
            { key: "targets", label: "Requested", width: "1.4fr", render: (row) => (row.requested_items || []).map((item) => item.target || "unnamed").join(", ") },
            { key: "specimen", label: "Specimen", width: "1.1fr", muted: true, render: (row) => specimenLabel(row.source_specimen_id) },
            { key: "block", label: "Preferred Block", width: "1fr", muted: true, render: (row) => (row.preferred_block_id ? blockLabel(row.preferred_block_id) : "Not specified") },
            { key: "priority", label: "Priority", width: "0.6fr", muted: true },
            { key: "status", label: "Status", width: "1.4fr", render: (row) => ancillaryRequestStatus(row, requestContext) },
          ]}
          emptyMessage="No ancillary work requested on this case."
        />
        <FlagNote>
          Status is derived from the linked Sectioning, Staining and Molecular records and from your own
          interpretations — it is never typed in, so the same request cannot read differently in two tabs.
        </FlagNote>

        {!isAncillaryMode && (
          <FlagNote>
            A request is added here from an AI-suggested test or manually. Request rows are otherwise
            read-only here — open Ancillary Work to view or edit a request in full.
          </FlagNote>
        )}

        {/* Primary Microscopy and Microscopy Review raise requests from this box,
            so it carries the same section-end save as the other workspaces. */}
        {!isAncillaryMode && (
          <Box sx={{ display: "flex", justifyContent: "flex-end", mt: 2, pt: 1.5, borderTop: `1px solid ${C.border}` }}>
            <Button sx={saveBtnSx} onClick={handleSave} disabled={busy}>
              {isSaving
                ? <CircularProgress size={15} sx={{ mr: 1, color: C.white }} />
                : <SaveRounded sx={{ mr: 0.75, fontSize: 16 }} />}
              {isAncillaryMode ? "Save Ancillary Work" : isReviewMode ? "Save Microscopy Review" : "Save Primary Microscopy"}
            </Button>
          </Box>
        )}

        {activeRequest && isAncillaryMode && (
          <Box sx={{ border: `1px solid ${C.border}`, p: 2, mt: 2, background: C.white }}>
            <ItemHeader
              title={`${activeRequest.request_type} request — ${ancillaryRequestStatus(activeRequest, requestContext)}`}
              subtitle={`${activeRequest.request_id}${activeRequest.originating_microscopy_id ? ` | raised in review ${shortId(activeRequest.originating_microscopy_id)}` : ""}`}
              onRemove={() => removeRequest(activeRequest.request_id)}
              removeTitle="Remove request"
            />

            <FG cols={3}>
              <Sel label="Request Type" options={REQUEST_TYPE_OPTIONS} value={activeRequest.request_type} onChange={(value) => updateRequest(activeRequest.request_id, "request_type", value)} />
              <Sel label="Priority" options={REQUEST_PRIORITY_OPTIONS} value={activeRequest.priority} onChange={(value) => updateRequest(activeRequest.request_id, "priority", value)} />
              {activeRequest.request_type === "Molecular test" && (
                <Sel label="Required Molecular Material" options={[{ value: "", label: "To be decided by Molecular" }, ...MOLECULAR_MATERIAL_OPTIONS.filter((item) => item !== "To be decided by Molecular")]} value={activeRequest.required_material} onChange={(value) => updateRequest(activeRequest.request_id, "required_material", value)} />
              )}
              <Sel
                label="Source Specimen"
                options={specimens.map((specimen) => ({ value: specimen.specimen_id, label: specimenLabel(specimen.specimen_id) }))}
                value={activeRequest.source_specimen_id}
                onChange={(value) => updateRequest(activeRequest.request_id, "source_specimen_id", value)}
              />
            </FG>
            <FG cols={3}>
              <Sel
                label="Preferred Block"
                options={[{ value: "", label: "— Laboratory to choose —" }, ...blocks
                  .filter((block) => !activeRequest.source_specimen_id || block.specimen_id === activeRequest.source_specimen_id)
                  .map((block) => ({ value: block.block_id, label: `${blockLabel(block.block_id)}${block.block_status ? ` · ${block.block_status}` : ""}` }))]}
                value={activeRequest.preferred_block_id}
                onChange={(value) => updateRequest(activeRequest.request_id, "preferred_block_id", value)}
              />
              <Sel
                label="Existing Unstained Slides to Use"
                options={availableSlides
                  .filter((slide) => !activeRequest.preferred_block_id || slide.block_id === activeRequest.preferred_block_id)
                  .map((slide) => ({
                    value: slide.slide_id,
                    label: `${slideLabel(slide.slide_id)}${slide.released ? "" : " (not released)"}`,
                  }))}
                value={activeRequest.preferred_slide_ids || []}
                onChange={(value) => updateRequest(activeRequest.request_id, "preferred_slide_ids", typeof value === "string" ? [value] : value)}
                multiple
                renderValue={(selected) => (selected || []).map((id) => shortId(id)).join(", ")}
              />
              <Sel label="Tissue Availability" options={TISSUE_RESERVATION_OPTIONS} value={activeRequest.tissue_reservation_status} onChange={(value) => updateRequest(activeRequest.request_id, "tissue_reservation_status", value)} />
            </FG>
            <TextArea
              label="Diagnostic Question"
              value={activeRequest.diagnostic_question}
              onChange={(value) => updateRequest(activeRequest.request_id, "diagnostic_question", value)}
              placeholder="What this work must resolve — carried to the laboratory worklist and back with the result"
            />
            {(() => {
              // A fresh cut is only needed when no unstained slide already fits.
              const availability = requestSlideAvailability(activeRequest, requestContext);
              return (
                <>
                  <FG cols={3}>
                    <SourceValue label="Targets Still Unordered" value={String(availability.outstanding)} />
                    <SourceValue label="Spare Unstained Slides That Fit" value={String(availability.spare_count)} />
                    <SourceValue label="New Sections Needed" value={String(availability.sections_needed)} />
                  </FG>
                  <FlagNote>
                    {availability.sections_needed === 0 && availability.outstanding > 0
                      ? "Unstained slides already exist for this request, so Staining can order the stains without another cut."
                      : availability.outstanding === 0
                        ? "Every requested target already has a bench order."
                        : `A stained slide is consumed and cannot take a second stain. ${availability.sections_needed} further section(s) must be cut in Sectioning from the preferred block; the rest can use the spare unstained slides.`}
                  </FlagNote>
                </>
              );
            })()}
            <FG cols={3}>
              <LineField label="Requested By" value={activeRequest.requested_by} onChange={(value) => updateRequest(activeRequest.request_id, "requested_by", value)} />
              <LineField label="Request Date and Time" value={activeRequest.request_datetime} onChange={(value) => updateRequest(activeRequest.request_id, "request_datetime", value)} type="datetime-local" />
              <Sel label="Cancelled" options={YES_NO_OPTIONS} value={activeRequest.cancelled} onChange={(value) => updateRequest(activeRequest.request_id, "cancelled", value)} />
            </FG>
            {activeRequest.cancelled === "Yes" && (
              <LineField label="Cancellation Reason" value={activeRequest.cancel_reason} onChange={(value) => updateRequest(activeRequest.request_id, "cancel_reason", value)} />
            )}

            <SubHeading>Requested Items</SubHeading>
            {(activeRequest.requested_items || []).map((item, index) => (
              <Box key={item.request_item_id} sx={{ display: "grid", gridTemplateColumns: "1fr 2fr auto", gap: 2, alignItems: "end", mb: 1.5 }}>
                <LineField
                  label={`${index + 1}. Target`}
                  value={item.target}
                  onChange={(value) => updateRequestItem(activeRequest.request_id, item.request_item_id, "target", value)}
                  placeholder="Marker, stain, probe or test"
                />
                <LineField
                  label="Purpose"
                  value={item.purpose}
                  onChange={(value) => updateRequestItem(activeRequest.request_id, item.request_item_id, "purpose", value)}
                  placeholder="What it is meant to demonstrate"
                />
                <IconButton
                  size="small"
                  title="Remove item"
                  onClick={() => removeRequestItem(activeRequest.request_id, item.request_item_id)}
                  sx={{ color: C.textSecond, mb: 0.5 }}
                >
                  <DeleteOutlineRounded fontSize="small" />
                </IconButton>
              </Box>
            ))}
            <Button sx={{ ...outlineBtnSx, px: 2, py: 0.5 }} onClick={() => addRequestItem(activeRequest.request_id)}>
              <AddRounded sx={{ mr: 0.5, fontSize: 15 }} />Add requested item
            </Button>

            <SubHeading>Linked Laboratory Work</SubHeading>
            <FG cols={3}>
              <SourceValue
                label="Sectioning Events"
                value={String(sectioningEvents.filter((event) => event.request_id === activeRequest.request_id).length)}
              />
              <SourceValue
                label="Stain Orders"
                value={String(stains.filter((stain) => stain.request_id === activeRequest.request_id).length)}
              />
              <SourceValue
                label="Molecular Orders"
                value={String(molecularOrders.filter((order) => order.request_id === activeRequest.request_id).length)}
              />
            </FG>
            <TextArea label="Resolution Note" value={activeRequest.resolution_note} onChange={(value) => updateRequest(activeRequest.request_id, "resolution_note", value)} />
          </Box>
        )}
        </Box>
      </SectionBox>

      {/* ─── Returned work and its interpretation ───────────────────────── */}
      <SectionBox
        title={isAncillaryMode ? "Returned Ancillary Work Queue" : "Completed Ancillary Work and Interpretation"}
        style={{ display: isReviewMode || isAncillaryMode ? undefined : "none" }}
      >
        <Box ref={returnedWorkRef}>
        <FieldLabel>Awaiting Pathologist Interpretation</FieldLabel>
        <PathologyTable
          rowId={(row) => row.id}
          rows={pendingWork}
          columns={[
            { key: "modality", label: "Work", width: "0.9fr" },
            { key: "target", label: "Target", width: "1.2fr" },
            { key: "slide", label: "Slide / Block", width: "1.1fr", muted: true, render: (row) => (row.slide_id ? slideLabel(row.slide_id) : blockLabel(row.block_id)) },
            { key: "control", label: "Technical Control", width: "1fr", muted: true, render: (row) => row.control_result || "Not recorded" },
            { key: "returned", label: "Returned by Lab", width: "0.9fr", muted: true, render: (row) => (row.returned ? "Yes" : "No") },
            {
              key: "actions",
              label: "",
              width: "0.9fr",
              align: "right",
              render: (row) => <RowButton onClick={() => interpretWork(row)}>Interpret</RowButton>,
            },
          ]}
          emptyMessage="No completed staining work is waiting for interpretation."
        />
        <FlagNote>
          The laboratory records the technical run and returns it; the pattern, percentage, score and the final call are
          recorded here. A technically passing control does not oblige you to accept the slide as interpretable.
          Special stains, IHC and FISH/ISH are read here. Molecular results are not — they have no slide, are
          interpreted in Molecular, and reach the diagnosis through the Integrated Diagnosis tab.
        </FlagNote>

        <Box sx={{ mt: 2.5 }}>
          <FieldLabel>Interpretations Recorded</FieldLabel>
          <PathologyTable
            rowId={(row) => row.result_id}
            selectedId={activeResultId}
            onSelect={(id, row) => {
              const nextId = id === activeResultId ? "" : id;
              setActiveResultId(nextId);
              if (nextId && row.microscopy_id) setActiveReviewId(row.microscopy_id);
              setResultTranscript("");
            }}
            rows={results}
            columns={[
              { key: "target", label: "Target", width: "1fr", render: (row) => resultTargetLabel(row) },
              { key: "modality", label: "Work", width: "0.8fr", muted: true, render: (row) => resultModality(row) || "—" },
              { key: "cycle", label: "Review Cycle", width: "1fr", muted: true, render: (row) => reviews.find((review) => review.microscopy_id === row.microscopy_id)?.review_cycle || "Unlinked" },
              { key: "interpretation", label: "Outcome", width: "1fr", render: (row) => row.interpretability === "Not interpretable" ? "Not interpretable" : row.interpretation },
              { key: "score", label: "Score", width: "0.7fr", muted: true, render: (row) => [row.intensity, row.percent_positive && `${row.percent_positive}%`, row.score].filter(Boolean).join(" · ") },
              { key: "reviewed_by", label: "Reviewer", width: "0.9fr", muted: true },
            ]}
            emptyMessage="No marker interpretation recorded yet."
          />
          <FG cols={3}>
            <SourceValue label="Interpretations Recorded" value={String(results.length)} />
            <SourceValue label="Outcomes Recorded" value={String(interpretedCount)} />
            <SourceValue label="Repeat Requested" value={String(results.filter((result) => result.repeat_or_additional_work_required === "Yes").length)} />
          </FG>
        </Box>

        {activeResult && renderResultForm(activeResult)}

        <Box sx={{ display: "flex", justifyContent: "flex-end", mt: 2, pt: 1.5, borderTop: `1px solid ${C.border}` }}>
          <Button sx={saveBtnSx} onClick={handleSave} disabled={busy}>
            {isSaving
              ? <CircularProgress size={15} sx={{ mr: 1, color: C.white }} />
              : <SaveRounded sx={{ mr: 0.75, fontSize: 16 }} />}
            {isAncillaryMode ? "Save Ancillary Work" : isReviewMode ? "Save Microscopy Review" : "Save Primary Microscopy"}
          </Button>
        </Box>
        </Box>
      </SectionBox>

      {/* The integrated diagnosis is NOT recorded here. Synthesising morphology,
          ancillary work, molecular results and cytology into one diagnosis is not
          microscope work, so it has its own Integrated Diagnosis tab. */}
      {isReviewMode && openRequests.length > 0 && (
        <SectionBox title="Open Ancillary Work">
          <FlagNote>
            {openRequests.length} ancillary request(s) are still open:{" "}
            {openRequests.map((request) => `${request.request_type} (${ancillaryRequestStatus(request, requestContext)})`).join("; ")}.
            Resolve them, or name them as pending in the Integrated Diagnosis tab before the report is signed.
          </FlagNote>
        </SectionBox>
      )}

      {/* ─── AI diagnostic assistant ────────────────────────────────────── */}
      <SectionBox title="AI Diagnostic Assistant" style={{ display: isAncillaryMode ? "none" : undefined }}>
        <Box ref={assistantRef}>
        <Box sx={{ display: "flex", alignItems: "center", gap: 1, mb: 1 }}>
          <LightbulbRounded sx={{ fontSize: 18, color: C.black }} />
          <Typography sx={{ fontFamily: FONT, fontSize: 12, color: C.textSecond }}>
            Clinician-reviewed advisory output
          </Typography>
        </Box>
        <FlagNote>
          The assistant reads only what you have recorded. It summarises the findings, says whether they support the
          diagnosis you have stated, and suggests the next work. It does not populate a field, score an image, decide
          whether a diagnosis is correct, or sign out a case.
        </FlagNote>

        {/* Shown independently of any assistant run: the treatment context is
            worth seeing on its own, and it makes the assistant's reasoning
            inspectable rather than opaque. */}
        <Box sx={{ mt: 2 }}>
          <ClinicalPosturePanel posture={posture} caseId={caseId} onRefreshed={setPosture} />
        </Box>

        {!latestRun && (
          <Typography sx={{ fontFamily: FONT, fontSize: 13, color: C.textMuted, mt: 2 }}>
            No assistant review yet. Open a review cycle and use the cycle-specific AI review action within that session.
          </Typography>
        )}
        {latestRun && (
          <>
            <Box sx={{ border: `1px solid ${C.border}`, background: C.bgSecondary, p: 1.5, my: 2 }}>
              <Typography sx={{ fontFamily: FONT, fontSize: 11, color: C.textMuted }}>
                Engine {latestRun.engine_version || ""} | {latestRun.review_status || "Requires clinician review"}
                {latestRun.generated_at ? ` | Generated ${latestRun.generated_at}` : ""}
              </Typography>
              {latestRun.assistant_mode && (
                <Typography sx={{ fontFamily: FONT, fontSize: 11, color: C.textSecond, mt: 0.5 }}>
                  Mode {latestRun.assistant_mode.replaceAll("_", " ")}
                </Typography>
              )}
              {(latestRun.source_families || []).map((source) => (
                <Typography key={source} sx={{ fontFamily: FONT, fontSize: 11, color: C.textSecond, mt: 0.5 }}>
                  {source}
                </Typography>
              ))}
              {latestRun.source_version_status && (
                <Typography sx={{ fontFamily: FONT, fontSize: 11, color: C.textMuted, mt: 0.75 }}>
                  {latestRun.source_version_status}
                </Typography>
              )}
            </Box>

            {/* Narrative output — read-only, so no accept or dismiss. */}
            {latestRun.case_summary && (
              <Box sx={{ mb: 2 }}>
                <FieldLabel>Case Summary</FieldLabel>
                <Typography sx={{ fontFamily: FONT, fontSize: 13, color: C.textPrimary, lineHeight: 1.7, mt: 0.5 }}>
                  {latestRun.case_summary}
                </Typography>
              </Box>
            )}

            <PlainList label="Major Findings Recorded" items={latestRun.major_findings} />

            {latestRun.diagnostic_assessment?.coherence && (
              <Box sx={{ border: `1px solid ${C.borderStrong}`, p: 1.75, mb: 2 }}>
                <FieldLabel>Do The Recorded Findings Support The Stated Diagnosis?</FieldLabel>
                <Typography sx={{ fontFamily: FONT, fontSize: 15, fontWeight: FW_NORMAL, mt: 0.5 }}>
                  {latestRun.diagnostic_assessment.coherence}
                </Typography>
                {latestRun.diagnostic_assessment.explanation && (
                  <Typography sx={{ fontFamily: FONT, fontSize: 13, color: C.textSecond, lineHeight: 1.7, mt: 1 }}>
                    {latestRun.diagnostic_assessment.explanation}
                  </Typography>
                )}
                <Box sx={{ mt: 1.5 }}>
                  <PlainList label="Not Currently Backed By Anything Recorded" items={latestRun.diagnostic_assessment.unsupported_elements} />
                  <PlainList label="Needed To Confirm" items={latestRun.diagnostic_assessment.needed_for_confirmation} />
                </Box>
              </Box>
            )}

            {/* Spread and treatment effect. Both read-only: derived from what you
                recorded, with the treatment-effect requirement itself coming from
                the deterministic posture rather than from the model. */}
            {latestRun.spread_assessment && (
              <Box sx={{ border: `1px solid ${C.border}`, p: 1.75, mb: 2 }}>
                <FieldLabel>What The Recorded Findings Establish About Spread</FieldLabel>
                <Box sx={{ display: "flex", flexWrap: "wrap", gap: 3, mt: 0.75 }}>
                  {[
                    ["Local extent", latestRun.spread_assessment.local_extent_recorded],
                    ["Regional spread", latestRun.spread_assessment.regional_spread_recorded],
                    ["Distant spread", latestRun.spread_assessment.distant_spread_recorded],
                    ["Versus expected pattern", latestRun.spread_assessment.consistency_with_expected_pattern],
                  ].map(([label, value]) => (
                    <Box key={label}>
                      <Typography sx={{ fontFamily: FONT, fontSize: 10, letterSpacing: "0.08em", textTransform: "uppercase", color: C.textMuted }}>
                        {label}
                      </Typography>
                      <Typography sx={{ fontFamily: FONT, fontSize: 13, mt: 0.25 }}>{value || "Cannot assess"}</Typography>
                    </Box>
                  ))}
                </Box>
                {latestRun.spread_assessment.explanation && (
                  <Typography sx={{ fontFamily: FONT, fontSize: 13, color: C.textSecond, lineHeight: 1.7, mt: 1 }}>
                    {latestRun.spread_assessment.explanation}
                  </Typography>
                )}
              </Box>
            )}

            {latestRun.treatment_effect_assessment?.required && (
              <Box sx={{ border: `1px solid ${C.borderStrong}`, p: 1.75, mb: 2 }}>
                <FieldLabel>Treatment Effect Must Be Reported</FieldLabel>
                <Typography sx={{ fontFamily: FONT, fontSize: 13, color: C.textSecond, mt: 0.5 }}>
                  This patient received therapy before this specimen was taken, so treatment effect is a required
                  reporting element{latestRun.treatment_effect_assessment.staging_prefix_expected
                    ? ` and the "${latestRun.treatment_effect_assessment.staging_prefix_expected}" staging prefix applies`
                    : ""}. Currently {(latestRun.treatment_effect_assessment.recorded_by_pathologist || "Cannot assess").toLowerCase()}.
                </Typography>
                {latestRun.treatment_effect_assessment.grading_framework && (
                  <Typography sx={{ fontFamily: FONT, fontSize: 11, color: C.textMuted, mt: 0.75 }}>
                    Framework: {latestRun.treatment_effect_assessment.grading_framework}
                  </Typography>
                )}
                {latestRun.treatment_effect_assessment.explanation && (
                  <Typography sx={{ fontFamily: FONT, fontSize: 13, color: C.textSecond, lineHeight: 1.7, mt: 1 }}>
                    {latestRun.treatment_effect_assessment.explanation}
                  </Typography>
                )}
                <PlainList label="Not Yet Addressed" items={latestRun.treatment_effect_assessment.unaddressed_elements} />
              </Box>
            )}

            {/* Reviewable suggestions. */}
            {SUGGESTION_GROUPS.map(([key, heading]) => {
              const items = latestRun[key] || [];
              if (!items.length) return null;
              return (
                <Box key={key} sx={{ mb: 2 }}>
                  <FieldLabel>{heading}</FieldLabel>
                  {items.map((item) => (
                    <SuggestionRow key={item.suggestion_id} item={item} onReview={reviewSuggestion} />
                  ))}
                </Box>
              );
            })}

            <PlainList label="Information The Assistant Was Missing" items={latestRun.missing_information} />
            {(latestRun.warnings || []).map((warning, index) => (
              <FlagNote key={`warning-${index}`}>{warning}</FlagNote>
            ))}
          </>
        )}
        </Box>
      </SectionBox>

      <CapValidationDialog
        open={validationOpen}
        onClose={() => setValidationOpen(false)}
        results={validationResults}
        title="Microscopy Validation"
      />
    </Box>
  );
}
