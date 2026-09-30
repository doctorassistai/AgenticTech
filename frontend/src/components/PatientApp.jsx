import React, { useState, useEffect, useCallback } from "react";
import { Box, Typography } from "@mui/material";
import { motion } from "framer-motion";

const API_BASE_URL = import.meta.env.VITE_BACKEND_URL || "https://doctorassist.ai/api/";

const FONT = '"Open Sans", sans-serif';
const FW_LIGHT = 300;
const FW_REGULAR = 400;
const C = { black: "#000000", charcoal: "#444444", ash: "#888888", mist: "#e0e0e0", ghost: "#fafafa", white: "#ffffff" };
const os = (x = {}) => ({ fontFamily: FONT, fontWeight: FW_LIGHT, WebkitFontSmoothing: "antialiased", ...x });

const Strip = ({ text }) => (
  <Box sx={{ px: 1.5, py: 1, mt: 1, background: C.ghost, border: `1px solid ${C.mist}`, borderLeft: `2px solid ${C.charcoal}` }}>
    <Typography sx={{ ...os({ fontSize: 11, color: C.charcoal, lineHeight: 1.6 }) }}>{text}</Typography>
  </Box>
);

const Marker = ({ s = "in" }) => {
  const M = {
    ok: { borderRadius: "50%", background: C.black },
    rv: { borderRadius: "50%", border: `1.5px solid ${C.black}`, background: `linear-gradient(90deg, ${C.black} 50%, transparent 50%)` },
    cr: { transform: "rotate(45deg)", background: C.black },
    in: { borderRadius: "50%", border: `1.5px solid ${C.mist}` },
  };
  return <Box sx={{ width: 11, height: 11, mt: 0.6, flexShrink: 0, ...M[s] }} />;
};

function levelToMarker(level) {
  return level === "urgent" ? "cr" : level === "routine" ? "rv" : "in";
}

function formatWhen(iso) {
  if (!iso) return "—";
  try {
    const d = new Date(iso);
    return d.toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
  } catch {
    return iso;
  }
}

const BASE = `${API_BASE_URL}hms/users/doctors/me/patients/patients/`;

// Patient-CONFIRMED photo only (routes_doctor.py never returns an
// unconfirmed one). Streamed through the gateway proxy with the doctor's
// session cookie, same-origin, so a plain <img src> works without any
// extra auth header.
function PhotoThumb({ patientId, photo }) {
  const [broken, setBroken] = useState(false);
  if (!photo?.photo_id) return null;
  const src = `${BASE}${patientId}/photos/${photo.photo_id}/image`;
  return (
    <Box sx={{ display: "inline-block", mr: 1.5, mb: 1, verticalAlign: "top", width: 120 }}>
      {!broken ? (
        <Box
          component="img"
          src={src}
          onError={() => setBroken(true)}
          sx={{ width: 120, height: 90, objectFit: "cover", border: `1px solid ${C.mist}`, display: "block", cursor: "pointer" }}
          onClick={() => window.open(src, "_blank")}
        />
      ) : (
        <Box sx={{ width: 120, height: 90, border: `1px solid ${C.mist}`, background: C.ghost, display: "flex", alignItems: "center", justifyContent: "center" }}>
          <Typography sx={{ ...os({ fontSize: 10, color: C.ash }) }}>No image</Typography>
        </Box>
      )}
      <Typography sx={{ ...os({ fontSize: 10, color: C.ash, textTransform: "uppercase", letterSpacing: "0.04em", mt: 0.4 }) }}>
        {photo.category || "photo"}
      </Typography>
      <Typography sx={{ ...os({ fontSize: 11, color: C.charcoal }) }}>{(photo.items || []).join(", ")}</Typography>
      {photo.note && <Typography sx={{ ...os({ fontSize: 11, color: C.charcoal, fontStyle: "italic" }) }}>{photo.note}</Typography>}
    </Box>
  );
}

function FollowupQA({ f }) {
  if (!f) return null;
  return (
    <Box sx={{ mt: 0.75, pl: 1, borderLeft: `2px solid ${C.mist}` }}>
      {f.text && <Typography sx={{ ...os({ fontSize: 11, color: C.charcoal, fontStyle: "italic", mb: 0.5 }) }}>"{f.text}"</Typography>}
      {(f.qa || []).map((x, i) => (
        <Typography key={i} sx={{ ...os({ fontSize: 11, color: C.charcoal }) }}>
          {x.q} — <span style={{ fontWeight: FW_REGULAR, color: C.black }}>{x.a}</span>
        </Typography>
      ))}
    </Box>
  );
}

