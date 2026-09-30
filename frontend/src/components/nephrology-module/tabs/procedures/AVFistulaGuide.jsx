import React from "react";
import Section from "../../components/Section";
import FormField from "../../components/FormField";
import { useNephrology } from "../../context/NephrologyContext";

/**
 * AVFistulaGuide Component
 * Comprehensive procedural record for Vascular Access Surgery, Tunneled/Temporary CVC Placement,
 * and Interventional Access Salvage (Fistulogram, PTA, Thrombectomy).
 */
const AVFistulaGuide = () => {
  const { formData, updateField } = useNephrology();
  const accessCategory = formData["avf_sub_procedure"] || "avf_surgical";

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "20px" }}>
      {/* Sub-Procedure Selector Header */}
      <div style={{ background: "#f8fafc", padding: "14px 20px", border: "1px solid #e2e8f0", borderRadius: "3px", display: "flex", alignItems: "center", gap: "20px" }}>
        <span style={{ fontSize: "11.5px", fontWeight: 700, letterSpacing: "0.06em", textTransform: "uppercase", color: "#1e293b" }}>
          ACCESS PROCEDURE:
        </span>
        <div style={{ display: "flex", gap: "12px", flexWrap: "wrap" }}>
          {[
            { id: "avf_surgical", label: "Surgical AVF / AVG Creation" },
            { id: "avf_permcath", label: "Tunneled CVC (Permcath)" },
            { id: "avf_temp_line", label: "Temporary Acute Line" },
            { id: "avf_endovascular", label: "Fistulogram / PTA / Thrombectomy" },
          ].map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => updateField("avf_sub_procedure", item.id)}
              style={{
                fontSize: "12px",
                fontWeight: 600,
                padding: "6px 16px",
                borderRadius: "2px",
                cursor: "pointer",
                border: "1px solid #000000",
                background: accessCategory === item.id ? "#000000" : "#ffffff",
                color: accessCategory === item.id ? "#ffffff" : "#000000",
                transition: "all 0.15s",
              }}
            >
              {item.label}
            </button>
          ))}
        </div>
      </div>

      {/* 1. Pre-Procedure Vascular Mapping & Anatomy */}
      <Section title="Vascular Mapping & Pre-Operative Vessel Anatomy" note="Pre-procedure sonographic assessment">
        {/* Row 1: Access type (2fr) + Side (1fr) */}
        <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr", gap: "18px 24px", marginBottom: "18px" }}>
          <FormField
            label="Specific Access Type Planned"
            name="avf_type"
            type="select"
            options={[
              "Radiocephalic AVF — Brescia-Cimino (Wrist)",
              "Brachiocephalic AVF (Upper Arm)",
              "Brachiobasilic AVF with Transposition (2-Stage)",
              "Prosthetic Forearm Loop Graft (PTFE 6mm)",
              "Prosthetic Upper Arm Straight Graft (PTFE)",
              "Tunneled Right Internal Jugular Permcath",
              "Temporary Non-Tunneled Catheter (IJ / Femoral)",
            ]}
          />
          <FormField
            label="Anatomic Extremity & Side"
            name="avf_side"
            type="select"
            options={["Left Non-Dominant Arm", "Right Arm (Left-handed patient)", "Left Upper Arm", "Right Upper Arm", "Femoral"]}
          />
        </div>

        {/* Row 2: Target artery, vein, distensibility (3 columns) */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "18px 24px", marginBottom: "18px" }}>
          <FormField label="Target Artery & Caliber (mm)" name="avf_art_diam" placeholder="e.g. Radial Artery 2.4 mm (>2.0mm required)" />
          <FormField label="Target Vein & Caliber (mm)" name="avf_vein_diam" placeholder="e.g. Cephalic Vein 2.8 mm (>2.5mm required)" />
          <FormField
            label="Tourniquet Vein Distensibility Test"
            name="avf_distensibility"
            type="select"
            options={[
              "Vein dilates >0.5 mm with tourniquet (Good elasticity)",
              "Rigid / Calcified vein wall",
              "Suboptimal distensibility",
            ]}
          />
        </div>

        {/* Row 3: Allen's test */}
        <div>
          <FormField
            label="Allen's Test (Palmar Collateral Flow)"
            name="avf_allens_test"
            type="select"
            options={["Normal (Patent ulnar artery; <5 sec palmar blush)", "Abnormal — Radial artery harvest contraindicated", "N/A (Upper arm/CVC)"]}
          />
        </div>
      </Section>

      {/* 2. Surgical Creation Operative Details (AVF / AVG) */}
      {(accessCategory === "avf_surgical" || accessCategory === "avf_radiocephalic" || accessCategory === "avf_brachiocephalic") && (
        <Section title="Surgical Anastomosis & Operative Technique" note="Operative creation details">
          {/* Row 1: Incision (2fr) + Heparin (1fr) */}
          <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr", gap: "18px 24px", marginBottom: "18px" }}>
            <FormField
              label="Surgical Incision Type"
              name="avf_incision"
              type="select"
              options={[
                "Curvilinear longitudinal wrist incision (3-4 cm)",
                "Transverse antecubital fossa incision (3-5 cm)",
                "Upper arm basilic tunneling incision",
                "Loop counter-incisions (PTFE graft)",
              ]}
            />
            <FormField
              label="Systemic Heparin Administered"
              name="avf_systemic_heparin"
              type="select"
              options={[
                "5000 IU IV given 3 mins prior to clamping",
                "3000 IU IV given",
                "Regional heparinized saline flush only (high bleeding risk)",
              ]}
            />
          </div>

          {/* Row 2: Anastomosis (2fr) + Arteriotomy (1fr) */}
          <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr", gap: "18px 24px", marginBottom: "18px" }}>
            <FormField
              label="Anastomosis Configuration"
              name="avf_anastomosis_type"
              type="select"
              options={[
                "End-to-Side (Vein end spatulated to Artery side)",
                "Side-to-Side (Lateral fistula creation)",
                "End-to-End (Uncommon / Interrupted)",
                "Graft Arterial & Venous Anastomoses",
              ]}
            />
            <FormField label="Arteriotomy Length (mm)" name="avf_arteriotomy_len" placeholder="e.g. 6-8 mm standard" />
          </div>

          {/* Row 3: Suture (2fr) + Clamp time (1fr) */}
          <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr", gap: "18px 24px", marginBottom: "18px" }}>
            <FormField
              label="Vascular Suture Material"
              name="avf_suture"
              type="select"
              options={["7-0 Prolene double-armed continuous suture", "6-0 Prolene continuous suture", "6-0 PTFE suture (Gore-Tex)"]}
            />
            <FormField label="Arterial Clamp Time (mins)" name="avf_clamp_time" placeholder="e.g. 18 mins" />
          </div>

          {/* Row 4: Intra-operative thrill (full width) */}
          <div style={{ marginBottom: "18px" }}>
            <FormField
              label="Intra-Operative Thrill / Pulsatility on Table"
              name="avf_table_thrill"
              type="select"
              options={[
                "Strong, continuous palpable thrill along outflow vein immediately on unclamping",
                "Expansile pulse with weak thrill — spasm noted (Papaverine applied)",
                "Absent thrill — immediate surgical revision performed",
              ]}
            />
          </div>

          {/* Row 5: Vein dilation, EBL, Closure (3 columns) */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "18px 24px" }}>
            <FormField label="Vein Hydrostatic Dilation" name="avf_vein_dilation" placeholder="e.g. Hydrostatically dilated with heparin-saline" />
            <FormField label="Estimated Blood Loss (mL)" name="avf_ebl" placeholder="e.g. <30 mL" />
            <FormField
              label="Wound Closure"
              name="avf_closure"
              type="select"
              options={["Subcutaneous 3-0 Vicryl + Subcuticular 4-0 Monocryl", "Interrupted 4-0 Nylon skin sutures", "Skin staples"]}
            />
          </div>
        </Section>
      )}

      {/* 3. Tunneled & Temporary Catheter Placement Details */}
      {(accessCategory === "avf_permcath" || accessCategory === "avf_temp_line") && (
        <Section title="Dialysis Catheter Operative Record (Permcath / Temporary)" note="Fluoroscopy and ultrasound guided line insertion">
          {/* Row 1: Approach (2fr) + Catheter spec (1fr) */}
          <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr", gap: "18px 24px", marginBottom: "18px" }}>
            <FormField
              label="Vessel Puncture Approach"
              name="cath_approach"
              type="select"
              options={[
                "Right Internal Jugular (Standard straight trajectory to SVC)",
                "Left Internal Jugular (Curved across mediastinum)",
                "Right Femoral Vein (Emergency bed-bound)",
                "Left Femoral Vein",
                "Subclavian Vein (Avoided if possible due to stenosis risk)",
              ]}
            />
            <FormField
              label="Catheter Specifications"
              name="cath_spec"
              placeholder="e.g. 14.5 Fr, 19 cm (Right IJ) / 23 cm (Left IJ)"
            />
          </div>

          {/* Row 2: US verification (2fr) + Fluoro check (1fr) */}
          <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr", gap: "18px 24px", marginBottom: "18px" }}>
            <FormField
              label="Real-Time Ultrasound Guidance"
              name="cath_us_verification"
              type="select"
              options={[
                "Vein fully compressible, non-thrombosed; Direct needle puncture under real-time US",
                "Free-hand US landmark puncture",
                "Difficult puncture — multiple attempts required",
              ]}
            />
            <FormField
              label="Fluoroscopy Confirmation"
              name="cath_fluoro_check"
              type="select"
              options={[
                "Tip confirmed at Cavoatrial Junction (CAJ / Upper Right Atrium)",
                "Mid-Superior Vena Cava (SVC) position confirmed",
                "Bedside post-procedure portable CXR ordered",
              ]}
            />
          </div>

          {/* Row 3: Tunnel position (2fr) + Flow check (1fr) */}
          <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr", gap: "18px 24px", marginBottom: "18px" }}>
            <FormField
              label="Subcutaneous Tunnel & Dacron Cuff Position"
              name="cath_tunnel_pos"
              type="select"
              options={[
                "Smooth downward chest tunnel; Cuff placed 2 cm inside exit orifice",
                "Non-tunneled temporary catheter (no cuff)",
                "Cuff position verified clear of skin exit",
              ]}
            />
            <FormField
              label="Dual-Lumen Flow Aspiration Check"
              name="cath_flow_check"
              type="select"
              options={[
                "Brisk, free-flowing blood return from both Arterial & Venous ports (>300 mL/min capable)",
                "Sluggish arterial port — catheter rotated 90 degrees",
                "Positional flow verified",
              ]}
            />
          </div>

          {/* Row 4: Arterial lock, Venous lock, Fixation (3 columns) */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "18px 24px" }}>
            <FormField label="Arterial Lumen Heparin Lock" name="cath_art_lock" placeholder="e.g. 1.8 mL (5000 U/mL)" />
            <FormField label="Venous Lumen Heparin Lock" name="cath_ven_lock" placeholder="e.g. 1.9 mL (5000 U/mL)" />
            <FormField
              label="Fixation & Sterile Dressing"
              name="cath_fixation"
              type="select"
              options={["Suture wings anchored with 2-0 Silk + Biopatch + Tegaderm", "Statlock stabilization device + sterile gauze"]}
            />
          </div>
        </Section>
      )}

      {/* 4. Endovascular Interventions (Fistulogram / PTA / Thrombectomy) */}
      {accessCategory === "avf_endovascular" && (
        <Section title="Endovascular Interventions (Fistulogram, PTA & Thrombectomy)" note="Catheter-based access salvage">
          {/* Row 1: Sheath & Contrast (2 columns) */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "18px 24px", marginBottom: "18px" }}>
            <FormField
              label="Access Puncture & Sheath Size"
              name="endo_sheath"
              type="select"
              options={["6 Fr Introducer Sheath (Retrograde)", "6 Fr Introducer Sheath (Antegrade)", "7 Fr Sheath (Thrombectomy)", "Dual Sheaths"]}
            />
            <FormField label="Contrast Agent & Volume (mL)" name="endo_contrast" placeholder="e.g. Isovue 300 (25 mL total)" />
          </div>

          {/* Row 2: Finding (2fr) + Result (1fr) */}
          <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr", gap: "18px 24px", marginBottom: "18px" }}>
            <FormField
              label="Primary Angiographic Finding"
              name="endo_findings"
              type="select"
              options={[
                "Juxta-anastomotic stenosis (>70% luminal narrowing)",
                "Cephalic arch / Outflow swing point stenosis",
                "Central venous stenosis (Subclavian / Brachiocephalic vein)",
                "Complete access thrombosis (Arterial plug + venous clot)",
                "Intra-graft pseudoaneurysm / Venous anastomosis stenosis",
              ]}
            />
            <FormField
              label="Post-PTA Angiographic Result"
              name="endo_post_result"
              type="select"
              options={[
                "Excellent: Full balloon expansion, <15% residual stenosis",
                "Good: <30% residual stenosis achieved",
                "Elastic recoil noted — repeat prolonged inflation performed",
              ]}
            />
          </div>

          {/* Row 3: Balloon size, burst atm, thrombectomy tech (3 columns) */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "18px 24px", marginBottom: "18px" }}>
            <FormField label="Angioplasty Balloon Size" name="endo_balloon_size" placeholder="e.g. 6 mm x 40 mm Conquest" />
            <FormField label="Rated Burst Pressure (atm)" name="endo_burst_atm" placeholder="e.g. 22 atm x 90s" />
            <FormField
              label="Thrombectomy Technique"
              name="endo_thrombectomy_tech"
              type="select"
              options={[
                "N/A — Pure angioplasty / Diagnostic fistulogram",
                "Pharmaco-mechanical: 4 mg r-tPA + Fogarty Balloon",
                "Mechanical Thrombectomy (AngioJet / Rotarex)",
                "Surgical open cutdown & Fogarty balloon",
              ]}
            />
          </div>

          {/* Row 4: Thrill restored */}
          <div>
            <FormField
              label="Post-Procedure Thrill Restored"
              name="endo_thrill_restored"
              type="select"
              options={["Continuous brisk thrill restored completely", "Pulsatile flow without continuous thrill", "Failed declotting"]}
            />
          </div>
        </Section>
      )}

      {/* 5. Post-Procedure Monitoring & Maturation Schedule */}
      <Section title="Post-Procedure Monitoring & Maturation Protocol" note="Follow-up and complication prevention">
        {/* Row 1: Steal syndrome & edema (2 columns balanced 50/50) */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "18px 24px", marginBottom: "18px" }}>
          <FormField
            label="Steal Syndrome Evaluation (Hand Perfusion)"
            name="avf_steal_check"
            type="select"
            options={[
              "Normal: Warm, pink fingers, capillary refill <2s, radial pulse palpable",
              "Mild steal: Cool fingertips, no resting pain or motor deficit",
              "Moderate steal: Cold hand, numbness during dialysis runs",
              "Severe ischemia: Pale, cold, resting pain / blue digits (Urgent revision)",
            ]}
          />
          <FormField
            label="Limb Edema / Venous Hypertension"
            name="avf_edema_check"
            type="select"
            options={["None — normal arm contours", "Mild dependent hand swelling (resolves with elevation)", "Marked extremity swelling (Central vein stenosis suspect)"]}
          />
        </div>

        {/* Row 2: Exercise plan & 6-wk US date (2 columns balanced 50/50) */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "18px 24px", marginBottom: "18px" }}>
          <FormField
            label="Maturation Exercise Protocol"
            name="avf_exercise_plan"
            type="select"
            options={[
              "Soft rubber ball squeezing starting Day 14 post-op (10 mins TID)",
              "Light tourniquet resistance exercise starting Week 3",
              "N/A (Catheter placed)",
            ]}
          />
          <FormField label="6-Week Maturation Doppler Ultrasound Date" name="avf_6wk_us_date" type="date" />
        </div>

        {/* Row 3: Detailed Notes */}
        <div>
          <FormField
            label="Detailed Operative / Interventional Notes"
            name="avf_operative_notes"
            type="textarea"
            placeholder="Document surgical anatomy, vessel handling, heparin administration, flow dynamics, post-procedure pulses, and instruction for hemodialysis unit..."
          />
        </div>
      </Section>
    </div>
  );
};

export default AVFistulaGuide;
