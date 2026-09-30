import React, { useState, useEffect, useCallback } from "react";
import { Box, Typography, Chip } from "@mui/material";
import {
  RefreshRounded,
  SaveRounded,
  AddRounded,
  DeleteOutlineRounded,
  MedicationRounded,
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

const ROUTE_OPTIONS = ["Oral", "IV", "IM", "Intra-articular"];
const INDICATION_OPTIONS = ["Disease flare", "Rescue course", "Maintenance/bridging", "Post-procedure", "Other"];

const CATEGORY_COLOR = { green: "#2e7d32", yellow: "#8a6d00", red: "#b3261e" };
const CATEGORY_BG = { green: "#eef7ee", yellow: "#fbf6e3", red: "#fbecea" };
const CATEGORY_LABEL = { green: "No flag", yellow: "Monitor", red: "Review" };

const EMPTY_FORM = {
  drug: "Prednisolone", route: "Oral", dose_mg: "", start_date: "", end_date: "",
  indication: "Disease flare", notes: "",
};

const METRIC_LABELS = {
  days_on_steroid_12mo: "Days on steroid (past year)",
  cumulative_prednisolone_equivalent_mg_12mo: "Cumulative pred.-equiv. (mg, past year)",
  avg_daily_dose_on_steroid_days_mg: "Avg. daily dose on steroid days (mg)",
  active_dose_today_mg: "Current active dose (mg/day pred.-equiv.)",
  rescue_course_count_12mo: "Rescue courses (past year)",
};

const formatDate = (d) => {
  if (!d) return "—";
  try { return new Date(d + "T00:00:00").toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" }); }
  catch { return d; }
};

export default function RheumatologySteroidStewardship({ doctorId, patientId, patientName }) {
  const [steroidDrugs, setSteroidDrugs] = useState(["Prednisolone", "Prednisone", "Methylprednisolone", "Dexamethasone", "Deflazacort", "Hydrocortisone", "Triamcinolone"]);
  const [steroidReportedAtIntake, setSteroidReportedAtIntake] = useState(false);
  const [diabetesFlag, setDiabetesFlag] = useState(false);
  const [hasIntakeData, setHasIntakeData] = useState(false);

  const [courses, setCourses] = useState([]);
  const [form, setForm] = useState(EMPTY_FORM);
  const [formOpen, setFormOpen] = useState(false);
  const [formSaving, setFormSaving] = useState(false);
  const [formError, setFormError] = useState("");
  const [ongoing, setOngoing] = useState(true);

  const [result, setResult] = useState(null);
  const [assessing, setAssessing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState("");
  const [assessError, setAssessError] = useState("");
  const [taperPlan, setTaperPlan] = useState(null);
const [taperGenerating, setTaperGenerating] = useState(false);
const [taperError, setTaperError] = useState("");
const [taperSaving, setTaperSaving] = useState(false);
const [taperSaveMsg, setTaperSaveMsg] = useState("");

  const loadContext = useCallback(async () => {
    if (!patientId || !doctorId) return;
    try {
      const res = await fetch(`${API_BASE_URL}hms/users/data/context/rheumatology-steroid-stewardship/context-preview/${patientId}/${doctorId}`);
      const json = await res.json();
      if (json?.status === "success") {
        if (json.data?.steroid_drugs?.length) setSteroidDrugs(json.data.steroid_drugs);
        setSteroidReportedAtIntake(Boolean(json.data?.steroid_reported_at_intake));
        setDiabetesFlag(Boolean(json.data?.diabetes_comorbidity_flagged));
        setHasIntakeData(Boolean(json.has_intake_data));
      }
    } catch (err) {
      console.error("Failed to load steroid stewardship context:", err);
    }
  }, [patientId, doctorId]);

  const loadCourses = useCallback(async () => {
    if (!patientId || !doctorId) return;
    try {
      const res = await fetch(`${API_BASE_URL}hms/users/data/context/rheumatology-steroid-stewardship/courses/${patientId}/${doctorId}`);
      const json = await res.json();
      if (json?.status === "success") setCourses(json.data || []);
    } catch (err) {
      console.error("Failed to load steroid courses:", err);
    }
  }, [patientId, doctorId]);

useEffect(() => {
    loadContext();
    loadCourses();
    return subscribeRheumContextUpdate(() => { loadContext(); loadCourses(); });
  }, [loadContext, loadCourses]);

  const handleAddCourse = async () => {
    setFormError("");
    if (!form.start_date) { setFormError("Start date is required."); return; }
    if (!form.dose_mg || Number(form.dose_mg) <= 0) { setFormError("Daily dose (mg) must be a positive number."); return; }
    setFormSaving(true);
    try {
      const res = await fetch(`${API_BASE_URL}hms/users/data/context/rheumatology-steroid-stewardship/add-course`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          patient_id: patientId, doctor_id: doctorId, ...form,
          dose_mg: Number(form.dose_mg),
          end_date: ongoing ? null : (form.end_date || null),
        }),
      });
      const json = await res.json();
      if (!res.ok || json?.status !== "success") throw new Error(json?.detail || "Failed to log steroid course");
      setForm(EMPTY_FORM);
      setOngoing(true);
      setFormOpen(false);
      loadCourses();
      announceRheumContextUpdate("steroid-stewardship");
    } catch (err) {
      console.error("Add steroid course failed:", err);

      setFormError(err.message || "Failed to log steroid course");
    } finally {
      setFormSaving(false);
    }
  };

  const handleDeleteCourse = async (courseId) => {
    try {
      const res = await fetch(`${API_BASE_URL}hms/users/data/context/rheumatology-steroid-stewardship/course/${courseId}`, { method: "DELETE" });
      const json = await res.json();
      if (!res.ok || json?.status !== "success") throw new Error(json?.detail || "Delete failed");
      loadCourses();
      announceRheumContextUpdate("steroid-stewardship");
    } catch (err) {
      console.error("Delete steroid course failed:", err);
    }
  };

  const handleAssess = async () => {
    setAssessError("");
    setAssessing(true);
    try {
      const res = await fetch(`${API_BASE_URL}hms/users/data/context/rheumatology-steroid-stewardship/assess`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ doctor_id: doctorId, patient_id: patientId }),
      });
      const json = await res.json();
      if (!res.ok || json?.status !== "success") throw new Error(json?.detail || "Failed to assess steroid exposure");
      setResult(json.finaloutput);
    } catch (err) {
      console.error("Steroid stewardship assessment failed:", err);
      setAssessError(err.message || "Failed to assess steroid exposure");
    } finally {
      setAssessing(false);
    }
  };

  const handleSave = async () => {
    if (!result?.domains?.length) return;
    setSaving(true);
    setSaveMsg("");
    try {
      const res = await fetch(`${API_BASE_URL}hms/users/data/context/rheumatology-steroid-stewardship/save`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          patient_id: patientId, doctor_id: doctorId,
          domains: result.domains, metrics: result.metrics || {}, narrative: result.narrative || "",
        }),
      });
      const json = await res.json();
      if (!res.ok || json?.status !== "success") throw new Error(json?.detail || json?.message || "Save failed");
      setSaveMsg("✅ Steroid stewardship assessment saved");
      window.dispatchEvent(new Event("refreshRheumatologySteroidStewardshipHistory"));
      announceRheumContextUpdate("steroid-stewardship");
    } catch (err) {
      console.error("Steroid stewardship save failed:", err);
      setSaveMsg(`❌ ${err.message || "Save failed"}`);
    } finally {
      setSaving(false);
      setTimeout(() => setSaveMsg(""), 3000);
    }
  };
