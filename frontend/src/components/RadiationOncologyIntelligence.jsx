import React, { useState, useEffect, useCallback } from "react";
import { Box, Typography, Button, IconButton, Collapse } from "@mui/material";
import { ExpandMore, ExpandLess } from "@mui/icons-material";
import { loadDashboard, regenerateDashboard } from "./radiationApi";
import RadiationOncologySkillPanel from "./RadiationOncologySkillPanel";

// ─── BRAND TOKENS (matching RadiotherapyRecord) ───────────────────
const FONT = '"Open Sans", sans-serif';
const FONT_MONO = '"Space Mono", monospace, monospace';
const FW_LIGHT = 300;
const FW_NORMAL = 400;
const FW_MEDIUM = 500;
const FW_SEMIBOLD = 600;

const C = {
  black: "#000000",
  white: "#ffffff",
  bgPrimary: "#ffffff",
  bgSecondary: "#fafafa",
  bgTertiary: "#f5f5f5",
  textPrimary: "#000000",
  textSecond: "#444444",
  textMuted: "#777777",
  border: "#e0e0e0",
  borderStrong: "#000000",
};

// ─── STATUS PILL COMPONENT ────────────────────────────────────────
const StatusPill = ({ status, label }) => {
  const getStatusStyles = (s) => {
    switch (s?.toLowerCase()) {
      case "ok":
        return {
          color: "#276738",
          borderColor: "rgba(39, 103, 56, 0.35)",
          bgColor: "#f2f9f4",
          dotColor: "#2e7d32",
        };
      case "watch":
        return {
          color: "#8a6d1c",
          borderColor: "rgba(138, 109, 28, 0.35)",
          bgColor: "#fdfaf0",
          dotColor: "#b78103",
        };
      case "alert":
        return {
          color: "#b03d2b",
          borderColor: "rgba(176, 61, 43, 0.35)",
          bgColor: "#fdf4f2",
          dotColor: "#c62828",
        };
      case "neutral":
      default:
        return {
          color: "#555555",
          borderColor: "#d0d0d0",
          bgColor: "#f7f7f8",
          dotColor: "#888888",
        };
    }
  };

  const style = getStatusStyles(status);

  return (
    <Box
      sx={{
        display: "inline-flex",
        alignItems: "center",
        gap: 0.75,
        fontFamily: FONT,
        fontSize: "11px",
        fontWeight: FW_MEDIUM,
        letterSpacing: "0.04em",
        textTransform: "uppercase",
        px: 1.2,
        py: 0.4,
        borderRadius: "2px",
        border: `1px solid ${style.borderColor}`,
        backgroundColor: style.bgColor,
        color: style.color,
        whiteSpace: "nowrap",
      }}
    >
      <Box
        sx={{
          width: 6,
          height: 6,
          borderRadius: "50%",
          backgroundColor: style.dotColor,
          display: "inline-block",
        }}
      />
      <span>{label}</span>
    </Box>
  );
};

// ─── FROZEN DASHBOARD STRUCTURE: 12 MODULES ───────────────────────
// This layout is FIELD-LOCKED. Row `param` labels, column headers, module
// headers, KPI labels, and patient-strip labels are STRUCTURE and never change.
// No mock clinical values live in this file: every value below starts as
// "Not available" and is filled in only by live agent data, overlaid by `param`
// (see LIVE-DATA OVERLAY). This lets Module 09's real output be verified against
// a clean baseline while the remaining agents are built one by one.
const NA = "Not available";

// One frozen row = the 6-key contract with values blanked until an agent derives
// them. `param` (the row label) is part of the locked layout and is preserved.
const naRow = (param) => ({
  param,
  finding: NA,
  ref: NA,
  status: "neutral",
  statusLabel: NA,
  action: "—",
});

