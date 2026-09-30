import React from "react";
import Section from "../../components/Section";
import FormField from "../../components/FormField";

/**
 * PdCatheterGuide Component
 * Complete clinical and operative procedural record for Peritoneal Dialysis
 * Catheter Surgical / Laparoscopic Insertion.
 */
const PdCatheterGuide = () => {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "20px" }}>
      {/* 1. Pre-Op Planning & Exit Site Selection */}
      <Section title="Pre-Operative Planning & Exit Site Localization" note="Access site optimization">
        {/* Row 1: Approach (2fr) + Exit site (1fr) */}
        <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr", gap: "18px 24px", marginBottom: "18px" }}>
          <FormField
            label="Surgical Insertion Approach"
            name="pd_proc_approach"
            type="select"
            options={[
              "Advanced Laparoscopic Insertion (with Omentopexy)",
              "Open Surgical Mini-Laparotomy (Paramedian cutdown)",
              "Percutaneous Fluoroscopic Guidewire (Modified Seldinger)",
              "Peritoneoscopic Optical Trocar Insertion",
            ]}
          />
          <FormField
            label="Exit Site Location"
            name="pd_exit_site_loc"
            type="select"
            options={[
              "Left Lower Quadrant (Paramedian — Standard)",
              "Right Lower Quadrant (Paramedian)",
              "Upper Abdominal (Obesity / Ostomy / Hernia history)",
              "Presternal Dual-Catheter (Severe obesity / Stoma)",
            ]}
          />
        </div>

        {/* Row 2: Beltline (2fr) + Abx (1fr) */}
        <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr", gap: "18px 24px", marginBottom: "18px" }}>
          <FormField
            label="Beltline Relation (Checked Standing & Sitting)"
            name="pd_beltline_check"
            type="select"
            options={[
              "Well below beltline — No friction",
              "Well above beltline — Patient confirmed comfortable",
              "Mid-abdominal — Adjusted clear of skin folds",
            ]}
          />
          <FormField
            label="Prophylactic Antibiotic Administered"
            name="pd_prophylactic_abx"
            type="select"
            options={[
              "Cefazolin 1g IV within 60 mins of incision",
              "Vancomycin 1g IV (MRSA colonized / Penicillin allergic)",
              "Gentamicin IV added",
            ]}
          />
        </div>

        {/* Row 3: Bowel & Bladder (2 columns balanced 50/50) */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "18px 24px" }}>
          <FormField
            label="Pre-Op Bowel Evacuation"
            name="pd_bowel_prep"
            type="select"
            options={["Enema administered pre-op; Rectum empty", "Spontaneous bowel movement on morning of surgery", "None"]}
          />
          <FormField
            label="Bladder Decompression"
            name="pd_bladder_decomp"
            type="select"
            options={["Foley catheter placed on table", "Patient voided immediately prior to surgery", "Intermittent catheterization"]}
          />
        </div>
      </Section>

      {/* 2. Catheter Model & Surgical Technique */}
      <Section title="Catheter Specification & Surgical Technique" note="Operative placement details">
        {/* Row 1: Model (2fr) + Tip (1fr) */}
        <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr", gap: "18px 24px", marginBottom: "18px" }}>
          <FormField
            label="PD Catheter Model"
            name="pd_catheter_model"
            type="select"
            options={[
              "Coiled 2-Cuff Tenckhoff Catheter (Standard 62 cm)",
              "Straight 2-Cuff Tenckhoff Catheter",
              "Swan-Neck Pre-formed Arcuate 2-Cuff",
              "Missouri / Toronto Western Discs Catheter",
            ]}
          />
          <FormField
            label="Pelvic Tip Positioning"
            name="pd_tip_position"
            type="select"
            options={[
              "Deep pelvis / True pelvis (Pouch of Douglas / Rectovesical pouch)",
              "Position visually confirmed via laparoscope",
              "Fluoroscopy contrast verified in dependent pelvis",
            ]}
          />
        </div>

        {/* Row 2: Deep cuff (2fr) + Superficial cuff (1fr) */}
        <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr", gap: "18px 24px", marginBottom: "18px" }}>
          <FormField
            label="Deep Cuff Positioning"
            name="pd_deep_cuff_pos"
            type="select"
            options={[
              "Embedded securely within posterior rectus sheath / muscle",
              "Anchored with absorbable pursestring (2-0 PDS)",
              "Pre-peritoneal space",
            ]}
          />
          <FormField
            label="Superficial Cuff Placement"
            name="pd_superficial_cuff_pos"
            type="select"
            options={[
              "2 cm inside skin exit tract (Target standard)",
              "1.5 - 2.5 cm from exit orifice",
              "Cuff depth verified — zero risk of skin extrusion",
            ]}
          />
        </div>

        {/* Row 3: Tunnel (2fr) + Adjuvant maneuvers (1fr) */}
        <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr", gap: "18px 24px" }}>
          <FormField
            label="Subcutaneous Tunnel Configuration"
            name="pd_tunnel_trajectory"
            type="select"
            options={[
              "Curved downward and lateral arc (Swan-neck angle)",
              "Straight lateral downward path",
              "Extended cranial subcutaneous tunnel",
            ]}
          />
          <FormField
            label="Laparoscopic Adjuvant Maneuvers"
            name="pd_lap_maneuvers"
            type="select"
            options={[
              "Omentopexy performed (Omentum sutured to abdominal wall)",
              "Partial omentectomy (Bulky omentum trimmed)",
              "Concurrent hernia repair with mesh",
              "Pelvic adhesiolysis performed",
              "None — Direct uncomplicated placement",
            ]}
          />
        </div>
      </Section>

      {/* 3. Fluid Instillation & Flow Trial */}
      <Section title="Perioperative Fluid Instillation & Drainage Test" note="Patency and leak check on operating table">
        {/* Row 1: Fluid & Inflow (2 columns) */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "18px 24px", marginBottom: "18px" }}>
          <FormField
            label="Trial Instillation Solution & Volume"
            name="pd_trial_volume"
            placeholder="e.g. 500 mL 1.5% Dextrose + 500 IU Heparin"
          />
          <FormField
            label="Inflow Gravitational Rate"
            name="pd_inflow_rate"
            type="select"
            options={[
              "Rapid free-flowing gravitational inflow (<5 mins for 500 mL)",
              "Sluggish inflow — catheter repositioned",
              "Inflow pain noted (flow rate slowed)",
            ]}
          />
        </div>

        {/* Row 2: Outflow & Color (2 columns) */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "18px 24px", marginBottom: "18px" }}>
          <FormField
            label="Outflow Drainage Volume & Rate"
            name="pd_outflow_rate"
            placeholder="e.g. 480 mL recovered within 8 mins (>85% recovery)"
          />
          <FormField
            label="Drainage Effluent Clarity"
            name="pd_effluent_color"
            type="select"
            options={[
              "Clear straw-colored / amber",
              "Light pink / faint serosanguinous (expected early)",
              "Frank bloody — irrigated until clearing",
            ]}
          />
        </div>

        {/* Row 3: Leak & Lock (2 columns) */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "18px 24px" }}>
          <FormField
            label="Pericatheter Leak Evaluation (Valsalva Test)"
            name="pd_leak_check"
            type="select"
            options={[
              "Zero pericatheter fluid leak under pressure/Valsalva",
              "Minor seepage — extra reinforcing pursestring suture placed",
              "Watertight fascial closure confirmed",
            ]}
          />
          <FormField
            label="Catheter Locking & Final Flush"
            name="pd_final_lock"
            type="select"
            options={[
              "Flushed with 10 mL Heparinized Saline (1000 U/mL) and clamped",
              "Dry catheter left closed",
              "Low volume flush (5 mL heparin)",
            ]}
          />
        </div>
      </Section>

      {/* 4. Dressing & Post-Op Plan */}
      <Section title="Catheter Dressing, Post-Op Care & Break-In Schedule" note="Healing and training protocol">
        {/* Row 1: Transfer set (2fr) + Suture removal (1fr) */}
        <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr", gap: "18px 24px", marginBottom: "18px" }}>
          <FormField
            label="Titanium Adapter & Transfer Set"
            name="pd_transfer_set"
            type="select"
            options={[
              "Titanium adapter attached + Baxter / Fresenius transfer set locked",
              "Titanium connector capped with sterile plug",
              "Standard transfer line secured",
            ]}
          />
          <FormField
            label="Suture Removal Schedule"
            name="pd_suture_removal"
            placeholder="e.g. Absorbable sutures used (Clips removed day 14)"
          />
        </div>

        {/* Row 2: Dressing (2fr) + Break-in (1fr) */}
        <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr", gap: "18px 24px", marginBottom: "18px" }}>
          <FormField
            label="Exit Site Sterile Dressing"
            name="pd_dressing_type"
            type="select"
            options={[
              "Non-occlusive sterile gauze with breathable tape (catheter immobilized)",
              "Chlorhexidine sponge (Biopatch) + transparent island dressing",
              "Mupirocin / Gentamicin ointment applied at exit site",
            ]}
          />
          <FormField
            label="Planned Break-In Interval"
            name="pd_break_in_plan"
            type="select"
            options={[
              "Standard 2-week rest without exchanges (Heal before fill)",
              "Extended 4-week break-in (High risk / Steroids / Malnutrition)",
              "Urgent-start low-volume APD supine only (Day 3-5 post-op)",
            ]}
          />
        </div>

        {/* Row 3: Narrative */}
        <div>
          <FormField
            label="Detailed Operative Procedure Narrative"
            name="pd_operative_narrative"
            type="textarea"
            placeholder="Document skin incision, muscle splitting, fascial closure, absence of visceral injury, patient tolerance, and anesthesia recovery..."
          />
        </div>
      </Section>
    </div>
  );
};

export default PdCatheterGuide;
