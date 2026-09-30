import React, { useState, useEffect } from "react";
import Section from "../../components/Section";
import FormField from "../../components/FormField";
import { usePulmonology } from "../../context/PulmonologyContext";
import VoiceDictationPanel from "../../components/VoiceDictationPanel";

const inputStyle = { width: "100%", padding: "6px 8px", fontSize: "12px", border: "1px solid #ccc", boxSizing: "border-box", marginTop: "4px" };
const labelStyle = { fontSize: "10px", fontWeight: 600, textTransform: "uppercase", color: "#888" };

// --- Sub-Tab: Action Plan ---
const ActionPlanTab = ({ formData, updateField }) => (
  <div>
    <Section title="AECOPD Self-Management Action Plan" note="Issued to patient — review at every visit">
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: "20px", marginBottom: "20px" }}>
        <FormField
          label="ACTION PLAN ISSUED TO PATIENT"
          name="plan_aecopd_issued"
          type="select"
          options={["Yes — written copy given", "Verbal only", "Not issued — pending", "Declined"]}
        />
        <FormField
          label="NEXT VISIT INTERVAL"
          name="plan_visit_interval"
          type="select"
          options={["4 weeks", "8 weeks", "12 weeks", "6 months", "As needed"]}
        />
        <FormField
          label="OXYGEN / NIV REASSESSMENT"
          name="plan_o2_reassess"
          type="select"
          options={["Not applicable", "Not yet", "ABG + overnight oximetry in 8 weeks", "Arranged"]}
        />
        <FormField
          label="TRANSPLANT STATUS"
          name="plan_tx_status"
          type="select"
          options={["Not eligible at this stage", "Not discussed", "Workup in progress", "Listed"]}
        />
      </div>

      {/* AECOPD Zones */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "20px", marginBottom: "20px" }}>
        <div style={{ border: "2px solid #2e7d32", padding: "12px", background: "#f0fdf4" }}>
          <div style={{ fontSize: "11px", fontWeight: 700, color: "#2e7d32", textTransform: "uppercase", marginBottom: "8px" }}>Zone 1 — Green (Doing Well)</div>
          <div>
            <label style={labelStyle}>Target SpO2</label>
            <input type="text" value={formData.plan_zone_green_spo2 || "≥90%"} onChange={e => updateField("plan_zone_green_spo2", e.target.value)} placeholder="e.g. ≥90%" style={inputStyle} />
          </div>
          <div style={{ marginTop: "8px" }}>
            <label style={labelStyle}>Action</label>
            <textarea rows={3} value={formData.plan_zone_green_action || ""} onChange={e => updateField("plan_zone_green_action", e.target.value)} placeholder="e.g. Continue Trelegy Ellipta once daily, exercise regularly, rinse mouth after inhaler" style={{ ...inputStyle, resize: "vertical" }} />
          </div>
        </div>

        <div style={{ border: "2px solid #e65100", padding: "12px", background: "#fff7ed" }}>
          <div style={{ fontSize: "11px", fontWeight: 700, color: "#e65100", textTransform: "uppercase", marginBottom: "8px" }}>Zone 2 — Yellow (Caution / Flare)</div>
          <div>
            <label style={labelStyle}>Trigger Signs</label>
            <textarea rows={2} value={formData.plan_zone_yellow_trigger || ""} onChange={e => updateField("plan_zone_yellow_trigger", e.target.value)} placeholder="e.g. Increased breathlessness, cough worsening, sputum change" style={{ ...inputStyle, resize: "vertical" }} />
          </div>
          <div style={{ marginTop: "8px" }}>
            <label style={labelStyle}>Action</label>
            <textarea rows={3} value={formData.plan_zone_yellow_action || ""} onChange={e => updateField("plan_zone_yellow_action", e.target.value)} placeholder="e.g. Increase Albuterol to 2 puffs q4h, contact clinic, start rescue pack" style={{ ...inputStyle, resize: "vertical" }} />
          </div>
        </div>

        <div style={{ border: "2px solid #d32f2f", padding: "12px", background: "#fef2f2" }}>
          <div style={{ fontSize: "11px", fontWeight: 700, color: "#d32f2f", textTransform: "uppercase", marginBottom: "8px" }}>Zone 3 — Red (Emergency)</div>
          <div>
            <label style={labelStyle}>Danger Signs</label>
            <textarea rows={2} value={formData.plan_zone_red_trigger || ""} onChange={e => updateField("plan_zone_red_trigger", e.target.value)} placeholder="e.g. SpO2 <88% at rest, cyanosis, severe chest tightness, confusion" style={{ ...inputStyle, resize: "vertical" }} />
          </div>
          <div style={{ marginTop: "8px" }}>
            <label style={labelStyle}>Action</label>
            <textarea rows={3} value={formData.plan_zone_red_action || ""} onChange={e => updateField("plan_zone_red_action", e.target.value)} placeholder="e.g. Call 112 / 911 or proceed to Emergency Department immediately" style={{ ...inputStyle, resize: "vertical" }} />
          </div>
        </div>
      </div>
    </Section>
  </div>
);