const REPORT_MODULES = [
  {
    id: "m1",
    num: "01 / 12",
    navLabel: "01 Readiness",
    title: "Patient Assessment & Radiation Readiness",
    description:
      "Confirms the patient is safe and complete to start or continue radiotherapy — eligibility, performance status, prior exposure, implants, organ function, and pathology correlation.",
    summary: "10 checks tracked",
    columns: ["Parameter", "Current Finding", "Reference / Expected", "Status", "Indication / Action"],
    rows: [
      naRow("Radiation Eligibility"),
      naRow("ECOG / KPS"),
      naRow("Prior Radiation History"),
      naRow("Surgery–Chemo–RT Timeline"),
      naRow("Implant / Device Safety"),
      naRow("Baseline Organ Function"),
      naRow("Imaging Completeness"),
      naRow("Pathology / Molecular Correlation"),
      naRow("Radiation Intent Classification"),
      naRow("Pre‑RT Checklist"),
    ],
  },
  {
    id: "m2",
    num: "02 / 12",
    navLabel: "02 Planning",
    title: "Treatment Planning Intelligence",
    description:
      "Guideline‑aligned recommendations for fractionation, targets, margins, technique, and simulation — checked against NCCN / ESTRO / ASTRO protocol logic.",
    summary: "15 checks tracked",
    columns: ["Parameter", "Current Finding", "Reference / Expected", "Status", "Indication / Action"],
    rows: [
      naRow("Fractionation Regimen"),
      naRow("Protocol Selection"),
      naRow("Dose Prescription"),
      naRow("Target Volumes (GTV/CTV/PTV)"),
      naRow("Margin Recommendation"),
      naRow("Elective Nodal Irradiation"),
      naRow("Adaptive RT Eligibility"),
      naRow("Organs‑at‑Risk Identification"),
      naRow("Technique Recommendation"),
      naRow("Beam Arrangement"),
      naRow("Bolus Recommendation"),
      naRow("Immobilization"),
      naRow("Simulation Protocol"),
      naRow("Planning Workflow Checklist"),
      naRow("Re‑plan Trigger (weight/anatomy)"),
    ],
  },
  {
    id: "m3",
    num: "03 / 12",
    navLabel: "03 Dose",
    title: "Dose Calculation & Cumulative Dose Intelligence",
    description:
      "The platform's core longitudinal engine — every organ's lifetime EQD2/BED exposure across all courses, imported or internal, checked continuously against QUANTEC and institutional constraints.",
    summary: "Lifetime OAR ledger · 15 checks",
    columns: ["Organ / Metric", "Cumulative EQD2", "Constraint (QUANTEC / Institutional)", "Status", "Indication / Action"],
    rows: [
      naRow("Spinal Cord (Dmax)"),
      naRow("Brainstem (Dmax)"),
      naRow("Ipsilateral Parotid (Mean)"),
      naRow("Contralateral Parotid (Mean)"),
      naRow("Larynx (Mean)"),
      naRow("Mandible (Dmax)"),
      naRow("Oral Cavity (Mean)"),
      naRow("Fractionation Conversion (BED₁₀)"),
      naRow("Re‑irradiation Assessment"),
      naRow("Dose Escalation Safety"),
      naRow("Multi‑course Aggregation"),
      naRow("Prior External Records Import"),
      naRow("Composite Dose Assessment"),
      naRow("Biological Dose Comparison"),
      naRow("Hard Safety Threshold Engine"),
    ],
  },
  {
    id: "m4",
    num: "04 / 12",
    navLabel: "04 QA",
    title: "Plan Quality & Safety Validation",
    description:
      "Independent verification that the approved plan matches the prescription, meets coverage and constraint targets, and is physically deliverable on the assigned machine.",
    summary: "12 checks tracked",
    columns: ["Parameter", "Current Finding", "Reference / Expected", "Status", "Indication / Action"],
    rows: [
      naRow("Plan Completeness"),
      naRow("Prescription vs. Plan"),
      naRow("Target Coverage (PTV70 V95%)"),
      naRow("OAR Constraint Compliance"),
      naRow("Plan Quality Score"),
      naRow("Homogeneity / Conformity Index"),
      naRow("Collision Risk"),
      naRow("Machine Compatibility"),
      naRow("Treatment Approval Checklist"),
      naRow("Independent Clinical Review"),
      naRow("AI Plan Consistency Check"),
      naRow("Planning Deviation Detection"),
    ],
  },
  {
    id: "m5",
    num: "05 / 12",
    navLabel: "05 Delivery",
    title: "Treatment Delivery Intelligence",
    description:
      "Fraction‑by‑fraction readiness and image‑guidance verification — catching setup drift, motion, and interruptions as they happen.",
    summary: "12 checks tracked",
    columns: ["Parameter", "Current Finding", "Reference / Expected", "Status", "Indication / Action"],
    rows: [
      naRow("Daily Treatment Readiness"),
      naRow("IGRT Verification"),
      naRow("Setup Error (3D vector)"),
      naRow("Couch Shift Trend"),
      naRow("Motion Management"),
      naRow("Adaptive Treatment Trigger"),
      naRow("Missed Fraction Detection"),
      naRow("Machine Interruption Log"),
      naRow("Session Completion Verification"),
      naRow("Delivery Quality Monitoring"),
      naRow("Treatment Workflow Status"),
      naRow("Respiratory Gating"),
    ],
  },
  {
    id: "m6",
    num: "06 / 12",
    navLabel: "06 Gaps",
    title: "Treatment Gap & Schedule Optimization",
    description:
      "Detects interruptions, quantifies their biological cost, and recommends — with documentation — how to compensate rather than letting a gap pass silently.",
    summary: "10 checks tracked",
    columns: ["Parameter", "Current Finding", "Reference / Expected", "Status", "Indication / Action"],
    rows: [
      naRow("Treatment Gap Detected"),
      naRow("Gap Compensation Calculator"),
      naRow("BED Compensation Estimate"),
      naRow("Weekend / Holiday Optimizer"),
      naRow("Interrupted Treatment Risk"),
      naRow("Tumor Repopulation Analysis"),
      naRow("Fraction Rescheduling"),
      naRow("Predicted Local Control Impact"),
      naRow("Protocol Compliance Tracker"),
      naRow("Gap Decision Documentation"),
    ],
  },
  {
    id: "m7",
    num: "07 / 12",
    navLabel: "07 Toxicity",
    title: "Toxicity Prediction & Management",
    description:
      "Predicted and observed acute/late toxicity, graded and trended, with supportive care prompts triggered by threshold — not left to be caught at the next visit.",
    summary: "15 checks · CTCAE v5.0",
    columns: ["Toxicity", "Current Grade / Finding", "Reference / Expected Trajectory", "Status", "Indication / Action"],
    rows: [
      naRow("Radiation Dermatitis"),
      naRow("Oral Mucositis"),
      naRow("Xerostomia Risk Prediction"),
      naRow("Radiation Pneumonitis"),
      naRow("Radiation Esophagitis"),
      naRow("Enteritis / Proctitis"),
      naRow("Brain Edema Monitoring"),
      naRow("Cardiac Toxicity Monitoring"),
      naRow("Radiation Nephropathy"),
      naRow("Radiation Myelopathy Risk"),
      naRow("Weight / Nutrition Trend"),
      naRow("Supportive Care Recommendation"),
      naRow("CTCAE Grading Currency"),
      naRow("Late Toxicity Prediction"),
      naRow("Toxicity Trend Dashboard"),
    ],
  },
  {
    id: "m8",
    num: "08 / 12",
    navLabel: "08 Response",
    title: "Response Assessment & Follow‑up",
    description:
      "Post‑treatment imaging, biomarker trends, recurrence surveillance, and the survivorship schedule — kept on one continuous timeline rather than reset at each visit.",
    summary: "12 checks tracked",
    columns: ["Parameter", "Current Finding", "Reference / Expected", "Status", "Indication / Action"],
    rows: [
      naRow("RECIST Response Assessment"),
      naRow("PERCIST / PET Response"),
      naRow("Imaging Comparison Engine"),
      naRow("Tumor Volume Regression"),
      naRow("Biomarker Trend"),
      naRow("Local Recurrence Detection"),
      naRow("Radiation Failure Pattern"),
      naRow("Follow‑up Schedule"),
      naRow("Survivorship Monitoring"),
      naRow("Late Effect Surveillance"),
      naRow("Disease Progression Dashboard"),
      naRow("Outcome Analytics"),
    ],
  },
  {
    id: "m9",
    num: "09 / 12",
    navLabel: "09 Docs",
    title: "Documentation & Clinical Intelligence",
    description:
      "Auto‑generated, explainable summaries at every stage — consultation, simulation, weekly review, completion, and tumor board — so nothing depends on manual re‑typing.",
    summary: "10 checks tracked",
    columns: ["Document", "Status", "Last Generated", "Completeness", "Indication / Action"],
    rows: [
      naRow("Consultation Summary"),
      naRow("Simulation Summary"),
      naRow("Treatment Plan Summary"),
      naRow("Weekly Review Summary"),
      naRow("Completion Summary"),
      naRow("Toxicity Summary"),
      naRow("Follow‑up Summary"),
      naRow("Tumor Board Summary"),
      naRow("Guideline Evidence Viewer"),
      naRow("Explainable AI Recommendation Log"),
    ],
  },
  {
    id: "m10",
    num: "10 / 12",
    navLabel: "10 Physics",
    title: "Radiation Physics & Quality Assurance",
    description:
      "Machine QA, patient‑specific QA, imaging registration, and contour quality — the physics layer that underwrites everything above it.",
    summary: "12 checks tracked",
    columns: ["Parameter", "Current Finding", "Reference / Expected", "Status", "Indication / Action"],
    rows: [
      naRow("Machine QA Correlation"),
      naRow("Patient‑Specific QA"),
      naRow("Dose Delivery Verification"),
      naRow("Portal Dosimetry Analysis"),
      naRow("Machine Performance Analytics"),
      naRow("Image Registration Validation"),
      naRow("Contour Consistency Checker"),
      naRow("Auto‑Segmentation Quality"),
      naRow("Registration Error Detection"),
      naRow("AI Contour Review Assistant"),
      naRow("Physics Checklist Automation"),
      naRow("Treatment Safety Audit Trail"),
    ],
  },
  {
    id: "m11",
    num: "11 / 12",
    navLabel: "11 MDT",
    title: "Multidisciplinary Decision Support",
    description:
      "Keeps radiation, chemotherapy, and surgical timelines coordinated, and surfaces trial matches and guideline compliance for the tumor board.",
    summary: "10 checks tracked",
    columns: ["Parameter", "Current Finding", "Reference / Expected", "Status", "Indication / Action"],
    rows: [
      naRow("Surgery–RT Sequencing"),
      naRow("Chemoradiation Coordination"),
      naRow("Concurrent Systemic Therapy Safety"),
      naRow("Pathology Correlation"),
      naRow("Molecular Marker Correlation"),
      naRow("Tumor Board Decision Assistant"),
      naRow("Re‑treatment Eligibility"),
      naRow("Clinical Trial Matching"),
      naRow("Guideline Compliance Dashboard"),
      naRow("Personalized Strategy Recommendation"),
    ],
  },
  {
    id: "m12",
    num: "12 / 12",
    navLabel: "12 Ops",
    title: "Department Analytics & Operations",
    description:
      "Zooms out from the single patient to machine, department, and cohort‑level performance — the operational layer that keeps every patient's plan deliverable on time.",
    summary: "10 checks tracked",
    columns: ["Parameter", "Current Finding", "Reference / Expected", "Status", "Indication / Action"],
    rows: [
      naRow("Machine Utilization"),
      naRow("Treatment Throughput"),
      naRow("Waiting Time (decision → fx 1)"),
      naRow("Fraction Completion Rate (dept.)"),
      naRow("Toxicity Incidence (cohort)"),
      naRow("Protocol Compliance (dept.)"),
      naRow("Re‑irradiation Registry"),
      naRow("Outcome Benchmarking"),
      naRow("Quality Indicator Dashboard"),
      naRow("Radiation Department Performance Score"),
    ],
  },
];

