// ─────────────────────────────────────────────────────────────────────────────
// tabFieldMap.js — the single source of truth mapping each workflow tab to
// (a) its backend section attribute and (b) the exact set of flat formData keys
// that belong to that section.
//
// WHY AN EXPLICIT REGISTRY (and not prefix-slicing):
//   • Sub-forms use their OWN prefixes (dbs*, vns*, ect*, ket*, cing*, caps* …),
//     not their parent tab's, so "surgery keys start with surg*" is false.
//   • Some prefixes collide with unrelated fields (s*, f*), so a startsWith()
//     rule would grab the wrong fields.
//   • Therefore every key is listed by hand below, grouped by the file it lives
//     in. Keep this in sync with the tabs — a new FormField k="..." must be
//     added to the right list here or it will NOT be saved.
//
// CROSS-PROVIDER KEY OVERLAP (intentional, safe):
//   `vnsIndication` and `dbsStimSideEffects` appear in BOTH a surgery sub-form
//   and a procedure sub-form. The Surgery tab (NeuropsychiatryWorkflow) and the
//   Procedure tab (NeuropsychiatryProcedure) run in SEPARATE providers with
//   SEPARATE formData, and write to DIFFERENT section attributes
//   (`surgery` vs `procedure`). They never coexist in one formData, so there is
//   no runtime collision and no data loss.
// ─────────────────────────────────────────────────────────────────────────────

// tabId (as used in NeuropsychiatryWorkflow TABS + the Procedure entry)
//   → backend section attribute (must match ALLOWED_SECTIONS in neuropsychiatry.py)
export const TAB_SECTION = {
  patient: 'patient',
  mse: 'mse',
  baseline: 'baseline',
  surgery: 'surgery',
  emergency: 'emergency',
  findings: 'findings',
  psychotherapy: 'psychotherapy',
  'post-procedure': 'postProcedure',
  summary: 'summary',
  procedure: 'procedure',
};

// The 9 sections owned by the main workflow provider (NeuropsychiatryWorkflow).
export const WORKFLOW_SECTIONS = [
  'patient',
  'mse',
  'baseline',
  'surgery',
  'emergency',
  'findings',
  'psychotherapy',
  'postProcedure',
  'summary',
];

// The section owned by the standalone Procedure provider (NeuropsychiatryProcedure).
export const PROCEDURE_SECTIONS = ['procedure'];

