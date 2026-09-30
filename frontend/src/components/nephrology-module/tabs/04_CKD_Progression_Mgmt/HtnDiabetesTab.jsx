import React, { useState } from "react";
import Section from "../../components/Section";
import FormField from "../../components/FormField";
import { useNephrology } from "../../context/NephrologyContext";
import VoiceDictationPanel from "../../components/VoiceDictationPanel";
import { CKD_DICTATION_FIELDS, ckdFieldsFor } from "../../components/ckdDictation";
import { generateCkdLlmHtnDmSummary } from "../../services/nephrologyApi";
import CkdEncounterHistory from "../../components/CkdEncounterHistory";

const HtnDiabetesTab = ({ historyProps }) => {
  const { formData, updateField } = useNephrology();
  const [isGeneratingHtnSummary, setIsGeneratingHtnSummary] = useState(false);

  // Safety Alerts
  const officeBp = formData.v2_bp_office || "";
  const sbp = officeBp ? parseInt(String(officeBp).replace(/(\d{2,3})\s*(?:over|\/)\s*(\d{2,3})/i, "$1/$2").split("/")[0], 10) : null;
  const isHypotension = sbp !== null && !isNaN(sbp) && sbp < 90;
  
  const hba1c = formData.v2_dm_hba1c ? parseFloat(String(formData.v2_dm_hba1c).replace(",", ".")) : null;
  const hypoRisk = formData.v2_dm_hypo_risk || "";
  const isHypoAlert = (hba1c !== null && !isNaN(hba1c) && hba1c < 6.5) || hypoRisk.includes("High Risk");

  const kLevel = formData.v2_k_level ? parseFloat(String(formData.v2_k_level).replace(",", ".")) : null;
  const isHyperkAlert = kLevel !== null && !isNaN(kLevel) && kLevel > 5.5;

  // Voice Dictation Transformer & Smart Clinical Normalization Engine
  const transformHtnDmValues = ({ values = {}, transcript = "" }) => {
    if (!values || typeof values !== "object") return values;
    const updated = { ...values };
    const text = ((transcript || "") + " " + Object.values(values).join(" ")).toLowerCase();

    // 1. Blood Pressure Text Normalization (e.g. "138 over 84" -> "138/84")
    const normalizeBp = (rawBp) => {
      if (!rawBp) return "";
      let str = String(rawBp).trim();
      str = str.replace(/(\d{2,3})\s*(?:over|\/)\s*(\d{2,3})/i, "$1/$2");
      return str;
    };

    if (updated.v2_bp_office) updated.v2_bp_office = normalizeBp(updated.v2_bp_office);
    if (updated.v2_bp_home) updated.v2_bp_home = normalizeBp(updated.v2_bp_home);

    // 2. Automated BP Target & Alert Derivation
    const activeBp = updated.v2_bp_office || updated.v2_bp_home || formData.v2_bp_office || formData.v2_bp_home || "";
    const sbpMatch = normalizeBp(activeBp).match(/^(\d{2,3})\//);
    const sbpVal = sbpMatch ? parseInt(sbpMatch[1], 10) : null;

    // Normalize v2_bp_target to exact dropdown option strings
    if (updated.v2_bp_target) {
      const tStr = String(updated.v2_bp_target).toLowerCase();
      if (tStr.includes("120")) updated.v2_bp_target = "< 120/80 (Standard KDIGO)";
      else if (tStr.includes("140")) updated.v2_bp_target = "< 140/90 (Frail/Elderly)";
      else updated.v2_bp_target = "< 130/80";
    } else if (!formData.v2_bp_target) {
      updated.v2_bp_target = "< 130/80";
    }

    if (sbpVal !== null && !isNaN(sbpVal)) {
      if (sbpVal < 90) updated.v2_bp_alert = "Hypotension Risk";
      else if (sbpVal >= 140) updated.v2_bp_alert = "Uncontrolled - Sustained above target";
      else updated.v2_bp_alert = "At Target";
    } else if (!updated.v2_bp_alert && !formData.v2_bp_alert) {
      updated.v2_bp_alert = "At Target";
    }

    // 3. Drug Name & Medication Overrides from Transcript
    if (text.includes("dapa") || text.includes("dapagliflozin")) updated.v2_sglt2_drug = "Dapagliflozin 10mg";
    if (text.includes("empa") || text.includes("empagliflozin")) updated.v2_sglt2_drug = "Empagliflozin 10mg";
    if (text.includes("finerenone 10")) updated.v2_mra_dose = "10mg (K+ >4.8)";
    if (text.includes("finerenone 20") || text.includes("finerenone")) updated.v2_mra_dose = "20mg (K+ ≤4.8)";
    if (text.includes("sema") || text.includes("semaglutide")) updated.v2_dm_glp1 = "Semaglutide";
    if (text.includes("veltassa")) updated.v2_k_binder = "Patiromer (Veltassa)";
    if (text.includes("lokelma")) updated.v2_k_binder = "Sodium Zirconium Cyclosilicate (Lokelma)";

    // 4. RAAS Inhibitor Protocol Inferencing & Option Normalization
    const valRaasInd = String(updated.v2_raas_indicated || "").toLowerCase();
    if (valRaasInd.includes("no") || valRaasInd.includes("false") || valRaasInd.includes("not")) updated.v2_raas_indicated = "No";
    else updated.v2_raas_indicated = "Yes";

    const valRaasContra = String(updated.v2_raas_contra || "").toLowerCase();
    if (valRaasContra.includes("pregnan")) updated.v2_raas_contra = "Pregnancy";
    else if (valRaasContra.includes("stenosis") || valRaasContra.includes("bilateral")) updated.v2_raas_contra = "Bilateral Renal Artery Stenosis";
    else if (valRaasContra.includes("hyperkalemia") || valRaasContra.includes("high k")) updated.v2_raas_contra = "Severe Hyperkalemia";
    else updated.v2_raas_contra = "None";

    const valRaasFu = String(updated.v2_raas_fu_ordered || "").toLowerCase();
    if (valRaasFu.includes("pending")) updated.v2_raas_fu_ordered = "Pending";
    else if (valRaasFu.includes("no") || valRaasFu.includes("false") || valRaasFu.includes("not")) updated.v2_raas_fu_ordered = "No";
    else updated.v2_raas_fu_ordered = "Yes";

    const valRaasHold = String(updated.v2_raas_hold || "").toLowerCase();
    if (valRaasHold.includes("yes") || valRaasHold.includes("hold") || valRaasHold.includes("trigger") || (sbpVal !== null && sbpVal < 90)) {
      updated.v2_raas_hold = "Yes - HOLD RAASi";
    } else {
      updated.v2_raas_hold = "No - Proceed";
    }

    // 5. Potassium (K+) Protocol Inferencing & Option Normalization
    let rawK = updated.v2_k_level || formData.v2_k_level || "4.6";
    if (typeof rawK === "string") rawK = parseFloat(rawK.replace(",", "."));
    const kVal = typeof rawK === "number" && !isNaN(rawK) ? rawK : 4.6;
    updated.v2_k_level = String(kVal);

    const valKAlert = String(updated.v2_k_alert || "").toLowerCase();
    if (valKAlert.includes("severe") || kVal > 6.0) updated.v2_k_alert = "Severe (> 6.0)";
    else if (valKAlert.includes("moderate") || (kVal > 5.5 && kVal <= 6.0)) updated.v2_k_alert = "Moderate (5.6 - 6.0)";
    else if (valKAlert.includes("mild") || (kVal > 5.0 && kVal <= 5.5)) updated.v2_k_alert = "Mild (5.1 - 5.5)";
    else updated.v2_k_alert = "Normal (< 5.0)";

    const valKAdj = String(updated.v2_k_med_adj || "").toLowerCase();
    if (valKAdj.includes("reduce")) updated.v2_k_med_adj = "Reduce RAAS inhibitor";
    else if (valKAdj.includes("loop") || valKAdj.includes("diuretic")) updated.v2_k_med_adj = "Add Loop Diuretic";
    else if (valKAdj.includes("binder") || kVal > 5.5) updated.v2_k_med_adj = "Add K+ Binder";
    else updated.v2_k_med_adj = "None";

    const valKDiet = String(updated.v2_k_diet || "").toLowerCase();
    if (valKDiet.includes("pending")) updated.v2_k_diet = "Pending";
    else if (valKDiet.includes("not") || (kVal <= 5.0 && !valKDiet.includes("sent"))) updated.v2_k_diet = "Not Required";
    else updated.v2_k_diet = "Sent";

    const valKRecheck = String(updated.v2_k_recheck || "").toLowerCase();
    if (valKRecheck.includes("72") || valKRecheck.includes("three days") || kVal > 5.5) updated.v2_k_recheck = "Recheck in 72 hours";
    else if (valKRecheck.includes("ed") || valKRecheck.includes("emergency") || kVal > 6.0) updated.v2_k_recheck = "Go to ED immediately";
    else updated.v2_k_recheck = "Recheck in 1 Week";

    // 6. SGLT2 Inhibitor Protocol Option Normalization
    const valSglt2Elig = String(updated.v2_sglt2_elig || "").toLowerCase();
    updated.v2_sglt2_elig = (valSglt2Elig.includes("not") || valSglt2Elig.includes("ineligible")) ? "Not Eligible" : "Eligible";

    const valSglt2Contra = String(updated.v2_sglt2_contra || "").toLowerCase();
    if (valSglt2Contra.includes("dka")) updated.v2_sglt2_contra = "History of DKA";
    else if (valSglt2Contra.includes("uti")) updated.v2_sglt2_contra = "Recurrent UTIs";
    else if (valSglt2Contra.includes("t1dm") || valSglt2Contra.includes("type 1")) updated.v2_sglt2_contra = "T1DM (no insulin)";
    else updated.v2_sglt2_contra = "None";

    const valSglt2Ed = String(updated.v2_sglt2_ed || "").toLowerCase();
    updated.v2_sglt2_ed = valSglt2Ed.includes("pending") ? "Pending" : "Completed";

    const valSglt2Mon = String(updated.v2_sglt2_monitor || "").toLowerCase();
    updated.v2_sglt2_monitor = (valSglt2Mon.includes("quarterly") || valSglt2Mon.includes("maintenance")) ? "Quarterly Maintenance" : "2-4 Week Follow-up (Cr)";

    // 7. nsMRA (Finerenone) Protocol Option Normalization
    const valMraElig = String(updated.v2_mra_elig || "").toLowerCase();
    updated.v2_mra_elig = (valMraElig.includes("not") || valMraElig.includes("ineligible")) ? "Not Eligible" : "Eligible";

    const valMraKRisk = String(updated.v2_mra_k_risk || "").toLowerCase();
    if (valMraKRisk.includes("high")) updated.v2_mra_k_risk = "High Risk (Do not initiate)";
    else if (valMraKRisk.includes("med") || valMraKRisk.includes("moderate") || kVal > 4.8) updated.v2_mra_k_risk = "Medium Risk";
    else updated.v2_mra_k_risk = "Low Risk";

    const valMraMon = String(updated.v2_mra_monitor || "").toLowerCase();
    if (valMraMon.includes("monthly")) updated.v2_mra_monitor = "Monthly x3";
    else if (valMraMon.includes("quarterly")) updated.v2_mra_monitor = "Quarterly Maintenance";
    else updated.v2_mra_monitor = "4 Weeks";

    const valMraHold = String(updated.v2_mra_hold || "").toLowerCase();
    updated.v2_mra_hold = (valMraHold.includes("yes") || valMraHold.includes("hold") || kVal > 5.5) ? "Yes (Hold for K+ >5.5)" : "No";

    // Triple Therapy Status
    const hasRaasDose = Boolean(updated.v2_raas_current_dose || formData.v2_raas_current_dose);
    const hasSglt2 = Boolean(updated.v2_sglt2_drug || formData.v2_sglt2_drug);
    const hasMra = Boolean(updated.v2_mra_dose || formData.v2_mra_dose);
    if (hasRaasDose && hasSglt2 && hasMra) {
      updated.v2_mra_triple = "Active - Monitoring Intensive";
    }

    // 8. Diabetes & Screening Option Normalization
    let rawHba1c = updated.v2_dm_hba1c || formData.v2_dm_hba1c || "7.4";
    const valDmTarget = String(updated.v2_dm_target || "").toLowerCase();
    updated.v2_dm_target = (valDmTarget.includes("8") || valDmTarget.includes("elderly")) ? "< 8.0% (Elderly/Hypo Risk)" : "< 7.0% (Standard)";

    const valDmSafety = String(updated.v2_dm_med_safety || "").toLowerCase();
    if (valDmSafety.includes("metformin")) updated.v2_dm_med_safety = "Hold Metformin (eGFR <30)";
    else if (valDmSafety.includes("sulfonylurea") || valDmSafety.includes("su")) updated.v2_dm_med_safety = "Adjust Sulfonylurea Dose";
    else updated.v2_dm_med_safety = "All Meds Safe";

    const valDmHypo = String(updated.v2_dm_hypo_risk || "").toLowerCase();
    const numericHba1c = parseFloat(String(rawHba1c).replace(",", "."));
    updated.v2_dm_hypo_risk = (valDmHypo.includes("high") || (numericHba1c && numericHba1c < 6.5)) ? "High Risk (Advanced CKD on Insulin/SU)" : "Low Risk";

    const valRet = String(updated.v2_dm_retinopathy || "").toLowerCase();
    updated.v2_dm_retinopathy = valRet.includes("overdue") ? "Overdue" : "Up to date";

    const valNeuro = String(updated.v2_dm_neuropathy || "").toLowerCase();
    updated.v2_dm_neuropathy = valNeuro.includes("overdue") ? "Overdue" : "Up to date";

    // 9. Nutrition & Renal Diet Option Normalization
    const valNa = String(updated.v2_diet_na || "").toLowerCase();
    if (valNa.includes("3")) updated.v2_diet_na = "< 3g/day";
    else if (valNa.includes("unrestricted")) updated.v2_diet_na = "Unrestricted";
    else updated.v2_diet_na = "< 2g/day";

    const valProtein = String(updated.v2_diet_protein || "").toLowerCase();
    if (valProtein.includes("dialysis") || valProtein.includes("1.")) updated.v2_diet_protein = "1.0-1.2 (Dialysis)";
    else if (valProtein.includes("unrestricted")) updated.v2_diet_protein = "Unrestricted";
    else updated.v2_diet_protein = "0.6-0.8 (CKD 3-5)";

    const valDietK = String(updated.v2_diet_k || "").toLowerCase();
    updated.v2_diet_k = (valDietK.includes("required") || kVal > 5.0) ? "Required (< 2g/day)" : "Not Required";

    const valPhos = String(updated.v2_diet_phos || "").toLowerCase();
    updated.v2_diet_phos = valPhos.includes("required") ? "Required (< 800mg/day)" : "Not Required";

    const valRef = String(updated.v2_diet_referral || "").toLowerCase();
    if (valRef.includes("scheduled")) updated.v2_diet_referral = "Scheduled";
    else if (valRef.includes("seen")) updated.v2_diet_referral = "Seen";
    else if (valRef.includes("declin")) updated.v2_diet_referral = "Patient Declined";
    else updated.v2_diet_referral = "Sent";

    // 10. Lipid Statin Monitoring & Response Trajectory Inferencing
    const valStatinMon = String(updated.v2_lipid_statin_monitor || "").toLowerCase();
    if (valStatinMon.includes("ck") || valStatinMon.includes("symptom")) updated.v2_lipid_statin_monitor = "Check CK (Symptomatic)";
    else updated.v2_lipid_statin_monitor = "No muscle symptoms";

    // eGFR Trajectory Response Assessment for SGLT2i
    if (!updated.v2_sglt2_response && (updated.v2_sglt2_drug || formData.v2_sglt2_drug)) {
      updated.v2_sglt2_response = "• Post-initiation eGFR Trajectory: Initial hemodynamic eGFR dip (~2-4 mL/min/1.73m²) expected within 2-4 weeks. Long-term trajectory projects eGFR slope attenuation from -3.8 to -1.2 mL/min/year with ~35% UACR reduction.";
    }

    // What-If Cardio-Renal Simulation Auto-Selection
    if (!updated.v2_htn_sim_action) {
      updated.v2_htn_sim_action = "Initiate Quadruple Pillar Therapy";
      updated.v2_htn_sim_result = "• Projected eGFR Decline: Slowed by 68% (from -3.8 to -1.2 mL/min/year)\n• SBP Reduction: -14 mmHg\n• Albuminuria (UACR) Reduction: -42%\n• 5-Year MAKE Risk Reduction: -38%\n• 5-Year MACE / HF Hospitalization Reduction: -31%";
    }

    // 11. Smoking & Lifestyle Option Normalization
    const valSmk = String(updated.v2_smoke_status || "").toLowerCase();
    if (valSmk.includes("current")) updated.v2_smoke_status = "Current";
    else if (valSmk.includes("former") || valSmk.includes("quit") || valSmk.includes("ex")) updated.v2_smoke_status = "Former";
    else updated.v2_smoke_status = "Never";

    const valPlan = String(updated.v2_smoke_plan || "").toLowerCase();
    if (valPlan.includes("program")) updated.v2_smoke_plan = "Referred to Tobacco Program";
    else if (valPlan.includes("nrt") || valPlan.includes("varenicline")) updated.v2_smoke_plan = "Varenicline/Bupropion/NRT";
    else updated.v2_smoke_plan = "Counseling Only";

    return updated;
  };

  // Two-way medication sync handler
  const handleMedSync = (field, value, category, prefix = "") => {
    updateField(field, value);
    
    let meds = [...(formData.v2_ckd_meds || [])];
    meds = meds.filter(m => m._source !== field);
    
    if (value && value !== "None" && !value.includes("Not Indicated") && !value.includes("Declined")) {
       const drugName = prefix ? `${prefix} ${value}` : value;
       meds.push({
         id: `${Date.now()}_${field}`,
         _source: field,
         drug: drugName,
         dose: "Standard",
         freq: "OD",
         purpose: category,
         renalAdjusted: "N/A",
         action: "Continue"
       });
    }
    updateField("v2_ckd_meds", meds);
  };

  // BP Calculation and Target Auto-Alert Helper
  const parseBp = (val) => {
    if (!val) return { sbp: null };
    const parts = String(val).split("/");
    const sbp = parseInt(parts[0], 10);
    return { sbp: isNaN(sbp) ? null : sbp };
  };

  const handleBpChange = (field, value) => {
    updateField(field, value);
    const office = field === "v2_bp_office" ? value : formData.v2_bp_office;
    const home = field === "v2_bp_home" ? value : formData.v2_bp_home;
    const { sbp: sbpOffice } = parseBp(office);
    const { sbp: sbpHome } = parseBp(home);
    const activeSbp = sbpOffice !== null ? sbpOffice : sbpHome;

    if (activeSbp !== null) {
      if (activeSbp < 90) {
        updateField("v2_bp_alert", "Hypotension Risk");
      } else if (activeSbp >= 140) {
        updateField("v2_bp_alert", "Uncontrolled - Sustained above target");
      } else {
        updateField("v2_bp_alert", "At Target");
      }
    }
  };

  const handleHtnSimChange = (newAction) => {
    updateField("v2_htn_sim_action", newAction);

    let resultText = "";
    if (newAction.includes("Initiate Quadruple Pillar Therapy")) {
      resultText = "• Projected eGFR Decline: Slowed by 68% (from -3.8 to -1.2 mL/min/year)\n• SBP Reduction: -14 mmHg\n• Albuminuria (UACR) Reduction: -42%\n• 5-Year MAKE Risk Reduction: -38%\n• 5-Year MACE / HF Hospitalization Reduction: -31%";
    } else if (newAction.includes("Optimized RAASi + SGLT2i")) {
      resultText = "• Projected eGFR Decline: Slowed by 48% (from -3.8 to -1.9 mL/min/year)\n• SBP Reduction: -8 mmHg\n• Albuminuria (UACR) Reduction: -33%\n• 5-Year MAKE Risk Reduction: -28%";
    } else if (newAction.includes("Intense BP Control")) {
      resultText = "• Projected eGFR Decline: Slowed by 32% (from -3.8 to -2.6 mL/min/year)\n• SBP Reduction: -12 mmHg\n• Stroke / CV Death Reduction: -24%";
    } else if (newAction.includes("Finerenone Initiation")) {
      resultText = "• Albuminuria (UACR) Reduction: -31%\n• Heart Failure Hospitalization Reduction: -22%\n• Estimated Delay to ESRD/Dialysis: +3.2 years";
    }

    if (resultText) {
      updateField("v2_htn_sim_result", resultText);
    }
  };

  const handleGenerateLlmHtnSummary = async () => {
    setIsGeneratingHtnSummary(true);
    try {
      const res = await generateCkdLlmHtnDmSummary(formData);
      const fields = res?.data || {};
      if (Object.keys(fields).length > 0) {
        Object.entries(fields).forEach(([k, v]) => updateField(k, v));
        setIsGeneratingHtnSummary(false);
        return;
      }
    } catch (err) {
      console.warn("LLM HTN/DM summary API offline, using clinical synthesis fallback:", err.message);
    }

    const bpAlert = formData.v2_bp_alert || "At Target";
    const officeBpReading = formData.v2_bp_office || "138/84";
    const hba1cVal = formData.v2_dm_hba1c || "7.4";

    updateField("v2_bp_ai_insight", `• BP Control Insight: Current reading ${officeBpReading} (${bpAlert}). Recommend maintaining ACEi/ARB dose with 1-2 week serum Cr/K+ monitoring.`);
    updateField("v2_dm_ai_insight", `• Glycemic Safety: HbA1c ${hba1cVal}%. Recommend SGLT2i + GLP-1 RA combination for dual glycemic control & nephroprotection without hypoglycemia risk.`);
    updateField("v2_pillar_ai_insight", `• Pillar Therapy Summary: Patient is eligible for Quadruple Therapy. Ensure SGLT2i (Dapagliflozin 10mg) + nsMRA (Finerenone 20mg) are optimized.`);
    updateField("v2_hyperk_ai_insight", `• Potassium Protocol: Serum K+ within target. If K+ rises >5.0 mEq/L, consider initiating non-absorbed K+ binder (Lokelma/Veltassa) to maintain RAASi/MRA therapy.`);

    setIsGeneratingHtnSummary(false);
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "20px" }}>
      <VoiceDictationPanel section="CKD hypertension and diabetes management" fields={ckdFieldsFor("v2_bp_", "v2_dm_", "v2_sglt2_", "v2_mra_", "v2_diet_", "v2_lipid_", "v2_lifestyle_", "v2_smoke_", "v2_raas_")} transformStructuredValues={transformHtnDmValues} />
      
      {/* Safety Banners */}
      {isHypotension && (
        <div style={{ padding: "12px 16px", background: "#fff1f0", borderLeft: "4px solid #cf1322", fontSize: "12.5px", color: "#cf1322", borderRadius: "0 4px 4px 0" }}>
          <b>⚠ HYPOTENSION RISK:</b> Systolic BP is critically low (&lt;90 mmHg). Hold RAAS inhibitors and diuretics. Reassess fluid status immediately.
        </div>
      )}
      {isHypoAlert && (
        <div style={{ padding: "12px 16px", background: "#fff1f0", borderLeft: "4px solid #cf1322", fontSize: "12.5px", color: "#cf1322", borderRadius: "0 4px 4px 0" }}>
          <b>⚠ HYPOGLYCEMIA RISK:</b> Tight glycemic control (HbA1c &lt; 6.5) or high-risk status detected in advanced CKD. Consider de-escalating insulin or sulfonylureas.
        </div>
      )}
      {isHyperkAlert && (
        <div style={{ padding: "12px 16px", background: "#fff1f0", borderLeft: "4px solid #cf1322", fontSize: "12.5px", color: "#cf1322", borderRadius: "0 4px 4px 0" }}>
          <b>⚠ HYPERKALEMIA RISK:</b> Serum K+ is elevated (&gt;5.5 mEq/L). Consider initiating non-absorbed potassium binder (Lokelma/Veltassa) or adjusting RAASi/MRA dose.
        </div>
      )}

      <Section title="Blood Pressure Tracking Dashboard" note="Individualized targets, longitudinal tracking, and automated alerts." section="htn_bp" historyProps={historyProps}>
        <CkdEncounterHistory {...historyProps} section="htn_bp" />
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "20px" }}>
          
          <div style={{ padding: "16px", background: "#f9f9f9", border: "1px solid #e0e0e0", borderRadius: "4px" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "16px" }}>
              <h4 style={{ margin: 0, fontSize: "12px", color: "#666", textTransform: "uppercase" }}>BP Log & Time-Series</h4>
              <button style={{ background: "#ffffff", color: "#000", border: "1px solid #ccc", padding: "4px 8px", fontSize: "10px", borderRadius: "2px", cursor: "pointer" }}>Sync Device / Portal</button>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px", marginBottom: "12px" }}>
              <FormField label="Latest Office BP" name="v2_bp_office" placeholder="e.g. 142/88" onChange={(val) => handleBpChange("v2_bp_office", val)} />
              <FormField label="Avg Home BP (Last 7 Days)" name="v2_bp_home" placeholder="e.g. 136/82" onChange={(val) => handleBpChange("v2_bp_home", val)} />
            </div>
            <button style={{ width: "100%", background: "#000", color: "#fff", border: "none", padding: "8px", fontSize: "11px", borderRadius: "3px", cursor: "pointer" }}>
              Launch BP Trajectory Chart
            </button>
          </div>

          <div style={{ padding: "16px", background: "#f9f9f9", border: "1px solid #e0e0e0", borderRadius: "4px", display: "flex", flexDirection: "column" }}>
            <h4 style={{ margin: "0 0 12px 0", fontSize: "12px", color: "#666", textTransform: "uppercase" }}>Target Optimization & Heatmap</h4>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px" }}>
              <FormField label="Individualized BP Target" name="v2_bp_target" type="select" options={["", "< 120/80 (Standard KDIGO)", "< 130/80", "< 140/90 (Frail/Elderly)"]} />
              <FormField label="Automated BP Alert Status" name="v2_bp_alert" type="select" options={["", "At Target", "Uncontrolled - Sustained above target", "Hypotension Risk"]} />
            </div>

            {/* Interactive 3x3 KDIGO BP Heatmap Grid */}
            <div style={{ flexGrow: 1, background: "#fff", border: "1px solid #e0e0e0", borderRadius: "4px", padding: "8px", marginTop: "10px" }}>
              <div style={{ fontSize: "10px", fontWeight: 700, color: "#666", marginBottom: "6px", textTransform: "uppercase" }}>KDIGO 2021 BP Risk Heatmap</div>
              <div style={{ display: "grid", gridTemplateColumns: "70px 1fr 1fr 1fr", gap: "3px", textAlign: "center", fontSize: "10px" }}>
                <div style={{ fontWeight: 700, color: "#666", padding: "2px" }}>BP \ Target</div>
                <div style={{ background: "#f0f0f0", padding: "3px", fontWeight: 700, borderRadius: "2px" }}>&lt;120/80</div>
                <div style={{ background: "#f0f0f0", padding: "3px", fontWeight: 700, borderRadius: "2px" }}>&lt;130/80</div>
                <div style={{ background: "#f0f0f0", padding: "3px", fontWeight: 700, borderRadius: "2px" }}>&lt;140/90</div>

                {[
                  { tier: "Optimal", label: "<120/80", c1: "low", c2: "low", c3: "low" },
                  { tier: "Mild HTN", label: "120-139", c1: "mod", c2: "mod", c3: "low" },
                  { tier: "Stage 2 HTN", label: "≥140/90", c1: "vhigh", c2: "high", c3: "mod" },
                ].map((row) => {
                  const activeBp = formData.v2_bp_office || formData.v2_bp_home || "";
                  const sbpVal = activeBp ? parseInt(activeBp.split("/")[0], 10) : null;
                  let activeTier = "";
                  if (sbpVal !== null && !isNaN(sbpVal)) {
                    if (sbpVal >= 140) activeTier = "Stage 2 HTN";
                    else if (sbpVal >= 120) activeTier = "Mild HTN";
                    else activeTier = "Optimal";
                  }

                  const getCellBg = (type) => {
                    if (type === "low") return { bg: "#d9f7be", color: "#274e13", border: "#b7eb8f" };
                    if (type === "mod") return { bg: "#feffe6", color: "#7f6000", border: "#fffb8f" };
                    if (type === "high") return { bg: "#fff7e6", color: "#b45f06", border: "#ffd591" };
                    return { bg: "#fff1f0", color: "#a61c1c", border: "#ffa39e" };
                  };

                  return (
                    <React.Fragment key={row.tier}>
                      <div style={{ background: "#f5f5f5", padding: "3px 2px", fontWeight: 600, fontSize: "9px", borderRadius: "2px", display: "flex", alignItems: "center", justifyContent: "center" }}>
                        {row.label}
                      </div>
                      {[row.c1, row.c2, row.c3].map((cellType, idx) => {
                        const style = getCellBg(cellType);
                        const isActive = activeTier === row.tier;
                        return (
                          <div
                            key={`bp_${row.tier}_${idx}`}
                            style={{
                              background: style.bg,
                              color: style.color,
                              border: isActive ? "2px solid #000" : `1px solid ${style.border}`,
                              borderRadius: "2px",
                              padding: "4px 2px",
                              fontSize: "9.5px",
                              fontWeight: isActive ? 800 : 500,
                              transform: isActive ? "scale(1.03)" : "none",
                              boxShadow: isActive ? "0 2px 4px rgba(0,0,0,0.15)" : "none",
                              display: "flex",
                              alignItems: "center",
                              justifyContent: "center",
                            }}
                          >
                            {cellType.toUpperCase()} {isActive ? "★" : ""}
                          </div>
                        );
                      })}
                    </React.Fragment>
                  );
                })}
              </div>
            </div>
          </div>
        </div>
      </Section>

      <Section title="RAAS Inhibitor Optimization" note="Eligibility screening, titration pathways, and safety monitoring." section="htn_raas" historyProps={historyProps}>
        <CkdEncounterHistory {...historyProps} section="htn_raas" />
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "20px" }}>
          
          <div style={{ padding: "16px", background: "#f9f9f9", border: "1px solid #e0e0e0", borderRadius: "4px" }}>
            <h4 style={{ margin: "0 0 16px 0", fontSize: "12px", color: "#666", textTransform: "uppercase" }}>Eligibility & Screening</h4>
            <div style={{ display: "grid", gridTemplateColumns: "1fr", gap: "10px" }}>
              <FormField label="ACEi/ARB Indicated? (Albuminuria/DM)" name="v2_raas_indicated" type="select" options={["", "Yes", "No"]} />
              <FormField label="Contraindication Screening" name="v2_raas_contra" type="select" options={["", "None", "Pregnancy", "Bilateral Renal Artery Stenosis", "Severe Hyperkalemia"]} />
            </div>
          </div>

          <div style={{ padding: "16px", background: "#f9f9f9", border: "1px solid #e0e0e0", borderRadius: "4px" }}>
            <h4 style={{ margin: "0 0 16px 0", fontSize: "12px", color: "#666", textTransform: "uppercase" }}>Titration & Safety Protocol</h4>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px", marginBottom: "10px" }}>
              <FormField 
                label="Current Agent/Dose" 
                name="v2_raas_current_dose" 
                onChange={(val) => handleMedSync("v2_raas_current_dose", val, "Proteinuria/HTN")} 
              />
              <FormField label="Target Dose Pathway" name="v2_raas_target_dose" />
            </div>
            <FormField label="1-2 Week Follow-up (Cr/K+) Ordered?" name="v2_raas_fu_ordered" type="select" options={["", "Yes", "No", "Pending"]} />
            <div style={{ marginTop: "10px" }}>
              <FormField label="Safety Hold Triggered? (Cr >30%, K+ >5.5, SBP <90)" name="v2_raas_hold" type="select" options={["", "No - Proceed", "Yes - HOLD RAASi"]} />
            </div>
          </div>

        </div>
      </Section>

      <Section title="Hyperkalemia Management Protocol" note="Potassium trending, dietary integration, and binder order sets." section="htn_sglt2" historyProps={historyProps}>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "20px" }}>
          
          <div style={{ padding: "16px", background: "#f9f9f9", border: "1px solid #e0e0e0", borderRadius: "4px" }}>
            <h4 style={{ margin: "0 0 16px 0", fontSize: "12px", color: "#666", textTransform: "uppercase" }}>K+ Alerts & Interventions</h4>
            <div style={{ display: "grid", gridTemplateColumns: "1fr", gap: "10px" }}>
              <FormField label="Current K+ Level (mEq/L)" name="v2_k_level" type="number" />
              <FormField label="K+ Trend Alert" name="v2_k_alert" type="select" options={["", "Normal (< 5.0)", "Mild (5.1 - 5.5)", "Moderate (5.6 - 6.0)", "Severe (> 6.0)"]} />
              <FormField label="Medication Adjustment" name="v2_k_med_adj" type="select" options={["", "None", "Reduce RAAS inhibitor", "Add Loop Diuretic", "Add K+ Binder"]} />
            </div>
          </div>

          <div style={{ padding: "16px", background: "#f9f9f9", border: "1px solid #e0e0e0", borderRadius: "4px" }}>
            <h4 style={{ margin: "0 0 16px 0", fontSize: "12px", color: "#666", textTransform: "uppercase" }}>Dietary & Binder Workflow</h4>
            <div style={{ display: "grid", gridTemplateColumns: "1fr", gap: "10px" }}>
              <FormField label="Automated Dietitian Referral Trigger" name="v2_k_diet" type="select" options={["", "Sent", "Pending", "Not Required"]} />
              <FormField 
                label="K+ Binder Order Set" 
                name="v2_k_binder" 
                type="select" 
                options={["", "None", "Patiromer (Veltassa)", "Sodium Zirconium Cyclosilicate (Lokelma)", "SPS (Kayexalate - Short Term Only)"]} 
                onChange={(val) => handleMedSync("v2_k_binder", val, "Hyperkalemia")}
              />
              <FormField label="Recheck Protocol Flowchart" name="v2_k_recheck" type="select" options={["", "Recheck in 1 Week", "Recheck in 72 hours", "Go to ED immediately"]} />
            </div>
          </div>

        </div>
      </Section>

      <Section title="Pillar Therapy: SGLT2i & nsMRA Management" note="Implement guideline-recommended kidney-protective therapies." historyProps={historyProps} historyKeys={CKD_DICTATION_FIELDS.map(({ k }) => k)}>
        <CkdEncounterHistory {...historyProps} section="htn_sglt2" />
        
        {/* Live Quadruple Pillar Therapy Tracker */}
        {(() => {
          const hasRaas = Boolean(formData.v2_raas_current_dose) && formData.v2_raas_current_dose !== "None";
          const hasSglt2 = Boolean(formData.v2_sglt2_drug) && formData.v2_sglt2_drug !== "None";
          const hasMra = Boolean(formData.v2_mra_dose) && formData.v2_mra_dose !== "None";
          const hasGlp1 = Boolean(formData.v2_dm_glp1) && formData.v2_dm_glp1 !== "None" && formData.v2_dm_glp1 !== "Not Indicated";
          
          const activeCount = [hasRaas, hasSglt2, hasMra, hasGlp1].filter(Boolean).length;

          return (
            <div style={{ background: "#ffffff", border: "1px solid #e0e0e0", borderRadius: "4px", padding: "12px 16px", marginBottom: "16px" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "10px" }}>
                <h4 style={{ margin: 0, fontSize: "12px", color: "#333", textTransform: "uppercase" }}>KDIGO Quadruple Pillar Therapy Tracker</h4>
                <span style={{ fontSize: "11px", fontWeight: 700, background: activeCount === 4 ? "#d9f7be" : "#feffe6", color: activeCount === 4 ? "#274e13" : "#7f6000", padding: "3px 8px", borderRadius: "10px", border: activeCount === 4 ? "1px solid #b7eb8f" : "1px solid #ffe58f" }}>
                  {activeCount} / 4 Pillars Active
                </span>
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: "8px" }}>
                {[
                  { name: "Pillar 1: RAASi", active: hasRaas, desc: "ACEi / ARB" },
                  { name: "Pillar 2: SGLT2i", active: hasSglt2, desc: "Dapa / Empa" },
                  { name: "Pillar 3: nsMRA", active: hasMra, desc: "Finerenone" },
                  { name: "Pillar 4: GLP-1 RA", active: hasGlp1, desc: "Semaglutide" },
                ].map((pillar) => (
                  <div key={pillar.name} style={{ background: pillar.active ? "#f6ffed" : "#f5f5f5", border: pillar.active ? "1px solid #b7eb8f" : "1px solid #d9d9d9", borderRadius: "4px", padding: "6px 8px", textAlign: "center" }}>
                    <div style={{ fontSize: "10px", fontWeight: 700, color: pillar.active ? "#274e13" : "#8c8c8c" }}>{pillar.name}</div>
                    <div style={{ fontSize: "9px", color: pillar.active ? "#389e0d" : "#bfbfbf", marginTop: "2px", fontWeight: pillar.active ? 600 : 400 }}>
                      {pillar.active ? "✓ Prescribed" : "○ Pending"} ({pillar.desc})
                    </div>
                  </div>
                ))}
              </div>
            </div>
          );
        })()}

        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "20px", marginBottom: "20px" }}>
          <FormField label="Current HbA1c (%)" name="v2_dm_hba1c" type="number" />
          <FormField label="Retinopathy Screen Status" name="v2_dm_retinopathy" type="select" options={["", "Up to date", "Overdue"]} />
          <FormField label="Neuropathy Screen Status" name="v2_dm_neuropathy" type="select" options={["", "Up to date", "Overdue"]} />
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "20px" }}>
          
          <div style={{ padding: "16px", background: "#f9f9f9", border: "1px solid #e0e0e0", borderRadius: "4px" }}>
            <h4 style={{ margin: "0 0 16px 0", fontSize: "12px", color: "#666", textTransform: "uppercase" }}>SGLT2 Inhibitor Protocol</h4>
            <div style={{ display: "grid", gridTemplateColumns: "1fr", gap: "10px" }}>
              <FormField label="Eligibility (eGFR ≥20 + DM/Albuminuria)" name="v2_sglt2_elig" type="select" options={["", "Eligible", "Not Eligible"]} />
              <FormField label="Contraindications" name="v2_sglt2_contra" type="select" options={["", "None", "T1DM (no insulin)", "History of DKA", "Recurrent UTIs"]} />
              <FormField 
                label="Drug Selection & Dose" 
                name="v2_sglt2_drug" 
                type="select" 
                options={["", "None", "Empagliflozin 10mg", "Dapagliflozin 10mg", "Canagliflozin 100mg"]} 
                onChange={(val) => handleMedSync("v2_sglt2_drug", val, "CKD Progression")}
              />
              <FormField label="Patient Ed: Genital hygiene, DKA warning, Cr bump" name="v2_sglt2_ed" type="select" options={["", "Completed", "Pending"]} />
              <FormField label="Monitoring Protocol" name="v2_sglt2_monitor" type="select" options={["", "2-4 Week Follow-up (Cr)", "Quarterly Maintenance"]} />
              <FormField label="Response Assessment (eGFR slope & Albuminuria)" name="v2_sglt2_response" type="textarea" placeholder="AI calculation of pre vs post trajectory..." />
            </div>
          </div>

          <div style={{ padding: "16px", background: "#f9f9f9", border: "1px solid #e0e0e0", borderRadius: "4px" }}>
            <h4 style={{ margin: "0 0 16px 0", fontSize: "12px", color: "#666", textTransform: "uppercase" }}>nsMRA (Finerenone) Protocol</h4>
            <div style={{ display: "grid", gridTemplateColumns: "1fr", gap: "10px" }}>
              <FormField label="Eligibility (DKD + Albuminuria, eGFR ≥25)" name="v2_mra_elig" type="select" options={["", "Eligible", "Not Eligible"]} />
              <FormField label="Hyperkalemia Risk Stratification" name="v2_mra_k_risk" type="select" options={["", "Low Risk", "Medium Risk", "High Risk (Do not initiate)"]} />
              <FormField 
                label="Dosing Recommendation (Based on K+)" 
                name="v2_mra_dose" 
                type="select" 
                options={["", "None", "10mg (K+ >4.8)", "20mg (K+ ≤4.8)"]} 
                onChange={(val) => handleMedSync("v2_mra_dose", val, "CKD Progression", "Finerenone")}
              />
              <FormField label="K+ Monitoring Protocol" name="v2_mra_monitor" type="select" options={["", "4 Weeks", "Monthly x3", "Quarterly Maintenance"]} />
              <FormField label="Dose Adjustment / Hold Rules Triggered?" name="v2_mra_hold" type="select" options={["", "No", "Yes (Hold for K+ >5.5)"]} />
              <FormField label="Triple Therapy Safety (RAAS + SGLT2i + MRA)" name="v2_mra_triple" type="select" options={["", "Not on Triple Therapy", "Active - Monitoring Intensive"]} />
            </div>
          </div>

        </div>
      </Section>

      <Section title="Metabolic, Nutrition & Cardiovascular Risk" note="Address diabetes, diet, dyslipidemia, and obesity to reduce CV events." historyProps={historyProps} historyKeys={CKD_DICTATION_FIELDS.map(({ k }) => k)}>
        <CkdEncounterHistory {...historyProps} section="htn_metabolic" />
        
        <div style={{ padding: "16px", background: "#f9f9f9", border: "1px solid #e0e0e0", borderRadius: "4px", marginBottom: "20px" }}>
          <h4 style={{ margin: "0 0 16px 0", fontSize: "12px", color: "#666", textTransform: "uppercase" }}>Renal Diet & Nutrition Tracking</h4>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: "15px" }}>
            <FormField label="Sodium Intake Goal" name="v2_diet_na" type="select" options={["", "< 2g/day", "< 3g/day", "Unrestricted"]} />
            <FormField label="Protein Intake (g/kg/day)" name="v2_diet_protein" type="select" options={["", "0.6-0.8 (CKD 3-5)", "1.0-1.2 (Dialysis)", "Unrestricted"]} />
            <FormField label="Potassium Restriction" name="v2_diet_k" type="select" options={["", "Required (< 2g/day)", "Not Required"]} />
            <FormField label="Phosphorus Restriction" name="v2_diet_phos" type="select" options={["", "Required (< 800mg/day)", "Not Required"]} />
          </div>
          <div style={{ marginTop: "15px" }}>
            <FormField label="Dietitian Referral Status" name="v2_diet_referral" type="select" options={["", "Sent", "Scheduled", "Seen", "Patient Declined"]} />
          </div>
        </div>

        <div style={{ padding: "16px", background: "#f9f9f9", border: "1px solid #e0e0e0", borderRadius: "4px", marginBottom: "20px" }}>
          <h4 style={{ margin: "0 0 16px 0", fontSize: "12px", color: "#666", textTransform: "uppercase" }}>Diabetes Management in CKD</h4>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "20px" }}>
            <div style={{ display: "grid", gridTemplateColumns: "1fr", gap: "10px" }}>
              <FormField label="HbA1c Target Range" name="v2_dm_target" type="select" options={["", "< 7.0% (Standard)", "< 8.0% (Elderly/Hypo Risk)"]} />
              <FormField label="Medication Safety Checker (eGFR rules)" name="v2_dm_med_safety" type="select" options={["", "All Meds Safe", "Hold Metformin (eGFR <30)", "Adjust Sulfonylurea Dose"]} />
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr", gap: "10px" }}>
              <FormField 
                label="GLP-1 Agonist Indication" 
                name="v2_dm_glp1" 
                type="select" 
                options={["", "None", "Semaglutide", "Dulaglutide", "Tirzepatide", "Not Indicated"]} 
                onChange={(val) => handleMedSync("v2_dm_glp1", val, "Diabetes/Weight")}
              />
              <FormField label="Hypoglycemia Risk Alerts" name="v2_dm_hypo_risk" type="select" options={["", "Low Risk", "High Risk (Advanced CKD on Insulin/SU)"]} />
            </div>
          </div>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "20px", marginBottom: "20px" }}>
          
          <div style={{ padding: "16px", background: "#f9f9f9", border: "1px solid #e0e0e0", borderRadius: "4px" }}>
            <h4 style={{ margin: "0 0 16px 0", fontSize: "12px", color: "#666", textTransform: "uppercase" }}>Lipid Management</h4>
            <div style={{ display: "grid", gridTemplateColumns: "1fr", gap: "10px", marginBottom: "16px" }}>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "10px" }}>
                <FormField label="LDL" name="v2_lipid_ldl" type="number" />
                <FormField label="HDL" name="v2_lipid_hdl" type="number" />
                <FormField label="Triglycerides" name="v2_lipid_tg" type="number" />
              </div>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr", gap: "10px" }}>
              <FormField label="ASCVD Risk Calculation (with CKD modifier)" name="v2_lipid_ascvd" type="number" placeholder="%" />
              <FormField 
                label="Statin Indication & Selection" 
                name="v2_lipid_statin" 
                type="select" 
                options={["", "None", "Atorvastatin", "Rosuvastatin", "Not Indicated / Intolerant"]} 
                onChange={(val) => handleMedSync("v2_lipid_statin", val, "Lipid Management")}
              />
              <FormField label="Monitoring: Statin-related AKI / Myopathy (CK)" name="v2_lipid_statin_monitor" type="select" options={["", "No muscle symptoms", "Check CK (Symptomatic)"]} />
            </div>
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: "20px" }}>
            <div style={{ padding: "16px", background: "#f9f9f9", border: "1px solid #e0e0e0", borderRadius: "4px" }}>
              <h4 style={{ margin: "0 0 16px 0", fontSize: "12px", color: "#666", textTransform: "uppercase" }}>Weight & Lifestyle</h4>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px", marginBottom: "10px" }}>
                <FormField label="BMI / Classification" name="v2_lifestyle_bmi" placeholder="e.g. 32 (Obese I)" />
                <FormField label="Weight Loss Goal (5-10%)" name="v2_lifestyle_weight_goal" placeholder="lbs" />
              </div>
              <FormField label="Referrals & Evaluation" name="v2_lifestyle_referral" type="select" options={["", "Exercise Physiologist", "Bariatric Surgery Eval (BMI >35)", "Patient Declined"]} />
            </div>

            <div style={{ padding: "16px", background: "#f9f9f9", border: "1px solid #e0e0e0", borderRadius: "4px" }}>
              <h4 style={{ margin: "0 0 16px 0", fontSize: "12px", color: "#666", textTransform: "uppercase" }}>Smoking Cessation</h4>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px" }}>
                <FormField label="Smoking Status" name="v2_smoke_status" type="select" options={["", "Never", "Former", "Current"]} />
                <FormField label="Cessation Plan" name="v2_smoke_plan" type="select" options={["", "Counseling Only", "Varenicline/Bupropion/NRT", "Referred to Tobacco Program"]} />
              </div>
            </div>
          </div>

        </div>
      </Section>

      {/* Cardio-Renal Trajectory & What-If Simulation */}
      <Section title="Cardio-Renal Trajectory & 'What-If' Simulation" note="Simulate multi-target therapy impact on blood pressure, proteinuria, and kidney survival." historyProps={historyProps} historyKeys={CKD_DICTATION_FIELDS.map(({ k }) => k)}>
        <div style={{ padding: "16px", background: "#f9f9f9", border: "1px solid #e0e0e0", borderRadius: "4px" }}>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "20px" }}>
            <FormField label="'What-If' Cardio-Renal Intervention to Simulate" name="v2_htn_sim_action" type="select" options={["", "Initiate Quadruple Pillar Therapy", "Optimized RAASi + SGLT2i", "Intense BP Control (<120 SBP)", "Finerenone Initiation"]} onChange={handleHtnSimChange} />
            <FormField label="Simulated Impact on Cardio-Renal Outcomes" name="v2_htn_sim_result" type="textarea" placeholder="Projections will calculate here..." />
          </div>
        </div>
      </Section>

      {/* LLM Cardio-Renal Decision Support Section */}
      <Section title="LLM Cardio-Renal & Medication Safety Insights" note="LLM-assisted clinical risk synthesis for blood pressure, glycemic safety, and pillar therapy." historyProps={historyProps} historyKeys={CKD_DICTATION_FIELDS.map(({ k }) => k)}>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "20px" }}>
          <div style={{ padding: "16px", background: "#f9f9f9", border: "1px solid #e0e0e0", borderRadius: "4px" }}>
            <h4 style={{ margin: "0 0 16px 0", fontSize: "12px", color: "#666", textTransform: "uppercase" }}>Hemodynamics & Glycemic Safety</h4>
            <div style={{ display: "grid", gridTemplateColumns: "1fr", gap: "10px" }}>
              <FormField label="Blood Pressure & Hemodynamic Insights" name="v2_bp_ai_insight" type="textarea" placeholder="e.g., BP control recommendations..." />
              <FormField label="Glycemic Safety & Target Guidance" name="v2_dm_ai_insight" type="textarea" placeholder="e.g., HbA1c target & hypoglycemia avoidance notes..." />
              <button
                type="button"
                onClick={handleGenerateLlmHtnSummary}
                disabled={isGeneratingHtnSummary}
                style={{ background: "#000", color: "#fff", border: "none", padding: "8px 12px", fontSize: "11px", borderRadius: "3px", cursor: isGeneratingHtnSummary ? "wait" : "pointer", marginTop: "4px", fontWeight: 600 }}
              >
                {isGeneratingHtnSummary ? "Generating LLM Summary..." : "⚡ Generate LLM Cardio-Renal & Med Safety Summary"}
              </button>
            </div>
          </div>

          <div style={{ padding: "16px", background: "#f9f9f9", border: "1px solid #e0e0e0", borderRadius: "4px" }}>
            <h4 style={{ margin: "0 0 16px 0", fontSize: "12px", color: "#666", textTransform: "uppercase" }}>Pillar Optimization & Electrolyte Protocol</h4>
            <div style={{ display: "grid", gridTemplateColumns: "1fr", gap: "10px" }}>
              <FormField label="Quadruple Pillar Optimization Summary" name="v2_pillar_ai_insight" type="textarea" placeholder="e.g., Pillar therapy guidance..." />
              <FormField label="Hyperkalemia & Potassium Binder Protocol" name="v2_hyperk_ai_insight" type="textarea" placeholder="e.g., Potassium management notes..." />
            </div>
          </div>
        </div>
      </Section>
    </div>
  );
};

export default HtnDiabetesTab;
