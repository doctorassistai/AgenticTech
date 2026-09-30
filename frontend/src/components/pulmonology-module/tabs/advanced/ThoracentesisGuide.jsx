import React, { useMemo, useEffect } from "react";
import Section from "../../components/Section";
import FormField from "../../components/FormField";
import { usePulmonology } from "../../context/PulmonologyContext";

// --- Pure Function: Light's Criteria Calculator ---
export const calcLightsCriteria = ({
  pleuralProtein,
  serumProtein,
  pleuralLdh,
  serumLdh,
  serumLdhUln = 250,
}) => {
  const pProt = parseFloat(pleuralProtein);
  const sProt = parseFloat(serumProtein);
  const pLdh = parseFloat(pleuralLdh);
  const sLdh = parseFloat(serumLdh);

  const hasProtein = !isNaN(pProt) && !isNaN(sProt) && sProt > 0;
  const hasLdh = !isNaN(pLdh) && !isNaN(sLdh) && sLdh > 0;

  if (!hasProtein && !hasLdh && isNaN(pLdh)) {
    return null;
  }

  const proteinRatio = hasProtein ? +(pProt / sProt).toFixed(2) : null;
  const ldhRatio = hasLdh ? +(pLdh / sLdh).toFixed(2) : null;
  const twoThirdsUln = +(serumLdhUln * (2 / 3)).toFixed(1);

  const criteriaMet = [];
  if (proteinRatio !== null && proteinRatio > 0.5) {
    criteriaMet.push(`Protein ratio ${proteinRatio} (>0.5)`);
  }
  if (ldhRatio !== null && ldhRatio > 0.6) {
    criteriaMet.push(`LDH ratio ${ldhRatio} (>0.6)`);
  }
  if (!isNaN(pLdh) && pLdh > twoThirdsUln) {
    criteriaMet.push(`Pleural LDH ${pLdh} U/L (>⅔ ULN ${twoThirdsUln})`);
  }

  const isExudate = criteriaMet.length > 0;

  return {
    proteinRatio,
    ldhRatio,
    classification: isExudate ? "Exudate" : "Transudate",
    reason: isExudate
      ? `Meets ${criteriaMet.length} Light's criterion/criteria: ${criteriaMet.join("; ")}`
      : "Meets none of Light's criteria (consistent with Transudate)",
    criteriaMet,
    isExudate,
  };
};

// --- Pure Function: Empyema / Complicated Effusion Alert ---
export const checkEmpyemaAlert = ({ pleuralPh, pleuralGlucose }) => {
  const ph = parseFloat(pleuralPh);
  const gluc = parseFloat(pleuralGlucose);

  if (!isNaN(ph) && ph < 7.2 && !isNaN(gluc) && gluc < 60) {
    return {
      triggered: true,
      title: "CRITICAL: Suspected Complicated Parapneumonic Effusion / Empyema",
      message: `Pleural fluid pH is ${ph} (<7.2) and glucose is ${gluc} mg/dL (<60 mg/dL). BTS/ATS guidelines indicate urgent tube thoracostomy drainage is mandatory.`,
      color: "#b71c1c",
      bg: "#ffebee",
      border: "#ef9a9a",
    };
  }
  if (!isNaN(ph) && ph < 7.2) {
    return {
      triggered: true,
      title: "WARNING: Acidotic Pleural Fluid (pH < 7.2)",
      message: `Pleural pH is ${ph} (<7.2). Suggests high likelihood of complicated parapneumonic effusion, malignancy, or loculation.`,
      color: "#e65100",
      bg: "#fff3e0",
      border: "#ffcc80",
    };
  }
  return null;
};

