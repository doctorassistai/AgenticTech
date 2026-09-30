import React, { useEffect, useState } from "react";
import Section from "../../components/Section";
import FormField from "../../components/FormField";
import VoiceDictationPanel from "../../components/VoiceDictationPanel";
import { useNephrology } from "../../context/NephrologyContext";
import DICOMViewer from "../../../DICOMViewer";
import { generateDifferential } from "../../services/nephrologyApi";

const PLANNER_DICTATION_FIELDS = [
  { k: "v2_inv_conf_cr", label: "Repeat Creatinine/eGFR", type: "select", options: ["Pending", "Confirmed Chronic", "Acute Component"] },
  { k: "v2_inv_conf_uacr", label: "First Morning Urine UACR", type: "select", options: ["Pending", "Confirmed Abnormal", "Normal"] },
  { k: "v2_inv_conf_cysc", label: "Cystatin C", type: "number" },
  { k: "v2_inv_cysc_egfr", label: "Cystatin C-based eGFR", type: "number" },
  { k: "v2_inv_cysc_stage", label: "Cystatin C KDIGO G-stage", type: "text" },
  { k: "v2_inv_img_us", label: "Ultrasound Status", type: "select", options: ["Ordered", "Completed", "Reviewed"] },
  { k: "v2_inv_img_doppler", label: "Doppler Status", type: "select", options: ["Ordered", "Completed", "Reviewed"] },
  { k: "v2_inv_img_ct", label: "CT Status", type: "select", options: ["Ordered", "Completed", "Reviewed"] },
  { k: "v2_inv_img_mri", label: "MRI Status", type: "select", options: ["Ordered", "Completed", "Reviewed"] },
  { k: "v2_img_size_right", label: "Right Kidney Size", type: "number" },
  { k: "v2_img_size_left", label: "Left Kidney Size", type: "number" },
  { k: "v2_img_cortex", label: "Cortical Thickness", type: "select", options: ["Normal", "Thinned", "Thickened"] },
  { k: "v2_img_echo", label: "Echogenicity", type: "select", options: ["Normal", "Increased (Medical Renal Disease)", "Decreased"] },
  { k: "v2_img_hydro", label: "Hydronephrosis", type: "select", options: ["None", "Mild", "Moderate", "Severe"] },
  { k: "v2_img_findings", label: "Imaging Findings", type: "textarea" },
  { k: "v2_img_raw_report", label: "Raw Radiology Report", type: "textarea" },
];

const BASIC_LAB_ALIASES = {
  Creatinine: ["creatinine", "serum cr", "scr"],
  BUN: ["bun", "blood urea nitrogen"],
  eGFR: ["egfr", "estimated gfr", "estimated glomerular filtration"],
  Electrolytes: ["electrolytes", "electrolyte"],
  CBC: ["cbc", "complete blood count"],
  Calcium: ["calcium"],
  Phosphate: ["phosphate", "phosphorus"],
  Albumin: ["albumin"],
  Bicarbonate: ["bicarbonate", "co2", "carbon dioxide"],
  Urinalysis: ["urinalysis", "urine analysis", "ua"],
};

const IMMUNO_LAB_ALIASES = {
  ANA: ["ana", "antinuclear antibody"],
  ANCA: ["anca", "antineutrophil cytoplasmic antibody"],
  "Anti-GBM": ["anti-gbm", "anti gbm", "glomerular basement membrane"],
  Complement: ["complement", "c3", "c4"],
  "Anti-dsDNA": ["anti-dsdna", "anti dsdna", "double stranded dna"],
  "Hepatitis B": ["hepatitis b", "hep b"],
  "Hepatitis C": ["hepatitis c", "hep c"],
  HIV: ["hiv", "human immunodeficiency virus"],
  "Other Serologies": ["other serologies", "serology", "serologies"],
};

