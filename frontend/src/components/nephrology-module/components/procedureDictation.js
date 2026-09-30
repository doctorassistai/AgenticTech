/**
 * procedureDictation.js
 * Comprehensive field dictionary and AI dictation mappings for Nephrology Procedure Notes.
 * Enables Voice Dictation & AI Auto-fill across Common Operative Records, Hemodialysis,
 * Vascular Access (AVF/Permcath), Kidney Transplantation, Renal Biopsy, and PD Catheter Insertion.
 */

export const COMMON_PROCEDURE_DICTATION_FIELDS = [
  { k: "proc_category", label: "procedure category", options: ["hd", "access", "transplant", "interventional"] },
  {
    k: "proc_type",
    label: "procedure type",
    options: [
      "renal_biopsy",
      "hd_maintenance",
      "hd_acute",
      "crrt",
      "pd_catheter",
      "avf_radiocephalic",
      "avf_brachiocephalic",
      "avg_placement",
      "permcath",
      "temp_line",
      "fistulogram",
      "thrombectomy",
      "tx_living",
      "tx_deceased",
      "tx_donor_nephrectomy",
    ],
  },
  { k: "proc_date", label: "date of procedure", type: "date" },
  { k: "proc_time_start", label: "procedure start time", type: "time" },
  { k: "proc_time_end", label: "procedure end time", type: "time" },
  { k: "proc_preop_diag", label: "pre-operative diagnosis" },
  { k: "proc_postop_diag", label: "post-operative diagnosis" },
  { k: "proc_indication", label: "clinical indication reason for procedure" },
  { k: "proc_consent", label: "informed consent obtained", options: ["Yes", "No"] },
  { k: "proc_risk_disc", label: "risk benefit discussion documented", options: ["Yes", "No"] },
  { k: "proc_operator", label: "performing physician operator name" },
  { k: "proc_qualification", label: "operator qualification specialty" },
  { k: "proc_assisting_staff", label: "assisting staff scrub nurses" },
  { k: "proc_anaesthesia", label: "anaesthesia type", options: ["Local Anaesthesia", "Conscious Sedation", "Regional Block / Brachial Plexus", "General Anaesthesia", "None"] },
  { k: "proc_side", label: "side laterality", options: ["Left", "Right", "Bilateral", "Midline", "N/A"] },
  { k: "proc_position", label: "patient position", options: ["Supine", "Prone (Native Biopsy)", "Semi-Fowler", "Left Lateral Decubitus", "Right Lateral Decubitus"] },
  { k: "proc_pain_score", label: "pre-procedure pain score 0 to 10" },
  { k: "proc_ramsay_score", label: "sedation level ramsay score", options: ["Level 1: Anxious / Restless", "Level 2: Cooperative / Oriented / Tranquil", "Level 3: Responds to commands only", "Level 4: Brisk response to light touch", "Level 5: Sluggish response to light touch", "Level 6: No response"] },
  { k: "proc_post_pain", label: "post-procedure pain score 0 to 10" },
  { k: "proc_recovery_status", label: "immediate recovery status", options: ["Stable & Alert — Vitals within normal limits", "Under Active Observation", "Hemodynamically Unstable — Resuscitation Active"] },
  { k: "proc_disposition", label: "patient disposition", options: ["Discharged Home (Outpatient procedure)", "Transferred to Hemodialysis Unit", "Transferred to Inpatient Nephrology Ward", "Transferred to Post-Anesthesia Care Unit (PACU)", "Transferred to Intensive Care Unit (ICU)"] },
  { k: "proc_complications", label: "procedural complications", options: ["None — Procedure completed without complications", "Minor bleeding controlled with pressure", "Hematoma at puncture/incision site", "Transient hypotension responding to fluid bolus", "Arrhythmia / vasovagal episode", "Vessel spasm resolved with vasodilator", "Other (documented in notes)"] },
  { k: "proc_post_orders", label: "post procedure orders and wound instructions" },
  { k: "proc_signoff_name", label: "physician digital sign off operator name" },
  { k: "proc_signoff_datetime", label: "physician digital sign-off date and time" },
];

export const HD_PROCEDURE_DICTATION_FIELDS = [
  { k: "hd_machine_id", label: "hemodialysis machine id station" },
  { k: "hd_membrane_area", label: "dialyzer membrane surface area" },
  { k: "hd_access_used", label: "vascular access used for dialysis", options: ["Arteriovenous Fistula (AVF)", "Arteriovenous Graft (AVG)", "Tunneled CVC (Permcath)", "Temporary Non-Tunneled CVC (IJ / Femoral)"] },
  { k: "hd_needle_gauge", label: "fistula needle gauge", options: ["15 Gauge (Standard Qb 350-450)", "16 Gauge (Qb 300-350)", "17 Gauge (Qb 250-300 / New Fistula)", "14 Gauge (Qb >450 mL/min)"] },
  { k: "hd_duration_hours", label: "dialysis session duration hours" },
  { k: "hd_pre_weight", label: "pre-session patient weight kg" },
  { k: "hd_dry_weight", label: "target dry weight kg" },
  { k: "hd_target_uf", label: "target ultrafiltration liters" },
  { k: "hd_qb", label: "prescribed blood flow rate Qb mL per min" },
  { k: "hd_qd", label: "prescribed dialysate flow rate Qd mL per min" },
  { k: "hd_k_bath", label: "potassium K+ bath", options: ["2.0 mEq/L (Standard maintenance)", "1.0 mEq/L (Severe hyperkalemia)", "3.0 mEq/L (Hypokalemia prone / Digoxin)", "4.0 mEq/L"] },
  { k: "hd_ca_bath", label: "calcium Ca2+ bath", options: ["2.5 mEq/L (Standard 1.25 mmol/L)", "3.0 mEq/L (High calcium bath)", "2.0 mEq/L (Low calcium for hypercalcemia)"] },
  { k: "hd_na_bath", label: "dialysate sodium concentration" },
  { k: "hd_heparin", label: "anticoagulation heparin protocol", options: ["Standard Unfractionated Heparin", "Low-Dose Heparin", "Heparin-Free (Saline Flushes q30m)", "Citrate Anticoagulation (CRRT/RCA)", "Enoxaparin / LMWH"] },
  { k: "hd_pre_bp", label: "pre-dialysis blood pressure" },
  { k: "hd_post_bp", label: "post-dialysis blood pressure" },
  { k: "hd_post_weight", label: "post-session patient weight kg" },
  { k: "hd_total_uf_removed", label: "total ultrafiltration volume removed liters" },
  { k: "hd_delivered_ktv", label: "single pool delivered Kt/V adequacy" },
  { k: "hd_delivered_urr", label: "urea reduction ratio URR percentage" },
  { k: "hd_adverse_events", label: "adverse events during dialysis", options: ["None — Uneventful Treatment", "Intradialytic Hypotension (IDH)", "Muscle Cramps", "Access Bleeding / Cannulation Hematoma", "Chest Pain / Dyspnea", "Nausea / Vomiting / Dialyzer Reaction"] },
];

