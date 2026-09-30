import React, { useState, useEffect, useCallback } from "react";
import { Box, Typography, Chip } from "@mui/material";
import {
  RefreshRounded,
  SaveRounded,
  DashboardCustomizeRounded,
  TrendingUpRounded,
  TrendingDownRounded,
  TrendingFlatRounded,
} from "@mui/icons-material";
import { THEMES } from "../dashboard/themes";
import { subscribeRheumContextUpdate } from "../dashboard/rheumatologyContextBus";

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
  padding: "7px 10px", border: `1px solid ${C.mist}`,
  borderRadius: "2px", background: C.white, fontFamily: FONT, fontSize: "12px",
  fontWeight: 300, color: C.ink, outline: "none", boxSizing: "border-box",
};

const TREND_META = {
  worsening: { icon: TrendingUpRounded, color: "#b3261e", bg: "#fbecea", label: "Worsening" },
  improving: { icon: TrendingDownRounded, color: "#2e7d32", bg: "#eef7ee", label: "Improving" },
  stable: { icon: TrendingFlatRounded, color: "#8a6d00", bg: "#fbf6e3", label: "Stable" },
};

const CATEGORY_COLOR = { green: "#2e7d32", yellow: "#8a6d00", red: "#b3261e" };

const RECOMMENDATION_COLOR = {
  "Safety review recommended": "#b3261e",
  "Review escalation options": "#c26b1e",
  "Continue current plan": "#2e7d32",
  "Reassess at next follow-up": "#8a6d00",
};

const Panel = ({ label, children }) => (
  <Box sx={{ border: `1px solid ${C.fog}`, borderRadius: "4px", p: 1.75, background: C.white }}>
    <Typography sx={{ ...os({ fontSize: 10, color: C.ash, textTransform: "uppercase", letterSpacing: "0.07em", mb: 1 }) }}>{label}</Typography>
    {children}
  </Box>
);

