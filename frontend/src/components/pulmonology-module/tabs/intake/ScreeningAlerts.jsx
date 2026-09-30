import React, { useEffect, useMemo, useState } from "react";
import Section from "../../components/Section";
import FormField from "../../components/FormField";
import VoiceDictationPanel from "../../components/VoiceDictationPanel";
import { usePulmonology } from "../../context/PulmonologyContext";
import { getDiagnosticCompleteness } from "../diagnostics/DiagnosticsOverviewTab";
import { evaluateClinicalPathway, PATHWAY_TYPES } from "../../utils/clinicalPathwayEngine";

// ---- Small pure helpers (no side effects, easy to unit-test later) ----

function calcAgeFromDob(dobStr) {
  if (!dobStr) return null;
  const dob = new Date(dobStr);
  if (isNaN(dob.getTime())) return null;
  const diffMs = Date.now() - dob.getTime();
  return Math.floor(diffMs / (1000 * 60 * 60 * 24 * 365.25));
}

function getGoldStage(fev1Pct) {
  if (isNaN(fev1Pct)) return "";
  if (fev1Pct >= 80) return "GOLD 1 (Mild)";
  if (fev1Pct >= 50) return "GOLD 2 (Moderate)";
  if (fev1Pct >= 30) return "GOLD 3 (Severe)";
  return "GOLD 4 (Very Severe)";
}

// BODE Index: BMI, Obstruction (FEV1%), Dyspnea (mMRC), Exercise (6MWT).
// Published point table, 0-10 total. This is arithmetic, not judgment —
// same category of "safe to automate" as GOLD group.
function calcBode({ bmi, fev1Pct, mmrc, sixMwtM }) {
  if ([bmi, fev1Pct, mmrc, sixMwtM].some((v) => v === null || v === undefined || isNaN(v))) {
    return null;
  }
  let points = 0;
  points += bmi > 21 ? 0 : 1;
  if (fev1Pct >= 65) points += 0;
  else if (fev1Pct >= 50) points += 1;
  else if (fev1Pct >= 36) points += 2;
  else points += 3;
  if (mmrc <= 1) points += 0;
  else if (mmrc === 2) points += 1;
  else if (mmrc === 3) points += 2;
  else points += 3;
  if (sixMwtM >= 350) points += 0;
  else if (sixMwtM >= 250) points += 1;
  else if (sixMwtM >= 150) points += 2;
  else points += 3;

  let riskBand = "";
  if (points <= 2) riskBand = "Low (0-2)";
  else if (points <= 4) riskBand = "Moderate (3-4)";
  else if (points <= 6) riskBand = "High (5-6)";
  else riskBand = "Very High (7-10)";

  return { points, riskBand };
}

// GAP Index (ILD): Gender, Age, two Physiology variables (FVC%, DLCO%).
function calcGap({ sex, age, fvcPct, dlcoPct }) {
  if (!sex || age === null || isNaN(fvcPct) || isNaN(dlcoPct)) return null;
  let points = 0;
  points += sex === "Male" ? 1 : 0;
  if (age <= 60) points += 0;
  else if (age <= 65) points += 1;
  else points += 2;
  if (fvcPct > 75) points += 0;
  else if (fvcPct >= 50) points += 1;
  else points += 2;
  if (dlcoPct > 55) points += 0;
  else if (dlcoPct >= 36) points += 1;
  else points += 2;

  let stage = "";
  if (points <= 3) stage = "Stage I (Low Risk)";
  else if (points <= 5) stage = "Stage II (Intermediate Risk)";
  else stage = "Stage III (High Risk)";

  return { points, stage };
}

function interpretAct(total) {
  if (isNaN(total)) return "";
  if (total >= 20) return "Well Controlled";
  if (total >= 16) return "Not Well Controlled";
  return "Very Poorly Controlled";
}

// Simplified FACED (bronchiectasis severity): FEV1, Age, chronic
// Pseudomonas colonization, radiographic Extension, Dyspnea (mMRC).
function calcFaced({ fev1Pct, age, pseudomonas, extension, mmrc }) {
  if (isNaN(fev1Pct) || age === null || !pseudomonas || !extension || isNaN(mmrc)) return null;
  let points = 0;
  points += fev1Pct < 50 ? 2 : 0;
  points += age > 70 ? 2 : 0;
  points += pseudomonas === "Yes" ? 1 : 0;
  points += extension === ">2 Lobes" ? 1 : 0;
  points += mmrc >= 3 ? 1 : 0;

  let severity = "";
  if (points <= 2) severity = "Mild (0-2)";
  else if (points <= 4) severity = "Moderate (3-4)";
  else severity = "Severe (5-7)";
  return { points, severity };
}

