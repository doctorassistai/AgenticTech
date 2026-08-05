import React, { useEffect, useRef, useState } from "react";
import ChemotherapyWorkflow from "./ChemotherapyWorkflow";
import SurgicalOncologyWorkflow from "./surgical-oncology/SurgicalOncologyWorkflow";
import RadiationTherapyWorkflow from "./RadiationTherapyWorkflow";
import NerveBlockForm from "./NerveBlockForm";

// TEMP — meeting demo only. Remove this line (and the initialData prop below) afterward.
const API_BASE_URL = import.meta.env.VITE_BACKEND_URL || "https://doctorassist.ai/api/";

// ─── Design Tokens (from DoctorDashboard) ────────────────────────────────────
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

/* ─── URL constants ──────────────────────────────────────────────────────── */
const TRANSCRIBE_URL = `${API_BASE_URL}hms/users/ai/elevenlabs/api/transcribe_labs`;
const SAVE_PROCEDURE_URL = `${API_BASE_URL}hms/users/orchestration/save-procedure-notes`;

/* ─── Oncology specialties ───────────────────────────────────────────────── */
const oncologySpecialties = [
  "Medical Oncology", "Chemotherapy", "Immunotherapy", "Targeted therapy", "Hormone therapy",
  "Precision oncology", "Radiation Oncology", "External beam radiotherapy", "Brachytherapy",
  "Stereotactic radiosurgery", "Surgical Oncology", "Curative surgery", "Cytoreductive surgery",
  "Reconstructive surgery", "Breast Oncology", "Thoracic Oncology", "Gastrointestinal Oncology",
  "Gynecologic Oncology", "Urologic Oncology", "Head and Neck Oncology", "Neuro-oncology",
  "Pediatric Oncology", "Hematologic Oncology", "Imaging Oncology", "Pathology", "Histopathology",
  "Cytology", "Molecular pathology", "Molecular Oncology", "Biomarker Analysis", "Nuclear Medicine",
  "Interventional Oncology", "Ablation therapies", "Embolization", "Research Oncology",
  "Palliative Oncology", "Pain Management", "Rehabilitation Oncology", "Nutritional Oncology",
  "Psycho-oncology", "Preventive Oncology", "Cancer Screening Programs", "Genetic Counseling",
];
const fixedProcedures = [
  { name: "Chemotherapy" },
  { name: "Surgery" },
  { name: "Radiation Therapy" },
    { name: "Nerve Block" },   // ← add this

];
/* ─── Auto-resize hook ───────────────────────────────────────────────────── */
const useAutoResize = (value) => {
  const ref = useRef(null);
  useEffect(() => {
    if (ref.current) {
      ref.current.style.height = "0px";
      ref.current.style.height = ref.current.scrollHeight + "px";
    }
  }, [value]);
  return ref;
};

/* ─── Flatten structured sections ───────────────────────────────────────── */
const flattenSection = (section) => {
  if (!section || typeof section !== "object") return "";
  let text = "";
  Object.entries(section).forEach(([heading, items]) => {
    if (Array.isArray(items) && items.length > 0) {
      text += `${heading.replaceAll("_", " ").toUpperCase()}:\n`;
      items.forEach((item) => { text += `• ${item}\n`; });
      text += "\n";
    }
  });
  return text.trim();
};

/* ═══════════════════════════════════════════════════════════════════════════
   CHEMO ENGINE DISPLAY
═══════════════════════════════════════════════════════════════════════════ */
const ChemoEngineDisplay = ({ data }) => {
  if (!data) return null;

  const ChemoSection = ({ title, children }) => (
    <div style={{
      marginBottom: "12px",
      paddingLeft: "12px",
      borderLeft: `2px solid ${C.mist}`,
    }}>
      <div style={{ ...os({ fontSize: 11, color: C.smoke, textTransform: "uppercase", letterSpacing: "0.07em", marginBottom: 6 }) }}>
        {title}
      </div>
      {children}
    </div>
  );

  const KV = ({ label, value }) => (
    <div style={{ display: "flex", gap: 8, marginBottom: 4 }}>
      <span style={{ ...os({ fontSize: 12, color: C.ash }), minWidth: 120 }}>{label}</span>
      <span style={{ ...os({ fontSize: 12, color: C.ink, fontWeight: 400 }) }}>{value}</span>
    </div>
  );

  const StatusBadge = ({ passed, label }) => (
    <span style={{
      display: "inline-block", padding: "2px 10px", borderRadius: "2px",
      background: passed ? "#f0fdf4" : "#fef2f2",
      border: `1px solid ${passed ? "#bbf7d0" : "#fecaca"}`,
      color: passed ? "#166534" : "#991b1b",
      ...os({ fontSize: 11, fontWeight: 400 }),
    }}>
      {passed ? "✓" : "✗"} {label}
    </span>
  );

  return (
    <div style={{ marginTop: 16, border: `1px solid ${C.fog}`, borderRadius: "4px", overflow: "hidden" }}>
      <div style={{
        padding: "10px 14px", background: C.ghost, borderBottom: `1px solid ${C.fog}`,
        display: "flex", alignItems: "center", gap: 8,
      }}>
        <span style={{ ...os({ fontSize: 11, color: C.smoke, textTransform: "uppercase", letterSpacing: "0.08em", fontWeight: 400 }) }}>
          Chemotherapy Validation Engine
        </span>
      </div>
      <div style={{ padding: "14px 16px", background: C.white }}>

        {data.pre_chemo_validation && (
          <ChemoSection title="Pre-Chemotherapy Validation">
            {data.pre_chemo_validation.baseline_data?.inputs_extracted && (
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "4px 16px", marginBottom: 8 }}>
                {Object.entries(data.pre_chemo_validation.baseline_data.inputs_extracted).map(([k, v]) => (
                  <KV key={k} label={k.replace(/_/g, " ")} value={v} />
                ))}
              </div>
            )}
            {data.pre_chemo_validation.bsa_calculation && (
              <div style={{ display: "flex", gap: 20 }}>
                <KV label="BSA" value={`${data.pre_chemo_validation.bsa_calculation.bsa_m2} m²`} />
                <KV label="BMI" value={data.pre_chemo_validation.bsa_calculation.bmi} />
              </div>
            )}
          </ChemoSection>
        )}

        {data.regimen_protocol_mapping && (
          <ChemoSection title="Regimen Selection">
            <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
              <StatusBadge passed={data.regimen_protocol_mapping.gate_passed} label="Safety Gate" />
              <span style={{ ...os({ fontSize: 12, color: C.ash }) }}>
                {data.regimen_protocol_mapping.guideline_framework}
              </span>
            </div>
          </ChemoSection>
        )}

        {data.realtime_monitoring && (
          <ChemoSection title="Real-Time Monitoring">
            <KV label="Febrile Neutropenia Risk"
              value={(data.realtime_monitoring.febrile_neutropenia_risk || "").toUpperCase()} />
            <KV label="Cycle Delay"
              value={data.realtime_monitoring.next_cycle_delay_suggested ? "Suggested" : "Not suggested"} />
          </ChemoSection>
        )}

        {data.longitudinal_tracking && (
          <ChemoSection title="Longitudinal Tracking">
            <KV label="Current Cycle" value={data.longitudinal_tracking.current_cycle} />
            <KV label="Completed Cycles" value={data.longitudinal_tracking.completed_cycles} />
          </ChemoSection>
        )}

        {data.audit_compliance && (
          <ChemoSection title="Safety & Compliance">
            <StatusBadge
              passed={data.audit_compliance.validation_decision === "proceed"}
              label={`Decision: ${(data.audit_compliance.validation_decision || "").toUpperCase()}`}
            />
            <div style={{ ...os({ fontSize: 11, color: C.silver, marginTop: 6 }) }}>
              {new Date(data.audit_compliance.timestamp).toLocaleString()}
            </div>
          </ChemoSection>
        )}
      </div>
    </div>
  );
};

