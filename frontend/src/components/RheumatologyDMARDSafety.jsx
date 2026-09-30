import React, { useState, useEffect, useCallback } from "react";
import { Box, Typography, Chip } from "@mui/material";
import {
  RefreshRounded,
  SaveRounded,
  ShieldRounded,
  MedicationRounded,
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
  width: "100%", padding: "8px 12px", border: `1px solid ${C.mist}`,
  borderRadius: "2px", background: C.white, fontFamily: FONT, fontSize: "12.5px",
  fontWeight: 300, color: C.ink, outline: "none", boxSizing: "border-box",
};

const STATUS_COLOR = { green: "#2e7d32", yellow: "#8a6d00", red: "#b3261e" };
const STATUS_BG = { green: "#eef7ee", yellow: "#fbf6e3", red: "#fbecea" };
const STATUS_LABEL = { green: "Continue", yellow: "Monitoring Required", red: "Review / Hold / Escalate" };
const STATUS_DOT_LABEL = { green: "\uD83D\uDFE2", yellow: "\uD83D\uDFE1", red: "\uD83D\uDD34" };

const CHECKLIST_STATUS_OPTIONS = ["Done", "Not Done", "Unknown"];

const LAB_FLAG_COLOR = (value, testName) => {
  // purely cosmetic client-side echo of server thresholds, for a quick visual cue only
  if (value === null || value === undefined) return C.silver;
  const v = Number(value);
  if (Number.isNaN(v)) return C.silver;
  if (["AST", "ALT"].includes(testName)) return v > 120 ? "#b3261e" : v > 40 ? "#8a6d00" : "#2e7d32";
  if (testName === "White Blood Cell Count (WBC)") return v < 3.0 ? "#b3261e" : v < 4.0 ? "#8a6d00" : "#2e7d32";
  if (testName === "Platelet Count") return v < 100 ? "#b3261e" : v < 150 ? "#8a6d00" : "#2e7d32";
  if (testName === "Creatinine") return v > 2.0 ? "#b3261e" : v > 1.5 ? "#8a6d00" : "#2e7d32";
  if (testName === "Hemoglobin") return v < 8 ? "#b3261e" : v < 10 ? "#8a6d00" : "#2e7d32";
  if (testName === "eGFR") return v < 30 ? "#b3261e" : v < 60 ? "#8a6d00" : "#2e7d32";
  return C.charcoal;
};