const selectMentionedLabs = (transcript, aliases) => {
  const normalize = (value) => ` ${String(value || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim()} `;
  const text = normalize(transcript);
  return Object.fromEntries(
    Object.entries(aliases)
      .filter(([, terms]) => terms.some((term) => text.includes(normalize(term))))
      .map(([label]) => [label, true])
  );
};

const getEgfrStage = (egfr) => {
  if (egfr >= 90) return "G1 (Normal or high)";
  if (egfr >= 60) return "G2 (Mildly decreased)";
  if (egfr >= 45) return "G3a (Mild to moderately decreased)";
  if (egfr >= 30) return "G3b (Moderately to severely decreased)";
  if (egfr >= 15) return "G4 (Severely decreased)";
  return "G5 (Kidney failure)";
};

const calculateCystatinEgfr = (cystatinC, age, sex) => {
  const serumCystatin = Number(cystatinC);
  const patientAge = Number(age);
  if (!(serumCystatin > 0) || !(patientAge > 0)) return null;
  const ratio = serumCystatin / 0.8;
  const sexFactor = String(sex || "").toLowerCase() === "female" ? 0.932 : 1;
  return 133
    * Math.pow(Math.min(ratio, 1), -0.499)
    * Math.pow(Math.max(ratio, 1), -1.328)
    * Math.pow(0.996, patientAge)
    * sexFactor;
};

