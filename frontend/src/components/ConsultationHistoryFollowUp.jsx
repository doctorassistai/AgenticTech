import React, { useState, useEffect, useCallback } from "react";
import {
  Box,
  Typography,
  Divider,
  Collapse,
  CircularProgress,
  Tabs,
  Tab,
} from "@mui/material";
import {
  CheckCircleRounded,
  ErrorRounded,
  ExpandMoreRounded,
  WarningRounded,
} from "@mui/icons-material";

const API_BASE_URL = import.meta.env.VITE_BACKEND_URL;

// ─── Design Tokens (kept identical to DoctorDashboard) ──────────────────────
const FONT = '"Open Sans", sans-serif';
const FW = 300;

const C = {
  black: "#0a0a0a",
  ink: "#1a1a1a",
  charcoal: "#2e2e2e",
  smoke: "#4a4a4a",
  ash: "#7a7a7a",
  silver: "#a8a8a8",
  mist: "#d4d4d4",
  fog: "#e8e8e8",
  ghost: "#f2f2f2",
  white: "#ffffff",
  // urgency accents — kept subtle, used only where clinically meaningful
  urgentRed: "#8a2e2e",
  urgentRedBg: "#faf1f1",
  priorityAmber: "#8a6a2e",
  priorityAmberBg: "#faf6ee",
};

const os = (extra = {}) => ({ fontFamily: FONT, fontWeight: FW, ...extra });

const card = {
  background: C.white,
  border: `1px solid ${C.fog}`,
  borderRadius: "4px",
  boxShadow: "0 1px 3px rgba(0,0,0,0.06)",
};

const sectionCard = { ...card, overflow: "hidden" };

const actionButton = {
  px: 2.5,
  py: 1.1,
  borderRadius: "2px",
  fontSize: 12,
  fontWeight: 400,
  fontFamily: FONT,
  textTransform: "none",
  letterSpacing: "0.06em",
  background: C.black,
  color: C.white,
  border: "none",
  cursor: "pointer",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  gap: 0.75,
  transition: "background 0.18s ease",
  "&:hover": { background: C.charcoal },
  "&:active": { background: C.ink },
  "&:disabled": { opacity: 0.4, cursor: "not-allowed" },
};

const SectionHeader = ({ children, sub, action }) => (
  <Box sx={{ px: { xs: 2.5, sm: 3 }, pt: { xs: 2.5, sm: 3 }, pb: 2, borderBottom: `1px solid ${C.fog}`, display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 2 }}>
    <Box>
      <Typography sx={{ ...os({ fontSize: 14, color: C.ink, letterSpacing: "0.02em" }) }}>{children}</Typography>
      {sub && <Typography sx={{ ...os({ fontSize: 11, color: C.ash, mt: 0.4 }) }}>{sub}</Typography>}
    </Box>
    {action && <Box sx={{ flexShrink: 0 }}>{action}</Box>}
  </Box>
);

// ─── Render helpers for documentation output ────────────────────────────────
const isEmptyValue = (v) =>
  v === "" || v === null || v === undefined || (Array.isArray(v) && v.length === 0);

const PRIMARY_KEYS = ["medication", "investigation_name", "diagnosis_text", "name", "title", "drug_name", "test_name"];

const IGNORED_KEYS = ["icd_selections", "confidence", "validation_status", "rank", "necessity_status", "safety_status", "editable"];

const renderDocFields = (obj) => {
  const entries = Object.entries(obj).filter(([k, v]) => !isEmptyValue(v) && !IGNORED_KEYS.includes(k));
  if (!entries.length) return <Typography sx={{ ...os({ fontSize: 12.5, color: C.ash, fontStyle: "italic" }) }}>No data</Typography>;

  return (
    <Box sx={{ display: "flex", flexDirection: "column", gap: 1.5 }}>
      {entries.map(([k, v]) => (
        <Box key={k}>
          <Typography sx={{ ...os({ fontSize: 10.5, color: C.ash, textTransform: "capitalize", mb: 0.3 }) }}>
            {k.replace(/_/g, " ")}
          </Typography>
          {typeof v === "string" ? (
            <Typography sx={{ ...os({ fontSize: 12.5, color: C.ink, whiteSpace: "pre-line", lineHeight: 1.75 }) }}>
              {v}
            </Typography>
          ) : Array.isArray(v) ? (
            renderDocArray(v)
          ) : typeof v === "object" && v !== null ? (
            <Box sx={{ pl: 1.5, borderLeft: `2px solid ${C.fog}` }}>{renderDocFields(v)}</Box>
          ) : (
            <Typography sx={{ ...os({ fontSize: 12.5, color: C.ink }) }}>{String(v)}</Typography>
          )}
        </Box>
      ))}
    </Box>
  );
};

