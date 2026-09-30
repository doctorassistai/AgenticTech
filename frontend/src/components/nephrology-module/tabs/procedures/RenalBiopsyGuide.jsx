import React from "react";
import Section from "../../components/Section";
import FormField from "../../components/FormField";

/**
 * RenalBiopsyGuide Component
 * Complete clinical and operational procedural record for Percutaneous Ultrasound-Guided
 * Renal Biopsy (Native Kidney & Transplant Allograft).
 */
const RenalBiopsyGuide = () => {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "20px" }}>
      {/* 1. Pre-Procedure Safety & Coagulation Checklist */}
      <Section title="Pre-Biopsy Safety & Coagulation Verification" note="Mandatory checks prior to needle insertion">
        {/* Row 1: Labs (3 columns) */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "18px 24px", marginBottom: "18px" }}>
          <FormField label="Platelet Count (cells/µL)" name="bx_platelets" placeholder="e.g. 210,000 (>100k required)" />
          <FormField label="INR / Prothrombin Time" name="bx_inr" placeholder="e.g. 1.05 (<1.3 required)" />
          <FormField label="aPTT (seconds)" name="bx_aptt" placeholder="e.g. 31s (Normal range)" />
        </div>

        {/* Row 2: BP & Anticoagulant Status (1:2 ratio) */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 2fr", gap: "18px 24px", marginBottom: "18px" }}>
          <FormField
            label="Pre-Procedure Blood Pressure"
            name="bx_bp_check"
            type="select"
            options={["Strictly Controlled (<140/90 mmHg)", "Elevated — Antihypertensive given", "Uncontrolled (>160/100) — Procedure Delayed"]}
          />
          <FormField
            label="Antiplatelet / Anticoagulant Status"
            name="bx_anticoag_status"
            type="select"
            options={[
              "No Antithrombotics Active",
              "Aspirin held 7 days",
              "Clopidogrel / P2Y12 held 7 days",
              "DOAC held >48 hours",
              "LMWH held >24 hours / UFH held 6h",
              "Warfarin reversed (INR confirmed <1.3)",
            ]}
          />
        </div>

        {/* Row 3: DDAVP */}
        <div>
          <FormField
            label="Desmopressin (DDAVP) Pre-Medication"
            name="bx_ddavp"
            type="select"
            options={["Not indicated (GFR adequate / Normal platelets)", "Administered 0.3 mcg/kg IV (Uremic bleeding prophylaxis)", "Administered Intranasally"]}
          />
        </div>
      </Section>

      {/* 2. Biopsy Target & Ultrasound Guidance */}
      <Section title="Biopsy Target, Guidance & Local Anesthesia" note="Operator technical settings">
        {/* Row 1: Target (2fr) + Position (1fr) */}
        <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr", gap: "18px 24px", marginBottom: "18px" }}>
          <FormField
            label="Target Kidney & Anatomic Site"
            name="bx_target_site"
            type="select"
            options={[
              "Native Left Kidney — Lower Pole (Standard)",
              "Native Right Kidney — Lower Pole",
              "Kidney Allograft / Transplant — Upper Pole / Outer Cortex",
              "Native Kidney — Cortical Mass / Lesion",
            ]}
          />
          <FormField
            label="Patient Position"
            name="bx_position"
            type="select"
            options={[
              "Prone with abdominal bolster (Native)",
              "Semi-Prone / Oblique (Native with scoliosis/resp limit)",
              "Supine (Transplant Allograft in Iliac Fossa)",
            ]}
          />
        </div>

        {/* Row 2: US Guidance (2fr) + Capsule depth (1fr) */}
        <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr", gap: "18px 24px", marginBottom: "18px" }}>
          <FormField
            label="Ultrasound Guidance Modality"
            name="bx_us_guidance"
            type="select"
            options={[
              "Real-time continuous US with needle guide bracket",
              "Real-time free-hand ultrasound guidance",
              "Pre-procedure US skin marking only",
              "CT fluoroscopy guidance (difficult habitus)",
            ]}
          />
          <FormField label="Depth to Renal Capsule (cm)" name="bx_capsule_depth" placeholder="e.g. 5.2 cm on US" />
        </div>

        {/* Row 3: US Findings (2fr) + Local anesthesia (1fr) */}
        <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr", gap: "18px 24px" }}>
          <FormField
            label="Ultrasound Visualization Findings"
            name="bx_us_findings"
            type="select"
            options={[
              "Clear parenchymal margins; Normal corticomedullary diff",
              "Increased cortical echogenicity (Medical renal disease)",
              "Thin cortex (<10 mm) — increased risk",
              "Mobile lower pole with respiratory excursion",
            ]}
          />
          <FormField label="Local Anesthetic Agent & Volume" name="bx_local_anesthesia" placeholder="e.g. 1% Lidocaine 15 mL" />
        </div>
      </Section>

      {/* 3. Device & Specimen Adequacy */}
      <Section title="Biopsy Device, Passes & Core Specimen Adequacy" note="Specimen procurement & laboratory triage">
        {/* Row 1: Needle Mechanism (2fr) + Gauge (1fr) */}
        <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr", gap: "18px 24px", marginBottom: "18px" }}>
          <FormField
            label="Biopsy Needle Type & Mechanism"
            name="bx_needle_mechanism"
            type="select"
            options={[
              "Automated Spring-Loaded Core Gun (e.g. Bard Magnum / Max-Core)",
              "Semi-Automated Needle (e.g. Quick-Core)",
              "Manual Tru-Cut Needle",
            ]}
          />
          <FormField
            label="Needle Gauge"
            name="bx_needle_gauge"
            type="select"
            options={["16 Gauge (Standard automated core)", "18 Gauge (High risk / Allograft)", "14 Gauge (Surgical open)"]}
          />
        </div>

        {/* Row 2: Throw, Passes, Cores (3 columns) */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "18px 24px", marginBottom: "18px" }}>
          <FormField
            label="Needle Throw Depth"
            name="bx_needle_throw"
            type="select"
            options={["22 mm Throw (Standard excursion)", "15 mm Throw (Short stroke / Near vessel)", "Variable throw"]}
          />
          <FormField label="Total Needle Passes" name="bx_total_passes" type="select" options={["1 Pass", "2 Passes (Standard)", "3 Passes", "4 Passes (Max limit)"]} />
          <FormField label="Intact Cores Obtained" name="bx_intact_cores" placeholder="e.g. 2 cores (12 mm & 15 mm)" />
        </div>

        {/* Row 3: Visual Adequacy (2fr) + Est Glomeruli (1fr) */}
        <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr", gap: "18px 24px", marginBottom: "18px" }}>
          <FormField
            label="Stereomicroscopic / Visual Assessment"
            name="bx_visual_adequacy"
            type="select"
            options={[
              "Adequate: Red cortical cores with prominent glomeruli confirmed",
              "Suboptimal: Mainly pale medullary / fibrotic tissue",
              "Inadequate: Striated muscle / perinephric adipose tissue",
            ]}
          />
          <FormField label="Estimated Glomeruli Count" name="bx_est_glomeruli" placeholder="e.g. >15 glomeruli seen" />
        </div>

        {/* Row 4: Specimen triage */}
        <div style={{ marginBottom: "18px" }}>
          <FormField
            label="Specimen Triage into Fixatives"
            name="bx_specimen_triage"
            type="select"
            options={[
              "Triaged: 10% Formalin (LM) + Zeus/Michel's (IF) + Glutaraldehyde (EM)",
              "Formalin & Michel's only",
              "Urgent Frozen Section for Rapid GN / Crescentic Staging",
            ]}
          />
        </div>

        {/* Row 5: Notes */}
        <div>
          <FormField
            label="Specimen Procurement Notes"
            name="bx_specimen_notes"
            type="textarea"
            placeholder="Document needle trajectory, respiratory cooperation, visual core characteristics, and specimen hand-off to lab courier..."
          />
        </div>
      </Section>

      {/* 4. Post-Biopsy Protocol & Monitoring */}
      <Section title="Post-Biopsy Hematoma Surveillance & Recovery" note="Monitoring protocol for early complication detection">
        {/* Row 1: Immediate US (2fr) + Bed Rest (1fr) */}
        <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr", gap: "18px 24px", marginBottom: "18px" }}>
          <FormField
            label="Immediate Post-Biopsy US Scan"
            name="bx_immediate_us"
            type="select"
            options={[
              "No perinephric or subcapsular hematoma detected",
              "Small subcapsular hematoma (<1.5 cm) — asymptomatic",
              "Perinephric collection detected — close surveillance",
              "Active color Doppler extravasation — compression extended",
            ]}
          />
          <FormField
            label="Strict Bed Rest Protocol"
            name="bx_bed_rest"
            type="select"
            options={[
              "Strict Flat Bed Rest x 6 Hours (Standard native)",
              "Strict Supine Bed Rest x 4 Hours (Transplant allograft)",
              "Extended Bed Rest x 12-24 Hours (Pain / hematoma)",
            ]}
          />
        </div>

        {/* Row 2: Dressing, Urine, Hemoglobin (3 columns) */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "18px 24px", marginBottom: "18px" }}>
          <FormField
            label="Compression Dressing"
            name="bx_compression"
            type="select"
            options={["Sterile pressure dressing + 2 kg sandbag x 4 hours", "Manual direct pressure 15 mins + pressure bandage", "Standard sterile dressing"]}
          />
          <FormField
            label="Urine Inspection Protocol"
            name="bx_urine_color"
            type="select"
            options={[
              "Urine Clear / Amber throughout recovery",
              "Microscopic hematuria only on dipstick",
              "Transient gross hematuria (cleared spontaneously)",
              "Persistent macroscopic hematuria with clots (Urgent alert)",
            ]}
          />
          <FormField label="Post-Biopsy 4-Hour Hemoglobin" name="bx_post_hgb" placeholder="e.g. 11.4 g/dL (Stable)" />
        </div>

        {/* Row 3: Vitals Status */}
        <div style={{ marginBottom: "18px" }}>
          <FormField
            label="Post-Procedure Vitals Status"
            name="bx_vitals_status"
            type="select"
            options={[
              "Vitals stable (q15m x 1h, q30m x 2h, q1h x 4h)",
              "Transient hypotension responding to IV bolus",
              "Unstable / Tachycardia — urgent repeat ultrasound ordered",
            ]}
          />
        </div>

        {/* Row 4: Summary notes */}
        <div>
          <FormField
            label="Post-Procedure Summary & Discharge Instructions"
            name="bx_post_summary"
            type="textarea"
            placeholder="Document patient toleration, pain management, avoidance of heavy lifting/exercise for 14 days, contact instructions for fever/hematuria..."
          />
        </div>
      </Section>
    </div>
  );
};

export default RenalBiopsyGuide;
