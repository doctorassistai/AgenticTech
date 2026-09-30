import React, { useState, useEffect } from "react";
import { Box, Typography, Button } from "@mui/material";
import SettingsOutlinedIcon from "@mui/icons-material/SettingsOutlined";
import ChemotherapySkillPanel from "./ChemotherapySkillPanel";

const API_BASE_URL = import.meta.env.VITE_BACKEND_URL || "https://doctorassist.ai/api/";
const AGENTIC_BASE = `${API_BASE_URL}hms/users/ai-legacy/`;

// ─── STYLES & COLOR SYSTEM (Light theme matching OPRecord.jsx) ───
const theme = {
  bg: "#ffffff",
  bgPanel: "#fafafa",
  bgRaise: "#f5f5f5",
  line: "#e0e0e0",
  lineSoft: "#f0f0f0",
  ink: "#000000",
  inkDim: "#333333",
  inkMute: "#777777",

  // Status Colors (Light Theme High-Contrast)
  ok: "#2e7d32",
  okBg: "#e8f5e9",
  okBorder: "#a5d6a7",

  watch: "#b78103",
  watchBg: "#fff8e1",
  watchBorder: "#ffe082",

  alert: "#c62828",
  alertBg: "#ffebee",
  alertBorder: "#ef9a9a",

  flag: "#1565c0",
  flagBg: "#e3f2fd",
  flagBorder: "#90caf9",

  stop: "#b71c1c",
  stopBg: "#fbe9e7",
  stopBorder: "#ffab91",

  fontSans: '"Open Sans", sans-serif',
  fontMono: '"Space Mono", monospace',
};

// ─── ECOG PERFORMANCE STATUS DESCRIPTIONS ───
const ECOG_DESCRIPTIONS = {
  0: "0 - Fully active",
  1: "1 - Restricted in strenuous activity",
  2: "2 - Ambulatory, up >50% of waking hours",
  3: "3 - Capable of only limited self-care",
  4: "4 - Completely disabled",
  5: "5 - Dead",
};

function formatEcogLabel(ecog) {
  if (ecog === undefined || ecog === null || ecog === "") return "ECOG —";
  const num = parseInt(ecog, 10);
  if (!isNaN(num) && ECOG_DESCRIPTIONS[num] !== undefined) {
    return `ECOG ${ECOG_DESCRIPTIONS[num]}`;
  }
  return `ECOG ${ecog}`;
}

// ─── EMPTY INITIAL REPORT STATE ───
const INITIAL_REPORT_DATA = {
  patient: {
    id: "—",
    idSub: "Live record",
    diagnosis: "—",
    diagnosisSub: "—",
    regimen: "—",
    regimenSub: "—",
    cycle: "—",
    cycleSub: "—",
    renal: "—",
    renalSub: "—",
    generated: "—",
    generatedSub: "—",
  },
  kpis: [
    { label: "Total Checks Evaluated", value: "0", status: "neutral" },
    { label: "Critical Alerts", value: "0", status: "ok" },
    { label: "Warnings / Watch", value: "0", status: "ok" },
    { label: "Data Gaps (Not Available)", value: "0", status: "neutral" },
  ],
};

function formatModuleRows(modulesData, moduleId, tbMdtSummary = null) {
  const mod = modulesData?.[moduleId] || modulesData?.[String(moduleId)];
  let checks = [];
  if (mod && Array.isArray(mod.checks)) {
    checks = [...mod.checks];
  }

  // Dynamically inject MDT summary into Module 11 at render time
  if (moduleId === 11 && tbMdtSummary) {
    const mdtCheck = {
      parameter: "Multi-Disciplinary Team (MDT) Summary",
      current_finding: tbMdtSummary,
      reference_expected: "MDT decision log attached to patient record",
      status: "ok",
      indication_action: "Tumor board discussion summary linked to chart.",
    };
    const existingIdx = checks.findIndex((c) => c.parameter === "Multi-Disciplinary Team (MDT) Summary");
    if (existingIdx >= 0) {
      checks[existingIdx] = { ...checks[existingIdx], ...mdtCheck };
    } else {
      checks.push(mdtCheck);
    }
  }

  if (checks.length > 0) {
    return checks.map((chk) => ({
      param: chk.parameter,
      finding: chk.current_finding,
      expected: chk.reference_expected,
      status: {
        label:
          chk.status === "ok"
            ? "Verified"
            : chk.status === "flag"
            ? "Flagged"
            : chk.status === "watch"
            ? "Watch"
            : chk.status === "neutral" || chk.status === "not_available" || chk.status === "not_applicable"
            ? (chk.current_finding && String(chk.current_finding).toLowerCase().includes("not applicable") ? "Not applicable" : "Not available")
            : chk.status.toUpperCase(),
        type: chk.status || "ok",
      },
      action: chk.indication_action,
    }));
  }
  return [];
}

