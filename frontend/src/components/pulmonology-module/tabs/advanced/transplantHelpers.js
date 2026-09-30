/**
 * pulmonology-module/tabs/advanced/transplantHelpers.js
 * Pure calculation engines, multi-source patient data reconciliation,
 * and 2021 ISHLT consensus recommendation logic for Lung Transplant Workup.
 */

export function calcAge(dobStr, explicitAge) {
  if (explicitAge !== undefined && explicitAge !== null && explicitAge !== "" && !isNaN(Number(explicitAge))) {
    return Number(explicitAge);
  }
  if (!dobStr) return null;
  const dob = new Date(dobStr);
  if (isNaN(dob.getTime())) return null;
  const diffMs = Date.now() - dob.getTime();
  return Math.floor(diffMs / (1000 * 60 * 60 * 24 * 365.25));
}

export function calcBmi(bmiVal, weightKg, heightCm) {
  const b = parseFloat(bmiVal);
  if (!isNaN(b) && b > 0) return b;
  const w = parseFloat(weightKg);
  let h = parseFloat(heightCm);
  if (!isNaN(w) && !isNaN(h) && w > 0 && h > 0) {
    if (h > 3) h = h / 100;
    return parseFloat((w / (h * h)).toFixed(1));
  }
  return null;
}

// BODE Index: BMI (<=21: 1, >21: 0), FEV1% (>=65: 0, 50-64: 1, 36-49: 2, <=35: 3),
// mMRC (<=1: 0, 2: 1, 3: 2, 4: 3), 6MWT (>=350: 0, 250-349: 1, 150-249: 2, <150: 3)
export function calcBode({ bmi, fev1Pct, mmrc, sixMwtM }) {
  if ([bmi, fev1Pct, mmrc, sixMwtM].some((v) => v === null || v === undefined || isNaN(v))) {
    return null;
  }
  let points = 0;
  points += bmi > 21 ? 0 : 1;
  if (fev1Pct >= 65) points += 0;
  else if (fev1Pct >= 50) points += 1;
  else if (fev1Pct >= 36) points += 2;
  else points += 3;

  if (mmrc <= 1) points += 0;
  else if (mmrc === 2) points += 1;
  else if (mmrc === 3) points += 2;
  else points += 3;

  if (sixMwtM >= 350) points += 0;
  else if (sixMwtM >= 250) points += 1;
  else if (sixMwtM >= 150) points += 2;
  else points += 3;

  let riskBand = "";
  if (points <= 2) riskBand = "Low (0-2)";
  else if (points <= 4) riskBand = "Moderate (3-4)";
  else if (points <= 6) riskBand = "High (5-6)";
  else riskBand = "Very High (7-10)";

  return { points, riskBand };
}

// GAP Index (ILD): Sex (Male: 1, Female: 0), Age (<=60: 0, 61-65: 1, >65: 2),
// FVC% (>75: 0, 50-75: 1, <50: 2), DLCO% (>55: 0, 36-55: 1, <=35: 2)
export function calcGap({ sex, age, fvcPct, dlcoPct }) {
  if (!sex || age === null || isNaN(fvcPct) || isNaN(dlcoPct)) return null;
  const isMale = String(sex).trim().toLowerCase().startsWith("m");
  let points = 0;
  points += isMale ? 1 : 0;
  if (age <= 60) points += 0;
  else if (age <= 65) points += 1;
  else points += 2;

  if (fvcPct > 75) points += 0;
  else if (fvcPct >= 50) points += 1;
  else points += 2;

  if (dlcoPct > 55) points += 0;
  else if (dlcoPct >= 36) points += 1;
  else points += 2;

  let stage = "";
  if (points <= 3) stage = "Stage I (Low Risk)";
  else if (points <= 5) stage = "Stage II (Intermediate Risk)";
  else stage = "Stage III (High Risk)";

  return { points, stage };
}