const formatDate = (d) => {
  if (!d) return "—";
  try { return new Date(d).toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" }); }
  catch { return d; }
};

export default function RheumatologyTreatToTarget({ doctorId, patientId, patientName }) {
  const [dashboard, setDashboard] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const [target, setTarget] = useState("Remission");
  const [nextReviewDate, setNextReviewDate] = useState("");
  const [targetSaving, setTargetSaving] = useState(false);

  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState("");

  const loadDashboard = useCallback(async () => {
    if (!patientId || !doctorId) return;
    setLoading(true);
    setError("");
    try {
      const res = await fetch(`${API_BASE_URL}hms/users/data/context/rheumatology-treat-to-target/dashboard/${patientId}/${doctorId}`);
      const json = await res.json();
      if (!res.ok || json?.status !== "success") throw new Error(json?.detail || "Failed to load treat-to-target dashboard");
      setDashboard(json.finaloutput);
      setTarget(json.finaloutput?.target || "Remission");
      setNextReviewDate(json.finaloutput?.next_review_date || "");
    } catch (err) {
      console.error("Failed to load treat-to-target dashboard:", err);
      setError(err.message || "Failed to load treat-to-target dashboard");
    } finally {
      setLoading(false);
    }
  }, [patientId, doctorId]);

useEffect(() => {
    loadDashboard();
    return subscribeRheumContextUpdate(loadDashboard);
  }, [loadDashboard]);
  
  const handleSetTarget = async () => {
    setTargetSaving(true);
    try {
      const res = await fetch(`${API_BASE_URL}hms/users/data/context/rheumatology-treat-to-target/set-target`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ patient_id: patientId, doctor_id: doctorId, target, next_review_date: nextReviewDate || null }),
      });
      const json = await res.json();
      if (!res.ok || json?.status !== "success") throw new Error(json?.detail || "Failed to update target");
      loadDashboard();
    } catch (err) {
      console.error("Set target failed:", err);
    } finally {
      setTargetSaving(false);
    }
  };

  const handleSaveSnapshot = async () => {
    if (!dashboard) return;
    setSaving(true);
    setSaveMsg("");
    try {
      const res = await fetch(`${API_BASE_URL}hms/users/data/context/rheumatology-treat-to-target/save-snapshot`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ patient_id: patientId, doctor_id: doctorId, snapshot: dashboard }),
      });
      const json = await res.json();
      if (!res.ok || json?.status !== "success") throw new Error(json?.detail || json?.message || "Save failed");
      setSaveMsg("✅ Snapshot saved");
      window.dispatchEvent(new Event("refreshRheumatologyTreatToTargetHistory"));
    } catch (err) {
      console.error("Save snapshot failed:", err);
      setSaveMsg(`❌ ${err.message || "Save failed"}`);
    } finally {
      setSaving(false);
      setTimeout(() => setSaveMsg(""), 3000);
    }
  };

  const trendKey = dashboard?.disease_activity?.trend;
  const TrendIcon = trendKey ? TREND_META[trendKey]?.icon : null;
  const currentScores = dashboard?.disease_activity?.current?.scores || {};
  const previousScores = dashboard?.disease_activity?.previous?.scores || {};
  const metricUsed = dashboard?.disease_activity?.metric_used;

  return (
    <Box sx={{ ...card, overflow: "hidden" }}>
      <Box sx={{ px: 3, py: 2.5, borderBottom: `1px solid ${C.fog}`, background: C.ghost, display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 1.5 }}>
        <Box>
          <Typography sx={{ ...os({ fontSize: 14, color: C.ink, letterSpacing: "0.02em" }) }}>Treat-to-Target Dashboard</Typography>
          <Typography sx={{ ...os({ fontSize: 11, color: C.ash, mt: 0.4 }) }}>
            {patientName ? `One-screen rollup — ${patientName}` : "One-screen rollup"}
          </Typography>
        </Box>
        <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
          <Chip label="Module 15 · Treat-to-Target" size="small" sx={{ background: C.black, color: C.white, fontWeight: 300, fontSize: 10, letterSpacing: "0.04em", borderRadius: "2px", height: 22 }} />
          <Box component="button" type="button" onClick={loadDashboard} disabled={loading} sx={{ background: "transparent", border: "none", cursor: "pointer", display: "flex", alignItems: "center", p: 0.5 }}>
            <RefreshRounded sx={{ fontSize: 16, color: C.ash, animation: loading ? "spin 1s linear infinite" : "none" }} />
          </Box>
        </Box>
      </Box>

      {error && (
        <Box sx={{ p: 3, textAlign: "center" }}><Typography sx={{ ...os({ fontSize: 13, color: "#b3261e" }) }}>{error}</Typography></Box>
      )}

      {!error && dashboard && (
        <>
          {/* Disease / Target / Next Review strip */}
          <Box sx={{ mx: 3, mt: 2.5, p: 1.75, borderRadius: "2px", background: C.ghost, border: `1px solid ${C.fog}`, display: "flex", flexWrap: "wrap", gap: 2, alignItems: "center" }}>
            <Box sx={{ minWidth: 160 }}>
              <Typography sx={{ ...os({ fontSize: 10, color: C.ash, textTransform: "uppercase", letterSpacing: "0.06em" }) }}>Disease</Typography>
              <Typography sx={{ ...os({ fontSize: 13, color: C.ink, mt: 0.25 }) }}>{dashboard.working_diagnosis || "Not yet established"}</Typography>
            </Box>
            <Box>
              <Typography sx={{ ...os({ fontSize: 10, color: C.ash, textTransform: "uppercase", letterSpacing: "0.06em", mb: 0.4 }) }}>Target</Typography>
              <select style={inputSx} value={target} onChange={(e) => setTarget(e.target.value)}>
                <option value="Remission">Remission</option>
                <option value="Low disease activity">Low disease activity</option>
              </select>
            </Box>
            <Box>
              <Typography sx={{ ...os({ fontSize: 10, color: C.ash, textTransform: "uppercase", letterSpacing: "0.06em", mb: 0.4 }) }}>Next Review</Typography>
              <input type="date" style={inputSx} value={nextReviewDate} onChange={(e) => setNextReviewDate(e.target.value)} />
            </Box>
            <Box component="button" type="button" onClick={handleSetTarget} disabled={targetSaving} sx={{ ...actionButton, minWidth: 90, py: 0.75, fontSize: 11, ml: "auto" }}>
              {targetSaving ? "Saving..." : "Update"}
            </Box>
          </Box>

          {/* Rollup grid */}
          <Box sx={{ p: 3, display: "grid", gridTemplateColumns: { xs: "1fr", md: "1fr 1fr" }, gap: 1.75 }}>
            <Panel label="Current Disease Activity">
              {Object.keys(currentScores).length > 0 ? (
                <>
                  <Box sx={{ display: "flex", flexWrap: "wrap", gap: 0.75, mb: 1 }}>
                    {Object.entries(currentScores).map(([k, v]) => (
                      <Chip key={k} label={`${k.replace(/_/g, "-").toUpperCase()}: ${v.value} (${v.category})`} size="small" sx={{ fontSize: 10, height: 22, background: C.ghost, color: C.charcoal, border: `1px solid ${C.mist}` }} />
                    ))}
                  </Box>
                  {trendKey && (
                    <Box sx={{ display: "inline-flex", alignItems: "center", gap: 0.5, px: 1, py: 0.4, borderRadius: "2px", background: TREND_META[trendKey]?.bg, mt: 0.5 }}>
                      {TrendIcon && <TrendIcon sx={{ fontSize: 15, color: TREND_META[trendKey]?.color }} />}
                      <Typography sx={{ ...os({ fontSize: 11, color: TREND_META[trendKey]?.color }) }}>
                        {TREND_META[trendKey]?.label}{metricUsed ? ` (${metricUsed.replace(/_/g, "-").toUpperCase()})` : ""}
                      </Typography>
                    </Box>
                  )}
                  {Object.keys(previousScores).length > 0 && (
                    <Typography sx={{ ...os({ fontSize: 10.5, color: C.silver, mt: 0.75 }) }}>
                      Previous ({formatDate(dashboard.disease_activity?.previous?.date)}): {Object.entries(previousScores).map(([k, v]) => `${k.replace(/_/g, "-").toUpperCase()} ${v.value}`).join(" · ")}
                    </Typography>
                  )}
                </>
              ) : (
                <Typography sx={{ ...os({ fontSize: 12, color: C.silver }) }}>No disease activity assessment recorded yet (Module 6).</Typography>
              )}
            </Panel>

            <Panel label="Current Treatment & Response">
              <Typography sx={{ ...os({ fontSize: 12, color: C.charcoal, mb: 0.75 }) }}>
                {dashboard.current_treatment?.medications?.length ? dashboard.current_treatment.medications.join(", ") : "No active prescriptions on record"}
              </Typography>
              <Box sx={{ display: "flex", gap: 0.75, flexWrap: "wrap" }}>
                <Chip label={`Response: ${dashboard.current_treatment?.response || "Not recorded"}`} size="small" sx={{ fontSize: 10, height: 22, background: C.ghost, color: C.charcoal, border: `1px solid ${C.mist}` }} />
                <Chip label={dashboard.current_treatment?.guideline_pathway || "EULAR treat-to-target"} size="small" sx={{ fontSize: 10, height: 22, background: C.ghost, color: C.charcoal, border: `1px solid ${C.mist}` }} />
              </Box>
            </Panel>

            <Panel label="Safety">
              {dashboard.safety?.flags?.length > 0 ? (
                <Box sx={{ display: "flex", flexWrap: "wrap", gap: 0.75 }}>
                  {dashboard.safety.flags.map((f, i) => (
                    <Chip key={i} label={`${f.label} (${f.source}): ${f.category}`} size="small" sx={{ fontSize: 10, height: 22, background: `${CATEGORY_COLOR[f.category]}18`, color: CATEGORY_COLOR[f.category], border: `1px solid ${CATEGORY_COLOR[f.category]}44` }} />
                  ))}
                </Box>
              ) : (
                <Typography sx={{ ...os({ fontSize: 12, color: "#2e7d32" }) }}>No active safety flags</Typography>
              )}
              <Typography sx={{ ...os({ fontSize: 10, color: C.silver, mt: 0.75 }) }}>
                DMARD safety {dashboard.safety?.assessed?.dmard_safety ? "assessed" : "not assessed yet"} · Steroid stewardship {dashboard.safety?.assessed?.steroid_stewardship ? "assessed" : "not assessed yet"}
              </Typography>
            </Panel>

            <Panel label="Flare Risk">
              {dashboard.flare_risk ? (
                <>
                  <Chip label={dashboard.flare_risk.category || "Not categorized"} size="small" sx={{ fontSize: 10, height: 22, background: C.ghost, color: C.charcoal, border: `1px solid ${C.mist}`, mb: dashboard.flare_risk.factors?.length ? 0.75 : 0 }} />
                  {(dashboard.flare_risk.factors || []).map((f, i) => (
                    <Typography key={i} sx={{ ...os({ fontSize: 11, color: C.charcoal }) }}>• {f}</Typography>
                  ))}
                </>
              ) : (
                <Typography sx={{ ...os({ fontSize: 12, color: C.silver }) }}>No flare prediction recorded yet (Module 10).</Typography>
              )}
            </Panel>

            <Panel label="Patient Summary">
              <Typography sx={{ ...os({ fontSize: 12, color: C.charcoal, mb: 0.5 }) }}>
                Condition: {dashboard.patient_summary?.condition || "Not yet established"}
              </Typography>
              <Typography sx={{ ...os({ fontSize: 12, color: C.charcoal, mb: 0.5 }) }}>
                Onset (as recorded at intake): {dashboard.patient_summary?.disease_duration || "Not recorded"}
              </Typography>
              <Typography sx={{ ...os({ fontSize: 12, color: C.charcoal, mb: 0.75 }) }}>
                Allergies: {dashboard.patient_summary?.allergies || "Not captured in current workflow"}
              </Typography>
              {dashboard.patient_summary?.comorbidities?.length > 0 ? (
                <Box sx={{ display: "flex", flexWrap: "wrap", gap: 0.5 }}>
                  {dashboard.patient_summary.comorbidities.map((c, i) => (
                    <Chip key={i} label={c} size="small" sx={{ fontSize: 10, height: 20, background: C.ghost, color: C.charcoal, border: `1px solid ${C.mist}` }} />
                  ))}
                </Box>
              ) : (
                <Typography sx={{ ...os({ fontSize: 11.5, color: C.silver }) }}>No comorbidities recorded at intake</Typography>
              )}
              {dashboard.patient_summary?.comorbidity_risk_domains?.length > 0 && (
                <Box sx={{ display: "flex", gap: 0.5, flexWrap: "wrap", mt: 1 }}>
                  {dashboard.patient_summary.comorbidity_risk_domains.map((d, i) => {
                    const riskColor = { Low: "#2e7d32", Moderate: "#8a6d00", High: "#b3261e" }[d.category] || C.charcoal;
                    return (
                      <Chip key={i} label={`${d.domain}: ${d.category}`} size="small" sx={{ fontSize: 10, height: 20, background: `${riskColor}18`, color: riskColor, border: `1px solid ${riskColor}44` }} />
                    );
                  })}
                </Box>
              )}
            </Panel>

            <Panel label="Laboratory">
              {dashboard.laboratory ? (
                <>
                  <Typography sx={{ ...os({ fontSize: 10.5, color: C.silver, mb: 0.75 }) }}>
                    Latest Biomarker Analysis ({formatDate(dashboard.laboratory.date)})
                  </Typography>
                  {dashboard.laboratory.numeric_flags?.length > 0 && (
                    <Box sx={{ display: "flex", flexWrap: "wrap", gap: 0.5, mb: 0.75 }}>
                      {dashboard.laboratory.numeric_flags.map((f, i) => (
                        <Chip key={i} label={`${f.test_name}: ${f.value}${f.unit ? " " + f.unit : ""} (${f.flag})`} size="small"
                          sx={{ fontSize: 10, height: 20, background: f.flag === "normal" ? C.ghost : "#fdecea", color: f.flag === "normal" ? C.charcoal : "#b3261e", border: `1px solid ${C.mist}` }} />
                      ))}
                    </Box>
                  )}
                  {dashboard.laboratory.qualitative_summary?.length > 0 && (
                    <Box sx={{ display: "flex", flexWrap: "wrap", gap: 0.5 }}>
                      {dashboard.laboratory.qualitative_summary.map((m, i) => (
                        <Chip key={i} label={`${m.marker_name}: ${m.result}`} size="small" sx={{ fontSize: 10, height: 20, background: C.ghost, color: C.charcoal, border: `1px solid ${C.mist}` }} />
                      ))}
                    </Box>
                  )}
                  {!dashboard.laboratory.numeric_flags?.length && !dashboard.laboratory.qualitative_summary?.length && (
                    <Typography sx={{ ...os({ fontSize: 12, color: C.silver }) }}>No biomarker data on the latest saved analysis.</Typography>
                  )}
                </>
              ) : (
                <Typography sx={{ ...os({ fontSize: 12, color: C.silver }) }}>No Biomarker Analysis saved yet.</Typography>
              )}
            </Panel>

            <Panel label="Imaging">
              {dashboard.imaging ? (
                dashboard.imaging.source === "comparison" ? (
                  <Box sx={{ display: "flex", flexDirection: "column", gap: 0.5 }}>
                    <Typography sx={{ ...os({ fontSize: 10.5, color: C.silver, mb: 0.25 }) }}>
                      Latest saved comparison ({formatDate(dashboard.imaging.date)})
                    </Typography>
                    {(dashboard.imaging.comparisons || []).map((c, i) => (
                      <Typography key={i} sx={{ ...os({ fontSize: 11.5, color: C.charcoal }) }}>
                        {c.region}: {c.direction}{c.cross_modality ? " (cross-modality)" : ""}
                      </Typography>
                    ))}
                  </Box>
                ) : (
                  <Box>
                    <Typography sx={{ ...os({ fontSize: 10.5, color: C.silver, mb: 0.25 }) }}>
                      Latest logged study ({formatDate(dashboard.imaging.date)}) — no comparison saved yet
                    </Typography>
                    <Typography sx={{ ...os({ fontSize: 12, color: C.charcoal }) }}>
                      {dashboard.imaging.modality} — {dashboard.imaging.region}
                    </Typography>
                  </Box>
                )
              ) : (
                <Typography sx={{ ...os({ fontSize: 12, color: C.silver }) }}>No imaging studies logged yet.</Typography>
              )}
            </Panel>
          </Box>

          {/* Recommendation + narrative */}
          <Box sx={{ px: 3, pb: 3, display: "flex", flexDirection: "column", gap: 1.5 }}>
            <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
              <DashboardCustomizeRounded sx={{ fontSize: 16, color: RECOMMENDATION_COLOR[dashboard.recommendation] || C.charcoal }} />
              <Typography sx={{ ...os({ fontSize: 13, color: RECOMMENDATION_COLOR[dashboard.recommendation] || C.ink }) }}>
                AI Recommendation: {dashboard.recommendation}
              </Typography>
            </Box>
            {dashboard.narrative && (
              <Box sx={{ p: 1.75, borderRadius: "2px", background: C.ghost, border: `1px solid ${C.fog}` }}>
                <Typography sx={{ ...os({ fontSize: 10, color: C.silver, textTransform: "uppercase", letterSpacing: "0.07em", mb: 0.5 }) }}>AI Summary</Typography>
                <Typography sx={{ ...os({ fontSize: 12.5, color: C.charcoal, lineHeight: 1.6 }) }}>{dashboard.narrative}</Typography>
              </Box>
            )}
          </Box>
        </>
      )}

      {/* Footer */}
      <Box sx={{ px: 3, py: 2, borderTop: `1px solid ${C.fog}`, background: C.ghost, display: "flex", alignItems: "center", justifyContent: "flex-end", gap: 1.5 }}>
        {saveMsg && <Typography sx={{ ...os({ fontSize: 12, color: saveMsg.includes("✅") ? "#2e7d32" : "#d32f2f" }) }}>{saveMsg}</Typography>}
        <Box component="button" type="button" onClick={handleSaveSnapshot} disabled={saving || !dashboard} sx={{ ...actionButton, minWidth: 190 }}>
          <SaveRounded sx={{ fontSize: 15 }} /> {saving ? "Saving..." : "Save Snapshot"}
        </Box>
      </Box>

      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </Box>
  );
}