export const ACCESS_PROCEDURE_DICTATION_FIELDS = [
  { k: "avf_sub_procedure", label: "vascular access procedure category", options: ["avf_surgical", "permcath_tunneled", "temporary_line", "endo_interventions"] },
  { k: "avf_vein_diam", label: "vein diameter caliber mm" },
  { k: "avf_artery_diam", label: "artery diameter mm" },
  { k: "avf_anast_type", label: "anastomosis configuration", options: ["End-to-Side (Arteriovenous)", "Side-to-Side (Spangler / Brescia)", "End-to-End"] },
  { k: "avf_thrill_bruit", label: "on-table thrill and bruit", options: ["Strong continuous thrill & bruit present", "Moderate thrill, pulsatile bruit", "Weak thrill / Vasospasm present", "Absent thrill (Immediate surgical revision / Heparin flush)"] },
  { k: "avf_heparin_dose", label: "systemic heparinization units" },
  { k: "avf_artery_clamp", label: "arterial clamp time minutes" },
  { k: "avf_vein_clamp", label: "venous clamp time minutes" },
  { k: "avf_blood_loss", label: "estimated blood loss mL" },
  { k: "avf_catheter_type", label: "permcath catheter model and length" },
  { k: "avf_puncture_vein", label: "permcath insertion puncture vein", options: ["Right Internal Jugular (Preferred)", "Left Internal Jugular", "Right Subclavian", "Right Femoral (Bridging)", "Left Femoral"] },
  { k: "avf_tip_position", label: "catheter tip position under fluoroscopy", options: ["Cavoatrial Junction (CAJ)", "Mid Right Atrium (Optimal for flow)", "Superior Vena Cava (SVC)"] },
  { k: "avf_aspirate_flow", label: "catheter blood aspiration test", options: ["Brisk pulsatile blood flow (20mL in <3 seconds without resistance)", "Sluggish flow (Repositioned / Rotated)", "Poor flow (Thrombus suspected)"] },
];

