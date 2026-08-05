import React, { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";

const API_BASE_URL =
  
  "https://doctorassist.ai/api/";

  import { THEMES } from "../dashboard/themes";

const themeName = localStorage.getItem("theme") || "PurpleWhite";
const theme = THEMES[themeName] || THEMES.PurpleWhite;
/* ─────────────────────────────────────────────────────────────────────────────
   DESIGN TOKENS
───────────────────────────────────────────────────────────────────────────── */
const T = {
  bgPrimary: theme.bg,
  bgSecondary: theme.bgAlt,
  bgTertiary: theme.bgTert,

  textPrimary: theme.text,
  textSecondary: theme.textSec,
  textMuted: theme.textMuted,

  border: theme.border,
  borderStrong: theme.borderStr,

  accent: theme.accent,

  // Text/icon color on accent backgrounds
  accentInv: theme.bg,
};




// Add this right after your imports
if (typeof document !== 'undefined') {
  const styleSheet = document.createElement("style");
  styleSheet.textContent = `
    @keyframes da-pulse {
      0%, 100% {
        opacity: 0.4;
        transform: scale(0.8);
      }
      50% {
        opacity: 1;
        transform: scale(1.2);
      }
    }
  `;
  document.head.appendChild(styleSheet);
}

/* ─────────────────────────────────────────────────────────────────────────────
   SECTION TOGGLE SLIDER
───────────────────────────────────────────────────────────────────────────── */
const SectionToggle = ({ sectionId, checked, onToggle }) => {
  return (
    <button
      onClick={() => onToggle(sectionId, !checked)}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: "0.4rem",
        padding: "0.25rem 0.6rem",
        border: `1px solid ${checked ? T.borderStrong : T.border}`,
        background: checked ? T.accent : T.bgPrimary,
        cursor: "pointer",
        fontFamily: "inherit",
        fontSize: "0.6rem",
        fontWeight: 400,
        color: checked ? T.accentInv : T.textMuted,
        letterSpacing: "0.12em",
        textTransform: "uppercase",
        transition: "all 0.15s",
        flexShrink: 0,
        userSelect: "none",
      }}
    >
      {/* Slider track */}
      <span style={{
        display: "inline-flex",
        width: 28,
        height: 14,
        borderRadius: 7,
        background: checked ? "#ffffff33" : T.border,
        border: `1px solid ${checked ? "rgba(255,255,255,0.4)" : T.border}`,
        alignItems: "center",
        padding: "0 2px",
        transition: "all 0.15s",
        position: "relative",
      }}>
        <span style={{
          width: 10,
          height: 10,
          borderRadius: "50%",
          background: checked ? T.accentInv : T.textMuted,
          transition: "all 0.2s",
          transform: checked ? "translateX(14px)" : "translateX(0px)",
          display: "block",
          flexShrink: 0,
        }} />
      </span>
      {checked ? "Included" : "Excluded"}
    </button>
  );
};

/* ─────────────────────────────────────────────────────────────────────────────
   HELPERS
───────────────────────────────────────────────────────────────────────────── */
const SectionLabel = ({ children }) => (
  <span style={{
    fontSize: "0.6rem", fontWeight: 400,
    color: T.textMuted, letterSpacing: "0.2em",
    textTransform: "uppercase",
  }}>
    {children}
  </span>
);

const Divider = () => (
  <div style={{ height: 1, background: T.border }} />
);

const Chip = ({ children, dark = false }) => (
  <span style={{
    display: "inline-block",
    fontSize: "0.6rem", fontWeight: 400,
    padding: "0.18rem 0.45rem",
    border: `1px solid ${dark ? T.borderStrong : T.border}`,
    background: dark ? T.accent : T.bgSecondary,
    color: dark ? T.accentInv : T.textSecondary,
    letterSpacing: "0.03em",
    whiteSpace: "nowrap",
  }}>
    {children}
  </span>
);

const isValidStr = (s) => {
  if (s === null || s === undefined) return false;
  if (typeof s !== "string") return true; // numbers/booleans etc. are valid if present
  const trimmed = s.trim();
  if (trimmed === "") return false;
  const lower = trimmed.toLowerCase();
  return lower !== "none" && lower !== "null" && lower !== "n/a" && lower !== "undefined";
};

/* ─────────────────────────────────────────────────────────────────────────────
   SECTION HEADER (title + slider toggle)
───────────────────────────────────────────────────────────────────────────── */
const SectionHeader = ({ title, sectionId, checked, onToggle }) => (
  <div style={{
    display: "flex", justifyContent: "space-between", alignItems: "center",
    padding: "0.75rem 1.25rem",
    background: T.bgSecondary,
    borderBottom: `1px solid ${T.border}`,
  }}>
    <SectionLabel>{title}</SectionLabel>
    <SectionToggle sectionId={sectionId} checked={checked} onToggle={onToggle} />
  </div>
);
const AGENT_SWARM = [
  { id: "intent", label: "Intent Agent" },
  { id: "guidelines", label: "Guideline Agent" },
  { id: "exclusion", label: "Exclusion Agent" },
  { id: "pharma", label: "Pharma Agent" },
  { id: "procedure", label: "Procedure Agent" },
  { id: "investigation", label: "Investigation Agent" },
  { id: "validation", label: "Validation Agent" },
];
/* ─────────────────────────────────────────────────────────────────────────────
   DRUG CARD
───────────────────────────────────────────────────────────────────────────── */
const DrugCard = ({ drug, index, total }) => (
  <div style={{
    padding: "1rem 1.25rem",
    borderBottom: index < total - 1 ? `1px solid ${T.border}` : "none",
    background: T.bgPrimary,
  }}>
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "0.4rem" }}>
      <span style={{ fontSize: "0.88rem", fontWeight: 400, color: T.textPrimary }}>{drug.drug_name}</span>
      <div style={{ display: "flex", gap: "0.35rem", flexShrink: 0, marginLeft: "0.75rem" }}>
        {isValidStr(drug.dose) && <Chip>{drug.dose}</Chip>}
        {isValidStr(drug.frequency) && <Chip>{drug.frequency}</Chip>}
      </div>
    </div>
    {isValidStr(drug.indication) && (
      <p style={{ fontSize: "0.78rem", fontWeight: 300, color: T.textSecondary, margin: "0 0 0.5rem", lineHeight: 1.6 }}>
        {drug.indication}
      </p>
    )}
    {isValidStr(drug.guideline_rationale) && (
      <div style={{ marginTop: "0.4rem", paddingLeft: "0.75rem", borderLeft: `2px solid ${T.border}` }}>
        <span style={{ fontSize: "0.6rem", color: T.textMuted, letterSpacing: "0.1em", textTransform: "uppercase", display: "block", marginBottom: "0.2rem" }}>Guideline</span>
        <span style={{ fontSize: "0.75rem", fontWeight: 300, color: T.textSecondary }}>{drug.guideline_rationale}</span>
      </div>
    )}
    {isValidStr(drug.patient_specific_reason) && (
      <div style={{ marginTop: "0.4rem", paddingLeft: "0.75rem", borderLeft: `2px solid ${T.borderStrong}` }}>
        <span style={{ fontSize: "0.6rem", color: T.textMuted, letterSpacing: "0.1em", textTransform: "uppercase", display: "block", marginBottom: "0.2rem" }}>Patient-specific</span>
        <span style={{ fontSize: "0.75rem", fontWeight: 300, color: T.textSecondary }}>{drug.patient_specific_reason}</span>
      </div>
    )}
  </div>
);

