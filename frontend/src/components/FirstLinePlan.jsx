// FirstLinePlan.jsx
import React, { useState } from "react";
import { Box, Typography, Button, CircularProgress } from "@mui/material";
import { motion, AnimatePresence } from "framer-motion";
import ExpandMoreIcon from "@mui/icons-material/ExpandMore";
import ExpandLessIcon from "@mui/icons-material/ExpandLess";
import SaveIcon from "@mui/icons-material/Save";
import CheckCircleIcon from "@mui/icons-material/CheckCircle";

const FONT = '"Open Sans", sans-serif';
const FW_LIGHT = 300;
const FW_REGULAR = 400;
const C = {
  black:    "#000",
  charcoal: "#444",
  ash:      "#888",
  mist:     "#e0e0e0",
  ghost:    "#fafafa",
  white:    "#fff",
};
const os = (x = {}) => ({
  fontFamily: FONT,
  fontWeight: FW_LIGHT,
  WebkitFontSmoothing: "antialiased",
  ...x,
});

const API_BASE_URL =
  import.meta.env.VITE_BACKEND_URL || "https://doctorassist.ai/api/";

/* ─── Presentational helpers (unchanged) ─────────────────── */
const Section = ({ title, children, defaultOpen = false }) => {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <Box sx={{ border:`1px solid ${C.mist}`, mb:1.5, "&:hover":{ borderColor:C.black }, transition:"border-color 0.2s" }}>
      <Box onClick={() => setOpen(v => !v)} sx={{ px:2, py:1.5, display:"flex", alignItems:"center", justifyContent:"space-between", cursor:"pointer", background: open ? C.ghost : C.white, borderBottom: open ? `1px solid ${C.mist}` : "none", userSelect:"none" }}>
        <Typography sx={{ ...os({ fontSize:11, color:C.black, fontWeight:FW_REGULAR, letterSpacing:"0.05em", textTransform:"uppercase" }) }}>{title}</Typography>
        {open ? <ExpandLessIcon sx={{ fontSize:14, color:C.ash }} /> : <ExpandMoreIcon sx={{ fontSize:14, color:C.ash }} />}
      </Box>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div initial={{ height:0, opacity:0 }} animate={{ height:"auto", opacity:1 }} exit={{ height:0, opacity:0 }} transition={{ duration:0.18 }} style={{ overflow:"hidden" }}>
            <Box sx={{ px:2, py:2 }}>{children}</Box>
          </motion.div>
        )}
      </AnimatePresence>
    </Box>
  );
};

const InfoRow = ({ label, value }) => (
  <Box sx={{ display:"flex", gap:1, py:0.4, borderBottom:`1px solid ${C.mist}` }}>
    <Typography sx={{ ...os({ fontSize:11, color:C.ash, minWidth:150 }) }}>{label}</Typography>
    <Typography sx={{ ...os({ fontSize:11, color:C.charcoal, fontWeight:FW_REGULAR, flex:1 }) }}>{value || "—"}</Typography>
  </Box>
);

const Marker = ({ s = "rv" }) => {
  const M = {
    cr:{ rotate:45, borderRadius:0, background:C.black },
    rv:{ borderRadius:"50%", border:`1.5px solid ${C.black}`, background:`linear-gradient(90deg,${C.black} 50%,transparent 50%)` },
    in:{ borderRadius:"50%", border:`1.5px solid ${C.mist}` },
  };
  return <Box sx={{ width:11, height:11, mt:0.6, flexShrink:0, ...(M[s] || M.rv) }} />;
};