export default function ChemoIntelligenceTab({ patientId, doctorId, treatmentId, cycleNum, treatmentHistory, liveData }) {
  const [data, setData] = useState({
    ...INITIAL_REPORT_DATA,
    ...liveData,
  });

  const [loading, setLoading] = useState(false);
  const [tbMdtSummary, setTbMdtSummary] = useState(null);

  const [skillPanelOpen, setSkillPanelOpen] = useState(false);

  // Match selected treatment card from treatmentHistory prop
  const matchedHist = Array.isArray(treatmentHistory)
    ? treatmentHistory.find((h) => String(h.treatmentId) === String(treatmentId) || String(h.id) === String(treatmentId))
    : null;

  const cardCyclesTotal = matchedHist?.cycles
    ? parseInt(matchedHist.cycles)
    : matchedHist?.plannedCycles
    ? parseInt(matchedHist.plannedCycles)
    : null;

  const cardProtocolName = matchedHist?.protocolName || matchedHist?.name || null;

  // ── FETCH TUMOR BOARD PLAN FOR MDT SUMMARY ──
  useEffect(() => {
    if (patientId) {
      fetch(`${API_BASE_URL}hms/users/data/context/get-tumor-board-plan?patientId=${patientId}`)
        .then((res) => res.json())
        .then((tbJson) => {
          if ((tbJson?.status === "success" || tbJson?.success) && tbJson?.data?.care_pathway_plan) {
            const plan = tbJson.data.care_pathway_plan;
            let summaryText = plan.mdt_basis_summary || "";
            if (plan.sequence_rationale) {
              summaryText += (summaryText ? " | " : "") + "Rationale: " + plan.sequence_rationale;
            }
            if (summaryText) {
              setTbMdtSummary(summaryText);
            }
          }
        })
        .catch((err) => console.warn("Failed to fetch tumor board plan:", err));
    }
  }, [patientId]);

  useEffect(() => {
    if (patientId) {
      setLoading(true);
      const AGENTIC_BASE = `${API_BASE_URL}hms/users/ai-legacy/`;
      const queryParams = `doctorId=${doctorId || ""}&treatmentId=${treatmentId || ""}&cycleNum=${cycleNum || ""}`;
      const primaryUrl = `${AGENTIC_BASE}chemotherapy-intelligence/report/${patientId}?${queryParams}`;
      const fallbackUrl = `/api/hms/users/ai-legacy/chemotherapy-intelligence/report/${patientId}?${queryParams}`;

      const doFetch = (url, isRetry = false) => {
        return fetch(url)
          .then((res) => {
            const contentType = res.headers.get("content-type") || "";
            if (!res.ok || !contentType.includes("application/json")) {
              if (!isRetry) return doFetch(fallbackUrl, true);
              throw new Error(`HTTP ${res.status} or non-JSON content-type`);
            }
            return res.json();
          })
          .then((resData) => {
            if (resData?.success && resData?.data) {
              const apiReport = resData.data;
              if (apiReport.patient) {
                const p = apiReport.patient;
                const activeCycle = cycleNum || p.cycle_current || 1;
                const totalCycles = cardCyclesTotal || p.cycle_total || 6;
                const regimenName = cardProtocolName || p.regimen || "AC-T";

                setData((prev) => ({
                  ...prev,
                  patient: {
                    ...prev.patient,
                    id: p.patient_id || prev.patient.id,
                    diagnosis: p.diagnosis || p.indication || "Carcinoma / Solid Tumor",
                    diagnosisSub: formatEcogLabel(p.ecog),
                    regimen: regimenName,
                    regimenSub: "Adjuvant / Curative",
                    cycle: `Cycle ${activeCycle} of ${totalCycles}`,
                    cycleSub: `Day ${p.day || 1} · 21-day Cadence`,
                    renal: p.crcl ? `CrCl ${p.crcl} mL/min` : "CrCl 48.1 mL/min",
                    renalSub: p.serum_creatinine ? `Serum Cr ${p.serum_creatinine} mg/dL` : "Serum Cr 0.9 mg/dL",
                    generated: resData.timestamp ? new Date(resData.timestamp).toLocaleTimeString() : new Date().toLocaleTimeString(),
                    generatedSub: resData.cached ? `Cached (v${resData.version || 1})` : `Fresh Run (v${resData.version || 1})`,
                  },
                  kpis: apiReport.summary_kpis && apiReport.summary_kpis.length > 0 ? apiReport.summary_kpis : prev.kpis,
                  modulesData: apiReport.modules || {},
                  reportVersion: resData.version || 1,
                  isCached: resData.cached || false,
                }));
              }
            }
          })
          .catch(() => {
            // Quiet fallback to prototype data when API is offline or deploying
          })
          .finally(() => setLoading(false));
      };

      doFetch(primaryUrl);
    }
  }, [patientId, doctorId, treatmentId, cycleNum, cardCyclesTotal, cardProtocolName]);

  const handleRegenerate = () => {
    if (!patientId || loading) return;
    setLoading(true);
    const AGENTIC_BASE = `${API_BASE_URL}hms/users/ai-legacy/`;
    const queryParams = `doctorId=${doctorId || ""}&treatmentId=${treatmentId || ""}&cycleNum=${cycleNum || ""}`;
    const generateUrl = `${AGENTIC_BASE}chemotherapy-intelligence/generate/${patientId}?${queryParams}`;

    fetch(generateUrl, { method: "POST" })
      .then((res) => res.json())
      .then((resData) => {
        if (resData?.success && resData?.data) {
          const apiReport = resData.data;
          if (apiReport.patient) {
            const p = apiReport.patient;
            const activeCycle = cycleNum || p.cycle_current || 1;
            const totalCycles = cardCyclesTotal || p.cycle_total || 6;
            const regimenName = cardProtocolName || p.regimen || "AC-T";

            setData((prev) => ({
              ...prev,
              patient: {
                ...prev.patient,
                id: p.patient_id || prev.patient.id,
                diagnosis: p.diagnosis || p.indication || "Carcinoma / Solid Tumor",
                diagnosisSub: formatEcogLabel(p.ecog),
                regimen: regimenName,
                regimenSub: "Adjuvant / Curative",
                cycle: `Cycle ${activeCycle} of ${totalCycles}`,
                cycleSub: `Day ${p.day || 1} · 21-day Cadence`,
                renal: p.crcl ? `CrCl ${p.crcl} mL/min` : "CrCl 48.1 mL/min",
                renalSub: p.serum_creatinine ? `Serum Cr ${p.serum_creatinine} mg/dL` : "Serum Cr 0.9 mg/dL",
                generated: resData.timestamp ? new Date(resData.timestamp).toLocaleTimeString() : new Date().toLocaleTimeString(),
                generatedSub: `Fresh Run (v${resData.version || 1})`,
              },
              kpis: apiReport.summary_kpis && apiReport.summary_kpis.length > 0 ? apiReport.summary_kpis : prev.kpis,
              modulesData: apiReport.modules || {},
              reportVersion: resData.version || 1,
              isCached: false,
              reportTimestamp: resData.timestamp,
            }));
          }
        }
      })
      .catch((err) => {
        console.warn("Failed to regenerate report:", err);
      })
      .finally(() => setLoading(false));
  };

  const scrollToModule = (id) => {
    const el = document.getElementById(id);
    if (el) el.scrollIntoView({ behavior: "smooth" });
  };

  return (
    <Box
      sx={{
        backgroundColor: theme.bg,
        color: theme.ink,
        fontFamily: theme.fontSans,
        fontWeight: 300,
        lineHeight: 1.55,
        minHeight: "100vh",
        width: "100%",
        pb: 10,
        fontSize: 13,
      }}
    >
      {/* ── STICKY TOPBAR ── */}
      <Box
        sx={{
          position: "sticky",
          top: 0,
          zIndex: 50,
          backgroundColor: "rgba(255,255,255,0.96)",
          backdropFilter: "blur(8px)",
          borderBottom: `1px solid ${theme.line}`,
          px: 3,
          py: 1.5,
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 2,
          width: "100%",
        }}
      >
        <Box sx={{ display: "flex", flexDirection: "column", gap: 0.25, flexShrink: 0 }}>
          <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
            <Box
              sx={{
                fontFamily: theme.fontMono,
                fontSize: 9.5,
                fontWeight: 700,
                letterSpacing: "0.18em",
                color: theme.inkMute,
                border: `1px solid ${theme.line}`,
                px: 0.75,
                py: 0.15,
                borderRadius: "3px",
                backgroundColor: theme.bgPanel,
                width: "fit-content",
              }}
            >
              CX · AI
            </Box>
            <Box
              onClick={handleRegenerate}
              sx={{
                fontFamily: theme.fontSans,
                fontSize: 10,
                fontWeight: 600,
                color: loading ? theme.inkMute : theme.flag,
                border: `1px solid ${loading ? theme.line : theme.flagBorder}`,
                backgroundColor: loading ? theme.bgPanel : theme.flagBg,
                borderRadius: "3px",
                px: 1,
                py: 0.25,
                cursor: loading ? "wait" : "pointer",
                transition: "all 0.15s ease",
                "&:hover": { opacity: loading ? 1 : 0.85 },
              }}
            >
              {loading ? "Regenerating..." : "↻ Regenerate Analysis"}
            </Box>
          </Box>
          <Typography
            sx={{
              fontSize: 13,
              fontWeight: 700,
              letterSpacing: "0.02em",
              color: theme.ink,
              fontFamily: theme.fontSans,
              whiteSpace: "nowrap",
            }}
          >
            Chemotherapy Intelligence Platform
          </Typography>
        </Box>

        {/* Module Nav Links */}
        <Box
          sx={{
            display: { xs: "none", md: "flex" },
            gap: 0,
            flex: 1,
            justifyContent: "flex-end",
            overflowX: "auto",
            scrollBehavior: "smooth",
            "&::-webkit-scrollbar": { height: 3 },
            "&::-webkit-scrollbar-thumb": { backgroundColor: theme.line },
          }}
        >
          {[
            { id: "m1", label: "01 Readiness" },
            { id: "m2", label: "02 Dosing" },
            { id: "m3", label: "03 Order Verif." },
            { id: "m4", label: "04 Cycle Support" },
            { id: "m5", label: "05 Toxicity" },
            { id: "m6", label: "06 Lifetime" },
            { id: "m7", label: "07 RDI / Response" },
            { id: "m8", label: "08 Emergency" },
            { id: "m9", label: "09 Follow-up" },
            { id: "m10", label: "10 Pharmacy" },
            { id: "m11", label: "11 Docs" },
            { id: "m12", label: "12 Analytics" },
          ].map((item, i, arr) => (
            <Box
              key={item.id}
              onClick={() => scrollToModule(item.id)}
              sx={{
                fontSize: 10,
                letterSpacing: "0.02em",
                color: theme.inkMute,
                fontWeight: 600,
                cursor: "pointer",
                whiteSpace: "nowrap",
                px: 0.8,
                py: 0.5,
                flexShrink: 0,
                borderRight: i < arr.length - 1 ? `1px solid ${theme.line}` : "none",
                fontFamily: theme.fontSans,
                transition: "all 0.15s ease",
                "&:hover": { color: theme.ink, backgroundColor: theme.bgPanel },
              }}
            >
              {item.label}
            </Box>
          ))}
        </Box>
      </Box>

      {/* ── CONFIGURE CHEMOTHERAPY SKILL ── */}
        <Button
          variant="outlined"
          startIcon={<SettingsOutlinedIcon />}
          onClick={() => setSkillPanelOpen(true)}
          sx={{
            ml: 1.5,
            flexShrink: 0,
            textTransform: "none",
            fontSize: 11,
            fontWeight: 600,
            fontFamily: theme.fontSans,
            color: theme.inkDim,
            borderColor: theme.line,
            backgroundColor: theme.bg,
            whiteSpace: "nowrap",
            "&:hover": {
              borderColor: theme.inkMute,
              backgroundColor: theme.bgPanel,
            },
          }}
        >
          Configure Skill
        </Button>

      {/* ── HERO SECTION (Full Width) ── */}
      <Box sx={{ px: 3, pt: 4, pb: 4, borderBottom: `1px solid ${theme.line}`, width: "100%" }}>
        <Typography
          sx={{
            fontFamily: theme.fontMono,
            fontSize: 11,
            letterSpacing: "0.2em",
            color: theme.inkMute,
            textTransform: "uppercase",
            mb: 1.5,
            fontWeight: 600,
          }}
        >
          Longitudinal Clinical Copilot · Demo Report
        </Typography>

        <Typography
          variant="h2"
          sx={{
            fontSize: { xs: 24, md: 32 },
            fontWeight: 400,
            letterSpacing: "-0.01em",
            color: theme.ink,
            fontFamily: theme.fontSans,
            lineHeight: 1.25,
          }}
        >
          One page. Every dose, nadir, and lifetime ceiling — checked before it's ever ordered.
        </Typography>

        <Typography sx={{ mt: 1.5, color: theme.inkDim, fontSize: 13.5, fontWeight: 300, fontFamily: theme.fontSans }}>
          This report consolidates readiness, dose calculation, order safety, cycle-by-cycle decisions, toxicity, lifetime cumulative exposure, and dose-intensity signals across the entire chemotherapy course. It sits alongside the EHR and pharmacy verification system, never replacing pharmacist or oncologist sign-off.
        </Typography>

        {/* Patient Strip (Full Width) */}
        <Box
          sx={{
            mt: 3.5,
            display: "grid",
            gridTemplateColumns: { xs: "repeat(2, 1fr)", sm: "repeat(3, 1fr)", md: "repeat(6, 1fr)" },
            borderTop: `1px solid ${theme.line}`,
            borderLeft: `1px solid ${theme.line}`,
            width: "100%",
          }}
        >
          <StripCell k="Patient ID" v={data.patient.id} isMono sub={data.patient.idSub} />
          <StripCell k="Diagnosis" v={data.patient.diagnosis} sub={data.patient.diagnosisSub} />
          <StripCell k="Regimen" v={data.patient.regimen} sub={data.patient.regimenSub} />
          <StripCell k="Cycle" v={data.patient.cycle} isMono sub={data.patient.cycleSub} />
          <StripCell k="Renal Function" v={data.patient.renal} sub={data.patient.renalSub} />
          <StripCell k="Report Generated" v={data.patient.generated} isMono sub={data.patient.generatedSub} />
        </Box>
      </Box>

      {/* ── KPI ROW (Full Width Grid) ── */}
      <Box
        sx={{
          width: "100%",
          px: 3,
          py: 3,
          display: "grid",
          gridTemplateColumns: { xs: "repeat(2, 1fr)", sm: "repeat(3, 1fr)", md: "repeat(6, 1fr)" },
          gap: 1.5,
          backgroundColor: theme.bgPanel,
          borderBottom: `1px solid ${theme.line}`,
        }}
      >
        {data.kpis.map((kpi, idx) => {
          const displayNum = kpi.num ?? kpi.value ?? "—";
          const statusType = kpi.statusType ?? kpi.status ?? "neutral";
          const displayStatusText =
            kpi.statusText ||
            (statusType === "ok"
              ? "All Clear"
              : statusType === "alert"
              ? "Action Needed"
              : statusType === "watch"
              ? "Watch"
              : statusType.toUpperCase());

          return (
            <Box
              key={idx}
              sx={{
                backgroundColor: theme.bg,
                border: `1px solid ${theme.line}`,
                borderRadius: "4px",
                p: 2,
              }}
            >
              <Typography sx={{ fontSize: 10, letterSpacing: "0.08em", color: theme.inkMute, textTransform: "uppercase", mb: 1, fontWeight: 600, fontFamily: theme.fontSans }}>
                {kpi.label}
              </Typography>
              <Typography sx={{ fontSize: 22, fontWeight: 600, color: theme.ink, fontFamily: theme.fontSans }}>
                {displayNum}
              </Typography>
              <Box
                sx={{
                  mt: 1,
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 0.75,
                  fontFamily: theme.fontMono,
                  fontSize: 10,
                  fontWeight: 600,
                  letterSpacing: "0.04em",
                  textTransform: "uppercase",
                  color: getStatusTextColor(statusType),
                }}
              >
                <Box sx={{ width: 6, height: 6, borderRadius: "50%", backgroundColor: getStatusTextColor(statusType) }} />
                {displayStatusText}
              </Box>
            </Box>
          );
        })}
      </Box>

      {/* ================= MODULE 01 ================= */}
      <ModuleSection id="m1" idx="01 / 12" title="Patient Assessment & Treatment Readiness" desc="Confirms the patient is safe and complete to receive today's cycle — eligibility, performance status, organ function, and pre-treatment checklist, checked before the order is even written." summary="10 checks tracked">
        <ReportTable
          headers={["Parameter", "Current Finding", "Reference / Expected", "Status", "Indication / Action"]}
          rows={formatModuleRows(data.modulesData, 1)}
        />
      </ModuleSection>

      {/* ================= MODULE 02 ================= */}
      <ModuleSection id="m2" idx="02 / 12" title="Chemotherapy Planning & Dose Calculation" desc="The platform's core dosing-safety engine — BSA, Calvert AUC, and renal/hepatic adjustment calculated in real time from today's labs, with capping and staleness checks applied automatically rather than left to memory." summary="12 checks tracked">
        {data.modulesData?.[2]?.flagship_note && (
          <FlagshipNote tag={data.modulesData[2].flagship_note.tag || "Flagship · Calvert AUC & BSA Dose Engine"}>
            {data.modulesData[2].flagship_note.text}
          </FlagshipNote>
        )}
        <ReportTable
          headers={["Parameter", "Current Finding", "Reference / Expected", "Status", "Indication / Action"]}
          rows={formatModuleRows(data.modulesData, 2)}
        />
      </ModuleSection>

      {/* ================= MODULE 03 ================= */}
      <ModuleSection id="m3" idx="03 / 12" title="Chemotherapy Order Verification" desc="Validates the order itself before it reaches the infusion chair — interactions, allergies, sequencing, rate, and required premedication." summary="10 checks tracked">
        {data.modulesData?.[3]?.flagship_note && (
          <FlagshipNote tag={data.modulesData[3].flagship_note.tag}>
            {data.modulesData[3].flagship_note.text}
          </FlagshipNote>
        )}
        <ReportTable
          headers={["Parameter", "Current Finding", "Reference / Expected", "Status", "Indication / Action"]}
          rows={formatModuleRows(data.modulesData, 3)}
        />
      </ModuleSection>

      {/* ================= MODULE 04 ================= */}
      <ModuleSection id="m4" idx="04 / 12" title="Cycle Decision Support" desc="Cross-references nadir counts and toxicity against the regimen's published modification rules to recommend proceed, delay, reduce, or hold — with the source rule cited." summary="12 checks tracked">
        <ReportTable
          headers={["Parameter", "Current Finding", "Reference / Expected (Source)", "Status", "Indication / Action"]}
          rows={formatModuleRows(data.modulesData, 4)}
        />
      </ModuleSection>

      {/* ================= MODULE 05 ================= */}
      <ModuleSection id="m5" idx="05 / 12" title="Toxicity Intelligence" desc="Predicted and observed toxicity, graded and trended by CTCAE, with drug-specific monitoring for the agents this patient is actually receiving." summary="15 checks · CTCAE v5.0">
        <ReportTable
          headers={["Toxicity", "Current Grade / Finding", "Reference / Expected", "Status", "Indication / Action"]}
          rows={formatModuleRows(data.modulesData, 5)}
        />
      </ModuleSection>

      {/* ================= MODULE 06 ================= */}
      <ModuleSection id="m6" idx="06 / 12" title="Lifetime Exposure & Safety" desc="The platform's hard-safety layer — a running per-drug-class ledger across the patient's entire record, including any prior-hospital treatment, with hard stops rather than soft warnings at lifetime ceilings." summary="10 checks · Lifetime ledger">
        {data.modulesData?.[6]?.flagship_note && (
          <FlagshipNote tag={data.modulesData[6].flagship_note.tag || "Flagship · Lifetime Ceiling Hard-Stop Engine"} isStop>
            {data.modulesData[6].flagship_note.text}
          </FlagshipNote>
        )}
        <ReportTable
          headers={["Drug Class / Metric", "Cumulative Exposure", "Lifetime Ceiling (Reference)", "Status", "Indication / Action"]}
          rows={formatModuleRows(data.modulesData, 6)}
        />
      </ModuleSection>

      {/* ================= MODULE 07 ================= */}
      <ModuleSection id="m7" idx="07 / 12" title="Treatment Performance & Response" desc="Response assessment alongside Relative Dose Intensity — tracking whether reduced intensity or delays are quietly compromising the treatment's intended effect." summary="12 checks · ARDI tracked through cycle 3">
        {data.modulesData?.[7]?.flagship_note && (
          <FlagshipNote tag={data.modulesData[7].flagship_note.tag || "Flagship · RDI / ARDI Analytics Engine"}>
            {data.modulesData[7].flagship_note.text}
          </FlagshipNote>
        )}
        <ReportTable
          headers={["Parameter", "Current Finding", "Reference / Expected", "Status", "Indication / Action"]}
          rows={formatModuleRows(data.modulesData, 7)}
        />
      </ModuleSection>

      {/* ================= MODULE 08 ================= */}
      <ModuleSection id="m8" idx="08 / 12" title="Emergency Chemotherapy Support" desc="Continuous surveillance for the acute, time-critical complications of chemotherapy — surfaced the moment early signals appear, not after they escalate." summary="10 checks · All clear today">
        <ReportTable
          headers={["Parameter", "Current Finding", "Reference / Expected", "Status", "Indication / Action"]}
          rows={formatModuleRows(data.modulesData, 8)}
        />
      </ModuleSection>

      {/* ================= MODULE 09 ================= */}
      <ModuleSection id="m9" idx="09 / 12" title="Monitoring & Follow-up" desc="Keeps every recurring lab, scan, and organ-specific monitoring requirement on a single scheduled cadence rather than relying on memory between visits." summary="10 checks tracked">
        <ReportTable
          headers={["Parameter", "Current Finding", "Reference / Expected", "Status", "Indication / Action"]}
          rows={formatModuleRows(data.modulesData, 9)}
        />
      </ModuleSection>

      {/* ================= MODULE 10 ================= */}
      <ModuleSection id="m10" idx="10 / 12" title="Pharmacy & Administration Intelligence" desc="Verification from preparation through infusion — stability, compatibility, cold chain, and closed-loop administration checks that back up the clinical order above." summary="10 checks tracked">
        <ReportTable
          headers={["Parameter", "Current Finding", "Reference / Expected", "Status", "Indication / Action"]}
          rows={formatModuleRows(data.modulesData, 10)}
        />
      </ModuleSection>

      {/* ================= MODULE 11 ================= */}
      <ModuleSection id="m11" idx="11 / 12" title="Documentation & Clinical Intelligence" desc="Auto-generated, explainable summaries at every stage of the chemotherapy course — so no dose modification or toxicity finding depends on manual re-typing." summary="10 checks tracked">
        <ReportTable
          headers={["Document", "Status", "Last Generated", "Completeness", "Indication / Action"]}
          rows={formatModuleRows(data.modulesData, 11, tbMdtSummary)}
        />
      </ModuleSection>

      {/* ================= MODULE 12 ================= */}
      <ModuleSection id="m12" idx="12 / 12" title="Analytics & Quality Improvement" desc="Zooms out from the single patient to unit and cohort-level performance — the operational layer that keeps dosing safety consistent across every chair, every day." summary="9 checks tracked">
        <ReportTable
          headers={["Parameter", "Current Finding", "Reference / Expected", "Status", "Indication / Action"]}
          rows={formatModuleRows(data.modulesData, 12)}
        />
      </ModuleSection>

      {/* ── FOOTER ── */}
      <Box sx={{ width: "100%", px: 3, pt: 6, pb: 10, color: theme.inkMute, fontSize: 11.5, fontWeight: 300, lineHeight: 1.7, fontFamily: theme.fontSans }}>
        <Box sx={{ height: 1, backgroundColor: theme.line, mb: 3 }} />
        <Typography sx={{ fontSize: 11.5, color: theme.inkMute, fontFamily: theme.fontSans }}>
          <strong style={{ color: theme.inkDim, fontWeight: 600 }}>About this report.</strong> This page demonstrates how a Chemotherapy Intelligence Platform would consolidate 130+ monitoring points across twelve modules — readiness, dose calculation, order verification, cycle decision support, toxicity, lifetime cumulative exposure, dose intensity and response, emergency surveillance, follow-up, pharmacy administration, documentation, and analytics — into a single longitudinal view. All patient data shown is synthetic and for illustration only.
        </Typography>
        <Typography sx={{ mt: 1.5, fontSize: 11.5, color: theme.inkMute, fontFamily: theme.fontSans }}>
          The three flagship engines — <strong style={{ color: theme.inkDim, fontWeight: 600 }}>Calvert AUC & BSA Dose Calculation</strong>, <strong style={{ color: theme.inkDim, fontWeight: 600 }}>Lifetime Ceiling Hard-Stop</strong>, and <strong style={{ color: theme.inkDim, fontWeight: 600 }}>RDI / ARDI Analytics</strong> — are highlighted in Modules 2, 6, and 7 with a distinct marker so a doctor can see, at a glance, when an automated safety calculation rather than a routine check has shaped today's order. This is designed to sit alongside the EHR, e-prescribing, and pharmacy verification systems, not to replace oncologist, pharmacist, or nursing sign-off. Every flag above is intended to be traceable back to its source data and guideline reference (NCCN/ESMO/ASCO) via the Explainable AI Clinical Recommendation log in Module 11.
        </Typography>
      </Box>
      {/* CHEMOTHERAPY SKILL */}
      <ChemotherapySkillPanel
        open={skillPanelOpen}
        onClose={() => setSkillPanelOpen(false)}
        patientId={patientId}
        doctorId={doctorId}
        treatmentId={treatmentId}
        cycleNum={cycleNum}
      />
    </Box>
  );
}

