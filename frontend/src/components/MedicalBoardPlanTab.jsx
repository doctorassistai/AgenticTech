// MedicalBoardPlanTab.jsx — fetches BOTH the doctor's current treatment plan
// and the medical board (tumor board) plan for a patient. Shows whichever
// exist as internal sub-tabs. Reports overall visibility to the parent via
// onStatusChange("loading" | "none" | "visible") so the parent tab bar can
// decide whether to show this section at all.
//
// Each medical board step is clickable → opens a popup with FULL step
// details (treatment, detailed plan, timing, duration, responsible
// specialty, monitoring, rationale, guideline support, contributing
// specialties, status reason) — same depth of detail as the Tumor Board
// page — plus a "Complete Step" button. Clicking it PUTs to
// hms/users/data/context/complete-tumor-board-step/{patient_id}/{doctor_id}/{step_number}
// then silently re-fetches the medical board plan (no page reload).
import React, { useState, useEffect } from "react";
import {
  Box, Typography, Avatar, Chip, Tabs, Tab,
  Dialog, DialogTitle, DialogContent, DialogActions, Button,
  CircularProgress, IconButton,
} from "@mui/material";
import {
  AccountTreeRounded,
  WarningAmberRounded,
  LockRounded,
  FlagRounded,
  RefreshRounded,
  AssignmentRounded,
  CloseRounded,
  CheckCircleRounded,
} from "@mui/icons-material";

const API_BASE_URL = import.meta.env.VITE_BACKEND_URL;
const FONT = '"Open Sans", sans-serif';
import { THEMES } from "../dashboard/themes";
const themeName = localStorage.getItem("theme") || "PurpleWhite";
const theme = THEMES[themeName] || THEMES.PurpleWhite;
const C = {
  // Text
  black: theme.text,
  ink: theme.text,
  charcoal: theme.textSec,
  smoke: theme.textSec,
  ash: theme.textMuted,
  silver: theme.textMuted,

  // Borders / Surfaces
  mist: theme.border,
  fog: theme.bgTert,
  ghost: theme.bgAlt,
  white: theme.bg,
};
const os = (extra = {}) => ({ fontFamily: FONT, fontWeight: 300, ...extra });

const tabSx = {
  "& .MuiTab-root": {
    textTransform: "none", fontWeight: 300, fontFamily: FONT, fontSize: 12,
    minWidth: "auto", px: 2, color: C.ash, letterSpacing: "0.04em",
    "&.Mui-selected": { color: C.ink, fontWeight: 400 },
  },
  "& .MuiTabs-indicator": { background: C.black, height: 1.5 },
  borderBottom: `1px solid ${C.fog}`,
};

// ─── Shared modality/status maps (medical board steps) ──────────────────────
const MODALITY_LABELS = {
  investigation: "Investigation",
  chemotherapy: "Chemotherapy",
  radiation: "Radiation",
  surgery: "Surgery",
  supportive_care: "Supportive Care",
  immunotherapy: "Immunotherapy",
  targeted_therapy: "Targeted Therapy",
};

const STEP_STATUS_STYLES = {
  pending:     { label: "Pending",     color: "#666666", bg: "#f0f0f0", border: "#d5d5d5" },
  in_progress: { label: "In Progress", color: "#0a6e88", bg: "#e8f7f8", border: "#a9e2e8" },
  completed:   { label: "Completed",   color: "#0a7a45", bg: "#e9f9f0", border: "#a9e6c4" },
  cancelled:   { label: "Cancelled",   color: "#a12525", bg: "#fdeeee", border: "#f0bcbc" },
};
const getStepStatusStyle = s => STEP_STATUS_STYLES[s] || STEP_STATUS_STYLES.pending;

// ─── Small building blocks ────────────────────────────────────────────────
const FieldLabel = ({ children }) => (
  <Typography sx={{ ...os({ fontSize: 10, color: C.silver, textTransform: "uppercase", letterSpacing: "0.08em", mb: 0.5 }) }}>
    {children}
  </Typography>
);

const InfoCard = ({ children, sx = {} }) => (
  <Box sx={{ p: 2, border: `1px solid ${C.fog}`, borderRadius: "4px", background: C.white, ...sx }}>
    {children}
  </Box>
);

// Small labeled block used throughout the step detail popup body.
const DetailRow = ({ label, children }) => (
  <Box sx={{ mb: 2 }}>
    <FieldLabel>{label}</FieldLabel>
    {children}
  </Box>
);

