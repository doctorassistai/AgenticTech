/**
 * chemoCrosswalk.js
 * 
 * Translation layer between OPRecord's partA…F schema and the canonical
 * Patient Context database schema used by ChemotherapyWorkflow.
 * 
 * Architecture:
 *   OP Record UI  →  opRecordToWorkflow()  →  Patient Context DB
 *   OP Record UI  ←  workflowToOPRecord()  ←  Patient Context DB
 * 
 * Both functions are PURE — no side effects, no API calls, no setState.
 * They just reshape data objects.
 */

// ─── HELPER: Split a full name into firstName / lastName ──────────────
const splitName = (fullName) => {
  const parts = (fullName || "").trim().split(" ");
  return {
    firstName: parts[0] || "",
    lastName: parts.slice(1).join(" ") || ""
  };
};

// ─── HELPER: Join firstName + lastName back into a single string ──────
const joinName = (firstName, lastName) => {
  return [firstName, lastName].filter(Boolean).join(" ");
};

// ─── HELPER: Convert OPRecord ECOG value ("0"–"5") to Workflow format ("ecog-0") ──
const ecogToWorkflow = (val) => {
  if (!val && val !== "0") return "";
  return `ecog-${val}`;
};

// ─── HELPER: Convert Workflow ECOG value ("ecog-0") back to OPRecord format ("0") ──
const ecogToOPRecord = (val) => {
  if (!val) return "";
  return val.replace("ecog-", "");
};

// ─── HELPER: Convert OPRecord allergy "no" to Workflow "no-nkda" ──────
const allergyToWorkflow = (val) => {
  if (val === "no") return "no-nkda";
  return val || "";
};

const allergyToOPRecord = (val) => {
  if (val === "no-nkda") return "no";
  return val || "";
};

// ─── HELPER: Convert OPRecord "yes"/"no" string to boolean ───────────
const yesNoToBool = (val) => val === "yes";
const boolToYesNo = (val) => val === true ? "yes" : val === false ? "no" : "";

// ─── HELPER: Convert OPRecord interval number to Workflow string ──────
const intervalToWorkflow = (days) => {
  if (!days) return "";
  return `every ${days} days`;
};

const intervalToOPRecord = (str) => {
  if (!str) return "";
  const match = String(str).match(/(\d+)/);
  return match ? match[1] : str;
};

// ─── HELPER: Serialize OPRecord pre-investigation array to JSON string ──
const investigationsToText = (overview) => {
  if (!overview.baselineInvestigations || overview.baselineInvestigations.length === 0) return "";
  try {
    return JSON.stringify(overview.baselineInvestigations.map(inv => ({ testName: inv.testName || "", remarks: inv.remarks || "", value: inv.value || "" })));
  } catch (e) {
    return "";
  }
};

// ─── HELPER: Deserialize JSON string or fallback text back to array ───────────────
const textToInvestigations = (text) => {
  if (!text) return { baselineInvestigations: [] };
  
  try {
    const parsed = JSON.parse(text);
    if (Array.isArray(parsed)) {
      return { 
        baselineInvestigations: parsed.map((item, i) => ({ 
          id: Date.now() + i, 
          testName: item.testName || "", 
          remarks: item.remarks || "",
          value: item.value || ""
        }))
      };
    }
  } catch (e) {
    // Fallback for legacy text format like "CBC, LFT"
    const items = text.split(",").map(t => t.trim()).filter(Boolean);
    return {
      baselineInvestigations: items.map((item, i) => ({
        id: Date.now() + i,
        testName: item,
        remarks: ""
      }))
    };
  }
  return { baselineInvestigations: [] };
};


/**
 * opRecordToWorkflow
 * 
 * Converts OPRecord's formData (overview, partA…F) into the canonical DB shape.
 * 
 * @param {Object} opFormData - OPRecord's formData
 * @param {Object} treatment - Treatment metadata
 * @param {Object} rawDbData - Existing raw database data (to preserve other cycles)
 * @param {number} activeEditCycle - The cycle being edited
 * @returns {Object} { formData, treatmentUpdates }
 */