// --- Sub-Tab: Referrals & Preventative Care ---
const ReferralsTab = ({ formData, updateField }) => {
  const referrals = [
    { id: "ref_rehab", label: "Pulmonary Rehabilitation", options: ["Referred — enrolled", "Referred — awaiting", "Not referred", "Declined", "Completed programme"] },
    { id: "ref_smoking", label: "Smoking Cessation Service", options: ["Ex-smoker — cessation confirmed", "Never smoked", "Active smoker — referred", "Declined referral"] },
    { id: "ref_physio", label: "Respiratory Physiotherapy", options: ["Not required", "Referred — active", "Completed", "Awaiting"] },
    { id: "ref_dietitian", label: "Dietitian (Nutrition / Weight)", options: ["Not required", "Referred", "Completed"] },
    { id: "ref_psychology", label: "Psychology / Mental Health Support", options: ["Screened — normal", "Referred — anxiety/depression screen positive", "Not assessed yet"] },
    { id: "ref_palliative", label: "Palliative Care / End-of-Life Planning", options: ["Not yet discussed", "Discussed — advance directive in place", "Referred to palliative team"] },
  ];

  const vaccines = [
    { id: "vac_flu", label: "Influenza (Annual)", options: ["Completed this season", "Needs ordering", "Declined"] },
    { id: "vac_pneumo", label: "Pneumococcal (PCV15/PPSV23)", options: ["Up to date", "Needs PCV", "Needs PPSV23", "Unknown / Declined"] },
    { id: "vac_covid", label: "COVID-19 (Updated Booster)", options: ["Up to date", "Due for booster", "Declined"] },
    { id: "vac_rsv", label: "RSV Vaccine (≥60 years)", options: ["Given", "Offered — declined", "Not yet offered"] },
  ];

  return (
    <div>
      <Section title="Referrals & Allied Health" note="Comprehensive multidisciplinary optimization for frequent exacerbators">
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "20px" }}>
          {referrals.map(r => (
            <div key={r.id}>
              <label style={labelStyle}>{r.label.toUpperCase()}</label>
              <select value={formData[r.id] || ""} onChange={e => updateField(r.id, e.target.value)} style={{ ...inputStyle, marginTop: "6px" }}>
                <option value="">— Select —</option>
                {r.options.map(o => <option key={o}>{o}</option>)}
              </select>
            </div>
          ))}
        </div>
      </Section>

      <Section title="Preventative Care & Vaccinations" note="Ensure all vaccines are up-to-date — respiratory infections are the leading cause of COPD exacerbations.">
        <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: "20px" }}>
          {vaccines.map(v => (
            <div key={v.id}>
              <label style={labelStyle}>{v.label.toUpperCase()}</label>
              <select value={formData[v.id] || ""} onChange={e => updateField(v.id, e.target.value)} style={{ ...inputStyle, marginTop: "6px" }}>
                <option value="">— Select —</option>
                {r => <option key={r}>{r}</option>}
                {v.options.map(o => <option key={o}>{o}</option>)}
              </select>
            </div>
          ))}
        </div>
      </Section>
    </div>
  );
};

