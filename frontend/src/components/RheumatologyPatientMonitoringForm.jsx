import React, { useEffect, useRef, useState, useCallback } from "react";

const API_BASE_URL = import.meta.env.VITE_BACKEND_URL || "https://doctorassist.ai/api/";

// ─── Design Tokens (copied from ProcedureNotes.jsx for visual consistency) ──
const FONT = '"Open Sans", sans-serif';
const FW = 300;

const C = {
  black: "#0a0a0a",
  ink: "#1a1a1a",
  charcoal: "#2e2e2e",
  smoke: "#4a4a4a",
  ash: "#7a7a7a",
  silver: "#a8a8a8",
  mist: "#d4d4d4",
  fog: "#e8e8e8",
  ghost: "#f2f2f2",
  white: "#ffffff",
};

const os = (extra = {}) => ({ fontFamily: FONT, fontWeight: FW, ...extra });

const card = {
  background: C.white,
  border: `1px solid ${C.fog}`,
  borderRadius: "4px",
  boxShadow: "0 1px 3px rgba(0,0,0,0.06)",
};

const STATUS_COLOR = { green: "#166534", yellow: "#92400e", red: "#991b1b" };
const STATUS_BG = { green: "#f0fdf4", yellow: "#fffbeb", red: "#fef2f2" };
const STATUS_BORDER = { green: "#bbf7d0", yellow: "#fde68a", red: "#fecaca" };
const STATUS_DOT = { green: "🟢", yellow: "🟡", red: "🔴" };

const DOMAIN_LABEL = {
  pain: "Pain",
  morning_stiffness: "Morning Stiffness",
  swelling: "Swelling",
  fatigue: "Fatigue",
  function: "Function",
  medication_adherence: "Medication Adherence",
  adverse_effects: "Adverse Effects",
  hospitalization: "Hospitalization",
  infection: "Infection",
};

const REPORTED_BY_OPTIONS = ["Patient — phone call", "Patient — in clinic", "Caregiver", "Clinic staff observation"];
const ADHERENCE_OPTIONS = ["Taking as prescribed", "Missed some doses", "Stopped taking"];
const SEVERITY_OPTIONS = ["Mild", "Moderate", "Severe"];

const FieldLabel = ({ children }) => (
  <div style={{ ...os({ fontSize: 10, color: C.silver, textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 6 }) }}>
    {children}
  </div>
);

const SectionHeader = ({ children, sub }) => (
  <div style={{ padding: "16px 20px", borderBottom: `1px solid ${C.fog}`, background: C.white }}>
    <div style={{ ...os({ fontSize: 14, color: C.ink, letterSpacing: "0.02em" }) }}>{children}</div>
    {sub && <div style={{ ...os({ fontSize: 11, color: C.ash, marginTop: 3 }) }}>{sub}</div>}
  </div>
);

const ActionBtn = ({ onClick, disabled, children, style = {} }) => (
  <button
    onClick={onClick}
    disabled={disabled}
    style={{
      padding: "8px 18px", borderRadius: "2px",
      background: disabled ? C.mist : C.black,
      color: disabled ? C.silver : C.white,
      border: "none", cursor: disabled ? "not-allowed" : "pointer",
      display: "flex", alignItems: "center", gap: 6,
      transition: "background 0.15s",
      ...os({ fontSize: 12 }),
      ...style,
    }}
    onMouseEnter={(e) => { if (!disabled) e.currentTarget.style.background = C.charcoal; }}
    onMouseLeave={(e) => { if (!disabled) e.currentTarget.style.background = C.black; }}
  >
    {children}
  </button>
);

const GhostBtn = ({ onClick, disabled, children, style = {} }) => (
  <button
    onClick={onClick}
    disabled={disabled}
    style={{
      padding: "7px 14px", borderRadius: "2px",
      background: "transparent", color: disabled ? C.silver : C.charcoal,
      border: `1px solid ${disabled ? C.fog : C.mist}`,
      cursor: disabled ? "not-allowed" : "pointer",
      display: "flex", alignItems: "center", gap: 6,
      transition: "all 0.15s",
      ...os({ fontSize: 12 }),
      ...style,
    }}
  >
    {children}
  </button>
);