export const TX_PROCEDURE_DICTATION_FIELDS = [
  { k: "tx_recipient_bg", label: "recipient blood group", options: ["O Positive", "A Positive", "B Positive", "AB Positive", "O Negative", "A Negative", "B Negative", "AB Negative"] },
  { k: "tx_donor_bg", label: "donor blood group", options: ["O Positive", "A Positive", "B Positive", "AB Positive", "O Negative", "A Negative", "B Negative", "AB Negative"] },
  { k: "tx_abo_compat", label: "ABO compatibility status", options: ["ABO Compatible", "ABO Incompatible (Desensitized: Plasmapheresis + Rituximab + IVIG)", "Paired Kidney Exchange Match"] },
  { k: "tx_donor_source", label: "donor source and type", options: ["Living Related Donor (First-degree: Sibling / Parent / Offspring)", "Living Spousal / Unrelated Donor", "Deceased Donor — Brain Death (DBD / Standard Criteria)", "Deceased Donor — Circulatory Death (DCD)", "Expanded Criteria Deceased Donor (ECD)"] },
  { k: "tx_hla_match", label: "HLA match score", options: ["6/6 Antigen Match (Full HLA Identity)", "5/6 Antigen Match", "4/6 Antigen Match", "3/6 Antigen Match", "Haploidentical (2/6 or 3/6)", "0/6 Mismatch (Deceased zero-mismatch)"] },
  { k: "tx_pra_level", label: "calculated PRA cPRA percent" },
  { k: "tx_cdc_crossmatch", label: "CDC crossmatch status", options: ["Negative (Safe to proceed)", "Positive T-Cell (Contraindicated / Hyperacute risk)", "Positive B-Cell (Permissible with enhanced immunosuppression)"] },
  { k: "tx_crossmatch_result", label: "crossmatch result", options: ["Negative (CDC & Flow Cytometry)", "CDC Negative / Flow Cytometry Weak Positive", "Positive (Desensitization Protocol Active)"] },
  { k: "tx_dsa_status", label: "donor specific antibodies DSA", options: ["DSA Negative (MFI <1000)", "Low-titer DSA present (MFI 1000-3000)", "High-titer DSA (Desensitization active)"] },
  { k: "tx_cmv_status", label: "CMV serostatus pairing", options: ["D+ / R- (High Risk — 6-month Valganciclovir prophylaxis)", "D+ / R+ (Moderate Risk — 3-month prophylaxis)", "D- / R+ (Moderate Risk)", "D- / R- (Low Risk — No active prophylaxis required)"] },
  { k: "tx_ebv_bkv_status", label: "EBV and BK virus status", options: ["D+ / R+ (Standard)", "D+ / R- (High risk for PTLD)", "D- / R-", "Negative BKV viremia"] },
  { k: "tx_implant_site", label: "surgical incision and approach", options: ["Right Lower Quadrant — Modified Gibson Incision (Extraperitoneal — Standard)", "Left Lower Quadrant — Modified Gibson Incision (Extraperitoneal)", "Midline Transperitoneal (En-bloc pediatric donor / Repeat transplant)"] },
  { k: "tx_vessel_count", label: "donor renal vessels anatomy" },
  { k: "tx_venous_anast", label: "venous anastomosis technique", options: ["Renal Vein End-to-Side to External Iliac Vein (5-0 Prolene continuous)", "Renal Vein with extension graft (Gonadal/Iliac) to External Iliac Vein", "Renal Vein to Common Iliac Vein (Deep pelvis / complex anatomy)"] },
  { k: "tx_venous_clamp_time", label: "venous clamp time minutes" },
  { k: "tx_arterial_anast", label: "arterial anastomosis technique", options: ["Renal Artery End-to-Side to External Iliac Artery (6-0 Prolene continuous)", "Carrel Aortic Patch to External Iliac Artery (Deceased donor)", "Renal Artery End-to-End to Internal Iliac / Hypogastric Artery", "Dual Renal Arteries: Pantaloons reconstruction to External Iliac"] },
  { k: "tx_arterial_clamp_time", label: "arterial clamp time minutes" },
  { k: "tx_cit", label: "cold ischemia time hours" },
  { k: "tx_wit", label: "warm ischemia time minutes" },
  { k: "tx_anast_wit", label: "anastomosis second warm ischemia rewarming minutes" },
  { k: "tx_preservation_fluid", label: "organ preservation fluid solution", options: ["University of Wisconsin (UW)", "Custodiol HTK Solution", "Perfadex / Celsior", "LifePort Machine Perfusion"] },
  { k: "tx_reperfusion_eval", label: "allograft re-perfusion assessment", options: ["Excellent: Immediate uniform pink blush, excellent parenchymal turgor, robust pulsation", "Good: Adequate re-perfusion, mild patchy areas clearing in 5 mins", "Sluggish re-perfusion / Vasospasm (Papaverine / Verapamil applied)", "Mottled / Soft / Dark graft (Urgent vascular interrogation)"] },
  { k: "tx_zero_hour_bx", label: "baseline zero hour biopsy", options: ["Needle core biopsy performed 30 mins post-reperfusion (No hematoma)", "Wedge biopsy performed at lower pole", "Not performed"] },
  { k: "tx_ureter_tech", label: "ureteric implantation technique", options: ["Lich-Gregoir Extravesical Ureteroneocystostomy (Standard non-refluxing)", "Leadbetter-Politano Intravesical Implantation", "Ureteroureterostomy (To native ipsilateral ureter)"] },
  { k: "tx_dj_stent", label: "internal ureteric stent double-j", options: ["6 Fr, 12 cm Double-J Stent placed across anastomosis into bladder", "6 Fr, 16 cm Double-J Stent placed", "No stent placed (Direct anastomosis)"] },
  { k: "tx_ureter_stent", label: "ureteric stent Double J", options: ["Double-J (DJ) Ureteric Stent in situ (4.7 Fr x 12-16cm)", "Stentless ureteroneocystostomy", "Single J / Externalized stent"] },
  { k: "tx_ureter_suture", label: "anastomosis suture material", options: ["5-0 PDS continuous suture with spatulated mucosal spit", "5-0 Monocryl interrupted", "4-0 Vicryl"] },
  { k: "tx_intraop_diuretics", label: "intra-operative diuretics given", options: ["Mannitol 20% 125 mL + Furosemide 100 mg IV prior to unclamping", "Furosemide 250 mg IV push", "Mannitol only", "None given"] },
  { k: "tx_stent_remove_date", label: "ureteric stent removal target date" },
  { k: "tx_urine_on_declamp", label: "intra-operative urine output on declamping", options: ["Immediate robust clear urine output (>300 mL on operating table)", "Delayed Graft Function / Oliguric (<50 mL on table)", "Anuria (Hydration and diuretics titrated)"] },
  { k: "tx_urine_output", label: "on-table initial urine output", options: ["Immediate brisk diuresis (>100 mL within 30 mins)", "Moderate diuresis (20-100 mL)", "Minimal urine (<20 mL / Oliguric)", "Anuria on table (Furosemide / Mannitol administered)"] },
  { k: "tx_induction", label: "induction immunosuppression", options: ["Basiliximab (Simulect) 20 mg IV Day 0 (Standard risk)", "rATG (Thymoglobulin) 1.5 mg/kg IV started on table (High immunological risk)", "Alemtuzumab (Campath) 30 mg IV single dose", "Methylprednisolone 500 mg IV given intra-operatively"] },
  { k: "tx_drain", label: "perinephric surgical drain", options: ["19 Fr Round Jackson-Pratt (JP) closed suction drain placed in pelvic space", "Blake 19 Fr silicone drain placed", "No drain placed"] },
  { k: "tx_wall_closure", label: "abdominal wall closure", options: ["Mass closure with continuous #1 PDS loop + Subcutaneous 2-0 Vicryl + Skin staples", "Layered closure: Internal oblique #0 PDS + External oblique #0 PDS + Subcuticular 4-0 Monocryl"] },
  { k: "tx_ebl", label: "estimated blood loss mL" },
  { k: "tx_tacro_target", label: "target tacrolimus trough level month 1" },
  { k: "tx_post_cr", label: "baseline immediate post-op creatinine target" },
  { k: "tx_surgical_notes", label: "detailed operative surgical summary" },
];

