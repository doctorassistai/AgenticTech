/**
 * medicationReconciliationEngine.js
 * Universal Clinical Pharmacotherapy & Medication Reconciliation Engine.
 * 
 * Provides:
 *  1. Clinical NLP classification of respiratory and cardiovascular medications.
 *  2. Real-time safety risk & therapeutic duplication detection.
 *  3. Evidence-based guideline escalation (GOLD 2024, GINA 2024, ACO).
 *  4. Deterministic 1-click clinical reconciliation with audit-ready rationale.
 */

const DRUG_CLASS_PATTERNS = {
  BETA_BLOCKER_NONSELECTIVE: /\b(propranolol|nadolol|timolol|sotalol|carvedilol|labetalol)\b/i,
  BETA_BLOCKER_SELECTIVE: /\b(metoprolol|atenolol|bisoprolol|nebivolol|esmolol)\b/i,
  NSAID: /\b(ibuprofen|naproxen|diclofenac|ketorolac|meloxicam|indomethacin|celecoxib|etoricoxib|aspirin)\b/i,
  TRIPLE: /\b(trelegy|breztri|trimbow|fluticasone\/umeclidinium\/vilanterol|budesonide\/glycopyrronium\/formoterol)\b/i,
  LABA_LAMA: /\b(anoro|ultibro|inspiolto|stiolto|duaklir|bevespi|umeclidinium\/vilanterol|indacaterol\/glycopyrronium)\b/i,
  LABA_ICS: /\b(advair|seretide|symbicort|dulera|breo|relvar|fluticasone\/salmeterol|budesonide\/formoterol)\b/i,
  LAMA: /\b(tiotropium|spiriva|respimat|umeclidinium|incruse|aclidinium|tudorza|glycopyrronium|seebri)\b/i,
  LABA: /\b(salmeterol|serevent|formoterol|foradil|indacaterol|onbrez|olodaterol|striverdi|vilanterol)\b/i,
  ICS: /\b(budesonide|pulmicort|fluticasone|flovent|beclomethasone|qvar|ciclesonide|alvesco|mometasone|asmanex)\b/i,
  SABA: /\b(albuterol|salbutamol|ventolin|proair|proventil|levalbuterol|xopenex)\b/i,
  SAMA: /\b(ipratropium|atrovent)\b/i,
  SABA_SAMA: /\b(combivent|duoneb)\b/i,
  BIOLOGIC: /\b(dupixent|dupilumab|nucala|mepolizumab|fasenra|benralizumab|xolair|omalizumab|tezspire|tezepelumab)\b/i,
  THEOPHYLLINE: /\b(theophylline|aminophylline|uniphyl|theo-24|deriphyllin)\b/i,
  PDE4: /\b(roflumilast|daliresp)\b/i,
  MACROLIDE: /\b(azithromycin|clarithromycin|erythromycin)\b/i,
  ORAL_STEROID: /\b(prednisone|prednisolone|methylprednisolone|dexamethasone)\b/i,
};

/**
 * Classify any medication name into its clinical pharmacological classes.
 */
export function classifyMedication(drugName = "") {
  const str = String(drugName || "").trim();
  const matched = [];
  for (const [cls, pattern] of Object.entries(DRUG_CLASS_PATTERNS)) {
    if (pattern.test(str)) {
      matched.push(cls);
    }
  }
  return matched;
}

/**
 * Perform real-time safety and interaction analysis on active prescriptions.
 */