// --- Sub-Tab: Sign-off ---
const SignOffTab = ({ formData, updateField }) => {
  const doctorName = formData.team_pulmonologist || "Dr. Arvind Ramesh";

  return (
    <div>
      <Section title="Visit Summary & Impression">
        <div style={{ marginBottom: "14px" }}>
          <label style={labelStyle}>CLINICAL IMPRESSION / VISIT SUMMARY</label>
          <textarea
            rows={5}
            value={formData.plan_visit_summary || ""}
            onChange={e => updateField("plan_visit_summary", e.target.value)}
            placeholder="Document clinical impression, decisions made, progress since last visit, and outstanding actions..."
            style={{ ...inputStyle, marginTop: "6px", resize: "vertical" }}
          />
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "20px" }}>
          <div>
            <label style={labelStyle}>NEXT VISIT DATE</label>
            <input type="date" value={formData.plan_next_visit_date || ""} onChange={e => updateField("plan_next_visit_date", e.target.value)} style={inputStyle} />
          </div>
          <div>
            <label style={labelStyle}>CLINICIAN SIGN-OFF</label>
            <select value={formData.plan_signoff || "signed"} onChange={e => updateField("plan_signoff", e.target.value)} style={{ ...inputStyle, marginTop: "4px" }}>
              <option value="">— Pending —</option>
              <option value="signed">Signed — {doctorName}</option>
              <option value="countersignature_required">Countersignature required</option>
            </select>
          </div>
        </div>
      </Section>

      <Section title="Discharge / Take-Home Instructions">
        <div style={{ marginBottom: "14px" }}>
          <label style={labelStyle}>PATIENT INSTRUCTIONS</label>
          <textarea
            rows={4}
            value={formData.plan_discharge_instructions || ""}
            onChange={e => updateField("plan_discharge_instructions", e.target.value)}
            placeholder="e.g. Use salbutamol as needed, continue BiPAP nightly, return if SpO2 drops below 88%..."
            style={{ ...inputStyle, marginTop: "6px", resize: "vertical" }}
          />
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "20px" }}>
          <FormField label="ACTIVE MEDICATIONS SUMMARY" name="plan_meds_summary" placeholder="e.g. Trelegy Ellipta, Albuterol PRN" />
          <FormField label="EMERGENCY CONTACT" name="plan_emergency_contact" placeholder="e.g. On-call respiratory team: Ext 4521" />
        </div>
      </Section>

      {formData.plan_signoff && formData.plan_signoff !== "— Pending —" && (
        <div style={{ border: "1px solid #c8e6c9", background: "#f0fdf4", padding: "14px 16px", marginTop: "16px", borderLeft: "4px solid #2e7d32" }}>
          <div style={{ fontSize: "11.5px", fontWeight: 600, color: "#1b5e20" }}>
            ✓ Verified &amp; Signed by: {doctorName} — Pulmonology Specialist
          </div>
          <div style={{ fontSize: "10.5px", color: "#4caf50", marginTop: "2px" }}>
            Encounter documented and locked for clinical review. Next follow-up: {formData.plan_next_visit_date || "in 8 weeks"}.
          </div>
        </div>
      )}
    </div>
  );
};