// KPI labels are frozen structure; values are blank until an agent supplies them.
const KPI_DATA = [
  { label: "Plan / Delivery", num: "—", status: "neutral", text: NA },
  { label: "Cumulative Dose Ledger", num: "—", status: "neutral", text: NA },
  { label: "Active Toxicity", num: "—", status: "neutral", text: NA },
  { label: "Treatment Gap", num: "—", status: "neutral", text: NA },
  { label: "Plan QA", num: "—", status: "neutral", text: NA },
  { label: "Next Response Assessment", num: "—", status: "neutral", text: NA },
];

// Patient-strip labels are frozen structure; values are blank until sourced.
const PATIENT_STRIP_DATA = [
  { k: "Patient ID", v: NA, sub: "", isMono: true },
  { k: "Diagnosis", v: NA, sub: "" },
  { k: "Intent", v: NA, sub: "" },
  { k: "Course", v: NA, sub: "", isMono: true },
  { k: "Concurrent Systemic", v: NA, sub: "" },
  { k: "Report Generated", v: NA, sub: "", isMono: true },
];

// ─── LIVE-DATA OVERLAY ─────────────────────────────────────────────
// The dashboard structure below is FROZEN. Live agent data only fills in row
// VALUES, matched by `param`. No field/row/column/module is ever added or removed.

