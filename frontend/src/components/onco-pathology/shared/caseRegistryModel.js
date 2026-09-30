const makeUid = (prefix) => {
  // Physical item IDs are scoped to a pathology case during barcode
  // verification, so a compact random token is sufficient and keeps labels
  // practical on curved containers.
  const uuid = globalThis.crypto?.randomUUID?.();
  const token = uuid
    ? parseInt(uuid.replace(/-/g, "").slice(0, 8), 16).toString(36).toUpperCase().padStart(7, "0")
    : `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`.toUpperCase().slice(-7);
  return `${prefix}-${token}`;
};

const EMPTY_CLINICIAN = {
  doctor_id: "",
  sys_user_id: "",
  name: "",
  email: "",
  phone_number: "",
  specialization: "",
  registration_number: "",
  hospital_id: "",
  hospital_name: "",
};

export const CLINICAL_HISTORY_FIELDS = [
  "previous_diagnoses",
  "previous_pathology_reports",
  "previous_imaging_studies",
  "previous_treatments",
];

export const makeContainer = () => ({
  container_id: makeUid("CONT"),
  external_label: "",
  container_label: "",
  container_type: "",
  fixative_transport_medium: "",
  label_verification: "",
  comments: "",
});

export const makeSpecimen = (index = 0) => ({
  specimen_id: makeUid("SPEC"),
  part_label: String.fromCharCode(65 + Math.min(index, 25)),
  specimen_type: "",
  procedure: "",
  anatomic_site: "",
  sub_site: "",
  laterality: "",
  surgical_excision_datetime: "",
  collection_datetime: "",
  received_datetime: "",
  fixation_start_datetime: "",
  specimen_integrity: "",
  integrity_discrepancy_reason: "",
  patient_specimen_label_verification: "",
  procedure_performed_by: "",
  performing_department: "",
  imaging_guidance_used: "",
  imaging_report_reference: "",
  biopsy_clip_marker_placed: "",
  received_by: "",
  receipt_photo: null,
  containers: [makeContainer(0)],
});

export const EMPTY_CASE_REGISTRY = {
  schema_version: "2.0",
  case_details: {
    request_datetime: "",
    priority: "Routine",
    patient_status: "",
    ordering_clinician: "",
    referring_clinician_contact: "",
    department: "",
    accessioning_clinician: { ...EMPTY_CLINICIAN },
  },
  patient: {
    patient_id: "",
    patient_name: "",
    mrn: "",
    dob: "",
    sex: "",
  },
  clinical_context: {
    reason: "",
    reason_other: "",
    suspected_primary_site: "",
    suspected_sub_site: "",
    clinical_stage: "",
    requested_tests: [],
    summary: "",
    relevant_family_history: "",
    relevant_imaging_note: "",
    current_medications: "",
    tumor_marker_results: "",
  },
  specimens: [],
  data_provenance: {},
};

const textFromUnknown = (value) => {
  if (Array.isArray(value)) return value.filter(Boolean).join("\n");
  if (value && typeof value === "object") return JSON.stringify(value);
  return value || "";
};

const normalizeContainers = (containers) => {
  if (!Array.isArray(containers)) return [];
  return containers.map((container, index) => ({
    ...makeContainer(index),
    ...(container || {}),
    container_id: container?.container_id || makeUid("CONT"),
  }));
};

const normalizeSpecimens = (specimens) => {
  if (!Array.isArray(specimens)) return [];
  return specimens.map((specimen, index) => ({
    ...makeSpecimen(index),
    ...(specimen || {}),
    specimen_id: specimen?.specimen_id || makeUid("SPEC"),
    containers: normalizeContainers(specimen?.containers),
  }));
};

export const normalizeCaseRegistry = (data = {}, patientId = "") => {
  const caseDetails = data.case_details || {};
  const patient = data.patient || {};
  const clinicalContext = data.clinical_context || {};

  return {
    schema_version: data.schema_version || "2.0",
    case_details: {
      ...EMPTY_CASE_REGISTRY.case_details,
      ...caseDetails,
      accessioning_clinician: {
        ...EMPTY_CLINICIAN,
        ...(caseDetails.accessioning_clinician || {}),
      },
    },
    patient: {
      ...EMPTY_CASE_REGISTRY.patient,
      ...patient,
      patient_id: patient.patient_id || patientId || "",
    },
    clinical_context: {
      ...EMPTY_CASE_REGISTRY.clinical_context,
      ...clinicalContext,
      requested_tests: Array.isArray(clinicalContext.requested_tests)
        ? clinicalContext.requested_tests
        : [],
    },
    specimens: normalizeSpecimens(data.specimens),
    data_provenance: data.data_provenance || {},
  };
};

