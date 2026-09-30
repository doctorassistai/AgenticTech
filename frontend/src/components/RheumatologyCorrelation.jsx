import React, { useState, useEffect, useCallback } from "react";
import { Box, Typography, Chip } from "@mui/material";
import { RefreshRounded, SaveRounded, HubRounded, WarningAmberRounded } from "@mui/icons-material";
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
  minHeight: 110, resize: "vertical",
};

const SOURCE_LABELS = {
  biomarkers: "Biomarker Analysis",
  imaging: "Imaging Comparison",
  disease_activity: "Disease Activity",
  treatment_response: "Treatment Response",
};

const formatDate = (d) => {
  if (!d) return "—";
  try { return new Date(d).toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" }); }
  catch { return d; }
};

export default function RheumatologyCorrelation({ doctorId, patientId, patientName }) {
  const [sourcesAvailable, setSourcesAvailable] = useState([]);
  const [sourcesMissing, setSourcesMissing] = useState([]);
  const [sourceDates, setSourceDates] = useState({});
  const [canGenerate, setCanGenerate] = useState(false);

  const [result, setResult] = useState(null);
  const [editedNarrative, setEditedNarrative] = useState("");
  const [generating, setGenerating] = useState(false);
  const [generateError, setGenerateError] = useState("");
  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState("");

  const loadContext = useCallback(async () => {
    if (!patientId || !doctorId) return;
    try {
      const res = await fetch(`${API_BASE_URL}hms/users/data/context/rheumatology-correlation/context-preview/${patientId}/${doctorId}`);
      const json = await res.json();
      if (json?.status === "success") {
        setSourcesAvailable(json.data?.sources_available || []);
        setSourcesMissing(json.data?.sources_missing || []);
        setSourceDates({
          biomarkers: json.data?.biomarkers_date,
          imaging: json.data?.imaging_date,
          disease_activity: json.data?.disease_activity_date,
          treatment_response: json.data?.treatment_response_date,
        });
        setCanGenerate(Boolean(json.can_generate));
      }
    } catch (err) {
      console.error("Failed to load correlation context:", err);
    }
  }, [patientId, doctorId]);

useEffect(() => {
    loadContext();
    return subscribeRheumContextUpdate(loadContext);
  }, [loadContext]);

  const handleGenerate = async () => {
    setGenerateError("");
    setGenerating(true);
    try {
      const res = await fetch(`${API_BASE_URL}hms/users/data/context/rheumatology-correlation/generate`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ doctor_id: doctorId, patient_id: patientId }),
      });
      const json = await res.json();
      if (!res.ok || json?.status !== "success") throw new Error(json?.detail || "Failed to generate correlation");
      setResult(json.finaloutput);
      setEditedNarrative(json.finaloutput?.narrative || "");
    } catch (err) {
      console.error("Correlation generation failed:", err);
      setGenerateError(err.message || "Failed to generate correlation");
    } finally {
      setGenerating(false);
    }
  };

  const handleSave = async () => {
    if (!result || !editedNarrative.trim()) return;
    setSaving(true);
    setSaveMsg("");
    try {
      const res = await fetch(`${API_BASE_URL}hms/users/data/context/rheumatology-correlation/save`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          patient_id: patientId, doctor_id: doctorId,
          sources_used: result.sources_used || [],
          source_data: result.source_data || {},
          narrative: editedNarrative,
        }),
      });
      const json = await res.json();
      if (!res.ok || json?.status !== "success") throw new Error(json?.detail || json?.message || "Save failed");
      setSaveMsg("✅ Correlation saved");
      window.dispatchEvent(new Event("refreshRheumatologyCorrelationHistory"));
      announceRheumContextUpdate("correlation");
    } catch (err) {
      console.error("Save correlation failed:", err);
      setSaveMsg(`❌ ${err.message || "Save failed"}`);
    } finally {
      setSaving(false);
      setTimeout(() => setSaveMsg(""), 3000);
    }
  };

  return (
    <Box sx={{ ...card, overflow: "hidden" }}>
      <Box sx={{ px: 3, py: 2.5, borderBottom: `1px solid ${C.fog}`, background: C.ghost, display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 1.5 }}>
        <Box>
          <Typography sx={{ ...os({ fontSize: 14, color: C.ink, letterSpacing: "0.02em" }) }}>Biomarker + Imaging Correlation</Typography>
          <Typography sx={{ ...os({ fontSize: 11, color: C.ash, mt: 0.4 }) }}>
            {patientName ? `Cross-source synthesis — ${patientName}` : "Cross-source synthesis"}
          </Typography>
        </Box>
        <Chip label="Correlation Engine" size="small" sx={{ background: C.black, color: C.white, fontWeight: 300, fontSize: 10, letterSpacing: "0.04em", borderRadius: "2px", height: 22 }} />
      </Box>

      {/* Source availability */}
      <Box sx={{ px: 3, pt: 2.5 }}>
        <Typography sx={{ ...os({ fontSize: 10, color: C.ash, textTransform: "uppercase", letterSpacing: "0.07em", mb: 1 }) }}>Available Sources</Typography>
        <Box sx={{ display: "flex", flexWrap: "wrap", gap: 0.75 }}>
          {["biomarkers", "imaging", "disease_activity", "treatment_response"].map((key) => {
            const has = sourcesAvailable.includes(key);
            return (
              <Chip
                key={key}
                label={has ? `${SOURCE_LABELS[key]} · ${formatDate(sourceDates[key])}` : `${SOURCE_LABELS[key]} · not saved yet`}
                size="small"
                sx={{
                  fontSize: 10.5, height: 24,
                  background: has ? "#eef7ee" : C.ghost,
                  color: has ? "#2e7d32" : C.ash,
                  border: `1px solid ${has ? "#2e7d3244" : C.mist}`,
                }}
              />
            );
          })}
        </Box>
        {!canGenerate && (
          <Typography sx={{ ...os({ fontSize: 11.5, color: C.ash, mt: 1 }) }}>
            Need at least 2 of the 4 sources saved (Biomarker Analysis, Imaging Comparison, Disease Activity, Treatment Response) to run a correlation.
          </Typography>
        )}
      </Box>

      {generateError && <Typography sx={{ ...os({ fontSize: 12, color: "#b3261e", mx: 3, mt: 2 }) }}>{generateError}</Typography>}

      <Box sx={{ px: 3, pt: 3, pb: 1, display: "flex", justifyContent: "flex-end" }}>
        <Box component="button" type="button" onClick={handleGenerate} disabled={generating || !canGenerate} sx={{ ...actionButton, minWidth: 190 }}>
          {generating ? <RefreshRounded sx={{ fontSize: 15, animation: "spin 1s linear infinite" }} /> : <HubRounded sx={{ fontSize: 15 }} />}
          {generating ? "Synthesizing..." : "Generate Correlation"}
        </Box>
      </Box>

      {/* Result */}
      {result && (
        <Box sx={{ px: { xs: 2, sm: 3 }, pb: 2, display: "flex", flexDirection: "column", gap: 1.5 }}>
          <Box sx={{ p: 1.5, borderRadius: "2px", background: "#fbf6e3", border: "1px solid #8a6d0044", display: "flex", gap: 1 }}>
            <WarningAmberRounded sx={{ fontSize: 16, color: "#8a6d00", mt: 0.15 }} />
            <Typography sx={{ ...os({ fontSize: 11.5, color: "#8a6d00" }) }}>
              Pattern-level synthesis only — not a diagnosis. No single finding above should be treated as definitive; clinical correlation required.
            </Typography>
          </Box>

          <Box>
            <Typography sx={{ ...os({ fontSize: 10, color: C.ash, textTransform: "uppercase", letterSpacing: "0.07em", mb: 0.75 }) }}>
              Synthesis (editable before save)
            </Typography>
            <textarea
              value={editedNarrative}
              onChange={(e) => setEditedNarrative(e.target.value)}
              style={inputSx}
            />
          </Box>

          <Typography sx={{ ...os({ fontSize: 10.5, color: C.silver }) }}>
            Sources used: {(result.sources_used || []).map((s) => SOURCE_LABELS[s] || s).join(", ")}
          </Typography>
        </Box>
      )}

      {/* Footer */}
      <Box sx={{ px: 3, py: 2, borderTop: `1px solid ${C.fog}`, background: C.ghost, display: "flex", alignItems: "center", justifyContent: "flex-end", gap: 1.5 }}>
        {saveMsg && <Typography sx={{ ...os({ fontSize: 12, color: saveMsg.includes("✅") ? "#2e7d32" : "#d32f2f" }) }}>{saveMsg}</Typography>}
        <Box component="button" type="button" onClick={handleSave} disabled={saving || !result || !editedNarrative.trim()} sx={{ ...actionButton, minWidth: 190 }}>
          <SaveRounded sx={{ fontSize: 15 }} /> {saving ? "Saving..." : "Save Correlation"}
        </Box>
      </Box>

      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </Box>
  );
}