/* ─────────────────────────────────────────────────────────────────────────────
   PROCEDURE CARD
───────────────────────────────────────────────────────────────────────────── */
const ProcedureCard = ({ proc, index, total }) => (
  <div style={{
    padding: "1rem 1.25rem",
    borderBottom: index < total - 1 ? `1px solid ${T.border}` : "none",
    background: T.bgPrimary,
  }}>
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "0.4rem" }}>
      <span style={{ fontSize: "0.88rem", fontWeight: 400, color: T.textPrimary }}>{proc.procedure_name}</span>
      <div style={{ display: "flex", gap: "0.35rem", flexShrink: 0, marginLeft: "0.75rem", flexWrap: "wrap", justifyContent: "flex-end" }}>
        {isValidStr(proc.timing) && <Chip>{proc.timing}</Chip>}
        {isValidStr(proc.guideline_support) && <Chip>{proc.guideline_support}</Chip>}
        {isValidStr(proc.recommendation_class) && <Chip>Class {proc.recommendation_class}</Chip>}
        {isValidStr(proc.evidence_level) && <Chip>Evidence {proc.evidence_level}</Chip>}
      </div>
    </div>

    {isValidStr(proc.indication) && (
      <p style={{ fontSize: "0.78rem", fontWeight: 300, color: T.textSecondary, margin: "0 0 0.5rem", lineHeight: 1.6 }}>
        {proc.indication}
      </p>
    )}

    {isValidStr(proc.reason_needed) && (
      <div style={{ marginTop: "0.4rem", paddingLeft: "0.75rem", borderLeft: `2px solid ${T.border}` }}>
        <span style={{ fontSize: "0.6rem", color: T.textMuted, letterSpacing: "0.1em", textTransform: "uppercase", display: "block", marginBottom: "0.2rem" }}>Why needed</span>
        <span style={{ fontSize: "0.75rem", fontWeight: 300, color: T.textSecondary }}>{proc.reason_needed}</span>
      </div>
    )}

    {isValidStr(proc.guideline_rationale) && (
      <div style={{ marginTop: "0.4rem", paddingLeft: "0.75rem", borderLeft: `2px solid ${T.border}` }}>
        <span style={{ fontSize: "0.6rem", color: T.textMuted, letterSpacing: "0.1em", textTransform: "uppercase", display: "block", marginBottom: "0.2rem" }}>Guideline</span>
        <span style={{ fontSize: "0.75rem", fontWeight: 300, color: T.textSecondary }}>{proc.guideline_rationale}</span>
      </div>
    )}

    {isValidStr(proc.patient_specific_reason) && (
      <div style={{ marginTop: "0.4rem", paddingLeft: "0.75rem", borderLeft: `2px solid ${T.borderStrong}` }}>
        <span style={{ fontSize: "0.6rem", color: T.textMuted, letterSpacing: "0.1em", textTransform: "uppercase", display: "block", marginBottom: "0.2rem" }}>Patient-specific</span>
        <span style={{ fontSize: "0.75rem", fontWeight: 300, color: T.textSecondary }}>{proc.patient_specific_reason}</span>
      </div>
    )}

    {isValidStr(proc.supporting_trial) && (
      <div style={{ marginTop: "0.4rem" }}>
        <Chip>Trial: {proc.supporting_trial}</Chip>
      </div>
    )}

    <BulletList title="Procedure Steps" items={proc.procedure_steps} />
    <BulletList title="Prerequisites" items={proc.prerequisites} />
    <BulletList title="Contraindications" items={proc.contraindications} />
    <BulletList title="Expected Complications" items={proc.expected_complications} />
    <BulletList title="Post-Procedure Care" items={proc.post_procedure_care} />

    <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap", marginTop: "0.5rem" }}>
      {isValidStr(proc.cardiac_risk_note) && <Chip>Cardiac risk: {proc.cardiac_risk_note}</Chip>}
      {isValidStr(proc.estimated_duration) && <Chip>Duration: {proc.estimated_duration}</Chip>}
      {isValidStr(proc.anesthesia_type) && <Chip>Anesthesia: {proc.anesthesia_type}</Chip>}
      {isValidStr(proc.estimated_blood_loss) && <Chip>Blood loss: {proc.estimated_blood_loss}</Chip>}
      {isValidStr(proc.hospital_stay) && <Chip>Stay: {proc.hospital_stay}</Chip>}
      {isValidStr(proc.recovery_time) && <Chip>Recovery: {proc.recovery_time}</Chip>}
      {isValidStr(proc.success_rate) && <Chip>Success rate: {proc.success_rate}</Chip>}
    </div>

    {isValidStr(proc.follow_up_schedule) && (
      <p style={{ fontSize: "0.75rem", fontWeight: 300, color: T.textSecondary, marginTop: "0.5rem" }}>
        <strong style={{ fontWeight: 400 }}>Follow-up schedule:</strong> {proc.follow_up_schedule}
      </p>
    )}
    {isValidStr(proc.expected_benefit) && (
      <p style={{ fontSize: "0.75rem", fontWeight: 300, color: T.textSecondary, marginTop: "0.3rem" }}>
        <strong style={{ fontWeight: 400 }}>Expected benefit:</strong> {proc.expected_benefit}
      </p>
    )}
    {isValidStr(proc.expected_outcome) && (
      <p style={{ fontSize: "0.75rem", fontWeight: 300, color: T.textSecondary, marginTop: "0.3rem" }}>
        <strong style={{ fontWeight: 400 }}>Expected outcome:</strong> {proc.expected_outcome}
      </p>
    )}
    {isValidStr(proc.alternative_procedure) && (
      <p style={{ fontSize: "0.75rem", fontWeight: 300, color: T.textSecondary, marginTop: "0.3rem" }}>
        <strong style={{ fontWeight: 400 }}>Alternative:</strong> {proc.alternative_procedure}
      </p>
    )}
    {isValidStr(proc.comments) && (
      <p style={{ fontSize: "0.75rem", fontWeight: 300, color: T.textMuted, fontStyle: "italic", marginTop: "0.3rem" }}>
        {proc.comments}
      </p>
    )}

    <div style={{ display: "flex", gap: "0.5rem", marginTop: "0.5rem", alignItems: "center" }}>
      <Chip dark={!!proc.specialty_scope_compliant}>
        {proc.specialty_scope_compliant ? "In-scope" : "Out-of-scope"}
      </Chip>
      {isValidStr(proc.specialty_scope_reason) && (
        <span style={{ fontSize: "0.7rem", color: T.textMuted, fontStyle: "italic" }}>{proc.specialty_scope_reason}</span>
      )}
    </div>
  </div>
);

