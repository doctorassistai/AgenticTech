// DischargeSummaryTab.jsx — Surgical Oncology Discharge Summary (OT Part J)
// Aggregates already-captured clinical data for the active booking (demographics,
// diagnosis, operative note, investigations, complications) and lets the doctor fill
// the discharge-specific fields (admission/discharge dates, condition, medications,
// advice, follow-up). Free-text sections can be AI-drafted (editable). Produces a
// formatted PDF for the patient.

import React, { useState, useEffect, useCallback } from "react";
import {
  Box, Typography, TextField, Button, IconButton, CircularProgress,
  Snackbar, Table, TableHead, TableBody, TableRow, TableCell, TableContainer,
} from "@mui/material";
import {
  SaveRounded, AddRounded, DeleteRounded, AutoAwesomeRounded,
  PictureAsPdfRounded, CloseRounded, RefreshRounded,
} from "@mui/icons-material";
import { jsPDF } from "jspdf";
import {
  C, FONT, FW_LIGHT, FW_NORMAL, FW_BOLD, inputSx, saveBtnSx, outlineBtnSx, thSx, tdSx,
} from "./shared/designTokens";
import { SectionBox, FG, FieldLabel, ROInput, Sel, RdoGroup } from "./shared/FormComponents";
import { getDischargeSummary, generateDischargeNarrative, generateStagingCommentary } from "./shared/api";
import CompletedInvestigationsPanel from "./shared/CompletedInvestigationsPanel";

// ─── Constants ───────────────────────────────────────────────────────────────
const CONDITION_OPTIONS = ["Stable", "Improved", "Referred", "DAMA", "Expired"];
const MED_ROUTES = ["PO", "IV", "IM", "SC", "Topical", "PR", "Inhaled", "Other"];
const MED_FREQUENCIES = ["OD", "BD", "TDS", "QID", "HS", "SOS", "STAT", "Weekly"];

const emptyMed = () => ({ drug: "", dose: "", route: "", frequency: "", duration: "" });

