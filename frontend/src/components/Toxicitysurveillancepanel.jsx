import React, { useState, useRef } from "react";
import {
  Box,
  Typography,
  IconButton,
  Tooltip,
  Chip,
  Tabs,
  Tab,
  LinearProgress,
} from "@mui/material";
import {
  RefreshRounded,
  LocalHospital,
  WarningAmberRounded,
  CheckCircleRounded,
  ErrorRounded,
  PlayArrowRounded,
  ExpandMoreRounded,
  ExpandLessRounded,
  FiberManualRecordRounded,
  TimelineRounded,
  ScienceRounded,
  MonitorHeartRounded,
  MedicalServicesRounded,
  FactCheckRounded,
  AssessmentRounded,
  ShieldRounded,
  GroupsRounded,
} from "@mui/icons-material";

// ─── Design tokens ────────────────────────────────────────────────────────────
const FONT = '"Open Sans", sans-serif';
const FW   = 300;
const C = {
  black:     "#0a0a0a",
  ink:       "#1a1a1a",
  charcoal:  "#2e2e2e",
  smoke:     "#4a4a4a",
  ash:       "#7a7a7a",
  silver:    "#a8a8a8",
  mist:      "#d4d4d4",
  fog:       "#e8e8e8",
  ghost:     "#f2f2f2",
  white:     "#ffffff",
  emergency: "#c62828",
  alert:     "#e65100",
  caution:   "#f57f17",
  routine:   "#2e7d32",
};

const os = (extra = {}) => ({ fontFamily: FONT, fontWeight: FW, ...extra });

const card = {
  background:   C.white,
  border:       `1px solid ${C.fog}`,
  borderRadius: "4px",
  boxShadow:    "0 1px 3px rgba(0,0,0,0.06)",
};

const actionBtn = {
  display:       "flex",
  alignItems:    "center",
  gap:           6,
  px:            2.5,
  py:            1.1,
  borderRadius:  "2px",
  fontSize:      12,
  fontFamily:    FONT,
  fontWeight:    400,
  textTransform: "none",
  letterSpacing: "0.06em",
  background:    C.black,
  color:         C.white,
  border:        "none",
  cursor:        "pointer",
  transition:    "background 0.18s",
  "&:hover":     { background: C.charcoal },
  "&:disabled":  { opacity: 0.4, cursor: "not-allowed" },
};

const tabSx = {
  "& .MuiTab-root": {
    textTransform: "none",
    fontWeight:    300,
    fontFamily:    FONT,
    fontSize:      12,
    minWidth:      "auto",
    px:            2,
    color:         C.ash,
    letterSpacing: "0.04em",
    "&.Mui-selected": { color: C.ink, fontWeight: 400 },
  },
  "& .MuiTabs-indicator": { background: C.black, height: 1.5 },
  borderBottom: `1px solid ${C.fog}`,
};

// ─── Alert config ──────────────────────────────────────────────────────────
const ALERT_CONFIG = {
  Emergency: { color: C.emergency, bg: "#fff5f5", label: "EMERGENCY", icon: <ErrorRounded sx={{ fontSize: 14 }} /> },
  Alert:     { color: C.alert,     bg: "#fff8f2", label: "ALERT",     icon: <WarningAmberRounded sx={{ fontSize: 14 }} /> },
  Caution:   { color: C.caution,   bg: "#fffde7", label: "CAUTION",   icon: <WarningAmberRounded sx={{ fontSize: 14 }} /> },
  Routine:   { color: C.routine,   bg: "#f1f8f2", label: "ROUTINE",   icon: <CheckCircleRounded sx={{ fontSize: 14 }} /> },
};
const alertCfg = (level) => ALERT_CONFIG[level] || ALERT_CONFIG.Routine;

// ─── Pipeline steps ────────────────────────────────────────────────────────
const PIPELINE_STEPS = [
  { id: "A13",     label: "Treatment Extraction",   icon: <MedicalServicesRounded sx={{ fontSize: 14 }} /> },
  { id: "A14",     label: "Timeline Segmentation",  icon: <TimelineRounded sx={{ fontSize: 14 }} /> },
  { id: "A15",     label: "Baseline Builder",        icon: <AssessmentRounded sx={{ fontSize: 14 }} /> },
  { id: "A16",     label: "Signal Extraction",       icon: <ScienceRounded sx={{ fontSize: 14 }} /> },
  { id: "A17",     label: "Lab Trend Analysis",      icon: <MonitorHeartRounded sx={{ fontSize: 14 }} /> },
  { id: "A18",     label: "irAE Toxicity Mapping",   icon: <LocalHospital sx={{ fontSize: 14 }} /> },
  { id: "A19",     label: "Risk Prediction",         icon: <WarningAmberRounded sx={{ fontSize: 14 }} /> },
  { id: "A20",     label: "Final Synthesis",         icon: <FactCheckRounded sx={{ fontSize: 14 }} /> },
  { id: "A21–A23", label: "Quality + Narrative",    icon: <AssessmentRounded sx={{ fontSize: 14 }} />, parallel: true },
  { id: "A24",     label: "Escalation Predictor",    icon: <ErrorRounded sx={{ fontSize: 14 }} /> },
  { id: "A25",     label: "Discontinuation Guard",   icon: <ShieldRounded sx={{ fontSize: 14 }} /> },
  { id: "A26",     label: "Cohort Pattern Reporter", icon: <GroupsRounded sx={{ fontSize: 14 }} /> },
];

// ─── Helpers ──────────────────────────────────────────────────────────────────

// Filters plan-text entries from treatments_identified
// Real treatments are short drug-like names, not sentences
const isRealTreatment = (t) => {
  const name = (t.treatment_name || "").trim();
  if (!name || name.length > 60) return false;
  if (/\bif\b|\bfor\b|\bmonitor\b|\binitiate\b|\bcontinue\b|\bhold\b/i.test(name)) return false;
  return true;
};

// Compute display overall: if overall=0 but sub-scores exist, average sub-scores
const computeDisplayOverall = (scores = {}) => {
  const raw = scores.overall ?? 0;
  if (raw > 0) return raw * 100;
  const keys = [
    "signal_detection_completeness", "ctcae_grading_accuracy",
    "hallucination_risk", "management_appropriateness", "early_warning_quality",
  ];
  const vals = keys.map(k => scores[k] ?? 0).filter(v => v > 0);
  if (!vals.length) return 0;
  return (vals.reduce((a, b) => a + b, 0) / vals.length) * 100;
};

// ─── Shared micro-components ──────────────────────────────────────────────────

const SectionHeader = ({ children, sub, action }) => (
  <Box sx={{ px: 3, pt: 3, pb: 2, borderBottom: `1px solid ${C.fog}`, display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 2 }}>
    <Box>
      <Typography sx={{ ...os({ fontSize: 14, color: C.ink, letterSpacing: "0.02em" }) }}>{children}</Typography>
      {sub && <Typography sx={{ ...os({ fontSize: 11, color: C.ash, mt: 0.4 }) }}>{sub}</Typography>}
    </Box>
    {action && <Box sx={{ flexShrink: 0 }}>{action}</Box>}
  </Box>
);

const CollapseSection = ({ title, children, defaultOpen = false, badge }) => {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <Box sx={{ border: `1px solid ${C.fog}`, borderRadius: "3px", overflow: "hidden", mb: 1.5 }}>
      <Box onClick={() => setOpen(v => !v)} sx={{
        display: "flex", alignItems: "center", justifyContent: "space-between",
        px: 2.5, py: 1.5, cursor: "pointer",
        background: open ? C.ghost : C.white,
        "&:hover": { background: C.ghost }, transition: "background 0.15s",
      }}>
        <Box sx={{ display: "flex", alignItems: "center", gap: 1.5 }}>
          <Typography sx={{ ...os({ fontSize: 12, color: C.ink }) }}>{title}</Typography>
          {badge != null && (
            <Box sx={{ px: 1, py: 0.25, borderRadius: "2px", background: C.fog, minWidth: 20, textAlign: "center" }}>
              <Typography sx={{ ...os({ fontSize: 10, color: C.smoke }) }}>{badge}</Typography>
            </Box>
          )}
        </Box>
        {open
          ? <ExpandLessRounded sx={{ fontSize: 16, color: C.ash }} />
          : <ExpandMoreRounded sx={{ fontSize: 16, color: C.ash }} />}
      </Box>
      {open && <Box sx={{ px: 2.5, py: 2, borderTop: `1px solid ${C.fog}` }}>{children}</Box>}
    </Box>
  );
};