// Multi-source Patient Data Reconciliation
export function reconcilePatientTransplantData(formData = {}, patientId = "") {
  let activePatientId = patientId || formData.patient_id || formData.pt_id || formData.pt_mrn || formData.mrn || "";
  let syncData = {};

  if (typeof window !== "undefined" && window.localStorage) {
    const candidates = [];
    if (activePatientId) {
      try {
        const direct = JSON.parse(window.localStorage.getItem(`pulm_sync_${activePatientId}`) || "{}");
        if (direct && typeof direct === "object" && Object.keys(direct).length > 0) {
          candidates.push(direct);
        }
      } catch (e) {
        console.warn("pulm_sync direct parse error:", e);
      }
    }

    try {
      const latest = JSON.parse(window.localStorage.getItem("pulm_sync_latest") || "{}");
      if (latest && typeof latest === "object" && Object.keys(latest).length > 0) {
        candidates.push(latest);
      }
      const active = JSON.parse(window.localStorage.getItem("pulm_sync_active") || "{}");
      if (active && typeof active === "object" && Object.keys(active).length > 0) {
        candidates.push(active);
      }
    } catch (e) {}

    // Check any other pulm_sync_* keys in localStorage
    for (let i = 0; i < window.localStorage.length; i++) {
      const k = window.localStorage.key(i);
      if (
        k &&
        k.startsWith("pulm_sync_") &&
        k !== `pulm_sync_${activePatientId}` &&
        k !== "pulm_sync_latest" &&
        k !== "pulm_sync_active"
      ) {
        try {
          const item = JSON.parse(window.localStorage.getItem(k) || "{}");
          if (item && typeof item === "object" && Object.keys(item).length > 0) {
            candidates.push(item);
            if (!activePatientId) {
              activePatientId = k.replace("pulm_sync_", "");
            }
          }
        } catch (e) {}
      }
    }

    // Merge candidates: lowest to highest priority so direct patientId overrides
    syncData = {};
    for (let i = candidates.length - 1; i >= 0; i--) {
      syncData = { ...syncData, ...candidates[i] };
    }
  }

  // Aggregate procedure logs from both formData and syncData
  const rawLog = [
    ...(Array.isArray(formData.completed_procedures_log) ? formData.completed_procedures_log : []),
    ...(Array.isArray(syncData.completed_procedures_log) ? syncData.completed_procedures_log : []),
    ...(formData.last_completed_procedure ? [formData.last_completed_procedure] : []),
    ...(syncData.last_completed_procedure ? [syncData.last_completed_procedure] : []),
  ];

  let procFev1 = null;
  let procFvc = null;
  let procDlco = null;
  let proc6mwt = null;
  let procPao2 = null;
  let procPaco2 = null;

  for (const proc of rawLog) {
    if (!proc) continue;
    const pId = String(proc.proc_id || proc.id || "").toLowerCase();
    const pData = proc.data || {};
    const summary = String(proc.summary || "");

    if (pId.includes("spiro") || pId.includes("pft")) {
      const f = pData.pulm_current_fev1_pct || pData.pft_fev1_pct || pData.fev1_pct;
      if (f && !procFev1) procFev1 = parseFloat(f);
      const fv = pData.pulm_current_fvc_pct || pData.pft_fvc_pct || pData.fvc_pct;
      if (fv && !procFvc) procFvc = parseFloat(fv);
      const d = pData.pulm_current_dlco_pct || pData.pft_dlco_pct || pData.dlco_pct;
      if (d && !procDlco) procDlco = parseFloat(d);

      if (!procFev1) {
        const m = summary.match(/fev1[^\d]*(\d+(?:\.\d+)?)\s*%/i);
        if (m) procFev1 = parseFloat(m[1]);
      }
      if (!procFvc) {
        const m = summary.match(/fvc[^\d]*(\d+(?:\.\d+)?)\s*%/i);
        if (m) procFvc = parseFloat(m[1]);
      }
      if (!procDlco) {
        const m = summary.match(/dlco[^\d]*(\d+(?:\.\d+)?)\s*%/i);
        if (m) procDlco = parseFloat(m[1]);
      }
    }

    if (pId.includes("6mwt") || pId.includes("sixmwt") || pId.includes("walk")) {
      const d = pData.pulm_current_6mwt_m || pData.mwt_distance || pData.sixmwt_distance;
      if (d && !proc6mwt) proc6mwt = parseFloat(d);
      if (!proc6mwt) {
        const m = summary.match(/(?:distance|6mwt|walk)[^\d]*(\d+(?:\.\d+)?)\s*m\b/i);
        if (m) proc6mwt = parseFloat(m[1]);
      }
    }

    if (pId.includes("abg")) {
      const o2 = pData.pulm_current_pao2 || pData.abg_pao2;
      if (o2 && !procPao2) procPao2 = parseFloat(o2);
      const co2 = pData.pulm_current_paco2 || pData.abg_paco2;
      if (co2 && !procPaco2) procPaco2 = parseFloat(co2);

      if (!procPao2) {
        const m = summary.match(/pao2[^\d]*(\d+(?:\.\d+)?)/i);
        if (m) procPao2 = parseFloat(m[1]);
      }
      if (!procPaco2) {
        const m = summary.match(/paco2[^\d]*(\d+(?:\.\d+)?)/i);
        if (m) procPaco2 = parseFloat(m[1]);
      }
    }
  }

  // 1. Primary Diagnosis Resolution
  let primaryDx =
    formData.pulm_primary_dx ||
    syncData.pulm_primary_dx ||
    formData.primary_diagnosis ||
    syncData.primary_diagnosis ||
    formData.pulm_intake_diagnosis ||
    syncData.pulm_intake_diagnosis ||
    "";

  if (!primaryDx) {
    const pathway = formData.calc_recommended_pathway || syncData.calc_recommended_pathway || formData.pulm_auto_pathway || syncData.pulm_auto_pathway || "";
    if (pathway.toLowerCase().includes("copd")) primaryDx = "COPD";
    else if (pathway.toLowerCase().includes("ild") || pathway.toLowerCase().includes("fibros")) primaryDx = "ILD / Fibrosis";
    else if (pathway.toLowerCase().includes("bronch")) primaryDx = "Bronchiectasis";
    else if (pathway.toLowerCase().includes("pah") || pathway.toLowerCase().includes("hypertension")) primaryDx = "Pulmonary Hypertension";
  }

  if (!primaryDx) {
    const visitReason = String(formData.pulm_visit_reason || syncData.pulm_visit_reason || "").toLowerCase();
    const smokingPackYears = Number(formData.lifestyle_pack_years || formData.pulm_smoking_pack_years || syncData.pulm_smoking_pack_years || 0);
    const hasSmoking = smokingPackYears > 10 || String(formData.lifestyle_smoking || syncData.lifestyle_smoking || "").toLowerCase().includes("smok");
    const meds = { ...(formData.pulm_meds || {}), ...(syncData.pulm_meds || {}) };
    const hasCopdMeds = meds.triple_therapy || meds.lama || meds.home_oxygen;

    if (visitReason.includes("copd") || hasCopdMeds || (hasSmoking && visitReason.includes("dyspnea"))) {
      primaryDx = "COPD";
    } else if (visitReason.includes("fibros") || visitReason.includes("ild") || visitReason.includes("ipf")) {
      primaryDx = "ILD / Fibrosis";
    } else if (visitReason.includes("asthma")) {
      primaryDx = "Asthma";
    } else if (visitReason.includes("bronchiectasis")) {
      primaryDx = "Bronchiectasis";
    } else if (visitReason.includes("hypertension") || visitReason.includes("pah")) {
      primaryDx = "Pulmonary Hypertension";
    }
  }

  // 2. Physiological Values (from Diagnostics Hub & Screening Alerts)
  const fev1Val = [
    formData.pulm_current_fev1_pct,
    syncData.pulm_current_fev1_pct,
    formData.pft_fev1_pct,
    syncData.pft_fev1_pct,
    formData.pft_fev1_post_pct,
    formData.pft_fev1_post,
    formData.fev1_pct,
    syncData.fev1_pct,
    procFev1,
  ].find((v) => v !== undefined && v !== null && v !== "" && !isNaN(Number(v)));

  const fvcVal = [
    formData.pulm_current_fvc_pct,
    syncData.pulm_current_fvc_pct,
    formData.pft_fvc_pct,
    syncData.pft_fvc_pct,
    formData.pft_fvc_post_pct,
    formData.pft_fvc_post,
    formData.fvc_pct,
    syncData.fvc_pct,
    procFvc,
  ].find((v) => v !== undefined && v !== null && v !== "" && !isNaN(Number(v)));

  const dlcoVal = [
    formData.pulm_current_dlco_pct,
    syncData.pulm_current_dlco_pct,
    formData.pft_dlco_pct,
    syncData.pft_dlco_pct,
    formData.dlco_pct,
    syncData.dlco_pct,
    procDlco,
  ].find((v) => v !== undefined && v !== null && v !== "" && !isNaN(Number(v)));

  const sixMwtVal = [
    formData.pulm_current_6mwt_m,
    syncData.pulm_current_6mwt_m,
    formData.mwt_distance,
    syncData.mwt_distance,
    formData.mwt_dist,
    syncData.mwt_dist,
    formData.sixmwt_distance,
    syncData.sixmwt_distance,
    proc6mwt,
  ].find((v) => v !== undefined && v !== null && v !== "" && !isNaN(Number(v)));

  const pao2Val = [
    formData.pulm_current_pao2,
    syncData.pulm_current_pao2,
    formData.abg_pao2,
    syncData.abg_pao2,
    formData.pao2,
    syncData.pao2,
    procPao2,
  ].find((v) => v !== undefined && v !== null && v !== "" && !isNaN(Number(v)));

  const paco2Val = [
    formData.pulm_current_paco2,
    syncData.pulm_current_paco2,
    formData.abg_paco2,
    syncData.abg_paco2,
    formData.paco2,
    syncData.paco2,
    procPaco2,
  ].find((v) => v !== undefined && v !== null && v !== "" && !isNaN(Number(v)));

  // Demographics
  const sex = formData.pt_sex || syncData.pt_sex || formData.pulm_patient_gender || "Male";
  const age = calcAge(
    formData.pt_dob || syncData.pt_dob,
    formData.pt_age || syncData.pt_age || formData.pulm_patient_age
  );

  const bmi = calcBmi(
    formData.pulm_clinical_bmi || syncData.pulm_clinical_bmi || formData.pt_bmi,
    formData.pulm_clinical_weight || syncData.pulm_clinical_weight,
    formData.pulm_clinical_height || syncData.pulm_clinical_height
  );

  // Dyspnea / mMRC
  let mmrc = parseInt(formData.score_mmrc || syncData.score_mmrc || formData.symptom_dyspnea_grade, 10);
  if (isNaN(mmrc)) {
    const sx = formData.pulm_symptoms || syncData.pulm_symptoms;
    if (sx) {
      const isRest = Array.isArray(sx) ? sx.includes("dyspnea_rest") : !!sx.dyspnea_rest;
      const isExertional = Array.isArray(sx) ? sx.includes("dyspnea_exertional") : !!sx.dyspnea_exertional;
      if (isRest) mmrc = 3;
      else if (isExertional) mmrc = 2;
    }
  }

  // BODE Index derivation
  let bode = formData.score_bode || syncData.score_bode || "";
  if (!bode && bmi !== null && fev1Val !== undefined && !isNaN(mmrc) && sixMwtVal !== undefined) {
    const calc = calcBode({
      bmi,
      fev1Pct: Number(fev1Val),
      mmrc,
      sixMwtM: Number(sixMwtVal),
    });
    if (calc) bode = `${calc.points} pts — ${calc.riskBand}`;
  }

  // GAP Index derivation
  let gap = formData.score_gap || syncData.score_gap || "";
  if (!gap && sex && age !== null && fvcVal !== undefined && dlcoVal !== undefined) {
    const calc = calcGap({
      sex,
      age,
      fvcPct: Number(fvcVal),
      dlcoPct: Number(dlcoVal),
    });
    if (calc) gap = `${calc.points} pts — ${calc.stage}`;
  }

  // Predicted TLC for donor matching
  let recipientTlc = parseFloat(formData.tx_tlc_pred || syncData.tx_tlc_pred);
  if (isNaN(recipientTlc) || recipientTlc <= 0) {
    const h = parseFloat(formData.pulm_clinical_height || syncData.pulm_clinical_height);
    if (!isNaN(h) && h > 0) {
      const heightVal = h > 3 ? h : h * 100;
      recipientTlc = sex.toLowerCase().startsWith("f")
        ? Math.max(3.0, 0.066 * heightVal - 5.79)
        : Math.max(3.5, 0.0799 * heightVal - 7.08);
      recipientTlc = parseFloat(recipientTlc.toFixed(2));
    } else {
      recipientTlc = 5.2;
    }
  }

  // Keys to auto-sync back into context state
  const updatesToSync = {};
  if (!formData.pulm_primary_dx && primaryDx) updatesToSync.pulm_primary_dx = primaryDx;
  if (!formData.pulm_current_fev1_pct && fev1Val !== undefined) updatesToSync.pulm_current_fev1_pct = String(fev1Val);
  if (!formData.pulm_current_fvc_pct && fvcVal !== undefined) updatesToSync.pulm_current_fvc_pct = String(fvcVal);
  if (!formData.pulm_current_dlco_pct && dlcoVal !== undefined) updatesToSync.pulm_current_dlco_pct = String(dlcoVal);
  if (!formData.pulm_current_6mwt_m && sixMwtVal !== undefined) updatesToSync.pulm_current_6mwt_m = String(sixMwtVal);
  if (!formData.pulm_current_pao2 && pao2Val !== undefined) updatesToSync.pulm_current_pao2 = String(pao2Val);
  if (!formData.pulm_current_paco2 && paco2Val !== undefined) updatesToSync.pulm_current_paco2 = String(paco2Val);
  if (!formData.score_bode && bode) updatesToSync.score_bode = bode;
  if (!formData.score_gap && gap) updatesToSync.score_gap = gap;
  if (!formData.tx_tlc_pred && recipientTlc) updatesToSync.tx_tlc_pred = String(recipientTlc);

  return {
    activePatientId,
    primaryDx: primaryDx || "Not specified",
    fev1: fev1Val !== undefined ? `${fev1Val}%` : "Not recorded",
    fev1Num: fev1Val !== undefined ? Number(fev1Val) : NaN,
    fvc: fvcVal !== undefined ? `${fvcVal}%` : "Not recorded",
    fvcNum: fvcVal !== undefined ? Number(fvcVal) : NaN,
    dlco: dlcoVal !== undefined ? `${dlcoVal}%` : "Not recorded",
    dlcoNum: dlcoVal !== undefined ? Number(dlcoVal) : NaN,
    sixMwt: sixMwtVal !== undefined ? `${sixMwtVal} m` : "Not recorded",
    sixMwtNum: sixMwtVal !== undefined ? Number(sixMwtVal) : NaN,
    pao2: pao2Val !== undefined ? `${pao2Val} mmHg` : "Not recorded",
    pao2Num: pao2Val !== undefined ? Number(pao2Val) : NaN,
    paco2: paco2Val !== undefined ? `${paco2Val} mmHg` : "Not recorded",
    paco2Num: paco2Val !== undefined ? Number(paco2Val) : NaN,
    bode: bode || "Not calculated",
    gap: gap || "Not calculated",
    recipientTlc,
    updatesToSync,
  };
}