export const BIOPSY_PROCEDURE_DICTATION_FIELDS = [
  { k: "bx_site", label: "target biopsy site", options: ["Native Left Kidney — Lower Pole (Standard)", "Native Right Kidney — Lower Pole", "Transplant Allograft — Upper Pole (Cortex)", "Transplant Allograft — Lower Pole"] },
  { k: "bx_us_guided", label: "real-time ultrasound guidance", options: ["Real-time US visualization (Continuous needle tracking)", "US marking with blind puncture", "CT-guided percutaneous biopsy"] },
  { k: "bx_needle_gauge", label: "biopsy needle gauge", options: ["16 Gauge (Standard automated core)", "18 Gauge (Fine automated needle)", "14 Gauge (Surgical core)"] },
  { k: "bx_passes_total", label: "total number of core passes" },
  { k: "bx_cores_lm", label: "number of cores for light microscopy formalin" },
  { k: "bx_cores_if", label: "number of cores for immunofluorescence Michels Zeus" },
  { k: "bx_cores_em", label: "number of cores for electron microscopy glutaraldehyde" },
  { k: "bx_path_prelim", label: "preliminary stereo adequacy check", options: ["Adequate: >10 glomeruli identified on dissecting stereomicroscope", "Suboptimal: 5-10 glomeruli identified", "Inadequate: Medulla only / <5 glomeruli (Additional pass required)"] },
  { k: "bx_us_post_eval", label: "post procedure ultrasound hematoma check", options: ["Normal: No perinephric hematoma or subcapsular collection", "Small subcapsular hematoma (<1 cm) — Clinically stable", "Moderate hematoma (1-3 cm) — Close hemodynamic observation", "Active extravasation / Arteriovenous fistula (Urgent intervention)"] },
];

export const PD_PROCEDURE_DICTATION_FIELDS = [
  { k: "pd_proc_approach", label: "pd catheter insertion approach", options: ["Laparoscopic insertion with rectus sheath tunneling & omentopexy (Preferred)", "Open surgical mini-laparotomy", "Percutaneous Seldinger technique with fluoroscopy", "Peritoneoscopic insertion under local anesthesia"] },
  { k: "pd_exit_site", label: "exit site location", options: ["Left Lower Quadrant (Below beltline — Standard)", "Right Lower Quadrant (Below beltline)", "Upper Abdomen (Above beltline)", "Presternal exit site (Swan-neck extension)"] },
  { k: "pd_deep_cuff", label: "deep cuff position", options: ["Within rectus muscle / posterior rectus sheath (Optimal)", "Pre-peritoneal space", "Subcutaneous layer (Suboptimal — Risk of leak)"] },
  { k: "pd_fluid_in", label: "trial infusion dialysate volume mL" },
  { k: "pd_fluid_out", label: "trial drainage volume mL" },
  { k: "pd_break_in", label: "break-in healing schedule", options: ["Strict 2-week break-in healing schedule (No dwell, heparin flushes weekly)", "Urgent-start PD (Low volume supine APD started within 48-72h)", "Delayed initiation (>4 weeks post-placement)"] },
];

/**
 * Accurately detects primary nephrology procedure from dictation or transcript text
 */
export function detectProcedureFromText(text = "") {
  if (!text || typeof text !== "string") return null;
  const t = text.toLowerCase();

  // 1. Renal Biopsy (even if performed on an allograft, unless it is a zero-hour transplant biopsy)
  const isZeroHourTx = t.includes("zero-hour") || t.includes("zero hour") || t.includes("baseline biopsy") || t.includes("kidney transplant") || t.includes("allograft implantation");
  const isBiopsy = !isZeroHourTx &&
                   (t.includes("biopsy") || t.includes("bx")) && 
                   (t.includes("renal biopsy") || t.includes("kidney biopsy") || t.includes("core") || t.includes("passes") || t.includes("glomeruli") || t.includes("lower pole") || t.includes("16 gauge") || t.includes("16-gauge"));
  if (isBiopsy) {
    return { category: "interventional", procType: "renal_biopsy" };
  }

  // 2. Kidney Transplantation Operative Suite
  const hasTxExplicit = t.includes("kidney transplant") || 
                        t.includes("renal transplant") || 
                        t.includes("kidney transplantation") || 
                        t.includes("transplantation operative") || 
                        t.includes("allograft implantation") || 
                        t.includes("living related kidney") || 
                        t.includes("deceased donor kidney") ||
                        t.includes("donor nephrectomy");

  const hasTxSurgicalMarkers = (t.includes("allograft") || t.includes("transplant")) && 
                               (t.includes("ischemia time") || t.includes("ureteroneocystostomy") || t.includes("lich-gregoir") || t.includes("reperfusion") || t.includes("gibson"));

  if (hasTxExplicit || hasTxSurgicalMarkers) {
    if (t.includes("donor nephrectomy") || t.includes("nephrectomy")) {
      return { category: "transplant", procType: "tx_donor_nephrectomy" };
    }
    if (t.includes("deceased") || t.includes("ddkt") || t.includes("brain death") || t.includes("dcd") || t.includes("dbd")) {
      return { category: "transplant", procType: "tx_deceased" };
    }
    return { category: "transplant", procType: "tx_living" };
  }

  // 3. Peritoneal Dialysis Catheter
  if (t.includes("pd catheter") || t.includes("peritoneal dialysis catheter") || t.includes("tenckhoff") || t.includes("pd_catheter")) {
    return { category: "hd", procType: "pd_catheter" };
  }

  // 4. CRRT / SLED
  if (t.includes("crrt") || t.includes("continuous renal") || t.includes("cvvh") || t.includes("sled")) {
    return { category: "hd", procType: "crrt" };
  }

  // 5. Acute Hemodialysis
  if (t.includes("acute hemodialysis") || t.includes("acute hd") || t.includes("hd_acute") || t.includes("inpatient hemodialysis")) {
    return { category: "hd", procType: "hd_acute" };
  }

  // 6. Chronic Maintenance Hemodialysis
  if (t.includes("maintenance hemodialysis") || t.includes("chronic hemodialysis") || t.includes("dialysis run") || t.includes("hd_maintenance") || t.includes("hemodialysis session") || t.includes("hemodialysis treatment") || t.includes("hemodialysis procedure") || t.includes("hemodialysis & extracorporeal") || t.includes("hemodialysis")) {
    return { category: "hd", procType: "hd_maintenance" };
  }

  // 7. Vascular Access Interventions: Fistulogram / Angioplasty / Thrombectomy
  if (t.includes("fistulogram") || t.includes("angioplasty") || t.includes("balloon dilatation") || t.includes("pta")) {
    return { category: "access", procType: "fistulogram" };
  }
  if (t.includes("thrombectomy") || t.includes("embolectomy") || t.includes("declot")) {
    return { category: "access", procType: "thrombectomy" };
  }

  // 8. Vascular Access Catheters: Permcath / Temporary line
  if (t.includes("permcath") || t.includes("tunneled hemodialysis") || t.includes("cuffed catheter") || t.includes("tunneled catheter") || t.includes("tunneled cvc")) {
    return { category: "access", procType: "permcath" };
  }
  if (t.includes("temp_line") || t.includes("temporary line") || t.includes("temporary catheter") || t.includes("vascath") || t.includes("dual-lumen") || t.includes("non-tunneled cvc")) {
    return { category: "access", procType: "temp_line" };
  }

  // 9. Vascular Access: AV Graft (Must exclude allograft!)
  if ((t.includes("graft") && !t.includes("allograft")) || t.includes("avg") || t.includes("ptfe") || t.includes("loop graft") || t.includes("av graft")) {
    return { category: "access", procType: "avg_placement" };
  }

  // 10. Vascular Access: AV Fistula Creation
  if (t.includes("brachiocephalic") || t.includes("brachiobasilic") || t.includes("upper arm fistula")) {
    return { category: "access", procType: "avf_brachiocephalic" };
  }
  if (t.includes("radiocephalic") || t.includes("brescia") || t.includes("avf creation") || t.includes("fistula creation") || t.includes("arteriovenous fistula")) {
    return { category: "access", procType: "avf_radiocephalic" };
  }

  return null;
}