const KVRow = ({ label, value, valueColor }) => (
  <Box sx={{ display: "flex", gap: 2, py: 0.75, borderBottom: `1px solid ${C.fog}`, "&:last-child": { borderBottom: "none" }, flexWrap: "wrap" }}>
    <Typography sx={{ ...os({ fontSize: 11, color: C.silver, textTransform: "uppercase", letterSpacing: "0.06em", minWidth: 180, flexShrink: 0 }) }}>
      {label}
    </Typography>
    <Typography sx={{ ...os({ fontSize: 12, color: valueColor || C.charcoal, flex: 1, lineHeight: 1.6 }) }}>
      {value || "—"}
    </Typography>
  </Box>
);

const StatBox = ({ value, label }) => (
  <Box sx={{ textAlign: "center", px: 2, py: 1.5, ...card }}>
    <Typography sx={{ ...os({ fontSize: 20, color: C.ink }) }}>{value ?? "—"}</Typography>
    <Typography sx={{ ...os({ fontSize: 10, color: C.silver }) }}>{label}</Typography>
  </Box>
);

const AlertBanner = ({ level, rationale }) => {
  const cfg = alertCfg(level);
  return (
    <Box sx={{ display: "flex", alignItems: "flex-start", gap: 1.5, p: 2, borderRadius: "3px",
      border: `1px solid ${cfg.color}22`, background: cfg.bg, mb: 2 }}>
      <Box sx={{ color: cfg.color, mt: 0.1, display: "flex" }}>{cfg.icon}</Box>
      <Box>
        <Typography sx={{ ...os({ fontSize: 12, color: cfg.color, letterSpacing: "0.06em", fontWeight: 500 }) }}>{cfg.label}</Typography>
        {rationale && <Typography sx={{ ...os({ fontSize: 12, color: C.charcoal, mt: 0.4, lineHeight: 1.5 }) }}>{rationale}</Typography>}
      </Box>
    </Box>
  );
};

const NarrativeBlock = ({ p1, p2, bottomLine }) => (
  <Box sx={{ display: "flex", flexDirection: "column", gap: 2 }}>
    {p1 && (
      <Box sx={{ p: 2.5, background: C.ghost, borderRadius: "3px", borderLeft: `3px solid ${C.mist}` }}>
        <Typography sx={{ ...os({ fontSize: 10, color: C.silver, textTransform: "uppercase", letterSpacing: "0.08em", mb: 1 }) }}>Clinical Assessment</Typography>
        <Typography sx={{ ...os({ fontSize: 13, color: C.charcoal, lineHeight: 1.7 }) }}>{p1}</Typography>
      </Box>
    )}
    {p2 && (
      <Box sx={{ p: 2.5, background: C.ghost, borderRadius: "3px", borderLeft: `3px solid ${C.mist}` }}>
        <Typography sx={{ ...os({ fontSize: 10, color: C.silver, textTransform: "uppercase", letterSpacing: "0.08em", mb: 1 }) }}>Recommendations</Typography>
        <Typography sx={{ ...os({ fontSize: 13, color: C.charcoal, lineHeight: 1.7 }) }}>{p2}</Typography>
      </Box>
    )}
    {bottomLine && (
      <Box sx={{ px: 2.5, py: 1.5, background: C.white, border: `1px solid ${C.fog}`, borderRadius: "3px", display: "flex", gap: 1.5, alignItems: "flex-start" }}>
        <FiberManualRecordRounded sx={{ fontSize: 8, color: C.ash, mt: 0.6, flexShrink: 0 }} />
        <Typography sx={{ ...os({ fontSize: 12, color: C.ink, fontStyle: "italic" }) }}>{bottomLine}</Typography>
      </Box>
    )}
  </Box>
);

// Grade 1 watchlist — always shown standalone (not hidden behind irAE count > 0)
const WatchlistSection = ({ watchlist }) => {
  if (!watchlist?.length) return null;
  return (
    <CollapseSection title="Grade 1 Watchlist" defaultOpen badge={watchlist.length}>
      <Box sx={{ mb: 1.5, pb: 1.5, borderBottom: `1px solid ${C.fog}` }}>
        <Typography sx={{ ...os({ fontSize: 11, color: C.silver, lineHeight: 1.6 }) }}>
          These signals have not yet confirmed as irAEs but require monitoring at each cycle.
        </Typography>
      </Box>
      {watchlist.map((w, i) => (
        <Box key={i} sx={{ display: "flex", gap: 1.5, py: 0.75, borderBottom: `1px solid ${C.fog}`, "&:last-child": { borderBottom: "none" } }}>
          <WarningAmberRounded sx={{ fontSize: 13, color: C.caution, mt: 0.2, flexShrink: 0 }} />
          <Typography sx={{ ...os({ fontSize: 12, color: C.charcoal }) }}>
            {typeof w === "string" ? w : w.signal || w.name || JSON.stringify(w)}
          </Typography>
        </Box>
      ))}
    </CollapseSection>
  );
};

const IRAECard = ({ item }) => {
  const grade     = String(item.ctcae_grade || item.grade || "");
  const gradeNum  = grade.replace(/\D/g, "");
  const gradeColor = gradeNum >= "3" ? C.emergency : gradeNum === "2" ? C.alert : gradeNum === "1" ? C.caution : C.smoke;
  return (
    <Box sx={{ ...card, p: 2, mb: 1.5, borderLeft: `3px solid ${gradeColor}` }}>
      <Box sx={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 2, mb: 1 }}>
        <Typography sx={{ ...os({ fontSize: 13, color: C.ink }) }}>
          {item.irae_name || item.toxicity_name || item.name || "Unknown irAE"}
        </Typography>
        {grade && (
          <Box sx={{ px: 1.25, py: 0.3, borderRadius: "2px", background: `${gradeColor}18`, border: `1px solid ${gradeColor}44`, flexShrink: 0 }}>
            <Typography sx={{ ...os({ fontSize: 10, color: gradeColor, fontWeight: 500, letterSpacing: "0.06em" }) }}>
              GRADE {gradeNum || grade}
            </Typography>
          </Box>
        )}
      </Box>
      <Box sx={{ display: "flex", gap: 2, flexWrap: "wrap", mb: item.clinical_evidence ? 1 : 0 }}>
        {item.organ_system && <Typography sx={{ ...os({ fontSize: 11, color: C.ash }) }}>🫀 {item.organ_system}</Typography>}
        {item.onset_timing && <Typography sx={{ ...os({ fontSize: 11, color: C.ash }) }}>⏱ {item.onset_timing}</Typography>}
        {item.ici_management_recommendation && <Typography sx={{ ...os({ fontSize: 11, color: C.smoke }) }}>→ {item.ici_management_recommendation}</Typography>}
      </Box>
      {item.clinical_evidence && <Typography sx={{ ...os({ fontSize: 11, color: C.silver, lineHeight: 1.5, mt: 0.5 }) }}>{item.clinical_evidence}</Typography>}
    </Box>
  );
};

const LabRow = ({ item }) => {
  const flagged = item.is_flagged || item.grade_crossing;
  return (
    <Box sx={{ display: "flex", gap: 2, py: 1, px: 1.5, borderRadius: "3px",
      background: flagged ? "#fff8f2" : C.white,
      border: `1px solid ${flagged ? C.caution + "44" : C.fog}`,
      mb: 0.75, flexWrap: "wrap" }}>
      <Typography sx={{ ...os({ fontSize: 12, color: C.ink, minWidth: 140, flexShrink: 0 }) }}>
        {item.test_name || item.lab_name || "Lab"}
      </Typography>
      <Box sx={{ display: "flex", gap: 2, flex: 1, flexWrap: "wrap" }}>
        {item.baseline_value && <Typography sx={{ ...os({ fontSize: 11, color: C.ash }) }}>Baseline: {item.baseline_value} {item.unit || ""}</Typography>}
        {item.post_value     && <Typography sx={{ ...os({ fontSize: 11, color: flagged ? C.alert : C.charcoal }) }}>Post: <strong>{item.post_value}</strong> {item.unit || ""}</Typography>}
        {item.fold_change    && <Typography sx={{ ...os({ fontSize: 11, color: C.smoke }) }}>({item.fold_change}× ULN)</Typography>}
        {(item.ctcae_grade || item.grade) && (
          <Chip label={`Grade ${(item.ctcae_grade || item.grade || "").replace(/\D/g, "")}`} size="small"
            sx={{ height: 18, fontSize: 10, fontFamily: FONT, background: C.fog, color: C.smoke, borderRadius: "2px" }} />
        )}
      </Box>
    </Box>
  );
};