/* ═══════════════════════════════════════════════════════════════════════════
   SECTION HEADER — mirrors DoctorDashboard SectionHeader
═══════════════════════════════════════════════════════════════════════════ */
const SectionHeader = ({ children, sub }) => (
  <div style={{
    padding: "16px 20px", borderBottom: `1px solid ${C.fog}`,
    background: C.white,
  }}>
    <div style={{ ...os({ fontSize: 14, color: C.ink, letterSpacing: "0.02em" }) }}>{children}</div>
    {sub && <div style={{ ...os({ fontSize: 11, color: C.ash, marginTop: 3 }) }}>{sub}</div>}
  </div>
);

/* ─── Inline label ───────────────────────────────────────────────────────── */
const FieldLabel = ({ children }) => (
  <div style={{ ...os({ fontSize: 10, color: C.silver, textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 6 }) }}>
    {children}
  </div>
);

/* ─── Ghost button ───────────────────────────────────────────────────────── */
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
    onMouseEnter={(e) => { if (!disabled) { e.currentTarget.style.borderColor = C.smoke; e.currentTarget.style.background = C.ghost; } }}
    onMouseLeave={(e) => { if (!disabled) { e.currentTarget.style.borderColor = C.mist; e.currentTarget.style.background = "transparent"; } }}
  >
    {children}
  </button>
);

/* ─── Solid action button ────────────────────────────────────────────────── */
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

/* ─── Pill badge ─────────────────────────────────────────────────────────── */
const Pill = ({ text, color = C.smoke }) => (
  <span style={{
    display: "inline-block", padding: "2px 8px", borderRadius: "2px",
    background: `${color}10`, color, border: `1px solid ${color}25`,
    ...os({ fontSize: 11, fontWeight: 400 }),
    marginRight: 4, marginBottom: 4,
  }}>{text}</span>
);

/* ─── Textarea ───────────────────────────────────────────────────────────── */
const StyledTextarea = ({ refObj, value, onChange, placeholder, minHeight = 120 }) => (
  <textarea
    ref={refObj}
    value={value}
    onChange={onChange}
    placeholder={placeholder}
    style={{
      width: "100%", minHeight, padding: "10px 14px",
      border: `1px solid ${C.mist}`, borderRadius: "2px",
      background: C.white, resize: "none", overflow: "hidden",
      ...os({ fontSize: 13, color: C.ink, lineHeight: 1.65 }),
      outline: "none", transition: "border-color 0.15s",
      boxSizing: "border-box",
    }}
    onFocus={(e) => { e.target.style.borderColor = C.charcoal; }}
    onBlur={(e) => { e.target.style.borderColor = C.mist; }}
  />
);

