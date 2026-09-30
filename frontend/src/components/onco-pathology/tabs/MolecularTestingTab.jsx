import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  Autocomplete,
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
  CloseRounded,
  DeleteOutlineRounded,
  FactCheckRounded,
  LightbulbRounded,
  MicRounded,
  SaveRounded,
  StopRounded,
} from "@mui/icons-material";
import {
  C,
  FONT,
  FW_LIGHT,
  FW_NORMAL,
  inputSx,
  outlineBtnSx,
  saveBtnSx,
  sectionHeaderSx,
} from "../../shared/designTokens";
import { FG, FieldLabel, FlagNote, SectionBox, Sel } from "../../shared/FormComponents";
import { MOLECULAR_GENE_GROUP, MOLECULAR_GENES } from "../constants";
import ClinicalPosturePanel from "../ClinicalPosturePanel";
import { getClinicalPosture, recommendMolecular, structureMolecular } from "../shared/api";
import {
  CONSENT_OPTIONS,
  DISSECTION_OPTIONS,
  EXPRESSION_RISK_OPTIONS,
  GERMLINE_CONFIRMATION_OPTIONS,
  HRD_STATUS_OPTIONS,
  METHYLATION_STATUS_OPTIONS,
  MOLECULAR_STATUS_OPTIONS,
  MOLECULAR_MATERIAL_OPTIONS,
  MOLECULAR_TEST_TYPE_OPTIONS,
  MSI_RESULT_OPTIONS,
  NUCLEIC_ACID_INPUT_OPTIONS,
  PERFORMING_LAB_OPTIONS,
  PRIORITY_OPTIONS,
  RESULT_COMPARISON_OPTIONS,
  SAMPLE_CLASS_OPTIONS,
  SAMPLE_QC_OPTIONS,
  TECHNICAL_QC_OPTIONS,
  TISSUE_ADEQUACY_OPTIONS,
  VARIANT_ORIGIN_OPTIONS,
  VARIANT_TYPE_OPTIONS,
  YES_NO_OPTIONS,
  makeMolecularOrder,
  makeMolecularOrderFromRequest,
  makeVariant,
  materialSampleClass,
  mergeMolecularExtraction,
  mergeMolecularReport,
  molecularResultReviewEligibility,
  molecularBlocks,
  molecularSectioningOutputs,
  molecularSlides,
  openMolecularRequests,
  stainingFishRecords,
  syncMolecular,
} from "../shared/molecularModel";
import { mmrAncillaryResults } from "../shared/microscopyModel";
import { validateMolecularCompleteness } from "../shared/capValidation";
import CapValidationDialog from "../CapValidationDialog";
import PathologyTable from "../PathologyTable";

const readOnlyValue = (value) => value || "Not recorded";

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

const LineField = ({ label, value, onChange, placeholder, type = "text" }) => (
  <Box>
    <FieldLabel>{label}</FieldLabel>
    <TextField
      type={type}
      value={value || ""}
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

// The gene field writes the same comma-separated string `genes_tested` has always
// held. The vocabulary in ../constants.js is a reference list for finding a gene
// quickly, never a constraint: anything typed that is not on it is kept as typed,
// because a laboratory's panel changes faster than any list shipped in code. The
// menu is grouped for browsing but filters across every group at once, so a gene
// filed under one organ system is still found when ordering for another.
const GENE_OPTIONS = MOLECULAR_GENES.map((entry) => entry.gene);

// Split on both separators: the picker writes comma-separated, but a dictated
// value comes back from the extraction model as whatever it chose — "EGFR; ALK"
// is a real output — and a value split on only one of them reads as a single
// chip with the count understating the panel. Joining always re-normalises to
// commas, so the stored string converges on one form.
const parseGenes = (value) => [...new Set(
  String(value || "").split(/[,;]/).map((gene) => gene.trim()).filter(Boolean)
)];

const GenePicker = ({ value, onChange }) => {
  const genes = parseGenes(value);
  return (
    <Box sx={{ gridColumn: "span 2" }}>
      <FieldLabel>Genes / Targets Tested</FieldLabel>
      <Autocomplete
        multiple
        freeSolo
        options={GENE_OPTIONS}
        groupBy={(gene) => MOLECULAR_GENE_GROUP[gene] || "Other / off-list"}
        value={genes}
        onChange={(_event, next) => onChange(next.map((gene) => String(gene).trim()).filter(Boolean).join(", "))}
        renderInput={(params) => (
          <TextField {...params} size="small" placeholder="Pick from the reference list, or type any gene / target" sx={inputSx} />
        )}
      />
      {genes.length > 0 && (
        <Typography sx={{ fontFamily: FONT, fontSize: 10.5, color: C.textMuted, mt: 0.5 }}>
          {genes.length} gene{genes.length === 1 ? "" : "s"} / target{genes.length === 1 ? "" : "s"} recorded
        </Typography>
      )}
    </Box>
  );
};

const SourceValue = ({ label, value }) => (
  <Box>
    <FieldLabel>{label}</FieldLabel>
    <TextField value={readOnlyValue(value)} size="small" fullWidth InputProps={{ readOnly: true }} sx={inputSx} />
  </Box>
);

const ItemHeader = ({ title, subtitle, onRemove }) => (
  <Box sx={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 1, mb: 1.5 }}>
    <Box>
      <Typography sx={{ fontFamily: FONT, fontSize: 13, fontWeight: FW_NORMAL }}>{title}</Typography>
      {subtitle && <Typography sx={{ fontFamily: FONT, fontSize: 11, color: C.textMuted }}>{subtitle}</Typography>}
    </Box>
    {onRemove && (
      <IconButton size="small" onClick={onRemove} title={`Remove ${title}`} sx={{ color: C.textSecond }}>
        <DeleteOutlineRounded fontSize="small" />
      </IconButton>
    )}
  </Box>
);

// A bordered sub-card with an uppercase header bar. Each molecular order's field
// groups render as these cards so the order reads as a stack of clear sections —
// the same visual as MicroscopyTab's RecordSection. Presentational only.
const OrderSection = ({ title, children }) => (
  <Box sx={{ border: `1px solid ${C.border}`, mb: 2, background: C.white }}>
    <Box sx={sectionHeaderSx}>{title}</Box>
    <Box sx={{ p: 2.5 }}>{children}</Box>
  </Box>
);

const SuggestionRow = ({ title, reason, source, confidence, status, onAccept, onDismiss }) => (
  <Box sx={{ borderTop: `1px solid ${C.border}`, py: 1.5, "&:first-of-type": { borderTop: 0 } }}>
    <Box sx={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 2, flexWrap: "wrap" }}>
      <Box sx={{ minWidth: 0, flex: 1 }}>
        <Typography sx={{ fontFamily: FONT, fontSize: 13, fontWeight: FW_NORMAL }}>{title}</Typography>
        {reason && <Typography sx={{ fontFamily: FONT, fontSize: 12, color: C.textSecond, mt: 0.5 }}>{reason}</Typography>}
        <Typography sx={{ fontFamily: FONT, fontSize: 11, color: C.textMuted, mt: 0.75 }}>
          {source || "Source not supplied"} | Confidence: {confidence || "Moderate"}
        </Typography>
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
  ["interpretation_suggestions", "Interpretation Suggestions"],
  ["reflex_suggestions", "Reflex / Confirmatory Testing"],
  // Only populated when the clinical posture records an actual prior exposure —
  // a resistance alteration after targeted therapy, or therapy-related change
  // after cytotoxic or radiation treatment.
  ["therapy_related_suggestions", "Prior-Therapy Considerations"],
  ["discordance_suggestions", "Morphology / IHC / Molecular Discordance"],
  ["germline_suggestions", "Germline Follow-up"],
  ["reporting_suggestions", "Reporting Suggestions"],
];
const LEGACY_SUGGESTION_GROUPS = [
  ["test_suggestions", "Molecular Test Suggestions"],
  ["sample_suggestions", "Sample Selection Suggestions"],
  ["adequacy_warnings", "Adequacy and QC Warnings"],
  ...SUGGESTION_GROUPS,
];
const REVIEWABLE_GROUP_KEYS = [...new Set(LEGACY_SUGGESTION_GROUPS.map(([key]) => key))];

