import React, { useState } from "react";
import { Box, Button, CircularProgress, Typography } from "@mui/material";
import { HistoryRounded, RefreshRounded } from "@mui/icons-material";
import { C, FONT, FW_NORMAL, outlineBtnSx } from "../shared/designTokens";
import { FieldLabel, FlagNote } from "../shared/FormComponents";
import { refreshClinicalPosture } from "./shared/api";

/**
 * Read-only display of the deterministic clinical posture that the advisory
 * engines reasoned from.
 *
 * Everything here was computed in Python (`users/patient_data/pathology_posture.py`)
 * from the patient's own treatment and investigation records — no model was
 * involved. It is shown so the pathologist can see WHY the assistant said what it
 * said, which is the whole point of the posture layer.
 *
 * Two deliberate limits, both visible in the UI rather than hidden:
 *  • `imaging_on_record` lists studies only. It carries no body-region coverage,
 *    so nothing here claims a region was or was not assessed.
 *  • `expected_spread_regions` sits beside it as reference. The comparison is the
 *    PATHOLOGIST'S to make; neither this panel nor the engine performs it, and
 *    neither recommends an investigation.
 */

const Pair = ({ label, value }) => (
  <Box sx={{ minWidth: 150, mr: 3, mb: 1 }}>
    <Typography sx={{ fontFamily: FONT, fontSize: 10, letterSpacing: "0.08em", textTransform: "uppercase", color: C.textMuted }}>
      {label}
    </Typography>
    <Typography sx={{ fontFamily: FONT, fontSize: 12, color: C.textPrimary, mt: 0.25 }}>{value}</Typography>
  </Box>
);

const STATUS_LABEL = {
  treatment_naive: "Treatment-naive",
  on_treatment: "On treatment",
  post_treatment: "Post treatment",
  unknown: "Unknown",
};

// A tri-state field is null when the record could not answer the question. That
// is deliberately NOT rendered as "No" — see the posture module's rule that
// missing data never becomes a negative finding.
const triState = (value) => (value === true ? "Yes" : value === false ? "No" : "Undetermined");

const snapshotAge = (derivedAt) => {
  if (!derivedAt) return "";
  const then = new Date(derivedAt);
  if (Number.isNaN(then.getTime())) return "";
  const hours = Math.floor((Date.now() - then.getTime()) / 3600000);
  if (hours < 1) return "just now";
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
};

