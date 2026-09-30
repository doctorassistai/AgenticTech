import React, { useState, useEffect, useCallback } from "react";
import { Box, Typography, Chip } from "@mui/material";
import {
  RefreshRounded,
  AutoAwesomeRounded,
  SaveRounded,
  TrendingUpRounded,
  TrendingDownRounded,
  TrendingFlatRounded,
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

const ghostButton = {
  px: 2, py: 0.9, borderRadius: "2px", fontSize: 12, fontWeight: 400,
  fontFamily: FONT, textTransform: "none", letterSpacing: "0.04em",
  background: "transparent", color: C.charcoal, border: `1px solid ${C.mist}`,
  cursor: "pointer", display: "flex", alignItems: "center", gap: 0.5,
  transition: "all 0.15s ease", "&:hover": { borderColor: C.smoke, background: C.ghost },
};

const inputSx = {
  width: "100%", padding: "9px 12px", border: `1px solid ${C.mist}`,
  borderRadius: "2px", background: C.white, fontFamily: FONT, fontSize: "12.5px",
  fontWeight: 300, color: C.ink, outline: "none", boxSizing: "border-box",
};

const CLASSIFICATION_META = {
  "Improving": { color: "#2e7d32", icon: TrendingUpRounded },
  "Stable": { color: "#3d5a80", icon: TrendingFlatRounded },
  "Inadequate response": { color: "#8a6d00", icon: TrendingFlatRounded },
  "Worsening": { color: "#b3261e", icon: TrendingDownRounded },
  "Possible flare": { color: "#b3261e", icon: WarningAmberRounded },
};

export default function RheumatologyTreatmentResponse({ doctorId, patientId, patientName }) {
  const [preview, setPreview] = useState(null);
  const [loadingPreview, setLoadingPreview] = useState(false);

  const [result, setResult] = useState(null); // /evaluate output, doctor-editable before save
  const [evaluating, setEvaluating] = useState(false);
  const [evalError, setEvalError] = useState(null);

  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState(null);
  const [saved, setSaved] = useState(false);

  const loadPreview = useCallback(async () => {
    if (!patientId || !doctorId) return;
    setLoadingPreview(true);
    try {
      const res = await fetch(`${API_BASE_URL}hms/users/data/context/rheumatology-treatment-response/context-preview/${patientId}/${doctorId}`);
      const json = await res.json();
      if (json?.status === "success") setPreview(json);
    } catch (err) {
      console.error("Failed to load treatment response context preview:", err);
    } finally {
      setLoadingPreview(false);
    }
  }, [patientId, doctorId]);

useEffect(() => {
    loadPreview();
    return subscribeRheumContextUpdate(loadPreview);
  }, [loadPreview]);

  const handleEvaluate = async () => {
    setEvaluating(true);
    setEvalError(null);
    setSaved(false);
    try {
      const res = await fetch(`${API_BASE_URL}hms/users/data/context/rheumatology-treatment-response/evaluate`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ doctor_id: doctorId, patient_id: patientId }),
      });
      const json = await res.json();
      if (!res.ok || json?.status !== "success") throw new Error(json?.detail || "Evaluation failed");
      setResult(json.finaloutput);
    } catch (err) {
      console.error("Treatment response evaluation failed:", err);
      setEvalError(err.message || "Evaluation failed");
    } finally {
      setEvaluating(false);
    }
  };

  const handleSave = async () => {
    if (!result) return;
    setSaving(true);
    setSaveError(null);
    try {
      const res = await fetch(`${API_BASE_URL}hms/users/data/context/rheumatology-treatment-response/save`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          doctor_id: doctorId, patient_id: patientId,
          classification: result.classification,
          primary_signal: result.primary_signal,
          biomarker_signal: result.biomarker_signal,
          imaging_signal: result.imaging_signal,
          narrative: result.narrative || "",
        }),
      });
      const json = await res.json();
      if (!res.ok || json?.status !== "success") throw new Error(json?.detail || json?.message || "Save failed");
      setSaved(true);
      window.dispatchEvent(new Event("refreshRheumatologyTreatmentResponseHistory"));
      loadPreview();
      announceRheumContextUpdate("treatment-response");
    } catch (err) {
      console.error("Treatment response save failed:", err);
      
      setSaveError(err.message || "Save failed");
    } finally {
      setSaving(false);
    }
  };

  const meta = result ? CLASSIFICATION_META[result.classification] : null;
  const Icon = meta?.icon;

  return (
    <Box sx={{ ...card, overflow: "hidden" }}>
      <Box sx={{ px: 3, py: 2.5, borderBottom: `1px solid ${C.fog}`, background: C.ghost, display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 1.5 }}>
        <Box>
          <Typography sx={{ ...os({ fontSize: 14, color: C.ink, letterSpacing: "0.02em" }) }}>Treatment Response Evaluation</Typography>
          <Typography sx={{ ...os({ fontSize: 11, color: C.ash, mt: 0.4 }) }}>
            {patientName ? `Overall response classification — ${patientName}` : "Overall response classification"}
          </Typography>
        </Box>
        <Chip label="Requirement #13 · Treatment Response" size="small" sx={{ background: C.black, color: C.white, fontWeight: 300, fontSize: 10, letterSpacing: "0.04em", borderRadius: "2px", height: 22 }} />
      </Box>

      <Box sx={{ p: { xs: 2, sm: 3 } }}>
        {loadingPreview && (
          <Box sx={{ display: "flex", alignItems: "center", gap: 1, mb: 2 }}>
            <RefreshRounded sx={{ fontSize: 15, color: C.ash, animation: "spin 1s linear infinite" }} />
            <Typography sx={{ ...os({ fontSize: 12, color: C.ash }) }}>Checking available data…</Typography>
          </Box>
        )}

        {!loadingPreview && preview && (
          <Box sx={{ mb: 2.5, p: 1.75, borderRadius: "2px", background: C.ghost, border: `1px solid ${C.fog}` }}>
            <Typography sx={{ ...os({ fontSize: 10, color: C.silver, textTransform: "uppercase", letterSpacing: "0.07em", mb: 0.75 }) }}>
              Data available
            </Typography>
            <Box sx={{ display: "flex", gap: 1, flexWrap: "wrap" }}>
              <Chip label={`Disease Activity: ${preview.data.disease_activity_records_available} saved`} size="small"
                sx={{ fontSize: 10.5, height: 20, background: preview.can_evaluate ? "#eef7ee" : "#fdecea", color: preview.can_evaluate ? "#2e7d32" : "#b3261e" }} />
              <Chip label={`Biomarker: ${preview.data.biomarker_records_available} saved`} size="small" sx={{ fontSize: 10.5, height: 20, background: C.white, color: C.ash, border: `1px solid ${C.mist}` }} />
              <Chip label={`Imaging: ${preview.data.imaging_available ? "available" : "none"}`} size="small" sx={{ fontSize: 10.5, height: 20, background: C.white, color: C.ash, border: `1px solid ${C.mist}` }} />
            </Box>
            {!preview.can_evaluate && (
              <Typography sx={{ ...os({ fontSize: 11, color: "#b3261e", mt: 1 }) }}>
                Needs at least 2 saved Disease Activity assessments (Previous → Current) before a response can be classified.
              </Typography>
            )}
          </Box>
        )}

        {!result && (
          <Box sx={{ display: "flex", justifyContent: "flex-end" }}>
            <Box component="button" type="button" onClick={handleEvaluate} disabled={evaluating || !preview?.can_evaluate} sx={{ ...actionButton, minWidth: 180 }}>
              <AutoAwesomeRounded sx={{ fontSize: 15 }} /> {evaluating ? "Evaluating..." : "Evaluate Response"}
            </Box>
          </Box>
        )}

        {evalError && <Typography sx={{ ...os({ fontSize: 11.5, color: "#b3261e", mt: 1.5 }) }}>{evalError}</Typography>}

        {result && (
          <Box>
            <Box sx={{
              display: "flex", alignItems: "center", gap: 1.5, p: 2, borderRadius: "2px",
              background: `${meta?.color}12`, border: `1px solid ${meta?.color}44`, mb: 2,
            }}>
              {Icon && <Icon sx={{ fontSize: 22, color: meta.color }} />}
              <Box>
                <Typography sx={{ ...os({ fontSize: 10, color: C.silver, textTransform: "uppercase", letterSpacing: "0.07em" }) }}>Classification</Typography>
                <Typography sx={{ ...os({ fontSize: 16, color: meta?.color || C.ink }) }}>{result.classification}</Typography>
              </Box>
            </Box>

            <Box sx={{ display: "grid", gridTemplateColumns: { xs: "1fr", sm: "1fr 1fr" }, gap: 1.5, mb: 2 }}>
              <Box sx={{ p: 1.5, border: `1px solid ${C.fog}`, borderRadius: "2px" }}>
                <Typography sx={{ ...os({ fontSize: 9.5, color: C.ash, textTransform: "uppercase", letterSpacing: "0.06em", mb: 0.5 }) }}>
                  Primary signal — {result.primary_signal?.score_key?.toUpperCase()}
                </Typography>
                <Typography sx={{ ...os({ fontSize: 12.5, color: C.ink }) }}>
                  {result.primary_signal?.previous_category} → {result.primary_signal?.current_category}
                </Typography>
              </Box>
              <Box sx={{ p: 1.5, border: `1px solid ${C.fog}`, borderRadius: "2px" }}>
                <Typography sx={{ ...os({ fontSize: 9.5, color: C.ash, textTransform: "uppercase", letterSpacing: "0.06em", mb: 0.5 }) }}>
                  Biomarker signal
                </Typography>
                <Typography sx={{ ...os({ fontSize: 12.5, color: C.ink }) }}>
                  {result.biomarker_signal ? `${result.biomarker_signal.previous_abnormal_count} → ${result.biomarker_signal.current_abnormal_count} abnormal (${result.biomarker_signal.direction})` : "No corroborating data"}
                </Typography>
              </Box>
              <Box sx={{ p: 1.5, border: `1px solid ${C.fog}`, borderRadius: "2px", gridColumn: { xs: "1", sm: "1 / -1" } }}>
                <Typography sx={{ ...os({ fontSize: 9.5, color: C.ash, textTransform: "uppercase", letterSpacing: "0.06em", mb: 0.5 }) }}>
                  Imaging signal
                </Typography>
                <Typography sx={{ ...os({ fontSize: 12.5, color: C.ink }) }}>
                  {result.imaging_signal
                    ? `${result.imaging_signal.regions_worsening} worsening / ${result.imaging_signal.regions_improving} improving / ${result.imaging_signal.regions_stable} stable (${result.imaging_signal.direction})`
                    : "No corroborating data"}
                </Typography>
              </Box>
            </Box>

            <Typography sx={{ ...os({ fontSize: 9.5, color: C.ash, textTransform: "uppercase", letterSpacing: "0.06em", mb: 0.5 }) }}>
              Narrative (editable before saving)
            </Typography>
            <textarea
              style={{ ...inputSx, minHeight: 80, resize: "vertical" }}
              value={result.narrative || ""}
              onChange={(e) => setResult((r) => ({ ...r, narrative: e.target.value }))}
              placeholder="No narrative generated — optionally add one before saving"
            />

            {saveError && <Typography sx={{ ...os({ fontSize: 11.5, color: "#b3261e", mt: 1.25 }) }}>{saveError}</Typography>}
            {saved && <Typography sx={{ ...os({ fontSize: 11.5, color: "#2e7d32", mt: 1.25 }) }}>Saved.</Typography>}

            <Box sx={{ display: "flex", justifyContent: "flex-end", gap: 1, mt: 2 }}>
              <Box component="button" type="button" onClick={() => { setResult(null); setSaved(false); }} sx={{ ...ghostButton, fontSize: 12 }}>
                Re-evaluate
              </Box>
              <Box component="button" type="button" onClick={handleSave} disabled={saving} sx={{ ...actionButton, minWidth: 140 }}>
                <SaveRounded sx={{ fontSize: 15 }} /> {saving ? "Saving..." : "Save Evaluation"}
              </Box>
            </Box>
          </Box>
        )}
      </Box>

      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </Box>
  );
}