/**
 * Normalizes free-text or speech transcript input into valid category & procType slugs
 */
export function resolveProcedureCategoryAndType(rawCat, rawType, text = "") {
  // 1. Prioritize text detection
  const detected = detectProcedureFromText(text);
  if (detected) return detected;

  // 2. If text was empty or had no markers, check explicit rawType slug
  if (rawType) {
    if (rawType.startsWith("tx_")) return { category: "transplant", procType: rawType };
    if (rawType === "renal_biopsy") return { category: "interventional", procType: "renal_biopsy" };
    if (rawType === "pd_catheter" || rawType === "crrt" || rawType.startsWith("hd_")) return { category: "hd", procType: rawType };
    if (rawType.startsWith("avf_") || rawType === "avg_placement" || rawType === "permcath" || rawType === "temp_line" || rawType === "fistulogram" || rawType === "thrombectomy") {
      return { category: "access", procType: rawType };
    }
  }

  // 3. Fallback based on rawCat
  if (rawCat === "transplant") return { category: "transplant", procType: "tx_living" };
  if (rawCat === "interventional") return { category: "interventional", procType: "renal_biopsy" };
  if (rawCat === "access") return { category: "access", procType: "avf_radiocephalic" };
  if (rawCat === "hd") return { category: "hd", procType: "hd_maintenance" };

  return { category: "hd", procType: "hd_maintenance" };
}

/**
 * Returns field descriptors dynamically based on active category and procedure type
 */
export const procedureFieldsFor = (category, procType, text = "") => {
  const resolved = resolveProcedureCategoryAndType(category, procType, text);
  const activeCat = resolved.category || category;
  const activeType = resolved.procType || procType;

  let specificFields = [];

  if (activeCat === "transplant" || activeType?.startsWith("tx")) {
    specificFields = TX_PROCEDURE_DICTATION_FIELDS;
  } else if (activeType === "pd_catheter") {
    specificFields = PD_PROCEDURE_DICTATION_FIELDS;
  } else if (activeCat === "interventional" || activeType === "renal_biopsy") {
    specificFields = BIOPSY_PROCEDURE_DICTATION_FIELDS;
  } else if (activeCat === "hd" || activeType?.startsWith("hd") || activeType === "crrt") {
    specificFields = HD_PROCEDURE_DICTATION_FIELDS;
  } else if (
    activeCat === "access" ||
    activeType?.startsWith("avf") ||
    activeType?.startsWith("avg") ||
    activeType?.includes("cath") ||
    activeType === "temp_line" ||
    activeType === "fistulogram" ||
    activeType === "thrombectomy"
  ) {
    specificFields = ACCESS_PROCEDURE_DICTATION_FIELDS;
  }

  return [...COMMON_PROCEDURE_DICTATION_FIELDS, ...specificFields];
};

/**
 * Smart instant local rule-based extractor for Nephrology Procedure Notes
 */