const renderDocArray = (arr) => {
  if (!arr.length) return <Typography sx={{ ...os({ fontSize: 12.5, color: C.ash, fontStyle: "italic" }) }}>None</Typography>;

  return (
    <Box sx={{ display: "flex", flexDirection: "column", gap: 1.5 }}>
      {arr.map((item, idx) => {
        if (typeof item === "string") {
          return <Typography key={idx} sx={{ ...os({ fontSize: 12.5, color: C.ink }) }}>{item}</Typography>;
        }
        if (typeof item !== "object" || item === null) {
          return <Typography key={idx} sx={{ ...os({ fontSize: 12.5, color: C.ink }) }}>{String(item)}</Typography>;
        }

        const filteredEntries = Object.entries(item).filter(([k, v]) => !isEmptyValue(v) && !IGNORED_KEYS.includes(k));
        const primaryEntry = filteredEntries.find(([k]) => PRIMARY_KEYS.includes(k));
        const rest = filteredEntries.filter(([k]) => !primaryEntry || k !== primaryEntry[0]);

        return (
          <Box key={idx} sx={{ border: `1px solid ${C.fog}`, borderRadius: "3px", p: 2, background: C.ghost }}>
            {primaryEntry && (
              <Typography sx={{ ...os({ fontSize: 13, color: C.ink, mb: 1 }) }}>{String(primaryEntry[1])}</Typography>
            )}
            <Box sx={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(140px, 1fr))", gap: 1.5 }}>
              {rest.map(([k, v]) => {
                if (typeof v === "object" && v !== null) {
                  return (
                    <Box key={k} sx={{ gridColumn: "1 / -1" }}>
                      <Typography sx={{ ...os({ fontSize: 10.5, color: C.ash, textTransform: "capitalize", mb: 0.4 }) }}>
                        {k.replace(/_/g, " ")}
                      </Typography>
                      {Array.isArray(v) ? renderDocArray(v) : renderDocFields(v)}
                    </Box>
                  );
                }
                return (
                  <Box key={k}>
                    <Typography sx={{ ...os({ fontSize: 10.5, color: C.ash, textTransform: "capitalize" }) }}>
                      {k.replace(/_/g, " ")}
                    </Typography>
                    <Typography sx={{ ...os({ fontSize: 12, color: C.ink, mt: 0.2 }) }}>{String(v)}</Typography>
                  </Box>
                );
              })}
            </Box>
          </Box>
        );
      })}
    </Box>
  );
};

const renderDocObject = (obj) => {
  const entries = Object.entries(obj).filter(([k, v]) => !isEmptyValue(v) && !IGNORED_KEYS.includes(k));
  if (entries.length === 0) return <Typography sx={{ ...os({ fontSize: 12.5, color: C.ash, fontStyle: "italic" }) }}>No data</Typography>;

  return (
    <Box sx={{ display: "flex", flexDirection: "column", gap: 2.5 }}>
      {entries.map(([sectionKey, sectionValue]) => (
        <Box key={sectionKey}>
          <Typography sx={{ ...os({ fontSize: 11.5, color: C.ash, letterSpacing: "0.04em", textTransform: "uppercase", mb: 1.25 }) }}>
            {sectionKey.replace(/_/g, " ")}
          </Typography>
          {typeof sectionValue === "string" ? (
            <Typography sx={{ ...os({ fontSize: 12.5, color: C.ink, whiteSpace: "pre-line", lineHeight: 1.75 }) }}>
              {sectionValue}
            </Typography>
          ) : Array.isArray(sectionValue) ? (
            renderDocArray(sectionValue)
          ) : typeof sectionValue === "object" && sectionValue !== null ? (
            renderDocFields(sectionValue)
          ) : (
            <Typography sx={{ ...os({ fontSize: 12.5, color: C.ink }) }}>{String(sectionValue)}</Typography>
          )}
        </Box>
      ))}
    </Box>
  );
};

const renderFinalOutput = (output, fallback = "No data recorded") => {
  if (!output) {
    return <Typography sx={{ ...os({ fontSize: 12.5, color: C.ash, fontStyle: "italic" }) }}>{fallback}</Typography>;
  }
  if (typeof output === "string") {
    return (
      <Typography sx={{ ...os({ fontSize: 12.5, color: C.ink, whiteSpace: "pre-line", lineHeight: 1.75 }) }}>
        {output}
      </Typography>
    );
  }
  if (Array.isArray(output)) return renderDocArray(output);
  if (typeof output === "object") {
    let processedOutput = output;
    // Merge ICD selections back into diagnosis list, matching original behaviour
    if (output.clinical_validation?.diagnosis_validation?.diagnoses && output.icd_selections) {
      processedOutput = JSON.parse(JSON.stringify(output));
      const diagnoses = processedOutput.clinical_validation.diagnosis_validation.diagnoses;
      const selections = processedOutput.icd_selections;
      Object.keys(selections).forEach((index) => {
        if (diagnoses[index]) {
          diagnoses[index].icd10_codes = [selections[index]];
        }
      });
    }
    return renderDocObject(processedOutput);
  }
  return <Typography sx={{ ...os({ fontSize: 12.5, color: C.ink }) }}>{String(output)}</Typography>;
};

const getFeatureData = (features, ...keywords) => {
  if (!features) return null;
  for (const key of Object.keys(features)) {
    if (keywords.some((kw) => key.includes(kw))) {
      return features[key]?.finaloutput;
    }
  }
  return null;
};

// ─── Helpers for building the follow-up plan payload straight from records ──