/* ─── Main component ────────────────────────────────────── */
export default function FirstLinePlan({
  patientId,
  doctorId,
  specialty,
  patientName,
  onClose,
  onAction,
}) {
  const [data, setData]             = useState(null);
  const [loading, setLoading]       = useState(false);
  const [error, setError]           = useState("");
  const [generated, setGenerated]   = useState(false);

  // Local UI state for the intent / strategy selection.
  const [intent, setIntent]         = useState(null);
  const [strategyId, setStrategyId] = useState(null);

  // Save state — idle | saving | saved | error
  const [saveState, setSaveState]   = useState("idle");
  const [saveError, setSaveError]   = useState("");
  const [savedAt, setSavedAt]       = useState(null);

  /* ── Generate — scoped to the caller's specialty + tumour board aware ── */
  const handleGenerate = async () => {
    if (!patientId || !doctorId) {
      setError("Select a patient and a doctor first.");
      return;
    }
    setLoading(true);
    setError("");
    setData(null);
    // Regenerating invalidates the previous save — reset save state.
    setSaveState("idle");
    setSaveError("");
    setSavedAt(null);

    try {
      // Build the URL against the new endpoint that honours specialty and
      // includes the tumour board plan.
      const url = new URL(
        `${API_BASE_URL}hms/users/ai-legacy/first-line-plan/${encodeURIComponent(patientId)}`
      );
      url.searchParams.set("doctor_id", doctorId);
      if (specialty) url.searchParams.set("specialty", specialty);

      const res = await fetch(url.toString(), {
        method: "GET",
        headers: { Accept: "application/json" },
      });
      if (!res.ok) {
        const t = await res.text().catch(() => "");
        throw new Error(t || `HTTP ${res.status}`);
      }
      const json = await res.json();
      setData(json);
      setGenerated(true);
      setIntent(json.default_intent || (json.intents && json.intents[0]) || "Curative");
      setStrategyId(json.strategies?.[0]?.id || null);
    } catch (err) {
      console.error("[FirstLinePlan] fetch failed:", err);
      setError(err.message || "Failed to load first-line plan.");
    } finally {
      setLoading(false);
    }
  };

  /* ── Save selected strategy — persists regimen + evidence ── */
  const handleSaveStrategy = async () => {
    if (!patientId || !doctorId) {
      setSaveError("Missing patient or doctor.");
      setSaveState("error");
      return;
    }

    const selected = (data?.strategies || []).find((s) => s.id === strategyId);
    if (!selected) {
      setSaveError("Select a strategy first.");
      setSaveState("error");
      return;
    }

    setSaveState("saving");
    setSaveError("");

    try {
      const payload = {
        patient_id:    patientId,
        doctor_id:     doctorId,
        strategy:      `${selected.id} — ${selected.name}`,
        strategy_id:   selected.id,
        strategy_name: selected.name,
        intent:        intent || data?.default_intent || null,

        // Everything the doctor is looking at for this strategy
        regimen:       selected.regimen  || null,
        evidence:      selected.evidence || null,
        role:          selected.role     || null,
        why:           selected.why      || null,
        prerequisites: selected.pre      || null,
        constraints:   selected.cons     || null,

        saved_by:      doctorId,
        note:          null,
      };

      const res = await fetch(
        `${API_BASE_URL}hms/users/data/system/save_strategy`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Accept: "application/json",
          },
          body: JSON.stringify(payload),
        }
      );

      if (!res.ok) {
        const t = await res.text().catch(() => "");
        throw new Error(t || `Save failed (HTTP ${res.status})`);
      }

      const json = await res.json();
      setSavedAt(json.saved_at || new Date().toISOString());
      setSaveState("saved");

      // Let the parent (VoiceAssistant) know so it can forward the
      // strategy to downstream modules (Dosing, Treatment Readiness, ...).
      if (onAction) {
        onAction("strategy_saved", {
          strategyId:   selected.id,
          strategyName: selected.name,
          strategy:     `${selected.id} — ${selected.name}`,
          intent:       intent || data?.default_intent || null,
          regimen:      selected.regimen  || null,
          evidence:     selected.evidence || null,
          role:         selected.role     || null,
          why:          selected.why      || null,
          prerequisites: selected.pre     || null,
          constraints:  selected.cons     || null,
          savedAt:      json.saved_at,
        });
      }
    } catch (err) {
      console.error("[FirstLinePlan] save failed:", err);
      setSaveError(err.message || "Failed to save the selected strategy.");
      setSaveState("error");
    }
  };

  if (!patientId || !doctorId) {
    return (
      <Box sx={{ p:4, textAlign:"center" }}>
        <Typography sx={{ ...os({ fontSize:13, color:C.ash }) }}>
          Select a patient to view the first-line plan.
        </Typography>
      </Box>
    );
  }

  const hero            = data?.hero                || {};
  const baselineTiles   = data?.baseline_tiles      || [];
  const diseaseDef      = data?.disease_definition  || [];
  const intentsList     = data?.intents             || [];
  const strategies      = data?.strategies          || [];
  const changeDrivers   = data?.change_drivers      || [];
  const modalityPrep    = data?.modality_prep       || [];
  const actions         = data?.actions             || [];
  const priorsFound     = data?.priors_found        || {};
  const appliedSpecialty = data?.doctor_specialty   || specialty || "Medical Oncology";

  const selectedStrategy = strategies.find(s => s.id === strategyId);

  const canSave = !!selectedStrategy && saveState !== "saving";

  const saveButtonLabel =
    saveState === "saving" ? "Saving…"
    : saveState === "saved" ? "Saved"
    : "Save Selected Strategy";

  return (
    <motion.div initial={{ opacity:0 }} animate={{ opacity:1 }} transition={{ duration:0.2 }}>
      <link href="https://fonts.googleapis.com/css2?family=Open+Sans:wght@300;400;600&display=swap" rel="stylesheet" />

      {/* ── Header bar: generate + save ─────────────────────── */}
      <Box sx={{
        display:"flex", alignItems:"center", justifyContent:"space-between",
        gap:2, pb:2, mb:3, borderBottom:`1px solid ${C.mist}`,
        flexWrap:"wrap",
      }}>
        <Box>
          <Typography sx={{
            ...os({ fontSize:11, color:C.ash, letterSpacing:"0.1em", textTransform:"uppercase" }),
          }}>
            {patientName ? `${patientName} / First-line plan` : "First-line plan"}
          </Typography>
          {/* Specialty + prior-decision indicators */}
          <Typography sx={{ ...os({ fontSize:10, color:C.ash, mt:0.5 }) }}>
            {appliedSpecialty} lens
            {priorsFound.tumour_board && " · tumour board plan included"}
            {priorsFound.saved_strategy && " · prior strategy included"}
            {priorsFound.doctor_decision && " · prior doctor decision included"}
          </Typography>
        </Box>

        <Box sx={{ display:"flex", gap:1, alignItems:"center", flexWrap:"wrap" }}>
          {/* Saved indicator */}
          {saveState === "saved" && savedAt && (
            <Box sx={{
              display:"flex", alignItems:"center", gap:0.5,
              fontSize:11, color:"#2e7d32", mr:1,
            }}>
              <CheckCircleIcon sx={{ fontSize:14 }} />
              <span>Saved {new Date(savedAt).toLocaleTimeString()}</span>
            </Box>
          )}

          {/* Save button — disabled until a strategy is selected */}
          <Button
            onClick={handleSaveStrategy}
            disabled={!canSave}
            variant="contained"
            size="small"
            startIcon={
              saveState === "saving"
                ? <CircularProgress size={12} sx={{ color: C.white }} />
                : <SaveIcon sx={{ fontSize:14 }} />
            }
            sx={{
              fontFamily:FONT, fontWeight:600, fontSize:11, letterSpacing:"0.08em",
              textTransform:"uppercase",
              backgroundColor: C.black, color: C.white,
              px:2, py:0.5, minWidth:"auto",
              "&:hover":{ backgroundColor:"#1a1a1a" },
              "&.Mui-disabled":{ backgroundColor: C.mist, color: C.ash },
            }}
          >
            {saveButtonLabel}
          </Button>

          {/* Generate button */}
          <Button
            onClick={handleGenerate}
            disabled={loading}
            variant="outlined" size="small"
            sx={{
              fontFamily:FONT, fontWeight:600, fontSize:11, letterSpacing:"0.08em",
              textTransform:"uppercase", color:C.black, borderColor:C.black,
              px:2, py:0.5, minWidth:"auto",
              "&:hover":{ backgroundColor:C.black, color:C.white, borderColor:C.black },
              "&.Mui-disabled":{ color:C.ash, borderColor:C.mist },
            }}
          >
            {loading ? "Generating…" : generated ? "Regenerate" : "Generate Plan"}
          </Button>

          {onClose && (
            <Button
              onClick={onClose} variant="text" size="small"
              sx={{
                fontFamily:FONT, fontWeight:600, fontSize:11, letterSpacing:"0.08em",
                textTransform:"uppercase", color:C.ash, px:1.5, py:0.5, minWidth:"auto",
                "&:hover":{ color:C.black, backgroundColor:"transparent" },
              }}
            >
              Close
            </Button>
          )}
        </Box>
      </Box>

      {/* Save error bar */}
      {saveState === "error" && saveError && (
        <Box sx={{ p:1.5, mb:2, border:"1px solid #ffcdd2", background:"#fce4ec" }}>
          <Typography sx={{ ...os({ fontSize:12, color:"#c62828" }) }}>
            {saveError}
          </Typography>
        </Box>
      )}

      {/* Loading */}
      {loading && (
        <Box sx={{ p:6, display:"flex", flexDirection:"column", alignItems:"center", gap:2 }}>
          <CircularProgress size={22} sx={{ color:C.black }} />
          <Typography sx={{ ...os({ fontSize:12, color:C.ash }) }}>
            Building first-line strategy options for the {appliedSpecialty} lens…
          </Typography>
        </Box>
      )}

      {/* Error */}
      {!loading && error && (
        <Box sx={{ p:2, mb:3, border:"1px solid #ffcdd2", background:"#fce4ec" }}>
          <Typography sx={{ ...os({ fontSize:12, color:"#c62828", fontWeight:FW_REGULAR }) }}>
            {error}
          </Typography>
        </Box>
      )}

      {/* Empty */}
      {!loading && !error && !data && (
        <Box sx={{ p:6, textAlign:"center", border:`1px dashed ${C.mist}`, background:C.ghost }}>
          <Typography sx={{ ...os({ fontSize:13, color:C.charcoal, mb:1 }) }}>
            No first-line plan generated yet.
          </Typography>
          <Typography sx={{ ...os({ fontSize:11, color:C.ash }) }}>
            Click <b>Generate Plan</b> above to build strategy options for the{" "}
            <b>{appliedSpecialty}</b> lens.
          </Typography>
        </Box>
      )}

      {/* Main content */}
      {!loading && !error && data && (
        <>
          {/* Hero */}
          <Box sx={{ pb:3, mb:3, borderBottom:`1px solid ${C.mist}` }}>
            <Typography sx={{
              ...os({ fontSize:11, color:C.ash, letterSpacing:"0.1em", textTransform:"uppercase", mb:1 }),
            }}>
              {hero.eyebrow || "First-line plan"}
            </Typography>
            <Typography sx={{ ...os({ fontSize:22, color:C.black, lineHeight:1.3, mb:1.5 }) }}>
              {hero.headline}
            </Typography>
            <Typography sx={{ ...os({ fontSize:13, color:C.ash, maxWidth:"60ch" }) }}>
              {hero.subtitle}
            </Typography>
          </Box>

          {/* Baseline tiles */}
          {baselineTiles.length > 0 && (
            <Section title="Patient treatment baseline" defaultOpen>
              <Box sx={{
                display:"grid",
                gridTemplateColumns:{ xs:"1fr 1fr", md:"repeat(3,1fr)" },
                gap:2,
              }}>
                {baselineTiles.map((t) => (
                  <Box key={t.label}>
                    <Typography sx={{
                      ...os({ fontSize:10, color:C.ash, textTransform:"uppercase",
                             letterSpacing:"0.1em", mb:0.5 }),
                    }}>
                      {t.label}
                    </Typography>
                    <Typography sx={{ ...os({ fontSize:14, color:C.black }) }}>
                      {t.value}
                    </Typography>
                  </Box>
                ))}
              </Box>
            </Section>
          )}

          {/* Disease definition */}
          {diseaseDef.length > 0 && (
            <Section title="Disease definition" defaultOpen>
              {diseaseDef.map((row, i) => (
                <InfoRow key={i} label={row.label} value={row.value} />
              ))}
            </Section>
          )}

          {/* Intent selector */}
          {intentsList.length > 0 && (
            <Section title="Treatment intent" defaultOpen>
              <Box sx={{ display:"flex", flexWrap:"wrap", gap:1 }}>
                {intentsList.map((o) => (
                  <Box
                    key={o}
                    component="button"
                    onClick={() => setIntent(o)}
                    sx={{
                      fontFamily: FONT,
                      fontWeight: FW_LIGHT,
                      fontSize: 11,
                      px: 1.5,
                      py: 0.5,
                      border: `1px solid ${intent === o ? C.black : C.mist}`,
                      borderRadius: "999px",
                      background: intent === o ? C.black : C.white,
                      color: intent === o ? C.white : C.black,
                      cursor: "pointer",
                    }}
                  >
                    {o}
                  </Box>
                ))}
              </Box>
            </Section>
          )}

          {/* Strategy comparison */}
          {strategies.length > 0 && (
            <Section title="Strategy comparison" defaultOpen>
              <Typography sx={{ ...os({ fontSize:11, color:C.ash, mb:2 }) }}>
                Why each is considered, what it needs, and what limits it.
                {priorsFound.tumour_board && (
                  <> The first strategy reflects the tumour board recommendation.</>
                )}
              </Typography>
              {strategies.map((s) => (
                <Box
                  key={s.id}
                  onClick={() => setStrategyId(s.id)}
                  sx={{
                    display: "grid",
                    gridTemplateColumns: "24px 1fr",
                    gap: 1.5,
                    py: 2,
                    borderTop: `1px solid ${C.mist}`,
                    cursor: "pointer",
                    background: strategyId === s.id ? C.ghost : "transparent",
                  }}
                >
                  <Box
                    component="input"
                    type="radio"
                    checked={strategyId === s.id}
                    onChange={() => setStrategyId(s.id)}
                    sx={{ mt: 0.5 }}
                  />
                  <Box>
                    <Typography sx={{
                      ...os({ fontSize:13, color:C.black, fontWeight:FW_REGULAR, mb:0.5 }),
                    }}>
                      {s.id}. {s.name}
                    </Typography>
                    <Typography sx={{ ...os({ fontSize:11, color:C.ash, mb:0.5 }) }}>
                      {s.role}
                    </Typography>
                    <Typography sx={{ ...os({ fontSize:11, color:C.charcoal, lineHeight:1.7, mb:0.5 }) }}>
                      <b>Why:</b> {s.why}
                    </Typography>
                    <Typography sx={{ ...os({ fontSize:11, color:C.charcoal, lineHeight:1.7, mb:0.5 }) }}>
                      <b>Prerequisites:</b> {s.pre}
                    </Typography>
                    <Typography sx={{ ...os({ fontSize:11, color:C.charcoal, lineHeight:1.7 }) }}>
                      <b>Constraints:</b> {s.cons}
                    </Typography>
                  </Box>
                </Box>
              ))}
            </Section>
          )}

          {/* Selected strategy */}
          {selectedStrategy && (
            <Section title={`Selected: ${selectedStrategy.name}`} defaultOpen>
              <InfoRow label="Regimen options" value={selectedStrategy.regimen} />
              <InfoRow label="Evidence" value={selectedStrategy.evidence} />
            </Section>
          )}

          {/* Change drivers */}
          {changeDrivers.length > 0 && (
            <Section title="What could change this plan" defaultOpen>
              <Typography sx={{ ...os({ fontSize:11, color:C.ash, mb:2 }) }}>
                Decision-critical missing data first.
              </Typography>
              {changeDrivers.map((c, i) => (
                <Box
                  key={i}
                  sx={{
                    display: "grid",
                    gridTemplateColumns: "22px 1fr",
                    gap: 1.5,
                    py: 1.2,
                    borderBottom: i < changeDrivers.length - 1 ? `1px solid ${C.mist}` : "none",
                  }}
                >
                  <Marker s={c.severity} />
                  <Box>
                    <Typography sx={{ ...os({ fontSize:12, color:C.black }) }}>
                      {c.title}
                    </Typography>
                    <Typography sx={{ ...os({ fontSize:11, color:C.ash, mt:0.3 }) }}>
                      {c.impact}
                    </Typography>
                  </Box>
                </Box>
              ))}
            </Section>
          )}

          {/* Modality preparation */}
          {modalityPrep.length > 0 && (
            <Section title="Modality preparation" defaultOpen>
              {modalityPrep.map((m, i) => (
                <Box
                  key={i}
                  sx={{
                    display: "grid",
                    gridTemplateColumns: "22px 1fr",
                    gap: 1.5,
                    py: 1,
                    borderBottom: i < modalityPrep.length - 1 ? `1px solid ${C.mist}` : "none",
                  }}
                >
                  <Marker s="in" />
                  <Typography sx={{ ...os({ fontSize:12, color:C.charcoal }) }}>
                    {m.text}
                  </Typography>
                </Box>
              ))}
            </Section>
          )}

          {/* Actions */}
          {actions.length > 0 && (
            <Box sx={{ display:"flex", gap:1.5, flexWrap:"wrap", mt:2 }}>
              {actions.map((a) => {
                const isPrimary = a.variant === "primary";
                return (
                  <Box
                    key={a.key}
                    component="button"
                    onClick={() => onAction && onAction(a.key, { strategyId, intent })}
                    sx={{
                      fontFamily: FONT,
                      fontWeight: FW_REGULAR,
                      fontSize: 11,
                      color: isPrimary ? C.white : C.black,
                      background: isPrimary ? C.black : "transparent",
                      border: `1px solid ${isPrimary ? C.black : C.mist}`,
                      px: 2.5,
                      py: 1,
                      cursor: "pointer",
                      textTransform: "uppercase",
                      letterSpacing: "0.08em",
                      "&:hover": isPrimary
                        ? { background:"#1a1a1a", borderColor:"#1a1a1a" }
                        : { borderColor: C.black, background: C.ghost },
                    }}
                  >
                    {a.label}
                  </Box>
                );
              })}
            </Box>
          )}
        </>
      )}
    </motion.div>
  );
}