const EscalationRow = ({ item }) => {
  const score = Number(item.escalation_score || 0);
  const pct   = Math.min(score, 100);
  const color = pct >= 70 ? C.emergency : pct >= 40 ? C.alert : C.caution;
  return (
    <Box sx={{ mb: 1.5, p: 2, border: `1px solid ${C.fog}`, borderRadius: "3px" }}>
      <Box sx={{ display: "flex", justifyContent: "space-between", mb: 1 }}>
        <Typography sx={{ ...os({ fontSize: 12, color: C.ink }) }}>{item.irae_name || "irAE"}</Typography>
        <Typography sx={{ ...os({ fontSize: 12, color, fontWeight: 500 }) }}>{score}/100</Typography>
      </Box>
      <Box sx={{ height: 4, borderRadius: 2, background: C.fog, overflow: "hidden", mb: 1 }}>
        <Box sx={{ height: "100%", width: `${pct}%`, background: color, borderRadius: 2, transition: "width 0.6s ease" }} />
      </Box>
      {item.predicted_timeline_to_grade3 && <Typography sx={{ ...os({ fontSize: 11, color: C.ash }) }}>Timeline to G3: {item.predicted_timeline_to_grade3}</Typography>}
      {item.intervention_recommendation  && <Typography sx={{ ...os({ fontSize: 11, color: C.smoke, mt: 0.5 }) }}>→ {item.intervention_recommendation}</Typography>}
    </Box>
  );
};