/* ═══════════════════════════════════════════════════════════════════════════
   TREATMENT DISPLAY — clean card-based layout
═══════════════════════════════════════════════════════════════════════════ */
const TreatmentDisplay = ({ data, chemoEngineData, selectedProcedure }) => {
  if (!data && !chemoEngineData) return (
    <div style={{ padding: "40px 20px", textAlign: "center", ...os({ fontSize: 13, color: C.ash }) }}>
      No treatment data generated yet.
    </div>
  );
  const isChemotherapy = selectedProcedure?.toLowerCase() === "chemotherapy" ||
    selectedProcedure?.toLowerCase().includes("chemo");
  const Block = ({ title, children }) => (
    <div style={{ border: `1px solid ${C.fog}`, borderRadius: "4px", overflow: "hidden", marginBottom: 12 }}>
      <div style={{
        padding: "9px 14px", background: C.ghost, borderBottom: `1px solid ${C.fog}`,
        ...os({ fontSize: 11, color: C.smoke, textTransform: "uppercase", letterSpacing: "0.07em", fontWeight: 400 }),
      }}>{title}</div>
      <div style={{ padding: "14px", background: C.white }}>{children}</div>
    </div>
  );

  const Row = ({ label, value }) => value ? (
    <div style={{ display: "flex", gap: 8, marginBottom: 6 }}>
      <span style={{ ...os({ fontSize: 11, color: C.ash, textTransform: "uppercase", letterSpacing: "0.05em" }), minWidth: 120, paddingTop: 1 }}>{label}</span>
      <span style={{ ...os({ fontSize: 13, color: C.ink }), flex: 1 }}>{Array.isArray(value) ? value.join(", ") : value}</span>
    </div>
  ) : null;

  const BulletList = ({ items, color = C.smoke }) => (
    <div>
      {(items || []).map((item, i) => (
        <div key={i} style={{ display: "flex", gap: 8, marginBottom: 5, alignItems: "flex-start" }}>
          <span style={{ color, fontSize: 14, lineHeight: 1.5, flexShrink: 0 }}>›</span>
          <span style={{ ...os({ fontSize: 13, color: C.charcoal, lineHeight: 1.6 }) }}>{item}</span>
        </div>
      ))}
    </div>
  );

  return (
    <div>
      {/* Procedure Steps */}
      {data?.procedure_steps?.steps?.length > 0 && (
        <Block title={data.procedure_steps.title || "Treatment Procedure Steps"}>
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {data.procedure_steps.steps.map((step, i) => (
              <div key={i} style={{
                display: "flex", gap: 12, alignItems: "flex-start",
                padding: "8px 12px", borderRadius: "2px",
                background: i % 2 === 0 ? C.ghost : C.white,
                border: `1px solid ${C.fog}`,
              }}>
                <div style={{
                  minWidth: 24, height: 24, borderRadius: "2px",
                  background: C.black, color: C.white,
                  display: "flex", alignItems: "center", justifyContent: "center",
                  ...os({ fontSize: 11, fontWeight: 400 }), flexShrink: 0,
                }}>{i + 1}</div>
                <span style={{ ...os({ fontSize: 13, color: C.ink, lineHeight: 1.65, paddingTop: 2 }) }}>
                  {step.replace(/^Step \d+:\s*/i, "")}
                </span>
              </div>
            ))}
          </div>
        </Block>
      )}

      {/* Medication Details */}
      {data?.medication_details?.medications?.length > 0 && (
        <Block title={data.medication_details.title || "Medication Details"}>
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {data.medication_details.medications.map((med, i) => (
              <div key={i} style={{ border: `1px solid ${C.fog}`, borderRadius: "2px", overflow: "hidden" }}>
                <div style={{
                  padding: "7px 12px", background: C.ghost, borderBottom: `1px solid ${C.fog}`,
                  display: "flex", alignItems: "center", gap: 8,
                }}>
                  <div style={{ width: 6, height: 6, borderRadius: "50%", background: C.charcoal }} />
                  <span style={{ ...os({ fontSize: 13, color: C.ink, fontWeight: 400 }) }}>{med.name}</span>
                </div>
                <div style={{ padding: "10px 12px", display: "grid", gridTemplateColumns: "1fr 1fr", gap: "6px 16px" }}>
                  {[["Dose", med.dose], ["Calculation", med.calculation], ["Route", med.route],
                  ["Infusion Time", med.infusion_time], ["Dilution", med.dilution], ["Compatibility", med.compatibility]]
                    .filter(([, v]) => v)
                    .map(([label, val], j) => (
                      <div key={j}>
                        <div style={{ ...os({ fontSize: 10, color: C.ash, textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 1 }) }}>{label}</div>
                        <div style={{ ...os({ fontSize: 13, color: C.ink }) }}>{val}</div>
                      </div>
                    ))}
                  {med.warnings?.length > 0 && (
                    <div style={{ gridColumn: "1/-1", marginTop: 4 }}>
                      <div style={{ ...os({ fontSize: 10, color: C.ash, textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 4 }) }}>Warnings</div>
                      {med.warnings.map((w, k) => <Pill key={k} text={w} color="#dc2626" />)}
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        </Block>
      )}

      {/* Safety Validation */}
      {data?.safety_validation && (
        <Block title={data.safety_validation.title || "Pre-Treatment Validation"}>
          {data.safety_validation.bsa_or_weight && (
            <div style={{
              display: "inline-block", padding: "5px 12px", borderRadius: "2px",
              background: C.ghost, border: `1px solid ${C.fog}`,
              ...os({ fontSize: 12, fontWeight: 400, color: C.ink, marginBottom: 10 }),
            }}>
              BSA / Weight: {Array.isArray(data.safety_validation.bsa_or_weight)
                ? data.safety_validation.bsa_or_weight.join(", ")
                : data.safety_validation.bsa_or_weight}
            </div>
          )}
          {data.safety_validation.clinical_flags?.length > 0 && (
            <div style={{ marginBottom: 8 }}>
              <FieldLabel>Clinical Flags</FieldLabel>
              <BulletList items={data.safety_validation.clinical_flags} color="#dc2626" />
            </div>
          )}
          {data.safety_validation.recommendations?.length > 0 && (
            <div>
              <FieldLabel>Recommendations</FieldLabel>
              <BulletList items={data.safety_validation.recommendations} color={C.charcoal} />
            </div>
          )}
        </Block>
      )}

      {/* Drug Interactions */}
      {data?.drug_interactions && (
        <Block title={data.drug_interactions.title || "Drug Interactions & Contraindications"}>
          {[
            { label: "High Risk", key: "high_risk", color: "#dc2626" },
            { label: "Moderate Risk", key: "moderate_risk", color: "#d97706" },
            { label: "Low Risk", key: "low_risk", color: "#059669" },
          ].map(({ label, key, color }) =>
            data.drug_interactions[key]?.length > 0 && data.drug_interactions[key][0] !== "" ? (
              <div key={key} style={{ marginBottom: 10 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 4 }}>
                  <div style={{ width: 8, height: 8, borderRadius: "50%", background: color }} />
                  <span style={{ ...os({ fontSize: 10, color, textTransform: "uppercase", letterSpacing: "0.06em", fontWeight: 400 }) }}>{label}</span>
                </div>
                <BulletList items={data.drug_interactions[key]} color={color} />
              </div>
            ) : null
          )}
        </Block>
      )}

      {/* Preparation & Infusion */}
      {data?.preparation_validation && (
        <Block title={data.preparation_validation.title || "Preparation & Infusion Validation"}>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 10 }}>
            {[["Stability", data.preparation_validation.stability],
            ["Infusion Rate", data.preparation_validation.infusion_rate],
            ["Line Compatibility", data.preparation_validation.line_compatibility]]
              .filter(([, v]) => v)
              .map(([label, val], i) => (
                <div key={i} style={{ padding: "8px 10px", borderRadius: "2px", background: C.ghost, border: `1px solid ${C.fog}` }}>
                  <div style={{ ...os({ fontSize: 10, color: C.ash, textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 2 }) }}>{label}</div>
                  <div style={{ ...os({ fontSize: 13, color: C.ink }) }}>{val}</div>
                </div>
              ))}
          </div>
          {data.preparation_validation.dilution_instructions?.length > 0 && (
            <>
              <FieldLabel>Dilution Instructions</FieldLabel>
              <BulletList items={data.preparation_validation.dilution_instructions} />
            </>
          )}
        </Block>
      )}

      {/* Monitoring Checklist */}
      {data?.monitoring_checklist && (
        <Block title={data.monitoring_checklist.title || "During Treatment Monitoring"}>
          {data.monitoring_checklist.checks?.length > 0 && (
            <div style={{ marginBottom: 10 }}>
              <FieldLabel>Monitoring Checks</FieldLabel>
              {data.monitoring_checklist.checks.map((c, i) => (
                <div key={i} style={{
                  display: "flex", alignItems: "flex-start", gap: 8,
                  padding: "6px 0", borderBottom: `1px solid ${C.fog}`,
                }}>
                  <div style={{ width: 6, height: 6, borderRadius: "50%", background: C.charcoal, marginTop: 6, flexShrink: 0 }} />
                  <span style={{ ...os({ fontSize: 13, color: C.charcoal, lineHeight: 1.6 }) }}>{c}</span>
                </div>
              ))}
            </div>
          )}
          {data.monitoring_checklist.emergency_preparedness?.length > 0 && (
            <>
              <FieldLabel>Emergency Preparedness</FieldLabel>
              <BulletList items={data.monitoring_checklist.emergency_preparedness} color="#dc2626" />
            </>
          )}
        </Block>
      )}

      {/* Post-Procedure Toxicity */}
      {data?.post_procedure_toxicity && (
        <Block title={data.post_procedure_toxicity.title || "Post-Procedure Toxicity & Follow-Up"}>
          {data.post_procedure_toxicity.observed_values && (
            <div style={{
              padding: "8px 12px", borderRadius: "2px",
              background: C.ghost, border: `1px solid ${C.fog}`,
              ...os({ fontSize: 13, color: C.ink, marginBottom: 10 }),
            }}>
              <span style={{ fontWeight: 400 }}>Observed values: </span>
              {Array.isArray(data.post_procedure_toxicity.observed_values)
                ? data.post_procedure_toxicity.observed_values.join(" · ")
                : data.post_procedure_toxicity.observed_values}
            </div>
          )}
          {data.post_procedure_toxicity.risk_assessment && (
            <Row label="Risk Assessment" value={data.post_procedure_toxicity.risk_assessment} />
          )}
          {data.post_procedure_toxicity.decision?.length > 0 && (
            <>
              <FieldLabel>Clinical Decision</FieldLabel>
              <BulletList items={data.post_procedure_toxicity.decision} />
            </>
          )}
          {data.post_procedure_toxicity.dose_adjustment && (
            <Row label="Dose Adjustment" value={data.post_procedure_toxicity.dose_adjustment} />
          )}
        </Block>
      )}

      {/* Follow-Up Plan */}
      {(data?.followup_plan || chemoEngineData) && (
        <Block title={data?.followup_plan?.title || "Follow-Up & Lab Scheduling"}>
          {data?.followup_plan?.next_labs?.length > 0 && (
            <div style={{ marginBottom: 10 }}>
              <FieldLabel>Next Labs</FieldLabel>
              <div style={{ display: "flex", flexWrap: "wrap" }}>
                {data.followup_plan.next_labs.map((lab, i) => <Pill key={i} text={lab} color={C.charcoal} />)}
              </div>
            </div>
          )}
          {data?.followup_plan?.alerts?.length > 0 && (
            <div style={{ marginBottom: 10 }}>
              <FieldLabel>Alerts</FieldLabel>
              <BulletList items={data.followup_plan.alerts} color={C.smoke} />
            </div>
          )}
          {data?.followup_plan?.patient_notification && (
            <Row label="Patient Notification"
              value={Array.isArray(data.followup_plan.patient_notification)
                ? data.followup_plan.patient_notification.join(", ")
                : data.followup_plan.patient_notification} />
          )}
          {/* 🔥 ONLY show Chemo Engine when selected procedure is Chemotherapy */}
          {isChemotherapy && chemoEngineData && (
            <ChemoEngineDisplay data={chemoEngineData} />
          )}
        </Block>
      )}
    </div>
  );
};

/* ═══════════════════════════════════════════════════════════════════════════
   MAIN COMPONENT
═══════════════════════════════════════════════════════════════════════════ */
const ProcedureNotes = ({ doctorId, patientId, doctorSpeciality, patientName }) => {  /* ─── State ──────────────────────────────────────────────────────────── */
  const [mode, setMode] = useState("order");
  const [procedureOptions, setProcedureOptions] = useState([]);
  const [selectedProcedure, setSelectedProcedure] = useState("");
  const [customProcedure, setCustomProcedure] = useState("");
  const [confirmedCustomProcedure, setConfirmedCustomProcedure] = useState("");
  const [patientAbstract, setPatientAbstract] = useState("");
  const [preProcedure, setPreProcedure] = useState("");
  const [duringProcedure, setDuringProcedure] = useState("");
  const [postProcedure, setPostProcedure] = useState("");

  /* Patient Details Tabs */
  const [activeTab, setActiveTab] = useState("summary");
  const [alertsRaw, setAlertsRaw] = useState(null);
  const [treatmentRaw, setTreatmentRaw] = useState(null);
  const [patientSummary, setPatientSummary] = useState("");
  const [treatmentProcedureTab, setTreatmentProcedureTab] = useState("");
  const [tumorBoard, setTumorBoard] = useState("");
  const [alerts, setAlerts] = useState(null);
  const [alertsLoading, setAlertsLoading] = useState(false);
  const [chemoEngineData, setChemoEngineData] = useState(null);
  const [hospitalId, setHospitalId] = useState("");
  const [doctorSpecialty, setDoctorSpecialty] = useState("");
  const [loading, setLoading] = useState(false);
  const [treatmentLoading, setTreatmentLoading] = useState(false);
  const [treatmentGenerated, setTreatmentGenerated] = useState(false);

  /* Audio */
  const mediaRecorder = useRef(null);
  const audioChunks = useRef([]);
  const [recordingField, setRecordingField] = useState(null);
  const [recording, setRecording] = useState(false);
  const [processing, setProcessing] = useState(false);

  /* Auto-resize */
  const abstractRef = useAutoResize(patientAbstract);
  const preRef = useAutoResize(preProcedure);
  const duringRef = useAutoResize(duringProcedure);
  const postRef = useAutoResize(postProcedure);
  const summaryRef = useAutoResize(patientSummary);
  const treatmentRef = useAutoResize(treatmentProcedureTab);
  const tumorRef = useAutoResize(tumorBoard);
  const alertsRef = useAutoResize(alerts);
  const allProcedures = [
    ...fixedProcedures,
    ...procedureOptions.filter(
      (p) =>
        !fixedProcedures.some(
          (f) => f.name.toLowerCase() === p.name.toLowerCase()
        )
    ),
  ];
  /* ─── Derived ─────────────────────────────────────────────────────────── */
  const normalizedSpecialty = (doctorSpecialty || "").toLowerCase().trim();
  const isOncologyDoctor = oncologySpecialties.some((s) => normalizedSpecialty.includes(s.toLowerCase()));

  const tabConfig = [
    { key: "summary", label: "Patient Summary" },
    { key: "treatment", label: "Treatment Procedure" },
    ...(isOncologyDoctor ? [{ key: "tumor", label: "Tumor Board" }] : []),
    { key: "alerts", label: "Alerts & Important" },
  ];

  const activeProcedure = selectedProcedure === "__other__" ? confirmedCustomProcedure : selectedProcedure;

  /* ─── Data fetchers ───────────────────────────────────────────────────── */
  const fetchProcedures = async () => {
    try {
      setLoading(true);
      const res = await fetch(`${API_BASE_URL}hms/users/ai-legacy/clinical-procedure-workflow`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ doctor_id: doctorId, patient_id: patientId, selected_procedure: null, mode: "order" }),
      });
      const data = await res.json();
      const output = data.finaloutput;
      setProcedureOptions(output?.suggested_procedures || []);
      setPatientAbstract(output?.patient_abstract || "");
    } catch (err) { console.error(err); }
    finally { setLoading(false); }
  };

  const fetchProcedureWorkflow = async (procedureName, activeMode) => {
    try {
      setLoading(true);
      setPreProcedure(""); setDuringProcedure(""); setPostProcedure("");
      const res = await fetch(`${API_BASE_URL}hms/users/ai-legacy/clinical-procedure-workflow`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ doctor_id: doctorId, patient_id: patientId, selected_procedure: procedureName, mode: activeMode }),
      });
      const data = await res.json();
      const output = data.finaloutput;
      setPreProcedure(flattenSection(output?.pre_procedure));
      setDuringProcedure(flattenSection(output?.during_procedure));
      setPostProcedure(flattenSection(output?.post_procedure));
    } catch (err) { console.error(err); }
    finally { setLoading(false); }
  };

  const fetchTreatmentProcedureAgent = async () => {
    try {
      if (!activeProcedure) { alert("Select procedure first"); return; }
      setTreatmentLoading(true);
      setTreatmentProcedureTab(""); setAlerts(""); setChemoEngineData(null);
      const res = await fetch(`${API_BASE_URL}hms/users/ai-legacy/clinical-procedure-workflow`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ doctor_id: doctorId, patient_id: patientId, selected_procedure: activeProcedure, mode: "order" }),
      });
      const data = await res.json();
      if (data?.finaloutput?.chemo_engine) setChemoEngineData(data.finaloutput.chemo_engine);
      else if (data?.chemo_engine) setChemoEngineData(data.chemo_engine);

      const treatment = data?.finaloutput?.treatment_procedure || data?.treatment_procedure || null;
      const alertsData = data?.finaloutput?.alerts_and_important;
      setTreatmentRaw(treatment);
      setAlertsRaw(alertsData);

      /* Format alerts */
      if (alertsData) {
        let fmt = "";
        if (alertsData.alerts?.length > 0) {
          fmt += "ALERTS\n" + "─".repeat(50) + "\n\n";
          alertsData.alerts.forEach((a, i) => { fmt += `${i + 1}. ${a.type || "Alert"}\n   ${a.message || ""}\n\n`; });
        } else { fmt += "ALERTS\n" + "─".repeat(50) + "\n\nNo critical alerts identified.\n\n"; }
        if (alertsData.important?.length > 0) {
          fmt += "IMPORTANT FINDINGS\n" + "─".repeat(50) + "\n\n";
          alertsData.important.forEach((item, i) => { fmt += `${i + 1}. ${item.type || "Finding"}\n   ${item.message || ""}\n\n`; });
        } else { fmt += "IMPORTANT FINDINGS\n" + "─".repeat(50) + "\n\nNo important findings.\n"; }
        setAlerts(fmt);
      }
      setTreatmentGenerated(true);
    } catch (err) { console.error(err); }
    finally { setTreatmentLoading(false); }
  };

  const fetchAlertsAgent = async () => {
    try {
      if (!activeProcedure) { alert("Select procedure first"); return; }
      setAlertsLoading(true); setAlerts("");
      const res = await fetch(`${API_BASE_URL}hms/users/ai-legacy/clinical-procedure-workflow`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ doctor_id: doctorId, patient_id: patientId, selected_procedure: activeProcedure, mode: "order" }),
      });
      const data = await res.json();
      const alertsData = data?.finaloutput?.alerts_and_important;
      let fmt = "";
      if (alertsData) {
        if (alertsData.alerts?.length > 0) {
          fmt += "ALERTS\n" + "─".repeat(50) + "\n\n";
          alertsData.alerts.forEach((a, i) => {
            fmt += `${i + 1}. ${a.type || "Alert"}\n   ${a.message || ""}\n`;
            if (a.severity) fmt += `   Severity: ${a.severity.toUpperCase()}\n`;
            if (a.action_required) fmt += `   Action: ${a.action_required}\n`;
            fmt += "\n";
          });
        } else { fmt += "ALERTS\n" + "─".repeat(50) + "\n\nNo critical alerts identified.\n\n"; }
        if (alertsData.important?.length > 0) {
          fmt += "IMPORTANT FINDINGS\n" + "─".repeat(50) + "\n\n";
          alertsData.important.forEach((item, i) => {
            fmt += `${i + 1}. ${item.type || "Finding"}\n   ${item.message || ""}\n`;
            if (item.impact) fmt += `   Impact: ${item.impact.toUpperCase()}\n`;
            if (item.action) fmt += `   Action: ${item.action}\n`;
            fmt += "\n";
          });
        } else { fmt += "IMPORTANT FINDINGS\n" + "─".repeat(50) + "\n\nNo important findings.\n"; }
      } else { fmt = "Unable to generate alerts. Please ensure patient data is available."; }
      setAlerts(fmt);
    } catch (err) { console.error(err); setAlerts("Error loading alerts. Please try again."); }
    finally { setAlertsLoading(false); }
  };

  const fetchDoctorHospital = async () => {
    try {
      const res = await fetch(`${API_BASE_URL}hms/users/doctors/get_doctor/${doctorId}`);
      const json = await res.json();
      if (json.status === "success") {
        setHospitalId(json.doctor.hospital_id);
        setDoctorSpecialty(json.doctor.specialization || "");
      }
    } catch (err) { console.error(err); }
  };

  const fetchTumorBoard = async () => {
    try {
      if (!hospitalId || !patientId) return;
      const res = await fetch(`${API_BASE_URL}hms/users/data/latest_doctor_recommendations/${hospitalId}/${patientId}`);
      const data = await res.json();
      const records = data?.data || [];
      if (!records.length) { setTumorBoard("No tumor board recommendations available."); return; }
      const latest = records.sort((a, b) => new Date(b.created_at) - new Date(a.created_at))[0];
      setTumorBoard(latest?.doctor_recommendation || "No recommendation found");
    } catch (err) { setTumorBoard("Error fetching tumor board data."); }
  };

  /* ─── Effects ─────────────────────────────────────────────────────────── */
  useEffect(() => {
    if (doctorId && patientId) { fetchProcedures(); fetchDoctorHospital(); }
  }, [doctorId, patientId]);

  useEffect(() => {
    if (!patientId) return;

    (async () => {
      try {
        const res = await fetch(`${API_BASE_URL}hms/users/data/context/patient-summary/${patientId}`);
        const data = await res.json();

        console.log("FULL API RESPONSE:", data);

        const paragraphs = data?.data?.summary?.paragraphs || [];

        const timeline = data?.data?.timeline?.timeline || [];

        const summaryText =
          paragraphs.length > 0
            ? paragraphs.join("\n\n")
            : "No patient summary available.";



        setPatientSummary(summaryText);

        console.log("Patient Summary:", summaryText);



      } catch (err) {
        console.error(err);
        setPatientSummary("Unable to load patient summary.");
      }
    })();
  }, [patientId]);

  /* ─── Audio ───────────────────────────────────────────────────────────── */
  const startRecording = async (field) => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      mediaRecorder.current = new MediaRecorder(stream);
      audioChunks.current = [];
      mediaRecorder.current.ondataavailable = (e) => { if (e.data.size > 0) audioChunks.current.push(e.data); };
      mediaRecorder.current.start();
      setRecordingField(field); setRecording(true);
    } catch { alert("Microphone permission is required."); }
  };

  const stopRecording = () => {
    if (!mediaRecorder.current) return;
    mediaRecorder.current.onstop = transcribeAudio;
    mediaRecorder.current.stop();
    mediaRecorder.current.stream.getTracks().forEach((t) => t.stop());
    setRecording(false);
  };

  const transcribeAudio = async () => {
    if (!audioChunks.current.length) return;
    setProcessing(true);
    try {
      const blob = new Blob(audioChunks.current, { type: "audio/webm" });
      audioChunks.current = [];
      const formData = new FormData();
      formData.append("file", blob, "audio.webm");
      const res = await fetch(TRANSCRIBE_URL, { method: "POST", body: formData });
      const data = await res.json();
      const text = data?.text || "";
      if (!text) return;
      const append = (prev) => (prev ? `${prev}\n${text}` : text);
      if (recordingField === "pre") setPreProcedure(append);
      if (recordingField === "during") setDuringProcedure(append);
      if (recordingField === "post") setPostProcedure(append);
    } catch { alert("Transcription failed"); }
    finally { setProcessing(false); setRecordingField(null); }
  };

  /* ─── Save ────────────────────────────────────────────────────────────── */
  const handleSave = async () => {
    try {
      const payload = {
        doctor_id: doctorId,
        patient_id: patientId,
        mode: mode,
        selected_procedure: activeProcedure,
        patient_abstract: patientAbstract,
        pre_procedure: preProcedure,
        during_procedure: duringProcedure,
        post_procedure: postProcedure,
        alerts_and_important: alertsRaw,
        treatment_procedure: treatmentRaw,
        patient_summary: patientSummary,
        tumor_board: tumorBoard,
        chemo_engine_data: chemoEngineData
      };

      console.log("Saving payload:", payload); // Debug log

      const res = await fetch(SAVE_PROCEDURE_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      const data = await res.json();

      if (res.ok) {
        alert("Procedure notes saved successfully ✓");
      } else {
        alert("Failed to save: " + (data.detail || "Unknown error"));
      }
    } catch (error) {
      console.error("Save error:", error);
      alert("Failed to save procedure notes");
    }
  };

  /* ─── Dictation Controls ─────────────────────────────────────────────── */
  const DictationControls = ({ field, label, onClear }) => (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <span style={{ ...os({ fontSize: 11, color: C.smoke, textTransform: "uppercase", letterSpacing: "0.07em", fontWeight: 400 }) }}>
          {label}
        </span>
        {recording && recordingField === field && (
          <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
            <div style={{ width: 6, height: 6, borderRadius: "50%", background: "#dc2626", animation: "pulse 1s infinite" }} />
            <span style={{ ...os({ fontSize: 11, color: "#dc2626" }) }}>Recording</span>
          </div>
        )}
      </div>
      <div style={{ display: "flex", gap: 6 }}>
        <GhostBtn
          onClick={() => recording && recordingField === field ? stopRecording() : startRecording(field)}
          style={{ padding: "5px 10px" }}
        >
          {recording && recordingField === field ? (
            <><span style={{ width: 8, height: 8, background: "#dc2626", borderRadius: "1px", display: "inline-block" }} /> Stop</>
          ) : (
            <><svg width="12" height="12" fill="currentColor" viewBox="0 0 20 20"><path fillRule="evenodd" d="M7 4a3 3 0 016 0v4a3 3 0 11-6 0V4zm4 10.93A7.001 7.001 0 0017 8a1 1 0 10-2 0A5 5 0 015 8a1 1 0 00-2 0 7.001 7.001 0 006 6.93V17H6a1 1 0 100 2h8a1 1 0 100-2h-3v-2.07z" clipRule="evenodd" /></svg> Dictate</>
          )}
        </GhostBtn>
        <GhostBtn onClick={onClear} style={{ padding: "5px 10px" }}>Clear</GhostBtn>
      </div>
    </div>
  );

  /* ─── Render ──────────────────────────────────────────────────────────── */
  return (
    <div style={{ fontFamily: FONT, fontWeight: FW, color: C.ink, display: "flex", flexDirection: "column", gap: 16 }}>
      <link href="https://fonts.googleapis.com/css2?family=Open+Sans:wght@300;400;600&display=swap" rel="stylesheet" />
      <style>{`@keyframes pulse { 0%,100%{opacity:1} 50%{opacity:0.4} } @keyframes spin { from{transform:rotate(0deg)} to{transform:rotate(360deg)} }`}</style>

      {/* ── Procedure Selection ─────────────────────────────────────────── */}
      <div style={{ ...card }}>
        <SectionHeader sub="Select or enter a clinical procedure to generate a workflow">
          Procedure Selection
        </SectionHeader>
        <div style={{ padding: "16px 20px", display: "flex", flexDirection: "column", gap: 12 }}>

          <div>
            <FieldLabel>Suggested Procedures</FieldLabel>
            <select
              value={selectedProcedure}
              onClick={() => { if (procedureOptions.length === 0) fetchProcedures(); }}
              onChange={(e) => { setSelectedProcedure(e.target.value); setCustomProcedure(""); setConfirmedCustomProcedure(""); }}
              style={{
                width: "100%", padding: "9px 12px",
                border: `1px solid ${C.mist}`, borderRadius: "2px",
                background: C.white, ...os({ fontSize: 13, color: C.ink }),
                outline: "none", cursor: "pointer", appearance: "auto",
              }}
              onFocus={(e) => { e.target.style.borderColor = C.charcoal; }}
              onBlur={(e) => { e.target.style.borderColor = C.mist; }}
            >
              <option value="">— Select from suggested procedures —</option>
              {allProcedures.map((p) => (
                <option key={p.name} value={p.name}>
                  {p.name}
                </option>
              ))}
              <option value="__other__">Custom Procedure</option>
            </select>
          </div>

          {selectedProcedure === "__other__" && (
            <div style={{ padding: "14px", border: `1px solid ${C.fog}`, borderRadius: "2px", background: C.ghost }}>
              <FieldLabel>Enter Custom Procedure Name</FieldLabel>
              <div style={{ display: "flex", gap: 8 }}>
                <input
                  type="text"
                  value={customProcedure}
                  onChange={(e) => setCustomProcedure(e.target.value)}
                  placeholder="Type custom procedure name..."
                  style={{
                    flex: 1, padding: "9px 12px",
                    border: `1px solid ${C.mist}`, borderRadius: "2px",
                    background: C.white, ...os({ fontSize: 13, color: C.ink }),
                    outline: "none", transition: "border-color 0.15s",
                  }}
                  onFocus={(e) => { e.target.style.borderColor = C.charcoal; }}
                  onBlur={(e) => { e.target.style.borderColor = C.mist; }}
                />
                <ActionBtn
                  disabled={!customProcedure.trim()}
                  onClick={() => { setConfirmedCustomProcedure(customProcedure.trim()); fetchProcedureWorkflow(customProcedure.trim(), mode); }}
                >
                  Use This Procedure
                </ActionBtn>
              </div>
              <p style={{ ...os({ fontSize: 11, color: C.silver, marginTop: 6 }) }}>
                Enter a custom procedure name to generate a workflow
              </p>
            </div>
          )}

          {activeProcedure && (
            <div style={{
              padding: "10px 12px", borderRadius: "2px",
              background: C.ghost, border: `1px solid ${C.fog}`,
              display: "flex", alignItems: "center", gap: 8,
            }}>
              <div style={{ width: 7, height: 7, borderRadius: "50%", background: C.charcoal, flexShrink: 0 }} />
              <span style={{ ...os({ fontSize: 13, color: C.smoke }) }}>
                Active Procedure:
              </span>
              <span style={{ ...os({ fontSize: 13, color: C.ink, fontWeight: 400 }) }}>
                {activeProcedure}
              </span>
            </div>
          )}
        </div>
      </div>

      {/* ── Patient Details ─────────────────────────────────────────────── */}
      <div style={{ ...card, position: "relative" }}>
        <SectionHeader sub="AI-generated patient context and clinical data">Patient Details</SectionHeader>

        {/* Tabs */}
        <div style={{ display: "flex", borderBottom: `1px solid ${C.fog}`, background: C.white }}>
          {tabConfig.map((tab) => {
            const isActive = activeTab === tab.key;
            const isLocked = tab.key === "alerts" && !treatmentGenerated && !treatmentProcedureTab;
            return (
              <button
                key={tab.key}
                disabled={isLocked}
                onClick={async () => {
                  setActiveTab(tab.key);
                  if (tab.key === "treatment" && !treatmentProcedureTab) await fetchTreatmentProcedureAgent();
                  if (tab.key === "tumor") { if (hospitalId && !tumorBoard) await fetchTumorBoard(); }
                  if (tab.key === "alerts") {
                    if (!treatmentGenerated && !treatmentProcedureTab) {
                      setAlerts("⚠ Please generate the Treatment Procedure first by clicking the Treatment tab.");
                      return;
                    }
                    await fetchAlertsAgent();
                  }
                }}
                style={{
                  flex: 1, padding: "10px 8px",
                  background: isActive ? C.black : "transparent",
                  color: isActive ? C.white : isLocked ? C.silver : C.ash,
                  border: "none", borderBottom: isActive ? `2px solid ${C.black}` : "2px solid transparent",
                  cursor: isLocked ? "not-allowed" : "pointer",
                  opacity: isLocked ? 0.5 : 1,
                  transition: "all 0.15s",
                  ...os({ fontSize: 12 }),
                  position: "relative",
                }}
                onMouseEnter={(e) => { if (!isActive && !isLocked) { e.currentTarget.style.background = C.ghost; e.currentTarget.style.color = C.ink; } }}
                onMouseLeave={(e) => { if (!isActive && !isLocked) { e.currentTarget.style.background = "transparent"; e.currentTarget.style.color = C.ash; } }}
                title={isLocked ? "Generate Treatment Procedure first" : ""}
              >
                {tab.label}
                {isLocked && (
                  <span style={{ ...os({ fontSize: 9, color: C.silver }), position: "absolute", top: 3, right: 6 }}>🔒</span>
                )}
              </button>
            );
          })}
        </div>

        {/* Tab Content */}
        <div style={{ padding: "16px 20px", position: "relative", minHeight: 120 }}>

          {/* Treatment loading overlay */}
          {activeTab === "treatment" && treatmentLoading && (
            <div style={{
              position: "absolute", inset: 0, background: "rgba(255,255,255,0.85)",
              backdropFilter: "blur(4px)", display: "flex", alignItems: "center",
              justifyContent: "center", zIndex: 10, borderRadius: "0 0 4px 4px",
            }}>
              <div style={{
                padding: "10px 18px", border: `1px solid ${C.fog}`, borderRadius: "2px",
                background: C.white, boxShadow: "0 2px 8px rgba(0,0,0,0.08)",
                ...os({ fontSize: 13, color: C.smoke }),
              }}>
                <span style={{ marginRight: 8, display: "inline-block", animation: "spin 1s linear infinite", width: 12, height: 12, border: `2px solid ${C.mist}`, borderTopColor: C.charcoal, borderRadius: "50%", verticalAlign: "middle" }} />
                Generating Treatment Procedure...
              </div>
            </div>
          )}

          {/* Alerts loading overlay */}
          {activeTab === "alerts" && alertsLoading && (
            <div style={{
              position: "absolute", inset: 0, background: "rgba(255,255,255,0.85)",
              backdropFilter: "blur(4px)", display: "flex", alignItems: "center",
              justifyContent: "center", zIndex: 10, borderRadius: "0 0 4px 4px",
            }}>
              <div style={{
                padding: "10px 18px", border: `1px solid ${C.fog}`, borderRadius: "2px",
                background: C.white, boxShadow: "0 2px 8px rgba(0,0,0,0.08)",
                ...os({ fontSize: 13, color: C.smoke }),
              }}>
                <span style={{ marginRight: 8, display: "inline-block", animation: "spin 1s linear infinite", width: 12, height: 12, border: `2px solid ${C.mist}`, borderTopColor: C.charcoal, borderRadius: "50%", verticalAlign: "middle" }} />
                Generating Alerts...
              </div>
            </div>
          )}

          {/* Summary Tab */}
          {activeTab === "summary" && (
            <div style={{
              padding: "14px", borderRadius: "2px",
              background: C.ghost, border: `1px solid ${C.fog}`,
              ...os({ fontSize: 13, color: C.charcoal, lineHeight: 1.7, whiteSpace: "pre-wrap" }),
            }}>
              {patientSummary || (
                <span style={{ color: C.silver }}>No patient summary available.</span>
              )}
            </div>
          )}

          {/* Treatment Tab */}
          {activeTab === "treatment" && (
            <TreatmentDisplay data={treatmentRaw} chemoEngineData={chemoEngineData} selectedProcedure={activeProcedure} />
          )}

          {/* Tumor Board Tab */}
          {activeTab === "tumor" && (
            <StyledTextarea
              refObj={tumorRef}
              value={tumorBoard}
              onChange={(e) => setTumorBoard(e.target.value)}
              placeholder="Tumor board recommendations will appear here..."
              minHeight={200}
            />
          )}

          {/* Alerts Tab */}
          {activeTab === "alerts" && (
            <StyledTextarea
              refObj={alertsRef}
              value={alerts || ""}
              onChange={(e) => setAlerts(e.target.value)}
              placeholder="Alerts and important findings will appear here..."
              minHeight={200}
            />
          )}
        </div>
      </div>

      {/* ── Generate Workflow ───────────────────────────────────────────── */}
      {activeProcedure && activeProcedure.toLowerCase().includes("chemo") ? (
  <ChemotherapyWorkflow patientId={patientId} doctorId={doctorId} />
) : activeProcedure && activeProcedure.toLowerCase().includes("surg") ? (
  <SurgicalOncologyWorkflow patientId={patientId} doctorId={doctorId} />
) : activeProcedure && activeProcedure.toLowerCase().includes("radiation") ? (
  <RadiationTherapyWorkflow patientId={patientId} doctorId={doctorId} />
) : activeProcedure && activeProcedure.toLowerCase().includes("nerve block") ? (
  <NerveBlockForm
    patientId={patientId}
    doctorId={doctorId}
    patientName={patientName}
  />
) : (
  <React.Fragment>
          <div style={{ ...card, padding: "16px 20px" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
              <p style={{ ...os({ fontSize: 12, color: C.ash }), margin: 0, flex: 1 }}>
                Select a procedure above, then click Generate Workflow to produce pre, during, and post-procedure documentation.
              </p>
              <ActionBtn
                onClick={() => { if (!activeProcedure) { alert("Please select a procedure first"); return; } fetchProcedureWorkflow(activeProcedure, mode); }}
                disabled={!activeProcedure}
              >
                Generate Workflow
              </ActionBtn>
            </div>
          </div>

          {/* ── Mode Tabs + Procedure Sections ─────────────────────────────── */}
          <div style={{ ...card, position: "relative", overflow: "hidden" }}>

            {/* Loading overlay */}
            {loading && (
              <div style={{
                position: "absolute", inset: 0, background: "rgba(255,255,255,0.8)",
                backdropFilter: "blur(3px)", display: "flex", alignItems: "center",
                justifyContent: "center", zIndex: 10,
              }}>
                <div style={{
                  padding: "8px 16px", border: `1px solid ${C.fog}`, borderRadius: "2px",
                  background: C.white, ...os({ fontSize: 12, color: C.smoke }),
                }}>
                  <span style={{ marginRight: 8, display: "inline-block", animation: "spin 1s linear infinite", width: 10, height: 10, border: `2px solid ${C.mist}`, borderTopColor: C.charcoal, borderRadius: "50%", verticalAlign: "middle" }} />
                  Loading...
                </div>
              </div>
            )}

            {/* Mode Tabs */}
            <div style={{ display: "flex", borderBottom: `1px solid ${C.fog}` }}>
              {["order", "report"].map((t) => {
                const isActive = mode === t;
                return (
                  <button
                    key={t}
                    onClick={() => { setMode(t); if (activeProcedure) fetchProcedureWorkflow(activeProcedure, t); }}
                    style={{
                      flex: 1, padding: "11px 20px",
                      background: isActive ? C.black : C.white,
                      color: isActive ? C.white : C.ash,
                      border: "none", borderBottom: `2px solid ${isActive ? C.black : "transparent"}`,
                      cursor: "pointer", transition: "all 0.15s",
                      display: "flex", alignItems: "center", justifyContent: "center", gap: 6,
                      ...os({ fontSize: 12 }),
                    }}
                    onMouseEnter={(e) => { if (!isActive) { e.currentTarget.style.background = C.ghost; e.currentTarget.style.color = C.ink; } }}
                    onMouseLeave={(e) => { if (!isActive) { e.currentTarget.style.background = C.white; e.currentTarget.style.color = C.ash; } }}
                  >
                    {t === "order" ? (
                      <svg width="13" height="13" fill="currentColor" viewBox="0 0 20 20"><path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm1-11a1 1 0 10-2 0v2H7a1 1 0 100 2h2v2a1 1 0 102 0v-2h2a1 1 0 100-2h-2V7z" clipRule="evenodd" /></svg>
                    ) : (
                      <svg width="13" height="13" fill="currentColor" viewBox="0 0 20 20"><path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z" clipRule="evenodd" /></svg>
                    )}
                    {t === "order" ? "Order Mode" : "Report Mode"}
                  </button>
                );
              })}
            </div>

            {/* Procedure Fields */}
            <div style={{ padding: "20px", display: "flex", flexDirection: "column", gap: 20 }}>

              {/* Pre Procedure */}
              <div>
                <DictationControls field="pre" label="Pre-Procedure" onClear={() => setPreProcedure("")} />
                <StyledTextarea
                  refObj={preRef}
                  value={preProcedure}
                  onChange={(e) => setPreProcedure(e.target.value)}
                  placeholder="Document pre-procedure steps, preparations, and requirements..."
                />
              </div>

              {/* Divider */}
              <div style={{ borderTop: `1px solid ${C.fog}` }} />

              {/* During Procedure */}
              <div>
                <DictationControls field="during" label="During Procedure" onClear={() => setDuringProcedure("")} />
                <StyledTextarea
                  refObj={duringRef}
                  value={duringProcedure}
                  onChange={(e) => setDuringProcedure(e.target.value)}
                  placeholder="Document the procedure steps, observations, and intraoperative notes..."
                />
              </div>

              {/* Divider */}
              <div style={{ borderTop: `1px solid ${C.fog}` }} />

              {/* Post Procedure */}
              <div>
                <DictationControls field="post" label="Post-Procedure" onClear={() => setPostProcedure("")} />
                <StyledTextarea
                  refObj={postRef}
                  value={postProcedure}
                  onChange={(e) => setPostProcedure(e.target.value)}
                  placeholder="Document post-procedure care, follow-up instructions, and recovery notes..."
                />
              </div>
            </div>
          </div>

          {/* ── Status & Save ───────────────────────────────────────────────── */}
          <div style={{ ...card, padding: "16px 20px" }}>

            {/* Processing indicator */}
            {(loading || processing) && (
              <div style={{
                marginBottom: 12, padding: "10px 14px",
                background: C.ghost, border: `1px solid ${C.fog}`, borderRadius: "2px",
                display: "flex", alignItems: "center", gap: 10,
              }}>
                <span style={{
                  display: "inline-block", animation: "spin 1s linear infinite",
                  width: 14, height: 14, border: `2px solid ${C.mist}`,
                  borderTopColor: C.charcoal, borderRadius: "50%", flexShrink: 0,
                }} />
                <span style={{ ...os({ fontSize: 12, color: C.smoke }) }}>
                  {processing ? "Transcribing audio..." : "Generating workflow..."}
                </span>
              </div>
            )}

            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <svg width="14" height="14" fill="currentColor" viewBox="0 0 20 20" style={{ color: C.silver, flexShrink: 0 }}>
                  <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z" clipRule="evenodd" />
                </svg>
                <span style={{ ...os({ fontSize: 12, color: C.silver }) }}>
                  All changes are auto-saved as draft. Click Save to finalize.
                </span>
              </div>
              <ActionBtn onClick={handleSave} disabled={!activeProcedure}>
                <svg width="13" height="13" fill="currentColor" viewBox="0 0 20 20"><path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" /></svg>
                Save Procedure Notes
              </ActionBtn>
            </div>
          </div>
        </React.Fragment>
      )}
    </div>
  );
};

export default ProcedureNotes;