export const TAB_FIELDS = {
  // ── Tab 1 · Patient Info (PatientInfoTab.jsx) ──────────────────────────────
  patient: [
    'patientId', 'hmsId', 'patientName', 'age', 'sex', 'dob', 'contact',
    'emgName', 'emgNumber', 'emgRel', 'bloodGroup', 'address', 'occupation',
    'maritalStatus', 'insurance', 'mhaStatus', 'referringDoctor', 'referringHospital',
    'presentingComplaint', 'hpi', 'durationIllness', 'onsetPattern', 'coreSymptoms',
    'precipitant', 'precipitantDetail',
    'pastPsych', 'pastDx', 'priorAdmissions', 'priorSuicideAttempts', 'priorECT',
    'priorNeuromod', 'pastPsychDetail',
    'comorbidities', 'comorbidityDetails', 'metalImplant', 'seizureHx', 'seizureDetail',
    'medications', 'clozapine', 'medNotes',
    'smoking', 'smokingPackYears', 'alcohol', 'alcoholUnits', 'substance',
    'substanceDetail', 'withdrawalRisk',
    'familyHx', 'familyHxDetails', 'personalHistory', 'premorbidPersonality',
    'forensicHx', 'forensicDetail', 'allergies',
  ],

  // ── Tab 2 · MSE & Cognition (MSETab.jsx) ───────────────────────────────────
  mse: [
    'mseDate', 'mseExaminer',
    'appearance', 'behaviour', 'eyeContact', 'rapport', 'psychomotor', 'catatonia',
    'eps', 'appearanceNotes',
    'speechRate', 'speechVolume', 'speechTone', 'speechFlow', 'speechFormal',
    'moodSubjective', 'moodObjective', 'affectRange', 'affectReactivity',
    'affectCongruence', 'affectAppropriate',
    'thoughtForm', 'delusions', 'delusionDetail', 'thoughtPossession', 'obsessions',
    'suicidalThoughts', 'homicidalThoughts',
    'hallucinations', 'hallucinationDetail', 'otherPerception',
    'conscLevel', 'orientation', 'attention', 'digitSpan', 'shortMemory', 'longMemory',
    'workingMemory', 'language', 'executive', 'confabulation',
    'insight', 'judgement', 'capacityTreatment', 'insightNotes',
    'riskSelfHarm', 'riskViolence', 'riskNeglect', 'riskVulnerability', 'riskAbsconding',
    'protectiveFactors', 'riskFormulation', 'cSSRS',
    'mmse', 'moca', 'aceIII', 'clock', 'fab', 'aims', 'basAkathisia', 'simpson',
    // Consultation-derived severity bands, each standing in for the test above it
    // when none was administered. See IMPRESSION_FALLBACKS in
    // context/clinicalScale.js — the measured score wins when both are present.
    // Deliberately none for clock, digitSpan or cSSRS.
    'cogImpression', 'execImpression',
    'dyskinesiaImpression', 'akathisiaImpression', 'parkinsonismImpression',
    'cognitiveSummary', 'sessionTranscript',
  ],

  // ── Tab 3 · Baseline Investigations (BaselineDataTab.jsx) ──────────────────
  baseline: [
    'baselineDate', 'baselineRequestedBy',
    'bpSys', 'bpDia', 'hr', 'temp', 'rr', 'spo2', 'glucose',
    'height', 'weight', 'bsa', 'bmi', 'waist',
    'phq1', 'phq2', 'phq3', 'phq4', 'phq5', 'phq6', 'phq7', 'phq8', 'phq9',
    'phqTotal', 'phqSeverity',
    'gad1', 'gad2', 'gad3', 'gad4', 'gad5', 'gad6', 'gad7', 'gadTotal', 'gadSeverity',
    'hamd', 'madrs', 'hama', 'ymrs', 'panssP', 'panssN', 'panssG', 'yboc', 'pcl5',
    'cgiS', 'cgiI', 'gaf',
    'hb', 'wbc', 'anc', 'platelets', 'sodium', 'potassium', 'creatinine', 'hba1c',
    'lipids', 'prolactin', 'tsh', 't4', 'b12', 'folate', 'vitD',
    'lithiumLevel', 'valproateLevel', 'carbamazepineLevel', 'clozapineLevel',
    'csfBiomarkers', 'autoimmunePanel', 'toxicology', 'labOther', 'sessionTranscript',
  ],

  // ── Tab 4 · Surgery (SurgeryTab.jsx + surgery-forms/*) ─────────────────────
  surgery: [
    // SurgeryTab.jsx (surg* / who*)
    'surgCategory', 'surgDate', 'surgStart', 'surgEnd', 'surgDuration', 'surgUrgency',
    'surgAsa', 'surgMDT', 'surgTrialCriteria', 'whoSignIn', 'whoTimeOut', 'whoSignOut',
    'surgAnaes', 'surgSurgeon', 'surgAnaesthetist', 'surgFrame', 'surgMER',
    'surgTestStim', 'surgTarget', 'surgDevice', 'surgFindings', 'surgComplications',
    'surgEBL', 'surgDisposition', 'surgPostImaging', 'surgPostOrders', 'surgSpecificNotes',
    // DBSElectrodeImplantationForm.jsx
    'dbsMdtApproval', 'dbsRefractoriness', 'dbsBaselineScale', 'dbsBaselineScore',
    'dbsNeuropsychClearance', 'dbsTargetStructure', 'dbsFrameMethod',
    'dbsCoordRX', 'dbsCoordRY', 'dbsCoordRZ', 'dbsCoordRArc', 'dbsCoordRRing',
    'dbsCoordLX', 'dbsCoordLY', 'dbsCoordLZ', 'dbsCoordLArc', 'dbsCoordLRing',
    'dbsMerPasses', 'dbsMerFindings', 'dbsStimEfficacy', 'dbsStimSideEffects',
    'dbsObservedAEs', 'dbsLeadModel', 'dbsLeadSerial', 'dbsFinalImpedances',
    'dbsVerificationImaging',
    // DBSIPGReplacementForm.jsx
    'dbsExplantedModel', 'dbsExplantedSerial', 'dbsReplacementReason', 'dbsPocketSite',
    'dbsPocketRevision', 'dbsPocketIrrigation', 'dbsExtensionIntegrity', 'dbsNewIpgModel',
    'dbsNewIpgSerial', 'dbsTelemetryCheck', 'dbsPostImpedanceCheck', 'dbsInitialSettings',
    // VNSImplantationForm.jsx  (vnsIndication also used by procedure VNS programming)
    'vnsIndication', 'vnsAanRefractoriness', 'vnsCardiacAssessment', 'vnsSurgicalSide',
    'vnsNerveAppearance', 'vnsLeadCoilSize', 'vnsStrainRelief', 'vnsTieDowns',
    'vnsGeneratorModel', 'vnsGeneratorSerial', 'vnsLeadSerial', 'vnsIntraopImpedance',
    'vnsImpedanceValue', 'vnsEcgMonitoring', 'vnsInitialOutput',
    // VNSBatteryReplacementForm.jsx
    'vnsExplantedModel', 'vnsExplantedSerial', 'vnsReplacementIndication',
    'vnsNewGeneratorModel', 'vnsNewGeneratorSerial', 'vnsPocketCondition',
    'vnsPinConnection', 'vnsDiagCheck', 'vnsPostOpSettings',
    // AnteriorCingulotomyForm.jsx
    'cingMdtClearance', 'cingRefractoryIndication', 'cingCapacityConsent',
    'cingTargetSite', 'cingLaterality', 'cingRX', 'cingRY', 'cingRZ',
    'cingLX', 'cingLY', 'cingLZ', 'cingModality', 'cingNumLesions', 'cingRfTemp',
    'cingRfDuration', 'cingLittPower', 'cingGkDose', 'cingVerificationImg',
    'cingLesionVolume',
    // AnteriorCapsulotomyForm.jsx
    'capsIndication', 'capsEthicsReview', 'capsBaselineScale', 'capsLaterality',
    'capsTargetSite', 'capsRX', 'capsRY', 'capsRZ', 'capsLX', 'capsLY', 'capsLZ',
    'capsModality', 'capsRfTemp', 'capsRfTime', 'capsGkIsocenters', 'capsGkDose',
    'capsMrVerif',
    // SubcaudateTractotomyForm.jsx
    'subcIndication', 'subcMdtClearance', 'subcBaselineScore', 'subcTargetingMethod',
    'subcLaterality', 'subcX', 'subcY', 'subcZ', 'subcModality', 'subcRfTemp',
    'subcRfTime', 'subcLesionDimensions', 'subcPostOpImaging',
    // LimbicLeucotomyForm.jsx
    'limbIndication', 'limbBoardReview', 'limbBaselineScales', 'limbCingRX', 'limbCingLX',
    'limbCingRfParams', 'limbSubcRX', 'limbSubcLX', 'limbSubcRfParams', 'limbPostOpMRI',
    'limbComplications', 'limbCognitiveCheck', 'sessionTranscript',
  ],

  // ── Tab 5 · Emergency (EmergencyTab.jsx) ───────────────────────────────────
  emergency: [
    'emgType6', 'arrivalMode', 'legalStatus',
    'timeOnset', 'timeArrival', 'timeAssess', 'timeTreat',
    'abcdeA', 'abcdeB', 'abcdeC', 'abcdeD', 'abcdeE',
    'emgBpSys', 'emgBpDia', 'emgHr', 'emgRr', 'emgSpo2', 'emgTempArrival', 'emgGlucose',
    'emgGCS', 'deEscalation', 'restraint', 'rapidTranq', 'emgCSSRS', 'emgMeds',
    'emgOrganicScreen', 'emgContactNotified', 'emgSpecific', 'emgScaleScore',
    'emgManagementPlan', 'sessionTranscript',
  ],

  // ── Tab 6 · Findings (FindingsTab.jsx) ─────────────────────────────────────
  findings: [
    'fProcedure', 'fCBTObs', 'fScalesSummary',
    'fImaging', 'fLabs', 'fFinalDx', 'fICD', 'fDDx', 'fRecommend',
    'fMDT', 'fMDTDetail', 'sessionTranscript',
  ],

  // ── Tab 7 · Psychotherapy / CBT (PsychotherapyTab.jsx) ─────────────────────
  // Saved as SESSIONS (psychotherapySessions), not as a flat section — see
  // PSYCHOTHERAPY_SESSION_FIELDS / buildPsychotherapySession below. Kept here so
  // records written by older builds still hydrate the form.
  psychotherapy: [
    'cbtSessionDate',
    'cbtSessionNum', 'cbtTotalSessions', 'cbtModality', 'cbtDuration', 'cbtBillingCode',
    'cbtTherapist', 'cbtPhq9', 'cbtGad7', 'cbtYbocs', 'cbtPreSuds', 'cbtPostSuds',
    // Conversation-derived severity bands, each standing in for the instrument
    // above it when no questionnaire was administered. See IMPRESSION_OPTIONS in
    // context/psychotherapyScale.js — the instrument wins when both are present.
    'cbtMoodImpression', 'cbtAnxietyImpression', 'cbtOcdImpression',
    'cbtDistressImpression', 'cbtReliefImpression',
    'cbtMseBrief', 'cbtRiskAssessment', 'cbtSafetyPlan', 'cbtPrimaryModality',
    'cbtAgenda', 'cbtInterventions', 'cbtClinicalNotes', 'cbtEngagement', 'cbtProgress',
    'cbtHomeworkAssigned', 'cbtHomeworkReview', 'cbtNextSession', 'sessionTranscript',
  ],

  // ── Tab 8 · Post-Procedure (PostOpTab.jsx) ─────────────────────────────────
  'post-procedure': [
    'ppPlan', 'ppObs', 'ppComplications',
    'ppTdmDate', 'ppTdmTrough', 'ppTdmLithium', 'ppTdmValproate', 'ppTdmCarbamazepine',
    'ppTdmClozapine', 'ppTdmNorclozapine', 'ppTdmLamotrigine', 'ppTdmAnc', 'ppTdmOther',
    'ppTdmInterp', 'ppTdmAction',
    'ppNurseShift', 'ppNurseName', 'ppNurseObsLevel', 'ppNurseMood',
    'ppNurseAgitationScale', 'ppNurseSleepHours', 'ppNurseSleepPattern',
    'ppNurseDietHydration', 'ppNursePRNGiven', 'ppNursePRNDetails', 'ppNurseIncidents',
    'ppNurseHandoverSummary',
    'ppEffCgiS', 'ppEffCgiI', 'ppEffTargetSymptomResponse', 'ppEffCurrentScore',
    'ppEffSideEffectsList', 'ppEffSeverityRating', 'ppEffRiskBenefitRatio',
    'ppEffManagementPlan',
    'ppTrCriteriaMet', 'ppTrDisorder', 'ppTrStaging', 'ppTrFailedTrialsCount',
    'ppTrAdequacyCheck', 'ppTrPastTrials', 'ppTrAugmentationOptions', 'ppTrRecommendation',
    'ppCognition', 'ppMMSE', 'ppScale', 'ppResponse', 'ppCSSRS', 'ppInstructions',
    'ppRestrictions', 'ppWarning', 'ppMeds',
    'ppFuDate', 'ppFuTime', 'ppFuDept', 'ppNextSession', 'ppFuInstr', 'ppDischargeReady',
    'ppReferrals', 'ppBarriers', 'sessionTranscript',
  ],

  // ── Tab 9 · Summary (SummaryTab.jsx) ───────────────────────────────────────
  summary: [
    'sClinical', 'sProcedures', 'sKeyFindings', 'sPrimaryDx', 'sSecondaryDx', 'sCodes',
    'sTreatmentResponse', 'sDischargeMeds', 'sRiskPlan', 'sRelapsePlan', 'sFollowup',
    'sPrognosis', 'sConsultant', 'sConsultantSign', 'sessionTranscript',
  ],

  // ── Procedure tab (ProcedureTab.jsx + procedures/*) — separate provider ────
  procedure: [
    // ProcedureTab.jsx (common fields)
    'procCategory', 'procType', 'procDate', 'procStart', 'procEnd', 'procDuration',
    'procIndication', 'procDiagnosis', 'consent', 'consentType', 'capacityAssessed',
    'consentDate', 'consentFile', 'riskBenefit', 'anaesType', 'operator', 'assistStaff',
    'preChecklist',
    // ECTForm.jsx
    'ectIndication', 'ectCourseType', 'ectWorkup', 'ectPreAnaes', 'ectRiskFactors',
    'ectDevice', 'ectElectrode', 'ectDosing', 'ectThreshold', 'ectDoseMultiple',
    'ectCharge', 'ectCurrent', 'ectFrequency', 'ectPulseWidth', 'ectTrainDuration',
    'ectEnergyPct', 'ectAnaesAgent', 'ectAnaesDose', 'ectRelaxant', 'ectRelaxantDose',
    'ectAdjuncts', 'ectAirway', 'ectMotorDuration', 'ectEEGDuration', 'ectSeizureQuality',
    'ectPostictalSupp', 'ectRestim', 'ectMaxHR', 'ectPeakBP', 'ectReorient',
    'ectSideEffects', 'ectSessionNo', 'ectTotalPlanned', 'ectResponse', 'ectNextSession',
    'ectNotes',
    // RTMSForm.jsx (tms*)
    'tmsIndication', 'tmsSafety', 'tmsMTMethod', 'tmsRMT', 'tmsCoil', 'tmsTarget',
    'tmsLocalization', 'tmsIntensity', 'tmsProtocol', 'tmsFrequency', 'tmsTrainDuration',
    'tmsInterTrain', 'tmsTrains', 'tmsPulsesSession', 'tmsSessionsPerDay', 'tmsSessionNo',
    'tmsTotalPlanned', 'tmsAdverse', 'tmsDiscomfort', 'tmsResponse', 'tmsNotes',
    // TDCSForm.jsx
    'tdcsIndication', 'tdcsDevice', 'tdcsAnode', 'tdcsCathode', 'tdcsCurrent',
    'tdcsDuration', 'tdcsRamp', 'tdcsElectrodeSize', 'tdcsSaline', 'tdcsCurrentDensity',
    'tdcsSessionNo', 'tdcsTotalPlanned', 'tdcsAdverse', 'tdcsResponse', 'tdcsNotes',
    // MSTForm.jsx
    'mstIndication', 'mstDevice', 'mstFrequency', 'mstIntensity', 'mstTrainDuration',
    'mstCoilPosition', 'mstAnaesAgent', 'mstRelaxant', 'mstMotorDuration', 'mstEEGDuration',
    'mstReorient', 'mstSessionNo', 'mstTotalPlanned', 'mstAdverse', 'mstResponse',
    'mstNotes',
    // DBSForm.jsx — DBS programming (dbsStimSideEffects also used by surgery DBS implant)
    'dbsIndication', 'dbsTarget', 'dbsDevice', 'dbsSessionType', 'dbsSettings',
    'dbsThresholds', 'dbsStimSideEffects', 'dbsResponse', 'dbsBattery', 'dbsNextVisit',
    'dbsNotes',
    // VNSForm.jsx — VNS programming (vnsIndication also used by surgery VNS implant)
    'vnsIndication', 'vnsDevice', 'vnsSessionType', 'vnsOutputCurrent', 'vnsFrequency',
    'vnsPulseWidth', 'vnsOnTime', 'vnsOffTime', 'vnsDutyCycle', 'vnsMagnetCurrent',
    'vnsMagnetPulseWidth', 'vnsMagnetOnTime', 'vnsSideEffects', 'vnsBattery', 'vnsResponse',
    'vnsNextVisit', 'vnsNotes',
    // KetamineForm.jsx
    'ketIndication', 'ketAgent', 'ketDose', 'ketRoute', 'ketInfusionTime', 'ketREMS',
    'ketBaselineBP', 'ketPeakBP', 'ketPeakHR', 'ketSpo2Nadir', 'ketCADSS', 'ketSedation',
    'ketObservation', 'ketAdverse', 'ketSessionNo', 'ketTotalPlanned', 'ketSchedule',
    'ketMADRS', 'ketCSSRS', 'ketNotes',
    // AmytalForm.jsx
    'amyIndication', 'amyAgent', 'amyDose', 'amyRate', 'amyMonitoring', 'amyResponse',
    'amyContent', 'amyAdverse', 'amyRecovery', 'amyNotes',
    // EEGForm.jsx
    'eegIndication', 'eegType', 'eegDuration', 'eegMontage', 'eegActivation', 'eegPDR',
    'eegBackground', 'eegEpileptiform', 'eegEDDist', 'eegSeizure', 'eegInterp',
    'eegCorrelation', 'eegNotes',
    // LumbarPunctureForm.jsx
    'lpIndication', 'lpImaging', 'lpPosition', 'lpLevel', 'lpNeedle', 'lpGauge',
    'lpAttempts', 'lpOpenPress', 'lpAppearance', 'lpVolume', 'lpAbeta42', 'lpAbetaRatio',
    'lpTotalTau', 'lpPTau', 'lpADProfile', 'lpProtein', 'lpGlucose', 'lpCells',
    'lpAutoimmune', 'lpComplications', 'lpNotes',
    // PolysomnographyForm.jsx
    'psgIndication', 'psgType', 'psgChannels', 'psgTST', 'psgEfficiency', 'psgSOL',
    'psgREMLat', 'psgN1', 'psgN2', 'psgN3', 'psgREM', 'psgWASO', 'psgArousal', 'psgAHI',
    'psgRDI', 'psgODI', 'psgSpo2Nadir', 'psgPLM', 'psgRBD', 'msltLatency', 'msltSOREMP',
    'psgInterp', 'psgNotes',
    // NeuropsychBatteryForm.jsx
    'npReferral', 'npValidity', 'npGeneral', 'npMemory', 'npAttention', 'npExecutive',
    'npLanguage', 'npVisuospatial', 'npSocial', 'npMoodValidity', 'npScores', 'npProfile',
    'npImpression', 'npRecommend',
  ],
};

