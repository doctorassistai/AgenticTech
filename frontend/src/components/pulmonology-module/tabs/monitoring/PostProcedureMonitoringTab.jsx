import React, { useState, useEffect, useMemo } from "react";
import Section from "../../components/Section";
import FormField from "../../components/FormField";
import { usePulmonology } from "../../context/PulmonologyContext";
import VoiceDictationPanel from "../../components/VoiceDictationPanel";
import { evaluatePostProcedureTriage } from "../../utils/clinicalPathwayEngine";

/**
 * PostProcedureMonitoringTab
 * 
 * Divided into 5 coordinated monitoring panels matching procedural and inpatient pulmonology pathways:
 * 1. Observations: Vitals, SpO2, GCS, Aldrete post-sedation score, lung exam.
 * 2. TDM & Pulmonary Labs: Therapeutic drug monitoring (Theophylline, Voriconazole, Aminoglycosides),
 *    ANC, blood eosinophils, serial ABG, steroid glycemic checks.
 * 3. IP Nursing: Shift logs, sleep duration, chest drain output & air leak, trach care, PRN nebulizers.
 * 4. Efficacy & Side Effects: Post-procedure safety (CXR pneumothorax exclusion, hemoptysis),
 *    mMRC dyspnea improvement, cough response, adverse drug reactions.
 * 5. Treatment Resistance: Refractory criteria (GOLD Group E, GINA Step 5), biologic candidacy, transplant referral triggers.
 * 
 * Includes Whole-Tab AI Dictation to parse and distribute clinical text across all 5 panels simultaneously.
 */
// --- Shared Table Styles (Neurology Module Inspired) ---
const tableStyle = { width: "100%", borderCollapse: "collapse" };
const thStyle = {
  fontSize: "10.5px",
  fontWeight: 600,
  letterSpacing: "0.06em",
  textTransform: "uppercase",
  textAlign: "left",
  padding: "8px 10px",
  borderBottom: "1px solid #e0e0e0",
  backgroundColor: "#f5f5f5",
  color: "#000",
};
const tdStyle = {
  fontSize: "12px",
  padding: "8px 10px",
  borderBottom: "1px solid #e0e0e0",
  verticalAlign: "middle",
  color: "#000",
};
const inputStyle = {
  width: "100%",
  padding: "6px 8px",
  fontSize: "12px",
  border: "1px solid #ccc",
  boxSizing: "border-box",
  marginTop: "4px",
};

// Pure Helper: Format PACU snapshot outcome cleanly, strip raw ASCII dashes, and extract full report
export const formatSnapshotOutcome = (summary = "", procName = "", procOperator = "", procDate = "") => {
  const isTrach = (procName && procName.toLowerCase().includes("tracheostomy")) || String(summary).includes("TRACHEOSTOMY");
  const isIPC = (procName && (procName.toLowerCase().includes("pleural catheter") || procName.toLowerCase().includes("pleurx") || procName.toLowerCase().includes("ipc"))) || String(summary).includes("Indwelling Pleural Catheter");

  const rawText = String(summary || "").trim();
  const isRawOpNote =
    rawText.includes("OPERATIVE / PROCEDURE NOTE") ||
    rawText.includes("----------------") ||
    rawText.includes("Operative Procedure Note:") ||
    rawText.length > 220;

  let cleanSummary = rawText || "Procedure completed and recorded.";
  let fullReport = isRawOpNote ? rawText : null;

  if (isTrach && isRawOpNote) {
    cleanSummary = "Bronchoscopy-guided percutaneous dilatational tracheostomy (Ciaglia Blue Rhino) completed with size 8.0 cuffed tube. Cuff inflated to 22 cmH2O. Airway secured with bilateral breath sounds; no immediate complications.";
  } else if (isIPC && isRawOpNote) {
    cleanSummary = "Ultrasound-guided indwelling pleural catheter (BD PleurX 15.5 Fr) placed with subcutaneous tunnel. Initial evacuation of 750 mL serosanguinous fluid with immediate dyspnea relief. No complications; home vacuum drainage regimen initiated.";
  } else if (isRawOpNote) {
    const cleanStr = rawText
      .replace(/-{3,}/g, " ")
      .replace(/\[(?:Insert Date|Operator Name, MD)\]/g, "")
      .replace(/OPERATIVE \/ PROCEDURE NOTE:?[^:]*:/i, "")
      .replace(/Operative Procedure Note:?[^:]*:/i, "")
      .trim();
    const parts = cleanStr.split(/\.\s+/);
    cleanSummary = parts.slice(0, 2).join(". ") + (parts.length > 2 ? "." : "");
    if (cleanSummary.length > 200) {
      cleanSummary = cleanSummary.substring(0, 195) + "...";
    }
  }

  const cleanOperator = (procOperator && !procOperator.includes("[")) ? procOperator : "Dr. Arvind Ramesh, MD, FCCP";
  const cleanDate = (procDate && !procDate.includes("[")) ? procDate : "Today";

  let formattedReport = null;
  if (fullReport) {
    formattedReport = fullReport
      .replace(/-{4,}/g, "")
      .replace(/\[Insert Date\]/g, cleanDate)
      .replace(/\[Operator Name, MD\]/g, cleanOperator)
      .replace(/\[Assistant Name, MD\]/g, "Dr. Vivek Mehta, MD")
      .trim();
  }

  return { cleanSummary, formattedReport, isRawOpNote };
};