// Signal row — handles both old (signal_name) and new (signal) field names
const SignalRow = ({ item }) => {
  const name           = item.signal_name || item.signal || item.name || "Unknown";
  const classification = item.classification || item.category || "—";
  const grade          = item.grade != null ? String(item.grade) : "";
  const confidence     = item.confidence || item.evidence_strength || "—";
  const rationale      = item.classification_rationale || item.evidence_text || "";
  const gradeColor     = grade === "1" ? C.caution : grade === "2" ? C.alert : grade >= "3" ? C.emergency : C.smoke;
  return (
    <Box sx={{ py: 1.5, borderBottom: `1px solid ${C.fog}`, "&:last-child": { borderBottom: "none" } }}>
      <Box sx={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", mb: 0.5, gap: 1 }}>
        <Typography sx={{ ...os({ fontSize: 12, color: C.ink }) }}>{name}</Typography>
        <Box sx={{ display: "flex", gap: 0.75, flexShrink: 0, flexWrap: "wrap" }}>
          {grade && (
            <Chip label={`G${grade}`} size="small"
              sx={{ height: 18, fontSize: 10, fontFamily: FONT, background: `${gradeColor}18`, color: gradeColor, borderRadius: "2px", border: `1px solid ${gradeColor}44` }} />
          )}
          <Chip label={classification} size="small"
            sx={{ height: 18, fontSize: 10, fontFamily: FONT, background: C.fog, color: C.smoke, borderRadius: "2px" }} />
          <Chip label={confidence} size="small"
            sx={{ height: 18, fontSize: 10, fontFamily: FONT, background: C.ghost, color: C.ash, borderRadius: "2px" }} />
        </Box>
      </Box>
      {rationale && <Typography sx={{ ...os({ fontSize: 11, color: C.silver, lineHeight: 1.5 }) }}>{rationale}</Typography>}
    </Box>
  );
};

const ScoreBar = ({ label, value }) => {
  const pct   = (value ?? 0) * 100;
  const color = pct >= 80 ? C.routine : pct >= 50 ? C.caution : C.emergency;
  return (
    <Box sx={{ mb: 1.5 }}>
      <Box sx={{ display: "flex", justifyContent: "space-between", mb: 0.5 }}>
        <Typography sx={{ ...os({ fontSize: 11, color: C.ash }) }}>{label}</Typography>
        <Typography sx={{ ...os({ fontSize: 11, color: C.charcoal }) }}>{pct.toFixed(0)}%</Typography>
      </Box>
      <Box sx={{ height: 3, borderRadius: 2, background: C.fog, overflow: "hidden" }}>
        <Box sx={{ height: "100%", width: `${pct}%`, background: color, borderRadius: 2, transition: "width 0.8s ease" }} />
      </Box>
    </Box>
  );
};

const PipelineProgress = ({ activeStep, timings = {} }) => (
  <Box sx={{ display: "flex", flexDirection: "column", gap: 0.5 }}>
    {PIPELINE_STEPS.map((step, idx) => {
      const done   = idx < activeStep;
      const active = idx === activeStep;
      const ms     = timings[step.id];
      return (
        <Box key={step.id} sx={{ display: "flex", alignItems: "center", gap: 1.5, py: 0.75, px: 1.5, borderRadius: "3px",
          background: active ? C.ghost : "transparent", transition: "background 0.2s" }}>
          <Box sx={{ width: 8, height: 8, borderRadius: "50%", flexShrink: 0,
            background: done ? C.black : active ? C.ash : C.mist,
            animation: active ? "tox-pulse 1.2s infinite" : "none",
            "@keyframes tox-pulse": { "0%": { opacity: 0.4 }, "50%": { opacity: 1 }, "100%": { opacity: 0.4 } } }} />
          <Box sx={{ color: done ? C.ink : active ? C.ash : C.silver, display: "flex" }}>{step.icon}</Box>
          <Typography sx={{ ...os({ fontSize: 12, flex: 1, color: done ? C.ink : active ? C.charcoal : C.silver }) }}>
            {step.id} — {step.label}
            {step.parallel && <span style={{ color: C.silver, fontSize: 10, marginLeft: 4 }}>[parallel]</span>}
          </Typography>
          {ms && <Typography sx={{ ...os({ fontSize: 10, color: C.silver }) }}>{ms}ms</Typography>}
          {active && (
            <Box sx={{ width: 40 }}>
              <LinearProgress sx={{ height: 2, borderRadius: 1, background: C.fog, "& .MuiLinearProgress-bar": { background: C.black } }} />
            </Box>
          )}
        </Box>
      );
    })}
  </Box>
);

// ─── API URL ───────────────────────────────────────────────────────────────────
const API_BASE_URL = import.meta.env.VITE_BACKEND_URL;

// ─── Main ─────────────────────────────────────────────────────────────────────
export default function ToxicitySurveillancePanel({ patientId, doctorId }) {
  const [running,    setRunning]    = useState(false);
  const [activeStep, setActiveStep] = useState(-1);
  const [result,     setResult]     = useState(null);
  const [error,      setError]      = useState(null);
  const [activeTab,  setActiveTab]  = useState(0);
  const stepTimerRef = useRef(null);

  const startStepProgress = () => {
    let step = 0;
    setActiveStep(0);
    stepTimerRef.current = setInterval(() => {
      step++;
      if (step < PIPELINE_STEPS.length) setActiveStep(step);
      else clearInterval(stepTimerRef.current);
    }, 1800);
  };

  const stopStepProgress = () => {
    clearInterval(stepTimerRef.current);
    setActiveStep(PIPELINE_STEPS.length);
  };

  const runAnalysis = async () => {
    if (!patientId || !doctorId) { setError("Patient ID and Doctor ID are required."); return; }
    setRunning(true);
    setResult(null);
    setError(null);
    startStepProgress();
    try {
      const res = await fetch(`${API_BASE_URL}hms/users/ai-legacy/toxicity-surveillance/run`, {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ patient_id: patientId, doctor_id: doctorId, specialty: "Oncology", include_intermediates: true }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.detail || `HTTP ${res.status}`);
      }
      const data = await res.json();
      console.log("toxicity-result", data);
      stopStepProgress();
      setResult(data);
      setActiveTab(0);
    } catch (e) {
      stopStepProgress();
      setError(e.message || "Analysis failed. Please try again.");
    } finally {
      setRunning(false);
    }
  };

  // ── Derived values ─────────────────────────────────────────────────────────
  const alertLevel  = result?.alert_level || "Routine";
  const alertCfgVal = alertCfg(alertLevel);
  const narrative   = result?.narrative || {};
  const toxicity    = result?.toxicity_detection || {};
  const synthesis   = result?.ici_management_decision || {};
  const escalation  = result?.escalation_prediction || {};
  const discontinue = result?.discontinuation_guard || {};
  const noise       = result?.signal_to_noise || {};
  const cohort      = result?.cohort_signature || {};
  const quality     = result?.quality_score || {};
  const risk        = result?.risk_assessment || {};
  const treatment   = result?.treatment_info || {};
  const baseline    = result?.baseline_summary || "";

  // Labs live under intermediate.lab_changes when include_intermediates=true
  const labs       = result?.intermediate?.lab_changes || {};
  const labChanges = labs.lab_changes || [];
  const labFlagged = labs.flagged_lab_changes || [];

  const iraes         = toxicity.suspected_toxicities || [];
  const escalPred     = escalation.escalation_predictions || [];
  const actions       = result?.recommended_actions || [];
  const monitoring    = result?.monitoring_plan || [];
  const referrals     = result?.specialist_referrals || [];
  const watchlist     = result?.grade1_watchlist || [];
  const signalClasses = noise.signal_classifications || [];
  const sns           = noise.signal_to_noise_summary || {};
  const qScores       = quality.scores || {};
  const displayOverall = computeDisplayOverall(qScores);
  const realTreatments = (treatment.treatments_identified || []).filter(isRealTreatment);

  // Tab badge counts
  const tabs = [
    { label: "Overview",        count: null },
    { label: "irAE Detected",   count: (iraes.length || watchlist.length) || null },
    { label: "Lab Trends",      count: labChanges.length || null },
    { label: "Escalation Risk", count: escalPred.length || null },
    { label: "Discontinuation", count: null },
    { label: "Signal Analysis", count: signalClasses.length || null },
    { label: "Monitoring Plan", count: monitoring.length || null },
    { label: "Cohort",          count: null },
    { label: "Quality",         count: null },
  ];

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <Box sx={{ ...card, overflow: "hidden" }}>

      {/* Header */}
      <SectionHeader
        sub="14-agent ICI toxicity surveillance · irAE detection · escalation prevention"
        action={
          <Box component="button" disabled={running} onClick={runAnalysis} sx={{
            ...actionBtn, minWidth: 160, py: 1,
            opacity: running ? 0.7 : 1, cursor: running ? "not-allowed" : "pointer",
          }}>
            {running ? (
              <>
                <RefreshRounded sx={{ fontSize: 15, animation: "tox-spin 1s linear infinite",
                  "@keyframes tox-spin": { "0%": { transform: "rotate(0deg)" }, "100%": { transform: "rotate(360deg)" } } }} />
                Running...
              </>
            ) : (
              <><PlayArrowRounded sx={{ fontSize: 16 }} /> Run Analysis</>
            )}
          </Box>
        }
      >
        Toxicity Surveillance
      </SectionHeader>

      {/* Idle */}
      {!running && !result && !error && (
        <Box sx={{ p: 4, textAlign: "center" }}>
          <LocalHospital sx={{ fontSize: 36, color: C.mist, mb: 2 }} />
          <Typography sx={{ ...os({ fontSize: 14, color: C.ash }) }}>ICI Toxicity Surveillance</Typography>
          <Typography sx={{ ...os({ fontSize: 12, color: C.silver, mt: 0.75, maxWidth: 480, mx: "auto", lineHeight: 1.6 }) }}>
            Click <strong style={{ fontWeight: 600 }}>Run Analysis</strong> to execute the 14-agent pipeline
            monitoring irAEs, escalation risk, and discontinuation prevention for this patient.
          </Typography>
          <Box sx={{ display: "flex", justifyContent: "center", gap: 1.5, mt: 2.5, flexWrap: "wrap" }}>
            {["irAE Detection", "Grade 1 Early Warning", "Escalation Prediction", "Discontinuation Guard", "Cohort Monitoring"].map(f => (
              <Chip key={f} label={f} size="small"
                sx={{ fontSize: 10, fontFamily: FONT, background: C.fog, color: C.smoke, border: `1px solid ${C.fog}`, borderRadius: "2px" }} />
            ))}
          </Box>
        </Box>
      )}

      {/* Error */}
      {error && !running && (
        <Box sx={{ p: 3 }}>
          <Box sx={{ p: 2.5, background: "#fff5f5", border: `1px solid ${C.emergency}22`, borderRadius: "3px", display: "flex", gap: 1.5 }}>
            <ErrorRounded sx={{ fontSize: 16, color: C.emergency, flexShrink: 0, mt: 0.1 }} />
            <Box>
              <Typography sx={{ ...os({ fontSize: 12, color: C.emergency, fontWeight: 500 }) }}>Analysis Failed</Typography>
              <Typography sx={{ ...os({ fontSize: 12, color: C.charcoal, mt: 0.5 }) }}>{error}</Typography>
            </Box>
          </Box>
          <Box sx={{ mt: 2, display: "flex", justifyContent: "flex-end" }}>
            <Box component="button" onClick={runAnalysis} sx={{ ...actionBtn, px: 2, py: 0.8, fontSize: 11 }}>
              <RefreshRounded sx={{ fontSize: 13 }} /> Retry
            </Box>
          </Box>
        </Box>
      )}

      {/* Running */}
      {running && (
        <Box sx={{ p: 3 }}>
          <Box sx={{ mb: 2, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <Typography sx={{ ...os({ fontSize: 12, color: C.ash }) }}>Running 14-agent pipeline...</Typography>
            <Typography sx={{ ...os({ fontSize: 10, color: C.silver }) }}>
              Agent {Math.min(activeStep + 1, PIPELINE_STEPS.length)} of {PIPELINE_STEPS.length}
            </Typography>
          </Box>
          <PipelineProgress activeStep={activeStep} timings={{}} />
        </Box>
      )}

      {/* Results */}
      {result && !running && (
        <Box>

          {/* Alert banner + quick stats */}
          <Box sx={{ px: 3, pt: 2.5, pb: 0 }}>
            <Box sx={{ display: "flex", alignItems: "center", gap: 1.5, p: 2, borderRadius: "3px",
              border: `1px solid ${alertCfgVal.color}33`, background: alertCfgVal.bg, mb: 2, flexWrap: "wrap" }}>
              <Box sx={{ color: alertCfgVal.color }}>{alertCfgVal.icon}</Box>
              <Box sx={{ flex: 1, minWidth: 150 }}>
                <Typography sx={{ ...os({ fontSize: 11, color: alertCfgVal.color, letterSpacing: "0.08em", fontWeight: 500 }) }}>
                  {alertCfgVal.label}
                </Typography>
                <Typography sx={{ ...os({ fontSize: 12, color: C.charcoal }) }}>
                  {narrative.bottom_line || synthesis.rationale || "Analysis complete."}
                </Typography>
              </Box>
              <Box sx={{ display: "flex", gap: 2, flexShrink: 0, flexWrap: "wrap" }}>
                {[
                  { val: iraes.length,                                   label: "irAEs" },
                  { val: toxicity.highest_grade_irae || "—",            label: "Max Grade" },
                  { val: watchlist.length,                               label: "Watchlist" },
                  { val: result.documents_analyzed || 0,                label: "Docs" },
                  { val: result.processing_time_ms ? `${(result.processing_time_ms / 1000).toFixed(1)}s` : "—", label: "Runtime" },
                ].map(s => (
                  <Box key={s.label} sx={{ textAlign: "center" }}>
                    <Typography sx={{ ...os({ fontSize: 18, color: C.ink }) }}>{s.val}</Typography>
                    <Typography sx={{ ...os({ fontSize: 9, color: C.silver, letterSpacing: "0.06em" }) }}>{s.label}</Typography>
                  </Box>
                ))}
              </Box>
              <Tooltip title="Re-run Analysis">
                <IconButton size="small" onClick={runAnalysis}
                  sx={{ width: 28, height: 28, border: `1px solid ${C.fog}`, borderRadius: "2px", color: C.ash, flexShrink: 0, "&:hover": { color: C.ink, background: C.ghost } }}>
                  <RefreshRounded sx={{ fontSize: 14 }} />
                </IconButton>
              </Tooltip>
            </Box>
          </Box>

          {/* Tabs */}
          <Box sx={{ px: 3 }}>
            <Tabs value={activeTab} onChange={(_, v) => setActiveTab(v)} variant="scrollable" scrollButtons="auto" sx={tabSx}>
              {tabs.map((t, i) => (
                <Tab key={i} label={
                  <Box sx={{ display: "flex", alignItems: "center", gap: 0.75 }}>
                    {t.label}
                    {t.count ? (
                      <Box sx={{ px: 0.75, py: 0.1, background: C.fog, borderRadius: "2px", minWidth: 18, textAlign: "center" }}>
                        <Typography sx={{ ...os({ fontSize: 9, color: C.smoke }) }}>{t.count}</Typography>
                      </Box>
                    ) : null}
                  </Box>
                } />
              ))}
            </Tabs>
          </Box>

          <Box sx={{ p: 3 }}>

            {/* ═══ OVERVIEW ═════════════════════════════════════════════ */}
            {activeTab === 0 && (
              <Box>
                <NarrativeBlock p1={narrative.paragraph_1} p2={narrative.paragraph_2} bottomLine={narrative.bottom_line} />

                {synthesis.recommendation && (
                  <Box sx={{ mt: 2.5 }}>
                    <CollapseSection title="ICI Management Decision" defaultOpen badge={synthesis.recommendation}>
                      <KVRow label="Recommendation" value={synthesis.recommendation}
                        valueColor={synthesis.recommendation === "Discontinue" ? C.emergency : synthesis.recommendation?.toLowerCase().includes("hold") ? C.alert : C.routine} />
                      <KVRow label="Rationale"          value={synthesis.rationale} />
                      <KVRow label="Hold vs Discontinue" value={synthesis.hold_vs_discontinue} />
                      {synthesis.steroid_protocol?.indicated && (
                        <>
                          <KVRow label="Steroid"  value={[synthesis.steroid_protocol.agent, synthesis.steroid_protocol.dose, synthesis.steroid_protocol.route].filter(Boolean).join(" ")} />
                          <KVRow label="Duration" value={synthesis.steroid_protocol.duration} />
                          <KVRow label="Taper"    value={synthesis.steroid_protocol.taper_plan} />
                        </>
                      )}
                      {synthesis.additional_immunosuppressant && <KVRow label="Additional IS" value={synthesis.additional_immunosuppressant} />}
                    </CollapseSection>
                  </Box>
                )}

                {treatment.current_treatment?.treatment_name && (
                  <CollapseSection title="Current Treatment">
                    <KVRow label="Drug"              value={treatment.current_treatment.treatment_name} />
                    <KVRow label="Class"             value={treatment.current_treatment.treatment_class} />
                    <KVRow label="ICI Subtype"       value={treatment.current_treatment.ici_subtype} />
                    <KVRow label="Cycle"             value={treatment.current_treatment.cycle_number} />
                    <KVRow label="Total Cycles"      value={treatment.current_treatment.total_cycles_to_date || treatment.cumulative_ici_cycles} />
                    <KVRow label="Indication"        value={treatment.current_treatment.indication} />
                    <KVRow label="Combination ICI"   value={treatment.combination_ici ? "Yes" : "No"} />
                    <KVRow label="Baseline irAE Risk" value={treatment.baseline_irae_risk_from_regimen} />
                  </CollapseSection>
                )}

                {realTreatments.length > 0 && (
                  <CollapseSection title="Treatment History" badge={realTreatments.length}>
                    {realTreatments.map((t, i) => (
                      <Box key={i} sx={{ py: 1, borderBottom: `1px solid ${C.fog}`, "&:last-child": { borderBottom: "none" } }}>
                        <Box sx={{ display: "flex", justifyContent: "space-between", flexWrap: "wrap", gap: 1 }}>
                          <Typography sx={{ ...os({ fontSize: 12, color: C.ink }) }}>{t.treatment_name}</Typography>
                          <Box sx={{ display: "flex", gap: 0.75 }}>
                            {t.ici_subtype && t.ici_subtype !== "Not applicable" && (
                              <Chip label={t.ici_subtype} size="small" sx={{ height: 18, fontSize: 10, fontFamily: FONT, background: C.fog, borderRadius: "2px" }} />
                            )}
                            {t.cycle_number && (
                              <Chip label={t.cycle_number} size="small" sx={{ height: 18, fontSize: 10, fontFamily: FONT, background: C.ghost, borderRadius: "2px" }} />
                            )}
                          </Box>
                        </Box>
                        {t.indication && <Typography sx={{ ...os({ fontSize: 11, color: C.ash, mt: 0.25 }) }}>{t.indication}</Typography>}
                      </Box>
                    ))}
                  </CollapseSection>
                )}

                {/* Grade 1 watchlist always visible on overview */}
                <WatchlistSection watchlist={watchlist} />

                {baseline && (
                  <CollapseSection title="Baseline Summary">
                    <Typography sx={{ ...os({ fontSize: 12, color: C.charcoal, lineHeight: 1.7 }) }}>{baseline}</Typography>
                  </CollapseSection>
                )}

                {actions.length > 0 && (
                  <CollapseSection title="Recommended Actions" defaultOpen badge={actions.length}>
                    {actions.map((a, i) => (
                      <Box key={i} sx={{ display: "flex", gap: 1.5, py: 0.75, borderBottom: `1px solid ${C.fog}`, "&:last-child": { borderBottom: "none" } }}>
                        <FiberManualRecordRounded sx={{ fontSize: 8, color: C.ash, mt: 0.6, flexShrink: 0 }} />
                        <Typography sx={{ ...os({ fontSize: 12, color: C.charcoal, lineHeight: 1.6 }) }}>
                          {typeof a === "string" ? a : a.action || JSON.stringify(a)}
                        </Typography>
                      </Box>
                    ))}
                  </CollapseSection>
                )}

                {referrals.length > 0 && (
                  <CollapseSection title="Specialist Referrals" badge={referrals.length}>
                    {referrals.map((r, i) => (
                      <Box key={i} sx={{ display: "flex", gap: 1.5, py: 0.75, borderBottom: `1px solid ${C.fog}`, "&:last-child": { borderBottom: "none" } }}>
                        <FiberManualRecordRounded sx={{ fontSize: 8, color: C.ash, mt: 0.6, flexShrink: 0 }} />
                        <Typography sx={{ ...os({ fontSize: 12, color: C.charcoal }) }}>
                          {typeof r === "string" ? r : r.specialty || JSON.stringify(r)}
                        </Typography>
                      </Box>
                    ))}
                  </CollapseSection>
                )}
              </Box>
            )}

            {/* ═══ irAE DETECTED ════════════════════════════════════════ */}
            {activeTab === 1 && (
              <Box>
                <Box sx={{ display: "flex", gap: 2, flexWrap: "wrap", mb: 2.5 }}>
                  <StatBox value={iraes.length}                         label="Confirmed irAEs" />
                  <StatBox value={toxicity.highest_grade_irae || "—"}  label="Highest Grade" />
                  <StatBox value={toxicity.multisystem_irae ? "Yes" : "No"} label="Multi-system" />
                  <StatBox value={watchlist.length}                    label="Watchlist Items" />
                </Box>

                {iraes.length > 0
                  ? iraes.map((item, i) => <IRAECard key={i} item={item} />)
                  : (
                    <Box sx={{ py: 3, textAlign: "center", mb: 2 }}>
                      <CheckCircleRounded sx={{ fontSize: 28, color: C.mist, mb: 1 }} />
                      <Typography sx={{ ...os({ fontSize: 13, color: C.ash }) }}>No confirmed irAEs</Typography>
                      <Typography sx={{ ...os({ fontSize: 12, color: C.silver, mt: 0.5 }) }}>
                        {toxicity.toxicity_mapping_summary || "No immune-related adverse events identified."}
                      </Typography>
                    </Box>
                  )}

                {(toxicity.missed_grade1_opportunities || []).length > 0 && (
                  <CollapseSection title="Missed Grade 1 Opportunities" badge={toxicity.missed_grade1_opportunities.length}>
                    {toxicity.missed_grade1_opportunities.map((m, i) => (
                      <Box key={i} sx={{ display: "flex", gap: 1.5, py: 0.75, borderBottom: `1px solid ${C.fog}`, "&:last-child": { borderBottom: "none" } }}>
                        <WarningAmberRounded sx={{ fontSize: 13, color: C.caution, mt: 0.2, flexShrink: 0 }} />
                        <Typography sx={{ ...os({ fontSize: 12, color: C.charcoal }) }}>{typeof m === "string" ? m : JSON.stringify(m)}</Typography>
                      </Box>
                    ))}
                  </CollapseSection>
                )}

                <WatchlistSection watchlist={watchlist} />
              </Box>
            )}

            {/* ═══ LAB TRENDS ═══════════════════════════════════════════ */}
            {activeTab === 2 && (
              <Box>
                {labChanges.length === 0 ? (
                  <Box sx={{ py: 4, textAlign: "center" }}>
                    <Typography sx={{ ...os({ fontSize: 13, color: C.ash }) }}>No lab trends available</Typography>
                    <Typography sx={{ ...os({ fontSize: 12, color: C.silver, mt: 0.5 }) }}>
                      {labs.lab_trend_summary || "No pre/post lab comparison data found."}
                    </Typography>
                  </Box>
                ) : (
                  <>
                    <Box sx={{ display: "flex", gap: 1.5, flexWrap: "wrap", mb: 2 }}>
                      {labs.highest_grade_lab_change && labs.highest_grade_lab_change !== "None" && (
                        <Chip label={`Max grade: ${labs.highest_grade_lab_change}`} size="small"
                          sx={{ fontSize: 10, fontFamily: FONT, background: "#fff8f2", color: C.alert, border: `1px solid ${C.alert}44`, borderRadius: "2px" }} />
                      )}
                      {labs.rapid_escalation_detected && (
                        <Chip label="Rapid escalation detected" size="small"
                          sx={{ fontSize: 10, fontFamily: FONT, background: "#fff5f5", color: C.emergency, border: `1px solid ${C.emergency}44`, borderRadius: "2px" }} />
                      )}
                    </Box>
                    {labChanges.map((item, i) => <LabRow key={i} item={item} />)}
                    {labFlagged.length > 0 && (
                      <Box sx={{ mt: 2 }}>
                        <Typography sx={{ ...os({ fontSize: 11, color: C.silver, textTransform: "uppercase", letterSpacing: "0.07em", mb: 1.5 }) }}>
                          Flagged Changes
                        </Typography>
                        {labFlagged.map((item, i) => <LabRow key={i} item={item} />)}
                      </Box>
                    )}
                    {(labs.grade_crossings_summary || []).length > 0 && (
                      <CollapseSection title="Grade Crossings">
                        {labs.grade_crossings_summary.map((g, i) => (
                          <Box key={i} sx={{ py: 0.75, borderBottom: `1px solid ${C.fog}`, "&:last-child": { borderBottom: "none" } }}>
                            <Typography sx={{ ...os({ fontSize: 12, color: C.charcoal }) }}>{typeof g === "string" ? g : JSON.stringify(g)}</Typography>
                          </Box>
                        ))}
                      </CollapseSection>
                    )}
                  </>
                )}
              </Box>
            )}

            {/* ═══ ESCALATION RISK ══════════════════════════════════════ */}
            {activeTab === 3 && (
              <Box>
                {escalation.overall_escalation_alert && escalation.overall_escalation_alert !== "None" && (
                  <AlertBanner level={escalation.overall_escalation_alert === "High" ? "Alert" : "Caution"} rationale={escalation.escalation_summary} />
                )}
                {escalPred.length === 0 ? (
                  <Box sx={{ py: 4, textAlign: "center" }}>
                    <CheckCircleRounded sx={{ fontSize: 32, color: C.mist, mb: 1.5 }} />
                    <Typography sx={{ ...os({ fontSize: 13, color: C.ash }) }}>No escalation risk identified</Typography>
                    <Typography sx={{ ...os({ fontSize: 12, color: C.silver, mt: 0.5 }) }}>
                      {escalation.escalation_summary || "No Grade 1–2 irAEs requiring escalation monitoring."}
                    </Typography>
                  </Box>
                ) : (
                  <>
                    {escalPred.map((item, i) => <EscalationRow key={i} item={item} />)}
                    {escalation.intervention_prevents_discontinuation && (
                      <Box sx={{ p: 2, mt: 1.5, background: "#f1f8f2", border: `1px solid ${C.routine}44`, borderRadius: "3px", display: "flex", gap: 1.5 }}>
                        <ShieldRounded sx={{ fontSize: 14, color: C.routine, mt: 0.1 }} />
                        <Typography sx={{ ...os({ fontSize: 12, color: C.charcoal }) }}>
                          Intervention within <strong>{escalation.discontinuation_prevention_window_days} days</strong> can prevent ICI discontinuation.
                        </Typography>
                      </Box>
                    )}
                  </>
                )}
              </Box>
            )}

            {/* ═══ DISCONTINUATION ══════════════════════════════════════ */}
            {activeTab === 4 && (
              <Box>
                {(() => {
                  const dra        = discontinue.discontinuation_risk_assessment || {};
                  const rechallenge = discontinue.rechallenge_assessment || {};
                  const plan       = discontinue.discontinuation_prevention_plan || [];
                  const cost       = discontinue.cost_of_discontinuation || {};
                  return (
                    <>
                      <CollapseSection title="Discontinuation Risk Assessment" defaultOpen>
                        <KVRow label="Current Risk"         value={dra.current_discontinuation_risk} />
                        <KVRow label="Avoidable"            value={dra.discontinuation_avoidable ? "Yes — with intervention" : "No"}
                          valueColor={dra.discontinuation_avoidable ? C.routine : C.emergency} />
                        <KVRow label="Rationale"            value={dra.avoidable_rationale} />
                        <KVRow label="Recommended Decision" value={discontinue.recommended_decision}
                          valueColor={discontinue.recommended_decision === "Discontinue" ? C.emergency : discontinue.recommended_decision?.toLowerCase().includes("hold") ? C.alert : C.routine} />
                        <KVRow label="Decision Rationale"   value={discontinue.decision_rationale} />
                        <KVRow label="Summary"              value={discontinue.discontinuation_summary} />
                      </CollapseSection>

                      <CollapseSection title="Rechallenge Assessment">
                        <KVRow label="Eligible"        value={rechallenge.rechallenge_eligible ? "Yes" : "No"} />
                        <KVRow label="Rationale"       value={rechallenge.rechallenge_eligibility_rationale} />
                        <KVRow label="Risk Level"      value={rechallenge.rechallenge_risk_level} />
                        <KVRow label="Expected Wait"   value={rechallenge.expected_time_to_rechallenge_eligibility_days ? `${rechallenge.expected_time_to_rechallenge_eligibility_days} days` : null} />
                        <KVRow label="Recurrence Risk" value={rechallenge.recurrence_risk_on_rechallenge} />
                        {(rechallenge.rechallenge_conditions || []).length > 0 && (
                          <Box sx={{ mt: 1 }}>
                            {rechallenge.rechallenge_conditions.map((c, i) => (
                              <Box key={i} sx={{ display: "flex", gap: 1, py: 0.5 }}>
                                <FiberManualRecordRounded sx={{ fontSize: 7, color: C.ash, mt: 0.7, flexShrink: 0 }} />
                                <Typography sx={{ ...os({ fontSize: 12, color: C.charcoal }) }}>{c}</Typography>
                              </Box>
                            ))}
                          </Box>
                        )}
                      </CollapseSection>

                      {cost.clinical_impact && cost.clinical_impact !== "Not applicable" && (
                        <CollapseSection title="Cost of Discontinuation">
                          <KVRow label="Clinical Impact"        value={cost.clinical_impact} />
                          <KVRow label="Alternatives Available" value={cost.alternatives_available ? "Yes" : "No"} />
                        </CollapseSection>
                      )}

                      {plan.length > 0 && (
                        <CollapseSection title="Prevention Plan" defaultOpen badge={plan.length}>
                          {plan.map((p, i) => (
                            <Box key={i} sx={{ display: "flex", gap: 1.5, py: 0.75, borderBottom: `1px solid ${C.fog}`, "&:last-child": { borderBottom: "none" } }}>
                              <FiberManualRecordRounded sx={{ fontSize: 8, color: C.ash, mt: 0.6, flexShrink: 0 }} />
                              <Typography sx={{ ...os({ fontSize: 12, color: C.charcoal }) }}>
                                {typeof p === "string" ? p : p.action || JSON.stringify(p)}
                              </Typography>
                            </Box>
                          ))}
                        </CollapseSection>
                      )}
                    </>
                  );
                })()}
              </Box>
            )}

            {/* ═══ SIGNAL ANALYSIS ══════════════════════════════════════ */}
            {activeTab === 5 && (
              <Box>
                {/* Always show counters even when 0 — they reflect the real API values */}
                <Box sx={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 1.5, mb: 2.5 }}>
                  <StatBox value={sns.total_signals     ?? 0} label="Total Signals" />
                  <StatBox value={sns.true_irae_signals ?? 0} label="True irAE" />
                  <StatBox value={sns.noise_signals     ?? 0} label="Noise" />
                  <StatBox value={sns.mimicker_signals  ?? 0} label="Mimickers" />
                </Box>

                {/* Explanatory note when signals classified but counts differ */}
                {signalClasses.length > 0 && sns.true_irae_signals === 0 && (
                  <Box sx={{ p: 2, mb: 2, background: "#fffde7", border: `1px solid ${C.caution}33`, borderRadius: "3px" }}>
                    <Typography sx={{ ...os({ fontSize: 12, color: C.smoke }) }}>
                      {signalClasses.length} signal(s) detected but not yet confirmed as true irAEs. Confidence is low — monitor closely each cycle.
                    </Typography>
                  </Box>
                )}

                <KVRow label="Signal Purity"   value={sns.irae_signal_purity} />
                <KVRow label="Noise Reduction" value={sns.noise_reduction_percent != null ? `${sns.noise_reduction_percent}%` : null} />
                <KVRow label="Confidence"      value={noise.noise_separation_confidence} />

                {signalClasses.length > 0 && (
                  <CollapseSection title="Signal Classifications" defaultOpen badge={signalClasses.length}>
                    {signalClasses.map((c, i) => <SignalRow key={i} item={c} />)}
                  </CollapseSection>
                )}

                {(noise.top_confirmed_irae_signals || []).length > 0 && (
                  <CollapseSection title="Top Confirmed irAE Signals" badge={noise.top_confirmed_irae_signals.length}>
                    {noise.top_confirmed_irae_signals.map((s, i) => (
                      <Box key={i} sx={{ py: 0.75, borderBottom: `1px solid ${C.fog}`, "&:last-child": { borderBottom: "none" } }}>
                        <Typography sx={{ ...os({ fontSize: 12, color: C.charcoal }) }}>{typeof s === "string" ? s : JSON.stringify(s)}</Typography>
                      </Box>
                    ))}
                  </CollapseSection>
                )}

                {(noise.top_noise_items_to_deprioritize || []).length > 0 && (
                  <CollapseSection title="Noise — Deprioritise" badge={noise.top_noise_items_to_deprioritize.length}>
                    {noise.top_noise_items_to_deprioritize.map((s, i) => (
                      <Box key={i} sx={{ py: 0.75, borderBottom: `1px solid ${C.fog}`, "&:last-child": { borderBottom: "none" } }}>
                        <Typography sx={{ ...os({ fontSize: 12, color: C.ash }) }}>{typeof s === "string" ? s : JSON.stringify(s)}</Typography>
                      </Box>
                    ))}
                  </CollapseSection>
                )}

                {(noise.critical_mimickers_to_rule_out || []).length > 0 && (
                  <CollapseSection title="Mimickers to Rule Out" badge={noise.critical_mimickers_to_rule_out.length}>
                    {noise.critical_mimickers_to_rule_out.map((m, i) => (
                      <Box key={i} sx={{ py: 1, borderBottom: `1px solid ${C.fog}`, "&:last-child": { borderBottom: "none" } }}>
                        <Typography sx={{ ...os({ fontSize: 12, color: C.charcoal }) }}>{typeof m === "string" ? m : m.mimicker || JSON.stringify(m)}</Typography>
                        {m.test_to_differentiate && <Typography sx={{ ...os({ fontSize: 11, color: C.ash }) }}>→ {m.test_to_differentiate}</Typography>}
                      </Box>
                    ))}
                  </CollapseSection>
                )}
              </Box>
            )}

            {/* ═══ MONITORING PLAN ══════════════════════════════════════ */}
            {activeTab === 6 && (
              <Box>
                {monitoring.length === 0 ? (
                  <Box sx={{ py: 4, textAlign: "center" }}>
                    <Typography sx={{ ...os({ fontSize: 13, color: C.ash }) }}>No monitoring plan generated</Typography>
                  </Box>
                ) : (
                  monitoring.map((m, i) => (
                    <Box key={i} sx={{ p: 2, mb: 1.5, ...card }}>
                      <Box sx={{ display: "flex", justifyContent: "space-between", mb: 0.75 }}>
                        <Typography sx={{ ...os({ fontSize: 12, color: C.ink }) }}>
                          {typeof m === "string" ? m : (m.lab || m.vital || m.organ || m.monitor || `Step ${i + 1}`)}
                        </Typography>
                        {m.frequency && (
                          <Chip label={m.frequency} size="small"
                            sx={{ height: 18, fontSize: 10, fontFamily: FONT, background: C.fog, borderRadius: "2px" }} />
                        )}
                      </Box>
                      {m.rationale           && <Typography sx={{ ...os({ fontSize: 11, color: C.ash, lineHeight: 1.5 }) }}>{m.rationale}</Typography>}
                      {m.action_if_positive  && <Typography sx={{ ...os({ fontSize: 11, color: C.smoke, mt: 0.5 }) }}>If positive: {m.action_if_positive}</Typography>}
                    </Box>
                  ))
                )}

                {(risk.continuous_monitoring_plan || []).length > 0 && (
                  <CollapseSection title="Continuous Risk Monitoring" badge={risk.continuous_monitoring_plan.length}>
                    {risk.continuous_monitoring_plan.map((m, i) => (
                      <Box key={i} sx={{ py: 0.75, borderBottom: `1px solid ${C.fog}`, "&:last-child": { borderBottom: "none" } }}>
                        <Typography sx={{ ...os({ fontSize: 12, color: C.charcoal }) }}>{typeof m === "string" ? m : JSON.stringify(m)}</Typography>
                      </Box>
                    ))}
                  </CollapseSection>
                )}

                {(risk.prophylactic_measures_recommended || []).length > 0 && (
                  <CollapseSection title="Prophylactic Measures" badge={risk.prophylactic_measures_recommended.length}>
                    {risk.prophylactic_measures_recommended.map((m, i) => (
                      <Box key={i} sx={{ display: "flex", gap: 1.5, py: 0.75, borderBottom: `1px solid ${C.fog}`, "&:last-child": { borderBottom: "none" } }}>
                        <FiberManualRecordRounded sx={{ fontSize: 8, color: C.ash, mt: 0.6, flexShrink: 0 }} />
                        <Typography sx={{ ...os({ fontSize: 12, color: C.charcoal }) }}>{typeof m === "string" ? m : JSON.stringify(m)}</Typography>
                      </Box>
                    ))}
                  </CollapseSection>
                )}
              </Box>
            )}

            {/* ═══ COHORT ═══════════════════════════════════════════════ */}
            {activeTab === 7 && (
              <Box>
                {(() => {
                  const sig   = cohort.patient_irae_signature || {};
                  const mon   = cohort.cohort_monitoring_recommendation || {};
                  const flags = cohort.cohort_flags || [];
                  return (
                    <>
                      <CollapseSection title="Patient irAE Signature" defaultOpen>
                        <KVRow label="ICI Agent"         value={sig.ici_agent} />
                        <KVRow label="ICI Class"         value={sig.ici_class} />
                        <KVRow label="Cycles Completed"  value={String(sig.ici_cycles_completed ?? "—")} />
                        <KVRow label="irAE Count"        value={String(sig.irae_count ?? "—")} />
                        <KVRow label="Organ Systems"     value={(sig.irae_organ_systems || []).join(", ") || "—"} />
                        <KVRow label="Highest Grade"     value={sig.highest_grade_overall} />
                        <KVRow label="Multi-system"      value={sig.multisystem_irae ? "Yes" : "No"} />
                        <KVRow label="ICI Status"        value={sig.ici_status} />
                        <KVRow label="G1→G3 Escalation"  value={sig.grade1_to_grade3_escalation_occurred ? "Yes" : "No"} />
                        <KVRow label="Alert Level"       value={sig.alert_level} valueColor={alertCfg(sig.alert_level).color} />
                      </CollapseSection>

                      <CollapseSection title="Cohort Monitoring Recommendation">
                        <KVRow label="Monitoring Interval" value={mon.monitoring_interval} />
                        <KVRow label="Next Surveillance"   value={mon.next_surveillance_due} />
                        <KVRow label="Priority"            value={mon.priority_in_cohort} />
                        <KVRow label="Alert Trigger"       value={mon.cohort_alert_trigger} />
                        <KVRow label="Escalation Protocol" value={mon.escalation_protocol_active ? "Active" : "Inactive"} />
                      </CollapseSection>

                      {flags.length > 0 && (
                        <CollapseSection title="Cohort Flags" badge={flags.length}>
                          {flags.map((f, i) => (
                            <Box key={i} sx={{ display: "flex", gap: 1.5, py: 0.75, borderBottom: `1px solid ${C.fog}`, "&:last-child": { borderBottom: "none" } }}>
                              <WarningAmberRounded sx={{ fontSize: 13, color: C.caution, flexShrink: 0, mt: 0.2 }} />
                              <Typography sx={{ ...os({ fontSize: 12, color: C.charcoal }) }}>{typeof f === "string" ? f : JSON.stringify(f)}</Typography>
                            </Box>
                          ))}
                        </CollapseSection>
                      )}

                      {cohort.pattern_summary && !cohort.pattern_summary.startsWith("Not applicable") && (
                        <Box sx={{ p: 2, background: C.ghost, borderRadius: "3px", borderLeft: `3px solid ${C.mist}` }}>
                          <Typography sx={{ ...os({ fontSize: 12, color: C.charcoal, lineHeight: 1.7 }) }}>{cohort.pattern_summary}</Typography>
                        </Box>
                      )}
                    </>
                  );
                })()}
              </Box>
            )}

            {/* ═══ QUALITY ══════════════════════════════════════════════ */}
            {activeTab === 8 && (
              <Box>
                {/* Overall — uses computed value, not the raw 0 */}
                <Box sx={{ p: 2.5, ...card, mb: 2.5, display: "flex", gap: 3, alignItems: "center", flexWrap: "wrap" }}>
                  <Box>
                    <Typography sx={{ ...os({ fontSize: 32, color: C.ink }) }}>
                      {displayOverall.toFixed(0)}
                      <span style={{ fontSize: 14, color: C.ash }}>/100</span>
                    </Typography>
                    <Typography sx={{ ...os({ fontSize: 10, color: C.silver, textTransform: "uppercase", letterSpacing: "0.08em" }) }}>
                      Overall Quality
                    </Typography>
                    {qScores.overall === 0 && displayOverall > 0 && (
                      <Typography sx={{ ...os({ fontSize: 10, color: C.caution }) }}>computed from sub-scores</Typography>
                    )}
                  </Box>
                  <Box sx={{ flex: 1, minWidth: 120 }}>
                    <Box sx={{ height: 6, borderRadius: 3, background: C.fog, overflow: "hidden" }}>
                      <Box sx={{ height: "100%", width: `${displayOverall}%`,
                        background: displayOverall >= 80 ? C.routine : displayOverall >= 50 ? C.caution : C.emergency,
                        borderRadius: 3, transition: "width 0.8s ease" }} />
                    </Box>
                    {quality.confidence_band && quality.confidence_band !== "..." && (
                      <Typography sx={{ ...os({ fontSize: 11, color: C.ash, mt: 1 }) }}>{quality.confidence_band}</Typography>
                    )}
                  </Box>
                  <Chip
                    label={quality.approved_for_clinical_use ? "Approved for Clinical Use" : "Review Required"}
                    size="small"
                    sx={{ fontFamily: FONT, fontSize: 10,
                      background:  quality.approved_for_clinical_use ? "#f1f8f2" : "#fff5f5",
                      color:       quality.approved_for_clinical_use ? C.routine  : C.emergency,
                      border:      `1px solid ${quality.approved_for_clinical_use ? C.routine : C.emergency}44`,
                      borderRadius: "2px" }}
                  />
                </Box>

                {/* Score breakdown */}
                <Box sx={{ mb: 2.5 }}>
                  <ScoreBar label="Signal Detection Completeness" value={qScores.signal_detection_completeness} />
                  <ScoreBar label="CTCAE Grading Accuracy"        value={qScores.ctcae_grading_accuracy} />
                  <ScoreBar label="Hallucination Risk"            value={qScores.hallucination_risk} />
                  <ScoreBar label="Management Appropriateness"    value={qScores.management_appropriateness} />
                  <ScoreBar label="Early Warning Quality"         value={qScores.early_warning_quality} />
                </Box>

                {/* All error/gap arrays — shown even when individual scores are 0 */}
                {(quality.ctcae_grading_errors || []).length > 0 && (
                  <CollapseSection title="CTCAE Grading Notes" badge={quality.ctcae_grading_errors.length}>
                    {quality.ctcae_grading_errors.map((e, i) => (
                      <Box key={i} sx={{ py: 0.75, borderBottom: `1px solid ${C.fog}`, "&:last-child": { borderBottom: "none" } }}>
                        <Typography sx={{ ...os({ fontSize: 12, color: C.smoke }) }}>{e}</Typography>
                      </Box>
                    ))}
                  </CollapseSection>
                )}
                {(quality.management_errors || []).length > 0 && (
                  <CollapseSection title="Management Notes" badge={quality.management_errors.length}>
                    {quality.management_errors.map((e, i) => (
                      <Box key={i} sx={{ py: 0.75, borderBottom: `1px solid ${C.fog}`, "&:last-child": { borderBottom: "none" } }}>
                        <Typography sx={{ ...os({ fontSize: 12, color: C.smoke }) }}>{e}</Typography>
                      </Box>
                    ))}
                  </CollapseSection>
                )}
                {(quality.early_warning_gaps || []).length > 0 && (
                  <CollapseSection title="Early Warning Gaps" badge={quality.early_warning_gaps.length}>
                    {quality.early_warning_gaps.map((e, i) => (
                      <Box key={i} sx={{ py: 0.75, borderBottom: `1px solid ${C.fog}`, "&:last-child": { borderBottom: "none" } }}>
                        <Typography sx={{ ...os({ fontSize: 12, color: C.smoke }) }}>{e}</Typography>
                      </Box>
                    ))}
                  </CollapseSection>
                )}
                {(quality.hallucination_flags || []).length > 0 && (
                  <CollapseSection title="Hallucination Flags" badge={quality.hallucination_flags.length}>
                    {quality.hallucination_flags.map((f, i) => (
                      <Box key={i} sx={{ py: 0.75, borderBottom: `1px solid ${C.fog}`, "&:last-child": { borderBottom: "none" } }}>
                        <Typography sx={{ ...os({ fontSize: 12, color: C.alert }) }}>{typeof f === "string" ? f : JSON.stringify(f)}</Typography>
                      </Box>
                    ))}
                  </CollapseSection>
                )}
                {(quality.missed_signals || []).length > 0 && (
                  <CollapseSection title="Missed Signals" badge={quality.missed_signals.length}>
                    {quality.missed_signals.map((s, i) => (
                      <Box key={i} sx={{ display: "flex", gap: 1.5, py: 0.75, borderBottom: `1px solid ${C.fog}`, "&:last-child": { borderBottom: "none" } }}>
                        <WarningAmberRounded sx={{ fontSize: 13, color: C.caution, mt: 0.2, flexShrink: 0 }} />
                        <Typography sx={{ ...os({ fontSize: 12, color: C.charcoal }) }}>{typeof s === "string" ? s : JSON.stringify(s)}</Typography>
                      </Box>
                    ))}
                  </CollapseSection>
                )}
                {(quality.improvement_recommendations || []).length > 0 && (
                  <CollapseSection title="Improvement Recommendations" badge={quality.improvement_recommendations.length}>
                    {quality.improvement_recommendations.map((r, i) => (
                      <Box key={i} sx={{ display: "flex", gap: 1.5, py: 0.75, borderBottom: `1px solid ${C.fog}`, "&:last-child": { borderBottom: "none" } }}>
                        <FiberManualRecordRounded sx={{ fontSize: 8, color: C.ash, mt: 0.6, flexShrink: 0 }} />
                        <Typography sx={{ ...os({ fontSize: 12, color: C.charcoal }) }}>{r}</Typography>
                      </Box>
                    ))}
                  </CollapseSection>
                )}

                {quality.requires_physician_review && (
                  <Box sx={{ mt: 2, p: 2, background: "#fff8f2", border: `1px solid ${C.alert}33`, borderRadius: "3px", display: "flex", gap: 1.5 }}>
                    <WarningAmberRounded sx={{ fontSize: 14, color: C.alert, mt: 0.1 }} />
                    <Box>
                      <Typography sx={{ ...os({ fontSize: 12, color: C.alert, fontWeight: 500 }) }}>Physician Review Required</Typography>
                      {(quality.review_priority_items || []).map((item, i) => (
                        <Typography key={i} sx={{ ...os({ fontSize: 11, color: C.charcoal, mt: 0.5 }) }}>• {item}</Typography>
                      ))}
                    </Box>
                  </Box>
                )}
              </Box>
            )}

          </Box>
        </Box>
      )}
    </Box>
  );
}