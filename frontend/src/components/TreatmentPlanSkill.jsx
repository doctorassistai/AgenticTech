import React, { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";

const API_BASE_URL =
  "https://doctorassist.ai/api/";

/* ─────────────────────────────────────────────────────────────────────────────
   DESIGN TOKENS
───────────────────────────────────────────────────────────────────────────── */
const T = {
  bgPrimary:    "#ffffff",
  bgSecondary:  "#fafafa",
  bgTertiary:   "#f5f5f5",
  textPrimary:  "#000000",
  textSecondary:"#444444",
  textMuted:    "#888888",
  border:       "#e0e0e0",
  borderStrong: "#000000",
  accent:       "#000000",
  accentInv:    "#ffffff",
};

// Add CSS for pulse animation
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

const isValidStr = (s) => s && s !== "None" && s.trim() !== "";

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
   SECTION HEADER
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

/* ─────────────────────────────────────────────────────────────────────────────
   PLAN SECTION BLOCK
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
   AGENT SWARM
───────────────────────────────────────────────────────────────────────────── */
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
   RANK SUMMARY CARD (Top Bar)
───────────────────────────────────────────────────────────────────────────── */
const RankSummaryCard = ({ summary }) => {
  if (!summary) return null;
  
  return (
    <div style={{
      padding: "0.75rem 1.25rem",
      background: T.bgTertiary,
      borderBottom: `1px solid ${T.border}`,
      display: "flex",
      flexWrap: "wrap",
      gap: "0.5rem",
      alignItems: "center",
    }}>
      <Chip dark>Rank #{summary.rank}</Chip>
      <Chip>{summary.strategy}</Chip>
      <Chip dark={summary.treatment_intent === "curative"}>{summary.treatment_intent}</Chip>
      <Chip>Validation: {Math.round(summary.validation_score * 100)}%</Chip>
      <Chip>Guideline: {Math.round(summary.guideline_compliance_score * 100)}%</Chip>
      <Chip>Confidence: {Math.round(summary.confidence_score * 100)}%</Chip>
      {summary.requires_specialist_review && (
        <Chip dark>⚠️ Specialist Review</Chip>
      )}
    </div>
  );
};

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
      <div style={{ display: "flex", gap: "0.35rem", flexShrink: 0, marginLeft: "0.75rem" }}>
        <Chip>{proc.timing}</Chip>
        <Chip dark>Class {proc.recommendation_class}</Chip>
        <Chip>Evidence {proc.evidence_level}</Chip>
      </div>
    </div>
    <p style={{ fontSize: "0.78rem", fontWeight: 300, color: T.textSecondary, margin: "0 0 0.5rem", lineHeight: 1.6 }}>
      {proc.indication}
    </p>
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
    {proc.expected_complications?.length > 0 && (
      <div style={{ marginTop: "0.4rem" }}>
        <span style={{ fontSize: "0.6rem", color: T.textMuted, letterSpacing: "0.1em", textTransform: "uppercase", display: "block", marginBottom: "0.2rem" }}>Expected Complications</span>
        <div style={{ display: "flex", flexWrap: "wrap", gap: "0.25rem" }}>
          {proc.expected_complications.map((comp, i) => (
            <Chip key={i}>{comp}</Chip>
          ))}
        </div>
      </div>
    )}
    {proc.post_procedure_care?.length > 0 && (
      <div style={{ marginTop: "0.4rem" }}>
        <span style={{ fontSize: "0.6rem", color: T.textMuted, letterSpacing: "0.1em", textTransform: "uppercase", display: "block", marginBottom: "0.2rem" }}>Post-Procedure Care</span>
        <div style={{ display: "flex", flexWrap: "wrap", gap: "0.25rem" }}>
          {proc.post_procedure_care.map((care, i) => (
            <Chip key={i}>{care}</Chip>
          ))}
        </div>
      </div>
    )}
  </div>
);