/**
 * Build the section payload for a tab: pick only that tab's keys out of the flat
 * formData. Keys the user never touched (undefined) are omitted so we never
 * overwrite stored values with nulls.
 *
 * @param {string} tabId  e.g. 'patient', 'surgery', 'post-procedure', 'procedure'
 * @param {object} formData  the flat context formData
 * @returns {{ section: string, data: object }}
 */
export function extractSectionData(tabId, formData) {
  const section = TAB_SECTION[tabId];
  const fields = TAB_FIELDS[tabId] || [];
  const data = {};
  for (const key of fields) {
    if (formData[key] !== undefined) {
      data[key] = formData[key];
    }
  }
  return { section, data };
}

/**
 * Flatten a record document's section attributes back into a single flat
 * formData object for hydration. Only the requested sections are merged (the
 * workflow provider merges WORKFLOW_SECTIONS; the Procedure provider merges
 * PROCEDURE_SECTIONS), which keeps the two cross-provider overlap keys
 * (vnsIndication, dbsStimSideEffects) unambiguous within each provider.
 *
 * @param {object|null} recordDoc  the full document from the backend
 * @param {string[]} sections  which section attributes to merge
 * @returns {object} flat formData
 */
export function hydrateFromRecord(recordDoc, sections) {
  const flat = {};
  if (!recordDoc) return flat;
  for (const section of sections) {
    const obj = recordDoc[section];
    if (obj && typeof obj === 'object' && !Array.isArray(obj)) {
      Object.assign(flat, obj);
    }
  }
  return flat;
}

