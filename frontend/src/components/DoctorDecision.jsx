// DoctorDecision.jsx
import React, { useEffect, useState } from "react";
import { Box, Typography } from "@mui/material";
import { motion } from "framer-motion";

const FONT = '"Open Sans", sans-serif';
const FW_LIGHT = 300;
const FW_REGULAR = 400;
const C = {
  black:"#000", charcoal:"#444", ash:"#888",
  mist:"#e0e0e0", ghost:"#fafafa", white:"#fff",
};
const os = (x = {}) => ({
  fontFamily: FONT, fontWeight: FW_LIGHT,
  WebkitFontSmoothing: "antialiased", ...x,
});

const API_BASE_URL =
  import.meta.env.VITE_BACKEND_URL || "https://doctorassist.ai/api/";

/* ─── Presentational ─────────────────────────────────────── */

const InfoRow = ({ label, value, editing, onChange, onRemove }) => (
  <Box sx={{
    display:"grid",
    gridTemplateColumns: editing ? "180px 1fr auto" : "180px 1fr",
    gap:1, py:0.5, borderBottom:`1px solid ${C.mist}`, alignItems:"center",
  }}>
    <Typography sx={{ ...os({ fontSize:11, color:C.ash }) }}>{label}</Typography>
    {editing ? (
      <Box
        component="input"
        value={value}
        onChange={e => onChange(e.target.value)}
        sx={{
          fontFamily:FONT, fontWeight:FW_REGULAR, fontSize:11,
          border:`1px solid ${C.mist}`, px:1, py:0.4,
          background:C.white, outline:"none",
          "&:focus":{ borderColor:C.black },
        }}
      />
    ) : (
      <Typography sx={{ ...os({ fontSize:11, color:C.charcoal, fontWeight:FW_REGULAR }) }}>
        {value || "—"}
      </Typography>
    )}
    {editing && onRemove && (
      <Box
        component="button"
        onClick={onRemove}
        sx={{
          fontFamily:FONT, fontSize:10, color:C.ash,
          background:"transparent", border:`1px solid ${C.mist}`,
          px:1, py:0.3, cursor:"pointer",
          textTransform:"uppercase", letterSpacing:"0.06em",
          "&:hover":{ borderColor:C.black, color:C.black },
        }}
      >
        Remove
      </Box>
    )}
  </Box>
);

const Btn = ({ children, variant = "secondary", onClick, disabled }) => {
  const isPrimary = variant === "primary";
  return (
    <Box
      component="button"
      onClick={onClick}
      disabled={disabled}
      sx={{
        fontFamily: FONT, fontWeight: FW_REGULAR, fontSize: 11,
        color: isPrimary ? C.white : C.black,
        background: isPrimary ? C.black : "transparent",
        border: `1px solid ${isPrimary ? C.black : C.mist}`,
        px: 2, py: 0.9,
        cursor: disabled ? "not-allowed" : "pointer",
        textTransform: "uppercase", letterSpacing: "0.08em",
        opacity: disabled ? 0.5 : 1,
        "&:hover": disabled ? {} : {
          borderColor: C.black,
          background: isPrimary ? "#1a1a1a" : C.ghost,
        },
      }}
    >
      {children}
    </Box>
  );
};

/* ─── Main component ─────────────────────────────────────── */

