/**
 * findingsAggregator.js
 * 
 * Aggregates clinical scale scores, procedures, diagnoses, and CBT observations
 * from active context data (formData, procedures map, psychotherapySessions,
 * mseSessions, and baselineSessions) into pre-formatted text for the Findings tab.
 */

// Helper to find the latest value for a key across formData and a sessions array
function getLatestValue(formData, sessions, key) {
  if (formData && formData[key] !== undefined && formData[key] !== '' && formData[key] !== null) {
    console.log(`[findingsAggregator] Found "${key}" in active formData:`, formData[key]);
    return formData[key];
  }
  if (Array.isArray(sessions) && sessions.length > 0) {
    for (let i = sessions.length - 1; i >= 0; i--) {
      const val = sessions[i]?.data?.[key];
      if (val !== undefined && val !== '' && val !== null) {
        console.log(`[findingsAggregator] Found "${key}" in historical session [${i}] (sessionId: ${sessions[i]?.sessionId || sessions[i]?.id || i}):`, val);
        return val;
      }
    }
  }
  return undefined;
}

export function aggregateFindingsData(
  formData = {},
  procedures = {},
  psychotherapySessions = [],
  mseSessions = [],
  baselineSessions = []
) {
  console.groupCollapsed('%c[findingsAggregator] Running aggregateFindingsData', 'color: #2563eb; font-weight: bold;');
  console.log('Inputs received:', {
    formDataKeysCount: Object.keys(formData || {}).length,
    proceduresMap: procedures,
    psychotherapySessionsCount: psychotherapySessions?.length || 0,
    mseSessionsCount: mseSessions?.length || 0,
    baselineSessionsCount: baselineSessions?.length || 0,
  });

  const updates = {};

  // 1. Procedures / Treatment Performed (fProcedure)
  if (!formData.fProcedure) {
    const procNames = [];
    if (procedures && typeof procedures === 'object') {
      for (const [slug, procObj] of Object.entries(procedures)) {
        if (procObj && procObj.type) {
          const count = procObj.sessions?.length;
          procNames.push(count ? `${procObj.type} (${count} session${count > 1 ? 's' : ''})` : procObj.type);
        }
      }
    }
    if (procNames.length === 0 && formData.procType) {
      procNames.push(formData.procType);
    }
    if (procNames.length === 0 && formData.surgCategory) {
      procNames.push(formData.surgCategory);
    }
    if (procNames.length > 0) {
      updates.fProcedure = procNames.join(', ');
      console.log('[findingsAggregator] Derived fProcedure:', updates.fProcedure);
    }
  } else {
    console.log('[findingsAggregator] fProcedure already filled in formData:', formData.fProcedure);
  }

  // 2. Psychotherapy & CBT Observations (fCBTObs)
  // Pulls directly from "Detailed Clinical Narrative & Therapist Observations" (cbtClinicalNotes)
  if (!formData.fCBTObs) {
    const cbtNotes = getLatestValue(formData, psychotherapySessions, 'cbtClinicalNotes');
    if (cbtNotes) {
      updates.fCBTObs = cbtNotes;
      console.log('[findingsAggregator] Derived fCBTObs:', updates.fCBTObs);
    }
  } else {
    console.log('[findingsAggregator] fCBTObs already filled in formData:', formData.fCBTObs);
  }

  // 3. Rating Scale Results Summary (fScalesSummary)
  if (!formData.fScalesSummary) {
    const scaleLines = [];

    // PHQ-9 (Baseline or CBT)
    const phqVal = getLatestValue(formData, baselineSessions, 'phqTotal') ?? getLatestValue(formData, psychotherapySessions, 'cbtPhq9');
    if (phqVal !== undefined) {
      const phqSev = getLatestValue(formData, baselineSessions, 'phqSeverity');
      const sevStr = phqSev ? ` (${phqSev})` : '';
      scaleLines.push(`• PHQ-9 (Depression): ${phqVal}/27${sevStr}`);
    }

    // GAD-7 (Baseline or CBT)
    const gadVal = getLatestValue(formData, baselineSessions, 'gadTotal') ?? getLatestValue(formData, psychotherapySessions, 'cbtGad7');
    if (gadVal !== undefined) {
      const gadSev = getLatestValue(formData, baselineSessions, 'gadSeverity');
      const sevStr = gadSev ? ` (${gadSev})` : '';
      scaleLines.push(`• GAD-7 (Anxiety): ${gadVal}/21${sevStr}`);
    }

    // Y-BOCS (Baseline or CBT)
    const ybocsVal = getLatestValue(formData, baselineSessions, 'yboc') ?? getLatestValue(formData, psychotherapySessions, 'cbtYbocs');
    if (ybocsVal !== undefined) {
      scaleLines.push(`• Y-BOCS (OCD): ${ybocsVal}/40`);
    }

    // Clinician-rated depression/anxiety/mania (from Baseline or MSE)
    const hamd = getLatestValue(formData, baselineSessions, 'hamd');
    if (hamd) scaleLines.push(`• HAM-D (Depression): ${hamd}`);

    const madrs = getLatestValue(formData, baselineSessions, 'madrs');
    if (madrs) scaleLines.push(`• MADRS (Depression): ${madrs}`);

    const hama = getLatestValue(formData, baselineSessions, 'hama');
    if (hama) scaleLines.push(`• HAM-A (Anxiety): ${hama}`);

    const ymrs = getLatestValue(formData, baselineSessions, 'ymrs');
    if (ymrs) scaleLines.push(`• YMRS (Mania): ${ymrs}`);

    const pcl5 = getLatestValue(formData, baselineSessions, 'pcl5');
    if (pcl5) scaleLines.push(`• PCL-5 (PTSD): ${pcl5}`);

    // PANSS (Baseline)
    const pP = getLatestValue(formData, baselineSessions, 'panssP');
    const pN = getLatestValue(formData, baselineSessions, 'panssN');
    const pG = getLatestValue(formData, baselineSessions, 'panssG');
    if (pP || pN || pG) {
      scaleLines.push(`• PANSS: Pos ${pP || '—'} · Neg ${pN || '—'} · Gen ${pG || '—'}`);
    }

    // Global Impressions & Functioning
    const cgiS = getLatestValue(formData, baselineSessions, 'cgiS');
    if (cgiS) scaleLines.push(`• CGI-S (Severity): ${cgiS}`);

    const cgiI = getLatestValue(formData, baselineSessions, 'cgiI');
    if (cgiI) scaleLines.push(`• CGI-I (Improvement): ${cgiI}`);

    const gaf = getLatestValue(formData, baselineSessions, 'gaf');
    if (gaf) scaleLines.push(`• GAF (Functioning): ${gaf}/100`);

    // Cognitive Scales (MSE)
    const mmse = getLatestValue(formData, mseSessions, 'mmse');
    if (mmse !== undefined) scaleLines.push(`• MMSE: ${mmse}/30`);

    const moca = getLatestValue(formData, mseSessions, 'moca');
    if (moca !== undefined) scaleLines.push(`• MoCA: ${moca}/30`);

    const aceIII = getLatestValue(formData, mseSessions, 'aceIII');
    if (aceIII !== undefined) scaleLines.push(`• ACE-III: ${aceIII}/100`);

    const fab = getLatestValue(formData, mseSessions, 'fab');
    if (fab !== undefined) scaleLines.push(`• FAB (Frontal Assessment): ${fab}/18`);

    const clock = getLatestValue(formData, mseSessions, 'clock');
    if (clock) scaleLines.push(`• Clock Drawing: ${clock}`);

    // Risk / Suicide
    const cssrs = getLatestValue(formData, mseSessions, 'cSSRS') || getLatestValue(formData, psychotherapySessions, 'cbtRiskAssessment');
    if (cssrs) {
      scaleLines.push(`• Risk / Suicide Screen (C-SSRS): ${cssrs}`);
    }

    // Movement / EPS (MSE)
    const aims = getLatestValue(formData, mseSessions, 'aims');
    if (aims) scaleLines.push(`• AIMS (Dyskinesia): ${aims}`);

    const bas = getLatestValue(formData, mseSessions, 'basAkathisia');
    if (bas) scaleLines.push(`• Barnes Akathisia: ${bas}`);

    const simpson = getLatestValue(formData, mseSessions, 'simpson');
    if (simpson) scaleLines.push(`• Simpson-Angus (EPS): ${simpson}`);

    if (scaleLines.length > 0) {
      updates.fScalesSummary = scaleLines.join('\n');
      console.log('[findingsAggregator] Derived fScalesSummary:\n' + updates.fScalesSummary);
    }
  } else {
    console.log('[findingsAggregator] fScalesSummary already filled in formData:', formData.fScalesSummary);
  }

  // 4. Final Diagnosis (fFinalDx)
  if (!formData.fFinalDx) {
    let dx = formData.sPrimaryDx || formData.pastDx || formData.presentingComplaint;
    if (Array.isArray(dx)) dx = dx.join(', ');
    if (dx) {
      updates.fFinalDx = dx;
      console.log('[findingsAggregator] Derived fFinalDx:', updates.fFinalDx);
    }
  } else {
    console.log('[findingsAggregator] fFinalDx already filled in formData:', formData.fFinalDx);
  }

  // 5. ICD Code (fICD)
  if (!formData.fICD) {
    const icd = formData.sCodes;
    if (icd) {
      updates.fICD = Array.isArray(icd) ? icd.map(c => typeof c === 'object' ? `${c.code || ''} ${c.desc || ''}`.trim() : c).filter(Boolean).join(', ') : icd;
      console.log('[findingsAggregator] Derived fICD:', updates.fICD);
    }
  } else {
    console.log('[findingsAggregator] fICD already filled in formData:', formData.fICD);
  }

  console.log('%c[findingsAggregator] Resulting updates to apply:', 'color: #16a34a; font-weight: bold;', updates);
  console.groupEnd();

  return updates;
}

