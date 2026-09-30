import React, { useState, useEffect, useCallback, useMemo } from "react";
import { Box, Typography, Chip } from "@mui/material";
import { RefreshRounded, TimelineRounded, ExpandMoreRounded, ExpandLessRounded } from "@mui/icons-material";
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

const TRACK_COLORS = {
  "Symptoms": "#5c6bc0",
  "Diagnosis": "#8e24aa",
  "Biomarkers": "#00897b",
  "Imaging": "#3949ab",
  "Disease Scores": "#e53935",
  "Medications": "#6d4c41",
  "Procedures": "#f4511e",
  "Response": "#43a047",
  "Flare": "#fb8c00",
  "Follow-up": "#546e7a",
};

const formatDate = (d) => {
  if (!d) return "—";
  try {
    const dateOnly = d.length <= 10 ? d + "T00:00:00" : d;
    return new Date(dateOnly).toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" });
  } catch {
    return d;
  }
};

export default function RheumatologyTimeline({ doctorId, patientId, patientName }) {
  const [events, setEvents] = useState([]);
  const [tracksAll, setTracksAll] = useState([]);
  const [activeTracks, setActiveTracks] = useState(new Set());
  const [expandedId, setExpandedId] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const fetchTimeline = useCallback(async () => {
    if (!patientId || !doctorId) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`${API_BASE_URL}hms/users/data/context/rheumatology-timeline/${patientId}/${doctorId}`);
      const json = await res.json();
      if (json?.status === "success") {
        setEvents(json.data || []);
        setTracksAll(json.tracks || []);
        setActiveTracks(new Set(json.tracks || []));
      } else {
        setError(json?.detail || "Failed to load timeline");
      }
    } catch (err) {
      console.error("Failed to fetch timeline:", err);
      setError("Network error while fetching timeline");
    } finally {
      setLoading(false);
    }
  }, [patientId, doctorId]);