/* ─────────────────────────────────────────────────────────────────────────────
   INVESTIGATION CARD
───────────────────────────────────────────────────────────────────────────── */
const InvCard = ({ inv, index, total }) => (
  <div style={{
    padding: "1rem 1.25rem",
    borderBottom: index < total - 1 ? `1px solid ${T.border}` : "none",
    background: T.bgPrimary,
  }}>
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "0.4rem" }}>
      <span style={{ fontSize: "0.88rem", fontWeight: 400, color: T.textPrimary }}>{inv.test_name}</span>
      <div style={{ display: "flex", gap: "0.35rem", flexShrink: 0, marginLeft: "0.75rem" }}>
        {isValidStr(inv.urgency) && <Chip>{inv.urgency}</Chip>}
        {inv.repeat_justified && <Chip dark>Repeat</Chip>}
      </div>
    </div>
    {isValidStr(inv.indication) && (
      <p style={{ fontSize: "0.78rem", fontWeight: 300, color: T.textSecondary, margin: "0 0 0.5rem", lineHeight: 1.6 }}>
        {inv.indication}
      </p>
    )}
    {inv.parameters?.length > 0 && (
  <div style={{ marginBottom: "0.6rem" }}>
    <span
      style={{
        fontSize: "0.6rem",
        color: T.textMuted,
        letterSpacing: "0.1em",
        textTransform: "uppercase",
        display: "block",
        marginBottom: "0.25rem",
      }}
    >
      Parameters
    </span>

    <div
      style={{
        display: "flex",
        flexWrap: "wrap",
        gap: "0.35rem",
      }}
    >
      {inv.parameters.map((param, idx) => (
        <Chip key={idx}>{param}</Chip>
      ))}
    </div>
  </div>
)}
    {isValidStr(inv.guideline_rationale) && (
      <div style={{ marginTop: "0.4rem", paddingLeft: "0.75rem", borderLeft: `2px solid ${T.border}` }}>
        <span style={{ fontSize: "0.6rem", color: T.textMuted, letterSpacing: "0.1em", textTransform: "uppercase", display: "block", marginBottom: "0.2rem" }}>Guideline</span>
        <span style={{ fontSize: "0.75rem", fontWeight: 300, color: T.textSecondary }}>{inv.guideline_rationale}</span>
      </div>
    )}
    {isValidStr(inv.patient_specific_reason) && (
      <div style={{ marginTop: "0.4rem", paddingLeft: "0.75rem", borderLeft: `2px solid ${T.borderStrong}` }}>
        <span style={{ fontSize: "0.6rem", color: T.textMuted, letterSpacing: "0.1em", textTransform: "uppercase", display: "block", marginBottom: "0.2rem" }}>Patient-specific</span>
        <span style={{ fontSize: "0.75rem", fontWeight: 300, color: T.textSecondary }}>{inv.patient_specific_reason}</span>
      </div>
    )}
  </div>
);

/* ─────────────────────────────────────────────────────────────────────────────
   LIFESTYLE CARD
───────────────────────────────────────────────────────────────────────────── */
const LifestyleCard = ({ mod, index, total }) => (
  <div style={{
    padding: "1rem 1.25rem",
    borderBottom: index < total - 1 ? `1px solid ${T.border}` : "none",
    background: T.bgPrimary,
  }}>
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "0.4rem" }}>
      <span style={{ fontSize: "0.88rem", fontWeight: 400, color: T.textPrimary, textTransform: "capitalize" }}>
        {mod.intervention_type}
      </span>
      <div style={{ display: "flex", gap: "0.35rem", flexShrink: 0, marginLeft: "0.75rem" }}>
        {isValidStr(mod.evidence_strength) && <Chip>Evidence: {mod.evidence_strength}</Chip>}
        {isValidStr(mod.implementation_difficulty) && <Chip>Difficulty: {mod.implementation_difficulty}</Chip>}
      </div>
    </div>
    {isValidStr(mod.specific_recommendation) && (
      <p style={{ fontSize: "0.78rem", fontWeight: 300, color: T.textSecondary, margin: "0 0 0.5rem", lineHeight: 1.6 }}>
        {mod.specific_recommendation}
      </p>
    )}
    {isValidStr(mod.guideline_rationale) && (
      <div style={{ marginTop: "0.4rem", paddingLeft: "0.75rem", borderLeft: `2px solid ${T.border}` }}>
        <span style={{ fontSize: "0.6rem", color: T.textMuted, letterSpacing: "0.1em", textTransform: "uppercase", display: "block", marginBottom: "0.2rem" }}>Guideline</span>
        <span style={{ fontSize: "0.75rem", fontWeight: 300, color: T.textSecondary }}>{mod.guideline_rationale}</span>
      </div>
    )}
    {isValidStr(mod.patient_specific_reason) && (
      <div style={{ marginTop: "0.4rem", paddingLeft: "0.75rem", borderLeft: `2px solid ${T.borderStrong}` }}>
        <span style={{ fontSize: "0.6rem", color: T.textMuted, letterSpacing: "0.1em", textTransform: "uppercase", display: "block", marginBottom: "0.2rem" }}>Patient-specific</span>
        <span style={{ fontSize: "0.75rem", fontWeight: 300, color: T.textSecondary }}>{mod.patient_specific_reason}</span>
      </div>
    )}
  </div>
);

