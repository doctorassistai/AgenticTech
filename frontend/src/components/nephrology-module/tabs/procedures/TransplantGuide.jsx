import React from "react";
import Section from "../../components/Section";
import FormField from "../../components/FormField";

/**
 * TransplantGuide Component
 * Comprehensive surgical operative record for Kidney Transplantation (Recipient Procedure,
 * Allograft Implantation, Vascular Anastomoses, and Ureteroneocystostomy).
 */
const TransplantGuide = () => {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "20px" }}>
      {/* 1. Pre-Transplant Immunology & Matching */}
      <Section title="Pre-Transplant Immunology, Crossmatch & Donor Source" note="Immunological verification prior to incision">
        {/* Row 1: Blood groups & compatibility (3 columns) */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "18px 24px", marginBottom: "18px" }}>
          <FormField
            label="Recipient Blood Group"
            name="tx_recipient_bg"
            type="select"
            options={["O Positive", "A Positive", "B Positive", "AB Positive", "O Negative", "A Negative", "B Negative", "AB Negative"]}
          />
          <FormField
            label="Donor Blood Group"
            name="tx_donor_bg"
            type="select"
            options={["O Positive", "A Positive", "B Positive", "AB Positive", "O Negative", "A Negative", "B Negative", "AB Negative"]}
          />
          <FormField
            label="ABO Compatibility Status"
            name="tx_abo_compat"
            type="select"
            options={[
              "ABO Compatible",
              "ABO Incompatible (Desensitized: Plasmapheresis + Rituximab + IVIG)",
              "Paired Kidney Exchange Match",
            ]}
          />
        </div>

        {/* Row 2: Donor Source & HLA (3 columns) */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "18px 24px", marginBottom: "18px" }}>
          <FormField
            label="Donor Source & Type"
            name="tx_donor_source"
            type="select"
            options={[
              "Living Related Donor (First-degree: Sibling / Parent / Offspring)",
              "Living Spousal / Unrelated Donor",
              "Deceased Donor — Brain Death (DBD / Standard Criteria)",
              "Deceased Donor — Circulatory Death (DCD)",
              "Expanded Criteria Deceased Donor (ECD)",
            ]}
          />
          <FormField
            label="HLA Match Score (A, B, DR)"
            name="tx_hla_match"
            type="select"
            options={[
              "6/6 Antigen Match (Full HLA Identity)",
              "5/6 Antigen Match",
              "4/6 Antigen Match",
              "3/6 Antigen Match",
              "Haploidentical (2/6 or 3/6)",
              "0/6 Mismatch (Deceased zero-mismatch)",
            ]}
          />
          <FormField label="Calculated PRA / cPRA (%)" name="tx_pra_level" placeholder="e.g. 0% (Unsensitized) or 24%" />
        </div>

        {/* Row 3: Crossmatch & DSA (2 columns, balanced 50/50) */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "18px 24px", marginBottom: "18px" }}>
          <FormField
            label="CDC Crossmatch Status"
            name="tx_cdc_crossmatch"
            type="select"
            options={["Negative (Safe to proceed)", "Positive T-Cell (Contraindicated / Hyperacute risk)", "Positive B-Cell (Permissible with enhanced immunosuppression)"]}
          />
          <FormField
            label="Donor Specific Antibodies (DSA)"
            name="tx_dsa_status"
            type="select"
            options={["DSA Negative (MFI <1000)", "Low-titer DSA present (MFI 1000-3000)", "High-titer DSA (Desensitization active)"]}
          />
        </div>

        {/* Row 4: Viral surveillance (2 columns, balanced 50/50) */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "18px 24px" }}>
          <FormField
            label="CMV Serostatus Pairing (D / R)"
            name="tx_cmv_status"
            type="select"
            options={[
              "D+ / R- (High Risk — 6-month Valganciclovir prophylaxis)",
              "D+ / R+ (Moderate Risk — 3-month prophylaxis)",
              "D- / R+ (Moderate Risk)",
              "D- / R- (Low Risk — No active prophylaxis required)",
            ]}
          />
          <FormField
            label="EBV & BK Virus Status"
            name="tx_ebv_bkv_status"
            type="select"
            options={["D+ / R+ (Standard)", "D+ / R- (High risk for PTLD)", "D- / R-", "Negative BKV viremia"]}
          />
        </div>
      </Section>

      {/* 2. Surgical Procedure & Allograft Implantation */}
      <Section title="Surgical Implantation, Vascular Anastomoses & Perfusion" note="Intra-operative recipient operation">
        {/* Exposure: Incision & Vessel Count (2:1 ratio) */}
        <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr", gap: "18px 24px", marginBottom: "18px" }}>
          <FormField
            label="Surgical Incision & Approach"
            name="tx_implant_site"
            type="select"
            options={[
              "Right Lower Quadrant — Modified Gibson Incision (Extraperitoneal — Standard)",
              "Left Lower Quadrant — Modified Gibson Incision (Extraperitoneal)",
              "Midline Transperitoneal (En-bloc pediatric donor / Repeat transplant)",
            ]}
          />
          <FormField label="Donor Renal Vessels Anatomy" name="tx_vessel_count" placeholder="e.g. Single artery, single vein" />
        </div>

        {/* Venous Anastomosis: Technique (2fr) + Clamp Time (1fr) */}
        <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr", gap: "18px 24px", marginBottom: "18px" }}>
          <FormField
            label="Venous Anastomosis Technique"
            name="tx_venous_anast"
            type="select"
            options={[
              "Renal Vein End-to-Side to External Iliac Vein (5-0 Prolene continuous)",
              "Renal Vein with extension graft (Gonadal/Iliac) to External Iliac Vein",
              "Renal Vein to Common Iliac Vein (Deep pelvis / complex anatomy)",
            ]}
          />
          <FormField label="Venous Clamp Time (mins)" name="tx_venous_clamp_time" placeholder="e.g. 18 mins" />
        </div>

        {/* Arterial Anastomosis: Technique (2fr) + Clamp Time (1fr) */}
        <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr", gap: "18px 24px", marginBottom: "20px" }}>
          <FormField
            label="Arterial Anastomosis Technique"
            name="tx_arterial_anast"
            type="select"
            options={[
              "Renal Artery End-to-Side to External Iliac Artery (6-0 Prolene continuous)",
              "Carrel Aortic Patch to External Iliac Artery (Deceased donor)",
              "Renal Artery End-to-End to Internal Iliac / Hypogastric Artery",
              "Dual Renal Arteries: Pantaloons reconstruction to External Iliac",
            ]}
          />
          <FormField label="Arterial Clamp Time (mins)" name="tx_arterial_clamp_time" placeholder="e.g. 24 mins" />
        </div>

        {/* Sub-Header: Ischemia Timers */}
        <div style={{ padding: "12px 16px", background: "#f8fafc", border: "1px solid #e2e8f0", borderRadius: "3px", marginBottom: "16px" }}>
          <span style={{ fontSize: "11px", fontWeight: 700, letterSpacing: "0.05em", textTransform: "uppercase", color: "#475569" }}>
            Ischemia Timers & Preservation Solution
          </span>
        </div>

        {/* Ischemia Timers (4 balanced columns) */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: "18px 24px", marginBottom: "20px" }}>
          <FormField label="Cold Ischemia (CIT - Hours)" name="tx_cit" placeholder="e.g. 1.5h living / 14h deceased" />
          <FormField label="Warm Ischemia (WIT - Mins)" name="tx_wit" placeholder="e.g. 2.5 mins (donor recovery)" />
          <FormField label="Anastomosis / 2nd WIT (Mins)" name="tx_anast_wit" placeholder="e.g. 32 mins (rewarming)" />
          <FormField
            label="Preservation Solution"
            name="tx_preservation_fluid"
            type="select"
            options={["University of Wisconsin (UW)", "Custodiol HTK Solution", "Perfadex / Celsior", "LifePort Machine Perfusion"]}
          />
        </div>

        {/* Re-perfusion Quality (2 balanced columns) */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "18px 24px" }}>
          <FormField
            label="Allograft Re-perfusion Assessment"
            name="tx_reperfusion_eval"
            type="select"
            options={[
              "Excellent: Immediate uniform pink blush, excellent parenchymal turgor, robust pulsation",
              "Good: Adequate re-perfusion, mild patchy areas clearing in 5 mins",
              "Sluggish re-perfusion / Vasospasm (Papaverine / Verapamil applied)",
              "Mottled / Soft / Dark graft (Urgent vascular interrogation)",
            ]}
          />
          <FormField
            label="Baseline (Zero-Hour) Biopsy"
            name="tx_zero_hour_bx"
            type="select"
            options={[
              "Needle core biopsy performed 30 mins post-reperfusion (No hematoma)",
              "Wedge biopsy performed at lower pole",
              "Not performed",
            ]}
          />
        </div>
      </Section>

      {/* 3. Ureteric Reconstruction & Intra-Operative Diuresis */}
      <Section title="Ureteroneocystostomy & Intra-Operative Diuresis" note="Urinary reconstruction details">
        {/* Row 1: Technique & Stent (2:1 ratio) */}
        <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr", gap: "18px 24px", marginBottom: "18px" }}>
          <FormField
            label="Ureteric Implantation Technique"
            name="tx_ureter_tech"
            type="select"
            options={[
              "Lich-Gregoir Extravesical Ureteroneocystostomy (Standard non-refluxing)",
              "Leadbetter-Politano Intravesical Implantation",
              "Ureteroureterostomy (To native ipsilateral ureter)",
            ]}
          />
          <FormField
            label="Internal Ureteric Stent (Double-J)"
            name="tx_dj_stent"
            type="select"
            options={[
              "6 Fr, 12 cm Double-J Stent placed across anastomosis into bladder",
              "6 Fr, 16 cm Double-J Stent placed",
              "No stent placed (Direct anastomosis)",
            ]}
          />
        </div>

        {/* Row 2: Suture, Diuretics, Stent Removal Date (3 balanced columns) */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "18px 24px", marginBottom: "18px" }}>
          <FormField
            label="Anastomosis Suture Material"
            name="tx_ureter_suture"
            type="select"
            options={["5-0 PDS continuous suture with spatulated mucosal spit", "5-0 Monocryl interrupted", "4-0 Vicryl"]}
          />
          <FormField
            label="Intra-Operative Diuretics Given"
            name="tx_intraop_diuretics"
            type="select"
            options={[
              "Mannitol 20% 125 mL + Furosemide 100 mg IV prior to unclamping",
              "Furosemide 250 mg IV push",
              "Mannitol only",
              "None given",
            ]}
          />
          <FormField label="Ureteric Stent Removal Target Date" name="tx_stent_remove_date" type="date" />
        </div>

        {/* Row 3: Intra-op urine output (full width) */}
        <div>
          <FormField
            label="Intra-Operative Urine Output on Declamping"
            name="tx_urine_on_declamp"
            type="select"
            options={[
              "Immediate robust clear urine output (>300 mL on operating table)",
              "Delayed Graft Function / Oliguric (<50 mL on table)",
              "Anuria (Hydration and diuretics titrated)",
            ]}
          />
        </div>
      </Section>

      {/* 4. Operative Closeout, Drains & Immunosuppression */}
      <Section title="Operative Closeout, Drains & Post-Op Protocol" note="Closure, lines, and induction therapy">
        {/* Row 1: Induction & Drain (2:1 ratio) */}
        <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr", gap: "18px 24px", marginBottom: "18px" }}>
          <FormField
            label="Induction Immunosuppression Administered"
            name="tx_induction"
            type="select"
            options={[
              "Basiliximab (Simulect) 20 mg IV Day 0 (Standard risk)",
              "rATG (Thymoglobulin) 1.5 mg/kg IV started on table (High immunological risk)",
              "Alemtuzumab (Campath) 30 mg IV single dose",
              "Methylprednisolone 500 mg IV given intra-operatively",
            ]}
          />
          <FormField
            label="Perinephric Surgical Drain"
            name="tx_drain"
            type="select"
            options={[
              "19 Fr Round Jackson-Pratt (JP) closed suction drain placed in pelvic space",
              "Blake 19 Fr silicone drain placed",
              "No drain placed",
            ]}
          />
        </div>

        {/* Row 2: Closure & Blood loss (2:1 ratio) */}
        <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr", gap: "18px 24px", marginBottom: "18px" }}>
          <FormField
            label="Abdominal Wall Closure"
            name="tx_wall_closure"
            type="select"
            options={[
              "Mass closure with continuous #1 PDS loop + Subcutaneous 2-0 Vicryl + Skin staples",
              "Layered closure: Internal oblique #0 PDS + External oblique #0 PDS + Subcuticular 4-0 Monocryl",
            ]}
          />
          <FormField label="Estimated Blood Loss (mL)" name="tx_ebl" placeholder="e.g. 150 mL (No transfusions)" />
        </div>

        {/* Row 3: Tacro target & Baseline Cr (2 balanced columns) */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "18px 24px", marginBottom: "18px" }}>
          <FormField label="Target Tacrolimus Trough Level (Month 1)" name="tx_tacro_target" placeholder="e.g. 8-10 ng/mL (Months 1-3)" />
          <FormField label="Baseline Immediate Post-Op Creatinine Target" name="tx_post_cr" placeholder="e.g. Target Cr <2.0 mg/dL by Day 3" />
        </div>

        {/* Row 4: Narrative surgical summary */}
        <div>
          <FormField
            label="Detailed Operative Surgical Summary & Technical Notes"
            name="tx_surgical_notes"
            type="textarea"
            placeholder="Document surgical access, vessel handling, vascular suture line hemostasis, bladder submucosal tunnel, graft positioning without kinking, patient tolerance, and destination ICU/Transplant ward..."
          />
        </div>
      </Section>
    </div>
  );
};

export default TransplantGuide;