// ─── Medical board step row (clickable) ───────────────────────────────────
const StepRow = ({ step, isLast, onClick }) => {
  const s = getStepStatusStyle(step.status);
  return (
    <Box
      onClick={() => onClick?.(step)}
      sx={{
        display: "flex", alignItems: "center", gap: 1.5,
        px: 1.75, py: 1.5,
        border: `1px solid ${C.fog}`,
        borderBottom: isLast ? `1px solid ${C.fog}` : "none",
        background: C.white,
        cursor: "pointer",
        transition: "background 0.15s ease",
        "&:hover": { background: C.ghost },
      }}
    >
      <Box sx={{
        width: 26, height: 26, flexShrink: 0, border: `1px solid ${C.black}`,
        display: "flex", alignItems: "center", justifyContent: "center",
        fontSize: 11, fontFamily: FONT, color: C.black,
      }}>
        {step.step_number}
      </Box>
      <Box sx={{ flex: 1, minWidth: 0 }}>
        <Box sx={{ display: "flex", alignItems: "center", gap: 0.75, flexWrap: "wrap" }}>
          <Typography sx={{ ...os({ fontSize: 13, color: C.ink }) }}>{step.phase_name}</Typography>
          {step.is_urgent && (
            <Box sx={{ display: "flex", alignItems: "center", gap: 0.3, color: "#a12525" }}>
              <FlagRounded sx={{ fontSize: 12 }} />
              <Typography sx={{ ...os({ fontSize: 9.5, textTransform: "uppercase", letterSpacing: "0.08em" }) }}>Urgent</Typography>
            </Box>
          )}
        </Box>
        <Typography sx={{ ...os({ fontSize: 11.5, color: C.ash, mt: 0.25 }) }} noWrap>
          {step.treatment_name}
        </Typography>
      </Box>
      <Chip
        label={MODALITY_LABELS[step.modality] || step.modality}
        size="small"
        sx={{
          display: { xs: "none", sm: "flex" },
          borderRadius: "2px", fontFamily: FONT, fontSize: 10.5,
          height: 22, border: `1px solid ${C.fog}`, background: C.ghost, color: C.smoke,
        }}
      />
      <Box sx={{
        px: 1, py: 0.4, border: `1px solid ${s.border}`, background: s.bg, color: s.color,
        fontSize: 10, fontFamily: FONT, textTransform: "uppercase", letterSpacing: "0.06em",
        flexShrink: 0, whiteSpace: "nowrap",
      }}>
        {s.label}
      </Box>
    </Box>
  );
};

