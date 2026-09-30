import React, { useState, useEffect, useCallback } from "react";
import { Box, Typography, Chip } from "@mui/material";
import {
  RefreshRounded,
  AutoAwesomeRounded,
  SaveRounded,
  CloseRounded,
  ScienceRounded,
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
  width: "100%", padding: "10px 14px", border: `1px solid ${C.mist}`,
  borderRadius: "2px", background: C.white, fontFamily: FONT, fontSize: "13px",
  fontWeight: 300, color: C.ink, outline: "none", boxSizing: "border-box",
};

const PRIORITY_COLOR = { Urgent: "#b3261e", Routine: C.charcoal };
const PRIORITY_BG = { Urgent: "#fbecea", Routine: C.ghost };
const STATUS_OPTIONS = ["Planned", "Ordered", "Resulted", "Cancelled"];

export default function RheumatologyInvestigationPlanner({ doctorId, patientId, patientName, onOrdersPlaced }) {
  const [differentialPreview, setDifferentialPreview] = useState(null);
  const [hasDifferential, setHasDifferential] = useState(false);
  const [additionalContext, setAdditionalContext] = useState("");
  const [investigations, setInvestigations] = useState([]);
  const [generating, setGenerating] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState("");
  const [genError, setGenError] = useState("");
  const [showDifferential, setShowDifferential] = useState(false);

  const loadDifferentialContext = useCallback(async () => {
    if (!patientId || !doctorId) return;
    try {
      const res = await fetch(`${API_BASE_URL}hms/users/data/context/rheumatology-investigation/differential-context/${patientId}/${doctorId}`);
      const json = await res.json();
      if (json?.status === "success") {
        setDifferentialPreview(json.data || null);
        setHasDifferential(Boolean(json.has_differential));
      }
    } catch (err) {
      console.error("Failed to load investigation planner differential context:", err);
    }
  }, [patientId, doctorId]);

  useEffect(() => {
    loadDifferentialContext();
    return subscribeRheumContextUpdate(loadDifferentialContext);
  }, [loadDifferentialContext]);

  const handleGenerate = async () => {
    setGenerating(true);
    setGenError("");
    try {
      const res = await fetch(`${API_BASE_URL}hms/users/data/context/rheumatology-investigation/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ doctor_id: doctorId, patient_id: patientId, additional_context: additionalContext }),
      });
      const json = await res.json();
      if (!res.ok || json?.status !== "success") throw new Error(json?.detail || "Failed to generate investigation plan");
      const items = (json.finaloutput?.investigations || []).map((it) => ({ ...it, status: "Planned" }));
      setInvestigations(items);
    } catch (err) {
      console.error("Investigation plan generation failed:", err);
      setGenError(err.message || "Failed to generate investigation plan");
    } finally {
      setGenerating(false);
    }
  };

  const removeItem = (idx) => setInvestigations((prev) => prev.filter((_, i) => i !== idx));

  const updateItem = (idx, patch) => {
    setInvestigations((prev) => {
      const items = [...prev];
      items[idx] = { ...items[idx], ...patch };
      return items;
    });
  };

  const togglePriority = (idx) => {
    setInvestigations((prev) => {
      const items = [...prev];
      const cur = items[idx].priority;
      items[idx] = { ...items[idx], priority: cur === "Urgent" ? "Routine" : "Urgent" };
      return items;
    });
  };

  const handleSave = async () => {
    if (investigations.length === 0) return;
    setSaving(true);
    setSaveMsg("");
    try {
      const res = await fetch(`${API_BASE_URL}hms/users/data/context/rheumatology-investigation/save`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          patient_id: patientId,
          doctor_id: doctorId,
          investigationPlan: { investigations },
          additionalContext: additionalContext,
        }),
      });
      const json = await res.json();
      if (!res.ok || json?.status !== "success") throw new Error(json?.detail || json?.message || "Save failed");
      setSaveMsg("✅ Investigation plan saved");
      window.dispatchEvent(new Event("refreshRheumatologyInvestigationHistory"));
      announceRheumContextUpdate("investigation-planner");
      if (typeof onOrdersPlaced === "function") onOrdersPlaced(investigations);
    } catch (err) {
      console.error("Investigation plan save failed:", err);
      setSaveMsg(`❌ ${err.message || "Save failed"}`);
    } finally {
      setSaving(false);
      setTimeout(() => setSaveMsg(""), 3000);
    }
  };

  const sortedInvestigations = [...investigations].sort((a, b) => (a.priority === "Urgent" ? -1 : 1) - (b.priority === "Urgent" ? -1 : 1));

  return (
    <Box sx={{ ...card, overflow: "hidden" }}>
      <Box sx={{ px: 3, py: 2.5, borderBottom: `1px solid ${C.fog}`, background: C.ghost, display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 1.5 }}>
        <Box>
          <Typography sx={{ ...os({ fontSize: 14, color: C.ink, letterSpacing: "0.02em" }) }}>Autoimmune Investigation Planner</Typography>
          <Typography sx={{ ...os({ fontSize: 11, color: C.ash, mt: 0.4 }) }}>
            {patientName ? `Why-this-test rationale, built from the saved differential — ${patientName}` : "Why-this-test rationale, built from the saved differential"}
          </Typography>
        </Box>
        <Chip label="Module 4 · Investigation Planner" size="small" sx={{ background: C.black, color: C.white, fontWeight: 300, fontSize: 10, letterSpacing: "0.04em", borderRadius: "2px", height: 22 }} />
      </Box>

      {/* Differential basis indicator */}
      <Box sx={{ mx: 3, mt: 2, p: 1.5, borderRadius: "2px", background: C.ghost, border: `1px solid ${C.fog}`, display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 1 }}>
        <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
          <Box sx={{ width: 7, height: 7, borderRadius: "50%", background: hasDifferential ? "#2e7d32" : C.silver }} />
          <Typography sx={{ ...os({ fontSize: 11, color: C.charcoal }) }}>
            {hasDifferential
              ? "Basis: saved differential diagnosis (Module 3) found"
              : "No saved differential found — complete Module 3 first"}
          </Typography>
        </Box>
        {hasDifferential && (
          <Box component="button" type="button" onClick={() => setShowDifferential((v) => !v)} sx={{ ...ghostButton, fontSize: 10, px: 1.25, py: 0.4 }}>
            {showDifferential ? "Hide details" : "View details"}
          </Box>
        )}
      </Box>

      {showDifferential && differentialPreview && (
        <Box sx={{ mx: 3, mt: 1, p: 1.5, borderRadius: "2px", background: C.white, border: `1px solid ${C.fog}` }}>
          {["likely", "possible", "must_not_miss"].map((tier) => {
            const items = differentialPreview.differential_diagnosis?.[tier] || [];
            if (!items.length) return null;
            return (
              <Box key={tier} sx={{ mb: 1 }}>
                <Typography sx={{ ...os({ fontSize: 10, color: C.silver, textTransform: "uppercase", letterSpacing: "0.07em", mb: 0.25 }) }}>
                  {tier.replace(/_/g, " ")}
                </Typography>
                {items.map((it, i) => (
                  <Typography key={i} sx={{ ...os({ fontSize: 11.5, color: C.charcoal }) }}>• {it.condition}</Typography>
                ))}
              </Box>
            );
          })}
        </Box>
      )}

      {/* Additional context + generate */}
      <Box sx={{ px: 3, pt: 2.5 }}>
        <Typography sx={{ ...os({ fontSize: 10, color: C.ash, textTransform: "uppercase", letterSpacing: "0.07em", mb: 0.75 }) }}>
          Additional Context (optional)
        </Typography>
        <textarea
          placeholder="Contraindications, tests already done elsewhere, patient preference, anything the plan should account for..."
          value={additionalContext}
          onChange={(e) => setAdditionalContext(e.target.value)}
          style={{ ...inputSx, minHeight: 60, resize: "vertical" }}
        />
        {genError && (
          <Typography sx={{ ...os({ fontSize: 12, color: "#b3261e", mt: 1 }) }}>{genError}</Typography>
        )}
        <Box sx={{ display: "flex", justifyContent: "flex-end", mt: 1.5 }}>
          <Box component="button" type="button" onClick={handleGenerate} disabled={generating || !hasDifferential} sx={{ ...actionButton, minWidth: 220 }}>
            {generating ? <RefreshRounded sx={{ fontSize: 15, animation: "spin 1s linear infinite" }} /> : <AutoAwesomeRounded sx={{ fontSize: 15 }} />}
            {generating ? "Generating..." : "Generate Investigation Plan"}
          </Box>
        </Box>
      </Box>

      {/* Results */}
      {sortedInvestigations.length > 0 ? (
        <Box sx={{ p: { xs: 2, sm: 3 }, display: "flex", flexDirection: "column", gap: 1.5 }}>
          {sortedInvestigations.map((item, idx) => {
            // find the original index (since we render a sorted copy)
            const originalIdx = investigations.indexOf(item);
            return (
              <Box key={`${item.test_name}-${idx}`} sx={{ border: `1px solid ${C.fog}`, borderRadius: "4px", overflow: "hidden" }}>
                <Box sx={{ px: 2, py: 1.25, display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 1.5, borderBottom: `1px solid ${C.fog}`, background: PRIORITY_BG[item.priority] }}>
                  <Box sx={{ flex: 1, minWidth: 0 }}>
                    <Box sx={{ display: "flex", alignItems: "center", gap: 1, flexWrap: "wrap" }}>
                      <ScienceRounded sx={{ fontSize: 15, color: PRIORITY_COLOR[item.priority] }} />
                      <Typography sx={{ ...os({ fontSize: 13, color: C.ink }) }}>{item.test_name}</Typography>
                      <Chip label={item.category} size="small" sx={{ fontSize: 9, height: 17, background: C.white, color: C.ash, border: `1px solid ${C.mist}` }} />
                    </Box>
                    <Box sx={{ display: "flex", gap: 0.5, flexWrap: "wrap", mt: 0.75 }}>
                      {(item.linked_conditions || []).map((cond) => (
                        <Chip key={cond} label={cond} size="small" sx={{ fontSize: 9.5, height: 18, background: C.ghost, color: C.charcoal, border: `1px solid ${C.mist}` }} />
                      ))}
                    </Box>
                    {(item.duplicate_check?.previously_ordered || item.duplicate_check?.previous_result_value != null) && (
                      <Box sx={{ display: "flex", flexDirection: "column", gap: 0.25, mt: 0.75 }}>
                        {item.duplicate_check?.previously_ordered && (
                          <Typography sx={{ ...os({ fontSize: 10.5, color: "#8a6d00" }) }}>
                            ⚠ Already ordered{item.duplicate_check.previous_ordered_date ? ` on ${item.duplicate_check.previous_ordered_date}` : ""} — status: {item.duplicate_check.previous_status}
                          </Typography>
                        )}
                        {item.duplicate_check?.previous_result_value != null && (
                          <Typography sx={{ ...os({ fontSize: 10.5, color: C.silver }) }}>
                            Previous result: {item.duplicate_check.previous_result_value}{item.duplicate_check.previous_result_date ? ` (${item.duplicate_check.previous_result_date})` : ""}
                          </Typography>
                        )}
                      </Box>
                    )}
                  </Box>
                  <Box sx={{ display: "flex", alignItems: "center", gap: 1, flexShrink: 0 }}>
                    <Box component="button" type="button" onClick={() => togglePriority(originalIdx)}
                      sx={{
                        border: `1px solid ${PRIORITY_COLOR[item.priority]}55`, borderRadius: "2px", background: "transparent",
                        color: PRIORITY_COLOR[item.priority], fontFamily: FONT, fontSize: 10, letterSpacing: "0.04em",
                        px: 1, py: 0.4, cursor: "pointer",
                      }}>
                      {item.priority}
                    </Box>
                    <Box component="button" type="button" onClick={() => removeItem(originalIdx)}
                      sx={{ border: "none", background: "transparent", cursor: "pointer", p: 0.25, color: C.silver, display: "flex" }}>
                      <CloseRounded sx={{ fontSize: 16 }} />
                    </Box>
                  </Box>
                </Box>
                <Box sx={{ p: 1.75, display: "flex", flexDirection: "column", gap: 1 }}>
                  <textarea
                    value={item.rationale}
                    onChange={(e) => updateItem(originalIdx, { rationale: e.target.value })}
                    style={{ ...inputSx, minHeight: 44, fontSize: 12, resize: "vertical" }}
                  />
                  <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
                    <Typography sx={{ ...os({ fontSize: 10, color: C.silver, textTransform: "uppercase", letterSpacing: "0.06em" }) }}>Status</Typography>
                    <select
                      value={item.status}
                      onChange={(e) => updateItem(originalIdx, { status: e.target.value })}
                      style={{ ...inputSx, width: 140, padding: "6px 10px", fontSize: 11.5 }}
                    >
                      {STATUS_OPTIONS.map((s) => <option key={s} value={s}>{s}</option>)}
                    </select>
                  </Box>
                </Box>
              </Box>
            );
          })}
        </Box>
      ) : (
        <Box sx={{ p: 4, textAlign: "center" }}>
          <Typography sx={{ ...os({ fontSize: 13, color: C.ash }) }}>
            No investigation plan generated yet.
          </Typography>
        </Box>
      )}

      {/* Footer */}
      <Box sx={{ px: 3, py: 2, borderTop: `1px solid ${C.fog}`, background: C.ghost, display: "flex", alignItems: "center", justifyContent: "flex-end", gap: 1.5 }}>
        {saveMsg && <Typography sx={{ ...os({ fontSize: 12, color: saveMsg.includes("✅") ? "#2e7d32" : "#d32f2f" }) }}>{saveMsg}</Typography>}
        <Box component="button" type="button" onClick={handleSave} disabled={saving || investigations.length === 0} sx={{ ...actionButton, minWidth: 200 }}>
          <SaveRounded sx={{ fontSize: 15 }} /> {saving ? "Saving..." : "Save Investigation Plan"}
        </Box>
      </Box>

      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </Box>
  );
}