// Turns a comma- or newline-separated string into a clean string array.
const splitToList = (text) =>
  (text || "")
    .split(/[\n,]/)
    .map((s) => s.trim())
    .filter(Boolean);

// Flattens a single documentation item (string or structured object) into one
// human-readable line, e.g. "Metformin 500mg BD" or "CBC 12-Jun-2026 — WBC 2.1 (low)".
const flattenItemToLine = (item) => {
  if (item === null || item === undefined) return "";
  if (typeof item === "string") return item;
  if (typeof item === "number" || typeof item === "boolean") return String(item);
  if (typeof item !== "object") return String(item);

  const entries = Object.entries(item).filter(([k, v]) => !isEmptyValue(v) && !IGNORED_KEYS.includes(k));
  const primaryEntry = entries.find(([k]) => PRIMARY_KEYS.includes(k));
  const rest = entries.filter(([k]) => !primaryEntry || k !== primaryEntry[0]);

  const restStrs = rest
    .filter(([, v]) => typeof v === "string" || typeof v === "number")
    .map(([, v]) => String(v));

  const primaryStr = primaryEntry ? String(primaryEntry[1]) : "";
  return [primaryStr, ...restStrs].filter(Boolean).join(" — ");
};

// Turns a documentation `finaloutput` (string, array, or object) into
// newline-separated text.
const outputToText = (output) => {
  if (!output) return "";
  if (typeof output === "string") return output;
  if (Array.isArray(output)) {
    return output.map(flattenItemToLine).filter(Boolean).join("\n");
  }
  if (typeof output === "object") {
    return flattenItemToLine(output);
  }
  return String(output);
};

// Candidate field names for vitals, since the raw vitals payload shape can vary
// slightly depending on how it was captured upstream.
const VITAL_FIELD_CANDIDATES = {
  bp: ["bp", "blood_pressure"],
  systolic: ["systolic_bp", "systolic", "bp_systolic"],
  diastolic: ["diastolic_bp", "diastolic", "bp_diastolic"],
  hr: ["hr", "heart_rate", "pulse", "pulse_rate"],
  temp: ["temp", "temperature"],
  spo2: ["spo2", "spO2", "oxygen_saturation"],
  weight: ["weight", "weight_kg", "body_weight"],
};

const pickField = (obj, keys) => {
  for (const k of keys) {
    if (obj?.[k] !== undefined && obj[k] !== null && obj[k] !== "") return obj[k];
  }
  return null;
};

// Extracts {bp, hr, temp, spo2, weight} strings from a single raw vitals record.
const extractVitalsFromRecord = (vital) => {
  if (!vital || typeof vital !== "object") {
    return { bp: "", hr: "", temp: "", spo2: "", weight: "" };
  }
  let bp = pickField(vital, VITAL_FIELD_CANDIDATES.bp);
  if (!bp) {
    const sys = pickField(vital, VITAL_FIELD_CANDIDATES.systolic);
    const dia = pickField(vital, VITAL_FIELD_CANDIDATES.diastolic);
    if (sys && dia) bp = `${sys}/${dia}`;
  }
  return {
    bp: bp ? String(bp) : "",
    hr: (() => { const v = pickField(vital, VITAL_FIELD_CANDIDATES.hr); return v ? String(v) : ""; })(),
    temp: (() => { const v = pickField(vital, VITAL_FIELD_CANDIDATES.temp); return v ? String(v) : ""; })(),
    spo2: (() => { const v = pickField(vital, VITAL_FIELD_CANDIDATES.spo2); return v ? String(v) : ""; })(),
    weight: (() => { const v = pickField(vital, VITAL_FIELD_CANDIDATES.weight); return v ? String(v) : ""; })(),
  };
};

const urgencyStyles = {
  urgent: { border: C.urgentRed, bg: C.urgentRedBg, text: C.urgentRed, label: "Urgent" },
  priority: { border: C.priorityAmber, bg: C.priorityAmberBg, text: C.priorityAmber, label: "Priority" },
  routine: { border: C.fog, bg: C.ghost, text: C.smoke, label: "Routine" },
};

const responseStatusLabel = {
  responding: "Responding",
  stable: "Stable",
  mixed: "Mixed",
  concerning: "Concerning",
  insufficient_data: "Insufficient Data",
};

const Pill = ({ children }) => (
  <Box
    sx={{
      display: "inline-flex",
      alignItems: "center",
      px: 1.25,
      py: 0.4,
      border: `1px solid ${C.fog}`,
      borderRadius: "2px",
      background: C.ghost,
    }}
  >
    <Typography sx={{ ...os({ fontSize: 10.5, color: C.smoke, letterSpacing: "0.03em" }) }}>{children}</Typography>
  </Box>
);