/* ─────────────────────────────────────────────────────────────────────────────
   BULLET LIST BLOCK
───────────────────────────────────────────────────────────────────────────── */
const BulletList = ({ title, items }) => {
  if (!items || items.length === 0) return null;
  return (
    <div style={{ marginBottom: "0.75rem" }}>
      <span style={{ fontSize: "0.7rem", fontWeight: 400, color: T.textSecondary, display: "block", marginBottom: "0.35rem" }}>
        {title}
      </span>
      {items.map((item, i) => (
        <div key={i} style={{ display: "flex", gap: "0.5rem", alignItems: "flex-start", marginBottom: "0.25rem" }}>
          <span style={{ color: T.textMuted, fontSize: "0.75rem", flexShrink: 0, marginTop: "0.05rem" }}>—</span>
          <span style={{ fontSize: "0.75rem", fontWeight: 300, color: T.textSecondary, lineHeight: 1.6 }}>{item}</span>
        </div>
      ))}
    </div>
  );
};

/* ─────────────────────────────────────────────────────────────────────────────
   PLAN SECTION BLOCK (shared wrapper)
───────────────────────────────────────────────────────────────────────────── */
const PlanSection = ({ title, sectionId, checked, onToggle, children }) => (
  <div style={{ borderBottom: `1px solid ${T.border}` }}>
    <SectionHeader title={title} sectionId={sectionId} checked={checked} onToggle={onToggle} />
    {checked && (
      <div>{children}</div>
    )}
  </div>
);

/* ─────────────────────────────────────────────────────────────────────────────
   CONFIDENCE BAR
───────────────────────────────────────────────────────────────────────────── */
const ConfBar = ({ label, value }) => (
  <div style={{ marginBottom: "0.5rem" }}>
    <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "0.2rem" }}>
      <span style={{ fontSize: "0.65rem", color: T.textMuted, letterSpacing: "0.1em", textTransform: "uppercase" }}>{label}</span>
      <span style={{ fontSize: "0.65rem", fontWeight: 400, color: T.textPrimary }}>{Math.round(value * 100)}%</span>
    </div>
    <div style={{ height: 3, background: T.border, position: "relative" }}>
      <div style={{ height: "100%", width: `${Math.round(value * 100)}%`, background: T.accent, transition: "width 0.4s ease" }} />
    </div>
  </div>
);

/* ─────────────────────────────────────────────────────────────────────────────
   TAB ROW
───────────────────────────────────────────────────────────────────────────── */
const TabRow = ({ plans, selectedTab, onTabChange }) => (
  <div style={{
    display: "flex",
    borderBottom: `1px solid ${T.border}`,
    background: T.bgSecondary,
    overflowX: "auto",
    flexShrink: 0,
  }}>
    {plans.map((plan, index) => {
      const active = selectedTab === index;
      return (
        <button
          key={index}
          onClick={() => onTabChange(index)}
          style={{
            display: "flex",
            alignItems: "center",
            gap: "0.5rem",
            padding: "0.75rem 1.25rem",
            background: active ? T.bgPrimary : "transparent",
            border: "none",
            borderBottom: active ? `2px solid ${T.borderStrong}` : "2px solid transparent",
            cursor: "pointer",
            fontFamily: "inherit",
            fontWeight: active ? 400 : 300,
            fontSize: "0.78rem",
            color: active ? T.textPrimary : T.textMuted,
            letterSpacing: "0.02em",
            whiteSpace: "nowrap",
            transition: "all 0.15s",
            flexShrink: 0,
          }}
        >
          <span>Rank #{plan.rank}</span>
          <Chip>{plan.strategy}</Chip>
          <Chip dark={plan.treatment_intent === "curative"}>{plan.treatment_intent}</Chip>
        </button>
      );
    })}
  </div>
);

