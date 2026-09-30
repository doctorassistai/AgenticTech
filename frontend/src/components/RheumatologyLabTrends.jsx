import React, { useState, useEffect, useCallback, useMemo } from "react";
import { Box, Typography, Chip } from "@mui/material";
import {
  RefreshRounded,
  AutoAwesomeRounded,
  SaveRounded,
  AddRounded,
  DeleteOutlineRounded,
  TrendingUpRounded,
  TrendingDownRounded,
  TrendingFlatRounded,
  ShowChartRounded,
  ScienceRounded,
  PictureAsPdfRounded,
} from "@mui/icons-material";
import jsPDF from "jspdf";
import { THEMES } from "../dashboard/themes";
import { announceRheumContextUpdate, subscribeRheumContextUpdate } from "../dashboard/rheumatologyContextBus";

const API_BASE_URL = import.meta.env.VITE_BACKEND_URL;

const themeName = localStorage.getItem("theme") || "PurpleWhite";
const theme = THEMES[themeName] || THEMES.PurpleWhite;
const FONT = '"Open Sans", sans-serif';
const FW = 300;

const C = {
  white: theme.bg, ghost: theme.bgAlt, fog: theme.bgTert,
  black: theme.text, ink: theme.text, charcoal: theme.textSec,
  smoke: theme.textSec, ash: theme.textMuted, silver: theme.textMuted,
  mist: theme.border, border: theme.borderStr,
};

const os = (extra = {}) => ({ fontFamily: FONT, fontWeight: FW, ...extra });
const card = { background: C.white, border: `1px solid ${C.fog}`, borderRadius: "4px", boxShadow: "0 1px 3px rgba(0,0,0,0.06)" };

const actionButton = {
  px: 2.5, py: 1.1, borderRadius: "2px", fontSize: 12, fontWeight: 400,
  fontFamily: FONT, textTransform: "none", letterSpacing: "0.06em",
  background: C.black, color: C.white, border: "none", cursor: "pointer",
  display: "flex", alignItems: "center", justifyContent: "center", gap: 0.75,
  transition: "background 0.18s ease",
  "&:hover": { background: C.charcoal }, "&:disabled": { opacity: 0.4, cursor: "not-allowed" },
};

const inputSx = {
  width: "100%", padding: "9px 12px", border: `1px solid ${C.mist}`,
  borderRadius: "2px", background: C.white, fontFamily: FONT, fontSize: "13px",
  fontWeight: 300, color: C.ink, outline: "none", boxSizing: "border-box",
};

const DIRECTION_META = {
  rising: { icon: TrendingUpRounded, color: "#b3261e", label: "Rising" },
  falling: { icon: TrendingDownRounded, color: "#2e7d32", label: "Falling" },
  stable: { icon: TrendingFlatRounded, color: C.charcoal, label: "Stable" },
  fluctuating: { icon: ShowChartRounded, color: "#8a6d00", label: "Fluctuating" },
};

