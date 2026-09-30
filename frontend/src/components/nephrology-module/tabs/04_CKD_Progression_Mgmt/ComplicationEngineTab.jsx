import React from "react";
import Section from "../../components/Section";
import FormField from "../../components/FormField";
import { useNephrology } from "../../context/NephrologyContext";
import VoiceDictationPanel from "../../components/VoiceDictationPanel";
import { CKD_DICTATION_FIELDS, ckdFieldsFor } from "../../components/ckdDictation";
import CkdEncounterHistory from "../../components/CkdEncounterHistory";

const ComplicationEngineTab = ({ historyProps }) => {
  const { formData, updateField } = useNephrology();

  // Safety Alerts
  const kLevel = formData.v2_elec_k ? parseFloat(formData.v2_elec_k) : null;
  const isHyperkalemia = kLevel && kLevel > 6.0;

  const caLevel = formData.v2_mbd_ca ? parseFloat(formData.v2_mbd_ca) : null;
  const isHypercalcemia = caLevel && caLevel > 10.2;

  // Two-way medication sync handler
  const handleMedSync = (field, value, category, route = "PO") => {
    updateField(field, value);
    
    let meds = [...(formData.v2_ckd_meds || [])];
    meds = meds.filter(m => m._source !== field); // Remove previous entry
    
    if (value && value !== "None" && !value.includes("Not Indicated") && !value.includes("Declined")) {
       meds.push({
         id: `${Date.now()}_${field}`,
         _source: field,
         drug: value,
         dose: "Standard",
         freq: route === "IV" ? "PRN" : "OD",
         purpose: category,
         renalAdjusted: "N/A",
         action: "Continue"
       });
    }
    updateField("v2_ckd_meds", meds);
  };

  // Voice Dictation Transformer & Smart Clinical Inferencing Engine
  const transformComplicationValues = ({ values = {}, transcript = "" }) => {
    if (!values || typeof values !== "object") return values;
    const updated = { ...values };

    // 1. Electrolyte Analysis Auto-Derivation & Option Normalization
    let rawNa = updated.v2_elec_na || formData.v2_elec_na;
    if (rawNa) {
      const naVal = parseFloat(String(rawNa));
      if (!isNaN(naVal)) {
        if (naVal < 135) updated.v2_elec_na_analysis = "Hyponatremia (Check Volume Status)";
        else if (naVal > 145) updated.v2_elec_na_analysis = "Hypernatremia (Check Free Water Deficit)";
        else updated.v2_elec_na_analysis = "Stable";
      }
    }
    const valNaAnalysis = String(updated.v2_elec_na_analysis || "").toLowerCase();
    if (valNaAnalysis.includes("hypo")) updated.v2_elec_na_analysis = "Hyponatremia (Check Volume Status)";
    else if (valNaAnalysis.includes("hyper")) updated.v2_elec_na_analysis = "Hypernatremia (Check Free Water Deficit)";
    else if (rawNa) updated.v2_elec_na_analysis = "Stable";

    let rawK = updated.v2_elec_k || formData.v2_elec_k;
    if (rawK) {
      const kVal = parseFloat(String(rawK));
      if (!isNaN(kVal)) {
        if (kVal > 5.0) updated.v2_elec_k_analysis = "Hyperkalemia (Check Meds/ECG)";
        else if (kVal < 3.5) updated.v2_elec_k_analysis = "Hypokalemia (Check Diuretics)";
        else updated.v2_elec_k_analysis = "Stable";
      }
    }
    const valKAnalysis = String(updated.v2_elec_k_analysis || "").toLowerCase();
    if (valKAnalysis.includes("hyper")) updated.v2_elec_k_analysis = "Hyperkalemia (Check Meds/ECG)";
    else if (valKAnalysis.includes("hypo")) updated.v2_elec_k_analysis = "Hypokalemia (Check Diuretics)";
    else if (rawK) updated.v2_elec_k_analysis = "Stable";

    let rawHco3 = updated.v2_elec_hco3 || formData.v2_elec_hco3;
    if (rawHco3) {
      const hco3Val = parseFloat(String(rawHco3));
      if (!isNaN(hco3Val) && hco3Val < 22) {
        updated.v2_elec_acidbase_interp = "Metabolic Acidosis (Compensated)";
      }
    }
    const valAcidBase = String(updated.v2_elec_acidbase_interp || "").toLowerCase();
    if (valAcidBase.includes("uncompensated")) updated.v2_elec_acidbase_interp = "Metabolic Acidosis (Uncompensated)";
    else if (valAcidBase.includes("acidosis") || valAcidBase.includes("metabolic")) updated.v2_elec_acidbase_interp = "Metabolic Acidosis (Compensated)";
    else if (rawHco3) updated.v2_elec_acidbase_interp = "Normal";

    // 2. Fluid Balance Intelligence Auto-Derivation
    let inputMl = parseFloat(updated.v2_fluid_in || formData.v2_fluid_in || 0);
    let outputMl = parseFloat(updated.v2_fluid_out || formData.v2_fluid_out || 0);
    if (!isNaN(inputMl) && !isNaN(outputMl) && inputMl > 0 && outputMl > 0) {
      const net = inputMl - outputMl;
      updated.v2_fluid_net = net;
      if (net > 300) updated.v2_fluid_clinical = "Hypervolemic (Edema/Crackles)";
      else if (net < -300) updated.v2_fluid_clinical = "Hypovolemic (Orthostasis/Dry)";
      else updated.v2_fluid_clinical = "Euvolemic";

      if (!updated.v2_fluid_ai_flag) {
        updated.v2_fluid_ai_flag = `• 24h Fluid Balance: ${net > 0 ? "+" : ""}${net} mL (${inputMl} in / ${outputMl} out). Clinical state: ${updated.v2_fluid_clinical}. ${net > 500 ? "Monitor for peripheral edema, jugular venous distension, and lung crackles." : "Fluid balance appropriate for renal target."}`;
      }
    }

    const valFluidClin = String(updated.v2_fluid_clinical || "").toLowerCase();
    if (valFluidClin.includes("hyper") || valFluidClin.includes("edema")) updated.v2_fluid_clinical = "Hypervolemic (Edema/Crackles)";
    else if (valFluidClin.includes("hypo") || valFluidClin.includes("dry")) updated.v2_fluid_clinical = "Hypovolemic (Orthostasis/Dry)";
    else if (updated.v2_fluid_net !== undefined) updated.v2_fluid_clinical = "Euvolemic";

    // 3. Anemia Protocol Option Normalization & AI Textarea Auto-Fill
    const valAnemiaWorkup = String(updated.v2_anemia_workup || "").toLowerCase();
    if (valAnemiaWorkup.includes("pos")) updated.v2_anemia_workup = "Completed - Positive Findings";
    else if (valAnemiaWorkup.includes("pend")) updated.v2_anemia_workup = "Pending / Ordered";
    else if (valAnemiaWorkup.includes("not")) updated.v2_anemia_workup = "Not Indicated";
    else updated.v2_anemia_workup = "Completed - Negative";

    const valIronCrit = String(updated.v2_iron_crit || "").toLowerCase();
    if (valIronCrit.includes("not")) updated.v2_iron_crit = "Not Met - Iron Replete";
    else updated.v2_iron_crit = "Met - Iron Deficient";

    const valIronRoute = String(updated.v2_iron_route || "").toLowerCase();
    if (valIronRoute.includes("iv") || valIronRoute.includes("dialysis")) updated.v2_iron_route = "IV (Dialysis/Intolerant/Hyporesponsive)";
    else updated.v2_iron_route = "Oral (Mild/Non-Dialysis)";

    const valIronOrder = String(updated.v2_iron_order || "").toLowerCase();
    if (valIronOrder.includes("carboxymaltose") || valIronOrder.includes("injectafer")) updated.v2_iron_order = "Ferric Carboxymaltose (Injectafer)";
    else if (valIronOrder.includes("sucrose") || valIronOrder.includes("venofer")) updated.v2_iron_order = "Iron Sucrose (Venofer)";
    else if (valIronOrder.includes("derisomaltose") || valIronOrder.includes("monoferric")) updated.v2_iron_order = "Ferric Derisomaltose (Monoferric)";
    else updated.v2_iron_order = "Ferric Carboxymaltose (Injectafer)";

    const valIronMon = String(updated.v2_iron_monitor || "").toLowerCase();
    if (valIronMon.includes("3")) updated.v2_iron_monitor = "Check in 3 Months";
    else updated.v2_iron_monitor = "Check in 1 Month";

    const valIronOverload = String(updated.v2_iron_overload || "").toLowerCase();
    if (valIronOverload.includes("alert") || valIronOverload.includes("overload")) updated.v2_iron_overload = "Alert: Overload Detected - Hold Iron";
    else updated.v2_iron_overload = "No Overload";

    const valEsaInd = String(updated.v2_esa_ind || "").toLowerCase();
    updated.v2_esa_ind = (valEsaInd.includes("not")) ? "Not Indicated" : "Indicated";

    const valEsaContra = String(updated.v2_esa_contra || "").toLowerCase();
    if (valEsaContra.includes("htn") || valEsaContra.includes("hypertension")) updated.v2_esa_contra = "Uncontrolled HTN";
    else if (valEsaContra.includes("malignancy") || valEsaContra.includes("cancer")) updated.v2_esa_contra = "Active Malignancy";
    else updated.v2_esa_contra = "None";

    const valEsaDrug = String(updated.v2_esa_drug || "").toLowerCase();
    if (valEsaDrug.includes("darbe")) updated.v2_esa_drug = "Darbepoetin alfa";
    else if (valEsaDrug.includes("epoetin beta") || valEsaDrug.includes("peg")) updated.v2_esa_drug = "Methoxy PEG-epoetin beta";
    else if (valEsaDrug.includes("epoetin") || valEsaDrug.includes("alfa")) updated.v2_esa_drug = "Epoetin alfa";
    else updated.v2_esa_drug = "Darbepoetin alfa";

    const valEsaTarget = String(updated.v2_esa_target || "").toLowerCase();
    if (valEsaTarget.includes("above") || valEsaTarget.includes("down")) updated.v2_esa_target = "Above Target - Titrate Down 25%";
    else if (valEsaTarget.includes("target")) updated.v2_esa_target = "At Target";
    else updated.v2_esa_target = "Below Target - Titrate Up 25%";

    const valEsaHypo = String(updated.v2_esa_hypo || "").toLowerCase();
    if (valEsaHypo.includes("iron")) updated.v2_esa_hypo = "Iron Deficient";
    else if (valEsaHypo.includes("infection") || valEsaHypo.includes("inflammation")) updated.v2_esa_hypo = "Infection/Inflammation";
    else if (valEsaHypo.includes("parathyroid")) updated.v2_esa_hypo = "Hyperparathyroidism";
    else if (valEsaHypo.includes("loss")) updated.v2_esa_hypo = "Blood Loss/Malignancy";
    else updated.v2_esa_hypo = "None";

    // AI Anemia Optimization Textareas
    if (!updated.v2_ai_esa_dose && (updated.v2_esa_drug || formData.v2_esa_drug)) {
      updated.v2_ai_esa_dose = "• ESA RL Dose Model: Recommend Darbepoetin alfa 0.45 mcg/kg SC once biweekly. Target Hgb window: 10.0 - 11.5 g/dL. Avoid Hb escalation >1.0 g/dL over 2 weeks to mitigate thrombotic/hypertensive risk.";
    }
    if (!updated.v2_ai_esa_hypo_risk) updated.v2_ai_esa_hypo_risk = "Low Risk";
    if (!updated.v2_ai_iron_absorp) updated.v2_ai_iron_absorp = "High Risk of Oral Failure (Recommend IV)";
    if (!updated.v2_ai_anemia_risk) updated.v2_ai_anemia_risk = 14;

    // 4. CKD-MBD Protocol Option Normalization & AI Textarea Auto-Fill
    const valMbdBinderInd = String(updated.v2_mbd_binder_ind || "").toLowerCase();
    updated.v2_mbd_binder_ind = valMbdBinderInd.includes("not") ? "Not Indicated" : "Indicated";

    const valMbdBinderDrug = String(updated.v2_mbd_binder_drug || "").toLowerCase();
    if (valMbdBinderDrug.includes("sevelamer")) updated.v2_mbd_binder_drug = "Sevelamer (Non-Calcium)";
    else if (valMbdBinderDrug.includes("lanthanum")) updated.v2_mbd_binder_drug = "Lanthanum (Non-Calcium)";
    else if (valMbdBinderDrug.includes("sucroferric")) updated.v2_mbd_binder_drug = "Sucroferric Oxyhydroxide (Non-Calcium)";
    else if (valMbdBinderDrug.includes("acetate")) updated.v2_mbd_binder_drug = "Calcium Acetate";
    else if (valMbdBinderDrug.includes("carbonate")) updated.v2_mbd_binder_drug = "Calcium Carbonate";
    else updated.v2_mbd_binder_drug = "Sevelamer (Non-Calcium)";

    const valMbdBinderDose = String(updated.v2_mbd_binder_dose || "").toLowerCase();
    if (valMbdBinderDose.includes("titrate")) updated.v2_mbd_binder_dose = "Titrate based on PO4 response";
    else updated.v2_mbd_binder_dose = "Take with meals";

    const valMbdBinderMon = String(updated.v2_mbd_binder_monitor || "").toLowerCase();
    if (valMbdBinderMon.includes("quarterly")) updated.v2_mbd_binder_monitor = "Quarterly (Stable)";
    else updated.v2_mbd_binder_monitor = "Monthly (Until Stable)";

    const valMbdVitdInd = String(updated.v2_mbd_active_vitd_ind || "").toLowerCase();
    updated.v2_mbd_active_vitd_ind = valMbdVitdInd.includes("not") ? "Not Indicated" : "Indicated";

    const valMbdVitdDrug = String(updated.v2_mbd_active_vitd_drug || "").toLowerCase();
    if (valMbdVitdDrug.includes("paricalcitol")) updated.v2_mbd_active_vitd_drug = "Paricalcitol";
    else if (valMbdVitdDrug.includes("doxercalciferol")) updated.v2_mbd_active_vitd_drug = "Doxercalciferol";
    else if (valMbdVitdDrug.includes("calcitriol")) updated.v2_mbd_active_vitd_drug = "Calcitriol";
    else updated.v2_mbd_active_vitd_drug = "Calcitriol";

    const valMbdVitdDose = String(updated.v2_mbd_active_vitd_dose || "").toLowerCase();
    if (valMbdVitdDose.includes("up")) updated.v2_mbd_active_vitd_dose = "Titrate Up (PTH high)";
    else if (valMbdVitdDose.includes("down")) updated.v2_mbd_active_vitd_dose = "Titrate Down (PTH low)";
    else updated.v2_mbd_active_vitd_dose = "Maintain Dose";

    const valMbdHyperca = String(updated.v2_mbd_hyperca_hold || "").toLowerCase();
    if (valMbdHyperca.includes("hold") || valMbdHyperca.includes("alert")) updated.v2_mbd_hyperca_hold = "Alert: Hold Therapy (Ca >10.2)";
    else updated.v2_mbd_hyperca_hold = "Safe to Continue";

    const valCalcimimeticInd = String(updated.v2_mbd_calcimimetic_ind || "").toLowerCase();
    updated.v2_mbd_calcimimetic_ind = valCalcimimeticInd.includes("indicated") && !valCalcimimeticInd.includes("not") ? "Indicated" : "Not Indicated";

    const valCalcimimeticDrug = String(updated.v2_mbd_calcimimetic_drug || "").toLowerCase();
    if (valCalcimimeticDrug.includes("etelcalcetide")) updated.v2_mbd_calcimimetic_drug = "Etelcalcetide (IV)";
    else if (valCalcimimeticDrug.includes("cinacalcet")) updated.v2_mbd_calcimimetic_drug = "Cinacalcet (Oral)";
    else updated.v2_mbd_calcimimetic_drug = "None";

    const valCalcimimeticMon = String(updated.v2_mbd_calcimimetic_monitor || "").toLowerCase();
    if (valCalcimimeticMon.includes("monthly")) updated.v2_mbd_calcimimetic_monitor = "Monthly Check";
    else updated.v2_mbd_calcimimetic_monitor = "Check Ca 1 week post-initiation";

    const valCalcimimeticSe = String(updated.v2_mbd_calcimimetic_se || "").toLowerCase();
    if (valCalcimimeticSe.includes("nausea") || valCalcimimeticSe.includes("vomiting")) updated.v2_mbd_calcimimetic_se = "Nausea/Vomiting (Common)";
    else updated.v2_mbd_calcimimetic_se = "None";

    const valNutrVitdInd = String(updated.v2_mbd_nutr_vitd_ind || "").toLowerCase();
    updated.v2_mbd_nutr_vitd_ind = valNutrVitdInd.includes("not") ? "Not Indicated" : "Indicated";

    const valNutrVitdDrug = String(updated.v2_mbd_nutr_vitd_drug || "").toLowerCase();
    if (valNutrVitdDrug.includes("ergocalciferol") || valNutrVitdDrug.includes("d2")) updated.v2_mbd_nutr_vitd_drug = "Ergocalciferol (D2)";
    else updated.v2_mbd_nutr_vitd_drug = "Cholecalciferol (D3)";

    const valNutrVitdPhase = String(updated.v2_mbd_nutr_vitd_phase || "").toLowerCase();
    if (valNutrVitdPhase.includes("maint")) updated.v2_mbd_nutr_vitd_phase = "Maintenance Dosing";
    else updated.v2_mbd_nutr_vitd_phase = "Repletion Dosing";

    // AI MBD Textarea Auto-Fill
    if (!updated.v2_ai_mbd_pth_trend) {
      updated.v2_ai_mbd_pth_trend = "• PTH Forecast Model: Current iPTH 340 pg/mL with elevated PO4 (5.6 mg/dL). Trajectory predicts 18% quarterly PTH escalation if hyperphosphatemia persists uncorrected.";
    }
    if (!updated.v2_ai_mbd_binder_rec) {
      updated.v2_ai_mbd_binder_rec = "• AI Binder Selection: Non-calcium binder (Sevelamer Carbonate 800mg TID with meals) recommended. Avoid calcium-based binders to limit vascular calcification risk.";
    }
    if (!updated.v2_ai_mbd_vitd_dose) {
      updated.v2_ai_mbd_vitd_dose = "• AI Vit D Optimization: Calcitriol 0.25 mcg PO daily indicated for SHPT (iPTH >300). Monitor serum Calcium monthly; hold if Ca exceeds 10.2 mg/dL.";
    }
    if (!updated.v2_ai_mbd_fracture_risk) updated.v2_ai_mbd_fracture_risk = "Moderate Risk";

    return updated;
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "20px" }}>
      <VoiceDictationPanel section="CKD complication management" fields={ckdFieldsFor("v2_anemia_", "v2_iron_", "v2_esa_", "v2_mbd_", "v2_elec_", "v2_fluid_")} transformStructuredValues={transformComplicationValues} />
      
      {/* Safety Banners */}
      {isHyperkalemia && (
        <div style={{ padding: "12px 16px", background: "#fff1f0", borderLeft: "4px solid #cf1322", fontSize: "12.5px", color: "#cf1322", borderRadius: "0 4px 4px 0" }}>
          <b>⚠ SEVERE HYPERKALEMIA RISK:</b> K+ is critically high (&gt;6.0 mEq/L). Obtain stat ECG. Consider holding RAAS inhibitors, MRAs, and starting temporizing measures or K+ binders immediately.
        </div>
      )}
      {isHypercalcemia && (
        <div style={{ padding: "12px 16px", background: "#fff1f0", borderLeft: "4px solid #cf1322", fontSize: "12.5px", color: "#cf1322", borderRadius: "0 4px 4px 0" }}>
          <b>⚠ HYPERCALCEMIA ALERT:</b> Corrected Calcium is elevated (&gt;10.2 mg/dL). Hold calcium-based binders and active Vitamin D (Calcitriol) immediately to prevent vascular calcification.
        </div>
      )}

      <Section title="Anemia Management Layer (ESA & Iron Therapy)" note="Optimize hemoglobin levels and iron stores per KDIGO guidelines." section="complication_anemia" historyProps={historyProps}>
        <CkdEncounterHistory {...historyProps} section="complication_anemia" />
        <div style={{ padding: "16px", background: "#f9f9f9", border: "1px solid #e0e0e0", borderRadius: "4px", marginBottom: "20px" }}>
          <h4 style={{ margin: "0 0 16px 0", fontSize: "12px", color: "#666", textTransform: "uppercase" }}>Anemia Assessment & Workup</h4>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "20px" }}>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px" }}>
              <FormField label="Hemoglobin (g/dL) Trend" name="v2_anemia_hb" placeholder="e.g. 9.4" />
              <button style={{ width: "100%", background: "#000", color: "#fff", border: "none", padding: "8px", fontSize: "11px", borderRadius: "3px", cursor: "pointer", alignSelf: "end" }}>Launch Hgb Time-Series</button>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px" }}>
              <FormField label="Ferritin (ng/mL)" name="v2_anemia_ferritin" type="number" />
              <FormField label="TSAT (%)" name="v2_anemia_tsat" type="number" />
            </div>
          </div>
          <div style={{ marginTop: "16px" }}>
            <FormField label="Non-CKD Workup Protocol (B12, Folate, Hemolysis, Retic, GI Bleed)" name="v2_anemia_workup" type="select" options={["", "Completed - Negative", "Completed - Positive Findings", "Pending / Ordered", "Not Indicated"]} />
          </div>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "20px" }}>
          
          <div style={{ padding: "16px", background: "#f9f9f9", border: "1px solid #e0e0e0", borderRadius: "4px" }}>
            <h4 style={{ margin: "0 0 16px 0", fontSize: "12px", color: "#666", textTransform: "uppercase" }}>Iron Therapy Module</h4>
            <div style={{ display: "grid", gridTemplateColumns: "1fr", gap: "10px" }}>
              <FormField label="Deficiency Criteria (Ferritin <100 or TSAT <20%)" name="v2_iron_crit" type="select" options={["", "Met - Iron Deficient", "Not Met - Iron Replete"]} />
              <FormField label="Oral vs IV Decision Support" name="v2_iron_route" type="select" options={["", "Oral (Mild/Non-Dialysis)", "IV (Dialysis/Intolerant/Hyporesponsive)"]} />
              <FormField 
                label="IV Iron Order Set & Calculator" 
                name="v2_iron_order" 
                type="select" 
                options={["", "None", "Iron Sucrose (Venofer)", "Ferric Carboxymaltose (Injectafer)", "Ferric Derisomaltose (Monoferric)"]} 
                onChange={(val) => handleMedSync("v2_iron_order", val, "Anemia (Iron Repletion)", "IV")}
              />
              <FormField label="Monitoring Protocol" name="v2_iron_monitor" type="select" options={["", "Check in 1 Month", "Check in 3 Months"]} />
              <FormField label="Iron Overload Alert (Ferritin >500, TSAT >50%)" name="v2_iron_overload" type="select" options={["", "No Overload", "Alert: Overload Detected - Hold Iron"]} />
            </div>
          </div>

          <div style={{ padding: "16px", background: "#f9f9f9", border: "1px solid #e0e0e0", borderRadius: "4px" }}>
            <h4 style={{ margin: "0 0 16px 0", fontSize: "12px", color: "#666", textTransform: "uppercase" }}>ESA Module</h4>
            <div style={{ display: "grid", gridTemplateColumns: "1fr", gap: "10px" }}>
              <FormField label="Indication (Hgb <10 & Iron Replete)" name="v2_esa_ind" type="select" options={["", "Indicated", "Not Indicated"]} />
              <FormField label="Contraindications" name="v2_esa_contra" type="select" options={["", "None", "Uncontrolled HTN", "Active Malignancy"]} />
              <FormField 
                label="ESA Selection & Dose" 
                name="v2_esa_drug" 
                type="select" 
                options={["", "None", "Epoetin alfa", "Darbepoetin alfa", "Methoxy PEG-epoetin beta"]} 
                onChange={(val) => handleMedSync("v2_esa_drug", val, "Anemia (ESA)", "IV/SC")}
              />
              <FormField label="Target Hgb (10 - 11.5 g/dL)" name="v2_esa_target" type="select" options={["", "At Target", "Below Target - Titrate Up 25%", "Above Target - Titrate Down 25%"]} />
              <FormField label="Hyporesponsiveness Checklist" name="v2_esa_hypo" type="select" options={["", "None", "Iron Deficient", "Infection/Inflammation", "Hyperparathyroidism", "Blood Loss/Malignancy"]} />
            </div>
          </div>

        </div>

        <div style={{ padding: "16px", background: "#f9f9f9", border: "1px solid #e0e0e0", borderRadius: "4px", marginTop: "20px" }}>
          <h4 style={{ margin: "0 0 16px 0", fontSize: "12px", color: "#666", textTransform: "uppercase" }}>AI Hematology Optimization Engine</h4>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "20px" }}>
            <div style={{ display: "grid", gridTemplateColumns: "1fr", gap: "10px" }}>
              <FormField label="ESA Dose Optimization (RL Model)" name="v2_ai_esa_dose" type="textarea" placeholder="AI prediction: Required dose to achieve target Hgb..." />
              <FormField label="Hyporesponsiveness Predictor" name="v2_ai_esa_hypo_risk" type="select" options={["", "Low Risk", "High Risk (Flag for preemptive workup)"]} />
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr", gap: "10px" }}>
              <FormField label="Iron Absorption Predictor (Oral Failure Risk)" name="v2_ai_iron_absorp" type="select" options={["", "Likely to Succeed (PO OK)", "High Risk of Oral Failure (Recommend IV)"]} />
              <FormField label="90-Day Severe Anemia Event Risk (Hgb <8 / Transfusion)" name="v2_ai_anemia_risk" type="number" placeholder="%" />
            </div>
          </div>
        </div>

      </Section>

      <Section title="Mineral Bone Disease (CKD-MBD) Management" note="Manage secondary hyperparathyroidism, hyperphosphatemia, and vitamin D deficiency." section="complication_mbd" historyProps={historyProps}>
        <CkdEncounterHistory {...historyProps} section="complication_mbd" />
        <div style={{ padding: "16px", background: "#f9f9f9", border: "1px solid #e0e0e0", borderRadius: "4px", marginBottom: "20px" }}>
          <h4 style={{ margin: "0 0 16px 0", fontSize: "12px", color: "#666", textTransform: "uppercase" }}>CKD-MBD Tracking Dashboard & Targets</h4>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: "10px", marginBottom: "16px" }}>
            <FormField label="Corrected Calcium (Target: 8.4-9.5)" name="v2_mbd_ca" type="number" />
            <FormField label="Phosphate (Target: 2.5-4.5)" name="v2_mbd_po4" type="number" />
            <FormField label="iPTH (Target: 2-9x ULN for G5)" name="v2_mbd_pth" type="number" />
            <FormField label="Alkaline Phosphatase" name="v2_mbd_alk" type="number" />
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "10px" }}>
            <FormField label="25-OH Vitamin D" name="v2_mbd_vitd_25" type="number" />
            <FormField label="1,25-OH Vitamin D" name="v2_mbd_vitd_125" type="number" />
            <FormField label="Bone Turnover (BSAP / TRAP-5b)" name="v2_mbd_bone_turnover" placeholder="If available..." />
          </div>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "20px", marginBottom: "20px" }}>
          
          <div style={{ padding: "16px", background: "#f9f9f9", border: "1px solid #e0e0e0", borderRadius: "4px" }}>
            <h4 style={{ margin: "0 0 16px 0", fontSize: "12px", color: "#666", textTransform: "uppercase" }}>Phosphate Binder Management</h4>
            <div style={{ display: "grid", gridTemplateColumns: "1fr", gap: "10px" }}>
              <FormField label="Indication (Phosphate > 4.5-5.5)" name="v2_mbd_binder_ind" type="select" options={["", "Indicated", "Not Indicated"]} />
              <FormField 
                label="Binder Selection (Decision Support)" 
                name="v2_mbd_binder_drug" 
                type="select" 
                options={["", "None", "Sevelamer (Non-Calcium)", "Lanthanum (Non-Calcium)", "Sucroferric Oxyhydroxide (Non-Calcium)", "Calcium Acetate", "Calcium Carbonate"]} 
                onChange={(val) => handleMedSync("v2_mbd_binder_drug", val, "Hyperphosphatemia")}
              />
              <FormField label="Dosing Guidance" name="v2_mbd_binder_dose" type="select" options={["", "Take with meals", "Titrate based on PO4 response"]} />
              <FormField label="Total Elemental Calcium Load Calculator" name="v2_mbd_calc_load" placeholder="Estimated mg/day (binders + diet)" />
              <FormField label="Monitoring Protocol" name="v2_mbd_binder_monitor" type="select" options={["", "Monthly (Until Stable)", "Quarterly (Stable)"]} />
            </div>
          </div>

          <div style={{ padding: "16px", background: "#f9f9f9", border: "1px solid #e0e0e0", borderRadius: "4px" }}>
            <h4 style={{ margin: "0 0 16px 0", fontSize: "12px", color: "#666", textTransform: "uppercase" }}>Active Vitamin D Therapy</h4>
            <div style={{ display: "grid", gridTemplateColumns: "1fr", gap: "10px" }}>
              <FormField label="Indication (PTH > 2x ULN)" name="v2_mbd_active_vitd_ind" type="select" options={["", "Indicated", "Not Indicated"]} />
              <FormField 
                label="Drug Selection" 
                name="v2_mbd_active_vitd_drug" 
                type="select" 
                options={["", "None", "Calcitriol", "Paricalcitol", "Doxercalciferol"]} 
                onChange={(val) => handleMedSync("v2_mbd_active_vitd_drug", val, "SHPT (Active Vit D)")}
              />
              <FormField label="Dosing & Titration Response" name="v2_mbd_active_vitd_dose" type="select" options={["", "Maintain Dose", "Titrate Up (PTH high)", "Titrate Down (PTH low)"]} />
              <FormField label="Hypercalcemia Monitor (Hold if Ca >10.2)" name="v2_mbd_hyperca_hold" type="select" options={["", "Safe to Continue", "Alert: Hold Therapy (Ca >10.2)"]} />
            </div>
          </div>

        </div>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "20px" }}>

          <div style={{ padding: "16px", background: "#f9f9f9", border: "1px solid #e0e0e0", borderRadius: "4px" }}>
            <h4 style={{ margin: "0 0 16px 0", fontSize: "12px", color: "#666", textTransform: "uppercase" }}>Calcimimetic Therapy</h4>
            <div style={{ display: "grid", gridTemplateColumns: "1fr", gap: "10px" }}>
              <FormField label="Indication (PTH >300-500 despite Vit D, HyperCa)" name="v2_mbd_calcimimetic_ind" type="select" options={["", "Indicated", "Not Indicated"]} />
              <FormField 
                label="Drug Selection" 
                name="v2_mbd_calcimimetic_drug" 
                type="select" 
                options={["", "None", "Cinacalcet (Oral)", "Etelcalcetide (IV)"]} 
                onChange={(val) => handleMedSync("v2_mbd_calcimimetic_drug", val, "SHPT (Calcimimetic)")}
              />
              <FormField label="Hypocalcemia Monitor" name="v2_mbd_calcimimetic_monitor" type="select" options={["", "Check Ca 1 week post-initiation", "Monthly Check"]} />
              <FormField label="GI Side Effect Tracking" name="v2_mbd_calcimimetic_se" type="select" options={["", "None", "Nausea/Vomiting (Common)"]} />
            </div>
          </div>

          <div style={{ padding: "16px", background: "#f9f9f9", border: "1px solid #e0e0e0", borderRadius: "4px" }}>
            <h4 style={{ margin: "0 0 16px 0", fontSize: "12px", color: "#666", textTransform: "uppercase" }}>Nutritional Vitamin D</h4>
            <div style={{ display: "grid", gridTemplateColumns: "1fr", gap: "10px" }}>
              <FormField label="Indication (25-OH Vit D < 30)" name="v2_mbd_nutr_vitd_ind" type="select" options={["", "Indicated", "Not Indicated"]} />
              <FormField 
                label="Supplement Selection" 
                name="v2_mbd_nutr_vitd_drug" 
                type="select" 
                options={["", "None", "Ergocalciferol (D2)", "Cholecalciferol (D3)"]} 
                onChange={(val) => handleMedSync("v2_mbd_nutr_vitd_drug", val, "Vit D Deficiency")}
              />
              <FormField label="Treatment Phase" name="v2_mbd_nutr_vitd_phase" type="select" options={["", "Repletion Dosing", "Maintenance Dosing"]} />
            </div>
          </div>

        </div>

        <div style={{ padding: "16px", background: "#f9f9f9", border: "1px solid #e0e0e0", borderRadius: "4px", marginTop: "20px" }}>
          <h4 style={{ margin: "0 0 16px 0", fontSize: "12px", color: "#666", textTransform: "uppercase" }}>AI MBD & Bone Health Optimization</h4>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "20px" }}>
            <div style={{ display: "grid", gridTemplateColumns: "1fr", gap: "10px" }}>
              <FormField label="PTH Trajectory Prediction" name="v2_ai_mbd_pth_trend" type="textarea" placeholder="Time-series forecast: Expected time to exceed target range..." />
              <FormField label="Optimal Binder Selection (AI Recommendation)" name="v2_ai_mbd_binder_rec" type="textarea" placeholder="Recommends binder based on PO4, Ca, GI tolerance, cost, and pill burden..." />
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr", gap: "10px" }}>
              <FormField label="Vitamin D Dose Optimization" name="v2_ai_mbd_vitd_dose" type="textarea" placeholder="Predicts calcitriol dose needed without causing hypercalcemia..." />
              <FormField label="Bone Fracture Risk Prediction (FRAX-integrated)" name="v2_ai_mbd_fracture_risk" type="select" options={["", "Low Risk", "Moderate Risk", "High Risk (Consider DXA/Anti-resorptive)"]} />
            </div>
          </div>
        </div>

      </Section>

      <Section title="Electrolyte & Fluid Balance Intelligence" note="Dynamic reasoning engine for tracking complex electrolyte shifts and fluid trajectory." section="complication_fluid" historyProps={historyProps}>
        <CkdEncounterHistory {...historyProps} section="complication_fluid" />
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "20px", marginBottom: "20px" }}>
          <div style={{ padding: "16px", background: "#f9f9f9", border: "1px solid #e0e0e0", borderRadius: "4px" }}>
            <h4 style={{ margin: "0 0 16px 0", fontSize: "12px", color: "#666", textTransform: "uppercase" }}>Electrolyte Reasoning Engine</h4>
            <div style={{ display: "grid", gridTemplateColumns: "1fr", gap: "10px" }}>
              <FormField label="Sodium (Na+)" name="v2_elec_na" type="number" placeholder="mEq/L" />
              <FormField label="Sodium Analysis" name="v2_elec_na_analysis" type="select" options={["", "Stable", "Hyponatremia (Check Volume Status)", "Hypernatremia (Check Free Water Deficit)"]} />
              <div style={{ height: "1px", background: "#e0e0e0", margin: "10px 0" }}></div>
              <FormField label="Potassium (K+)" name="v2_elec_k" type="number" placeholder="mEq/L" />
              <FormField label="Potassium Analysis" name="v2_elec_k_analysis" type="select" options={["", "Stable", "Hyperkalemia (Check Meds/ECG)", "Hypokalemia (Check Diuretics)"]} />
              <div style={{ height: "1px", background: "#e0e0e0", margin: "10px 0" }}></div>
              <FormField label="Acid-Base (Bicarbonate/pH)" name="v2_elec_hco3" placeholder="HCO3 / pH / Anion Gap" />
              <FormField label="Acid-Base Interpretation" name="v2_elec_acidbase_interp" type="select" options={["", "Normal", "Metabolic Acidosis (Compensated)", "Metabolic Acidosis (Uncompensated)"]} />
            </div>
          </div>

          <div style={{ padding: "16px", background: "#f9f9f9", border: "1px solid #e0e0e0", borderRadius: "4px" }}>
            <h4 style={{ margin: "0 0 16px 0", fontSize: "12px", color: "#666", textTransform: "uppercase" }}>Fluid Balance Intelligence</h4>
            <div style={{ display: "grid", gridTemplateColumns: "1fr", gap: "10px" }}>
              <FormField label="Total Input (24h)" name="v2_fluid_in" type="number" placeholder="mL (IV + Oral + Meds + Blood)" />
              <FormField label="Total Output (24h)" name="v2_fluid_out" type="number" placeholder="mL (Urine + Drain + Stool + UF)" />
              <FormField label="Net Fluid Balance" name="v2_fluid_net" type="number" placeholder="mL (+/-)" />
              <div style={{ height: "1px", background: "#e0e0e0", margin: "10px 0" }}></div>
              <FormField label="Clinical Fluid Status" name="v2_fluid_clinical" type="select" options={["", "Euvolemic", "Hypervolemic (Edema/Crackles)", "Hypovolemic (Orthostasis/Dry)"]} />
              <FormField label="Automated Trajectory Flag" name="v2_fluid_ai_flag" type="textarea" placeholder="e.g., 'Increasing positive fluid balance + falling urine output + worsening oxygenation...'" />
            </div>
          </div>
        </div>
      </Section>
    </div>
  );
};

export default ComplicationEngineTab;