/* ─────────────────────────────────────────────────────────────────────────────
   TREATMENT PLAN VIEW
───────────────────────────────────────────────────────────────────────────── */
const TreatmentPlanView = ({ plan, selectedSections, onSectionChange }) => {
  if (!plan) return null;

  return (
    <div>
      {/* ── Treatment Intent + Scores ── */}
      <PlanSection
        title="Treatment Intent"
        sectionId="treatment_intent"
        checked={selectedSections.treatment_intent}
        onToggle={onSectionChange}
      >
        <div style={{ padding: "1rem 1.25rem", background: T.bgPrimary }}>
          <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap", marginBottom: "1rem" }}>
            <Chip dark>{(plan.treatment_intent || "curative").toUpperCase()}</Chip>
            <Chip>{(plan.strategy || "standard").toUpperCase()}</Chip>
          </div>
          <ConfBar label="Confidence" value={plan.confidence_score || 0} />
          <ConfBar label="Guideline compliance" value={plan.guideline_compliance_score || 0} />
          <p style={{ fontSize: "0.75rem", fontWeight: 300, color: T.textMuted, fontStyle: "italic", marginTop: "0.5rem", lineHeight: 1.6 }}>
            {plan.treatment_intent === "curative"
              ? "Curative intent: Treatment aimed at complete resolution of the condition and restoration of normal health."
              : plan.treatment_intent === "palliative"
              ? "Palliative intent: Treatment focused on symptom management and quality of life improvement."
              : "Supportive intent: Treatment aimed at supporting organ function and preventing complications."}
          </p>
        </div>
      </PlanSection>

      {/* ── Primary Goals ── */}
      {plan.primary_goals?.length > 0 && (
        <PlanSection
          title="Primary Goals"
          sectionId="primary_goals"
          checked={selectedSections.primary_goals}
          onToggle={onSectionChange}
        >
          {plan.primary_goals.map((goal, i) => (
            <div key={i} style={{
              padding: "0.875rem 1.25rem",
              borderBottom: i < plan.primary_goals.length - 1 ? `1px solid ${T.border}` : "none",
              display: "flex", gap: "0.75rem", alignItems: "flex-start",
            }}>
              <span style={{ fontSize: "0.65rem", color: T.textMuted, fontWeight: 400, letterSpacing: "0.1em", paddingTop: "0.1rem", flexShrink: 0 }}>
                {String(i + 1).padStart(2, "0")}
              </span>
              <span style={{ fontSize: "0.82rem", fontWeight: 300, color: T.textSecondary, lineHeight: 1.7 }}>{goal}</span>
            </div>
          ))}
        </PlanSection>
      )}

      {/* ── First-Line Medications ── */}
      {plan.first_line_drugs?.length > 0 && (
        <PlanSection
          title="First-Line Medications"
          sectionId="first_line_medications"
          checked={selectedSections.first_line_medications}
          onToggle={onSectionChange}
        >
          {plan.first_line_drugs.map((drug, i) => (
            <DrugCard key={i} drug={drug} index={i} total={plan.first_line_drugs.length} />
          ))}
        </PlanSection>
      )}

      {/* ── Adjunctive Medications ── */}
      {plan.adjunctive_drugs?.length > 0 && (
        <PlanSection
          title="Adjunctive Medications"
          sectionId="adjunctive_medications"
          checked={selectedSections.adjunctive_medications}
          onToggle={onSectionChange}
        >
          {plan.adjunctive_drugs.map((drug, i) => (
            <DrugCard key={i} drug={drug} index={i} total={plan.adjunctive_drugs.length} />
          ))}
        </PlanSection>
      )}

      {/* ── Recommended Procedures ── */}
      {plan.recommended_procedures?.length > 0 && (
        <PlanSection
          title="Recommended Procedures"
          sectionId="procedures"
          checked={selectedSections.procedures}
          onToggle={onSectionChange}
        >
          {plan.recommended_procedures.map((proc, i) => (
            <ProcedureCard key={i} proc={proc} index={i} total={plan.recommended_procedures.length} />
          ))}
        </PlanSection>
      )}

      {/* ── Required Investigations ── */}
      {plan.required_investigations?.length > 0 && (
        <PlanSection
          title="Required Investigations"
          sectionId="investigations"
          checked={selectedSections.investigations}
          onToggle={onSectionChange}
        >
          {plan.required_investigations.map((inv, i) => (
            <InvCard key={i} inv={inv} index={i} total={plan.required_investigations.length} />
          ))}
        </PlanSection>
      )}

      {/* ── Lifestyle Modifications ── */}
      {plan.lifestyle_modifications?.length > 0 && (
        <PlanSection
          title="Lifestyle Modifications"
          sectionId="lifestyle"
          checked={selectedSections.lifestyle}
          onToggle={onSectionChange}
        >
          {plan.lifestyle_modifications.map((mod, i) => (
            <LifestyleCard key={i} mod={mod} index={i} total={plan.lifestyle_modifications.length} />
          ))}
        </PlanSection>
      )}

      {/* ── Follow-up Plan ── */}
      {plan.follow_up_plan && (
        <PlanSection
          title="Follow-up Plan"
          sectionId="follow_up"
          checked={selectedSections.follow_up}
          onToggle={onSectionChange}
        >
          <div style={{ padding: "1rem 1.25rem", background: T.bgPrimary }}>
            <div style={{ marginBottom: "0.75rem", display: "flex", alignItems: "center", gap: "0.5rem" }}>
              <span style={{ fontSize: "0.7rem", color: T.textMuted, letterSpacing: "0.1em", textTransform: "uppercase" }}>Next visit</span>
              <Chip dark>{plan.follow_up_plan.next_visit_timing}</Chip>
            </div>
            {isValidStr(plan.follow_up_plan.follow_up_guideline_rationale) && (
              <div style={{ marginBottom: "0.75rem", paddingLeft: "0.75rem", borderLeft: `2px solid ${T.border}` }}>
                <span style={{ fontSize: "0.6rem", color: T.textMuted, letterSpacing: "0.1em", textTransform: "uppercase", display: "block", marginBottom: "0.2rem" }}>Guideline</span>
                <span style={{ fontSize: "0.75rem", fontWeight: 300, color: T.textSecondary }}>{plan.follow_up_plan.follow_up_guideline_rationale}</span>
              </div>
            )}
            <BulletList title="Monitoring Parameters" items={plan.follow_up_plan.monitoring_parameters} />
            <BulletList title="Success Criteria" items={plan.follow_up_plan.success_criteria} />
            <BulletList title="Escalation Triggers" items={plan.follow_up_plan.escalation_triggers} />
          </div>
        </PlanSection>
      )}
    </div>
  );
};

/* ─────────────────────────────────────────────────────────────────────────────
   FORMAT FOR DICTATION
───────────────────────────────────────────────────────────────────────────── */
const formatTreatmentPlanForDictation = (plan, sections) => {
  let text = "\n\nTREATMENT PROTOCOL\n\n";

  if (sections.treatment_intent) {
    text += `TREATMENT INTENT\n${(plan.treatment_intent || "").toUpperCase()}\n\n`;
  }
  if (sections.primary_goals && plan.primary_goals?.length) {
    text += "PRIMARY GOALS\n";
    plan.primary_goals.forEach(g => { text += `  • ${g}\n`; });
    text += "\n";
  }
  const appendDrugs = (label, drugs) => {
    if (!drugs?.length) return;
    text += `${label}\n`;
    drugs.forEach(d => {
      text += `  • ${d.drug_name}\n    - Dose: ${d.dose}\n    - Frequency: ${d.frequency}\n    - Indication: ${d.indication}\n`;
      if (isValidStr(d.guideline_rationale)) text += `    - Guideline: ${d.guideline_rationale}\n`;
      if (isValidStr(d.patient_specific_reason)) text += `    - Patient Specific: ${d.patient_specific_reason}\n`;
    });
    text += "\n";
  };
  if (sections.first_line_medications)   appendDrugs("FIRST-LINE MEDICATIONS",  plan.first_line_drugs);
  if (sections.adjunctive_medications)   appendDrugs("ADJUNCTIVE MEDICATIONS",  plan.adjunctive_drugs);

  if (sections.procedures && plan.recommended_procedures?.length) {
    text += "RECOMMENDED PROCEDURES\n";
    plan.recommended_procedures.forEach(p => {
      text += `  • ${p.procedure_name}\n    - Indication: ${p.indication}\n    - Timing: ${p.timing}\n`;
      if (isValidStr(p.reason_needed)) text += `    - Reason Needed: ${p.reason_needed}\n`;
      if (isValidStr(p.guideline_rationale)) text += `    - Guideline: ${p.guideline_rationale}\n`;
      if (isValidStr(p.patient_specific_reason)) text += `    - Patient Specific: ${p.patient_specific_reason}\n`;
      if (isValidStr(p.supporting_trial)) text += `    - Supporting Trial: ${p.supporting_trial}\n`;
      p.procedure_steps?.forEach(s => { text += `      · Step: ${s}\n`; });
      p.prerequisites?.forEach(s => { text += `      · Prerequisite: ${s}\n`; });
      p.contraindications?.forEach(s => { text += `      · Contraindication: ${s}\n`; });
      p.expected_complications?.forEach(s => { text += `      · Possible Complication: ${s}\n`; });
      p.post_procedure_care?.forEach(s => { text += `      · Post-Procedure Care: ${s}\n`; });
      if (isValidStr(p.cardiac_risk_note)) text += `    - Cardiac Risk: ${p.cardiac_risk_note}\n`;
      if (isValidStr(p.estimated_duration)) text += `    - Estimated Duration: ${p.estimated_duration}\n`;
      if (isValidStr(p.anesthesia_type)) text += `    - Anesthesia: ${p.anesthesia_type}\n`;
      if (isValidStr(p.hospital_stay)) text += `    - Hospital Stay: ${p.hospital_stay}\n`;
      if (isValidStr(p.recovery_time)) text += `    - Recovery Time: ${p.recovery_time}\n`;
      if (isValidStr(p.expected_benefit)) text += `    - Expected Benefit: ${p.expected_benefit}\n`;
      if (isValidStr(p.expected_outcome)) text += `    - Expected Outcome: ${p.expected_outcome}\n`;
      if (isValidStr(p.alternative_procedure)) text += `    - Alternative: ${p.alternative_procedure}\n`;
      if (isValidStr(p.comments)) text += `    - Comments: ${p.comments}\n`;
      text += `    - Specialty Scope Compliant: ${p.specialty_scope_compliant ? "Yes" : "No"}\n`;
      if (isValidStr(p.specialty_scope_reason)) text += `    - Scope Reason: ${p.specialty_scope_reason}\n`;
    });
    text += "\n";
  }

  if (sections.investigations && plan.required_investigations?.length) {
    text += "REQUIRED INVESTIGATIONS\n";
    plan.required_investigations.forEach(inv => {
     text += `  • ${inv.test_name}\n`;

if (inv.parameters?.length > 0) {
  text += `    - Parameters: ${inv.parameters.join(", ")}\n`;
}

text += `    - Indication: ${inv.indication}\n`;
text += `    - Urgency: ${inv.urgency}\n`;
      if (isValidStr(inv.guideline_rationale)) text += `    - Guideline: ${inv.guideline_rationale}\n`;
      if (isValidStr(inv.patient_specific_reason)) text += `    - Patient Specific: ${inv.patient_specific_reason}\n`;
      if (inv.repeat_justified) text += `    - Repeat: Yes\n`;
    });
    text += "\n";
  }
  if (sections.lifestyle && plan.lifestyle_modifications?.length) {
    text += "LIFESTYLE MODIFICATIONS\n";
    plan.lifestyle_modifications.forEach(m => {
      text += `  • ${m.specific_recommendation}\n    - Evidence: ${m.evidence_strength}\n    - Difficulty: ${m.implementation_difficulty}\n`;
      if (isValidStr(m.guideline_rationale)) text += `    - Guideline: ${m.guideline_rationale}\n`;
      if (isValidStr(m.patient_specific_reason)) text += `    - Patient Specific: ${m.patient_specific_reason}\n`;
    });
    text += "\n";
  }
  if (sections.follow_up && plan.follow_up_plan) {
    const fu = plan.follow_up_plan;
    text += `FOLLOW-UP PLAN\n  • Next Visit: ${fu.next_visit_timing}\n`;
    if (isValidStr(fu.follow_up_guideline_rationale)) text += `  • Guideline: ${fu.follow_up_guideline_rationale}\n`;
    fu.monitoring_parameters?.forEach(p => { text += `  • Monitor: ${p}\n`; });
    fu.success_criteria?.forEach(c => { text += `  • Success: ${c}\n`; });
    fu.escalation_triggers?.forEach(t => { text += `  • Escalate: ${t}\n`; });
    text += "\n";
  }
  return text;
};