// ═════════════════════════════════════════════════════════════════════════════
// PROCEDURES — nested procedures→sessions model
// ═════════════════════════════════════════════════════════════════════════════
//
// A case can hold MANY procedure types, and each type can have MANY sessions
// (an ECT course, a full rTMS series …). Rather than the old single flat
// `procedure` section (which could only hold ONE procedure and overwrote the
// shared common fields whenever a second type was saved), procedures live in a
// dedicated top-level `procedures` map on the record document:
//
//   procedures: {
//     <slug>: {
//       type:     "<display name>",     // e.g. "Electroconvulsive Therapy (ECT)"
//       category: "<category>",
//       sessions: [
//         { id, session_no, saved_at, data: { ...common + type-specific fields } }
//       ]
//     },
//     ...
//   }
//
// Each session is a FULL snapshot (common fields + that type's specific fields
// together) because the "common" fields — date, consent, anaesthesia, operator,
// the safety checklist, and especially the ECT charge which titrates every
// session — are genuinely per-session, not per-course. This keeps every session
// self-contained and trivially retrievable for the per-procedure history view.
//
// SECURITY: `slug` is interpolated into a MongoDB field path on the backend
// (procedures.<slug>.sessions). PROC_SLUGS is the fixed allow-list the backend
// validates against; the frontend only ever derives a slug from PROC_TYPE_SLUG,
// so an arbitrary/user-controlled slug can never reach the field path.