function PatientTimeline({ patientId }) {
  const [data, setData] = useState(null);
  const [err, setErr] = useState(null);
  const [open, setOpen] = useState({});
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);

  const load = useCallback(async () => {
    try {
      const r = await fetch(`${BASE}${patientId}/timeline?days=14`, { credentials: "include" });
      if (!r.ok) throw new Error(`Request failed (${r.status})`);
      setData(await r.json());
      setErr(null);
    } catch (e) { setErr(e.message); }
  }, [patientId]);
  useEffect(() => { load(); }, [load]);

  const send = async () => {
    if (!draft.trim()) return;
    setSending(true);
    try {
      const r = await fetch(`${BASE}${patientId}/messages`, {
        method: "POST", credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: draft.trim() }),
      });
      if (!r.ok) throw new Error("Send failed");
      setDraft("");
      await load();
    } catch (e) { setErr(e.message); } finally { setSending(false); }
  };

  const H = ({ children }) => (
    <Typography sx={{ ...os({ fontSize: 11, color: C.black, fontWeight: FW_REGULAR, textTransform: "uppercase", letterSpacing: "0.08em", mb: 1.5 }) }}>{children}</Typography>
  );

  return (
    <>
      <Box sx={{ mb: 4 }}>
        <H>Message to patient (shown in the patient's chat)</H>
        <Box component="textarea" value={draft} onChange={(e) => setDraft(e.target.value)} rows={3} maxLength={1000}
          placeholder="Write a message for the patient…"
          sx={{ width: "100%", boxSizing: "border-box", fontFamily: FONT, fontSize: 12, p: 1, border: `1px solid ${C.mist}`, resize: "vertical" }} />
        <Box component="button" disabled={sending || !draft.trim()} onClick={send}
          sx={{ mt: 1, fontFamily: FONT, fontSize: 10, textTransform: "uppercase", letterSpacing: "0.08em", background: C.black, color: C.white, border: "none", px: 2, py: 0.8, cursor: "pointer", opacity: sending || !draft.trim() ? 0.5 : 1 }}>
          {sending ? "Sending…" : "Send to patient"}
        </Box>
        {(data?.messages || []).slice(0, 12).map((m) => (
          <Box key={m.id} sx={{ py: 0.75, borderBottom: `1px solid ${C.mist}` }}>
            <Typography sx={{ ...os({ fontSize: 10, color: C.ash, textTransform: "uppercase", letterSpacing: "0.06em" }) }}>
              {m.from === "doctor" ? `You${m.doctor_name ? ` (${m.doctor_name})` : ""}` : "Patient"} · {formatWhen(m.at)}{m.urgent ? " · URGENT WORDS" : ""}
            </Typography>
            {m.kind === "photo" ? (
              <PhotoThumb patientId={patientId} photo={m.photo} />
            ) : m.kind === "followup" ? (
              <FollowupQA f={{ text: m.text, qa: m.qa }} />
            ) : (
              <Typography sx={{ ...os({ fontSize: 12, color: C.black }) }}>{m.text}</Typography>
            )}
          </Box>
        ))}
      </Box>

      <Box sx={{ mb: 4 }}>
        <H>Day by day ({data?.days?.length ?? 0})</H>
        {err && <Typography sx={{ ...os({ fontSize: 12, color: C.ash }) }}>{err}</Typography>}
        {(data?.days || []).map((d, i) => (
          <Box key={i} sx={{ py: 1.25, borderBottom: `1px solid ${C.mist}` }}>
            <Box onClick={() => setOpen((o) => ({ ...o, [i]: !o[i] }))} sx={{ cursor: "pointer" }}>
              <Typography sx={{ ...os({ fontSize: 12, color: C.black, fontWeight: FW_REGULAR }) }}>
                {d.date} {open[i] ? "▾" : "▸"}
              </Typography>
              <Typography sx={{ ...os({ fontSize: 11, color: C.charcoal, mt: 0.5 }) }}>{d.summary}</Typography>
            </Box>
            {open[i] && (
              <Box sx={{ mt: 1 }}>
                {!d.questions_saved && <Strip text="Question text was not saved for this day, so ids are shown." />}
                {d.items.map((it) => (
                  <Box key={it.id} sx={{ py: 0.4, borderBottom: `1px solid ${C.ghost}` }}>
                    <Box sx={{ display: "flex", gap: 1 }}>
                      <Typography sx={{ ...os({ fontSize: 11, color: it.problem ? C.black : C.ash, fontWeight: it.problem ? FW_REGULAR : FW_LIGHT, flex: 1 }) }}>
                        {it.urgent ? "! " : it.problem ? "● " : ""}{it.label}{it.typed ? ` (typed: "${it.typed}")` : ""}
                      </Typography>
                      <Typography sx={{ ...os({ fontSize: 11, color: it.problem ? C.black : C.ash, minWidth: 100, textAlign: "right" }) }}>{it.answer}</Typography>
                    </Box>
                  </Box>
                ))}
                {d.note && <Typography sx={{ ...os({ fontSize: 11, color: C.charcoal, mt: 0.75, fontStyle: "italic" }) }}>Patient note: "{d.note}"</Typography>}
                {(d.followups || []).length > 0 && (
                  <Box sx={{ mt: 0.75 }}>
                    <Typography sx={{ ...os({ fontSize: 10, color: C.ash, textTransform: "uppercase", letterSpacing: "0.06em" }) }}>Follow-up questions</Typography>
                    {d.followups.map((f, fi) => <FollowupQA key={fi} f={f} />)}
                  </Box>
                )}
                {(d.photos || []).length > 0 && (
                  <Box sx={{ mt: 0.75 }}>
                    <Typography sx={{ ...os({ fontSize: 10, color: C.ash, textTransform: "uppercase", letterSpacing: "0.06em", mb: 0.5 }) }}>Photos</Typography>
                    {d.photos.map((p, pi) => <PhotoThumb key={pi} patientId={patientId} photo={p} />)}
                  </Box>
                )}
                {d.food_items?.length > 0 && <Typography sx={{ ...os({ fontSize: 11, color: C.charcoal, mt: 0.5 }) }}>Food: {d.food_items.join(", ")}</Typography>}
              </Box>
            )}
          </Box>
        ))}
      </Box>
    </>
  );
}