// ─── Step detail popup — full details + "Complete Step" action ───────────
// Shows every field the doctor filled in for the step (treatment, detailed
// plan, timing, duration, responsible specialty, monitoring, rationale,
// guideline support, contributing specialties, status reason) — the same
// depth as the Tumor Board page's step popup — followed by the Complete
// Step control at the bottom.
const StepDetailDialog = ({ step, patientId, doctorId, onClose, onCompleted }) => {
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  if (!step) return null;

  const s = getStepStatusStyle(step.status);
  const isCompleted = step.status === "completed";

  const handleCompleteStep = async () => {
    setSubmitting(true);
    setError("");
    try {
      const res = await fetch(
        `${API_BASE_URL}hms/users/data/context/complete-tumor-board-step/${patientId}/${doctorId}/${step.step_number}`,
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            patient_id: patientId,
            doctor_id: doctorId,
            step_number: step.step_number,
            status: "completed",
          }),
        }
      );
      if (!res.ok) {
        const errJson = await res.json().catch(() => null);
        throw new Error(errJson?.message || `Failed to complete step (${res.status})`);
      }
      // Let the parent silently re-fetch the plan so the row reflects the
      // new status without a page reload.
      await onCompleted?.();
      onClose();
    } catch (err) {
      console.error("Failed to complete tumor board step:", err);
      setError(err.message || "Something went wrong. Please try again.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog
      open={Boolean(step)}
      onClose={submitting ? undefined : onClose}
      maxWidth="sm"
      fullWidth
      PaperProps={{ sx: { borderRadius: "6px", border: `1px solid ${C.fog}` } }}
    >
      <DialogTitle sx={{
        display: "flex", alignItems: "flex-start", justifyContent: "space-between",
        gap: 1, borderBottom: `1px solid ${C.fog}`, py: 2,
      }}>
        <Box sx={{ display: "flex", alignItems: "center", gap: 1.25 }}>
          <Box sx={{
            width: 30, height: 30, flexShrink: 0, border: `1px solid ${C.black}`,
            display: "flex", alignItems: "center", justifyContent: "center",
            fontSize: 12, fontFamily: FONT, color: C.black,
          }}>
            {step.step_number}
          </Box>
          <Box>
            <FieldLabel>{MODALITY_LABELS[step.modality] || step.modality}</FieldLabel>
            <Typography sx={{ ...os({ fontSize: 15, color: C.ink }) }}>{step.phase_name}</Typography>
          </Box>
        </Box>
        <IconButton size="small" onClick={onClose} disabled={submitting} sx={{ mt: -0.5, mr: -0.5 }}>
          <CloseRounded sx={{ fontSize: 18, color: C.ash }} />
        </IconButton>
      </DialogTitle>

      <DialogContent sx={{ pt: 2.5, pb: 1 }}>
        {/* Status / modality / urgent chips */}
        <Box sx={{ display: "flex", gap: 1, flexWrap: "wrap", mb: 2.5 }}>
          <Chip
            label={MODALITY_LABELS[step.modality] || step.modality}
            size="small"
            sx={{ borderRadius: "2px", fontFamily: FONT, fontSize: 10.5, height: 22, border: `1px solid ${C.fog}`, background: C.ghost, color: C.smoke }}
          />
          <Box sx={{
            px: 1, py: 0.4, border: `1px solid ${s.border}`, background: s.bg, color: s.color,
            fontSize: 10, fontFamily: FONT, textTransform: "uppercase", letterSpacing: "0.06em",
          }}>
            {s.label}
          </Box>
          {step.is_urgent && (
            <Box sx={{ display: "flex", alignItems: "center", gap: 0.3, color: "#a12525", px: 0.5 }}>
              <FlagRounded sx={{ fontSize: 13 }} />
              <Typography sx={{ ...os({ fontSize: 10, textTransform: "uppercase", letterSpacing: "0.08em" }) }}>Urgent</Typography>
            </Box>
          )}
        </Box>

        {/* Treatment name */}
        {step.treatment_name && (
          <DetailRow label="Treatment">
            <Typography sx={{ ...os({ fontSize: 13.5, color: C.ink }) }}>{step.treatment_name}</Typography>
          </DetailRow>
        )}

        {/* Detailed plan (falls back to legacy `description` field if present) */}
        {(step.detailed_plan || step.description) && (
          <DetailRow label="Detailed Plan">
            <Typography sx={{ ...os({ fontSize: 12.5, color: C.charcoal, lineHeight: 1.7 }) }}>
              {step.detailed_plan || step.description}
            </Typography>
          </DetailRow>
        )}

        {/* Timing / duration / responsible specialty */}
        {(step.sequence_timing || step.estimated_duration || step.responsible_specialty) && (
          <Box sx={{ display: "flex", gap: 3, mb: 0.5, flexWrap: "wrap" }}>
            {step.sequence_timing && (
              <DetailRow label="Timing">
                <Typography sx={{ ...os({ fontSize: 12.5, color: C.charcoal }) }}>{step.sequence_timing}</Typography>
              </DetailRow>
            )}
            {step.estimated_duration && (
              <DetailRow label="Duration">
                <Typography sx={{ ...os({ fontSize: 12.5, color: C.charcoal }) }}>{step.estimated_duration}</Typography>
              </DetailRow>
            )}
            {step.responsible_specialty && (
              <DetailRow label="Responsible Specialty">
                <Typography sx={{ ...os({ fontSize: 12.5, color: C.charcoal }) }}>{step.responsible_specialty}</Typography>
              </DetailRow>
            )}
          </Box>
        )}

        {/* Monitoring before starting */}
        {step.monitoring_before_starting?.length > 0 && (
          <DetailRow label="Monitoring Before Starting">
            <Box sx={{ display: "flex", flexDirection: "column", gap: 0.5 }}>
              {step.monitoring_before_starting.map((m, i) => (
                <Typography key={i} sx={{ ...os({ fontSize: 12.5, color: C.charcoal }) }}>• {m}</Typography>
              ))}
            </Box>
          </DetailRow>
        )}

        {/* Rationale */}
        {step.rationale && (
          <DetailRow label="Rationale">
            <Typography sx={{ ...os({ fontSize: 12.5, color: C.charcoal, lineHeight: 1.7 }) }}>
              {step.rationale}
            </Typography>
          </DetailRow>
        )}

        {/* Guideline support */}
        {step.guideline_support && (
          <DetailRow label="Guideline Support">
            <Typography sx={{ ...os({ fontSize: 12, color: C.smoke, fontStyle: "italic" }) }}>
              {step.guideline_support}
            </Typography>
          </DetailRow>
        )}

        {/* Contributing specialties */}
        {step.contributing_doctors?.length > 0 && (
          <DetailRow label="Contributing Specialties">
            <Box sx={{ display: "flex", gap: 0.75, flexWrap: "wrap" }}>
              {step.contributing_doctors.map((d, i) => (
                <Chip key={i} label={d} size="small" sx={{
                  borderRadius: "2px", fontFamily: FONT, fontSize: 11, height: 24,
                  border: `1px solid ${C.fog}`, background: C.ghost, color: C.smoke,
                }} />
              ))}
            </Box>
          </DetailRow>
        )}

        {/* Free-form notes (legacy field, kept if backend still sends it) */}
        {step.notes && (
          <DetailRow label="Notes">
            <Typography sx={{ ...os({ fontSize: 12.5, color: C.charcoal, lineHeight: 1.7 }) }}>
              {step.notes}
            </Typography>
          </DetailRow>
        )}

        {/* Status reason, if the step was put on hold / cancelled with a reason */}
        {step.status_reason && (
          <Box sx={{ mt: 0.5, mb: 2, p: 1.5, background: C.ghost, border: `1px solid ${C.fog}`, borderRadius: "4px" }}>
            <Typography sx={{ ...os({ fontSize: 11.5, color: C.ash, lineHeight: 1.6 }) }}>
              {step.status_reason}
            </Typography>
          </Box>
        )}

        {isCompleted && (
          <Box sx={{ display: "flex", alignItems: "center", gap: 0.75, color: "#0a7a45", mb: 1 }}>
            <CheckCircleRounded sx={{ fontSize: 16 }} />
            <Typography sx={{ ...os({ fontSize: 12 }) }}>This step is already completed.</Typography>
          </Box>
        )}

        {error && (
          <Typography sx={{ ...os({ fontSize: 11.5, color: "#a12525", mb: 1 }) }}>{error}</Typography>
        )}
      </DialogContent>

      {/* Complete Step action sits below all the detail above */}
      <DialogActions sx={{ px: 3, pb: 2.5, pt: 1, borderTop: `1px solid ${C.fog}` }}>
        <Button
          onClick={onClose}
          disabled={submitting}
          sx={{ ...os({ fontSize: 12.5, color: C.ash, textTransform: "none" }) }}
        >
          Close
        </Button>
        <Button
          onClick={handleCompleteStep}
          disabled={submitting || isCompleted}
          variant="contained"
          startIcon={submitting ? <CircularProgress size={14} sx={{ color: C.white }} /> : <CheckCircleRounded sx={{ fontSize: 16 }} />}
          sx={{
            ...os({ fontSize: 12.5, textTransform: "none" }),
            background: C.black,
            "&:hover": { background: C.ink },
            "&.Mui-disabled": { background: C.mist, color: C.white },
          }}
        >
          {isCompleted ? "Completed" : submitting ? "Completing..." : "Complete Step"}
        </Button>
      </DialogActions>
    </Dialog>
  );
};