export const opRecordToWorkflow = (opFormData, treatment, rawDbData = {}, activeEditCycle = null) => {
  const { overview, partA, partB, partC, partD, partE, partF } = opFormData;
  const cycleKey = String(activeEditCycle || treatment?.currentCycle || 1);
  const { firstName, lastName } = splitName(overview.patientName);

  // ─── Patient-scoped sections (flat, not under cycles) ──────────────

  const summary = {
    patientId: overview.patientId || "",
    firstName,
    lastName,
    age: overview.patientAge || "",
    sex: overview.patientGender || "",
    registrationDate: overview.registrationDate || "",
    nextDueDate: partE.followUpDaycare || partE.followUpDoctor || "",
  };

  const allergyList = Array.isArray(overview.allergies) ? overview.allergies : [];
  const firstAllergy = allergyList.length > 0 ? allergyList[0] : {};

  const assessment = {
    diagnosis: overview.patientDiagnosis || "",
    performanceStatus: ecogToWorkflow(overview.ecog),
    tumorBoard: overview.tbPastDecision || "",
    allergyStatus: allergyToWorkflow(overview.allergy),
    allergies: allergyList,
    allergyDrug: firstAllergy.drug || "",
    allergyType: firstAllergy.type || "",
    allergySeverity: firstAllergy.severity || "",
    interactionCheckSource: firstAllergy.interactionChecked || "",
    baselineLabs: investigationsToText(overview),
    serumCreatinine: overview.serumCreatinine || "",
    height: overview.height || "",
    weight: overview.weight || "",
    
    // OPRecord-only fields
    tbFollowed: overview.tbFollowed || "",
    tbNotFollowedReason: overview.tbNotFollowedReason || "",
    tbScheduleDate: overview.tbScheduleDate || "",
    tbQuestion: overview.tbQuestion || "",
  };

  // --- Auto-calculate cumulative doses ---
  let calculatedCumulativeDoses = "—";
  if (treatment && treatment.completedCycles) {
    const cycles = parseInt(treatment.completedCycles);
    if (cycles && !isNaN(cycles)) {
      if (!partA.drugs || partA.drugs.length === 0 || !partA.drugs[0].name) {
        calculatedCumulativeDoses = "— (No drugs defined in Part A Plan)";
      } else {
        const h = parseFloat(overview.height);
        const w = parseFloat(overview.weight);
        const bsa = (h && w) ? (0.007184 * Math.pow(h, 0.725) * Math.pow(w, 0.425)) : 0;
        
        const doses = partA.drugs.map(drug => {
          let perCycleNum = 0;
          const doseVal = parseFloat(drug.dose);
          if (!isNaN(doseVal)) {
            if (drug.unit === "m2" && bsa > 0) {
              perCycleNum = Math.round(doseVal * bsa);
            } else if (drug.unit === "kg" && w > 0) {
              perCycleNum = Math.round(doseVal * w);
            } else {
              perCycleNum = doseVal;
            }
          }
          if (perCycleNum > 0 && drug.name) {
            const total = perCycleNum * cycles;
            let unitStr = (drug.unit === "m2" || drug.unit === "kg") ? "mg" : (drug.unit || "");
            return `${drug.name}: ${total} ${unitStr}`.trim() + ` (${perCycleNum} ${unitStr}/cycle × ${cycles} cycles)`;
          }
          return "";
        }).filter(Boolean);
        
        if (doses.length > 0) {
          calculatedCumulativeDoses = doses.join("\n");
        }
      }
    }
  } else {
    calculatedCumulativeDoses = "— (No completed cycles recorded to auto-calculate)";
  }

  const completion = {
    toleratedWell: partE.tolerated || "",
    watchSymptoms: {
      pain: partE.watchPain || false,
      motions: partE.watchMotions || false,
      constipation: partE.watchConstipation || false,
      vomiting: partE.watchVomiting || false,
      wbc: partE.watchWBC || false,
      mouth: partE.watchMouth || false,
      indigestion: partE.watchIndigestion || false,
      fever: partE.watchFever || false,
    },
    dischargeDrugs: partE.dischargeDrugs || [],
    followUpSchedule: partE.followUpDoctor || "",
    followUpDaycare: partE.followUpDaycare || "",
    
    totalCyclesCompleted: String(treatment?.completedCycles || ""),
    cumulativeDoses: calculatedCumulativeDoses,
    treatmentOutcomes: partE.treatmentOutcomes || "",
    residualToxicity: partE.residualToxicity || "",
    treatmentCompletionStatus: partE.treatmentCompletionStatus || "",
    treatmentNotCompletedReason: partE.treatmentCompletionStatus === "not-completed" ? (partE.treatmentNotCompletedReason || "") : "",
    treatmentNotCompletedNotes: partE.treatmentCompletionStatus === "not-completed" ? (partE.treatmentNotCompletedNotes || "") : "",
    toxicitySummaryText: partE.toxicitySummaryText || "",
    dischargePreparedBy: partE.dischargePreparedBy || "",
    endOfResponseTreatment: partE.endOfResponseTreatment || "",
    endOfResponseDate: partE.endOfResponseDate || "",
    cycleCompletionDates: partE.cycles || [], // OPRecord-only history
  };

  const qa = {
    auditPeriod: partE.auditPeriod || "",
    dosingAccuracy: partE.dosingAccuracy || "",
    adverseEventRate: partE.adverseEventRate || "",
    protocolAdherence: partE.protocolAdherence || "",
    incidentReview: partE.incidentReview || "",
  };

  const final_summary = {
    overallAssessment: partF.overallAssessment || "",
    recommendations: partF.recommendations || "",
    physicianSignature: partF.physicianSignature || "",
    signatureDate: partF.signatureDate || "",
    physicianSigned: !!partF.physicianSigned,
    dischargePreparedBy: partF.dischargePreparedBy || partE.dischargePreparedBy || "",
    toxicitySummaryText: partF.toxicitySummaryText || partE.toxicitySummaryText || "",
    treatmentCompletionStatus: partF.treatmentCompletionStatus || partE.treatmentCompletionStatus || "",
    treatmentNotCompletedReason: (partF.treatmentCompletionStatus || partE.treatmentCompletionStatus) === "not-completed"
      ? (partF.treatmentNotCompletedReason || partE.treatmentNotCompletedReason || "")
      : "",
    treatmentNotCompletedNotes: (partF.treatmentCompletionStatus || partE.treatmentCompletionStatus) === "not-completed"
      ? (partF.treatmentNotCompletedNotes || partE.treatmentNotCompletedNotes || "")
      : "",
    endOfResponseTreatment: partF.endOfResponseTreatment || partE.endOfResponseTreatment || "",
    endOfResponseDate: partF.endOfResponseDate || partE.endOfResponseDate || "",
  };

  // ─── Cycle-scoped sections (stored under cycles[currentCycle]) ─────

  const details = {
    detailsName: joinName(summary.firstName, summary.lastName),
    age: overview.patientAge || "",
    gender: overview.patientGender || "",
    height: overview.height || "",
    weight: overview.weight || "",
    lmpDate: overview.lmpDate || "",
    consultants: {
      drA: partB.consultantDrA || false,
      drB: partB.consultantDrB || false,
      drC: partB.consultantDrC || false,
    },
    consultantName: partB.consultantName || "",
    tumorBoardReference: overview.tbAssign || "",
    emergencyContact: partE.emergencyContact || "",
  };

  const regimen = {
    treatmentIntent: String(partB.intent || partA.intent || ""),
    selectedProtocol: String(partB.docProtocolSelect || partA.protocolName || ""),
    intervalDetails: intervalToWorkflow(partA.daysBetween),
    startDate: String(partB.docStartDate || partA.startDate || ""),
    protocolDetails: String(partA.protocolDetails || partA.specialInstructions || ""),
    doseAdjustments: String(partB.docProtocolChangeReason || partA.doseAdjustments || ""),
    concurrentTherapy: String(partA.concurrentTherapy || ""),
    chemoType: String(partA.chemoType || ""),
    chemoTypeOther: String(partA.chemoTypeOther || ""),
    reasonForChange: String(partA.reasonForChange || ""),
    protocolMasterRef: String(partA.protocolMasterRef || ""),
    drugs: partA.drugs || [],
    
    // Treatment type checkboxes from partB (which we kept in partB)
    treatmentTypeNeo: partB.therapyNeoAdjuvant || false,
    treatmentTypeCon: partB.therapyConcurrent || false,
    treatmentTypeAdj: partB.therapyAdjuvant || false,
    treatmentTypeSole: partB.therapyCTAlone || false,

    // OPRecord-only
    docOngoingTox: partB.docOngoingTox || "",
    docProceed: partB.docProceed || (partB.treatmentDecision === "continue" ? "yes" : partB.treatmentDecision ? "no" : ""),
    treatmentDecision: partB.treatmentDecision || (partB.docProceed === "yes" ? "continue" : ""),
    treatmentDecisionJustification: partB.treatmentDecisionJustification || "",
    docReasons: {
      tolerance: partB.docReasonTolerance || false,
      progression: partB.docReasonProgression || false,
      choice: partB.docReasonChoice || false,
    },
    postponeFromDate: partB.postponeFromDate || "",
    postponeUntilDate: partB.postponeUntilDate || "",
    postponeDays: partB.postponeDays || "",
    postponeReassessmentPlan: partB.postponeReassessmentPlan || "",
  };

  const pre_chemo = {
    cycleNumber: partB.docCycleNo || "",
    height: overview.height || "",
    weight: overview.weight || "",
    informedConsent: yesNoToBool(partB.consentTaken),
    consentDate: partB.consentTaken === "yes" ? (partB.consentDate || "") : "",
    consentDocumentName: partB.consentTaken === "yes" ? (partB.consentDocumentName || "") : "",
    consentDocumentUrl: partB.consentTaken === "yes" ? (partB.consentDocumentUrl || "") : "",
    currentLabs: partB.currentLabs || "",
    venousAccess: partB.venousAccess || "",
    emergencyMeds: partB.emergencyMeds || "",
    safetyVerified: partB.safetyVerified || "",
  };

  const prep = {
    drugName: partB.drugPreparations?.[0]?.drugName || partB.medDrugName || (partA.drugs?.[0]?.name || ""),
    dosePerSqm: partB.drugPreparations?.[0]?.dose || partB.medDose || (partA.drugs?.[0]?.dose || ""),
    doseUnit: partB.drugPreparations?.[0]?.doseUnit || partB.medDoseUnit || partA.drugs?.[0]?.unit || "m2",
    calculatedDose: "", // Derived in UI
    pharmacyVerification: partB.pharmacyVerification || false,
    nurseVerification: partB.nurseVerification || false,
    prepPPE: partB.prepPPE || false,
    labelingDetails: partB.labelingDetails || "",
    
    // Modification fields
    modifiedDose: partB.drugPreparations?.[0]?.modDose || partB.medModDose || "",
    modifiedDoseUnit: partB.drugPreparations?.[0]?.modDoseUnit || partB.medModDoseUnit || "mg",
    doseModified: partB.drugPreparations?.[0]?.whetherMod || partB.medWhetherMod || "",
    modReasons: {
      comorbidities: partB.drugPreparations?.[0]?.modReasonComorb || partB.medModReasonComorb || false,
      toxicity: partB.drugPreparations?.[0]?.modReasonTox || partB.medModReasonTox || false,
      performance: partB.drugPreparations?.[0]?.modReasonPerf || partB.medModReasonPerf || false,
      nutritional: partB.drugPreparations?.[0]?.modReasonNutri || partB.medModReasonNutri || false,
      general: partB.drugPreparations?.[0]?.modReasonGen || partB.medModReasonGen || false,
      other: partB.drugPreparations?.[0]?.modReasonOther || partB.medModReasonOther || false,
    },
    approvalDoctorName: partB.approvalDoctorName || "",
    approvalDoctorSigned: partB.approvalDoctorSigned || false,
    drugs: partB.drugPreparations?.map(d => ({
      drugName: d.drugName || "",
      dosePerSqm: d.dose || "",
      doseUnit: d.doseUnit || "m2",
      modifiedDose: d.modDose || "",
      modifiedDoseUnit: d.modDoseUnit || "mg",
      doseModified: d.whetherMod || "",
      modReasons: {
        comorbidities: d.modReasonComorb || false,
        toxicity: d.modReasonTox || false,
        performance: d.modReasonPerf || false,
        nutritional: d.modReasonNutri || false,
        general: d.modReasonGen || false,
        other: d.modReasonOther || false,
      }
    })) || []
  };

  const admin = {
    placeOfTreatment: {
      casualty: partC.placeOfTreatmentCasualty || false,
      daycare: partC.placeOfTreatmentDaycare || false,
      injectionRoom: partC.placeOfTreatmentInjectionRoom || false,
      ir: partC.placeOfTreatmentIR || false,
      paediatric: partC.placeOfTreatmentPaediatric || false,
      ward: partC.placeOfTreatmentWard || false,
      other: partC.placeOfTreatmentOther || false,
    },
    wardType: partC.wardType || "",
    vitals: {
      tempPre: partC.tempPre || "", tempDuring: partC.tempDuring || "", tempPost: partC.tempPost || "",
      pulsePre: partC.pulsePre || "", pulseDuring: partC.pulseDuring || "", pulsePost: partC.pulsePost || "",
      bpPre: partC.bpPre || "", bpDuring: partC.bpDuring || "", bpPost: partC.bpPost || "",
      rrPre: partC.rrPre || "", rrDuring: partC.rrDuring || "", rrPost: partC.rrPost || "",
      spo2Pre: partC.spo2Pre || "", spo2During: partC.spo2During || "", spo2Post: partC.spo2Post || "",
      painPre: partC.painPre || "", painDuring: partC.painDuring || "", painPost: partC.painPost || "",
    },
    
    adminRoute: partC.adminRoute || "",
    adminRouteNotes: partC.adminRouteNotes || "",
    totalDose: (() => {
      const h = parseFloat(overview.height);
      const w = parseFloat(overview.weight);
      const bsa = (h && w) ? (0.007184 * Math.pow(h, 0.725) * Math.pow(w, 0.425)) : 0;
      const doses = (partA.drugs || []).map(drug => {
        let calc = "";
        let formula = "";
        const doseVal = parseFloat(drug.dose);
        if (!isNaN(doseVal)) {
          if (drug.unit === "m2" && bsa > 0) {
            calc = Math.round(doseVal * bsa) + " mg";
            formula = `(${doseVal} mg/m² × ${bsa.toFixed(2)} m²)`;
          } else if (drug.unit === "kg" && w > 0) {
            calc = Math.round(doseVal * w) + " mg";
            formula = `(${doseVal} mg/kg × ${w} kg)`;
          } else {
            calc = `${doseVal} ${drug.unit || ""}`.trim();
          }
        }
        return drug.name && calc ? `${drug.name}: ${calc} ${formula}`.trim() : "";
      }).filter(Boolean);
      return doses.length > 0 ? doses.join("  |  ") : (partC.totalDose || "");
    })(),
    patientIdConfirmed: partC.patientIdConfirmed || false,
    regimenConfirmed: partC.regimenConfirmed || false,
    preMedication: partC.preMedication || "",
    approvalPreparedNurseName: partC.approvalPreparedNurseName || "",
    approvalPreparedNurseSigned: partC.approvalPreparedNurseSigned || false,
    approvalVerifiedNurseName: partC.approvalVerifiedNurseName || "",
    approvalVerifiedNurseSigned: partC.approvalVerifiedNurseSigned || false,
    adminDrugs: partC.drugs || [],
    startTime: partC.drugs?.[0]?.startTime || "",
    endTime: partC.drugs?.[0]?.endTime || "",
    infusionObservations: partC.doctorNotes || "",
  };

  const cycle_admin = {
    cycleDate1: partC.planDate || "",
    cycleCompleted: partC.cycleCompleted || "",
    notCompletedReason: partC.cycleCompleted === "not-completed" ? (partC.cycleNotCompletedReason || "") : "",
    remarks: partC.doctorNotes || "",
    medsGiven: admin.totalDose || "",
  };

  const post_chemo = {
    monitoringPeriod: partD.monitoringPeriod || "",
    nadirLabs: partD.nadirLabs || "",
    sideEffectMgt: partD.sideEffectMgt || "",
    toxicities: partD.toxicities || [],
    adverseEvents: (partD.toxicities || [])
      .filter(t => t.event || t.description)
      .map(t => `${t.event || ""}: ${t.description || ""} (Grade ${t.grade || "?"})`)
      .join("; "),
    attribution: partD.attribution || "",
    postponeTreatment: partD.postponeTreatment || "no",
    postponeReason: partD.postponeReason || "",
    doseAdjustment: partD.postponeReason || "",
    postponeDays: partD.postponeDays || "",
    postponeFromDate: partD.postponeTreatment === "yes" ? (partD.postponeFromDate || "") : "",
    postponeUntilDate: partD.postponeTreatment === "yes" ? (partD.postponeUntilDate || "") : "",

    // Organ-Specific Monitoring
    organCardiac: partD.organCardiac || false,
    echoDetails: partD.echoDetails || "",
    lvef: partD.lvef || "",
    organPulmonary: partD.organPulmonary || false,
    pulmonaryTests: partD.pulmonaryTests || "",
    organNeuro: partD.organNeuro || false,
    neuroAssessment: partD.neuroAssessment || "",
    organAudio: partD.organAudio || false,
    audioTests: partD.audioTests || "",

    // Treatment-Specific Parameters
    trtUrineProtein: partD.trtUrineProtein || false,
    urineProteinDetails: partD.urineProteinDetails || "",
    trtThyroid: partD.trtThyroid || false,
    thyroidDetails: partD.thyroidDetails || "",
    trtGlucose: partD.trtGlucose || false,
    glucoseDetails: partD.glucoseDetails || "",
    trtEcg: partD.trtEcg || false,
    ecgDetails: partD.ecgDetails || "",
  };

  const response = {
    interimImaging: partD.interimImaging || "",
    responseCriteria: partD.responseCriteria || "",
    tumorBoardReview: partD.tumorBoardReview || "",
    tumorBoardReviewDetails: partD.tumorBoardReviewDetails || "",
    treatmentPlanUpdate: partD.postponeTreatment === "yes"
      ? `Treatment postponed: ${partD.postponeReason || "reason not specified"}`
      : "",
  };

  // ─── Assemble the canonical formData shape ─────────────────────────
  const formData = {
    ...rawDbData,
    summary,
    assessment,
    completion,
    qa,
    final_summary,
    cycles: {
      ...(rawDbData.cycles || {}),
      [cycleKey]: {
        ...(rawDbData.cycles?.[cycleKey] || {}),
        details,
        regimen,
        pre_chemo,
        prep,
        admin,
        cycle_admin,
        post_chemo,
        response,
        completion,
        qa,
        final_summary,
        assessment
      }
    }
  };

  const plannedCycles = parseInt(partA.cycles) || parseInt(partB.docPlannedCycles) || undefined;
  const treatmentUpdates = {};
  if (plannedCycles) {
    treatmentUpdates.plannedCycles = plannedCycles;
    
    // Also include the un-complete logic in the save payload updates
    if (treatment) {
      const compCycles = treatment.completedCycles || 0;
      const wasCompleted = compCycles >= plannedCycles || treatment.status === "all_cycles_completed" || treatment.treatmentCompleted;
      if (wasCompleted && compCycles < plannedCycles) {
        treatmentUpdates.currentCycle = compCycles + 1;
        treatmentUpdates.status = `cycle_${treatmentUpdates.currentCycle}_in_progress`;
        treatmentUpdates.treatmentCompleted = false;
      }
    }
  }

  return { formData, treatmentUpdates };
};