const ScreeningAlertsTab = () => {
  const { formData, updateField, updateFields, setTrack, setActiveTab } = usePulmonology();

  const completeness = useMemo(
    () => getDiagnosticCompleteness(formData),
    [
      formData.pulm_current_fev1_pct,
      formData.pulm_current_6mwt_m,
      formData.pulm_current_pao2,
      formData.pft_fev1_pct,
      formData.mwt_distance,
      formData.abg_pao2,
    ]
  );

  const pathwayDecision = useMemo(() => evaluateClinicalPathway(formData), [formData]);

  useEffect(() => {
    if (pathwayDecision?.pathway && formData.calc_recommended_pathway !== pathwayDecision.pathway) {
      updateField("calc_recommended_pathway", pathwayDecision.pathway);
      updateField("calc_pathway_title", pathwayDecision.title);
      updateField("calc_pathway_suggested_proc", pathwayDecision.interventions?.[0]?.name || "");
    }
  }, [pathwayDecision, formData.calc_recommended_pathway, updateField]);

  const primaryDx = formData.pulm_primary_dx;
  const isCopdFamily = primaryDx === "COPD" || primaryDx === "Asthma-COPD Overlap";
  const isAsthma = primaryDx === "Asthma";
  const isIld = primaryDx === "ILD / Fibrosis";
  const isBronchiectasis = primaryDx === "Bronchiectasis";
  const isPh = primaryDx === "Pulmonary Hypertension";

  const mmrc = parseInt(formData.score_mmrc, 10);
  const cat = parseInt(formData.score_cat, 10);
  const exac = parseInt(formData.hx_exac_count, 10);

  // Real-time resolution: read pulm_current_* first, then fall back immediately to live procedure fields
  const effectiveFev1 = formData.pulm_current_fev1_pct || formData.pft_fev1_pct || formData.pft_fev1_post_pct;
  const effectiveFvc = formData.pulm_current_fvc_pct || formData.pft_fvc_pct;
  const effectiveDlco = formData.pulm_current_dlco_pct || formData.pft_dlco_pct;
  const effective6mwt = formData.pulm_current_6mwt_m || formData.mwt_distance;
  const effectivePao2 = formData.pulm_current_pao2 || formData.abg_pao2;
  const effectivePaco2 = formData.pulm_current_paco2 || formData.abg_paco2;

  const fev1Pct = parseFloat(effectiveFev1);
  const fvcPct = parseFloat(effectiveFvc);
  const dlcoPct = parseFloat(effectiveDlco);
  const sixMwtM = parseFloat(effective6mwt);
  const pao2 = parseFloat(effectivePao2);
  const paco2 = parseFloat(effectivePaco2);
  const bmi = parseFloat(formData.pulm_clinical_bmi);
  const spo2 = parseFloat(formData.pulm_baseline_spo2);
  const age = calcAgeFromDob(formData.pt_dob);

  // Auto-sync procedure values to root physiological keys if not explicitly filled
  useEffect(() => {
    const updates = {};
    if (!formData.pulm_current_fev1_pct && effectiveFev1) updates.pulm_current_fev1_pct = String(effectiveFev1);
    if (!formData.pulm_current_fvc_pct && effectiveFvc) updates.pulm_current_fvc_pct = String(effectiveFvc);
    if (!formData.pulm_current_dlco_pct && effectiveDlco) updates.pulm_current_dlco_pct = String(effectiveDlco);
    if (!formData.pulm_current_6mwt_m && effective6mwt) updates.pulm_current_6mwt_m = String(effective6mwt);
    if (!formData.pulm_current_pao2 && effectivePao2) updates.pulm_current_pao2 = String(effectivePao2);
    if (!formData.pulm_current_paco2 && effectivePaco2) updates.pulm_current_paco2 = String(effectivePaco2);

    if (Object.keys(updates).length > 0) {
      if (typeof updateFields === "function") {
        updateFields(updates);
      } else {
        Object.entries(updates).forEach(([k, v]) => updateField(k, v));
      }
    }
  }, [
    effectiveFev1,
    effectiveFvc,
    effectiveDlco,
    effective6mwt,
    effectivePao2,
    effectivePaco2,
    formData.pulm_current_fev1_pct,
    formData.pulm_current_fvc_pct,
    formData.pulm_current_dlco_pct,
    formData.pulm_current_6mwt_m,
    formData.pulm_current_pao2,
    formData.pulm_current_paco2,
    updateField,
    updateFields,
  ]);

  // Derive effective mMRC from explicit score_mmrc or active respiratory symptoms
  const effectiveMmrc = useMemo(() => {
    if (!isNaN(mmrc)) return mmrc;
    const sx = formData.pulm_symptoms || {};
    const isRest = Array.isArray(sx) ? sx.includes("dyspnea_rest") : !!sx.dyspnea_rest;
    const isExertional = Array.isArray(sx) ? sx.includes("dyspnea_exertional") : !!sx.dyspnea_exertional;
    if (isRest) return 3;
    if (isExertional) return 2;
    return NaN;
  }, [mmrc, formData.pulm_symptoms]);

  // Auto-populate score_mmrc if empty and symptoms indicate dyspnea
  useEffect(() => {
    if ((formData.score_mmrc === undefined || formData.score_mmrc === "") && !isNaN(effectiveMmrc)) {
      updateField("score_mmrc", String(effectiveMmrc));
    }
  }, [effectiveMmrc, formData.score_mmrc, updateField]);

  // GOLD Group (A/B/E) — aligned with GOLD 2023/2024 recommendations:
  // In GOLD 2023/2024, ≥2 moderate exacerbations or ≥1 hospitalization places the patient in Group E regardless of symptoms.
  // Otherwise, mMRC (or CAT) separates Group A from Group B.
  useEffect(() => {
    if (!isCopdFamily) return;
    let group = "";
    if (!isNaN(exac) && exac >= 2) {
      group = "Group E (High Risk Exacerbator)";
    } else {
      const activeMmrc = !isNaN(mmrc) ? mmrc : effectiveMmrc;
      const highlySymptomatic = (!isNaN(cat) && cat >= 10) || (!isNaN(activeMmrc) && activeMmrc >= 2);
      if (!isNaN(exac)) {
        if (highlySymptomatic) group = "Group B (More Symptoms, Low Risk)";
        else group = "Group A (Less Symptoms, Low Risk)";
      } else if (highlySymptomatic) {
        group = "Group B (More Symptoms)";
      }
    }
    if (group && formData.calc_gold_group !== group) {
      updateField("calc_gold_group", group);
    }
  }, [isCopdFamily, mmrc, cat, exac, effectiveMmrc, formData.calc_gold_group, updateField]);

  // GOLD Stage (spirometric grade)
  useEffect(() => {
    if (!isCopdFamily) return;
    const stage = getGoldStage(fev1Pct);
    if (stage && formData.calc_gold_stage !== stage) updateField("calc_gold_stage", stage);
  }, [isCopdFamily, fev1Pct, formData.calc_gold_stage, updateField]);

  // BODE Index — auto-calculated from BMI, FEV1%, mMRC (explicit or symptom-derived), and 6MWT
  const activeBodeMmrc = !isNaN(mmrc) ? mmrc : effectiveMmrc;
  const bode = useMemo(
    () => (isCopdFamily ? calcBode({ bmi, fev1Pct, mmrc: activeBodeMmrc, sixMwtM }) : null),
    [isCopdFamily, bmi, fev1Pct, activeBodeMmrc, sixMwtM]
  );
  useEffect(() => {
    if (!bode) return;
    const label = `${bode.points} pts — ${bode.riskBand}`;
    if (formData.score_bode !== label) updateField("score_bode", label);
  }, [bode, formData.score_bode, updateField]);

  // GAP Index — ILD only.
  const gap = useMemo(
    () => (isIld ? calcGap({ sex: formData.pt_sex, age, fvcPct, dlcoPct }) : null),
    [isIld, formData.pt_sex, age, fvcPct, dlcoPct]
  );
  useEffect(() => {
    if (!gap) return;
    const label = `${gap.points} pts — ${gap.stage}`;
    if (formData.score_gap !== label) updateField("score_gap", label);
  }, [gap, formData.score_gap, updateField]);

  // ACT interpretation — Asthma only. The total is entered (it's a 5-item
  // patient questionnaire we don't have sub-items for here), but the banding
  // is a fixed cutoff, so that part is safe to automate.
  const actTotal = parseInt(formData.score_act, 10);
  useEffect(() => {
    if (!isAsthma) return;
    const label = interpretAct(actTotal);
    if (label && formData.calc_act_interpretation !== label) {
      updateField("calc_act_interpretation", label);
    }
  }, [isAsthma, actTotal, formData.calc_act_interpretation, updateField]);

  // FACED — Bronchiectasis only.
  const faced = useMemo(
    () =>
      isBronchiectasis
        ? calcFaced({
            fev1Pct,
            age,
            pseudomonas: formData.bx_pseudomonas,
            extension: formData.bx_extension,
            mmrc,
          })
        : null,
    [isBronchiectasis, fev1Pct, age, formData.bx_pseudomonas, formData.bx_extension, mmrc]
  );
  useEffect(() => {
    if (!faced) return;
    const label = `${faced.points} pts — ${faced.severity}`;
    if (formData.score_faced !== label) updateField("score_faced", label);
  }, [faced, formData.score_faced, updateField]);

  // O2-need-vs-prescribed mismatch: flags patients who meet resting
  // hypoxemia criteria but have no home O2 recorded — a real gap, vs. a
  // toggle someone has to remember to flip.
  useEffect(() => {
    if (isNaN(spo2)) return;
    const meetsO2Criteria = spo2 < 88;
    const hasO2Prescribed = !!formData.med_o2_flow && parseFloat(formData.med_o2_flow) > 0;
    const flag = meetsO2Criteria
      ? hasO2Prescribed
        ? "Active (Criteria Met, O2 Prescribed)"
        : "Active (Criteria Met, NOT Prescribed — Review)"
      : "Inactive";
    if (formData.alert_hypoxemia !== flag) updateField("alert_hypoxemia", flag);
  }, [spo2, formData.med_o2_flow, formData.alert_hypoxemia, updateField]);

  // Transplant referral flag — rule-based instead of a free dropdown, using
  // criteria that vary by disease (BODE for COPD, GAP for ILD).
  useEffect(() => {
    let flag = "";
    if (isCopdFamily && bode) {
      if (bode.points >= 7 || fev1Pct < 20) flag = "Urgent Referral (Rank 1)";
      else if (bode.points >= 5) flag = "Consider Referral";
      else flag = "Not Indicated";
    } else if (isIld && gap) {
      if (gap.points >= 6) flag = "Urgent Referral (Rank 1)";
      else if (gap.points >= 4) flag = "Consider Referral";
      else flag = "Not Indicated";
    }
    if (flag && formData.alert_tx_triage !== flag) updateField("alert_tx_triage", flag);
  }, [isCopdFamily, isIld, bode, gap, fev1Pct, formData.alert_tx_triage, updateField]);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "20px" }}>
      {/* 0. Diagnostic Completeness Gating Indicator */}
      <div
        style={{
          border: `1px solid ${completeness.isComplete ? "#81c784" : "#ffb74d"}`,
          backgroundColor: completeness.isComplete ? "#f0fdf4" : "#fff8e1",
          padding: "12px 16px",
          borderRadius: "2px",
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
        }}
      >
        <div>
          <span
            style={{
              fontSize: "10.5px",
              fontWeight: 700,
              textTransform: "uppercase",
              letterSpacing: "0.05em",
              backgroundColor: completeness.isComplete ? "#2e7d32" : "#f57c00",
              color: "#fff",
              padding: "2px 8px",
              borderRadius: "2px",
              marginRight: "8px",
            }}
          >
            {completeness.isComplete ? "Diagnostics Complete" : "Diagnostics Pending"}
          </span>
          <span style={{ fontSize: "12.5px", fontWeight: 600, color: "#222" }}>
            {completeness.status}
          </span>
          {(formData.pft_fev1_pct || formData.mwt_distance || formData.abg_pao2 || formData.last_proc_synced_at) && (
            <span style={{ fontSize: "11px", color: "#166534", fontWeight: 600, display: "block", marginTop: "3px" }}>
              ✓ Real-time sync active: Diagnostic procedures recorded in Procedure Notes automatically feed scores below {formData.last_proc_synced_at ? `(synced at ${formData.last_proc_synced_at})` : ""}.
            </span>
          )}
          {!completeness.isComplete && !formData.pft_fev1_pct && (
            <span style={{ fontSize: "11.5px", color: "#666", display: "block", marginTop: "2px" }}>
              Core physiological inputs (FEV1%, 6MWT distance, or PaO2) can be entered in Diagnostics Hub or documented in Procedure Notes.
            </span>
          )}
        </div>
        <button
          onClick={() => setActiveTab("diag_overview")}
          style={{
            padding: "5px 12px",
            fontSize: "11.5px",
            fontWeight: 600,
            background: "#000",
            color: "#fff",
            border: "none",
            cursor: "pointer",
            whiteSpace: "nowrap",
          }}
        >
          Open Diagnostics Hub →
        </button>
      </div>

      <VoiceDictationPanel section="Screening & Clinical Alerts" />

      {/* 1. Automated Care Pathway Decision & Escalation Engine */}
      <Section
        id="sec_pathway"
        title="Clinical Care Pathway & Triage Engine"
        variant="dark"
        note="Algorithmic synthesis of Imaging, ABG, PFT, and Risk Scores to route between Medical Airway Mgmt, Advanced Procedures, and Transplant"
      >
        <div
          style={{
            border: `1px solid ${pathwayDecision.urgency.border}`,
            background: pathwayDecision.urgency.bg,
            padding: "16px 18px",
            marginBottom: "16px",
            borderRadius: "2px",
          }}
        >
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: "10px", marginBottom: "8px" }}>
            <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
              <span
                style={{
                  fontSize: "10.5px",
                  fontWeight: 700,
                  textTransform: "uppercase",
                  letterSpacing: "0.06em",
                  backgroundColor: pathwayDecision.urgency.color,
                  color: "#ffffff",
                  padding: "3px 8px",
                  borderRadius: "2px",
                }}
              >
                {pathwayDecision.badge}
              </span>
              <span
                style={{
                  fontSize: "10px",
                  fontWeight: 700,
                  letterSpacing: "0.05em",
                  textTransform: "uppercase",
                  border: `1px solid ${pathwayDecision.urgency.color}`,
                  color: pathwayDecision.urgency.color,
                  padding: "2px 6px",
                  borderRadius: "2px",
                  background: "#ffffff",
                }}
              >
                {pathwayDecision.urgency.label}
              </span>
            </div>
            <span style={{ fontSize: "11px", color: "#555", fontWeight: 600 }}>
              ISHLT / ATS / GOLD Decision Support
            </span>
          </div>

          <h4 style={{ margin: "4px 0 8px 0", fontSize: "14px", fontWeight: 700, color: pathwayDecision.urgency.color }}>
            {pathwayDecision.title}
          </h4>

          <p style={{ margin: "0 0 14px 0", fontSize: "12.5px", color: "#222", lineHeight: "1.5" }}>
            {pathwayDecision.primaryReason}
          </p>

          <div style={{ display: "grid", gridTemplateColumns: "1.2fr 1fr", gap: "16px", background: "#ffffff", border: `1px solid ${pathwayDecision.urgency.border}`, padding: "14px", marginBottom: "14px" }}>
            <div>
              <div style={{ fontSize: "10.5px", fontWeight: 700, textTransform: "uppercase", color: "#666", marginBottom: "6px" }}>
                Identified Clinical Triggers & Evidence:
              </div>
              {pathwayDecision.triggers.length === 0 ? (
                <div style={{ fontSize: "12px", color: "#888", fontStyle: "italic" }}>
                  No acute anatomical or severe physiological triggers detected. Standard baseline parameters.
                </div>
              ) : (
                <ul style={{ margin: 0, paddingLeft: "18px", fontSize: "12px", color: "#333", lineHeight: "1.6" }}>
                  {pathwayDecision.triggers.map((trig, idx) => (
                    <li key={idx}>
                      <b style={{ color: trig.severity === "EMERGENCY" || trig.severity === "URGENT" ? "#c62828" : "#2e7d32" }}>
                        [{trig.category}]
                      </b>{" "}
                      {trig.detail}
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <div>
              <div style={{ fontSize: "10.5px", fontWeight: 700, textTransform: "uppercase", color: "#666", marginBottom: "6px" }}>
                Recommended Clinical Action(s):
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                {pathwayDecision.interventions.map((interv, idx) => (
                  <div key={idx} style={{ padding: "8px 10px", background: "#f9f9f9", borderLeft: `3px solid ${pathwayDecision.urgency.color}`, fontSize: "11.5px" }}>
                    <b>{interv.name}</b>
                    <div style={{ color: "#555", fontSize: "11px", marginTop: "2px" }}>{interv.note}</div>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Interactive Direct-Action Buttons */}
          <div style={{ display: "flex", gap: "10px", flexWrap: "wrap", alignItems: "center" }}>
            {pathwayDecision.pathway === PATHWAY_TYPES.ADVANCED_PROCEDURE && (
              <>
                {pathwayDecision.suggestedTrack === "monitoring" ? (
                  <button
                    type="button"
                    onClick={() => setTrack("monitoring")}
                    style={{
                      padding: "8px 18px",
                      fontSize: "12px",
                      fontWeight: 700,
                      background: "#2e7d32",
                      color: "#ffffff",
                      border: "none",
                      cursor: "pointer",
                      borderRadius: "2px",
                    }}
                  >
                    Proceed to Post-Procedure Monitoring →
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={() => {
                      window.dispatchEvent(
                        new CustomEvent("open_procedure_notes", {
                          detail: { procedure: "Pulmonology Procedures", subProcedure: pathwayDecision.suggestedTab || "nivtitr" },
                        })
                      );
                      alert(`To document ${pathwayDecision.interventions[0]?.name || "Procedure"}, please open the "Procedure Notes" workspace from the menu. Results saved there will automatically update Diagnostics & Screening and advance the encounter to Post-Procedure Monitoring.`);
                    }}
                    style={{
                      padding: "7px 16px",
                      fontSize: "12px",
                      fontWeight: 700,
                      background: pathwayDecision.urgency.color,
                      color: "#ffffff",
                      border: "none",
                      cursor: "pointer",
                    }}
                  >
                    Open in Procedure Notes ({pathwayDecision.interventions[0]?.name || "Procedure"}) →
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => {
                    setTrack("airway");
                    setActiveTab("meds");
                  }}
                  style={{
                    padding: "7px 14px",
                    fontSize: "12px",
                    fontWeight: 600,
                    background: "#ffffff",
                    color: "#333333",
                    border: "1px solid #cccccc",
                    cursor: "pointer",
                  }}
                >
                  Proceed to Airway Mgmt (Medical Route) →
                </button>
              </>
            )}

            {pathwayDecision.pathway === PATHWAY_TYPES.AIRWAY_MGMT && (
              <>
                <button
                  type="button"
                  onClick={() => {
                    setTrack("airway");
                    setActiveTab("meds");
                  }}
                  style={{
                    padding: "7px 16px",
                    fontSize: "12px",
                    fontWeight: 700,
                    background: "#000000",
                    color: "#ffffff",
                    border: "none",
                    cursor: "pointer",
                  }}
                >
                  Proceed to Airway Mgmt (Medications & Dosing) →
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setTrack("airway");
                    setActiveTab("airway_support");
                  }}
                  style={{
                    padding: "7px 14px",
                    fontSize: "12px",
                    fontWeight: 600,
                    background: "#ffffff",
                    color: "#333333",
                    border: "1px solid #cccccc",
                    cursor: "pointer",
                  }}
                >
                  Oxygen & Airway Support →
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setTrack("airway");
                    setActiveTab("plan");
                  }}
                  style={{
                    padding: "7px 14px",
                    fontSize: "12px",
                    fontWeight: 600,
                    background: "#ffffff",
                    color: "#333333",
                    border: "1px solid #cccccc",
                    cursor: "pointer",
                  }}
                >
                  Care Plan →
                </button>
              </>
            )}

            {pathwayDecision.pathway === PATHWAY_TYPES.TRANSPLANT_EVAL && (
              <>
                <button
                  type="button"
                  onClick={() => {
                    setActiveTab("diag_overview");
                  }}
                  style={{
                    padding: "7px 16px",
                    fontSize: "12px",
                    fontWeight: 700,
                    background: "#b71c1c",
                    color: "#ffffff",
                    border: "none",
                    cursor: "pointer",
                  }}
                >
                  Review Diagnostic Evaluation & Workup →
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setTrack("airway");
                    setActiveTab("meds");
                  }}
                  style={{
                    padding: "7px 14px",
                    fontSize: "12px",
                    fontWeight: 600,
                    background: "#ffffff",
                    color: "#333333",
                    border: "1px solid #cccccc",
                    cursor: "pointer",
                  }}
                >
                  Proceed to Airway Mgmt (Medical Route) →
                </button>
              </>
            )}
          </div>
        </div>

        {/* Clinician Decision & Override */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "20px", marginTop: "12px" }}>
          <FormField
            label="CLINICIAN PATHWAY DISPOSITION"
            name="pathway_clinician_decision"
            type="select"
            options={[
              "",
              "Accepted Algorithmic Pathway",
              "Overridden: Proceed with Medical Airway Management Only",
              "Overridden: Proceed with Bedside Procedural Intervention",
              "Overridden: Conservative / Palliative Approach",
              "Patient Declined Intervention at this time",
            ]}
          />
          <FormField
            label="CLINICIAN JUSTIFICATION / OVERRIDE NOTES"
            name="pathway_clinician_rationale"
            type="textarea"
            placeholder="Document clinical justification if overriding automated decision or tailoring intervention..."
          />
        </div>
      </Section>

      {/* 2. Alerts Board */}
      <Section id="sec_alerts" title="Clinical Action Board: Critical Alerts & Triage" variant="dark" note="High-priority automated routing based on derived clinical scores.">
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "20px" }}>
          <div style={{ padding: "12px", background: "#fff5f5", border: "1px solid #ffcccc", borderRadius: "4px" }}>
            <h4 style={{ margin: "0 0 10px 0", fontSize: "12px", color: "#cc0000", textTransform: "uppercase" }}>Abnormal Threshold Alerts</h4>
            <FormField label="FEV1 < 30% Alert" name="alert_fev1_low" type="select" options={["", "Active", "Inactive"]} />
            <FormField label="Rapid FEV1 Decline (>40 mL/year)" name="alert_fev1_rapid" type="select" options={["", "Active", "Inactive"]} />
            <FormField label="Resting Hypoxemia / O2 Need (Auto-Calculated)" name="alert_hypoxemia" type="derived" placeholder="Flags SpO2 <88% without home O2 prescribed" />
          </div>
          <div style={{ padding: "12px", background: "#f9f9f9", border: "1px solid #e0e0e0", borderRadius: "4px" }}>
            <h4 style={{ margin: "0 0 10px 0", fontSize: "12px", color: "#666666", textTransform: "uppercase" }}>Automated Routing & Triage</h4>
            <FormField label="Transplant Referral Triage (Auto-Calculated)" name="alert_tx_triage" type="derived" placeholder="Not available for this diagnosis without BODE/GAP inputs" />
            <FormField label="Alert Priority" name="alert_priority" type="select" options={["", "Routine", "Urgent", "Critical"]} />
            <FormField label="Routing Action" name="alert_routing" type="select" options={["", "Direct to Pulmonology", "Refer to Lung Transplant", "Palliative Care Consult"]} />
            {formData.alert_tx_triage && formData.alert_tx_triage !== "Not Indicated" && (
              <button
                type="button"
                onClick={() => setActiveTab("transplant")}
                style={{
                  marginTop: "10px",
                  padding: "5px 12px",
                  fontSize: "11px",
                  fontWeight: 600,
                  background: "#b71c1c",
                  color: "#fff",
                  border: "none",
                  cursor: "pointer",
                }}
              >
                Open Transplant Evaluation →
              </button>
            )}
          </div>
        </div>
      </Section>

      {/* 2. Disease-specific scoring engines below */}
      <div id="sec_scoring" style={{ scrollMarginTop: "24px" }}>
        {!primaryDx && (
          <Section title="Disease-Specific Scoring Engines" note="Select a Primary Pulmonary Diagnosis on the Baseline tab to load the correct scoring tools.">
            <div style={{ padding: "12px", background: "#fff8e6", border: "1px solid #f0d98c", borderRadius: "4px", fontSize: "12px", color: "#7a5c00" }}>
              No diagnosis selected yet. COPD-specific tools (GOLD, BODE) will not display for Asthma, ILD, Bronchiectasis, or Pulmonary Hypertension patients — set the diagnosis first so the right tools show up.
            </div>
          </Section>
        )}

        {isCopdFamily && (
          <Section title="COPD Scoring — GOLD & BODE" note="Calculates validated COPD severity and mortality-risk scores.">
            <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "20px" }}>
              <FormField label="mMRC Dyspnea Scale (0-4)" name="score_mmrc" type="number" placeholder="Enter 0 to 4" />
              <FormField label="CAT Score (0-40)" name="score_cat" type="number" placeholder="Enter total score" />
              <FormField label="STOP-BANG (Sleep Apnea)" name="score_stopbang" type="select" options={["", "Low Risk (0-2)", "Intermediate (3-4)", "High (5-8)"]} />
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "20px", marginTop: "20px" }}>
              <FormField
                label="GOLD Group (Auto-Calculated)"
                name="calc_gold_group"
                type="derived"
                derivedValue={formData.calc_gold_group || (!isNaN(exac) && exac >= 2 ? "Group E (High Risk Exacerbator)" : "")}
                placeholder="Requires mMRC/CAT + Exacerbation History"
              />
              <FormField
                label="GOLD Stage (Auto-Calculated)"
                name="calc_gold_stage"
                type="derived"
                derivedValue={formData.calc_gold_stage || getGoldStage(fev1Pct)}
                placeholder="Requires current FEV1%"
              />
              <FormField
                label="BODE Index (Auto-Calculated)"
                name="score_bode"
                type="derived"
                derivedValue={formData.score_bode || (bode ? `${bode.points} pts — ${bode.riskBand}` : "")}
                placeholder="Requires BMI, FEV1%, mMRC, 6MWT"
              />
            </div>
          </Section>
        )}

        {isAsthma && (
          <Section title="Asthma Scoring — ACT" note="Asthma Control Test — enter the patient-completed total (5 items, 5-25 points).">
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "20px" }}>
              <FormField label="ACT Total Score (5-25)" name="score_act" type="number" placeholder="Enter total from 5-item questionnaire" />
              <FormField label="Control Level (Auto-Calculated)" name="calc_act_interpretation" type="derived" placeholder="≥20 well controlled / 16-19 not well controlled / ≤15 very poorly controlled" />
            </div>
          </Section>
        )}

        {isIld && (
          <Section title="ILD Scoring — GAP Index" note="Gender-Age-Physiology index for interstitial lung disease mortality risk.">
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "20px" }}>
              <FormField label="GAP Index (Auto-Calculated)" name="score_gap" type="derived" placeholder="Requires sex, age, FVC%, DLCO%" />
              <FormField label="6MWT Desaturation" name="ild_6mwt_desat" type="select" options={["", "No Desaturation", "Mild (SpO2 88-94%)", "Significant (SpO2 <88%)"]} />
            </div>
          </Section>
        )}

        {isBronchiectasis && (
          <Section title="Bronchiectasis Scoring — FACED" note="Severity score using FEV1, Age, chronic Pseudomonas, radiographic Extension, and Dyspnea.">
            <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "20px" }}>
              <FormField label="Chronic Pseudomonas Colonization?" name="bx_pseudomonas" type="select" options={["", "Yes", "No"]} />
              <FormField label="Radiographic Extension" name="bx_extension" type="select" options={["", "1-2 Lobes", ">2 Lobes"]} />
              <FormField label="FACED Score (Auto-Calculated)" name="score_faced" type="derived" placeholder="Requires FEV1%, age, mMRC + fields above" />
            </div>
          </Section>
        )}

        {isPh && (
          <Section title="Pulmonary Hypertension — Functional Class" note="WHO Functional Class is the primary staging tool for PH, not GOLD/BODE.">
            <FormField
              label="WHO Functional Class"
              name="ph_who_class"
              type="select"
              options={[
                "",
                "Class I — No symptom limitation with ordinary activity",
                "Class II — Slight limitation, comfortable at rest",
                "Class III — Marked limitation, comfortable at rest",
                "Class IV — Symptoms at rest, unable to perform any activity",
              ]}
            />
          </Section>
        )}
      </div>

      {/* 3. Preventative & Psychosocial Screening */}
      <Section id="sec_preventative" title="Preventative Screening & Labs" note="Monitoring for secondary complications and genetic factors.">
        <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: "20px" }}>
          <FormField label="Lung Cancer Screening (LDCT)" name="screen_ldct" type="select" options={["", "Eligible - Completed", "Eligible - Pending", "Not Eligible", "Refused"]} />
          <FormField label="Date of Last LDCT" name="screen_ldct_date" type="date" />
          <FormField label="Alpha-1 Antitrypsin Screened?" name="screen_a1at" type="select" options={["", "Yes", "No", "Pending"]} />
          <FormField label="Bone Density (DEXA) Status" name="screen_dexa" type="select" options={["", "Normal", "Osteopenia", "Osteoporosis", "Not Screened"]} />
        </div>
      </Section>

      <Section id="sec_psychosocial" title="Psychosocial & Functional Screening" note="Mental health and pulmonary rehabilitation tracking.">
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "20px" }}>
          <FormField label="PHQ-9 (Depression) Score" name="score_phq9" type="number" placeholder="Enter score (0-27)" />
          <FormField label="GAD-7 (Anxiety) Score" name="score_gad7" type="number" placeholder="Enter score (0-21)" />
          <FormField label="Pulmonary Rehab Status" name="status_pulm_rehab" type="select" options={["", "Not Indicated", "Referred", "Currently Attending", "Completed", "Declined"]} />
        </div>
      </Section>


    </div>
  );
};

export default ScreeningAlertsTab;
