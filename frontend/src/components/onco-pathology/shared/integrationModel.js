// shared/integrationModel.js — Integrated Diagnosis data model
//
// Integration is where the pathologist synthesises everything into one
// diagnosis. It is deliberately NOT part of Microscopy.
//
// Looking at a slide and integrating a case are two different activities. A
// molecular result is DNA/RNA and never went under a microscope; a cytology
// diagnosis is read off smears that never entered the histology block chain.
// Both must reach the final report. While the synthesis step lived inside the
// microscopy tab, everything that had to reach the report was forced to pretend
// it was microscope work — so molecular looped back into Microscopy and cytology
// reached nothing at all.
//
// This section therefore holds only the pathologist's own synthesis plus
// confirmation provenance. Every piece of evidence it reasons over stays
// authoritative in its own tab and is read through integrationEvidence() —
// never copied in.

const makeUid = (prefix) => {
  const uuid = globalThis.crypto?.randomUUID?.();
  const token = uuid || `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  return `${prefix}-${token}`;
};

export const CONCORDANCE_OPTIONS = ["Concordant", "Discordant", "Partially concordant", "Unresolved"];

// A cytology specimen collected as a separate event carries its own accession in
// a real laboratory, so the correlation between two cases is a link, not a merge.
export const COMPANION_RELATION_OPTIONS = [
  "Cytology of same lesion",
  "Prior biopsy",
  "Prior resection",
  "Concurrent specimen, separate accession",
  "Other",
];

export const makeCompanionCase = () => ({
  link_id: makeUid("CMP"),
  case_id: "",
  accession_id: "",
  relation: "",
  note: "",
});

export const EMPTY_INTEGRATION = {
  morphology_contribution: "",
  ancillary_contribution: "",
  molecular_contribution: "",
  cytology_contribution: "",
  clinical_imaging_contribution: "",
  overall_concordance: "Unresolved",
  conflict_resolution: "",
  final_integrated_diagnosis: "",
  remaining_uncertainty: "",
  pending_tests: "",
  confirmed_by: "",
  confirmation_datetime: "",
  companion_cases: [],
};

// ─── Evidence projection ─────────────────────────────────────────────────────

const hasText = (value) => !!String(value ?? "").trim();

const ancillaryRead = (result = {}) => hasText(result.interpretation)
  || result.interpretability === "Not interpretable";

/**
 * The read-only evidence inventory this tab reasons over. Nothing here is
 * editable and nothing is stored — each group is projected from the tab that
 * owns it.
 *
 * `ancillaryResults` is the already-assembled complete projection
 * (completeAncillaryResults() in shared/microscopyModel.js). It is passed in
 * rather than imported so this model stays import-free like the others.
 */
export const integrationEvidence = ({
  microscopy = {},
  molecular = {},
  cytopathology = {},
  ancillaryResults = [],
} = {}) => ({
  reviews: (Array.isArray(microscopy?.reviews) ? microscopy.reviews : [])
    .filter((review) => ["Final", "Addendum"].includes(review?.report_status)),
  ancillary: (Array.isArray(ancillaryResults) ? ancillaryResults : []).filter(ancillaryRead),
  molecular: (Array.isArray(molecular?.orders) ? molecular.orders : [])
    .filter((order) => order?.status === "Reported"),
  cytology: (Array.isArray(cytopathology?.records) ? cytopathology.records : [])
    .filter((record) => record?.diagnostic_category || hasText(record?.cytologic_diagnosis)),
});

/**
 * Laboratory work that is finished but has not been accounted for in the
 * integrated diagnosis, and work that is still open. Used by the deterministic
 * readiness check and shown to the pathologist; never stored.
 */
export const integrationOutstanding = ({
  staining = {},
  molecular = {},
  cytopathology = {},
  ancillaryResults = [],
} = {}) => {
  const read = new Set((Array.isArray(ancillaryResults) ? ancillaryResults : [])
    .filter(ancillaryRead)
    .map((result) => result.stain_id)
    .filter(Boolean));
  return {
    // Returned to the pathologist but never interpreted.
    unread_stains: (Array.isArray(staining?.records) ? staining.records : []).filter((record) => record?.status === "Completed"
      && record?.modality !== "H&E"
      && record?.returned_to_microscopy === "Yes"
      && !read.has(record.stain_id)),
    // Reported molecular work is complete in its own tab; what matters here is
    // whether it was returned for integration.
    unreturned_molecular: (Array.isArray(molecular?.orders) ? molecular.orders : [])
      .filter((order) => order?.status === "Reported" && order?.returned_for_integrated_diagnosis !== "Yes"),
    open_staining: (Array.isArray(staining?.records) ? staining.records : [])
      .filter((record) => record?.status && !["Completed", "Reported", "Cancelled"].includes(record.status)),
    open_molecular: (Array.isArray(molecular?.orders) ? molecular.orders : [])
      .filter((order) => order?.status && !["Reported", "Completed", "Cancelled"].includes(order.status)),
    unsigned_cytology: (Array.isArray(cytopathology?.records) ? cytopathology.records : [])
      .filter((record) => record?.diagnostic_category && !["Final", "Amended"].includes(record?.report_status)),
  };
};

// ─── Reconciliation ──────────────────────────────────────────────────────────

// The only reconciliation pass. Free text is never rewritten; companion links
// are de-duplicated and a case can never be its own companion. Whether a linked
// case still exists cannot be checked here without a fetch, so a link is kept
// and the tab reports a load failure instead of silently dropping it.
export const syncIntegration = (data = {}, { caseId = "" } = {}) => {
  const seen = new Set();
  const companionCases = (Array.isArray(data?.companion_cases) ? data.companion_cases : [])
    .filter((link) => link && (hasText(link.case_id) || hasText(link.accession_id)))
    .filter((link) => {
      const key = link.case_id || link.accession_id;
      if (link.case_id && link.case_id === caseId) return false;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .map((link) => ({ ...makeCompanionCase(), ...link, link_id: link.link_id || makeUid("CMP") }));

  return { ...EMPTY_INTEGRATION, ...(data || {}), companion_cases: companionCases };
};

// ─── Dictation merge ─────────────────────────────────────────────────────────

// The only keys AI dictation may write. Every one is the pathologist's own
// synthesis free text except overall_concordance. Identity (confirmed_by /
// confirmation_datetime) and companion links are never dictated into — the
// pathologist confirms who and when themselves.
export const INTEGRATION_DICTATION_FIELDS = [
  "morphology_contribution",
  "ancillary_contribution",
  "molecular_contribution",
  "cytology_contribution",
  "clinical_imaging_contribution",
  "conflict_resolution",
  "final_integrated_diagnosis",
  "remaining_uncertainty",
  "pending_tests",
  "overall_concordance",
];

const isEmptyValue = (value) => value === "" || value === null || value === undefined;

// overall_concordance defaults to "Unresolved"; treat that default as empty so a
// stated concordance can land, while a recorded real choice is never replaced.
const canFill = (current, key) => isEmptyValue(current)
  || (key === "overall_concordance" && current === "Unresolved");

/**
 * Fill dictated values into currently-empty integration fields only.
 * Incoming blanks are ignored and recorded values are never overwritten.
 * `patch` values should already be snapped to canonical options by the caller
 * (the tab coerces overall_concordance before merging).
 */
export const mergeIntegrationExtraction = (integration = {}, patch = {}) => {
  const next = { ...integration };
  INTEGRATION_DICTATION_FIELDS.forEach((key) => {
    const value = patch[key];
    if (value === "" || value === null || value === undefined) return;
    if (canFill(next[key], key)) next[key] = value;
  });
  return next;
};

export const integrationConfirmed = (integration = {}) => Boolean(
  hasText(integration.final_integrated_diagnosis)
  && hasText(integration.confirmed_by)
  && hasText(integration.confirmation_datetime),
);