const inputStyle = {
  width: "100%", padding: "9px 12px",
  border: `1px solid ${C.mist}`, borderRadius: "2px",
  background: C.white, ...os({ fontSize: 13, color: C.ink }),
  outline: "none", boxSizing: "border-box",
};

const Field = ({ label, children }) => (
  <div>
    <FieldLabel>{label}</FieldLabel>
    {children}
  </div>
);

const formatDate = (d) => {
  if (!d) return "—";
  try { return new Date(d).toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" }); }
  catch { return d; }
};
const formatDateTime = (d) => {
  if (!d) return "—";
  try { return new Date(d).toLocaleString("en-US", { year: "numeric", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }); }
  catch { return d; }
};

const EMPTY_FORM = {
  report_date: new Date().toISOString().slice(0, 10),
  reported_by: REPORTED_BY_OPTIONS[0],
  pain: "",
  patient_global_assessment: "",
  morning_stiffness_minutes: "",
  swollen_joint_count: "",
  fatigue: "",
  function_difficulty: "",
  medication_adherence: ADHERENCE_OPTIONS[0],
  adverse_effects_reported: false,
  adverse_effects_description: "",
  adverse_effects_severity: "",
  hospitalization_since_last_checkin: "No",
  hospitalization_reason: "",
  infection_since_last_checkin: "No",
  notes: "",
};

/* ═══════════════════════════════════════════════════════════════════════════
   DOMAIN FLAG ROW
═══════════════════════════════════════════════════════════════════════════ */
const DomainFlagRow = ({ domain }) => (
  <div style={{
    display: "flex", alignItems: "flex-start", gap: 10, padding: "10px 12px",
    border: `1px solid ${STATUS_BORDER[domain.category] || C.fog}`,
    background: STATUS_BG[domain.category] || C.ghost,
    borderRadius: "2px", marginBottom: 6,
  }}>
    <span style={{ fontSize: 14, lineHeight: 1.4 }}>{STATUS_DOT[domain.category] || "⚪"}</span>
    <div style={{ flex: 1 }}>
      <div style={{ ...os({ fontSize: 12.5, color: C.ink, fontWeight: 400, marginBottom: 2 }) }}>
        {DOMAIN_LABEL[domain.domain] || domain.domain}
      </div>
      {(domain.reasons || []).map((r, i) => (
        <div key={i} style={{ ...os({ fontSize: 11.5, color: STATUS_COLOR[domain.category] || C.charcoal }) }}>{r}</div>
      ))}
    </div>
  </div>
);

/* ═══════════════════════════════════════════════════════════════════════════
   MAIN COMPONENT
═══════════════════════════════════════════════════════════════════════════ */
const RheumatologyPatientMonitoringForm = ({ doctorId, patientId, patientName }) => {
  const [previousCheckin, setPreviousCheckin] = useState(null);
  const [checkins, setCheckins] = useState([]);
  const [form, setForm] = useState(EMPTY_FORM);
  const [formOpen, setFormOpen] = useState(true);
  const [formSaving, setFormSaving] = useState(false);
  const [formError, setFormError] = useState("");

  const [assessment, setAssessment] = useState(null);
  const [assessingId, setAssessingId] = useState(null);
  const [assessError, setAssessError] = useState("");

  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState("");

  const [history, setHistory] = useState([]);
  const [historyLoading, setHistoryLoading] = useState(false);

  const loadContext = useCallback(async () => {
    if (!patientId || !doctorId) return;
    try {
      const res = await fetch(`${API_BASE_URL}hms/users/data/context/rheumatology-patient-monitoring/context-preview/${patientId}/${doctorId}`);
      const json = await res.json();
      if (json?.status === "success") setPreviousCheckin(json.data?.previous_checkin || null);
    } catch (err) { console.error("Failed to load monitoring context:", err); }
  }, [patientId, doctorId]);

  const loadCheckins = useCallback(async () => {
    if (!patientId || !doctorId) return;
    try {
      const res = await fetch(`${API_BASE_URL}hms/users/data/context/rheumatology-patient-monitoring/checkins/${patientId}/${doctorId}`);
      const json = await res.json();
      if (json?.status === "success") setCheckins(json.data || []);
    } catch (err) { console.error("Failed to load check-ins:", err); }
  }, [patientId, doctorId]);

  const loadHistory = useCallback(async () => {
    if (!patientId || !doctorId) return;
    setHistoryLoading(true);
    try {
      const res = await fetch(`${API_BASE_URL}hms/users/data/context/rheumatology-patient-monitoring/history/${patientId}/${doctorId}`);
      const json = await res.json();
      if (json?.status === "success") setHistory(json.data || []);
    } catch (err) { console.error("Failed to load monitoring history:", err); }
    finally { setHistoryLoading(false); }
  }, [patientId, doctorId]);

  useEffect(() => { loadContext(); loadCheckins(); loadHistory(); }, [loadContext, loadCheckins, loadHistory]);

  const handleAddCheckin = async () => {
    setFormError("");
    const requiredVas = ["pain", "patient_global_assessment", "fatigue", "function_difficulty"];
    for (const f of requiredVas) {
      const v = Number(form[f]);
      if (form[f] === "" || Number.isNaN(v) || v < 0 || v > 10) {
        setFormError(`${f.replace(/_/g, " ")} must be a number between 0 and 10.`);
        return;
      }
    }
    if (form.morning_stiffness_minutes === "" || Number(form.morning_stiffness_minutes) < 0) {
      setFormError("Morning stiffness (minutes) is required and must be 0 or more."); return;
    }
    if (form.swollen_joint_count === "" || Number(form.swollen_joint_count) < 0) {
      setFormError("Swollen joint count is required and must be 0 or more."); return;
    }
    if (form.adverse_effects_reported && !form.adverse_effects_severity) {
      setFormError("Please select adverse effect severity."); return;
    }

    setFormSaving(true);
    try {
      const res = await fetch(`${API_BASE_URL}hms/users/data/context/rheumatology-patient-monitoring/add-checkin`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          patient_id: patientId, doctor_id: doctorId,
          ...form,
          pain: Number(form.pain),
          patient_global_assessment: Number(form.patient_global_assessment),
          morning_stiffness_minutes: Number(form.morning_stiffness_minutes),
          swollen_joint_count: Number(form.swollen_joint_count),
          fatigue: Number(form.fatigue),
          function_difficulty: Number(form.function_difficulty),
        }),
      });
      const json = await res.json();
      if (!res.ok || json?.status !== "success") throw new Error(json?.detail || "Failed to log check-in");

      setForm(EMPTY_FORM);
      await Promise.all([loadCheckins(), loadContext()]);

      // Auto-assess the just-logged check-in
      if (json.id) await handleAssess(json.id);
    } catch (err) {
      console.error("Add check-in failed:", err);
      setFormError(err.message || "Failed to log check-in");
    } finally {
      setFormSaving(false);
    }
  };

  const handleAssess = async (checkinId) => {
    setAssessError("");
    setAssessingId(checkinId);
    setAssessment(null);
    try {
      const res = await fetch(`${API_BASE_URL}hms/users/data/context/rheumatology-patient-monitoring/assess`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ patient_id: patientId, doctor_id: doctorId, checkin_id: checkinId }),
      });
      const json = await res.json();
      if (!res.ok || json?.status !== "success") throw new Error(json?.detail || "Failed to assess check-in");
      setAssessment(json.finaloutput);
    } catch (err) {
      console.error("Assess check-in failed:", err);
      setAssessError(err.message || "Failed to assess check-in");
    } finally {
      setAssessingId(null);
    }
  };

  const handleSaveAssessment = async () => {
    if (!assessment) return;
    setSaving(true);
    setSaveMsg("");
    try {
      const res = await fetch(`${API_BASE_URL}hms/users/data/context/rheumatology-patient-monitoring/save`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          patient_id: patientId, doctor_id: doctorId,
          checkin_id: assessment.checkin_id,
          domains: assessment.domains,
          overall_status: assessment.overall_status,
          rapid3_style: assessment.rapid3_style,
          narrative: assessment.narrative || "",
        }),
      });
      const json = await res.json();
      if (!res.ok || json?.status !== "success") throw new Error(json?.detail || json?.message || "Save failed");
      setSaveMsg("✅ Assessment saved");
      loadHistory();
    } catch (err) {
      console.error("Save assessment failed:", err);
      setSaveMsg(`❌ ${err.message || "Save failed"}`);
    } finally {
      setSaving(false);
      setTimeout(() => setSaveMsg(""), 3000);
    }
  };

  return (
    <div style={{ fontFamily: FONT, fontWeight: FW, color: C.ink, display: "flex", flexDirection: "column", gap: 16 }}>
      <style>{`@keyframes spin { from{transform:rotate(0deg)} to{transform:rotate(360deg)} }`}</style>

      {/* ── Header ── */}
      <div style={{ ...card, padding: "16px 20px", display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 8 }}>
        <div>
          <div style={{ ...os({ fontSize: 14, color: C.ink, letterSpacing: "0.02em" }) }}>Rheumatology Patient Monitoring</div>
          <div style={{ ...os({ fontSize: 11, color: C.ash, marginTop: 3 }) }}>
            {patientName ? `Between-visit check-in — ${patientName}` : "Between-visit check-in"} — Module 17
          </div>
        </div>
        {previousCheckin && (
          <div style={{ ...os({ fontSize: 11, color: C.silver }) }}>
            Last check-in: {formatDate(previousCheckin.report_date)} · {previousCheckin.reported_by}
          </div>
        )}
      </div>

      {/* ── Log a new check-in ── */}
      <div style={{ ...card }}>
        <SectionHeader sub="Logged by clinic staff on the patient's behalf (phone, caregiver, or in-clinic report) — there is no live patient portal yet">
          Log Check-in
        </SectionHeader>
        <div style={{ padding: "16px 20px", display: "flex", flexDirection: "column", gap: 14 }}>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <Field label="Report Date">
              <input type="date" style={inputStyle} value={form.report_date} onChange={(e) => setForm((f) => ({ ...f, report_date: e.target.value }))} />
            </Field>
            <Field label="Reported By">
              <select style={inputStyle} value={form.reported_by} onChange={(e) => setForm((f) => ({ ...f, reported_by: e.target.value }))}>
                {REPORTED_BY_OPTIONS.map((o) => <option key={o} value={o}>{o}</option>)}
              </select>
            </Field>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <Field label="Pain — 0 to 10 (VAS)">
              <input type="number" min={0} max={10} step={0.5} style={inputStyle} value={form.pain} onChange={(e) => setForm((f) => ({ ...f, pain: e.target.value }))} placeholder="e.g. 6" />
            </Field>
            <Field label="Patient Global Assessment — 0 to 10 (VAS)">
              <input type="number" min={0} max={10} step={0.5} style={inputStyle} value={form.patient_global_assessment} onChange={(e) => setForm((f) => ({ ...f, patient_global_assessment: e.target.value }))} placeholder="e.g. 5" />
            </Field>
            <Field label="Fatigue — 0 to 10 (VAS)">
              <input type="number" min={0} max={10} step={0.5} style={inputStyle} value={form.fatigue} onChange={(e) => setForm((f) => ({ ...f, fatigue: e.target.value }))} placeholder="e.g. 4" />
            </Field>
            <Field label="Function Difficulty — 0 to 10 (VAS)">
              <input type="number" min={0} max={10} step={0.5} style={inputStyle} value={form.function_difficulty} onChange={(e) => setForm((f) => ({ ...f, function_difficulty: e.target.value }))} placeholder="e.g. 3" />
            </Field>
            <Field label="Morning Stiffness (minutes)">
              <input type="number" min={0} style={inputStyle} value={form.morning_stiffness_minutes} onChange={(e) => setForm((f) => ({ ...f, morning_stiffness_minutes: e.target.value }))} placeholder="e.g. 45" />
            </Field>
            <Field label="Swollen Joint Count (patient-reported estimate)">
              <input type="number" min={0} style={inputStyle} value={form.swollen_joint_count} onChange={(e) => setForm((f) => ({ ...f, swollen_joint_count: e.target.value }))} placeholder="e.g. 2" />
            </Field>
          </div>

          <Field label="Medication Adherence">
            <select style={inputStyle} value={form.medication_adherence} onChange={(e) => setForm((f) => ({ ...f, medication_adherence: e.target.value }))}>
              {ADHERENCE_OPTIONS.map((o) => <option key={o} value={o}>{o}</option>)}
            </select>
          </Field>

          <div style={{ padding: "12px", border: `1px solid ${C.fog}`, borderRadius: "2px", background: C.ghost }}>
            <label style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer" }}>
              <input type="checkbox" checked={form.adverse_effects_reported} onChange={(e) => setForm((f) => ({ ...f, adverse_effects_reported: e.target.checked }))} />
              <span style={{ ...os({ fontSize: 12.5, color: C.ink }) }}>Adverse effect reported</span>
            </label>
            {form.adverse_effects_reported && (
              <div style={{ marginTop: 10, display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                <Field label="Severity">
                  <select style={inputStyle} value={form.adverse_effects_severity} onChange={(e) => setForm((f) => ({ ...f, adverse_effects_severity: e.target.value }))}>
                    <option value="">Select severity...</option>
                    {SEVERITY_OPTIONS.map((o) => <option key={o} value={o}>{o}</option>)}
                  </select>
                </Field>
                <Field label="Description">
                  <input style={inputStyle} value={form.adverse_effects_description} onChange={(e) => setForm((f) => ({ ...f, adverse_effects_description: e.target.value }))} placeholder="e.g. nausea after MTX dose" />
                </Field>
              </div>
            )}
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <div style={{ padding: "12px", border: `1px solid ${C.fog}`, borderRadius: "2px", background: C.ghost }}>
              <FieldLabel>Hospitalization Since Last Check-in</FieldLabel>
              <select style={inputStyle} value={form.hospitalization_since_last_checkin} onChange={(e) => setForm((f) => ({ ...f, hospitalization_since_last_checkin: e.target.value }))}>
                <option value="No">No</option>
                <option value="Yes">Yes</option>
              </select>
              {form.hospitalization_since_last_checkin === "Yes" && (
                <input style={{ ...inputStyle, marginTop: 8 }} value={form.hospitalization_reason} onChange={(e) => setForm((f) => ({ ...f, hospitalization_reason: e.target.value }))} placeholder="Reason (optional)" />
              )}
            </div>
            <div style={{ padding: "12px", border: `1px solid ${C.fog}`, borderRadius: "2px", background: C.ghost }}>
              <FieldLabel>Infection Since Last Check-in</FieldLabel>
              <select style={inputStyle} value={form.infection_since_last_checkin} onChange={(e) => setForm((f) => ({ ...f, infection_since_last_checkin: e.target.value }))}>
                <option value="No">No</option>
                <option value="Yes">Yes</option>
              </select>
            </div>
          </div>

          <Field label="Notes (optional)">
            <textarea
              style={{ ...inputStyle, minHeight: 60, resize: "vertical" }}
              value={form.notes}
              onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
              placeholder="Any other context from the check-in..."
            />
          </Field>

          {formError && <div style={{ ...os({ fontSize: 12, color: "#b3261e" }) }}>{formError}</div>}

          <div style={{ display: "flex", justifyContent: "flex-end" }}>
            <ActionBtn onClick={handleAddCheckin} disabled={formSaving}>
              {formSaving ? "Logging..." : "Log Check-in & Assess"}
            </ActionBtn>
          </div>
        </div>
      </div>

      {/* ── Assessment result ── */}
      {(assessingId || assessment || assessError) && (
        <div style={{ ...card }}>
          <SectionHeader sub="Every flag below is decided by fixed rules — the AI summary only describes them">Check-in Assessment</SectionHeader>
          <div style={{ padding: "16px 20px" }}>
            {assessingId && !assessment && (
              <div style={{ display: "flex", alignItems: "center", gap: 8, ...os({ fontSize: 12, color: C.ash }) }}>
                <span style={{ display: "inline-block", animation: "spin 1s linear infinite", width: 12, height: 12, border: `2px solid ${C.mist}`, borderTopColor: C.charcoal, borderRadius: "50%" }} />
                Assessing check-in...
              </div>
            )}
            {assessError && <div style={{ ...os({ fontSize: 12, color: "#b3261e" }) }}>{assessError}</div>}
            {assessment && (
              <>
                <div style={{
                  display: "flex", alignItems: "center", gap: 10, marginBottom: 14,
                  padding: "10px 14px", borderRadius: "2px",
                  background: STATUS_BG[assessment.overall_status], border: `1px solid ${STATUS_BORDER[assessment.overall_status]}`,
                }}>
                  <span style={{ fontSize: 18 }}>{STATUS_DOT[assessment.overall_status]}</span>
                  <span style={{ ...os({ fontSize: 13, color: STATUS_COLOR[assessment.overall_status], fontWeight: 400 }) }}>
                    Overall: {assessment.overall_status.toUpperCase()}
                  </span>
                  {assessment.rapid3_style && (
                    <span style={{ ...os({ fontSize: 11.5, color: C.ash, marginLeft: "auto" }) }}>
                      RAPID3-style: {assessment.rapid3_style.sum} — {assessment.rapid3_style.band}
                    </span>
                  )}
                </div>

                {assessment.domains.map((d) => <DomainFlagRow key={d.domain} domain={d} />)}

                {assessment.narrative && (
                  <div style={{ marginTop: 10, padding: "12px 14px", borderRadius: "2px", background: C.ghost, border: `1px solid ${C.fog}` }}>
                    <FieldLabel>AI Summary</FieldLabel>
                    <div style={{ ...os({ fontSize: 12.5, color: C.charcoal, lineHeight: 1.6 }) }}>{assessment.narrative}</div>
                  </div>
                )}

                <div style={{ display: "flex", alignItems: "center", justifyContent: "flex-end", gap: 10, marginTop: 14 }}>
                  {saveMsg && <span style={{ ...os({ fontSize: 12, color: saveMsg.includes("✅") ? "#166534" : "#991b1b" }) }}>{saveMsg}</span>}
                  <ActionBtn onClick={handleSaveAssessment} disabled={saving}>{saving ? "Saving..." : "Save Assessment"}</ActionBtn>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {/* ── Recent check-ins (re-assess) ── */}
      {checkins.length > 0 && (
        <div style={{ ...card }}>
          <SectionHeader sub="Click any logged check-in to re-run its assessment">Logged Check-ins</SectionHeader>
          <div style={{ padding: "12px 20px", display: "flex", flexDirection: "column", gap: 6 }}>
            {checkins.map((c) => (
              <div key={c._id} style={{
                display: "flex", alignItems: "center", justifyContent: "space-between",
                padding: "8px 12px", border: `1px solid ${C.fog}`, borderRadius: "2px",
              }}>
                <span style={{ ...os({ fontSize: 12, color: C.ink }) }}>
                  {formatDate(c.report_date)} · {c.reported_by} · Pain {c.pain}/10 · Fatigue {c.fatigue}/10
                </span>
                <GhostBtn onClick={() => handleAssess(c._id)} disabled={assessingId === c._id} style={{ padding: "5px 10px" }}>
                  {assessingId === c._id ? "Assessing..." : "Assess"}
                </GhostBtn>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── History of saved assessments ── */}
      <div style={{ ...card }}>
        <SectionHeader sub="Previously saved, doctor-reviewed monitoring assessments">Monitoring History</SectionHeader>
        <div style={{ padding: "16px 20px" }}>
          {historyLoading && (
            <div style={{ ...os({ fontSize: 12, color: C.ash }) }}>Loading...</div>
          )}
          {!historyLoading && history.length === 0 && (
            <div style={{ ...os({ fontSize: 12.5, color: C.silver }) }}>No saved monitoring assessments yet.</div>
          )}
          {!historyLoading && history.map((rec, idx) => (
            <div key={rec._id || idx} style={{ border: `1px solid ${C.fog}`, borderRadius: "2px", marginBottom: 8, overflow: "hidden" }}>
              <div style={{
                display: "flex", alignItems: "center", justifyContent: "space-between",
                padding: "8px 12px", background: C.ghost, borderBottom: `1px solid ${C.fog}`,
              }}>
                <span style={{ ...os({ fontSize: 11.5, color: C.ash }) }}>{formatDateTime(rec.created_at)}</span>
                <span style={{ ...os({ fontSize: 11.5, color: STATUS_COLOR[rec.overall_status] }) }}>
                  {STATUS_DOT[rec.overall_status]} {rec.overall_status?.toUpperCase()}
                </span>
              </div>
              {rec.narrative && (
                <div style={{ padding: "10px 12px", ...os({ fontSize: 12, color: C.charcoal, lineHeight: 1.6 }) }}>
                  {rec.narrative}
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};

export default RheumatologyPatientMonitoringForm;