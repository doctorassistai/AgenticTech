import React, { useRef } from "react";
import {
  Box, Typography, TextField, Button, IconButton, CircularProgress,
} from "@mui/material";
import {
  AddRounded, DeleteOutlineRounded, UploadFileRounded, ImageRounded,
} from "@mui/icons-material";
import {
  C, FONT, FW_NORMAL, inputSx, outlineBtnSx,
} from "../../surgical-oncology/shared/designTokens";
import { SectionBox, FieldLabel, Sel } from "../../surgical-oncology/shared/FormComponents";
import {
  ACCESSION_CONTAINER_TYPES,
  DEPARTMENTS,
  FIXATIVE_TRANSPORT_OPTIONS,
  LATERALITY_OPTIONS,
  SPECIMEN_INTEGRITY_OPTIONS,
  SPECIMEN_TYPE_OPTIONS,
  VERIFICATION_OPTIONS,
  YES_NO_UNKNOWN_OPTIONS,
} from "../constants";
import { makeContainer, makeSpecimen } from "../shared/caseRegistryModel";
import Code128Barcode from "../shared/Code128Barcode";

const gridSx = {
  display: "grid",
  gridTemplateColumns: { xs: "1fr", lg: "repeat(2, minmax(0, 1fr))" },
  gap: 2,
};

// Cold ischaemia runs from surgical excision (fall back to collection when the
// excision time has not been recorded) to the start of formalin fixation.
// ASCO/CAP guidance is <1 h for hormone-receptor testing, so intervals beyond
// 60 minutes are flagged as a warning. Ordering violations are errors.
const COLD_ISCHAEMIA_WARN_MIN = 60;

const getTimingNote = (specimen) => {
  if (specimen.collection_datetime && specimen.received_datetime) {
    const collected = new Date(specimen.collection_datetime).getTime();
    const received = new Date(specimen.received_datetime).getTime();
    if (Number.isFinite(collected) && Number.isFinite(received) && received < collected) {
      return { message: "Receipt time is earlier than collection time.", tone: "error" };
    }
  }

  if (specimen.fixation_start_datetime) {
    const fixation = new Date(specimen.fixation_start_datetime).getTime();
    if (Number.isFinite(fixation)) {
      const usesExcision = !!specimen.surgical_excision_datetime;
      const anchorRaw = usesExcision
        ? specimen.surgical_excision_datetime
        : specimen.collection_datetime;
      if (anchorRaw) {
        const anchor = new Date(anchorRaw).getTime();
        if (Number.isFinite(anchor)) {
          const basis = usesExcision ? "excision" : "collection";
          if (fixation < anchor) {
            return { message: `Fixation start time is earlier than ${basis} time.`, tone: "error" };
          }
          const minutes = Math.round((fixation - anchor) / 60000);
          if (minutes > COLD_ISCHAEMIA_WARN_MIN) {
            return {
              message: `Cold-ischaemia interval (${basis} to fixation): ${minutes} minutes — exceeds the 60-minute CAP/ASCO recommendation for receptor testing.`,
              tone: "warning",
            };
          }
          return {
            message: `Recorded cold-ischaemia interval (${basis} to fixation): ${minutes} minute${minutes === 1 ? "" : "s"}.`,
            tone: "info",
          };
        }
      }
    }
  }
  return null;
};

const timingTone = {
  error: { color: "#cf1322", border: "#cf1322", background: "#fff1f0" },
  warning: { color: "#b76e00", border: "#b76e00", background: "#fff8e6" },
  info: { color: C.textSecond, border: C.border, background: C.bgSecondary },
};

const PhotoUploadButton = ({ specimen, isUploading, onUpload }) => {
  const inputRef = useRef(null);
  return (
    <Box>
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        style={{ display: "none" }}
        onChange={(event) => onUpload(specimen.specimen_id, event.target.files?.[0], event)}
      />
      <Button
        sx={outlineBtnSx}
        onClick={() => inputRef.current?.click()}
        disabled={isUploading}
      >
        {isUploading
          ? <CircularProgress size={14} sx={{ mr: 1, color: C.black }} />
          : <UploadFileRounded sx={{ mr: 0.75, fontSize: 16 }} />}
        Upload Receipt Photo
      </Button>
    </Box>
  );
};

