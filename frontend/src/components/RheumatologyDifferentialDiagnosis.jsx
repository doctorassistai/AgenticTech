import React, { useState, useEffect, useCallback } from "react";
import { Box, Typography, Chip } from "@mui/material";
import {
  RefreshRounded,
  AutoAwesomeRounded,
  SaveRounded,
  CloseRounded,
  StarRounded,
  StarBorderRounded,
  WarningAmberRounded,
  CheckCircleRounded,
  CancelRounded,
  HelpOutlineRounded,
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

const TIERS = [
  { key: "likely", label: "Likely", accent: "#2e7d32", bg: "#eef7ee" },
  { key: "possible", label: "Possible", accent: "#8a6d00", bg: "#fbf6e3" },
  { key: "must_not_miss", label: "Must Not Miss", accent: "#b3261e", bg: "#fbecea" },
];

const TRIAGE_COLOR = {
  "Urgent": "#b3261e",
  "High Priority": "#c26b1e",
  "Routine Rheumatology": "#2e7d32",
  "Low Risk / Non-rheumatological pattern": C.charcoal,
};
const TRIAGE_BG = {
  "Urgent": "#fbecea",
  "High Priority": "#fdf0e4",
  "Routine Rheumatology": "#eef7ee",
  "Low Risk / Non-rheumatological pattern": C.ghost,
};

const EMPTY_RESULT = { likely: [], possible: [], must_not_miss: [] };

export default function RheumatologyDifferentialDiagnosis({ doctorId, patientId, patientName, onApprove }) {
  const [contextPreview, setContextPreview] = useState({ intake: {}, joint_map: {} });
  const [hasContext, setHasContext] = useState(false);
  const [additionalFindings, setAdditionalFindings] = useState("");
  const [result, setResult] = useState(EMPTY_RESULT);
  const [workingDiagnosis, setWorkingDiagnosis] = useState("");
  const [triage, setTriage] = useState(null);
  const [generating, setGenerating] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState("");
  const [genError, setGenError] = useState("");
  const [showContext, setShowContext] = useState(false);
  // Doctor's answers to per-condition clarifying questions.
  // Keyed by `${condition}::${questionId}` → answer string ("yes" | "no" | free text).
  const [clarifyingAnswers, setClarifyingAnswers] = useState({});

  const loadContextPreview = useCallback(async () => {
    if (!patientId || !doctorId) return;
    try {
      const res = await fetch(`${API_BASE_URL}hms/users/data/context/rheumatology-differential/context-preview/${patientId}/${doctorId}`);
      const json = await res.json();
      if (json?.status === "success") {
        setContextPreview(json.data || { intake: {}, joint_map: {} });
        setHasContext(Boolean(json.has_data));
      }
    } catch (err) {
      console.error("Failed to load differential context preview:", err);
    }
  }, [patientId, doctorId]);

useEffect(() => {
    loadContextPreview();
    return subscribeRheumContextUpdate(loadContextPreview);
  }, [loadContextPreview]);

 const handleGenerate = async (findingsOverride) => {
    const findingsToSend = findingsOverride !== undefined ? findingsOverride : additionalFindings;
    setGenerating(true);
    setGenError("");
    try {
      const res = await fetch(`${API_BASE_URL}hms/users/data/context/rheumatology-differential/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ doctor_id: doctorId, patient_id: patientId, additional_findings: findingsToSend }),
      });
      const json = await res.json();
      if (!res.ok || json?.status !== "success") throw new Error(json?.detail || "Failed to generate differential");
      if (findingsOverride !== undefined) setAdditionalFindings(findingsOverride);
      setResult({ ...EMPTY_RESULT, ...(json.finaloutput || {}) });
      setWorkingDiagnosis("");
      setTriage(json.finaloutput?.triage || null);
      // Fresh generation → previous answers no longer map to anything meaningful.
      setClarifyingAnswers({});
    } catch (err) {
      console.error("Differential generation failed:", err);
      setGenError(err.message || "Failed to generate differential diagnosis");
    } finally {
      setGenerating(false);
    }
  };

  const removeCondition = (tierKey, idx) => {
    setResult((prev) => ({ ...prev, [tierKey]: prev[tierKey].filter((_, i) => i !== idx) }));
  };

  const updateEvidenceText = (tierKey, idx, text) => {
    setResult((prev) => {
      const items = [...prev[tierKey]];
      items[idx] = { ...items[idx], evidence: text.split("\n").map((s) => s.trim()).filter(Boolean) };
      return { ...prev, [tierKey]: items };
    });
  };

  const toggleWorkingDiagnosis = (condition) => {
    setWorkingDiagnosis((prev) => (prev === condition ? "" : condition));
  };

  const answerKey = (condition, questionId) => `${condition}::${questionId}`;

  const setClarifyingAnswer = (condition, questionId, value) => {
    setClarifyingAnswers((prev) => ({ ...prev, [answerKey(condition, questionId)]: value }));
  };

  const hasAnyResult = TIERS.some((t) => result[t.key]?.length > 0);

  const hasAnyAnsweredQuestion = TIERS.some((t) =>
    (result[t.key] || []).some((item) =>
      (item.clarifying_questions || []).some((q) => {
        const v = clarifyingAnswers[answerKey(item.condition, q.id)];
        return v !== undefined && String(v).trim() !== "";
      })
    )
  );

  // Compiles every answered clarifying question into plain text so it can be
  // sent back through the same "additional_findings" channel the engine
  // already trusts — this way the AI never has to guess these facts, and
  // the answers show up in the audit trail (context_used) exactly like any
  // other dictated finding.
  const buildRefinementText = () => {
    const lines = [];
    TIERS.forEach((t) => {
      (result[t.key] || []).forEach((item) => {
        (item.clarifying_questions || []).forEach((q) => {
          const raw = clarifyingAnswers[answerKey(item.condition, q.id)];
          if (raw === undefined || String(raw).trim() === "") return;
          const answerLabel = q.type === "yes_no" ? (raw === "yes" ? "Yes" : "No") : raw;
          lines.push(`Regarding ${item.condition} — ${q.question} Answer: ${answerLabel}`);
        });
      });
    });
    return lines.join("\n");
  };

  const handleRefine = () => {
    const refinementText = buildRefinementText();
    if (!refinementText) return;
    const combined = additionalFindings?.trim()
      ? `${additionalFindings.trim()}\n${refinementText}`
      : refinementText;
    handleGenerate(combined);
  };

  const buildDifferentialForSave = () => {
    const out = {};
    TIERS.forEach((t) => {
      out[t.key] = (result[t.key] || []).map((item) => {
        const clarifying_answers = {};
        (item.clarifying_questions || []).forEach((q) => {
          const raw = clarifyingAnswers[answerKey(item.condition, q.id)];
          if (raw !== undefined && String(raw).trim() !== "") {
            clarifying_answers[q.id] = q.type === "yes_no" ? (raw === "yes" ? "yes" : "no") : raw;
          }
        });
        return { ...item, clarifying_answers };
      });
    });
    return out;
  };

  const handleSave = async () => {
    if (!hasAnyResult) return;
    setSaving(true);
    setSaveMsg("");
    try {
      const res = await fetch(`${API_BASE_URL}hms/users/data/context/rheumatology-differential/save`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          patient_id: patientId,
          doctor_id: doctorId,
          differentialDiagnosis: buildDifferentialForSave(),
          workingDiagnosis,
          additionalFindings,
          triage,
        }),
      });
      const json = await res.json();
      if (!res.ok || json?.status !== "success") throw new Error(json?.detail || json?.message || "Save failed");
      setSaveMsg("✅ Differential diagnosis saved");
      window.dispatchEvent(new Event("refreshRheumatologyDifferentialHistory"));
      announceRheumContextUpdate("differential");
      if (workingDiagnosis && typeof onApprove === "function") {
        onApprove(workingDiagnosis);
      }
    } catch (err) {
      console.error("Differential save failed:", err);
      setSaveMsg(`❌ ${err.message || "Save failed"}`);
    } finally {
      setSaving(false);
      setTimeout(() => setSaveMsg(""), 3000);
    }
  };

  const contextChipLabel = hasContext
    ? [
        Object.keys(contextPreview.intake || {}).length ? "Intake" : null,
        Object.keys(contextPreview.joint_map || {}).length ? "Joint Map" : null,
      ].filter(Boolean).join(" + ") || "Context available"
    : "No Module 1/2 data yet";

  return (
    <Box sx={{ ...card, overflow: "hidden" }}>
      <Box sx={{ px: 3, py: 2.5, borderBottom: `1px solid ${C.fog}`, background: C.ghost, display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 1.5 }}>
        <Box>
          <Typography sx={{ ...os({ fontSize: 14, color: C.ink, letterSpacing: "0.02em" }) }}>Differential Diagnosis Engine</Typography>
          <Typography sx={{ ...os({ fontSize: 11, color: C.ash, mt: 0.4 }) }}>
            {patientName ? `Likely → Possible → Must not miss — ${patientName}` : "Likely → Possible → Must not miss"}
          </Typography>
        </Box>
        <Chip label="Module 3 · Differential Diagnosis" size="small" sx={{ background: C.black, color: C.white, fontWeight: 300, fontSize: 10, letterSpacing: "0.04em", borderRadius: "2px", height: 22 }} />
      </Box>

      {/* Context indicator */}
      <Box sx={{ mx: 3, mt: 2, p: 1.5, borderRadius: "2px", background: C.ghost, border: `1px solid ${C.fog}`, display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 1 }}>
        <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
          <Box sx={{ width: 7, height: 7, borderRadius: "50%", background: hasContext ? "#2e7d32" : C.silver }} />
          <Typography sx={{ ...os({ fontSize: 11, color: C.charcoal }) }}>
            Basis for generation: <strong style={{ fontWeight: 400 }}>{contextChipLabel}</strong>
          </Typography>
        </Box>
        <Box component="button" type="button" onClick={() => setShowContext((v) => !v)} sx={{ ...ghostButton, fontSize: 10, px: 1.25, py: 0.4 }}>
          {showContext ? "Hide details" : "View details"}
        </Box>
      </Box>

      {showContext && (
        <Box sx={{ mx: 3, mt: 1, p: 1.5, borderRadius: "2px", background: C.white, border: `1px solid ${C.fog}` }}>
          <Typography sx={{ ...os({ fontSize: 10, color: C.silver, textTransform: "uppercase", letterSpacing: "0.07em", mb: 0.5 }) }}>From Intake</Typography>
          <Typography sx={{ ...os({ fontSize: 11.5, color: C.charcoal, mb: 1.5, whiteSpace: "pre-wrap" }) }}>
            {Object.keys(contextPreview.intake || {}).length ? JSON.stringify(contextPreview.intake, null, 2) : "No intake record found."}
          </Typography>
          <Typography sx={{ ...os({ fontSize: 10, color: C.silver, textTransform: "uppercase", letterSpacing: "0.07em", mb: 0.5 }) }}>From Joint Map</Typography>
          <Typography sx={{ ...os({ fontSize: 11.5, color: C.charcoal, whiteSpace: "pre-wrap" }) }}>
            {Object.keys(contextPreview.joint_map || {}).length ? JSON.stringify(contextPreview.joint_map, null, 2) : "No joint map record found."}
          </Typography>
        </Box>
      )}

      {/* Additional findings + generate */}
      <Box sx={{ px: 3, pt: 2.5 }}>
        <Typography sx={{ ...os({ fontSize: 10, color: C.ash, textTransform: "uppercase", letterSpacing: "0.07em", mb: 0.75 }) }}>
          Additional Findings (optional)
        </Typography>
        <textarea
          placeholder="Anything not yet captured in Intake or Joint Map — e.g. a rash, dry eyes, Raynaud's, a family member's diagnosis mentioned today..."
          value={additionalFindings}
          onChange={(e) => setAdditionalFindings(e.target.value)}
          style={{ ...inputSx, minHeight: 70, resize: "vertical" }}
        />
        {genError && (
          <Typography sx={{ ...os({ fontSize: 12, color: "#b3261e", mt: 1 }) }}>{genError}</Typography>
        )}
        <Box sx={{ display: "flex", justifyContent: "flex-end", mt: 1.5 }}>
          <Box component="button" type="button" onClick={handleGenerate} disabled={generating || (!hasContext && !additionalFindings.trim())} sx={{ ...actionButton, minWidth: 220 }}>
            {generating ? <RefreshRounded sx={{ fontSize: 15, animation: "spin 1s linear infinite" }} /> : <AutoAwesomeRounded sx={{ fontSize: 15 }} />}
            {generating ? "Generating..." : "Generate Differential"}
          </Box>
        </Box>
      </Box>

      {/* Working diagnosis banner */}
      {workingDiagnosis && (
        <Box sx={{ mx: 3, mt: 2.5, p: 1.5, borderRadius: "2px", background: "#eef7ee", border: "1px solid #2e7d3244", display: "flex", alignItems: "center", gap: 1 }}>
          <StarRounded sx={{ fontSize: 16, color: "#2e7d32" }} />
          <Typography sx={{ ...os({ fontSize: 12, color: "#1b4d1e" }) }}>
            Working diagnosis: <strong style={{ fontWeight: 400 }}>{workingDiagnosis}</strong> — will be saved and pushed to Diagnosis on save.
          </Typography>
        </Box>
      )}

      {/* Triage banner */}
      {triage && (
        <Box sx={{ mx: 3, mt: 2, p: 1.5, borderRadius: "2px", background: TRIAGE_BG[triage.category] || C.ghost, border: `1px solid ${TRIAGE_COLOR[triage.category] || C.mist}44`, display: "flex", gap: 1, alignItems: "flex-start" }}>
          <WarningAmberRounded sx={{ fontSize: 16, color: TRIAGE_COLOR[triage.category] || C.charcoal, mt: 0.15 }} />
          <Box>
            <Typography sx={{ ...os({ fontSize: 12, color: TRIAGE_COLOR[triage.category] || C.ink }) }}>
              Triage: <strong style={{ fontWeight: 400 }}>{triage.category}</strong>
            </Typography>
            {triage.rationale && (
              <Typography sx={{ ...os({ fontSize: 11.5, color: C.charcoal, mt: 0.25 }) }}>{triage.rationale}</Typography>
            )}
          </Box>
        </Box>
      )}

      {/* Results — three tiers */}
      {hasAnyResult ? (
        <Box sx={{ p: { xs: 2, sm: 3 }, display: "grid", gridTemplateColumns: { xs: "1fr", lg: "repeat(3, 1fr)" }, gap: 2 }}>
          {TIERS.map((tier) => (
            <Box key={tier.key} sx={{ border: `1px solid ${C.fog}`, borderRadius: "4px", overflow: "hidden" }}>
              <Box sx={{ px: 2, py: 1.25, background: tier.bg, borderBottom: `1px solid ${C.fog}` }}>
                <Typography sx={{ ...os({ fontSize: 12, color: tier.accent, letterSpacing: "0.03em" }) }}>
                  {tier.label} ({result[tier.key]?.length || 0})
                </Typography>
              </Box>
              <Box sx={{ p: 1.5, display: "flex", flexDirection: "column", gap: 1.25 }}>
                {(result[tier.key] || []).length === 0 && (
                  <Typography sx={{ ...os({ fontSize: 11.5, color: C.silver, textAlign: "center", py: 2 }) }}>None</Typography>
                )}
                {(result[tier.key] || []).map((item, idx) => {
                  const isWorking = workingDiagnosis === item.condition;
                  return (
                    <Box key={`${item.condition}-${idx}`} sx={{ border: `1px solid ${isWorking ? tier.accent : C.fog}`, borderRadius: "2px", p: 1.5, background: C.white }}>
                      <Box sx={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 1 }}>
                        <Typography sx={{ ...os({ fontSize: 12.5, color: C.ink, flex: 1 }) }}>{item.condition}</Typography>
                        <Box sx={{ display: "flex", gap: 0.25, flexShrink: 0 }}>
                          <Box component="button" type="button" onClick={() => toggleWorkingDiagnosis(item.condition)}
                            title="Mark as working diagnosis"
                            sx={{ border: "none", background: "transparent", cursor: "pointer", p: 0.25, color: isWorking ? tier.accent : C.silver, display: "flex" }}>
                            {isWorking ? <StarRounded sx={{ fontSize: 16 }} /> : <StarBorderRounded sx={{ fontSize: 16 }} />}
                          </Box>
                          <Box component="button" type="button" onClick={() => removeCondition(tier.key, idx)}
                            title="Remove"
                            sx={{ border: "none", background: "transparent", cursor: "pointer", p: 0.25, color: C.silver, display: "flex" }}>
                            <CloseRounded sx={{ fontSize: 15 }} />
                          </Box>
                        </Box>
                      </Box>
                      {item.confidence_note && (
                        <Typography sx={{ ...os({ fontSize: 10, color: C.silver, fontStyle: "italic", mt: 0.25 }) }}>
                          {item.confidence_note}
                        </Typography>
                      )}
                      <textarea
                        value={(item.evidence || []).join("\n")}
                        onChange={(e) => updateEvidenceText(tier.key, idx, e.target.value)}
                        style={{ ...inputSx, marginTop: 8, minHeight: 54, fontSize: 11.5, resize: "vertical" }}
                      />

                      {(item.clarifying_questions || []).length > 0 && (
                        <Box sx={{ mt: 1.25, pt: 1.25, borderTop: `1px dashed ${C.fog}`, display: "flex", flexDirection: "column", gap: 1 }}>
                          <Box sx={{ display: "flex", alignItems: "center", gap: 0.5 }}>
                            <HelpOutlineRounded sx={{ fontSize: 13, color: C.silver }} />
                            <Typography sx={{ ...os({ fontSize: 10, color: C.silver, textTransform: "uppercase", letterSpacing: "0.06em" }) }}>
                              Ask the patient
                            </Typography>
                          </Box>
                          {item.clarifying_questions.map((q) => {
                            const currentAnswer = clarifyingAnswers[answerKey(item.condition, q.id)];
                            return (
                              <Box key={q.id}>
                                <Typography sx={{ ...os({ fontSize: 11.5, color: C.charcoal, mb: 0.5 }) }}>{q.question}</Typography>
                                {q.type === "yes_no" ? (
                                  <Box sx={{ display: "flex", gap: 0.75 }}>
                                    <Box
                                      component="button" type="button"
                                      onClick={() => setClarifyingAnswer(item.condition, q.id, "yes")}
                                      sx={{
                                        ...ghostButton, fontSize: 11, px: 1.5, py: 0.4,
                                        borderColor: currentAnswer === "yes" ? "#2e7d32" : C.mist,
                                        background: currentAnswer === "yes" ? "#eef7ee" : "transparent",
                                        color: currentAnswer === "yes" ? "#2e7d32" : C.charcoal,
                                      }}
                                    >
                                      <CheckCircleRounded sx={{ fontSize: 13 }} /> Yes
                                    </Box>
                                    <Box
                                      component="button" type="button"
                                      onClick={() => setClarifyingAnswer(item.condition, q.id, "no")}
                                      sx={{
                                        ...ghostButton, fontSize: 11, px: 1.5, py: 0.4,
                                        borderColor: currentAnswer === "no" ? "#b3261e" : C.mist,
                                        background: currentAnswer === "no" ? "#fbecea" : "transparent",
                                        color: currentAnswer === "no" ? "#b3261e" : C.charcoal,
                                      }}
                                    >
                                      <CancelRounded sx={{ fontSize: 13 }} /> No
                                    </Box>
                                  </Box>
                                ) : (
                                  <input
                                    type="text"
                                    placeholder="Patient's answer..."
                                    value={currentAnswer || ""}
                                    onChange={(e) => setClarifyingAnswer(item.condition, q.id, e.target.value)}
                                    style={{ ...inputSx, fontSize: 11.5, padding: "7px 10px" }}
                                  />
                                )}
                              </Box>
                            );
                          })}
                        </Box>
                      )}
                    </Box>
                  );
                })}
              </Box>
            </Box>
          ))}
        </Box>
      ) : (
        <Box sx={{ p: 4, textAlign: "center" }}>
          <Typography sx={{ ...os({ fontSize: 13, color: C.ash }) }}>
            No differential generated yet. Add any additional findings above and click "Generate Differential".
          </Typography>
        </Box>
      )}

      {hasAnyResult && hasAnyAnsweredQuestion && (
        <Box sx={{ mx: 3, mb: 2.5, p: 1.5, borderRadius: "2px", background: C.ghost, border: `1px solid ${C.fog}`, display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 1 }}>
          <Typography sx={{ ...os({ fontSize: 11.5, color: C.charcoal }) }}>
            Patient answers recorded above — refine the differential using them before saving.
          </Typography>
          <Box component="button" type="button" onClick={handleRefine} disabled={generating} sx={{ ...actionButton, minWidth: 200 }}>
            {generating ? <RefreshRounded sx={{ fontSize: 15, animation: "spin 1s linear infinite" }} /> : <AutoAwesomeRounded sx={{ fontSize: 15 }} />}
            {generating ? "Refining..." : "Refine with Answers"}
          </Box>
        </Box>
      )}

      {/* Footer */}
      <Box sx={{ px: 3, py: 2, borderTop: `1px solid ${C.fog}`, background: C.ghost, display: "flex", alignItems: "center", justifyContent: "flex-end", gap: 1.5 }}>
        {saveMsg && <Typography sx={{ ...os({ fontSize: 12, color: saveMsg.includes("✅") ? "#2e7d32" : "#d32f2f" }) }}>{saveMsg}</Typography>}
        <Box component="button" type="button" onClick={handleSave} disabled={saving || !hasAnyResult} sx={{ ...actionButton, minWidth: 200 }}>
          <SaveRounded sx={{ fontSize: 15 }} /> {saving ? "Saving..." : "Save Differential"}
        </Box>
      </Box>

      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </Box>
  );
}