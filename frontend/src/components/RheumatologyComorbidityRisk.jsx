import React, { useState, useEffect, useCallback } from "react";
import { Box, Typography, Chip } from "@mui/material";
import {
  RefreshRounded,
  SaveRounded,
  ShieldRounded,
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
  borderRadius: "2px", background: C.white, fontFamily: FONT, fontSize: "12.5px",
  fontWeight: 300, color: C.ink, outline: "none", boxSizing: "border-box",
};

const CATEGORY_COLOR = { Low: "#2e7d32", Moderate: "#8a6d00", High: "#b3261e" };
const CATEGORY_BG = { Low: "#eef7ee", Moderate: "#fbf6e3", High: "#fbecea" };
const CHECKLIST_STATUS_OPTIONS = ["Unknown", "Done", "Not Done"];

export default function RheumatologyComorbidityRisk({ doctorId, patientId, patientName }) {
  const [preview, setPreview] = useState({ domains: [], raw_comorbidities: [], steroid_exposure_reported: false });
  const [hasIntakeData, setHasIntakeData] = useState(false);
  const [checklist, setChecklist] = useState({});
  const [result, setResult] = useState(null);
  const [calculating, setCalculating] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState("");
  const [calcError, setCalcError] = useState("");

  const loadPreview = useCallback(async () => {
    if (!patientId || !doctorId) return;
    try {
      const res = await fetch(`${API_BASE_URL}hms/users/data/context/rheumatology-comorbidity-risk/context-preview/${patientId}/${doctorId}`);
      const json = await res.json();
      if (json?.status === "success") {
        setPreview(json.data || { domains: [], raw_comorbidities: [], steroid_exposure_reported: false });
        setHasIntakeData(Boolean(json.has_intake_data));
      }
    } catch (err) {
      console.error("Failed to load comorbidity risk context:", err);
    }
  }, [patientId, doctorId]);

useEffect(() => {
    loadPreview();
    return subscribeRheumContextUpdate(loadPreview);
  }, [loadPreview]);
  const setChecklistValue = (domain, item, value) => {
    setChecklist((prev) => ({
      ...prev,
      [domain]: { ...(prev[domain] || {}), [item]: value },
    }));
  };

  const handleCalculate = async () => {
    setCalcError("");
    setCalculating(true);
    try {
      const res = await fetch(`${API_BASE_URL}hms/users/data/context/rheumatology-comorbidity-risk/calculate`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ doctor_id: doctorId, patient_id: patientId, checklist }),
      });
      const json = await res.json();
      if (!res.ok || json?.status !== "success") throw new Error(json?.detail || "Failed to calculate comorbidity risk");
      setResult(json.finaloutput || null);
    } catch (err) {
      console.error("Comorbidity risk calculation failed:", err);
      setCalcError(err.message || "Failed to calculate comorbidity risk");
    } finally {
      setCalculating(false);
    }
  };

  const handleSave = async () => {
    if (!result?.domains?.length) return;
    setSaving(true);
    setSaveMsg("");
    try {
      const res = await fetch(`${API_BASE_URL}hms/users/data/context/rheumatology-comorbidity-risk/save`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          patient_id: patientId, doctor_id: doctorId,
          domains: result.domains, narrative: result.narrative || "",
        }),
      });
      const json = await res.json();
      if (!res.ok || json?.status !== "success") throw new Error(json?.detail || json?.message || "Save failed");
      setSaveMsg("✅ Comorbidity risk review saved");
      window.dispatchEvent(new Event("refreshRheumatologyComorbidityRiskHistory"));
      announceRheumContextUpdate("comorbidity-risk");
    } catch (err) {
      console.error("Comorbidity risk save failed:", err);
      setSaveMsg(`❌ ${err.message || "Save failed"}`);
    } finally {
      setSaving(false);
      setTimeout(() => setSaveMsg(""), 3000);
    }
  };

  const domainsToRender = result?.domains?.length ? result.domains : preview.domains;

  return (
    <Box sx={{ ...card, overflow: "hidden" }}>
      <Box sx={{ px: 3, py: 2.5, borderBottom: `1px solid ${C.fog}`, background: C.ghost, display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 1.5 }}>
        <Box>
          <Typography sx={{ ...os({ fontSize: 14, color: C.ink, letterSpacing: "0.02em" }) }}>Comorbidity & Risk Intelligence</Typography>
          <Typography sx={{ ...os({ fontSize: 11, color: C.ash, mt: 0.4 }) }}>
            {patientName ? `Cardiovascular / Osteoporosis / Infection risk — ${patientName}` : "Cardiovascular / Osteoporosis / Infection risk"}
          </Typography>
        </Box>
        <Chip label="Comorbidity & Risk" size="small" sx={{ background: C.black, color: C.white, fontWeight: 300, fontSize: 10, letterSpacing: "0.04em", borderRadius: "2px", height: 22 }} />
      </Box>

      {/* Auto-derived context */}
      <Box sx={{ mx: 3, mt: 2, p: 1.5, borderRadius: "2px", background: C.ghost, border: `1px solid ${C.fog}` }}>
        <Box sx={{ display: "flex", alignItems: "center", gap: 1, mb: 0.75 }}>
          <Box sx={{ width: 7, height: 7, borderRadius: "50%", background: hasIntakeData ? "#2e7d32" : C.silver }} />
          <Typography sx={{ ...os({ fontSize: 11, color: C.charcoal }) }}>
            {hasIntakeData
              ? `Comorbidities from Module 1 intake: ${preview.raw_comorbidities?.length ? preview.raw_comorbidities.join(", ") : "none recorded"}`
              : "No intake found — complete Module 1 first, or rely on the manual checklist below"}
          </Typography>
        </Box>
        <Typography sx={{ ...os({ fontSize: 11, color: C.ash }) }}>
          Steroid exposure reported at intake: {preview.steroid_exposure_reported ? "Yes" : "No"}
        </Typography>
      </Box>

      {/* Per-domain checklist inputs */}
      <Box sx={{ p: 3, display: "flex", flexDirection: "column", gap: 2 }}>
        {(preview.domains || []).map((d) => (
          <Box key={d.domain} sx={{ border: `1px solid ${C.fog}`, borderRadius: "4px", overflow: "hidden" }}>
            <Box sx={{ px: 2, py: 1.25, background: C.ghost, borderBottom: `1px solid ${C.fog}` }}>
              <Typography sx={{ ...os({ fontSize: 12.5, color: C.ink }) }}>{d.domain}</Typography>
              <Typography sx={{ ...os({ fontSize: 10.5, color: C.silver, mt: 0.25 }) }}>
                Auto-detected: {d.auto_detected_factors?.length ? d.auto_detected_factors.join(", ") : "none"}
              </Typography>
            </Box>
            <Box sx={{ p: 1.75, display: "grid", gridTemplateColumns: { xs: "1fr", sm: "1fr 1fr" }, gap: 1.25 }}>
              {(d.manual_checklist_items || []).map((item) => (
                <Box key={item}>
                  <Typography sx={{ ...os({ fontSize: 10.5, color: C.ash, mb: 0.5 }) }}>{item}</Typography>
                  <select
                    style={{ ...inputSx }}
                    value={checklist[d.domain]?.[item] || "Unknown"}
                    onChange={(e) => setChecklistValue(d.domain, item, e.target.value)}
                  >
                    {CHECKLIST_STATUS_OPTIONS.map((s) => <option key={s} value={s}>{s}</option>)}
                  </select>
                </Box>
              ))}
            </Box>
          </Box>
        ))}
      </Box>

      {calcError && <Typography sx={{ ...os({ fontSize: 12, color: "#b3261e", mx: 3, mb: 1 }) }}>{calcError}</Typography>}

      <Box sx={{ px: 3, pb: 2, display: "flex", justifyContent: "flex-end" }}>
        <Box component="button" type="button" onClick={handleCalculate} disabled={calculating} sx={{ ...actionButton, minWidth: 200 }}>
          {calculating ? <RefreshRounded sx={{ fontSize: 15, animation: "spin 1s linear infinite" }} /> : <ShieldRounded sx={{ fontSize: 15 }} />}
          {calculating ? "Calculating..." : "Calculate Risk"}
        </Box>
      </Box>

      {/* Results */}
      {result?.domains?.length > 0 && (
        <Box sx={{ px: 3, pb: 1 }}>
          <Box sx={{ display: "grid", gridTemplateColumns: { xs: "1fr", md: "repeat(3, 1fr)" }, gap: 2 }}>
            {result.domains.map((d) => (
              <Box key={d.domain} sx={{ border: `1px solid ${C.fog}`, borderRadius: "4px", p: 2, background: CATEGORY_BG[d.category] || C.ghost }}>
                <Box sx={{ display: "flex", alignItems: "center", justifyContent: "space-between", mb: 1 }}>
                  <Typography sx={{ ...os({ fontSize: 11, color: C.charcoal, textTransform: "uppercase", letterSpacing: "0.05em" }) }}>{d.domain}</Typography>
                  <Chip label={d.category} size="small" sx={{ fontSize: 9.5, height: 18, background: CATEGORY_COLOR[d.category] || C.charcoal, color: C.white }} />
                </Box>
                {(d.reasons || []).map((r, i) => (
                  <Typography key={i} sx={{ ...os({ fontSize: 11, color: C.charcoal, lineHeight: 1.6 }) }}>• {r}</Typography>
                ))}
              </Box>
            ))}
          </Box>

          {result.narrative && (
            <Box sx={{ mt: 2, p: 1.75, borderRadius: "2px", background: C.ghost, border: `1px solid ${C.fog}` }}>
              <Typography sx={{ ...os({ fontSize: 10, color: C.silver, textTransform: "uppercase", letterSpacing: "0.07em", mb: 0.5 }) }}>AI Summary</Typography>
              <Typography sx={{ ...os({ fontSize: 12.5, color: C.charcoal, lineHeight: 1.6 }) }}>{result.narrative}</Typography>
            </Box>
          )}
        </Box>
      )}

      {!result && (
        <Box sx={{ p: 3, textAlign: "center" }}>
          <Typography sx={{ ...os({ fontSize: 12.5, color: C.ash }) }}>
            Review the auto-detected factors above, fill in the manual checklist, then click "Calculate Risk".
          </Typography>
        </Box>
      )}

      {/* Footer */}
      <Box sx={{ px: 3, py: 2, borderTop: `1px solid ${C.fog}`, background: C.ghost, display: "flex", alignItems: "center", justifyContent: "flex-end", gap: 1.5 }}>
        {saveMsg && <Typography sx={{ ...os({ fontSize: 12, color: saveMsg.includes("✅") ? "#2e7d32" : "#d32f2f" }) }}>{saveMsg}</Typography>}
        <Box component="button" type="button" onClick={handleSave} disabled={saving || !result?.domains?.length} sx={{ ...actionButton, minWidth: 200 }}>
          <SaveRounded sx={{ fontSize: 15 }} /> {saving ? "Saving..." : "Save Review"}
        </Box>
      </Box>

      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </Box>
  );
}