export default function PatientApp({ patientId, doctorId, patientName }) {
  const [overview, setOverview] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [acking, setAcking] = useState(null);

  const load = useCallback(async () => {
    if (!patientId) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(
        `${API_BASE_URL}hms/users/doctors/me/patients/patients/${patientId}/overview?days=14`,
        { credentials: "include" }
      );
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.detail || `Request failed (${res.status})`);
      }
      const json = await res.json();
      setOverview(json);
    } catch (err) {
      console.error("Failed to load patient overview:", err);
      setError(err.message || "Could not load patient data");
    } finally {
      setLoading(false);
    }
  }, [patientId]);

  useEffect(() => { load(); }, [load]);

  const acknowledge = useCallback(async (alertId) => {
    setAcking(alertId);
    try {
      const res = await fetch(
        `${API_BASE_URL}hms/users/doctors/me/patients/alerts/${alertId}/acknowledge`,
        { method: "POST", credentials: "include" }
      );
      if (!res.ok) throw new Error("Failed to acknowledge");
      setOverview((prev) => prev ? {
        ...prev,
        alerts: prev.alerts.map((a) => a.id === alertId ? { ...a, acknowledged: true } : a),
      } : prev);
    } catch (err) {
      console.error("Acknowledge failed:", err);
    } finally {
      setAcking(null);
    }
  }, []);

  if (!patientId) {
    return (
      <Box sx={{ py: 6, textAlign: "center" }}>
        <Typography sx={{ ...os({ fontSize: 13, color: C.ash }) }}>Select a patient to view their app data.</Typography>
      </Box>
    );
  }

  if (loading) {
    return (
      <Box sx={{ py: 6, textAlign: "center" }}>
        <Typography sx={{ ...os({ fontSize: 13, color: C.ash }) }}>Loading patient app data…</Typography>
      </Box>
    );
  }

  if (error) {
    return (
      <Box sx={{ py: 6, textAlign: "center" }}>
        <Typography sx={{ ...os({ fontSize: 13, color: C.black, mb: 1 }) }}>Could not load patient app data</Typography>
        <Typography sx={{ ...os({ fontSize: 12, color: C.ash, mb: 2 }) }}>{error}</Typography>
        <Box
          component="button"
          onClick={load}
          sx={{
            fontFamily: FONT, fontSize: 11, color: C.black, background: "transparent",
            border: `1px solid ${C.mist}`, px: 1.5, py: 0.6, cursor: "pointer",
            textTransform: "uppercase", letterSpacing: "0.08em",
          }}
        >
          Retry
        </Box>
      </Box>
    );
  }

  const alerts = overview?.alerts || [];
  const unacknowledged = alerts.filter((a) => !a.acknowledged);
  const medications = overview?.medications?.medications || [];
  const hospitalMeds = overview?.medications?.hospital_given || [];
  const adherence = overview?.adherence;
  const foodLog = overview?.food_log || [];

  const highestGrade = unacknowledged.some((a) => a.level === "urgent") ? "urgent"
    : unacknowledged.length ? "routine" : null;

  const adherenceRows = adherence ? [
    ["Check-ins", `${adherence.checkin_days} of ${adherence.checkin_days_possible} days`],
    ["Doses taken", String(adherence.medication_log.taken || 0)],
    ["Doses late", String(adherence.medication_log.late || 0)],
    ["Doses skipped", String(adherence.medication_log.skipped || 0)],
  ] : [];

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.2 }}>
      <link href="https://fonts.googleapis.com/css2?family=Open+Sans:wght@300;400;600&display=swap" rel="stylesheet" />

      <Box sx={{ pb: 3, mb: 3, borderBottom: `1px solid ${C.mist}` }}>
        <Typography sx={{ ...os({ fontSize: 11, color: C.ash, letterSpacing: "0.1em", textTransform: "uppercase", mb: 1 }) }}>
          {patientName || "Patient"} / Patient app and alerts
        </Typography>
        <Typography sx={{ ...os({ fontSize: 22, color: C.black, lineHeight: 1.3, mb: 1.5 }) }}>
          {unacknowledged.length > 0
            ? `${unacknowledged.length} patient report${unacknowledged.length === 1 ? "" : "s"} need${unacknowledged.length === 1 ? "s" : ""} review${highestGrade ? `; highest is ${highestGrade}` : ""}.`
            : "No reports currently need review."}
        </Typography>
        <Typography sx={{ ...os({ fontSize: 13, color: C.ash, maxWidth: "60ch" }) }}>
          Symptoms, photos and medicine logs reported through the patient app, from the last 14 days.
        </Typography>
      </Box>

      <Box sx={{ mb: 4 }}>
        <Typography sx={{ ...os({ fontSize: 11, color: C.black, fontWeight: FW_REGULAR, textTransform: "uppercase", letterSpacing: "0.08em", mb: 1.5 }) }}>
          Reports needing action
        </Typography>
        {alerts.length === 0 ? (
          <Typography sx={{ ...os({ fontSize: 12, color: C.ash }) }}>No alerts in this window.</Typography>
        ) : (
          alerts.map((a, i) => (
            <Box
              key={a.id}
              sx={{
                display: "grid", gridTemplateColumns: "22px 1fr auto", gap: 1.5, py: 1.5,
                borderTop: i === 0 ? `1px solid ${C.mist}` : "none", borderBottom: `1px solid ${C.mist}`,
                alignItems: "flex-start", opacity: a.acknowledged ? 0.5 : 1,
              }}
            >
              <Marker s={levelToMarker(a.level)} />
              <Box>
                <Typography sx={{ ...os({ fontSize: 10, color: C.ash, letterSpacing: "0.06em", textTransform: "uppercase" }) }}>
                  {formatWhen(a.created_at)}
                </Typography>
                <Typography sx={{ ...os({ fontSize: 12, color: C.black, mt: 0.5 }) }}>{a.title}</Typography>
                <Typography sx={{ ...os({ fontSize: 11, color: C.charcoal, mt: 0.5 }) }}>
                  To: {a.to}{a.acknowledged ? " · Acknowledged" : ""}
                </Typography>
              </Box>
              {!a.acknowledged && (
                <Box
                  component="button"
                  disabled={acking === a.id}
                  onClick={() => acknowledge(a.id)}
                  sx={{
                    fontFamily: FONT, fontWeight: FW_REGULAR, fontSize: 10, color: C.black,
                    background: "transparent", border: `1px solid ${C.mist}`, px: 1.5, py: 0.6,
                    cursor: acking === a.id ? "default" : "pointer", textTransform: "uppercase",
                    letterSpacing: "0.08em", opacity: acking === a.id ? 0.5 : 1,
                    "&:hover": { borderColor: C.black, background: C.ghost },
                  }}
                >
                  {acking === a.id ? "…" : "Acknowledge"}
                </Box>
              )}
            </Box>
          ))
        )}
      </Box>

      <Box sx={{ display: "grid", gridTemplateColumns: { xs: "1fr", md: "1fr 1fr" }, gap: 4, mb: 4 }}>
        <Box>
          <Typography sx={{ ...os({ fontSize: 11, color: C.black, fontWeight: FW_REGULAR, textTransform: "uppercase", letterSpacing: "0.08em", mb: 1.5 }) }}>
            Adherence (last {adherence?.window_days ?? 14} days)
          </Typography>
          {adherenceRows.length === 0 ? (
            <Typography sx={{ ...os({ fontSize: 12, color: C.ash }) }}>No data yet.</Typography>
          ) : adherenceRows.map(([k, v], i) => (
            <Box key={i} sx={{ display: "flex", gap: 1, py: 0.5, borderBottom: `1px solid ${C.mist}` }}>
              <Typography sx={{ ...os({ fontSize: 11, color: C.ash, minWidth: 140 }) }}>{k}</Typography>
              <Typography sx={{ ...os({ fontSize: 11, color: C.charcoal }) }}>{v}</Typography>
            </Box>
          ))}
        </Box>

        <Box>
          <Typography sx={{ ...os({ fontSize: 11, color: C.black, fontWeight: FW_REGULAR, textTransform: "uppercase", letterSpacing: "0.08em", mb: 1.5 }) }}>
            Current medicines ({medications.length}{hospitalMeds.length ? ` + ${hospitalMeds.length} hospital-given` : ""})
          </Typography>
          {medications.length === 0 && hospitalMeds.length === 0 ? (
            <Typography sx={{ ...os({ fontSize: 12, color: C.ash }) }}>No active medicines on file.</Typography>
          ) : (
            <>
              {medications.map((m) => (
                <Box key={m.id} sx={{ display: "flex", gap: 1, py: 0.5, borderBottom: `1px solid ${C.mist}` }}>
                  <Typography sx={{ ...os({ fontSize: 11, color: C.charcoal, minWidth: 140 }) }}>
                    {m.name}{m.dose ? ` · ${m.dose}` : ""}
                  </Typography>
                  <Typography sx={{ ...os({ fontSize: 11, color: C.ash }) }}>{m.time || "PRN"} · {m.status}</Typography>
                </Box>
              ))}
              {hospitalMeds.map((m, i) => (
                <Box key={`h-${i}`} sx={{ display: "flex", gap: 1, py: 0.5, borderBottom: `1px solid ${C.mist}` }}>
                  <Typography sx={{ ...os({ fontSize: 11, color: C.ash, minWidth: 140 }) }}>{m.name}</Typography>
                  <Typography sx={{ ...os({ fontSize: 11, color: C.ash }) }}>Hospital-given</Typography>
                </Box>
              ))}
            </>
          )}
        </Box>
      </Box>

      <PatientTimeline patientId={patientId} />

      {foodLog.length > 0 && (
        <Box sx={{ mb: 2 }}>
          <Typography sx={{ ...os({ fontSize: 11, color: C.black, fontWeight: FW_REGULAR, textTransform: "uppercase", letterSpacing: "0.08em", mb: 1.5 }) }}>
            Food log
          </Typography>
          {foodLog.map((f, i) => (
            <Box key={i} sx={{ display: "flex", gap: 1.5, py: 0.5, borderBottom: `1px solid ${C.mist}` }}>
              <Typography sx={{ ...os({ fontSize: 11, color: C.ash, minWidth: 90 }) }}>{f.date}</Typography>
              <Typography sx={{ ...os({ fontSize: 11, color: C.charcoal }) }}>{(f.items || []).join(", ")}</Typography>
            </Box>
          ))}
        </Box>
      )}

      {adherence && (
        <Strip text={`${adherence.checkin_days} of ${adherence.checkin_days_possible} days checked in over the last ${adherence.window_days} days.`} />
      )}
    </motion.div>
  );
}