// Renders the structured FollowUpConsultationPlan returned by the backend.
const FollowUpPlanResult = ({ plan }) => {
  if (!plan) return null;

  const urgency = urgencyStyles[plan.urgency] || urgencyStyles.routine;
  const ctx = plan.clinical_context || {};
  const focus = plan.specialty_focus || {};
  const response = plan.treatment_response_assessment || {};
  const redFlags = plan.red_flag_screen || {};
  const questions = plan.symptom_check_questions || [];
  const checklist = plan.checklist || {};

  return (
    <Box sx={{ ...sectionCard, mt: 3 }}>
      <SectionHeader sub="Generated from this visit's inputs plus the patient's full longitudinal history">
        Consultation Prep Pack
      </SectionHeader>

      <Box sx={{ p: { xs: 2, sm: 3 }, display: "flex", flexDirection: "column", gap: 3 }}>
        {/* Urgency + brief */}
        <Box
          sx={{
            border: `1px solid ${urgency.border}`,
            background: urgency.bg,
            borderRadius: "3px",
            p: 2.25,
          }}
        >
          <Box sx={{ display: "flex", alignItems: "center", gap: 1, mb: 1 }}>
            {plan.urgency !== "routine" && <WarningRounded sx={{ fontSize: 16, color: urgency.text }} />}
            <Typography sx={{ ...os({ fontSize: 11, color: urgency.text, letterSpacing: "0.06em", textTransform: "uppercase" }) }}>
              {urgency.label}
            </Typography>
            {response.response_status && (
              <>
                <Box sx={{ width: "1px", height: 12, background: C.mist }} />
                <Typography sx={{ ...os({ fontSize: 11, color: C.ash }) }}>
                  Treatment response: {responseStatusLabel[response.response_status] || response.response_status}
                </Typography>
              </>
            )}
          </Box>
          {redFlags.escalation_action && (
            <Typography sx={{ ...os({ fontSize: 12, color: urgency.text, mb: 1 }) }}>
              {redFlags.escalation_action}
            </Typography>
          )}
          <Typography sx={{ ...os({ fontSize: 13, color: C.ink, lineHeight: 1.85, whiteSpace: "pre-line" }) }}>
            {plan.consultation_brief || "No brief generated."}
          </Typography>
        </Box>

        {/* Warnings */}
        {plan.warnings?.length > 0 && (
          <Box sx={{ display: "flex", flexDirection: "column", gap: 0.75 }}>
            {plan.warnings.map((w, i) => (
              <Box key={i} sx={{ display: "flex", alignItems: "flex-start", gap: 1 }}>
                <ErrorRounded sx={{ fontSize: 13, color: C.silver, mt: "2px" }} />
                <Typography sx={{ ...os({ fontSize: 11.5, color: C.ash }) }}>{w}</Typography>
              </Box>
            ))}
          </Box>
        )}

        <Divider sx={{ borderColor: C.fog }} />

        {/* Specialty focus */}
        <Box>
          <Typography sx={{ ...os({ fontSize: 11.5, color: C.ash, letterSpacing: "0.04em", textTransform: "uppercase", mb: 1.25 }) }}>
            Visit Focus — {focus.specialty ? focus.specialty.replace(/_/g, " ") : "General"}
          </Typography>
          <Box sx={{ display: "flex", flexWrap: "wrap", gap: 0.75, mb: focus.rationale ? 1.25 : 0 }}>
            {(focus.primary_focus_domains || []).map((d, i) => (
              <Pill key={i}>{d}</Pill>
            ))}
          </Box>
          {focus.rationale && (
            <Typography sx={{ ...os({ fontSize: 12, color: C.smoke, lineHeight: 1.7 }) }}>{focus.rationale}</Typography>
          )}
          {focus.monitoring_priorities?.length > 0 && (
            <Box sx={{ mt: 1.5, display: "flex", flexDirection: "column", gap: 0.5 }}>
              {focus.monitoring_priorities.map((m, i) => (
                <Typography key={i} sx={{ ...os({ fontSize: 12, color: C.ink }) }}>
                  · {m}
                </Typography>
              ))}
            </Box>
          )}
        </Box>

        <Divider sx={{ borderColor: C.fog }} />

        {/* Clinical context summary */}
        <Box>
          <Typography sx={{ ...os({ fontSize: 11.5, color: C.ash, letterSpacing: "0.04em", textTransform: "uppercase", mb: 1.25 }) }}>
            Clinical Picture
          </Typography>
          <Box sx={{ display: "grid", gridTemplateColumns: { xs: "1fr", sm: "1fr 1fr" }, gap: 1.5, mb: 1.5 }}>
            <Box>
              <Typography sx={{ ...os({ fontSize: 10.5, color: C.silver }) }}>Diagnosis</Typography>
              <Typography sx={{ ...os({ fontSize: 12.5, color: C.ink, mt: 0.2 }) }}>{ctx.primary_diagnosis || "—"}</Typography>
            </Box>
            <Box>
              <Typography sx={{ ...os({ fontSize: 10.5, color: C.silver }) }}>Disease Status</Typography>
              <Typography sx={{ ...os({ fontSize: 12.5, color: C.ink, mt: 0.2 }) }}>{ctx.disease_status || "—"}</Typography>
            </Box>
          </Box>
          {ctx.interval_history?.length > 0 && (
            <Box sx={{ mb: 1.5 }}>
              <Typography sx={{ ...os({ fontSize: 10.5, color: C.silver, mb: 0.4 }) }}>Since Last Visit</Typography>
              {ctx.interval_history.map((h, i) => (
                <Typography key={i} sx={{ ...os({ fontSize: 12.5, color: C.ink, mb: 0.3 }) }}>
                  · {h}
                </Typography>
              ))}
            </Box>
          )}
          {ctx.clinical_summary_text && (
            <Typography sx={{ ...os({ fontSize: 12.5, color: C.smoke, lineHeight: 1.75, fontStyle: "italic" }) }}>
              {ctx.clinical_summary_text}
            </Typography>
          )}
        </Box>

        <Divider sx={{ borderColor: C.fog }} />

        {/* Symptom check questions */}
        <Box>
          <Typography sx={{ ...os({ fontSize: 11.5, color: C.ash, letterSpacing: "0.04em", textTransform: "uppercase", mb: 1.25 }) }}>
            Questions to Ask the Patient
          </Typography>
          {questions.length === 0 ? (
            <Typography sx={{ ...os({ fontSize: 12.5, color: C.ash, fontStyle: "italic" }) }}>None generated</Typography>
          ) : (
            <Box sx={{ display: "flex", flexDirection: "column", gap: 1.5 }}>
              {questions.map((q, i) => (
                <Box key={i} sx={{ border: `1px solid ${C.fog}`, borderRadius: "3px", p: 1.75, background: C.ghost }}>
                  <Box sx={{ display: "flex", justifyContent: "space-between", gap: 1.5, mb: 0.5 }}>
                    <Typography sx={{ ...os({ fontSize: 12.5, color: C.ink }) }}>{q.question}</Typography>
                    <Box sx={{ flexShrink: 0 }}>
                      <Pill>{q.category}</Pill>
                    </Box>
                  </Box>
                  {q.clinical_rationale && (
                    <Typography sx={{ ...os({ fontSize: 11, color: C.ash, mt: 0.5 }) }}>{q.clinical_rationale}</Typography>
                  )}
                </Box>
              ))}
            </Box>
          )}
        </Box>

        <Divider sx={{ borderColor: C.fog }} />

        {/* Checklist */}
        <Box>
          <Typography sx={{ ...os({ fontSize: 11.5, color: C.ash, letterSpacing: "0.04em", textTransform: "uppercase", mb: 1.25 }) }}>
            Clinician Checklist
          </Typography>
          <Box sx={{ display: "grid", gridTemplateColumns: { xs: "1fr", sm: "1fr 1fr" }, gap: 2 }}>
            {[
              ["Vitals to Check", checklist.vitals_to_check],
              ["Physical Exam", checklist.physical_exam_items],
              ["Investigations to Review", checklist.investigations_to_review],
              ["Investigations to Order", checklist.investigations_to_order],
              ["Medication Adherence", checklist.medication_adherence_checks],
            ].map(([label, items]) => (
              <Box key={label}>
                <Typography sx={{ ...os({ fontSize: 10.5, color: C.silver, mb: 0.5 }) }}>{label}</Typography>
                {!items || items.length === 0 ? (
                  <Typography sx={{ ...os({ fontSize: 11.5, color: C.ash, fontStyle: "italic" }) }}>None</Typography>
                ) : (
                  items.map((it, i) => (
                    <Typography key={i} sx={{ ...os({ fontSize: 12, color: C.ink, mb: 0.3 }) }}>
                      · {it}
                    </Typography>
                  ))
                )}
              </Box>
            ))}
          </Box>
        </Box>
      </Box>
    </Box>
  );
};

