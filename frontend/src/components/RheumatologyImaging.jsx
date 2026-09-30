import React, { useState, useEffect, useCallback } from "react";
import { Box, Typography, Chip } from "@mui/material";
import {
  RefreshRounded,
  SaveRounded,
  AddRounded,
  DeleteOutlineRounded,
  ImageSearchRounded,
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

const MODALITY_OPTIONS = ["X-ray", "Ultrasound", "MRI", "CT"];
const REGION_OPTIONS = [
  "shoulder_L", "shoulder_R", "elbow_L", "elbow_R", "wrist_L", "wrist_R",
  "hand_L", "hand_R", "knee_L", "knee_R", "ankle_L", "ankle_R",
  "foot_L", "foot_R", "hip_L", "hip_R",
  "Sacroiliac joints", "Cervical spine", "Thoracic spine", "Lumbar spine",
  "Both hands (composite)", "Both feet (composite)",
];
const GRADE_OPTIONS = ["None", "Mild", "Moderate", "Severe"];
const PRESENT_ABSENT_OPTIONS = ["Absent", "Present"];

const FIELD_LABEL_OVERRIDES = {
  joint_space_narrowing: "Joint Space Narrowing",
  bone_marrow_edema: "Bone Marrow Edema",
  power_doppler_activity: "Power Doppler Activity",
  periarticular_osteopenia: "Periarticular Osteopenia",
  structural_lesion: "Structural Lesion",
};
const fieldLabel = (key) => FIELD_LABEL_OVERRIDES[key] || key.split("_").map((w) => w[0].toUpperCase() + w.slice(1)).join(" ");

const defaultFindingForSchema = (schema, modality) => {
  const fields = schema?.[modality] || {};
  const out = {};
  Object.entries(fields).forEach(([key, spec]) => { out[key] = spec.type === "grade" ? "None" : "Absent"; });
  return out;
};

const DIRECTION_COLOR = { worsening: "#b3261e", improving: "#2e7d32", stable: "#8a6d00" };
const DIRECTION_BG = { worsening: "#fbecea", improving: "#eef7ee", stable: "#fbf6e3" };

const EMPTY_FORM = { modality: "X-ray", region: "wrist_R", date: "", finding: {}, radiologist_impression: "" };

const formatDate = (d) => {
  if (!d) return "—";
  try { return new Date(d + "T00:00:00").toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" }); }
  catch { return d; }
};

export default function RheumatologyImaging({ doctorId, patientId, patientName }) {
  const [fieldSchema, setFieldSchema] = useState(null);
  const [studies, setStudies] = useState([]);
  const [form, setForm] = useState(EMPTY_FORM);
  const [formOpen, setFormOpen] = useState(false);
  const [formSaving, setFormSaving] = useState(false);
  const [formError, setFormError] = useState("");

  const [result, setResult] = useState(null);
  const [comparing, setComparing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState("");
  const [compareError, setCompareError] = useState("");

  const loadStudies = useCallback(async () => {
    if (!patientId || !doctorId) return;
    try {
      const res = await fetch(`${API_BASE_URL}hms/users/data/context/rheumatology-imaging/studies/${patientId}/${doctorId}`);
      const json = await res.json();
      if (json?.status === "success") setStudies(json.data || []);
    } catch (err) {
      console.error("Failed to load imaging studies:", err);
    }
  }, [patientId, doctorId]);

useEffect(() => {
  loadStudies();
  return subscribeRheumContextUpdate(loadStudies);
}, [loadStudies]);

  useEffect(() => {
    const loadSchema = async () => {
      try {
        const res = await fetch(`${API_BASE_URL}hms/users/data/context/rheumatology-imaging/field-schema`);
        const json = await res.json();
        if (json?.status === "success") {
          setFieldSchema(json.data || {});
          setForm((f) => ({ ...f, finding: defaultFindingForSchema(json.data, f.modality) }));
        }
      } catch (err) {
        console.error("Failed to load imaging field schema:", err);
      }
    };
    loadSchema();
  }, []);
  const handleAddStudy = async () => {
    setFormError("");
    if (!form.date) { setFormError("Study date is required."); return; }
    setFormSaving(true);
    try {
      const res = await fetch(`${API_BASE_URL}hms/users/data/context/rheumatology-imaging/add-study`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ patient_id: patientId, doctor_id: doctorId, ...form }),
      });
      const json = await res.json();
      if (!res.ok || json?.status !== "success") throw new Error(json?.detail || "Failed to log imaging study");
      setForm(EMPTY_FORM);
      setFormOpen(false);
      loadStudies();
      announceRheumContextUpdate("imaging");
    } catch (err) {
      console.error("Add imaging study failed:", err);
      setFormError(err.message || "Failed to log imaging study");
    } finally {
      setFormSaving(false);
    }
  };

  const handleDeleteStudy = async (studyId) => {
    try {
      const res = await fetch(`${API_BASE_URL}hms/users/data/context/rheumatology-imaging/study/${studyId}`, { method: "DELETE" });
      const json = await res.json();
      if (!res.ok || json?.status !== "success") throw new Error(json?.detail || "Delete failed");
      loadStudies();
      announceRheumContextUpdate("imaging");
    } catch (err) {
      console.error("Delete imaging study failed:", err);
    }
  };

  const handleCompare = async () => {
    setCompareError("");
    setComparing(true);
    try {
      const res = await fetch(`${API_BASE_URL}hms/users/data/context/rheumatology-imaging/compare`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ doctor_id: doctorId, patient_id: patientId }),
      });
      const json = await res.json();
      if (!res.ok || json?.status !== "success") throw new Error(json?.detail || "Failed to compare imaging studies");
      setResult({ ...json.finaloutput, skipped_regions: json.skipped_regions, context_used: json.context_used });
    } catch (err) {
      console.error("Imaging comparison failed:", err);
      setCompareError(err.message || "Failed to compare imaging studies");
    } finally {
      setComparing(false);
    }
  };

  const handleSave = async () => {
    if (!result?.comparisons?.length) return;
    setSaving(true);
    setSaveMsg("");
    try {
      const res = await fetch(`${API_BASE_URL}hms/users/data/context/rheumatology-imaging/save-comparison`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          patient_id: patientId, doctor_id: doctorId,
          comparisons: result.comparisons, narrative: result.narrative || "",
        }),
      });
      const json = await res.json();
      if (!res.ok || json?.status !== "success") throw new Error(json?.detail || json?.message || "Save failed");
      setSaveMsg("✅ Imaging comparison saved");
      window.dispatchEvent(new Event("refreshRheumatologyImagingHistory"));
      announceRheumContextUpdate("imaging");
    } catch (err) {
      console.error("Imaging comparison save failed:", err);
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
          <Typography sx={{ ...os({ fontSize: 14, color: C.ink, letterSpacing: "0.02em" }) }}>Imaging Intelligence</Typography>
          <Typography sx={{ ...os({ fontSize: 11, color: C.ash, mt: 0.4 }) }}>
            {patientName ? `Longitudinal imaging comparison — ${patientName}` : "Longitudinal imaging comparison"}
          </Typography>
        </Box>
        <Chip label="Module 11 · Imaging Intelligence" size="small" sx={{ background: C.black, color: C.white, fontWeight: 300, fontSize: 10, letterSpacing: "0.04em", borderRadius: "2px", height: 22 }} />
      </Box>

      {/* Study log */}
      <Box sx={{ px: 3, pt: 2.5 }}>
        <Box sx={{ display: "flex", alignItems: "center", justifyContent: "space-between", mb: 1 }}>
          <Typography sx={{ ...os({ fontSize: 11, color: C.ash, textTransform: "uppercase", letterSpacing: "0.07em" }) }}>Imaging Study Log</Typography>
          <Box component="button" type="button" onClick={() => setFormOpen((v) => !v)} sx={{ ...ghostButton, fontSize: 10.5, px: 1.25, py: 0.4 }}>
            <AddRounded sx={{ fontSize: 13 }} /> {formOpen ? "Cancel" : "Log Study"}
          </Box>
        </Box>

        {formOpen && (
          <Box sx={{ p: 1.75, mb: 1.5, border: `1px solid ${C.fog}`, borderRadius: "2px", display: "grid", gridTemplateColumns: { xs: "1fr", sm: "1fr 1fr 1fr" }, gap: 1 }}>
            <select
              style={inputSx}
              value={form.modality}
              onChange={(e) => {
                const modality = e.target.value;
                setForm((f) => ({ ...f, modality, finding: defaultFindingForSchema(fieldSchema, modality) }));
              }}
            >
              {MODALITY_OPTIONS.map((m) => <option key={m} value={m}>{m}</option>)}
            </select>
            <select style={inputSx} value={form.region} onChange={(e) => setForm((f) => ({ ...f, region: e.target.value }))}>
              {REGION_OPTIONS.map((r) => <option key={r} value={r}>{r}</option>)}
            </select>
            <input type="date" style={inputSx} value={form.date} onChange={(e) => setForm((f) => ({ ...f, date: e.target.value }))} />

            {Object.entries(fieldSchema?.[form.modality] || {}).map(([key, spec]) => (
              <Box key={key}>
                <Typography sx={{ ...os({ fontSize: 10, color: C.ash, mb: 0.5 }) }}>{fieldLabel(key)}</Typography>
                <select
                  style={inputSx}
                  value={form.finding[key] ?? (spec.type === "grade" ? "None" : "Absent")}
                  onChange={(e) => setForm((f) => ({ ...f, finding: { ...f.finding, [key]: e.target.value } }))}
                >
                  {(spec.type === "grade" ? GRADE_OPTIONS : PRESENT_ABSENT_OPTIONS).map((s) => <option key={s} value={s}>{s}</option>)}
                </select>
              </Box>
            ))}
            <input style={{ ...inputSx, gridColumn: "1 / -1" }} placeholder="Radiologist impression (optional, free text)" value={form.radiologist_impression} onChange={(e) => setForm((f) => ({ ...f, radiologist_impression: e.target.value }))} />

            {formError && <Typography sx={{ ...os({ fontSize: 11, color: "#b3261e", gridColumn: "1 / -1" }) }}>{formError}</Typography>}
            <Box sx={{ gridColumn: "1 / -1", display: "flex", justifyContent: "flex-end" }}>
              <Box component="button" type="button" onClick={handleAddStudy} disabled={formSaving} sx={{ ...actionButton, minWidth: 100, py: 0.75, fontSize: 11 }}>
                {formSaving ? "Saving..." : "Log Study"}
              </Box>
            </Box>
          </Box>
        )}

        {studies.length > 0 ? (
          <Box sx={{ display: "flex", flexWrap: "wrap", gap: 0.75, mb: 1 }}>
            {studies.map((s) => (
              <Chip
                key={s._id}
                label={`${formatDate(s.date)} · ${s.modality} · ${s.region}`}
                size="small"
                onDelete={() => handleDeleteStudy(s._id)}
                deleteIcon={<DeleteOutlineRounded sx={{ fontSize: 14 }} />}
                sx={{ fontSize: 10.5, height: 24, background: C.ghost, color: C.charcoal, border: `1px solid ${C.mist}` }}
              />
            ))}
          </Box>
        ) : (
          <Typography sx={{ ...os({ fontSize: 11.5, color: C.silver, mb: 1 }) }}>No imaging studies logged yet.</Typography>
        )}
      </Box>

      {compareError && <Typography sx={{ ...os({ fontSize: 12, color: "#b3261e", mx: 3, mb: 1 }) }}>{compareError}</Typography>}

      <Box sx={{ px: 3, pb: 2, display: "flex", justifyContent: "flex-end" }}>
        <Box component="button" type="button" onClick={handleCompare} disabled={comparing} sx={{ ...actionButton, minWidth: 190 }}>
          {comparing ? <RefreshRounded sx={{ fontSize: 15, animation: "spin 1s linear infinite" }} /> : <ImageSearchRounded sx={{ fontSize: 15 }} />}
          {comparing ? "Comparing..." : "Compare Studies"}
        </Box>
      </Box>

      {/* Results */}
      {result?.comparisons?.length > 0 && (
        <Box sx={{ px: 3, pb: 2, display: "flex", flexDirection: "column", gap: 1.5 }}>
          {result.skipped_regions?.length > 0 && (
            <Typography sx={{ ...os({ fontSize: 11, color: C.silver }) }}>
              Not enough studies to compare yet: {result.skipped_regions.join(", ")}
            </Typography>
          )}
          {result.comparisons.map((c) => (
            <Box key={c.region} sx={{ border: `1px solid ${C.fog}`, borderRadius: "4px", overflow: "hidden" }}>
              <Box sx={{ px: 2, py: 1.5, background: DIRECTION_BG[c.direction] || C.ghost, borderBottom: `1px solid ${C.fog}`, display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 1 }}>
                <Typography sx={{ ...os({ fontSize: 13, color: C.ink }) }}>{c.region}</Typography>
                <Box sx={{ display: "flex", gap: 0.75, alignItems: "center" }}>
                  {c.cross_modality && <Chip label="Cross-modality" size="small" sx={{ fontSize: 9, height: 18, background: C.ghost, color: C.ash, border: `1px solid ${C.mist}` }} />}
                  <Chip label={c.direction} size="small" sx={{ fontSize: 10.5, height: 20, background: DIRECTION_COLOR[c.direction] || C.charcoal, color: C.white }} />
                </Box>
              </Box>
              <Box sx={{ p: 1.75 }}>
                <Typography sx={{ ...os({ fontSize: 11, color: C.silver, mb: 0.75 }) }}>
                  {c.previous_study.modality} ({formatDate(c.previous_study.date)}) → {c.current_study.modality} ({formatDate(c.current_study.date)})
                </Typography>
                {c.field_deltas.length > 0 ? (
                  c.field_deltas.map((d, i) => (
                    <Typography key={i} sx={{ ...os({ fontSize: 11.5, color: C.charcoal }) }}>• {d}</Typography>
                  ))
                ) : (
                  <Typography sx={{ ...os({ fontSize: 11.5, color: C.silver }) }}>No change in structured findings between these studies.</Typography>
                )}
              </Box>
            </Box>
          ))}

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
        <Box component="button" type="button" onClick={handleSave} disabled={saving || !result?.comparisons?.length} sx={{ ...actionButton, minWidth: 200 }}>
          <SaveRounded sx={{ fontSize: 15 }} /> {saving ? "Saving..." : "Save Comparison"}
        </Box>
      </Box>

      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </Box>
  );
}