export function aggregateSummaryData(
  formData = {},
  procedures = {},
  psychotherapySessions = [],
  mseSessions = [],
  baselineSessions = []
) {
  console.groupCollapsed('%c[findingsAggregator] Running aggregateSummaryData', 'color: #9333ea; font-weight: bold;');
  console.log('Inputs received:', {
    formDataKeysCount: Object.keys(formData || {}).length,
    proceduresMap: procedures,
    psychotherapySessionsCount: psychotherapySessions?.length || 0,
    mseSessionsCount: mseSessions?.length || 0,
    baselineSessionsCount: baselineSessions?.length || 0,
  });

  const updates = {};

  // 1. Procedures / Treatments Performed (sProcedures)
  if (!formData.sProcedures) {
    if (formData.fProcedure) {
      updates.sProcedures = formData.fProcedure;
      console.log('[findingsAggregator] Derived sProcedures from fProcedure:', updates.sProcedures);
    } else {
      const procNames = [];
      if (procedures && typeof procedures === 'object') {
        for (const [slug, procObj] of Object.entries(procedures)) {
          if (procObj && procObj.type) {
            const count = procObj.sessions?.length;
            procNames.push(count ? `${procObj.type} (${count} session${count > 1 ? 's' : ''})` : procObj.type);
          }
        }
      }
      if (procNames.length === 0 && formData.procType) {
        procNames.push(formData.procType);
      }
      if (procNames.length === 0 && formData.surgCategory) {
        procNames.push(formData.surgCategory);
      }
      if (procNames.length > 0) {
        updates.sProcedures = procNames.join(', ');
        console.log('[findingsAggregator] Derived sProcedures from procedures/form:', updates.sProcedures);
      }
    }
  } else {
    console.log('[findingsAggregator] sProcedures already filled in formData:', formData.sProcedures);
  }

  // 2. Key Findings (sKeyFindings) - aggregated from Findings tab / scales / CBT observations
  if (!formData.sKeyFindings) {
    const findingsParts = [];
    if (formData.fScalesSummary) {
      findingsParts.push(`Scale Scores:\n${formData.fScalesSummary}`);
    }
    if (formData.fCBTObs) {
      findingsParts.push(`CBT Observations:\n${formData.fCBTObs}`);
    }
    if (formData.fImaging) {
      findingsParts.push(`Imaging:\n${formData.fImaging}`);
    }
    if (formData.fLabs) {
      findingsParts.push(`Laboratory Results:\n${formData.fLabs}`);
    }
    if (findingsParts.length > 0) {
      updates.sKeyFindings = findingsParts.join('\n\n');
      console.log('[findingsAggregator] Derived sKeyFindings:\n' + updates.sKeyFindings);
    }
  } else {
    console.log('[findingsAggregator] sKeyFindings already filled in formData:', formData.sKeyFindings);
  }

  // 3. Primary Diagnosis (sPrimaryDx) - fallback to Findings tab fFinalDx, then Patient Info pastDx or presentingComplaint
  if (!formData.sPrimaryDx) {
    let dx = formData.fFinalDx || formData.pastDx || formData.presentingComplaint;
    if (Array.isArray(dx)) dx = dx.join(', ');
    if (dx) {
      updates.sPrimaryDx = dx;
      console.log('[findingsAggregator] Derived sPrimaryDx:', updates.sPrimaryDx);
    }
  } else {
    console.log('[findingsAggregator] sPrimaryDx already filled in formData:', formData.sPrimaryDx);
  }

  console.log('%c[findingsAggregator] Resulting Summary updates to apply:', 'color: #16a34a; font-weight: bold;', updates);
  console.groupEnd();

  return updates;
}