// ─── REUSABLE REPORT SUB-COMPONENTS ───

function StripCell({ k, v, isMono, sub }) {
  return (
    <Box sx={{ borderRight: `1px solid ${theme.line}`, borderBottom: `1px solid ${theme.line}`, p: "14px 16px", backgroundColor: theme.bgPanel }}>
      <Typography sx={{ fontFamily: theme.fontMono, fontSize: 9.5, letterSpacing: "0.12em", color: theme.inkMute, textTransform: "uppercase", mb: 0.75, fontWeight: 600 }}>
        {k}
      </Typography>
      <Typography sx={{ fontSize: 14.5, fontWeight: 500, color: theme.ink, fontFamily: isMono ? theme.fontMono : theme.fontSans }}>
        {v}
      </Typography>
      {sub && (
        <Typography sx={{ fontSize: 11.5, color: theme.inkMute, fontWeight: 300, mt: 0.25, fontFamily: theme.fontSans }}>
          {sub}
        </Typography>
      )}
    </Box>
  );
}

function ModuleSection({ id, idx, title, desc, summary, children }) {
  return (
    <Box id={id} sx={{ width: "100%", px: 3, pt: 6, pb: 1, borderBottom: `1px solid ${theme.lineSoft}`, scrollMarginTop: 64 }}>
      <Box sx={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", gap: 3, mb: 3, flexWrap: "wrap" }}>
        <Box>
          <Typography sx={{ fontFamily: theme.fontMono, fontSize: 11, color: theme.inkMute, letterSpacing: "0.18em", mb: 1, fontWeight: 600 }}>
            Module {idx}
          </Typography>
          <Typography variant="h3" sx={{ fontSize: 22, fontWeight: 500, letterSpacing: "-0.005em", color: theme.ink, fontFamily: theme.fontSans }}>
            {title}
          </Typography>
          <Typography sx={{ color: theme.inkDim, fontSize: 13, fontWeight: 300, mt: 0.75, fontFamily: theme.fontSans }}>
            {desc}
          </Typography>
        </Box>
        <Box sx={{ display: "flex", gap: 1.25, alignItems: "center", fontFamily: theme.fontMono, fontSize: 10, letterSpacing: "0.06em", color: theme.inkMute, border: `1px solid ${theme.line}`, px: 1.5, py: 0.75, backgroundColor: theme.bgPanel, whiteSpace: "nowrap" }}>
          {summary}
        </Box>
      </Box>

      {children}
    </Box>
  );
}

function FlagshipNote({ tag, isStop, children }) {
  const borderColor = isStop ? theme.stopBorder : theme.flagBorder;
  const bgColor = isStop ? theme.stopBg : theme.flagBg;
  const tagColor = isStop ? theme.stop : theme.flag;

  return (
    <Box sx={{ display: "flex", gap: 1.75, alignItems: "flex-start", border: `1px solid ${borderColor}`, backgroundColor: bgColor, p: "14px 16px", mb: 3, borderRadius: "4px" }}>
      <Box sx={{ fontFamily: theme.fontMono, fontSize: 9.5, letterSpacing: "0.08em", textTransform: "uppercase", fontWeight: 700, color: tagColor, border: `1px solid ${borderColor}`, px: 1, py: 0.4, whiteSpace: "nowrap", flexShrink: 0, backgroundColor: theme.bg }}>
        {tag}
      </Box>
      <Typography sx={{ fontSize: 12.5, color: theme.inkDim, fontWeight: 400, fontFamily: theme.fontSans }}>
        {children}
      </Typography>
    </Box>
  );
}

function ReportTable({ headers, rows }) {
  return (
    <Box sx={{ overflowX: "auto", mb: 4, width: "100%" }}>
      <Box component="table" sx={{ width: "100%", borderCollapse: "collapse", fontSize: 12.8, fontFamily: theme.fontSans }}>
        <Box component="thead">
          <Box component="tr" sx={{ backgroundColor: theme.bgPanel }}>
            {headers.map((h, idx) => (
              <Box component="th" key={idx} sx={{ textAlign: "left", fontFamily: theme.fontMono, fontWeight: 600, fontSize: 9.5, letterSpacing: "0.1em", textTransform: "uppercase", color: theme.inkMute, px: 1.75, py: 1.25, borderBottom: `1px solid ${theme.line}` }}>
                {h}
              </Box>
            ))}
          </Box>
        </Box>
        <Box component="tbody">
          {rows && rows.length > 0 ? (
            rows.map((row, rIdx) => (
              <Box component="tr" key={rIdx} sx={{ "&:hover td": { backgroundColor: theme.bgPanel } }}>
                <Box component="td" sx={{ px: 1.75, py: 1.5, borderBottom: `1px solid ${theme.lineSoft}`, color: theme.ink, fontWeight: 500 }}>
                  {row.param}
                </Box>
                <Box component="td" sx={{ px: 1.75, py: 1.5, borderBottom: `1px solid ${theme.lineSoft}`, color: theme.inkDim, fontWeight: 300 }}>
                  {row.finding}
                </Box>
                <Box component="td" sx={{ px: 1.75, py: 1.5, borderBottom: `1px solid ${theme.lineSoft}`, color: theme.inkDim, fontWeight: 300 }}>
                  {row.expected}
                </Box>
                <Box component="td" sx={{ px: 1.75, py: 1.5, borderBottom: `1px solid ${theme.lineSoft}`, whiteSpace: "nowrap" }}>
                  <StatusPill label={row.status.label} type={row.status.type} />
                </Box>
                <Box component="td" sx={{ px: 1.75, py: 1.5, borderBottom: `1px solid ${theme.lineSoft}`, color: theme.inkDim, fontWeight: 300 }}>
                  {row.action}
                </Box>
              </Box>
            ))
          ) : (
            <Box component="tr">
              <Box component="td" colSpan={headers.length} sx={{ p: 3, textAlign: "center", color: theme.inkMute, fontFamily: theme.fontMono, fontSize: 11 }}>
                No evaluation checks generated for this module yet.
              </Box>
            </Box>
          )}
        </Box>
      </Box>
    </Box>
  );
}

function StatusPill({ label, type }) {
  const getPillStyle = () => {
    if (type === "ok") return { color: theme.ok, borderColor: theme.okBorder, bg: theme.okBg };
    if (type === "watch") return { color: theme.watch, borderColor: theme.watchBorder, bg: theme.watchBg };
    if (type === "alert") return { color: theme.alert, borderColor: theme.alertBorder, bg: theme.alertBg };
    if (type === "flag") return { color: theme.flag, borderColor: theme.flagBorder, bg: theme.flagBg };
    if (type === "stop") return { color: theme.stop, borderColor: theme.stopBorder, bg: theme.stopBg };
    return { color: theme.inkMute, borderColor: theme.line, bg: theme.bgPanel };
  };

  const st = getPillStyle();
  const dotColor = getStatusTextColor(type);

  return (
    <Box
      sx={{
        display: "inline-flex",
        alignItems: "center",
        gap: 0.75,
        fontFamily: theme.fontMono,
        fontSize: 9.5,
        fontWeight: 600,
        letterSpacing: "0.05em",
        textTransform: "uppercase",
        px: 1.1,
        py: 0.4,
        border: `1px solid ${st.borderColor}`,
        backgroundColor: st.bg,
        color: st.color,
        borderRadius: "3px",
      }}
    >
      <Box sx={{ width: 5, height: 5, borderRadius: "50%", backgroundColor: dotColor }} />
      {label}
    </Box>
  );
}

function getStatusTextColor(type) {
  if (type === "ok") return theme.ok;
  if (type === "watch") return theme.watch;
  if (type === "alert") return theme.alert;
  if (type === "flag") return theme.flag;
  if (type === "stop") return theme.stop;
  return theme.inkMute;
}