// Minimal inline sparkline — no chart library dependency.
const Sparkline = ({ values = [], color = C.charcoal, width = 220, height = 48 }) => {
  if (!values.length) return null;
  const nums = values.map((v) => v.value);
  const min = Math.min(...nums), max = Math.max(...nums);
  const range = max - min || 1;
  const pad = 6;
  const stepX = values.length > 1 ? (width - pad * 2) / (values.length - 1) : 0;
  const points = values.map((v, i) => {
    const x = pad + i * stepX;
    const y = height - pad - ((v.value - min) / range) * (height - pad * 2);
    return `${x},${y}`;
  }).join(" ");
  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`}>
      <polyline points={points} fill="none" stroke={color} strokeWidth="1.75" strokeLinejoin="round" strokeLinecap="round" />
      {values.map((v, i) => {
        const x = pad + i * stepX;
        const y = height - pad - ((v.value - min) / range) * (height - pad * 2);
        return <circle key={i} cx={x} cy={y} r={2.25} fill={color} />;
      })}
    </svg>
  );
};

// ─── Patient-facing PDF: "additional tests to take" table ──────────────────
// Deliberately scoped to suggested_tests only (not the full lab history or
// trend narratives) — this is meant to be handed to the patient as a simple
// "go get these done" sheet, not a clinical record.
const generateSuggestedTestsPDF = ({ suggestedTests, advisoryNote, patientName }) => {
  if (!suggestedTests || suggestedTests.length === 0) return;

  const doc = new jsPDF("p", "mm", "a4");
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const marginX = 14, marginY = 18;
  const usableWidth = pageWidth - marginX * 2;
  let y = marginY;

  // Header
  doc.setFont("helvetica", "bold"); doc.setFontSize(18);
  doc.text("DoctorAssist.ai Hospital", marginX, y);
  doc.setFontSize(10); doc.setFont("helvetica", "normal");
  doc.text("Recommended Additional Lab Tests", marginX, y + 6);
  doc.setDrawColor(0, 0, 0); doc.setLineWidth(0.5);
  doc.line(marginX, y + 10, pageWidth - marginX, y + 10);
  y += 16;

  // Patient / date box
  const boxHeight = 16;
  doc.rect(marginX, y, usableWidth, boxHeight);
  doc.setFont("helvetica", "bold");
  doc.text("Patient Name:", marginX + 4, y + 6.5);
  doc.text("Date:", marginX + usableWidth / 2 + 4, y + 6.5);
  doc.setFont("helvetica", "normal");
  doc.text(patientName || "—", marginX + 32, y + 6.5);
  doc.text(new Date().toLocaleDateString(), marginX + usableWidth / 2 + 20, y + 6.5);
  y += boxHeight + 8;

  doc.setFont("helvetica", "bold"); doc.setFontSize(11);
  doc.text("Please arrange to have the following tests done:", marginX, y);
  y += 8;

  const ensureSpace = (h) => { if (y + h > pageHeight - 25) { doc.addPage(); y = marginY; } };

  // Table: Test | Reason | Urgency | Last Recorded
  const colWidths = [42, usableWidth - 42 - 30 - 40, 30, 40];
  const headers = ["Test", "Reason", "Urgency", "Last Recorded"];
  const padding = 2, lineHeight = 5;

  ensureSpace(10);
  let x = marginX;
  doc.setFont("helvetica", "bold"); doc.setFontSize(9);
  headers.forEach((h, i) => {
    doc.rect(x, y, colWidths[i], 8);
    doc.text(h, x + padding, y + 5.5);
    x += colWidths[i];
  });
  y += 8;
  doc.setFont("helvetica", "normal");

  suggestedTests.forEach((t) => {
    const urgencyLabel = t.urgency === "consider_soon" ? "Consider soon" : "Routine";
    const lastRecorded = t.last_recorded
      ? `${t.last_recorded.value} ${t.unit || ""} on ${t.last_recorded.date}`.trim()
      : "Not previously recorded";

    const cells = [t.test_name || "", t.reason || "", urgencyLabel, lastRecorded];
    const heights = cells.map((cell, i) => doc.splitTextToSize(String(cell), colWidths[i] - padding * 2).length);
    const rowHeight = Math.max(...heights) * lineHeight + padding * 2;
    ensureSpace(rowHeight);

    let colX = marginX;
    cells.forEach((cell, i) => {
      doc.rect(colX, y, colWidths[i], rowHeight);
      const lines = doc.splitTextToSize(String(cell), colWidths[i] - padding * 2);
      doc.text(lines, colX + padding, y + padding + lineHeight - 1);
      colX += colWidths[i];
    });
    y += rowHeight;
  });

  y += 6;

  if (advisoryNote) {
    ensureSpace(20);
    doc.setFont("helvetica", "bold"); doc.setFontSize(10);
    doc.text("Also worth noting:", marginX, y);
    y += 6;
    doc.setFont("helvetica", "normal"); doc.setFontSize(10);
    const lines = doc.splitTextToSize(advisoryNote, usableWidth);
    doc.text(lines, marginX, y);
    y += lines.length * 5 + 4;
  }

  ensureSpace(30);
  doc.line(pageWidth - 80, y + 20, pageWidth - 20, y + 20);
  doc.setFontSize(9);
  doc.text("Doctor Signature", pageWidth - 78, y + 26);

  const pages = doc.getNumberOfPages();
  for (let i = 1; i <= pages; i++) {
    doc.setPage(i);
    doc.setFontSize(9);
    doc.text(`Generated on ${new Date().toLocaleString()} • Page ${i} of ${pages}`, pageWidth / 2, pageHeight - 10, { align: "center" });
  }

  const fileSafeName = (patientName || "Patient").replace(/\s+/g, "_");
  doc.save(`${fileSafeName}_Suggested_Lab_Tests.pdf`);
};

export default function RheumatologyLabTrends({ doctorId, patientId, patientName }) {
  const [catalog, setCatalog] = useState({});
  const [results, setResults] = useState([]);
  const [series, setSeries] = useState({});
  const [loadingResults, setLoadingResults] = useState(false);

  const [testName, setTestName] = useState("");
  const [value, setValue] = useState("");
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [notes, setNotes] = useState("");
  const [adding, setAdding] = useState(false);
  const [addError, setAddError] = useState("");

  const [trends, setTrends] = useState([]);
  const [skippedTests, setSkippedTests] = useState([]);
  const [analyzing, setAnalyzing] = useState(false);
  const [analyzeError, setAnalyzeError] = useState("");

  const [suggestedTests, setSuggestedTests] = useState([]);
  const [advisoryNote, setAdvisoryNote] = useState("");
  const [suggesting, setSuggesting] = useState(false);
  const [suggestError, setSuggestError] = useState("");
  const [hasSuggested, setHasSuggested] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState("");

  const loadResults = useCallback(async () => {
    if (!patientId || !doctorId) return;
    setLoadingResults(true);
    try {
      const res = await fetch(`${API_BASE_URL}hms/users/data/context/rheumatology-labs/results/${patientId}/${doctorId}`);
      const json = await res.json();
      if (json?.status === "success") {
        setResults(json.results || []);
        setSeries(json.series || {});
        setCatalog(json.catalog || {});
      }
    } catch (err) {
      console.error("Failed to load lab results:", err);
    } finally {
      setLoadingResults(false);
    }
  }, [patientId, doctorId]);

  useEffect(() => {
    loadResults();
    return subscribeRheumContextUpdate(loadResults);
  }, [loadResults]);

  const testOptions = useMemo(() => Object.keys(catalog).sort(), [catalog]);

  const handleAddResult = async () => {
    setAddError("");
    if (!testName || value === "") { setAddError("Select a test and enter a value."); return; }
    setAdding(true);
    try {
      const res = await fetch(`${API_BASE_URL}hms/users/data/context/rheumatology-labs/add-result`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ patient_id: patientId, doctor_id: doctorId, test_name: testName, value: Number(value), date, notes }),
      });
      const json = await res.json();
      if (!res.ok || json?.status !== "success") throw new Error(json?.detail || "Failed to add result");
      setValue(""); setNotes("");
      await loadResults();
      announceRheumContextUpdate("lab-trends");
    } catch (err) {
      console.error("Add lab result failed:", err);
      setAddError(err.message || "Failed to add result");
    } finally {
      setAdding(false);
    }
  };

  const handleDeleteResult = async (resultId) => {
    try {
      await fetch(`${API_BASE_URL}hms/users/data/context/rheumatology-labs/result/${resultId}`, { method: "DELETE" });
      await loadResults();
      announceRheumContextUpdate("lab-trends");
    } catch (err) {
      console.error("Delete lab result failed:", err);
    }
  };

  const handleSuggestTests = useCallback(async () => {
    setSuggesting(true);
    setSuggestError("");
    try {
      const res = await fetch(`${API_BASE_URL}hms/users/data/context/rheumatology-labs/suggest-tests`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ doctor_id: doctorId, patient_id: patientId }),
      });
      const json = await res.json();
      if (!res.ok || json?.status !== "success") throw new Error(json?.detail || "Failed to get suggestions");
      setSuggestedTests(json.finaloutput?.suggested_tests || []);
      setAdvisoryNote(json.finaloutput?.advisory_note || "");
      setHasSuggested(true);
    } catch (err) {
      console.error("Suggest tests failed:", err);
      setSuggestError(err.message || "Failed to get suggestions");
    } finally {
      setSuggesting(false);
    }
  }, [doctorId, patientId]);

  // "Analyze Trends" now also surfaces suggested additional tests in the same
  // click — a doctor no longer has to press two separate buttons to get both
  // the trend read and the "what else should this patient get tested for" read.
  const handleAnalyze = async () => {
    setAnalyzing(true);
    setAnalyzeError("");
    try {
      const res = await fetch(`${API_BASE_URL}hms/users/data/context/rheumatology-labs/analyze-trends`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ doctor_id: doctorId, patient_id: patientId }),
      });
      const json = await res.json();
      if (!res.ok || json?.status !== "success") throw new Error(json?.detail || "Failed to analyze trends");
      setTrends(json.finaloutput?.trends || []);
      setSkippedTests(json.skipped_tests || []);
    } catch (err) {
      console.error("Trend analysis failed:", err);
      setAnalyzeError(err.message || "Failed to analyze trends");
    } finally {
      setAnalyzing(false);
    }
    // Fire after the trend try/catch/finally above, with its own independent
    // loading + error state (suggesting / suggestError) so a suggestion
    // failure is never reported as a trend-analysis failure.
    await handleSuggestTests();
  };

  const updateTrendNarrative = (idx, text) => {
    setTrends((prev) => { const t = [...prev]; t[idx] = { ...t[idx], narrative: text }; return t; });
  };

  const handleSaveAnalysis = async () => {
    if (trends.length === 0) return;
    setSaving(true);
    setSaveMsg("");
    try {
      const res = await fetch(`${API_BASE_URL}hms/users/data/context/rheumatology-labs/save-analysis`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ patient_id: patientId, doctor_id: doctorId, trends }),
      });
      const json = await res.json();
      if (!res.ok || json?.status !== "success") throw new Error(json?.detail || json?.message || "Save failed");
      setSaveMsg("✅ Trend analysis saved");
      window.dispatchEvent(new Event("refreshRheumatologyLabTrendHistory"));
      announceRheumContextUpdate("lab-trends");
    } catch (err) {
      console.error("Save trend analysis failed:", err);
      setSaveMsg(`❌ ${err.message || "Save failed"}`);
    } finally {
      setSaving(false);
      setTimeout(() => setSaveMsg(""), 3000);
    }
  };

  const handleGeneratePDF = () => {
    generateSuggestedTestsPDF({ suggestedTests, advisoryNote, patientName });
  };

  return (
    <Box sx={{ ...card, overflow: "hidden" }}>
      <Box sx={{ px: 3, py: 2.5, borderBottom: `1px solid ${C.fog}`, background: C.ghost, display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 1.5 }}>
        <Box>
          <Typography sx={{ ...os({ fontSize: 14, color: C.ink, letterSpacing: "0.02em" }) }}>Lab Trend Intelligence</Typography>
          <Typography sx={{ ...os({ fontSize: 11, color: C.ash, mt: 0.4 }) }}>
            {patientName ? `Longitudinal lab trajectories — ${patientName}` : "Longitudinal lab trajectories"}
          </Typography>
        </Box>
        <Chip label="Module 5 · Lab Trends" size="small" sx={{ background: C.black, color: C.white, fontWeight: 300, fontSize: 10, letterSpacing: "0.04em", borderRadius: "2px", height: 22 }} />
      </Box>

      {/* Add result */}
      <Box sx={{ px: 3, pt: 2.5 }}>
        <Typography sx={{ ...os({ fontSize: 10, color: C.ash, textTransform: "uppercase", letterSpacing: "0.07em", mb: 0.75 }) }}>Add Lab Result</Typography>
        <Box sx={{ display: "flex", gap: 1.25, flexWrap: "wrap", alignItems: "flex-end" }}>
          <Box sx={{ minWidth: 220, flex: "1 1 220px" }}>
            <select value={testName} onChange={(e) => setTestName(e.target.value)} style={inputSx}>
              <option value="">Select test…</option>
              {testOptions.map((t) => <option key={t} value={t}>{t} ({catalog[t]})</option>)}
            </select>
          </Box>
          <Box sx={{ width: 120 }}>
            <input type="number" placeholder="Value" value={value} onChange={(e) => setValue(e.target.value)} style={inputSx} />
          </Box>
          <Box sx={{ width: 155 }}>
            <input type="date" value={date} onChange={(e) => setDate(e.target.value)} style={inputSx} />
          </Box>
          <Box sx={{ minWidth: 180, flex: "1 1 180px" }}>
            <input type="text" placeholder="Notes (optional)" value={notes} onChange={(e) => setNotes(e.target.value)} style={inputSx} />
          </Box>
          <Box component="button" type="button" onClick={handleAddResult} disabled={adding}
            sx={{ ...actionButton, minWidth: 110, height: 38, py: 0 }}>
            <AddRounded sx={{ fontSize: 16 }} /> Add
          </Box>
        </Box>
        {addError && <Typography sx={{ ...os({ fontSize: 12, color: "#b3261e", mt: 1 }) }}>{addError}</Typography>}
      </Box>

      {/* Results table */}
      <Box sx={{ px: 3, pt: 3 }}>
        <Box sx={{ display: "flex", alignItems: "center", justifyContent: "space-between", mb: 1 }}>
          <Typography sx={{ ...os({ fontSize: 10, color: C.ash, textTransform: "uppercase", letterSpacing: "0.07em" }) }}>Recorded Results</Typography>
          <Box
            component="button"
            type="button"
            onClick={loadResults}
            disabled={loadingResults}
            title="Refresh results"
            sx={{
              border: "none", background: "transparent", cursor: "pointer",
              color: C.ash, display: "flex", alignItems: "center", p: 0.5,
              "&:hover": { color: C.charcoal }, "&:disabled": { cursor: "not-allowed", opacity: 0.6 },
            }}
          >
            <RefreshRounded sx={{ fontSize: 14, animation: loadingResults ? "spin 1s linear infinite" : "none" }} />
          </Box>
        </Box>
        {results.length === 0 ? (
          <Typography sx={{ ...os({ fontSize: 12, color: C.silver, py: 1.5 }) }}>No lab results recorded yet.</Typography>
        ) : (
          <Box sx={{ border: `1px solid ${C.fog}`, borderRadius: "4px", overflow: "hidden", maxHeight: 260, overflowY: "auto" }}>
            {results.map((r) => (
              <Box key={r._id} sx={{ display: "flex", alignItems: "center", justifyContent: "space-between", px: 1.5, py: 1, borderBottom: `1px solid ${C.fog}`, "&:last-child": { borderBottom: "none" }, "&:hover": { background: C.ghost } }}>
                <Box sx={{ display: "flex", alignItems: "center", gap: 1.5, flexWrap: "wrap" }}>
                  <Typography sx={{ ...os({ fontSize: 12, color: C.ink, minWidth: 160 }) }}>{r.test_name}</Typography>
                  <Typography sx={{ ...os({ fontSize: 12, color: C.charcoal }) }}>{r.value} {r.unit}</Typography>
                  <Typography sx={{ ...os({ fontSize: 11, color: C.ash }) }}>{r.date}</Typography>
                  {r.source === "auto_extracted" && (
                    <Chip
                      label="Auto-extracted"
                      size="small"
                      sx={{ fontSize: 9.5, height: 18, background: `${C.charcoal}18`, color: C.charcoal, fontWeight: 400 }}
                    />
                  )}
                  {r.notes && <Typography sx={{ ...os({ fontSize: 11, color: C.silver, fontStyle: "italic" }) }}>{r.notes}</Typography>}
                </Box>
                <Box component="button" type="button" onClick={() => handleDeleteResult(r._id)}
                  sx={{ border: "none", background: "transparent", cursor: "pointer", color: C.silver, display: "flex", "&:hover": { color: "#b3261e" } }}>
                  <DeleteOutlineRounded sx={{ fontSize: 16 }} />
                </Box>
              </Box>
            ))}
          </Box>
        )}
      </Box>

      {/* Analyze trends (now also fetches suggested tests) */}
      <Box sx={{ px: 3, pt: 3, pb: 1 }}>
        {analyzeError && <Typography sx={{ ...os({ fontSize: 12, color: "#b3261e", mb: 1 }) }}>{analyzeError}</Typography>}
        <Box sx={{ display: "flex", justifyContent: "flex-end" }}>
          <Box component="button" type="button" onClick={handleAnalyze} disabled={analyzing || results.length === 0} sx={{ ...actionButton, minWidth: 220 }}>
            {(analyzing || suggesting) ? <RefreshRounded sx={{ fontSize: 15, animation: "spin 1s linear infinite" }} /> : <AutoAwesomeRounded sx={{ fontSize: 15 }} />}
            {analyzing ? "Analyzing..." : suggesting ? "Checking suggested tests..." : "Analyze Trends"}
          </Box>
        </Box>
      </Box>

     {skippedTests.length > 0 && (
        <Box sx={{ mx: 3, mb: 1 }}>
          <Typography sx={{ ...os({ fontSize: 11, color: C.silver }) }}>
            Skipped (need 2+ results to trend): {skippedTests.join(", ")}
          </Typography>
        </Box>
      )}

      {/* Suggest additional tests — still available standalone for re-running
          without re-analyzing trends */}
      <Box sx={{ px: 3, pt: 1, pb: 1 }}>
        {suggestError && <Typography sx={{ ...os({ fontSize: 12, color: "#b3261e", mb: 1 }) }}>{suggestError}</Typography>}
        <Box sx={{ display: "flex", justifyContent: "flex-end", gap: 1 }}>
          <Box component="button" type="button" onClick={handleSuggestTests} disabled={suggesting} sx={{ ...actionButton, minWidth: 220, background: "transparent", color: C.charcoal, border: `1px solid ${C.mist}` }}>
            {suggesting ? <RefreshRounded sx={{ fontSize: 15, animation: "spin 1s linear infinite" }} /> : <ScienceRounded sx={{ fontSize: 15 }} />}
            {suggesting ? "Reviewing..." : "Suggest Additional Tests"}
          </Box>
          <Box
            component="button"
            type="button"
            onClick={handleGeneratePDF}
            disabled={suggestedTests.length === 0}
            title={suggestedTests.length === 0 ? "Suggest additional tests first" : "Generate a patient-facing PDF"}
            sx={{ ...actionButton, minWidth: 190 }}
          >
            <PictureAsPdfRounded sx={{ fontSize: 15 }} /> Generate Patient PDF
          </Box>
        </Box>
      </Box>

      {hasSuggested && (
        <Box sx={{ mx: 3, mb: 2 }}>
          {suggestedTests.length === 0 && !advisoryNote && (
            <Typography sx={{ ...os({ fontSize: 12, color: C.silver, py: 1 }) }}>
              No additional tests stand out right now based on recorded data and history.
            </Typography>
          )}
          {suggestedTests.map((s, idx) => (
            <Box key={`${s.test_name}-${idx}`} sx={{ border: `1px solid ${C.fog}`, borderRadius: "4px", p: 1.5, mb: 1, display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 1.5, flexWrap: "wrap" }}>
              <Box sx={{ flex: "1 1 260px" }}>
                <Box sx={{ display: "flex", alignItems: "center", gap: 1, mb: 0.5 }}>
                  <Typography sx={{ ...os({ fontSize: 12.5, color: C.ink }) }}>{s.test_name}</Typography>
                  <Chip
                    label={s.urgency === "consider_soon" ? "Consider soon" : "Routine"}
                    size="small"
                    sx={{
                      fontSize: 9.5, height: 18,
                      background: s.urgency === "consider_soon" ? "#8a6d0018" : `${C.charcoal}18`,
                      color: s.urgency === "consider_soon" ? "#8a6d00" : C.charcoal,
                    }}
                  />
                </Box>
                <Typography sx={{ ...os({ fontSize: 12, color: C.charcoal }) }}>{s.reason}</Typography>
                {s.last_recorded && (
                  <Typography sx={{ ...os({ fontSize: 10.5, color: C.silver, mt: 0.5 }) }}>
                    Last recorded: {s.last_recorded.value} {s.unit} on {s.last_recorded.date}
                    {s.last_recorded.days_ago != null && ` (${s.last_recorded.days_ago}d ago)`}
                  </Typography>
                )}
              </Box>
              <Box
                component="button"
                type="button"
                onClick={() => { setTestName(s.test_name); }}
                sx={{ ...actionButton, minWidth: 100, py: 0.75, fontSize: 11 }}
              >
                <AddRounded sx={{ fontSize: 14 }} /> Add
              </Box>
            </Box>
          ))}
          {advisoryNote && (
            <Box sx={{ p: 1.5, borderRadius: "4px", background: C.ghost, border: `1px solid ${C.fog}` }}>
              <Typography sx={{ ...os({ fontSize: 10, color: C.silver, textTransform: "uppercase", letterSpacing: "0.07em", mb: 0.5 }) }}>Also worth noting (outside this module)</Typography>
              <Typography sx={{ ...os({ fontSize: 12, color: C.charcoal }) }}>{advisoryNote}</Typography>
            </Box>
          )}
        </Box>
      )}

      {/* Trend cards */}
      {trends.length > 0 && (
        <Box sx={{ p: { xs: 2, sm: 3 }, display: "grid", gridTemplateColumns: { xs: "1fr", md: "repeat(2, 1fr)" }, gap: 2 }}>
          {trends.map((t, idx) => {
            const meta = DIRECTION_META[t.direction] || DIRECTION_META.stable;
            const Icon = meta.icon;
            return (
              <Box key={`${t.test_name}-${idx}`} sx={{ border: `1px solid ${C.fog}`, borderRadius: "4px", p: 2 }}>
                <Box sx={{ display: "flex", alignItems: "center", justifyContent: "space-between", mb: 1 }}>
                  <Box sx={{ display: "flex", alignItems: "center", gap: 0.75 }}>
                    <Icon sx={{ fontSize: 17, color: meta.color }} />
                    <Typography sx={{ ...os({ fontSize: 13, color: C.ink }) }}>{t.test_name}</Typography>
                  </Box>
                  <Chip label={meta.label} size="small" sx={{ fontSize: 9.5, height: 18, background: `${meta.color}18`, color: meta.color }} />
                </Box>
                <Sparkline values={t.values} color={meta.color} />
                <textarea
                  value={t.narrative}
                  onChange={(e) => updateTrendNarrative(idx, e.target.value)}
                  style={{ ...inputSx, minHeight: 50, fontSize: 12, resize: "vertical", marginTop: 8 }}
                />
              </Box>
            );
          })}
        </Box>
      )}

      {/* Footer */}
      <Box sx={{ px: 3, py: 2, borderTop: `1px solid ${C.fog}`, background: C.ghost, display: "flex", alignItems: "center", justifyContent: "flex-end", gap: 1.5 }}>
        {saveMsg && <Typography sx={{ ...os({ fontSize: 12, color: saveMsg.includes("✅") ? "#2e7d32" : "#d32f2f" }) }}>{saveMsg}</Typography>}
        <Box component="button" type="button" onClick={handleSaveAnalysis} disabled={saving || trends.length === 0} sx={{ ...actionButton, minWidth: 180 }}>
          <SaveRounded sx={{ fontSize: 15 }} /> {saving ? "Saving..." : "Save Trend Analysis"}
        </Box>
      </Box>

      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </Box>
  );
}