export default function SpecimenAccessioningSection({
  specimens,
  setSpecimens,
  accessionId,
  photoUploadId,
  onPhotoUpload,
}) {
  const updateSpecimen = (specimenId, key, value) => {
    setSpecimens((current) => current.map((specimen) =>
      specimen.specimen_id === specimenId ? { ...specimen, [key]: value } : specimen
    ));
  };

  const updateContainer = (specimenId, containerId, key, value) => {
    setSpecimens((current) => current.map((specimen) => {
      if (specimen.specimen_id !== specimenId) return specimen;
      return {
        ...specimen,
        containers: specimen.containers.map((container) =>
          container.container_id === containerId ? { ...container, [key]: value } : container
        ),
      };
    }));
  };

  const addSpecimen = () => {
    setSpecimens((current) => [...current, makeSpecimen(current.length)]);
  };

  const removeSpecimen = (specimenId) => {
    setSpecimens((current) => current.filter((specimen) => specimen.specimen_id !== specimenId));
  };

  const addContainer = (specimenId) => {
    setSpecimens((current) => current.map((specimen) => {
      if (specimen.specimen_id !== specimenId) return specimen;
      return {
        ...specimen,
        containers: [...specimen.containers, makeContainer(specimen.containers.length)],
      };
    }));
  };

  const removeContainer = (specimenId, containerId) => {
    setSpecimens((current) => current.map((specimen) => {
      if (specimen.specimen_id !== specimenId) return specimen;
      return {
        ...specimen,
        containers: specimen.containers.filter((container) => container.container_id !== containerId),
      };
    }));
  };

  return (
    <SectionBox title="Biopsy / Specimen Accessioning">
      <Box sx={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 2, mb: 2, flexWrap: "wrap" }}>
        <Typography sx={{ fontSize: 12, color: C.textSecond, fontFamily: FONT }}>
          Record each received specimen separately. Container totals are calculated from the records below.
        </Typography>
        <Button sx={outlineBtnSx} onClick={addSpecimen}>
          <AddRounded sx={{ mr: 0.75, fontSize: 16 }} />
          Add Specimen
        </Button>
      </Box>

      {specimens.length === 0 && (
        <Box sx={{ border: `1px dashed ${C.border}`, p: 3, textAlign: "center", background: C.bgSecondary }}>
          <Typography sx={{ fontSize: 12, color: C.textSecond, fontFamily: FONT, mb: 1.5 }}>
            No specimen has been accessioned for this case yet.
          </Typography>
          <Button sx={outlineBtnSx} onClick={addSpecimen}>
            <AddRounded sx={{ mr: 0.75, fontSize: 16 }} />
            Add First Specimen
          </Button>
        </Box>
      )}

      {specimens.map((specimen, specimenIndex) => {
        const timingNote = getTimingNote(specimen);
        const hasDiscrepancy = [
          specimen.patient_specimen_label_verification === "Discrepancy",
          specimen.specimen_integrity === "Inadequate",
          specimen.specimen_integrity === "Compromised",
        ].some(Boolean);

        return (
          <Box key={specimen.specimen_id} sx={{ border: `1px solid ${C.border}`, mb: 2, background: C.white }}>
            <Box sx={{ px: 2, py: 1.25, background: C.bgSecondary, borderBottom: `1px solid ${C.border}`, display: "flex", alignItems: "center", justifyContent: "space-between", gap: 2 }}>
              <Box>
                <Typography sx={{ fontSize: 12, fontFamily: FONT, fontWeight: FW_NORMAL }}>
                  Specimen {specimenIndex + 1} {specimen.part_label ? `- Part ${specimen.part_label}` : ""}
                </Typography>
                <Typography sx={{ fontSize: 10, color: C.textMuted, fontFamily: FONT, mt: 0.25, wordBreak: "break-all" }}>
                  {specimen.specimen_id}
                </Typography>
              </Box>
              <IconButton
                size="small"
                onClick={() => removeSpecimen(specimen.specimen_id)}
                title="Remove specimen"
                sx={{ color: C.textSecond }}
              >
                <DeleteOutlineRounded sx={{ fontSize: 18 }} />
              </IconButton>
            </Box>

            <Box sx={{ p: 2 }}>
              <Box sx={gridSx}>
                <Box>
                  <FieldLabel>Part Label</FieldLabel>
                  <TextField value={specimen.part_label} onChange={(e) => updateSpecimen(specimen.specimen_id, "part_label", e.target.value)} size="small" fullWidth placeholder="A" sx={inputSx} />
                </Box>
                <Box>
                  <FieldLabel>Specimen Type</FieldLabel>
                  <Sel label="Specimen Type" options={SPECIMEN_TYPE_OPTIONS} value={specimen.specimen_type} onChange={(value) => updateSpecimen(specimen.specimen_id, "specimen_type", value)} />
                </Box>
                <Box>
                  <FieldLabel>Procedure</FieldLabel>
                  <TextField value={specimen.procedure} onChange={(e) => updateSpecimen(specimen.specimen_id, "procedure", e.target.value)} size="small" fullWidth placeholder="Procedure performed" sx={inputSx} />
                </Box>
                <Box>
                  <FieldLabel>Patient / Specimen Label</FieldLabel>
                  <Sel label="Verification" options={VERIFICATION_OPTIONS} value={specimen.patient_specimen_label_verification} onChange={(value) => updateSpecimen(specimen.specimen_id, "patient_specimen_label_verification", value)} />
                </Box>
                <Box>
                  <FieldLabel>Anatomic Site</FieldLabel>
                  <TextField value={specimen.anatomic_site} onChange={(e) => updateSpecimen(specimen.specimen_id, "anatomic_site", e.target.value)} size="small" fullWidth sx={inputSx} />
                </Box>
                <Box>
                  <FieldLabel>Sub-site</FieldLabel>
                  <TextField value={specimen.sub_site} onChange={(e) => updateSpecimen(specimen.specimen_id, "sub_site", e.target.value)} size="small" fullWidth sx={inputSx} />
                </Box>
                <Box>
                  <FieldLabel>Laterality</FieldLabel>
                  <Sel label="Laterality" options={LATERALITY_OPTIONS} value={specimen.laterality} onChange={(value) => updateSpecimen(specimen.specimen_id, "laterality", value)} />
                </Box>
                <Box>
                  <FieldLabel>Specimen Integrity</FieldLabel>
                  <Sel label="Integrity" options={SPECIMEN_INTEGRITY_OPTIONS} value={specimen.specimen_integrity} onChange={(value) => updateSpecimen(specimen.specimen_id, "specimen_integrity", value)} />
                </Box>
                <Box>
                  <FieldLabel>Surgical Excision Date and Time</FieldLabel>
                  <TextField type="datetime-local" value={specimen.surgical_excision_datetime} onChange={(e) => updateSpecimen(specimen.specimen_id, "surgical_excision_datetime", e.target.value)} size="small" fullWidth InputLabelProps={{ shrink: true }} sx={inputSx} />
                </Box>
                <Box>
                  <FieldLabel>Collection Date and Time</FieldLabel>
                  <TextField type="datetime-local" value={specimen.collection_datetime} onChange={(e) => updateSpecimen(specimen.specimen_id, "collection_datetime", e.target.value)} size="small" fullWidth InputLabelProps={{ shrink: true }} sx={inputSx} />
                </Box>
                <Box>
                  <FieldLabel>Receipt Date and Time</FieldLabel>
                  <TextField type="datetime-local" value={specimen.received_datetime} onChange={(e) => updateSpecimen(specimen.specimen_id, "received_datetime", e.target.value)} size="small" fullWidth InputLabelProps={{ shrink: true }} sx={inputSx} />
                </Box>
                <Box>
                  <FieldLabel>Fixation Start Date and Time</FieldLabel>
                  <TextField type="datetime-local" value={specimen.fixation_start_datetime} onChange={(e) => updateSpecimen(specimen.specimen_id, "fixation_start_datetime", e.target.value)} size="small" fullWidth InputLabelProps={{ shrink: true }} sx={inputSx} />
                </Box>
                <Box>
                  <FieldLabel>Received by Laboratory Technician</FieldLabel>
                  <TextField value={specimen.received_by} onChange={(e) => updateSpecimen(specimen.specimen_id, "received_by", e.target.value)} size="small" fullWidth sx={inputSx} />
                </Box>
                <Box>
                  <FieldLabel>Procedure Performed By</FieldLabel>
                  <TextField value={specimen.procedure_performed_by} onChange={(e) => updateSpecimen(specimen.specimen_id, "procedure_performed_by", e.target.value)} size="small" fullWidth sx={inputSx} />
                </Box>
                <Box>
                  <FieldLabel>Performing Department</FieldLabel>
                  <Sel label="Department" options={DEPARTMENTS} value={specimen.performing_department} onChange={(value) => updateSpecimen(specimen.specimen_id, "performing_department", value)} />
                </Box>
                <Box>
                  <FieldLabel>Imaging Guidance Used</FieldLabel>
                  <Sel label="Imaging Guidance" options={YES_NO_UNKNOWN_OPTIONS} value={specimen.imaging_guidance_used} onChange={(value) => updateSpecimen(specimen.specimen_id, "imaging_guidance_used", value)} />
                </Box>
                <Box>
                  <FieldLabel>Biopsy Clip / Marker Placed</FieldLabel>
                  <Sel label="Clip / Marker" options={YES_NO_UNKNOWN_OPTIONS} value={specimen.biopsy_clip_marker_placed} onChange={(value) => updateSpecimen(specimen.specimen_id, "biopsy_clip_marker_placed", value)} />
                </Box>
                <Box sx={{ gridColumn: { lg: "1 / -1" } }}>
                  <FieldLabel>Imaging Report Reference</FieldLabel>
                  <TextField value={specimen.imaging_report_reference} onChange={(e) => updateSpecimen(specimen.specimen_id, "imaging_report_reference", e.target.value)} size="small" fullWidth placeholder="Study/report ID or link" sx={inputSx} />
                </Box>
                {(hasDiscrepancy || specimen.integrity_discrepancy_reason) && (
                  <Box sx={{ gridColumn: { lg: "1 / -1" } }}>
                    <FieldLabel>Integrity / Label Discrepancy Reason</FieldLabel>
                    <TextField value={specimen.integrity_discrepancy_reason} onChange={(e) => updateSpecimen(specimen.specimen_id, "integrity_discrepancy_reason", e.target.value)} size="small" fullWidth multiline minRows={2} sx={inputSx} />
                  </Box>
                )}
              </Box>

              {timingNote && (
                <Box sx={{ mt: 2, px: 1.5, py: 1, border: `1px solid ${timingTone[timingNote.tone].border}`, background: timingTone[timingNote.tone].background }}>
                  <Typography sx={{ fontSize: 11, color: timingTone[timingNote.tone].color, fontFamily: FONT }}>
                    {timingNote.message}
                  </Typography>
                </Box>
              )}

              <Box sx={{ mt: 2.5, mb: 1.5, display: "flex", alignItems: "center", justifyContent: "space-between", gap: 2, flexWrap: "wrap" }}>
                <Typography sx={{ fontSize: 11, textTransform: "uppercase", letterSpacing: "0.12em", fontFamily: FONT }}>
                  Containers ({specimen.containers.length})
                </Typography>
                <Button sx={{ ...outlineBtnSx, px: 2, py: 0.6 }} onClick={() => addContainer(specimen.specimen_id)}>
                  <AddRounded sx={{ mr: 0.5, fontSize: 15 }} />
                  Add Container
                </Button>
              </Box>

              {specimen.containers.map((container, containerIndex) => (
                <Box key={container.container_id} sx={{ borderTop: `1px solid ${C.border}`, pt: 1.5, pb: 1 }}>
                  <Box sx={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 1, mb: 1 }}>
                    <Typography sx={{ fontSize: 11, color: C.textSecond, fontFamily: FONT }}>
                      Container {containerIndex + 1}
                    </Typography>
                    <IconButton size="small" onClick={() => removeContainer(specimen.specimen_id, container.container_id)} title="Remove container" sx={{ color: C.textSecond }}>
                      <DeleteOutlineRounded sx={{ fontSize: 17 }} />
                    </IconButton>
                  </Box>
                  <Box sx={{ mb: 1.5 }}>
                    <FieldLabel>Container Barcode</FieldLabel>
                    <Code128Barcode value={container.container_id} accessionId={accessionId} />
                  </Box>
                  <Box sx={gridSx}>
                    {container.external_label && (
                      <Box>
                        <FieldLabel>External / Surgical Label</FieldLabel>
                        <TextField
                          value={container.external_label}
                          size="small"
                          fullWidth
                          InputProps={{ readOnly: true }}
                          sx={inputSx}
                        />
                      </Box>
                    )}
                    <Box>
                      <FieldLabel>Pathology Container Label</FieldLabel>
                      <TextField value={container.container_label} onChange={(e) => updateContainer(specimen.specimen_id, container.container_id, "container_label", e.target.value)} size="small" fullWidth placeholder={`Container ${containerIndex + 1}`} sx={inputSx} />
                    </Box>
                    <Box>
                      <FieldLabel>Container Type</FieldLabel>
                      <Sel label="Container Type" options={ACCESSION_CONTAINER_TYPES} value={container.container_type} onChange={(value) => updateContainer(specimen.specimen_id, container.container_id, "container_type", value)} />
                    </Box>
                    <Box>
                      <FieldLabel>Fixative / Transport Medium</FieldLabel>
                      <Sel label="Fixative / Medium" options={FIXATIVE_TRANSPORT_OPTIONS} value={container.fixative_transport_medium} onChange={(value) => updateContainer(specimen.specimen_id, container.container_id, "fixative_transport_medium", value)} />
                    </Box>
                    <Box>
                      <FieldLabel>Container Label Verification</FieldLabel>
                      <Sel label="Verification" options={VERIFICATION_OPTIONS} value={container.label_verification} onChange={(value) => updateContainer(specimen.specimen_id, container.container_id, "label_verification", value)} />
                    </Box>
                    <Box sx={{ gridColumn: { lg: "1 / -1" } }}>
                      <FieldLabel>Container Comments</FieldLabel>
                      <TextField value={container.comments} onChange={(e) => updateContainer(specimen.specimen_id, container.container_id, "comments", e.target.value)} size="small" fullWidth sx={inputSx} />
                    </Box>
                  </Box>
                </Box>
              ))}

              <Box sx={{ mt: 2, display: "flex", alignItems: "center", gap: 1.5, flexWrap: "wrap" }}>
                <PhotoUploadButton specimen={specimen} isUploading={photoUploadId === specimen.specimen_id} onUpload={onPhotoUpload} />
                {specimen.receipt_photo?.file_url && (
                  <Box sx={{ display: "flex", alignItems: "center", gap: 0.75, minWidth: 0 }}>
                    <ImageRounded sx={{ fontSize: 16, color: C.textSecond }} />
                    <Typography sx={{ fontSize: 11, fontFamily: FONT, color: C.textSecond, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: 320 }}>
                      {specimen.receipt_photo.file_name || "Receipt photo uploaded"}
                    </Typography>
                  </Box>
                )}
              </Box>
            </Box>
          </Box>
        );
      })}
    </SectionBox>
  );
}
