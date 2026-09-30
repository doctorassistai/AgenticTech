import React, { useState, useEffect, useCallback } from "react";
import { Box, Typography, Chip } from "@mui/material";
import {
  RefreshRounded,
  AutoAwesomeRounded,
  SaveRounded,
  AddRounded,
  DeleteOutlineRounded,
  ScienceRounded,
  WarningAmberRounded,
} from "@mui/icons-material";
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

const RESULT_OPTIONS = ["Positive", "Negative", "Equivocal"];

const FLAG_META = {
  high: { color: "#b3261e", label: "High" },
  low: { color: "#8a6d00", label: "Low" },
  normal: { color: "#2e7d32", label: "Normal" },
  unranged: { color: C.ash, label: "No range on file" },
};

const RESULT_META = {
  Positive: "#b3261e",
  Negative: "#2e7d32",
  Equivocal: "#8a6d00",
};

export default function RheumatologyBiomarkerAnalysis({ doctorId, patientId, patientName }) {
  const [markerCatalog, setMarkerCatalog] = useState([]);
  const [numericTestCount, setNumericTestCount] = useState(0);

  const [qualitativeRecords, setQualitativeRecords] = useState([]);
  const [loadingQualitative, setLoadingQualitative] = useState(false);

  const [markerName, setMarkerName] = useState("");
  const [result, setResult] = useState("");
  const [titer, setTiter] = useState("");
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [notes, setNotes] = useState("");
  const [adding, setAdding] = useState(false);
  const [addError, setAddError] = useState("");

  const [analysis, setAnalysis] = useState(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [analyzeError, setAnalyzeError] = useState("");
  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState("");

  const loadContext = useCallback(async () => {
    if (!patientId || !doctorId) return;
    try {
      const res = await fetch(`${API_BASE_URL}hms/users/data/context/rheumatology-biomarkers/context-preview/${patientId}/${doctorId}`);
      const json = await res.json();
      if (json?.status === "success") {
        setMarkerCatalog(json.data?.qualitative_markers || []);
        setNumericTestCount(json.data?.numeric_tests_recorded_in_module5 || 0);
      }
    } catch (err) {
      console.error("Failed to load biomarker context:", err);
    }
  }, [patientId, doctorId]);

  const loadQualitative = useCallback(async () => {
    if (!patientId || !doctorId) return;
    setLoadingQualitative(true);
    try {
      const res = await fetch(`${API_BASE_URL}hms/users/data/context/rheumatology-biomarkers/qualitative/${patientId}/${doctorId}`);
      const json = await res.json();
      if (json?.status === "success") setQualitativeRecords(json.data || []);
    } catch (err) {
      console.error("Failed to load qualitative markers:", err);
    } finally {
      setLoadingQualitative(false);
    }
  }, [patientId, doctorId]);

useEffect(() => {
    loadContext();
    loadQualitative();
    return subscribeRheumContextUpdate(() => { loadContext(); loadQualitative(); });
  }, [loadContext, loadQualitative]);

  const handleAddMarker = async () => {
    setAddError("");
    if (!markerName || !result) { setAddError("Select a marker and a result."); return; }
    setAdding(true);
    try {
      const res = await fetch(`${API_BASE_URL}hms/users/data/context/rheumatology-biomarkers/add-qualitative`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ patient_id: patientId, doctor_id: doctorId, marker_name: markerName, result, titer, date, notes }),
      });
      const json = await res.json();
      if (!res.ok || json?.status !== "success") throw new Error(json?.detail || "Failed to add marker");
      setResult(""); setTiter(""); setNotes("");
      await loadQualitative();
      announceRheumContextUpdate("biomarker-analysis");
    } catch (err) {
      console.error("Add qualitative marker failed:", err);
      setAddError(err.message || "Failed to add marker");
    } finally {
      setAdding(false);
    }
  };

  const handleDeleteMarker = async (markerId) => {
    try {
      await fetch(`${API_BASE_URL}hms/users/data/context/rheumatology-biomarkers/qualitative/${markerId}`, { method: "DELETE" });
      await loadQualitative();
      announceRheumContextUpdate("biomarker-analysis");
    } catch (err) {
      console.error("Delete qualitative marker failed:", err);
    }
  };

  const handleAnalyze = async () => {
    setAnalyzing(true);
    setAnalyzeError("");
    try {
      const res = await fetch(`${API_BASE_URL}hms/users/data/context/rheumatology-biomarkers/analyze`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ doctor_id: doctorId, patient_id: patientId }),
      });
      const json = await res.json();
      if (!res.ok || json?.status !== "success") throw new Error(json?.detail || "Failed to analyze biomarkers");
      setAnalysis(json.finaloutput);
    } catch (err) {
      console.error("Biomarker analysis failed:", err);
      setAnalyzeError(err.message || "Failed to analyze biomarkers");
    } finally {
      setAnalyzing(false);
    }
  };

  const handleSave = async () => {
    if (!analysis) return;
    setSaving(true);
    setSaveMsg("");
    try {
      const res = await fetch(`${API_BASE_URL}hms/users/data/context/rheumatology-biomarkers/save`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          patient_id: patientId, doctor_id: doctorId,
          numeric_flags: analysis.numeric_flags || [],
          qualitative_summary: analysis.qualitative_summary || [],
          combination_flags: analysis.combination_flags || [],
          narrative: analysis.narrative || "",
        }),
      });
      const json = await res.json();
      if (!res.ok || json?.status !== "success") throw new Error(json?.detail || json?.message || "Save failed");
      setSaveMsg("✅ Biomarker analysis saved");
      window.dispatchEvent(new Event("refreshRheumatologyBiomarkerAnalysisHistory"));
      announceRheumContextUpdate("biomarker-analysis");
    } catch (err) {
      console.error("Save biomarker analysis failed:", err);
      setSaveMsg(`❌ ${err.message || "Save failed"}`);
    } finally {
      setSaving(false);
      setTimeout(() => setSaveMsg(""), 3000);
    }
  };

  const canAnalyze = numericTestCount > 0 || qualitativeRecords.length > 0;

  return (
    <Box sx={{ ...card, overflow: "hidden" }}>
      <Box sx={{ px: 3, py: 2.5, borderBottom: `1px solid ${C.fog}`, background: C.ghost, display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 1.5 }}>
        <Box>
          <Typography sx={{ ...os({ fontSize: 14, color: C.ink, letterSpacing: "0.02em" }) }}>Biomarker Analysis</Typography>
          <Typography sx={{ ...os({ fontSize: 11, color: C.ash, mt: 0.4 }) }}>
            {patientName ? `Reference-range flagging & combination patterns — ${patientName}` : "Reference-range flagging & combination patterns"}
          </Typography>
        </Box>
        <Chip label="Biomarker Analysis" size="small" sx={{ background: C.black, color: C.white, fontWeight: 300, fontSize: 10, letterSpacing: "0.04em", borderRadius: "2px", height: 22 }} />
      </Box>

      {/* Numeric data hint */}
      <Box sx={{ mx: 3, mt: 2, p: 1.5, borderRadius: "2px", background: C.ghost, border: `1px solid ${C.fog}` }}>
        <Typography sx={{ ...os({ fontSize: 11, color: C.charcoal }) }}>
          {numericTestCount > 0
            ? `${numericTestCount} numeric lab result(s) available from Lab Trends — reference-range flagging will use the latest value per test.`
            : "No numeric lab results found yet. Add results in Lab Trends (Module 5) to include them here."}
        </Typography>
      </Box>

      {/* Qualitative marker log */}
      <Box sx={{ px: 3, pt: 2.5 }}>
        <Typography sx={{ ...os({ fontSize: 10, color: C.ash, textTransform: "uppercase", letterSpacing: "0.07em", mb: 0.75 }) }}>Add Qualitative Marker</Typography>
        <Box sx={{ display: "flex", gap: 1.25, flexWrap: "wrap", alignItems: "flex-end" }}>
          <Box sx={{ minWidth: 220, flex: "1 1 220px" }}>
            <select value={markerName} onChange={(e) => setMarkerName(e.target.value)} style={inputSx}>
              <option value="">Select marker…</option>
              {markerCatalog.map((m) => <option key={m} value={m}>{m}</option>)}
            </select>
          </Box>
          <Box sx={{ width: 140 }}>
            <select value={result} onChange={(e) => setResult(e.target.value)} style={inputSx}>
              <option value="">Result…</option>
              {RESULT_OPTIONS.map((r) => <option key={r} value={r}>{r}</option>)}
            </select>
          </Box>
          <Box sx={{ minWidth: 160, flex: "1 1 160px" }}>
            <input type="text" placeholder="Titer (optional)" value={titer} onChange={(e) => setTiter(e.target.value)} style={inputSx} />
          </Box>
          <Box sx={{ width: 155 }}>
            <input type="date" value={date} onChange={(e) => setDate(e.target.value)} style={inputSx} />
          </Box>
          <Box sx={{ minWidth: 160, flex: "1 1 160px" }}>
            <input type="text" placeholder="Notes (optional)" value={notes} onChange={(e) => setNotes(e.target.value)} style={inputSx} />
          </Box>
          <Box component="button" type="button" onClick={handleAddMarker} disabled={adding}
            sx={{ ...actionButton, minWidth: 110, height: 38, py: 0 }}>
            <AddRounded sx={{ fontSize: 16 }} /> Add
          </Box>
        </Box>
        {addError && <Typography sx={{ ...os({ fontSize: 12, color: "#b3261e", mt: 1 }) }}>{addError}</Typography>}
      </Box>

      {/* Qualitative marker table */}
      <Box sx={{ px: 3, pt: 3 }}>
        <Box sx={{ display: "flex", alignItems: "center", justifyContent: "space-between", mb: 1 }}>
          <Typography sx={{ ...os({ fontSize: 10, color: C.ash, textTransform: "uppercase", letterSpacing: "0.07em" }) }}>Qualitative Markers</Typography>
          {loadingQualitative && <RefreshRounded sx={{ fontSize: 14, color: C.ash, animation: "spin 1s linear infinite" }} />}
        </Box>
        {qualitativeRecords.length === 0 ? (
          <Typography sx={{ ...os({ fontSize: 12, color: C.silver, py: 1.5 }) }}>No qualitative markers recorded yet.</Typography>
        ) : (
          <Box sx={{ border: `1px solid ${C.fog}`, borderRadius: "4px", overflow: "hidden", maxHeight: 240, overflowY: "auto" }}>
            {qualitativeRecords.map((m) => (
              <Box key={m._id} sx={{ display: "flex", alignItems: "center", justifyContent: "space-between", px: 1.5, py: 1, borderBottom: `1px solid ${C.fog}`, "&:last-child": { borderBottom: "none" }, "&:hover": { background: C.ghost } }}>
                <Box sx={{ display: "flex", alignItems: "center", gap: 1.5, flexWrap: "wrap" }}>
                  <Typography sx={{ ...os({ fontSize: 12, color: C.ink, minWidth: 160 }) }}>{m.marker_name}</Typography>
                  <Chip label={m.result} size="small" sx={{ fontSize: 10, height: 20, background: `${RESULT_META[m.result] || C.charcoal}18`, color: RESULT_META[m.result] || C.charcoal }} />
                  {m.titer && <Typography sx={{ ...os({ fontSize: 11.5, color: C.charcoal }) }}>{m.titer}</Typography>}
                  <Typography sx={{ ...os({ fontSize: 11, color: C.ash }) }}>{m.date}</Typography>
                </Box>
                <Box component="button" type="button" onClick={() => handleDeleteMarker(m._id)}
                  sx={{ border: "none", background: "transparent", cursor: "pointer", color: C.silver, display: "flex", "&:hover": { color: "#b3261e" } }}>
                  <DeleteOutlineRounded sx={{ fontSize: 16 }} />
                </Box>
              </Box>
            ))}
          </Box>
        )}
      </Box>

      {/* Analyze */}
      <Box sx={{ px: 3, pt: 3, pb: 1 }}>
        {analyzeError && <Typography sx={{ ...os({ fontSize: 12, color: "#b3261e", mb: 1 }) }}>{analyzeError}</Typography>}
        <Box sx={{ display: "flex", justifyContent: "flex-end" }}>
          <Box component="button" type="button" onClick={handleAnalyze} disabled={analyzing || !canAnalyze} sx={{ ...actionButton, minWidth: 190 }}>
            {analyzing ? <RefreshRounded sx={{ fontSize: 15, animation: "spin 1s linear infinite" }} /> : <ScienceRounded sx={{ fontSize: 15 }} />}
            {analyzing ? "Analyzing..." : "Analyze Biomarkers"}
          </Box>
        </Box>
      </Box>

      {/* Results */}
      {analysis && (
        <Box sx={{ px: { xs: 2, sm: 3 }, pb: 2, display: "flex", flexDirection: "column", gap: 2 }}>

          {analysis.numeric_flags?.length > 0 && (
            <Box>
              <Typography sx={{ ...os({ fontSize: 10, color: C.ash, textTransform: "uppercase", letterSpacing: "0.07em", mb: 1 }) }}>Numeric Values</Typography>
              <Box sx={{ display: "flex", flexWrap: "wrap", gap: 0.75 }}>
                {analysis.numeric_flags.map((f, i) => {
                  const meta = FLAG_META[f.flag] || FLAG_META.unranged;
                  return (
                    <Chip
                      key={i}
                      label={`${f.test_name}: ${f.value} ${f.unit} (${meta.label})`}
                      size="small"
                      sx={{ fontSize: 10.5, height: 24, background: `${meta.color}18`, color: meta.color, border: `1px solid ${meta.color}44` }}
                    />
                  );
                })}
              </Box>
            </Box>
          )}

          {analysis.combination_flags?.length > 0 && (
            <Box>
              <Typography sx={{ ...os({ fontSize: 10, color: C.ash, textTransform: "uppercase", letterSpacing: "0.07em", mb: 1 }) }}>Combination Flags</Typography>
              <Box sx={{ display: "flex", flexDirection: "column", gap: 1 }}>
                {analysis.combination_flags.map((f, i) => (
                  <Box key={i} sx={{ display: "flex", gap: 1, alignItems: "flex-start", p: 1.5, border: `1px solid #8a6d0044`, borderRadius: "2px", background: "#fbf6e3" }}>
                    <WarningAmberRounded sx={{ fontSize: 16, color: "#8a6d00", mt: 0.15 }} />
                    <Box>
                      <Typography sx={{ ...os({ fontSize: 12.5, color: C.ink }) }}>{f.flag}</Typography>
                      <Typography sx={{ ...os({ fontSize: 11.5, color: C.charcoal, mt: 0.25 }) }}>{f.reasoning}</Typography>
                    </Box>
                  </Box>
                ))}
              </Box>
            </Box>
          )}

          {analysis.narrative && (
            <Box sx={{ p: 1.75, borderRadius: "2px", background: C.ghost, border: `1px solid ${C.fog}` }}>
              <Typography sx={{ ...os({ fontSize: 10, color: C.silver, textTransform: "uppercase", letterSpacing: "0.07em", mb: 0.5 }) }}>AI Summary</Typography>
              <Typography sx={{ ...os({ fontSize: 12.5, color: C.charcoal, lineHeight: 1.6 }) }}>{analysis.narrative}</Typography>
            </Box>
          )}
        </Box>
      )}

      {/* Footer */}
      <Box sx={{ px: 3, py: 2, borderTop: `1px solid ${C.fog}`, background: C.ghost, display: "flex", alignItems: "center", justifyContent: "flex-end", gap: 1.5 }}>
        {saveMsg && <Typography sx={{ ...os({ fontSize: 12, color: saveMsg.includes("✅") ? "#2e7d32" : "#d32f2f" }) }}>{saveMsg}</Typography>}
        <Box component="button" type="button" onClick={handleSave} disabled={saving || !analysis} sx={{ ...actionButton, minWidth: 200 }}>
          <SaveRounded sx={{ fontSize: 15 }} /> {saving ? "Saving..." : "Save Analysis"}
        </Box>
      </Box>

      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </Box>
  );
}