// LLM narrative sometimes comes back with markdown (**bold**, ## headings, - bullets).
// The narrative fields are plain editable textareas, so convert to clean plaintext:
// keep the structure (line breaks, "• " bullets) but drop the raw markdown syntax.
const stripMarkdown = (text) => {
  if (!text || typeof text !== "string") return "";
  return text
    // headings: "## Title" / "### Title" → "Title"
    .replace(/^\s{0,3}#{1,6}\s+/gm, "")
    // bold/italic: **x**, __x__, *x*, _x_ → x
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/__([^_]+)__/g, "$1")
    .replace(/\*([^*]+)\*/g, "$1")
    .replace(/_([^_]+)_/g, "$1")
    // inline code / code fences → drop the backticks
    .replace(/```[a-z]*\n?/gi, "")
    .replace(/`([^`]+)`/g, "$1")
    // list markers: "- ", "* ", "+ ", "1. " → "• "
    .replace(/^\s*[-*+]\s+/gm, "• ")
    .replace(/^\s*\d+\.\s+/gm, "• ")
    // links [text](url) → text
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    // stray leftover emphasis characters at line edges
    .replace(/[ \t]+$/gm, "")
    // collapse 3+ blank lines to a single blank line
    .replace(/\n{3,}/g, "\n\n")
    .trim();
};

const DEFAULT_DISCHARGE = {
  admissionDate: "",
  dischargeDate: "",
  admissionType: "",
  conditionAtDischarge: "",
  dischargeVitals: "",
  courseInHospital: "",
  dischargeMedications: [],
  dischargeAdvice: "",
  followUpDate: "",
  followUpClinic: "",
  pendingReports: "",
  adjuvantPlan: "",
  stagingCommentary: "",
};

// ─── Small read-only display helpers ──────────────────────────────────────────
const RO = ({ label, value }) => <ROInput label={label} value={value || ""} />;

const ReadText = ({ label, value }) => (
  <Box sx={{ mb: 1.5 }}>
    <FieldLabel>{label}</FieldLabel>
    <Typography sx={{ fontSize: 13, fontFamily: FONT, fontWeight: FW_LIGHT, color: value ? C.textPrimary : C.textMuted, whiteSpace: "pre-wrap" }}>
      {value || "—"}
    </Typography>
  </Box>
);

const DischargeSummaryTab = ({ patientId, doctorId, doctorName, currentBookingId, bookingData, onSave }) => {
  const [agg, setAgg] = useState(null);
  const [isLoading, setIsLoading] = useState(false);
  const [d, setD] = useState(DEFAULT_DISCHARGE);
  const [snackbar, setSnackbar] = useState({ open: false, message: "" });
  const [generating, setGenerating] = useState({ course_in_hospital: false, discharge_advice: false, staging_commentary: false });
  const [isSaving, setIsSaving] = useState(false);

  const set = (k, v) => setD(p => ({ ...p, [k]: v }));
  const notify = (message) => setSnackbar({ open: true, message });

  // ── Load aggregated data + hydrate editable fields ──────────────────────────
  const load = useCallback(async () => {
    if (!currentBookingId || !patientId) return;
    setIsLoading(true);
    try {
      const res = await getDischargeSummary(patientId, currentBookingId);
      if (res?.status === "success" && res.data) {
        setAgg(res.data);
        const saved = res.data.discharge || {};
        setD({
          ...DEFAULT_DISCHARGE,
          ...saved,
          dischargeMedications: Array.isArray(saved.dischargeMedications) ? saved.dischargeMedications : [],
          // Pre-seed adjuvant plan from oncology records when the doctor hasn't written one.
          adjuvantPlan: saved.adjuvantPlan || buildAdjuvantHint(res.data.adjuvant),
        });
      }
    } catch (err) {
      console.error("[DischargeSummaryTab] load error:", err);
      notify("Failed to load discharge summary data.");
    } finally {
      setIsLoading(false);
    }
  }, [currentBookingId, patientId]);

  useEffect(() => { load(); }, [load]);

  const buildAdjuvantHint = (adjuvant) => {
    if (!adjuvant) return "";
    const parts = [];
    if (adjuvant.chemotherapy) parts.push(`Chemotherapy: ${adjuvant.chemotherapy}`);
    if (adjuvant.radiotherapy) parts.push(`Radiotherapy: ${adjuvant.radiotherapy}`);
    return parts.join("\n");
  };

  // ── Discharge medications table ─────────────────────────────────────────────
  const addMed = () => setD(p => ({ ...p, dischargeMedications: [...p.dischargeMedications, emptyMed()] }));
  const removeMed = (i) => setD(p => ({ ...p, dischargeMedications: p.dischargeMedications.filter((_, idx) => idx !== i) }));
  const setMed = (i, key, val) => setD(p => ({
    ...p,
    dischargeMedications: p.dischargeMedications.map((m, idx) => (idx === i ? { ...m, [key]: val } : m)),
  }));

  // ── AI narrative ────────────────────────────────────────────────────────────
  const draftNarrative = async (section, field) => {
    if (!currentBookingId) return;
    setGenerating(p => ({ ...p, [section]: true }));
    try {
      const res = await generateDischargeNarrative(currentBookingId, patientId, section);
      if (res?.status === "success" && res.data?.text) {
        set(field, stripMarkdown(res.data.text));
        notify("Draft generated. Please review and edit before saving.");
      } else {
        notify("No draft returned. Please try again.");
      }
    } catch (err) {
      console.error("[DischargeSummaryTab] narrative error:", err);
      notify("Failed to generate draft.");
    } finally {
      setGenerating(p => ({ ...p, [section]: false }));
    }
  };

  // ── Save ────────────────────────────────────────────────────────────────────
  const handleSave = async () => {
    if (!currentBookingId) { notify("No active booking."); return; }
    setIsSaving(true);
    try {
      // Persisted under the `discharge` section via OTRecord's handleSave → saveSection.
      await onSave("discharge", { ...d });
      // onSave shows its own snackbar in OTRecord; local reload keeps view consistent.
    } catch (err) {
      console.error("[DischargeSummaryTab] save error:", err);
      notify("Failed to save discharge summary.");
    } finally {
      setIsSaving(false);
    }
  };

  // ── PDF export ──────────────────────────────────────────────────────────────
  const handleExportPDF = () => {
    if (!agg) { notify("Nothing to export yet."); return; }
    const demo = agg.demographics || {};
    const diag = agg.diagnosis || {};
    const proc = agg.procedure || {};
    const find = agg.findings || {};
    const comp = agg.complications || {};

    const doc = new jsPDF();
    const marginX = 14;
    const col1Width = 55;
    const col2Width = 127;
    const tableWidth = col1Width + col2Width;
    let y = 34;

    doc.setFontSize(18);
    doc.setFont("helvetica", "bold");
    doc.setTextColor(0);
    doc.text("DISCHARGE SUMMARY", 105, 18, null, null, "center");
    doc.setFontSize(9);
    doc.setFont("helvetica", "normal");
    doc.setTextColor(120);
    doc.text("Department of Surgical Oncology", 105, 24, null, null, "center");
    doc.text(`Generated: ${new Date().toLocaleString()}`, 105, 29, null, null, "center");

    const addSection = (title) => {
      if (y > 265) { doc.addPage(); y = 20; }
      doc.setFillColor(238, 238, 238);
      doc.rect(marginX, y, tableWidth, 9, "F");
      doc.setDrawColor(0);
      doc.setLineWidth(0.2);
      doc.rect(marginX, y, tableWidth, 9, "S");
      doc.setFontSize(10.5);
      doc.setTextColor(0);
      doc.setFont("helvetica", "bold");
      doc.text(title.toUpperCase(), marginX + 3, y + 6.2);
      y += 9;
    };

    const addLine = (label, value) => {
      if (value === undefined || value === null || String(value).trim() === "") return;
      const textVal = String(value);
      doc.setFontSize(9.5);
      doc.setFont("helvetica", "normal");
      const split = doc.splitTextToSize(textVal, col2Width - 6);
      const rowHeight = Math.max(9, 4.6 * split.length + 4);
      if (y + rowHeight > 285) { doc.addPage(); y = 20; }
      doc.setDrawColor(0);
      doc.setLineWidth(0.2);
      doc.rect(marginX, y, tableWidth, rowHeight, "S");
      doc.line(marginX + col1Width, y, marginX + col1Width, y + rowHeight);
      doc.setFont("helvetica", "bold");
      doc.setTextColor(50);
      doc.text(String(label), marginX + 3, y + 6);
      doc.setFont("helvetica", "normal");
      doc.setTextColor(0);
      doc.text(split, marginX + col1Width + 3, y + 6);
      y += rowHeight;
    };

    const addPara = (text) => {
      if (!text || !String(text).trim()) return;
      doc.setFontSize(9.5);
      doc.setFont("helvetica", "normal");
      doc.setTextColor(0);
      const split = doc.splitTextToSize(String(text), tableWidth - 6);
      const rowHeight = 4.6 * split.length + 6;
      if (y + rowHeight > 285) { doc.addPage(); y = 20; }
      doc.setDrawColor(0);
      doc.setLineWidth(0.2);
      doc.rect(marginX, y, tableWidth, rowHeight, "S");
      doc.text(split, marginX + 3, y + 6);
      y += rowHeight;
    };

    addSection("Patient Details");
    addLine("Name", demo.patientName);
    addLine("Age / Sex", demo.ageSex);
    addLine("Patient ID", demo.patientId);
    addLine("Ward / Bed", demo.wardBed);
    addLine("Unit", demo.unitName);
    addLine("Blood Group", demo.bloodGroup);
    addLine("Admission Date", d.admissionDate);
    addLine("Discharge Date", d.dischargeDate);
    addLine("Admission Type", d.admissionType);
    addLine("Treating Doctor", demo.treatingDoctor);

    addSection("Diagnosis");
    addLine("Final Diagnosis", diag.finalDiagnosis);
    addLine("Tumour Site", diag.tumourSite);
    addLine("Tumour Size", diag.tumourSize);
    addLine("Staging", diag.staging);
    addLine("Resection", diag.resection);
    if (d.stagingCommentary) {
      addSection("Clinical Staging Commentary");
      addPara(d.stagingCommentary);
    }

    addSection("Procedure Performed");
    addLine("Procedure", proc.procedureName);
    addLine("Date of Surgery", proc.surgeryDate);
    addLine("Primary Surgeon", proc.primarySurgeon);
    addLine("Approach", proc.approach);
    addLine("Laterality", proc.laterality);
    addLine("Anaesthesia", proc.anaesthesiaType);
    addLine("Intent", proc.intent);

    addSection("Operative Findings");
    addLine("Findings", find.findings);
    addLine("Intra-op Course", find.intraOpCourse);
    addLine("Blood Loss", find.bloodLoss);
    addLine("Specimens Sent", find.specimensSent);
    addLine("Frozen Section", find.frozenReport);

    if (Array.isArray(agg.investigations) && agg.investigations.length) {
      addSection("Key Investigations");
      agg.investigations.forEach(inv => {
        const val = `${inv.value}${inv.unit ? " " + inv.unit : ""}${inv.flag ? " (" + inv.flag + ")" : ""}`;
        addLine(inv.label, val);
      });
    }

    addSection("Course in Hospital");
    addPara(d.courseInHospital || "Not documented.");

    addSection("Complications");
    addLine("Intra-operative", comp.intraOp || "None");
    addLine("Post-operative", comp.postOp || (comp.postOpPresent === "No" ? "None" : ""));
    addLine("Details", comp.postOpDetails || comp.intraOpDetails);
    addLine("Clavien-Dindo", comp.clavienDindo);

    addSection("Condition at Discharge");
    addLine("Condition", d.conditionAtDischarge);
    addLine("Vitals", d.dischargeVitals);

    if (Array.isArray(d.dischargeMedications) && d.dischargeMedications.length) {
      addSection("Discharge Medications");
      d.dischargeMedications.forEach((m, i) => {
        const parts = [m.dose, m.route, m.frequency, m.duration].filter(Boolean).join(" · ");
        if (m.drug || parts) addLine(`${i + 1}. ${m.drug || ""}`.trim(), parts);
      });
    }

    addSection("Discharge Advice");
    addPara(d.dischargeAdvice || "As advised.");

    addSection("Follow-up Plan");
    addLine("Follow-up Date", d.followUpDate);
    addLine("Clinic / Dept", d.followUpClinic);
    addLine("Pending Reports", d.pendingReports);
    addLine("Adjuvant Plan", d.adjuvantPlan);

    addSection("Signature");
    addLine("Doctor", doctorName || demo.treatingDoctor);
    addLine("Date", new Date().toLocaleDateString());

    const safeName = (demo.patientName || "patient").replace(/[^a-z0-9]+/gi, "_");
    doc.save(`Discharge_Summary_${safeName}.pdf`);
  };

  // ── Render ──────────────────────────────────────────────────────────────────
  if (isLoading && !agg) {
    return (
      <Box sx={{ display: "flex", justifyContent: "center", alignItems: "center", p: 6 }}>
        <CircularProgress size={28} sx={{ color: C.black }} />
      </Box>
    );
  }

  const demo = agg?.demographics || {};
  const diag = agg?.diagnosis || {};
  const proc = agg?.procedure || {};
  const find = agg?.findings || {};
  const comp = agg?.complications || {};
  const investigations = agg?.investigations || [];

  return (
    <Box>
      {/* Header actions */}
      <Box sx={{ display: "flex", justifyContent: "space-between", alignItems: "center", mb: 2.5 }}>
        <Box>
          <Typography sx={{ fontSize: 18, fontFamily: FONT, fontWeight: FW_NORMAL }}>Discharge Summary</Typography>
          <Typography sx={{ fontSize: 12, fontFamily: FONT, color: C.textMuted }}>
            Auto-compiled from this booking. Review, complete the discharge fields, then save.
          </Typography>
        </Box>
        <Box sx={{ display: "flex", gap: 1 }}>
          <Button sx={outlineBtnSx} onClick={load} disabled={isLoading}>
            <RefreshRounded sx={{ mr: 0.5, fontSize: 16 }} /> Refresh
          </Button>
          <Button sx={outlineBtnSx} onClick={handleExportPDF}>
            <PictureAsPdfRounded sx={{ mr: 0.5, fontSize: 16 }} /> Download PDF
          </Button>
          <Button sx={saveBtnSx} onClick={handleSave} disabled={isSaving}>
            {isSaving ? <CircularProgress size={14} sx={{ mr: 1, color: C.white }} /> : <SaveRounded sx={{ mr: 0.5, fontSize: 16 }} />}
            Save
          </Button>
        </Box>
      </Box>

      {/* 1. Patient + Admission */}
      <SectionBox title="Patient & Admission Details">
        <FG cols={3}>
          <RO label="Patient Name" value={demo.patientName} />
          <RO label="Age / Sex" value={demo.ageSex} />
          <RO label="Patient ID" value={demo.patientId} />
          <RO label="Ward / Bed" value={demo.wardBed} />
          <RO label="Unit" value={demo.unitName} />
          <RO label="Blood Group" value={demo.bloodGroup} />
        </FG>
        <FG cols={3}>
          <TextField type="date" label="Admission Date" InputLabelProps={{ shrink: true }}
            value={d.admissionDate} onChange={e => set("admissionDate", e.target.value)} size="small" sx={inputSx} fullWidth />
          <TextField type="date" label="Discharge Date" InputLabelProps={{ shrink: true }}
            value={d.dischargeDate} onChange={e => set("dischargeDate", e.target.value)} size="small" sx={inputSx} fullWidth />
          <Sel label="Admission Type" options={["Elective", "Emergency", "Day Care"]}
            value={d.admissionType} onChange={v => set("admissionType", v)} />
        </FG>
      </SectionBox>

      {/* 2. Diagnosis (auto) */}
      <SectionBox title="Diagnosis">
        <ReadText label="Final Diagnosis" value={diag.finalDiagnosis} />
        <FG cols={3}>
          <RO label="Tumour Site" value={diag.tumourSite} />
          <RO label="Tumour Size" value={diag.tumourSize} />
          <RO label="Staging (TNM)" value={diag.staging} />
          <RO label="Resection Status" value={diag.resection} />
        </FG>
        {/* Three-stage staging infographic */}
        {(() => {
          const dn = bookingData?.doctors_note || bookingData?.fullBooking?.doctors_note || {};
          const mg = bookingData?.management || bookingData?.fullBooking?.management || agg?.staging_data?.management || {};
          const po = bookingData?.post_op || bookingData?.fullBooking?.post_op || agg?.staging_data?.post_op || {};

          const cT = dn.clinicalStagingT || ""; const cN = dn.clinicalStagingN || ""; const cM = dn.clinicalStagingM || "";
          const sT = mg.stagingT || ""; const sN = mg.stagingN || ""; const sM = mg.stagingM || "";
          const pT = po.pathStagingT || ""; const pN = po.pathStagingN || ""; const pM = po.pathStagingM || "";

          const hasStaging = (cT || cN || cM || sT || sN || sM || pT || pN || pM);
          if (!hasStaging) return null;

          const extractNum = (s) => { const m = String(s || "").match(/\d/); return m ? parseInt(m[0]) : null; };
          const getChange = (clinVal, intVal, pathVal) => {
            const ref = clinVal || intVal;
            const c = extractNum(ref); const p = extractNum(pathVal);
            if (p === null || c === null) return null;
            return p > c ? "up" : p < c ? "down" : "same";
          };
          const tChange = getChange(cT, sT, pT);
          const nChange = getChange(cN, sN, pN);

          const tNum = extractNum(cT || sT); const pTNum = extractNum(pT);
          const nNum = extractNum(cN || sN); const pNNum = extractNum(pN);
          let concordance = null;
          if (pTNum !== null || pNNum !== null) {
            const up = (pTNum !== null && tNum !== null && pTNum > tNum) || (pNNum !== null && nNum !== null && pNNum > nNum);
            const dn2 = (pTNum !== null && tNum !== null && pTNum < tNum) || (pNNum !== null && nNum !== null && pNNum < nNum);
            if (up) concordance = { label: "Upstaged", color: "#b91c1c", bg: "#fef2f2" };
            else if (dn2) concordance = { label: "Downstaged", color: "#15803d", bg: "#f0fdf4" };
            else concordance = { label: "Concordant", color: "#1d4ed8", bg: "#eff6ff" };
          }

          const chStyle = (ch) => ({
            "up":   { bg: "#fef2f2", border: "#b91c1c", text: "#b91c1c" },
            "down": { bg: "#f0fdf4", border: "#15803d", text: "#15803d" },
            "same": { bg: "#f8fafc", border: "#6b7280", text: "#374151" },
          }[ch] || { bg: "#fff", border: C.border, text: C.textPrimary });

          const TnmBadge = ({ prefix, val, change, showChange }) => {
            const s = showChange ? chStyle(change) : { bg: "#fff", border: C.border, text: C.textPrimary };
            return (
              <Box sx={{ textAlign: "center" }}>
                <Typography sx={{ fontSize: 8, fontFamily: FONT, color: C.textMuted, mb: 0.4, textTransform: "uppercase", letterSpacing: "0.06em" }}>{prefix}</Typography>
                <Box sx={{ width: 40, height: 40, display: "flex", alignItems: "center", justifyContent: "center", border: `2px solid ${s.border}`, background: s.bg, position: "relative" }}>
                  <Typography sx={{ fontSize: 13, fontFamily: "'Roboto Mono', monospace", fontWeight: "bold", color: val ? s.text : C.textMuted }}>
                    {val || "—"}
                  </Typography>
                  {showChange && change === "up" && <Box sx={{ position: "absolute", top: -9, right: -3, fontSize: 11, color: "#b91c1c", lineHeight: 1 }}>▲</Box>}
                  {showChange && change === "down" && <Box sx={{ position: "absolute", top: -9, right: -3, fontSize: 11, color: "#15803d", lineHeight: 1 }}>▼</Box>}
                </Box>
              </Box>
            );
          };

          const FactPill = ({ label, value, hi }) => {
            if (!value) return null;
            const pal = { danger: ["#fef2f2","#b91c1c"], success: ["#f0fdf4","#15803d"], warn: ["#fffbeb","#b45309"], neutral: ["#f3f4f6","#6b7280"] };
            const [bg, color] = pal[hi || "neutral"];
            return (
              <Box sx={{ display: "inline-flex", alignItems: "center", gap: 0.4, px: 0.9, py: 0.3, background: bg, border: `1px solid ${color}33`, mr: 0.75, mb: 0.5 }}>
                <Typography sx={{ fontSize: 9, fontFamily: FONT, color, fontWeight: FW_BOLD, textTransform: "uppercase", letterSpacing: "0.04em" }}>{label}</Typography>
                <Typography sx={{ fontSize: 9, fontFamily: FONT, color }}>{value}</Typography>
              </Box>
            );
          };

          const nodesPos = po.pathNodesPositive || ""; const nodesEx = po.pathNodesExamined || "";
          const hasHPR = po.pathResection || po.pathMarginStatus || po.pathLVI || po.pathPNI || po.pathGrade || nodesEx;

          return (
            <Box sx={{ mt: 2, border: `1px solid ${C.border}`, background: "#fff", overflow: "hidden" }}>
              {/* Header */}
              <Box sx={{ px: 2, py: 1, borderBottom: `1px solid ${C.border}`, display: "flex", alignItems: "center", justifyContent: "space-between", background: C.bgSecondary }}>
                <Typography sx={{ fontSize: 10, fontFamily: FONT, fontWeight: FW_BOLD, textTransform: "uppercase", letterSpacing: "0.12em" }}>Staging Journey</Typography>
                {concordance && (
                  <Box sx={{ display: "flex", alignItems: "center", gap: 0.75, px: 1.25, py: 0.3, background: concordance.bg, border: `1px solid ${concordance.color}` }}>
                    <Box sx={{ width: 6, height: 6, borderRadius: "50%", background: concordance.color }} />
                    <Typography sx={{ fontSize: 9, fontFamily: FONT, fontWeight: FW_BOLD, color: concordance.color, textTransform: "uppercase", letterSpacing: "0.08em" }}>{concordance.label}</Typography>
                  </Box>
                )}
              </Box>

              {/* Journey Flow */}
              <Box sx={{ display: "flex", alignItems: "center", px: 2, py: 2, gap: 0 }}>
                {/* Pre-Op */}
                <Box sx={{ flex: 1, textAlign: "center" }}>
                  <Box sx={{ pb: 0.5, mb: 1.5, borderBottom: "2px solid #1d4ed8", display: "inline-block", px: 0.75 }}>
                    <Typography sx={{ fontSize: 8, fontFamily: FONT, fontWeight: FW_BOLD, textTransform: "uppercase", color: "#1d4ed8", letterSpacing: "0.1em" }}>Pre-Op Clinical</Typography>
                    <Typography sx={{ fontSize: 7, fontFamily: FONT, color: "#3b82f6" }}>cTNM</Typography>
                  </Box>
                  <Box sx={{ display: "flex", justifyContent: "center", gap: 0.75 }}>
                    <TnmBadge prefix="T" val={cT} showChange={false} />
                    <TnmBadge prefix="N" val={cN} showChange={false} />
                    <TnmBadge prefix="M" val={cM} showChange={false} />
                  </Box>
                  {dn.clinicalStageGroup && (
                    <Box sx={{ mt: 0.75, display: "inline-block", px: 1.25, py: 0.25, background: "#eff6ff", border: "1px solid #1d4ed8" }}>
                      <Typography sx={{ fontSize: 10, fontFamily: FONT, fontWeight: FW_BOLD, color: "#1d4ed8" }}>Stage {dn.clinicalStageGroup}</Typography>
                    </Box>
                  )}
                  {!cT && !cN && !cM && <Typography sx={{ fontSize: 8, fontFamily: FONT, color: C.textMuted, fontStyle: "italic", mt: 0.75 }}>Doctors Note tab</Typography>}
                </Box>

                {/* Intra-Op Arrow */}
                <Box sx={{ display: "flex", flexDirection: "column", alignItems: "center", flexShrink: 0, mx: 0.5 }}>
                  <Typography sx={{ fontSize: 7, fontFamily: FONT, color: C.textMuted, mb: 0.4, textTransform: "uppercase", letterSpacing: "0.06em" }}>Intra-Op</Typography>
                  {(sT || sN || sM) && (
                    <Box sx={{ display: "flex", gap: 0.3, mb: 0.4 }}>
                      {sT && <Box sx={{ px: 0.5, py: 0.1, background: "#f3f4f6", border: `1px solid ${C.border}` }}><Typography sx={{ fontSize: 8, fontFamily: "'Roboto Mono', monospace", color: "#374151" }}>{sT}</Typography></Box>}
                      {sN && <Box sx={{ px: 0.5, py: 0.1, background: "#f3f4f6", border: `1px solid ${C.border}` }}><Typography sx={{ fontSize: 8, fontFamily: "'Roboto Mono', monospace", color: "#374151" }}>{sN}</Typography></Box>}
                      {sM && <Box sx={{ px: 0.5, py: 0.1, background: "#f3f4f6", border: `1px solid ${C.border}` }}><Typography sx={{ fontSize: 8, fontFamily: "'Roboto Mono', monospace", color: "#374151" }}>{sM}</Typography></Box>}
                    </Box>
                  )}
                  <Box sx={{ display: "flex", alignItems: "center" }}>
                    <Box sx={{ width: 22, height: 1.5, background: C.border }} />
                    <Box sx={{ fontSize: 14, color: C.border, lineHeight: 0.5, mx: -0.25 }}>▶</Box>
                    <Box sx={{ width: 22, height: 1.5, background: concordance ? concordance.color : C.border }} />
                  </Box>
                </Box>

                {/* Post-Op */}
                <Box sx={{ flex: 1, textAlign: "center" }}>
                  <Box sx={{ pb: 0.5, mb: 1.5, borderBottom: `2px solid ${concordance?.color || C.border}`, display: "inline-block", px: 0.75 }}>
                    <Typography sx={{ fontSize: 8, fontFamily: FONT, fontWeight: FW_BOLD, textTransform: "uppercase", color: concordance?.color || C.textMuted, letterSpacing: "0.1em" }}>Post-Op Pathological</Typography>
                    <Typography sx={{ fontSize: 7, fontFamily: FONT, color: concordance?.color || C.textMuted }}>pTNM · HPR</Typography>
                  </Box>
                  <Box sx={{ display: "flex", justifyContent: "center", gap: 0.75 }}>
                    <TnmBadge prefix="pT" val={pT} change={tChange} showChange={true} />
                    <TnmBadge prefix="pN" val={pN} change={nChange} showChange={true} />
                    <TnmBadge prefix="pM" val={pM} showChange={false} />
                  </Box>
                  {po.pathStageGroup && (
                    <Box sx={{ mt: 0.75, display: "inline-block", px: 1.25, py: 0.25, background: concordance?.bg || "#f3f4f6", border: `1px solid ${concordance?.color || C.border}` }}>
                      <Typography sx={{ fontSize: 10, fontFamily: FONT, fontWeight: FW_BOLD, color: concordance?.color || C.textPrimary }}>Stage {po.pathStageGroup}</Typography>
                    </Box>
                  )}
                  {!pT && !pN && !pM && <Typography sx={{ fontSize: 8, fontFamily: FONT, color: C.textMuted, fontStyle: "italic", mt: 0.75 }}>Awaiting HPR report</Typography>}
                </Box>
              </Box>

              {/* HPR Quick Facts */}
              {hasHPR && (
                <Box sx={{ borderTop: `1px solid ${C.border}`, px: 2, py: 1, background: C.bgSecondary }}>
                  <Typography sx={{ fontSize: 7.5, fontFamily: FONT, fontWeight: FW_BOLD, textTransform: "uppercase", color: C.textMuted, mb: 0.6, letterSpacing: "0.1em" }}>HPR Quick Facts</Typography>
                  <Box sx={{ display: "flex", flexWrap: "wrap" }}>
                    {(nodesPos || nodesEx) && <FactPill label="Nodes" value={`${nodesPos || "?"}/${nodesEx || "?"}`} hi={nodesPos && parseInt(nodesPos) > 0 ? "warn" : "success"} />}
                    <FactPill label="R" value={po.pathResection} hi={po.pathResection === "R0" ? "success" : po.pathResection ? "danger" : null} />
                    <FactPill label="Margins" value={po.pathMarginStatus} hi={po.pathMarginStatus === "Clear" ? "success" : po.pathMarginStatus === "Involved" ? "danger" : "neutral"} />
                    <FactPill label="LVI" value={po.pathLVI} hi={po.pathLVI === "Yes" ? "danger" : po.pathLVI === "No" ? "success" : "neutral"} />
                    <FactPill label="PNI" value={po.pathPNI} hi={po.pathPNI === "Yes" ? "danger" : po.pathPNI === "No" ? "success" : "neutral"} />
                    {po.pathGrade && <FactPill label="Grade" value={po.pathGrade.replace("Differentiated", "Diff.")} hi="neutral" />}
                  </Box>
                </Box>
              )}

              {/* LLM Staging Commentary */}
              <Box sx={{ borderTop: `1px solid ${C.border}`, px: 2, py: 1.5 }}>
                <Box sx={{ display: "flex", alignItems: "center", justifyContent: "space-between", mb: 1 }}>
                  <Typography sx={{ fontSize: 11, fontFamily: FONT, fontWeight: FW_BOLD, textTransform: "uppercase", letterSpacing: "0.06em", color: C.textMuted }}>Clinical Staging Commentary</Typography>
                  <Button
                    size="small"
                    onClick={async () => {
                      if (!currentBookingId) return;
                      setGenerating(p => ({ ...p, staging_commentary: true }));
                      try {
                        const res = await generateStagingCommentary(currentBookingId);
                        if (res?.status === "success" && res.data?.text) {
                          set("stagingCommentary", stripMarkdown(res.data.text));
                          notify("Commentary generated. Review and edit before saving.");
                        } else {
                          notify("No commentary returned. Please try again.");
                        }
                      } catch (err) {
                        notify("Failed to generate commentary.");
                      } finally {
                        setGenerating(p => ({ ...p, staging_commentary: false }));
                      }
                    }}
                    disabled={generating.staging_commentary}
                    sx={{ ...outlineBtnSx, mt: 0, py: 0.4, px: 1.5, fontSize: 10 }}
                  >
                    {generating.staging_commentary
                      ? <><CircularProgress size={12} sx={{ mr: 0.75 }} />Generating...</>
                      : <><AutoAwesomeRounded sx={{ fontSize: 13, mr: 0.5 }} />Generate Commentary</>}
                  </Button>
                </Box>
                <TextField
                  fullWidth multiline rows={4}
                  value={d.stagingCommentary || ""}
                  onChange={e => set("stagingCommentary", e.target.value)}
                  sx={inputSx}
                  placeholder="Click 'Generate Commentary' to get an AI-drafted clinical interpretation of the staging comparison, or type manually..."
                />
              </Box>
            </Box>
          );
        })()}
      </SectionBox>

      {/* 3. Procedure (auto) */}
      <SectionBox title="Procedure Performed">
        <FG cols={3}>
          <RO label="Procedure" value={proc.procedureName} />
          <RO label="Date of Surgery" value={proc.surgeryDate} />
          <RO label="Primary Surgeon" value={proc.primarySurgeon} />
          <RO label="Approach" value={proc.approach} />
          <RO label="Laterality" value={proc.laterality} />
          <RO label="Anaesthesia" value={proc.anaesthesiaType} />
          <RO label="Intent" value={proc.intent} />
        </FG>
      </SectionBox>

      {/* 4. Operative findings (auto) */}
      <SectionBox title="Operative Findings">
        <ReadText label="Findings" value={find.findings} />
        <FG cols={3}>
          <RO label="Intra-op Course" value={find.intraOpCourse} />
          <RO label="Blood Loss" value={find.bloodLoss} />
          <RO label="Specimens Sent (HPE)" value={find.specimensSent} />
        </FG>
        {find.frozenReport ? <ReadText label="Frozen Section Report" value={find.frozenReport} /> : null}
      </SectionBox>

      {/* 5. Investigations (auto) */}
      <SectionBox title="Key Investigations">
        {investigations.length === 0 ? (
          <Typography sx={{ fontSize: 12, fontFamily: FONT, color: C.textMuted }}>No lab results recorded for this booking.</Typography>
        ) : (
          <TableContainer>
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell sx={thSx}>Investigation</TableCell>
                  <TableCell sx={thSx}>Value</TableCell>
                  <TableCell sx={thSx}>Flag</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {investigations.map((inv, i) => (
                  <TableRow key={i}>
                    <TableCell sx={tdSx}>{inv.label}</TableCell>
                    <TableCell sx={tdSx}>{inv.value}{inv.unit ? ` ${inv.unit}` : ""}</TableCell>
                    <TableCell sx={{ ...tdSx, color: inv.flag && inv.flag !== "Normal" ? "red" : C.textMuted, fontWeight: inv.flag && inv.flag !== "Normal" ? FW_BOLD : FW_LIGHT }}>
                      {inv.flag || "—"}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>
        )}
        <CompletedInvestigationsPanel patientId={patientId} doctorId={doctorId} />
      </SectionBox>

      {/* 6. Course in Hospital (AI-draftable) */}
      <SectionBox title="Course in Hospital">
        <Box sx={{ display: "flex", justifyContent: "flex-end", mb: 1 }}>
          <Button sx={outlineBtnSx} onClick={() => draftNarrative("course_in_hospital", "courseInHospital")}
            disabled={generating.course_in_hospital}>
            {generating.course_in_hospital ? <CircularProgress size={14} sx={{ mr: 1, color: C.black }} /> : <AutoAwesomeRounded sx={{ mr: 0.5, fontSize: 16 }} />}
            Draft with AI
          </Button>
        </Box>
        <TextField multiline minRows={4} fullWidth placeholder="Peri-operative and post-operative course…"
          value={d.courseInHospital} onChange={e => set("courseInHospital", e.target.value)} size="small" sx={inputSx} />
      </SectionBox>

      {/* 7. Complications (auto) */}
      <SectionBox title="Complications">
        <FG cols={2}>
          <RO label="Intra-operative" value={comp.intraOp || "None"} />
          <RO label="Post-operative" value={comp.postOp || (comp.postOpPresent === "No" ? "None" : "")} />
          <RO label="Clavien-Dindo Grade" value={comp.clavienDindo} />
        </FG>
        {(comp.postOpDetails || comp.intraOpDetails) ? <ReadText label="Details" value={comp.postOpDetails || comp.intraOpDetails} /> : null}
      </SectionBox>

      {/* 8. Condition at discharge (new) */}
      <SectionBox title="Condition at Discharge">
        <RdoGroup label="Condition" options={CONDITION_OPTIONS} value={d.conditionAtDischarge} onChange={v => set("conditionAtDischarge", v)} />
        <TextField label="Vitals at Discharge (BP / PR / SpO₂ / Temp)" fullWidth
          value={d.dischargeVitals} onChange={e => set("dischargeVitals", e.target.value)} size="small" sx={{ ...inputSx, mt: 1.5 }} />
      </SectionBox>

      {/* 9. Discharge medications (new) */}
      <SectionBox title="Discharge Medications">
        <TableContainer>
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell sx={thSx}>Drug</TableCell>
                <TableCell sx={thSx}>Dose</TableCell>
                <TableCell sx={thSx}>Route</TableCell>
                <TableCell sx={thSx}>Frequency</TableCell>
                <TableCell sx={thSx}>Duration</TableCell>
                <TableCell sx={{ ...thSx, width: 48 }} />
              </TableRow>
            </TableHead>
            <TableBody>
              {d.dischargeMedications.length === 0 ? (
                <TableRow>
                  <TableCell sx={{ ...tdSx, color: C.textMuted }} colSpan={6}>No medications added.</TableCell>
                </TableRow>
              ) : d.dischargeMedications.map((m, i) => (
                <TableRow key={i}>
                  <TableCell sx={{ ...tdSx, minWidth: 160 }}>
                    <TextField value={m.drug} onChange={e => setMed(i, "drug", e.target.value)} placeholder="Drug name" size="small" sx={inputSx} fullWidth />
                  </TableCell>
                  <TableCell sx={tdSx}>
                    <TextField value={m.dose} onChange={e => setMed(i, "dose", e.target.value)} placeholder="e.g. 500 mg" size="small" sx={inputSx} fullWidth />
                  </TableCell>
                  <TableCell sx={{ ...tdSx, minWidth: 110 }}>
                    <Sel label="" options={MED_ROUTES} value={m.route} onChange={v => setMed(i, "route", v)} />
                  </TableCell>
                  <TableCell sx={{ ...tdSx, minWidth: 110 }}>
                    <Sel label="" options={MED_FREQUENCIES} value={m.frequency} onChange={v => setMed(i, "frequency", v)} />
                  </TableCell>
                  <TableCell sx={tdSx}>
                    <TextField value={m.duration} onChange={e => setMed(i, "duration", e.target.value)} placeholder="e.g. 5 days" size="small" sx={inputSx} fullWidth />
                  </TableCell>
                  <TableCell sx={tdSx}>
                    <IconButton size="small" onClick={() => removeMed(i)}><DeleteRounded sx={{ fontSize: 18 }} /></IconButton>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>
        <Button sx={{ ...outlineBtnSx, mt: 1.5 }} onClick={addMed}>
          <AddRounded sx={{ mr: 0.5, fontSize: 16 }} /> Add Medication
        </Button>
      </SectionBox>

      {/* 10. Discharge advice (AI-draftable) */}
      <SectionBox title="Discharge Advice">
        <Box sx={{ display: "flex", justifyContent: "flex-end", mb: 1 }}>
          <Button sx={outlineBtnSx} onClick={() => draftNarrative("discharge_advice", "dischargeAdvice")}
            disabled={generating.discharge_advice}>
            {generating.discharge_advice ? <CircularProgress size={14} sx={{ mr: 1, color: C.black }} /> : <AutoAwesomeRounded sx={{ mr: 0.5, fontSize: 16 }} />}
            Draft with AI
          </Button>
        </Box>
        <TextField multiline minRows={4} fullWidth placeholder="Diet, wound care, activity, warning signs, when to return…"
          value={d.dischargeAdvice} onChange={e => set("dischargeAdvice", e.target.value)} size="small" sx={inputSx} />
      </SectionBox>

      {/* 11. Follow-up plan (new) */}
      <SectionBox title="Follow-up Plan">
        <FG cols={2}>
          <TextField type="date" label="Follow-up Date" InputLabelProps={{ shrink: true }}
            value={d.followUpDate} onChange={e => set("followUpDate", e.target.value)} size="small" sx={inputSx} fullWidth />
          <TextField label="Clinic / Department" value={d.followUpClinic}
            onChange={e => set("followUpClinic", e.target.value)} size="small" sx={inputSx} fullWidth />
        </FG>
        <TextField label="Pending Reports (e.g. final histopathology)" fullWidth
          value={d.pendingReports} onChange={e => set("pendingReports", e.target.value)} size="small" sx={{ ...inputSx, mb: 1.5 }} />
        <TextField label="Planned Adjuvant Therapy" multiline minRows={2} fullWidth
          value={d.adjuvantPlan} onChange={e => set("adjuvantPlan", e.target.value)} size="small" sx={inputSx} />
      </SectionBox>

      {/* Signature */}
      <SectionBox title="Signature">
        <FG cols={2}>
          <RO label="Treating Doctor" value={doctorName || demo.treatingDoctor} />
          <RO label="Date" value={new Date().toLocaleDateString()} />
        </FG>
      </SectionBox>

      <Box sx={{ display: "flex", justifyContent: "flex-end", gap: 1, mt: 1 }}>
        <Button sx={outlineBtnSx} onClick={handleExportPDF}>
          <PictureAsPdfRounded sx={{ mr: 0.5, fontSize: 16 }} /> Download PDF
        </Button>
        <Button sx={saveBtnSx} onClick={handleSave} disabled={isSaving}>
          {isSaving ? <CircularProgress size={14} sx={{ mr: 1, color: C.white }} /> : <SaveRounded sx={{ mr: 0.5, fontSize: 16 }} />}
          Save Discharge Summary
        </Button>
      </Box>

      <Snackbar open={snackbar.open} autoHideDuration={4000}
        onClose={() => setSnackbar(p => ({ ...p, open: false }))}
        anchorOrigin={{ vertical: "top", horizontal: "center" }}>
        <Box sx={{ background: C.black, color: C.white, px: 3, py: 1.5, display: "flex", alignItems: "center", gap: 2, boxShadow: "0 8px 24px rgba(0,0,0,0.3)", minWidth: 300, justifyContent: "space-between" }}>
          <Typography sx={{ fontFamily: FONT, fontSize: 13, fontWeight: FW_LIGHT }}>{snackbar.message}</Typography>
          <IconButton size="small" onClick={() => setSnackbar(p => ({ ...p, open: false }))} sx={{ color: C.white, p: 0.5 }}><CloseRounded fontSize="small" /></IconButton>
        </Box>
      </Snackbar>
    </Box>
  );
};

export default DischargeSummaryTab;
