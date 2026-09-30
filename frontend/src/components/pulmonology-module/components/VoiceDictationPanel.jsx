import React, { useRef, useState } from "react";
import { usePulmonology } from "../context/PulmonologyContext";
import { structurePulmonologyDictation, transcribePulmonologyAudio } from "../services/pulmonologyApi";

// Date parsing helpers for clinical ambient speech
function parseDateString(str) {
  if (!str || typeof str !== "string") return null;
  const isoMatch = str.match(/\b(\d{4})-(\d{1,2})-(\d{1,2})\b/);
  if (isoMatch) {
    return `${isoMatch[1]}-${isoMatch[2].padStart(2, "0")}-${isoMatch[3].padStart(2, "0")}`;
  }
  const slashMatch = str.match(/\b(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})\b/);
  if (slashMatch) {
    return `${slashMatch[3]}-${slashMatch[1].padStart(2, "0")}-${slashMatch[2].padStart(2, "0")}`;
  }
  const months = {
    jan: "01", january: "01", feb: "02", february: "02", mar: "03", march: "03",
    apr: "04", april: "04", may: "05", jun: "06", june: "06", jul: "07", july: "07",
    aug: "08", august: "08", sep: "09", sept: "09", september: "09", oct: "10",
    october: "10", nov: "11", november: "11", dec: "12", december: "12",
  };
  const namedMatch = str.match(/\b(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\s+(\d{1,2})(?:st|nd|rd|th)?(?:,)?\s+(\d{4})\b/i);
  if (namedMatch) {
    const m = months[namedMatch[1].toLowerCase()];
    const d = namedMatch[2].padStart(2, "0");
    const y = namedMatch[3];
    return `${y}-${m}-${d}`;
  }
  return null;
}

function findDateNearContext(text, contextRegex) {
  const m = text.match(contextRegex);
  if (!m) return null;
  const start = Math.max(0, m.index - 20);
  const end = Math.min(text.length, m.index + m[0].length + 70);
  const windowStr = text.slice(start, end);
  return parseDateString(windowStr);
}

function parseWordNumber(str) {
  if (!str) return null;
  const s = String(str).trim().toLowerCase();
  const map = {
    zero: "0", none: "0", no: "0", nil: "0",
    one: "1", two: "2", three: "3", four: "4", five: "5",
    six: "6", seven: "7", eight: "8", nine: "9", ten: "10",
  };
  if (map[s] !== undefined) return map[s];
  const digits = s.match(/\d+/);
  return digits ? digits[0] : null;
}

function extractYesNoComorbidity(text, aliases) {
  for (const alias of aliases) {
    const aliasEsc = alias.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

    // Check direct negation e.g. "no hypertension", "negative for heart failure", "denies cad", "without ckd"
    const directNeg = new RegExp(`(?:negative\\s+for|no(?:t)?\\s+(?:hx\\s+of\\s+)?|denies(?:\\s+any)?\\s+|without\\s+|ruled\\s+out\\s+)[^.;\\n]*?\\b${aliasEsc}\\b`, "i");
    if (directNeg.test(text)) return "No";

    // Grouped negation: e.g. "Negative for heart failure, coronary artery disease, atrial fibrillation..."
    const negGroupMatch = text.match(/(?:negative\s+for|denies\s+(?:any\s+)?|no\s+history\s+of|ruled\s+out)\s+([^.]+)/i);
    if (negGroupMatch) {
      const negClause = negGroupMatch[1];
      if (new RegExp(`\\b${aliasEsc}\\b`, "i").test(negClause)) {
        return "No";
      }
    }

    // Positive mention
    const posMention = new RegExp(`\\b${aliasEsc}\\b`, "i");
    if (posMention.test(text)) {
      return "Yes";
    }
  }
  return null;
}

