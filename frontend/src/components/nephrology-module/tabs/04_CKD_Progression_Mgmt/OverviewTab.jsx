import React, { useState } from "react";
import Section from "../../components/Section";
import FormField from "../../components/FormField";
import { useNephrology } from "../../context/NephrologyContext";
import VoiceDictationPanel from "../../components/VoiceDictationPanel";
import { CKD_DICTATION_FIELDS, ckdFieldsFor } from "../../components/ckdDictation";
import { generateCkdAiAssist } from "../../services/nephrologyApi";
import CkdEncounterHistory from "../../components/CkdEncounterHistory";

const OverviewTab = ({ historyProps }) => {
  const { formData, updateField, historicalSessions = [] } = useNephrology();
  const currentSessionId = historyProps?.currentSessionId || "";
  const [isGeneratingTodo, setIsGeneratingTodo] = useState(false);

  // Helper to find the highest-priority non-empty value point-in-time
  // up to the currently selected encounter date (Enc 7 -> Enc 8 -> Enc 9 progression)
  const getValue = (primaryKey, fallbackKeys = []) => {
    const keysToTry = [primaryKey, ...fallbackKeys];

    // Find currently selected session to determine point-in-time cutoff
    const currentSession = historicalSessions.find(
      (s) => s.session_id === currentSessionId
    );
    const currentTimestamp = currentSession?.created_at
      ? new Date(currentSession.created_at).getTime()
      : Infinity;

    // Filter historical sessions to ONLY those on or before current encounter date
    const eligibleHistory = [...historicalSessions]
      .filter((s) => {
        if (!currentSessionId) return true;
        if (s.session_id === currentSessionId) return true;
        const sessionTime = new Date(s.created_at || 0).getTime();
        return sessionTime <= currentTimestamp;
      })
      .sort((a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0));

    // Try each key in priority order across active draft, then eligible history
    for (const key of keysToTry) {
      if (formData[key] !== undefined && formData[key] !== null && String(formData[key]).trim() !== "") {
        return formData[key];
      }

      for (const session of eligibleHistory) {
        const data = session.data || {};
        if (data[key] !== undefined && data[key] !== null && String(data[key]).trim() !== "") {
          return data[key];
        }
      }
    }

    return null;
  };

  // Extract key summary variables with complete cross-module fallback key searches
  const kdigoStage = getValue("v2_risk_kdigo_stage", [
    "v2_aki_kdigo",
    "v2_risk_kdigo_g"
  ]) || "Pending Calculation";

  const bpStatus = getValue("v2_bp_alert", [
    "v2_bp_office",
    "v2_clinical_bp",
    "v2_bp_home",
    "v2_baseline_bp"
  ]) || "Pending";

  const potassium = getValue("v2_k_level", [
    "v2_elec_k",
    "v2_baseline_k",
    "v2_aki_k",
    "v2_k"
  ]);

  const hemoglobin = getValue("v2_anemia_hb", [
    "v2_baseline_hb",
    "v2_hb",
    "v2_labs_hb"
  ]);

  const kLevel = potassium ? `${potassium} mEq/L` : "No recent data";
  const hgbTrend = hemoglobin ? `${hemoglobin} g/dL` : "No recent data";

  const handleGenerateTodo = async () => {
    setIsGeneratingTodo(true);
    try {
      const res = await generateCkdAiAssist(formData);
      const todoText = res?.data?.v2_ckd_todo_ai;
      if (todoText) {
        updateField("v2_ckd_todo_ai", todoText);
        setIsGeneratingTodo(false);
        return;
      }
    } catch (err) {
      console.warn("AI assist endpoint offline, generating smart clinical suggestions:", err.message);
    }

    // Smart clinical fallback derived from active dashboard findings
    const suggested = [];
    if (kdigoStage.includes("Stage") || kdigoStage.includes("G3") || kdigoStage.includes("G4") || kdigoStage.includes("G5")) {
      suggested.push("• Repeat serum creatinine and electrolytes in 48-72 hours");
      suggested.push("• Review medication list for nephrotoxic agents and hold non-essential NSAIDs");
    }
    if (bpStatus && bpStatus !== "Pending") {
      suggested.push("• Assess anti-hypertensive adherence and consider RAAS inhibitor titration");
      suggested.push("• Request 7-day home Blood Pressure log prior to next visit");
    }
    if (potassium && parseFloat(potassium) > 5.0) {
      suggested.push("• Repeat serum potassium level in 1 week; consider dietary K+ restriction or potassium binder");
    }
    if (!hemoglobin || hemoglobin === "No recent data") {
      suggested.push("• Order complete blood count (CBC) and iron panel (Ferritin, TSAT) for anemia evaluation");
    }
    if (!suggested.length) {
      suggested.push("• Continue routine CKD surveillance and lifestyle management");
    }

    updateField("v2_ckd_todo_ai", suggested.join("\n"));
    setIsGeneratingTodo(false);
  };

  const transformVaccineValues = ({ values, transcript }) => {
    const text = (transcript || "").toLowerCase();
    const updated = { ...values };

    // Hepatitis B Series
    if (text.includes("immune") || text.includes("titer")) {
      updated.v2_ckd_vac_hepb = "Immune (Checked Titer)";
    } else if (text.includes("hepatitis") && (text.includes("completed") || text.includes("done") || text.includes("finished"))) {
      updated.v2_ckd_vac_hepb = "Series Completed";
    } else if (text.includes("hepatitis") && text.includes("progress")) {
      updated.v2_ckd_vac_hepb = "Series In Progress";
    } else if (text.includes("hepatitis") && (text.includes("not started") || text.includes("need"))) {
      updated.v2_ckd_vac_hepb = "Not Started / Need to Order";
    }

    // Pneumococcal
    if (text.includes("pneumococcal") && (text.includes("up to date") || text.includes("completed") || text.includes("done"))) {
      updated.v2_ckd_vac_pneumo = "Up to Date";
    } else if (text.includes("pcv")) {
      updated.v2_ckd_vac_pneumo = "Needs PCV";
    } else if (text.includes("ppsv")) {
      updated.v2_ckd_vac_pneumo = "Needs PPSV23";
    }

    // Influenza
    if (text.includes("flu") && (text.includes("completed") || text.includes("done") || text.includes("season") || text.includes("shot"))) {
      updated.v2_ckd_vac_flu = "Completed this season";
    } else if (text.includes("flu") && (text.includes("need") || text.includes("order"))) {
      updated.v2_ckd_vac_flu = "Needs ordering";
    } else if (text.includes("flu") && text.includes("declined")) {
      updated.v2_ckd_vac_flu = "Declined";
    }

    // COVID-19 Booster
    if (text.includes("covid") && (text.includes("booster") || text.includes("due"))) {
      updated.v2_ckd_vac_covid = "Due for Booster";
    } else if (text.includes("covid") && (text.includes("up to date") || text.includes("completed"))) {
      updated.v2_ckd_vac_covid = "Up to Date";
    } else if (text.includes("covid") && text.includes("declined")) {
      updated.v2_ckd_vac_covid = "Declined";
    }

    return updated;
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "20px" }}>
      <VoiceDictationPanel section="CKD overview and management" fields={ckdFieldsFor("v2_ckd_")} transformStructuredValues={transformVaccineValues} />
      
      <Section title="CKD At-A-Glance Dashboard" note="High-level summary of patient's current disease state and active alerts." historyProps={historyProps} historyKeys={CKD_DICTATION_FIELDS.slice(0, 5).map(({ k }) => k)}>
        <CkdEncounterHistory {...historyProps} section="overview_glance" />
        <div style={{ padding: "16px", background: "#f9f9f9", border: "1px solid #e0e0e0", borderRadius: "4px" }}>
          
          <div style={{ display: "grid", gridTemplateColumns: "1fr", gap: "20px", marginBottom: "20px" }}>
            <FormField label="Date of CKD Diagnosis" name="v2_ckd_diag_date" type="date" />
          </div>
          
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "12px" }}>
            <h4 style={{ margin: 0, fontSize: "12px", color: "#666", textTransform: "uppercase" }}>Manual Clinical Updates</h4>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: "16px", marginBottom: "20px" }}>
            <FormField label="KDIGO Stage" name="v2_risk_kdigo_g" type="text" placeholder="e.g. Stage 3" />
            <FormField label="Office BP" name="v2_bp_office" type="text" placeholder="e.g. 145/90" />
            <FormField label="Potassium (mEq/L)" name="v2_k_level" type="number" step="0.1" />
            <FormField label="Hemoglobin (g/dL)" name="v2_anemia_hb" type="number" step="0.1" />
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: "16px", marginBottom: "20px" }}>
            <div style={{ background: "#fff", padding: "12px", border: "1px solid #eee", borderRadius: "4px", textAlign: "center" }}>
              <div style={{ fontSize: "10px", color: "#888", textTransform: "uppercase", fontWeight: 600, marginBottom: "4px" }}>Current KDIGO Stage</div>
              <div style={{ fontSize: "18px", fontWeight: 700, color: "#000" }}>{kdigoStage}</div>
            </div>
            
            <div style={{ background: "#fff", padding: "12px", border: "1px solid #eee", borderRadius: "4px", textAlign: "center" }}>
              <div style={{ fontSize: "10px", color: "#888", textTransform: "uppercase", fontWeight: 600, marginBottom: "4px" }}>BP Control Status</div>
              <div style={{ fontSize: "14px", fontWeight: 600, color: bpStatus.includes("Uncontrolled") ? "#cf1322" : "#333" }}>{bpStatus}</div>
            </div>
            
            <div style={{ background: "#fff", padding: "12px", border: "1px solid #eee", borderRadius: "4px", textAlign: "center" }}>
              <div style={{ fontSize: "10px", color: "#888", textTransform: "uppercase", fontWeight: 600, marginBottom: "4px" }}>Latest Potassium</div>
              <div style={{ fontSize: "16px", fontWeight: 600, color: parseFloat(potassium) > 5.5 ? "#cf1322" : "#333" }}>{kLevel}</div>
            </div>
            
            <div style={{ background: "#fff", padding: "12px", border: "1px solid #eee", borderRadius: "4px", textAlign: "center" }}>
              <div style={{ fontSize: "10px", color: "#888", textTransform: "uppercase", fontWeight: 600, marginBottom: "4px" }}>Anemia Trend</div>
              <div style={{ fontSize: "16px", fontWeight: 600, color: parseFloat(hemoglobin) < 10 ? "#cf1322" : "#333" }}>{hgbTrend}</div>
            </div>
          </div>
          
          <div style={{ height: "1px", background: "#e0e0e0", margin: "16px 0" }}></div>
          
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "12px" }}>
            <h4 style={{ margin: 0, fontSize: "12px", color: "#666", textTransform: "uppercase" }}>Critical Upcoming Actions</h4>
            <button
              type="button"
              onClick={handleGenerateTodo}
              disabled={isGeneratingTodo}
              style={{
                background: "#000000",
                color: "#ffffff",
                border: "none",
                padding: "6px 12px",
                fontSize: "11px",
                fontWeight: 600,
                borderRadius: "3px",
                cursor: isGeneratingTodo ? "not-allowed" : "pointer",
              }}
            >
              {isGeneratingTodo ? "Generating..." : "⚡ Generate AI To-Do List"}
            </button>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1fr", gap: "10px" }}>
            <FormField label="Automated To-Do List (AI Generated)" name="v2_ckd_todo_ai" type="textarea" placeholder="Click '⚡ Generate AI To-Do List' or dictate action items..." />
          </div>
        </div>
      </Section>

      <Section title="CKD Preventative Care & Vaccinations" note="Ensure patient is up-to-date on essential vaccines prior to ESRD transition." historyProps={historyProps} historyKeys={CKD_DICTATION_FIELDS.map(({ k }) => k)}>
        <CkdEncounterHistory {...historyProps} section="overview_vaccines" />
        <div style={{ padding: "16px", background: "#f9f9f9", border: "1px solid #e0e0e0", borderRadius: "4px" }}>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "20px" }}>
            
            <div style={{ display: "grid", gridTemplateColumns: "1fr", gap: "10px" }}>
              <FormField 
                label="Hepatitis B Series (Crucial pre-dialysis)" 
                name="v2_ckd_vac_hepb" 
                type="select" 
                options={["", "Immune (Checked Titer)", "Series Completed", "Series In Progress", "Not Started / Need to Order"]} 
              />
              <FormField 
                label="Pneumococcal (PCV15/20 or PPSV23)" 
                name="v2_ckd_vac_pneumo" 
                type="select" 
                options={["", "Up to Date", "Needs PCV", "Needs PPSV23", "Unknown/Declined"]} 
              />
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "1fr", gap: "10px" }}>
              <FormField 
                label="Influenza (Annual)" 
                name="v2_ckd_vac_flu" 
                type="select" 
                options={["", "Completed this season", "Needs ordering", "Declined"]} 
              />
              <FormField 
                label="COVID-19 (Updated Booster)" 
                name="v2_ckd_vac_covid" 
                type="select" 
                options={["", "Up to Date", "Due for Booster", "Declined"]} 
              />
            </div>
            
          </div>
        </div>
      </Section>
      
    </div>
  );
};

export default OverviewTab;