// The 18 common fields every procedure session carries (from ProcedureTab.jsx).
export const PROCEDURE_COMMON_FIELDS = [
  'procCategory', 'procType', 'procDate', 'procStart', 'procEnd', 'procDuration',
  'procIndication', 'procDiagnosis', 'consent', 'consentType', 'capacityAssessed',
  'consentDate', 'consentFile', 'riskBenefit', 'anaesType', 'operator', 'assistStaff',
  'preChecklist', 'sessionTranscript',
];

// slug → the type-specific formData keys for that procedure's sub-form. Split
// out of the old single `procedure` field list; keep in sync with procedures/*.
export const PROCEDURE_TYPE_FIELDS = {
  // ECTForm.jsx
  ect: [
    'ectIndication', 'ectCourseType', 'ectWorkup', 'ectPreAnaes', 'ectRiskFactors',
    'ectDevice', 'ectElectrode', 'ectDosing', 'ectThreshold', 'ectDoseMultiple',
    'ectCharge', 'ectCurrent', 'ectFrequency', 'ectPulseWidth', 'ectTrainDuration',
    'ectEnergyPct', 'ectAnaesAgent', 'ectAnaesDose', 'ectRelaxant', 'ectRelaxantDose',
    'ectAdjuncts', 'ectAirway', 'ectMotorDuration', 'ectEEGDuration', 'ectSeizureQuality',
    'ectPostictalSupp', 'ectRestim', 'ectMaxHR', 'ectPeakBP', 'ectReorient',
    'ectSideEffects', 'ectSessionNo', 'ectTotalPlanned', 'ectResponse', 'ectNextSession',
    'ectNotes',
  ],
  // RTMSForm.jsx (tms*)
  rtms: [
    'tmsIndication', 'tmsSafety', 'tmsMTMethod', 'tmsRMT', 'tmsCoil', 'tmsTarget',
    'tmsLocalization', 'tmsIntensity', 'tmsProtocol', 'tmsFrequency', 'tmsTrainDuration',
    'tmsInterTrain', 'tmsTrains', 'tmsPulsesSession', 'tmsSessionsPerDay', 'tmsSessionNo',
    'tmsTotalPlanned', 'tmsAdverse', 'tmsDiscomfort', 'tmsResponse', 'tmsNotes',
  ],
  // TDCSForm.jsx
  tdcs: [
    'tdcsIndication', 'tdcsDevice', 'tdcsAnode', 'tdcsCathode', 'tdcsCurrent',
    'tdcsDuration', 'tdcsRamp', 'tdcsElectrodeSize', 'tdcsSaline', 'tdcsCurrentDensity',
    'tdcsSessionNo', 'tdcsTotalPlanned', 'tdcsAdverse', 'tdcsResponse', 'tdcsNotes',
  ],
  // MSTForm.jsx
  mst: [
    'mstIndication', 'mstDevice', 'mstFrequency', 'mstIntensity', 'mstTrainDuration',
    'mstCoilPosition', 'mstAnaesAgent', 'mstRelaxant', 'mstMotorDuration', 'mstEEGDuration',
    'mstReorient', 'mstSessionNo', 'mstTotalPlanned', 'mstAdverse', 'mstResponse',
    'mstNotes',
  ],
  // DBSForm.jsx — DBS programming (dbsStimSideEffects also used by surgery DBS implant)
  dbs: [
    'dbsIndication', 'dbsTarget', 'dbsDevice', 'dbsSessionType', 'dbsSettings',
    'dbsThresholds', 'dbsStimSideEffects', 'dbsResponse', 'dbsBattery', 'dbsNextVisit',
    'dbsNotes',
  ],
  // VNSForm.jsx — VNS programming (vnsIndication also used by surgery VNS implant)
  vns: [
    'vnsIndication', 'vnsDevice', 'vnsSessionType', 'vnsOutputCurrent', 'vnsFrequency',
    'vnsPulseWidth', 'vnsOnTime', 'vnsOffTime', 'vnsDutyCycle', 'vnsMagnetCurrent',
    'vnsMagnetPulseWidth', 'vnsMagnetOnTime', 'vnsSideEffects', 'vnsBattery', 'vnsResponse',
    'vnsNextVisit', 'vnsNotes',
  ],
  // KetamineForm.jsx (ket*)
  ketamine: [
    'ketIndication', 'ketAgent', 'ketDose', 'ketRoute', 'ketInfusionTime', 'ketREMS',
    'ketBaselineBP', 'ketPeakBP', 'ketPeakHR', 'ketSpo2Nadir', 'ketCADSS', 'ketSedation',
    'ketObservation', 'ketAdverse', 'ketSessionNo', 'ketTotalPlanned', 'ketSchedule',
    'ketMADRS', 'ketCSSRS', 'ketNotes',
  ],
  // AmytalForm.jsx (amy*)
  amytal: [
    'amyIndication', 'amyAgent', 'amyDose', 'amyRate', 'amyMonitoring', 'amyResponse',
    'amyContent', 'amyAdverse', 'amyRecovery', 'amyNotes',
  ],
  // EEGForm.jsx
  eeg: [
    'eegIndication', 'eegType', 'eegDuration', 'eegMontage', 'eegActivation', 'eegPDR',
    'eegBackground', 'eegEpileptiform', 'eegEDDist', 'eegSeizure', 'eegInterp',
    'eegCorrelation', 'eegNotes',
  ],
  // LumbarPunctureForm.jsx
  lp: [
    'lpIndication', 'lpImaging', 'lpPosition', 'lpLevel', 'lpNeedle', 'lpGauge',
    'lpAttempts', 'lpOpenPress', 'lpAppearance', 'lpVolume', 'lpAbeta42', 'lpAbetaRatio',
    'lpTotalTau', 'lpPTau', 'lpADProfile', 'lpProtein', 'lpGlucose', 'lpCells',
    'lpAutoimmune', 'lpComplications', 'lpNotes',
  ],
  // PolysomnographyForm.jsx (psg* + mslt*)
  psg: [
    'psgIndication', 'psgType', 'psgChannels', 'psgTST', 'psgEfficiency', 'psgSOL',
    'psgREMLat', 'psgN1', 'psgN2', 'psgN3', 'psgREM', 'psgWASO', 'psgArousal', 'psgAHI',
    'psgRDI', 'psgODI', 'psgSpo2Nadir', 'psgPLM', 'psgRBD', 'msltLatency', 'msltSOREMP',
    'psgInterp', 'psgNotes',
  ],
  // NeuropsychBatteryForm.jsx (np*)
  npbattery: [
    'npReferral', 'npValidity', 'npGeneral', 'npMemory', 'npAttention', 'npExecutive',
    'npLanguage', 'npVisuospatial', 'npSocial', 'npMoodValidity', 'npScores', 'npProfile',
    'npImpression', 'npRecommend',
  ],
};