export function analyzePrescriptionSafety(prescriptions = [], formData = {}) {
  const alerts = [];
  const activeMeds = (Array.isArray(prescriptions) ? prescriptions : []).filter(
    (m) => m && m.action !== "Stopped"
  );

  const dx = String(
    formData.pulm_triage_pathway ||
      formData.primary_diagnosis ||
      formData.diagnosis ||
      "COPD"
  ).toLowerCase();
  const isCopd = /copd|emphysema|bronchitis|airway obstruction/i.test(dx);
  const isAsthma = /asthma|eosinophil/i.test(dx);
  const isAco = /overlap|aco/i.test(dx) || (isCopd && isAsthma);

  const hasTriple = activeMeds.some((m) => classifyMedication(m.drug).includes("TRIPLE"));
  const hasLama = activeMeds.some(
    (m) => classifyMedication(m.drug).includes("LAMA") && !classifyMedication(m.drug).includes("TRIPLE")
  );
  const hasIcs = activeMeds.some(
    (m) => classifyMedication(m.drug).includes("ICS") && !classifyMedication(m.drug).includes("TRIPLE")
  );
  const hasSaba = activeMeds.some((m) => classifyMedication(m.drug).includes("SABA"));
  const hasSama = activeMeds.some((m) => classifyMedication(m.drug).includes("SAMA"));

  // 1. Non-selective beta-blockers
  for (const m of activeMeds) {
    if (classifyMedication(m.drug).includes("BETA_BLOCKER_NONSELECTIVE")) {
      alerts.push({
        severity: "CRITICAL",
        type: "CONTRAINDICATION",
        title: "Critical Bronchospasm Risk (Non-Selective Beta-Blocker)",
        description: `${m.drug} blocks airway β2 receptors, triggering life-threatening bronchospasm in obstructive airway disease.`,
        recommendation: "Stop immediately and switch to cardioselective β1 blocker (e.g. Bisoprolol or Metoprolol succinate) if indicated.",
        affectedMeds: [m.drug],
      });
    }
  }

  // 2. NSAIDs in Asthma / ACO
  for (const m of activeMeds) {
    if (classifyMedication(m.drug).includes("NSAID")) {
      alerts.push({
        severity: isAsthma || isAco ? "CRITICAL" : "WARNING",
        type: "CONTRAINDICATION",
        title: "NSAID / Aspirin Bronchospasm Warning",
        description: `${m.drug} can trigger severe acute bronchoconstriction in patients with underlying airway hyperresponsiveness (Samter's Triad / AERD).`,
        recommendation: isAsthma || isAco ? "Discontinue NSAID and use acetaminophen/paracetamol for analgesia." : "Use with caution; avoid high chronic doses.",
        affectedMeds: [m.drug],
      });
    }
  }

  // 3. Therapeutic Duplications with Single-Inhaler Triple Therapy
  if (hasTriple) {
    const redundantMeds = activeMeds.filter((m) => {
      const classes = classifyMedication(m.drug);
      return (
        !classes.includes("TRIPLE") &&
        (classes.includes("LAMA") ||
          classes.includes("ICS") ||
          classes.includes("LABA") ||
          classes.includes("LABA_ICS") ||
          classes.includes("LABA_LAMA"))
      );
    });

    if (redundantMeds.length > 0) {
      alerts.push({
        severity: "WARNING",
        type: "DUPLICATE",
        title: "Therapeutic Duplication with Triple Therapy",
        description: `Patient is prescribed Single-Inhaler Triple Therapy concurrently with separate individual inhalers (${redundantMeds.map((m) => m.drug).join(", ")}).`,
        recommendation: "Stop separate single-agent LAMA and ICS inhalers to eliminate duplicate dosing and reduce systemic toxicity/pneumonia risk.",
        affectedMeds: redundantMeds.map((m) => m.drug),
      });
    }
  }

  // 4. Dual Anticholinergic (SAMA + LAMA or SAMA + Triple)
  if (hasSama && (hasLama || hasTriple)) {
    alerts.push({
      severity: "WARNING",
      type: "DUPLICATE",
      title: "Dual Anticholinergic Toxicity Overlap",
      description: "Concurrent use of SAMA (Ipratropium) with long-acting muscarinic antagonists increases anticholinergic adverse effects (dry mouth, urinary retention, acute narrow-angle glaucoma).",
      recommendation: "Stop SAMA and use pure SABA (Albuterol) for rescue bronchodilation.",
      affectedMeds: activeMeds.filter((m) => classifyMedication(m.drug).includes("SAMA")).map((m) => m.drug),
    });
  }

  // 5. GINA Asthma SABA Monotherapy Black-Box Warning
  if ((isAsthma || isAco) && hasSaba && !hasIcs && !hasTriple && !activeMeds.some((m) => classifyMedication(m.drug).includes("LABA_ICS"))) {
    alerts.push({
      severity: "CRITICAL",
      type: "GUIDELINE_GAP",
      title: "GINA Black-Box Warning: SABA Monotherapy Without Inhaled Corticosteroid",
      description: "Regular or PRN SABA use alone without anti-inflammatory ICS is clinically unsafe and associated with increased severe exacerbations and asthma-related death.",
      recommendation: "Add Inhaled Corticosteroid (ICS) or switch to ICS-Formoterol Anti-Inflammatory Reliever (MART).",
      affectedMeds: activeMeds.filter((m) => classifyMedication(m.drug).includes("SABA")).map((m) => m.drug),
    });
  }

  // 6. Asthma / ACO LABA or LAMA Monotherapy Warning
  const hasLabaOrLamaOnly = activeMeds.some((m) => {
    const cls = classifyMedication(m.drug);
    return (cls.includes("LABA") || cls.includes("LAMA") || cls.includes("LABA_LAMA")) && !cls.includes("ICS") && !cls.includes("TRIPLE") && !cls.includes("LABA_ICS");
  });
  if ((isAsthma || isAco) && hasLabaOrLamaOnly && !hasIcs && !hasTriple && !activeMeds.some((m) => classifyMedication(m.drug).includes("LABA_ICS"))) {
    alerts.push({
      severity: "CRITICAL",
      type: "CONTRAINDICATION",
      title: "LABA/LAMA Monotherapy in Asthma / ACO",
      description: "Long-acting bronchodilator monotherapy without an inhaled corticosteroid is contraindicated in asthma/ACO due to risk of severe exacerbations and death.",
      recommendation: "Immediately add an Inhaled Corticosteroid (ICS) or switch to a combination ICS/LABA or Triple Therapy.",
      affectedMeds: activeMeds.filter((m) => {
        const cls = classifyMedication(m.drug);
        return (cls.includes("LABA") || cls.includes("LAMA") || cls.includes("LABA_LAMA")) && !cls.includes("ICS") && !cls.includes("TRIPLE") && !cls.includes("LABA_ICS");
      }).map((m) => m.drug),
    });
  }

  return alerts;
}