export default function MolecularTestingTab({
  caseId,
  initialData,
  processing,
  sectioning,
  staining,
  microscopy,
  grossing,
  doctorId,
  doctorName,
  onSave,
}) {
  const blocks = useMemo(() => molecularBlocks(processing, sectioning, grossing), [processing, sectioning, grossing]);
  const slides = useMemo(() => molecularSlides(sectioning, grossing), [sectioning, grossing]);
  const sectioningOutputs = useMemo(() => molecularSectioningOutputs(sectioning), [sectioning]);
  // MMR is read from the assembled projection: antibody work from Staining,
  // retained / lost call from the pathologist in Microscopy. Never stored here.
  const mmrRows = useMemo(() => mmrAncillaryResults(staining, microscopy), [staining, microscopy]);
  const fishRecords = useMemo(() => stainingFishRecords(staining), [staining]);
  const [molecular, setMolecular] = useState(() => syncMolecular(initialData));
  const [selectedSampleClass, setSelectedSampleClass] = useState("");
  const [selectedBlockId, setSelectedBlockId] = useState("");
  const [selectedSlideId, setSelectedSlideId] = useState("");
  const [notice, setNotice] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const [validationOpen, setValidationOpen] = useState(false);
  const [validationResults, setValidationResults] = useState([]);
  const [focusedOrderId, setFocusedOrderId] = useState("");
  // Dictation → transcribe → structure → autofill, held per order (mirroring the
  // review transcripts in MicroscopyTab and the record transcripts in
  // CytopathologyTab). One microphone and one structure run at a time, but each
  // order card keeps its own editable transcript.
  const mediaRecorderRef = useRef(null);
  const audioChunksRef = useRef([]);
  const [transcripts, setTranscripts] = useState({});
  const [recordingOrderId, setRecordingOrderId] = useState("");
  const [autofillOrderId, setAutofillOrderId] = useState("");
  const [isTranscribing, setIsTranscribing] = useState(false);
  // Deterministic clinical posture. Prior systemic therapy changes how a variant
  // reads — resistance alterations, therapy-related change — so the exposure is
  // established from the patient record rather than inferred by the model.
  const [posture, setPosture] = useState(null);

  useEffect(() => {
    setMolecular(syncMolecular(initialData));
    setSelectedSampleClass("");
    setSelectedBlockId("");
    setSelectedSlideId("");
    setFocusedOrderId("");
    setTranscripts({});
    setRecordingOrderId("");
    setAutofillOrderId("");
    setIsTranscribing(false);
    setNotice("");
  }, [caseId]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!caseId) return;
    let cancelled = false;
    getClinicalPosture(caseId)
      .then((response) => { if (!cancelled && response?.data) setPosture(response.data); })
      .catch(() => {}); // Never block molecular work on an unavailable posture.
    return () => { cancelled = true; };
  }, [caseId]);

  const update = (fn) => setMolecular((current) => fn(current));
  const orders = molecular.orders;
  // Pathologist requests for molecular work with no order yet. Owned by
  // Microscopy and read-only here.
  const openRequests = useMemo(() => openMolecularRequests(microscopy, molecular), [microscopy, molecular]);
  const legacyRuns = (molecular.recommendation_runs || []).filter((run) => !run.focus_test_order_id);

  const sampleOptions = [
    { value: "", label: "— Select sample —" },
    ...blocks.map((block) => ({ value: `block:${block.block_id}`, label: `Block ${block.block_id}${block.cassette_label ? ` (${block.cassette_label})` : ""}` })),
    ...slides.map((slide) => ({ value: `slide:${slide.slide_id}`, label: `Slide ${String(slide.slide_id).slice(-8)}${slide.level ? ` (${slide.level})` : ""}` })),
  ];

  const addOrder = () => {
    if (!selectedSampleClass) {
      setNotice("Choose the sample type before adding a molecular test order.");
      return;
    }
    const order = makeMolecularOrder(doctorName || doctorId || "");
    order.sample_class = selectedSampleClass;
    if (selectedBlockId) order.sample_block_id = selectedBlockId;
    if (selectedSlideId) order.sample_slide_id = selectedSlideId;
    setNotice("");
    update((current) => ({ ...current, orders: [...current.orders, order] }));
  };

  // One click from the pathologist's request to the test order: the diagnostic
  // question, priority, preferred block and the request link come across.
  const addOrderFromRequest = (request) => {
    setNotice("");
    update((current) => ({
      ...current,
      orders: [...current.orders, makeMolecularOrderFromRequest(request, doctorName || doctorId || "")],
    }));
  };

  const updateOrder = (orderId, key, value) => update((current) => ({
    ...current,
    orders: current.orders.map((order) => (order.test_order_id === orderId ? { ...order, [key]: value } : order)),
  }));

  const updateVariant = (orderId, variantId, key, value) => update((current) => ({
    ...current,
    orders: current.orders.map((order) => order.test_order_id !== orderId ? order : {
      ...order,
      variants: (order.variants || []).map((variant) => variant.variant_id === variantId ? { ...variant, [key]: value } : variant),
    }),
  }));

  const addVariant = (orderId) => update((current) => ({
    ...current,
    orders: current.orders.map((order) => order.test_order_id === orderId
      ? { ...order, variants: [...(order.variants || []), makeVariant()] }
      : order),
  }));

  const removeVariant = (orderId, variantId) => update((current) => ({
    ...current,
    orders: current.orders.map((order) => order.test_order_id === orderId
      ? { ...order, variants: (order.variants || []).filter((variant) => variant.variant_id !== variantId) }
      : order),
  }));

  const removeOrder = (orderId) => {
    update((current) => ({
      ...current,
      orders: current.orders.filter((order) => order.test_order_id !== orderId),
    }));
    // Drop the order's transcript and any in-flight work with it.
    setTranscripts((prev) => { const next = { ...prev }; delete next[orderId]; return next; });
    if (recordingOrderId === orderId) {
      try {
        mediaRecorderRef.current?.stop?.();
        mediaRecorderRef.current?.stream?.getTracks().forEach((track) => track.stop());
      } catch (error) { /* best effort */ }
      setRecordingOrderId("");
    }
    if (autofillOrderId === orderId) setAutofillOrderId("");
  };

  // ─── Dictation ────────────────────────────────────────────────────────────
  // Per order card: the pathologist dictates the order's read, and "AI Autofill
  // Empty Fields" structures the transcript into the order's empty fields.
  // Mirrors the MicroscopyTab / CytopathologyTab handlers one order at a time.
  const startRecording = async (order) => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      mediaRecorderRef.current = new MediaRecorder(stream);
      audioChunksRef.current = [];
      mediaRecorderRef.current.ondataavailable = (event) => {
        if (event.data.size > 0) audioChunksRef.current.push(event.data);
      };
      mediaRecorderRef.current.start();
      setRecordingOrderId(order.test_order_id);
    } catch (error) {
      console.error("[MolecularTestingTab] microphone:", error);
      setNotice("Microphone access is unavailable.");
    }
  };

  const stopRecording = () => {
    if (!mediaRecorderRef.current || !recordingOrderId) return;
    const orderId = recordingOrderId;
    mediaRecorderRef.current.onstop = async () => {
      setRecordingOrderId("");
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
        if (text) setTranscripts((prev) => ({ ...prev, [orderId]: [prev[orderId], text].filter(Boolean).join(" ") }));
      } catch (error) {
        console.error("[MolecularTestingTab] transcription:", error);
        setNotice("Molecular dictation transcription failed.");
      } finally {
        setIsTranscribing(false);
      }
    };
    mediaRecorderRef.current.stop();
    mediaRecorderRef.current.stream.getTracks().forEach((track) => track.stop());
  };

  // Extraction fills fields the pathologist left empty. It never overwrites a
  // recorded value, never writes identity or lineage, and remains a suggestion.
  // Variant rows are minted only when the order has none recorded yet.
  const autofillOrder = async (order) => {
    const orderId = order.test_order_id;
    const transcript = transcripts[orderId] || "";
    if (!transcript.trim()) return;
    setAutofillOrderId(orderId);
    setNotice("");
    try {
      const response = await structureMolecular(transcript, {
        test_type: order.test_type || "",
        platform: order.platform || "",
        panel_name: order.panel_name || "",
      });
      if (response.status !== "success" || !response.data) throw new Error("No structured data returned");
      const structuredAt = new Date().toISOString();
      const before = order;
      const after = mergeMolecularExtraction(before, response.data);
      const report = mergeMolecularReport(before, after, response.data);
      update((current) => ({
        ...current,
        orders: current.orders.map((entry) => (entry.test_order_id === orderId
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
      setNotice(autofillNotice("molecular order", report, response.failed_groups));
    } catch (error) {
      console.error("[MolecularTestingTab] dictation structuring:", error);
      setNotice("Molecular dictation structuring failed.");
    } finally {
      setAutofillOrderId("");
    }
  };

  const handleGenerate = async (orderId) => {
    if (!caseId || !orderId) return;
    const order = orders.find((item) => item.test_order_id === orderId);
    const eligibility = molecularResultReviewEligibility(order);
    if (!eligibility.eligible) {
      setNotice(eligibility.reason);
      return;
    }
    setFocusedOrderId(orderId);
    setIsGenerating(true);
    setNotice("");
    try {
      const response = await recommendMolecular(caseId, orderId, molecular);
      if (response.status !== "success" || !response.data) throw new Error("No recommendations returned");
      update((current) => ({ ...current, recommendation_runs: [...(current.recommendation_runs || []), response.data].slice(-20) }));
      setNotice("Molecular result review generated for clinician review.");
    } catch (error) {
      console.error("[MolecularTestingTab] recommendations:", error);
      setNotice("Molecular result review generation failed; the order was not changed.");
    } finally {
      setIsGenerating(false);
    }
  };

  const reviewSuggestion = (runId, collectionKey, suggestionId, decision) => {
    const reviewedAt = new Date().toISOString();
    const reviewer = doctorName || doctorId || "";
    update((current) => {
      const runs = current.recommendation_runs || [];
      const run = runs.find((item) => item.recommendation_run_id === runId);
      if (!run) return current;
      const nextRuns = runs.map((runItem) => {
        if (runItem.recommendation_run_id !== runId) return runItem;
        const nextCollection = (runItem[collectionKey] || []).map((item) => item.suggestion_id === suggestionId
          ? { ...item, review_status: decision, reviewed_by: reviewer, reviewed_at: reviewedAt }
          : item);
        const hasUnreviewed = REVIEWABLE_GROUP_KEYS.some((key) => {
          const items = key === collectionKey ? nextCollection : (runItem[key] || []);
          return items.some((item) => item.review_status === "Suggested");
        });
        return { ...runItem, [collectionKey]: nextCollection, review_status: hasUnreviewed ? "Requires clinician review" : "Reviewed" };
      });
      return { ...current, recommendation_runs: nextRuns };
    });
  };

  const handleValidate = () => {
    setValidationResults(validateMolecularCompleteness(molecular, blocks, slides, mmrRows));
    setValidationOpen(true);
  };

  const handleSubmit = async () => {
    setIsSaving(true);
    try {
      await onSave("molecular", molecular);
    } finally {
      setIsSaving(false);
    }
  };

  const updateSampleClass = (order, value) => {
    updateOrder(order.test_order_id, "sample_class", value);
    if (!["Tissue block", "Tissue curls / scrolls"].includes(value)) updateOrder(order.test_order_id, "sample_block_id", "");
    if (value !== "Slide") updateOrder(order.test_order_id, "sample_slide_id", "");
  };

  const updateRequiredMaterial = (order, value) => {
    updateOrder(order.test_order_id, "required_material", value);
    const nextClass = materialSampleClass(value, !!order.sample_block_id);
    if (nextClass) updateSampleClass(order, nextClass);
    if (value !== "Tissue curls / scrolls") updateOrder(order.test_order_id, "sectioning_event_id", "");
  };

  // One microphone and one structure run at a time across the order cards.
  const busy = isSaving || isGenerating || isTranscribing || !!autofillOrderId || !!recordingOrderId;

  return (
    <Box sx={{ fontFamily: FONT }}>
      <SectionBox title="Molecular Worklist">
        <FG cols={4}>
          <SourceValue label="Test Orders" value={String(orders.length)} />
          <SourceValue label="Reported" value={String(orders.filter((order) => order.status === "Reported").length)} />
          <SourceValue label="Failed / QC Hold" value={String(orders.filter((order) => order.status === "Failed" || order.sample_qc_result === "Fail").length)} />
          <SourceValue label="Returned for Integrated Diagnosis" value={String(orders.filter((order) => order.returned_for_integrated_diagnosis === "Yes").length)} />
        </FG>
        <FlagNote>
          Molecular orders reference the exact block, slide, blood, plasma, or marrow used. FISH/ISH is performed and recorded once on the staining bench; a FISH-ISH order here links to that record read-only.
        </FlagNote>
        <FG cols={4}>
          <Box><FieldLabel>Sample Type for New Order</FieldLabel><Sel label="Sample Type" options={SAMPLE_CLASS_OPTIONS} value={selectedSampleClass} onChange={(value) => { setSelectedSampleClass(value); setSelectedBlockId(""); setSelectedSlideId(""); }} /></Box>
          <Box><FieldLabel>Block / Slide (optional)</FieldLabel><Sel label="Sample" options={sampleOptions} value={selectedBlockId ? `block:${selectedBlockId}` : selectedSlideId ? `slide:${selectedSlideId}` : ""} onChange={(value) => { if (value.startsWith("block:")) { setSelectedBlockId(value.slice(6)); setSelectedSlideId(""); } else if (value.startsWith("slide:")) { setSelectedSlideId(value.slice(6)); setSelectedBlockId(""); } else { setSelectedBlockId(""); setSelectedSlideId(""); } }} /></Box>
          <Box sx={{ display: "flex", alignItems: "flex-end" }}><Button sx={outlineBtnSx} onClick={addOrder}><AddRounded sx={{ mr: 0.75, fontSize: 16 }} /> Add Test Order</Button></Box>
        </FG>

        <Box sx={{ mt: 2 }}>
          <FieldLabel>Open Requests From Microscopy</FieldLabel>
          <PathologyTable
            rowId={(row) => row.request_id}
            rows={openRequests}
            columns={[
              { key: "targets", label: "Requested Test", width: "1.1fr" },
              { key: "diagnostic_question", label: "Diagnostic Question", width: "1.8fr", muted: true },
              { key: "priority", label: "Priority", width: "0.6fr", muted: true },
              { key: "requested_by", label: "Requested By", width: "1fr", muted: true },
              {
                key: "block",
                label: "Preferred Block",
                width: "0.9fr",
                muted: true,
                render: (row) => (row.preferred_block_id ? String(row.preferred_block_id).slice(-6) : "Lab to choose"),
              },
              {
                key: "actions",
                label: "",
                width: "1fr",
                align: "right",
                render: (row) => (
                  <Button
                    sx={{ ...outlineBtnSx, px: 1.25, py: 0.3, fontSize: 11 }}
                    onClick={(event) => { event.stopPropagation(); addOrderFromRequest(row); }}
                  >
                    Create test order
                  </Button>
                ),
              },
            ]}
            emptyMessage="No pathologist request is waiting for a molecular order."
          />
        </Box>
      </SectionBox>

      {/* Case-level treatment context, derived from the patient record rather than
          by the model. The spread reference is suppressed here — it belongs with
          the morphology tabs, not with variant interpretation. */}
      <ClinicalPosturePanel
        posture={posture}
        caseId={caseId}
        onRefreshed={setPosture}
        showSpreadReference={false}
      />

      {orders.map((order, index) => {
        const eligibility = molecularResultReviewEligibility(order);
        const orderRun = [...(molecular.recommendation_runs || [])].reverse()
          .find((run) => run.focus_test_order_id === order.test_order_id);
        return (
        <Box key={order.test_order_id} sx={{ border: `1px solid ${C.border}`, p: 2, mb: 2, background: C.white }}>
          <ItemHeader title={`${index + 1}. ${order.test_type || "Molecular test"}`} subtitle={order.test_order_id} onRemove={() => removeOrder(order.test_order_id)} />

          {/* The dictation panel leads the order card: the pathologist dictates
              the order's read and AI Autofill fills the empty order fields below.
              Optional — nothing here is saved until the order itself is saved. */}
          <Box sx={{ border: `1px solid ${C.border}`, p: 1.5, mb: 2, background: C.bgSecondary }}>
            <Typography sx={{ fontFamily: FONT, fontSize: 11, color: C.textMuted, letterSpacing: "0.08em", textTransform: "uppercase", mb: 1 }}>Molecular dictation</Typography>
            <FieldLabel>Dictation Transcript</FieldLabel>
            <TextField
              value={transcripts[order.test_order_id] || ""}
              onChange={(event) => setTranscripts((prev) => ({ ...prev, [order.test_order_id]: event.target.value }))}
              size="small"
              fullWidth
              multiline
              minRows={6}
              maxRows={6}
              placeholder="Dictate the order's read — indication, specimen and QC, assay, result, interpretation and variants. AI Autofill structures the transcript into the empty order fields only."
              sx={inputSx}
            />
            <Box sx={{ display: "flex", gap: 1.5, mt: 1.5, pt: 1.5, borderTop: `1px solid ${C.border}`, flexWrap: "wrap" }}>
              <Button
                sx={{
                  ...outlineBtnSx,
                  px: 2,
                  background: recordingOrderId === order.test_order_id ? "#cf1322" : C.white,
                  color: recordingOrderId === order.test_order_id ? C.white : C.black,
                  borderColor: recordingOrderId === order.test_order_id ? "#cf1322" : C.black,
                  "&:hover": { background: recordingOrderId === order.test_order_id ? "#a8071a" : C.bgTertiary },
                }}
                onClick={recordingOrderId === order.test_order_id ? stopRecording : () => startRecording(order)}
                disabled={isTranscribing || !!autofillOrderId || (!!recordingOrderId && recordingOrderId !== order.test_order_id)}
              >
                {recordingOrderId === order.test_order_id ? <StopRounded sx={{ mr: 0.75, fontSize: 16 }} /> : <MicRounded sx={{ mr: 0.75, fontSize: 16 }} />}
                {isTranscribing ? "Processing..." : recordingOrderId === order.test_order_id ? "Stop Recording" : "Start Recording"}
              </Button>
              <Button
                sx={{ ...outlineBtnSx, px: 2 }}
                onClick={() => autofillOrder(order)}
                disabled={busy || !(transcripts[order.test_order_id] || "").trim()}
              >
                {autofillOrderId === order.test_order_id
                  ? <CircularProgress size={14} sx={{ mr: 1, color: C.black }} />
                  : <AutoAwesomeRounded sx={{ mr: 0.75, fontSize: 16 }} />}
                AI Autofill Empty Fields
              </Button>
            </Box>
            {order.dictation?.structured_at && (
              <FlagNote>
                Last structured {order.dictation.structured_at} — {order.dictation.review_status}
              </FlagNote>
            )}
            <FlagNote>
              Optional — nothing here is saved until the order itself is saved, and no completeness check depends
              on it. Extraction never overwrites a value you already recorded, and never writes identity, lineage,
              links, timestamps, staff or workflow state. Variant rows are created from a dictation only when the
              order has none recorded yet.
            </FlagNote>
          </Box>

          <OrderSection title="Order & Clinical Question">
          <FG cols={4}>
            <Box><FieldLabel>Test Type</FieldLabel><Sel label="Test Type" options={MOLECULAR_TEST_TYPE_OPTIONS} value={order.test_type} onChange={(value) => updateOrder(order.test_order_id, "test_type", value)} /></Box>
            {order.test_type === "Other" && <LineField label="Other Test Type" value={order.test_type_other} onChange={(value) => updateOrder(order.test_order_id, "test_type_other", value)} />}
            <LineField label="Requested By" value={order.requested_by} onChange={(value) => updateOrder(order.test_order_id, "requested_by", value)} />
            <LineField label="Request Date and Time" type="datetime-local" value={order.request_datetime} onChange={(value) => updateOrder(order.test_order_id, "request_datetime", value)} />
            <Box><FieldLabel>Priority</FieldLabel><Sel label="Priority" options={PRIORITY_OPTIONS} value={order.priority} onChange={(value) => updateOrder(order.test_order_id, "priority", value)} /></Box>
            <Box><FieldLabel>Performing Laboratory</FieldLabel><Sel label="Performing Laboratory" options={PERFORMING_LAB_OPTIONS} value={order.performing_lab} onChange={(value) => updateOrder(order.test_order_id, "performing_lab", value)} /></Box>
            {order.performing_lab === "External reference laboratory" && <LineField label="Laboratory Name" value={order.lab_name} onChange={(value) => updateOrder(order.test_order_id, "lab_name", value)} />}
            <Box><FieldLabel>Status</FieldLabel><Sel label="Status" options={MOLECULAR_STATUS_OPTIONS} value={order.status} onChange={(value) => updateOrder(order.test_order_id, "status", value)} /></Box>
          </FG>
          <FG cols={2}>
            <TextArea label="Clinical Indication" value={order.clinical_indication} onChange={(value) => updateOrder(order.test_order_id, "clinical_indication", value)} />
            <TextArea label="Diagnostic / Predictive Question" value={order.diagnostic_question} onChange={(value) => updateOrder(order.test_order_id, "diagnostic_question", value)} />
          </FG>
          <FG cols={4}>
            <SourceValue label="Microscopy Request" value={order.request_id ? String(order.request_id).slice(-6) : ""} />
            <SourceValue label="Originating Microscopy Review" value={order.originating_microscopy_id ? String(order.originating_microscopy_id).slice(-6) : ""} />
            <LineField label="Previous Molecular Test Reference" value={order.previous_test_ref} onChange={(value) => updateOrder(order.test_order_id, "previous_test_ref", value)} />
            <LineField label="Source Report ID" value={order.source_report_id} onChange={(value) => updateOrder(order.test_order_id, "source_report_id", value)} />
            <LineField label="Source Laboratory System" value={order.source_lab_system} onChange={(value) => updateOrder(order.test_order_id, "source_lab_system", value)} />
          </FG>

          {order.test_type === "FISH-ISH" && (
            <>
              <Typography sx={{ fontFamily: FONT, fontSize: 11, color: C.textMuted, letterSpacing: "0.08em", textTransform: "uppercase", mt: 2, mb: 1 }}>
                Linked FISH record (performed on the staining bench)
              </Typography>
              <FG cols={2}>
                <Box>
                  <FieldLabel>Authoritative FISH Record</FieldLabel>
                  <Sel
                    label="FISH Record"
                    options={[{ value: "", label: "— Not linked —" }, ...fishRecords.map((record) => ({
                      value: record.stain_id,
                      label: `${record.gene_target || "FISH"} · ${record.status || "Ordered"} · slide ${String(record.slide_id).slice(-6)}`,
                    }))]}
                    value={order.linked_stain_id}
                    onChange={(value) => updateOrder(order.test_order_id, "linked_stain_id", value)}
                  />
                </Box>
                <SourceValue
                  label="Reported Signal Data (Read-Only)"
                  value={(() => {
                    const record = fishRecords.find((item) => item.stain_id === order.linked_stain_id);
                    if (!record) return "";
                    return [
                      record.cells_counted && `${record.cells_counted} cells`,
                      record.signal_ratio && `ratio ${record.signal_ratio}`,
                      record.copy_number && `copy number ${record.copy_number}`,
                      record.signal_quality,
                    ].filter(Boolean).join(" · ");
                  })()}
                />
              </FG>
              <FlagNote>
                FISH/ISH is performed and recorded once, on the staining bench. This order links to that record; the
                probe, run, controls and counting are edited in Staining, and the amplified / rearranged call is the
                pathologist&apos;s, recorded in Microscopy. Do not re-enter the result here.
              </FlagNote>
            </>
          )}

          </OrderSection>

          <OrderSection title="Specimen & Adequacy">
          <FG cols={4}>
            <Box><FieldLabel>Required Molecular Material</FieldLabel><Sel label="Required material" options={[{ value: "", label: "— Select material —" }, ...MOLECULAR_MATERIAL_OPTIONS]} value={order.required_material} onChange={(value) => updateRequiredMaterial(order, value)} /></Box>
            <Box><FieldLabel>Specimen Type</FieldLabel><Sel label="Specimen Type" options={SAMPLE_CLASS_OPTIONS} value={order.sample_class} onChange={(value) => updateSampleClass(order, value)} /></Box>
            {["Tissue block", "Tissue curls / scrolls"].includes(order.sample_class) && <Box><FieldLabel>Source Block</FieldLabel><Sel label="Block" options={[{ value: "", label: "— Select block —" }, ...blocks.map((block) => ({ value: block.block_id, label: `${block.block_id}${block.cassette_label ? ` (${block.cassette_label})` : ""}` }))]} value={order.sample_block_id} onChange={(value) => updateOrder(order.test_order_id, "sample_block_id", value)} /></Box>}
            {order.sample_class === "Slide" && <Box><FieldLabel>Specimen Slide</FieldLabel><Sel label="Slide" options={[{ value: "", label: "— Select slide —" }, ...slides.map((slide) => ({ value: slide.slide_id, label: `${String(slide.slide_id).slice(-8)}${slide.level ? ` (${slide.level})` : ""}` }))]} value={order.sample_slide_id} onChange={(value) => updateOrder(order.test_order_id, "sample_slide_id", value)} /></Box>}
            {order.required_material === "Tissue curls / scrolls" && <LineField label="Sections / Curls Required" value={order.section_count} onChange={(value) => updateOrder(order.test_order_id, "section_count", value)} />}
            {order.required_material === "Tissue curls / scrolls" && <Box><FieldLabel>Prepared Material From Sectioning</FieldLabel><Sel label="Sectioning output" options={[{ value: "", label: "— Awaiting preparation —" }, ...sectioningOutputs.filter((output) => !order.request_id || output.request_id === order.request_id).map((output) => ({ value: output.event_id, label: `${String(output.event_id).slice(-8)} · ${output.output_quantity || "?"} curl(s)${output.output_container ? ` · ${output.output_container}` : ""}` }))]} value={order.sectioning_event_id} onChange={(value) => updateOrder(order.test_order_id, "sectioning_event_id", value)} /></Box>}
            <LineField label="Collection Date and Time" type="datetime-local" value={order.collection_datetime || order.specimen_collection_datetime} onChange={(value) => { updateOrder(order.test_order_id, "collection_datetime", value); updateOrder(order.test_order_id, "specimen_collection_datetime", value); }} />
            <LineField label="Received Date and Time" type="datetime-local" value={order.received_datetime} onChange={(value) => updateOrder(order.test_order_id, "received_datetime", value)} />
            <LineField label="Selected Area" value={order.selected_area} onChange={(value) => updateOrder(order.test_order_id, "selected_area", value)} />
            <LineField label="Tumour Cellularity (%)" value={order.tumor_cellularity_percent} onChange={(value) => updateOrder(order.test_order_id, "tumor_cellularity_percent", value)} />
            <LineField label="Necrosis (%)" value={order.necrosis_percent} onChange={(value) => updateOrder(order.test_order_id, "necrosis_percent", value)} />
            <Box><FieldLabel>Macro / Microdissection</FieldLabel><Sel label="Dissection" options={DISSECTION_OPTIONS} value={order.dissection} onChange={(value) => updateOrder(order.test_order_id, "dissection", value)} /></Box>
            <Box><FieldLabel>Tissue Adequacy</FieldLabel><Sel label="Tissue Adequacy" options={TISSUE_ADEQUACY_OPTIONS} value={order.tissue_adequacy} onChange={(value) => updateOrder(order.test_order_id, "tissue_adequacy", value)} /></Box>
            <LineField label="Tissue Remaining" value={order.tissue_remaining} onChange={(value) => updateOrder(order.test_order_id, "tissue_remaining", value)} />
            <LineField label="DNA / RNA Extraction Date" type="datetime-local" value={order.extraction_datetime} onChange={(value) => updateOrder(order.test_order_id, "extraction_datetime", value)} />
            <LineField label="Nucleic-Acid Concentration" value={order.concentration} onChange={(value) => updateOrder(order.test_order_id, "concentration", value)} />
            <LineField label="Nucleic-Acid Quality Score" value={order.quality_score} onChange={(value) => updateOrder(order.test_order_id, "quality_score", value)} />
            <Box><FieldLabel>Sample QC</FieldLabel><Sel label="Sample QC" options={SAMPLE_QC_OPTIONS} value={order.sample_qc_result} onChange={(value) => updateOrder(order.test_order_id, "sample_qc_result", value)} /></Box>
            <Box><FieldLabel>Repeat Extraction</FieldLabel><Sel label="Repeat Extraction" options={YES_NO_OPTIONS} value={order.repeat_extraction} onChange={(value) => updateOrder(order.test_order_id, "repeat_extraction", value)} /></Box>
            <Box><FieldLabel>Recollection Required</FieldLabel><Sel label="Recollection Required" options={YES_NO_OPTIONS} value={order.recollection_required} onChange={(value) => updateOrder(order.test_order_id, "recollection_required", value)} /></Box>
          </FG>
          <FlagNote>
            Whole tissue block and extracted DNA/RNA go directly to Molecular. Unstained slides or tissue curls require suitable existing material or a linked Sectioning event; a molecular request does not automatically require a new slide.
          </FlagNote>
          <FG cols={1}>
            {(order.sample_qc_result === "Fail" || order.status === "Failed") && <TextArea label="Failure / Recollection Reason" value={order.failure_reason} onChange={(value) => updateOrder(order.test_order_id, "failure_reason", value)} />}
            {order.sample_class && order.sample_class !== "Tissue block" && order.sample_class !== "Slide" && <TextArea label="Sample Description" value={order.sample_description} onChange={(value) => updateOrder(order.test_order_id, "sample_description", value)} placeholder="Describe the blood, plasma, marrow, or other material" />}
          </FG>

          </OrderSection>

          <OrderSection title="Assay & Quality Control">
          <FG cols={4}>
            <LineField label="Platform" value={order.platform} onChange={(value) => updateOrder(order.test_order_id, "platform", value)} />
            <LineField label="Panel / Assay Name" value={order.panel_name} onChange={(value) => updateOrder(order.test_order_id, "panel_name", value)} />
            <LineField label="Panel / Assay Version" value={order.panel_version} onChange={(value) => updateOrder(order.test_order_id, "panel_version", value)} />
            <LineField label="Assay Run ID" value={order.assay_run_id} onChange={(value) => updateOrder(order.test_order_id, "assay_run_id", value)} />
            <GenePicker value={order.genes_tested} onChange={(value) => updateOrder(order.test_order_id, "genes_tested", value)} />
            <LineField label="Methodology" value={order.methodology} onChange={(value) => updateOrder(order.test_order_id, "methodology", value)} />
            <Box><FieldLabel>Nucleic Acid Input</FieldLabel><Sel label="Nucleic Acid Input" options={NUCLEIC_ACID_INPUT_OPTIONS} value={order.nucleic_acid_input} onChange={(value) => updateOrder(order.test_order_id, "nucleic_acid_input", value)} /></Box>
            <LineField label="Reference Genome / Transcript" value={order.reference_genome} onChange={(value) => updateOrder(order.test_order_id, "reference_genome", value)} />
            <LineField label="Coverage / Depth" value={order.coverage_depth} onChange={(value) => updateOrder(order.test_order_id, "coverage_depth", value)} />
            <LineField label="Limit of Detection" value={order.limit_of_detection} onChange={(value) => updateOrder(order.test_order_id, "limit_of_detection", value)} />
            <LineField label="ctDNA Assay Limit of Detection" value={order.ctdna_lod} onChange={(value) => updateOrder(order.test_order_id, "ctdna_lod", value)} />
            <Box><FieldLabel>Technical QC</FieldLabel><Sel label="Technical QC" options={TECHNICAL_QC_OPTIONS} value={order.technical_qc_status} onChange={(value) => updateOrder(order.test_order_id, "technical_qc_status", value)} /></Box>
          </FG>
          <FlagNote>
            Nucleic acid input is what decides whether a fusion result can be read. A fusion joins two genes inside an
            intron, so an assay fed DNA reports the fusion as wild type unless its panel happens to cover that intron —
            RNA has the introns already spliced out and shows the join directly. Record DNA here and a fusion negative
            stops meaning the same thing as it would on RNA.
          </FlagNote>

          </OrderSection>

          <OrderSection title="Results & Interpretation">
          <Typography sx={{ fontFamily: FONT, fontSize: 11, color: C.textMuted, letterSpacing: "0.08em", textTransform: "uppercase", mb: 1 }}>
            Microsatellite Instability & Tumor Mutational Burden
          </Typography>
          <FG cols={4}>
            <Box><FieldLabel>MSI Result</FieldLabel><Sel label="MSI Result" options={MSI_RESULT_OPTIONS} value={order.msi_result} onChange={(value) => updateOrder(order.test_order_id, "msi_result", value)} /></Box>
            <LineField label="MSI Method" value={order.msi_method} onChange={(value) => updateOrder(order.test_order_id, "msi_method", value)} placeholder="e.g. 5-marker PCR, NGS" />
            <LineField label="TMB Value" value={order.tmb_value} onChange={(value) => updateOrder(order.test_order_id, "tmb_value", value)} placeholder="e.g. 12.5" />
            <LineField label="TMB Unit" value={order.tmb_unit} onChange={(value) => updateOrder(order.test_order_id, "tmb_unit", value)} placeholder="mut/Mb" />
            <LineField label="TMB Method" value={order.tmb_method} onChange={(value) => updateOrder(order.test_order_id, "tmb_method", value)} placeholder="e.g. Comprehensive NGS" />
            <LineField label="TMB Interpretation" value={order.tmb_interpretation} onChange={(value) => updateOrder(order.test_order_id, "tmb_interpretation", value)} placeholder="e.g. TMB-High (>=10 mut/Mb)" />
          </FG>

          <Typography sx={{ fontFamily: FONT, fontSize: 11, color: C.textMuted, letterSpacing: "0.08em", textTransform: "uppercase", mt: 2, mb: 1 }}>
            Homologous Recombination Deficiency (HRD / Genomic Scars)
          </Typography>
          <FG cols={4}>
            <Box><FieldLabel>HRD Status</FieldLabel><Sel label="HRD Status" options={HRD_STATUS_OPTIONS} value={order.hrd_status} onChange={(value) => updateOrder(order.test_order_id, "hrd_status", value)} /></Box>
            <LineField label="HRD Score (GIS)" value={order.hrd_score} onChange={(value) => updateOrder(order.test_order_id, "hrd_score", value)} placeholder="e.g. 54" />
            <LineField label="HRD Method / Assay" value={order.hrd_method} onChange={(value) => updateOrder(order.test_order_id, "hrd_method", value)} placeholder="e.g. Myriad myChoice, FoundationOne" />
            <LineField label="LOH Status / Score" value={order.loh_status} onChange={(value) => updateOrder(order.test_order_id, "loh_status", value)} placeholder="Loss of heterozygosity" />
          </FG>

          <Typography sx={{ fontFamily: FONT, fontSize: 11, color: C.textMuted, letterSpacing: "0.08em", textTransform: "uppercase", mt: 2, mb: 1 }}>
            Epigenetics & Methylation Profiling
          </Typography>
          <FG cols={4}>
            <LineField label="Methylation Target / Panel" value={order.methylation_target} onChange={(value) => updateOrder(order.test_order_id, "methylation_target", value)} placeholder="e.g. MGMT, MLH1, Heidelberg CNS" />
            <Box><FieldLabel>Methylation Status</FieldLabel><Sel label="Methylation Status" options={METHYLATION_STATUS_OPTIONS} value={order.methylation_status} onChange={(value) => updateOrder(order.test_order_id, "methylation_status", value)} /></Box>
            <LineField label="Methylation Class / Subgroup" value={order.methylation_class} onChange={(value) => updateOrder(order.test_order_id, "methylation_class", value)} placeholder="e.g. Glioblastoma RTK II" />
            <LineField label="Classifier Calibrated Score" value={order.methylation_classifier_score} onChange={(value) => updateOrder(order.test_order_id, "methylation_classifier_score", value)} placeholder="e.g. 0.98" />
          </FG>

          <Typography sx={{ fontFamily: FONT, fontSize: 11, color: C.textMuted, letterSpacing: "0.08em", textTransform: "uppercase", mt: 2, mb: 1 }}>
            Transcriptomics & Gene Expression Signatures
          </Typography>
          <FG cols={4}>
            <LineField label="Expression Signature Name" value={order.expression_signature_name} onChange={(value) => updateOrder(order.test_order_id, "expression_signature_name", value)} placeholder="e.g. Oncotype DX, MammaPrint" />
            <LineField label="Recurrence / Risk Score" value={order.expression_score} onChange={(value) => updateOrder(order.test_order_id, "expression_score", value)} placeholder="e.g. 18" />
            <Box><FieldLabel>Expression Risk Category</FieldLabel><Sel label="Risk Category" options={EXPRESSION_RISK_OPTIONS} value={order.expression_risk_category} onChange={(value) => updateOrder(order.test_order_id, "expression_risk_category", value)} /></Box>
            <Box><FieldLabel>Result Comparison</FieldLabel><Sel label="Result Comparison" options={RESULT_COMPARISON_OPTIONS} value={order.result_comparison} onChange={(value) => updateOrder(order.test_order_id, "result_comparison", value)} /></Box>
          </FG>

          <FG cols={2} sx={{ mt: 1.5, mb: 1.5 }}>
            <Box><FieldLabel>No Clinically Significant Alteration</FieldLabel><Sel label="No Alteration" options={YES_NO_OPTIONS} value={order.no_significant_alteration} onChange={(value) => updateOrder(order.test_order_id, "no_significant_alteration", value)} /></Box>
          </FG>
          {mmrRows.length > 0 && (
            <Box sx={{ border: `1px solid ${C.border}`, background: C.bgSecondary, p: 1.5, mb: 1.5 }}>
              <FieldLabel>MMR IHC (read-only): antibody work from Staining, call from Microscopy</FieldLabel>
              <Typography sx={{ fontFamily: FONT, fontSize: 11, color: C.textSecond }}>
                {mmrRows.map((row) => `${row.marker}: ${row.interpretation || "awaiting pathologist reading"}${row.pattern ? ` (${row.pattern})` : ""}`).join(" | ")}
              </Typography>
            </Box>
          )}
          <FG cols={1}>
            <TextArea label="Actionable / Resistance-Associated Findings" value={order.actionable_findings} onChange={(value) => updateOrder(order.test_order_id, "actionable_findings", value)} />
            <TextArea label="Resistance-Associated Findings" value={order.resistance_findings} onChange={(value) => updateOrder(order.test_order_id, "resistance_findings", value)} />
            <TextArea label="Pathologist / Molecular Specialist Interpretation Comments" value={order.interpretation_comments} onChange={(value) => updateOrder(order.test_order_id, "interpretation_comments", value)} />
          </FG>
          </OrderSection>

          <OrderSection title="Genomic Variants">
          {order.variants?.map((variant) => (
            <Box key={variant.variant_id} sx={{ border: `1px solid ${C.border}`, p: 1.5, mt: 1.5, background: C.bgSecondary }}>
              <ItemHeader title="Variant" subtitle={variant.variant_id} onRemove={() => removeVariant(order.test_order_id, variant.variant_id)} />
              <FG cols={4}>
                <LineField label="Gene" value={variant.gene} onChange={(value) => updateVariant(order.test_order_id, variant.variant_id, "gene", value)} />
                <LineField label="Transcript" value={variant.transcript} onChange={(value) => updateVariant(order.test_order_id, variant.variant_id, "transcript", value)} />
                <LineField label="DNA Change" value={variant.dna_change} onChange={(value) => updateVariant(order.test_order_id, variant.variant_id, "dna_change", value)} />
                <LineField label="Protein Change" value={variant.protein_change} onChange={(value) => updateVariant(order.test_order_id, variant.variant_id, "protein_change", value)} />
                <Box><FieldLabel>Variant Type</FieldLabel><Sel label="Variant Type" options={VARIANT_TYPE_OPTIONS} value={variant.variant_type} onChange={(value) => updateVariant(order.test_order_id, variant.variant_id, "variant_type", value)} /></Box>
                <LineField label="VAF (%)" value={variant.vaf_percent} onChange={(value) => updateVariant(order.test_order_id, variant.variant_id, "vaf_percent", value)} />
                <LineField label="Copy Number" value={variant.copy_number} onChange={(value) => updateVariant(order.test_order_id, variant.variant_id, "copy_number", value)} />
                <LineField label="Fusion Partner Gene" value={variant.fusion_partner} onChange={(value) => updateVariant(order.test_order_id, variant.variant_id, "fusion_partner", value)} />
                <LineField label="Fusion Breakpoint / Detail" value={variant.fusion_detail} onChange={(value) => updateVariant(order.test_order_id, variant.variant_id, "fusion_detail", value)} />
                <LineField label="Classification Tier" value={variant.tier} onChange={(value) => updateVariant(order.test_order_id, variant.variant_id, "tier", value)} />
                <LineField label="Classification System" value={variant.classification_system} onChange={(value) => updateVariant(order.test_order_id, variant.variant_id, "classification_system", value)} />
                <LineField label="Clinical Significance" value={variant.clinical_significance} onChange={(value) => updateVariant(order.test_order_id, variant.variant_id, "clinical_significance", value)} />
                <Box><FieldLabel>Somatic / Germline Status</FieldLabel><Sel label="Origin" options={VARIANT_ORIGIN_OPTIONS} value={variant.origin} onChange={(value) => updateVariant(order.test_order_id, variant.variant_id, "origin", value)} /></Box>
                <LineField label="Zygosity / Allele Metric" value={variant.zygosity} onChange={(value) => updateVariant(order.test_order_id, variant.variant_id, "zygosity", value)} />
                <LineField label="Evidence Source" value={variant.evidence_source} onChange={(value) => updateVariant(order.test_order_id, variant.variant_id, "evidence_source", value)} />
                <LineField label="Interpretation DB Version" value={variant.interpretation_db_version} onChange={(value) => updateVariant(order.test_order_id, variant.variant_id, "interpretation_db_version", value)} />
                <LineField label="HGVS Genomic" value={variant.hgvs_genomic} onChange={(value) => updateVariant(order.test_order_id, variant.variant_id, "hgvs_genomic", value)} />
                <LineField label="Genome Build" value={variant.genome_build} onChange={(value) => updateVariant(order.test_order_id, variant.variant_id, "genome_build", value)} />
              </FG>
            </Box>
          ))}
          <Button sx={{ ...outlineBtnSx, mt: 1.5 }} onClick={() => addVariant(order.test_order_id)}><AddRounded sx={{ mr: 0.75, fontSize: 16 }} /> Add Variant</Button>

          </OrderSection>

          <OrderSection title="Review, Germline & Handoff">
          <FG cols={4}>
            <LineField label="Reviewed By" value={order.reviewed_by} onChange={(value) => updateOrder(order.test_order_id, "reviewed_by", value)} />
            <LineField label="Review Date and Time" type="datetime-local" value={order.review_datetime} onChange={(value) => updateOrder(order.test_order_id, "review_datetime", value)} />
            <LineField label="Result Date and Time" type="datetime-local" value={order.result_datetime} onChange={(value) => updateOrder(order.test_order_id, "result_datetime", value)} />
            <LineField label="Report Date and Time" type="datetime-local" value={order.report_datetime} onChange={(value) => updateOrder(order.test_order_id, "report_datetime", value)} />
            <Box><FieldLabel>Possible Germline Finding Flagged</FieldLabel><Sel label="Germline Flag" options={YES_NO_OPTIONS} value={order.possible_germline_flagged} onChange={(value) => updateOrder(order.test_order_id, "possible_germline_flagged", value)} /></Box>
            <Box><FieldLabel>Genetic Counselling Referral</FieldLabel><Sel label="Counselling Referral" options={YES_NO_OPTIONS} value={order.genetic_counselling_referral} onChange={(value) => updateOrder(order.test_order_id, "genetic_counselling_referral", value)} /></Box>
            <Box><FieldLabel>Patient Consent</FieldLabel><Sel label="Consent" options={CONSENT_OPTIONS} value={order.consent_status} onChange={(value) => updateOrder(order.test_order_id, "consent_status", value)} /></Box>
            <Box><FieldLabel>Confirmatory Germline Test</FieldLabel><Sel label="Germline Confirmation" options={GERMLINE_CONFIRMATION_OPTIONS} value={order.germline_confirmation_status} onChange={(value) => updateOrder(order.test_order_id, "germline_confirmation_status", value)} /></Box>
            <Box><FieldLabel>Returned for Integrated Diagnosis</FieldLabel><Sel label="Integrated Diagnosis" options={YES_NO_OPTIONS} value={order.returned_for_integrated_diagnosis} onChange={(value) => updateOrder(order.test_order_id, "returned_for_integrated_diagnosis", value)} /></Box>
            {order.returned_for_integrated_diagnosis === "Yes" && <LineField label="Return Date and Time" type="datetime-local" value={order.returned_datetime} onChange={(value) => updateOrder(order.test_order_id, "returned_datetime", value)} />}
          </FG>
          <FlagNote>
            A reported order returned for integrated diagnosis appears in the Integrated Diagnosis tab, not in
            Microscopy&apos;s returned-work queue. There is no slide to read: the variant interpretation above is the
            pathologist&apos;s reading, and it is not re-entered anywhere else.
          </FlagNote>
          <FG cols={1}>
            <TextArea label="Recommended Additional / Reflex Testing" value={order.recommended_reflex_testing} onChange={(value) => updateOrder(order.test_order_id, "recommended_reflex_testing", value)} />
            {order.final_report !== undefined && <TextArea label="Final Report" value={order.final_report} onChange={(value) => updateOrder(order.test_order_id, "final_report", value)} />}
          </FG>

          </OrderSection>

          <OrderSection title="Molecular Result Review">
            <Box sx={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 2, flexWrap: "wrap" }}>
              <Box>
                <Typography sx={{ fontFamily: FONT, fontSize: 11, color: C.textMuted }}>
                  Reviews only this reported order; suggestions never edit or return the result automatically.
                </Typography>
              </Box>
              <Button sx={outlineBtnSx} onClick={() => handleGenerate(order.test_order_id)} disabled={isGenerating || !eligibility.eligible}>
                {isGenerating && focusedOrderId === order.test_order_id ? <CircularProgress size={14} sx={{ mr: 1, color: C.black }} /> : <AutoAwesomeRounded sx={{ mr: 0.75, fontSize: 16 }} />}
                Review Molecular Result With AI
              </Button>
            </Box>
            {!eligibility.eligible && <Typography sx={{ fontFamily: FONT, fontSize: 11, color: C.textMuted, mt: 1 }}>{eligibility.reason}</Typography>}
            {orderRun && (
              <Box sx={{ mt: 1.5 }}>
                <Box sx={{ border: `1px solid ${C.border}`, background: C.bgSecondary, p: 1.5, mb: 1.5 }}>
                  <Typography sx={{ fontFamily: FONT, fontSize: 12, fontWeight: FW_NORMAL }}>AI molecular review</Typography>
                  <Typography sx={{ fontFamily: FONT, fontSize: 11, color: C.textMuted, mt: 0.5 }}>Engine {orderRun.engine_version || ""} | {orderRun.review_status || "Requires clinician review"}</Typography>
                  {(orderRun.source_families || []).map((source) => <Typography key={source} sx={{ fontFamily: FONT, fontSize: 11, color: C.textSecond, mt: 0.5 }}>{source}</Typography>)}
                  {orderRun.source_version_status && <Typography sx={{ fontFamily: FONT, fontSize: 11, color: C.textMuted, mt: 0.75 }}>{orderRun.source_version_status}</Typography>}
                  {orderRun.case_summary && <Typography sx={{ fontFamily: FONT, fontSize: 12, color: C.textSecond, mt: 1 }}>{orderRun.case_summary}</Typography>}
                  {orderRun.technical_assessment?.limitations?.length > 0 && <FlagNote>Technical limitations: {orderRun.technical_assessment.limitations.join("; ")}</FlagNote>}
                  {orderRun.missing_information?.length > 0 && <FlagNote>Missing information: {orderRun.missing_information.join("; ")}</FlagNote>}
                  {orderRun.warnings?.length > 0 && <FlagNote>{orderRun.warnings.join(" ")}</FlagNote>}
                </Box>
                {SUGGESTION_GROUPS.map(([key, heading]) => {
                  const items = orderRun[key] || [];
                  if (!items.length) return null;
                  return <Box key={key} sx={{ mb: 2 }}><FieldLabel>{heading}</FieldLabel>{items.map((suggestion) => <SuggestionRow key={suggestion.suggestion_id} title={suggestion.item} reason={suggestion.reason} source={suggestion.source_name} confidence={suggestion.confidence} status={suggestion.review_status} onAccept={() => reviewSuggestion(orderRun.recommendation_run_id, key, suggestion.suggestion_id, "Accepted")} onDismiss={() => reviewSuggestion(orderRun.recommendation_run_id, key, suggestion.suggestion_id, "Dismissed")} />)}</Box>;
                })}
              </Box>
            )}
          </OrderSection>
        </Box>
        );
      })}

      {orders.length === 0 && <FlagNote>No molecular test order recorded yet. Select a sample type above and add the first order.</FlagNote>}

      {legacyRuns.length > 0 && <SectionBox title="Earlier Molecular Advisory Runs">
        <Box sx={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 2, flexWrap: "wrap", mb: 2 }}>
          <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}><LightbulbRounded sx={{ fontSize: 18, color: C.black }} /><Typography sx={{ fontFamily: FONT, fontSize: 12, color: C.textSecond }}>Clinician-reviewed, source-labelled advisory output</Typography></Box>
          <Typography sx={{ fontFamily: FONT, fontSize: 12, color: C.textSecond }}>Older runs without a focused order remain available for reference.</Typography>
        </Box>
        {legacyRuns[legacyRuns.length - 1] && (
          <>
            <Box sx={{ border: `1px solid ${C.border}`, background: C.bgSecondary, p: 1.5, mb: 2 }}>
              <Typography sx={{ fontFamily: FONT, fontSize: 12, fontWeight: FW_NORMAL }}>Molecular advisory</Typography>
              <Typography sx={{ fontFamily: FONT, fontSize: 11, color: C.textMuted, mt: 0.5 }}>Engine {legacyRuns[legacyRuns.length - 1].engine_version || ""} | {legacyRuns[legacyRuns.length - 1].review_status || "Requires clinician review"}</Typography>
              {(legacyRuns[legacyRuns.length - 1].source_families || []).map((source) => <Typography key={source} sx={{ fontFamily: FONT, fontSize: 11, color: C.textSecond, mt: 0.5 }}>{source}</Typography>)}
              {legacyRuns[legacyRuns.length - 1].missing_information?.length > 0 && <FlagNote>Missing information: {legacyRuns[legacyRuns.length - 1].missing_information.join("; ")}</FlagNote>}
              {legacyRuns[legacyRuns.length - 1].warnings?.length > 0 && <FlagNote>{legacyRuns[legacyRuns.length - 1].warnings.join(" ")}</FlagNote>}
            </Box>
            {LEGACY_SUGGESTION_GROUPS.map(([key, heading]) => {
              const items = legacyRuns[legacyRuns.length - 1][key] || [];
              if (!items.length) return null;
              return <Box key={key} sx={{ mb: 2 }}><FieldLabel>{heading}</FieldLabel>{items.map((suggestion) => <SuggestionRow key={suggestion.suggestion_id} title={suggestion.item} reason={suggestion.reason} source={suggestion.source_name} confidence={suggestion.confidence} status={suggestion.review_status} onAccept={() => reviewSuggestion(legacyRuns[legacyRuns.length - 1].recommendation_run_id, key, suggestion.suggestion_id, "Accepted")} onDismiss={() => reviewSuggestion(legacyRuns[legacyRuns.length - 1].recommendation_run_id, key, suggestion.suggestion_id, "Dismissed")} />)}</Box>;
            })}
          </>
        )}
      </SectionBox>}

      {notice && <Box sx={{ border: `1px solid ${C.border}`, background: C.bgSecondary, p: 1.5, mb: 2.5 }}><Typography sx={{ fontFamily: FONT, fontSize: 12, color: C.textSecond }}>{notice}</Typography></Box>}
      <Box sx={{ display: "flex", gap: 1.5, flexWrap: "wrap" }}>
        <Button sx={outlineBtnSx} onClick={handleValidate}><FactCheckRounded sx={{ mr: 0.75, fontSize: 16 }} /> Review Reconciliation</Button>
        <Button sx={saveBtnSx} onClick={handleSubmit} disabled={isSaving}>{isSaving ? <CircularProgress size={14} sx={{ mr: 1, color: C.white }} /> : <SaveRounded sx={{ mr: 0.75, fontSize: 16 }} />} Save Molecular Testing</Button>
      </Box>
      <CapValidationDialog open={validationOpen} onClose={() => setValidationOpen(false)} title="Molecular Testing Reconciliation Review" results={validationResults} />
    </Box>
  );
}