export default function ClinicalPosturePanel({ posture, caseId, onRefreshed, showSpreadReference = true }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  if (!posture || !Object.keys(posture).length) return null;

  const radiotherapy = posture.radiotherapy || {};
  const chemotherapy = posture.chemotherapy || {};
  const imaging = posture.imaging_on_record || [];
  const treatments = posture.prior_treatments || [];
  const gaps = posture.data_gaps || [];

  const handleRefresh = async () => {
    if (!caseId) return;
    setBusy(true);
    setError("");
    try {
      const response = await refreshClinicalPosture(caseId);
      if (onRefreshed) onRefreshed(response?.data || {});
    } catch (err) {
      setError(err?.message || "Could not refresh the clinical posture.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Box sx={{ border: `1px solid ${C.border}`, background: C.bgSecondary, p: 1.5, mb: 2 }}>
      <Box sx={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 2, flexWrap: "wrap", mb: 1 }}>
        <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
          <HistoryRounded sx={{ fontSize: 17, color: C.black }} />
          <Typography sx={{ fontFamily: FONT, fontSize: 12, fontWeight: FW_NORMAL }}>
            Clinical posture — derived from the patient record, not by the model
          </Typography>
        </Box>
        <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
          {posture.derived_at && (
            <Typography sx={{ fontFamily: FONT, fontSize: 11, color: C.textMuted }}>
              Snapshot {snapshotAge(posture.derived_at)}
            </Typography>
          )}
          <Button sx={{ ...outlineBtnSx, px: 1.25, py: 0.4 }} onClick={handleRefresh} disabled={busy || !caseId}>
            {busy ? <CircularProgress size={13} sx={{ color: C.black, mr: 0.5 }} /> : <RefreshRounded sx={{ mr: 0.5, fontSize: 15 }} />}
            Refresh
          </Button>
        </Box>
      </Box>

      <Box sx={{ display: "flex", flexWrap: "wrap", mt: 1 }}>
        <Pair label="Treatment status" value={STATUS_LABEL[posture.treatment_status] || "Unknown"} />
        <Pair label="Therapy before this specimen" value={triState(posture.therapy_before_specimen)} />
        {(posture.modalities_before_specimen || []).length > 0 && (
          <Pair label="Modalities before specimen" value={posture.modalities_before_specimen.join(", ")} />
        )}
        {posture.treatment_effect_required && <Pair label="Treatment effect" value="Must be reported" />}
        {posture.staging_prefix_expected && <Pair label="Staging prefix" value={posture.staging_prefix_expected} />}
      </Box>

      {/* The basis is shown always. A derived clinical fact without its reasoning
          is exactly the black box this layer exists to remove. */}
      {posture.treatment_status_basis && (
        <Typography sx={{ fontFamily: FONT, fontSize: 11, color: C.textSecond, mt: 0.5, fontStyle: "italic" }}>
          Basis: {posture.treatment_status_basis}
        </Typography>
      )}

      {treatments.length > 0 && (
        <Box sx={{ mt: 1.5 }}>
          <FieldLabel>Recorded Treatment</FieldLabel>
          {treatments.map((row, index) => (
            <Typography key={`${row.treatment_type}-${row.date}-${index}`} sx={{ fontFamily: FONT, fontSize: 12, color: C.textSecond, mt: 0.4 }}>
              {[row.date, row.treatment_type, row.intent, row.status].filter(Boolean).join(" · ")}
              {row.summary ? ` — ${row.summary}` : ""}
              {row.precedes_specimen === true ? " (before this specimen)" : ""}
              {row.precedes_specimen === null ? " (timing undetermined)" : ""}
            </Typography>
          ))}
        </Box>
      )}

      {radiotherapy.recorded_intent || (radiotherapy.target_volumes || []).length > 0 || (radiotherapy.organs_at_risk || []).length > 0 ? (
        <Box sx={{ mt: 1.5 }}>
          <FieldLabel>Radiotherapy Field Relationship</FieldLabel>
          <Box sx={{ display: "flex", flexWrap: "wrap", mt: 0.5 }}>
            <Pair label="Specimen site in target volume" value={triState(radiotherapy.specimen_site_in_target_volume)} />
            <Pair label="Specimen site an organ at risk" value={triState(radiotherapy.specimen_site_on_organs_at_risk)} />
            {radiotherapy.dose && <Pair label="Dose" value={radiotherapy.dose} />}
            {(radiotherapy.target_volumes || []).length > 0 && (
              <Pair label="Target volumes" value={radiotherapy.target_volumes.join(", ")} />
            )}
          </Box>
          {(radiotherapy.organs_at_risk || []).length > 0 && (
            <Typography sx={{ fontFamily: FONT, fontSize: 11, color: C.textSecond, mt: 0.25 }}>
              Organs at risk: {radiotherapy.organs_at_risk.map((organ) => [organ.organ, organ.max_dose_gy && `max ${organ.max_dose_gy} Gy`].filter(Boolean).join(" ")).join("; ")}
            </Typography>
          )}
          {radiotherapy.field_overlap_basis && (
            <Typography sx={{ fontFamily: FONT, fontSize: 11, color: C.textMuted, mt: 0.25, fontStyle: "italic" }}>
              Basis: {radiotherapy.field_overlap_basis}
            </Typography>
          )}
        </Box>
      ) : null}

      {(chemotherapy.protocol || (chemotherapy.drugs || []).length > 0) && (
        <Box sx={{ mt: 1.5 }}>
          <FieldLabel>Systemic Therapy</FieldLabel>
          <Typography sx={{ fontFamily: FONT, fontSize: 12, color: C.textSecond, mt: 0.4 }}>
            {[chemotherapy.protocol, (chemotherapy.drugs || []).join(", "), chemotherapy.cycles, chemotherapy.recorded_intent]
              .filter(Boolean).join(" · ")}
          </Typography>
          {chemotherapy.residual_toxicity && (
            <Typography sx={{ fontFamily: FONT, fontSize: 11, color: C.textMuted, mt: 0.25 }}>
              Residual toxicity: {chemotherapy.residual_toxicity}
            </Typography>
          )}
        </Box>
      )}

      {showSpreadReference && (
        <Box sx={{ display: "flex", gap: 4, flexWrap: "wrap", mt: 1.5 }}>
          <Box sx={{ flex: 1, minWidth: 240 }}>
            <FieldLabel>Imaging On Record</FieldLabel>
            {imaging.length === 0 && (
              <Typography sx={{ fontFamily: FONT, fontSize: 12, color: C.textMuted, mt: 0.4 }}>
                No radiology study is on record for this patient.
              </Typography>
            )}
            {imaging.map((study, index) => (
              <Typography key={`${study.modality}-${study.date}-${index}`} sx={{ fontFamily: FONT, fontSize: 12, color: study.found ? C.textSecond : C.textMuted, mt: 0.4 }}>
                {[study.date, study.modality].filter(Boolean).join(" · ")}
                {study.note ? ` — ${study.note}` : ""}
                {study.found && study.date_confidence ? ` (date confidence: ${study.date_confidence})` : ""}
              </Typography>
            ))}
          </Box>
          {(posture.expected_spread_regions || []).length > 0 && (
            <Box sx={{ flex: 1, minWidth: 240 }}>
              <FieldLabel>Where This Site Typically Spreads</FieldLabel>
              <Typography sx={{ fontFamily: FONT, fontSize: 12, color: C.textSecond, mt: 0.4 }}>
                {posture.expected_spread_regions.join(", ")}
              </Typography>
              {posture.regional_nodes && (
                <Typography sx={{ fontFamily: FONT, fontSize: 11, color: C.textMuted, mt: 0.5 }}>
                  Regional nodes: {posture.regional_nodes}
                </Typography>
              )}
              {(posture.common_metastatic_sites || []).length > 0 && (
                <Typography sx={{ fontFamily: FONT, fontSize: 11, color: C.textMuted, mt: 0.25 }}>
                  Common metastatic sites: {posture.common_metastatic_sites.join(", ")}
                </Typography>
              )}
              <Typography sx={{ fontFamily: FONT, fontSize: 11, color: C.textMuted, mt: 0.75, fontStyle: "italic" }}>
                Reference only. The imaging list carries no region coverage, so nothing here
                states whether a region has been assessed — that comparison is yours.
              </Typography>
            </Box>
          )}
        </Box>
      )}

      {gaps.length > 0 && <FlagNote>Clinical history gaps: {gaps.join("; ")}</FlagNote>}
      {error && <FlagNote>{error}</FlagNote>}
    </Box>
  );
}