/**
 * Analyze Inhaler Technique checklist and generate educational alerts.
 */
export function analyzeInhalerTechnique(formData = {}, prescriptions = []) {
  const alerts = [];
  const device = formData.inh_device || "";
  
  if (device.includes("MDI") && formData.inh_chk_shake === false) {
    alerts.push("Remember to shake the pMDI vigorously before each actuation to mix the propellant and medication.");
  }
  if (device.includes("MDI") && formData.inh_chk_spacer === false) {
    alerts.push("Use a valved holding chamber (spacer) with the pMDI to improve lung deposition and reduce oropharyngeal impaction.");
  }
  if (formData.inh_chk_exhale === false) {
    alerts.push("Critical Step Missed: Must exhale fully (away from the inhaler) before actuation to allow deep inhalation.");
  }
  if (formData.inh_chk_hold === false) {
    alerts.push("Critical Step Missed: Hold breath for 5-10 seconds after inhaling to allow medication to settle in the lower airways.");
  }
  
  const hasIcs = (Array.isArray(prescriptions) ? prescriptions : []).some(m => {
    const cls = classifyMedication(m.drug);
    return (cls.includes("ICS") || cls.includes("TRIPLE") || cls.includes("LABA_ICS")) && m.action !== "Stopped";
  });
  
  if (formData.inh_chk_rinse === false && hasIcs) {
    alerts.push("Mouth rinsing is required after using ICS-containing inhalers to prevent oral candidiasis (thrush).");
  }

  return alerts;
}

/**
 * Determine guideline escalation tier (GOLD A/B/E or GINA 1–5).
 */