/* ─────────────────────────────────────────────────────────────────────────────
   MAIN COMPONENT
───────────────────────────────────────────────────────────────────────────── */
const TreatmentPlanPopup = ({
  open, onClose, onApprove,
  doctorId, patientId, diagnosisText = "",
}) => {
  const [loading, setLoading]         = useState(false);
  const [response, setResponse]       = useState(null);
  const [error, setError]             = useState(null);
  const [selectedTab, setSelectedTab] = useState(0);
  const [approved, setApproved]       = useState(false);
const [activeAgent, setActiveAgent] = useState(0);
const [progress, setProgress] = useState(5);
const [showContent, setShowContent] = useState(false);
const [isTransitioning, setIsTransitioning] = useState(false);
  const [selectedSections, setSelectedSections] = useState({
    treatment_intent:         true,
    primary_goals:            true,
    first_line_medications:   true,
    adjunctive_medications:   true,
    procedures:               true,
    investigations:           true,
    lifestyle:                true,
    follow_up:                true,
  });

  const handleSectionChange = (sectionId, val) => {
    setSelectedSections(prev => ({ ...prev, [sectionId]: val }));
  };

  const buildRequest = () => {
    const req = { patient_id: patientId, doctor_id: doctorId };
    if (diagnosisText?.trim()) {
      let clean = diagnosisText.trim();
      const prefix = "Primary Diagnosis: ";
      if (clean.startsWith(prefix)) clean = clean.substring(prefix.length);
      req.primary_diagnosis = { disease: clean };
    }
    return req;
  };
const createRequestData = () => {
    const requestData = {
      "patient_id": patientId,
      "doctor_id": doctorId
    };

    if (diagnosisText && diagnosisText.trim() !== "") {
      // Strip "Primary Diagnosis: " prefix if it exists
      let cleanDiagnosis = diagnosisText.trim();
      
      // Check if it starts with "Primary Diagnosis: " and remove it
      const prefix = "Primary Diagnosis: ";
      if (cleanDiagnosis.startsWith(prefix)) {
        cleanDiagnosis = cleanDiagnosis.substring(prefix.length);
      }
      
      requestData.primary_diagnosis = {
        "disease": cleanDiagnosis
      };
    }

    return requestData;
  };
  const generateTreatmentPlan = async () => {
    setLoading(true);
    setError(null);
    setResponse(null);
    setSelectedTab(0);
    setApproved(false);
    try {
      const requestData = createRequestData();
      console.log(requestData)
      const res = await fetch(`${API_BASE_URL}hms/users/ai-legacy/generate-treatment-plan`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(requestData),
      });
      if (!res.ok) throw new Error(`Failed to generate treatment plan: ${res.statusText}`);
      const data = await res.json();
      console.log("Treatment plan response:", data);
      setResponse(data);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };
useEffect(() => {
  if (!loading) return;

  let i = 0;
  let isComplete = false;
  
  const processNextAgent = () => {
    if (isComplete) return;
    
    if (i < AGENT_SWARM.length - 1) {
      // Process first 6 agents normally (up to 90%)
      setActiveAgent(i);
      setProgress(((i + 1) / AGENT_SWARM.length) * 100);
      i++;
      
      if (i < AGENT_SWARM.length - 1) {
        const randomDelay = 500 + Math.random() * 1300;
        setTimeout(processNextAgent, randomDelay);
      } else {
        // Last agent - stop at 90% and wait for backend response
        setActiveAgent(i);
        setProgress(90);
        isComplete = true;
      }
    }
  };
  
  const initialDelay = 300;
  const timeoutId = setTimeout(processNextAgent, initialDelay);
  
  return () => clearTimeout(timeoutId);
}, [loading]);

// Handle completion when response arrives
useEffect(() => {
  if (response && loading) {
    // Smooth transition to 100%
    let currentProgress = 90;
    const interval = setInterval(() => {
      if (currentProgress < 100) {
        currentProgress += 2;
        setProgress(currentProgress);
      } else {
        clearInterval(interval);
        // Start fade out transition
        setIsTransitioning(true);
        // After fade out, show content
        setTimeout(() => {
          setLoading(false);
          setShowContent(true);
          setIsTransitioning(false);
        }, 400);
      }
    }, 30);
    
    return () => clearInterval(interval);
  }
}, [response, loading]);
  useEffect(() => {
    if (open) generateTreatmentPlan();
  }, [open, diagnosisText, patientId, doctorId]);

    const handleApprove = async () => {

  if (response && response.treatment_plans && response.treatment_plans[selectedTab]) {

    const plan = response.treatment_plans[selectedTab];

    const formattedPlan =
      formatTreatmentPlanForDictation(
        plan,
        selectedSections
      );

    // =========================
    // VERIFY API
    // =========================
    try {

      await fetch(
        `${API_BASE_URL}hms/users/data/context/verify-treatment-plan`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            tag: "treatment_plan",
            doctor_id: doctorId,
            patient_id: patientId,
            treatment_plan_data: plan,
            formatted_plan: formattedPlan
          }),
        }
      );

    } catch (err) {

      // IMPORTANT
      // should not block approve flow
      console.error(
        "Treatment verify API failed:",
        err
      );
    }

    // =========================
    // EXISTING FLOW
    // =========================

    onApprove(formattedPlan);

    if (!window.DOCTOR_ASSIST_DATA) {
      window.DOCTOR_ASSIST_DATA = {};
    }

    window.DOCTOR_ASSIST_DATA.treatment_plan =
      formattedPlan;

    window.dispatchEvent(
      new CustomEvent(
        "treatment-approved",
        {
          detail: formattedPlan
        }
      )
    );

    setApproved(true);
  }
};
  if (!open) return null;

  const plans = response?.treatment_plans || [];
  const currentPlan = plans[selectedTab] || null;

  return (
    <AnimatePresence>
      {open && (
        <>
          {/* ── Backdrop ── */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
            style={{
              position: "fixed", inset: 0,
              background: "rgba(0,0,0,0.5)",
              zIndex: 9999,
            }}
          />

          {/* ── Popup ── */}
          <motion.div
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 16 }}
            transition={{ duration: 0.2 }}
            style={{
              position: "fixed",
              top: "5%", left: "17%",
              transform: "translate(-50%, -50%)",
              zIndex: 10000,
              width: "min(960px, 96vw)",
              maxHeight: "90vh",
              display: "flex",
              flexDirection: "column",
              background: T.bgPrimary,
              border: `1px solid ${T.borderStrong}`,
              fontFamily: "'Open Sans', sans-serif",
              fontWeight: 300,
              overflow: "hidden",
            }}
          >

            {/* ── HEADER ── */}
            <div style={{
              display: "flex", justifyContent: "space-between", alignItems: "center",
              padding: "0.875rem 1.5rem",
              background: T.bgSecondary,
              borderBottom: `1px solid ${T.border}`,
              flexShrink: 0,
            }}>
              <div style={{ display: "flex", flexDirection: "column", gap: "0.2rem" }}>
                <SectionLabel>Clinical Intelligence</SectionLabel>
                <span style={{ fontSize: "1rem", fontWeight: 300, color: T.textPrimary, letterSpacing: "-0.02em" }}>
                  Treatment Plans
                </span>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: "0.75rem" }}>
                {response && (
                  <div style={{ display: "flex", alignItems: "center", gap: "0.4rem" }}>
                    <span style={{ width: 6, height: 6, borderRadius: "50%", background: T.textPrimary, display: "block" }} />
                    <SectionLabel>{response.total_plans || 0} plans generated</SectionLabel>
                  </div>
                )}
                <button
                  onClick={onClose}
                  style={{
                    width: 30, height: 30,
                    border: `1px solid ${T.border}`,
                    background: T.bgPrimary,
                    cursor: "pointer",
                    display: "flex", alignItems: "center", justifyContent: "center",
                    fontSize: "1.1rem", color: T.textMuted,
                    fontFamily: "inherit", lineHeight: 1,
                  }}
                >×</button>
              </div>
            </div>

            {/* ── TABS ── */}
            {plans.length > 0 && (
              <TabRow
                plans={plans}
                selectedTab={selectedTab}
                onTabChange={(i) => { setSelectedTab(i); setApproved(false); }}
              />
            )}

            {/* ── BODY ── */}
            <div style={{ flex: 1, overflowY: "auto" }}>

              {loading && (
                <motion.div 
                  initial={{ opacity: 1 }}
                  animate={{ opacity: isTransitioning ? 0 : 1 }}
                  transition={{ duration: 0.4 }}
                  style={{
                    padding: "2rem 1.5rem",
                    display: "flex",
                    flexDirection: "column",
                    gap: "1.5rem",
                  }}
                >
                  {/* Header */}
                  <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                    <SectionLabel>AI Clinical Engine</SectionLabel>
                    <span style={{ 
                      fontSize: "0.9rem", 
                      fontWeight: 400, 
                      color: T.textPrimary, 
                      letterSpacing: "-0.01em" 
                    }}>
                      {progress >= 100 ? "Finalizing Treatment Plan" : "Generating Treatment Plan"}
                    </span>
                  </div>

                  {/* Agent List */}
                  <div style={{ display: "flex", flexDirection: "column", gap: 0.5 }}>
                    {AGENT_SWARM.map((agent, idx) => {
                      const isDone = idx < activeAgent;
                      const isActive = idx === activeAgent;
                      const isLastAndWaiting = idx === AGENT_SWARM.length - 1 && progress >= 90 && progress < 100;
                      
                      return (
                        <motion.div
                          key={agent.id}
                          initial={{ opacity: 0, y: 8 }}
                          animate={{ opacity: 1, y: 0 }}
                          transition={{ delay: idx * 0.06 }}
                          style={{
                            display: "flex",
                            alignItems: "center",
                            gap: "0.75rem",
                            padding: "0.6rem 0.75rem",
                            borderRadius: "4px",
                            background: (isActive || isLastAndWaiting) ? "rgba(0,0,0,0.03)" : "transparent",
                            transition: "background 0.15s ease",
                          }}
                        >
                          {/* Status Dot */}
                          <div
                            style={{
                              width: 8,
                              height: 8,
                              borderRadius: "50%",
                              background: isDone
                                ? T.accent
                                : (isActive || isLastAndWaiting)
                                ? T.textSecondary
                                : T.border,
                              animation: (isActive || isLastAndWaiting) ? "da-pulse 1.2s ease-in-out infinite" : "none",
                            }}
                          />

                          {/* Agent Label */}
                          <span style={{
                            fontSize: "0.75rem",
                            fontWeight: (isActive || isLastAndWaiting) ? 400 : 300,
                            color: isDone ? T.textPrimary : (isActive || isLastAndWaiting) ? T.textSecondary : T.textMuted,
                            letterSpacing: "0.02em",
                          }}>
                            {agent.label}
                          </span>

                          {/* Status text */}
                          <span style={{
                            fontSize: "0.65rem",
                            marginLeft: "auto",
                            color: isDone ? T.textMuted : (isActive || isLastAndWaiting) ? T.textSecondary : T.textMuted,
                            fontStyle: (isActive || isLastAndWaiting) ? "normal" : "italic",
                          }}>
                            {isDone 
                              ? "Complete" 
                              : (isLastAndWaiting && progress >= 90 && progress < 100)
                              ? "Validating..."
                              : isActive 
                              ? "Processing..." 
                              : "Pending"}
                          </span>
                        </motion.div>
                      );
                    })}
                  </div>

                  {/* Progress Bar */}
                  <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem", marginTop: "0.25rem" }}>
                    <div style={{
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "center",
                    }}>
                      <SectionLabel>Overall Progress</SectionLabel>
                      <motion.span 
                        animate={{ scale: progress >= 100 ? [1, 1.1, 1] : 1 }}
                        transition={{ duration: 0.5 }}
                        style={{
                          fontSize: "0.65rem",
                          fontWeight: 400,
                          color: progress >= 100 ? T.accent : T.textPrimary,
                        }}
                      >
                        {Math.min(100, Math.round(progress))}%
                      </motion.span>
                    </div>
                    <div style={{
                      height: 2,
                      background: T.border,
                      overflow: "hidden",
                      borderRadius: 1,
                    }}>
                      <motion.div
                        initial={{ width: "0%" }}
                        animate={{ width: `${Math.min(100, progress)}%` }}
                        transition={{ duration: 0.3, ease: "easeOut" }}
                        style={{
                          height: "100%",
                          background: progress >= 100 ? T.accent : T.accent,
                        }}
                      />
                    </div>
                  </div>

                  {/* Segment indicator bar */}
                  <div style={{
                    display: "flex",
                    gap: "1px",
                    marginTop: "0.5rem",
                  }}>
                    {AGENT_SWARM.map((_, idx) => (
                      <div
                        key={idx}
                        style={{
                          flex: 1,
                          height: 2,
                          background: idx < activeAgent ? T.accent : (idx === activeAgent && progress >= 90 && progress < 100) ? T.accent : T.border,
                          transition: "background 0.3s ease",
                          borderRadius: 1,
                        }}
                      />
                    ))}
                  </div>

                  {/* Status message when waiting for response */}
                  {progress >= 90 && progress < 100 && (
                    <motion.div
                      initial={{ opacity: 0, y: 5 }}
                      animate={{ opacity: 1, y: 0 }}
                      style={{
                        textAlign: "center",
                        marginTop: "0.5rem",
                        padding: "0.5rem",
                        borderRadius: "4px",
                        background: T.bgTertiary,
                      }}
                    >
                      <span style={{
                        fontSize: "0.7rem",
                        color: T.textSecondary,
                        fontStyle: "italic",
                      }}>
                        Finalizing treatment plan. This may take a few moments...
                      </span>
                    </motion.div>
                  )}
                </motion.div>
              )}

              {/* Error */}
              {error && (
                <div style={{
                  margin: "1.25rem 1.5rem",
                  padding: "0.875rem 1.25rem",
                  border: `1px solid ${T.borderStrong}`,
                  borderLeft: `3px solid ${T.borderStrong}`,
                  background: T.bgSecondary,
                }}>
                  <SectionLabel>Error</SectionLabel>
                  <p style={{ fontSize: "0.82rem", color: T.textSecondary, marginTop: "0.35rem", fontWeight: 300 }}>{error}</p>
                </div>
              )}

              {/* Plan content */}
              {(currentPlan && (!loading || showContent)) && (
                <motion.div
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.4, delay: 0.1 }}
                >
                  <TreatmentPlanView
                    plan={currentPlan}
                    selectedSections={selectedSections}
                    onSectionChange={handleSectionChange}
                  />
                </motion.div>
              )}
            </div>

            {/* ── FOOTER ── */}
            {plans.length > 0 && !loading && (
              <div style={{
                display: "flex", justifyContent: "space-between", alignItems: "center",
                padding: "0.875rem 1.5rem",
                borderTop: `1px solid ${T.border}`,
                background: T.bgSecondary,
                flexShrink: 0,
              }}>
                <span style={{ fontSize: "0.65rem", fontWeight: 300, color: T.textMuted, fontStyle: "italic" }}>
                  Clinical intelligence that compounds over time.
                </span>

                {approved ? (
                  <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
                    <span style={{ width: 6, height: 6, borderRadius: "50%", background: T.accent, display: "block" }} />
                    <span style={{ fontSize: "0.75rem", fontWeight: 400, color: T.textPrimary }}>
                      Plan approved and added to dictation
                    </span>
                  </div>
                ) : (
                  <div style={{ display: "flex", gap: "0.75rem" }}>
                    <button
                      onClick={onClose}
                      style={{
                        padding: "0.45rem 0.875rem",
                        border: `1px solid ${T.border}`,
                        background: T.bgPrimary,
                        cursor: "pointer",
                        fontFamily: "inherit",
                        fontSize: "0.72rem",
                        fontWeight: 400,
                        color: T.textSecondary,
                        letterSpacing: "0.08em",
                        textTransform: "uppercase",
                      }}
                    >
                      Cancel
                    </button>
                    <button
                      onClick={handleApprove}
                      style={{
                        padding: "0.45rem 1.25rem",
                        border: `1px solid ${T.borderStrong}`,
                        background: T.accent,
                        cursor: "pointer",
                        fontFamily: "inherit",
                        fontSize: "0.72rem",
                        fontWeight: 400,
                        color: T.accentInv,
                        letterSpacing: "0.08em",
                        textTransform: "uppercase",
                      }}
                    >
                      Approve Rank #{selectedTab + 1} →
                    </button>
                  </div>
                )}
              </div>
            )}

          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
};

export default TreatmentPlanPopup;