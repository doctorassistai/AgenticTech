import React, { useState, useEffect, useCallback } from "react";
import { Box, Typography, Chip } from "@mui/material";
import {
  RefreshRounded,
  SaveRounded,
  AddRounded,
  DeleteOutlineRounded,
  WhatshotRounded,
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

const RISK_COLOR = { Low: "#2e7d32", Moderate: "#8a6d00", High: "#b3261e" };
const RISK_BG = { Low: "#eef7ee", Moderate: "#fbf6e3", High: "#fbecea" };
const SEVERITY_OPTIONS = ["Mild", "Moderate", "Severe"];

const formatDate = (d) => {
  if (!d) return "—";
  try { return new Date(d + "T00:00:00").toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" }); }
  catch { return d; }
};

export default function RheumatologyFlarePrediction({ doctorId, patientId, patientName }) {
  const [context, setContext] = useState(null);
  const [flareEvents, setFlareEvents] = useState([]);
  const [eventForm, setEventForm] = useState({ event_date: "", severity: "Moderate", notes: "" });
  const [eventFormOpen, setEventFormOpen] = useState(false);
  const [eventSaving, setEventSaving] = useState(false);
  const [eventError, setEventError] = useState("");

  const [result, setResult] = useState(null);
  const [predicting, setPredicting] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState("");
  const [predictError, setPredictError] = useState("");

  const loadContext = useCallback(async () => {
    if (!patientId || !doctorId) return;
    try {
      const res = await fetch(`${API_BASE_URL}hms/users/data/context/rheumatology-flare/context-preview/${patientId}/${doctorId}`);
      const json = await res.json();
      if (json?.status === "success") setContext(json.data || null);
    } catch (err) {
      console.error("Failed to load flare context:", err);
    }
  }, [patientId, doctorId]);

  const loadFlareEvents = useCallback(async () => {
    if (!patientId || !doctorId) return;
    try {
      const res = await fetch(`${API_BASE_URL}hms/users/data/context/rheumatology-flare/flare-events/${patientId}/${doctorId}`);
      const json = await res.json();
      if (json?.status === "success") setFlareEvents(json.data || []);
    } catch (err) {
      console.error("Failed to load flare events:", err);
    }
  }, [patientId, doctorId]);

useEffect(() => {
    loadContext();
    loadFlareEvents();
    return subscribeRheumContextUpdate(loadContext);
  }, [loadContext, loadFlareEvents]);

  const handleAddEvent = async () => {
    setEventError("");
    if (!eventForm.event_date) { setEventError("Event date is required."); return; }
    setEventSaving(true);
    try {
      const res = await fetch(`${API_BASE_URL}hms/users/data/context/rheumatology-flare/add-flare-event`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ patient_id: patientId, doctor_id: doctorId, ...eventForm }),
      });
      const json = await res.json();
      if (!res.ok || json?.status !== "success") throw new Error(json?.detail || "Failed to log flare event");
      setEventForm({ event_date: "", severity: "Moderate", notes: "" });
      setEventFormOpen(false);
      loadFlareEvents();
      loadContext();
      announceRheumContextUpdate("flare-prediction");
    } catch (err) {
      console.error("Add flare event failed:", err);
      setEventError(err.message || "Failed to log flare event");
    } finally {
      setEventSaving(false);
    }
  };

  const handleDeleteEvent = async (eventId) => {
    try {
      const res = await fetch(`${API_BASE_URL}hms/users/data/context/rheumatology-flare/flare-event/${eventId}`, { method: "DELETE" });
      const json = await res.json();
      if (!res.ok || json?.status !== "success") throw new Error(json?.detail || "Delete failed");
      loadFlareEvents();
      loadContext();
      announceRheumContextUpdate("flare-prediction");
    } catch (err) {
      console.error("Delete flare event failed:", err);
    }
  };

  const handlePredict = async () => {
    setPredictError("");
    setPredicting(true);
    try {
      const res = await fetch(`${API_BASE_URL}hms/users/data/context/rheumatology-flare/predict`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ doctor_id: doctorId, patient_id: patientId }),
      });
      const json = await res.json();
      if (!res.ok || json?.status !== "success") throw new Error(json?.detail || "Failed to compute flare risk");
      setResult({ ...json.finaloutput, context_used: json.context_used });
    } catch (err) {
      console.error("Flare prediction failed:", err);
      setPredictError(err.message || "Failed to compute flare risk");
    } finally {
      setPredicting(false);
    }
  };

  const handleSave = async () => {
    if (!result) return;
    setSaving(true);
    setSaveMsg("");
    try {
      const res = await fetch(`${API_BASE_URL}hms/users/data/context/rheumatology-flare/save`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          patient_id: patientId, doctor_id: doctorId,
          risk_level: result.risk_level, score: result.score, factors: result.factors,
          narrative: result.narrative || "", context_used: result.context_used || {},
        }),
      });
      const json = await res.json();
      if (!res.ok || json?.status !== "success") throw new Error(json?.detail || json?.message || "Save failed");
      setSaveMsg("✅ Flare prediction saved");
      window.dispatchEvent(new Event("refreshRheumatologyFlareHistory"));
      announceRheumContextUpdate("flare-prediction");
    } catch (err) {
      console.error("Flare prediction save failed:", err);
      setSaveMsg(`❌ ${err.message || "Save failed"}`);
    } finally {
      setSaving(false);
      setTimeout(() => setSaveMsg(""), 3000);
    }
  };

  return (
    <Box sx={{ ...card, overflow: "hidden" }}>
      <Box sx={{ px: 3, py: 2.5, borderBottom: `1px solid ${C.fog}`, background: C.ghost, display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 1.5 }}>
        <Box>
          <Typography sx={{ ...os({ fontSize: 14, color: C.ink, letterSpacing: "0.02em" }) }}>Flare Prediction</Typography>
          <Typography sx={{ ...os({ fontSize: 11, color: C.ash, mt: 0.4 }) }}>
            {patientName ? `Risk of flare before next follow-up — ${patientName}` : "Risk of flare before next follow-up"}
          </Typography>
        </Box>
        <Chip label="Module 10 · Flare Prediction" size="small" sx={{ background: C.black, color: C.white, fontWeight: 300, fontSize: 10, letterSpacing: "0.04em", borderRadius: "2px", height: 22 }} />
      </Box>

      {/* Context signals summary */}
      {context && (
        <Box sx={{ mx: 3, mt: 2, p: 1.5, borderRadius: "2px", background: C.ghost, border: `1px solid ${C.fog}`, display: "flex", flexDirection: "column", gap: 0.5 }}>
          <Typography sx={{ ...os({ fontSize: 10, color: C.silver, textTransform: "uppercase", letterSpacing: "0.07em", mb: 0.25 }) }}>Signals in use</Typography>
          <Typography sx={{ ...os({ fontSize: 11, color: C.charcoal }) }}>
            Disease activity trend: {context.activity_trend_worsening ? "worsening" : "stable/improving or no comparison available"}
          </Typography>
          <Typography sx={{ ...os({ fontSize: 11, color: C.charcoal }) }}>
            Rising inflammatory markers: {context.rising_inflammatory_markers?.length ? context.rising_inflammatory_markers.join(", ") : "none recorded"}
          </Typography>
          <Typography sx={{ ...os({ fontSize: 11, color: C.charcoal }) }}>
            Recent DMARD/biologic stopped (90d): {context.recent_medication_changes?.dmard_stopped?.length || 0}
            {" · "}Steroid stopped/tapered (90d): {context.recent_medication_changes?.steroid_stopped?.length || 0}
          </Typography>
          <Typography sx={{ ...os({ fontSize: 11, color: C.charcoal }) }}>
            Flare events in last 12 months: {context.flare_events_last_12_months ?? 0}
          </Typography>
        </Box>
      )}

      {/* Flare event log */}
      <Box sx={{ px: 3, pt: 2.5 }}>
        <Box sx={{ display: "flex", alignItems: "center", justifyContent: "space-between", mb: 1 }}>
          <Typography sx={{ ...os({ fontSize: 11, color: C.ash, textTransform: "uppercase", letterSpacing: "0.07em" }) }}>Flare Event Log</Typography>
          <Box component="button" type="button" onClick={() => setEventFormOpen((v) => !v)} sx={{ ...ghostButton, fontSize: 10.5, px: 1.25, py: 0.4 }}>
            <AddRounded sx={{ fontSize: 13 }} /> {eventFormOpen ? "Cancel" : "Log Flare"}
          </Box>
        </Box>

        {eventFormOpen && (
          <Box sx={{ p: 1.5, mb: 1.5, border: `1px solid ${C.fog}`, borderRadius: "2px", display: "grid", gridTemplateColumns: { xs: "1fr", sm: "1fr 1fr 1fr" }, gap: 1 }}>
            <input type="date" style={inputSx} value={eventForm.event_date} onChange={(e) => setEventForm((f) => ({ ...f, event_date: e.target.value }))} />
            <select style={inputSx} value={eventForm.severity} onChange={(e) => setEventForm((f) => ({ ...f, severity: e.target.value }))}>
              {SEVERITY_OPTIONS.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
            <input style={inputSx} placeholder="Notes (optional)" value={eventForm.notes} onChange={(e) => setEventForm((f) => ({ ...f, notes: e.target.value }))} />
            {eventError && <Typography sx={{ ...os({ fontSize: 11, color: "#b3261e", gridColumn: "1 / -1" }) }}>{eventError}</Typography>}
            <Box sx={{ gridColumn: "1 / -1", display: "flex", justifyContent: "flex-end" }}>
              <Box component="button" type="button" onClick={handleAddEvent} disabled={eventSaving} sx={{ ...actionButton, minWidth: 100, py: 0.75, fontSize: 11 }}>
                {eventSaving ? "Saving..." : "Log"}
              </Box>
            </Box>
          </Box>
        )}

        {flareEvents.length > 0 ? (
          <Box sx={{ display: "flex", flexWrap: "wrap", gap: 0.75, mb: 1 }}>
            {flareEvents.map((e) => (
              <Chip
                key={e._id}
                label={`${formatDate(e.event_date)} · ${e.severity}`}
                size="small"
                onDelete={() => handleDeleteEvent(e._id)}
                deleteIcon={<DeleteOutlineRounded sx={{ fontSize: 14 }} />}
                sx={{ fontSize: 10.5, height: 24, background: C.ghost, color: C.charcoal, border: `1px solid ${C.mist}` }}
              />
            ))}
          </Box>
        ) : (
          <Typography sx={{ ...os({ fontSize: 11.5, color: C.silver, mb: 1 }) }}>No flare events logged yet.</Typography>
        )}
      </Box>

      {predictError && <Typography sx={{ ...os({ fontSize: 12, color: "#b3261e", mx: 3, mb: 1 }) }}>{predictError}</Typography>}

      <Box sx={{ px: 3, pb: 2, display: "flex", justifyContent: "flex-end" }}>
        <Box component="button" type="button" onClick={handlePredict} disabled={predicting} sx={{ ...actionButton, minWidth: 190 }}>
          {predicting ? <RefreshRounded sx={{ fontSize: 15, animation: "spin 1s linear infinite" }} /> : <WhatshotRounded sx={{ fontSize: 15 }} />}
          {predicting ? "Computing..." : "Compute Flare Risk"}
        </Box>
      </Box>

      {/* Result */}
      {result && (
        <Box sx={{ px: 3, pb: 2 }}>
          <Box sx={{ border: `1px solid ${C.fog}`, borderRadius: "4px", overflow: "hidden" }}>
            <Box sx={{ px: 2, py: 1.5, background: RISK_BG[result.risk_level] || C.ghost, borderBottom: `1px solid ${C.fog}`, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              <Typography sx={{ ...os({ fontSize: 13, color: C.ink }) }}>Flare Risk</Typography>
              <Chip label={`${result.risk_level} (score ${result.score})`} size="small" sx={{ fontSize: 10.5, height: 20, background: RISK_COLOR[result.risk_level] || C.charcoal, color: C.white }} />
            </Box>
            <Box sx={{ p: 1.75, display: "flex", flexDirection: "column", gap: 0.5 }}>
              {(result.factors || []).map((f, i) => (
                <Typography key={i} sx={{ ...os({ fontSize: 11.5, color: C.charcoal }) }}>• {f}</Typography>
              ))}
            </Box>
            {result.narrative && (
              <Box sx={{ mx: 1.75, mb: 1.75, p: 1.5, borderRadius: "2px", background: C.ghost, border: `1px solid ${C.fog}` }}>
                <Typography sx={{ ...os({ fontSize: 10, color: C.silver, textTransform: "uppercase", letterSpacing: "0.07em", mb: 0.5 }) }}>AI Summary</Typography>
                <Typography sx={{ ...os({ fontSize: 12, color: C.charcoal, lineHeight: 1.6 }) }}>{result.narrative}</Typography>
              </Box>
            )}
          </Box>
        </Box>
      )}

      {/* Footer */}
      <Box sx={{ px: 3, py: 2, borderTop: `1px solid ${C.fog}`, background: C.ghost, display: "flex", alignItems: "center", justifyContent: "flex-end", gap: 1.5 }}>
        {saveMsg && <Typography sx={{ ...os({ fontSize: 12, color: saveMsg.includes("✅") ? "#2e7d32" : "#d32f2f" }) }}>{saveMsg}</Typography>}
        <Box component="button" type="button" onClick={handleSave} disabled={saving || !result} sx={{ ...actionButton, minWidth: 200 }}>
          <SaveRounded sx={{ fontSize: 15 }} /> {saving ? "Saving..." : "Save Prediction"}
        </Box>
      </Box>

      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </Box>
  );
}