/**
 * workflowToOPRecord
 * 
 * Converts the canonical DB shape back into OPRecord's formData.
 * 
 * @param {Object} dbData - Canonical formData from the database
 * @param {Object} treatment - Treatment metadata
 * @param {number} activeEditCycle - The cycle to load
 * @returns {Object} OPRecord-shaped formData
 */
export const workflowToOPRecord = (dbData, treatment, activeEditCycle = null) => {
  const summary = dbData.summary || {};
  const assess = dbData.assessment || {};
  const comp = dbData.completion || {};
  const qaSection = dbData.qa || {};
  const finalSummary = dbData.final_summary || {};

  const cycleKey = String(activeEditCycle || treatment?.currentCycle || 1);
  const cycleData = dbData.cycles?.[cycleKey] || {};
  
  // Find fallback data from the most recent previous cycle (e.g. Cycle N-1)
  let fallbackDet = {};
  let fallbackReg = {};
  let fallbackPreC = {};
  let fallbackPrp = {};
  let fallbackAdm = {};
  let fallbackCAdm = {};
  let fallbackPostC = {};
  let fallbackResp = {};
  if (dbData.cycles) {
    for (let i = parseInt(cycleKey, 10) - 1; i >= 1; i--) {
      if (dbData.cycles[String(i)]) {
        fallbackDet = dbData.cycles[String(i)].details || {};
        fallbackReg = dbData.cycles[String(i)].regimen || {};
        fallbackPreC = dbData.cycles[String(i)].pre_chemo || {};
        fallbackPrp = dbData.cycles[String(i)].prep || {};
        fallbackAdm = dbData.cycles[String(i)].admin || {};
        fallbackCAdm = dbData.cycles[String(i)].cycle_admin || {};
        fallbackPostC = dbData.cycles[String(i)].post_chemo || {};
        fallbackResp = dbData.cycles[String(i)].response || {};
        break;
      }
    }
  }

  // Helper to deep merge and fallback intelligently
  const mergeSection = (current, fallback) => {
    if (!current || Object.keys(current).length === 0) return fallback;
    const merged = { ...fallback, ...current };
    
    // Specifically handle arrays like drugs or toxicities
    if (merged.drugs && merged.drugs.length === 1 && !merged.drugs[0].name) {
      merged.drugs = fallback.drugs || merged.drugs;
    } else if (!merged.drugs || merged.drugs.length === 0) {
      merged.drugs = fallback.drugs || [];
    }
    return merged;
  };

  const det = mergeSection(cycleData.details, fallbackDet);
  const reg = mergeSection(cycleData.regimen, fallbackReg);
  
  // Toxicity, cycle administration, prep, admin, pre_chemo, organ monitoring, and response are cycle-specific.
  // Never inherit previous cycle values — that caused cycle N save to look like cycle N+1 data.
  const preC = cycleData.pre_chemo || {};
  const prp = cycleData.prep || {};
  const adm = cycleData.admin || {};
  const cadm = cycleData.cycle_admin || {};
  const postC = cycleData.post_chemo || {};
  const resp = cycleData.response || {};

  // ─── overview ──────────────────────────────────────────────────────
  const overview = {
    patientName: det.detailsName || joinName(summary.firstName, summary.lastName),
    patientId: summary.patientId || "",
    patientAge: det.age || summary.age || "",
    patientGender: (det.gender || summary.sex || "").toLowerCase(),
    patientDiagnosis: assess.diagnosis || "",
    registrationDate: summary.registrationDate || "",
    height: preC.height || det.height || assess.height || "",
    weight: preC.weight || det.weight || assess.weight || "",
    serumCreatinine: assess.serumCreatinine || "",
    lmpDate: det.lmpDate || "",
    ecog: ecogToOPRecord(assess.performanceStatus),
    
    tbPastDecision: assess.tumorBoard || "",
    tbFollowed: assess.tbFollowed || "",
    tbNotFollowedReason: assess.tbNotFollowedReason || "",
    tbAssign: det.tumorBoardReference || "",
    tbScheduleDate: assess.tbScheduleDate || "",
    tbQuestion: assess.tbQuestion || "",
    
    allergy: allergyToOPRecord(assess.allergyStatus),
    allergies: Array.isArray(assess.allergies) && assess.allergies.length > 0 
      ? assess.allergies 
      : (assess.allergyDrug ? [{ 
          id: Date.now(), 
          drug: assess.allergyDrug || "", 
          type: assess.allergyType || "", 
          severity: assess.allergySeverity || "", 
          interactionChecked: assess.interactionCheckSource || "" 
        }] : []),
    
    ...textToInvestigations(assess.baselineLabs),
  };

  // ─── partA (Protocol Master) ─────────────────────────────────────────
  const partA = {
    intent: reg.treatmentIntent || "",
    protocolName: reg.selectedProtocol || "",
    startDate: reg.startDate || "",
    cycles: treatment?.plannedCycles ? String(treatment.plannedCycles) : "",
    daysBetween: intervalToOPRecord(reg.intervalDetails),
    protocolDetails: reg.protocolDetails || "",
    doseAdjustments: reg.doseAdjustments || "",
    concurrentTherapy: reg.concurrentTherapy || "",
    chemoType: reg.chemoType || "",
    chemoTypeOther: reg.chemoTypeOther || "",
    reasonForChange: reg.reasonForChange || "",
    protocolMasterRef: reg.protocolMasterRef || "",
    specialInstructions: reg.protocolDetails || "",
    drugs: reg.drugs && reg.drugs.length > 0
      ? reg.drugs
      : [{ id: 1, name: "", type: "", dose: "", unit: "", maxDose: "", route: "", adminType: "", frequency: "", diluent: "", volume: "", duration: "", instructions: "" }],
  };

  // ─── partB (Doctor Note) ─────────────────────────────────────────────
  const partB = {
    consultantDrA: det.consultants?.drA || false,
    consultantDrB: det.consultants?.drB || false,
    consultantDrC: det.consultants?.drC || false,
    consultantName: det.consultantName || "",
    
    consentTaken: boolToYesNo(preC.informedConsent),
    consentDate: preC.consentDate || "",
    consentDocumentName: preC.consentDocumentName || "",
    consentDocumentUrl: preC.consentDocumentUrl || "",
    safetyVerified: preC.safetyVerified || "",
    
    docCycleNo: preC.cycleNumber || String(treatment?.currentCycle || 1),
    docOngoingTox: reg.docOngoingTox || "", 
    docProceed: reg.docProceed || (reg.treatmentDecision === "continue" ? "yes" : reg.treatmentDecision ? "no" : ""),
    treatmentDecision: reg.treatmentDecision || (reg.docProceed === "yes" ? "continue" : ""),
    treatmentDecisionJustification: reg.treatmentDecisionJustification || "",
    docReasonTolerance: reg.docReasons?.tolerance || false,
    docReasonProgression: reg.docReasons?.progression || false,
    docReasonChoice: reg.docReasons?.choice || false,
    
    postponeFromDate: reg.postponeFromDate || "",
    postponeUntilDate: reg.postponeUntilDate || "",
    postponeDays: reg.postponeDays || "",
    postponeReassessmentPlan: reg.postponeReassessmentPlan || "",
    
    // Treatment selection
    intent: reg.treatmentIntent || "",
    docProtocolSelect: reg.selectedProtocol || "",
    docPlannedCycles: treatment?.plannedCycles ? String(treatment.plannedCycles) : "",
    docProtocolChangeReason: reg.doseAdjustments || "",
    docFreqDay: det.frequency || "",
    docPlanDates: det.schedule || "",
    docStartDate: reg.startDate || "",
    
    therapyNeoAdjuvant: reg.treatmentTypeNeo || false,
    therapyConcurrent: reg.treatmentTypeCon || false,
    therapyAdjuvant: reg.treatmentTypeAdj || false,
    therapyCTAlone: reg.treatmentTypeSole || false,

    // Pre-chemo & Prep details
    currentLabs: preC.currentLabs || "",
    venousAccess: preC.venousAccess || "",
    emergencyMeds: preC.emergencyMeds || "",
    pharmacyVerification: prp.pharmacyVerification || false,
    nurseVerification: prp.nurseVerification || false,
    prepPPE: prp.prepPPE || false,
    labelingDetails: prp.labelingDetails || "",

    // Medication Details
    medDrugName: prp.drugName || (reg.drugs?.[0]?.name || ""),
    medDose: prp.dosePerSqm || (reg.drugs?.[0]?.dose || ""),
    medDoseUnit: prp.doseUnit || reg.drugs?.[0]?.unit || "m2",
    medWhetherMod: prp.doseModified || "",
    medModDose: prp.modifiedDose || "",
    medModDoseUnit: prp.modifiedDoseUnit || "mg",
    medModReasonComorb: prp.modReasons?.comorbidities || false,
    medModReasonTox: prp.modReasons?.toxicity || false,
    medModReasonPerf: prp.modReasons?.performance || false,
    medModReasonNutri: prp.modReasons?.nutritional || false,
    medModReasonGen: prp.modReasons?.general || false,
    medModReasonOther: prp.modReasons?.other || false,
    approvalDoctorName: prp.approvalDoctorName || "",
    approvalDoctorSigned: prp.approvalDoctorSigned || false,
    drugPreparations: prp.drugs && prp.drugs.length > 0
      ? prp.drugs.map((d, index) => ({
          id: Date.now() + index,
          drugName: d.drugName || "",
          dose: d.dosePerSqm || "",
          doseUnit: d.doseUnit || "m2",
          whetherMod: d.doseModified || "",
          modDose: d.modifiedDose || "",
          modDoseUnit: d.modifiedDoseUnit || "mg",
          modReasonComorb: d.modReasons?.comorbidities || false,
          modReasonTox: d.modReasons?.toxicity || false,
          modReasonPerf: d.modReasons?.performance || false,
          modReasonNutri: d.modReasons?.nutritional || false,
          modReasonGen: d.modReasons?.general || false,
          modReasonOther: d.modReasons?.other || false,
        }))
      : [{
          id: Date.now(),
          drugName: prp.drugName || (reg.drugs?.[0]?.name || ""),
          dose: prp.dosePerSqm || (reg.drugs?.[0]?.dose || ""),
          doseUnit: prp.doseUnit || reg.drugs?.[0]?.unit || "m2",
          whetherMod: prp.doseModified || "",
          modDose: prp.modifiedDose || "",
          modDoseUnit: prp.modifiedDoseUnit || "mg",
          modReasonComorb: prp.modReasons?.comorbidities || false,
          modReasonTox: prp.modReasons?.toxicity || false,
          modReasonPerf: prp.modReasons?.performance || false,
          modReasonNutri: prp.modReasons?.nutritional || false,
          modReasonGen: prp.modReasons?.general || false,
          modReasonOther: prp.modReasons?.other || false,
        }],
  };

  // ─── partC (Nurse Note) ──────────────────────────────────────────────
  const partC = {
    cycleNo: treatment?.currentCycle ? String(treatment.currentCycle) : "",
    frequency: det.frequency || "",
    planDate: cadm.cycleDate1 || "",
    placeOfTreatmentCasualty: adm.placeOfTreatment?.casualty || false,
    placeOfTreatmentDaycare: adm.placeOfTreatment?.daycare || false,
    placeOfTreatmentInjectionRoom: adm.placeOfTreatment?.injectionRoom || false,
    placeOfTreatmentIR: adm.placeOfTreatment?.ir || false,
    placeOfTreatmentPaediatric: adm.placeOfTreatment?.paediatric || false,
    placeOfTreatmentWard: adm.placeOfTreatment?.ward || false,
    placeOfTreatmentOther: adm.placeOfTreatment?.other || false,
    wardType: adm.wardType || "",
    
    tempPre: adm.vitals?.tempPre || "",
    tempDuring: adm.vitals?.tempDuring || "",
    tempPost: adm.vitals?.tempPost || "",
    pulsePre: adm.vitals?.pulsePre || "",
    pulseDuring: adm.vitals?.pulseDuring || "",
    pulsePost: adm.vitals?.pulsePost || "",
    bpPre: adm.vitals?.bpPre || "",
    bpDuring: adm.vitals?.bpDuring || "",
    bpPost: adm.vitals?.bpPost || "",
    rrPre: adm.vitals?.rrPre || "",
    rrDuring: adm.vitals?.rrDuring || "",
    rrPost: adm.vitals?.rrPost || "",
    spo2Pre: adm.vitals?.spo2Pre || "",
    spo2During: adm.vitals?.spo2During || "",
    spo2Post: adm.vitals?.spo2Post || "",
    painPre: adm.vitals?.painPre || "",
    painDuring: adm.vitals?.painDuring || "",
    painPost: adm.vitals?.painPost || "",
    
    adminRoute: adm.adminRoute || "",
    adminRouteNotes: adm.adminRouteNotes || "",
    totalDose: adm.totalDose || "",
    patientIdConfirmed: adm.patientIdConfirmed || false,
    regimenConfirmed: adm.regimenConfirmed || false,
    preMedication: adm.preMedication || "",
    approvalPreparedNurseName: adm.approvalPreparedNurseName || "",
    approvalPreparedNurseSigned: adm.approvalPreparedNurseSigned || false,
    approvalVerifiedNurseName: adm.approvalVerifiedNurseName || "",
    approvalVerifiedNurseSigned: adm.approvalVerifiedNurseSigned || false,
    
    drugs: adm.adminDrugs && adm.adminDrugs.length > 0 && adm.adminDrugs[0].name 
      ? adm.adminDrugs 
      : (partA.drugs && partA.drugs.length > 0 && partA.drugs[0].name
          ? partA.drugs.map((d, i) => {
              let calc = "";
              const h = parseFloat(overview.height);
              const w = parseFloat(overview.weight);
              const bsa = (h && w) ? (0.007184 * Math.pow(h, 0.725) * Math.pow(w, 0.425)) : 0;
              const doseVal = parseFloat(d.dose);
              if (!isNaN(doseVal)) {
                if (d.unit === "m2" && bsa > 0) {
                  calc = Math.round(doseVal * bsa) + " mg";
                } else if (d.unit === "kg" && w > 0) {
                  calc = Math.round(doseVal * w) + " mg";
                } else {
                  calc = `${doseVal} ${d.unit || ""}`.trim();
                }
              }
              return {
                id: Date.now() + i,
                name: d.name || "",
                instructions: d.instructions || "",
                dose: calc,
                diluent: d.diluent || "",
                given: "",
                startTime: "",
                endTime: "",
                notGivenReason: "",
                infusionReaction: ""
              };
            })
          : [{ id: 1, name: "", instructions: "", dose: "", diluent: "", given: "", startTime: "", endTime: "", notGivenReason: "", infusionReaction: "" }]),
    
    cycleCompleted: cadm.cycleCompleted || "",
    cycleNotCompletedReason: cadm.notCompletedReason || "",
    doctorNotes: cadm.remarks || "",
  };

  // ─── partD (Toxicity Management) ─────────────────────────────────────
  const partD = {
    toxicities: postC.toxicities && postC.toxicities.length > 0 
      ? postC.toxicities 
      : [{ id: 1, cycleDay: "", gradingSystem: "", system: "", event: "", description: "", onset: "", grade: "", managementPlace: "" }],
    
    attribution: postC.attribution || "",
    postponeTreatment: postC.postponeTreatment === "yes" || resp.treatmentPlanUpdate?.includes("postponed") ? "yes" : "no",
    postponeReason: postC.postponeReason || postC.doseAdjustment || "",
    postponeDays: postC.postponeDays || "",
    postponeFromDate: postC.postponeFromDate || "",
    postponeUntilDate: postC.postponeUntilDate || "",
    
    monitoringPeriod: postC.monitoringPeriod || "",
    nadirLabs: postC.nadirLabs || "",
    sideEffectMgt: postC.sideEffectMgt || "",
    
    interimImaging: resp.interimImaging || "",
    responseCriteria: resp.responseCriteria || "",
    tumorBoardReview: resp.tumorBoardReview || "",
    tumorBoardReviewDetails: resp.tumorBoardReviewDetails || "",

    // Organ-Specific Monitoring
    organCardiac: postC.organCardiac || false,
    echoDetails: postC.echoDetails || "",
    lvef: postC.lvef || "",
    organPulmonary: postC.organPulmonary || false,
    pulmonaryTests: postC.pulmonaryTests || "",
    organNeuro: postC.organNeuro || false,
    neuroAssessment: postC.neuroAssessment || "",
    organAudio: postC.organAudio || false,
    audioTests: postC.audioTests || "",

    // Treatment-Specific Parameters
    trtUrineProtein: postC.trtUrineProtein || false,
    urineProteinDetails: postC.urineProteinDetails || "",
    trtThyroid: postC.trtThyroid || false,
    thyroidDetails: postC.thyroidDetails || "",
    trtGlucose: postC.trtGlucose || false,
    glucoseDetails: postC.glucoseDetails || "",
    trtEcg: postC.trtEcg || false,
    ecgDetails: postC.ecgDetails || "",
  };

  // ─── partE (Discharge On Treatment) ──────────────────────────────────
  const partE = {
    tolerated: comp.toleratedWell || "",
    watchPain: comp.watchSymptoms?.pain || false,
    watchMotions: comp.watchSymptoms?.motions || false,
    watchConstipation: comp.watchSymptoms?.constipation || false,
    watchVomiting: comp.watchSymptoms?.vomiting || false,
    watchWBC: comp.watchSymptoms?.wbc || false,
    watchMouth: comp.watchSymptoms?.mouth || false,
    watchIndigestion: comp.watchSymptoms?.indigestion || false,
    watchFever: comp.watchSymptoms?.fever || false,
    
    dischargeDrugs: comp.dischargeDrugs && comp.dischargeDrugs.length > 0
      ? comp.dischargeDrugs
      : [{ id: 1, remarks: "", name: "", route: "", dosage: "", days: "" }],
      
    followUpDoctor: /^\d{4}-\d{2}-\d{2}$/.test(comp.followUpSchedule) ? comp.followUpSchedule : "",
    followUpDaycare: /^\d{4}-\d{2}-\d{2}$/.test(comp.followUpDaycare) ? comp.followUpDaycare : "",
    emergencyContact: det.emergencyContact || "",
    
    totalCyclesCompleted: String(treatment?.completedCycles || ""),
    cumulativeDoses: comp.cumulativeDoses || "",
    treatmentOutcomes: comp.treatmentOutcomes || "",
    residualToxicity: comp.residualToxicity || "",
    treatmentCompletionStatus: comp.treatmentCompletionStatus || "",
    treatmentNotCompletedReason: comp.treatmentNotCompletedReason || "",
    treatmentNotCompletedNotes: comp.treatmentNotCompletedNotes || "",
    toxicitySummaryText: comp.toxicitySummaryText || "",
    dischargePreparedBy: comp.dischargePreparedBy || "",
    endOfResponseTreatment: comp.endOfResponseTreatment || "",
    endOfResponseDate: comp.endOfResponseDate || "",
    cycles: comp.cycleCompletionDates && comp.cycleCompletionDates.length > 0 
      ? comp.cycleCompletionDates
      : [
          { id: 1, label: "Cycle 1", date: "", status: "" },
          { id: 2, label: "Cycle 2", date: "", status: "" }
        ],
        
    auditPeriod: qaSection.auditPeriod || "",
    dosingAccuracy: qaSection.dosingAccuracy || "",
    adverseEventRate: qaSection.adverseEventRate || "",
    protocolAdherence: qaSection.protocolAdherence || "",
    incidentReview: qaSection.incidentReview || "",
  };

  // ─── partF (Discharge Completion) ────────────────────────────────────
  const partF = {
    overallAssessment: finalSummary.overallAssessment || "",
    recommendations: finalSummary.recommendations || "",
    physicianSignature: finalSummary.physicianSignature || "",
    signatureDate: finalSummary.signatureDate || "",
    physicianSigned: !!finalSummary.physicianSigned,
    dischargePreparedBy: finalSummary.dischargePreparedBy || comp.dischargePreparedBy || "",
    toxicitySummaryText: finalSummary.toxicitySummaryText || comp.toxicitySummaryText || "",
    treatmentCompletionStatus: finalSummary.treatmentCompletionStatus || comp.treatmentCompletionStatus || "",
    treatmentNotCompletedReason: finalSummary.treatmentNotCompletedReason || comp.treatmentNotCompletedReason || "",
    treatmentNotCompletedNotes: finalSummary.treatmentNotCompletedNotes || comp.treatmentNotCompletedNotes || "",
    endOfResponseTreatment: finalSummary.endOfResponseTreatment || comp.endOfResponseTreatment || "",
    endOfResponseDate: finalSummary.endOfResponseDate || comp.endOfResponseDate || "",
  };

  return { overview, partA, partB, partC, partD, partE, partF };
};