// --- Pure Function: 2021 ISHLT Transplant Consensus Derivation ---
export const getTransplantRecommendation = ({
  primaryDx,
  scoreBode,
  scoreGap,
  sixMwtM,
  fev1Pct,
  pao2,
  paco2,
  dlcoPct,
}) => {
  const dx = (primaryDx || "").toLowerCase();
  const bodePoints = parseInt(scoreBode, 10);
  const gapStr = String(scoreGap || "");
  const sixMwtNum = parseFloat(sixMwtM);
  const fev1Num = parseFloat(fev1Pct);
  const pao2Num = parseFloat(pao2);
  const paco2Num = parseFloat(paco2);
  const dlcoNum = parseFloat(dlcoPct);

  // Check Listing Criteria First (Highest Acuity per 2021 ISHLT Consensus)
  const listingReasons = [];
  if (dx.includes("copd") && !isNaN(bodePoints) && bodePoints >= 7) {
    listingReasons.push(`BODE score of ${bodePoints} (≥7)`);
  }
  if ((dx.includes("ild") || dx.includes("fibros")) && gapStr.includes("Stage III")) {
    listingReasons.push("GAP Stage III (High 1-year mortality risk)");
  }
  if (!isNaN(fev1Num) && fev1Num > 0 && fev1Num < 25) {
    listingReasons.push(`FEV1 of ${fev1Num}% predicted (<25% severe airflow limitation)`);
  }
  if (!isNaN(pao2Num) && pao2Num > 0 && pao2Num < 55) {
    listingReasons.push(`Refractory resting PaO2 of ${pao2Num} mmHg (<55 mmHg)`);
  }
  if (!isNaN(dlcoNum) && dlcoNum > 0 && dlcoNum < 35) {
    listingReasons.push(`DLCO of ${dlcoNum}% predicted (<35% critical diffusion defect)`);
  }

  if (listingReasons.length > 0) {
    return {
      level: "listing",
      badge: "Consider Active Listing (High Priority)",
      title: "2021 ISHLT: Expedited Lung Transplant Listing Evaluation Recommended",
      message: `Patient meets ISHLT consensus criteria for transplant listing: ${listingReasons.join("; ")}. Multidisciplinary transplant committee review and UNOS/ISHLT protocol evaluation recommended.`,
      color: "#b71c1c",
      bg: "#ffebee",
      border: "#ef9a9a",
    };
  }

  // Check Referral Criteria
  const referralReasons = [];
  if (dx.includes("copd") && !isNaN(bodePoints) && bodePoints >= 5) {
    referralReasons.push(`BODE score of ${bodePoints} (≥5)`);
  }
  if ((dx.includes("ild") || dx.includes("fibros")) && gapStr.includes("Stage II")) {
    referralReasons.push("GAP Stage II (Intermediate risk)");
  }
  if (!isNaN(fev1Num) && fev1Num >= 25 && fev1Num <= 35) {
    referralReasons.push(`FEV1 of ${fev1Num}% predicted (25–35% referral zone)`);
  }
  if (!isNaN(sixMwtNum) && sixMwtNum > 0 && sixMwtNum < 250) {
    referralReasons.push(`6MWT of ${sixMwtNum} m (<250 m functional impairment)`);
  }
  if (!isNaN(pao2Num) && pao2Num >= 55 && pao2Num <= 60) {
    referralReasons.push(`PaO2 of ${pao2Num} mmHg (55–60 mmHg borderline hypoxemia)`);
  }
  if (!isNaN(paco2Num) && paco2Num > 50) {
    referralReasons.push(`PaCO2 of ${paco2Num} mmHg (>50 mmHg chronic hypercapnia)`);
  }
  if (!isNaN(dlcoNum) && dlcoNum >= 35 && dlcoNum <= 50) {
    referralReasons.push(`DLCO of ${dlcoNum}% predicted (35–50% moderate diffusion defect)`);
  }

  if (referralReasons.length > 0) {
    return {
      level: "referral",
      badge: "Transplant Referral Recommended",
      title: "2021 ISHLT: Transplant Center Referral & Multi-Disciplinary Workup Indicated",
      message: `Patient meets ISHLT consensus referral indicators: ${referralReasons.join("; ")}. Early referral facilitates full transplant workup and optimization prior to terminal decline.`,
      color: "#e65100",
      bg: "#fff3e0",
      border: "#ffcc80",
    };
  }

  return null;
};
