import React, { useEffect, useRef, useState } from "react";
import {
  Box,
  Button,
  Checkbox,
  CircularProgress,
  FormControlLabel,
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
import {
  structureGrossing,
  uploadDocument,
  verifyGrossingContainerImage,
} from "../shared/api";
import { coerceEnum, coerceNumber } from "../shared/transcribeMerge";
import {
  BIOBANK_ALLOCATION_OPTIONS,
  BIOPSY_HANDLING_OPTIONS,
  BIOPSY_MEASUREMENT_OPTIONS,
  SPECIMEN_CLASS_OPTIONS,
  TUMOR_BORDER_OPTIONS,
  TUMOR_CONFIGURATION_OPTIONS,
  YES_NO_OPTIONS,
  ensureGrossingRecord,
  makeCassette,
  makeLymphNodeGroup,
  makeMargin,
  mergeGrossingExtraction,
  normalizeGrossing,
  serializeGrossing,
} from "../shared/grossingModel";
import { validateGrossingCAP, validateGrossingCompleteness } from "../shared/capValidation";
import CapValidationDialog from "../CapValidationDialog";
import Code128Barcode from "../shared/Code128Barcode";
import BypassVerificationControl from "../shared/BypassVerificationControl";
import { makeBypassRecord } from "../shared/barcodeVerification";

const API_BASE_URL = import.meta.env.VITE_BACKEND_URL || "https://doctorassist.ai/api/";

const localDateTimeValue = () => {
  const now = new Date();
  const offset = now.getTimezoneOffset() * 60000;
  return new Date(now.getTime() - offset).toISOString().slice(0, 16);
};

const readOnlyValue = (value) => value || "Not recorded";

const SourceValue = ({ label, value }) => (
  <Box>
    <FieldLabel>{label}</FieldLabel>
    <TextField
      value={readOnlyValue(value)}
      size="small"
      fullWidth
      InputProps={{ readOnly: true }}
      sx={inputSx}
    />
  </Box>
);

const NumberField = ({ label, value, onChange, placeholder }) => (
  <Box>
    <FieldLabel>{label}</FieldLabel>
    <TextField
      type="number"
      value={value ?? ""}
      onChange={(event) => onChange(event.target.value)}
      size="small"
      fullWidth
      placeholder={placeholder}
      inputProps={{ min: 0, step: "0.1" }}
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
    <IconButton size="small" onClick={onRemove} title={`Remove ${title}`} sx={{ color: C.textSecond }}>
      <DeleteOutlineRounded fontSize="small" />
    </IconButton>
  </Box>
);

export default function GrossingBenchTab({
  caseId,
  accessionId,
  initialData,
  caseRegister,
  patientId,
  doctorId,
  doctorName,
  hospitalId,
  onSave,
}) {
  const specimens = Array.isArray(caseRegister?.specimens) ? caseRegister.specimens : [];
  const staff = { staff_id: doctorId || "", name: doctorName || "" };
  const initialSelected = initialData?.records?.find((record) => record.primary_for_reporting)?.specimen_id
    || initialData?.records?.[0]?.specimen_id
    || specimens[0]?.specimen_id
    || "";

  const [grossing, setGrossing] = useState(() => normalizeGrossing(initialData, specimens, staff));
  const [selectedSpecimenId, setSelectedSpecimenId] = useState(initialSelected);
  const [transcript, setTranscript] = useState("");
  const [notice, setNotice] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [isAutofilling, setIsAutofilling] = useState(false);
  const [containerUploadId, setContainerUploadId] = useState("");
  const [bypassContainerId, setBypassContainerId] = useState("");
  const [bypassReason, setBypassReason] = useState("");
  const [photoUploadType, setPhotoUploadType] = useState("");
  const [validationOpen, setValidationOpen] = useState(false);
  const [validationResults, setValidationResults] = useState([]);
  const mediaRecorderRef = useRef(null);
  const audioChunksRef = useRef([]);
  const beforePhotoRef = useRef(null);
  const afterPhotoRef = useRef(null);

  useEffect(() => {
    const next = normalizeGrossing(initialData, specimens, staff);
    setGrossing(next);
    setSelectedSpecimenId(
      next.records.find((record) => record.primary_for_reporting)?.specimen_id
      || next.records[0]?.specimen_id
      || specimens[0]?.specimen_id
      || ""
    );
    setTranscript("");
    setNotice("");
    setContainerUploadId("");
    setBypassContainerId("");
    setBypassReason("");
  }, [caseId]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (selectedSpecimenId && specimens.some((specimen) => specimen.specimen_id === selectedSpecimenId)) return;
    setSelectedSpecimenId(specimens[0]?.specimen_id || "");
  }, [selectedSpecimenId, specimens]);

  const selectedSpecimen = specimens.find((specimen) => specimen.specimen_id === selectedSpecimenId) || null;
  const record = selectedSpecimen
    ? ensureGrossingRecord(grossing, selectedSpecimen, staff)
    : null;

  const updateRecord = (updater) => {
    if (!selectedSpecimen) return;
    setGrossing((current) => {
      const normalized = normalizeGrossing(current, specimens, staff);
      const currentRecord = ensureGrossingRecord(normalized, selectedSpecimen, staff);
      const nextRecord = updater(currentRecord);
      const exists = normalized.records.some((item) => item.specimen_id === selectedSpecimenId);
      return {
        ...normalized,
        records: exists
          ? normalized.records.map((item) => item.specimen_id === selectedSpecimenId ? nextRecord : item)
          : [...normalized.records, nextRecord],
      };
    });
  };

  const updateCommon = (key, value) => updateRecord((current) => ({
    ...current,
    common: { ...current.common, [key]: value },
  }));

  const updateCommonDimension = (key, value) => updateRecord((current) => ({
    ...current,
    common: {
      ...current.common,
      dimensions_mm: { ...current.common.dimensions_mm, [key]: value },
    },
  }));

  const updateBiopsy = (key, value) => updateRecord((current) => ({
    ...current,
    biopsy: { ...current.biopsy, [key]: value },
  }));

  const updateBiopsyDimension = (key, value) => updateRecord((current) => ({
    ...current,
    biopsy: {
      ...current.biopsy,
      dimensions_mm: { ...current.biopsy.dimensions_mm, [key]: value },
    },
  }));

  const updateResection = (key, value) => updateRecord((current) => ({
    ...current,
    resection: { ...current.resection, [key]: value },
  }));

  const updateTumorDimension = (key, value) => updateRecord((current) => ({
    ...current,
    resection: {
      ...current.resection,
      tumor_dimensions_mm: { ...current.resection.tumor_dimensions_mm, [key]: value },
    },
  }));

  const toggleContainer = (containerId) => updateRecord((current) => {
    const selected = current.selected_container_ids.includes(containerId);
    const nextContainerIds = selected
      ? current.selected_container_ids.filter((id) => id !== containerId)
      : [...current.selected_container_ids, containerId];
    return {
      ...current,
      selected_container_ids: nextContainerIds,
      cassettes: current.cassettes.map((cassette) => ({
        ...cassette,
        parent_container_ids: cassette.parent_container_ids.filter((id) => nextContainerIds.includes(id)),
      })),
    };
  });

  const handleContainerVerificationUpload = async (containerId, event) => {
    const file = event.target.files?.[0];
    if (!file || !record || !selectedSpecimen) return;
    setContainerUploadId(containerId);
    setNotice("");
    try {
      const response = await verifyGrossingContainerImage({
        file,
        caseId,
        accessionId,
        specimenId: selectedSpecimen.specimen_id,
        containerId,
        patientId,
        doctorId,
        hospitalId,
      });
      const verification = response.verification;
      if (!verification) throw new Error("Verification response is missing");
      updateRecord((current) => ({
        ...current,
        container_verifications: [
          ...(current.container_verifications || []),
          {
            ...verification,
            verified_by: {
              staff_id: doctorId || "",
              name: doctorName || "",
            },
          },
        ],
      }));

      if (verification.result === "matched") {
        setNotice("Container barcode matched the selected accessioning container.");
      } else if (verification.result === "mismatch") {
        setNotice("Container barcode does not match the selected container. Grossing remains locked.");
      } else {
        setNotice("No barcode could be read from the image. Grossing remains locked.");
      }
    } catch (error) {
      console.error("[GrossingBenchTab] container verification:", error);
      setNotice(error.message || "Container barcode verification failed.");
    } finally {
      setContainerUploadId("");
      event.target.value = "";
    }
  };

  // Doctor's escape hatch when the barcode cannot be machine-verified: the bypass
  // is appended to the same verification list (recorded honestly as NOT verified,
  // with who, when and why) and unlocks Grossing for this container.
  const bypassContainerVerification = (containerId) => {
    const reason = bypassReason.trim();
    if (!reason || !record || !selectedSpecimen) return;
    updateRecord((current) => ({
      ...current,
      container_verifications: [
        ...(current.container_verifications || []),
        {
          ...makeBypassRecord({ staff_id: doctorId || "", name: doctorName || "" }, reason),
          container_id: containerId,
        },
      ],
    }));
    setBypassContainerId("");
    setBypassReason("");
    setNotice("Container barcode verification bypassed. Grossing is unlocked — the record is saved as not verified.");
  };

  const markPrimary = (checked) => {
    if (!selectedSpecimen) return;
    setGrossing((current) => {
      const normalized = normalizeGrossing(current, specimens, staff);
      const active = ensureGrossingRecord(normalized, selectedSpecimen, staff);
      const records = normalized.records.some((item) => item.specimen_id === selectedSpecimenId)
        ? normalized.records
        : [...normalized.records, active];
      return {
        ...normalized,
        records: records.map((item) => ({
          ...item,
          primary_for_reporting: item.specimen_id === selectedSpecimenId ? checked : false,
        })),
      };
    });
  };

  const addCassette = () => updateRecord((current) => ({
    ...current,
    cassettes: [
      ...current.cassettes,
      makeCassette(current.specimen_id, current.selected_container_ids, current.cassettes.length),
    ],
  }));

  const updateCassette = (cassetteId, key, value) => updateRecord((current) => ({
    ...current,
    cassettes: current.cassettes.map((cassette) => cassette.cassette_id === cassetteId
      ? { ...cassette, [key]: value }
      : cassette),
  }));

  const removeCassette = (cassetteId) => updateRecord((current) => ({
    ...current,
    cassettes: current.cassettes.filter((cassette) => cassette.cassette_id !== cassetteId),
  }));

  const addMargin = () => updateRecord((current) => ({
    ...current,
    resection: {
      ...current.resection,
      margins: [...current.resection.margins, makeMargin()],
    },
  }));

  const updateMargin = (marginId, key, value) => updateRecord((current) => ({
    ...current,
    resection: {
      ...current.resection,
      margins: current.resection.margins.map((margin) => margin.margin_id === marginId
        ? { ...margin, [key]: value }
        : margin),
    },
  }));

  const removeMargin = (marginId) => updateRecord((current) => ({
    ...current,
    resection: {
      ...current.resection,
      margins: current.resection.margins.filter((margin) => margin.margin_id !== marginId),
    },
  }));

  const addLymphNodeGroup = () => updateRecord((current) => ({
    ...current,
    resection: {
      ...current.resection,
      lymph_node_groups: [...current.resection.lymph_node_groups, makeLymphNodeGroup()],
    },
  }));

  const updateLymphNodeGroup = (groupId, key, value) => updateRecord((current) => ({
    ...current,
    resection: {
      ...current.resection,
      lymph_node_groups: current.resection.lymph_node_groups.map((group) => (
        group.lymph_node_group_id === groupId ? { ...group, [key]: value } : group
      )),
    },
  }));

  const removeLymphNodeGroup = (groupId) => updateRecord((current) => ({
    ...current,
    resection: {
      ...current.resection,
      lymph_node_groups: current.resection.lymph_node_groups.filter(
        (group) => group.lymph_node_group_id !== groupId
      ),
    },
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
      console.error("[GrossingBenchTab] microphone:", error);
      setNotice("Microphone access is unavailable.");
    }
  };

  const stopRecording = () => {
    if (!mediaRecorderRef.current || !isRecording) return;
    mediaRecorderRef.current.onstop = async () => {
      setIsRecording(false);
      setIsProcessing(true);
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
        if (text) setTranscript((current) => current ? `${current} ${text}` : text);
      } catch (error) {
        console.error("[GrossingBenchTab] transcription:", error);
        setNotice("Grossing dictation transcription failed.");
      } finally {
        setIsProcessing(false);
      }
    };
    mediaRecorderRef.current.stop();
    mediaRecorderRef.current.stream.getTracks().forEach((track) => track.stop());
  };

  const handleAutofill = async () => {
    if (!record || !transcript.trim()) return;
    setIsAutofilling(true);
    setNotice("");
    try {
      const response = await structureGrossing(transcript, record.specimen_class);
      if (response.status !== "success" || !response.data) throw new Error("No structured data returned");
      const reviewedAt = new Date().toISOString();
      const structured = {
        ...response.data,
        common: response.data.common
          ? {
            ...response.data.common,
            weight_g: coerceNumber(response.data.common.weight_g),
            dimensions_mm: Object.fromEntries(
              Object.entries(response.data.common.dimensions_mm || {}).map(([key, value]) => [key, coerceNumber(value)])
            ),
          }
          : response.data.common,
        biopsy: response.data.biopsy
          ? {
            ...response.data.biopsy,
            tissue_count: coerceNumber(response.data.biopsy.tissue_count),
            measurement_basis: coerceEnum(response.data.biopsy.measurement_basis, BIOPSY_MEASUREMENT_OPTIONS),
            entire_specimen_submitted: coerceEnum(response.data.biopsy.entire_specimen_submitted, YES_NO_OPTIONS),
            handling_method: coerceEnum(response.data.biopsy.handling_method, BIOPSY_HANDLING_OPTIONS),
            dimensions_mm: Object.fromEntries(
              Object.entries(response.data.biopsy.dimensions_mm || {}).map(([key, value]) => [key, coerceNumber(value)])
            ),
          }
          : response.data.biopsy,
        resection: response.data.resection
          ? {
            ...response.data.resection,
            tumor_border: coerceEnum(response.data.resection.tumor_border, TUMOR_BORDER_OPTIONS),
            tumor_configuration: coerceEnum(response.data.resection.tumor_configuration, TUMOR_CONFIGURATION_OPTIONS),
            lymph_nodes_identified: coerceNumber(response.data.resection.lymph_nodes_identified),
            biobank_or_frozen_allocation: coerceEnum(
              response.data.resection.biobank_or_frozen_allocation,
              BIOBANK_ALLOCATION_OPTIONS
            ),
            tumor_dimensions_mm: Object.fromEntries(
              Object.entries(response.data.resection.tumor_dimensions_mm || {}).map(([key, value]) => [key, coerceNumber(value)])
            ),
            margins: (response.data.resection.margins || []).map((margin) => ({
              ...makeMargin(),
              ...(margin || {}),
              distance_mm: coerceNumber(margin?.distance_mm),
            })),
            lymph_node_groups: (response.data.resection.lymph_node_groups || []).map((group) => ({
              ...makeLymphNodeGroup(),
              ...(group || {}),
              count_identified: coerceNumber(group?.count_identified),
            })),
          }
          : response.data.resection,
        cassettes: (response.data.cassettes || [])
          .filter((cassette) => [
            cassette?.tissue_description,
            cassette?.sampling_purpose,
            cassette?.special_instructions,
          ].some(Boolean))
          .map((cassette, index) => ({
            ...makeCassette(record.specimen_id, record.selected_container_ids, index),
            tissue_description: cassette?.tissue_description || "",
            sampling_purpose: cassette?.sampling_purpose || "",
            special_instructions: cassette?.special_instructions || "",
          })),
      };
      updateRecord((current) => ({
        ...mergeGrossingExtraction(current, structured),
        dictation: {
          transcript,
          structured_at: reviewedAt,
          review_status: "accepted",
          reviewed_by: doctorName || doctorId || "",
          reviewed_at: reviewedAt,
        },
      }));
      setNotice("Dictation fields were applied to currently empty Grossing fields.");
    } catch (error) {
      console.error("[GrossingBenchTab] structure:", error);
      setNotice("Grossing dictation structuring failed.");
    } finally {
      setIsAutofilling(false);
    }
  };

  const handlePhotoUpload = async (type, event) => {
    const file = event.target.files?.[0];
    if (!file || !record) return;
    setPhotoUploadType(type);
    setNotice("");
    try {
      const response = await uploadDocument({
        file,
        doctorId,
        patientId,
        hospitalId,
        docType: "grossing_specimen_photo",
        remarks: `Pathology case ${caseId}; specimen ${record.specimen_id}; ${type}`,
      });
      updateRecord((current) => ({
        ...current,
        photographs: {
          ...current.photographs,
          [type]: {
            document_id: response.document?.document_id || "",
            file_name: file.name,
            file_url: response.file_url || "",
            uploaded_at: response.document?.uploaded_at || new Date().toISOString(),
          },
        },
      }));
      setNotice("Grossing photograph uploaded.");
    } catch (error) {
      console.error("[GrossingBenchTab] photograph:", error);
      setNotice("Grossing photograph upload failed.");
    } finally {
      setPhotoUploadType("");
      event.target.value = "";
    }
  };

  const handleValidate = () => {
    setValidationResults([
      ...validateGrossingCompleteness(record, selectedSpecimen),
      ...validateGrossingCAP(record, selectedSpecimen),
    ]);
    setValidationOpen(true);
  };

  const handleSubmit = async () => {
    if (!record) return;
    const selectedIds = record.selected_container_ids || [];
    const latestFor = (containerId) => [...(record.container_verifications || [])]
      .reverse()
      .find((item) => item.container_id === containerId);
    if (!selectedIds.length || selectedIds.some((containerId) => {
      const latest = latestFor(containerId);
      return !latest || (latest.result !== "matched" && latest.result !== "bypassed");
    })) {
      setNotice("Verify every selected container barcode, or bypass verification, before completing Grossing.");
      return;
    }
    setIsSaving(true);
    try {
      const existing = grossing.records.some((item) => item.specimen_id === selectedSpecimenId);
      const working = existing ? grossing : { ...grossing, records: [...grossing.records, record] };
      await onSave("grossing", serializeGrossing(working, specimens, staff));
    } finally {
      setIsSaving(false);
    }
  };

  if (specimens.length === 0) {
    return (
      <Box sx={{ border: `1px solid ${C.border}`, background: C.bgSecondary, p: 3, fontFamily: FONT }}>
        <Typography sx={{ fontFamily: FONT, fontSize: 14, fontWeight: FW_NORMAL, mb: 0.5 }}>
          No accessioned specimens are available for Grossing.
        </Typography>
        <Typography sx={{ fontFamily: FONT, fontSize: 12, color: C.textMuted }}>
          Add and save a specimen in Patient Case Registry and Biopsy / Specimen Accessioning.
        </Typography>
      </Box>
    );
  }

  const specimenOptions = specimens.map((specimen, index) => ({
    value: specimen.specimen_id,
    label: `${specimen.part_label || index + 1} - ${specimen.specimen_type || specimen.anatomic_site || "Unnamed specimen"}`,
  }));
  const containers = selectedSpecimen?.containers || [];
  const latestContainerVerifications = new Map();
  (record.container_verifications || []).forEach((verification) => {
    if (verification?.container_id) latestContainerVerifications.set(verification.container_id, verification);
  });
  const selectedContainerIds = record.selected_container_ids || [];
  const unverifiedContainerIds = selectedContainerIds.filter((containerId) => {
    const latest = latestContainerVerifications.get(containerId);
    return !latest || (latest.result !== "matched" && latest.result !== "bypassed");
  });
  const grossingLocked = selectedContainerIds.length === 0 || unverifiedContainerIds.length > 0;
  const busy = isRecording || isProcessing || isAutofilling
    || !!containerUploadId || !!photoUploadType;

  // Cold ischaemia runs from surgical excision (fall back to collection when the
  // excision time has not been recorded) to the start of formalin fixation.
  const coldIschaemia = (() => {
    const anchor = selectedSpecimen?.surgical_excision_datetime || selectedSpecimen?.collection_datetime;
    const end = selectedSpecimen?.fixation_start_datetime;
    if (!anchor || !end) return "";
    const a = new Date(anchor).getTime();
    const e = new Date(end).getTime();
    if (!Number.isFinite(a) || !Number.isFinite(e) || e < a) return "";
    const minutes = Math.round((e - a) / 60000);
    const basis = selectedSpecimen?.surgical_excision_datetime ? "excision" : "collection";
    return `${minutes} minute${minutes === 1 ? "" : "s"} (${basis} to fixation)`;
  })();

  const selectionSection = (
    <SectionBox title="Specimen Selection and Accession Handoff">
      <FG cols={2}>
        <Box>
          <FieldLabel>Specimen Being Grossed</FieldLabel>
          <Sel
            label="Specimen"
            options={specimenOptions}
            value={selectedSpecimenId}
            onChange={setSelectedSpecimenId}
          />
        </Box>
        <Box>
          <FieldLabel>Grossing Workflow</FieldLabel>
          <Sel
            label="Specimen Class"
            options={SPECIMEN_CLASS_OPTIONS}
            value={record.specimen_class}
            onChange={(value) => updateRecord((current) => ({ ...current, specimen_class: value }))}
            disabled={grossingLocked}
          />
        </Box>
        <SourceValue label="Specimen ID" value={selectedSpecimen?.specimen_id} />
        <SourceValue label="Part Label" value={selectedSpecimen?.part_label} />
        <SourceValue label="Specimen Type" value={selectedSpecimen?.specimen_type} />
        <SourceValue label="Procedure" value={selectedSpecimen?.procedure} />
        <SourceValue
          label="Anatomic Site"
          value={[selectedSpecimen?.anatomic_site, selectedSpecimen?.sub_site].filter(Boolean).join(" - ")}
        />
        <SourceValue label="Laterality" value={selectedSpecimen?.laterality} />
        <SourceValue label="Surgical Excision Date and Time" value={selectedSpecimen?.surgical_excision_datetime} />
        <SourceValue label="Collection Date and Time" value={selectedSpecimen?.collection_datetime} />
        <SourceValue label="Fixation Start Date and Time" value={selectedSpecimen?.fixation_start_datetime} />
        <SourceValue label="Cold-Ischaemia Interval" value={coldIschaemia} />
      </FG>

      <FieldLabel>Source Containers</FieldLabel>
      <Box sx={{ display: "grid", gap: 1.5, mb: 1.5 }}>
        {containers.map((container, index) => {
          const selected = selectedContainerIds.includes(container.container_id);
          const verification = latestContainerVerifications.get(container.container_id);
          const matched = verification?.result === "matched";
          const bypassed = verification?.result === "bypassed";
          const failed = selected && verification && !matched && !bypassed;
          const decodedValues = (verification?.decoded_barcodes || []).map((item) => item.value).filter(Boolean);
          return (
            <Box
              key={container.container_id}
              sx={{
                border: `1px solid ${failed ? "#cf1322" : bypassed && selected ? "#b76e00" : matched && selected ? C.black : C.border}`,
                background: C.white,
                p: 1.5,
              }}
            >
              <Box sx={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 2, flexWrap: "wrap" }}>
                <FormControlLabel
                  control={(
                    <Checkbox
                      checked={selected}
                      onChange={() => toggleContainer(container.container_id)}
                      disabled={containerUploadId === container.container_id}
                      size="small"
                    />
                  )}
                  label={container.container_label || `Container ${index + 1}`}
                  sx={{ m: 0, ".MuiFormControlLabel-label": { fontFamily: FONT, fontSize: 12 } }}
                />
                <Typography sx={{ fontFamily: FONT, fontSize: 10, color: C.textMuted, wordBreak: "break-all" }}>
                  {container.container_id}
                </Typography>
              </Box>
              <Typography sx={{ fontFamily: FONT, fontSize: 11, color: C.textSecond, mt: 0.75 }}>
                {[container.container_type || "Type not recorded", container.fixative_transport_medium || "Medium not recorded"]
                  .join(" | ")}
              </Typography>

              {selected && (
                <Box sx={{ mt: 1.25, pt: 1.25, borderTop: `1px solid ${C.border}` }}>
                  <Box sx={{ display: "flex", alignItems: "center", gap: 1, flexWrap: "wrap" }}>
                    <Button component="label" sx={outlineBtnSx} disabled={!!containerUploadId}>
                      {containerUploadId === container.container_id
                        ? <CircularProgress size={14} sx={{ mr: 1, color: C.black }} />
                        : <UploadFileRounded sx={{ mr: 0.75, fontSize: 16 }} />}
                      {verification ? "Upload New Container Image" : "Upload Container Image"}
                      <input
                        hidden
                        type="file"
                        accept="image/*"
                        onChange={(event) => handleContainerVerificationUpload(container.container_id, event)}
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
                      open={bypassContainerId === container.container_id}
                      reason={bypassReason}
                      onReasonChange={setBypassReason}
                      onConfirm={() => bypassContainerVerification(container.container_id)}
                      onCancel={() => { setBypassContainerId(""); setBypassReason(""); }}
                      onOpen={() => { setBypassContainerId(container.container_id); setBypassReason(""); }}
                      busy={!!containerUploadId}
                    />
                  )}
                </Box>
              )}
            </Box>
          );
        })}
        {containers.length === 0 && <FlagNote>No accessioned containers are recorded for this specimen.</FlagNote>}
      </Box>

      <FormControlLabel
        control={(
          <Checkbox
            checked={!!record.primary_for_reporting}
            onChange={(event) => markPrimary(event.target.checked)}
            disabled={grossingLocked}
            size="small"
          />
        )}
        label="Primary grossing record for downstream reporting"
        sx={{ ".MuiFormControlLabel-label": { fontFamily: FONT, fontSize: 12 } }}
      />
    </SectionBox>
  );

  return (
    <Box sx={{ fontFamily: FONT }}>
      {selectionSection}

      {grossingLocked && (
        <Box sx={{ border: "1px solid #cf1322", background: "#fff1f0", p: 1.5, mb: 2.5 }}>
          <Typography sx={{ display: "flex", alignItems: "center", gap: 0.75, fontFamily: FONT, fontSize: 12, color: "#cf1322" }}>
            <WarningAmberRounded sx={{ fontSize: 17 }} />
            {selectedContainerIds.length === 0
              ? "Select a source container and verify its barcode image to unlock Grossing."
              : "Grossing is locked until every selected container is verified, or an unverifiable barcode is bypassed."}
          </Typography>
        </Box>
      )}

      {notice && (
        <Box sx={{ border: `1px solid ${C.border}`, background: C.bgSecondary, p: 1.5, mb: 2.5 }}>
          <Typography sx={{ fontFamily: FONT, fontSize: 12, color: C.textSecond }}>{notice}</Typography>
        </Box>
      )}

      <Box
        component="fieldset"
        disabled={grossingLocked}
        aria-disabled={grossingLocked}
        sx={{
          border: 0,
          p: 0,
          m: 0,
          minWidth: 0,
          opacity: grossingLocked ? 0.55 : 1,
          pointerEvents: grossingLocked ? "none" : "auto",
        }}
      >
      <SectionBox title="Speech-to-Text Grossing Dictation">
        <TextArea label="Transcript" value={transcript} onChange={setTranscript} rows={4} />
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
            disabled={isProcessing || isAutofilling}
          >
            {isRecording ? <StopRounded sx={{ mr: 0.75, fontSize: 16 }} /> : <MicRounded sx={{ mr: 0.75, fontSize: 16 }} />}
            {isProcessing ? "Processing..." : isRecording ? "Stop Recording" : "Start Recording"}
          </Button>
          <Button sx={outlineBtnSx} onClick={handleAutofill} disabled={busy || !transcript.trim()}>
            {isAutofilling ? <CircularProgress size={14} sx={{ mr: 1, color: C.black }} /> : <AutoAwesomeRounded sx={{ mr: 0.75, fontSize: 16 }} />}
            AI Autofill Empty Fields
          </Button>
        </Box>
      </SectionBox>

      <SectionBox title="Grossing Staff and Common Description">
        <FG cols={2}>
          <Box>
            <FieldLabel>Grossed By</FieldLabel>
            <TextField
              value={record.grossed_by.name}
              onChange={(event) => updateRecord((current) => ({
                ...current,
                grossed_by: { ...current.grossed_by, name: event.target.value },
              }))}
              size="small"
              fullWidth
              sx={inputSx}
            />
          </Box>
          <Box>
            <FieldLabel>Grossing Date and Time</FieldLabel>
            <TextField
              type="datetime-local"
              value={record.grossing_datetime}
              onChange={(event) => updateRecord((current) => ({ ...current, grossing_datetime: event.target.value }))}
              onFocus={() => {
                if (!record.grossing_datetime) updateRecord((current) => ({ ...current, grossing_datetime: localDateTimeValue() }));
              }}
              size="small"
              fullWidth
              InputLabelProps={{ shrink: true }}
              sx={inputSx}
            />
          </Box>
          <NumberField label="Specimen Length (mm)" value={record.common.dimensions_mm.length_mm} onChange={(value) => updateCommonDimension("length_mm", value)} />
          <NumberField label="Specimen Width (mm)" value={record.common.dimensions_mm.width_mm} onChange={(value) => updateCommonDimension("width_mm", value)} />
          <NumberField label="Specimen Depth / Thickness (mm)" value={record.common.dimensions_mm.depth_mm} onChange={(value) => updateCommonDimension("depth_mm", value)} />
          <NumberField label="Specimen Weight (g)" value={record.common.weight_g} onChange={(value) => updateCommon("weight_g", value)} />
        </FG>
        <FG cols={2}>
          <TextArea label="External Surface Description" value={record.common.external_surface_description} onChange={(value) => updateCommon("external_surface_description", value)} />
          <TextArea label="Cut Surface Description" value={record.common.cut_surface_description} onChange={(value) => updateCommon("cut_surface_description", value)} />
          <TextArea label="Specimen Orientation" value={record.common.orientation} onChange={(value) => updateCommon("orientation", value)} placeholder="Orientation supplied by surgeon or established at grossing" />
          <TextArea label="Identifying Sutures / Clips / Markers" value={record.common.identifying_markers} onChange={(value) => updateCommon("identifying_markers", value)} />
        </FG>
        <TextArea label="Gross Description" value={record.common.gross_description} onChange={(value) => updateCommon("gross_description", value)} rows={4} />
      </SectionBox>

      {record.specimen_class === "Small biopsy" && (
        <SectionBox title="Small Biopsy Submission">
          <FG cols={2}>
            <NumberField label="Number of Cores / Fragments / Tissue Bits" value={record.biopsy.tissue_count} onChange={(value) => updateBiopsy("tissue_count", value)} />
            <Box>
              <FieldLabel>Measurement Basis</FieldLabel>
              <Sel label="Measurement Basis" options={BIOPSY_MEASUREMENT_OPTIONS} value={record.biopsy.measurement_basis} onChange={(value) => updateBiopsy("measurement_basis", value)} />
            </Box>
            <NumberField label="Tissue Length (mm)" value={record.biopsy.dimensions_mm.length_mm} onChange={(value) => updateBiopsyDimension("length_mm", value)} />
            <NumberField label="Tissue Width (mm)" value={record.biopsy.dimensions_mm.width_mm} onChange={(value) => updateBiopsyDimension("width_mm", value)} />
            <NumberField label="Tissue Depth / Thickness (mm)" value={record.biopsy.dimensions_mm.depth_mm} onChange={(value) => updateBiopsyDimension("depth_mm", value)} />
            <Box>
              <FieldLabel>Entire Specimen Submitted</FieldLabel>
              <Sel label="Entire Specimen Submitted" options={YES_NO_OPTIONS} value={record.biopsy.entire_specimen_submitted} onChange={(value) => updateBiopsy("entire_specimen_submitted", value)} />
            </Box>
            <Box>
              <FieldLabel>Handling Method</FieldLabel>
              <Sel label="Handling Method" options={BIOPSY_HANDLING_OPTIONS} value={record.biopsy.handling_method} onChange={(value) => updateBiopsy("handling_method", value)} />
            </Box>
            {record.biopsy.handling_method === "Other" && (
              <Box>
                <FieldLabel>Other Handling Method</FieldLabel>
                <TextField value={record.biopsy.handling_method_other} onChange={(event) => updateBiopsy("handling_method_other", event.target.value)} size="small" fullWidth sx={inputSx} />
              </Box>
            )}
          </FG>
        </SectionBox>
      )}

      {record.specimen_class === "Large specimen / resection" && (
        <>
          <SectionBox title="Lesion and Tumor Description">
            <FG cols={2}>
              <Box>
                <FieldLabel>Lesion / Tumor Location</FieldLabel>
                <TextField value={record.resection.lesion_location} onChange={(event) => updateResection("lesion_location", event.target.value)} size="small" fullWidth sx={inputSx} />
              </Box>
              <Box>
                <FieldLabel>Tumor Border</FieldLabel>
                <Sel label="Tumor Border" options={TUMOR_BORDER_OPTIONS} value={record.resection.tumor_border} onChange={(value) => updateResection("tumor_border", value)} />
              </Box>
              <NumberField label="Tumor Length (mm)" value={record.resection.tumor_dimensions_mm.length_mm} onChange={(value) => updateTumorDimension("length_mm", value)} />
              <NumberField label="Tumor Width (mm)" value={record.resection.tumor_dimensions_mm.width_mm} onChange={(value) => updateTumorDimension("width_mm", value)} />
              <NumberField label="Tumor Depth (mm)" value={record.resection.tumor_dimensions_mm.depth_mm} onChange={(value) => updateTumorDimension("depth_mm", value)} />
              <Box>
                <FieldLabel>Tumor Configuration</FieldLabel>
                <Sel label="Tumor Configuration" options={TUMOR_CONFIGURATION_OPTIONS} value={record.resection.tumor_configuration} onChange={(value) => updateResection("tumor_configuration", value)} />
              </Box>
            </FG>
            <FG cols={2}>
              <TextArea label="Necrosis" value={record.resection.necrosis} onChange={(value) => updateResection("necrosis", value)} />
              <TextArea label="Hemorrhage" value={record.resection.hemorrhage} onChange={(value) => updateResection("hemorrhage", value)} />
              <TextArea label="Cystic Change" value={record.resection.cystic_change} onChange={(value) => updateResection("cystic_change", value)} />
              <TextArea label="Relationship to Surrounding Structures" value={record.resection.relationship_to_surrounding_structures} onChange={(value) => updateResection("relationship_to_surrounding_structures", value)} />
            </FG>
          </SectionBox>

          <SectionBox title="Specimen-Specific Margins and Ink Map">
            {record.resection.margins.map((margin, index) => (
              <Box key={margin.margin_id} sx={{ border: `1px solid ${C.border}`, p: 2, mb: 1.5, background: C.white }}>
                <ItemHeader title={`Margin ${index + 1}`} subtitle={margin.margin_id} onRemove={() => removeMargin(margin.margin_id)} />
                <FG cols={2}>
                  <Box>
                    <FieldLabel>Margin Name</FieldLabel>
                    <TextField value={margin.name} onChange={(event) => updateMargin(margin.margin_id, "name", event.target.value)} size="small" fullWidth placeholder="e.g. proximal, deep, radial" sx={inputSx} />
                  </Box>
                  <NumberField label="Tumor-to-Margin Distance (mm)" value={margin.distance_mm} onChange={(value) => updateMargin(margin.margin_id, "distance_mm", value)} />
                  <Box>
                    <FieldLabel>Ink Color</FieldLabel>
                    <TextField value={margin.ink_color} onChange={(event) => updateMargin(margin.margin_id, "ink_color", event.target.value)} size="small" fullWidth sx={inputSx} />
                  </Box>
                  <Box>
                    <FieldLabel>Comments</FieldLabel>
                    <TextField value={margin.comments} onChange={(event) => updateMargin(margin.margin_id, "comments", event.target.value)} size="small" fullWidth sx={inputSx} />
                  </Box>
                </FG>
              </Box>
            ))}
            <Button sx={outlineBtnSx} onClick={addMargin}>
              <AddRounded sx={{ mr: 0.75, fontSize: 16 }} /> Add Margin
            </Button>
          </SectionBox>

          <SectionBox title="Lymph Nodes Identified at Grossing">
            <FG cols={2}>
              <NumberField label="Total Lymph Nodes Identified" value={record.resection.lymph_nodes_identified} onChange={(value) => updateResection("lymph_nodes_identified", value)} />
            </FG>
            {record.resection.lymph_node_groups.map((group, index) => (
              <Box key={group.lymph_node_group_id} sx={{ border: `1px solid ${C.border}`, p: 2, mb: 1.5, background: C.white }}>
                <ItemHeader title={`Lymph Node Group ${index + 1}`} subtitle={group.lymph_node_group_id} onRemove={() => removeLymphNodeGroup(group.lymph_node_group_id)} />
                <FG cols={2}>
                  <Box>
                    <FieldLabel>Group / Station</FieldLabel>
                    <TextField value={group.name} onChange={(event) => updateLymphNodeGroup(group.lymph_node_group_id, "name", event.target.value)} size="small" fullWidth sx={inputSx} />
                  </Box>
                  <NumberField label="Nodes Identified in Group" value={group.count_identified} onChange={(value) => updateLymphNodeGroup(group.lymph_node_group_id, "count_identified", value)} />
                </FG>
                <TextArea label="Gross Appearance" value={group.gross_appearance} onChange={(value) => updateLymphNodeGroup(group.lymph_node_group_id, "gross_appearance", value)} />
              </Box>
            ))}
            <Button sx={outlineBtnSx} onClick={addLymphNodeGroup}>
              <AddRounded sx={{ mr: 0.75, fontSize: 16 }} /> Add Lymph Node Group
            </Button>
            <FlagNote>Microscopic nodes examined and positive-node counts are recorded in the later report, not at Grossing.</FlagNote>
          </SectionBox>
        </>
      )}

      <SectionBox title="Cassettes and Tissue Sampling">
        <Box sx={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 2, mb: 1.5, flexWrap: "wrap" }}>
          <Typography sx={{ fontFamily: FONT, fontSize: 12, color: C.textSecond }}>
            Cassettes submitted: {record.cassettes.length}
          </Typography>
          <Button sx={outlineBtnSx} onClick={addCassette}>
            <AddRounded sx={{ mr: 0.75, fontSize: 16 }} /> Add Cassette
          </Button>
        </Box>
        {record.cassettes.map((cassette, index) => (
          <Box key={cassette.cassette_id} sx={{ border: `1px solid ${C.border}`, p: 2, mb: 1.5, background: C.white }}>
            <ItemHeader title={`Cassette ${index + 1}`} subtitle={cassette.cassette_id} onRemove={() => removeCassette(cassette.cassette_id)} />
            <Box sx={{ mb: 1.5 }}>
              <FieldLabel>Cassette Barcode</FieldLabel>
              <Code128Barcode value={cassette.cassette_id} accessionId={accessionId} />
            </Box>
            <FG cols={2}>
              <Box>
                <FieldLabel>Cassette Label</FieldLabel>
                <TextField value={cassette.label} onChange={(event) => updateCassette(cassette.cassette_id, "label", event.target.value)} size="small" fullWidth sx={inputSx} />
              </Box>
              <SourceValue label="Parent Specimen ID" value={cassette.parent_specimen_id} />
              <TextArea label="Tissue Submitted" value={cassette.tissue_description} onChange={(value) => updateCassette(cassette.cassette_id, "tissue_description", value)} />
              <TextArea label="Sampling Purpose" value={cassette.sampling_purpose} onChange={(value) => updateCassette(cassette.cassette_id, "sampling_purpose", value)} placeholder="e.g. tumor, closest margin, representative normal tissue" />
            </FG>
            <TextArea label="Special Instructions" value={cassette.special_instructions} onChange={(value) => updateCassette(cassette.cassette_id, "special_instructions", value)} />
          </Box>
        ))}
      </SectionBox>

      {record.specimen_class === "Large specimen / resection" && (
        <SectionBox title="Grossing Images and Tissue Allocation">
          <input ref={beforePhotoRef} type="file" accept="image/*" style={{ display: "none" }} onChange={(event) => handlePhotoUpload("before_sectioning", event)} />
          <input ref={afterPhotoRef} type="file" accept="image/*" style={{ display: "none" }} onChange={(event) => handlePhotoUpload("after_sectioning", event)} />
          <Box sx={{ display: "flex", gap: 1.5, flexWrap: "wrap", mb: 2 }}>
            <Button sx={outlineBtnSx} onClick={() => beforePhotoRef.current?.click()} disabled={busy}>
              {photoUploadType === "before_sectioning" ? <CircularProgress size={14} sx={{ mr: 1, color: C.black }} /> : <UploadFileRounded sx={{ mr: 0.75, fontSize: 16 }} />}
              Before Sectioning Photo
            </Button>
            <Button sx={outlineBtnSx} onClick={() => afterPhotoRef.current?.click()} disabled={busy}>
              {photoUploadType === "after_sectioning" ? <CircularProgress size={14} sx={{ mr: 1, color: C.black }} /> : <UploadFileRounded sx={{ mr: 0.75, fontSize: 16 }} />}
              After Sectioning Photo
            </Button>
          </Box>
          <FG cols={2}>
            <SourceValue label="Before Sectioning File" value={record.photographs.before_sectioning?.file_name} />
            <SourceValue label="After Sectioning File" value={record.photographs.after_sectioning?.file_name} />
            <Box>
              <FieldLabel>Specimen X-ray / Mammogram / Imaging Reference</FieldLabel>
              <TextField value={record.resection.imaging_reference} onChange={(event) => updateResection("imaging_reference", event.target.value)} size="small" fullWidth sx={inputSx} />
            </Box>
            <Box>
              <FieldLabel>Tissue Allocated for Biobank / Frozen Storage</FieldLabel>
              <Sel label="Tissue Allocation" options={BIOBANK_ALLOCATION_OPTIONS} value={record.resection.biobank_or_frozen_allocation} onChange={(value) => updateResection("biobank_or_frozen_allocation", value)} />
            </Box>
          </FG>
          {record.resection.biobank_or_frozen_allocation === "Yes" && (
            <TextArea label="Allocation Details" value={record.resection.allocation_details} onChange={(value) => updateResection("allocation_details", value)} />
          )}
        </SectionBox>
      )}

      <SectionBox title="Grossing Handoff Status">
        <FG cols={2}>
          <Box>
            <FieldLabel>Record Status</FieldLabel>
            <Sel label="Record Status" options={["Draft", "Completed", "On hold"]} value={record.status} onChange={(value) => updateRecord((current) => ({ ...current, status: value }))} />
          </Box>
          <SourceValue label="Cassette Count" value={String(record.cassettes.length)} />
        </FG>
      </SectionBox>

      <Box sx={{ display: "flex", gap: 1.5, flexWrap: "wrap" }}>
        <Button sx={outlineBtnSx} onClick={handleValidate}>
          <FactCheckRounded sx={{ mr: 0.75, fontSize: 16 }} /> Review Completeness
        </Button>
        <Button sx={saveBtnSx} onClick={handleSubmit} disabled={isSaving || busy}>
          {isSaving ? <CircularProgress size={14} sx={{ mr: 1, color: C.white }} /> : <SaveRounded sx={{ mr: 0.75, fontSize: 16 }} />}
          Save Grossing
        </Button>
      </Box>
      </Box>

      <CapValidationDialog
        open={validationOpen}
        onClose={() => setValidationOpen(false)}
        title="Grossing Completeness Review"
        results={validationResults}
      />
    </Box>
  );
}