/* ─────────────────────────────────────────────────────────────────────────────
   DRUG CARD
───────────────────────────────────────────────────────────────────────────── */
const DrugCard = ({ drug, index, total }) => {
  // Handle both formats: first_line_drugs (with drug_name) and first_line_drugs from API
  const drugName = drug.drug_name || drug.name || "Unknown Drug";
  const dose = drug.dose || drug.dosage || "";
  const frequency = drug.frequency || "";
  const indication = drug.indication || "";
  const guidelineRationale = drug.guideline_rationale || "";
  const patientSpecificReason = drug.patient_specific_reason || "";

  return (
    <div style={{
      padding: "1rem 1.25rem",
      borderBottom: index < total - 1 ? `1px solid ${T.border}` : "none",
      background: T.bgPrimary,
    }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "0.4rem" }}>
        <span style={{ fontSize: "0.88rem", fontWeight: 400, color: T.textPrimary }}>{drugName}</span>
        <div style={{ display: "flex", gap: "0.35rem", flexShrink: 0, marginLeft: "0.75rem" }}>
          {dose && <Chip>{dose}</Chip>}
          {frequency && <Chip>{frequency}</Chip>}
        </div>
      </div>
      {indication && (
        <p style={{ fontSize: "0.78rem", fontWeight: 300, color: T.textSecondary, margin: "0 0 0.5rem", lineHeight: 1.6 }}>
          {indication}
        </p>
      )}
      {isValidStr(guidelineRationale) && (
        <div style={{ marginTop: "0.4rem", paddingLeft: "0.75rem", borderLeft: `2px solid ${T.border}` }}>
          <span style={{ fontSize: "0.6rem", color: T.textMuted, letterSpacing: "0.1em", textTransform: "uppercase", display: "block", marginBottom: "0.2rem" }}>Guideline</span>
          <span style={{ fontSize: "0.75rem", fontWeight: 300, color: T.textSecondary }}>{guidelineRationale}</span>
        </div>
      )}
      {isValidStr(patientSpecificReason) && (
        <div style={{ marginTop: "0.4rem", paddingLeft: "0.75rem", borderLeft: `2px solid ${T.borderStrong}` }}>
          <span style={{ fontSize: "0.6rem", color: T.textMuted, letterSpacing: "0.1em", textTransform: "uppercase", display: "block", marginBottom: "0.2rem" }}>Patient-specific</span>
          <span style={{ fontSize: "0.75rem", fontWeight: 300, color: T.textSecondary }}>{patientSpecificReason}</span>
        </div>
      )}
    </div>
  );
};

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
        <Chip>{inv.urgency}</Chip>
        {inv.repeat_justified && <Chip dark>Repeat</Chip>}
      </div>
    </div>
    <p style={{ fontSize: "0.78rem", fontWeight: 300, color: T.textSecondary, margin: "0 0 0.5rem", lineHeight: 1.6 }}>
      {inv.indication}
    </p>
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
        <Chip>Evidence: {mod.evidence_strength}</Chip>
        <Chip>Difficulty: {mod.implementation_difficulty}</Chip>
      </div>
    </div>
    <p style={{ fontSize: "0.78rem", fontWeight: 300, color: T.textSecondary, margin: "0 0 0.5rem", lineHeight: 1.6 }}>
      {mod.specific_recommendation}
    </p>
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
   TREATMENT PLAN VIEW (Skill-Based)
