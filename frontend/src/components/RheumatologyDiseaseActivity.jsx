import React, { useState, useEffect, useCallback } from "react";
import { Box, Typography, Chip } from "@mui/material";
import {
  RefreshRounded,
  CalculateRounded,
  SaveRounded,
  TrackChangesRounded,
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
  width: "100%", padding: "10px 14px", border: `1px solid ${C.mist}`,
  borderRadius: "2px", background: C.white, fontFamily: FONT, fontSize: "13px",
  fontWeight: 300, color: C.ink, outline: "none", boxSizing: "border-box",
};

const CATEGORY_COLOR = {
  Remission: "#2e7d32",
  Low: "#8a6d00",
  Moderate: "#c26b1e",
  High: "#b3261e",
};
const CATEGORY_BG = {
  Remission: "#eef7ee",
  Low: "#fbf6e3",
  Moderate: "#fdf0e4",
  High: "#fbecea",
};

const SCORE_META = {
  das28_esr: { label: "DAS28-ESR", max: 10 },
  das28_crp: { label: "DAS28-CRP", max: 10 },
  cdai: { label: "CDAI", max: 76 },
  sdai: { label: "SDAI", max: 86 },
  basdai: { label: "BASDAI", max: 10 },
  asdas: { label: "ASDAS", max: 5 },
  sledai: { label: "SLEDAI-2K", max: 20 },
};

const SLEDAI_DESCRIPTORS = [
  ["seizure", "Seizure"], ["psychosis", "Psychosis"], ["organic_brain_syndrome", "Organic brain syndrome"],
  ["visual_disturbance", "Visual disturbance"], ["cranial_nerve_disorder", "Cranial nerve disorder"],
  ["lupus_headache", "Lupus headache"], ["cva", "CVA"], ["vasculitis", "Vasculitis"],
  ["arthritis", "Arthritis"], ["myositis", "Myositis"], ["urinary_casts", "Urinary casts"],
  ["hematuria", "Hematuria"], ["proteinuria", "Proteinuria"], ["pyuria", "Pyuria"],
  ["new_rash", "New rash"], ["alopecia", "Alopecia"], ["mucosal_ulcers", "Mucosal ulcers"],
  ["pleurisy", "Pleurisy"], ["pericarditis", "Pericarditis"], ["low_complement", "Low complement"],
  ["increased_dsdna", "Increased dsDNA"], ["fever", "Fever"], ["thrombocytopenia", "Thrombocytopenia"],
  ["leukopenia", "Leukopenia"],
];

const Field = ({ label, children }) => (
  <Box sx={{ mb: 2 }}>
    <Typography sx={{ ...os({ fontSize: 10, color: C.ash, textTransform: "uppercase", letterSpacing: "0.07em", mb: 0.75 }) }}>
      {label}
    </Typography>
    {children}
  </Box>
);

const ScoreGauge = ({ scoreKey, data }) => {
  const meta = SCORE_META[scoreKey];
  if (!data) {
    return (
      <Box sx={{ border: `1px solid ${C.fog}`, borderRadius: "4px", p: 2, opacity: 0.5 }}>
        <Typography sx={{ ...os({ fontSize: 11, color: C.silver, textTransform: "uppercase", letterSpacing: "0.06em" }) }}>{meta.label}</Typography>
        <Typography sx={{ ...os({ fontSize: 12, color: C.silver, mt: 1 }) }}>Not available — missing CRP/ESR</Typography>
      </Box>
    );
  }
  const { value, category } = data;
  const pct = Math.min(100, Math.max(0, (value / meta.max) * 100));
  const color = CATEGORY_COLOR[category] || C.charcoal;
  const bg = CATEGORY_BG[category] || C.ghost;
  return (
    <Box sx={{ border: `1px solid ${C.fog}`, borderRadius: "4px", p: 2, background: bg }}>
      <Box sx={{ display: "flex", alignItems: "center", justifyContent: "space-between", mb: 1 }}>
        <Typography sx={{ ...os({ fontSize: 11, color: C.charcoal, textTransform: "uppercase", letterSpacing: "0.06em" }) }}>{meta.label}</Typography>
        <Chip label={category} size="small" sx={{ fontSize: 9.5, height: 18, background: color, color: C.white }} />
      </Box>
      <Typography sx={{ ...os({ fontSize: 26, color: C.ink, mb: 1 }) }}>{value}</Typography>
      <Box sx={{ height: 6, borderRadius: 3, background: C.white, border: `1px solid ${C.fog}`, overflow: "hidden" }}>
        <Box sx={{ height: "100%", width: `${pct}%`, background: color, transition: "width 0.3s ease" }} />
      </Box>
    </Box>
  );
};