useEffect(() => {
    fetchTimeline();
    return subscribeRheumContextUpdate(fetchTimeline);
  }, [fetchTimeline]);
  
  const toggleTrack = (track) => {
    setActiveTracks((prev) => {
      const next = new Set(prev);
      if (next.has(track)) next.delete(track); else next.add(track);
      return next;
    });
  };

  const filteredEvents = useMemo(
    () => events.filter((e) => activeTracks.has(e.track)),
    [events, activeTracks]
  );

  return (
    <Box sx={{ ...card, overflow: "hidden" }}>
      <Box sx={{ px: 3, py: 2.5, borderBottom: `1px solid ${C.fog}`, background: C.ghost, display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 1.5 }}>
        <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
          <TimelineRounded sx={{ fontSize: 17, color: C.smoke }} />
          <Box>
            <Typography sx={{ ...os({ fontSize: 14, color: C.ink, letterSpacing: "0.02em" }) }}>Longitudinal Patient Timeline</Typography>
            <Typography sx={{ ...os({ fontSize: 11, color: C.ash, mt: 0.4 }) }}>
              {patientName ? `Chronological disease course — ${patientName}` : "Chronological disease course"}
            </Typography>
          </Box>
        </Box>
        <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
          <Chip label="Module 15 · Patient Timeline" size="small" sx={{ background: C.black, color: C.white, fontWeight: 300, fontSize: 10, letterSpacing: "0.04em", borderRadius: "2px", height: 22 }} />
          <Box component="button" type="button" onClick={fetchTimeline} disabled={loading}
            sx={{ width: 28, height: 28, border: `1px solid ${C.fog}`, borderRadius: "2px", background: C.white, color: C.ash, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", "&:hover": { background: C.fog, color: C.ink } }}>
            <RefreshRounded sx={{ fontSize: 15, animation: loading ? "spin 1s linear infinite" : "none" }} />
          </Box>
        </Box>
      </Box>

      {/* Track filter chips */}
      <Box sx={{ px: 3, pt: 2, display: "flex", flexWrap: "wrap", gap: 0.75 }}>
        {tracksAll.map((t) => {
          const active = activeTracks.has(t);
          return (
            <Chip
              key={t}
              label={t}
              size="small"
              onClick={() => toggleTrack(t)}
              sx={{
                fontSize: 10.5, height: 24, cursor: "pointer",
                background: active ? (TRACK_COLORS[t] || C.charcoal) : C.ghost,
                color: active ? "#fff" : C.ash,
                border: `1px solid ${active ? "transparent" : C.mist}`,
                fontFamily: FONT, fontWeight: 300,
              }}
            />
          );
        })}
      </Box>

      {error && !loading && (
        <Box sx={{ p: 3, textAlign: "center" }}><Typography sx={{ ...os({ fontSize: 13, color: C.ash }) }}>{error}</Typography></Box>
      )}

      {!loading && !error && filteredEvents.length === 0 && (
        <Box sx={{ p: 4, textAlign: "center" }}>
          <Typography sx={{ ...os({ fontSize: 13, color: C.ash }) }}>
            {events.length === 0 ? "No timeline data yet for this patient" : "No events match the selected tracks"}
          </Typography>
        </Box>
      )}

      {/* Vertical scrollable timeline */}
      {filteredEvents.length > 0 && (
        <Box sx={{ p: { xs: 2, sm: 3 }, maxHeight: 560, overflowY: "auto" }}>
          <Box sx={{ position: "relative", pl: 2.5, borderLeft: `2px solid ${C.mist}` }}>
            {filteredEvents.map((e, idx) => {
              const id = `${e.track}-${e.date}-${idx}`;
              const isExpanded = expandedId === id;
              const color = TRACK_COLORS[e.track] || C.charcoal;
              return (
                <Box key={id} sx={{ position: "relative", mb: 2.5 }}>
                  <Box sx={{ position: "absolute", left: -30, top: 3, width: 10, height: 10, borderRadius: "50%", background: color, border: `2px solid ${C.white}` }} />
                  <Box
                    onClick={() => setExpandedId(isExpanded ? null : id)}
                    sx={{ cursor: "pointer", border: `1px solid ${C.fog}`, borderRadius: "4px", overflow: "hidden", "&:hover": { borderColor: C.mist } }}
                  >
                    <Box sx={{ px: 1.75, py: 1, display: "flex", alignItems: "center", justifyContent: "space-between", gap: 1, background: C.ghost }}>
                      <Box sx={{ display: "flex", alignItems: "center", gap: 1, minWidth: 0 }}>
                        <Chip label={e.track} size="small" sx={{ fontSize: 9.5, height: 18, background: color, color: "#fff", flexShrink: 0 }} />
                        <Typography sx={{ ...os({ fontSize: 12, color: C.ink }), overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{e.label}</Typography>
                      </Box>
                      <Box sx={{ display: "flex", alignItems: "center", gap: 0.75, flexShrink: 0 }}>
                        <Typography sx={{ ...os({ fontSize: 10.5, color: C.silver }) }}>{formatDate(e.date)}</Typography>
                        {isExpanded ? <ExpandLessRounded sx={{ fontSize: 15, color: C.ash }} /> : <ExpandMoreRounded sx={{ fontSize: 15, color: C.ash }} />}
                      </Box>
                    </Box>
                    {isExpanded && (
                      <Box sx={{ px: 1.75, py: 1.25 }}>
                        <Typography sx={{ ...os({ fontSize: 11.5, color: C.charcoal, lineHeight: 1.5 }) }}>{e.summary || "No further detail recorded."}</Typography>
                        <Typography sx={{ ...os({ fontSize: 9.5, color: C.silver, mt: 0.75 }) }}>Source: {e.source_module}</Typography>
                      </Box>
                    )}
                  </Box>
                </Box>
              );
            })}
          </Box>
        </Box>
      )}

      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </Box>
  );
}