───────────────────────────────────────────────────────────────────────────── */
const TreatmentPlanView = ({ plan, selectedSections, onSectionChange }) => {
  if (!plan) return null;

  // Get rank summary from ranked_summary if available
  const rankSummary = plan.rank_summary || null;

  return (
    <div>
      {/* Rank Summary */}
      {rankSummary && <RankSummaryCard summary={rankSummary} />}

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
            {plan.requires_specialist_review && <Chip dark>⚠️ Specialist Review</Chip>}
          </div>
          <ConfBar label="Confidence" value={plan.confidence_score || 0} />
          <ConfBar label="Guideline compliance" value={plan.guideline_compliance_score || 0} />
          <ConfBar label="Validation Score" value={plan.validation_result?.validation_score || 0} />
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

      {/* ── Validation Result (Warnings & Recommendations) ── */}
      {plan.validation_result && (
        <PlanSection
          title="Validation Result"
          sectionId="validation"
          checked={selectedSections.validation}
          onToggle={onSectionChange}
        >
          <div style={{ padding: "1rem 1.25rem", background: T.bgPrimary }}>
            {plan.validation_result.warnings?.length > 0 && (
              <div style={{ marginBottom: "0.75rem" }}>
                <span style={{ fontSize: "0.7rem", fontWeight: 400, color: "#dc2626", display: "block", marginBottom: "0.35rem" }}>
                  ⚠️ Warnings
                </span>
                {plan.validation_result.warnings.map((warning, i) => (
                  <div key={i} style={{ display: "flex", gap: "0.5rem", alignItems: "flex-start", marginBottom: "0.25rem" }}>
                    <span style={{ color: "#dc2626", fontSize: "0.75rem", flexShrink: 0, marginTop: "0.05rem" }}>—</span>
                    <span style={{ fontSize: "0.75rem", fontWeight: 300, color: T.textSecondary, lineHeight: 1.6 }}>{warning}</span>
                  </div>
                ))}
              </div>
            )}
            {plan.validation_result.recommendations_to_add?.length > 0 && (
              <div style={{ marginBottom: "0.75rem" }}>
                <span style={{ fontSize: "0.7rem", fontWeight: 400, color: T.textSecondary, display: "block", marginBottom: "0.35rem" }}>
                  ✓ Recommendations to Add
                </span>
                {plan.validation_result.recommendations_to_add.map((rec, i) => (
                  <div key={i} style={{ display: "flex", gap: "0.5rem", alignItems: "flex-start", marginBottom: "0.25rem" }}>
                    <span style={{ color: T.textMuted, fontSize: "0.75rem", flexShrink: 0, marginTop: "0.05rem" }}>•</span>
                    <span style={{ fontSize: "0.75rem", fontWeight: 300, color: T.textSecondary, lineHeight: 1.6 }}>{rec}</span>
                  </div>
                ))}
              </div>
            )}
            {plan.validation_result.recommendations_to_remove?.length > 0 && (
              <div style={{ marginBottom: "0.75rem" }}>
                <span style={{ fontSize: "0.7rem", fontWeight: 400, color: "#dc2626", display: "block", marginBottom: "0.35rem" }}>
                  ✗ Recommendations to Remove
                </span>
                {plan.validation_result.recommendations_to_remove.map((rec, i) => (
                  <div key={i} style={{ display: "flex", gap: "0.5rem", alignItems: "flex-start", marginBottom: "0.25rem" }}>
                    <span style={{ color: "#dc2626", fontSize: "0.75rem", flexShrink: 0, marginTop: "0.05rem" }}>—</span>
                    <span style={{ fontSize: "0.75rem", fontWeight: 300, color: T.textSecondary, lineHeight: 1.6 }}>{rec}</span>
                  </div>
                ))}
              </div>
            )}
            {plan.validation_result.safety_notes?.length > 0 && (
              <div style={{ marginBottom: "0.75rem" }}>
                <span style={{ fontSize: "0.7rem", fontWeight: 400, color: T.textSecondary, display: "block", marginBottom: "0.35rem" }}>
                  Safety Notes
                </span>
                {plan.validation_result.safety_notes.map((note, i) => (
                  <div key={i} style={{ display: "flex", gap: "0.5rem", alignItems: "flex-start", marginBottom: "0.25rem" }}>
                    <span style={{ color: T.textMuted, fontSize: "0.75rem", flexShrink: 0, marginTop: "0.05rem" }}>•</span>
                    <span style={{ fontSize: "0.75rem", fontWeight: 300, color: T.textSecondary, lineHeight: 1.6 }}>{note}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </PlanSection>
      )}

      {/* ── Retrieved Skills Summary ── */}
      {plan.retrieved_skills_summary?.length > 0 && (
        <PlanSection
          title="Retrieved Skills"
          sectionId="skills"
          checked={selectedSections.skills}
          onToggle={onSectionChange}
        >
          <div style={{ padding: "1rem 1.25rem", background: T.bgPrimary }}>
            {plan.retrieved_skills_summary.map((skill, i) => (
              <div key={i} style={{
                padding: "0.75rem",
                borderBottom: i < plan.retrieved_skills_summary.length - 1 ? `1px solid ${T.border}` : "none",
              }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: "0.5rem" }}>
                  <span style={{ fontSize: "0.82rem", fontWeight: 400, color: T.textPrimary }}>{skill.skill_name}</span>
                  <Chip>Score: {(skill.score * 100).toFixed(1)}%</Chip>
                </div>
                <p style={{ fontSize: "0.7rem", color: T.textMuted, margin: "0.25rem 0" }}>
                  {skill.disease_type} — {skill.subtype}
                </p>
                {skill.applied_recommendations?.length > 0 && (
                  <div style={{ marginTop: "0.25rem" }}>
                    <span style={{ fontSize: "0.6rem", color: T.textMuted, letterSpacing: "0.1em", textTransform: "uppercase" }}>Applied:</span>
                    <div style={{ display: "flex", flexWrap: "wrap", gap: "0.25rem", marginTop: "0.2rem" }}>
                      {skill.applied_recommendations.map((rec, ri) => (
                        <Chip key={ri}>{rec}</Chip>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            ))}
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
  let text = "\n\nTREATMENT PROTOCOL (Skill-Based)\n\n";

  if (sections.treatment_intent) {
    text += `TREATMENT INTENT\n${(plan.treatment_intent || "").toUpperCase()}\n\n`;
  }
  if (sections.primary_goals && plan.primary_goals?.length) {
    text += "PRIMARY GOALS\n";
    plan.primary_goals.forEach(g => { text += `  • ${g}\n`; });
    text += "\n";
  }
  
  // Procedures
  if (sections.procedures && plan.recommended_procedures?.length) {
    text += "RECOMMENDED PROCEDURES\n";
    plan.recommended_procedures.forEach(p => {
      text += `  • ${p.procedure_name}\n    - Indication: ${p.indication}\n    - Timing: ${p.timing}\n`;
      if (isValidStr(p.guideline_rationale)) text += `    - Guideline: ${p.guideline_rationale}\n`;
      if (isValidStr(p.patient_specific_reason)) text += `    - Patient Specific: ${p.patient_specific_reason}\n`;
    });
    text += "\n";
  }

  const appendDrugs = (label, drugs) => {
    if (!drugs?.length) return;
    text += `${label}\n`;
    drugs.forEach(d => {
      const name = d.drug_name || d.name || "Unknown";
      text += `  • ${name}\n`;
      if (d.dose || d.dosage) text += `    - Dose: ${d.dose || d.dosage}\n`;
      if (d.frequency) text += `    - Frequency: ${d.frequency}\n`;
      if (d.indication) text += `    - Indication: ${d.indication}\n`;
      if (isValidStr(d.guideline_rationale)) text += `    - Guideline: ${d.guideline_rationale}\n`;
      if (isValidStr(d.patient_specific_reason)) text += `    - Patient Specific: ${d.patient_specific_reason}\n`;
    });
    text += "\n";
  };
  if (sections.first_line_medications)   appendDrugs("FIRST-LINE MEDICATIONS",  plan.first_line_drugs);
  if (sections.adjunctive_medications)   appendDrugs("ADJUNCTIVE MEDICATIONS",  plan.adjunctive_drugs);

  if (sections.investigations && plan.required_investigations?.length) {
    text += "REQUIRED INVESTIGATIONS\n";
    plan.required_investigations.forEach(inv => {
      text += `  • ${inv.test_name}\n    - Indication: ${inv.indication}\n    - Urgency: ${inv.urgency}\n`;
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
  
  // Validation warnings
  if (sections.validation && plan.validation_result?.warnings?.length) {
    text += "VALIDATION WARNINGS\n";
    plan.validation_result.warnings.forEach(w => { text += `  • ⚠️ ${w}\n`; });
    text += "\n";
  }
  
  return text;
};

/* ─────────────────────────────────────────────────────────────────────────────
   MAIN COMPONENT - TreatmentPlanSkill
───────────────────────────────────────────────────────────────────────────── */
const TreatmentPlanSkill = ({
  open,
  onClose,
  onApprove,
  doctorId,
  patientId,
  primaryDiagnosis,
  reasonForDiagnosis,
}) => {
  const [loading, setLoading] = useState(false);
  const [response, setResponse] = useState(null);
  const [error, setError] = useState(null);
  const [selectedTab, setSelectedTab] = useState(0);
  const [approved, setApproved] = useState(false);
  const [activeAgent, setActiveAgent] = useState(0);
  const [progress, setProgress] = useState(5);
  const [showContent, setShowContent] = useState(false);
  const [isTransitioning, setIsTransitioning] = useState(false);
  
  const [selectedSections, setSelectedSections] = useState({
    treatment_intent:         true,
    primary_goals:            true,
    procedures:               true,
    first_line_medications:   true,
    adjunctive_medications:   true,
    investigations:           true,
    lifestyle:                true,
    follow_up:                true,
    validation:               true,
    skills:                   true,
  });

  const handleSectionChange = (sectionId, val) => {
    setSelectedSections(prev => ({ ...prev, [sectionId]: val }));
  };

  const generateTreatmentPlan = async () => {
    setLoading(true);
    setError(null);
    setResponse(null);
    setSelectedTab(0);
    setApproved(false);
    setShowContent(false);
    setIsTransitioning(false);
    
    try {
      const requestData = {
        patient_id: patientId,
        doctor_id: doctorId,
        primary_diagnosis: primaryDiagnosis || "",
        reason_for_diagnosis: reasonForDiagnosis || "",
      };

      console.log("📤 Sending treatment plan request to skill endpoint:", requestData);

      const res = await fetch(`${API_BASE_URL}hms/users/ai-legacy/generate-treatment-plan/skill`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(requestData),
      });

      if (!res.ok) {
        const errorText = await res.text();
        throw new Error(`Failed to generate treatment plan: ${res.status} - ${errorText}`);
      }

      const data = await res.json();
      console.log("✅ Treatment Plan Skill Response:", data);
      
      // Map ranked_summary to each treatment plan
      if (data.treatment_plans && data.ranked_summary) {
        data.treatment_plans = data.treatment_plans.map((plan, index) => {
          const summary = data.ranked_summary.find(s => s.rank === plan.rank);
          return {
            ...plan,
            rank_summary: summary || null,
          };
        });
      }
      
      setResponse(data);
    } catch (err) {
      console.error("❌ Treatment Plan Error:", err);
      setError(err.message);
    } finally {
      // The loading will be handled by the useEffect that watches response
    }
  };

  // Agent swarm animation
  useEffect(() => {
    if (!loading) return;

    let i = 0;
    let isComplete = false;
    
    const processNextAgent = () => {
      if (isComplete) return;
      
      if (i < AGENT_SWARM.length - 1) {
        setActiveAgent(i);
        setProgress(((i + 1) / AGENT_SWARM.length) * 100);
        i++;
        
        if (i < AGENT_SWARM.length - 1) {
          const randomDelay = 500 + Math.random() * 1300;
          setTimeout(processNextAgent, randomDelay);
        } else {
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
      let currentProgress = 90;
      const interval = setInterval(() => {
        if (currentProgress < 100) {
          currentProgress += 2;
          setProgress(currentProgress);
        } else {
          clearInterval(interval);
          setIsTransitioning(true);
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
    if (open && primaryDiagnosis) {
      generateTreatmentPlan();
    }
  }, [open, primaryDiagnosis, reasonForDiagnosis, patientId, doctorId]);

  const handleApprove = async () => {
    if (response && response.treatment_plans && response.treatment_plans[selectedTab]) {
      const plan = response.treatment_plans[selectedTab];
      const formattedPlan = formatTreatmentPlanForDictation(plan, selectedSections);

      // Verify API call
      try {
        await fetch(`${API_BASE_URL}hms/users/data/context/verify-treatment-plan`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            tag: "treatment_plan_skill",
            doctor_id: doctorId,
            patient_id: patientId,
            treatment_plan_data: plan,
            formatted_plan: formattedPlan,
            primary_diagnosis: primaryDiagnosis,
            reason_for_diagnosis: reasonForDiagnosis,
          }),
        });
      } catch (err) {
        console.error("Treatment verify API failed:", err);
      }

      // Append to dictation
      if (onApprove) {
        onApprove(formattedPlan);
      }

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
          {/* Backdrop */}
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

          {/* Popup */}
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
            {/* Header */}
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
                  Treatment Plans (Skill-Based)
                </span>
                {primaryDiagnosis && (
                  <span style={{ fontSize: "0.7rem", color: T.textMuted, fontStyle: "italic" }}>
                    Based on: {primaryDiagnosis}
                  </span>
                )}
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

            {/* Tabs */}
            {plans.length > 0 && (
              <TabRow
                plans={plans}
                selectedTab={selectedTab}
                onTabChange={(i) => { setSelectedTab(i); setApproved(false); }}
              />
            )}

            {/* Body */}
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
                  <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                    <SectionLabel>AI Clinical Engine</SectionLabel>
                    <span style={{ 
                      fontSize: "0.9rem", 
                      fontWeight: 400, 
                      color: T.textPrimary, 
                      letterSpacing: "-0.01em" 
                    }}>
                      {progress >= 100 ? "Finalizing Treatment Plan" : "Generating Treatment Plan with Skills"}
                    </span>
                  </div>

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
                          <span style={{
                            fontSize: "0.75rem",
                            fontWeight: (isActive || isLastAndWaiting) ? 400 : 300,
                            color: isDone ? T.textPrimary : (isActive || isLastAndWaiting) ? T.textSecondary : T.textMuted,
                            letterSpacing: "0.02em",
                          }}>
                            {agent.label}
                          </span>
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
                        Finalizing treatment plan with skills. This may take a few moments...
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

            {/* Footer */}
            {plans.length > 0 && !loading && (
              <div style={{
                display: "flex", justifyContent: "space-between", alignItems: "center",
                padding: "0.875rem 1.5rem",
                borderTop: `1px solid ${T.border}`,
                background: T.bgSecondary,
                flexShrink: 0,
              }}>
                <span style={{ fontSize: "0.65rem", fontWeight: 300, color: T.textMuted, fontStyle: "italic" }}>
                  Clinical intelligence with specialized skills.
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

export default TreatmentPlanSkill;