export function extractNephrologyLocalDictation(text) {
  if (!text || typeof text !== "string") return {};
  const t = text.toLowerCase();
  const extracted = {};

  // Step 1: Detect exact procedure category & type
  const detected = detectProcedureFromText(text) || { category: "hd", procType: "hd_maintenance" };
  extracted.proc_category = detected.category;
  extracted.proc_type = detected.procType;

  // Step 2: Common Universal Fields
  const dateMatch = t.match(/(?:procedure\s*date|date(?:\s*of\s*procedure)?)\s*(?:is|of|:)?\s*(\d{4}-\d{2}-\d{2})/i) ||
                    t.match(/(\d{4}-\d{2}-\d{2})/);
  if (dateMatch) extracted.proc_date = dateMatch[1];

  const startTimeMatch = t.match(/start\s*time\s*(?:is|at|:)?\s*(\d{1,2}:\d{2})/i);
  if (startTimeMatch) extracted.proc_time_start = startTimeMatch[1];

  const endTimeMatch = t.match(/end\s*time\s*(?:is|at|:)?\s*(\d{1,2}:\d{2})/i);
  if (endTimeMatch) extracted.proc_time_end = endTimeMatch[1];

  const opMatch = text.match(/(?:operator|surgeon|physician|performed by)\s*(?:is|was|:)?\s*(Dr\.?\s+[A-Za-z\s]+|[A-Za-z\s]+?)(?:,|\band\b|\n|(?<=\w\w)\.|$)/i);
  if (opMatch) extracted.proc_operator = opMatch[1].trim().replace(/,\s*$/, "");

  const signoffMatch = text.match(/(?:digital\s*sign-?off|sign-?off)\s*(?:by|:)?\s*(Dr\.?\s+[A-Z][a-zA-Z.\s]+?)(?=\.\s+[A-Z]|\.$|\n|$)/i);
  if (signoffMatch) extracted.proc_signoff_name = signoffMatch[1].trim().replace(/,\s*$/, "");

  const preopMatch = text.match(/pre-?operative\s*diagnosis\s*(?:is|was|:)?\s*([^.]+?)(?:\.\s*Post|\.\s*Indication|\.\s*Performing|\.|$)/i);
  if (preopMatch) extracted.proc_preop_diag = preopMatch[1].trim();

  const postopMatch = text.match(/post-?operative\s*diagnosis\s*(?:is|was|:)?\s*([^.]+?)(?:\.\s*Indication|\.\s*Performing|\.\s*Donor|\.|$)/i);
  if (postopMatch) extracted.proc_postop_diag = postopMatch[1].trim();

  const indMatch = text.match(/indication\s*(?:is|was|:)?\s*([^.]+?)(?:\.\s*Performing|\.\s*Informed|\.\s*Patient|\.|$)/i);
  if (indMatch) extracted.proc_indication = indMatch[1].trim();

  if (t.includes("general anaesthesia") || t.includes("general anesthesia")) {
    extracted.proc_anaesthesia = "General Anaesthesia";
  } else if (t.includes("regional block") || t.includes("brachial plexus")) {
    extracted.proc_anaesthesia = "Regional Block / Brachial Plexus";
  } else if (t.includes("local anaesthesia") || t.includes("local anesthesia") || (t.includes("local") && t.includes("lidocaine"))) {
    extracted.proc_anaesthesia = "Local Anaesthesia";
  } else if (t.includes("conscious sedation") || t.includes("midazolam")) {
    extracted.proc_anaesthesia = "Conscious Sedation";
  }

  if (t.includes("right iliac") || t.includes("right forearm") || t.includes("right kidney") || t.includes("laterality is right") || t.includes("side is right") || t.includes("right lower quadrant")) {
    extracted.proc_side = "Right";
  } else if (t.includes("left forearm") || t.includes("left kidney") || t.includes("laterality is left") || t.includes("side is left") || t.includes("left iliac")) {
    extracted.proc_side = "Left";
  }

  if (t.includes("prone")) {
    extracted.proc_position = "Prone (Native Biopsy)";
  } else if (t.includes("supine")) {
    extracted.proc_position = "Supine";
  }

  if (t.includes("consent") && (t.includes("obtained") || t.includes("signed") || t.includes("verified"))) {
    extracted.proc_consent = "Yes";
    extracted.chk_consent = true;
  }
  if (t.includes("time-out") || t.includes("timeout") || t.includes("time out")) {
    extracted.chk_timeout = true;
  }
  extracted.chk_id = true;

  if (t.includes("stable and alert") || t.includes("stable & alert") || t.includes("vitals within normal limits")) {
    extracted.proc_recovery_status = "Stable & Alert — Vitals within normal limits";
  }
  if (t.includes("transferred to intensive care unit") || t.includes("icu")) {
    extracted.proc_disposition = "Transferred to Intensive Care Unit (ICU)";
  } else if (t.includes("inpatient nephrology ward") || t.includes("ward")) {
    extracted.proc_disposition = "Transferred to Inpatient Nephrology Ward";
  } else if (t.includes("discharged home")) {
    extracted.proc_disposition = "Discharged Home (Outpatient procedure)";
  }

  if (t.includes("complications: none") || t.includes("without complications") || t.includes("complications encountered: none")) {
    extracted.proc_complications = "None — Procedure completed without complications";
  }

  // Step 3: Procedure-Specific Fields
  if (detected.category === "transplant") {
    if (t.includes("living related")) {
      extracted.tx_donor_source = "Living Related Donor (First-degree: Sibling / Parent / Offspring)";
    } else if (t.includes("deceased")) {
      extracted.tx_donor_source = "Deceased Donor — Brain Death (DBD / Standard Criteria)";
    } else if (t.includes("spousal") || t.includes("unrelated")) {
      extracted.tx_donor_source = "Living Spousal / Unrelated Donor";
    }

    if (t.includes("4 of 6") || t.includes("4/6")) extracted.tx_hla_match = "4/6 Antigen Match";
    else if (t.includes("5 of 6") || t.includes("5/6")) extracted.tx_hla_match = "5/6 Antigen Match";
    else if (t.includes("6 of 6") || t.includes("6/6")) extracted.tx_hla_match = "6/6 Antigen Match (Full HLA Identity)";

    if (t.includes("crossmatch") && (t.includes("negative") || t.includes("cdc negative"))) {
      extracted.tx_crossmatch_result = "Negative (CDC & Flow Cytometry)";
      extracted.tx_cdc_crossmatch = "Negative (Safe to proceed)";
    }
    if (t.includes("abo compatible")) extracted.tx_abo_compat = "ABO Compatible";

    const citMatch = t.match(/cold\s*ischemia\s*time\s*(?:was|is|of|:)?\s*(\d+)\s*(?:minutes|mins)/i);
    if (citMatch) extracted.tx_cit = (parseInt(citMatch[1], 10) / 60).toFixed(2);

    const witMatch = t.match(/warm\s*(?:anastomosis\s*)?ischemia\s*time\s*(?:was|is|of|:)?\s*(\d+)\s*(?:minutes|mins)/i);
    if (witMatch) extracted.tx_wit = witMatch[1];

    if (t.includes("gibson")) {
      extracted.tx_implant_site = "Right Lower Quadrant — Modified Gibson Incision (Extraperitoneal — Standard)";
    }
    if (t.includes("pink blush") || t.includes("robust pulsation") || t.includes("immediate uniform pink blush") || t.includes("pink coloration")) {
      extracted.tx_reperfusion_eval = "Excellent: Immediate uniform pink blush, excellent parenchymal turgor, robust pulsation";
    }
    if (t.includes("diuresis") || t.includes("urine produced") || t.includes("urine output")) {
      extracted.tx_urine_output = "Immediate brisk diuresis (>100 mL within 30 mins)";
      extracted.tx_urine_on_declamp = "Immediate robust clear urine output (>300 mL on operating table)";
    }
    if (t.includes("double-j") || t.includes("dj stent") || t.includes("double j") || t.includes("stent")) {
      extracted.tx_ureter_stent = "Double-J (DJ) Ureteric Stent in situ (4.7 Fr x 12-16cm)";
      extracted.tx_dj_stent = "6 Fr, 12 cm Double-J Stent placed across anastomosis into bladder";
    }
    if (t.includes("external iliac vein")) {
      extracted.tx_venous_anast = "Renal Vein End-to-Side to External Iliac Vein (5-0 Prolene continuous)";
    }
    if (t.includes("external iliac artery")) {
      extracted.tx_arterial_anast = "Renal Artery End-to-Side to External Iliac Artery (6-0 Prolene continuous)";
    }
    if (t.includes("lich-gregoir") || t.includes("extravesical")) {
      extracted.tx_ureter_tech = "Lich-Gregoir Extravesical Ureteroneocystostomy (Standard non-refluxing)";
    }
    if (t.includes("basiliximab") || t.includes("simulect")) {
      extracted.tx_induction = "Basiliximab (Simulect) 20 mg IV Day 0 (Standard risk)";
    } else if (t.includes("ratg") || t.includes("thymoglobulin")) {
      extracted.tx_induction = "rATG (Thymoglobulin) 1.5 mg/kg IV started on table (High immunological risk)";
    }
    if (t.includes("drain") || t.includes("jackson-pratt") || t.includes("jp drain")) {
      extracted.tx_drain = "19 Fr Round Jackson-Pratt (JP) closed suction drain placed in pelvic space";
    }
    if (t.includes("mass closure") || t.includes("pds loop") || t.includes("closure")) {
      extracted.tx_wall_closure = "Mass closure with continuous #1 PDS loop + Subcutaneous 2-0 Vicryl + Skin staples";
    }
    const eblMatch = t.match(/(?:blood\s*loss|ebl)\s*(?:was|is|of|:)?\s*(\d+)\s*(?:ml|cc)?/i);
    if (eblMatch) extracted.tx_ebl = `${eblMatch[1]} mL`;
    if (t.includes("zero-hour biopsy") || t.includes("zero hour biopsy") || t.includes("baseline biopsy") || t.includes("zero-hour") || t.includes("zero hour")) {
      if (t.includes("wedge")) {
        extracted.tx_zero_hour_bx = "Wedge biopsy performed at lower pole";
      } else if (t.includes("not performed") || t.includes("no biopsy")) {
        extracted.tx_zero_hour_bx = "Not performed";
      } else {
        extracted.tx_zero_hour_bx = "Needle core biopsy performed 30 mins post-reperfusion (No hematoma)";
      }
    }
    if (t.includes("tacrolimus") || t.includes("tacro")) {
      extracted.tx_tacro_target = "8-10 ng/mL (Months 1-3)";
    }
  } else if (detected.category === "interventional") {
    if (t.includes("native left")) extracted.bx_site = "Native Left Kidney — Lower Pole (Standard)";
    else if (t.includes("native right")) extracted.bx_site = "Native Right Kidney — Lower Pole";
    else if (t.includes("transplant") || t.includes("allograft")) extracted.bx_site = "Transplant Allograft — Upper Pole (Cortex)";

    if (t.includes("16-gauge") || t.includes("16 gauge")) extracted.bx_needle_gauge = "16 Gauge (Standard automated core)";
    else if (t.includes("18-gauge") || t.includes("18 gauge")) extracted.bx_needle_gauge = "18 Gauge (Fine automated needle)";

    const passesMatch = t.match(/(\d+)\s*passes/i);
    if (passesMatch) extracted.bx_passes_total = passesMatch[1];

    if (t.includes(">10 glomeruli") || t.includes("15 glomeruli") || t.includes("adequate")) {
      extracted.bx_path_prelim = "Adequate: >10 glomeruli identified on dissecting stereomicroscope";
    }
    if (t.includes("no hematoma") || t.includes("no perinephric hematoma")) {
      extracted.bx_us_post_eval = "Normal: No perinephric hematoma or subcapsular collection";
    }
  } else if (detected.category === "access") {
    const veinMatch = t.match(/cephalic\s*vein\s*(?:diameter\s*)?(?:is|of|:)?\s*(\d+(?:\.\d+)?)\s*mm/i);
    if (veinMatch) extracted.avf_vein_diam = veinMatch[1];
    const artMatch = t.match(/radial\s*artery\s*(?:diameter\s*)?(?:is|of|:)?\s*(\d+(?:\.\d+)?)\s*mm/i);
    if (artMatch) extracted.avf_artery_diam = artMatch[1];
    const clampMatch = t.match(/clamp\s*time\s*(?:was|is|of|:)?\s*(\d+)\s*minutes/i);
    if (clampMatch) extracted.avf_artery_clamp = clampMatch[1];
    if (t.includes("thrill") && (t.includes("strong") || t.includes("palpable"))) {
      extracted.avf_thrill_bruit = "Strong continuous thrill & bruit present";
    }
    if (t.includes("end-to-side")) {
      extracted.avf_anast_type = "End-to-Side (Arteriovenous)";
    }
  } else if (detected.category === "hd") {
    if (detected.procType === "pd_catheter") {
      if (t.includes("laparoscopic")) extracted.pd_proc_approach = "Laparoscopic insertion with rectus sheath tunneling & omentopexy (Preferred)";
      if (t.includes("left lower quadrant") || t.includes("llq")) extracted.pd_exit_site = "Left Lower Quadrant (Below beltline — Standard)";
    } else {
      const qbMatch = t.match(/(?:qb|blood\s*flow(?:\s*rate)?)\s*(?:of|is|:)?\s*(\d+)/i);
      if (qbMatch) extracted.hd_qb = qbMatch[1];

      const qdMatch = t.match(/(?:qd|dialysate\s*flow(?:\s*rate)?)\s*(?:of|is|:)?\s*(\d+)/i);
      if (qdMatch) extracted.hd_qd = qdMatch[1];

      const ufMatch = t.match(/(?:achieved\s*uf|uf\s*removed|total\s*ultrafiltration\s*(?:volume\s*)?removed|total\s*uf)\s*(?:is|was|of|:)?\s*(\d+(?:\.\d+)?)\s*(?:l|liters)?/i);
      if (ufMatch) extracted.hd_total_uf_removed = ufMatch[1];

      const targetUfMatch = t.match(/target\s*(?:uf|ultrafiltration)\s*(?:is|was|of|:)?\s*(\d+(?:\.\d+)?)\s*(?:l|liters)?/i);
      if (targetUfMatch) extracted.hd_target_uf = targetUfMatch[1];

      const dryWtMatch = t.match(/(?:target\s*)?dry\s*weight\s*(?:is|was|of|:)?\s*(\d+(?:\.\d+)?)\s*(?:kg)?/i);
      if (dryWtMatch) extracted.hd_dry_weight = dryWtMatch[1];

      const preWtMatch = t.match(/pre(?:-session)?\s*weight\s*(?:is|was|of|:)?\s*(\d+(?:\.\d+)?)\s*(?:kg)?/i);
      if (preWtMatch) extracted.hd_pre_weight = preWtMatch[1];

      const postWtMatch = t.match(/post(?:-session)?\s*weight\s*(?:is|was|of|:)?\s*(\d+(?:\.\d+)?)\s*(?:kg)?/i);
      if (postWtMatch) extracted.hd_post_weight = postWtMatch[1];

      const ktvMatch = t.match(/(?:delivered\s*)?kt\/v(?:\s*adequacy)?\s*(?:is|was|of|:)?\s*(\d+(?:\.\d+)?)/i);
      if (ktvMatch) extracted.hd_delivered_ktv = ktvMatch[1];

      const urrMatch = t.match(/(?:delivered\s*)?(?:urr|urea\s*reduction\s*ratio)\s*(?:is|was|of|:)?\s*(\d+(?:\.\d+)?)\s*%?/i);
      if (urrMatch) extracted.hd_delivered_urr = `${urrMatch[1]}%`;

      const durMatch = t.match(/(?:duration|session\s*duration)\s*(?:is|was|of|:)?\s*(\d+(?:\.\d+)?)\s*(?:hours|hrs|h)/i);
      if (durMatch) extracted.hd_duration_hours = durMatch[1];

      if (t.includes("fistula") || t.includes("avf") || t.includes("radiocephalic") || t.includes("brachiocephalic")) {
        extracted.hd_access_used = "Arteriovenous Fistula (AVF)";
      } else if (t.includes("graft") || t.includes("avg") || t.includes("ptfe")) {
        extracted.hd_access_used = "Arteriovenous Graft (AVG)";
      } else if (t.includes("permcath") || t.includes("tunneled cvc") || t.includes("tunneled")) {
        extracted.hd_access_used = "Tunneled CVC (Permcath)";
      } else if (t.includes("temporary") || t.includes("dual-lumen") || t.includes("non-tunneled")) {
        extracted.hd_access_used = "Temporary Non-Tunneled CVC (IJ / Femoral)";
      }

      if (t.includes("2k bath") || t.includes("2.0 meq/l") || t.includes("2.0 k")) {
        extracted.hd_k_bath = "2.0 mEq/L (Standard maintenance)";
      } else if (t.includes("1k bath") || t.includes("1.0 meq/l") || t.includes("1.0 k")) {
        extracted.hd_k_bath = "1.0 mEq/L (Severe hyperkalemia)";
      } else if (t.includes("3k bath") || t.includes("3.0 meq/l") || t.includes("3.0 k")) {
        extracted.hd_k_bath = "3.0 mEq/L (Hypokalemia prone / Digoxin)";
      }

      if (t.includes("2.5 ca") || t.includes("2.5 meq/l calcium")) {
        extracted.hd_ca_bath = "2.5 mEq/L (Standard 1.25 mmol/L)";
      }

      if (t.includes("heparin-free") || t.includes("saline flushes")) {
        extracted.hd_heparin = "Heparin-Free (Saline Flushes q30m)";
      } else if (t.includes("heparin") || t.includes("unfractionated")) {
        extracted.hd_heparin = "Standard Unfractionated Heparin";
      }

      const preBpMatch = t.match(/pre(?:-dialysis)?\s*bp\s*(?:is|was|of|:)?\s*(\d{2,3}\/\d{2,3})/i);
      if (preBpMatch) extracted.hd_pre_bp = preBpMatch[1];

      const postBpMatch = t.match(/post(?:-dialysis)?\s*bp\s*(?:is|was|of|:)?\s*(\d{2,3}\/\d{2,3})/i);
      if (postBpMatch) extracted.hd_post_bp = postBpMatch[1];
    }
  }

  return extracted;
}

