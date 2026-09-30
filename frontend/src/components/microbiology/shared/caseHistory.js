// shared/caseHistory.js — read-only projections of a PRIOR microbiology case.
//
// Shared by the Registration tab's "Previous Microbiology Cases" table and by
// PriorMicrobiologyDialog so both read one definition of a case's date, specimen
// readout and principal finding. `getPatientCases` returns each case's full
// document, so nothing here fetches.

/**
 * Best available date for a case: earliest specimen receipt, else the request
 * datetime, else document creation. Mirrors the pathology worklist rule.
 */
export const microCaseDate = (caseDoc) => {
  const specimens = caseDoc?.case_register?.specimens || [];
  const received = specimens
    .map((specimen) => specimen?.received_datetime)
    .filter(Boolean)
    .sort();
  return received[0]
    || caseDoc?.case_register?.request?.request_datetime
    || caseDoc?.created_at
    || "";
};

/**
 * A stored date as a short local date. Values that are not dates read as "—"
 * rather than being echoed into a Date column.
 */
export const formatShortDate = (value) => {
  if (!value) return "—";
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? "—" : parsed.toLocaleDateString();
};

/**
 * Specimen readout for the table's Specimens column: "3 — Blood culture, Urine".
 * "" when the case has no registered specimens yet.
 */
export const specimenSummary = (caseDoc) => {
  const specimens = caseDoc?.case_register?.specimens || [];
  if (specimens.length === 0) return "";
  const types = specimens
    .map((specimen) => specimen?.specimen_type)
    .filter(Boolean)
    .join(", ");
  return `${specimens.length}${types ? ` — ${types}` : ""}`;
};

/**
 * The case's principal finding for the history table: the first named culture
 * organism (Tab 5), else the first named mycobacterial species (Tab 10). "" when
 * neither track has a named organism yet — the table shows "Not reported". The
 * full record is in the View dialog.
 */
export const principalMicroFinding = (caseDoc) => {
  const workup = caseDoc?.culture_workup || {};
  for (const block of Object.values(workup)) {
    for (const isolate of block?.isolates || []) {
      if (isolate?.organism) return isolate.organism;
    }
  }
  const myco = caseDoc?.mycobacteriology || {};
  for (const block of Object.values(myco)) {
    for (const isolate of block?.isolates || []) {
      if (isolate?.species) return isolate.species;
    }
  }
  return "";
};