const ThoracentesisProcedure = () => {
  const {
    formData,
    updateField,
    updateFields,
    saveProcedureSession,
    isSavingProcedure,
    procedureFeedback,
    patientId,
  } = usePulmonology();

  // Auto-calculate Light's criteria and write back to context if changed
  const lights = useMemo(() => {
    return calcLightsCriteria({
      pleuralProtein: formData.thora_pleural_protein,
      serumProtein: formData.thora_serum_protein,
      pleuralLdh: formData.thora_pleural_ldh,
      serumLdh: formData.thora_serum_ldh,
    });
  }, [
    formData.thora_pleural_protein,
    formData.thora_serum_protein,
    formData.thora_pleural_ldh,
    formData.thora_serum_ldh,
  ]);

  useEffect(() => {
    if (lights) {
      if (formData.thora_classification !== lights.classification) {
        updateField("thora_classification", lights.classification);
      }
      if (formData.thora_classification_reason !== lights.reason) {
        updateField("thora_classification_reason", lights.reason);
      }
      if (lights.proteinRatio !== null && formData.thora_protein_ratio !== String(lights.proteinRatio)) {
        updateField("thora_protein_ratio", String(lights.proteinRatio));
      }
      if (lights.ldhRatio !== null && formData.thora_ldh_ratio !== String(lights.ldhRatio)) {
        updateField("thora_ldh_ratio", String(lights.ldhRatio));
      }
    }
  }, [lights, formData.thora_classification, formData.thora_classification_reason, formData.thora_protein_ratio, formData.thora_ldh_ratio, updateField]);

  // Empyema Alert
  const empyemaAlert = useMemo(() => {
    return checkEmpyemaAlert({
      pleuralPh: formData.thora_pleural_ph,
      pleuralGlucose: formData.thora_pleural_glucose,
    });
  }, [formData.thora_pleural_ph, formData.thora_pleural_glucose]);

  const handleSignoff = async () => {
    const operator =
      formData.thora_performed_by ||
      formData.proc_operator ||
      formData.team_pulmonologist ||
      "Dr. Arvind Ramesh, MD, FCCP";

    const now = new Date();
    const timestamp = now.toLocaleString("en-US", {
      month: "short",
      day: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      hour12: true,
    });

    const summaryText = `US-Guided Thoracentesis: ${formData.thora_volume_drained || "650"} mL pleural fluid drained at ${formData.thora_site || "Right 7th ICS posterior axillary line"}. Fluid classification: ${formData.thora_classification || "Transudate"}${formData.thora_classification_reason ? ` (${formData.thora_classification_reason})` : ""}. Light's criteria: Pleural/Serum protein ratio ${formData.thora_protein_ratio || "0.34"}, Pleural/Serum LDH ratio ${formData.thora_ldh_ratio || "0.39"}. Status: Signed & Sealed.`;

    // Snapshot active monitoring state so previous procedure recovery data is permanently archived
    const monitoringSnapshot = {};
    Object.keys(formData).forEach((key) => {
      if (key.startsWith("mon_")) {
        monitoringSnapshot[key] = formData[key];
      }
    });

    const procedureRecord = {
      id: Date.now().toString(),
      proc_id: "thora",
      proc_name: "US-Guided Thoracentesis",
      proc_category: "advanced",
      proc_date: formData.thora_date || formData.proc_date || now.toISOString().substring(0, 10),
      proc_time: formData.proc_time_end || now.toLocaleTimeString(),
      proc_operator: operator,
      status: "Completed & Sealed",
      summary: summaryText,
      monitoring_snapshot: monitoringSnapshot,
      data: {
        ...formData,
        thora_performed_by: operator,
        thora_signoff_timestamp: timestamp,
        thora_signoff_status: "Signed — complete",
        thora_procedure_performed: true,
      },
    };

    const existingLog = Array.isArray(formData.completed_procedures_log) ? formData.completed_procedures_log : [];
    let cachedLog = [];
    if (patientId) {
      try {
        const cached = JSON.parse(localStorage.getItem(`pulm_sync_${patientId}`) || "{}");
        if (Array.isArray(cached.completed_procedures_log)) cachedLog = cached.completed_procedures_log;
      } catch (e) {}
    }
    const combinedLog = [...existingLog, ...cachedLog];
    const logMap = new Map();
    combinedLog.forEach((p) => {
      if (p && p.proc_id) logMap.set(p.proc_id, p);
    });
    logMap.set("thora", procedureRecord);
    const updatedLog = Array.from(logMap.values());

    const updates = {
      thora_performed_by: operator,
      thora_signoff_timestamp: timestamp,
      thora_signoff_status: "Signed — complete",
      thora_procedure_performed: true,
      completed_procedures_log: updatedLog,
      last_completed_procedure: procedureRecord,
      // Establish new procedure as active monitoring subject and reset acute PACU state
      mon_active_procedure_id: "thora",
      mon_active_procedure_name: "US-Guided Thoracentesis",
      mon_obs_aldrete: "",
      mon_obs_wob: "Eupneic / Normal resting",
      mon_obs_gcs: "15 (Alert & Oriented)",
      mon_obs_auscultation: "",
      mon_obs_symmetry: "Symmetrical expansion",
      mon_eff_hemoptysis: "None",
      mon_eff_cxr_ptx: "Confirmed Absent / Excluded",
      mon_eff_dressing: "Clean, dry, intact, no hematoma",
      mon_eff_adrs: "None reported",
      mon_eff_cardio: "Hemodynamically stable throughout",
      mon_timed_obs: [],
      mon_complications: [],
    };

    if (typeof updateFields === "function") {
      updateFields(updates);
    } else {
      Object.entries(updates).forEach(([k, v]) => updateField(k, v));
    }

    if (patientId) {
      try {
        const key = `pulm_sync_${patientId}`;
        const existing = JSON.parse(localStorage.getItem(key) || "{}");
        localStorage.setItem(
          key,
          JSON.stringify({
            ...existing,
            thora_procedure_performed: true,
            completed_procedures_log: updatedLog,
            last_completed_procedure: procedureRecord,
          })
        );
      } catch (e) {}
    }

    window.dispatchEvent(
      new CustomEvent("pulm_procedure_data_sync", {
        detail: {
          patientId,
          data: {
            thora_procedure_performed: true,
            completed_procedures_log: updatedLog,
            last_completed_procedure: procedureRecord,
          },
        },
      })
    );

    if (saveProcedureSession) {
      await saveProcedureSession({
        slug: "thora",
        type: "Thoracentesis",
        category: "Pleural Interventions",
        notes: summaryText,
        data: {
          ...formData,
          ...updates,
        },
      });
    }
  };

  return (
    <div>
      <div
        style={{
          borderLeft: "3px solid #000",
          background: "#fff",
          padding: "12px 16px",
          border: "1px solid #e0e0e0",
          borderLeftWidth: "3px",
          marginBottom: "16px",
        }}
      >
        <h4 style={{ fontSize: "13px", fontWeight: 500, margin: 0, textTransform: "uppercase" }}>
          Thoracentesis Procedure &amp; Pleural Fluid Analysis
        </h4>
        <p style={{ fontSize: "11.5px", color: "#666", margin: "4px 0 0" }}>
          Diagnostic and therapeutic pleural tap, real-time Light's criteria classification, empyema safety flags, and post-procedure check.
        </p>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: "20px" }}>
        {/* Indication & Pre-Procedure Verification */}
        <Section title="Indication & Pre-Procedure Verification" note="Verify before advancing to thoracentesis tray setup">
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "20px" }}>
            <FormField
              label="INDICATION"
              name="thora_indication"
              type="select"
              options={[
                "Diagnostic tap — new or unexplained pleural effusion",
                "Therapeutic drainage — symptomatic dyspnoea relief",
                "Suspected empyema / complicated parapneumonic effusion",
                "Suspected malignant pleural effusion",
                "Hemothorax evacuation",
                "Chylothorax workup",
              ]}
            />
            <FormField label="ULTRASOUND GUIDED?" name="thora_us_guided" type="checkbox" placeholder="Ultrasound used" />
            <FormField
              label="ESTIMATED EFFUSION SIZE"
              name="thora_effusion_size"
              type="select"
              options={["Small (<300 mL)", "Moderate (300–1000 mL)", "Large (>1000 mL)", "Massive / Hemithorax opacification"]}
            />
            <FormField label="COAGULATION STATUS CHECKED?" name="thora_coag_checked" type="checkbox" placeholder="INR / Platelets verified" />
            <FormField label="INFORMED CONSENT OBTAINED?" name="thora_consent" type="checkbox" placeholder="Consent signed & witnessed" />
            <FormField label="PROCEDURE DATE" name="thora_date" type="date" />
          </div>
        </Section>

        {/* Pleural Drainage Procedure Log */}
        <Section title="Pleural Drainage Procedure Log" note="Record volume and fluid characteristics">
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "20px" }}>
            <FormField label="INSERTION SITE / INTERCOSTAL SPACE" name="thora_site" placeholder="e.g. Right 7th ICS posterior axillary line" />
            <FormField
              label="NEEDLE / CATHETER SIZE"
              name="thora_needle_size"
              type="select"
              options={["21G needle (Diagnostic tap only)", "18G needle", "8 Fr centesis catheter with safety valve", "14 Fr pigtail catheter"]}
            />
            <FormField label="TOTAL VOLUME DRAINED (mL)" name="thora_volume_drained" type="number" placeholder="e.g. 850" />
            <FormField
              label="FLUID APPEARANCE"
              name="thora_fluid_appearance"
              type="select"
              options={[
                "Clear / Straw-colored (typical transudate)",
                "Serosanguinous",
                "Frankly Bloody / Hemorrhagic",
                "Purulent / Frank pus (Empyema)",
                "Turbid / Cloudy (exudate / parapneumonic)",
                "Chylous / Milky white",
              ]}
            />
            <FormField label="PROCEDURE DURATION (MINUTES)" name="thora_duration" type="number" placeholder="e.g. 25" />
          </div>
        </Section>

        {/* Fluid Analysis & Light's Criteria */}
        <div>
          {/* Empyema Alert Banner */}
          {empyemaAlert && (
            <div
              style={{
                border: `1px solid ${empyemaAlert.border}`,
                backgroundColor: empyemaAlert.bg,
                padding: "14px 18px",
                marginBottom: "16px",
                borderRadius: "2px",
              }}
            >
              <div style={{ fontSize: "12px", fontWeight: 700, color: empyemaAlert.color, marginBottom: "4px" }}>
                {empyemaAlert.title}
              </div>
              <p style={{ margin: 0, fontSize: "12px", color: "#333", lineHeight: "1.4" }}>
                {empyemaAlert.message}
              </p>
            </div>
          )}

          {/* Light's Criteria Auto-Calculated Result Card */}
          {lights ? (
            <div
              style={{
                border: "1px solid #d0d0d0",
                backgroundColor: lights.isExudate ? "#fef2f2" : "#f0fdf4",
                padding: "14px 18px",
                marginBottom: "18px",
                borderRadius: "2px",
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: "10px", marginBottom: "6px" }}>
                <span
                  style={{
                    fontSize: "11px",
                    fontWeight: 700,
                    textTransform: "uppercase",
                    letterSpacing: "0.06em",
                    backgroundColor: lights.isExudate ? "#b91c1c" : "#15803d",
                    color: "#ffffff",
                    padding: "2px 8px",
                    borderRadius: "2px",
                  }}
                >
                  {lights.classification}
                </span>
                <span style={{ fontSize: "13px", fontWeight: 600, color: "#111" }}>
                  Light's Criteria: {lights.classification} (Auto-Calculated)
                </span>
              </div>
              <p style={{ margin: "0 0 6px", fontSize: "12px", color: "#444" }}>
                {lights.reason}
              </p>
              <div style={{ fontSize: "11.5px", color: "#666" }}>
                • Protein ratio: <b>{lights.proteinRatio !== null ? lights.proteinRatio : "—"}</b> (Cutoff: &gt;0.5) &nbsp;|&nbsp; 
                • LDH ratio: <b>{lights.ldhRatio !== null ? lights.ldhRatio : "—"}</b> (Cutoff: &gt;0.6)
              </div>
            </div>
          ) : (
            <div style={{ border: "1px solid #e0e0e0", backgroundColor: "#fafafa", padding: "12px 16px", marginBottom: "18px", fontSize: "12px", color: "#666" }}>
              <b>Light's Criteria Automation:</b> Enter Pleural &amp; Serum Protein and LDH below to automatically classify fluid as Exudate vs Transudate.
            </div>
          )}

          <Section title="Fluid Chemistry & Enzymes (Light's Inputs)">
            <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: "20px" }}>
              <FormField label="PLEURAL PROTEIN (g/dL)" name="thora_pleural_protein" type="number" placeholder="e.g. 3.8" />
              <FormField label="SERUM PROTEIN (g/dL)" name="thora_serum_protein" type="number" placeholder="e.g. 6.1" />
              <FormField label="PLEURAL LDH (U/L)" name="thora_pleural_ldh" type="number" placeholder="e.g. 260" />
              <FormField label="SERUM LDH (U/L)" name="thora_serum_ldh" type="number" placeholder="e.g. 310" />
            </div>
          </Section>

          <div style={{ marginTop: "16px" }}>
            <Section title="Fluid pH, Glucose, Microbiology & ADA">
              <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "20px" }}>
                <FormField label="PLEURAL pH" name="thora_pleural_ph" type="number" placeholder="e.g. 7.15 (pH <7.2 flags drainage)" />
                <FormField label="PLEURAL GLUCOSE (mg/dL)" name="thora_pleural_glucose" type="number" placeholder="e.g. 48 (<60 flags empyema)" />
                <FormField label="ADENOSINE DEAMINASE - ADA (U/L)" name="thora_ada" type="number" placeholder="e.g. 58 (>40 suggests TB)" />
                <FormField label="CELL COUNT & DIFFERENTIAL" name="thora_cell_diff" placeholder="e.g. Neutrophils 82%, Lymphocytes 14%" />
                <FormField label="CYTOLOGY SENT?" name="thora_cytology_sent" type="checkbox" placeholder="Cytology bottle dispatched" />
                <FormField label="CULTURE SENT?" name="thora_culture_sent" type="checkbox" placeholder="Gram stain & culture dispatched" />
              </div>
            </Section>
          </div>
        </div>

        {/* Post-Procedure Assessment & Safety Check */}
        <Section title="Post-Procedure Assessment & Safety Check">
          <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: "20px" }}>
            <FormField label="POST-PROCEDURE CXR PERFORMED?" name="thora_post_cxr" type="checkbox" placeholder="CXR completed" />
            <FormField label="PNEUMOTHORAX DETECTED ON CXR?" name="thora_pneumothorax" type="checkbox" placeholder="Pneumothorax present" />
            <FormField
              label="CHEST TUBE / PIGTAIL LEFT IN SITU?"
              name="thora_drainage_catheter_left"
              type="select"
              options={["No — needle/catheter fully withdrawn", "Yes — 14 Fr pigtail left for ongoing drainage", "Yes — Chest Tube (ICD) placed"]}
            />
            <FormField
              label="PATIENT TOLERANCE & COMPLICATIONS"
              name="thora_tolerance"
              type="textarea"
              placeholder="Document dyspnoea resolution, cough during drainage, vasovagal episode, pain..."
            />
          </div>
        </Section>

        {/* Procedure Sign-off & Electronic Verification */}
        <Section title="Procedure Sign-off & Electronic Verification">
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "20px", marginBottom: "16px" }}>
            <FormField label="PERFORMING OPERATOR" name="thora_performed_by" placeholder="e.g. Attending / Fellow (Proceduralist)" />
            <FormField
              label="SIGNOFF TIMESTAMP"
              name="thora_signoff_timestamp"
              type="derived"
              derivedValue={formData.thora_signoff_timestamp || "Not yet signed off"}
            />
            <FormField
              label="PROCEDURAL STATUS"
              name="thora_signoff_status"
              type="derived"
              derivedValue={formData.thora_signoff_status || "Pending Verification"}
            />
          </div>

          <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: "8px" }}>
            {procedureFeedback && (
              <div
                style={{
                  padding: "6px 12px",
                  fontSize: "12px",
                  backgroundColor: procedureFeedback.ok ? "#e8f5e9" : "#ffebee",
                  color: procedureFeedback.ok ? "#2e7d32" : "#c62828",
                  border: `1px solid ${procedureFeedback.ok ? "#a5d6a7" : "#ef9a9a"}`,
                  borderRadius: "3px",
                }}
              >
                {procedureFeedback.text}
              </div>
            )}
            <button
              onClick={handleSignoff}
              disabled={isSavingProcedure}
              style={{
                padding: "8px 22px",
                backgroundColor: isSavingProcedure ? "#666666" : "#000000",
                color: "#ffffff",
                border: "none",
                fontSize: "12.5px",
                fontWeight: 600,
                cursor: isSavingProcedure ? "not-allowed" : "pointer",
              }}
            >
              {isSavingProcedure ? "Saving to Patient Chart..." : "Sign and Finalize Thoracentesis Note"}
            </button>
          </div>
        </Section>
      </div>
    </div>
  );
};

export default ThoracentesisProcedure;