// Procedure display name (formData.procType / renderProcedureForm switch) → slug.
// Keys MUST match the exact strings in PROC_CATEGORIES / ProcedureTab.jsx.
export const PROC_TYPE_SLUG = {
  'Electroconvulsive Therapy (ECT)': 'ect',
  'Repetitive TMS (rTMS)': 'rtms',
  'Transcranial Direct Current Stimulation (tDCS)': 'tdcs',
  'Magnetic Seizure Therapy (MST)': 'mst',
  'Deep Brain Stimulation (DBS) Programming': 'dbs',
  'Vagus Nerve Stimulation (VNS) Programming': 'vns',
  'Ketamine / Esketamine Therapy': 'ketamine',
  'Amytal (Narcoanalysis) Interview': 'amytal',
  'Electroencephalography (EEG)': 'eeg',
  'Lumbar Puncture (CSF Biomarkers)': 'lp',
  'Polysomnography (Sleep Study)': 'psg',
  'Neuropsychological Assessment Battery': 'npbattery',
};

// slug → display name (reverse of PROC_TYPE_SLUG), for history headers.
export const PROC_SLUG_TYPE = Object.fromEntries(
  Object.entries(PROC_TYPE_SLUG).map(([type, slug]) => [slug, type])
);

// The fixed allow-list of procedure slugs (mirrors PROC_SLUGS on the backend).
export const PROC_SLUGS = Object.keys(PROCEDURE_TYPE_FIELDS);

// slug → the clinical "session number" field, when that sub-form has one. Used
// to prefill the next session's number when adding a session. Types without a
// per-session counter (dbs/vns/amytal/eeg/lp/psg/npbattery) are omitted.
export const PROC_SESSION_NO_FIELD = {
  ect: 'ectSessionNo',
  rtms: 'tmsSessionNo',
  tdcs: 'tdcsSessionNo',
  mst: 'mstSessionNo',
  ketamine: 'ketSessionNo',
};

// Every procedure-related formData key (common + all types), for stripping.
const PROC_ALL_FIELDS = new Set([
  ...PROCEDURE_COMMON_FIELDS,
  ...Object.values(PROCEDURE_TYPE_FIELDS).flat(),
]);

/**
 * Build a procedure session snapshot from the flat formData. Picks the common
 * fields plus the fields for whichever type is currently selected (procType).
 * Returns null when no valid procedure type is selected.
 *
 * @param {object} formData  the flat context formData
 * @returns {{ slug, type, category, data }|null}
 */
export function buildProcedureSession(formData) {
  const type = formData.procType;
  const slug = PROC_TYPE_SLUG[type];
  if (!slug) return null;
  const keys = [...PROCEDURE_COMMON_FIELDS, ...(PROCEDURE_TYPE_FIELDS[slug] || [])];
  const data = {};
  for (const key of keys) {
    if (formData[key] !== undefined) data[key] = formData[key];
  }
  return { slug, type, category: formData.procCategory || '', data };
}

/**
 * Return a copy of formData with all procedure fields removed, so the entry
 * form can be reset between sessions/procedures without wiping unrelated state.
 * `keep` fields are preserved even if they're procedure fields — by default the
 * operator (doctor) name, so it survives a reset and stays autopopulated.
 *
 * @param {object} formData
 * @param {string[]} keep  procedure fields to preserve (default ['operator'])
 * @returns {object}
 */
export function stripProcedureFields(formData, keep = ['operator']) {
  const keepSet = new Set(keep);
  const out = {};
  for (const [key, value] of Object.entries(formData)) {
    if (PROC_ALL_FIELDS.has(key) && !keepSet.has(key)) continue;
    out[key] = value;
  }
  return out;
}

/**
 * Best-effort one-line result for a session history row: the value of the
 * type's *Response field (ectResponse, tmsResponse, dbsResponse …) if present.
 *
 * @param {object} data  a session's data object
 * @returns {string}
 */
export function procedureSessionResult(data) {
  if (!data) return '';
  const key = Object.keys(data).find((k) => /response$/i.test(k));
  return key ? String(data[key] || '') : '';
}

// ═════════════════════════════════════════════════════════════════════════════
// PSYCHOTHERAPY / CBT — sessions model (same logic as procedures)
// ═════════════════════════════════════════════════════════════════════════════
//
// Psychotherapy is a COURSE of sessions, so the tab's saves must accumulate the
// same way procedures do. Sessions live in a dedicated top-level array on the
// record document (written by the psychotherapy-session endpoints, NOT by the
// generic section save, which could only ever hold the latest session):
//
//   psychotherapySessions: [ { id, session_no, saved_at, data: { cbt* } } ]
//
// Psychotherapy is a single activity — the modality is a field *inside* the
// session — so there is no slug map here, just one flat list of sessions.