const handleGenerateTaperPlan = async () => {
  setTaperError("");
  setTaperGenerating(true);
  try {
    const res = await fetch(`${API_BASE_URL}hms/users/data/context/rheumatology-steroid-stewardship/generate-taper-plan`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ patient_id: patientId, doctor_id: doctorId }),
    });
    const json = await res.json();
    if (!res.ok || json?.status !== "success") throw new Error(json?.detail || "Failed to generate taper plan");
    setTaperPlan(json.finaloutput);
  } catch (err) {
    console.error("Generate taper plan failed:", err);
    setTaperError(err.message || "Failed to generate taper plan");
  } finally {
    setTaperGenerating(false);
  }
};

const handleTaperStepChange = (index, field, value) => {
  setTaperPlan((prev) => {
    if (!prev) return prev;
    const steps = prev.steps.map((s, i) => (i === index ? { ...s, [field]: value } : s));
    return { ...prev, steps };
  });
};

const handleSaveTaperPlan = async () => {
  if (!taperPlan?.steps?.length) return;
  setTaperSaving(true);
  setTaperSaveMsg("");
  try {
    const res = await fetch(`${API_BASE_URL}hms/users/data/context/rheumatology-steroid-stewardship/save-taper-plan`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        patient_id: patientId, doctor_id: doctorId,
        steps: taperPlan.steps,
        generated_from_active_dose_mg: taperPlan.generated_from_active_dose_mg,
        disclaimer: taperPlan.disclaimer,
      }),
    });
    const json = await res.json();
    if (!res.ok || json?.status !== "success") throw new Error(json?.detail || "Save failed");
    setTaperSaveMsg("✅ Taper plan saved");
    window.dispatchEvent(new Event("refreshRheumatologySteroidStewardshipTaperHistory"));
    announceRheumContextUpdate("steroid-stewardship");
  } catch (err) {
    console.error("Save taper plan failed:", err);
    setTaperSaveMsg(`❌ ${err.message || "Save failed"}`);
  } finally {
    setTaperSaving(false);
    setTimeout(() => setTaperSaveMsg(""), 3000);
  }
};
  return (
    <Box sx={{ ...card, overflow: "hidden" }}>
      <Box sx={{ px: 3, py: 2.5, borderBottom: `1px solid ${C.fog}`, background: C.ghost, display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 1.5 }}>
        <Box>
          <Typography sx={{ ...os({ fontSize: 14, color: C.ink, letterSpacing: "0.02em" }) }}>Steroid Stewardship</Typography>
          <Typography sx={{ ...os({ fontSize: 11, color: C.ash, mt: 0.4 }) }}>
            {patientName ? `Cumulative glucocorticoid exposure — ${patientName}` : "Cumulative glucocorticoid exposure"}
          </Typography>
        </Box>
        <Chip label="Module 14 · Steroid Stewardship" size="small" sx={{ background: C.black, color: C.white, fontWeight: 300, fontSize: 10, letterSpacing: "0.04em", borderRadius: "2px", height: 22 }} />
      </Box>

      {/* Intake hint */}
      {hasIntakeData && (steroidReportedAtIntake || diabetesFlag) && (
        <Box sx={{ mx: 3, mt: 2, p: 1.5, borderRadius: "2px", background: C.ghost, border: `1px solid ${C.fog}` }}>
          {steroidReportedAtIntake && (
            <Typography sx={{ ...os({ fontSize: 11, color: C.charcoal }) }}>
              Steroid exposure reported at intake — log the course(s) below if not already captured.
            </Typography>
          )}
          {diabetesFlag && (
            <Typography sx={{ ...os({ fontSize: 11, color: C.charcoal, mt: steroidReportedAtIntake ? 0.5 : 0 }) }}>
              Diabetes-related comorbidity reported at intake — factored into the hyperglycemia flag.
            </Typography>
          )}
        </Box>
      )}

      {/* Course log */}
      <Box sx={{ px: 3, pt: 2.5 }}>
        <Box sx={{ display: "flex", alignItems: "center", justifyContent: "space-between", mb: 1 }}>
          <Typography sx={{ ...os({ fontSize: 11, color: C.ash, textTransform: "uppercase", letterSpacing: "0.07em" }) }}>Steroid Course Log</Typography>
          <Box component="button" type="button" onClick={() => setFormOpen((v) => !v)} sx={{ ...ghostButton, fontSize: 10.5, px: 1.25, py: 0.4 }}>
            <AddRounded sx={{ fontSize: 13 }} /> {formOpen ? "Cancel" : "Log Course"}
          </Box>
        </Box>

        {formOpen && (
          <Box sx={{ p: 1.75, mb: 1.5, border: `1px solid ${C.fog}`, borderRadius: "2px", display: "grid", gridTemplateColumns: { xs: "1fr", sm: "1fr 1fr 1fr" }, gap: 1 }}>
            <select style={inputSx} value={form.drug} onChange={(e) => setForm((f) => ({ ...f, drug: e.target.value }))}>
              {steroidDrugs.map((d) => <option key={d} value={d}>{d}</option>)}
            </select>
            <select style={inputSx} value={form.route} onChange={(e) => setForm((f) => ({ ...f, route: e.target.value }))}>
              {ROUTE_OPTIONS.map((r) => <option key={r} value={r}>{r}</option>)}
            </select>
            <input type="number" min={0} step="0.5" style={inputSx} placeholder="Daily dose (mg)" value={form.dose_mg} onChange={(e) => setForm((f) => ({ ...f, dose_mg: e.target.value }))} />

            <Box>
              <Typography sx={{ ...os({ fontSize: 10, color: C.ash, mb: 0.5 }) }}>Start Date</Typography>
              <input type="date" style={inputSx} value={form.start_date} onChange={(e) => setForm((f) => ({ ...f, start_date: e.target.value }))} />
            </Box>
            <Box>
              <Typography sx={{ ...os({ fontSize: 10, color: C.ash, mb: 0.5 }) }}>End Date</Typography>
              <input type="date" style={{ ...inputSx, opacity: ongoing ? 0.5 : 1 }} disabled={ongoing} value={form.end_date} onChange={(e) => setForm((f) => ({ ...f, end_date: e.target.value }))} />
              <Box sx={{ display: "flex", alignItems: "center", gap: 0.5, mt: 0.5 }}>
                <input type="checkbox" checked={ongoing} onChange={(e) => setOngoing(e.target.checked)} id="ongoing-checkbox" />
                <label htmlFor="ongoing-checkbox" style={{ fontFamily: FONT, fontSize: 10.5, color: C.ash }}>Ongoing (no end date)</label>
              </Box>
            </Box>
            <Box>
              <Typography sx={{ ...os({ fontSize: 10, color: C.ash, mb: 0.5 }) }}>Indication</Typography>
              <select style={inputSx} value={form.indication} onChange={(e) => setForm((f) => ({ ...f, indication: e.target.value }))}>
                {INDICATION_OPTIONS.map((i) => <option key={i} value={i}>{i}</option>)}
              </select>
            </Box>
            <input style={{ ...inputSx, gridColumn: "1 / -1" }} placeholder="Notes (optional, free text)" value={form.notes} onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))} />

            {formError && <Typography sx={{ ...os({ fontSize: 11, color: "#b3261e", gridColumn: "1 / -1" }) }}>{formError}</Typography>}
            <Box sx={{ gridColumn: "1 / -1", display: "flex", justifyContent: "flex-end" }}>
              <Box component="button" type="button" onClick={handleAddCourse} disabled={formSaving} sx={{ ...actionButton, minWidth: 100, py: 0.75, fontSize: 11 }}>
                {formSaving ? "Saving..." : "Log Course"}
              </Box>
            </Box>
          </Box>
        )}

        {courses.length > 0 ? (
          <Box sx={{ display: "flex", flexWrap: "wrap", gap: 0.75, mb: 1 }}>
            {courses.map((c) => (
              <Chip
                key={c._id}
                label={`${formatDate(c.start_date)} → ${c.end_date ? formatDate(c.end_date) : "ongoing"} · ${c.drug} ${c.dose_mg}mg (${c.route}) · ${c.indication}`}
                size="small"
                onDelete={() => handleDeleteCourse(c._id)}
                deleteIcon={<DeleteOutlineRounded sx={{ fontSize: 14 }} />}
                sx={{ fontSize: 10.5, height: 24, background: C.ghost, color: C.charcoal, border: `1px solid ${C.mist}` }}
              />
            ))}
          </Box>
        ) : (
          <Typography sx={{ ...os({ fontSize: 11.5, color: C.silver, mb: 1 }) }}>No steroid courses logged yet.</Typography>
        )}
      </Box>

      {assessError && <Typography sx={{ ...os({ fontSize: 12, color: "#b3261e", mx: 3, mb: 1 }) }}>{assessError}</Typography>}

      <Box sx={{ px: 3, pb: 2, display: "flex", justifyContent: "flex-end" }}>
        <Box component="button" type="button" onClick={handleAssess} disabled={assessing || courses.length === 0} sx={{ ...actionButton, minWidth: 190 }}>
          {assessing ? <RefreshRounded sx={{ fontSize: 15, animation: "spin 1s linear infinite" }} /> : <MedicationRounded sx={{ fontSize: 15 }} />}
          {assessing ? "Assessing..." : "Assess Exposure"}
        </Box>
      </Box>

      {/* Results */}
      {result?.domains?.length > 0 && (
        <Box sx={{ px: 3, pb: 2, display: "flex", flexDirection: "column", gap: 1.5 }}>
          {result.metrics && (
            <Box sx={{ display: "flex", flexWrap: "wrap", gap: 0.75 }}>
              {Object.entries(result.metrics).map(([k, v]) => (
                <Chip key={k} label={`${METRIC_LABELS[k] || k}: ${v}`} size="small" sx={{ fontSize: 10, height: 22, background: C.ghost, color: C.charcoal, border: `1px solid ${C.mist}` }} />
              ))}
            </Box>
          )}

          <Box sx={{ display: "grid", gridTemplateColumns: { xs: "1fr", sm: "repeat(2, 1fr)", lg: "repeat(3, 1fr)" }, gap: 1.5 }}>
            {result.domains.map((d) => (
              <Box key={d.domain} sx={{ border: `1px solid ${C.fog}`, borderRadius: "4px", overflow: "hidden" }}>
                <Box sx={{ px: 1.75, py: 1.25, background: CATEGORY_BG[d.category] || C.ghost, borderBottom: `1px solid ${C.fog}`, display: "flex", alignItems: "center", justifyContent: "space-between", gap: 1 }}>
                  <Typography sx={{ ...os({ fontSize: 12.5, color: C.ink }) }}>{d.domain}</Typography>
                  <Chip label={CATEGORY_LABEL[d.category] || d.category} size="small" sx={{ fontSize: 9.5, height: 19, background: CATEGORY_COLOR[d.category] || C.charcoal, color: C.white }} />
                </Box>
                <Box sx={{ p: 1.5 }}>
                  {(d.reasons || []).map((r, i) => (
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
      {/* Taper plan */}
{result?.metrics?.active_dose_today_mg > 0 && (
  <Box sx={{ px: 3, pb: 2 }}>
    <Box sx={{ display: "flex", alignItems: "center", justifyContent: "space-between", mb: 1 }}>
      <Typography sx={{ ...os({ fontSize: 11, color: C.ash, textTransform: "uppercase", letterSpacing: "0.07em" }) }}>
        Tapering Plan
      </Typography>
      <Box component="button" type="button" onClick={handleGenerateTaperPlan} disabled={taperGenerating} sx={{ ...ghostButton, fontSize: 10.5, px: 1.25, py: 0.4 }}>
        {taperGenerating ? "Generating..." : "Generate Taper Plan"}
      </Box>
    </Box>

    {taperError && <Typography sx={{ ...os({ fontSize: 12, color: "#b3261e", mb: 1 }) }}>{taperError}</Typography>}

    {taperPlan?.steps?.length > 0 && (
      <Box sx={{ border: `1px solid ${C.fog}`, borderRadius: "4px", overflow: "hidden" }}>
        <Box sx={{ p: 1.5, background: CATEGORY_BG.yellow, borderBottom: `1px solid ${C.fog}` }}>
          <Typography sx={{ ...os({ fontSize: 11, color: CATEGORY_COLOR.yellow, lineHeight: 1.5 }) }}>
            {taperPlan.disclaimer}
          </Typography>
        </Box>
        <Box sx={{ p: 1.5, display: "flex", flexDirection: "column", gap: 1 }}>
          {taperPlan.steps.map((s, i) => (
            <Box key={i} sx={{ display: "grid", gridTemplateColumns: { xs: "1fr", sm: "40px 1fr 1fr 1fr 1fr" }, gap: 0.75, alignItems: "center" }}>
              <Typography sx={{ ...os({ fontSize: 11, color: C.ash }) }}>#{s.step}</Typography>
              <input type="date" style={inputSx} value={s.start_date} onChange={(e) => handleTaperStepChange(i, "start_date", e.target.value)} />
              <input type="number" step="0.5" style={inputSx} value={s.dose_mg} onChange={(e) => handleTaperStepChange(i, "dose_mg", Number(e.target.value))} placeholder="Dose (mg)" />
              <input type="number" style={inputSx} value={s.duration_days} onChange={(e) => handleTaperStepChange(i, "duration_days", Number(e.target.value))} placeholder="Days" />
              <input type="number" step="0.5" style={inputSx} value={s.next_dose_mg} onChange={(e) => handleTaperStepChange(i, "next_dose_mg", Number(e.target.value))} placeholder="Next dose (mg)" />
              {s.note && <Typography sx={{ ...os({ fontSize: 10.5, color: C.ash, gridColumn: "1 / -1" }) }}>{s.note}</Typography>}
            </Box>
          ))}
        </Box>
        <Box sx={{ px: 1.5, pb: 1.5, display: "flex", alignItems: "center", justifyContent: "flex-end", gap: 1.5 }}>
          {taperSaveMsg && <Typography sx={{ ...os({ fontSize: 12, color: taperSaveMsg.includes("✅") ? "#2e7d32" : "#d32f2f" }) }}>{taperSaveMsg}</Typography>}
          <Box component="button" type="button" onClick={handleSaveTaperPlan} disabled={taperSaving} sx={{ ...actionButton, minWidth: 160, py: 0.75, fontSize: 11 }}>
            {taperSaving ? "Saving..." : "Save Taper Plan"}
          </Box>
        </Box>
      </Box>
    )}
  </Box>
)}

      {/* Footer */}
      <Box sx={{ px: 3, py: 2, borderTop: `1px solid ${C.fog}`, background: C.ghost, display: "flex", alignItems: "center", justifyContent: "flex-end", gap: 1.5 }}>
        {saveMsg && <Typography sx={{ ...os({ fontSize: 12, color: saveMsg.includes("✅") ? "#2e7d32" : "#d32f2f" }) }}>{saveMsg}</Typography>}
        <Box component="button" type="button" onClick={handleSave} disabled={saving || !result?.domains?.length} sx={{ ...actionButton, minWidth: 200 }}>
          <SaveRounded sx={{ fontSize: 15 }} /> {saving ? "Saving..." : "Save Assessment"}
        </Box>
      </Box>

      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </Box>
  );
}