// --- Main Component ---
const CarePlanTab = () => {
  const { formData, updateField } = usePulmonology();
  const [justPopulated, setJustPopulated] = useState(false);

  const applyCarePlanDefaults = () => {
    setJustPopulated(true);
    setTimeout(() => setJustPopulated(false), 2000);

    // 1. Action plan metadata
    updateField("plan_aecopd_issued", "Yes — written copy given");
    updateField("plan_visit_interval", "8 weeks");
    updateField("plan_o2_reassess", "Not applicable");
    updateField("plan_tx_status", "Not eligible at this stage");

    // 2. AECOPD Zones
    updateField("plan_zone_green_spo2", "≥90%");
    updateField("plan_zone_green_action", "Continue Trelegy Ellipta 1 inhalation once daily in the morning. Rinse mouth and spit after use. Continue regular light physical activity.");
    updateField("plan_zone_yellow_trigger", "Increased breathlessness, increased cough, or sputum volume/color change (yellow/green).");
    updateField("plan_zone_yellow_action", "Increase rescue Albuterol to 2 puffs every 4 hours PRN. Contact pulmonology clinic. Initiate 5-day rescue pack if symptoms do not improve.");
    updateField("plan_zone_red_trigger", "Resting SpO2 <88%, acute severe breathlessness, chest tightness, blue lips/fingers, or confusion.");
    updateField("plan_zone_red_action", "Call 112 / 911 or proceed to the nearest Emergency Department immediately.");

    // 3. Referrals & Vaccines
    updateField("ref_rehab", "Referred — enrolled");
    updateField("ref_smoking", formData.lifestyle_smoking === "Never Smoked" ? "Never smoked" : "Ex-smoker — cessation confirmed");
    updateField("ref_physio", "Not required");
    updateField("ref_dietitian", "Not required");
    updateField("ref_psychology", "Screened — normal");
    updateField("ref_palliative", "Not yet discussed");

    updateField("vac_flu", "Completed this season");
    updateField("vac_pneumo", "Up to date");
    updateField("vac_covid", "Up to date");
    updateField("vac_rsv", "Given");

    // 4. Clinical Visit Summary & Sign-off
    if (!formData.plan_visit_summary) {
      updateField(
        "plan_visit_summary",
        "Patient meets GOLD 2024 Group E criteria (FEV1 52% predicted, 2 exacerbations/yr, blood eosinophils 320 cells/mcL). Outpatient medication reconciliation completed: consolidated to single-inhaler Triple Therapy (Trelegy Ellipta 100/62.5/25 mcg OD). Discontinued duplicate Tiotropium and Budesonide to eliminate therapeutic duplication and reduce adverse effects. Albuterol PRN maintained for rescue. Inhaler technique verified with DPI protocol and post-dose mouth rinse. Patient is stable on room air (target SpO2 90–94%). Enrolled in Pulmonary Rehabilitation. Follow-up in 8 weeks."
      );
    }

    if (!formData.plan_next_visit_date) {
      const d = new Date();
      d.setDate(d.getDate() + 56); // 8 weeks out
      updateField("plan_next_visit_date", d.toISOString().substring(0, 10));
    }

    updateField("plan_signoff", "signed");

    if (!formData.plan_discharge_instructions) {
      updateField(
        "plan_discharge_instructions",
        "Take Trelegy Ellipta 1 inhalation once daily in the morning. Rinse mouth and spit with water after each use. Use Albuterol HFA 2 puffs as needed for acute shortness of breath. Attend scheduled Pulmonary Rehabilitation sessions. Return immediately if SpO2 drops below 88% or severe breathlessness occurs."
      );
    }

    if (!formData.plan_meds_summary) {
      updateField(
        "plan_meds_summary",
        "Trelegy Ellipta 100/62.5/25 mcg OD, Albuterol HFA 90 mcg 2 puffs q4-6h PRN (Tiotropium & Budesonide Discontinued)"
      );
    }

    if (!formData.plan_emergency_contact) {
      updateField("plan_emergency_contact", "Pulmonology On-Call Service: Ext 4521 / Emergency: 112 or 911");
    }
  };

  useEffect(() => {
    // Automatically apply defaults on first visit if not yet initialized
    if (!formData.plan_aecopd_issued) {
      applyCarePlanDefaults();
    }
  }, [formData.plan_aecopd_issued]);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "20px" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", background: "#fff", padding: "14px 18px", border: "1px solid #e0e0e0", borderLeft: "4px solid #000" }}>
        <div>
          <h4 style={{ margin: 0, fontSize: "14px", fontWeight: 600, textTransform: "uppercase" }}>Pulmonary Care Plan &amp; Longitudinal Management</h4>
          <p style={{ margin: "3px 0 0", fontSize: "11.5px", color: "#666" }}>AECOPD self-management action plan, allied health referrals, preventative vaccinations, and clinician sign-off</p>
        </div>
        <button
          type="button"
          onClick={applyCarePlanDefaults}
          style={{
            fontSize: "11.5px",
            padding: "6px 14px",
            background: justPopulated ? "#16a34a" : "#000",
            color: "#fff",
            border: "none",
            borderRadius: "2px",
            cursor: "pointer",
            fontWeight: 600,
            transition: "all 0.2s ease",
          }}
        >
          {justPopulated ? "✓ Guidelines Aligned!" : "⚡ Auto-Align Care Plan to GOLD Guidelines"}
        </button>
      </div>

      <VoiceDictationPanel section="Pulmonary Care Plan" />
      <ActionPlanTab formData={formData} updateField={updateField} />
      <ReferralsTab formData={formData} updateField={updateField} />
      <SignOffTab formData={formData} updateField={updateField} />
    </div>
  );
};

export default CarePlanTab;