export default function DoctorDecision({
  patientId,
  doctorId,
  patientName,
  specialty,
  onClose,
}) {
  const [loading, setLoading]   = useState(false);
  const [saving,  setSaving]    = useState(false);
  const [error,   setError]     = useState("");
  const [savedMsg, setSavedMsg] = useState("");

  const [topCard,  setTopCard]  = useState([]);
  const [liveCard, setLiveCard] = useState([]);
  const [savedStrategy, setSavedStrategy] = useState(null);

  const [editing,   setEditing]   = useState(false);
  const [rejecting, setRejecting] = useState(false);
  const [reason,    setReason]    = useState("");
  const [rejectText, setRejectText] = useState("");
  const [log, setLog] = useState([]);

  /* ── Load the decision card ─────────────────────────────── */
  useEffect(() => {
    if (!patientId || !doctorId) return;
    let cancelled = false;

    (async () => {
      setLoading(true);
      setError("");
      try {
        const res = await fetch(
          `${API_BASE_URL}hms/users/ai-legacy/generate_doctor_decision`,
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Accept: "application/json",
            },
            body: JSON.stringify({
              patient_id: patientId,
              doctor_id:  doctorId,
              specialty:  specialty || null,
            }),
          }
        );
        if (!res.ok) {
          const t = await res.text().catch(() => "");
          throw new Error(t || `HTTP ${res.status}`);
        }
        const json = await res.json();
        if (cancelled) return;
        setTopCard(json.top_card || []);
        setLiveCard(json.live_card || []);
        setSavedStrategy(json.saved_strategy || null);
      } catch (err) {
        console.error("[DoctorDecision] load failed:", err);
        if (!cancelled) setError(err.message || "Failed to load the decision card.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => { cancelled = true; };
  }, [patientId, doctorId, specialty]);

  /* ── Load the audit log ─────────────────────────────────── */
  const reloadLog = async () => {
    if (!patientId || !doctorId) return;
    try {
      const res = await fetch(
        `${API_BASE_URL}hms/users/ai-legacy/get_doctor_decision_log?patient_id=${encodeURIComponent(patientId)}&doctor_id=${encodeURIComponent(doctorId)}`
      );
      if (!res.ok) return;
      const json = await res.json();
      setLog(json.items || []);
    } catch { /* silent */ }
  };
  useEffect(() => { reloadLog(); /* eslint-disable-next-line */ }, [patientId, doctorId]);

  /* ── Row editing ─────────────────────────────────────────── */
  const setTop  = (i, v) => setTopCard(c  => c.map((r, idx) => idx === i ? { ...r, value: v } : r));
  const setLive = (i, v) => setLiveCard(c => c.map((r, idx) => idx === i ? { ...r, value: v } : r));

  const addTop  = ()  => setTopCard(c  => [...c, { label: "New field", value: "" }]);
  const addLive = ()  => setLiveCard(c => [...c, { label: "New field", value: "" }]);
  const removeTop  = (i) => setTopCard(c  => c.filter((_, idx) => idx !== i));
  const removeLive = (i) => setLiveCard(c => c.filter((_, idx) => idx !== i));

  /* ── Build the finaloutput payload ───────────────────────── */
  const buildFinalOutput = (decision, extra = {}) => {
    const merged = [...topCard, ...liveCard];
    return {
      sections:      merged.map(r => ({ label: r.label, value: r.value })),
      fields:        Object.fromEntries(merged.map(r => [r.label, r.value])),
      decision,
      reason:        reason || "",
      strategy_id:   savedStrategy?.strategy_id   || null,
      strategy_name: savedStrategy?.strategy_name || null,
      intent:        savedStrategy?.intent        || null,
      decided_by:    doctorId,
      decided_at:    new Date().toISOString(),
      ...extra,
    };
  };

  /* ── Save via the existing bulk endpoint ─────────────────── */
  const saveDecision = async (finaloutput) => {
    const payload = {
      documents: [{
        status:         "success",
        feature_id:     "documentation-treatment-plan",
        feature_name:   "Treatment Plan",
        display_method: "text",
        finaloutput,
        metadata: {
          doctor_id:  doctorId,
          patient_id: patientId,
          saved_from: "doctor-decision",
        },
      }],
    };

    const res = await fetch(
      `${API_BASE_URL}hms/users/data/context/save_documentation_features_bulk`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify(payload),
      }
    );

    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error(json.detail || json.message || `HTTP ${res.status}`);
    }
    return json;
  };

  /* ── Record the decision (audit + feature save) ──────────── */
  const recordDecision = async (action, replacementPlan) => {
    setSaving(true);
    setError("");
    setSavedMsg("");
    try {
      const res = await fetch(
        `${API_BASE_URL}hms/users/ai-legacy/record_doctor_decision`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Accept: "application/json",
          },
          body: JSON.stringify({
            patient_id:       patientId,
            doctor_id:        doctorId,
            action,
            reason:           reason || "",
            card:             topCard,
            live_card:        liveCard,
            replacement_plan: replacementPlan || null,
            strategy_id:      savedStrategy?.strategy_id   || null,
            strategy_name:    savedStrategy?.strategy_name || null,
            intent:           savedStrategy?.intent        || null,
          }),
        }
      );

      if (!res.ok) {
        const t = await res.text().catch(() => "");
        throw new Error(t || `HTTP ${res.status}`);
      }
      const json = await res.json();
      setSavedMsg(
        `${action.toUpperCase()} recorded (revision ${json.revision}${
          json.saved_to_feature ? ", saved as Treatment Plan" : ""
        }).`
      );
      await reloadLog();
    } catch (err) {
      console.error("[DoctorDecision] save failed:", err);
      setError(err.message || "Failed to record the decision.");
    } finally {
      setSaving(false);
    }
  };

  /* ── Actions ─────────────────────────────────────────────── */
  const handleAccept = async () => {
    await recordDecision("accept", null);
  };

  const handleModify = async () => {
    if (!editing) {
      setEditing(true);
      return;
    }
    await recordDecision("modify", null);
    setEditing(false);
  };

  const handleReject = async () => {
    if (!rejecting) {
      setRejecting(true);
      return;
    }
    const r = (rejectText || "").trim();
    if (!r) {
      setError("Enter the plan you want to use instead.");
      return;
    }
    await recordDecision("reject", r);
    setRejecting(false);
    setRejectText("");
  };

  const handleRefer   = async () => recordDecision("refer", null);
  const handleRequest = async () => recordDecision("request", null);

  /* ── Guard ───────────────────────────────────────────────── */
  if (!patientId || !doctorId) {
    return (
      <Box sx={{ p:4, textAlign:"center" }}>
        <Typography sx={{ ...os({ fontSize:13, color:C.ash }) }}>
          Select a patient to view the decision screen.
        </Typography>
      </Box>
    );
  }

  /* ── Render ──────────────────────────────────────────────── */
  return (
    <motion.div initial={{ opacity:0 }} animate={{ opacity:1 }} transition={{ duration:0.2 }}>
      <link
        href="https://fonts.googleapis.com/css2?family=Open+Sans:wght@300;400;600&display=swap"
        rel="stylesheet"
      />

      {/* Hero */}
      <Box sx={{ pb:3, mb:3, borderBottom:`1px solid ${C.mist}` }}>
        <Typography sx={{
          ...os({ fontSize:11, color:C.ash, letterSpacing:"0.1em", textTransform:"uppercase", mb:1 }),
        }}>
          {patientName ? `${patientName} / Doctor decision` : "Doctor decision"}
        </Typography>
        <Typography sx={{ ...os({ fontSize:22, color:C.black, lineHeight:1.3, mb:1.5 }) }}>
          You own this decision. Everything the system prepared is below, with what is still open.
        </Typography>
        <Typography sx={{ ...os({ fontSize:13, color:C.ash, maxWidth:"60ch" }) }}>
          Accept, modify, reject, refer or ask for more information. Each action is recorded with your reason.
        </Typography>
      </Box>

      {/* Header bar */}
      <Box sx={{
        display:"flex", alignItems:"center", justifyContent:"space-between",
        gap:2, pb:2, mb:3, borderBottom:`1px solid ${C.mist}`, flexWrap:"wrap",
      }}>
        <Typography sx={{
          ...os({ fontSize:11, color:C.ash, letterSpacing:"0.1em", textTransform:"uppercase" }),
        }}>
          {savedStrategy?.strategy || "No saved strategy"}
        </Typography>
        {onClose && <Btn onClick={onClose}>Close</Btn>}
      </Box>

      {/* Loading */}
      {loading && (
        <Box sx={{ p:6, textAlign:"center" }}>
          <Typography sx={{ ...os({ fontSize:12, color:C.ash }) }}>
            Loading the decision card…
          </Typography>
        </Box>
      )}

      {/* Error */}
      {!loading && error && (
        <Box sx={{ p:1.5, mb:3, border:"1px solid #ffcdd2", background:"#fce4ec" }}>
          <Typography sx={{ ...os({ fontSize:12, color:"#c62828" }) }}>{error}</Typography>
        </Box>
      )}

      {/* Proposed strategy (saved) */}
      {!loading && topCard.length > 0 && (
        <Box sx={{ mb:3 }}>
          <Typography sx={{
            ...os({ fontSize:11, color:C.black, fontWeight:FW_REGULAR,
                   textTransform:"uppercase", letterSpacing:"0.08em", mb:1.5 }),
          }}>
            Proposed first-line strategy
          </Typography>
          {topCard.map((r, i) => (
            <InfoRow
              key={`top-${i}`}
              label={r.label}
              value={r.value}
              editing={editing}
              onChange={v => setTop(i, v)}
              onRemove={editing ? () => removeTop(i) : null}
            />
          ))}
          {editing && (
            <Box sx={{ display:"flex", gap:1, mt:1.5 }}>
              <Btn onClick={addTop}>+ Add field</Btn>
            </Box>
          )}
        </Box>
      )}

      {/* Live rows (graph) */}
      {!loading && liveCard.length > 0 && (
        <Box sx={{ mb:3 }}>
          <Typography sx={{
            ...os({ fontSize:11, color:C.black, fontWeight:FW_REGULAR,
                   textTransform:"uppercase", letterSpacing:"0.08em", mb:1.5 }),
          }}>
            Live from the record
          </Typography>
          {liveCard.map((r, i) => (
            <InfoRow
              key={`live-${i}`}
              label={r.label}
              value={r.value}
              editing={editing}
              onChange={v => setLive(i, v)}
              onRemove={editing ? () => removeLive(i) : null}
            />
          ))}
          {editing && (
            <Box sx={{ display:"flex", gap:1, mt:1.5 }}>
              <Btn onClick={addLive}>+ Add field</Btn>
            </Box>
          )}
        </Box>
      )}

      {/* Reason */}
      <Box sx={{ mb:3 }}>
        <Typography sx={{
          ...os({ fontSize:11, color:C.black, fontWeight:FW_REGULAR,
                 textTransform:"uppercase", letterSpacing:"0.08em", mb:1.5 }),
        }}>
          Reason or modification
        </Typography>
        <Box
          component="textarea"
          value={reason}
          onChange={e => setReason(e.target.value)}
          placeholder="Reason or modification (recorded in the audit log)"
          sx={{
            fontFamily:FONT, fontWeight:FW_LIGHT, fontSize:12,
            width:"100%", minHeight:80, border:`1px solid ${C.mist}`,
            p:1.5, background:C.white, resize:"vertical", outline:"none",
            "&:focus":{ borderColor:C.black },
          }}
        />
      </Box>

      {/* Replacement plan (reject) */}
      {rejecting && (
        <Box sx={{ mb:3 }}>
          <Typography sx={{
            ...os({ fontSize:11, color:C.black, fontWeight:FW_REGULAR,
                   textTransform:"uppercase", letterSpacing:"0.08em", mb:1.5 }),
          }}>
            Replacement plan (you write the plan)
          </Typography>
          <Box
            component="textarea"
            value={rejectText}
            onChange={e => setRejectText(e.target.value)}
            placeholder="Type the plan you want to use instead. This becomes the Treatment Plan."
            sx={{
              fontFamily:FONT, fontWeight:FW_LIGHT, fontSize:12,
              width:"100%", minHeight:120, border:`1px solid ${C.mist}`,
              p:1.5, background:C.white, resize:"vertical", outline:"none",
              "&:focus":{ borderColor:C.black },
            }}
          />
        </Box>
      )}

      {/* Actions */}
      <Box sx={{ display:"flex", flexWrap:"wrap", gap:1.5, mb:3 }}>
        <Btn variant="primary" onClick={handleAccept}  disabled={saving || loading}>
          {saving ? "Saving…" : "Accept"}
        </Btn>
        <Btn onClick={handleModify} disabled={saving || loading}>
          {editing ? "Save modification" : "Modify"}
        </Btn>
        <Btn onClick={handleReject} disabled={saving || loading}>
          {rejecting ? "Save rejection & plan" : "Reject"}
        </Btn>
        <Btn onClick={handleRefer}   disabled={saving || loading}>Refer to tumour board</Btn>
        <Btn onClick={handleRequest} disabled={saving || loading}>Request more information</Btn>
      </Box>

      {/* Saved feedback */}
      {savedMsg && (
        <Box sx={{ p:1.5, mb:2, border:"1px solid #c8e6c9", background:"#f1f8e9" }}>
          <Typography sx={{ ...os({ fontSize:12, color:"#2e7d32" }) }}>
            {savedMsg}
          </Typography>
        </Box>
      )}

      {/* Decision log */}
      <Box>
        <Typography sx={{
          ...os({ fontSize:11, color:C.black, fontWeight:FW_REGULAR,
                 textTransform:"uppercase", letterSpacing:"0.08em", mb:1.5 }),
        }}>
          Decision log for this patient
        </Typography>
        {log.length === 0 ? (
          <Typography sx={{ ...os({ fontSize:11, color:C.ash }) }}>
            No decisions recorded yet in this session.
          </Typography>
        ) : (
          <Box component="table" sx={{ width:"100%", borderCollapse:"collapse" }}>
            <Box component="thead">
              <Box component="tr">
                {["When","Action","Detail","Revision"].map(h => (
                  <Box component="th" key={h} sx={{
                    textAlign:"left", fontSize:10, fontWeight:FW_LIGHT, color:C.ash,
                    textTransform:"uppercase", letterSpacing:"0.08em",
                    py:1, borderBottom:`1px solid ${C.black}`,
                  }}>{h}</Box>
                ))}
              </Box>
            </Box>
            <Box component="tbody">
              {log.map((l, i) => (
                <Box component="tr" key={i}>
                  <Box component="td" sx={{ fontSize:11, color:C.ash, py:1.2, borderBottom:`1px solid ${C.mist}` }}>
                    {l.decided_at?.slice(0,16).replace("T"," ")}
                  </Box>
                  <Box component="td" sx={{ fontSize:11, color:C.black, py:1.2, borderBottom:`1px solid ${C.mist}`, textTransform:"uppercase" }}>
                    {l.action}
                  </Box>
                  <Box component="td" sx={{ fontSize:11, color:C.charcoal, py:1.2, borderBottom:`1px solid ${C.mist}` }}>
                    {l.reason || l.replacement_plan || "—"}
                  </Box>
                  <Box component="td" sx={{ fontSize:11, color:C.ash, py:1.2, borderBottom:`1px solid ${C.mist}` }}>
                    {l.revision}
                  </Box>
                </Box>
              ))}
            </Box>
          </Box>
        )}
      </Box>
    </motion.div>
  );
}