// Every field a CBT session snapshot carries (the whole Psychotherapy tab).
export const PSYCHOTHERAPY_SESSION_FIELDS = TAB_FIELDS.psychotherapy;

/**
 * Build a psychotherapy/CBT session snapshot from the flat formData. Returns
 * null when the form is effectively blank, so a stray Save cannot append an
 * empty session (the procedure equivalent gates on a selected type; the CBT log
 * has no such required field, so "has any value at all" is the gate).
 *
 * @param {object} formData  the flat context formData
 * @returns {{ data: object }|null}
 */
export function buildPsychotherapySession(formData) {
  const data = {};
  let hasValue = false;
  for (const key of PSYCHOTHERAPY_SESSION_FIELDS) {
    const value = formData[key];
    if (value === undefined) continue;
    data[key] = value;
    if (value !== '' && value !== null && !(Array.isArray(value) && value.length === 0)) {
      hasValue = true;
    }
  }
  return hasValue ? { data } : null;
}

/**
 * Best-effort one-line result for a CBT session history row: progress towards
 * treatment goals (the closest analogue of a procedure's *Response field).
 *
 * @param {object} data  a session's data object
 * @returns {string}
 */
export function psychotherapySessionResult(data) {
  if (!data) return '';
  return String(data.cbtProgress || '');
}

// ═════════════════════════════════════════════════════════════════════════════
// MENTAL STATE EXAMINATION — sessions model (same logic as psychotherapy)
// ═════════════════════════════════════════════════════════════════════════════
//
// An MSE is repeated at every review and read as a SERIES: this week's affect,
// risk level and MMSE only mean something next to last week's. Saving it into one
// flat section threw that series away — each save overwrote the previous
// examination. Examinations now live in a dedicated top-level array on the record
// document (written by the mse-session endpoints, not the generic section save):
//
//   mseSessions: [ { id, session_no, saved_at, data: { ...MSE fields } } ]
//
// There is only one kind of examination — no slug map, just a flat list.

// Every field an examination snapshot carries (the whole MSE tab).
export const MSE_SESSION_FIELDS = TAB_FIELDS.mse;

/**
 * Build an MSE snapshot from the flat formData. Returns null when the form is
 * effectively blank, so a stray Save cannot append an empty examination. Like
 * the CBT log the tab has no single required field (an MSE is legitimately
 * partial — you record what you observed), so "has any value at all" is the gate.
 *
 * @param {object} formData  the flat context formData
 * @returns {{ data: object }|null}
 */
export function buildMseSession(formData) {
  const data = {};
  let hasValue = false;
  for (const key of MSE_SESSION_FIELDS) {
    const value = formData[key];
    if (value === undefined) continue;
    data[key] = value;
    if (value !== '' && value !== null && !(Array.isArray(value) && value.length === 0)) {
      hasValue = true;
    }
  }
  return hasValue ? { data } : null;
}

/**
 * Best-effort one-line result for an examination's history row. Suicide/self-harm
 * risk is the one finding that changes what happens next, so it leads — it is
 * also a short graded value, which is what that single-line row can show.
 *
 * @param {object} data  an examination's data object
 * @returns {string}
 */
export function mseSessionResult(data) {
  if (!data) return '';
  return data.riskSelfHarm ? `self-harm risk ${String(data.riskSelfHarm)}` : '';
}

// ═════════════════════════════════════════════════════════════════════════════
// BASELINE INVESTIGATIONS — sessions model, with a TABULAR history detail
// ═════════════════════════════════════════════════════════════════════════════
//
// Vitals, scales and labs are repeated on a schedule (metabolic monitoring,
// clozapine ANC, lithium levels), and the whole point is the trend — one flat
// section meant every repeat panel destroyed the previous one. Panels now live in
// a dedicated top-level array on the record document:
//
//   baselineSessions: [ { id, session_no, saved_at, data: { ...baseline fields } } ]
//
// Unlike the other sessions tabs this one's history detail renders as a TABLE
// (SessionHistory detail="table"): a panel is a column of numbers, and numbers
// are read against their unit and reference range, not as prose.

// Every field a baseline panel snapshot carries (the whole Baseline tab).
export const BASELINE_SESSION_FIELDS = TAB_FIELDS.baseline;

/**
 * Build a baseline panel snapshot from the flat formData. Returns null when the
 * form is effectively blank so a stray Save cannot append an empty panel.
 *
 * Derived values (bsa, bmi, phqTotal/Severity, gadTotal/gadSeverity) are readOnly
 * in the form but ARE part of the snapshot: runCalculations has already filled
 * them in formData, and a stored panel should carry the scored instrument, not
 * just its items.
 *
 * @param {object} formData  the flat context formData
 * @returns {{ data: object }|null}
 */
export function buildBaselineSession(formData) {
  const data = {};
  let hasValue = false;
  for (const key of BASELINE_SESSION_FIELDS) {
    const value = formData[key];
    if (value === undefined) continue;
    data[key] = value;
    if (value !== '' && value !== null && !(Array.isArray(value) && value.length === 0)) {
      hasValue = true;
    }
  }
  return hasValue ? { data } : null;
}

/**
 * Best-effort one-line result for a panel's history row: the two scored screens,
 * which are the only self-summarising numbers on the tab.
 *
 * @param {object} data  a panel's data object
 * @returns {string}
 */
export function baselineSessionResult(data) {
  if (!data) return '';
  const bits = [];
  if (data.phqTotal !== undefined && data.phqTotal !== '') bits.push(`PHQ-9 ${data.phqTotal}`);
  if (data.gadTotal !== undefined && data.gadTotal !== '') bits.push(`GAD-7 ${data.gadTotal}`);
  return bits.join(' · ');
}

