/**
 * reportGenerator.js
 * Utility to generate and trigger printing / saving as PDF of clinical reports
 * with patient demographics and structured form data.
 */

import { renderVal, humanizeKey } from '../components/SessionHistory';

function escapeHtml(str) {
  if (str === null || str === undefined) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

export function printHtmlDocument(htmlContent) {
  const iframe = document.createElement('iframe');
  iframe.style.position = 'fixed';
  iframe.style.right = '0';
  iframe.style.bottom = '0';
  iframe.style.width = '0';
  iframe.style.height = '0';
  iframe.style.border = '0';
  document.body.appendChild(iframe);

  const doc = iframe.contentWindow.document;
  doc.open();
  doc.write(htmlContent);
  doc.close();

  iframe.contentWindow.focus();
  setTimeout(() => {
    try {
      iframe.contentWindow.print();
    } catch (e) {
      console.error('Print failed:', e);
    }
    setTimeout(() => {
      try {
        document.body.removeChild(iframe);
      } catch (_) {}
    }, 2000);
  }, 400);
}

function buildReportHtml({ title, subtitle, patient, sections, transcript, examiner }) {
  const patientGrid = [
    { label: 'Patient Name', val: patient.patientName || '—' },
    { label: 'Patient ID / HMS ID', val: patient.patientId || patient.hmsId || '—' },
    { label: 'Age / Sex', val: [patient.age && `${patient.age} yrs`, patient.sex].filter(Boolean).join(' / ') || '—' },
    { label: 'Contact', val: patient.contact || '—' },
    { label: 'Blood Group', val: patient.bloodGroup || '—' },
    { label: 'Date of Examination', val: patient.reportDate || new Date().toISOString().split('T')[0] },
    { label: 'Referring Doctor / Hospital', val: [patient.referringDoctor, patient.referringHospital].filter(Boolean).join(', ') || '—' },
    { label: 'Examiner / Clinician', val: examiner || patient.examiner || '—' },
  ];

  const sectionsHtml = sections
    .map((sec) => {
      const rows = (sec.fields || []).filter(
        (f) => f.value !== undefined && f.value !== null && f.value !== '' && (!Array.isArray(f.value) || f.value.length > 0)
      );
      if (!rows.length) return '';

      const itemsHtml = rows
        .map((r) => {
          const isFull = r.full || (typeof r.value === 'string' && r.value.length > 60) || Array.isArray(r.value);
          return `
            <div class="field-item ${isFull ? 'full-width' : ''}">
              <div class="field-label">${escapeHtml(r.label)}</div>
              <div class="field-value">${escapeHtml(renderVal(r.value))}</div>
            </div>
          `;
        })
        .join('');

      return `
        <div class="report-section">
          <div class="section-header">${escapeHtml(sec.title)}</div>
          <div class="section-grid">
            ${itemsHtml}
          </div>
        </div>
      `;
    })
    .filter(Boolean)
    .join('');

  const transcriptHtml = transcript
    ? `
      <div class="report-section page-break-inside-avoid">
        <div class="section-header">Clinical Conversation Transcript</div>
        <div class="transcript-box">${escapeHtml(transcript)}</div>
      </div>
    `
    : '';

  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8" />
  <title>${escapeHtml(title)} - ${escapeHtml(patient.patientName || 'Report')}</title>
  <style>
    @page {
      size: A4;
      margin: 14mm 14mm 14mm 14mm;
    }
    *, *::before, *::after {
      box-sizing: border-box;
    }
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
      color: #1a1a1a;
      background: #ffffff;
      margin: 0;
      padding: 0;
      font-size: 12px;
      line-height: 1.45;
    }
    .header-table {
      width: 100%;
      border-bottom: 2px solid #1a1a1a;
      padding-bottom: 10px;
      margin-bottom: 14px;
    }
    .header-table h1 {
      font-size: 18px;
      margin: 0 0 4px;
      font-weight: 700;
      color: #0f172a;
      letter-spacing: -0.01em;
      text-transform: uppercase;
    }
    .header-table h2 {
      font-size: 13px;
      margin: 0;
      font-weight: 600;
      color: #334155;
    }
    .header-meta {
      text-align: right;
      font-size: 10.5px;
      color: #64748b;
    }
    .patient-card {
      border: 1px solid #cbd5e1;
      border-radius: 4px;
      background: #f8fafc;
      padding: 10px 12px;
      margin-bottom: 16px;
      display: grid;
      grid-template-columns: repeat(4, 1fr);
      gap: 8px 14px;
    }
    .patient-field {
      display: flex;
      flex-direction: column;
    }
    .patient-field-label {
      font-size: 9.5px;
      font-weight: 600;
      color: #64748b;
      text-transform: uppercase;
      letter-spacing: 0.03em;
    }
    .patient-field-val {
      font-size: 12px;
      font-weight: 600;
      color: #0f172a;
      margin-top: 1px;
    }
    .report-section {
      margin-bottom: 14px;
      page-break-inside: avoid;
    }
    .section-header {
      font-size: 11.5px;
      font-weight: 700;
      color: #1e293b;
      background: #f1f5f9;
      border-left: 3px solid #334155;
      padding: 5px 8px;
      text-transform: uppercase;
      letter-spacing: 0.04em;
      margin-bottom: 8px;
    }
    .section-grid {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 6px 20px;
    }
    .field-item {
      display: flex;
      flex-direction: column;
      border-bottom: 1px solid #f1f5f9;
      padding-bottom: 4px;
    }
    .field-item.full-width {
      grid-column: 1 / -1;
    }
    .field-label {
      font-size: 10.5px;
      font-weight: 600;
      color: #475569;
    }
    .field-value {
      font-size: 12px;
      color: #0f172a;
      margin-top: 1px;
      white-space: pre-wrap;
    }
    .transcript-box {
      background: #fafafa;
      border: 1px solid #e2e8f0;
      border-radius: 4px;
      padding: 10px;
      font-size: 11px;
      line-height: 1.5;
      color: #334155;
      white-space: pre-wrap;
    }
    .footer-sign {
      margin-top: 30px;
      display: flex;
      justify-content: space-between;
      align-items: flex-end;
      page-break-inside: avoid;
      padding-top: 10px;
      border-top: 1px solid #e2e8f0;
    }
    .sign-box {
      text-align: center;
      width: 200px;
    }
    .sign-line {
      border-bottom: 1px solid #475569;
      margin-bottom: 4px;
      height: 30px;
    }
    .sign-label {
      font-size: 11px;
      font-weight: 600;
      color: #334155;
    }
  </style>
</head>
<body>
  <table class="header-table">
    <tr>
      <td>
        <h1>${escapeHtml(title)}</h1>
        <h2>${escapeHtml(subtitle)}</h2>
      </td>
      <td class="header-meta">
        <div><strong>Department of Neuropsychiatry</strong></div>
        <div>Generated: ${new Date().toLocaleString()}</div>
      </td>
    </tr>
  </table>

  <div class="patient-card">
    ${patientGrid
      .map(
        (p) => `
      <div class="patient-field">
        <span class="patient-field-label">${escapeHtml(p.label)}</span>
        <span class="patient-field-val">${escapeHtml(p.val)}</span>
      </div>
    `
      )
      .join('')}
  </div>

  ${sectionsHtml}

  ${transcriptHtml}

  <div class="footer-sign">
    <div>
      <div style="font-size: 10px; color: #94a3b8;">Confidential Medical Record · Dr. Assist Neuropsychiatry System</div>
    </div>
    <div class="sign-box">
      <div class="sign-line"></div>
      <div class="sign-label">${escapeHtml(examiner || 'Clinician / Therapist Signature')}</div>
    </div>
  </div>
</body>
</html>
  `;
}

/**
 * Generate and trigger download / print of the MSE & Cognition Report.
 */
export function downloadMseReport(formData) {
  const d = formData || {};
  const patient = {
    patientName: d.patientName,
    patientId: d.patientId,
    hmsId: d.hmsId,
    age: d.age,
    sex: d.sex,
    contact: d.contact,
    bloodGroup: d.bloodGroup,
    referringDoctor: d.referringDoctor,
    referringHospital: d.referringHospital,
    reportDate: d.mseDate,
  };

  const sections = [
    {
      title: '2.0 — Examination Details',
      fields: [
        { label: 'Date of Examination', value: d.mseDate },
        { label: 'Examined By', value: d.mseExaminer },
      ],
    },
    {
      title: '2.1 — Appearance & Behaviour',
      fields: [
        { label: 'General Appearance', value: d.appearance },
        { label: 'Behaviour', value: d.behaviour },
        { label: 'Eye Contact', value: d.eyeContact },
        { label: 'Rapport', value: d.rapport },
        { label: 'Psychomotor Activity', value: d.psychomotor },
        { label: 'Catatonic Signs (Bush-Francis)', value: d.catatonia, full: true },
        { label: 'Movement / EPS Signs', value: d.eps, full: true },
        { label: 'Additional Observations', value: d.appearanceNotes, full: true },
      ],
    },
    {
      title: '2.2 — Speech',
      fields: [
        { label: 'Rate', value: d.speechRate },
        { label: 'Volume', value: d.speechVolume },
        { label: 'Tone / Prosody', value: d.speechTone },
        { label: 'Flow / Quantity', value: d.speechFlow },
        { label: 'Formal Thought Disorder', value: d.speechFormal },
      ],
    },
    {
      title: '2.3 — Mood & Affect',
      fields: [
        { label: 'Mood (Subjective)', value: d.moodSubjective },
        { label: 'Mood (Objective)', value: d.moodObjective },
        { label: 'Affect Range', value: d.affectRange },
        { label: 'Affect Reactivity', value: d.affectReactivity },
        { label: 'Congruence', value: d.affectCongruence },
        { label: 'Appropriateness', value: d.affectAppropriate },
      ],
    },
    {
      title: '2.4 — Thought (Form, Content, Possession)',
      fields: [
        { label: 'Thought Form', value: d.thoughtForm },
        { label: 'Delusions', value: d.delusions, full: true },
        { label: 'Delusion Detail', value: d.delusionDetail, full: true },
        { label: 'Thought Possession / Passivity', value: d.thoughtPossession, full: true },
        { label: 'Obsessions / Compulsions', value: d.obsessions, full: true },
        { label: 'Suicidal Ideation', value: d.suicidalThoughts },
        { label: 'Homicidal / Harm-to-others', value: d.homicidalThoughts },
      ],
    },
    {
      title: '2.5 — Perception',
      fields: [
        { label: 'Hallucinations', value: d.hallucinations, full: true },
        { label: 'Hallucination Detail', value: d.hallucinationDetail, full: true },
        { label: 'Other Perceptual Disturbance', value: d.otherPerception, full: true },
      ],
    },
    {
      title: '2.6 — Cognition (Bedside)',
      fields: [
        { label: 'Level of Consciousness', value: d.conscLevel },
        { label: 'Orientation', value: d.orientation },
        { label: 'Attention & Concentration', value: d.attention },
        { label: 'Digit Span', value: d.digitSpan },
        { label: 'Short-term / Recall Memory', value: d.shortMemory },
        { label: 'Long-term Memory', value: d.longMemory },
        { label: 'Working Memory (serial 7s / WORLD)', value: d.workingMemory },
        { label: 'Language', value: d.language },
        { label: 'Executive Function (bedside)', value: d.executive },
        { label: 'Confabulation', value: d.confabulation },
      ],
    },
    {
      title: '2.7 — Insight & Judgement',
      fields: [
        { label: 'Insight', value: d.insight },
        { label: 'Judgement', value: d.judgement },
        { label: 'Capacity re: Treatment', value: d.capacityTreatment },
        { label: 'Insight / Capacity Notes', value: d.insightNotes, full: true },
      ],
    },
    {
      title: '2.8 — Risk Assessment',
      fields: [
        { label: 'Risk of Self-Harm / Suicide', value: d.riskSelfHarm },
        { label: 'Risk to Others / Violence', value: d.riskViolence },
        { label: 'Risk of Self-Neglect', value: d.riskNeglect },
        { label: 'Risk of Vulnerability / Exploitation', value: d.riskVulnerability },
        { label: 'Risk of Absconding', value: d.riskAbsconding },
        { label: 'Protective Factors', value: d.protectiveFactors, full: true },
        { label: 'Risk Formulation & Management Plan', value: d.riskFormulation, full: true },
        { label: 'C-SSRS Screen Result', value: d.cSSRS },
      ],
    },
    {
      title: '2.9 — Cognitive Screening & Movement Scales',
      fields: [
        { label: 'MMSE Score (0–30)', value: d.mmse },
        { label: 'MoCA Score (0–30)', value: d.moca },
        { label: 'ACE-III Score (0–100)', value: d.aceIII },
        { label: 'Global Cognition (Impression)', value: d.cogImpression },
        { label: 'Clock Drawing Test', value: d.clock },
        { label: 'Frontal Assessment Battery (0–18)', value: d.fab },
        { label: 'Executive Function (Impression)', value: d.execImpression },
        { label: 'AIMS Total (Tardive Dyskinesia, 0–28)', value: d.aims },
        { label: 'Involuntary Movements (Impression)', value: d.dyskinesiaImpression },
        { label: 'Barnes Akathisia Scale (0–14)', value: d.basAkathisia },
        { label: 'Restlessness / Akathisia (Impression)', value: d.akathisiaImpression },
        { label: 'Simpson-Angus EPS Scale (0–40)', value: d.simpson },
        { label: 'Stiffness / Parkinsonism (Impression)', value: d.parkinsonismImpression },
        { label: 'Cognitive Summary', value: d.cognitiveSummary, full: true },
      ],
    },
  ];

  const html = buildReportHtml({
    title: 'Mental State Examination & Cognition Report',
    subtitle: 'Comprehensive Neuropsychiatric & Cognitive Assessment',
    patient,
    sections,
    transcript: d.sessionTranscript,
    examiner: d.mseExaminer,
  });

  printHtmlDocument(html);
}

/**
 * Generate and trigger download / print of the Psychotherapy & CBT Session Report.
 */
export function downloadPsychotherapyReport(formData) {
  const d = formData || {};
  const patient = {
    patientName: d.patientName,
    patientId: d.patientId,
    hmsId: d.hmsId,
    age: d.age,
    sex: d.sex,
    contact: d.contact,
    bloodGroup: d.bloodGroup,
    referringDoctor: d.referringDoctor,
    referringHospital: d.referringHospital,
    reportDate: d.cbtSessionDate,
  };

  const sections = [
    {
      title: '1.0 — Session Logistics & Billing Details',
      fields: [
        { label: 'Session Date', value: d.cbtSessionDate },
        { label: 'Session Number', value: d.cbtSessionNum ? `Session ${d.cbtSessionNum}${d.cbtTotalSessions ? ` of ${d.cbtTotalSessions}` : ''}` : undefined },
        { label: 'Session Modality', value: d.cbtModality },
        { label: 'Session Duration', value: d.cbtDuration ? `${d.cbtDuration} mins` : undefined },
        { label: 'CPT / Billing Code', value: d.cbtBillingCode },
        { label: 'Therapist / Provider', value: d.cbtTherapist },
      ],
    },
    {
      title: '2.0 — Routine Outcome Monitoring (Symptom Scales)',
      fields: [
        { label: 'PHQ-9 Score (Depression, 0–27)', value: d.cbtPhq9 },
        { label: 'Depression (Clinical Impression)', value: d.cbtMoodImpression },
        { label: 'GAD-7 Score (Anxiety, 0–21)', value: d.cbtGad7 },
        { label: 'Anxiety (Clinical Impression)', value: d.cbtAnxietyImpression },
        { label: 'Y-BOCS Score (OCD, 0–40)', value: d.cbtYbocs },
        { label: 'Obsessive–Compulsive (Impression)', value: d.cbtOcdImpression },
        { label: 'Pre-Session Distress (SUDs, 0–100)', value: d.cbtPreSuds },
        { label: 'Distress on Arrival (Impression)', value: d.cbtDistressImpression },
        { label: 'Post-Session Distress (SUDs, 0–100)', value: d.cbtPostSuds },
        { label: 'Relief Across Session (Impression)', value: d.cbtReliefImpression },
      ],
    },
    {
      title: '3.0 — Clinical Status & Risk Assessment',
      fields: [
        { label: 'Brief Mental Status Exam', value: d.cbtMseBrief },
        { label: 'Suicide / Self-Harm Risk Assessment', value: d.cbtRiskAssessment },
        { label: 'Safety Plan Status', value: d.cbtSafetyPlan },
      ],
    },
    {
      title: '4.0 — Therapeutic Modality & Interventions',
      fields: [
        { label: 'Primary Therapeutic Approach', value: d.cbtPrimaryModality },
        { label: 'Specific Techniques / Interventions Utilized', value: d.cbtInterventions },
        { label: 'Session Agenda & Main Target Problem', value: d.cbtAgenda, full: true },
        { label: 'Clinical Narrative & Observations', value: d.cbtClinicalNotes, full: true },
      ],
    },
    {
      title: '5.0 — Patient Engagement & Goal Progress',
      fields: [
        { label: 'Patient Engagement & Alliance', value: d.cbtEngagement },
        { label: 'Progress Towards Treatment Goals', value: d.cbtProgress },
      ],
    },
    {
      title: '6.0 — Homework Assignment & Next Steps',
      fields: [
        { label: 'Last Session’s Homework Completion', value: d.cbtHomeworkReview },
        { label: 'Homework / Action Plan Assigned', value: d.cbtHomeworkAssigned, full: true },
        { label: 'Next Session Schedule', value: d.cbtNextSession },
      ],
    },
  ];

  const html = buildReportHtml({
    title: 'Psychotherapy & CBT Clinical Session Report',
    subtitle: 'Cognitive Behavioral Therapy & Process Documentation',
    patient,
    sections,
    transcript: d.sessionTranscript,
    examiner: d.cbtTherapist,
  });

  printHtmlDocument(html);
}

/**
 * Generate and trigger download / print of the Neuropsychiatry Clinical Summary Report.
 */
export function downloadSummaryReport(formData) {
  const d = formData || {};
  const patient = {
    patientName: d.patientName,
    patientId: d.patientId,
    hmsId: d.hmsId,
    age: d.age,
    sex: d.sex,
    contact: d.contact,
    bloodGroup: d.bloodGroup,
    referringDoctor: d.referringDoctor,
    referringHospital: d.referringHospital,
    reportDate: new Date().toISOString().split('T')[0],
  };

  const formatList = (arr, mapper) => {
    if (!Array.isArray(arr) || !arr.length) return undefined;
    const formatted = arr.map(mapper).filter(Boolean);
    return formatted.length ? formatted.join('\n') : undefined;
  };

  const secDx = formatList(d.sSecondaryDx, (item) => (typeof item === 'object' ? item.dx : item));
  const codes = formatList(d.sCodes, (c) =>
    typeof c === 'object' ? [c.code, c.desc].filter(Boolean).join(' — ') : c
  );
  const meds = formatList(d.sDischargeMeds, (m) =>
    typeof m === 'object'
      ? [
          m.drug,
          m.dose,
          m.freq,
          m.route,
          m.duration,
          m.status ? `(${m.status})` : '',
        ]
          .filter(Boolean)
          .join(' · ')
      : m
  );
  const followup = formatList(d.sFollowup, (f) =>
    typeof f === 'object'
      ? [f.date, f.dept, f.purpose ? `(${f.purpose})` : ''].filter(Boolean).join(' · ')
      : f
  );

  const sections = [
    {
      title: '1.0 — Clinical Summary & Key Findings',
      fields: [
        { label: 'Clinical Summary', value: d.sClinical, full: true },
        { label: 'Procedures / Treatments Performed', value: d.sProcedures, full: true },
        { label: 'Key Findings & Highlights', value: d.sKeyFindings, full: true },
      ],
    },
    {
      title: '2.0 — Diagnosis & Clinical Classification',
      fields: [
        { label: 'Primary Diagnosis (DSM-5-TR / ICD-11)', value: d.sPrimaryDx, full: true },
        { label: 'Secondary Diagnoses', value: secDx, full: true },
        { label: 'Diagnostic Codes (ICD / DSM)', value: codes, full: true },
      ],
    },
    {
      title: '3.0 — Discharge Plan & Follow-up',
      fields: [
        { label: 'Medications at Discharge', value: meds, full: true },
        { label: 'Follow-up Appointments', value: followup, full: true },
        { label: 'Prognosis Discussed with Patient/Family', value: d.sPrognosis },
      ],
    },
  ];

  const html = buildReportHtml({
    title: 'Neuropsychiatry Clinical Summary Report',
    subtitle: 'Comprehensive End-of-Workflow Assessment & Discharge Summary',
    patient,
    sections,
    transcript: d.sessionTranscript,
    examiner: d.sConsultant || d.doctorName,
  });

  printHtmlDocument(html);
}