export default function RheumatologyDMARDSafety({ doctorId, patientId, patientName }) {
  const [previewPanel, setPreviewPanel] = useState([]);
  const [hasDmards, setHasDmards] = useState(false);
  const [checklist, setChecklist] = useState({}); // { drug_class: { item: "Done"|"Not Done"|"Unknown" } }
  const [result, setResult] = useState(null); // { panel, narrative }
  const [calculating, setCalculating] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState("");
  const [calcError, setCalcError] = useState("");

  const loadPreview = useCallback(async () => {
    if (!patientId || !doctorId) return;
    try {
      const res = await fetch(`${API_BASE_URL}hms/users/data/context/rheumatology-dmard-safety/context-preview/${patientId}/${doctorId}`);
      const json = await res.json();
      if (json?.status === "success") {
        const panel = json.data?.panel || [];
        setPreviewPanel(panel);
        setHasDmards(Boolean(json.has_dmards));
        // seed checklist state with "Unknown" for every manual item, preserving any existing entries
        setChecklist((prev) => {
          const next = { ...prev };
          panel.forEach((d) => {
            const existing = next[d.drug_class] || {};
            const seeded = {};
            (d.manual_checklist_items || []).forEach((item) => {
              seeded[item] = existing[item] || "Unknown";
            });
            next[d.drug_class] = seeded;
          });
          return next;
        });
      }
    } catch (err) {
      console.error("Failed to load DMARD safety context:", err);
    }
  }, [patientId, doctorId]);

useEffect(() => {
    loadPreview();
    return subscribeRheumContextUpdate(loadPreview);
  }, [loadPreview]);

  const setChecklistItem = (drugClass, item, value) => {
    setChecklist((prev) => ({
      ...prev,
      [drugClass]: { ...(prev[drugClass] || {}), [item]: value },
    }));
  };

  const handleCalculate = async () => {
    setCalcError("");
    setCalculating(true);
    try {
      const res = await fetch(`${API_BASE_URL}hms/users/data/context/rheumatology-dmard-safety/calculate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ doctor_id: doctorId, patient_id: patientId, checklist }),
      });
      const json = await res.json();
      if (!res.ok || json?.status !== "success") throw new Error(json?.detail || "Failed to run safety check");
      setResult(json.finaloutput || null);
    } catch (err) {
      console.error("DMARD safety calculation failed:", err);
      setCalcError(err.message || "Failed to run safety check");
    } finally {
      setCalculating(false);
    }
  };

  const handleSave = async () => {
    if (!result?.panel?.length) return;
    setSaving(true);
    setSaveMsg("");
    try {
      const res = await fetch(`${API_BASE_URL}hms/users/data/context/rheumatology-dmard-safety/save`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          patient_id: patientId,
          doctor_id: doctorId,
          panel: result.panel,
          narrative: result.narrative || "",
        }),
      });
      const json = await res.json();
      if (!res.ok || json?.status !== "success") throw new Error(json?.detail || json?.message || "Save failed");
      setSaveMsg("✅ DMARD safety review saved");
      window.dispatchEvent(new Event("refreshRheumatologyDMARDSafetyHistory"));
      announceRheumContextUpdate("dmard-safety");
    } catch (err) {
      console.error("DMARD safety save failed:", err);
      setSaveMsg(`❌ ${err.message || "Save failed"}`);
    } finally {
      setSaving(false);
      setTimeout(() => setSaveMsg(""), 3000);
    }
  };

  // Prefer the calculated result's panel (has status) once available; otherwise show the raw preview
  const displayPanel = result?.panel?.length ? result.panel : null;

  return (
    <Box sx={{ ...card, overflow: "hidden" }}>
      <Box sx={{ px: 3, py: 2.5, borderBottom: `1px solid ${C.fog}`, background: C.ghost, display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 1.5 }}>
        <Box>
          <Typography sx={{ ...os({ fontSize: 14, color: C.ink, letterSpacing: "0.02em" }) }}>DMARD Safety Monitoring</Typography>
          <Typography sx={{ ...os({ fontSize: 11, color: C.ash, mt: 0.4 }) }}>
            {patientName ? `Per-drug lab + screening status — ${patientName}` : "Per-drug lab + screening status"}
          </Typography>
        </Box>
        <Chip label="Module 8 · DMARD Safety" size="small" sx={{ background: C.black, color: C.white, fontWeight: 300, fontSize: 10, letterSpacing: "0.04em", borderRadius: "2px", height: 22 }} />
      </Box>

      {/* Current DMARDs basis indicator */}
      <Box sx={{ mx: 3, mt: 2, p: 1.5, borderRadius: "2px", background: C.ghost, border: `1px solid ${C.fog}`, display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 1 }}>
        <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
          <Box sx={{ width: 7, height: 7, borderRadius: "50%", background: hasDmards ? "#2e7d32" : C.silver }} />
          <Typography sx={{ ...os({ fontSize: 11, color: C.charcoal }) }}>
            {hasDmards
              ? `${previewPanel.length} recognized DMARD${previewPanel.length === 1 ? "" : "s"} in current medications`
              : "No recognized DMARDs found in current medications"}
          </Typography>
        </Box>
        <Box component="button" type="button" onClick={loadPreview} sx={{ border: "none", background: "transparent", cursor: "pointer", p: 0.25, color: C.silver, display: "flex" }}>
          <RefreshRounded sx={{ fontSize: 15 }} />
        </Box>
      </Box>

      {/* Manual checklist inputs, per drug */}
      {hasDmards && (
        <Box sx={{ p: { xs: 2, sm: 3 }, display: "flex", flexDirection: "column", gap: 1.5 }}>
          {previewPanel.map((d) => (
            <Box key={d.drug_class} sx={{ border: `1px solid ${C.fog}`, borderRadius: "4px", overflow: "hidden" }}>
              <Box sx={{ px: 2, py: 1.25, background: C.ghost, borderBottom: `1px solid ${C.fog}`, display: "flex", alignItems: "center", gap: 1, flexWrap: "wrap" }}>
                <MedicationRounded sx={{ fontSize: 15, color: C.smoke }} />
                <Typography sx={{ ...os({ fontSize: 12.5, color: C.ink }) }}>{d.name}</Typography>
                <Chip label={d.drug_class} size="small" sx={{ fontSize: 9.5, height: 18, background: C.white, color: C.ash, border: `1px solid ${C.mist}` }} />
                {d.interval_days && (
                  <Typography sx={{ ...os({ fontSize: 10, color: C.silver, ml: "auto" }) }}>
                    Lab interval: every {d.interval_days} days
                  </Typography>
                )}
              </Box>

              <Box sx={{ p: 1.75, display: "flex", flexDirection: "column", gap: 1.25 }}>
                {/* Latest labs, if any required for this class */}
                {(d.required_labs || []).length > 0 && (
                  <Box sx={{ display: "flex", flexWrap: "wrap", gap: 1 }}>
                    {d.required_labs.map((testName) => {
                      const entry = d.latest_labs?.[testName];
                      const baseline = d.baseline_labs?.[testName];
                      const showBaseline =
                        baseline?.value !== undefined && baseline?.value !== null &&
                        entry?.value !== undefined && entry?.value !== null;
                      return (
                        <Box key={testName} sx={{ px: 1.25, py: 0.6, borderRadius: "2px", border: `1px solid ${C.mist}`, background: C.white }}>
                          <Typography sx={{ ...os({ fontSize: 9.5, color: C.silver, textTransform: "uppercase", letterSpacing: "0.05em" }) }}>{testName}</Typography>
                          <Typography sx={{ ...os({ fontSize: 12, color: LAB_FLAG_COLOR(entry?.value, testName) }) }}>
                            {entry?.value !== undefined && entry?.value !== null ? `${entry.value}` : "not recorded"}
                            {entry?.date ? <span style={{ color: C.silver, fontSize: 10 }}> · {entry.date}</span> : null}
                          </Typography>
                          {showBaseline && (
                            <Typography sx={{ ...os({ fontSize: 9.5, color: C.silver, mt: 0.25 }) }}>
                              Baseline: {baseline.value}{baseline.date ? ` (${baseline.date})` : ""}
                            </Typography>
                          )}
                        </Box>
                      );
                    })}
                  </Box>
                )}

                {/* Manual checklist items */}
                {(d.manual_checklist_items || []).length > 0 && (
                  <Box sx={{ display: "flex", flexDirection: "column", gap: 0.75 }}>
                    {d.manual_checklist_items.map((item) => (
                      <Box key={item} sx={{ display: "flex", alignItems: "center", gap: 1.5, flexWrap: "wrap" }}>
                        <Typography sx={{ ...os({ fontSize: 11.5, color: C.charcoal, flex: 1, minWidth: 180 }) }}>{item}</Typography>
                        <select
                          value={checklist[d.drug_class]?.[item] || "Unknown"}
                          onChange={(e) => setChecklistItem(d.drug_class, item, e.target.value)}
                          style={{ ...inputSx, width: 130 }}
                        >
                          {CHECKLIST_STATUS_OPTIONS.map((opt) => <option key={opt} value={opt}>{opt}</option>)}
                        </select>
                      </Box>
                    ))}
                  </Box>
                )}

                {(d.required_labs || []).length === 0 && (d.manual_checklist_items || []).length === 0 && (
                  <Typography sx={{ ...os({ fontSize: 11.5, color: C.silver }) }}>No structured monitoring items for this class.</Typography>
                )}
              </Box>
            </Box>
          ))}
        </Box>
      )}

      {calcError && <Typography sx={{ ...os({ fontSize: 12, color: "#b3261e", mx: 3, mb: 1 }) }}>{calcError}</Typography>}

      {hasDmards && (
        <Box sx={{ px: 3, pb: 2, display: "flex", justifyContent: "flex-end" }}>
          <Box component="button" type="button" onClick={handleCalculate} disabled={calculating} sx={{ ...actionButton, minWidth: 190 }}>
            {calculating ? <RefreshRounded sx={{ fontSize: 15, animation: "spin 1s linear infinite" }} /> : <ShieldRounded sx={{ fontSize: 15 }} />}
            {calculating ? "Checking..." : "Run Safety Check"}
          </Box>
        </Box>
      )}

      {/* Results — status per drug */}
      {displayPanel && (
        <Box sx={{ px: 3, pb: 2, display: "flex", flexDirection: "column", gap: 1.5 }}>
          {displayPanel.map((p, i) => (
            <Box key={i} sx={{ border: `1px solid ${C.fog}`, borderRadius: "4px", overflow: "hidden" }}>
              <Box sx={{ px: 2, py: 1.25, background: STATUS_BG[p.status] || C.ghost, borderBottom: `1px solid ${C.fog}`, display: "flex", alignItems: "center", gap: 1, flexWrap: "wrap" }}>
                <Typography sx={{ fontSize: 15 }}>{STATUS_DOT_LABEL[p.status] || "\u26AA"}</Typography>
                <Typography sx={{ ...os({ fontSize: 12.5, color: C.ink }) }}>{p.name}</Typography>
                <Chip
                  label={STATUS_LABEL[p.status] || p.status}
                  size="small"
                  sx={{ fontSize: 10, height: 20, background: STATUS_COLOR[p.status] || C.charcoal, color: C.white, ml: "auto" }}
                />
              </Box>
              <Box sx={{ p: 1.75 }}>
                {(p.reasons || []).map((r, ri) => (
                  <Box key={ri} sx={{ display: "flex", gap: 0.75, alignItems: "flex-start", mb: 0.5 }}>
                    {p.status !== "green" && <WarningAmberRounded sx={{ fontSize: 13, color: STATUS_COLOR[p.status], mt: 0.15 }} />}
                    <Typography sx={{ ...os({ fontSize: 11.5, color: C.charcoal }) }}>{r}</Typography>
                  </Box>
                ))}
              </Box>
            </Box>
          ))}

          {result?.narrative && (
            <Box sx={{ p: 1.75, borderRadius: "2px", background: C.ghost, border: `1px solid ${C.fog}` }}>
              <Typography sx={{ ...os({ fontSize: 10, color: C.silver, textTransform: "uppercase", letterSpacing: "0.07em", mb: 0.5 }) }}>AI Summary</Typography>
              <Typography sx={{ ...os({ fontSize: 12.5, color: C.charcoal, lineHeight: 1.6 }) }}>{result.narrative}</Typography>
            </Box>
          )}
        </Box>
      )}

      {!hasDmards && (
        <Box sx={{ p: 4, textAlign: "center" }}>
          <Typography sx={{ ...os({ fontSize: 13, color: C.ash }) }}>
            No recognized DMARDs found in current medications. Nothing to monitor.
          </Typography>
        </Box>
      )}

      {/* Footer */}
      <Box sx={{ px: 3, py: 2, borderTop: `1px solid ${C.fog}`, background: C.ghost, display: "flex", alignItems: "center", justifyContent: "flex-end", gap: 1.5 }}>
        {saveMsg && <Typography sx={{ ...os({ fontSize: 12, color: saveMsg.includes("✅") ? "#2e7d32" : "#d32f2f" }) }}>{saveMsg}</Typography>}
        <Box component="button" type="button" onClick={handleSave} disabled={saving || !displayPanel} sx={{ ...actionButton, minWidth: 200 }}>
          <SaveRounded sx={{ fontSize: 15 }} /> {saving ? "Saving..." : "Save Safety Review"}
        </Box>
      </Box>

      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </Box>
  );
}