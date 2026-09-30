import React, { useState, useEffect, useCallback } from "react";
import { Box, Typography, Chip } from "@mui/material";
import {
  RefreshRounded,
  AddRounded,
  CloseRounded,
  DeleteOutlineRounded,
  TimelineRounded,
  EditRounded,
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

const RESPONSE_OPTIONS = ["Not yet assessed", "Good response", "Partial response", "No response"];
const REASON_STOPPED_OPTIONS = [
  "Inadequate response", "Adverse effect / toxicity", "Remission achieved — de-escalation",
  "Patient preference", "Cost / access issue", "Pregnancy / conception planning",
  "Intercurrent infection", "Surgery — perioperative hold", "Other",
];

const RESPONSE_COLOR = {
  "Good response": "#2e7d32", "Partial response": "#8a6d00",
  "No response": "#b3261e", "Not yet assessed": C.silver,
};

const EMPTY_FORM = {
  drug_name: "", dose: "", start_date: "", stop_date: "",
  response: "Not yet assessed", reason_stopped: "", reason_stopped_detail: "", notes: "",
};

const formatDate = (d) => {
  if (!d) return "—";
  try { return new Date(d + "T00:00:00").toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" }); }
  catch { return d; }
};

const Field = ({ label, children, span }) => (
  <Box sx={{ gridColumn: span ? "1 / -1" : "auto" }}>
    <Typography sx={{ ...os({ fontSize: 9.5, color: C.ash, textTransform: "uppercase", letterSpacing: "0.06em", mb: 0.5 }) }}>{label}</Typography>
    {children}
  </Box>
);

export default function RheumatologyTreatmentLedger({ doctorId, patientId, patientName }) {
  const [entries, setEntries] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const [suggestions, setSuggestions] = useState([]);
  const [formOpen, setFormOpen] = useState(false);
  const [editingId, setEditingId] = useState(null); // ledger entry _id being edited, or null for "add new"
  const [form, setForm] = useState(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState("");

  const loadLedger = useCallback(async () => {
    if (!patientId || !doctorId) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`${API_BASE_URL}hms/users/data/context/rheumatology-treatment-ledger/${patientId}/${doctorId}`);
      const json = await res.json();
      if (json?.status === "success") setEntries(json.data || []);
      else setError(json?.detail || "Failed to load treatment ledger");
    } catch (err) {
      console.error("Failed to fetch treatment ledger:", err);
      setError("Network error while fetching ledger");
    } finally {
      setLoading(false);
    }
  }, [patientId, doctorId]);

  const loadSuggestions = useCallback(async () => {
    if (!patientId) return;
    try {
      const res = await fetch(`${API_BASE_URL}hms/users/data/context/rheumatology-treatment-ledger/suggest-from-medications/${patientId}`);
      const json = await res.json();
      if (json?.status === "success") setSuggestions(json.suggestions || []);
    } catch (err) {
      console.error("Failed to load medication suggestions:", err);
    }
  }, [patientId]);

useEffect(() => {
    loadLedger();
    loadSuggestions();
    return subscribeRheumContextUpdate(() => { loadLedger(); loadSuggestions(); });
  }, [loadLedger, loadSuggestions]);

  const openAddForm = (prefill = null) => {
    setEditingId(null);
    setFormError("");
    setForm(prefill ? { ...EMPTY_FORM, drug_name: prefill.drug_name, dose: prefill.dose } : EMPTY_FORM);
    setFormOpen(true);
  };

  const openEditForm = (entry) => {
    setEditingId(entry._id);
    setFormError("");
    setForm({
      drug_name: entry.drug_name || "", dose: entry.dose || "",
      start_date: entry.start_date || "", stop_date: entry.stop_date || "",
      response: entry.response || "Not yet assessed",
      reason_stopped: entry.reason_stopped || "", reason_stopped_detail: entry.reason_stopped_detail || "",
      notes: entry.notes || "",
    });
    setFormOpen(true);
  };

  const closeForm = () => { setFormOpen(false); setEditingId(null); setForm(EMPTY_FORM); setFormError(""); };

  const handleSubmit = async () => {
    setFormError("");
    if (!form.drug_name.trim()) { setFormError("Drug name is required."); return; }
    if (!form.start_date) { setFormError("Start date is required."); return; }
    if (form.stop_date && !form.reason_stopped) { setFormError("Reason stopped is required once a stop date is set."); return; }

    setSaving(true);
    try {
      const body = {
        drug_name: form.drug_name, dose: form.dose,
        start_date: form.start_date, stop_date: form.stop_date || null,
        response: form.response,
        reason_stopped: form.stop_date ? form.reason_stopped : null,
        reason_stopped_detail: form.reason_stopped_detail,
        notes: form.notes,
      };

      let res, json;
      if (editingId) {
        res = await fetch(`${API_BASE_URL}hms/users/data/context/rheumatology-treatment-ledger/entry/${editingId}`, {
          method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
        });
      } else {
        res = await fetch(`${API_BASE_URL}hms/users/data/context/rheumatology-treatment-ledger/add-entry`, {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ...body, doctor_id: doctorId, patient_id: patientId }),
        });
      }
      json = await res.json();
      if (!res.ok || json?.status !== "success") throw new Error(json?.detail || json?.message || "Save failed");

      closeForm();
      loadLedger();
      announceRheumContextUpdate("treatment-ledger");
    } catch (err) {
      console.error("Treatment ledger save failed:", err);
      setFormError(err.message || "Save failed");
    } finally {
      setSaving(false);
    }
  };

  const handleDiscontinue = (entry) => {
    openEditForm({ ...entry, stop_date: new Date().toISOString().slice(0, 10) });
  };

  const handleDelete = async (entryId) => {
    if (!window.confirm("Delete this ledger entry? This cannot be undone.")) return;
    try {
      const res = await fetch(`${API_BASE_URL}hms/users/data/context/rheumatology-treatment-ledger/entry/${entryId}`, { method: "DELETE" });
      const json = await res.json();
      if (!res.ok || json?.status !== "success") throw new Error(json?.detail || "Delete failed");
      loadLedger();
      announceRheumContextUpdate("treatment-ledger");
    } catch (err) {
      console.error("Treatment ledger delete failed:", err);
      alert(err.message || "Delete failed");
    }
  };

  const active = entries.filter((e) => e.status === "Active");
  const stopped = entries.filter((e) => e.status === "Stopped");

  const Row = ({ e }) => (
    <Box sx={{ border: `1px solid ${C.fog}`, borderRadius: "4px", p: 1.75, display: "flex", flexDirection: "column", gap: 0.75 }}>
      <Box sx={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 1, flexWrap: "wrap" }}>
        <Box>
          <Typography sx={{ ...os({ fontSize: 13, color: C.ink }) }}>{e.drug_name}</Typography>
          {e.dose && <Typography sx={{ ...os({ fontSize: 11, color: C.ash }) }}>{e.dose}</Typography>}
        </Box>
        <Box sx={{ display: "flex", alignItems: "center", gap: 0.75 }}>
          <Chip
            label={e.status}
            size="small"
            sx={{ fontSize: 9.5, height: 18, background: e.status === "Active" ? "#eef7ee" : C.ghost, color: e.status === "Active" ? "#2e7d32" : C.ash, border: `1px solid ${e.status === "Active" ? "#2e7d3244" : C.mist}` }}
          />
          <Box component="button" type="button" onClick={() => openEditForm(e)} sx={{ border: "none", background: "transparent", cursor: "pointer", p: 0.25, color: C.silver, display: "flex" }}>
            <EditRounded sx={{ fontSize: 15 }} />
          </Box>
          <Box component="button" type="button" onClick={() => handleDelete(e._id)} sx={{ border: "none", background: "transparent", cursor: "pointer", p: 0.25, color: C.silver, display: "flex" }}>
            <DeleteOutlineRounded sx={{ fontSize: 15 }} />
          </Box>
        </Box>
      </Box>

      <Box sx={{ display: "flex", gap: 2, flexWrap: "wrap" }}>
        <Typography sx={{ ...os({ fontSize: 11, color: C.charcoal }) }}>
          {formatDate(e.start_date)} → {e.stop_date ? formatDate(e.stop_date) : "ongoing"}
        </Typography>
        <Chip label={e.response} size="small" sx={{ fontSize: 9.5, height: 18, background: `${RESPONSE_COLOR[e.response] || C.charcoal}18`, color: RESPONSE_COLOR[e.response] || C.charcoal, border: `1px solid ${RESPONSE_COLOR[e.response] || C.mist}44` }} />
      </Box>

      {e.reason_stopped && (
        <Typography sx={{ ...os({ fontSize: 11, color: C.ash }) }}>
          Stopped — {e.reason_stopped}{e.reason_stopped_detail ? `: ${e.reason_stopped_detail}` : ""}
        </Typography>
      )}
      {e.notes && <Typography sx={{ ...os({ fontSize: 11, color: C.charcoal, fontStyle: "italic" }) }}>{e.notes}</Typography>}

      {e.status === "Active" && (
        <Box sx={{ display: "flex", justifyContent: "flex-end" }}>
          <Box component="button" type="button" onClick={() => handleDiscontinue(e)} sx={{ ...ghostButton, fontSize: 10.5, px: 1.25, py: 0.4 }}>
            Discontinue
          </Box>
        </Box>
      )}
    </Box>
  );

  return (
    <Box sx={{ ...card, overflow: "hidden" }}>
      <Box sx={{ px: 3, py: 2.5, borderBottom: `1px solid ${C.fog}`, background: C.ghost, display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 1.5 }}>
        <Box>
          <Typography sx={{ ...os({ fontSize: 14, color: C.ink, letterSpacing: "0.02em" }) }}>Treatment Ledger</Typography>
          <Typography sx={{ ...os({ fontSize: 11, color: C.ash, mt: 0.4 }) }}>
            {patientName ? `Complete drug timeline — ${patientName}` : "Complete drug timeline"}
          </Typography>
        </Box>
        <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
          <Chip label="Module 9 · Treatment Ledger" size="small" sx={{ background: C.black, color: C.white, fontWeight: 300, fontSize: 10, letterSpacing: "0.04em", borderRadius: "2px", height: 22 }} />
          {loading && <RefreshRounded sx={{ fontSize: 16, color: C.ash, animation: "spin 1s linear infinite" }} />}
        </Box>
      </Box>

      {/* Prefill suggestions from current medications */}
      {suggestions.length > 0 && !formOpen && (
        <Box sx={{ mx: 3, mt: 2, p: 1.5, borderRadius: "2px", background: C.ghost, border: `1px solid ${C.fog}` }}>
          <Typography sx={{ ...os({ fontSize: 10, color: C.silver, textTransform: "uppercase", letterSpacing: "0.07em", mb: 0.75 }) }}>
            Quick-add from current medications
          </Typography>
          <Box sx={{ display: "flex", flexWrap: "wrap", gap: 0.75 }}>
            {suggestions.map((s, i) => (
              <Box key={i} component="button" type="button" onClick={() => openAddForm(s)}
                sx={{ ...ghostButton, fontSize: 11, px: 1.25, py: 0.5 }}>
                <AddRounded sx={{ fontSize: 13 }} /> {s.drug_name}{s.dose ? ` — ${s.dose}` : ""}
              </Box>
            ))}
          </Box>
        </Box>
      )}

      {!formOpen && (
        <Box sx={{ px: 3, pt: 2, display: "flex", justifyContent: "flex-end" }}>
          <Box component="button" type="button" onClick={() => openAddForm()} sx={{ ...actionButton, minWidth: 160 }}>
            <AddRounded sx={{ fontSize: 15 }} /> Add Entry
          </Box>
        </Box>
      )}

      {/* Add / Edit form */}
      {formOpen && (
        <Box sx={{ mx: 3, mt: 2, p: 2, borderRadius: "2px", background: C.white, border: `1px solid ${C.fog}` }}>
          <Box sx={{ display: "flex", alignItems: "center", justifyContent: "space-between", mb: 1.5 }}>
            <Typography sx={{ ...os({ fontSize: 12.5, color: C.ink }) }}>{editingId ? "Edit Entry" : "New Entry"}</Typography>
            <Box component="button" type="button" onClick={closeForm} sx={{ border: "none", background: "transparent", cursor: "pointer", color: C.silver, display: "flex" }}>
              <CloseRounded sx={{ fontSize: 17 }} />
            </Box>
          </Box>

          <Box sx={{ display: "grid", gridTemplateColumns: { xs: "1fr", sm: "1fr 1fr" }, gap: 1.5 }}>
            <Field label="Drug Name">
              <input style={inputSx} value={form.drug_name} onChange={(e) => setForm((f) => ({ ...f, drug_name: e.target.value }))} placeholder="e.g. Methotrexate" />
            </Field>
            <Field label="Dose">
              <input style={inputSx} value={form.dose} onChange={(e) => setForm((f) => ({ ...f, dose: e.target.value }))} placeholder="e.g. 15mg weekly" />
            </Field>
            <Field label="Start Date">
              <input type="date" style={inputSx} value={form.start_date} onChange={(e) => setForm((f) => ({ ...f, start_date: e.target.value }))} />
            </Field>
            <Field label="Stop Date (leave blank if ongoing)">
              <input type="date" style={inputSx} value={form.stop_date} onChange={(e) => setForm((f) => ({ ...f, stop_date: e.target.value }))} />
            </Field>
            <Field label="Response">
              <select style={inputSx} value={form.response} onChange={(e) => setForm((f) => ({ ...f, response: e.target.value }))}>
                {RESPONSE_OPTIONS.map((r) => <option key={r} value={r}>{r}</option>)}
              </select>
            </Field>
            {form.stop_date && (
              <Field label="Reason Stopped">
                <select style={inputSx} value={form.reason_stopped} onChange={(e) => setForm((f) => ({ ...f, reason_stopped: e.target.value }))}>
                  <option value="">Select a reason…</option>
                  {REASON_STOPPED_OPTIONS.map((r) => <option key={r} value={r}>{r}</option>)}
                </select>
              </Field>
            )}
            {form.stop_date && (
              <Field label="Reason Detail (optional)" span>
                <input style={inputSx} value={form.reason_stopped_detail} onChange={(e) => setForm((f) => ({ ...f, reason_stopped_detail: e.target.value }))} placeholder="Any additional detail" />
              </Field>
            )}
            <Field label="Notes (optional)" span>
              <textarea style={{ ...inputSx, minHeight: 50, resize: "vertical" }} value={form.notes} onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))} />
            </Field>
          </Box>

          {formError && <Typography sx={{ ...os({ fontSize: 11.5, color: "#b3261e", mt: 1.25 }) }}>{formError}</Typography>}

          <Box sx={{ display: "flex", justifyContent: "flex-end", gap: 1, mt: 2 }}>
            <Box component="button" type="button" onClick={closeForm} sx={{ ...ghostButton, fontSize: 12 }}>Cancel</Box>
            <Box component="button" type="button" onClick={handleSubmit} disabled={saving} sx={{ ...actionButton, minWidth: 120 }}>
              {saving ? "Saving..." : editingId ? "Update" : "Add"}
            </Box>
          </Box>
        </Box>
      )}

      {error && !loading && (
        <Box sx={{ p: 3, textAlign: "center" }}><Typography sx={{ ...os({ fontSize: 13, color: C.ash }) }}>{error}</Typography></Box>
      )}

      {!loading && !error && entries.length === 0 && !formOpen && (
        <Box sx={{ p: 4, textAlign: "center" }}>
          <TimelineRounded sx={{ fontSize: 28, color: C.silver, mb: 1 }} />
          <Typography sx={{ ...os({ fontSize: 13, color: C.ash }) }}>No treatment ledger entries yet</Typography>
        </Box>
      )}

      {!error && entries.length > 0 && (
        <Box sx={{ p: { xs: 2, sm: 3 } }}>
          {active.length > 0 && (
            <Box sx={{ mb: stopped.length > 0 ? 2.5 : 0 }}>
              <Typography sx={{ ...os({ fontSize: 10, color: "#2e7d32", textTransform: "uppercase", letterSpacing: "0.07em", mb: 1 }) }}>
                Active ({active.length})
              </Typography>
              <Box sx={{ display: "flex", flexDirection: "column", gap: 1.25 }}>
                {active.map((e) => <Row key={e._id} e={e} />)}
              </Box>
            </Box>
          )}
          {stopped.length > 0 && (
            <Box>
              <Typography sx={{ ...os({ fontSize: 10, color: C.silver, textTransform: "uppercase", letterSpacing: "0.07em", mb: 1 }) }}>
                Past ({stopped.length})
              </Typography>
              <Box sx={{ display: "flex", flexDirection: "column", gap: 1.25 }}>
                {stopped.map((e) => <Row key={e._id} e={e} />)}
              </Box>
            </Box>
          )}
        </Box>
      )}

      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </Box>
  );
}