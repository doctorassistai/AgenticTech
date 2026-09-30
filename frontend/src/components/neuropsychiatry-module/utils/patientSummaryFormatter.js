/**
 * patientSummaryFormatter.js
 * 
 * Extracts and formats the Global Patient Summary JSON (from hms/users/data/context/patient-summary)
 * into a concise, readable clinical narrative suitable for the "Clinical Summary" textarea.
 */

/**
 * Strips markdown asterisks, normalizes thin/non-breaking unicode whitespace,
 * and removes excessive spaces.
 */
function cleanText(str) {
  if (!str || typeof str !== 'string') return '';
  return str
    .replace(/\*\*/g, '') // remove markdown bold
    .replace(/[\u202f\u00a0\u2000-\u200b]/g, ' ') // normalize thin / non-breaking spaces
    .replace(/[ \t]+/g, ' ') // collapse multiple spaces/tabs
    .trim();
}

/**
 * Formats patient summary object into a clean, concise plain-text block.
 */
export function formatPatientSummary(raw) {
  if (!raw) return '';

  // Unwrap payload if wrapped in { data: ... } or { patient_summary: ... }
  const payload = raw.data || raw;
  const summary = payload.summary || payload.patient_summary?.summary;
  const overview = payload.patient_summary?.patient_overview || payload.patient_overview;

  const sections = [];

  // 1. Extract Diagnosis Header
  const diagnosis =
    summary?.diagnosis_header ||
    summary?.confirmed_diagnoses?.[0] ||
    overview?.one_liner ||
    payload.diagnosis;

  if (diagnosis) {
    const cleanDx = cleanText(diagnosis);
    if (cleanDx) {
      sections.push(`DIAGNOSIS:\n${cleanDx}`);
    }
  }

  // 2. Extract Narrative Paragraphs
  const paragraphs = summary?.paragraphs;
  if (Array.isArray(paragraphs) && paragraphs.length > 0) {
    const cleanedParagraphs = paragraphs
      .map(p => cleanText(p))
      .filter(Boolean);

    if (cleanedParagraphs.length > 0) {
      sections.push(
        `CLINICAL SUMMARY:\n` + cleanedParagraphs.map(p => `• ${p}`).join('\n\n')
      );
    }
  } else if (summary?.full_text) {
    const cleanFull = cleanText(summary.full_text);
    if (cleanFull) {
      sections.push(`CLINICAL SUMMARY:\n${cleanFull}`);
    }
  } else if (overview) {
    const lines = [];
    if (overview.presenting_today_for) {
      lines.push(`Presenting for: ${cleanText(overview.presenting_today_for)}`);
    }
    if (overview.known_to_this_clinic_since) {
      lines.push(`Known since: ${overview.known_to_this_clinic_since}`);
    }
    if (lines.length > 0) {
      sections.push(`OVERVIEW:\n${lines.join('\n')}`);
    }
  }

  return sections.join('\n\n').trim();
}