const EMPTY_RESULT = { tender_joint_count: null, swollen_joint_count: null, scores: {}, inputs_used: {}, narrative: null };

export default function RheumatologyDiseaseActivity({ doctorId, patientId, patientName }) {
  const [context, setContext] = useState({ joint_counts: {}, crp: null, esr: null, previous: null });
  const [hasJointData, setHasJointData] = useState(false);
  const [ptga, setPtga] = useState("");
  const [pga, setPga] = useState("");
  const [tjcOverride, setTjcOverride] = useState("");
  const [sjcOverride, setSjcOverride] = useState("");
  const [target, setTarget] = useState("Remission");
  const [basdai, setBasdai] = useState({ q1_fatigue: "", q2_spinal_pain: "", q3_peripheral_pain: "", q4_enthesitis: "", q5_stiffness_severity: "", q6_stiffness_duration: "" });
  const [asdas, setAsdas] = useState({ back_pain: "", morning_stiffness_duration: "", patient_global: "", peripheral_pain_swelling: "" });
  const [sledaiDescriptors, setSledaiDescriptors] = useState({});
  const [result, setResult] = useState(EMPTY_RESULT);
  const [calculating, setCalculating] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState("");
  const [calcError, setCalcError] = useState("");

  const loadContext = useCallback(async () => {
    if (!patientId || !doctorId) return;
    try {
      const res = await fetch(`${API_BASE_URL}hms/users/data/context/rheumatology-disease-activity/context-preview/${patientId}/${doctorId}`);
      const json = await res.json();
      if (json?.status === "success") {
        setContext(json.data || { joint_counts: {}, crp: null, esr: null, previous: null });
        setHasJointData(Boolean(json.has_joint_data));
      }
    } catch (err) {
      console.error("Failed to load disease activity context:", err);
    }
  }, [patientId, doctorId]);

useEffect(() => {
    loadContext();
    return subscribeRheumContextUpdate(loadContext);
  }, [loadContext]);
  const handleCalculate = async () => {
    setCalcError("");
    const ptgaNum = Number(ptga);
    const pgaNum = Number(pga);
    if (ptga === "" || ptgaNum < 0 || ptgaNum > 100) { setCalcError("Patient Global Assessment must be 0-100."); return; }
    if (pga === "" || pgaNum < 0 || pgaNum > 10) { setCalcError("Physician Global Assessment must be 0-10."); return; }

    setCalculating(true);
    try {
      const body = {
        doctor_id: doctorId, patient_id: patientId,
        patient_global_assessment: ptgaNum, physician_global_assessment: pgaNum,
      };
      if (tjcOverride !== "") body.tender_joint_count = Number(tjcOverride);
      if (sjcOverride !== "") body.swollen_joint_count = Number(sjcOverride);

      const basdaiComplete = Object.values(basdai).every((v) => v !== "");
      if (basdaiComplete) body.basdai = Object.fromEntries(Object.entries(basdai).map(([k, v]) => [k, Number(v)]));

      const asdasComplete = Object.values(asdas).every((v) => v !== "");
      if (asdasComplete) body.asdas = Object.fromEntries(Object.entries(asdas).map(([k, v]) => [k, Number(v)]));

      if (Object.keys(sledaiDescriptors).length > 0) body.sledai_descriptors = sledaiDescriptors;

      const res = await fetch(`${API_BASE_URL}hms/users/data/context/rheumatology-disease-activity/calculate`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
      });
      const json = await res.json();
      if (!res.ok || json?.status !== "success") throw new Error(json?.detail || "Failed to calculate disease activity");
      setResult(json.finaloutput || EMPTY_RESULT);
    } catch (err) {
      console.error("Disease activity calculation failed:", err);
      setCalcError(err.message || "Failed to calculate disease activity");
    } finally {
      setCalculating(false);
    }
  };

  const hasAnyScore = Object.values(result.scores || {}).some(Boolean);

  const handleSave = async () => {
    if (!hasAnyScore) return;
    setSaving(true);
    setSaveMsg("");
    try {
      const res = await fetch(`${API_BASE_URL}hms/users/data/context/rheumatology-disease-activity/save`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          patient_id: patientId, doctor_id: doctorId,
          scores: result.scores, inputs_used: result.inputs_used,
          narrative: result.narrative || "", target,
        }),
      });
      const json = await res.json();
      if (!res.ok || json?.status !== "success") throw new Error(json?.detail || json?.message || "Save failed");
      setSaveMsg("✅ Disease activity assessment saved");
      window.dispatchEvent(new Event("refreshRheumatologyDiseaseActivityHistory"));
      announceRheumContextUpdate("disease-activity");
      loadContext();
    } catch (err) {
      console.error("Disease activity save failed:", err);
      setSaveMsg(`❌ ${err.message || "Save failed"}`);
    } finally {
      setSaving(false);
      setTimeout(() => setSaveMsg(""), 3000);
    }
  };

  const jc = context.joint_counts || {};

  return (
    <Box sx={{ ...card, overflow: "hidden" }}>
      <Box sx={{ px: 3, py: 2.5, borderBottom: `1px solid ${C.fog}`, background: C.ghost, display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 1.5 }}>
        <Box>
          <Typography sx={{ ...os({ fontSize: 14, color: C.ink, letterSpacing: "0.02em" }) }}>Disease Activity Engine</Typography>
          <Typography sx={{ ...os({ fontSize: 11, color: C.ash, mt: 0.4 }) }}>
            {patientName ? `DAS28 / CDAI / SDAI — ${patientName}` : "DAS28 / CDAI / SDAI"}
          </Typography>
        </Box>
        <Chip label="Module 6 · Disease Activity" size="small" sx={{ background: C.black, color: C.white, fontWeight: 300, fontSize: 10, letterSpacing: "0.04em", borderRadius: "2px", height: 22 }} />
      </Box>

      {/* Auto-derived context */}
      <Box sx={{ mx: 3, mt: 2, p: 1.5, borderRadius: "2px", background: C.ghost, border: `1px solid ${C.fog}` }}>
        <Box sx={{ display: "flex", alignItems: "center", gap: 1, mb: 0.75 }}>
          <Box sx={{ width: 7, height: 7, borderRadius: "50%", background: hasJointData ? "#2e7d32" : C.silver }} />
          <Typography sx={{ ...os({ fontSize: 11, color: C.charcoal }) }}>
            {hasJointData
              ? `Joint counts from Module 2: ${jc.tender_joint_count} tender / ${jc.swollen_joint_count} swollen`
              : "No joint map found — complete Module 2 first, or enter counts manually below"}
          </Typography>
        </Box>
        <Typography sx={{ ...os({ fontSize: 11, color: C.ash }) }}>
          CRP: {context.crp ? `${context.crp.value} mg/L (${context.crp.date})` : "not recorded"} · ESR: {context.esr ? `${context.esr.value} mm/hr (${context.esr.date})` : "not recorded"}
        </Typography>
      </Box>

      {/* Inputs */}
      <Box sx={{ p: 3, display: "grid", gridTemplateColumns: { xs: "1fr", md: "1fr 1fr" }, gap: 2, columnGap: 3 }}>
        <Field label="Patient Global Assessment — 0 to 100 (VAS)">
          <input type="number" min={0} max={100} style={inputSx} value={ptga} onChange={(e) => setPtga(e.target.value)} placeholder="e.g. 45" />
        </Field>
        <Field label="Physician Global Assessment — 0 to 10 (VAS)">
          <input type="number" min={0} max={10} style={inputSx} value={pga} onChange={(e) => setPga(e.target.value)} placeholder="e.g. 4" />
        </Field>
        <Field label={`Tender Joint Count override (auto: ${jc.tender_joint_count ?? "—"})`}>
          <input type="number" min={0} max={28} style={inputSx} value={tjcOverride} onChange={(e) => setTjcOverride(e.target.value)} placeholder="Leave blank to use Module 2" />
        </Field>
        <Field label={`Swollen Joint Count override (auto: ${jc.swollen_joint_count ?? "—"})`}>
          <input type="number" min={0} max={28} style={inputSx} value={sjcOverride} onChange={(e) => setSjcOverride(e.target.value)} placeholder="Leave blank to use Module 2" />
        </Field>
      </Box>

      {(context.applicable_score_groups || []).includes("axial_spa") && (
        <Box sx={{ px: 3, pb: 1 }}>
          <Typography sx={{ ...os({ fontSize: 11, color: C.ash, textTransform: "uppercase", letterSpacing: "0.07em", mb: 1.5 }) }}>
            BASDAI / ASDAS — axial involvement suspected from working diagnosis
          </Typography>
          <Box sx={{ display: "grid", gridTemplateColumns: { xs: "1fr", md: "1fr 1fr" }, gap: 2, columnGap: 3, mb: 1 }}>
            {[
              ["q1_fatigue", "Fatigue (0-10)"], ["q2_spinal_pain", "Spinal Pain (0-10)"],
              ["q3_peripheral_pain", "Peripheral Joint Pain/Swelling (0-10)"], ["q4_enthesitis", "Localized Tenderness / Enthesitis (0-10)"],
              ["q5_stiffness_severity", "Morning Stiffness Severity (0-10)"], ["q6_stiffness_duration", "Morning Stiffness Duration (0-10, 0=none, 10=2+hrs)"],
            ].map(([key, label]) => (
              <Field key={key} label={label}>
                <input type="number" min={0} max={10} style={inputSx} value={basdai[key]} onChange={(e) => setBasdai((prev) => ({ ...prev, [key]: e.target.value }))} />
              </Field>
            ))}
          </Box>
          <Box sx={{ display: "grid", gridTemplateColumns: { xs: "1fr", md: "1fr 1fr" }, gap: 2, columnGap: 3 }}>
            {[
              ["back_pain", "Back Pain, last week (0-10)"], ["morning_stiffness_duration", "Morning Stiffness Duration (0-10)"],
              ["patient_global", "Patient Global Assessment, ASDAS scale (0-10)"], ["peripheral_pain_swelling", "Peripheral Pain/Swelling (0-10)"],
            ].map(([key, label]) => (
              <Field key={key} label={label}>
                <input type="number" min={0} max={10} style={inputSx} value={asdas[key]} onChange={(e) => setAsdas((prev) => ({ ...prev, [key]: e.target.value }))} />
              </Field>
            ))}
          </Box>
          <Typography sx={{ ...os({ fontSize: 10, color: C.silver, mt: 0.5 }) }}>
            ASDAS uses CRP if on file, otherwise falls back to ESR — see current values above.
          </Typography>
        </Box>
      )}

      {(context.applicable_score_groups || []).includes("sle") && (
        <Box sx={{ px: 3, pb: 1 }}>
          <Typography sx={{ ...os({ fontSize: 11, color: C.ash, textTransform: "uppercase", letterSpacing: "0.07em", mb: 1.5 }) }}>
            SLEDAI-2K — descriptors present in the last 10 days
          </Typography>
          <Box sx={{ display: "flex", flexWrap: "wrap", gap: 0.75 }}>
            {SLEDAI_DESCRIPTORS.map(([key, label]) => {
              const active = Boolean(sledaiDescriptors[key]);
              return (
                <Chip
                  key={key}
                  label={label}
                  onClick={() => setSledaiDescriptors((prev) => ({ ...prev, [key]: !prev[key] }))}
                  size="small"
                  sx={{
                    fontSize: 11, borderRadius: "2px", cursor: "pointer",
                    background: active ? C.black : C.ghost,
                    color: active ? C.white : C.charcoal,
                    border: `1px solid ${active ? C.black : C.mist}`,
                  }}
                />
              );
            })}
          </Box>
        </Box>
      )}

      {calcError && <Typography sx={{ ...os({ fontSize: 12, color: "#b3261e", mx: 3, mb: 1 }) }}>{calcError}</Typography>}

      <Box sx={{ px: 3, pb: 2, display: "flex", justifyContent: "flex-end" }}>
        <Box component="button" type="button" onClick={handleCalculate} disabled={calculating} sx={{ ...actionButton, minWidth: 200 }}>
          {calculating ? <RefreshRounded sx={{ fontSize: 15, animation: "spin 1s linear infinite" }} /> : <CalculateRounded sx={{ fontSize: 15 }} />}
          {calculating ? "Calculating..." : "Calculate Disease Activity"}
        </Box>
      </Box>

      {/* Previous → Current → Target */}
      {hasAnyScore && (
        <Box sx={{ px: 3, pb: 1 }}>
          <Box sx={{ display: "flex", alignItems: "center", gap: 1, mb: 1.5 }}>
            <TrackChangesRounded sx={{ fontSize: 15, color: C.smoke }} />
            <Typography sx={{ ...os({ fontSize: 11, color: C.ash, textTransform: "uppercase", letterSpacing: "0.07em" }) }}>Treat-to-Target</Typography>
            <Box sx={{ ml: "auto" }}>
              <select value={target} onChange={(e) => setTarget(e.target.value)} style={{ ...inputSx, width: 200, padding: "6px 10px", fontSize: 11.5 }}>
                <option value="Remission">Target: Remission</option>
                <option value="Low disease activity">Target: Low disease activity</option>
              </select>
            </Box>
          </Box>

          <Box sx={{ display: "grid", gridTemplateColumns: { xs: "1fr", sm: "repeat(2, 1fr)", lg: "repeat(4, 1fr)" }, gap: 2 }}>
            {["das28_esr", "das28_crp", "cdai", "sdai"].map((k) => (
              <ScoreGauge key={k} scoreKey={k} data={result.scores?.[k]} />
            ))}
            {(context.applicable_score_groups || []).includes("axial_spa") && (
              <>
                <ScoreGauge scoreKey="basdai" data={result.scores?.basdai} />
                <ScoreGauge scoreKey="asdas" data={result.scores?.asdas} />
              </>
            )}
            {(context.applicable_score_groups || []).includes("sle") && (
              <ScoreGauge scoreKey="sledai" data={result.scores?.sledai} />
            )}
          </Box>

          {context.previous?.scores && (
            <Typography sx={{ ...os({ fontSize: 11, color: C.silver, mt: 1.5 }) }}>
              Previous assessment ({context.previous.date}): {Object.entries(context.previous.scores).map(([k, v]) => `${SCORE_META[k]?.label || k} ${v.value} (${v.category})`).join(" · ")}
            </Typography>
          )}

          {result.narrative && (
            <Box sx={{ mt: 2, p: 1.75, borderRadius: "2px", background: C.ghost, border: `1px solid ${C.fog}` }}>
              <Typography sx={{ ...os({ fontSize: 10, color: C.silver, textTransform: "uppercase", letterSpacing: "0.07em", mb: 0.5 }) }}>AI Trend Summary</Typography>
              <Typography sx={{ ...os({ fontSize: 12.5, color: C.charcoal, lineHeight: 1.6 }) }}>{result.narrative}</Typography>
            </Box>
          )}
        </Box>
      )}

      {!hasAnyScore && (
        <Box sx={{ p: 4, textAlign: "center" }}>
          <Typography sx={{ ...os({ fontSize: 13, color: C.ash }) }}>
            Enter Patient/Physician Global Assessment above and click "Calculate Disease Activity".
          </Typography>
        </Box>
      )}

      {/* Footer */}
      <Box sx={{ px: 3, py: 2, borderTop: `1px solid ${C.fog}`, background: C.ghost, display: "flex", alignItems: "center", justifyContent: "flex-end", gap: 1.5 }}>
        {saveMsg && <Typography sx={{ ...os({ fontSize: 12, color: saveMsg.includes("✅") ? "#2e7d32" : "#d32f2f" }) }}>{saveMsg}</Typography>}
        <Box component="button" type="button" onClick={handleSave} disabled={saving || !hasAnyScore} sx={{ ...actionButton, minWidth: 200 }}>
          <SaveRounded sx={{ fontSize: 15 }} /> {saving ? "Saving..." : "Save Assessment"}
        </Box>
      </Box>

      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </Box>
  );
}