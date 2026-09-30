import React, { useState, useEffect, useCallback } from "react";
import { Box, Typography, Chip } from "@mui/material";
import {
  RefreshRounded,
  SaveRounded,
  AddRounded,
  DeleteOutlineRounded,
  MedicalServicesRounded,
  AutoAwesomeRounded,
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

const JOINT_REGION_LABELS = (region) => region.replace(/_/g, " ").replace(/^\w/, (c) => c.toUpperCase());

export default function RheumatologyProcedure({ doctorId, patientId, patientName }) {
  const [context, setContext] = useState(null);
  const [recentLog, setRecentLog] = useState([]);

  const [procedureType, setProcedureType] = useState("Steroid injection");
  const [jointRegion, setJointRegion] = useState("");

  const [guidance, setGuidance] = useState(null);
  const [guidanceLoading, setGuidanceLoading] = useState(false);

  const [briefing, setBriefing] = useState(null);
  const [briefingLoading, setBriefingLoading] = useState(false);
  const [briefingError, setBriefingError] = useState("");

  const [form, setForm] = useState({
    date: "", indication: "Synovitis", medication_name: "", volume_ml: "",
    complications: "None", complications_detail: "", outcome: "Not yet assessed", notes: "",
  });
  const [formOpen, setFormOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState("");

  const loadContext = useCallback(async () => {
    if (!patientId || !doctorId) return;
    try {
      const res = await fetch(`${API_BASE_URL}hms/users/data/context/rheumatology-procedure/context-preview/${patientId}/${doctorId}`);
      const json = await res.json();
      if (json?.status === "success") {
        setContext(json.data || null);
        if (!jointRegion && json.data?.joint_regions?.length) setJointRegion(json.data.joint_regions[0]);
      }
    } catch (err) {
      console.error("Failed to load procedure context:", err);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [patientId, doctorId]);

  const loadRecentLog = useCallback(async () => {
    if (!patientId || !doctorId) return;
    try {
      const res = await fetch(`${API_BASE_URL}hms/users/data/context/rheumatology-procedure/history/${patientId}/${doctorId}`);
      const json = await res.json();
      if (json?.status === "success") setRecentLog((json.data || []).slice(0, 6));
    } catch (err) {
      console.error("Failed to load procedure log:", err);
    }
  }, [patientId, doctorId]);

useEffect(() => {
    loadContext();
    loadRecentLog();
    return subscribeRheumContextUpdate(() => { loadContext(); loadRecentLog(); });
  }, [loadContext, loadRecentLog]);

  const handleLoadGuidance = async () => {
    if (!procedureType || !jointRegion) return;
    setGuidanceLoading(true);
    setGuidance(null);
    setBriefing(null);
    try {
      const res = await fetch(`${API_BASE_URL}hms/users/data/context/rheumatology-procedure/guidance-panel/${encodeURIComponent(procedureType)}/${encodeURIComponent(jointRegion)}`);
      const json = await res.json();
      if (json?.status === "success") setGuidance(json.data);
    } catch (err) {
      console.error("Failed to load guidance panel:", err);
    } finally {
      setGuidanceLoading(false);
    }
  };

  const handleGenerateBriefing = async () => {
    setBriefingError("");
    setBriefingLoading(true);
    try {
      const res = await fetch(`${API_BASE_URL}hms/users/data/context/rheumatology-procedure/generate-briefing`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ doctor_id: doctorId, patient_id: patientId, procedure_type: procedureType, joint_region: jointRegion }),
      });
      const json = await res.json();
      if (!res.ok || json?.status !== "success") throw new Error(json?.detail || "Failed to generate briefing");
      setBriefing(json.finaloutput);
    } catch (err) {
      console.error("Briefing generation failed:", err);
      setBriefingError(err.message || "Failed to generate briefing");
    } finally {
      setBriefingLoading(false);
    }
  };

  const handleSaveProcedure = async () => {
    setSaving(true);
    setSaveMsg("");
    try {
      if (!form.date) throw new Error("Date is required.");
      const res = await fetch(`${API_BASE_URL}hms/users/data/context/rheumatology-procedure/add-procedure`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          patient_id: patientId, doctor_id: doctorId,
          procedure_type: procedureType, joint_region: jointRegion,
          ...form,
          volume_ml: form.volume_ml === "" ? null : Number(form.volume_ml),
        }),
      });
      const json = await res.json();
      if (!res.ok || json?.status !== "success") throw new Error(json?.detail || "Failed to log procedure");
      setSaveMsg("✅ Procedure logged");
      setForm({ date: "", indication: "Synovitis", medication_name: "", volume_ml: "", complications: "None", complications_detail: "", outcome: "Not yet assessed", notes: "" });
      setFormOpen(false);
      loadRecentLog();
      loadContext();
      window.dispatchEvent(new Event("refreshRheumatologyProcedureHistory"));
      announceRheumContextUpdate("procedure");
    } catch (err) {
      console.error("Procedure save failed:", err);
      setSaveMsg(`❌ ${err.message || "Save failed"}`);
    } finally {
      setSaving(false);
      setTimeout(() => setSaveMsg(""), 3000);
    }
  };

  const handleDelete = async (id) => {
    try {
      const res = await fetch(`${API_BASE_URL}hms/users/data/context/rheumatology-procedure/procedure/${id}`, { method: "DELETE" });
      const json = await res.json();
      if (!res.ok || json?.status !== "success") throw new Error(json?.detail || "Delete failed");
      loadRecentLog();
      loadContext();
    } catch (err) {
      console.error("Delete procedure failed:", err);
    }
  };

  return (
    <Box sx={{ ...card, overflow: "hidden" }}>
      <Box sx={{ px: 3, py: 2.5, borderBottom: `1px solid ${C.fog}`, background: C.ghost, display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 1.5 }}>
        <Box>
          <Typography sx={{ ...os({ fontSize: 14, color: C.ink, letterSpacing: "0.02em" }) }}>Intra-Articular Procedure Intelligence</Typography>
          <Typography sx={{ ...os({ fontSize: 11, color: C.ash, mt: 0.4 }) }}>
            {patientName ? `Ultrasound-guided procedure reference — ${patientName}` : "Ultrasound-guided procedure reference"}
          </Typography>
        </Box>
        <Chip label="Module 12 · Procedure Intelligence" size="small" sx={{ background: C.black, color: C.white, fontWeight: 300, fontSize: 10, letterSpacing: "0.04em", borderRadius: "2px", height: 22 }} />
      </Box>

      {/* Assistive disclaimer banner */}
      <Box sx={{ mx: 3, mt: 2, p: 1.5, borderRadius: "2px", background: "#fbf6e3", border: "1px solid #e8d98a", display: "flex", gap: 1, alignItems: "flex-start" }}>
        <WarningAmberRounded sx={{ fontSize: 16, color: "#8a6d00", mt: 0.1, flexShrink: 0 }} />
        <Typography sx={{ ...os({ fontSize: 11, color: "#5f4d00", lineHeight: 1.5 }) }}>
          Assistive guidance only — not autonomous procedure control, and not real-time ultrasound image analysis. All joint identification, target confirmation, and needle placement decisions remain with the physician.
        </Typography>
      </Box>

      {/* Selectors */}
      <Box sx={{ px: 3, pt: 2.5, display: "grid", gridTemplateColumns: { xs: "1fr", sm: "1fr 1fr" }, gap: 1.25 }}>
        <Box>
          <Typography sx={{ ...os({ fontSize: 10, color: C.silver, textTransform: "uppercase", letterSpacing: "0.07em", mb: 0.5 }) }}>Procedure Type</Typography>
          <select style={inputSx} value={procedureType} onChange={(e) => { setProcedureType(e.target.value); setGuidance(null); setBriefing(null); }}>
            {(context?.procedure_types || ["Steroid injection", "Hyaluronic acid injection", "Arthrocentesis", "Other intra-articular procedure"]).map((p) => (
              <option key={p} value={p}>{p}</option>
            ))}
          </select>
        </Box>
        <Box>
          <Typography sx={{ ...os({ fontSize: 10, color: C.silver, textTransform: "uppercase", letterSpacing: "0.07em", mb: 0.5 }) }}>Joint / Region</Typography>
          <select style={inputSx} value={jointRegion} onChange={(e) => { setJointRegion(e.target.value); setGuidance(null); setBriefing(null); }}>
            {(context?.joint_regions || []).map((r) => (
              <option key={r} value={r}>{JOINT_REGION_LABELS(r)}</option>
            ))}
          </select>
        </Box>
      </Box>

      <Box sx={{ px: 3, pt: 1.5, display: "flex", gap: 1, flexWrap: "wrap" }}>
        <Box component="button" type="button" onClick={handleLoadGuidance} disabled={guidanceLoading || !jointRegion} sx={{ ...ghostButton, fontSize: 11.5 }}>
          <MedicalServicesRounded sx={{ fontSize: 14 }} /> {guidanceLoading ? "Loading..." : "Load Reference Guidance"}
        </Box>
        <Box component="button" type="button" onClick={handleGenerateBriefing} disabled={briefingLoading || !jointRegion} sx={{ ...ghostButton, fontSize: 11.5 }}>
          <AutoAwesomeRounded sx={{ fontSize: 14 }} /> {briefingLoading ? "Generating..." : "Generate Pre-Procedure Briefing"}
        </Box>
      </Box>

      {/* Guidance panel */}
      {guidance && (
        <Box sx={{ mx: 3, mt: 2, p: 2, border: `1px solid ${C.fog}`, borderRadius: "4px", background: C.ghost }}>
          <Typography sx={{ ...os({ fontSize: 10, color: C.silver, textTransform: "uppercase", letterSpacing: "0.07em", mb: 1 }) }}>Reference material — not real-time image analysis</Typography>
          {guidance.procedure_type_guidance && (
            <Box sx={{ mb: 1.25 }}>
              <Typography sx={{ ...os({ fontSize: 11.5, color: C.ink, mb: 0.25 }) }}>Overview</Typography>
              <Typography sx={{ ...os({ fontSize: 11.5, color: C.charcoal, lineHeight: 1.5 }) }}>{guidance.procedure_type_guidance.overview}</Typography>
              <Typography sx={{ ...os({ fontSize: 11.5, color: C.ink, mt: 1, mb: 0.25 }) }}>Contraindications</Typography>
              <Typography sx={{ ...os({ fontSize: 11.5, color: C.charcoal, lineHeight: 1.5 }) }}>{guidance.procedure_type_guidance.contraindications}</Typography>
              <Typography sx={{ ...os({ fontSize: 11.5, color: C.ink, mt: 1, mb: 0.25 }) }}>Aftercare</Typography>
              <Typography sx={{ ...os({ fontSize: 11.5, color: C.charcoal, lineHeight: 1.5 }) }}>{guidance.procedure_type_guidance.aftercare}</Typography>
            </Box>
          )}
          {guidance.joint_landmark_guidance && (
            <Box sx={{ pt: 1.25, borderTop: `1px solid ${C.mist}` }}>
              <Typography sx={{ ...os({ fontSize: 11.5, color: C.ink, mb: 0.25 }) }}>Landmarks</Typography>
              <Typography sx={{ ...os({ fontSize: 11.5, color: C.charcoal, lineHeight: 1.5 }) }}>{guidance.joint_landmark_guidance.landmarks}</Typography>
              <Typography sx={{ ...os({ fontSize: 11.5, color: C.ink, mt: 1, mb: 0.25 }) }}>Structures to Avoid</Typography>
              <Typography sx={{ ...os({ fontSize: 11.5, color: C.charcoal, lineHeight: 1.5 }) }}>{guidance.joint_landmark_guidance.avoid}</Typography>
            </Box>
          )}
        </Box>
      )}

      {/* Briefing */}
      {briefingError && <Typography sx={{ ...os({ fontSize: 12, color: "#b3261e", mx: 3, mt: 1.5 }) }}>{briefingError}</Typography>}
      {briefing && (
        <Box sx={{ mx: 3, mt: 2, p: 2, border: `1px solid ${C.fog}`, borderRadius: "4px" }}>
          <Typography sx={{ ...os({ fontSize: 10, color: C.silver, textTransform: "uppercase", letterSpacing: "0.07em", mb: 1 }) }}>Pre-Procedure Briefing</Typography>
          {briefing.recent_imaging ? (
            <Typography sx={{ ...os({ fontSize: 11.5, color: C.charcoal, mb: 1 }) }}>
              Most recent imaging on file for this region: {briefing.recent_imaging.modality} ({briefing.recent_imaging.date}).
            </Typography>
          ) : (
            <Typography sx={{ ...os({ fontSize: 11.5, color: C.ash, mb: 1 }) }}>No prior imaging on file for this region.</Typography>
          )}
          {briefing.narrative && (
            <Typography sx={{ ...os({ fontSize: 12, color: C.charcoal, lineHeight: 1.6, mb: 1 }) }}>{briefing.narrative}</Typography>
          )}
          <Typography sx={{ ...os({ fontSize: 10.5, color: "#8a6d00", fontStyle: "italic" }) }}>{briefing.disclaimer}</Typography>
        </Box>
      )}

      {/* Procedure log form */}
      <Box sx={{ px: 3, pt: 3 }}>
        <Box sx={{ display: "flex", alignItems: "center", justifyContent: "space-between", mb: 1 }}>
          <Typography sx={{ ...os({ fontSize: 11, color: C.ash, textTransform: "uppercase", letterSpacing: "0.07em" }) }}>Procedure Log</Typography>
          <Box component="button" type="button" onClick={() => setFormOpen((v) => !v)} sx={{ ...ghostButton, fontSize: 10.5, px: 1.25, py: 0.4 }}>
            <AddRounded sx={{ fontSize: 13 }} /> {formOpen ? "Cancel" : "Log Procedure"}
          </Box>
        </Box>

        {formOpen && (
          <Box sx={{ p: 1.5, mb: 1.5, border: `1px solid ${C.fog}`, borderRadius: "2px", display: "grid", gridTemplateColumns: { xs: "1fr", sm: "1fr 1fr" }, gap: 1 }}>
            <input type="date" style={inputSx} value={form.date} onChange={(e) => setForm((f) => ({ ...f, date: e.target.value }))} />
            <select style={inputSx} value={form.indication} onChange={(e) => setForm((f) => ({ ...f, indication: e.target.value }))}>
              {(context?.indications || []).map((i) => <option key={i} value={i}>{i}</option>)}
            </select>
            <input style={inputSx} placeholder="Medication (e.g. Triamcinolone 40mg)" value={form.medication_name} onChange={(e) => setForm((f) => ({ ...f, medication_name: e.target.value }))} />
            <input type="number" step="0.1" style={inputSx} placeholder="Volume (mL)" value={form.volume_ml} onChange={(e) => setForm((f) => ({ ...f, volume_ml: e.target.value }))} />
            <select style={inputSx} value={form.complications} onChange={(e) => setForm((f) => ({ ...f, complications: e.target.value }))}>
              {(context?.complications || []).map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
            <select style={inputSx} value={form.outcome} onChange={(e) => setForm((f) => ({ ...f, outcome: e.target.value }))}>
              {(context?.outcomes || []).map((o) => <option key={o} value={o}>{o}</option>)}
            </select>
            {(form.complications === "Other" || (form.complications !== "None" && form.complications !== "")) && (
              <input style={{ ...inputSx, gridColumn: "1 / -1" }} placeholder="Complication detail (optional)" value={form.complications_detail} onChange={(e) => setForm((f) => ({ ...f, complications_detail: e.target.value }))} />
            )}
            <textarea style={{ ...inputSx, gridColumn: "1 / -1", minHeight: 60, resize: "vertical" }} placeholder="Notes (optional)" value={form.notes} onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))} />
          </Box>
        )}
      </Box>

      {/* Recent log chips */}
      <Box sx={{ px: 3, pb: 2 }}>
        {recentLog.length > 0 ? (
          <Box sx={{ display: "flex", flexWrap: "wrap", gap: 0.75 }}>
            {recentLog.map((p) => (
              <Chip
                key={p._id}
                label={`${p.date} · ${p.procedure_type} · ${JOINT_REGION_LABELS(p.joint_region)}`}
                size="small"
                onDelete={() => handleDelete(p._id)}
                deleteIcon={<DeleteOutlineRounded sx={{ fontSize: 14 }} />}
                sx={{ fontSize: 10.5, height: 24, background: C.ghost, color: C.charcoal, border: `1px solid ${C.mist}` }}
              />
            ))}
          </Box>
        ) : (
          <Typography sx={{ ...os({ fontSize: 11.5, color: C.silver }) }}>No procedures logged yet.</Typography>
        )}
      </Box>

      {/* Footer */}
      <Box sx={{ px: 3, py: 2, borderTop: `1px solid ${C.fog}`, background: C.ghost, display: "flex", alignItems: "center", justifyContent: "flex-end", gap: 1.5 }}>
        {saveMsg && <Typography sx={{ ...os({ fontSize: 12, color: saveMsg.includes("✅") ? "#2e7d32" : "#d32f2f" }) }}>{saveMsg}</Typography>}
        <Box component="button" type="button" onClick={handleSaveProcedure} disabled={saving || !formOpen} sx={{ ...actionButton, minWidth: 180 }}>
          <SaveRounded sx={{ fontSize: 15 }} /> {saving ? "Saving..." : "Save Procedure Log"}
        </Box>
      </Box>

      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </Box>
  );
}