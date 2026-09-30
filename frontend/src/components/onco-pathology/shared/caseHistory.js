// shared/caseHistory.js — read-only projections of a PRIOR pathology case.
//
// Shared by the Case Registry "Previous Pathology Cases" table and by
// PriorCaseDialog so both read one definition of a case's date and diagnosis.
// `getPatientCases` returns each case's full document, so nothing here fetches.

/**
 * Best available date for a case: earliest specimen receipt, else the pathology
 * request time, else document creation. Mirrors the worklist rule.
 */
export const priorCaseDate = (caseDoc) => {
  const specimens = caseDoc?.case_register?.specimens || [];
  const received = specimens
    .map((specimen) => specimen?.received_datetime)
    .filter(Boolean)
    .sort();
  return received[0]
    || caseDoc?.case_register?.case_details?.request_datetime
    || caseDoc?.created_at
    || "";
};

/**
 * A stored date as a short local date. Values that are not dates — the treatment
 * records contain literal placeholders such as "empty" — read as "—" rather than
 * being echoed into a Date column.
 */
export const formatShortDate = (value) => {
  if (!value) return "—";
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? "—" : parsed.toLocaleDateString();
};

/**
 * The case-level diagnosis, written by the Final Diagnosis tab into its
 * canonical `final_diagnosis` section.
 */
export const priorCaseDiagnosis = (caseDoc) => caseDoc?.final_diagnosis?.final_diagnosis || caseDoc?.tnm?.latest?.final_diagnosis || "";
