import React, { useState, useEffect, useCallback } from "react";
import { Box, Typography, Chip } from "@mui/material";
import {
  RefreshRounded,
  SaveRounded,
  AddRounded,
  DeleteOutlineRounded,
  MonitorHeartRounded,
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

const MANIFESTATION_TYPES = [
  "Interstitial lung disease", "Uveitis", "Vasculitis", "Renal involvement",
  "Skin manifestations", "Neuropathy", "Cardiovascular involvement",
  "GI manifestations", "Sicca symptoms",
];
const SEVERITY_OPTIONS = ["Mild", "Moderate", "Severe"];
const STATUS_OPTIONS = ["Active", "Resolved"];
const SOURCE_OPTIONS = ["Doctor exam", "Patient reported", "Specialist referral/report", "Investigation finding"];

const CATEGORY_COLOR = { green: "#2e7d32", yellow: "#8a6d00", red: "#b3261e", resolved: "#5b5b5b" };
const CATEGORY_BG = { green: "#eef7ee", yellow: "#fbf6e3", red: "#fbecea", resolved: "#f2f2f2" };
const CATEGORY_LABEL = { green: "Mild / Stable", yellow: "Moderate / Monitor", red: "Severe / Review", resolved: "Resolved" };

const EMPTY_FORM = {
  manifestation_type: "", date_noted: "", severity: "Mild",
  status: "Active", source: "Doctor exam", notes: "",
};
const formatDate = (d) => {
  if (!d) return "—";
  try { return new Date(d + "T00:00:00").toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" }); }
  catch { return d; }
};

export default function RheumatologyManifestation({ doctorId, patientId, patientName }) {
  const [suggestedTypes, setSuggestedTypes] = useState([]);
  const [rawSymptoms, setRawSymptoms] = useState([]);
  const [hasIntakeData, setHasIntakeData] = useState(false);

  const [events, setEvents] = useState([]);
  const [form, setForm] = useState(EMPTY_FORM);
  const [formOpen, setFormOpen] = useState(false);
  const [formSaving, setFormSaving] = useState(false);
  const [formError, setFormError] = useState("");

  const [result, setResult] = useState(null);
  const [assessing, setAssessing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState("");
  const [assessError, setAssessError] = useState("");

  const loadContext = useCallback(async () => {
    if (!patientId || !doctorId) return;
    try {
      const res = await fetch(`${API_BASE_URL}hms/users/data/context/rheumatology-manifestations/context-preview/${patientId}/${doctorId}`);
      const json = await res.json();
      if (json?.status === "success") {
        setSuggestedTypes(json.data?.suggested_types_from_intake || []);
        setRawSymptoms(json.data?.raw_extra_articular_symptoms || []);
        setHasIntakeData(Boolean(json.has_intake_data));
      }
    } catch (err) {
      console.error("Failed to load manifestation context:", err);
    }
  }, [patientId, doctorId]);

  const loadEvents = useCallback(async () => {
    if (!patientId || !doctorId) return;
    try {
      const res = await fetch(`${API_BASE_URL}hms/users/data/context/rheumatology-manifestations/events/${patientId}/${doctorId}`);
      const json = await res.json();
      if (json?.status === "success") setEvents(json.data || []);
    } catch (err) {
      console.error("Failed to load manifestation events:", err);
    }
  }, [patientId, doctorId]);

useEffect(() => {
    loadContext();
    loadEvents();
    return subscribeRheumContextUpdate(() => { loadContext(); loadEvents(); });
  }, [loadContext, loadEvents]);

  const handleAddEvent = async () => {
    setFormError("");
    if (!form.date_noted) { setFormError("Date noted is required."); return; }
    if (!form.manifestation_type) { setFormError("Select a manifestation type."); return; }
    setFormSaving(true);
    try {
      const res = await fetch(`${API_BASE_URL}hms/users/data/context/rheumatology-manifestations/add-event`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ patient_id: patientId, doctor_id: doctorId, ...form }),
      });
      const json = await res.json();
      if (!res.ok || json?.status !== "success") throw new Error(json?.detail || "Failed to log manifestation event");
      setForm(EMPTY_FORM);
      setFormOpen(false);
      loadEvents();
      announceRheumContextUpdate("manifestation");
    } catch (err) {
      console.error("Add manifestation event failed:", err);

      setFormError(err.message || "Failed to log manifestation event");
    } finally {
      setFormSaving(false);
    }
  };

  const handleDeleteEvent = async (eventId) => {
    try {
      const res = await fetch(`${API_BASE_URL}hms/users/data/context/rheumatology-manifestations/event/${eventId}`, { method: "DELETE" });
      const json = await res.json();
      if (!res.ok || json?.status !== "success") throw new Error(json?.detail || "Delete failed");
      loadEvents();
      announceRheumContextUpdate("manifestation");
    } catch (err) {
      console.error("Delete manifestation event failed:", err);

    }
  };

  const handleAssess = async () => {
    setAssessError("");
    setAssessing(true);
    try {
      const res = await fetch(`${API_BASE_URL}hms/users/data/context/rheumatology-manifestations/assess`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ doctor_id: doctorId, patient_id: patientId }),
      });
      const json = await res.json();
      if (!res.ok || json?.status !== "success") throw new Error(json?.detail || "Failed to assess manifestations");
      setResult(json.finaloutput);
    } catch (err) {
      console.error("Manifestation assessment failed:", err);
      setAssessError(err.message || "Failed to assess manifestations");
    } finally {
      setAssessing(false);
    }
  };

  const handleSave = async () => {
    if (!result?.panel?.length) return;
    setSaving(true);
    setSaveMsg("");
    try {
      const res = await fetch(`${API_BASE_URL}hms/users/data/context/rheumatology-manifestations/save`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          patient_id: patientId, doctor_id: doctorId,
          panel: result.panel, narrative: result.narrative || "",
        }),
      });
      const json = await res.json();
      if (!res.ok || json?.status !== "success") throw new Error(json?.detail || json?.message || "Save failed");
      setSaveMsg("✅ Manifestation assessment saved");
      window.dispatchEvent(new Event("refreshRheumatologyManifestationHistory"));
      announceRheumContextUpdate("manifestation");
    } catch (err) {
      console.error("Manifestation assessment save failed:", err);
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
          <Typography sx={{ ...os({ fontSize: 14, color: C.ink, letterSpacing: "0.02em" }) }}>Extra-Articular Manifestations</Typography>
          <Typography sx={{ ...os({ fontSize: 11, color: C.ash, mt: 0.4 }) }}>
            {patientName ? `Longitudinal manifestation tracking — ${patientName}` : "Longitudinal manifestation tracking"}
          </Typography>
        </Box>
        <Chip label="Module 12 · Extra-Articular Manifestations" size="small" sx={{ background: C.black, color: C.white, fontWeight: 300, fontSize: 10, letterSpacing: "0.04em", borderRadius: "2px", height: 22 }} />
      </Box>

      {/* Intake hint */}
      {hasIntakeData && suggestedTypes.length > 0 && (
        <Box sx={{ mx: 3, mt: 2, p: 1.5, borderRadius: "2px", background: C.ghost, border: `1px solid ${C.fog}` }}>
          <Typography sx={{ ...os({ fontSize: 11, color: C.charcoal, mb: 0.75 }) }}>
            Suggested from Module 1 intake symptoms — review and log if confirmed:
          </Typography>
          <Box sx={{ display: "flex", flexWrap: "wrap", gap: 0.6 }}>
            {suggestedTypes.map((t) => (
              <Chip
                key={t}
                label={t}
                size="small"
                onClick={() => { setForm((f) => ({ ...f, manifestation_type: t })); setFormOpen(true); }}
                sx={{ fontSize: 10.5, height: 22, background: C.white, color: C.charcoal, border: `1px solid ${C.mist}`, cursor: "pointer" }}
              />
            ))}
          </Box>
          {rawSymptoms.length > 0 && (
            <Typography sx={{ ...os({ fontSize: 10.5, color: C.silver, mt: 0.75 }) }}>
              Raw intake symptoms: {rawSymptoms.join(", ")}
            </Typography>
          )}
        </Box>
      )}

      {/* Event log */}
      <Box sx={{ px: 3, pt: 2.5 }}>
        <Box sx={{ display: "flex", alignItems: "center", justifyContent: "space-between", mb: 1 }}>
          <Typography sx={{ ...os({ fontSize: 11, color: C.ash, textTransform: "uppercase", letterSpacing: "0.07em" }) }}>Manifestation Event Log</Typography>
          <Box component="button" type="button" onClick={() => setFormOpen((v) => !v)} sx={{ ...ghostButton, fontSize: 10.5, px: 1.25, py: 0.4 }}>
            <AddRounded sx={{ fontSize: 13 }} /> {formOpen ? "Cancel" : "Log Event"}
          </Box>
        </Box>

        {formOpen && (
          <Box sx={{ p: 1.75, mb: 1.5, border: `1px solid ${C.fog}`, borderRadius: "2px", display: "grid", gridTemplateColumns: { xs: "1fr", sm: "1fr 1fr 1fr" }, gap: 1 }}>
            <select
  style={{ ...inputSx, gridColumn: { xs: "1 / -1", sm: "1 / span 2" } }}
  value={form.manifestation_type}
  onChange={(e) => setForm((f) => ({ ...f, manifestation_type: e.target.value }))}
>
  <option value="" disabled>Select manifestation type…</option>
  {MANIFESTATION_TYPES.map((m) => <option key={m} value={m}>{m}</option>)}
</select>
            <input type="date" style={inputSx} value={form.date_noted} onChange={(e) => setForm((f) => ({ ...f, date_noted: e.target.value }))} />

            <Box>
              <Typography sx={{ ...os({ fontSize: 10, color: C.ash, mb: 0.5 }) }}>Severity</Typography>
              <select style={inputSx} value={form.severity} onChange={(e) => setForm((f) => ({ ...f, severity: e.target.value }))}>
                {SEVERITY_OPTIONS.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
            </Box>
            <Box>
              <Typography sx={{ ...os({ fontSize: 10, color: C.ash, mb: 0.5 }) }}>Status</Typography>
              <select style={inputSx} value={form.status} onChange={(e) => setForm((f) => ({ ...f, status: e.target.value }))}>
                {STATUS_OPTIONS.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
            </Box>
            <Box>
              <Typography sx={{ ...os({ fontSize: 10, color: C.ash, mb: 0.5 }) }}>Source</Typography>
              <select style={inputSx} value={form.source} onChange={(e) => setForm((f) => ({ ...f, source: e.target.value }))}>
                {SOURCE_OPTIONS.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
            </Box>
            <input style={{ ...inputSx, gridColumn: "1 / -1" }} placeholder="Notes (optional, free text)" value={form.notes} onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))} />

            {formError && <Typography sx={{ ...os({ fontSize: 11, color: "#b3261e", gridColumn: "1 / -1" }) }}>{formError}</Typography>}
            <Box sx={{ gridColumn: "1 / -1", display: "flex", justifyContent: "flex-end" }}>
              <Box component="button" type="button" onClick={handleAddEvent} disabled={formSaving} sx={{ ...actionButton, minWidth: 100, py: 0.75, fontSize: 11 }}>
                {formSaving ? "Saving..." : "Log Event"}
              </Box>
            </Box>
          </Box>
        )}

        {events.length > 0 ? (
          <Box sx={{ display: "flex", flexWrap: "wrap", gap: 0.75, mb: 1 }}>
            {events.map((ev) => (
              <Chip
                key={ev._id}
                label={`${formatDate(ev.date_noted)} · ${ev.manifestation_type} · ${ev.severity} · ${ev.status}`}
                size="small"
                onDelete={() => handleDeleteEvent(ev._id)}
                deleteIcon={<DeleteOutlineRounded sx={{ fontSize: 14 }} />}
                sx={{ fontSize: 10.5, height: 24, background: C.ghost, color: C.charcoal, border: `1px solid ${C.mist}` }}
              />
            ))}
          </Box>
        ) : (
          <Typography sx={{ ...os({ fontSize: 11.5, color: C.silver, mb: 1 }) }}>No manifestation events logged yet.</Typography>
        )}
      </Box>

      {assessError && <Typography sx={{ ...os({ fontSize: 12, color: "#b3261e", mx: 3, mb: 1 }) }}>{assessError}</Typography>}

      <Box sx={{ px: 3, pb: 2, display: "flex", justifyContent: "flex-end" }}>
        <Box component="button" type="button" onClick={handleAssess} disabled={assessing || events.length === 0} sx={{ ...actionButton, minWidth: 190 }}>
          {assessing ? <RefreshRounded sx={{ fontSize: 15, animation: "spin 1s linear infinite" }} /> : <MonitorHeartRounded sx={{ fontSize: 15 }} />}
          {assessing ? "Assessing..." : "Assess Manifestations"}
        </Box>
      </Box>

      {/* Results */}
      {result?.panel?.length > 0 && (
        <Box sx={{ px: 3, pb: 2, display: "flex", flexDirection: "column", gap: 1.5 }}>
          <Box sx={{ display: "grid", gridTemplateColumns: { xs: "1fr", sm: "repeat(2, 1fr)", lg: "repeat(3, 1fr)" }, gap: 1.5 }}>
            {result.panel.map((p) => (
              <Box key={p.manifestation_type} sx={{ border: `1px solid ${C.fog}`, borderRadius: "4px", overflow: "hidden" }}>
                <Box sx={{ px: 1.75, py: 1.25, background: CATEGORY_BG[p.category] || C.ghost, borderBottom: `1px solid ${C.fog}`, display: "flex", alignItems: "center", justifyContent: "space-between", gap: 1 }}>
                  <Typography sx={{ ...os({ fontSize: 12.5, color: C.ink }) }}>{p.manifestation_type}</Typography>
                  <Chip label={CATEGORY_LABEL[p.category] || p.category} size="small" sx={{ fontSize: 9.5, height: 19, background: CATEGORY_COLOR[p.category] || C.charcoal, color: C.white }} />
                </Box>
                <Box sx={{ p: 1.5 }}>
                  <Typography sx={{ ...os({ fontSize: 10.5, color: C.silver, mb: 0.6 }) }}>
                    {p.latest_event?.severity} · {p.latest_event?.status} · {formatDate(p.latest_event?.date_noted)} · {p.latest_event?.source}
                  </Typography>
                  {(p.reasons || []).map((r, i) => (
                    <Typography key={i} sx={{ ...os({ fontSize: 11, color: C.charcoal, lineHeight: 1.5 }) }}>• {r}</Typography>
                  ))}
                </Box>
              </Box>
            ))}
          </Box>

          {result.narrative && (
            <Box sx={{ p: 1.75, borderRadius: "2px", background: C.ghost, border: `1px solid ${C.fog}` }}>
              <Typography sx={{ ...os({ fontSize: 10, color: C.silver, textTransform: "uppercase", letterSpacing: "0.07em", mb: 0.5 }) }}>AI Summary</Typography>
              <Typography sx={{ ...os({ fontSize: 12.5, color: C.charcoal, lineHeight: 1.6 }) }}>{result.narrative}</Typography>
            </Box>
          )}
        </Box>
      )}

      {/* Footer */}
      <Box sx={{ px: 3, py: 2, borderTop: `1px solid ${C.fog}`, background: C.ghost, display: "flex", alignItems: "center", justifyContent: "flex-end", gap: 1.5 }}>
        {saveMsg && <Typography sx={{ ...os({ fontSize: 12, color: saveMsg.includes("✅") ? "#2e7d32" : "#d32f2f" }) }}>{saveMsg}</Typography>}
        <Box component="button" type="button" onClick={handleSave} disabled={saving || !result?.panel?.length} sx={{ ...actionButton, minWidth: 200 }}>
          <SaveRounded sx={{ fontSize: 15 }} /> {saving ? "Saving..." : "Save Assessment"}
        </Box>
      </Box>

      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </Box>
  );
}