export function generateGuidelineEscalation(formData = {}) {
  const dx = String(
    formData.pulm_triage_pathway ||
      formData.primary_diagnosis ||
      formData.diagnosis ||
      "COPD"
  ).toLowerCase();
  const isCopd = /copd|emphysema|bronchitis|airway obstruction/i.test(dx);
  const isAsthma = /asthma|eosinophil/i.test(dx);

  const exac = parseInt(formData.exacerbations_last_year || formData.pulm_exacerbations || 0, 10);
  const hosp = parseInt(formData.hospitalized_exacerbation || formData.pulm_hospitalizations || 0, 10);
  const eos = parseFloat(formData.blood_eosinophils || formData.lab_eosinophils || 0);
  const fev1 = parseFloat(formData.fev1_percent || formData.pft_fev1_pred || 0);

  if (isCopd) {
    if (exac >= 2 || hosp >= 1) {
      let firstLine = "LABA + LAMA Dual Therapy";
      let rationale = `Patient has ≥2 moderate or ≥1 hospitalized exacerbation in past 12 months (${exac} exac, ${hosp} hosp).`;
      
      if (eos >= 300) {
        firstLine = "Single-Inhaler Triple Therapy (ICS + LABA + LAMA, e.g. Trelegy Ellipta or Breztri Aerosphere)";
        rationale += ` Blood eosinophils ≥ 300 (${eos}). Strong recommendation to add ICS (Triple Therapy) to prevent exacerbations.`;
      } else if (eos < 100 && eos > 0) {
        firstLine = "LABA + LAMA Dual Therapy";
        rationale += ` Blood eosinophils < 100 (${eos}). ICS provides little benefit and increases pneumonia risk; use LABA+LAMA instead of Triple.`;
      } else {
        firstLine = "LABA + LAMA Dual Therapy or Triple Therapy";
        rationale += ` Consider Triple Therapy if exacerbations continue on LABA+LAMA.`;
      }

      const hxPneumonia = parseInt(formData.hx_pneumonia_count || 0, 10);
      if (fev1 > 0 && fev1 < 50 && (hxPneumonia > 0 || exac >= 3)) {
        rationale += " Consider adding PDE4 Inhibitor (Roflumilast) for chronic bronchitis with FEV1 < 50%.";
      }

      return {
        guideline: "GOLD 2024",
        category: "Group E (Frequent Exacerbator)",
        firstLine: firstLine,
        rescue: "Albuterol MDI 2 puffs q4-6h PRN",
        decision: "step_up",
        rationale: rationale,
      };
    }
    return {
      guideline: "GOLD 2024",
      category: "Group B (Symptomatic Non-Exacerbator)",
      firstLine: "Dual Bronchodilation (LAMA + LABA, e.g. Anoro or Stiolto)",
      rescue: "Albuterol MDI PRN",
      decision: "step_up",
      rationale: "Dual bronchodilation provides superior symptom relief and FEV1 improvement over monotherapy.",
    };
  }

  if (isAsthma) {
    const isSevere = eos >= 300 || fev1 < 60 || exac >= 2;
    const firstLine = isSevere
        ? "Medium/High-dose ICS-Formoterol MART + LAMA. Evaluate for Anti-IL5/IL4R Biologic (e.g. Mepolizumab, Benralizumab, Dupilumab) given severe eosinophilic phenotype."
        : "Low-dose ICS-Formoterol Maintenance & Reliever (MART)";
    return {
      guideline: "GINA 2024",
      category: isSevere ? "Track 1: Step 4–5 Severe / Eosinophilic" : "Track 1: Step 2–3 Moderate",
      firstLine: firstLine,
      rescue: "ICS-Formoterol PRN as anti-inflammatory reliever",
      decision: isSevere ? "step_up" : "no_change",
      rationale: `GINA 2024 Track 1 strategy ensures airway anti-inflammatory coverage with every puff. ${isSevere ? "Biologic evaluation strongly recommended for severe eosinophilic exacerbators." : ""}`,
    };
  }

  return {
    guideline: "Standard Pulmonology",
    category: "Individualized Regimen",
    firstLine: "Guideline-concordant maintenance",
    rescue: "Short-acting bronchodilator PRN",
    decision: "no_change",
    rationale: "Reconcile against current active diagnoses and contraindications.",
  };
}

/**
 * Deterministic fallback to reconcile active prescriptions and clinical fields.
 */