const ApprovalRow = ({ approval, name }) => {
  const isApproved = approval.status === "approved";
  return (
    <Box sx={{
      display: "flex", alignItems: "center", justifyContent: "space-between",
      px: 1.25, py: 0.75, border: `1px solid ${C.fog}`, background: C.ghost,
    }}>
      <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
        <Avatar sx={{ width: 24, height: 24, borderRadius: "2px", background: C.black, fontSize: 10, fontFamily: FONT }}>
          {(name || "D")[0].toUpperCase()}
        </Avatar>
        <Box>
          <Typography sx={{ ...os({ fontSize: 12, color: C.ink }) }}>
            {name ? `Dr. ${name}` : "Loading..."}
          </Typography>
          <Typography sx={{ ...os({ fontSize: 10, color: C.ash }) }}>{approval.speciality}</Typography>
        </Box>
      </Box>
      <Box sx={{
        px: 0.9, py: 0.3,
        background: isApproved ? "#e9f9f0" : "#fff6e5",
        color: isApproved ? "#0a7a45" : "#9a6300",
        border: `1px solid ${isApproved ? "#a9e6c4" : "#f0dca8"}`,
        fontSize: 9.5, fontFamily: FONT, textTransform: "uppercase", letterSpacing: "0.06em",
      }}>
        {isApproved ? "Approved" : "Pending"}
      </Box>
    </Box>
  );
};