const specimenHasContent = (specimen) => {
  const ignored = new Set(["specimen_id", "part_label", "containers", "receipt_photo"]);
  const hasSpecimenValue = Object.entries(specimen || {}).some(
    ([key, value]) => !ignored.has(key) && String(value || "").trim()
  );
  const hasContainerValue = (specimen?.containers || []).some((container) =>
    Object.entries(container || {}).some(
      ([key, value]) => !["container_id", "parent_specimen_id"].includes(key)
        && String(value || "").trim()
    )
  );
  return hasSpecimenValue || hasContainerValue || !!specimen?.receipt_photo?.file_url;
};

export const serializeCaseRegistry = (state, patientId = "") => {
  const normalized = normalizeCaseRegistry(state, patientId);
  const specimens = normalized.specimens.filter(specimenHasContent);

  return {
    ...normalized,
    specimens,
  };
};

export const referralOutputToPatch = (output = {}) => ({
  case_details: {
    ordering_clinician: output.referred_from || "",
    referring_clinician_contact: output.referring_clinician_contact || "",
    department: output.referring_department || "",
  },
  clinical_context: {
    reason: output.reason || "",
    reason_other: output.reason_other || "",
    suspected_primary_site: output.suspected_primary_site || "",
    suspected_sub_site: output.suspected_sub_site || "",
    clinical_stage: output.clinical_stage || "",
    requested_tests: Array.isArray(output.requested_tests) ? output.requested_tests : [],
    summary: output.overall_summary || output.clinical_indication_summary || "",
    relevant_family_history: textFromUnknown(output.relevant_family_history),
    relevant_imaging_note: textFromUnknown(output.relevant_imaging_note),
    current_medications: textFromUnknown(output.current_medications),
    tumor_marker_results: textFromUnknown(output.tumor_marker_results),
  },
});

// Convert a cross-specialty request envelope into an editable, unsaved registry
// draft. Explicit structured specimen facts are imported; all other request
// details stay under provenance rather than being guessed into unrelated fields.
export const pathologyRequestToCaseRegistry = (request = {}, patientId = "") => {
  const context = request.clinical_context || {};
  const requestDetails = request.details || {};
  const requestSpecimen = requestDetails.specimen || {};
  const requestDate = request.created_at ? String(request.created_at).slice(0, 16) : "";
  const requester = {
    doctor_id: request.requester_doctor_id || "",
    name: request.requester_doctor_name || "",
  };
  const importedSpecimen = requestSpecimen.description || requestSpecimen.anatomical_site
    ? {
        ...makeSpecimen(0),
        specimen_id: makeUid("SPEC"),
        specimen_type: requestSpecimen.description || "",
        procedure: requestDetails.procedure || "",
        anatomic_site: requestSpecimen.anatomical_site || "",
        laterality: requestSpecimen.laterality || "",
        collection_datetime: requestSpecimen.collection_datetime || "",
        performing_department: request.referring_department || "",
        containers: [{
          ...makeContainer(),
          external_label: requestSpecimen.specimen_label || "",
          container_label: requestSpecimen.specimen_label || "",
          fixative_transport_medium: requestSpecimen.container_details || "",
          comments: requestSpecimen.notes || "",
        }],
      }
    : null;
  return normalizeCaseRegistry({
    ...EMPTY_CASE_REGISTRY,
    case_details: {
      ...EMPTY_CASE_REGISTRY.case_details,
      department: request.referring_department || "",
      ordering_clinician: requester.name,
      request_datetime: requestDate,
      priority: request.priority || "Routine",
    },
    patient: { ...EMPTY_CASE_REGISTRY.patient, patient_id: request.patient_id || patientId, patient_name: request.patient_name || "" },
    clinical_context: {
      ...EMPTY_CASE_REGISTRY.clinical_context,
      reason: context.reason || "",
      reason_other: context.reason_other || "",
      suspected_primary_site: context.suspected_primary_site || "",
      suspected_sub_site: context.suspected_sub_site || "",
      clinical_stage: context.clinical_stage || "",
      requested_tests: Array.isArray(context.requested_tests) ? context.requested_tests : [],
      summary: context.summary || "",
    },
    specimens: importedSpecimen ? [importedSpecimen] : [],
    data_provenance: {
      request: {
        request_id: request.request_id || "",
        source_type: "cross-specialty pathology request",
        source_specialization: request.source_specialization || "",
        source_module: request.source_module || "",
        requester: requester,
        request_type: request.request_type || "",
        details: request.details || {},
        imported_at: new Date().toISOString(),
        review_status: "requires review",
      },
    },
  }, patientId);
};