// Smart local rule-based clinical fallback extractor (inlined so no external schema files required)
export function extractPulmonologyLocalDictation(text, section = "") {
  if (!text || typeof text !== "string") return {};
  const t = text.toLowerCase();
  const extracted = {};

  // Vital signs & anthropometrics
  const isMonitoringSection = String(section || "").toLowerCase().includes("monitoring");
  const hrMatch = t.match(/(?:hr|heart\s*rate|pulse)\s*(?:is|of|at|=)?\s*(\d{2,3})/);
  if (hrMatch) {
    if (isMonitoringSection) extracted.mon_obs_hr = hrMatch[1];
    else extracted.pulm_baseline_hr = hrMatch[1];
  }

  const bpMatch = t.match(/(?:bp|blood\s*pressure)\s*(?:is|of|at|=)?\s*(\d{2,3}\s*[\/\\]\s*\d{2,3})/);
  if (bpMatch) {
    if (isMonitoringSection) extracted.mon_obs_bp = bpMatch[1].replace(/\s+/g, "");
    else extracted.pulm_baseline_bp = bpMatch[1].replace(/\s+/g, "");
  }

  const spo2Match = t.match(/(?:spo2|saturation|sat|o2\s*sat)\s*(?:is|of|at|=)?\s*(\d{2,3})\s*%?/);
  if (spo2Match) {
    if (isMonitoringSection) extracted.mon_obs_spo2 = spo2Match[1];
    else extracted.pulm_baseline_spo2 = spo2Match[1];
  }

  const rrMatch = t.match(/(?:rr|respiratory\s*rate|resp\s*rate)\s*(?:is|of|at|=)?\s*(\d{1,2})/);
  if (rrMatch) {
    if (isMonitoringSection) extracted.mon_obs_rr = rrMatch[1];
    else extracted.pulm_baseline_rr = rrMatch[1];
  }

  // If on Post-Procedure Monitoring Tab, parse all 5 clinical panels & flowsheet
  if (isMonitoringSection) {
    if (t.includes("standard ward") || t.includes("ward monitoring") || t.includes("q1h x 4") || t.includes("ward")) {
      extracted.mon_plan_frequency = "Standard Ward (q1h × 4, then q4h)";
    } else if (t.includes("pacu") || t.includes("intensive pacu")) {
      extracted.mon_plan_frequency = "Intensive PACU (q15min × 1h, q30min × 2h, then q1h)";
    } else if (t.includes("step-down") || t.includes("high-dependency") || t.includes("hdu")) {
      extracted.mon_plan_frequency = "Step-Down / High-Dependency Unit (q2h)";
    } else if (t.includes("icu") || t.includes("intensive care")) {
      extracted.mon_plan_frequency = "Continuous ICU Monitoring";
    }

    if (t.includes("intact gag") || t.includes("self-maintaining") || t.includes("self maintaining") || t.includes("intact reflexes")) {
      extracted.mon_plan_airway_status = "Intact gag/cough reflexes (Self-maintaining)";
    } else if (t.includes("nasopharyngeal")) {
      extracted.mon_plan_airway_status = "Nasopharyngeal airway in situ";
    } else if (t.includes("endotracheal") || t.includes("ett") || t.includes("invasive ventilation")) {
      extracted.mon_plan_airway_status = "Endotracheal tube / Invasive ventilation";
    } else if (t.includes("speaking valve")) {
      extracted.mon_plan_airway_status = "Tracheostomy tube with speaking valve";
    } else if (t.includes("trach") || t.includes("tracheostomy")) {
      extracted.mon_plan_airway_status = "Tracheostomy tube on continuous humidified O2";
    }

    if (t.includes("spontaneous emergence") || t.includes("no reversal") || t.includes("uneventful emergence")) {
      extracted.mon_plan_reversal = "Spontaneous emergence (No reversal required)";
    } else if (t.includes("naloxone") || t.includes("narcan")) {
      extracted.mon_plan_reversal = "Naloxone (Narcan) administered for opioid depression";
    } else if (t.includes("flumazenil")) {
      extracted.mon_plan_reversal = "Flumazenil administered for benzodiazepine sedation";
    } else if (t.includes("sugammadex")) {
      extracted.mon_plan_reversal = "Sugammadex administered for neuromuscular blockade";
    }

    if (t.includes("room air") || t.includes("21%")) {
      extracted.mon_obs_o2_flow = "Room Air (21%)";
    } else if (t.includes("nasal cannula 1") || t.includes("nasal cannula 2") || t.includes("2 l/min") || t.includes("2l/min") || t.includes("nasal prongs")) {
      extracted.mon_obs_o2_flow = "Nasal Cannula 1-2 L/min";
    } else if (t.includes("nasal cannula 3") || t.includes("nasal cannula 4") || t.includes("4 l/min")) {
      extracted.mon_obs_o2_flow = "Nasal Cannula 3-4 L/min";
    } else if (t.includes("venturi 28") || t.includes("venturi 35") || t.includes("venturi mask")) {
      extracted.mon_obs_o2_flow = "Venturi Mask 28-35%";
    } else if (t.includes("non-rebreather") || t.includes("nrb")) {
      extracted.mon_obs_o2_flow = "Non-Rebreather 10-15 L/min";
    } else if (t.includes("hfnc") || t.includes("high flow")) {
      extracted.mon_obs_o2_flow = "High Flow Nasal Cannula (HFNC)";
    } else if (t.includes("bipap") || t.includes("niv circuit") || t.includes("niv")) {
      extracted.mon_obs_o2_flow = "NIV / BiPAP Circuit";
    }

    const tempMatch = t.match(/(?:temp(?:erature)?)\s*(?:is|of|at|=)?\s*(\d{2}(?:\.\d)?)\b/i);
    if (tempMatch) extracted.mon_obs_temp = tempMatch[1];

    const gcsMatch = t.match(/gcs\s*(?:is|of|at|=)?\s*(\d{1,2})\b/i);
    if (gcsMatch) {
      extracted.mon_obs_gcs = gcsMatch[1] === "15" ? "15 (Alert & Oriented)" : gcsMatch[1];
    }

    const aldreteMatch = t.match(/aldrete\s*(?:score)?\s*(?:is|of|at|=)?\s*(\d{1,2})\b/i);
    if (aldreteMatch) {
      if (aldreteMatch[1] === "10") extracted.mon_obs_aldrete = "10 (Full Recovery - Discharge Ready)";
      else if (aldreteMatch[1] === "9") extracted.mon_obs_aldrete = "9 (Clear to Step-Down Unit)";
      else if (aldreteMatch[1] === "8") extracted.mon_obs_aldrete = "8 (PACU Recovery Required)";
      else extracted.mon_obs_aldrete = "< 8 (Continuous Monitoring Required)";
    }

    if (t.includes("eupneic") || t.includes("normal resting work") || t.includes("normal work of breathing") || t.includes("unlabored")) {
      extracted.mon_obs_wob = "Eupneic / Normal resting";
    } else if (t.includes("scalene") || t.includes("mild accessory")) {
      extracted.mon_obs_wob = "Mild scalene / sternocleidomastoid use";
    } else if (t.includes("intercostal") || t.includes("retractions")) {
      extracted.mon_obs_wob = "Moderate intercostal retractions";
    } else if (t.includes("paradox") || t.includes("exhaustion")) {
      extracted.mon_obs_wob = "Severe abdominal paradox / exhaustion";
    }

    if (t.includes("clear") && (t.includes("lung") || t.includes("chest") || t.includes("auscultat") || t.includes("bilaterally"))) {
      extracted.mon_obs_auscultation = "Clear bilaterally";
    } else if (t.includes("wheeze") || t.includes("wheezing")) {
      extracted.mon_obs_auscultation = "Bilateral expiratory wheezes";
    } else if (t.includes("crackles") || t.includes("crepitations")) {
      extracted.mon_obs_auscultation = "End-inspiratory fine basilar crackles";
    } else if (t.includes("bronchial")) {
      extracted.mon_obs_auscultation = "Coarse bronchial breath sounds";
    }

    if (t.includes("symmetrical") || t.includes("symmetric") || t.includes("equal expansion")) {
      extracted.mon_obs_symmetry = "Symmetrical expansion";
    } else if (t.includes("reduced right") || t.includes("decreased right")) {
      extracted.mon_obs_symmetry = "Reduced expansion right hemithorax";
    } else if (t.includes("reduced left") || t.includes("decreased left")) {
      extracted.mon_obs_symmetry = "Reduced expansion left hemithorax";
    } else if (t.includes("subcutaneous emphysema")) {
      extracted.mon_obs_symmetry = "Subcutaneous emphysema palpated";
    }

    // Panel 2: TDM & Labs
    const theoMatch = t.match(/theophylline\s*(?:level|trough)?\s*(?:is|of|at|=)?\s*(\d+(?:\.\d+)?)\b/i);
    if (theoMatch) extracted.mon_tdm_theophylline = theoMatch[1];

    const voriMatch = t.match(/voriconazole\s*(?:level|trough)?\s*(?:is|of|at|=)?\s*(\d+(?:\.\d+)?)\b/i);
    if (voriMatch) extracted.mon_tdm_voriconazole = voriMatch[1];

    const aminoMatch = t.match(/(?:aminoglycoside|tobramycin|amikacin)\s*(?:level|trough)?\s*(?:is|of|at|=)?\s*(\d+(?:\.\d+)?)\b/i);
    if (aminoMatch) extracted.mon_tdm_aminoglycoside = aminoMatch[1];

    const aecMatch = t.match(/(?:aec|eosinophil(?:s)?)\s*(?:count)?\s*(?:is|of|at|=)?\s*(\d+)\b/i);
    if (aecMatch) extracted.mon_tdm_eosinophils = aecMatch[1];

    const ancMatch = t.match(/anc\s*(?:is|of|at|=)?\s*(\d+)\b/i);
    if (ancMatch) extracted.mon_tdm_anc = ancMatch[1];

    const igeMatch = t.match(/(?:serum\s*total\s*ige|total\s*ige|ige)\s*(?:is|of|at|=)?\s*(\d+)\b/i);
    if (igeMatch) extracted.mon_tdm_ige = igeMatch[1];

    const phMatch = t.match(/(?:arterial\s*ph|abg\s*ph|ph)\s*(?:is|of|at|=)?\s*(7\.\d{1,2})\b/i);
    if (phMatch) extracted.mon_tdm_abg_ph = phMatch[1];

    const paco2Match = t.match(/(?:serial\s*paco2|paco2)\s*(?:is|of|at|=)?\s*(\d{2})\b/i);
    if (paco2Match) extracted.mon_tdm_abg_paco2 = paco2Match[1];

    const pao2Match = t.match(/(?:serial\s*pao2|pao2)\s*(?:is|of|at|=)?\s*(\d{2,3})\b/i);
    if (pao2Match) extracted.mon_tdm_abg_pao2 = pao2Match[1];

    const hco3Match = t.match(/(?:serial\s*hco3|hco3|bicarb(?:onate)?)\s*(?:is|of|at|=)?\s*(\d{1,2})\b/i);
    if (hco3Match) extracted.mon_tdm_abg_hco3 = hco3Match[1];

    const glucoseMatch = t.match(/(?:blood\s*glucose|bsl|sugar)\s*(?:is|of|at|=)?\s*(\d{2,3})\b/i);
    if (glucoseMatch) extracted.mon_tdm_glucose = glucoseMatch[1];

    const kMatch = t.match(/(?:serum\s*potassium|potassium|\bpot\b)\s*(?:is|of|at|=)?\s*(\d(?:\.\d+)?)\b/i);
    if (kMatch) extracted.mon_tdm_potassium = kMatch[1];

    const egfrMatch = t.match(/(?:egfr|gfr)\s*(?:is|of|at|=)?\s*(\d{2,3})\b/i);
    if (egfrMatch) extracted.mon_tdm_egfr = egfrMatch[1];

    // Panel 3: IP Nursing & Drains
    if (t.includes("day shift")) extracted.mon_nurs_shift = "Day Shift (07:00 - 15:00)";
    else if (t.includes("evening shift")) extracted.mon_nurs_shift = "Evening Shift (15:00 - 23:00)";
    else if (t.includes("night shift")) extracted.mon_nurs_shift = "Night Shift (23:00 - 07:00)";

    const nurseMatch = text.match(/(?:primary\s*nurse|nurse|rn)\s*([a-zA-Z]+)/i);
    if (nurseMatch && !["day", "evening", "night", "notes"].includes(nurseMatch[1].toLowerCase())) {
      const n = nurseMatch[1];
      extracted.mon_nurs_nurse_name = `RN ${n.charAt(0).toUpperCase() + n.slice(1).toLowerCase()}`;
    }

    const sleepHrsMatch = t.match(/(?:sleep\s*duration|slept)\s*(?:is|of|at|=)?\s*(\d+(?:\.\d+)?)\s*(?:hours|hrs)?\b/i);
    if (sleepHrsMatch) extracted.mon_nurs_sleep_hrs = sleepHrsMatch[1];

    if (t.includes("restful") || t.includes("no nocturnal awakenings")) {
      extracted.mon_nurs_sleep_quality = "Restful, no nocturnal awakenings";
    } else if (t.includes("interrupted by cough") || t.includes("awakenings from wheeze")) {
      extracted.mon_nurs_sleep_quality = "Interrupted by cough / wheezing";
    } else if (t.includes("orthopneic") || t.includes("pillows")) {
      extracted.mon_nurs_sleep_quality = "Orthopneic (requires 3+ pillows)";
    }

    const drainMatch = t.match(/(?:chest\s*tube|drain(?:age)?|pleurx)\s*(?:output|drained)?\s*(?:of|is|at|=)?\s*(\d+)\s*ml/i);
    if (drainMatch) {
      extracted.mon_nurs_drain_volume = drainMatch[1];
      extracted.mon_drain_output_ml = drainMatch[1];
    }

    if (t.includes("no active drain") || t.includes("drain removed")) {
      extracted.mon_nurs_drain_color = "No active drain";
      extracted.mon_nurs_air_leak = "No active drain";
    } else {
      if (t.includes("no air leak") || t.includes("air leak absent") || t.includes("air leak negative")) {
        extracted.mon_nurs_air_leak = "Absent";
      } else if (t.includes("air leak on cough") || t.includes("grade 1 air leak")) {
        extracted.mon_nurs_air_leak = "Present on forced cough only (Grade 1)";
      } else if (t.includes("continuous air leak")) {
        extracted.mon_nurs_air_leak = "Continuous during tidal breathing (Grade 3)";
      }

      if (t.includes("serosanguinous")) extracted.mon_nurs_drain_color = "Serosanguinous";
      else if (t.includes("serous")) extracted.mon_nurs_drain_color = "Serous (Straw-colored)";
      else if (t.includes("purulent") || t.includes("pus")) extracted.mon_nurs_drain_color = "Purulent / Turbid (Empyema)";
    }

    if (t.includes("not intubated") || t.includes("non-tracheostomized")) {
      extracted.mon_nurs_suction_freq = "Not intubated / Non-tracheostomized";
    } else if (t.includes("minimal suction")) {
      extracted.mon_nurs_suction_freq = "Minimal (1-2 times / shift)";
    }

    if (t.includes("thin clear") || t.includes("clear mucoid") || t.includes("mucoid sputum")) {
      extracted.mon_nurs_sputum = "Thin & Clear / Mucoid";
    } else if (t.includes("tenacious") || t.includes("retained secretions")) {
      extracted.mon_nurs_sputum = "Thick & Tenacious (Retained secretions)";
    } else if (t.includes("purulent sputum")) {
      extracted.mon_nurs_sputum = "Purulent (Yellow / Green)";
    }

    const prnMatch = t.match(/(\d+)\s*(?:prn|nebulizer|nebs|dose)/i);
    if (prnMatch) extracted.mon_nurs_prn_nebs = `${prnMatch[1]} doses Salbutamol/Ipratropium`;

    // Panel 4: Efficacy & Safety
    if (t.includes("no pneumothorax") || t.includes("pneumothorax excluded") || t.includes("cxr clear") || t.includes("ptx excluded")) {
      extracted.mon_eff_cxr_ptx = "Confirmed Absent / Excluded";
    } else if (t.includes("cxr not indicated")) {
      extracted.mon_eff_cxr_ptx = "Not indicated for this procedure";
    }

    if (t.includes("no hemoptysis") || t.includes("hemoptysis resolved") || t.includes("no blood in sputum")) {
      extracted.mon_eff_hemoptysis = "None";
    } else if (t.includes("scant blood") || t.includes("streaks")) {
      extracted.mon_eff_hemoptysis = "Scant blood streaks (<5 mL)";
    }

    if (t.includes("dressing clean") || t.includes("clean dry") || t.includes("intact dressing") || t.includes("site clean")) {
      extracted.mon_eff_dressing = "Clean, dry, intact, no hematoma";
    } else if (t.includes("strike-through")) {
      extracted.mon_eff_dressing = "Minor serous strike-through (Reinforced)";
    }

    const postMmrcMatch = t.match(/mmrc\s*(?:grade|score)?\s*(?:is|of|at|=)?\s*([0-4])/i);
    if (postMmrcMatch) {
      const map = {
        "0": "0 (Breathless only with strenuous exercise)",
        "1": "1 (Short of breath when hurrying on level ground)",
        "2": "2 (Walks slower than peers due to breathlessness)",
        "3": "3 (Stops for breath after walking 100 yards)",
        "4": "4 (Too breathless to leave house / dress)",
      };
      extracted.mon_eff_mmrc = map[postMmrcMatch[1]] || postMmrcMatch[1];
    }

    if (t.includes("no cough") || t.includes("cough 0")) {
      extracted.mon_eff_cough_vas = "0 (No cough)";
    } else if (t.includes("mild cough") || t.includes("cough vas 1") || t.includes("cough vas 2")) {
      extracted.mon_eff_cough_vas = "1-3 (Mild, occasional cough)";
    } else if (t.includes("moderate cough")) {
      extracted.mon_eff_cough_vas = "4-6 (Moderate, disturbing activities)";
    }

    if (t.includes("wheezing completely resolved") || t.includes("wheezes resolved")) {
      extracted.mon_eff_wheeze_response = "Completely resolved";
    } else if (t.includes("wheezing substantially improved") || t.includes("wheeze improved")) {
      extracted.mon_eff_wheeze_response = "Substantially improved";
    }

    if (t.includes("no adrs") || t.includes("no adverse") || t.includes("no side effects") || t.includes("no drug reaction")) {
      extracted.mon_eff_adrs = "None reported";
    }

    if (t.includes("hemodynamically stable") || t.includes("cardiovascularly stable") || t.includes("stable hemodynamics")) {
      extracted.mon_eff_cardio = "Hemodynamically stable throughout";
    }

    // Panel 5: Treatment Resistance
    if (t.includes("gold group e met") || t.includes("group e met")) {
      extracted.mon_res_gold_group_e = "Met: ≥1 hospitalization for acute COPD exacerbation";
    } else if (t.includes("gold group e not met")) {
      extracted.mon_res_gold_group_e = "Not met (<2 exacerbations, 0 hospitalizations)";
    }

    if (t.includes("gina step 5 controlled") || t.includes("controlled on step 3-4") || t.includes("gina controlled")) {
      extracted.mon_res_gina_step5 = "Controlled on Step 3-4 therapy";
    } else if (t.includes("gina step 5 uncontrolled") || t.includes("uncontrolled despite high-dose")) {
      extracted.mon_res_gina_step5 = "Uncontrolled despite high-dose ICS-LABA";
    }

    if (t.includes("steroid sensitive") || t.includes("responsive to steroid")) {
      extracted.mon_res_steroid_response = "Steroid-sensitive (FEV1 improves >12% & 200mL)";
    } else if (t.includes("steroid resistant") || t.includes("refractory")) {
      extracted.mon_res_steroid_response = "Refractory / Poor FEV1 response to oral trial";
    }

    if (t.includes("biologic candidate") || t.includes("anti-il5") || t.includes("mepolizumab") || t.includes("eosinophilic phenotype")) {
      extracted.mon_res_biologic_candidate = "Candidate for Anti-IL5 / Anti-IL5R (Mepolizumab / Benralizumab)";
    } else if (t.includes("no biologic") || t.includes("not indicated for biologic")) {
      extracted.mon_res_biologic_candidate = "None / Not indicated";
    }

    if (t.includes("endobronchial valves") || t.includes("zephyr")) {
      extracted.mon_res_interventional_escalation = "Candidate for Endobronchial Valves (EBV / Zephyr)";
    } else if (t.includes("no interventional escalation") || t.includes("interventional escalation not indicated")) {
      extracted.mon_res_interventional_escalation = "Not indicated";
    }

    if (t.includes("no transplant") || t.includes("no lung transplant")) {
      extracted.mon_res_transplant_trigger = "No transplant indication currently";
    } else if (t.includes("transplant trigger met") || t.includes("bode index 7")) {
      extracted.mon_res_transplant_trigger = "Trigger met: BODE Index 7–10 or FEV1 < 25% predicted";
    }

    // Panel 6: Clinical Prophylaxis & Functional Nursing Orders
    if (t.includes("enoxaparin 40") || t.includes("enoxaparin daily") || t.includes("lovenox 40") || t.includes("dvt prophylaxis enoxaparin")) {
      extracted.mon_proph_dvt = "Enoxaparin 40mg SC daily";
    } else if (t.includes("enoxaparin 30") || t.includes("lovenox 30")) {
      extracted.mon_proph_dvt = "Enoxaparin 30mg SC BD (High risk)";
    } else if (t.includes("heparin 5000") || t.includes("unfractionated heparin")) {
      extracted.mon_proph_dvt = "Unfractionated Heparin 5000U SC q8h";
    } else if (t.includes("scds") || t.includes("compression devices")) {
      extracted.mon_proph_dvt = "Sequential Compression Devices (SCDs) only";
    } else if (t.includes("no dvt") || t.includes("ambulation sufficient")) {
      extracted.mon_proph_dvt = "None / Ambulation sufficient";
    }

    if (t.includes("pantoprazole") || t.includes("protonix") || t.includes("stress ulcer prophylaxis")) {
      extracted.mon_proph_gi = "Pantoprazole 40mg IV/PO daily";
    } else if (t.includes("famotidine") || t.includes("pepcid")) {
      extracted.mon_proph_gi = "Famotidine 20mg IV/PO BD";
    } else if (t.includes("no gi") || t.includes("enteral nutrition protective")) {
      extracted.mon_proph_gi = "None / Enteral nutrition protective";
    }

    if (t.includes("regular diet") || t.includes("diet as tolerated")) {
      extracted.mon_orders_nutrition = "Regular diet as tolerated";
    } else if (text.includes("clear liquids")) {
      extracted.mon_orders_nutrition = "Clear liquids after 1 hour if alert";
    } else if (t.includes("npo until gag") || t.includes("npo")) {
      extracted.mon_orders_nutrition = "NPO until gag reflex confirmed intact";
    } else if (t.includes("diabetic diet") || t.includes("renal diet")) {
      extracted.mon_orders_nutrition = "Diabetic / Renal protective diet";
    }

    if (t.includes("incentive spirometry") || t.includes("spirometry 10 breaths") || t.includes("rt orders")) {
      extracted.mon_orders_rt = "Incentive Spirometry 10 breaths/hr while awake";
    } else if (t.includes("acapella") || t.includes("flutter valve")) {
      extracted.mon_orders_rt = "Acapella / Flutter valve therapy QID";
    } else if (t.includes("chest physio") || t.includes("postural drainage")) {
      extracted.mon_orders_rt = "Chest Physiotherapy & postural drainage";
    } else if (t.includes("early ambulation with portable") || t.includes("early ambulation")) {
      extracted.mon_orders_rt = "Early ambulation with portable O2 canister";
    }

    // Activity Restrictions
    if (t.includes("bed rest") || t.includes("bedrest")) extracted.mon_act_bedrest = true;
    if (t.includes("head elevated") || t.includes("semi-fowlers") || t.includes("head of bed")) extracted.mon_act_head_elevated = true;
    if (t.includes("canister below") || t.includes("drain below") || t.includes("drainage upright")) extracted.mon_act_drain_nondep = true;
    if (t.includes("avoid forced cough") || t.includes("avoid valsalva")) extracted.mon_act_no_cough = true;
    if (t.includes("ambulate only with") || t.includes("ambulate with nurse") || t.includes("assistance while on oxygen")) extracted.mon_act_amb_o2 = true;

    // Red-Flag Warning Signs
    if (t.includes("red-flag") || t.includes("red flag") || t.includes("warning signs") || t.includes("counseled")) {
      extracted.mon_warn_pain = true;
      extracted.mon_warn_sob = true;
      extracted.mon_warn_hemoptysis = true;
      extracted.mon_warn_crepitus = true;
      extracted.mon_warn_drain_leak = true;
    }

    // Auto-prime flowsheet observation if vitals are dictated
    if (extracted.mon_obs_spo2 || extracted.mon_obs_bp) {
      extracted.mon_timed_obs = [
        {
          id: Date.now().toString(),
          time: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
          bp: extracted.mon_obs_bp || "120/78",
          hr: extracted.mon_obs_hr || "74",
          rr: extracted.mon_obs_rr || "16",
          spo2: (extracted.mon_obs_spo2 || "95") + "%",
          o2: extracted.mon_obs_o2_flow || "Nasal Cannula 1-2 L/min",
          aldrete: extracted.mon_obs_aldrete || "10 (Full Recovery - Discharge Ready)",
          gcs: extracted.mon_obs_gcs || "15 (Alert & Oriented)",
          pain: "0/10",
          drain: extracted.mon_nurs_drain_volume ? `${extracted.mon_nurs_drain_volume} mL` : "None",
          interventions: "Arrival PACU check logged via voice dictation",
          assessedBy: extracted.mon_nurs_nurse_name || "RN Sarah",
        },
      ];
    }
  }

  const wtMatch = t.match(/(?:weight|wt)\s*(?:is|of|at|=)?\s*(\d{2,3}(?:\.\d+)?)\s*(?:kg|kilos)?/);
  if (wtMatch) extracted.pulm_clinical_weight = wtMatch[1];

  const htMatch = t.match(/(?:height|ht)\s*(?:is|of|at|=)?\s*(\d{2,3}(?:\.\d+)?)\s*cm/);
  if (htMatch) extracted.pulm_clinical_height = htMatch[1];

  // Dates
  const baselineDate = findDateNearContext(text, /(?:assessment\s*date|baseline\s*date|date\s*of\s*baseline|assessment)/i);
  if (baselineDate) extracted.pulm_baseline_date = baselineDate;

  const cxrDate = findDateNearContext(text, /(?:chest\s*x-?ray|cxr)/i);
  if (cxrDate) extracted.img_cxr_date = cxrDate;

  const ctDate = findDateNearContext(text, /(?:chest\s*ct|ct\s*scan|ct\s*chest)/i);
  if (ctDate) extracted.img_ct_date = ctDate;

  const dobDate = findDateNearContext(text, /(?:date\s*of\s*birth|dob|born)/i);
  if (dobDate) extracted.pt_dob = dobDate;

  // General Comorbidities
  const comorbMap = {
    hx_htn: ["hypertension", "htn", "high blood pressure"],
    hx_hf: ["heart failure", "cor pulmonale", "chf", "congestive heart failure"],
    hx_cad: ["coronary artery disease", "cad", "ischemic heart"],
    hx_afib: ["atrial fibrillation", "a-fib", "afib", "a fib"],
    hx_diabetes: ["type 2 diabetes", "t2dm", "diabetes", "diabetic", "dm"],
    hx_ckd: ["chronic kidney disease", "ckd", "renal failure", "renal insufficiency"],
    hx_gerd: ["gerd", "acid reflux", "gastroesophageal reflux", "reflux"],
    hx_osa: ["obstructive sleep apnea", "sleep apnea", "osa"],
    hx_osteo: ["osteoporosis", "osteopenic"],
    hx_ctd: ["connective tissue disease", "rheumatoid arthritis", "lupus", "scleroderma", "ctd"],
    hx_immuno: ["immunocompromised", "immunosuppressed", "immunodeficiency"],
    hx_cancer: ["lung cancer", "pulmonary malignancy", "lung malignancy"],
  };
  Object.entries(comorbMap).forEach(([fieldKey, aliases]) => {
    const val = extractYesNoComorbidity(text, aliases);
    if (val) extracted[fieldKey] = val;
  });

  // Primary Diagnosis
  if (t.includes("copd") || t.includes("chronic obstructive")) extracted.pulm_primary_dx = "COPD";
  else if (t.includes("asthma") && t.includes("overlap")) extracted.pulm_primary_dx = "Asthma-COPD Overlap";
  else if (t.includes("asthma")) extracted.pulm_primary_dx = "Asthma";
  else if (t.includes("ild") || t.includes("fibrosis") || t.includes("interstitial")) extracted.pulm_primary_dx = "ILD / Fibrosis";
  else if (t.includes("bronchiectasis")) extracted.pulm_primary_dx = "Bronchiectasis";
  else if (t.includes("pulmonary hypertension") || t.includes("pah")) extracted.pulm_primary_dx = "Pulmonary Hypertension";

  // Structured Pulmonary History
  const dxYearMatch = t.match(/(?:initial\s*diagnosis\s*year|diagnos(?:ed|is)\s*(?:in|year)?|dx\s*year)\s*(?:is|was|in|:)?\s*(\d{4})/i);
  if (dxYearMatch) extracted.pulm_dx_year = dxYearMatch[1];

  if (t.includes("biomass") || t.includes("chulha") || t.includes("wood smoke") || t.includes("occupational and biomass")) {
    extracted.pulm_etiology = "Occupational/Biomass";
  } else if (t.includes("smoking-related") || t.includes("smoking related") || t.includes("tobacco")) {
    extracted.pulm_etiology = "Smoking-related";
  } else if (t.includes("alpha-1") || t.includes("aatd")) {
    extracted.pulm_etiology = "Alpha-1 Antitrypsin Def";
  } else if (t.includes("eosinophilic")) {
    extracted.pulm_etiology = "Eosinophilic";
  } else if (t.includes("allergic")) {
    extracted.pulm_etiology = "Allergic";
  } else if (t.includes("idiopathic") || t.includes("ipf")) {
    extracted.pulm_etiology = "Idiopathic (IPF)";
  } else if (t.includes("sarcoidosis")) {
    extracted.pulm_etiology = "Sarcoidosis";
  } else if (t.includes("hypersensitivity")) {
    extracted.pulm_etiology = "Hypersensitivity (HP)";
  }

  const pneuMatch = t.match(/(?:(\d+|one|two|three|four|five)\s*(?:lifetime\s*)?(?:episode(?:s)?\s*of\s*)?pneumonia|pneumonia\s*(?:episodes?|count)\s*(?:is|of|:)?\s*(\d+|one|two|three|four|five))/i);
  if (pneuMatch) {
    const rawNum = pneuMatch[1] || pneuMatch[2];
    const parsed = parseWordNumber(rawNum);
    if (parsed) extracted.hx_pneumonia_count = parsed;
  }

  if (t.includes("no prior tuberculosis") || t.includes("no tb") || t.includes("negative for tb") || t.includes("denies tb")) {
    extracted.hx_tb = "No";
  } else if (t.includes("completed") && (t.includes("tb") || t.includes("tuberculosis"))) {
    extracted.hx_tb = "Yes - Completed";
  } else if (t.includes("incomplete") && (t.includes("tb") || t.includes("tuberculosis"))) {
    extracted.hx_tb = "Yes - Incomplete";
  }

  if (t.includes("no pulmonary embolism") || t.includes("no pe") || t.includes("negative for pe") || t.includes("denies pe")) {
    extracted.hx_pe = "No";
  } else if (t.includes("pulmonary embolism") || t.includes("prior pe")) {
    extracted.hx_pe = "Yes";
  }

  const exacMatch = t.match(/(?:(\d+|one|two|three|four|five)\s*(?:moderate\s*|severe\s*)?exacerbations?\s*(?:in\s*(?:the\s*)?past\s*year)?|exacerbation(?:s)?\s*(?:count)?\s*(?:is|of|:)?\s*(\d+|one|two|three|four|five))/i);
  if (exacMatch) {
    const rawNum = exacMatch[1] || exacMatch[2];
    const parsed = parseWordNumber(rawNum);
    if (parsed) extracted.hx_exac_count = parsed;
  }

  if (t.includes("no prior icu") || t.includes("no icu admission") || t.includes("denies icu")) {
    extracted.hx_icu_resp = "No";
  } else if (t.includes("icu admission") || t.includes("prior icu")) {
    extracted.hx_icu_resp = "Yes";
  }

  if (t.includes("no prior intubation") || t.includes("never intubated") || t.includes("no intubation") || t.includes("no mechanical ventilation")) {
    extracted.hx_intubation = "No";
  } else if (t.includes("intubation") || t.includes("mechanical ventilation")) {
    extracted.hx_intubation = "Yes";
  }

  if (t.includes("no prior niv") || t.includes("no niv") || t.includes("no bipap") || t.includes("no cpap")) {
    extracted.hx_niv = "No";
  } else if (t.includes("chronic home") || t.includes("home bipap") || t.includes("home cpap")) {
    extracted.hx_niv = "Yes - Chronic Home";
  } else if (t.includes("niv") || t.includes("bipap") || t.includes("cpap")) {
    extracted.hx_niv = "Yes - Acute";
  }

  // PFT & Functional Status
  const fev1Match = t.match(/fev\s*1\s*(?:is|of|at|=)?\s*(\d{1,3}(?:\.\d+)?)\s*%?/);
  if (fev1Match) { extracted.pulm_current_fev1_pct = fev1Match[1]; extracted.pft_fev1_actual = fev1Match[1]; }

  const fvcMatch = t.match(/fvc\s*(?:is|of|at|=)?\s*(\d{1,3}(?:\.\d+)?)\s*%?/);
  if (fvcMatch) { extracted.pulm_current_fvc_pct = fvcMatch[1]; extracted.pft_fvc_actual = fvcMatch[1]; }

  const dlcoMatch = t.match(/dlco\s*(?:is|of|at|=)?\s*(\d{1,3}(?:\.\d+)?)\s*%?/);
  if (dlcoMatch) extracted.pulm_current_dlco_pct = dlcoMatch[1];

  const sixMwtMatch = t.match(/(\d{2,4})\s*(?:meters|m|metres)\s*(?:walked|on\s*6mwt|6-minute)/);
  if (sixMwtMatch) extracted.pulm_current_6mwt_m = sixMwtMatch[1];

  // mMRC Dyspnea and CAT Scores
  const mmrcMatch = t.match(/(?:mmrc|dyspnea\s*scale)\s*(?:is|of|at|=|:)?\s*([0-4])/i);
  if (mmrcMatch) {
    extracted.score_mmrc = mmrcMatch[1];
  } else if (t.includes("exertional shortness of breath") || t.includes("exertional dyspnea") || t.includes("dyspnea on exertion")) {
    extracted.score_mmrc = "2";
  } else if (t.includes("dyspnea at rest") || t.includes("shortness of breath at rest")) {
    extracted.score_mmrc = "4";
  }

  const catMatch = t.match(/cat\s*(?:score)?\s*(?:is|of|at|=|:)?\s*(\d{1,2})/i);
  if (catMatch) {
    extracted.score_cat = catMatch[1];
  }

  // ABG
  const phMatch = t.match(/(?:ph)\s*(?:is|of|at|=)?\s*(7\.\d{2})/);
  if (phMatch) { extracted.pulm_current_ph = phMatch[1]; extracted.abg_ph = phMatch[1]; }

  const paco2Match = t.match(/paco2\s*(?:is|of|at|=)?\s*(\d{2,3}(?:\.\d+)?)/);
  if (paco2Match) { extracted.pulm_current_paco2 = paco2Match[1]; extracted.abg_paco2 = paco2Match[1]; }

  const pao2Match = t.match(/pao2\s*(?:is|of|at|=)?\s*(\d{2,3}(?:\.\d+)?)/);
  if (pao2Match) { extracted.pulm_current_pao2 = pao2Match[1]; extracted.abg_pao2 = pao2Match[1]; }

  const hco3Match = t.match(/hco3\s*(?:is|of|at|=)?\s*(\d{1,2}(?:\.\d+)?)/);
  if (hco3Match) { extracted.pulm_current_hco3 = hco3Match[1]; extracted.abg_hco3 = hco3Match[1]; }

  // Radiology findings (ensure pulmonary parenchymal emphysema is differentiated from subcutaneous emphysema)
  const isSubQEmphysemaOnly = t.includes("subcutaneous emphysema") && !t.includes("pulmonary emphysema") && !t.includes("centrilobular");
  const hasNegation = (word) => {
    const regex = new RegExp(`(?:no|without|denies|negative for|free of|resolved)\\s+[^.]*?${word}`);
    return regex.test(t);
  };

  if ((t.includes("hyperinflation") || t.includes("emphysema")) && !isSubQEmphysemaOnly && !hasNegation("emphysema") && !hasNegation("hyperinflation")) {
    extracted.img_primary_finding = "Hyperinflation / Emphysema";
  } else if ((t.includes("fibrosis") || t.includes("honeycombing")) && !hasNegation("fibrosis")) {
    extracted.img_primary_finding = "Fibrosis / Honeycombing";
  } else if (t.includes("bronchiectasis") && !hasNegation("bronchiectasis")) {
    extracted.img_primary_finding = "Bronchiectasis";
  } else if ((t.includes("nodule") || t.includes("mass")) && !hasNegation("nodule") && !hasNegation("mass")) {
    extracted.img_primary_finding = "Lung Nodule / Mass";
  } else if (t.includes("effusion") && !hasNegation("effusion")) {
    extracted.img_primary_finding = "Pleural Effusion";
  } else if (t.includes("clear") || t.includes("normal")) {
    extracted.img_primary_finding = "Normal / Clear";
  }

  // Vaccines & Allergies
  if (t.includes("flu") || t.includes("influenza")) {
    if (t.includes("up to date")) extracted.vac_flu = "Up to Date";
    else if (t.includes("overdue")) extracted.vac_flu = "Overdue";
    else if (t.includes("declined")) extracted.vac_flu = "Declined";
  }
  if (t.includes("pneumococcal") || t.includes("pneumo") || t.includes("prevnar") || t.includes("pneumovax")) {
    if (t.includes("complete")) extracted.vac_pneumo = "Complete (PCV/PPSV)";
    else if (t.includes("partial")) extracted.vac_pneumo = "Partial";
    else if (t.includes("overdue")) extracted.vac_pneumo = "Overdue";
    else if (t.includes("declined")) extracted.vac_pneumo = "Declined";
  }
  if (t.includes("rsv")) {
    if (t.includes("received")) extracted.vac_rsv = "Eligible - Received";
    else if (t.includes("not received")) extracted.vac_rsv = "Eligible - Not Received";
    else if (t.includes("not eligible") || t.includes("not yet eligible")) extracted.vac_rsv = "Not Yet Eligible";
  }
  if (t.includes("covid")) {
    if (t.includes("up to date")) extracted.vac_covid = "Up to Date";
    else if (t.includes("overdue")) extracted.vac_covid = "Overdue";
    else if (t.includes("declined")) extracted.vac_covid = "Declined";
  }
  if (t.includes("nkda") || t.includes("no known drug allergies") || t.includes("no drug allergies")) {
    extracted.alg_meds = "NKDA (No Known Drug Allergies)";
  } else {
    const algMatch = text.match(/(?:drug\s*allergies|allergies\s*\(meds\))\s*(?:are|is|:)?\s*([^.]+)/i);
    if (algMatch) extracted.alg_meds = algMatch[1].trim();
  }
  const envMatch = text.match(/(?:environmental\s*triggers?\s*(?:include)?|triggers?\s*(?:are|include)?)\s*([^.]+)/i);
  if (envMatch) extracted.alg_env = envMatch[1].trim();

  // Surgical & Thoracic History
  if (t.includes("no prior thoracic") || t.includes("no prior lung surgery") || t.includes("no lung surgery")) {
    extracted.surg_lung = "No";
  } else if (t.includes("lobectomy") || t.includes("lung surgery")) {
    extracted.surg_lung = "Yes";
  }
  if (t.includes("no lung volume reduction") || t.includes("no lvrs")) {
    extracted.surg_lvrs = "No";
  } else if (t.includes("endobronchial valves")) {
    extracted.surg_lvrs = "Yes (Endobronchial Valves)";
  } else if (t.includes("lung volume reduction") || t.includes("lvrs")) {
    extracted.surg_lvrs = "Yes (Surgical)";
  }
  if (t.includes("no lung transplant")) {
    extracted.surg_tx = "No";
  } else if (t.includes("lung transplant")) {
    extracted.surg_tx = "Yes";
  }
  if (t.includes("no prior thoracentesis") || t.includes("no chest tube") || t.includes("no thoracentesis")) {
    extracted.surg_pleural = "No";
  } else if (t.includes("thoracentesis") || t.includes("chest tube")) {
    extracted.surg_pleural = "Yes";
  }

  // Family History
  if (t.includes("family history of hereditary lung disease is no") || t.includes("no family history") || t.includes("family history ... no")) {
    extracted.fam_lung = "No";
  } else if (t.includes("family history of lung") || t.includes("family history")) {
    extracted.fam_lung = "Yes";
  }

  // Chief Presenting Reason
  const ccMatch = text.match(/(?:chief\s*presenting\s*reason|chief\s*complaint|presenting\s*complaint|patient\s*presents\s*with)\s*(?:is|:)?\s*([^.]+?(?:\.|$))/i);
  if (ccMatch) extracted.chief_complaint = ccMatch[0].trim();

  // Inhaler Adherence
  if (t.includes("adherence") || t.includes("technique")) {
    if (t.includes("good")) extracted.med_adherence = "Good";
    else if (t.includes("fair") || t.includes("inconsistent")) extracted.med_adherence = "Fair/Inconsistent";
    else if (t.includes("poor technique")) extracted.med_adherence = "Poor Technique";
    else if (t.includes("poor adherence")) extracted.med_adherence = "Poor Adherence";
  }

  // Onboarding & Demographics (if dictated here or in intake)
  const nameMatch = text.match(/(?:patient\s*(?:full\s*)?name\s*(?:is|:)?)\s*([a-zA-Z\s]+?)(?:,|\.|\band\b|female|male|mrn|dob|date)/i);
  if (nameMatch) extracted.pt_name = nameMatch[1].trim();

  const mrnMatch = text.match(/(?:mrn|medical\s*record\s*number)\s*(?:is|:)?\s*([a-zA-Z0-9\-]+)/i);
  if (mrnMatch) extracted.pt_mrn = mrnMatch[1].trim();

  if (t.includes("female")) extracted.pt_sex = "Female";
  else if (t.includes("male")) extracted.pt_sex = "Male";

  if (t.includes("south asian")) extracted.pt_ethnicity = "South Asian";
  if (t.includes("malayalam")) extracted.pt_language = "Malayalam / English";

  const phoneMatch = text.match(/(?:contact\s*(?:telephone\s*)?(?:number)?|phone)\s*(?:is|:)?\s*(\+?[\d\s\-]{8,15})/i);
  if (phoneMatch) extracted.pt_contact = phoneMatch[1].trim();

  const emailMatch = text.match(/([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/i);
  if (emailMatch) extracted.pt_email = emailMatch[1].trim();

  if (t.includes("outpatient")) extracted.pulm_encounter_type = "Outpatient Clinic";
  else if (t.includes("emergency")) extracted.pulm_encounter_type = "Emergency Department";
  else if (t.includes("inpatient") || t.includes("admitted")) extracted.pulm_encounter_type = "Admitted (Inpatient)";

  if (t.includes("shortness of breath") || t.includes("dyspnea")) extracted.pulm_visit_reason = "Shortness of Breath (Dyspnea)";

  const refMatch = text.match(/(?:referred\s*by)\s*(?:is|:)?\s*(dr\.?\s+[a-zA-Z\s]+?)(?:,|\.|\band\b|for|the|\()/i);
  if (refMatch) extracted.pulm_referred_by = refMatch[1].trim();

  const ecMatch = text.match(/(?:emergency\s*contact.*?is\s*(?:her\s*son|his\s*son|her\s*daughter|son|daughter)?\,?\s*)([a-zA-Z\s]+?)(?:,|\.|\bcontact\b|\bnumber\b)/i);
  if (ecMatch) {
    extracted.pt_ec_name = ecMatch[1].trim();
    extracted.pt_poa_name = ecMatch[1].trim();
  }
  if (t.includes("son")) {
    extracted.pt_ec_relation = "Son";
    extracted.pt_poa_relation = "Son";
  }
  const ecNumMatch = text.match(/(?:emergency\s*contact.*?number\s*(?:is|:)?)\s*(\+?[\d\s\-]{8,15})/i);
  if (ecNumMatch) {
    extracted.pt_ec_number = ecNumMatch[1].trim();
    extracted.pt_poa_number = ecNumMatch[1].trim();
  }

  if (t.includes("star health")) extracted.pt_payer_primary = "Star Health Senior Citizen Red Carpet";
  if (t.includes("verified")) extracted.pt_coverage_status = "Verified";
  if (t.includes("approved")) extracted.pt_auth_status = "Approved";

  if (t.includes("housing is stable") || t.includes("stable housing")) extracted.sdoh_housing = "Stable";
  if (t.includes("environment quality is good") || t.includes("good environment")) extracted.sdoh_environment = "Good";
  if (t.includes("adequate hvac")) extracted.sdoh_hvac = "Adequate HVAC";
  if (t.includes("food security is secure") || t.includes("secure food")) extracted.sdoh_food = "Secure";
  if (t.includes("transportation access is reliable") || t.includes("reliable transport")) extracted.sdoh_transport = "Reliable";
  if (t.includes("retired") && !extracted.sdoh_employment) extracted.sdoh_employment = "Retired";
  if (t.includes("high school")) extracted.sdoh_education = "High School Graduate";
  if (t.includes("adequate health literacy") || t.includes("adequate literacy")) extracted.sdoh_literacy = "Adequate";
  if (t.includes("strong social support") || t.includes("strong support")) extracted.sdoh_support = "Strong (Lives with family)";

  if (t.includes("never smoked")) {
    extracted.lifestyle_smoking = "Never Smoked";
    extracted.lifestyle_pack_years = 0;
  }
  if (t.includes("never vaped")) extracted.lifestyle_vaping = "Never";
  if (t.includes("marijuana") && t.includes("none")) extracted.lifestyle_thc = "None";
  if (t.includes("alcohol") && t.includes("none")) extracted.lifestyle_alcohol = "None";
  if (t.includes("drug") && t.includes("none")) extracted.lifestyle_drugs = "None";
  if (t.includes("retired homemaker")) extracted.lifestyle_occupation = "Retired Homemaker (Biomass smoke exposure)";
  if (t.includes("farming") || t.includes("organic dust")) extracted.lifestyle_exposures = "Farming/Organic Dust";
  if (t.includes("pets") && t.includes("none")) extracted.lifestyle_pets = "None";

  const docMatch = text.match(/(?:attending\s*pulmonologist|\bpulmonologist\b)\s*(?:is|:)?\s*(dr\.?\s+[a-zA-Z\s]+?)(?:,|\.|\band\b|respiratory)/i);
  if (docMatch) extracted.team_pulmonologist = docMatch[1].trim();

  const rtMatch = text.match(/(?:respiratory\s*therapist|\brt\b)\s*(?:is|:)?\s*([a-zA-Z\s]+?)(?:,|\.|\band\b|pulmonary)/i);
  if (rtMatch) extracted.team_rt = rtMatch[1].trim();

  const nurseMatch = text.match(/(?:pulmonary\s*nurse|\bnurse\b)\s*(?:is|:)?\s*([a-zA-Z\s]+?)(?:,|\.|\band\b|social)/i);
  if (nurseMatch) extracted.team_nurse = nurseMatch[1].trim();

  const swMatch = text.match(/(?:social\s*worker|\bmsw\b)\s*(?:is|:)?\s*([a-zA-Z\s]+?)(?:,|\.|\band\b|end)/i);
  if (swMatch) extracted.team_social_worker = swMatch[1].trim();

  // Sedation and Procedure Operative Records
  if (!extracted.mon_obs_gcs) {
    const gcsMatch = t.match(/gcs\s*(?:is|of|at|=)?\s*(\d{1,2})/);
    if (gcsMatch) extracted.mon_obs_gcs = gcsMatch[1] === "15" ? "15 (Alert & Oriented)" : gcsMatch[1];
  }

  if (!extracted.mon_obs_aldrete) {
    const aldreteMatch = t.match(/aldrete\s*(?:score)?\s*(?:is|of|at|=)?\s*(\d{1,2})/);
    if (aldreteMatch) {
      if (aldreteMatch[1] === "10") extracted.mon_obs_aldrete = "10 (Full Recovery - Discharge Ready)";
      else if (aldreteMatch[1] === "9") extracted.mon_obs_aldrete = "9 (Clear to Step-Down Unit)";
      else if (aldreteMatch[1] === "8") extracted.mon_obs_aldrete = "8 (PACU Recovery Required)";
      else extracted.mon_obs_aldrete = "< 8 (Continuous Monitoring Required)";
    }
  }

  if (!extracted.mon_drain_output_ml) {
    const drainMatch = t.match(/(?:chest\s*drain|drain|chest\s*tube)\s*(?:output)?\s*(?:is|of|at|=)?\s*(\d{1,4})\s*(?:ml|cc)?/);
    if (drainMatch) extracted.mon_drain_output_ml = drainMatch[1];
  }

  const opMatch = text.match(/(?:operator|pulmonologist|physician|technologist|performed by|prescribing clinician|clinician)\s*(?:is|was|:)?\s*(dr\.?\s+[a-z\s]+?)(?:,|\.|\band\b|$)/i);
  if (opMatch) {
    const docName = opMatch[1].trim();
    extracted.proc_operator = docName;
    extracted.nivtitr_operator = docName;
  }

  const preopMatch = t.match(/pre-?operative\s*diagnosis\s*(?:is|was|:)?\s*([^.]+)/i);
  if (preopMatch) extracted.proc_preop_diag = preopMatch[1].trim();

  const postopMatch = t.match(/post-?operative\s*diagnosis\s*(?:is|was|:)?\s*([^.]+)/i);
  if (postopMatch) extracted.proc_postop_diag = postopMatch[1].trim();

  const procDateMatch = t.match(/(?:procedure\s*date|proc\s*date|session\s*date)\s*(?:is|of|:)?\s*(\d{4}-\d{2}-\d{2})/);
  if (procDateMatch) {
    extracted.proc_date = procDateMatch[1];
    extracted.nivtitr_date = procDateMatch[1];
  }

  const startTimeMatch = t.match(/start\s*time\s*(?:is|at|:)?\s*(\d{1,2}:\d{2})/);
  if (startTimeMatch) extracted.proc_time_start = startTimeMatch[1];

  const endTimeMatch = t.match(/end\s*time\s*(?:is|at|:)?\s*(\d{1,2}:\d{2})/);
  if (endTimeMatch) extracted.proc_time_end = endTimeMatch[1];

  if (t.includes("right lung") || t.includes("right-sided") || t.includes("right sided") || t.includes("right pleural") || t.includes("right side")) {
    extracted.proc_side = "Right";
  } else if (t.includes("left lung") || t.includes("left-sided") || t.includes("left sided") || t.includes("left pleural") || t.includes("left side")) {
    extracted.proc_side = "Left";
  } else if (t.includes("bilateral")) {
    extracted.proc_side = "Bilateral";
  } else if (t.includes("bipap") || t.includes("niv") || t.includes("titration") || t.includes("pft") || t.includes("central airway")) {
    extracted.proc_side = "N/A (Central Airway / PFT)";
  }

  if (t.includes("conscious sedation") || t.includes("midazolam")) extracted.proc_anaesthesia = "Conscious Sedation (Midazolam + Fentanyl)";
  else if (t.includes("local topical") || t.includes("topical 2%") || t.includes("lidocaine")) extracted.proc_anaesthesia = "Local Topical Spray (Lidocaine 2-4%)";
  else if (t.includes("general anaesthesia") || t.includes("general anesthesia")) extracted.proc_anaesthesia = "General Anaesthesia with ETT";
  else if (t.includes("non-invasive") || t.includes("noninvasive") || t.includes("bipap") || t.includes("niv")) extracted.proc_anaesthesia = "None / Non-invasive";

  if (t.includes("consent") || t.includes("procedure") || t.includes("titration") || t.includes("bipap") || t.includes("performed")) {
    extracted.proc_consent = "Yes";
    extracted.proc_risk_disc = "Yes";
    extracted.chk_id = true;
    extracted.chk_consent = true;
    extracted.chk_site = true;
    extracted.chk_allergies = true;
    extracted.chk_anticoag = true;
    extracted.chk_iv = true;
    extracted.chk_o2 = true;
    extracted.chk_timeout = true;
  }
  if (t.includes("timeout") || t.includes("time-out") || t.includes("time out")) {
    extracted.chk_timeout = true;
  }
  if (t.includes("sitting upright") || t.includes("sitting position")) extracted.proc_position = "Sitting upright (Standard PFT / Thora)";
  else if (t.includes("supine")) extracted.proc_position = "Supine (Bronchoscopy / PDT)";

  const fluidVolMatch = t.match(/(?:fluid\s*(?:removed|evacuated|drained)|aspirated)\s*(?:is|of|was|:)?\s*(\d{2,4})\s*(?:ml|cc)/i);
  if (fluidVolMatch) {
    extracted.thora_fluid_removed_ml = fluidVolMatch[1];
    extracted.thora_volume_ml = fluidVolMatch[1];
  }
  const balReturnMatch = t.match(/(?:return\s*fluid|aspirated\s*return|bal\s*return)\s*(?:is|of|was|:)?\s*(\d{2,3})\s*(?:ml|cc)/i);
  if (balReturnMatch) extracted.bronch_return_ml = balReturnMatch[1];

  // Procedure Dictation Mapping (Bronchoscopy, Pleural, Airway)
  const isProcedureSection = String(section || "").toLowerCase().includes("procedure") ||
    String(section || "").toLowerCase().includes("bronch") ||
    t.includes("bronchoscopy") || t.includes("thoracentesis") || t.includes("chest tube");

  if (isProcedureSection) {
    if (!extracted.proc_notes) extracted.proc_notes = text.trim();
    if (!extracted.proc_findings) extracted.proc_findings = text.trim();
    
    if (t.includes("bronch") || t.includes("airway") || t.includes("hemoptysis") || String(section).toLowerCase().includes("bronch")) {
      extracted.bronch_notes_live = text.trim();
      
      if (t.includes("hemoptysis") || t.includes("hemorrhage") || t.includes("airway bleeding")) {
        extracted.bronch_indication = "Hemoptysis evaluation and source identification";
      } else if (t.includes("diagnostic bal") || t.includes("pneumonia")) {
        extracted.bronch_indication = "Diagnostic BAL — immunocompromised pneumonia / opportunistic infection";
      } else if (t.includes("mass") || t.includes("biopsy") || t.includes("lesion")) {
        extracted.bronch_indication = "Endobronchial mass biopsy / airway inspection";
      } else if (t.includes("ebus") || t.includes("lymphadenopathy")) {
        extracted.bronch_indication = "Mediastinal lymphadenopathy staging (EBUS-TBNA)";
      }

      if (t.includes("large-bore") || t.includes("large working channel") || t.includes("therapeutic")) {
        extracted.bronch_scope_type = "Therapeutic large working channel scope";
      } else if (t.includes("flexible") || t.includes("video-bronchoscope")) {
        extracted.bronch_scope_type = "Flexible diagnostic video-bronchoscope";
      } else if (t.includes("ebus")) {
        extracted.bronch_scope_type = "Convex-probe EBUS bronchoscope";
      }

      if (t.includes("oral") || t.includes("bite block")) {
        extracted.bronch_route = "Oral route via bite block";
      } else if (t.includes("nasal")) {
        extracted.bronch_route = "Nasal route";
      } else if (t.includes("endotracheal") || t.includes("ett")) {
        extracted.bronch_route = "Endotracheal tube in situ";
      }

      const nadirMatch = t.match(/(?:spo2\s*(?:nadir|lowest|dropped\s*to)|nadir\s*spo2)\s*(?:is|of|at|=)?\s*(\d{2})/i) ||
                         t.match(/spo2\s*(?:improved\s*to|at|is|=)\s*(\d{2})/i);
      if (nadirMatch) extracted.bronch_spo2_nadir = nadirMatch[1];

      if (t.includes("balloon tamponade") || t.includes("blocker") || t.includes("severe hemoptysis") || t.includes(">100 ml")) {
        extracted.bronch_bleeding_grade = "Severe (>100 mL — selective intubation / ICU transfer)";
        extracted.bronch_complications = "Bleeding (see grading below)";
      } else if (t.includes("moderate hemoptysis") || t.includes("50-100 ml")) {
        extracted.bronch_bleeding_grade = "Moderate (50–100 mL — topical adrenaline / balloon wedge)";
        extracted.bronch_complications = "Bleeding (see grading below)";
      } else if (t.includes("mild hemoptysis") || t.includes("<50 ml")) {
        extracted.bronch_bleeding_grade = "Mild (<50 mL — resolved with suction / cold saline)";
      } else if (t.includes("no procedure-related") || t.includes("no complication") || t.includes("hemostasis achieved")) {
        extracted.bronch_complications = "None";
      }

      if (t.includes("lesion") || t.includes("friable") || t.includes("mass")) {
        extracted.bronch_endobronchial_lesion = true;
      }

      extracted.bronch_consent = true;
      extracted.bronch_recovery_stable = true;
      extracted.bronch_post_cxr_ordered = true;

      const opMatch = text.match(/(?:operator|pulmonologist|physician|performed by)\s*(?:is|was|:)?\s*(dr\.?\s+[a-z\s]+?)(?:,|\.|\band\b|$)/i);
      if (opMatch) {
        extracted.bronch_performed_by = opMatch[1].trim();
      } else {
        extracted.bronch_performed_by = "Dr. Arvind Ramesh, MD, FCCP";
      }
    }
  }

  // Clinical Symptoms Profile Checklist Extraction
  const syms = [];
  if (
    (t.includes("exertion") || t.includes("workout") || t.includes("exercise") || t.includes("walking")) &&
    (t.includes("shortness of breath") || t.includes("dyspnea") || t.includes("breathless") || t.includes("sob"))
  ) {
    syms.push("dyspnea_exertional");
  }
  if (t.includes("at rest") && (t.includes("shortness of breath") || t.includes("dyspnea") || t.includes("sob"))) {
    syms.push("dyspnea_rest");
  }
  if (t.includes("cough") || t.includes("coughing")) syms.push("chronic_cough");
  if (t.includes("sputum") || t.includes("phlegm") || t.includes("mucus")) syms.push("sputum_production");
  if (t.includes("wheez") || t.includes("wheezing") || t.includes("wheezes")) syms.push("wheezing");
  if (t.includes("chest tight") || t.includes("tightness in chest") || t.includes("tight chest")) syms.push("chest_tightness");
  if ((t.includes("hemoptysis") || t.includes("blood in sputum") || t.includes("coughing blood")) && !t.includes("no hemoptysis") && !t.includes("negative for hemoptysis") && !t.includes("denies hemoptysis")) {
    syms.push("hemoptysis");
  }
  if (t.includes("orthopnea") && !t.includes("no orthopnea") && !t.includes("negative for orthopnea")) syms.push("orthopnea");
  if ((t.includes("pnd") || t.includes("paroxysmal nocturnal")) && !t.includes("no pnd") && !t.includes("negative for pnd")) syms.push("pnd");
  if (t.includes("daytime somnolence") || t.includes("daytime sleepiness") || t.includes("drowsy")) syms.push("daytime_somnolence");
  if (t.includes("snoring") && !t.includes("no snoring") && !t.includes("denies snoring")) syms.push("snoring");
  if (t.includes("fatigue") || t.includes("tiredness") || t.includes("exhaustion")) syms.push("fatigue");
  if ((t.includes("weight loss") || t.includes("lost weight")) && !t.includes("no weight loss")) syms.push("weight_loss");

  if (syms.length > 0) {
    const symMap = {};
    syms.forEach((s) => { symMap[s] = true; });
    extracted.pulm_symptoms = symMap;
  }

  // Clinical Respiratory Medications & Inhalers Checklist Extraction
  const meds = [];
  if (t.includes("albuterol") || t.includes("salbutamol") || t.includes("saba") || t.includes("proair") || t.includes("ventolin")) meds.push("saba");
  if (t.includes("ipratropium") || t.includes("atrovent") || t.includes("sama")) meds.push("sama");
  if (t.includes("fluticasone") || t.includes("budesonide") || t.includes("flovent") || t.includes("pulmicort") || t.includes("ics") || t.includes("inhaled steroid")) meds.push("ics");
  if (t.includes("salmeterol") || t.includes("formoterol") || t.includes("laba")) meds.push("laba");
  if (t.includes("tiotropium") || t.includes("spiriva") || t.includes("lama")) meds.push("lama");
  if (t.includes("triple therapy") || t.includes("trelegy") || t.includes("breztri")) meds.push("triple_therapy");
  if (t.includes("prednisone") || t.includes("oral steroid") || t.includes("methylprednisolone")) meds.push("oral_steroids");
  if (t.includes("biologic") || t.includes("omalizumab") || t.includes("xolair") || t.includes("dupilumab") || t.includes("dupixent") || t.includes("nucala") || t.includes("fasenra")) meds.push("biologics");
  if (t.includes("azithromycin") || t.includes("macrolide")) meds.push("macrolides");
  if (t.includes("roflumilast") || t.includes("daliresp") || t.includes("pde4")) meds.push("pde4_inhibitor");
  if (
    (t.includes("home oxygen") || t.includes("supplemental oxygen") || t.includes("nasal cannula") || t.includes("o2 at home")) &&
    !t.includes("not on home oxygen") && !t.includes("no home oxygen") && !t.includes("not on oxygen") && !t.includes("no supplemental oxygen")
  ) {
    meds.push("home_oxygen");
  }

  if (meds.length > 0) {
    const medMap = {};
    meds.forEach((m) => { medMap[m] = true; });
    extracted.pulm_meds = medMap;
  }

  // =========================================================================
  // DISCHARGE & CLINICAL DISPOSITION SECTION EXTRACTION
  // =========================================================================
  // 1. Functional Baseline & Discharge Ambulatory Status
  if (t.includes("wheelchair")) extracted.disp_functional_status = "Wheelchair dependent";
  else if (t.includes("bedbound") || t.includes("bed-bound") || t.includes("caregiver burden")) extracted.disp_functional_status = "Bedbound / High caregiver burden";
  else if (t.includes("cane") || t.includes("walker") || t.includes("needs assistance")) extracted.disp_functional_status = "Needs Assistance (Cane/Walker)";
  else if (t.includes("independent") || t.includes("community ambulator") || t.includes("ambulating well") || t.includes("ambulates independently")) extracted.disp_functional_status = "Independent / Community ambulator";

  if (t.includes("elevator")) extracted.disp_home_stairs = "Elevator accessible";
  else if (t.includes("multiple flights")) extracted.disp_home_stairs = "Multiple flights of stairs";
  else if (t.includes("flight of stairs") || t.includes("stairs without ramp")) extracted.disp_home_stairs = "Flight of stairs without ramp";
  else if (t.includes("no stairs") || t.includes("single level") || t.includes("ground floor") || t.includes("single story")) extracted.disp_home_stairs = "No stairs / Single level home";

  // 2. Discharge Destination & Transport
  if (t.includes("home health") || t.includes("home with home health") || t.includes("visiting nurse")) extracted.disp_destination = "Home with Home Health (Nursing / RT)";
  else if (t.includes("skilled nursing") || t.includes("snf")) extracted.disp_destination = "Skilled Nursing Facility (SNF)";
  else if (t.includes("ltach") || t.includes("long term acute care") || t.includes("long-term acute")) extracted.disp_destination = "Long-Term Acute Care Hospital (LTACH)";
  else if (t.includes("rehab facility") || t.includes("irf") || t.includes("inpatient rehab")) extracted.disp_destination = "Inpatient Rehabilitation Facility (IRF)";
  else if (t.includes("hospice")) extracted.disp_destination = "Home Hospice / Palliative Care";
  else if (t.includes("transfer to icu") || t.includes("higher acuity") || t.includes("transfer to higher")) extracted.disp_destination = "Transfer to Higher Acuity / ICU";
  else if (t.includes("home") || t.includes("self-care") || t.includes("discharge home") || t.includes("discharged home")) extracted.disp_destination = "Home (Self-Care)";

  if (t.includes("wheelchair van")) extracted.disp_transport_mode = "Wheelchair Van Service";
  else if (t.includes("als ambulance") || t.includes("ventilator transport")) extracted.disp_transport_mode = "Ambulance (ALS with Ventilator/NIV)";
  else if (t.includes("ambulance") || t.includes("bls")) extracted.disp_transport_mode = "Ambulance (BLS with Supplemental O2)";
  else if (t.includes("family transport") || t.includes("private vehicle") || t.includes("car") || t.includes("self transport") || t.includes("family car") || t.includes("self / family")) extracted.disp_transport_mode = "Self / Family Transport (Private Vehicle)";

  if (t.includes("portable tank") || t.includes("portable o2") || t.includes("o2 cylinder") || t.includes("on oxygen for transport")) extracted.disp_transport_o2 = "Continuous O2 via portable tank";
  else if (t.includes("transport ventilator") || t.includes("transport niv") || t.includes("ventilator")) extracted.disp_transport_o2 = "Continuous NIV / Mechanical ventilator";
  else if (t.includes("room air") || t.includes("no transport o2") || t.includes("no o2 required")) extracted.disp_transport_o2 = "Room air — No O2 required";

  // 3. Durable Medical Equipment (DME) Orders
  if (t.includes("high-flow concentrator") || t.includes("10l concentrator") || t.includes("10 lpm concentrator")) extracted.disp_dme_o2_concentrator = "Ordered — High-Flow Concentrator (10L/min)";
  else if (t.includes("stationary concentrator") || t.includes("home oxygen concentrator") || t.includes("concentrator ordered") || t.includes("oxygen concentrator")) extracted.disp_dme_o2_concentrator = "Ordered — Stationary Concentrator (5L/min)";
  else if (t.includes("already has concentrator") || t.includes("patient has concentrator")) extracted.disp_dme_o2_concentrator = "Patient Already Has Stationary Unit";

  if (t.includes("e-cylinder") || t.includes("e cylinder") || t.includes("cylinders")) extracted.disp_dme_o2_portable = "E-Cylinders with Conserving Regulator";
  else if (t.includes("portable oxygen concentrator") || t.includes("poc")) extracted.disp_dme_o2_portable = "Portable Oxygen Concentrator (POC)";
  else if (t.includes("liquid oxygen")) extracted.disp_dme_o2_portable = "Liquid Oxygen Unit";
  else if (t.includes("already has portable")) extracted.disp_dme_o2_portable = "Patient Already Has Portable O2";

  if (t.includes("bipap s/t") || t.includes("bipap machine") || t.includes("home bipap") || t.includes("niv device")) extracted.disp_dme_niv_device = "Ordered — BiPAP S/T Home Machine";
  else if (t.includes("auto-cpap") || t.includes("cpap machine") || t.includes("cpap")) extracted.disp_dme_niv_device = "Ordered — Auto-CPAP Machine";
  else if (t.includes("avaps")) extracted.disp_dme_niv_device = "Ordered — AVAPS Device";
  else if (t.includes("already has device") || t.includes("already has bipap")) extracted.disp_dme_niv_device = "Patient Already Has Device";

  if (t.includes("full face mask") || t.includes("ffm")) extracted.disp_dme_niv_mask = "Full Face Mask (Size M)";
  else if (t.includes("nasal mask")) extracted.disp_dme_niv_mask = "Nasal Mask (Size M)";
  else if (t.includes("nasal pillows")) extracted.disp_dme_niv_mask = "Nasal Pillows";

  if (t.includes("mesh nebulizer") || t.includes("portable nebulizer")) extracted.disp_dme_nebulizer = "Ordered — Portable Mesh Nebulizer";
  else if (t.includes("tabletop nebulizer") || t.includes("compressor nebulizer") || t.includes("nebulizer ordered") || t.includes("home nebulizer")) extracted.disp_dme_nebulizer = "Ordered — Tabletop Compressor Nebulizer";

  if (t.includes("four-wheel rollator") || t.includes("rollator")) extracted.disp_dme_mobility_aid = "Four-Wheel Rollator with Seat";
  else if (t.includes("walker")) extracted.disp_dme_mobility_aid = "Standard Walker";
  else if (t.includes("wheelchair")) extracted.disp_dme_mobility_aid = "Lightweight Wheelchair";
  else if (t.includes("cane")) extracted.disp_dme_mobility_aid = "Single-Point Cane";

  // 4. Follow-up Appointments & Referrals
  const followupPulmMatch = t.match(/(?:chest\s*clinic|pulmonology\s*follow-?up|pulm\s*follow-?up|see\s*pulmonologist)\s*(?:in|on|at|date)?\s*(\d{4}-\d{2}-\d{2})/i);
  if (followupPulmMatch) {
    extracted.disp_followup_pulm_date = followupPulmMatch[1];
  } else if (t.includes("pulm in 2 weeks") || t.includes("pulmonology in 2 weeks") || t.includes("follow-up in 2 weeks") || t.includes("follow up in 2 weeks")) {
    const d14 = new Date();
    d14.setDate(d14.getDate() + 14);
    extracted.disp_followup_pulm_date = d14.toISOString().split("T")[0];
  }

  const clinicMatch = text.match(/(?:pulmonology\s*clinic|chest\s*clinic|follow-?up\s*location)\s*(?:is|at|:)?\s*([a-zA-Z0-9\s,–-]+?)(?:,|\.|\band\b|pcp|$)/i);
  if (clinicMatch) extracted.disp_followup_pulm_clinic = clinicMatch[1].trim();

  const followupPcpMatch = t.match(/(?:pcp\s*follow-?up|primary\s*care\s*follow-?up)\s*(?:in|on|at|date)?\s*(\d{4}-\d{2}-\d{2})/i);
  if (followupPcpMatch) {
    extracted.disp_followup_pcp_date = followupPcpMatch[1];
  } else if (t.includes("pcp in 1 week") || t.includes("primary care in 1 week") || t.includes("pcp within 7 days") || t.includes("primary care in 7 days")) {
    const d7 = new Date();
    d7.setDate(d7.getDate() + 7);
    extracted.disp_followup_pcp_date = d7.toISOString().split("T")[0];
  }

  const pcpDocMatch = text.match(/(?:pcp\s*physician|pcp\s*doctor|primary\s*care\s*physician|pcp)\s*(?:is|:)?\s*(dr\.?\s+[a-zA-Z\s]+?)(?:,|\.|\band\b|$)/i);
  if (pcpDocMatch) extracted.disp_followup_pcp_name = pcpDocMatch[1].trim();

  // Specialist Referrals
  if (t.includes("pulmonary rehab") || t.includes("pulmonary rehabilitation")) extracted.disp_ref_rehab = true;
  if (t.includes("sleep medicine") || t.includes("sleep study") || t.includes("polysomnography")) extracted.disp_ref_sleep = true;
  if (t.includes("palliative care") || t.includes("palliative consult")) extracted.disp_ref_palliative = true;
  if (t.includes("thoracic surgery") || t.includes("thoracic consult")) extracted.disp_ref_thoracic = true;
  if (t.includes("transplant referral") || t.includes("lung transplant program")) extracted.disp_ref_tx = true;
  if (t.includes("smoking cessation")) extracted.disp_ref_smoking = true;

  // 5. Patient & Caregiver Education
  if (t.includes("primary caregiver present") || t.includes("wife present") || t.includes("husband present") || t.includes("family present") || t.includes("caregiver present")) {
    extracted.disp_caregiver_present = "Yes — Primary Caregiver Present";
  } else if (t.includes("lives alone") || t.includes("patient independent") || t.includes("no caregiver")) {
    extracted.disp_caregiver_present = "No — Patient Independent";
  }

  if (t.includes("teach-back") || t.includes("teach back") || t.includes("understanding verified") || t.includes("return demo") || t.includes("verbal understanding")) {
    extracted.disp_teach_back_confirmed = true;
  }
  if (t.includes("fire safety") || t.includes("oxygen safety") || t.includes("o2 safety")) {
    extracted.disp_edu_o2_safety = true;
  }
  if (t.includes("action plan") || t.includes("copd action plan") || t.includes("asthma action plan")) {
    extracted.disp_edu_action_plan = true;
  }
  if (t.includes("emergency contact") || t.includes("emergency numbers") || t.includes("triage line")) {
    extracted.disp_edu_contacts = true;
  }
  if (t.includes("inhaler technique") || t.includes("spacer verified") || t.includes("inhaler teaching")) {
    extracted.disp_med_teaching_done = true;
    extracted.disp_med_inhaler_proficiency = "Demonstrated Adequate Inhalation Technique";
  }

  // 6. Prognosis & Follow-Up Interval
  if (t.includes("good prognosis") || t.includes("high potential") || t.includes("prognosis good")) {
    extracted.disp_summary_prognosis = "Good — High potential for outpatient functional recovery";
  } else if (t.includes("guarded prognosis") || t.includes("guarded")) {
    extracted.disp_summary_prognosis = "Guarded — Vulnerable to recurrent exacerbations; strict inhaler adherence required";
  } else if (t.includes("progressive decline") || t.includes("advanced disease")) {
    extracted.disp_summary_prognosis = "Progressive Decline — Advanced pulmonary disease; home oxygen dependent";
  } else if (t.includes("palliative prognosis")) {
    extracted.disp_summary_prognosis = "Palliative — Symptom management & comfort-focused care";
  }

  if (t.includes("urgent follow-up") || t.includes("7-10 days") || t.includes("7 to 10 days")) {
    extracted.disp_summary_followup_interval = "Urgent: 7–10 days post-discharge (Post-exacerbation clinic)";
  } else if (t.includes("routine follow-up") || t.includes("2-4 weeks") || t.includes("2 to 4 weeks") || t.includes("routine 2-4")) {
    extracted.disp_summary_followup_interval = "Routine: 2–4 weeks (Outpatient Pulmonology Clinic)";
  } else if (t.includes("specialist follow-up") || t.includes("6-8 weeks") || t.includes("repeat pft")) {
    extracted.disp_summary_followup_interval = "Specialist: 6–8 weeks with repeat Spirometry / PFT";
  }

  // 7. Care Team Attestation & Sign-Off
  if (t.includes("attestation") || t.includes("sign off") || t.includes("signed off") || t.includes("approved discharge") || t.includes("attested")) {
    extracted.disp_consultant_attestation = true;
    extracted.disp_sign_attending_check = true;
    extracted.disp_sign_fellow_check = true;
    extracted.disp_sign_rt_check = true;
    extracted.disp_sign_attending_time = new Date().toISOString();
    extracted.disp_sign_fellow_time = new Date().toISOString();
    extracted.disp_sign_rt_time = new Date().toISOString();
  }

  return extracted;
}

const VoiceDictationPanel = ({ section = "Encounter", fields = [], onStructured, transformStructuredValues }) => {
  const { updateFields, sessionStatus, getFieldSpecs, applyDictatedData } = usePulmonology();
  const isReadOnly = sessionStatus === "completed";
  const [transcript, setTranscript] = useState("");
  const [isRecording, setIsRecording] = useState(false);
  const [isTranscribing, setIsTranscribing] = useState(false);
  const [isStructuring, setIsStructuring] = useState(false);
  const [message, setMessage] = useState("");
  const recorderRef = useRef(null);
  const chunksRef = useRef([]);

  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const recorder = new MediaRecorder(stream);
      recorderRef.current = recorder;
      chunksRef.current = [];
      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) chunksRef.current.push(event.data);
      };
      recorder.start();
      setMessage("");
      setIsRecording(true);
    } catch (error) {
      console.error("Unable to access microphone:", error);
      setMessage("Microphone access was denied or is unavailable on this device.");
    }
  };

  const stopRecording = () => {
    const recorder = recorderRef.current;
    if (!recorder || !isRecording) return;
    recorder.onstop = async () => {
      setIsRecording(false);
      setIsTranscribing(true);
      try {
        const audio = new Blob(chunksRef.current, { type: "audio/webm" });
        const result = await transcribePulmonologyAudio(audio);
        const text = result?.text || result?.transcription || "";
        if (!text) throw new Error("The transcription service returned no text");
        setTranscript((previous) => (previous ? `${previous} ${text}` : text));
        setMessage("Audio transcribed successfully. Review the transcript, then click AI Auto-fill.");
      } catch (error) {
        console.warn("Audio transcription service notice:", error.message);
        setMessage("Audio transcription unavailable or service offline. You can also paste or type clinical text directly.");
      } finally {
        setIsTranscribing(false);
      }
    };
    recorder.stop();
    recorder.stream.getTracks().forEach((track) => track.stop());
  };

  const autofill = async () => {
    if (!transcript.trim()) return;
    setIsStructuring(true);
    setMessage("");

    let values = {};
    // Dynamic on-screen field discovery matching Neurology architecture:
    // If specific fields are passed use them, otherwise dynamically query currently mounted FormFields on screen
    const dynamicFields =
      fields && fields.length > 0
        ? fields
        : getFieldSpecs
          ? getFieldSpecs()
          : [];

    try {
      // 1. Attempt backend dynamic LLM structuring first
      const result = await structurePulmonologyDictation({ text: transcript, fields: dynamicFields, section });
      const rawValues = result?.data || {};
      values = transformStructuredValues ? transformStructuredValues({ values: rawValues, transcript }) : rawValues;
    } catch (error) {
      console.warn("Backend LLM structuring request failed, using local clinical fallback:", error.message);
    }

    // 2. Supplement / fallback with local smart regex extractor
    const localExtracted = extractPulmonologyLocalDictation(transcript, section);
    const cleanedRawValues = {};
    Object.entries(values).forEach(([k, v]) => {
      if (v !== undefined && v !== null && v !== "") cleanedRawValues[k] = v;
    });
    values = { ...cleanedRawValues, ...localExtracted };

    if (Object.keys(values).length > 0) {
      if (applyDictatedData) {
        applyDictatedData(values);
      } else {
        updateFields(values);
      }
      if (onStructured) onStructured({ values, transcript });
      const count = Object.keys(values).length;
      setMessage(`Successfully auto-filled ${count} clinical field${count === 1 ? "" : "s"}. Please review values before saving.`);
    } else {
      setMessage("No matching fields were recognized in the provided dictation. Try specifying key terms (e.g. FEV1 48%, SpO2 92%, Heart rate 84).");
    }

    setIsStructuring(false);
  };

  return (
    <div
      style={{
        border: "1px solid #d0d0d0",
        background: "#fafafa",
        padding: "12px 16px",
        marginBottom: "16px",
        borderRadius: "2px",
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "8px" }}>
        <div style={{ fontSize: "11px", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em", color: "#111" }}>
          Voice Dictation &amp; AI Auto-Fill · {section}
        </div>
        <span style={{ fontSize: "10.5px", color: "#666" }}>
          Speech-to-text with intelligent field mapping
        </span>
      </div>

      <textarea
        value={transcript}
        onChange={(event) => setTranscript(event.target.value)}
        disabled={isReadOnly || isRecording || isTranscribing || isStructuring}
        placeholder={`Type or dictate clinical notes for ${section.toLowerCase()} here...`}
        rows={3}
        style={{
          width: "100%",
          boxSizing: "border-box",
          border: "1px solid #d0d0d0",
          padding: "8px 10px",
          fontSize: "12px",
          resize: "vertical",
          marginBottom: "8px",
          fontFamily: "inherit",
        }}
      />

      <div style={{ display: "flex", gap: "10px", alignItems: "center", flexWrap: "wrap" }}>
        <button
          type="button"
          onClick={isRecording ? stopRecording : startRecording}
          disabled={isReadOnly || isTranscribing || isStructuring}
          style={{
            border: "1px solid #000000",
            background: isRecording ? "#b42318" : "#000000",
            color: "#ffffff",
            padding: "6px 14px",
            cursor: isReadOnly ? "not-allowed" : "pointer",
            fontSize: "11.5px",
            fontWeight: 600,
          }}
        >
          {isTranscribing ? "Transcribing..." : isRecording ? "Stop Dictation" : "Start Dictation"}
        </button>

        <button
          type="button"
          onClick={autofill}
          disabled={isReadOnly || !transcript.trim() || isRecording || isTranscribing || isStructuring}
          style={{
            border: "1px solid #000000",
            background: "#ffffff",
            color: "#000000",
            padding: "6px 14px",
            cursor: isReadOnly || !transcript.trim() ? "not-allowed" : "pointer",
            fontSize: "11.5px",
            fontWeight: 600,
          }}
        >
          {isStructuring ? "Extracting..." : "AI Auto-fill Fields"}
        </button>

        {transcript && (
          <button
            type="button"
            onClick={() => {
              setTranscript("");
              setMessage("");
            }}
            disabled={isRecording || isTranscribing || isStructuring}
            style={{
              border: "none",
              background: "none",
              color: "#888888",
              cursor: "pointer",
              fontSize: "11px",
              textDecoration: "underline",
            }}
          >
            Clear Transcript
          </button>
        )}

        {message && (
          <span
            style={{
              fontSize: "11px",
              fontWeight: 500,
              color: message.includes("failed") || message.includes("denied") || message.includes("unavailable") ? "#b42318" : "#2e7d32",
            }}
          >
            {message}
          </span>
        )}
      </div>
    </div>
  );
};

export default VoiceDictationPanel;