// ─── Medical board plan body ──────────────────────────────────────────────
const MedicalBoardPlanBody = ({ medicalBoardStatus, planDoc, doctorNames, onStepClick }) => {
  if (medicalBoardStatus === "pending") {
    const approvals = planDoc?.doctor_approvals || [];
    const pendingCount = approvals.filter(a => a.status !== "approved").length;
    return (
      <Box sx={{ border: `1px solid ${C.fog}`, borderRadius: "4px", overflow: "hidden", background: C.white }}>
        <Box sx={{ p: 2.5, borderBottom: `1px solid ${C.fog}`, background: C.ghost, display: "flex", alignItems: "center", gap: 1.5 }}>
          <Box sx={{ width: 36, height: 36, background: "#9a6300", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
            <WarningAmberRounded sx={{ fontSize: 18, color: C.white }} />
          </Box>
          <Box>
            <Typography sx={{ ...os({ fontSize: 14, color: C.ink }) }}>Medical Board Plan — Approval Pending</Typography>
            <Typography sx={{ ...os({ fontSize: 11.5, color: "#9a6300", mt: 0.25 }) }}>
              {pendingCount} of {approvals.length} doctors still need to approve this plan
            </Typography>
          </Box>
        </Box>
        <Box sx={{ p: 2.5, display: "flex", flexDirection: "column", gap: 0.75 }}>
          {approvals.map((a, idx) => (
            <ApprovalRow key={a.doctor_id || idx} approval={a} name={doctorNames[a.doctor_id]} />
          ))}
        </Box>
        <Box sx={{ px: 2.5, pb: 2.5 }}>
          <Typography sx={{ ...os({ fontSize: 11.5, color: C.silver }) }}>
            The full plan will be shown here once every doctor listed above has approved it.
          </Typography>
        </Box>
      </Box>
    );
  }

  if (medicalBoardStatus === "approved") {
    const plan = planDoc.care_pathway_plan;
    const approvals = planDoc.doctor_approvals || [];
    return (
      <Box sx={{ border: `1px solid ${C.fog}`, borderRadius: "4px", overflow: "hidden", background: C.white }}>
        <Box sx={{ p: 2.5, borderBottom: `1px solid ${C.fog}`, background: C.ghost }}>
          <Box sx={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: 1.5 }}>
            <Box sx={{ display: "flex", alignItems: "center", gap: 1.5 }}>
              <Box sx={{ width: 36, height: 36, background: C.black, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                <AccountTreeRounded sx={{ fontSize: 18, color: C.white }} />
              </Box>
              <Box>
                <Typography sx={{ ...os({ fontSize: 14, color: C.ink }) }}>{plan.primary_diagnosis}</Typography>
                <Typography sx={{ ...os({ fontSize: 11, color: C.ash, mt: 0.2 }) }}>
                  Stage {plan.cancer_stage} · {plan.overall_treatment_intent} intent · {plan.total_steps ?? plan.steps?.length} steps
                </Typography>
              </Box>
            </Box>
            <Box sx={{
              px: 1, py: 0.4, background: "#e9f9f0", color: "#0a7a45", border: "1px solid #a9e6c4",
              fontSize: 10, fontFamily: FONT, textTransform: "uppercase", letterSpacing: "0.06em",
              display: "flex", alignItems: "center", gap: 0.4, whiteSpace: "nowrap",
            }}>
              <LockRounded sx={{ fontSize: 12 }} />
              Approved by all {approvals.length} doctors
            </Box>
          </Box>
        </Box>

        {plan.safety_flags?.length > 0 && (
          <Box sx={{ p: 2, borderBottom: `1px solid ${C.fog}`, background: "#fff9ec" }}>
            {plan.safety_flags.map((f, i) => (
              <Typography key={i} sx={{ ...os({ fontSize: 12, color: "#9a6300", mb: i < plan.safety_flags.length - 1 ? 0.75 : 0 }) }}>
                ⚠ {f}
              </Typography>
            ))}
          </Box>
        )}

        {plan.mdt_basis_summary && (
          <Box sx={{ p: 2, borderBottom: `1px solid ${C.fog}` }}>
            <Typography sx={{ ...os({ fontSize: 12, color: C.smoke, lineHeight: 1.7 }) }}>{plan.mdt_basis_summary}</Typography>
          </Box>
        )}

        <Box sx={{ p: 2 }}>
          {plan.steps.map((step, idx) => (
            <StepRow key={step.step_number ?? idx} step={step} isLast={idx === plan.steps.length - 1} onClick={onStepClick} />
          ))}
        </Box>
      </Box>
    );
  }

  return null;
};

// ─── Treatment plan body (structured data only — no raw dictation) ──────────
const TreatmentPlanBody = ({ treatmentPlanDoc }) => {
  const finaloutput = treatmentPlanDoc?.finaloutput?.processed_treatment_plan;
  const structured = finaloutput?.structured_data;
  const intentAlignment = treatmentPlanDoc?.finaloutput?.intent_alignment;
  const metadata = treatmentPlanDoc?.metadata;

  if (!structured) {
    return (
      <Box sx={{ p: 5, textAlign: "center", border: `1px solid ${C.fog}`, borderRadius: "4px", background: C.ghost }}>
        <Typography sx={{ ...os({ fontSize: 13, color: C.ash }) }}>Treatment plan data unavailable</Typography>
      </Box>
    );
  }

  const hasGoals = structured.primaryGoals?.length > 0;
  const hasMeds = structured.medications?.length > 0;
  const procedures = structured.recommendedProcedures || structured.procedures || [];
  const hasProcedures = procedures.length > 0;
  const hasInvestigations = structured.investigations?.length > 0;
  const hasLifestyle = structured.lifestyleModifications?.length > 0;
  const nextVisit = structured.followUpPlan?.nextVisit;
  const monitoringParams = structured.followUpPlan?.monitoringParameters || [];

  return (
    <Box sx={{ display: "flex", flexDirection: "column", gap: 2 }}>
      {/* Header */}
      <Box sx={{ border: `1px solid ${C.fog}`, borderRadius: "4px", overflow: "hidden" }}>
        <Box sx={{ p: 2.5, background: C.ghost, borderBottom: `1px solid ${C.fog}`, display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: 1.5 }}>
          <Box sx={{ display: "flex", alignItems: "center", gap: 1.5 }}>
            <Box sx={{ width: 36, height: 36, background: C.black, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
              <AssignmentRounded sx={{ fontSize: 18, color: C.white }} />
            </Box>
            <Box>
              <Typography sx={{ ...os({ fontSize: 14, color: C.ink }) }}>
                {structured.primaryDiagnosis || "Treatment Plan"}
              </Typography>
              {intentAlignment?.intent && (
                <Typography sx={{ ...os({ fontSize: 11, color: C.ash, mt: 0.2, textTransform: "capitalize" }) }}>
                  Intent: {intentAlignment.intent.replace(/_/g, " ")}
                  {intentAlignment.alignment_status ? ` · ${intentAlignment.alignment_status}` : ""}
                </Typography>
              )}
            </Box>
          </Box>
          {metadata?.plan_status && (
            <Box sx={{
              px: 1, py: 0.4,
              background: metadata.plan_status === "approved" ? "#e9f9f0" : "#fff6e5",
              color: metadata.plan_status === "approved" ? "#0a7a45" : "#9a6300",
              border: `1px solid ${metadata.plan_status === "approved" ? "#a9e6c4" : "#f0dca8"}`,
              fontSize: 10, fontFamily: FONT, textTransform: "uppercase", letterSpacing: "0.06em",
              whiteSpace: "nowrap",
            }}>
              {metadata.plan_status}
            </Box>
          )}
        </Box>
      </Box>

      {/* Primary goals */}
      {hasGoals && (
        <InfoCard>
          <FieldLabel>Primary Goals</FieldLabel>
          <Box component="ul" sx={{ m: 0, pl: 2.5 }}>
            {structured.primaryGoals.map((g, i) => (
              <Typography key={i} component="li" sx={{ ...os({ fontSize: 13, color: C.charcoal, mb: 0.5, lineHeight: 1.6 }) }}>{g}</Typography>
            ))}
          </Box>
        </InfoCard>
      )}

      {/* Medications */}
      {hasMeds && (
        <InfoCard>
          <FieldLabel>Medications</FieldLabel>
          <Box sx={{ display: "flex", flexDirection: "column", gap: 1.25, mt: 1 }}>
            {structured.medications.map((m, i) => (
              <Box key={i} sx={{ p: 1.5, border: `1px solid ${C.fog}`, borderRadius: "2px", background: C.ghost }}>
                <Box sx={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", flexWrap: "wrap", gap: 1 }}>
                  <Typography sx={{ ...os({ fontSize: 13, color: C.ink }) }}>{m.name}</Typography>
                  <Typography sx={{ ...os({ fontSize: 11.5, color: C.smoke }) }}>{m.dose} · {m.frequency}</Typography>
                </Box>
                {m.indication && (
                  <Typography sx={{ ...os({ fontSize: 11.5, color: C.ash, mt: 0.5 }) }}>Indication: {m.indication}</Typography>
                )}
                {m.patientSpecific && (
                  <Typography sx={{ ...os({ fontSize: 11.5, color: C.smoke, mt: 0.5, lineHeight: 1.5 }) }}>{m.patientSpecific}</Typography>
                )}
              </Box>
            ))}
          </Box>
        </InfoCard>
      )}

      {/* Recommended Procedures */}
      {hasProcedures && (
        <InfoCard>
          <FieldLabel>Recommended Procedures ({procedures.length})</FieldLabel>
          <Box sx={{ display: "flex", flexDirection: "column", gap: 1.25, mt: 1 }}>
            {procedures.map((p, i) => {
              const name = p.name || p.procedure_name || `Procedure ${i + 1}`;
              const timing = p.timing;
              const indication = p.indication;
              const reasonNeeded = p.reasonNeeded || p.reason_needed;
              const guideline = p.guideline || p.guideline_rationale;
              const patientSpecific = p.patientSpecific || p.patient_specific_reason;
              const steps = p.steps || p.procedure_steps || [];
              return (
                <Box key={i} sx={{ p: 1.5, border: `1px solid ${C.fog}`, borderRadius: "2px", background: C.ghost }}>
                  <Box sx={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", flexWrap: "wrap", gap: 1 }}>
                    <Typography sx={{ ...os({ fontSize: 13, color: C.ink }) }}>{name}</Typography>
                    {timing && (
                      <Typography sx={{ ...os({ fontSize: 10.5, color: C.smoke, textTransform: "uppercase", letterSpacing: "0.06em" }) }}>{timing}</Typography>
                    )}
                  </Box>
                  {indication && (
                    <Typography sx={{ ...os({ fontSize: 11.5, color: C.ash, mt: 0.5, lineHeight: 1.5 }) }}>Indication: {indication}</Typography>
                  )}
                  {reasonNeeded && (
                    <Typography sx={{ ...os({ fontSize: 11.5, color: C.ash, mt: 0.5, lineHeight: 1.5 }) }}>Why needed: {reasonNeeded}</Typography>
                  )}
                  {guideline && (
                    <Typography sx={{ ...os({ fontSize: 11.5, color: C.smoke, mt: 0.5, lineHeight: 1.5 }) }}>{guideline}</Typography>
                  )}
                  {patientSpecific && (
                    <Typography sx={{ ...os({ fontSize: 11.5, color: C.smoke, mt: 0.5, lineHeight: 1.5 }) }}>{patientSpecific}</Typography>
                  )}
                  {steps.length > 0 && (
                    <Box component="ul" sx={{ m: 0, mt: 0.75, pl: 2.5 }}>
                      {steps.map((s, si) => (
                        <Typography key={si} component="li" sx={{ ...os({ fontSize: 11.5, color: C.charcoal, mb: 0.3 }) }}>{s}</Typography>
                      ))}
                    </Box>
                  )}
                </Box>
              );
            })}
          </Box>
        </InfoCard>
      )}

      {/* Investigations */}
      {hasInvestigations && (
        <InfoCard>
          <FieldLabel>Required Investigations</FieldLabel>
          <Box sx={{ display: "flex", flexDirection: "column", gap: 1.25, mt: 1 }}>
            {structured.investigations.map((inv, i) => (
              <Box key={i} sx={{ p: 1.5, border: `1px solid ${C.fog}`, borderRadius: "2px", background: C.ghost }}>
                <Box sx={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", flexWrap: "wrap", gap: 1 }}>
                  <Typography sx={{ ...os({ fontSize: 13, color: C.ink }) }}>{inv.name}</Typography>
                  {inv.urgency && (
                    <Typography sx={{ ...os({ fontSize: 10.5, color: C.smoke, textTransform: "uppercase", letterSpacing: "0.06em" }) }}>{inv.urgency}</Typography>
                  )}
                </Box>
                {inv.indication && (
                  <Typography sx={{ ...os({ fontSize: 11.5, color: C.ash, mt: 0.5, lineHeight: 1.5 }) }}>{inv.indication}</Typography>
                )}
              </Box>
            ))}
          </Box>
        </InfoCard>
      )}

      {/* Lifestyle modifications */}
      {hasLifestyle && (
        <InfoCard>
          <FieldLabel>Lifestyle Modifications</FieldLabel>
          <Box sx={{ display: "flex", flexDirection: "column", gap: 1.25, mt: 1 }}>
            {structured.lifestyleModifications.map((l, i) => (
              <Box key={i} sx={{ p: 1.5, border: `1px solid ${C.fog}`, borderRadius: "2px", background: C.ghost }}>
                <Typography sx={{ ...os({ fontSize: 13, color: C.charcoal, lineHeight: 1.6 }) }}>{l.recommendation}</Typography>
                <Box sx={{ display: "flex", gap: 1, mt: 0.75, flexWrap: "wrap" }}>
                  {l.evidence && (
                    <Chip label={`Evidence ${l.evidence}`} size="small" sx={{ fontSize: 10, height: 20, background: C.white, border: `1px solid ${C.fog}`, color: C.smoke }} />
                  )}
                  {l.difficulty && (
                    <Chip label={l.difficulty} size="small" sx={{ fontSize: 10, height: 20, background: C.white, border: `1px solid ${C.fog}`, color: C.smoke, textTransform: "capitalize" }} />
                  )}
                </Box>
              </Box>
            ))}
          </Box>
        </InfoCard>
      )}

      {/* Follow-up */}
      {(nextVisit || monitoringParams.length > 0) && (
        <InfoCard>
          <FieldLabel>Follow-Up Plan</FieldLabel>
          {nextVisit && (
            <Typography sx={{ ...os({ fontSize: 13, color: C.charcoal, mb: monitoringParams.length ? 1 : 0 }) }}>
              Next visit: {nextVisit}
            </Typography>
          )}
          {monitoringParams.length > 0 && (
            <Box component="ul" sx={{ m: 0, pl: 2.5 }}>
              {monitoringParams.map((p, i) => (
                <Typography key={i} component="li" sx={{ ...os({ fontSize: 12.5, color: C.charcoal, mb: 0.4 }) }}>
                  {typeof p === "object" ? JSON.stringify(p) : String(p)}
                </Typography>
              ))}
            </Box>
          )}
        </InfoCard>
      )}
    </Box>
  );
};

// ─── Main component ──────────────────────────────────────────────────────────
const MedicalBoardPlanTab = ({ patientId, doctorId, onStatusChange }) => {
  const [treatmentPlanStatus, setTreatmentPlanStatus] = useState("loading"); // loading | none | found
  const [treatmentPlanDoc, setTreatmentPlanDoc] = useState(null);

  const [medicalBoardStatus, setMedicalBoardStatus] = useState("loading"); // loading | none | pending | approved
  const [medicalBoardDoc, setMedicalBoardDoc] = useState(null);
  const [doctorNames, setDoctorNames] = useState({});

  const [activeSubTab, setActiveSubTab] = useState(0);

  // Currently opened step popup (null = closed)
  const [selectedStep, setSelectedStep] = useState(null);

  // ── Fetch current treatment plan ──
  const fetchTreatmentPlan = async () => {
    if (!patientId || !doctorId) return;
    try {
      const res = await fetch(`${API_BASE_URL}hms/users/data/context/get-current-plan/${patientId}/${doctorId}`);
      if (res.status === 404) { setTreatmentPlanDoc(null); setTreatmentPlanStatus("none"); return; }
      const json = await res.json();
      const doc = json?.data;
      if (!res.ok || !doc?.finaloutput?.processed_treatment_plan?.structured_data) {
        setTreatmentPlanDoc(null);
        setTreatmentPlanStatus("none");
        return;
      }
      setTreatmentPlanDoc(doc);
      setTreatmentPlanStatus("found");
    } catch (err) {
      console.error("Failed to fetch current treatment plan:", err);
      setTreatmentPlanDoc(null);
      setTreatmentPlanStatus("none");
    }
  };

  // ── Fetch medical board plan ──
  // `silent = true` skips flipping the status back to "loading", so calling
  // this after "Complete Step" just refreshes the data in place with no
  // spinner / no visible reload.
  const fetchMedicalBoardPlan = async ({ silent = false } = {}) => {
    if (!patientId || !doctorId) return;
    if (!silent) setMedicalBoardStatus("loading");
    try {
      const res = await fetch(`${API_BASE_URL}hms/users/data/context/get-tumor-board-plan-by-doctor/${patientId}/${doctorId}`);
      if (res.status === 404) { setMedicalBoardDoc(null); setMedicalBoardStatus("none"); return; }
      const json = await res.json();
      const doc = json?.data;
      if (!res.ok || !doc?.care_pathway_plan) { setMedicalBoardDoc(null); setMedicalBoardStatus("none"); return; }
      setMedicalBoardDoc(doc);
      const approvals = doc.doctor_approvals || [];
      const allApproved = approvals.length > 0 && approvals.every(a => a.status === "approved");
      setMedicalBoardStatus(allApproved ? "approved" : "pending");

      // Keep the currently-open popup in sync with the freshly-fetched plan
      // (e.g. after Complete Step) so the popup shows the updated status
      // instead of a stale snapshot.
      setSelectedStep(prevSelected => {
        if (!prevSelected) return prevSelected;
        const freshStep = doc.care_pathway_plan?.steps?.find(
          st => st.step_number === prevSelected.step_number
        );
        return freshStep || prevSelected;
      });
    } catch (err) {
      console.error("Failed to fetch medical board plan:", err);
      if (!silent) { setMedicalBoardDoc(null); setMedicalBoardStatus("none"); }
    }
  };

  useEffect(() => { fetchTreatmentPlan(); fetchMedicalBoardPlan(); }, [patientId, doctorId]);

  // Resolve doctor names for the medical board approvals list
  useEffect(() => {
    const approvals = medicalBoardDoc?.doctor_approvals || [];
    const missing = approvals.map(a => a.doctor_id).filter(id => id && !doctorNames[id]);
    if (missing.length === 0) return;

    let cancelled = false;
    (async () => {
      const entries = await Promise.all(missing.map(async id => {
        try {
          const res = await fetch(`${API_BASE_URL}hms/users/speciality/users/patient/get_doctor_details`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ doctor_id: id }),
          });
          const data = await res.json();
          const name = data?.doctor_name || data?.doctor?.name || data?.data?.name || "";
          return [id, name];
        } catch { return [id, ""]; }
      }));
      if (cancelled) return;
      setDoctorNames(prev => {
        const next = { ...prev };
        entries.forEach(([id, name]) => { if (name) next[id] = name; });
        return next;
      });
    })();

    return () => { cancelled = true; };
  }, [medicalBoardDoc]);

  // Bubble up overall visibility once both requests have settled
  useEffect(() => {
    if (treatmentPlanStatus === "loading" || medicalBoardStatus === "loading") {
      onStatusChange?.("loading");
      return;
    }
    const treatmentVisible = treatmentPlanStatus === "found";
    const boardVisible = medicalBoardStatus === "pending" || medicalBoardStatus === "approved";
    onStatusChange?.(treatmentVisible || boardVisible ? "visible" : "none");
  }, [treatmentPlanStatus, medicalBoardStatus]);

  if (treatmentPlanStatus === "loading" || medicalBoardStatus === "loading") {
    return (
      <Box sx={{ display: "flex", alignItems: "center", justifyContent: "center", py: 6 }}>
        <RefreshRounded sx={{ fontSize: 28, color: C.ash, animation: "spin 1s linear infinite" }} />
      </Box>
    );
  }

  const treatmentVisible = treatmentPlanStatus === "found";
  const boardVisible = medicalBoardStatus === "pending" || medicalBoardStatus === "approved";

  // Neither plan exists
  if (!treatmentVisible && !boardVisible) {
    return (
      <Box sx={{ p: 5, textAlign: "center", border: `1px solid ${C.fog}`, borderRadius: "4px", background: C.ghost }}>
        <AccountTreeRounded sx={{ fontSize: 36, color: C.silver, mb: 1.5, opacity: 0.6 }} />
        <Typography sx={{ ...os({ fontSize: 13, color: C.ash }) }}>
          No treatment plan or medical board plan available for this patient yet
        </Typography>
      </Box>
    );
  }

  const boardBody = (
    <MedicalBoardPlanBody
      medicalBoardStatus={medicalBoardStatus}
      planDoc={medicalBoardDoc}
      doctorNames={doctorNames}
      onStepClick={setSelectedStep}
    />
  );

  // Reusable popup — mounted once, driven by `selectedStep`.
  // After a successful "Complete Step" it re-fetches silently so the
  // underlying row/plan updates without any reload.
  const stepDialog = (
    <StepDetailDialog
      step={selectedStep}
      patientId={patientId}
      doctorId={doctorId}
      onClose={() => setSelectedStep(null)}
      onCompleted={() => fetchMedicalBoardPlan({ silent: true })}
    />
  );

  // Only one of the two exists — skip the sub-tab bar entirely
  if (treatmentVisible && !boardVisible) {
    return <TreatmentPlanBody treatmentPlanDoc={treatmentPlanDoc} />;
  }
  if (boardVisible && !treatmentVisible) {
    return (
      <>
        {boardBody}
        {stepDialog}
      </>
    );
  }

  // Both exist — show sub-tabs
  return (
    <Box>
      <Tabs value={activeSubTab} onChange={(_, v) => setActiveSubTab(v)} sx={{ ...tabSx, mb: 2 }}>
        <Tab label="Treatment Plan" />
        <Tab label="Medical Board Plan" />
      </Tabs>
      {activeSubTab === 0 && <TreatmentPlanBody treatmentPlanDoc={treatmentPlanDoc} />}
      {activeSubTab === 1 && boardBody}
      {stepDialog}
    </Box>
  );
};

export default MedicalBoardPlanTab;