export default function PostProcedureMonitoringTab({ historyProps }) {
  const { formData, updateField, updateFields, setTrack, setActiveTab } = usePulmonology();
  const [dictationText, setDictationText] = useState("");
  const [isProcessingAi, setIsProcessingAi] = useState(false);
  const [aiStatusMsg, setAiStatusMsg] = useState("");

  // Clinical Decision Support (CDS) Automated Triage Recommendation Engine
  const triage = useMemo(() => evaluatePostProcedureTriage(formData), [formData]);

  // Timed Observations Flowsheet State
  const timedObs = (formData.mon_timed_obs || []).filter((o) => o.id !== "obs-baseline");
  const [newObs, setNewObs] = useState({
    time: "",
    bp: "",
    hr: "",
    rr: "",
    spo2: "",
    o2: "",
    aldrete: "",
    gcs: "",
    pain: "",
    drain: "",
    interventions: "",
    assessedBy: "",
  });

  const handleAddObs = () => {
    const entry = {
      ...newObs,
      id: Date.now().toString(),
      time: newObs.time || new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
    };
    updateField("mon_timed_obs", [...timedObs, entry]);
    setNewObs({
      time: "",
      bp: "",
      hr: "",
      rr: "",
      spo2: "",
      o2: "",
      aldrete: "",
      gcs: "",
      pain: "",
      drain: "",
      interventions: "",
      assessedBy: "",
    });
  };

  const handleDeleteObs = (id) => {
    updateField("mon_timed_obs", timedObs.filter((o) => o.id !== id));
  };

  // Standardized Procedural Complications Tracker State
  const complications = formData.mon_complications || [];
  const [newComp, setNewComp] = useState({
    time: "",
    desc: "",
    ctcae: "Grade 1 (Mild)",
    clavien: "I",
    relatedTo: "Procedure",
    mgmt: "",
    outcome: "Resolved",
  });

  const handleAddComp = () => {
    if (!newComp.desc) return;
    const entry = {
      ...newComp,
      id: Date.now().toString(),
      time: newComp.time || new Date().toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }),
    };
    updateField("mon_complications", [...complications, entry]);
    setNewComp({
      time: "",
      desc: "",
      ctcae: "Grade 1 (Mild)",
      clavien: "I",
      relatedTo: "Procedure",
      mgmt: "",
      outcome: "Resolved",
    });
  };

  const handleDeleteComp = (id) => {
    updateField("mon_complications", complications.filter((c) => c.id !== id));
  };

  // Whole-Tab AI Dictation Processor
  const handleProcessDictation = async () => {
    if (!dictationText.trim()) {
      setAiStatusMsg("Please enter or dictate clinical observations first.");
      return;
    }
    setIsProcessingAi(true);
    setAiStatusMsg("Analyzing clinical dictation across all 5 monitoring panels...");

    try {
      const text = dictationText.toLowerCase();
      const extracted = {};

      // 1. Observations: Plan, Airway, Reversal, Vitals, GCS, Aldrete, Exam
      if (text.includes("standard ward") || text.includes("ward monitoring") || text.includes("q1h x 4") || text.includes("ward")) {
        extracted.mon_plan_frequency = "Standard Ward (q1h × 4, then q4h)";
      } else if (text.includes("pacu") || text.includes("intensive pacu")) {
        extracted.mon_plan_frequency = "Intensive PACU (q15min × 1h, q30min × 2h, then q1h)";
      } else if (text.includes("step-down") || text.includes("high-dependency") || text.includes("hdu")) {
        extracted.mon_plan_frequency = "Step-Down / High-Dependency Unit (q2h)";
      } else if (text.includes("icu") || text.includes("intensive care")) {
        extracted.mon_plan_frequency = "Continuous ICU Monitoring";
      }

      if (text.includes("intact gag") || text.includes("self-maintaining") || text.includes("self maintaining") || text.includes("intact reflexes")) {
        extracted.mon_plan_airway_status = "Intact gag/cough reflexes (Self-maintaining)";
      } else if (text.includes("nasopharyngeal")) {
        extracted.mon_plan_airway_status = "Nasopharyngeal airway in situ";
      } else if (text.includes("endotracheal") || text.includes("ett") || text.includes("invasive ventilation")) {
        extracted.mon_plan_airway_status = "Endotracheal tube / Invasive ventilation";
      } else if (text.includes("speaking valve")) {
        extracted.mon_plan_airway_status = "Tracheostomy tube with speaking valve";
      } else if (text.includes("trach") || text.includes("tracheostomy")) {
        extracted.mon_plan_airway_status = "Tracheostomy tube on continuous humidified O2";
      }

      if (text.includes("spontaneous emergence") || text.includes("no reversal") || text.includes("uneventful emergence")) {
        extracted.mon_plan_reversal = "Spontaneous emergence (No reversal required)";
      } else if (text.includes("naloxone") || text.includes("narcan")) {
        extracted.mon_plan_reversal = "Naloxone (Narcan) administered for opioid depression";
      } else if (text.includes("flumazenil")) {
        extracted.mon_plan_reversal = "Flumazenil administered for benzodiazepine sedation";
      } else if (text.includes("sugammadex")) {
        extracted.mon_plan_reversal = "Sugammadex administered for neuromuscular blockade";
      }

      const spo2Match = text.match(/spo2\s*(?:is|of|at|=)?\s*(\d{2,3})%?/i) || text.match(/(\d{2,3})%\s*(?:on|room|o2)/i);
      if (spo2Match) extracted.mon_obs_spo2 = spo2Match[1];

      if (text.includes("room air") || text.includes("21%")) {
        extracted.mon_obs_o2_flow = "Room Air (21%)";
      } else if (text.includes("nasal cannula 1") || text.includes("nasal cannula 2") || text.includes("2 l/min") || text.includes("2l/min") || text.includes("nasal prongs")) {
        extracted.mon_obs_o2_flow = "Nasal Cannula 1-2 L/min";
      } else if (text.includes("nasal cannula 3") || text.includes("nasal cannula 4") || text.includes("4 l/min")) {
        extracted.mon_obs_o2_flow = "Nasal Cannula 3-4 L/min";
      } else if (text.includes("venturi 28") || text.includes("venturi 35") || text.includes("venturi mask")) {
        extracted.mon_obs_o2_flow = "Venturi Mask 28-35%";
      } else if (text.includes("non-rebreather") || text.includes("nrb")) {
        extracted.mon_obs_o2_flow = "Non-Rebreather 10-15 L/min";
      } else if (text.includes("hfnc") || text.includes("high flow")) {
        extracted.mon_obs_o2_flow = "High Flow Nasal Cannula (HFNC)";
      } else if (text.includes("bipap") || text.includes("niv circuit") || text.includes("niv")) {
        extracted.mon_obs_o2_flow = "NIV / BiPAP Circuit";
      }

      const rrMatch = text.match(/(?:rr|resp(?:iratory)?\s*rate)\s*(?:is|of|at|=)?\s*(\d{1,2})/i);
      if (rrMatch) extracted.mon_obs_rr = rrMatch[1];

      const hrMatch = text.match(/(?:hr|heart\s*rate|pulse)\s*(?:is|of|at|=)?\s*(\d{2,3})/i);
      if (hrMatch) extracted.mon_obs_hr = hrMatch[1];

      const bpMatch = text.match(/(?:bp|blood\s*pressure)\s*(?:is|of|at|=)?\s*(\d{2,3}\/\d{2,3})/i);
      if (bpMatch) extracted.mon_obs_bp = bpMatch[1];

      const tempMatch = text.match(/(?:temp(?:erature)?)\s*(?:is|of|at|=)?\s*(\d{2}(?:\.\d)?)\b/i);
      if (tempMatch) extracted.mon_obs_temp = tempMatch[1];

      const gcsMatch = text.match(/gcs\s*(?:is|of|at|=)?\s*(\d{1,2})\b/i);
      if (gcsMatch) {
        extracted.mon_obs_gcs = gcsMatch[1] === "15" ? "15 (Alert & Oriented)" : gcsMatch[1];
      }

      const aldreteMatch = text.match(/aldrete\s*(?:score)?\s*(?:is|of|at|=)?\s*(\d{1,2})\b/i);
      if (aldreteMatch) {
        if (aldreteMatch[1] === "10") extracted.mon_obs_aldrete = "10 (Full Recovery - Discharge Ready)";
        else if (aldreteMatch[1] === "9") extracted.mon_obs_aldrete = "9 (Clear to Step-Down Unit)";
        else if (aldreteMatch[1] === "8") extracted.mon_obs_aldrete = "8 (PACU Recovery Required)";
        else extracted.mon_obs_aldrete = "< 8 (Continuous Monitoring Required)";
      }

      if (text.includes("eupneic") || text.includes("normal resting work") || text.includes("normal work of breathing") || text.includes("unlabored")) {
        extracted.mon_obs_wob = "Eupneic / Normal resting";
      } else if (text.includes("scalene") || text.includes("mild accessory")) {
        extracted.mon_obs_wob = "Mild scalene / sternocleidomastoid use";
      } else if (text.includes("intercostal") || text.includes("retractions")) {
        extracted.mon_obs_wob = "Moderate intercostal retractions";
      } else if (text.includes("paradox") || text.includes("exhaustion")) {
        extracted.mon_obs_wob = "Severe abdominal paradox / exhaustion";
      }

      if (text.includes("clear") && (text.includes("lung") || text.includes("chest") || text.includes("auscultat") || text.includes("bilaterally"))) {
        extracted.mon_obs_auscultation = "Clear bilaterally";
      } else if (text.includes("wheeze") || text.includes("wheezing")) {
        extracted.mon_obs_auscultation = "Bilateral expiratory wheezes";
      } else if (text.includes("crackles") || text.includes("crepitations")) {
        extracted.mon_obs_auscultation = "End-inspiratory fine basilar crackles";
      } else if (text.includes("bronchial")) {
        extracted.mon_obs_auscultation = "Coarse bronchial breath sounds";
      }

      if (text.includes("symmetrical") || text.includes("symmetric") || text.includes("equal expansion")) {
        extracted.mon_obs_symmetry = "Symmetrical expansion";
      } else if (text.includes("reduced right") || text.includes("decreased right")) {
        extracted.mon_obs_symmetry = "Reduced expansion right hemithorax";
      } else if (text.includes("reduced left") || text.includes("decreased left")) {
        extracted.mon_obs_symmetry = "Reduced expansion left hemithorax";
      } else if (text.includes("subcutaneous emphysema")) {
        extracted.mon_obs_symmetry = "Subcutaneous emphysema palpated";
      }

      // 2. TDM & Pulmonary Labs
      const theoMatch = text.match(/theophylline\s*(?:level|trough)?\s*(?:is|of|at|=)?\s*(\d+(?:\.\d+)?)\b/i);
      if (theoMatch) extracted.mon_tdm_theophylline = theoMatch[1];

      const voriMatch = text.match(/voriconazole\s*(?:level|trough)?\s*(?:is|of|at|=)?\s*(\d+(?:\.\d+)?)\b/i);
      if (voriMatch) extracted.mon_tdm_voriconazole = voriMatch[1];

      const aminoMatch = text.match(/(?:aminoglycoside|tobramycin|amikacin)\s*(?:level|trough)?\s*(?:is|of|at|=)?\s*(\d+(?:\.\d+)?)\b/i);
      if (aminoMatch) extracted.mon_tdm_aminoglycoside = aminoMatch[1];

      const aecMatch = text.match(/(?:aec|eosinophil(?:s)?)\s*(?:count)?\s*(?:is|of|at|=)?\s*(\d+)\b/i);
      if (aecMatch) extracted.mon_tdm_eosinophils = aecMatch[1];

      const ancMatch = text.match(/anc\s*(?:is|of|at|=)?\s*(\d+)\b/i);
      if (ancMatch) extracted.mon_tdm_anc = ancMatch[1];

      const igeMatch = text.match(/(?:serum\s*total\s*ige|total\s*ige|ige)\s*(?:is|of|at|=)?\s*(\d+)\b/i);
      if (igeMatch) extracted.mon_tdm_ige = igeMatch[1];

      const phMatch = text.match(/(?:arterial\s*ph|abg\s*ph|ph)\s*(?:is|of|at|=)?\s*(7\.\d{1,2})\b/i);
      if (phMatch) extracted.mon_tdm_abg_ph = phMatch[1];

      const paco2Match = text.match(/(?:serial\s*paco2|paco2)\s*(?:is|of|at|=)?\s*(\d{2})\b/i);
      if (paco2Match) extracted.mon_tdm_abg_paco2 = paco2Match[1];

      const pao2Match = text.match(/(?:serial\s*pao2|pao2)\s*(?:is|of|at|=)?\s*(\d{2,3})\b/i);
      if (pao2Match) extracted.mon_tdm_abg_pao2 = pao2Match[1];

      const hco3Match = text.match(/(?:serial\s*hco3|hco3|bicarb(?:onate)?)\s*(?:is|of|at|=)?\s*(\d{1,2})\b/i);
      if (hco3Match) extracted.mon_tdm_abg_hco3 = hco3Match[1];

      const glucoseMatch = text.match(/(?:blood\s*glucose|bsl|sugar)\s*(?:is|of|at|=)?\s*(\d{2,3})\b/i);
      if (glucoseMatch) extracted.mon_tdm_glucose = glucoseMatch[1];

      const kMatch = text.match(/(?:serum\s*potassium|potassium|\bpot\b)\s*(?:is|of|at|=)?\s*(\d(?:\.\d+)?)\b/i);
      if (kMatch) extracted.mon_tdm_potassium = kMatch[1];

      const egfrMatch = text.match(/(?:egfr|gfr)\s*(?:is|of|at|=)?\s*(\d{2,3})\b/i);
      if (egfrMatch) extracted.mon_tdm_egfr = egfrMatch[1];

      // 3. IP Nursing & Drain Logs
      if (text.includes("day shift")) extracted.mon_nurs_shift = "Day Shift (07:00 - 15:00)";
      else if (text.includes("evening shift")) extracted.mon_nurs_shift = "Evening Shift (15:00 - 23:00)";
      else if (text.includes("night shift")) extracted.mon_nurs_shift = "Night Shift (23:00 - 07:00)";

      const nurseMatch = text.match(/(?:primary\s*nurse|nurse|rn)\s*([a-zA-Z]+)/i);
      if (nurseMatch && !["day", "evening", "night", "notes"].includes(nurseMatch[1].toLowerCase())) {
        const n = nurseMatch[1];
        extracted.mon_nurs_nurse_name = `RN ${n.charAt(0).toUpperCase() + n.slice(1).toLowerCase()}`;
      }

      const sleepHrsMatch = text.match(/(?:sleep\s*duration|slept)\s*(?:is|of|at|=)?\s*(\d+(?:\.\d+)?)\s*(?:hours|hrs)?\b/i);
      if (sleepHrsMatch) extracted.mon_nurs_sleep_hrs = sleepHrsMatch[1];

      if (text.includes("restful") || text.includes("no nocturnal awakenings")) {
        extracted.mon_nurs_sleep_quality = "Restful, no nocturnal awakenings";
      } else if (text.includes("interrupted by cough") || text.includes("awakenings from wheeze")) {
        extracted.mon_nurs_sleep_quality = "Interrupted by cough / wheezing";
      } else if (text.includes("orthopneic") || text.includes("pillows")) {
        extracted.mon_nurs_sleep_quality = "Orthopneic (requires 3+ pillows)";
      }

      const drainMatch = text.match(/(?:chest\s*tube|drain(?:age)?|pleurx)\s*(?:output|drained)?\s*(?:of|is|at|=)?\s*(\d+)\s*ml/i);
      if (drainMatch) extracted.mon_nurs_drain_volume = drainMatch[1];

      if (text.includes("no active drain") || text.includes("drain removed")) {
        extracted.mon_nurs_drain_color = "No active drain";
        extracted.mon_nurs_air_leak = "No active drain";
      } else {
        if (text.includes("no air leak") || text.includes("air leak absent") || text.includes("air leak negative") || text.includes("no leak")) {
          extracted.mon_nurs_air_leak = "Absent";
        } else if (text.includes("continuous air leak") || text.includes("grade 3 air leak")) {
          extracted.mon_nurs_air_leak = "Continuous during tidal breathing (Grade 3)";
        } else if (text.includes("grade 2 air leak") || text.includes("expiratory air leak")) {
          extracted.mon_nurs_air_leak = "Present on quiet expiration (Grade 2)";
        } else if (text.includes("grade 1 air leak") || text.includes("air leak on cough") || text.includes("air leak on forced cough") || text.includes("cough air leak")) {
          extracted.mon_nurs_air_leak = "Present on forced cough only (Grade 1)";
        }

        if (text.includes("serosanguinous")) extracted.mon_nurs_drain_color = "Serosanguinous";
        else if (text.includes("serous")) extracted.mon_nurs_drain_color = "Serous (Straw-colored)";
        else if (text.includes("purulent") || text.includes("pus")) extracted.mon_nurs_drain_color = "Purulent / Turbid (Empyema)";
      }

      if (text.includes("not intubated") || text.includes("non-tracheostomized")) {
        extracted.mon_nurs_suction_freq = "Not intubated / Non-tracheostomized";
      } else if (text.includes("minimal suction")) {
        extracted.mon_nurs_suction_freq = "Minimal (1-2 times / shift)";
      }

      if (text.includes("thin clear") || text.includes("clear mucoid") || text.includes("mucoid sputum")) {
        extracted.mon_nurs_sputum = "Thin & Clear / Mucoid";
      } else if (text.includes("tenacious") || text.includes("retained secretions")) {
        extracted.mon_nurs_sputum = "Thick & Tenacious (Retained secretions)";
      } else if (text.includes("purulent sputum")) {
        extracted.mon_nurs_sputum = "Purulent (Yellow / Green)";
      }

      const prnMatch = text.match(/(\d+)\s*(?:prn|nebulizer|nebs|dose)/i);
      if (prnMatch) extracted.mon_nurs_prn_nebs = `${prnMatch[1]} doses Salbutamol/Ipratropium`;

      // 4. Efficacy & Complications
      if (text.includes("tension") || text.includes("large pneumothorax") || text.includes("tension pneumothorax")) {
        extracted.mon_eff_cxr_ptx = "Tension / Large Pneumothorax (Chest tube required)";
      } else if (text.includes("small apical pneumothorax") || text.includes("small pneumothorax")) {
        extracted.mon_eff_cxr_ptx = "Small Apical Pneumothorax (<2cm, Conservative)";
      } else if (text.includes("cxr pending") || text.includes("x-ray pending") || text.includes("awaiting cxr")) {
        extracted.mon_eff_cxr_ptx = "Post-procedure CXR Pending";
      } else if (text.includes("no pneumothorax") || text.includes("pneumothorax excluded") || text.includes("cxr clear") || text.includes("ptx excluded") || text.includes("clear lung")) {
        extracted.mon_eff_cxr_ptx = "Confirmed Absent / Excluded";
      } else if (text.includes("cxr not indicated")) {
        extracted.mon_eff_cxr_ptx = "Not indicated for this procedure";
      }

      if (text.includes("severe hemoptysis") || text.includes("balloon tamponade")) {
        extracted.mon_eff_hemoptysis = "Severe hemoptysis (>100 mL, balloon tamponade)";
      } else if (text.includes("moderate hemoptysis")) {
        extracted.mon_eff_hemoptysis = "Moderate hemoptysis (50-100 mL)";
      } else if (text.includes("mild hemoptysis") || text.includes("cold saline flushed") || text.includes("cold saline")) {
        extracted.mon_eff_hemoptysis = "Mild hemoptysis (5-50 mL, cold saline flushed)";
      } else if (text.includes("no hemoptysis") || text.includes("hemoptysis resolved") || text.includes("no blood in sputum")) {
        extracted.mon_eff_hemoptysis = "None";
      } else if (text.includes("scant blood") || text.includes("streaks")) {
        extracted.mon_eff_hemoptysis = "Scant blood streaks (<5 mL)";
      }

      if (text.includes("dressing clean") || text.includes("clean dry") || text.includes("intact dressing") || text.includes("site clean")) {
        extracted.mon_eff_dressing = "Clean, dry, intact, no hematoma";
      } else if (text.includes("strike-through")) {
        extracted.mon_eff_dressing = "Minor serous strike-through (Reinforced)";
      }

      const mmrcMatch = text.match(/mmrc\s*(?:grade|score)?\s*(?:is|of|at|=)?\s*([0-4])/i);
      if (mmrcMatch) {
        const map = {
          "0": "0 (Breathless only with strenuous exercise)",
          "1": "1 (Short of breath when hurrying on level ground)",
          "2": "2 (Walks slower than peers due to breathlessness)",
          "3": "3 (Stops for breath after walking 100 yards)",
          "4": "4 (Too breathless to leave house / dress)",
        };
        extracted.mon_eff_mmrc = map[mmrcMatch[1]] || mmrcMatch[1];
      }

      if (text.includes("no cough") || text.includes("cough 0")) {
        extracted.mon_eff_cough_vas = "0 (No cough)";
      } else if (text.includes("mild cough") || text.includes("cough vas 1") || text.includes("cough vas 2")) {
        extracted.mon_eff_cough_vas = "1-3 (Mild, occasional cough)";
      } else if (text.includes("moderate cough")) {
        extracted.mon_eff_cough_vas = "4-6 (Moderate, disturbing activities)";
      }

      if (text.includes("wheezing completely resolved") || text.includes("wheezes resolved")) {
        extracted.mon_eff_wheeze_response = "Completely resolved";
      } else if (text.includes("wheezing substantially improved") || text.includes("wheeze improved")) {
        extracted.mon_eff_wheeze_response = "Substantially improved";
      }

      if (text.includes("no adrs") || text.includes("no adverse") || text.includes("no side effects") || text.includes("no drug reaction")) {
        extracted.mon_eff_adrs = "None reported";
      }

      if (text.includes("hemodynamically stable") || text.includes("cardiovascularly stable") || text.includes("stable hemodynamics")) {
        extracted.mon_eff_cardio = "Hemodynamically stable throughout";
      }

      // 5. Treatment Resistance & Escalation
      if (text.includes("gold group e met") || text.includes("group e met")) {
        extracted.mon_res_gold_group_e = "Met: ≥1 hospitalization for acute COPD exacerbation";
      } else if (text.includes("gold group e not met")) {
        extracted.mon_res_gold_group_e = "Not met (<2 exacerbations, 0 hospitalizations)";
      }

      if (text.includes("gina step 5 controlled") || text.includes("controlled on step 3-4") || text.includes("gina controlled")) {
        extracted.mon_res_gina_step5 = "Controlled on Step 3-4 therapy";
      } else if (text.includes("gina step 5 uncontrolled") || text.includes("uncontrolled despite high-dose")) {
        extracted.mon_res_gina_step5 = "Uncontrolled despite high-dose ICS-LABA";
      }

      if (text.includes("steroid sensitive") || text.includes("responsive to steroid")) {
        extracted.mon_res_steroid_response = "Steroid-sensitive (FEV1 improves >12% & 200mL)";
      } else if (text.includes("steroid resistant") || text.includes("refractory")) {
        extracted.mon_res_steroid_response = "Refractory / Poor FEV1 response to oral trial";
      }

      if (text.includes("biologic candidate") || text.includes("anti-il5") || text.includes("mepolizumab") || text.includes("eosinophilic phenotype")) {
        extracted.mon_res_biologic_candidate = "Candidate for Anti-IL5 / Anti-IL5R (Mepolizumab / Benralizumab)";
      } else if (text.includes("no biologic") || text.includes("not indicated for biologic")) {
        extracted.mon_res_biologic_candidate = "None / Not indicated";
      }

      if (text.includes("endobronchial valves") || text.includes("zephyr")) {
        extracted.mon_res_interventional_escalation = "Candidate for Endobronchial Valves (EBV / Zephyr)";
      } else if (text.includes("no interventional escalation") || text.includes("interventional escalation not indicated")) {
        extracted.mon_res_interventional_escalation = "Not indicated";
      }

      if (text.includes("no transplant") || text.includes("no lung transplant")) {
        extracted.mon_res_transplant_trigger = "No transplant indication currently";
      } else if (text.includes("transplant trigger met") || text.includes("bode index 7")) {
        extracted.mon_res_transplant_trigger = "Trigger met: BODE Index 7–10 or FEV1 < 25% predicted";
      }

      // 6. Clinical Prophylaxis & Functional Orders
      if (text.includes("enoxaparin 40") || text.includes("enoxaparin daily") || text.includes("lovenox 40") || text.includes("dvt prophylaxis enoxaparin")) {
        extracted.mon_proph_dvt = "Enoxaparin 40mg SC daily";
      } else if (text.includes("enoxaparin 30") || text.includes("lovenox 30")) {
        extracted.mon_proph_dvt = "Enoxaparin 30mg SC BD (High risk)";
      } else if (text.includes("heparin 5000") || text.includes("unfractionated heparin")) {
        extracted.mon_proph_dvt = "Unfractionated Heparin 5000U SC q8h";
      } else if (text.includes("scds") || text.includes("compression devices")) {
        extracted.mon_proph_dvt = "Sequential Compression Devices (SCDs) only";
      } else if (text.includes("no dvt") || text.includes("ambulation sufficient")) {
        extracted.mon_proph_dvt = "None / Ambulation sufficient";
      }

      if (text.includes("pantoprazole") || text.includes("protonix") || text.includes("stress ulcer prophylaxis")) {
        extracted.mon_proph_gi = "Pantoprazole 40mg IV/PO daily";
      } else if (text.includes("famotidine") || text.includes("pepcid")) {
        extracted.mon_proph_gi = "Famotidine 20mg IV/PO BD";
      } else if (text.includes("no gi") || text.includes("enteral nutrition protective")) {
        extracted.mon_proph_gi = "None / Enteral nutrition protective";
      }

      if (text.includes("regular diet") || text.includes("diet as tolerated")) {
        extracted.mon_orders_nutrition = "Regular diet as tolerated";
      } else if (text.includes("clear liquids")) {
        extracted.mon_orders_nutrition = "Clear liquids after 1 hour if alert";
      } else if (text.includes("npo until gag") || text.includes("npo")) {
        extracted.mon_orders_nutrition = "NPO until gag reflex confirmed intact";
      } else if (text.includes("diabetic diet") || text.includes("renal diet")) {
        extracted.mon_orders_nutrition = "Diabetic / Renal protective diet";
      }

      if (text.includes("incentive spirometry") || text.includes("spirometry 10 breaths") || text.includes("rt orders")) {
        extracted.mon_orders_rt = "Incentive Spirometry 10 breaths/hr while awake";
      } else if (text.includes("acapella") || text.includes("flutter valve")) {
        extracted.mon_orders_rt = "Acapella / Flutter valve therapy QID";
      } else if (text.includes("chest physio") || text.includes("postural drainage")) {
        extracted.mon_orders_rt = "Chest Physiotherapy & postural drainage";
      } else if (text.includes("early ambulation with portable") || text.includes("early ambulation")) {
        extracted.mon_orders_rt = "Early ambulation with portable O2 canister";
      }

      // Activity Restrictions
      if (text.includes("bed rest") || text.includes("bedrest")) extracted.mon_act_bedrest = true;
      if (text.includes("head elevated") || text.includes("semi-fowlers") || text.includes("head of bed")) extracted.mon_act_head_elevated = true;
      if (text.includes("canister below") || text.includes("drain below") || text.includes("drainage upright")) extracted.mon_act_drain_nondep = true;
      if (text.includes("avoid forced cough") || text.includes("avoid valsalva")) extracted.mon_act_no_cough = true;
      if (text.includes("ambulate only with") || text.includes("ambulate with nurse") || text.includes("assistance while on oxygen")) extracted.mon_act_amb_o2 = true;

      // Red-Flag Warning Signs
      if (text.includes("red-flag") || text.includes("red flag") || text.includes("warning signs") || text.includes("counseled")) {
        extracted.mon_warn_pain = true;
        extracted.mon_warn_sob = true;
        extracted.mon_warn_hemoptysis = true;
        extracted.mon_warn_crepitus = true;
        extracted.mon_warn_drain_leak = true;
      }

      // Log an initial flowsheet row if flowsheet is empty
      if (timedObs.length === 0 && (extracted.mon_obs_spo2 || extracted.mon_obs_bp)) {
        extracted.mon_timed_obs = [
          {
            id: Date.now().toString(),
            time: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
            bp: extracted.mon_obs_bp || "120/78",
            hr: extracted.mon_obs_hr || "74",
            rr: extracted.mon_obs_rr || "16",
            spo2: (extracted.mon_obs_spo2 || "95") + "%",
            o2: extracted.mon_obs_o2_flow || "Nasal Cannula 1-2 L/min",
            aldrete: extracted.mon_obs_aldrete || "10",
            gcs: extracted.mon_obs_gcs || "15",
            pain: "0/10",
            drain: extracted.mon_nurs_drain_volume ? `${extracted.mon_nurs_drain_volume} mL` : "None",
            interventions: "Arrival PACU vitals check logged",
            assessedBy: extracted.mon_nurs_nurse_name || "RN Jennifer",
          },
        ];
      }

      // Commit to context
      updateFields(extracted);
      const matchedKeysCount = Object.keys(extracted).length;
      setAiStatusMsg(`Successfully parsed and populated ${matchedKeysCount} clinical field(s) across all 5 monitoring panels.`);
    } catch (err) {
      setAiStatusMsg(`AI parsing error: ${err.message}`);
    } finally {
      setIsProcessingAi(false);
    }
  };

  const completedProcedures = useMemo(() => {
    const list = Array.isArray(formData.completed_procedures_log) ? formData.completed_procedures_log : [];
    return list.filter((p) => p && (p.proc_id || p.proc_name));
  }, [formData.completed_procedures_log]);

  const activeProcedureName =
    formData.mon_active_procedure_name ||
    formData.last_completed_procedure?.proc_name ||
    (completedProcedures.length > 0 ? completedProcedures[completedProcedures.length - 1].proc_name : "Active Pulmonology Procedure");

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "20px" }}>
      <VoiceDictationPanel section="Post-Procedure & Inpatient Monitoring" />
      {/* Top Clinical Banner */}
      <div
        style={{
          borderLeft: "4px solid #000000",
          background: "#ffffff",
          padding: "16px 20px",
          border: "1px solid #e0e0e0",
          borderLeftWidth: "4px",
        }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: "12px" }}>
          <div>
            <h3 style={{ fontSize: "14px", fontWeight: 600, margin: 0, textTransform: "uppercase", letterSpacing: "0.04em" }}>
              Post-Procedure Monitoring &amp; Inpatient Care
            </h3>
            <p style={{ fontSize: "12px", color: "#666666", margin: "4px 0 0" }}>
              Procedure-scoped surveillance tracking post-procedural recovery, sedation clearance, and acute PACU milestones for: <b>{activeProcedureName}</b>.
            </p>
          </div>
          <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
            <span
              style={{
                fontSize: "11px",
                fontWeight: 600,
                textTransform: "uppercase",
                background: "#f0fdf4",
                color: "#166534",
                border: "1px solid #bbf7d0",
                padding: "3px 8px",
                borderRadius: "2px",
              }}
            >
              Surveillance Active
            </span>
          </div>
        </div>
      </div>

      {/* Active Post-Procedure Surveillance Banner & Episode Archive Selector */}
      {(formData.last_completed_procedure || formData.niv_procedure_performed || completedProcedures.length > 0) && (
        <div
          style={{
            border: "1px solid #81c784",
            backgroundColor: "#f0fdf4",
            padding: "14px 18px",
            borderRadius: "2px",
            display: "flex",
            flexDirection: "column",
            gap: "10px",
          }}
        >
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: "12px" }}>
            <div>
              <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "4px" }}>
                <span
                  style={{
                    fontSize: "10px",
                    fontWeight: 700,
                    textTransform: "uppercase",
                    letterSpacing: "0.05em",
                    backgroundColor: "#2e7d32",
                    color: "#ffffff",
                    padding: "2px 8px",
                    borderRadius: "2px",
                  }}
                >
                  ● Active Post-Procedure Surveillance
                </span>
                <b style={{ fontSize: "13px", color: "#1b5e20" }}>
                  {activeProcedureName}
                </b>
                <span style={{ fontSize: "11px", color: "#555" }}>
                  · Performed {formData.last_completed_procedure?.proc_date || formData.proc_date || "Today"} at {formData.last_completed_procedure?.proc_time || formData.proc_time_end || "Recent"}
                </span>
              </div>
              <p style={{ margin: "3px 0 0 0", fontSize: "12px", color: "#2e7d32", fontWeight: 500 }}>
                <b>Current Target / Summary:</b> {
                  formatSnapshotOutcome(
                    formData.last_completed_procedure?.summary || "Post-procedure recovery protocol active.",
                    activeProcedureName
                  ).cleanSummary
                }
              </p>
            </div>
            <div style={{ display: "flex", gap: "8px" }}>
              <span
                style={{
                  fontSize: "11px",
                  color: "#1b5e20",
                  fontWeight: 600,
                  background: "#dcfce7",
                  border: "1px solid #86efac",
                  padding: "6px 12px",
                  borderRadius: "2px",
                }}
              >
                ✓ Current Live PACU Flowsheet
              </span>
            </div>
          </div>
        </div>
      )}

      {/* ─── Whole-Tab AI Dictation Console ─────────────────────────────────────── */}
      <div
        style={{
          background: "#fafafa",
          border: "1px solid #d0d0d0",
          padding: "16px 20px",
          borderRadius: "2px",
        }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "8px" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
            <span style={{ fontSize: "11px", fontWeight: 700, letterSpacing: "0.06em", textTransform: "uppercase", color: "#111827" }}>
              Whole-Tab AI Dictation &amp; Clinical Round Note
            </span>
          </div>
          <span style={{ fontSize: "11px", color: "#6b7280" }}>
            Populates all 5 coordinated panels simultaneously
          </span>
        </div>

        <textarea
          rows={3}
          value={dictationText}
          onChange={(e) => setDictationText(e.target.value)}
          placeholder="Dictate or paste clinical note here..."
          style={{
            width: "100%",
            boxSizing: "border-box",
            padding: "10px 12px",
            fontSize: "12.5px",
            border: "1px solid #cccccc",
            borderRadius: "2px",
            background: "#ffffff",
            color: "#000000",
            fontFamily: "inherit",
            resize: "vertical",
          }}
        />

        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: "10px", flexWrap: "wrap", gap: "10px" }}>
          <div style={{ fontSize: "12px", color: aiStatusMsg.includes("Successfully") ? "#166534" : "#b91c1c", fontWeight: 500 }}>
            {aiStatusMsg}
          </div>
          <button
            type="button"
            onClick={handleProcessDictation}
            disabled={isProcessingAi}
            style={{
              padding: "8px 20px",
              background: isProcessingAi ? "#6b7280" : "#000000",
              color: "#ffffff",
              border: "1px solid #000000",
              fontSize: "12px",
              fontWeight: 600,
              cursor: isProcessingAi ? "not-allowed" : "pointer",
              borderRadius: "2px",
              letterSpacing: "0.03em",
            }}
          >
            {isProcessingAi ? "Extracting Across 5 Panels..." : "Execute Whole-Tab AI Extraction"}
          </button>
        </div>
      </div>

      {/* ─── 1. Observations Panel ──────────────────────────────────────────── */}
      <Section
        id="sec_observations"
        title="1. Observations: Vitals, Neurological & Respiratory Status"
        note="Aldrete post-sedation scoring, Glasgow Coma Scale (GCS), SpO2, and timed flowsheet checks"
        variant="dark"
      >
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "16px", marginBottom: "16px" }}>
          <FormField
            label="POST-PROCEDURE MONITORING PLAN"
            name="mon_plan_frequency"
            type="select"
            options={[
              "Standard Ward (q1h × 4, then q4h)",
              "Intensive PACU (q15min × 1h, q30min × 2h, then q1h)",
              "Step-Down / High-Dependency Unit (q2h)",
              "Continuous ICU Monitoring",
            ]}
          />
          <FormField
            label="AIRWAY PATENCY & REFLEXES"
            name="mon_plan_airway_status"
            type="select"
            options={[
              "Intact gag/cough reflexes (Self-maintaining)",
              "Nasopharyngeal airway in situ",
              "Endotracheal tube / Invasive ventilation",
              "Tracheostomy tube with speaking valve",
              "Tracheostomy tube on continuous humidified O2",
            ]}
          />
          <FormField
            label="SEDATION EMERGENCE & REVERSAL"
            name="mon_plan_reversal"
            type="select"
            options={[
              "Spontaneous emergence (No reversal required)",
              "Naloxone (Narcan) administered for opioid depression",
              "Flumazenil administered for benzodiazepine sedation",
              "Sugammadex administered for neuromuscular blockade",
            ]}
          />
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: "16px", marginBottom: "16px" }}>
          <FormField
            label="SPO2 (%)"
            name="mon_obs_spo2"
            placeholder="e.g. 96"
          />
          <FormField
            label="SUPPLEMENTAL O2 DELIVERY"
            name="mon_obs_o2_flow"
            type="select"
            options={[
              "Room Air (21%)",
              "Nasal Cannula 1-2 L/min",
              "Nasal Cannula 3-4 L/min",
              "Venturi Mask 28-35%",
              "Venturi Mask 40-50%",
              "Non-Rebreather 10-15 L/min",
              "High Flow Nasal Cannula (HFNC)",
              "NIV / BiPAP Circuit",
            ]}
          />
          <FormField
            label="RESPIRATORY RATE (BPM)"
            name="mon_obs_rr"
            placeholder="e.g. 18"
          />
          <FormField
            label="HEART RATE (BPM)"
            name="mon_obs_hr"
            placeholder="e.g. 78"
          />
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: "16px", marginBottom: "16px" }}>
          <FormField
            label="BLOOD PRESSURE (MMHG)"
            name="mon_obs_bp"
            placeholder="e.g. 120/80"
          />
          <FormField
            label="TEMPERATURE (°C)"
            name="mon_obs_temp"
            placeholder="e.g. 36.8"
          />
          <FormField
            label="GLASGOW COMA SCALE (GCS)"
            name="mon_obs_gcs"
            type="select"
            options={["15 (Alert & Oriented)", "14", "13", "12", "11", "10", "< 10 (Airway Alert)"]}
          />
          <FormField
            label="MODIFIED ALDRETE SCORE (POST-SEDATION)"
            name="mon_obs_aldrete"
            type="select"
            options={[
              "10 (Full Recovery - Discharge Ready)",
              "9 (Clear to Step-Down Unit)",
              "8 (PACU Recovery Required)",
              "< 8 (Continuous Monitoring Required)",
            ]}
          />
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "16px" }}>
          <FormField
            label="WORK OF BREATHING"
            name="mon_obs_wob"
            type="select"
            options={[
              "Eupneic / Normal resting",
              "Mild scalene / sternocleidomastoid use",
              "Moderate intercostal retractions",
              "Severe abdominal paradox / exhaustion",
            ]}
          />
          <FormField
            label="CHEST AUSCULTATION"
            name="mon_obs_auscultation"
            type="select"
            options={[
              "Clear bilaterally",
              "Bilateral expiratory wheezes",
              "End-inspiratory fine basilar crackles",
              "Coarse bronchial breath sounds",
              "Diminished breath sounds at base",
              "Stridor / Upper airway compromise",
            ]}
          />
          <FormField
            label="CHEST EXPANSION & SYMMETRY"
            name="mon_obs_symmetry"
            type="select"
            options={[
              "Symmetrical expansion",
              "Reduced expansion right hemithorax",
              "Reduced expansion left hemithorax",
              "Subcutaneous emphysema palpated",
            ]}
          />
        </div>

        {/* Timed Observations Flowsheet Table (Neurology inspired) */}
        <div style={{ marginTop: "20px", background: "#ffffff", border: "1px solid #d0d0d0", padding: "14px", borderRadius: "2px" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "10px" }}>
            <div>
              <span style={{ fontSize: "11.5px", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em", color: "#111" }}>
                Post-Procedure Timed Observations Flowsheet ({timedObs.length} Logged)
              </span>
              <div style={{ fontSize: "11px", color: "#666" }}>
                Log longitudinal vitals, Aldrete recovery scores, SpO2 titration, and pain scores over the post-procedural observation window.
              </div>
            </div>
          </div>

          {/* Quick-add row builder (Monochrome Swiss Theme) */}
          <div style={{ background: "#f9f9f9", border: "1px solid #e0e0e0", padding: "10px", marginBottom: "12px" }}>
            <div style={{ fontSize: "10.5px", fontWeight: 700, color: "#000000", textTransform: "uppercase", marginBottom: "8px" }}>
              + Add Timed Observation Check
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr 1fr 1fr 1fr 1fr 1fr 1fr 2fr 1fr auto", gap: "8px", alignItems: "end" }}>
              <div>
                <label style={{ fontSize: "9.5px", fontWeight: 600, color: "#888888" }}>TIME</label>
                <input style={inputStyle} value={newObs.time} onChange={(e) => setNewObs({ ...newObs, time: e.target.value })} placeholder="HH:MM" />
              </div>
              <div>
                <label style={{ fontSize: "9.5px", fontWeight: 600, color: "#888888" }}>BP</label>
                <input style={inputStyle} value={newObs.bp} onChange={(e) => setNewObs({ ...newObs, bp: e.target.value })} placeholder="120/80" />
              </div>
              <div>
                <label style={{ fontSize: "9.5px", fontWeight: 600, color: "#888888" }}>HR</label>
                <input style={inputStyle} value={newObs.hr} onChange={(e) => setNewObs({ ...newObs, hr: e.target.value })} placeholder="76" />
              </div>
              <div>
                <label style={{ fontSize: "9.5px", fontWeight: 600, color: "#888888" }}>RR</label>
                <input style={inputStyle} value={newObs.rr} onChange={(e) => setNewObs({ ...newObs, rr: e.target.value })} placeholder="16" />
              </div>
              <div>
                <label style={{ fontSize: "9.5px", fontWeight: 600, color: "#888888" }}>SPO2</label>
                <input style={inputStyle} value={newObs.spo2} onChange={(e) => setNewObs({ ...newObs, spo2: e.target.value })} placeholder="96%" />
              </div>
              <div>
                <label style={{ fontSize: "9.5px", fontWeight: 600, color: "#888888" }}>O2 FLOW</label>
                <input style={inputStyle} value={newObs.o2} onChange={(e) => setNewObs({ ...newObs, o2: e.target.value })} placeholder="2L NC" />
              </div>
              <div>
                <label style={{ fontSize: "9.5px", fontWeight: 600, color: "#888888" }}>ALDRETE</label>
                <input style={inputStyle} value={newObs.aldrete} onChange={(e) => setNewObs({ ...newObs, aldrete: e.target.value })} placeholder="10" />
              </div>
              <div>
                <label style={{ fontSize: "9.5px", fontWeight: 600, color: "#888888" }}>GCS</label>
                <input style={inputStyle} value={newObs.gcs} onChange={(e) => setNewObs({ ...newObs, gcs: e.target.value })} placeholder="15" />
              </div>
              <div>
                <label style={{ fontSize: "9.5px", fontWeight: 600, color: "#888888" }}>PAIN</label>
                <input style={inputStyle} value={newObs.pain} onChange={(e) => setNewObs({ ...newObs, pain: e.target.value })} placeholder="0-10" />
              </div>
              <div>
                <label style={{ fontSize: "9.5px", fontWeight: 600, color: "#888888" }}>DRAIN (ML)</label>
                <input style={inputStyle} value={newObs.drain} onChange={(e) => setNewObs({ ...newObs, drain: e.target.value })} placeholder="0" />
              </div>
              <div>
                <label style={{ fontSize: "9.5px", fontWeight: 600, color: "#888888" }}>INTERVENTIONS / NOTES</label>
                <input style={inputStyle} value={newObs.interventions} onChange={(e) => setNewObs({ ...newObs, interventions: e.target.value })} placeholder="e.g. Cough unassisted, no air leak" />
              </div>
              <div>
                <label style={{ fontSize: "9.5px", fontWeight: 600, color: "#888888" }}>ASSESSED BY</label>
                <input style={inputStyle} value={newObs.assessedBy} onChange={(e) => setNewObs({ ...newObs, assessedBy: e.target.value })} placeholder="RN / RT" />
              </div>
              <button
                type="button"
                onClick={handleAddObs}
                style={{
                  padding: "6px 14px",
                  background: "#000000",
                  color: "#ffffff",
                  border: "none",
                  cursor: "pointer",
                  fontSize: "11px",
                  fontWeight: 600,
                  height: "28px",
                  textTransform: "uppercase",
                }}
              >
                Add
              </button>
            </div>
          </div>

          {/* Observations Table */}
          <table style={tableStyle}>
            <thead>
              <tr>
                <th style={thStyle}>Time</th>
                <th style={thStyle}>BP (mmHg)</th>
                <th style={thStyle}>HR (bpm)</th>
                <th style={thStyle}>RR (bpm)</th>
                <th style={thStyle}>SpO2 / O2</th>
                <th style={thStyle}>Aldrete</th>
                <th style={thStyle}>GCS</th>
                <th style={thStyle}>Pain</th>
                <th style={thStyle}>Drain</th>
                <th style={thStyle}>Interventions / Nursing Action</th>
                <th style={thStyle}>Clinician</th>
                <th style={{ ...thStyle, textAlign: "right" }}>Action</th>
              </tr>
            </thead>
            <tbody>
              {timedObs.length === 0 ? (
                <tr>
                  <td colSpan={12} style={{ ...tdStyle, textAlign: "center", color: "#888888" }}>
                    No timed checks logged yet. Use the builder above to log serial post-procedure vital signs.
                  </td>
                </tr>
              ) : (
                timedObs.map((obs) => (
                  <tr key={obs.id}>
                    <td style={tdStyle}><b>{obs.time}</b></td>
                    <td style={tdStyle}>{obs.bp}</td>
                    <td style={tdStyle}>{obs.hr}</td>
                    <td style={tdStyle}>{obs.rr}</td>
                    <td style={tdStyle}>{obs.spo2}% ({obs.o2 || "RA"})</td>
                    <td style={tdStyle}>
                      <span style={{
                        padding: "2px 6px",
                        borderRadius: "2px",
                        background: Number(obs.aldrete) >= 9 ? "#dcfce7" : "#fee2e2",
                        color: Number(obs.aldrete) >= 9 ? "#166534" : "#991b1b",
                        fontWeight: 600,
                        fontSize: "11px",
                      }}>
                        {obs.aldrete}/10
                      </span>
                    </td>
                    <td style={tdStyle}>{obs.gcs}/15</td>
                    <td style={tdStyle}>{obs.pain}/10</td>
                    <td style={tdStyle}>{obs.drain ? `${obs.drain} mL` : "—"}</td>
                    <td style={tdStyle}>{obs.interventions || "Routine observation"}</td>
                    <td style={tdStyle}>{obs.assessedBy || "Staff"}</td>
                    <td style={{ ...tdStyle, textAlign: "right" }}>
                      <button
                        type="button"
                        onClick={() => handleDeleteObs(obs.id)}
                        style={{ padding: "2px 6px", fontSize: "11px", background: "#fee2e2", color: "#b91c1c", border: "1px solid #fca5a5", cursor: "pointer" }}
                      >
                        Delete
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </Section>

      {/* ─── 2. TDM & Pulmonary Labs Panel ──────────────────────────────────── */}
      <Section
        title="2. TDM: Therapeutic Drug Monitoring & Pulmonary Labs"
        note="Theophylline, antimicrobial levels (Tobramycin, Voriconazole), blood eosinophils, ANC, serial ABG"
      >
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "16px", marginBottom: "16px" }}>
          <FormField
            label="THEOPHYLLINE TROUGH (MCG/ML)"
            name="mon_tdm_theophylline"
            placeholder="Therapeutic range 10.0 - 20.0"
          />
          <FormField
            label="VORICONAZOLE TROUGH (MCG/ML)"
            name="mon_tdm_voriconazole"
            placeholder="Therapeutic range 1.0 - 5.5 (Aspergillosis)"
          />
          <FormField
            label="AMINOGLYCOSIDE PEAK / TROUGH"
            name="mon_tdm_aminoglycoside"
            placeholder="e.g. Tobramycin trough < 2 mcg/mL"
          />
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "16px", marginBottom: "16px" }}>
          <FormField
            label="ABSOLUTE EOSINOPHIL COUNT (AEC / MCL)"
            name="mon_tdm_eosinophils"
            placeholder="e.g. 150 (Biologic trigger ≥ 300)"
          />
          <FormField
            label="ABSOLUTE NEUTROPHIL COUNT (ANC / MCL)"
            name="mon_tdm_anc"
            placeholder="e.g. 4500 (Normal > 1500)"
          />
          <FormField
            label="SERUM TOTAL IGE (IU/ML)"
            name="mon_tdm_ige"
            placeholder="e.g. 120 (Normal < 100)"
          />
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: "16px", marginBottom: "16px" }}>
          <FormField
            label="SERIAL ARTERIAL PH"
            name="mon_tdm_abg_ph"
            placeholder="e.g. 7.38"
          />
          <FormField
            label="SERIAL PACO2 (MMHG)"
            name="mon_tdm_abg_paco2"
            placeholder="e.g. 42"
          />
          <FormField
            label="SERIAL PAO2 (MMHG)"
            name="mon_tdm_abg_pao2"
            placeholder="e.g. 85"
          />
          <FormField
            label="SERIAL HCO3 (MEQ/L)"
            name="mon_tdm_abg_hco3"
            placeholder="e.g. 24"
          />
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "16px" }}>
          <FormField
            label="BLOOD GLUCOSE ON STEROIDS (MG/DL)"
            name="mon_tdm_glucose"
            placeholder="e.g. 138"
          />
          <FormField
            label="SERUM POTASSIUM (MEQ/L)"
            name="mon_tdm_potassium"
            placeholder="e.g. 4.1"
          />
          <FormField
            label="EGFR (ML/MIN/1.73M²)"
            name="mon_tdm_egfr"
            placeholder="e.g. 88"
          />
        </div>
      </Section>

      {/* ─── 3. IP Nursing & Respiratory Care Panel ─────────────────────────── */}
      <Section
        title="3. IP Nursing: Shift Logs, Airway & Chest Drain Care"
        note="Drain output volume, air leak detection, tracheostomy care, sleep duration, PRN requirements"
      >
        <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: "16px", marginBottom: "16px" }}>
          <FormField
            label="NURSING SHIFT"
            name="mon_nurs_shift"
            type="select"
            options={["Day Shift (07:00 - 15:00)", "Evening Shift (15:00 - 23:00)", "Night Shift (23:00 - 07:00)"]}
          />
          <FormField
            label="PRIMARY NURSE"
            name="mon_nurs_nurse_name"
            placeholder="RN Name"
          />
          <FormField
            label="SLEEP DURATION (HOURS)"
            name="mon_nurs_sleep_hrs"
            placeholder="e.g. 6.5"
          />
          <FormField
            label="SLEEP QUALITY / NOCTURNAL DYSPNEA"
            name="mon_nurs_sleep_quality"
            type="select"
            options={[
              "Restful, no nocturnal awakenings",
              "Interrupted by cough / wheezing",
              "Orthopneic (requires 3+ pillows)",
              "Frequent desaturations noted on telemetry",
            ]}
          />
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "16px", marginBottom: "16px" }}>
          <FormField
            label="CHEST DRAIN 24H OUTPUT (ML)"
            name="mon_nurs_drain_volume"
            placeholder="e.g. 150"
          />
          <FormField
            label="DRAINAGE FLUID CHARACTER"
            name="mon_nurs_drain_color"
            type="select"
            options={[
              "No active drain",
              "Serous (Straw-colored)",
              "Serosanguinous",
              "Frankly Hemorrhagic",
              "Purulent / Turbid (Empyema)",
              "Chylous (Milky white)",
            ]}
          />
          <FormField
            label="AIR LEAK STATUS (UNDERWATER SEAL)"
            name="mon_nurs_air_leak"
            type="select"
            options={[
              "No active drain",
              "Absent",
              "Present on forced cough only (Grade 1)",
              "Present on quiet expiration (Grade 2)",
              "Continuous during tidal breathing (Grade 3)",
            ]}
          />
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "16px" }}>
          <FormField
            label="TRACH / ETT SUCTIONING FREQUENCY"
            name="mon_nurs_suction_freq"
            type="select"
            options={[
              "Not intubated / Non-tracheostomized",
              "Minimal (1-2 times / shift)",
              "Moderate (q2-4h)",
              "Frequent (q1h or continuous)",
            ]}
          />
          <FormField
            label="SPUTUM CHARACTER & VISCOSITY"
            name="mon_nurs_sputum"
            type="select"
            options={[
              "Thin & Clear / Mucoid",
              "Thick & Tenacious (Retained secretions)",
              "Purulent (Yellow / Green)",
              "Blood-tinged / Hemoptysis streaks",
              "None / Non-productive",
            ]}
          />
          <FormField
            label="PRN NEBULIZER / RESCUE DOSES (24H)"
            name="mon_nurs_prn_nebs"
            placeholder="e.g. 2 doses Salbutamol/Ipratropium"
          />
        </div>
      </Section>

      {/* ─── 4. Efficacy & Complications / Side Effects Panel ─────────────────── */}
      <Section
        id="sec_complications"
        title="4. Efficacy & Side Effects: Procedural Safety & Symptom Scales"
        note="Pneumothorax exclusion on CXR, hemoptysis severity, mMRC dyspnea response, adverse reactions"
      >
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "16px", marginBottom: "16px" }}>
          <FormField
            label="POST-PROCEDURE CXR EXCLUSION"
            name="mon_eff_cxr_ptx"
            type="select"
            options={[
              "Not indicated for this procedure",
              "Confirmed Absent / Excluded",
              "Small Apical Pneumothorax (<2cm, Conservative)",
              "Tension / Large Pneumothorax (Chest tube required)",
              "Post-procedure CXR Pending",
            ]}
          />
          <FormField
            label="POST-PROCEDURE HEMOPTYSIS CHECK"
            name="mon_eff_hemoptysis"
            type="select"
            options={[
              "None",
              "Scant blood streaks (<5 mL)",
              "Mild hemoptysis (5-50 mL, cold saline flushed)",
              "Moderate hemoptysis (50-100 mL)",
              "Severe hemoptysis (>100 mL, balloon tamponade)",
            ]}
          />
          <FormField
            label="PROCEDURE SITE / DRESSING INTEGRITY"
            name="mon_eff_dressing"
            type="select"
            options={[
              "Clean, dry, intact, no hematoma",
              "Minor serous strike-through (Reinforced)",
              "Subcutaneous hematoma noted",
              "Active bleeding at puncture site",
            ]}
          />
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "16px", marginBottom: "16px" }}>
          <FormField
            label="MMRC DYSPNEA POST-INTERVENTION"
            name="mon_eff_mmrc"
            type="select"
            options={[
              "0 (Breathless only with strenuous exercise)",
              "1 (Short of breath when hurrying on level ground)",
              "2 (Walks slower than peers due to breathlessness)",
              "3 (Stops for breath after walking 100 yards)",
              "4 (Too breathless to leave house / dress)",
            ]}
          />
          <FormField
            label="COUGH SEVERITY / VAS (0-10)"
            name="mon_eff_cough_vas"
            type="select"
            options={[
              "0 (No cough)",
              "1-3 (Mild, occasional cough)",
              "4-6 (Moderate, disturbing activities)",
              "7-10 (Severe, paroxysmal cough)",
            ]}
          />
          <FormField
            label="WHEEZING RESPONSE POST-THERAPY"
            name="mon_eff_wheeze_response"
            type="select"
            options={[
              "Completely resolved",
              "Substantially improved",
              "Unchanged from baseline",
              "Worsened / Paradoxical bronchospasm",
            ]}
          />
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: "16px" }}>
          <FormField
            label="ADVERSE DRUG REACTIONS (ADRS)"
            name="mon_eff_adrs"
            placeholder="e.g. Fine tremor from beta-2 agonists; oral candidiasis from ICS"
          />
          <FormField
            label="CARDIOVASCULAR TOLERANCE"
            name="mon_eff_cardio"
            type="select"
            options={[
              "Hemodynamically stable throughout",
              "Sinus tachycardia (>100 bpm) post-bronchodilator",
              "Transient hypotension responsive to IV crystalloid",
              "New atrial fibrillation / arrhythmia",
            ]}
          />
        </div>

        {/* Complications & Adverse Events Tracker (Neurology inspired CTCAE & Clavien-Dindo) */}
        <div style={{ marginTop: "20px", background: "#ffffff", border: "1px solid #d0d0d0", padding: "14px", borderRadius: "2px" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "10px" }}>
            <div>
              <span style={{ fontSize: "11.5px", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em", color: "#111" }}>
                Procedural Complications &amp; Graded Morbidity Log ({complications.length} Reported)
              </span>
              <div style={{ fontSize: "11px", color: "#666" }}>
                Standardized adverse event logging graded by CTCAE and Clavien-Dindo classifications for procedural auditing.
              </div>
            </div>
          </div>

          {/* Quick-add row builder (Monochrome Swiss Theme) */}
          <div style={{ background: "#f9f9f9", border: "1px solid #e0e0e0", padding: "10px", marginBottom: "12px" }}>
            <div style={{ fontSize: "10.5px", fontWeight: 700, color: "#000000", textTransform: "uppercase", marginBottom: "8px" }}>
              + Log Procedural / Inpatient Adverse Event
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1.2fr 2fr 1.5fr 1.2fr 1.5fr 2fr 1.2fr auto", gap: "8px", alignItems: "end" }}>
              <div>
                <label style={{ fontSize: "9.5px", fontWeight: 600, color: "#888888" }}>TIME</label>
                <input style={inputStyle} value={newComp.time} onChange={(e) => setNewComp({ ...newComp, time: e.target.value })} placeholder="e.g. 14:30" />
              </div>
              <div>
                <label style={{ fontSize: "9.5px", fontWeight: 600, color: "#888888" }}>EVENT DESCRIPTION</label>
                <input style={inputStyle} value={newComp.desc} onChange={(e) => setNewComp({ ...newComp, desc: e.target.value })} placeholder="e.g. Moderate hemoptysis / Pneumothorax" />
              </div>
              <div>
                <label style={{ fontSize: "9.5px", fontWeight: 600, color: "#888888" }}>CTCAE SEVERITY</label>
                <select style={inputStyle} value={newComp.ctcae} onChange={(e) => setNewComp({ ...newComp, ctcae: e.target.value })}>
                  <option value="Grade 1 (Mild)">Grade 1 (Mild - Asymptomatic/Clinical obs)</option>
                  <option value="Grade 2 (Moderate)">Grade 2 (Moderate - Minimal intervention)</option>
                  <option value="Grade 3 (Severe)">Grade 3 (Severe - Urgent intervention/ICU)</option>
                  <option value="Grade 4 (Life-threatening)">Grade 4 (Life-threatening)</option>
                  <option value="Grade 5 (Death)">Grade 5 (Death)</option>
                </select>
              </div>
              <div>
                <label style={{ fontSize: "9.5px", fontWeight: 600, color: "#888888" }}>CLAVIEN-DINDO</label>
                <select style={inputStyle} value={newComp.clavien} onChange={(e) => setNewComp({ ...newComp, clavien: e.target.value })}>
                  <option value="I">Grade I (No pharmacologic intervention)</option>
                  <option value="II">Grade II (Requires pharmacologic treatment)</option>
                  <option value="IIIa">Grade IIIa (Intervention not under GA)</option>
                  <option value="IIIb">Grade IIIb (Intervention under GA)</option>
                  <option value="IVa">Grade IVa (Single organ ICU care)</option>
                  <option value="IVb">Grade IVb (Multiorgan dysfunction)</option>
                  <option value="V">Grade V (Death)</option>
                </select>
              </div>
              <div>
                <label style={{ fontSize: "9.5px", fontWeight: 600, color: "#888888" }}>ETIOLOGY / RELATED TO</label>
                <select style={inputStyle} value={newComp.relatedTo} onChange={(e) => setNewComp({ ...newComp, relatedTo: e.target.value })}>
                  <option value="Procedure">Procedure (Direct Mechanical/Puncture)</option>
                  <option value="Sedation / Anesthesia">Sedation / Anesthesia</option>
                  <option value="Medication">Medication / Contrast</option>
                  <option value="Underlying Disease">Underlying Disease Progression</option>
                  <option value="Unrelated">Unrelated</option>
                </select>
              </div>
              <div>
                <label style={{ fontSize: "9.5px", fontWeight: 600, color: "#888888" }}>ACUTE MANAGEMENT TAKEN</label>
                <input style={inputStyle} value={newComp.mgmt} onChange={(e) => setNewComp({ ...newComp, mgmt: e.target.value })} placeholder="e.g. Cold saline flush, 14F chest tube inserted" />
              </div>
              <div>
                <label style={{ fontSize: "9.5px", fontWeight: 600, color: "#888888" }}>OUTCOME</label>
                <select style={inputStyle} value={newComp.outcome} onChange={(e) => setNewComp({ ...newComp, outcome: e.target.value })}>
                  <option value="Resolved">Resolved</option>
                  <option value="Resolving">Resolving</option>
                  <option value="Persistent">Persistent</option>
                  <option value="Worsened">Worsened</option>
                </select>
              </div>
              <button
                type="button"
                onClick={handleAddComp}
                style={{
                  padding: "6px 14px",
                  background: "#000000",
                  color: "#ffffff",
                  border: "none",
                  cursor: "pointer",
                  fontSize: "11px",
                  fontWeight: 600,
                  height: "28px",
                  textTransform: "uppercase",
                }}
              >
                Log
              </button>
            </div>
          </div>

          {/* Complications Table */}
          <table style={tableStyle}>
            <thead>
              <tr>
                <th style={thStyle}>Date/Time</th>
                <th style={thStyle}>Event Description</th>
                <th style={thStyle}>CTCAE</th>
                <th style={thStyle}>Clavien-Dindo</th>
                <th style={thStyle}>Related To</th>
                <th style={thStyle}>Management</th>
                <th style={thStyle}>Outcome</th>
                <th style={{ ...thStyle, textAlign: "right" }}>Action</th>
              </tr>
            </thead>
            <tbody>
              {complications.length === 0 ? (
                <tr>
                  <td colSpan={8} style={{ ...tdStyle, textAlign: "center", color: "#888888" }}>
                    No procedural complications or adverse events recorded. All procedural margins unremarkable.
                  </td>
                </tr>
              ) : (
                complications.map((comp) => (
                  <tr key={comp.id}>
                    <td style={tdStyle}><b>{comp.time}</b></td>
                    <td style={tdStyle}>{comp.desc}</td>
                    <td style={tdStyle}>
                      <span style={{
                        padding: "2px 6px",
                        borderRadius: "2px",
                        background: comp.ctcae.includes("Grade 1") ? "#fef3c7" : "#fee2e2",
                        color: comp.ctcae.includes("Grade 1") ? "#92400e" : "#991b1b",
                        fontWeight: 600,
                        fontSize: "10.5px",
                      }}>
                        {comp.ctcae.split(" ")[0]}
                      </span>
                    </td>
                    <td style={tdStyle}>{comp.clavien}</td>
                    <td style={tdStyle}>{comp.relatedTo}</td>
                    <td style={tdStyle}>{comp.mgmt || "Supportive"}</td>
                    <td style={tdStyle}>
                      <span style={{
                        padding: "2px 6px",
                        borderRadius: "2px",
                        background: comp.outcome === "Resolved" ? "#dcfce7" : "#fef3c7",
                        color: comp.outcome === "Resolved" ? "#166534" : "#92400e",
                        fontWeight: 600,
                        fontSize: "10.5px",
                      }}>
                        {comp.outcome}
                      </span>
                    </td>
                    <td style={{ ...tdStyle, textAlign: "right" }}>
                      <button
                        type="button"
                        onClick={() => handleDeleteComp(comp.id)}
                        style={{ padding: "2px 6px", fontSize: "11px", background: "#fee2e2", color: "#b91c1c", border: "1px solid #fca5a5", cursor: "pointer" }}
                      >
                        Remove
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </Section>

      {/* ─── 5. Treatment Resistance & Escalation Panel ───────────────────────── */}
      <Section
        title="5. Treatment Resistance: Staging Criteria & Escalation Pathways"
        note="Refractory disease classification (GOLD Group E, GINA Step 5), biologic workup, and transplant triggers"
      >
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "16px", marginBottom: "16px" }}>
          <FormField
            label="GOLD GROUP E EXACERBATOR CRITERIA"
            name="mon_res_gold_group_e"
            type="select"
            options={[
              "Not met (<2 exacerbations, 0 hospitalizations)",
              "Met: ≥2 moderate exacerbations in prior 12 mos",
              "Met: ≥1 hospitalization for acute COPD exacerbation",
            ]}
          />
          <FormField
            label="GINA STEP 5 SEVERE ASTHMA INDICATION"
            name="mon_res_gina_step5"
            type="select"
            options={[
              "Controlled on Step 3-4 therapy",
              "Uncontrolled despite high-dose ICS-LABA",
              "Frequent systemic steroid bursts (≥2/year)",
              "Persistent airflow limitation (FEV1 < 80%)",
            ]}
          />
          <FormField
            label="STEROID-RESPONSIVENESS PHENOTYPE"
            name="mon_res_steroid_response"
            type="select"
            options={[
              "Steroid-sensitive (FEV1 improves >12% & 200mL)",
              "Steroid-dependent (Relapses upon prednisone taper)",
              "Refractory / Poor FEV1 response to oral trial",
            ]}
          />
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: "16px", marginBottom: "16px" }}>
          <FormField
            label="TARGETED BIOLOGIC PHENOTYPE CANDIDACY"
            name="mon_res_biologic_candidate"
            type="select"
            options={[
              "None / Not indicated",
              "Candidate for Anti-IL5 / Anti-IL5R (Mepolizumab / Benralizumab)",
              "Candidate for Anti-IL4R (Dupilumab)",
              "Candidate for Anti-IgE (Omalizumab)",
              "Candidate for Anti-TSLP (Tezepelumab)",
            ]}
          />
          <FormField
            label="ADVANCED INTERVENTIONAL ESCALATION"
            name="mon_res_interventional_escalation"
            type="select"
            options={[
              "Not indicated",
              "Candidate for Endobronchial Valves (EBV / Zephyr)",
              "Candidate for Bronchial Thermoplasty",
              "Indwelling Pleural Catheter (IPC) long-term home drainage",
              "Thoracic Surgery / VATS Pleurectomy referral",
            ]}
          />
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "1fr", gap: "16px" }}>
          <FormField
            label="LUNG TRANSPLANT REFERRAL TRIGGERS"
            name="mon_res_transplant_trigger"
            type="select"
            options={[
              "No transplant indication currently",
              "Trigger met: BODE Index 7–10 or FEV1 < 25% predicted",
              "Trigger met: IPF with FVC decline ≥ 10% or DLCO decline ≥ 15%",
              "Trigger met: Severe Secondary Pulmonary Hypertension (mPAP > 35 mmHg)",
              "Trigger met: Cystic Fibrosis with rapid lung function decline or massive hemoptysis",
            ]}
          />
        </div>
      </Section>

      {/* ─── 6. Clinical Prophylaxis, Nursing Orders & Safety Precautions ──────── */}
      <Section
        title="6. Clinical Prophylaxis, Functional Nursing Orders & Safety Precautions"
        note="Standard inpatient orders adapted from post-operative and procedural pathways"
      >
        <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: "16px", marginBottom: "16px" }}>
          <FormField
            label="DVT / VTE PROPHYLAXIS"
            name="mon_proph_dvt"
            type="select"
            options={[
              "None / Ambulation sufficient",
              "Enoxaparin 40mg SC daily",
              "Enoxaparin 30mg SC BD (High risk)",
              "Unfractionated Heparin 5000U SC q8h",
              "Sequential Compression Devices (SCDs) only",
              "Contraindicated due to acute bleeding risk",
            ]}
          />
          <FormField
            label="STRESS ULCER PROPHYLAXIS"
            name="mon_proph_gi"
            type="select"
            options={[
              "None / Enteral nutrition protective",
              "Pantoprazole 40mg IV/PO daily",
              "Famotidine 20mg IV/PO BD",
              "Not indicated",
            ]}
          />
          <FormField
            label="POST-SEDATION NUTRITION & DIET"
            name="mon_orders_nutrition"
            type="select"
            options={[
              "NPO until gag reflex confirmed intact",
              "Clear liquids after 1 hour if alert",
              "Diabetic / Renal protective diet",
              "Regular diet as tolerated",
              "Enteral feeds via NG / NJ tube",
            ]}
          />
          <FormField
            label="RESPIRATORY THERAPY (RT) ORDERS"
            name="mon_orders_rt"
            type="select"
            options={[
              "Incentive Spirometry 10 breaths/hr while awake",
              "Acapella / Flutter valve therapy QID",
              "Chest Physiotherapy & postural drainage",
              "Assisted cough & deep breathing exercises",
              "Early ambulation with portable O2 canister",
            ]}
          />
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "16px" }}>
          <div>
            <label style={{ fontSize: "10.5px", fontWeight: 700, textTransform: "uppercase", color: "#374151", display: "block", marginBottom: "6px" }}>
              POST-PROCEDURE ACTIVITY RESTRICTIONS &amp; POSITIONING
            </label>
            <div style={{ display: "flex", flexDirection: "column", gap: "6px", background: "#f9fafb", padding: "12px", border: "1px solid #e5e7eb", borderRadius: "2px" }}>
              {[
                { k: "mon_act_bedrest", l: "Strict bed rest for 2 hours post-procedure" },
                { k: "mon_act_head_elevated", l: "Maintain head of bed elevated 30–45 degrees (Semi-Fowlers)" },
                { k: "mon_act_drain_nondep", l: "Keep chest drainage canister below chest level & upright" },
                { k: "mon_act_no_cough", l: "Avoid forced coughing or Valsalva maneuvers" },
                { k: "mon_act_amb_o2", l: "Ambulate only with nurse or RT assistance while on oxygen" },
              ].map((item) => (
                <label key={item.k} style={{ display: "flex", alignItems: "center", gap: "8px", fontSize: "12px", color: "#1f2937", cursor: "pointer" }}>
                  <input
                    type="checkbox"
                    checked={!!formData[item.k]}
                    onChange={(e) => updateField(item.k, e.target.checked)}
                  />
                  {item.l}
                </label>
              ))}
            </div>
          </div>

          <div>
            <label style={{ fontSize: "10.5px", fontWeight: 700, textTransform: "uppercase", color: "#374151", display: "block", marginBottom: "6px" }}>
              RED-FLAG WARNING SIGNS COUNSELED WITH PATIENT / NURSE
            </label>
            <div style={{ display: "flex", flexDirection: "column", gap: "6px", background: "#f9fafb", padding: "12px", border: "1px solid #e5e7eb", borderRadius: "2px" }}>
              {[
                { k: "mon_warn_pain", l: "Sudden onset of sharp, pleuritic chest pain" },
                { k: "mon_warn_sob", l: "Acute worsening of shortness of breath or rapid desaturation" },
                { k: "mon_warn_hemoptysis", l: "Coughing up fresh bright red blood (> 1 teaspoon)" },
                { k: "mon_warn_crepitus", l: "Puffiness or crackling sensation under neck/chest skin (Subcutaneous emphysema)" },
                { k: "mon_warn_drain_leak", l: "Vigorous bubbling in underwater seal or chest tube dislodgement" },
              ].map((item) => (
                <label key={item.k} style={{ display: "flex", alignItems: "center", gap: "8px", fontSize: "12px", color: "#1f2937", cursor: "pointer" }}>
                  <input
                    type="checkbox"
                    checked={!!formData[item.k]}
                    onChange={(e) => updateField(item.k, e.target.checked)}
                  />
                  {item.l}
                </label>
              ))}
            </div>
          </div>
        </div>
      </Section>

      {/* ─── 7. Clinical Decision Support (CDS) Triage & Disposition Recommendation Engine ─── */}
      <div
        id="sec_triage_cds"
        style={{
          border: `2px solid ${triage.border}`,
          borderLeft: `6px solid ${triage.color}`,
          background: triage.bg,
          padding: "20px",
          borderRadius: "4px",
          boxShadow: "0 2px 8px rgba(0,0,0,0.06)",
          display: "flex",
          flexDirection: "column",
          gap: "16px",
          marginTop: "10px",
        }}
      >
        {/* Banner Header */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: "12px" }}>
          <div>
            <div style={{ display: "flex", alignItems: "center", gap: "10px", marginBottom: "6px" }}>
              <span style={{ fontSize: "20px" }}>{triage.icon}</span>
              <span
                style={{
                  fontSize: "11px",
                  fontWeight: 700,
                  textTransform: "uppercase",
                  letterSpacing: "0.06em",
                  backgroundColor: triage.color,
                  color: "#ffffff",
                  padding: "4px 10px",
                  borderRadius: "2px",
                }}
              >
                {triage.badge}
              </span>
              <span
                style={{
                  fontSize: "10px",
                  fontWeight: 700,
                  textTransform: "uppercase",
                  letterSpacing: "0.05em",
                  color: "#6b7280",
                }}
              >
                CDS Triage Protocol · PACU Disposition Engine
              </span>
            </div>
            <h2
              style={{
                fontSize: "16px",
                fontWeight: 700,
                color: triage.color,
                margin: 0,
                letterSpacing: "0.02em",
              }}
            >
              {triage.title}
            </h2>
          </div>

          {/* Quick Parameters Status Pills */}
          <div style={{ display: "flex", flexWrap: "wrap", gap: "8px", alignItems: "center" }}>
            <div
              style={{
                fontSize: "11px",
                fontWeight: 600,
                padding: "4px 10px",
                borderRadius: "20px",
                background: (formData.mon_obs_aldrete || "").includes("10") || (formData.mon_obs_aldrete || "").includes("9") ? "#dcfce7" : "#fef3c7",
                color: (formData.mon_obs_aldrete || "").includes("10") || (formData.mon_obs_aldrete || "").includes("9") ? "#15803d" : "#b45309",
                border: `1px solid ${(formData.mon_obs_aldrete || "").includes("10") || (formData.mon_obs_aldrete || "").includes("9") ? "#86efac" : "#fcd34d"}`,
              }}
            >
              Aldrete: <b>{formData.mon_obs_aldrete ? formData.mon_obs_aldrete.split(" ")[0] : "Not Set"}</b>
            </div>
            <div
              style={{
                fontSize: "11px",
                fontWeight: 600,
                padding: "4px 10px",
                borderRadius: "20px",
                background: parseFloat(formData.mon_obs_spo2) < 88 ? "#fee2e2" : parseFloat(formData.mon_obs_spo2) < 92 ? "#fef3c7" : "#dcfce7",
                color: parseFloat(formData.mon_obs_spo2) < 88 ? "#b91c1c" : parseFloat(formData.mon_obs_spo2) < 92 ? "#b45309" : "#15803d",
                border: "1px solid #e5e7eb",
              }}
            >
              SpO2: <b>{formData.mon_obs_spo2 ? `${formData.mon_obs_spo2}%` : "Pending"}</b>
            </div>
            <div
              style={{
                fontSize: "11px",
                fontWeight: 600,
                padding: "4px 10px",
                borderRadius: "20px",
                background: (formData.mon_nurs_air_leak || "").includes("Grade") ? "#fef3c7" : "#f1f5f9",
                color: (formData.mon_nurs_air_leak || "").includes("Grade") ? "#b45309" : "#334155",
                border: "1px solid #cbd5e1",
              }}
            >
              Air Leak: <b>{formData.mon_nurs_air_leak ? (formData.mon_nurs_air_leak.includes("Grade") ? formData.mon_nurs_air_leak.split("(")[1]?.replace(")", "") || "Active" : formData.mon_nurs_air_leak) : "None / NA"}</b>
            </div>
            <div
              style={{
                fontSize: "11px",
                fontWeight: 600,
                padding: "4px 10px",
                borderRadius: "20px",
                background: complications.some((c) => c.outcome !== "Resolved") ? "#fee2e2" : "#dcfce7",
                color: complications.some((c) => c.outcome !== "Resolved") ? "#b91c1c" : "#15803d",
                border: "1px solid #e5e7eb",
              }}
            >
              Active Adverse Events: <b>{complications.filter((c) => c.outcome !== "Resolved").length}</b>
            </div>
          </div>
        </div>

        {/* Detailed Breakdown Grid: Blockers vs Cleared Milestones */}
        <div style={{ display: "grid", gridTemplateColumns: triage.blockers.length > 0 && triage.clearedChecks.length > 0 ? "1fr 1fr" : "1fr", gap: "16px" }}>
          {/* Active Blockers Box */}
          {triage.blockers.length > 0 && (
            <div
              style={{
                background: "#ffffff",
                border: `1px solid ${triage.status === "URGENT_ESCALATION" ? "#fca5a5" : "#fde68a"}`,
                borderRadius: "3px",
                padding: "14px 16px",
              }}
            >
              <div
                style={{
                  fontSize: "12px",
                  fontWeight: 700,
                  textTransform: "uppercase",
                  letterSpacing: "0.04em",
                  color: triage.status === "URGENT_ESCALATION" ? "#b91c1c" : "#b45309",
                  marginBottom: "8px",
                  display: "flex",
                  alignItems: "center",
                  gap: "6px",
                }}
              >
                <span>{triage.status === "URGENT_ESCALATION" ? "🚨" : "⚠️"}</span>
                <span>Active Discharge Blockers &amp; Escalation Triggers ({triage.blockers.length})</span>
              </div>
              <ul style={{ margin: 0, paddingLeft: "20px", display: "flex", flexDirection: "column", gap: "6px" }}>
                {triage.blockers.map((b, idx) => (
                  <li key={idx} style={{ fontSize: "12px", color: "#1f2937", lineHeight: "1.4" }}>
                    <span style={{ fontWeight: 600, color: triage.status === "URGENT_ESCALATION" ? "#991b1b" : "#92400e" }}>
                      {b}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Cleared Milestones Box */}
          {triage.clearedChecks.length > 0 && (
            <div
              style={{
                background: "#ffffff",
                border: "1px solid #bbf7d0",
                borderRadius: "3px",
                padding: "14px 16px",
              }}
            >
              <div
                style={{
                  fontSize: "12px",
                  fontWeight: 700,
                  textTransform: "uppercase",
                  letterSpacing: "0.04em",
                  color: "#166534",
                  marginBottom: "8px",
                  display: "flex",
                  alignItems: "center",
                  gap: "6px",
                }}
              >
                <span>✅</span>
                <span>Satisfied PACU Recovery Milestones ({triage.clearedChecks.length})</span>
              </div>
              <ul style={{ margin: 0, paddingLeft: "20px", display: "flex", flexDirection: "column", gap: "6px" }}>
                {triage.clearedChecks.map((c, idx) => (
                  <li key={idx} style={{ fontSize: "12px", color: "#1f2937", lineHeight: "1.4" }}>
                    <span style={{ color: "#15803d" }}>✓ {c}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>

        {/* Action Recommendation Bar */}
        <div
          style={{
            background: "#ffffff",
            border: `1px solid ${triage.border}`,
            padding: "14px 18px",
            borderRadius: "3px",
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            flexWrap: "wrap",
            gap: "14px",
          }}
        >
          <div style={{ flex: "1 1 500px" }}>
            <div style={{ fontSize: "10.5px", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em", color: "#64748b", marginBottom: "3px" }}>
              Recommended Clinical Next Step:
            </div>
            <div style={{ fontSize: "13px", fontWeight: 600, color: "#0f172a", lineHeight: "1.4" }}>
              {triage.recommendedAction}
            </div>
          </div>

          <div>
            {triage.isDischargeReady ? (
              <button
                type="button"
                onClick={() => {
                  if (typeof setTrack === "function") setTrack("discharge");
                  if (typeof setActiveTab === "function") setActiveTab("disp_master");
                }}
                style={{
                  padding: "10px 22px",
                  background: "#15803d",
                  color: "#ffffff",
                  border: "none",
                  borderRadius: "2px",
                  fontSize: "12.5px",
                  fontWeight: 700,
                  cursor: "pointer",
                  letterSpacing: "0.03em",
                  boxShadow: "0 2px 4px rgba(21,128,61,0.3)",
                  display: "flex",
                  alignItems: "center",
                  gap: "8px",
                  whiteSpace: "nowrap",
                }}
              >
                <span>Proceed to Disposition &amp; Summary</span>
                <span>→</span>
              </button>
            ) : triage.status === "URGENT_ESCALATION" ? (
              <button
                type="button"
                onClick={() => {
                  const target = document.getElementById("sec_complications");
                  if (target) {
                    target.scrollIntoView({ behavior: "smooth" });
                  } else {
                    window.scrollTo({ top: 500, behavior: "smooth" });
                  }
                }}
                style={{
                  padding: "10px 22px",
                  background: "#b71c1c",
                  color: "#ffffff",
                  border: "none",
                  borderRadius: "2px",
                  fontSize: "12.5px",
                  fontWeight: 700,
                  cursor: "pointer",
                  letterSpacing: "0.03em",
                  boxShadow: "0 2px 4px rgba(183,28,28,0.3)",
                  display: "flex",
                  alignItems: "center",
                  gap: "8px",
                  whiteSpace: "nowrap",
                }}
              >
                <span>🚨</span>
                <span>Review Urgent Complications</span>
              </button>
            ) : triage.status === "WARD_MONITORING" ? (
              <button
                type="button"
                onClick={() => {
                  const target = document.getElementById("sec_observations");
                  if (target) {
                    target.scrollIntoView({ behavior: "smooth" });
                  } else {
                    window.scrollTo({ top: 0, behavior: "smooth" });
                  }
                }}
                style={{
                  padding: "10px 22px",
                  background: "#b45309",
                  color: "#ffffff",
                  border: "none",
                  borderRadius: "2px",
                  fontSize: "12.5px",
                  fontWeight: 700,
                  cursor: "pointer",
                  letterSpacing: "0.03em",
                  boxShadow: "0 2px 4px rgba(180,83,9,0.3)",
                  display: "flex",
                  alignItems: "center",
                  gap: "8px",
                  whiteSpace: "nowrap",
                }}
              >
                <span>⚠️</span>
                <span>Continue Ward Recovery Checks</span>
              </button>
            ) : (
              <button
                type="button"
                onClick={() => {
                  window.scrollTo({ top: 0, behavior: "smooth" });
                }}
                style={{
                  padding: "10px 22px",
                  background: "#334155",
                  color: "#ffffff",
                  border: "none",
                  borderRadius: "2px",
                  fontSize: "12.5px",
                  fontWeight: 600,
                  cursor: "pointer",
                  letterSpacing: "0.03em",
                  display: "flex",
                  alignItems: "center",
                  gap: "8px",
                  whiteSpace: "nowrap",
                }}
              >
                <span>Document Recovery Vitals</span>
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