// Normalize a param key for matching: unify hyphen variants (ASCII "-", U+2011),
// collapse whitespace, lowercase. Lets "Follow‑up Summary" match "Follow-up Summary".
const normParam = (s) =>
  String(s || "")
    .replace(/[‐‑‒–—]/g, "-")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();

// Overlay one live envelope's rows onto a frozen module, by param. Values only.
const overlayModule = (mod, envelope) => {
  const liveRows = envelope?.data?.rows;
  if (!Array.isArray(liveRows) || liveRows.length === 0) return mod;

  const liveByParam = new Map(liveRows.map((r) => [normParam(r.param), r]));
  const rows = mod.rows.map((row) => {
    const live = liveByParam.get(normParam(row.param));
    if (!live) return row; // no live value → keep frozen placeholder
    // Keep the frozen `param` (label text is part of the locked layout); take the
    // agent's derived values for the other five keys, falling back to frozen.
    return {
      ...row,
      finding: live.finding ?? row.finding,
      ref: live.ref ?? row.ref,
      status: live.status ?? row.status,
      statusLabel: live.statusLabel ?? row.statusLabel,
      action: live.action ?? row.action,
    };
  });
  return { ...mod, rows };
};

// Build the render list: frozen modules with live values overlaid where available.
const applyLiveData = (liveByModuleId) =>
  REPORT_MODULES.map((mod) =>
    liveByModuleId[mod.id] ? overlayModule(mod, liveByModuleId[mod.id]) : mod
  );