// ─── Main Component ──────────────────────────────────────────────────────────
/**
 * Encapsulates the entire "follow-up" consultation history experience:
 * fetching prior documentation/vitals grouped by appointment, the "Process Data"
 * action (which builds the payload directly from whatever has already been
 * recorded against `currentAppointmentId` via the documentation-outputs
 * endpoint — no manual entry required), and the expandable timeline UI plus
 * the resulting consultation prep pack.
 *
 * Parent usage:
 *   {isFollowUp && (
 *     <ConsultationHistoryFollowUp
 *       patientId={patientId}
 *       doctorId={doctorId}
 *       currentAppointmentId={currentAppointmentId}
 *       isMobile={isMobile}
 *     />
 *   )}
 */
export default function ConsultationHistoryFollowUp({
  patientId,
  doctorId,
  currentAppointmentId,
  isMobile,
}) {
  const [consultationHistory, setConsultationHistory] = useState([]);
  const [loadingHistory, setLoadingHistory] = useState(false);
  const [expandedAppointment, setExpandedAppointment] = useState(null);
  const [selectedHistoryTab, setSelectedHistoryTab] = useState({});
  const [processingHistory, setProcessingHistory] = useState(false);
  const [processingSuccess, setProcessingSuccess] = useState(false);
  const [processingError, setProcessingError] = useState(null);

  // ── Result of the last successful "Process Data" call ───────────────────
  const [consultationPlan, setConsultationPlan] = useState(null);

  // Finds the entry in the fetched, grouped history that corresponds to
  // today's / the current appointment (i.e. the visit already in progress).
  const findCurrentAppointmentEntry = useCallback(
    (history) => {
      if (!currentAppointmentId) return null;
      return (
        history.find((a) => a.appointment_id === currentAppointmentId) ||
        history.find((a) => a.metadata?.appointment_id === currentAppointmentId) ||
        null
      );
    },
    [currentAppointmentId]
  );

  const fetchConsultationHistory = async () => {
    if (!patientId || !doctorId) return;
    setLoadingHistory(true);
    try {
      const res = await fetch(
        `${API_BASE_URL}hms/users/data/context/get-documentation-outputs?patient_id=${patientId}&doctor_id=${doctorId}`
      );
      const data = await res.json();
      const outputs = data?.documentation_outputs || [];

      // Group documents by appointment_id (from metadata) or by date
      const grouped = {};
      for (const doc of outputs) {
        const groupKey =
          doc.metadata?.appointment_id ||
          doc.created_at?.split("T")[0] ||
          "unknown";
        if (!grouped[groupKey]) {
          grouped[groupKey] = {
            key: groupKey,
            created_at: doc.created_at,
            metadata: doc.metadata || {},
            features: {},
          };
        }
        if (doc.created_at > (grouped[groupKey].created_at || "")) {
          grouped[groupKey].created_at = doc.created_at;
        }
        const fname = (doc.feature_name || "").toLowerCase().replace(/[\s-]+/g, "_");
        if (
          !grouped[groupKey].features[fname] ||
          new Date(doc.created_at) > new Date(grouped[groupKey].features[fname].created_at || 0)
        ) {
          grouped[groupKey].features[fname] = {
            finaloutput: doc.finaloutput,
            display_method: doc.display_method,
            feature_id: doc.feature_id,
            feature_name: doc.feature_name,
            created_at: doc.created_at,
          };
        }
      }

      // Group vitals into the correct appointment
      if (data?.vitals?.vitals) {
        for (const vital of data.vitals.vitals) {
          const vitalDate = vital.timestamp?.split("T")[0];
          if (!vitalDate) continue;

          let groupKey = Object.keys(grouped).find(
            (k) => grouped[k].created_at?.startsWith(vitalDate) || k.startsWith(vitalDate)
          );
          if (!groupKey) groupKey = vitalDate;

          if (!grouped[groupKey]) {
            grouped[groupKey] = {
              key: groupKey,
              created_at: vital.timestamp,
              metadata: { patient_id: patientId, doctor_id: doctorId },
              features: {},
            };
          }

          if (!grouped[groupKey].features["vitals"]) {
            grouped[groupKey].features["vitals"] = {
              finaloutput: [],
              display_method: "object",
              feature_id: "vitals",
              feature_name: "Vitals",
              created_at: vital.timestamp,
            };
          }
          grouped[groupKey].features["vitals"].finaloutput.push(vital);
        }
      }

      const sorted = Object.values(grouped)
        .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
        .map((g) => ({
          appointment_id: g.key,
          appointment_date: g.created_at
            ? new Date(g.created_at).toLocaleDateString("en-IN", {
                year: "numeric",
                month: "short",
                day: "numeric",
              })
            : g.key,
          created_at: g.created_at,
          metadata: g.metadata,
          features: g.features,
          status: "success",
        }));

      setConsultationHistory(sorted);
    } catch (err) {
      console.error("❌ Failed to fetch consultation history:", err);
      setConsultationHistory([]);
    } finally {
      setLoadingHistory(false);
    }
  };

  useEffect(() => {
    if (patientId && doctorId) {
      fetchConsultationHistory();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [patientId, doctorId, currentAppointmentId]);

  // Builds the payload straight from the current appointment's recorded
  // documentation and posts it to the follow-up consultation plan endpoint.
  const handleProcessFollowUpData = async () => {
    if (!patientId || !doctorId) return;

    setProcessingHistory(true);
    setProcessingError(null);
    setProcessingSuccess(false);
    setConsultationPlan(null);

    const entry = consultationHistory[0];

    if (!entry) {
      setProcessingError("No consultation history found.");
      setProcessingHistory(false);
      return;
    }

    const meds = outputToText(getFeatureData(entry.features, "medication"));
    const invs = outputToText(getFeatureData(entry.features, "investigation"));
    const plan = outputToText(getFeatureData(entry.features, "treatment"));
    const note = outputToText(getFeatureData(entry.features, "clinical"));

    const vitalsData = getFeatureData(entry.features, "vitals");
    const latestVital = Array.isArray(vitalsData) ? vitalsData[vitalsData.length - 1] : vitalsData;
    const vitals = extractVitalsFromRecord(latestVital);

    const payload = {
      patient_id: patientId,
      doctor_id: doctorId,
      current_medications: splitToList(meds),
      investigations: splitToList(invs),
      treatment_plan: plan || "",
      latest_clinical_note: note || "",
      vitals: [
        vitals.bp && `BP ${vitals.bp}`,
        vitals.hr && `HR ${vitals.hr}`,
        vitals.temp && `Temp ${vitals.temp}`,
        vitals.spo2 && `SpO2 ${vitals.spo2}`,
        vitals.weight && `Weight ${vitals.weight}`,
      ].filter(Boolean),
    };

    try {
      const res = await fetch(`${API_BASE_URL}hms/users/ai-legacy/generate-followup-consultation-plan`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const errBody = await res.json().catch(() => ({}));
        throw new Error(errBody?.detail || `Request failed with status ${res.status}`);
      }

      const data = await res.json();
      setConsultationPlan(data?.followup_consultation_plan || null);
      setProcessingSuccess(true);
      fetchConsultationHistory();
      setTimeout(() => setProcessingSuccess(false), 2000);
    } catch (err) {
      console.error("❌ Failed to process follow-up data:", err);
      setProcessingError(err?.message || "Failed to process data. Please try again.");
    } finally {
      setProcessingHistory(false);
    }
  };

  return (
    <Box sx={{ display: "flex", flexDirection: "column" }}>
      <Box sx={{ ...sectionCard }}>
        <SectionHeader
          sub="Consultation history from this patient's previous visits"
          action={
            <Box
              component="button"
              type="button"
              onClick={handleProcessFollowUpData}
              disabled={processingHistory}
              sx={{ ...actionButton, minWidth: 170 }}
            >
              {processingHistory ? (
                <>
                  <CircularProgress size={13} thickness={5} sx={{ color: C.white }} />
                  Processing...
                </>
              ) : processingSuccess ? (
                <>
                  <CheckCircleRounded sx={{ fontSize: 15 }} />
                  Data Processed Successfully
                </>
              ) : (
                "Process Data"
              )}
            </Box>
          }
        >
          Patient Consultation History
        </SectionHeader>

        <Box sx={{ p: { xs: 2, sm: 3 } }}>
          {processingError && (
            <Box
              sx={{
                mb: 2,
                px: 2,
                py: 1.1,
                border: `1px solid ${C.fog}`,
                borderRadius: "2px",
                background: C.ghost,
                display: "flex",
                alignItems: "center",
                gap: 1,
              }}
            >
              <ErrorRounded sx={{ fontSize: 15, color: C.smoke }} />
              <Typography sx={{ ...os({ fontSize: 12, color: C.smoke }) }}>{processingError}</Typography>
            </Box>
          )}

          {loadingHistory ? (
            <Box sx={{ py: 4, textAlign: "center" }}>
              <Typography sx={{ ...os({ fontSize: 13, color: C.ash }) }}>Loading consultation history...</Typography>
            </Box>
          ) : consultationHistory.length === 0 ? (
            <Box sx={{ py: 4, textAlign: "center" }}>
              <Typography sx={{ ...os({ fontSize: 13, color: C.ash }) }}>No previous consultations found</Typography>
            </Box>
          ) : (
            <Box sx={{ display: "flex", gap: { xs: 2, sm: 3 }, flexDirection: isMobile ? "column" : "row" }}>
              {/* Timeline rail */}
              {!isMobile && (
                <Box sx={{ display: "flex", flexDirection: "column", alignItems: "center", pt: 2, flexShrink: 0 }}>
                  {consultationHistory.map((appt, i) => (
                    <React.Fragment key={appt.appointment_id ?? i}>
                      <Box
                        sx={{
                          width: i === 0 ? 9 : 7,
                          height: i === 0 ? 9 : 7,
                          borderRadius: "50%",
                          background: i === 0 ? C.black : C.white,
                          border: `1.5px solid ${C.black}`,
                          flexShrink: 0,
                        }}
                      />
                      {i < consultationHistory.length - 1 && (
                        <Box sx={{ width: "1px", flexGrow: 1, minHeight: 56, background: C.fog, my: 0.5 }} />
                      )}
                    </React.Fragment>
                  ))}
                </Box>
              )}

              {/* Appointment cards */}
              <Box sx={{ flex: 1, display: "flex", flexDirection: "column", gap: 2, minWidth: 0 }}>
                {consultationHistory.map((appt, i) => {
                  const apptKey = appt.appointment_id ?? i;
                  const isExpanded = expandedAppointment === apptKey;
                  const activeTab = selectedHistoryTab[apptKey] ?? 0;

                  return (
                    <Box key={apptKey} sx={{ ...card, overflow: "hidden" }}>
                      {/* Card header */}
                      <Box
                        onClick={() => setExpandedAppointment(isExpanded ? null : apptKey)}
                        sx={{
                          px: 2.5,
                          py: 2,
                          display: "flex",
                          alignItems: "flex-start",
                          justifyContent: "space-between",
                          gap: 2,
                          cursor: "pointer",
                          "&:hover": { background: C.ghost },
                          transition: "background 0.15s",
                        }}
                      >
                        <Box sx={{ minWidth: 0 }}>
                          <Typography sx={{ ...os({ fontSize: 13, color: C.ink }) }}>
                            {appt.appointment_date}
                            {i === 0 && (
                              <Box
                                component="span"
                                sx={{ ...os({ fontSize: 10, color: C.ash, ml: 1, letterSpacing: "0.05em", textTransform: "uppercase" }) }}
                              >
                                Latest
                              </Box>
                            )}
                          </Typography>
                          <Typography sx={{ ...os({ fontSize: 11.5, color: C.ash, mt: 0.4 }) }}>
                            Follow-up Consultation · {Object.keys(appt.features || {}).length} documentation outputs
                          </Typography>
                          <Typography sx={{ ...os({ fontSize: 10.5, color: C.silver, mt: 0.3 }) }}>
                            Last appointment date:{" "}
                            {appt.created_at
                              ? new Date(appt.created_at).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" })
                              : appt.appointment_date}
                          </Typography>
                        </Box>
                        <Box sx={{ display: "flex", alignItems: "center", gap: 1.25, flexShrink: 0 }}>
                          <ExpandMoreRounded
                            sx={{
                              fontSize: 18,
                              color: C.ash,
                              transform: isExpanded ? "rotate(180deg)" : "rotate(0deg)",
                              transition: "transform 0.18s ease",
                            }}
                          />
                        </Box>
                      </Box>

                      {/* Collapsed blurred preview */}
                      {!isExpanded && (
                        <Box onClick={() => setExpandedAppointment(apptKey)} sx={{ cursor: "pointer" }}>
                          <Box sx={{ position: "relative", maxHeight: 72, overflow: "hidden", px: 2.5 }}>
                            <Typography sx={{ ...os({ fontSize: 10.5, color: C.silver, textTransform: "uppercase", letterSpacing: "0.05em", mb: 0.5 }) }}>
                              Medication
                            </Typography>
                            <Typography sx={{ ...os({ fontSize: 12, color: C.smoke, filter: "blur(3px)", userSelect: "none", whiteSpace: "pre-line" }) }}>
                              {(() => {
                                const d = getFeatureData(appt.features, "medication");
                                return !d ? "No data recorded" : typeof d === "string" ? d : "Documentation data available";
                              })()}
                            </Typography>
                            <Typography sx={{ ...os({ fontSize: 10.5, color: C.silver, textTransform: "uppercase", letterSpacing: "0.05em", mt: 1.25, mb: 0.5 }) }}>
                              Treatment Plan
                            </Typography>
                            <Typography sx={{ ...os({ fontSize: 12, color: C.smoke, filter: "blur(3px)", userSelect: "none", whiteSpace: "pre-line" }) }}>
                              {(() => {
                                const d = getFeatureData(appt.features, "treatment");
                                return !d ? "No data recorded" : typeof d === "string" ? d : "Documentation data available";
                              })()}
                            </Typography>
                            <Box
                              sx={{
                                position: "absolute",
                                left: 0,
                                right: 0,
                                bottom: 0,
                                height: 40,
                                background: `linear-gradient(180deg, rgba(255,255,255,0), ${C.white})`,
                              }}
                            />
                          </Box>
                          <Box sx={{ px: 2.5, py: 1.5 }}>
                            <Typography sx={{ ...os({ fontSize: 11, color: C.ink, letterSpacing: "0.02em" }) }}>
                              Read Previous Consultation →
                            </Typography>
                          </Box>
                        </Box>
                      )}

                      {/* Expanded content */}
                      <Collapse in={isExpanded} timeout={180}>
                        <Divider sx={{ borderColor: C.fog }} />
                        <Tabs
                          value={activeTab}
                          onChange={(_, v) => setSelectedHistoryTab((p) => ({ ...p, [apptKey]: v }))}
                          sx={{ ...tabSx, px: 2.5 }}
                        >
                          <Tab label="Medication" />
                          <Tab label="Investigation" />
                          <Tab label="Treatment Plan" />
                          <Tab label="Clinical Notes" />
                          <Tab label="Vitals" />
                        </Tabs>
                        <Box sx={{ p: { xs: 2, sm: 2.5 } }}>
                          {activeTab === 0 && renderFinalOutput(getFeatureData(appt.features, "medication"), "No medication data recorded")}
                          {activeTab === 1 && renderFinalOutput(getFeatureData(appt.features, "investigation"), "No investigation data recorded")}
                          {activeTab === 2 && renderFinalOutput(getFeatureData(appt.features, "treatment"), "No treatment plan recorded")}
                          {activeTab === 3 && renderFinalOutput(getFeatureData(appt.features, "clinical"), "No clinical notes recorded")}
                          {activeTab === 4 && renderFinalOutput(getFeatureData(appt.features, "vitals"), "No vitals recorded")}
                        </Box>
                      </Collapse>
                    </Box>
                  );
                })}
              </Box>
            </Box>
          )}
        </Box>
      </Box>

      {/* Backend-generated prep pack, rendered after a successful "Process Data" call */}
      <FollowUpPlanResult plan={consultationPlan} />
    </Box>
  );
}

// Tabs styling (kept identical to original)
const tabSx = {
  "& .MuiTab-root": {
    textTransform: "none",
    fontWeight: 300,
    fontFamily: FONT,
    fontSize: 12,
    minWidth: "auto",
    px: { xs: 1.5, sm: 2 },
    color: C.ash,
    letterSpacing: "0.04em",
    "&.Mui-selected": { color: C.ink, fontWeight: 400 },
  },
  "& .MuiTabs-indicator": { background: C.black, height: 1.5 },
  "& .MuiTabs-scrollButtons": { display: "flex" },
  borderBottom: `1px solid ${C.fog}`,
};