export function buildReconciledRegimen(currentPrescriptions = [], formData = {}) {
  const meds = (Array.isArray(currentPrescriptions) ? currentPrescriptions : []).map((m) => ({ ...m }));
  const dx = String(
    formData.pulm_triage_pathway ||
      formData.primary_diagnosis ||
      formData.diagnosis ||
      "COPD"
  ).toLowerCase();
  const isCopd = /copd|emphysema|bronchitis|airway obstruction/i.test(dx);
  const isAsthma = /asthma|eosinophil/i.test(dx);
  const isAco = /overlap|aco/i.test(dx) || (isCopd && isAsthma);

  const exac = parseInt(formData.exacerbations_last_year || formData.pulm_exacerbations || 0, 10);
  const hosp = parseInt(formData.hospitalized_exacerbation || formData.pulm_hospitalizations || 0, 10);
  const eos = parseFloat(formData.blood_eosinophils || formData.lab_eosinophils || 0);
  const isGroupE = isCopd && (exac >= 2 || hosp >= 1);

  const hasTriple = meds.some(
    (m) => classifyMedication(m.drug).includes("TRIPLE") && m.action !== "Stopped"
  );
  let shouldAddTriple = isGroupE && eos >= 300 && !hasTriple;

  const reconciledPrescriptions = meds.map((med) => {
    const item = { ...med };
    const classes = classifyMedication(item.drug);

    if (classes.includes("BETA_BLOCKER_NONSELECTIVE")) {
      item.action = "Stopped";
      item.alert = "CRITICAL: Non-selective beta-blocker precipitates bronchospasm in obstructive airways.";
      item.rationale = "Stopped: Contraindicated in COPD/Asthma. Switch to cardioselective beta-1 blocker if needed.";
    } else if (classes.includes("NSAID")) {
      if (isAsthma || isAco) {
        item.action = "Stopped";
        item.alert = "CRITICAL: High risk of NSAID/Aspirin-induced bronchospasm (Samter's Triad).";
        item.rationale = "Discontinued: Avoid in asthma due to bronchospasm risk.";
      }
    } else if ((hasTriple || shouldAddTriple) && (classes.includes("LAMA") || classes.includes("ICS") || classes.includes("LABA") || classes.includes("LABA_ICS") || classes.includes("LABA_LAMA")) && !classes.includes("TRIPLE")) {
      item.action = "Stopped";
      item.alert = "DUPLICATE: Component already included in Single-Inhaler Triple Therapy.";
      item.rationale = "Stopped: Consolidated into single-inhaler triple therapy to prevent duplicate dosing.";
    } else if (classes.includes("SAMA") && (meds.some((m) => classifyMedication(m.drug).includes("LAMA")) || hasTriple || shouldAddTriple)) {
      item.action = "Stopped";
      item.alert = "DUAL ANTICHOLINERGIC: Avoid concurrent SAMA + LAMA.";
      item.rationale = "Stopped: Discontinued to eliminate additive anticholinergic side effects.";
    } else if ((isAsthma || isAco) && (classes.includes("LABA") || classes.includes("LAMA") || classes.includes("LABA_LAMA")) && !classes.includes("ICS") && !classes.includes("TRIPLE") && !classes.includes("LABA_ICS") && !hasIcs) {
      item.alert = "CRITICAL: LABA/LAMA Monotherapy is unsafe in Asthma/ACO without ICS.";
    } else if (classes.includes("SABA")) {
      item.action = "Continue";
      item.rationale = "Maintained: Short-acting rescue bronchodilator for acute dyspnea.";
    } else if (classes.includes("TRIPLE")) {
      item.action = "Continue";
      item.rationale = "Maintained: 1st-line maintenance for frequent exacerbation reduction.";
    }

    return item;
  });

  if (shouldAddTriple) {
    reconciledPrescriptions.push({
      id: "med_triple_auto",
      drug: "Fluticasone/Umeclidinium/Vilanterol (Trelegy Ellipta)",
      dose: "100/62.5/25 mcg",
      freq: "OD (Once daily)",
      purpose: "Single-inhaler triple therapy maintenance",
      action: "Continue",
      alert: "GOLD Group E step-up: 1st-line triple therapy for frequent exacerbators with Eos >= 300.",
      rationale: "Initiated single-inhaler triple therapy to reduce exacerbations.",
    });
  }

  const escalation = generateGuidelineEscalation(formData);
  const fev1 = parseFloat(formData.fev1_percent || formData.pft_fev1_pred || 0);
  const ctd = String(formData.hx_ctd || formData.hx_rheumatoid || "No").toLowerCase();
  const hasArthritis = ctd.includes("yes");

  let recommendedDevice =
    fev1 && fev1 < 35
      ? "Nebuliser"
      : isCopd || isGroupE
      ? "DPI (dry powder inhaler)"
      : "pMDI (pressurised metered dose inhaler)";

  if (hasArthritis || String(formData.inh_technique).includes("Incorrect")) {
    recommendedDevice = "Soft mist inhaler (Respimat) or pMDI with Spacer (due to arthritis/technique issues)";
  }

  const clinicalRationale =
    isGroupE && eos >= 300
      ? `Patient qualifies as GOLD Group E frequent exacerbator (${exac} exacerbations) with Eosinophils ≥300. Guideline-directed step-up to single-inhaler Triple Therapy initiated. Prior single-agent inhalers marked Stopped to prevent duplicate dosing.`
      : escalation.rationale;

  const techniqueAlerts = analyzeInhalerTechnique(formData, reconciledPrescriptions);
  const techniqueNotes = techniqueAlerts.length > 0
    ? techniqueAlerts.join(" ")
    : "Instruct patient on proper device inhalation technique. Emphasize mouth rinsing after ICS-containing inhaler to prevent oral candidiasis.";

  return {
    reconciledPrescriptions,
    safetyAlerts: analyzePrescriptionSafety(reconciledPrescriptions, formData),
    techniqueAlerts,
    guidelineSummary: `${escalation.guideline} ${escalation.category}`,
    regimenChangeDecision: escalation.decision,
    recommendedDevice,
    clinicalRationale,
    techniqueNotes,
  };
}