// Overlay header values onto the frozen patient strip — VALUES only, matched by
// label. A missing/blank value keeps the frozen "Not available" placeholder; no
// cell is added or removed.
const applyHeaderStrip = (header) => {
  const live = header?.patientStrip;
  if (!live) return PATIENT_STRIP_DATA;
  const byLabel = new Map(
    Object.entries(live).map(([k, v]) => [normParam(k), v])
  );
  return PATIENT_STRIP_DATA.map((cell) => {
    const h = byLabel.get(normParam(cell.k));
    if (!h) return cell;
    return {
      ...cell,
      v: h.v != null && h.v !== "" ? h.v : cell.v,
      sub: h.sub != null && h.sub !== "" ? h.sub : cell.sub,
    };
  });
};

// Overlay header values onto the frozen KPI cards — VALUES only, matched by label.
const applyHeaderKpis = (header) => {
  const live = header?.kpis;
  if (!live) return KPI_DATA;
  const byLabel = new Map(
    Object.entries(live).map(([k, v]) => [normParam(k), v])
  );
  return KPI_DATA.map((kpi) => {
    const h = byLabel.get(normParam(kpi.label));
    if (!h) return kpi;
    return {
      ...kpi,
      num: h.num != null && h.num !== "" ? h.num : kpi.num,
      status: h.status || kpi.status,
      text: h.text != null && h.text !== "" ? h.text : kpi.text,
    };
  });
};