const PlannerTab = () => {
  const { formData, updateField, updateFields } = useNephrology();
  const selectedBasic = formData.v2_inv_basic || {};
  const selectedImmuno = formData.v2_inv_immuno || {};
  const selectedOrders = formData.v2_inv_orders || {};
  const orderSet = formData.v2_inv_orderset;
  const cystatinC = formData.v2_inv_conf_cysc;
  const patientAge = formData.v2_clinical_age;
  const biologicalSex = formData.v2_clinical_sex || formData.v2_gender;
  const patientId = formData.v2_patient_id || formData.patientId || "PT-12345";
  const [isGeneratingOrderset, setIsGeneratingOrderset] = useState(false);

  const handleGenerateOrderset = async () => {
    setIsGeneratingOrderset(true);
    try {
      const result = await generateDifferential(formData);
      const values = result?.data || {};
      if (values.v2_inv_orderset) {
        updateField("v2_inv_orderset", values.v2_inv_orderset);
      }
    } catch (err) {
      console.error("Failed to generate AI orderset:", err);
    } finally {
      setIsGeneratingOrderset(false);
    }
  };

  const handlePlannerDictation = ({ transcript }) => {
    const basic = selectMentionedLabs(transcript, BASIC_LAB_ALIASES);
    const immunological = selectMentionedLabs(transcript, IMMUNO_LAB_ALIASES);
    if (Object.keys(basic).length || Object.keys(immunological).length) {
      updateFields({
        v2_inv_basic: { ...(formData.v2_inv_basic || {}), ...basic },
        v2_inv_immuno: { ...(formData.v2_inv_immuno || {}), ...immunological },
      });
    }
  };

  useEffect(() => {
    const calculatedEgfr = calculateCystatinEgfr(cystatinC, patientAge, biologicalSex);
    if (calculatedEgfr === null) {
      if (formData.v2_inv_cysc_egfr || formData.v2_inv_cysc_stage || formData.v2_inv_cysc_interpretation) {
        updateFields({
          v2_inv_cysc_egfr: "",
          v2_inv_cysc_stage: "",
          v2_inv_cysc_interpretation: "",
        });
      }
      return;
    }
    const roundedEgfr = Math.round(calculatedEgfr);
    const stage = getEgfrStage(roundedEgfr);
    updateFields({
      v2_inv_cysc_egfr: String(roundedEgfr),
      v2_inv_cysc_stage: stage,
      v2_inv_cysc_interpretation: `Estimated GFR is ${roundedEgfr} mL/min/1.73m² (${stage}) using the CKD-EPI cystatin C equation. Interpret with clinical context and confirm chronicity when eGFR is below 60.`,
    });
  }, [cystatinC, patientAge, biologicalSex]);

  const handleToggle = (group, item) => {
    const current = formData[group] || {};
    const updated = { ...current, [item]: !current[item] };
    updateField(group, updated);
  };

  const toggleStyle = (isActive) => ({
    padding: "6px 12px",
    border: isActive ? "1px solid #000000" : "1px solid #cccccc",
    backgroundColor: isActive ? "#000000" : "#ffffff",
    color: isActive ? "#ffffff" : "#333333",
    fontSize: "11.5px",
    fontWeight: "500",
    cursor: "pointer",
    display: "inline-block",
    marginRight: "8px",
    marginBottom: "8px",
    borderRadius: "2px",
    transition: "all 0.15s ease",
  });

  const BASIC_LABS = ["Creatinine", "BUN", "eGFR", "Electrolytes", "CBC", "Calcium", "Phosphate", "Albumin", "Bicarbonate", "Urinalysis"];
  const IMMUNO_LABS = ["ANA", "ANCA", "Anti-GBM", "Complement", "Anti-dsDNA", "Hepatitis B", "Hepatitis C", "HIV", "Other Serologies"];

  const getOrdersList = (set) => {
    switch (set) {
      case "Diabetic Kidney Disease": return ["HbA1c", "Retinopathy screening referral", "Urine ACR", "Lipid panel"];
      case "Hypertensive Nephropathy": return ["BP control assessment", "Cardiovascular workup (ECG/Echo)", "Renal artery doppler", "Aldosterone/Renin ratio"];
      case "Glomerulonephritis": return ["ANA", "ANCA", "Anti-GBM", "Complement levels (C3/C4)", "SPEP/UPEP", "Hepatitis panel", "HIV"];
      case "Obstructive Uropathy": return ["Renal ultrasound", "Post-void residual (PVR)", "Urology referral"];
      case "Polycystic Kidney Disease": return ["Family history review", "Renal Ultrasound", "CT/MRI Abdomen", "Genetic counseling referral"];
      case "Drug-induced": return ["Detailed Medication review", "Temporal correlation assessment", "Discontinue suspected nephrotoxin", "Eosinophil count"];
      default: return [];
    }
  };
  const orderList = getOrdersList(orderSet);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "20px" }}>
      <VoiceDictationPanel section="Investigation Planner and Imaging" fields={PLANNER_DICTATION_FIELDS} onStructured={handlePlannerDictation} />
      <Section title="Confirmatory Testing Protocol" note="Confirm CKD diagnosis, determine etiology, and establish accurate staging.">
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "20px" }}>
          <FormField label="Repeat Creatinine/eGFR (within 90 days)" name="v2_inv_conf_cr" type="select" options={["", "Pending", "Confirmed Chronic", "Acute Component"]} />
          <FormField label="First morning urine UACR (x2-3)" name="v2_inv_conf_uacr" type="select" options={["", "Pending", "Confirmed Abnormal", "Normal"]} />
          <FormField label="Cystatin C (mg/L, if Cr unreliable)" name="v2_inv_conf_cysc" type="number" placeholder="e.g. 1.2" />
          <FormField label="Cystatin C-based eGFR" name="v2_inv_cysc_egfr" type="derived" derivedValue={formData.v2_inv_cysc_egfr ? `${formData.v2_inv_cysc_egfr} mL/min/1.73m²` : "Requires Cystatin C, age and sex"} />
          <FormField label="KDIGO G-stage" name="v2_inv_cysc_stage" type="derived" derivedValue={formData.v2_inv_cysc_stage || "Awaiting calculated eGFR"} />
          <FormField label="Clinical Interpretation" name="v2_inv_cysc_interpretation" type="derived" derivedValue={formData.v2_inv_cysc_interpretation || "Enter Cystatin C to generate interpretation"} />
        </div>
      </Section>

      <Section title="Kidney Investigation Planner" note="The system explains: Why this test is being considered and what clinical question it answers.">
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "20px" }}>
          <div>
            <h4 style={{ marginBottom: "8px", fontSize: "12px", color: "#666", textTransform: "uppercase" }}>Basic Investigation Layer</h4>
            <div>
              {BASIC_LABS.map(lab => <div key={lab} style={toggleStyle(selectedBasic[lab])} onClick={() => handleToggle("v2_inv_basic", lab)}>{selectedBasic[lab] ? "✓ " : "+ "}{lab}</div>)}
            </div>
          </div>
          <div>
            <h4 style={{ marginBottom: "8px", fontSize: "12px", color: "#666", textTransform: "uppercase" }}>Immunological Investigation</h4>
            <div>
              {IMMUNO_LABS.map(lab => <div key={lab} style={toggleStyle(selectedImmuno[lab])} onClick={() => handleToggle("v2_inv_immuno", lab)}>{selectedImmuno[lab] ? "✓ " : "+ "}{lab}</div>)}
            </div>
          </div>
        </div>
      </Section>

      <Section title="DICOM Imaging Studies">
        <DICOMViewer patientId={patientId} />
      </Section>

      <Section title="Etiology Workup Manager" note="Smart order sets appear automatically based on clinical data.">
        <div style={{ display: "grid", gridTemplateColumns: "1fr", gap: "20px" }}>
          <div style={{ display: "flex", alignItems: "flex-end" }}>
            <div style={{ flex: 1 }}>
              <FormField label="Suggested Workup Order Set" name="v2_inv_orderset" type="select" options={[
                "",
                "Diabetic Kidney Disease",
                "Hypertensive Nephropathy",
                "Glomerulonephritis",
                "Obstructive Uropathy",
                "Polycystic Kidney Disease",
                "Drug-induced"
              ]} />
            </div>
            <button 
              onClick={handleGenerateOrderset}
              disabled={isGeneratingOrderset}
              style={{ marginLeft: "10px", marginBottom: "4px", background: "#ffffff", color: "#000000", border: "1px solid #cccccc", padding: "6px 12px", fontSize: "11px", borderRadius: "3px", cursor: "pointer", height: "30px" }}
            >
              {isGeneratingOrderset ? "Generating..." : "Auto-Select via AI"}
            </button>
          </div>
          
          {orderSet && orderList.length > 0 && (
            <div style={{ padding: "16px", background: "#f9f9f9", border: "1px solid #e0e0e0", borderRadius: "4px" }}>
              <h4 style={{ margin: "0 0 12px 0", fontSize: "12px", color: "#333", textTransform: "uppercase" }}>{orderSet} - Required Protocol</h4>
              <div>
                {orderList.map(item => (
                  <div key={item} style={toggleStyle(selectedOrders[item])} onClick={() => handleToggle("v2_inv_orders", item)}>
                    {selectedOrders[item] ? "✓ " : "+ "}{item}
                  </div>
                ))}
              </div>
            </div>
          )}


          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "20px", marginTop: "10px" }}>
            <FormField label="Etiology Workup Status" name="v2_inv_workup_status" type="select" options={["", "Initiated", "Pending Labs", "Pending Biopsy", "Completed"]} />
            <FormField label="Renal Biopsy Indication" name="v2_inv_biopsy_status" type="select" options={["", "Not Indicated", "Considered", "Scheduled", "Completed"]} />
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr", gap: "20px" }}>
            <FormField label="Finalized Primary Etiology" name="v2_inv_final_etiology" type="text" placeholder="Enter definitive diagnosis once workup is complete..." />
            <FormField label="Diagnostic Confidence" name="v2_inv_confidence" type="select" options={["", "Suspected", "Probable (Clinical/Labs)", "Definitive (Biopsy Proven)"]} />
          </div>
        </div>
      </Section>
    </div>
  );
};

export default PlannerTab;
