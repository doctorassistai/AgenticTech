import React, { useState, useEffect, useCallback } from "react";
import { Box, Typography, Chip } from "@mui/material";
import {
  RefreshRounded,
  AutoAwesomeRounded,
  SaveRounded,
  CheckCircleRounded,
  RadioButtonUncheckedRounded,
  GavelRounded,
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
  width: "100%", padding: "10px 14px", border: `1px solid ${C.mist}`,
  borderRadius: "2px", background: C.white, fontFamily: FONT, fontSize: "13px",
  fontWeight: 300, color: C.ink, outline: "none", boxSizing: "border-box",
};

const RESPONSE_COLOR = {
  "Good response": "#2e7d32",
  "Moderate response": "#8a6d00",
  "No response": "#b3261e",
};

const Field = ({ label, children }) => (
  <Box sx={{ mb: 2 }}>
    <Typography sx={{ ...os({ fontSize: 10, color: C.ash, textTransform: "uppercase", letterSpacing: "0.07em", mb: 0.75 }) }}>
      {label}
    </Typography>
    {children}
  </Box>
);

export default function RheumatologyTreatmentDecision({ doctorId, patientId, patientName }) {
  const [context, setContext] = useState({
    matched_disease_key: null, matched_disease_label: null, matched_condition: null,
    prognostic_field_schema: [], current_medications: [],
    current_disease_activity: null, treatment_response: { response: "" }, safety_context: {},
  });
  const [prognosticValues, setPrognosticValues] = useState({});
  const [additionalContext, setAdditionalContext] = useState("");

  const updatePrognosticValue = (key, value) => {
    setPrognosticValues((prev) => ({ ...prev, [key]: value }));
  };
  const [options, setOptions] = useState([]);
  const [selected, setSelected] = useState(new Set());
  const [physicianNotes, setPhysicianNotes] = useState("");
  const [generating, setGenerating] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState("");
  const [genError, setGenError] = useState("");

  const loadContext = useCallback(async () => {
    if (!patientId || !doctorId) return;
    try {
      const res = await fetch(`${API_BASE_URL}hms/users/data/context/rheumatology-treatment/context-preview/${patientId}/${doctorId}`);
      const json = await res.json();
      if (json?.status === "success") {
        const data = json.data || {};
        setContext(data);
        const schema = data.prognostic_field_schema || [];
        const defaults = {};
        schema.forEach((f) => { defaults[f.key] = f.type === "number" ? 0 : "Unknown"; });
        setPrognosticValues(defaults);
      }
    } catch (err) {
      console.error("Failed to load treatment decision context:", err);
    }
  }, [patientId, doctorId]);

useEffect(() => {
    loadContext();
    return subscribeRheumContextUpdate(loadContext);
  }, [loadContext]);

  const handleGenerate = async () => {
    setGenerating(true);
    setGenError("");
    try {
      const res = await fetch(`${API_BASE_URL}hms/users/data/context/rheumatology-treatment/generate`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          doctor_id: doctorId, patient_id: patientId,
          prognostic_factors: prognosticValues,
          additional_context: additionalContext,
        }),
      });
      const json = await res.json();
      if (!res.ok || json?.status !== "success") throw new Error(json?.detail || "Failed to generate treatment options");
      setOptions(json.finaloutput?.options || []);
      setSelected(new Set());
      if (json.finaloutput?.matched_disease_key) {
        setContext((prev) => ({
          ...prev,
          matched_disease_key: json.finaloutput.matched_disease_key,
          matched_disease_label: json.finaloutput.matched_disease_label,
        }));
      }
    } catch (err) {
      console.error("Treatment options generation failed:", err);
      setGenError(err.message || "Failed to generate treatment options");
    } finally {
      setGenerating(false);
    }
  };

  const toggleSelected = (option) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(option)) next.delete(option); else next.add(option);
      return next;
    });
  };

  const handleSave = async () => {
    if (options.length === 0) return;
    setSaving(true);
    setSaveMsg("");
    try {
      const res = await fetch(`${API_BASE_URL}hms/users/data/context/rheumatology-treatment/save`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          patient_id: patientId, doctor_id: doctorId,
          matched_disease_key: context.matched_disease_key,
          options_presented: options,
          selected_options: Array.from(selected),
          physician_notes: physicianNotes,
          prognostic_factors: prognosticValues,
        }),
      });
      const json = await res.json();
      if (!res.ok || json?.status !== "success") throw new Error(json?.detail || json?.message || "Save failed");
      setSaveMsg("✅ Treatment decision review saved");
      window.dispatchEvent(new Event("refreshRheumatologyTreatmentHistory"));
      announceRheumContextUpdate("treatment-decision");
    } catch (err) {
      console.error("Treatment decision save failed:", err);
      setSaveMsg(`❌ ${err.message || "Save failed"}`);
    } finally {
      setSaving(false);
      setTimeout(() => setSaveMsg(""), 3000);
    }
  };

  const responseInfo = context.treatment_response || {};
  const responseColor = RESPONSE_COLOR[responseInfo.response] || C.charcoal;

  return (
    <Box sx={{ ...card, overflow: "hidden" }}>
      <Box sx={{ px: 3, py: 2.5, borderBottom: `1px solid ${C.fog}`, background: C.ghost, display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 1.5 }}>
        <Box>
          <Typography sx={{ ...os({ fontSize: 14, color: C.ink, letterSpacing: "0.02em" }) }}>Treatment Decision Engine</Typography>
          <Typography sx={{ ...os({ fontSize: 11, color: C.ash, mt: 0.4 }) }}>
            {context.matched_disease_label
              ? (patientName ? `${context.matched_disease_label} — options for physician review, ${patientName}` : `${context.matched_disease_label} — options for physician review`)
              : (patientName ? `Options for physician review, ${patientName}` : "Options for physician review")}
          </Typography>
        </Box>
        <Chip label="Module 7 · Treatment Decision" size="small" sx={{ background: C.black, color: C.white, fontWeight: 300, fontSize: 10, letterSpacing: "0.04em", borderRadius: "2px", height: 22 }} />
      </Box>

     {/* Disease gate + pipeline context */}
      <Box sx={{ mx: 3, mt: 2, p: 1.5, borderRadius: "2px", background: C.ghost, border: `1px solid ${C.fog}` }}>
        <Box sx={{ display: "flex", alignItems: "center", gap: 1, mb: 1 }}>
          <Box sx={{ width: 7, height: 7, borderRadius: "50%", background: context.matched_disease_key ? "#2e7d32" : "#b3261e" }} />
          <Typography sx={{ ...os({ fontSize: 11, color: C.charcoal }) }}>
            {context.matched_disease_key
              ? `${context.matched_disease_label} confirmed in saved differential (matched: "${context.matched_condition}") — module active`
              : "No supported condition (RA / PsA / Axial SpA / SLE / Gout) found in saved differential — complete Module 3 first"}
          </Typography>
        </Box>
        <Typography sx={{ ...os({ fontSize: 11, color: C.ash, mb: 0.5 }) }}>
          Current therapy: {context.current_medications?.length ? context.current_medications.join(", ") : "none on record"}
        </Typography>
        {context.current_disease_activity && (
          <Typography sx={{ ...os({ fontSize: 11, color: C.ash, mb: 0.5 }) }}>
            Latest disease activity ({context.current_disease_activity.date}): {Object.entries(context.current_disease_activity.scores || {}).map(([k, v]) => `${k.toUpperCase().replace("_", "-")} ${v.value} (${v.category})`).join(" · ")}
          </Typography>
        )}
        {responseInfo.response && (
          <Chip label={`Response: ${responseInfo.response}`} size="small" sx={{ fontSize: 10, height: 20, background: `${responseColor}18`, color: responseColor, mt: 0.5 }} />
        )}
      </Box>

     {/* Prognostic inputs — rendered from server-provided schema for the matched disease */}
      <Box sx={{ p: 3, display: "grid", gridTemplateColumns: { xs: "1fr", md: "1fr 1fr 1fr" }, gap: 2, columnGap: 3 }}>
        {(context.prognostic_field_schema || []).map((f) => (
          <Field key={f.key} label={f.label}>
            {f.type === "select" ? (
              <select style={inputSx} value={prognosticValues[f.key] ?? "Unknown"} onChange={(e) => updatePrognosticValue(f.key, e.target.value)}>
                {(f.options || ["Unknown", "Yes", "No"]).map((opt) => (
                  <option key={opt} value={opt}>{opt}</option>
                ))}
              </select>
            ) : (
              <input type="number" min={f.min ?? 0} style={inputSx} value={prognosticValues[f.key] ?? 0} onChange={(e) => updatePrognosticValue(f.key, Number(e.target.value) || 0)} />
            )}
          </Field>
        ))}
      </Box>

      <Box sx={{ px: 3, pb: 2 }}>
        <Field label="Additional Context (optional)">
          <textarea
            placeholder="Patient preference, cost/access concerns, prior drug intolerances not captured elsewhere..."
            value={additionalContext}
            onChange={(e) => setAdditionalContext(e.target.value)}
            style={{ ...inputSx, minHeight: 60, resize: "vertical" }}
          />
        </Field>
        {genError && <Typography sx={{ ...os({ fontSize: 12, color: "#b3261e", mb: 1 }) }}>{genError}</Typography>}
        <Box sx={{ display: "flex", justifyContent: "flex-end" }}>
          <Box component="button" type="button" onClick={handleGenerate} disabled={generating || !context.matched_disease_key} sx={{ ...actionButton, minWidth: 220 }}>
            {generating ? <RefreshRounded sx={{ fontSize: 15, animation: "spin 1s linear infinite" }} /> : <AutoAwesomeRounded sx={{ fontSize: 15 }} />}
            {generating ? "Generating..." : "Generate Treatment Options"}
          </Box>
        </Box>
      </Box>

      {/* Options */}
      {options.length > 0 ? (
        <Box sx={{ p: { xs: 2, sm: 3 }, display: "flex", flexDirection: "column", gap: 1.5 }}>
          <Typography sx={{ ...os({ fontSize: 11, color: C.ash, mb: 0.5 }) }}>
            These are options for your review, not a recommendation — select any you intend to act on before saving.
          </Typography>
          {options.map((opt, idx) => {
            const isSelected = selected.has(opt.option);
            return (
              <Box key={`${opt.option}-${idx}`} sx={{ border: `1px solid ${isSelected ? C.black : C.fog}`, borderRadius: "4px", overflow: "hidden" }}>
                <Box
                  onClick={() => toggleSelected(opt.option)}
                  sx={{ px: 2, py: 1.5, display: "flex", alignItems: "flex-start", gap: 1.25, cursor: "pointer", background: isSelected ? C.ghost : C.white }}
                >
                  {isSelected ? <CheckCircleRounded sx={{ fontSize: 18, color: C.black, mt: 0.1 }} /> : <RadioButtonUncheckedRounded sx={{ fontSize: 18, color: C.silver, mt: 0.1 }} />}
                  <Box sx={{ flex: 1 }}>
                    <Typography sx={{ ...os({ fontSize: 13, color: C.ink }) }}>{opt.option}</Typography>
                    <Typography sx={{ ...os({ fontSize: 12, color: C.charcoal, mt: 0.5, lineHeight: 1.5 }) }}>{opt.reason}</Typography>
                  </Box>
                </Box>
                <Box sx={{ px: 2, pb: 1.75, display: "flex", flexDirection: "column", gap: 1 }}>
                  {opt.supporting_factors?.length > 0 && (
                    <Box>
                      <Typography sx={{ ...os({ fontSize: 9.5, color: C.silver, textTransform: "uppercase", letterSpacing: "0.06em", mb: 0.25 }) }}>Supporting Factors</Typography>
                      {opt.supporting_factors.map((f, i) => (
                        <Typography key={i} sx={{ ...os({ fontSize: 11.5, color: C.charcoal }) }}>• {f}</Typography>
                      ))}
                    </Box>
                  )}
                  {opt.patient_specific_risks?.length > 0 && (
                    <Box sx={{ p: 1, borderRadius: "2px", background: "#fbecea" }}>
                      <Box sx={{ display: "flex", alignItems: "center", gap: 0.5, mb: 0.25 }}>
                        <WarningAmberRounded sx={{ fontSize: 13, color: "#b3261e" }} />
                        <Typography sx={{ ...os({ fontSize: 9.5, color: "#b3261e", textTransform: "uppercase", letterSpacing: "0.06em" }) }}>Patient-Specific Risk</Typography>
                      </Box>
                      {opt.patient_specific_risks.map((r, i) => (
                        <Typography key={i} sx={{ ...os({ fontSize: 11.5, color: "#8a1f1a" }) }}>• {r}</Typography>
                      ))}
                    </Box>
                  )}
                  {opt.general_class_risk && (
                    <Typography sx={{ ...os({ fontSize: 11, color: C.silver, fontStyle: "italic" }) }}>
                      General class caution: {opt.general_class_risk}
                    </Typography>
                  )}
                  <Box sx={{ display: "flex", alignItems: "center", gap: 0.5, mt: 0.5 }}>
                    <GavelRounded sx={{ fontSize: 12, color: C.silver }} />
                    <Typography sx={{ ...os({ fontSize: 10, color: C.silver }) }}>{opt.guideline_reference}</Typography>
                  </Box>
                </Box>
              </Box>
            );
          })}

          <Field label="Physician Notes (optional)">
            <textarea
              placeholder="Your own reasoning for the decision made today..."
              value={physicianNotes}
              onChange={(e) => setPhysicianNotes(e.target.value)}
              style={{ ...inputSx, minHeight: 60, resize: "vertical" }}
            />
          </Field>
        </Box>
      ) : (
        <Box sx={{ p: 4, textAlign: "center" }}>
          <Typography sx={{ ...os({ fontSize: 13, color: C.ash }) }}>
            No treatment options generated yet.
          </Typography>
        </Box>
      )}

      {/* Footer */}
      <Box sx={{ px: 3, py: 2, borderTop: `1px solid ${C.fog}`, background: C.ghost, display: "flex", alignItems: "center", justifyContent: "flex-end", gap: 1.5 }}>
        {saveMsg && <Typography sx={{ ...os({ fontSize: 12, color: saveMsg.includes("✅") ? "#2e7d32" : "#d32f2f" }) }}>{saveMsg}</Typography>}
        <Box component="button" type="button" onClick={handleSave} disabled={saving || options.length === 0} sx={{ ...actionButton, minWidth: 220 }}>
          <SaveRounded sx={{ fontSize: 15 }} /> {saving ? "Saving..." : "Save Decision Review"}
        </Box>
      </Box>

      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </Box>
  );
}