// ─── MAIN COMPONENT ────────────────────────────────────────────────
const RadiationOncologyIntelligence = ({ patientId, doctorId }) => {
  // All modules expanded by default for full visibility
  const [collapsedModules, setCollapsedModules] = useState({});

  // Live agent data overlaid onto the frozen modules (values only).
  const [liveData, setLiveData] = useState({}); // { m9: envelope, ... }
  const [header, setHeader] = useState(null); // { patientStrip, kpis } | null
  const [loading, setLoading] = useState(false);
  const [regenerating, setRegenerating] = useState(false);
  const [dataError, setDataError] = useState("");
  const [skillOpen, setSkillOpen] = useState(false);

  const ctx = { patientId, doctorId };

  // Page visit: load latest saved generation (backend generates on first-ever visit).
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setDataError("");
    loadDashboard(ctx)
      .then(({ modules, header: liveHeader }) => {
        if (!cancelled) {
          setLiveData(modules);
          setHeader(liveHeader);
        }
      })
      .catch((err) => {
        if (!cancelled) setDataError(err?.message || "Failed to load live data.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [patientId, doctorId]);

  // Regenerate button: force a fresh agent run + new stored version (silent history).
  const handleRegenerate = useCallback(async () => {
    setRegenerating(true);
    setDataError("");
    try {
      const { modules, header: liveHeader } = await regenerateDashboard(ctx);
      setLiveData((prev) => ({ ...prev, ...modules }));
      if (liveHeader) setHeader(liveHeader);
    } catch (err) {
      setDataError(err?.message || "Failed to regenerate.");
    } finally {
      setRegenerating(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [patientId, doctorId]);

  // Frozen modules with live values overlaid where an agent has run.
  const modules = applyLiveData(liveData);

  // Frozen header strip + KPI cards with live values overlaid (values only).
  const patientStrip = applyHeaderStrip(header);
  const kpis = applyHeaderKpis(header);

  // Provenance line for the live-data controls (version + when generated).
  const liveEnvelopes = Object.values(liveData);
  let liveStatusText = "";
  if (liveEnvelopes.length > 0) {
    const latest = liveEnvelopes[0];
    const when = latest.generatedAt
      ? String(latest.generatedAt).replace("T", " ").replace("Z", " UTC")
      : "—";
    const count = liveEnvelopes.length;
    liveStatusText = `${count} module${count > 1 ? "s" : ""} live · v${
      latest.version ?? "?"
    } · generated ${when}`;
  }

  const toggleModule = (id) => {
    setCollapsedModules((prev) => ({
      ...prev,
      [id]: !prev[id],
    }));
  };

  const scrollToModule = (id) => {
    const el = document.getElementById(`roi-${id}`);
    if (el) {
      el.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  };

  return (
    <Box sx={{ fontFamily: FONT, color: C.textPrimary, pb: 6 }}>
      {/* ─── HERO / REPORT HEADER ──────────────────────────────────── */}
      <Box sx={{ mb: 4, pb: 3, borderBottom: `1px solid ${C.black}` }}>
        <Typography
          sx={{
            fontSize: 11,
            letterSpacing: "0.22em",
            textTransform: "uppercase",
            color: C.textMuted,
            fontWeight: FW_NORMAL,
            mb: 1,
            fontFamily: FONT,
          }}
        >
          Longitudinal Clinical Copilot · Demo Report
        </Typography>
        <Typography
          variant="h4"
          sx={{
            fontFamily: FONT,
            fontWeight: FW_LIGHT,
            letterSpacing: "-0.01em",
            fontSize: { xs: "22px", md: "28px" },
            color: C.textPrimary,
            mb: 1.5,
            lineHeight: 1.3,
          }}
        >
          One page. Every course of radiation and chemotherapy, monitored continuously.
        </Typography>
        <Typography
          sx={{
            fontSize: 13,
            color: C.textSecond,
            maxWidth: 900,
            lineHeight: 1.6,
            fontWeight: FW_LIGHT,
          }}
        >
          This report consolidates readiness, planning, cumulative dose, delivery, toxicity, and follow‑up signals
          across the entire radiotherapy journey — surfacing only what needs a decision. It sits alongside the TPS
          (Eclipse / RayStation / Monaco / Pinnacle), never replacing it.
        </Typography>

        {/* Live-data controls (UI chrome — no data field is added/removed) */}
<Box
  sx={{
    mt: 2.5,
    display: "flex",
    alignItems: "center",
    gap: 2,
    flexWrap: "wrap",
  }}
>
  {/* Regenerate Report */}
  <Button
    onClick={handleRegenerate}
    disabled={loading || regenerating}
    sx={{
      fontFamily: FONT,
      fontSize: 11.5,
      fontWeight: FW_MEDIUM,
      letterSpacing: "0.04em",
      textTransform: "uppercase",
      color: C.white,
      backgroundColor: C.black,
      border: `1px solid ${C.black}`,
      borderRadius: 0,
      px: 2,
      py: 0.7,
      "&:hover": {
        backgroundColor: "#222222",
      },
      "&.Mui-disabled": {
        color: C.textMuted,
        backgroundColor: C.bgTertiary,
        borderColor: C.border,
      },
    }}
  >
    {regenerating ? "Regenerating…" : "Regenerate report"}
  </Button>

  {/* Configure Intelligence Skill */}
  <Button
    onClick={() => setSkillOpen(true)}
    sx={{
      fontFamily: FONT,
      fontSize: 11.5,
      fontWeight: FW_MEDIUM,
      textTransform: "none",
      color: C.white,
      backgroundColor: C.black,
      border: `1px solid ${C.black}`,
      borderRadius: 0,
      px: 2,
      py: 0.7,
      "&:hover": {
        backgroundColor: "#222222",
      },
    }}
  >
    Configure Intelligence Skill
  </Button>

  {/* Status */}
  <Typography
    sx={{
      fontSize: 11.5,
      color: dataError ? "#b03d2b" : C.textMuted,
      fontFamily: FONT,
      fontWeight: FW_LIGHT,
    }}
  >
    {loading
      ? "Loading latest generation…"
      : dataError
      ? dataError
      : liveStatusText}
  </Typography>
</Box>
</Box>
      {/* ─── PATIENT STRIP (6 Cells) ───────────────────────────────── */}
      <Box
        sx={{
          display: "grid",
          gridTemplateColumns: { xs: "repeat(2, 1fr)", sm: "repeat(3, 1fr)", md: "repeat(6, 1fr)" },
          borderTop: `1px solid ${C.border}`,
          borderLeft: `1px solid ${C.border}`,
          backgroundColor: C.white,
          mb: 3,
        }}
      >
        {patientStrip.map((cell, idx) => (
          <Box
            key={idx}
            sx={{
              p: 2,
              borderRight: `1px solid ${C.border}`,
              borderBottom: `1px solid ${C.border}`,
              backgroundColor: C.bgPrimary,
            }}
          >
            <Typography
              sx={{
                fontSize: 10,
                letterSpacing: "0.14em",
                textTransform: "uppercase",
                color: C.textMuted,
                fontFamily: FONT,
                fontWeight: FW_NORMAL,
                mb: 0.8,
              }}
            >
              {cell.k}
            </Typography>
            <Typography
              sx={{
                fontSize: 14,
                fontWeight: FW_MEDIUM,
                color: C.textPrimary,
                fontFamily: cell.isMono ? FONT_MONO : FONT,
                lineHeight: 1.3,
              }}
            >
              {cell.v}
            </Typography>
            {cell.sub && (
              <Typography
                sx={{
                  fontSize: 11.5,
                  color: C.textMuted,
                  fontWeight: FW_LIGHT,
                  mt: 0.4,
                  lineHeight: 1.3,
                }}
              >
                {cell.sub}
              </Typography>
            )}
          </Box>
        ))}
      </Box>

      {/* ─── KPI SUMMARY ROW (6 Cards) ─────────────────────────────── */}
      <Box
        sx={{
          display: "grid",
          gridTemplateColumns: { xs: "repeat(2, 1fr)", sm: "repeat(3, 1fr)", md: "repeat(6, 1fr)" },
          gap: 1.5,
          mb: 4,
        }}
      >
        {kpis.map((kpi, idx) => {
          let dotBg = "#888888";
          let textColor = C.textSecond;
          if (kpi.status === "ok") {
            dotBg = "#2e7d32";
            textColor = "#276738";
          } else if (kpi.status === "watch") {
            dotBg = "#b78103";
            textColor = "#8a6d1c";
          } else if (kpi.status === "alert") {
            dotBg = "#c62828";
            textColor = "#b03d2b";
          }

          return (
            <Box
              key={idx}
              sx={{
                p: 2,
                border: `1px solid ${C.border}`,
                backgroundColor: C.bgSecondary,
                display: "flex",
                flexDirection: "column",
                justifyContent: "space-between",
                minHeight: 110,
              }}
            >
              <Typography
                sx={{
                  fontSize: 10,
                  letterSpacing: "0.1em",
                  textTransform: "uppercase",
                  color: C.textMuted,
                  fontWeight: FW_NORMAL,
                  mb: 1,
                }}
              >
                {kpi.label}
              </Typography>
              <Typography
                sx={{
                  fontSize: 22,
                  fontWeight: FW_LIGHT,
                  color: C.textPrimary,
                  lineHeight: 1.1,
                  mb: 1,
                }}
              >
                {kpi.num}
              </Typography>
              <Box sx={{ display: "flex", alignItems: "center", gap: 0.75, mt: "auto" }}>
                <Box
                  sx={{
                    width: 6,
                    height: 6,
                    borderRadius: "50%",
                    backgroundColor: dotBg,
                    flexShrink: 0,
                  }}
                />
                <Typography
                  sx={{
                    fontSize: 10.5,
                    fontWeight: FW_MEDIUM,
                    color: textColor,
                    letterSpacing: "0.04em",
                    textTransform: "uppercase",
                  }}
                >
                  {kpi.text}
                </Typography>
              </Box>
            </Box>
          );
        })}
      </Box>

      {/* ─── MODULE JUMP NAVIGATION ─────────────────────────────────── */}
      <Box
        sx={{
          display: "flex",
          gap: 0.5,
          overflowX: "auto",
          pb: 1.5,
          mb: 3,
          borderBottom: `2px solid ${C.black}`,
          scrollbarWidth: "thin",
          "&::-webkit-scrollbar": { height: 4 },
          "&::-webkit-scrollbar-thumb": { backgroundColor: C.border },
        }}
      >
        {modules.map((mod) => (
          <Button
            key={mod.id}
            size="small"
            onClick={() => scrollToModule(mod.id)}
            sx={{
              fontFamily: FONT,
              fontSize: 11,
              fontWeight: FW_NORMAL,
              textTransform: "none",
              color: C.textSecond,
              backgroundColor: C.bgSecondary,
              border: `1px solid ${C.border}`,
              borderRadius: 0,
              px: 1.5,
              py: 0.5,
              whiteSpace: "nowrap",
              "&:hover": {
                backgroundColor: C.black,
                color: C.white,
                borderColor: C.black,
              },
            }}
          >
            {mod.navLabel}
          </Button>
        ))}
      </Box>

      {/* ─── 12 MODULE SECTIONS ─────────────────────────────────────── */}
      <Box sx={{ display: "flex", flexDirection: "column", gap: 3.5 }}>
        {modules.map((mod) => {
          const isCollapsed = !!collapsedModules[mod.id];

          return (
            <Box
              key={mod.id}
              id={`roi-${mod.id}`}
              sx={{
                border: `1px solid ${C.border}`,
                backgroundColor: C.white,
                scrollMarginTop: "20px",
              }}
            >
              {/* Header Bar */}
              <Box
                onClick={() => toggleModule(mod.id)}
                sx={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  p: "14px 20px",
                  background: C.black,
                  color: C.white,
                  cursor: "pointer",
                  userSelect: "none",
                  gap: 2,
                }}
              >
                <Box sx={{ display: "flex", alignItems: "baseline", gap: 1.5, flexWrap: "wrap" }}>
                  <Typography
                    sx={{
                      fontSize: 11,
                      letterSpacing: "0.15em",
                      color: "#bbbbbb",
                      fontFamily: FONT,
                      textTransform: "uppercase",
                      fontWeight: FW_LIGHT,
                    }}
                  >
                    Module {mod.num}
                  </Typography>
                  <Typography
                    sx={{
                      fontSize: 14.5,
                      fontWeight: FW_MEDIUM,
                      letterSpacing: "0.02em",
                      textTransform: "uppercase",
                      color: C.white,
                      fontFamily: FONT,
                    }}
                  >
                    {mod.title}
                  </Typography>
                </Box>

                <Box sx={{ display: "flex", alignItems: "center", gap: 1.5 }}>
                  <Box
                    sx={{
                      fontSize: 10.5,
                      color: "#cccccc",
                      border: "1px solid #555555",
                      px: 1.2,
                      py: 0.3,
                      fontFamily: FONT,
                      letterSpacing: "0.06em",
                      whiteSpace: "nowrap",
                      display: { xs: "none", sm: "block" },
                    }}
                  >
                    {mod.summary}
                  </Box>
                  <IconButton size="small" sx={{ color: C.white, p: 0.2 }}>
                    {isCollapsed ? <ExpandMore /> : <ExpandLess />}
                  </IconButton>
                </Box>
              </Box>

              {/* Description sub-bar */}
              <Box
                sx={{
                  p: "10px 20px",
                  borderBottom: `1px solid ${C.border}`,
                  backgroundColor: C.bgSecondary,
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  flexWrap: "wrap",
                  gap: 1,
                }}
              >
                <Typography
                  sx={{
                    fontSize: 12.5,
                    color: C.textSecond,
                    fontWeight: FW_LIGHT,
                    maxWidth: 880,
                    lineHeight: 1.5,
                  }}
                >
                  {mod.description}
                </Typography>
                <Box
                  sx={{
                    fontSize: 10.5,
                    color: C.textMuted,
                    border: `1px solid ${C.border}`,
                    px: 1,
                    py: 0.2,
                    display: { xs: "block", sm: "none" },
                  }}
                >
                  {mod.summary}
                </Box>
              </Box>

              {/* Collapsible Table Content */}
              <Collapse in={!isCollapsed}>
                <Box sx={{ overflowX: "auto" }}>
                  <table
                    style={{
                      width: "100%",
                      borderCollapse: "collapse",
                      fontSize: "12.5px",
                      minWidth: "750px",
                    }}
                  >
                    <thead>
                      <tr
                        style={{
                          background: C.bgSecondary,
                          borderBottom: `1px solid ${C.border}`,
                        }}
                      >
                        {mod.columns.map((col, cIdx) => (
                          <th
                            key={cIdx}
                            style={{
                              padding: "10px 16px",
                              textAlign: "left",
                              fontFamily: FONT,
                              fontWeight: FW_SEMIBOLD,
                              fontSize: "10.5px",
                              letterSpacing: "0.08em",
                              textTransform: "uppercase",
                              color: C.textMuted,
                              whiteSpace: "nowrap",
                              width:
                                cIdx === 0
                                  ? "26%"
                                  : cIdx === 1
                                  ? "22%"
                                  : cIdx === 2
                                  ? "22%"
                                  : cIdx === 3
                                  ? "13%"
                                  : "17%",
                            }}
                          >
                            {col}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {mod.rows.map((row, rIdx) => {
                        const isLast = rIdx === mod.rows.length - 1;
                        return (
                          <tr
                            key={rIdx}
                            style={{
                              borderBottom: isLast ? "none" : `1px solid ${C.border}`,
                              backgroundColor: rIdx % 2 === 0 ? C.white : C.bgSecondary,
                            }}
                          >
                            {/* Parameter / Document / Organ */}
                            <td
                              style={{
                                padding: "12px 16px",
                                verticalAlign: "top",
                                fontWeight: FW_MEDIUM,
                                color: C.textPrimary,
                              }}
                            >
                              {row.param}
                            </td>

                            {/* Column 2: Finding or Status (for Module 9) */}
                            <td
                              style={{
                                padding: "12px 16px",
                                verticalAlign: "top",
                                color: C.textSecond,
                              }}
                            >
                              {mod.id === "m9" ? (
                                <StatusPill status={row.status} label={row.statusLabel} />
                              ) : (
                                row.finding
                              )}
                            </td>

                            {/* Column 3: Reference or Last Generated */}
                            <td
                              style={{
                                padding: "12px 16px",
                                verticalAlign: "top",
                                color: C.textSecond,
                              }}
                            >
                              {mod.id === "m9" ? row.finding : row.ref}
                            </td>

                            {/* Column 4: Status Pill (or Completeness for Module 9) */}
                            <td
                              style={{
                                padding: "12px 16px",
                                verticalAlign: "top",
                                whiteSpace: "nowrap",
                              }}
                            >
                              {mod.id === "m9" ? (
                                <span style={{ color: C.textSecond }}>{row.ref}</span>
                              ) : (
                                <StatusPill status={row.status} label={row.statusLabel} />
                              )}
                            </td>

                            {/* Column 5: Action / Indication */}
                            <td
                              style={{
                                padding: "12px 16px",
                                verticalAlign: "top",
                                color: C.textSecond,
                                fontSize: "12px",
                              }}
                            >
                              {row.action}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </Box>
              </Collapse>
            </Box>
          );
        })}
      </Box>
        <RadiationOncologySkillPanel
        open={skillOpen}
        onClose={() => setSkillOpen(false)}
        patientId={patientId}
        doctorId={doctorId}
      />

    </Box>
  );
};

export default RadiationOncologyIntelligence;