/**
 * Row spec for the tabular history detail: [key, label, unit] grouped exactly as
 * the tab's own sections are, so a saved panel reads back in the order it was
 * entered. Labels are the tab's labels, shortened where a full question stem
 * would not fit a table cell; units and ranges go in the Unit column.
 *
 * MUST stay in sync with BaselineDataTab.jsx — same obligation TAB_FIELDS above
 * already carries. Any key present in a saved panel but missing here still shows
 * up in the table (buildBaselineTable in BaselineDataTab.jsx appends it under
 * "Other"), so a forgotten field degrades to a humanised label rather than
 * vanishing from the record.
 *
 * The three "3.5 —" lab groups are the one exception to "the tab's labels": their
 * keys now come from NEURO_LAB_FIELDS in LabInvestigations.jsx, which the tab
 * mounts in place of the old hand-typed fields. Renaming a key there without
 * renaming it here drops those rows into "Other" — it will not lose them, but the
 * grouping and units go with the label.
 */
export const BASELINE_TABLE_SPEC = [
  {
    group: '3.1 — Vital Signs',
    rows: [
      ['bpSys', 'Blood Pressure (Systolic)', 'mmHg'],
      ['bpDia', 'Blood Pressure (Diastolic)', 'mmHg'],
      ['hr', 'Heart Rate', 'bpm'],
      ['temp', 'Temperature', '°C'],
      ['rr', 'Respiratory Rate', '/min'],
      ['spo2', 'SpO₂', '%'],
      ['glucose', 'Blood Glucose (POC)', 'mg/dL'],
    ],
  },
  {
    group: '3.2 — Physical & Metabolic Measurements',
    rows: [
      ['height', 'Height', 'cm'],
      ['weight', 'Weight', 'kg'],
      ['bsa', 'Body Surface Area', 'm²'],
      ['bmi', 'BMI', 'kg/m²'],
      ['waist', 'Waist Circumference', 'cm'],
    ],
  },
  {
    group: '3.3 — PHQ-9 (Depression)',
    rows: [
      ['phq1', 'Q1 · Interest / pleasure', '0–3'],
      ['phq2', 'Q2 · Depressed / hopeless', '0–3'],
      ['phq3', 'Q3 · Sleep', '0–3'],
      ['phq4', 'Q4 · Energy', '0–3'],
      ['phq5', 'Q5 · Appetite', '0–3'],
      ['phq6', 'Q6 · Self-worth', '0–3'],
      ['phq7', 'Q7 · Concentration', '0–3'],
      ['phq8', 'Q8 · Psychomotor', '0–3'],
      ['phq9', 'Q9 · Thoughts of self-harm', '0–3'],
      ['phqTotal', 'PHQ-9 Total', '/27'],
      ['phqSeverity', 'PHQ-9 Severity', ''],
    ],
  },
  {
    group: '3.3 — GAD-7 (Anxiety)',
    rows: [
      ['gad1', 'Q1 · Nervous / on edge', '0–3'],
      ['gad2', 'Q2 · Uncontrollable worry', '0–3'],
      ['gad3', 'Q3 · Worrying too much', '0–3'],
      ['gad4', 'Q4 · Trouble relaxing', '0–3'],
      ['gad5', 'Q5 · Restlessness', '0–3'],
      ['gad6', 'Q6 · Irritability', '0–3'],
      ['gad7', 'Q7 · Fear of something awful', '0–3'],
      ['gadTotal', 'GAD-7 Total', '/21'],
      ['gadSeverity', 'GAD-7 Severity', ''],
    ],
  },
  {
    group: '3.4 — Clinician-Rated Scales',
    rows: [
      ['hamd', 'HAM-D (Hamilton Depression)', '/52'],
      ['madrs', 'MADRS (Montgomery-Åsberg)', '/60'],
      ['hama', 'HAM-A (Hamilton Anxiety)', '/56'],
      ['ymrs', 'YMRS (Young Mania)', '/60'],
      ['panssP', 'PANSS — Positive', '7–49'],
      ['panssN', 'PANSS — Negative', '7–49'],
      ['panssG', 'PANSS — General', '16–112'],
      ['yboc', 'Y-BOCS (OCD)', '/40'],
      ['pcl5', 'PCL-5 (PTSD)', '/80'],
      ['cgiS', 'CGI — Severity', '1–7'],
      ['cgiI', 'CGI — Improvement', '1–7'],
      ['gaf', 'GAF Score', '/100'],
    ],
  },
  {
    group: '3.5 — Metabolic / Haematology',
    rows: [
      ['hb', 'Haemoglobin', 'g/dL'],
      ['wbc', 'WBC', '/µL'],
      ['anc', 'Absolute Neutrophil Count', '/µL'],
      ['platelets', 'Platelets', '/µL'],
      ['sodium', 'Sodium', 'mmol/L'],
      ['potassium', 'Potassium', 'mmol/L'],
      ['creatinine', 'Creatinine', 'mg/dL'],
      ['hba1c', 'HbA1c', '%'],
      ['lipids', 'Total Cholesterol', 'mg/dL'],
      ['prolactin', 'Prolactin', 'ng/mL'],
    ],
  },
  {
    group: '3.5 — Endocrine / Nutrition',
    rows: [
      ['tsh', 'TSH', 'mIU/L'],
      ['t4', 'Free T4', 'ng/dL'],
      ['b12', 'Vitamin B12', 'pg/mL'],
      ['folate', 'Folate', 'ng/mL'],
      ['vitD', 'Vitamin D', 'ng/mL'],
    ],
  },
  {
    group: '3.5 — Therapeutic Drug Levels',
    rows: [
      ['lithiumLevel', 'Lithium Level', 'mmol/L'],
      ['valproateLevel', 'Valproate Level', 'µg/mL'],
      ['carbamazepineLevel', 'Carbamazepine Level', 'µg/mL'],
      ['clozapineLevel', 'Clozapine Level', 'ng/mL'],
    ],
  },
  {
    group: '3.5 — Dementia / Organic Workup',
    rows: [
      ['csfBiomarkers', 'CSF Biomarkers (Aβ42, tau, p-tau)', ''],
      ['autoimmunePanel', 'Autoimmune Encephalitis Panel', ''],
      ['toxicology', 'Urine Drug Screen / Toxicology', ''],
      ['labOther', 'Other Lab Values / Notes', ''],
    ],
  },
];

/** Every key the table spec accounts for — used to catch the ones it doesn't. */
export const BASELINE_TABLE_KEYS = new Set(
  BASELINE_TABLE_SPEC.flatMap(({ rows }) => rows.map(([k]) => k))
);
