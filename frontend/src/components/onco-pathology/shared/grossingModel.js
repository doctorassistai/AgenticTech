const makeUid = (prefix) => {
  const uuid = globalThis.crypto?.randomUUID?.();
  const token = uuid
    ? parseInt(uuid.replace(/-/g, "").slice(0, 8), 16).toString(36).toUpperCase().padStart(7, "0")
    : `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`.toUpperCase().slice(-7);
  return `${prefix}-${token}`;
};

export const SPECIMEN_CLASS_OPTIONS = [
  "Small biopsy",
  "Large specimen / resection",
  "Other",
];

export const YES_NO_OPTIONS = ["Yes", "No"];

export const BIOPSY_MEASUREMENT_OPTIONS = ["Individual", "Aggregate"];

export const BIOPSY_HANDLING_OPTIONS = [
  "None",
  "Filter paper",
  "Tissue wrap",
  "Mesh biopsy bag",
  "Other",
];

export const TUMOR_BORDER_OPTIONS = [
  "Well circumscribed",
  "Infiltrative",
  "Ill defined",
  "Encapsulated",
  "Other",
];

export const TUMOR_CONFIGURATION_OPTIONS = [
  "Ulcerated",
  "Polypoid",
  "Fungating",
  "Flat",
  "Infiltrative",
  "Cystic",
  "Other",
];

export const BIOBANK_ALLOCATION_OPTIONS = ["No", "Yes", "Not applicable"];

const emptyDimensions = () => ({ length_mm: "", width_mm: "", depth_mm: "" });

export const makeMargin = () => ({
  margin_id: makeUid("MARGIN"),
  name: "",
  distance_mm: "",
  ink_color: "",
  comments: "",
});

export const makeLymphNodeGroup = () => ({
  lymph_node_group_id: makeUid("LNG"),
  name: "",
  count_identified: "",
  gross_appearance: "",
});

export const makeCassette = (specimenId = "", containerIds = [], index = 0) => ({
  cassette_id: makeUid("CAS"),
  parent_specimen_id: specimenId,
  parent_container_ids: [...containerIds],
  label: index < 26 ? String.fromCharCode(65 + index) : `C${index + 1}`,
  tissue_description: "",
  sampling_purpose: "",
  special_instructions: "",
});

const inferSpecimenClass = (specimen = {}) => {
  const value = `${specimen.specimen_type || ""} ${specimen.procedure || ""}`.toLowerCase();
  if (/biopsy|curettage|core|fragment|punch|shave/.test(value)) return "Small biopsy";
  if (/resection|ectomy|excision|amputation/.test(value)) return "Large specimen / resection";
  return "Other";
};

export const makeGrossingRecord = (specimen = {}, staff = {}) => {
  return {
    grossing_id: makeUid("GROSS"),
    specimen_id: specimen.specimen_id || "",
    selected_container_ids: [],
    container_verifications: [],
    specimen_class: inferSpecimenClass(specimen),
    primary_for_reporting: false,
    grossed_by: {
      staff_id: staff.staff_id || "",
      name: staff.name || "",
    },
    grossing_datetime: "",
    common: {
      weight_g: "",
      dimensions_mm: emptyDimensions(),
      external_surface_description: "",
      cut_surface_description: "",
      orientation: "",
      identifying_markers: "",
      gross_description: "",
    },
    biopsy: {
      tissue_count: "",
      measurement_basis: "",
      dimensions_mm: emptyDimensions(),
      entire_specimen_submitted: "",
      handling_method: "",
      handling_method_other: "",
    },
    resection: {
      lesion_location: "",
      tumor_dimensions_mm: emptyDimensions(),
      tumor_border: "",
      tumor_configuration: "",
      necrosis: "",
      hemorrhage: "",
      cystic_change: "",
      relationship_to_surrounding_structures: "",
      margins: [],
      lymph_nodes_identified: "",
      lymph_node_groups: [],
      imaging_reference: "",
      biobank_or_frozen_allocation: "",
      allocation_details: "",
    },
    cassettes: [],
    photographs: {
      before_sectioning: null,
      after_sectioning: null,
    },
    dictation: {
      transcript: "",
      structured_at: "",
      review_status: "",
      reviewed_by: "",
      reviewed_at: "",
    },
    status: "Draft",
  };
};

export const EMPTY_GROSSING = {
  schema_version: "2.0",
  measurement_unit: "mm",
  records: [],
};

const normalizeDimensions = (value = {}) => ({
  length_mm: value?.length_mm || "",
  width_mm: value?.width_mm || "",
  depth_mm: value?.depth_mm || "",
});

const normalizeRecord = (record = {}, specimen = {}, staff = {}) => {
  const base = makeGrossingRecord(specimen, staff);
  const validContainerIds = new Set((specimen.containers || []).map((item) => item.container_id));
  const selectedContainerIds = Array.isArray(record.selected_container_ids)
    ? record.selected_container_ids.filter((id) => validContainerIds.has(id))
    : base.selected_container_ids;

  return {
    ...base,
    ...record,
    grossing_id: record.grossing_id || base.grossing_id,
    specimen_id: specimen.specimen_id || record.specimen_id || "",
    selected_container_ids: selectedContainerIds,
    container_verifications: Array.isArray(record.container_verifications)
      ? record.container_verifications.filter((item) => validContainerIds.has(item?.container_id))
      : [],
    grossed_by: { ...base.grossed_by, ...(record.grossed_by || {}) },
    common: {
      ...base.common,
      ...(record.common || {}),
      dimensions_mm: normalizeDimensions(record.common?.dimensions_mm),
    },
    biopsy: {
      ...base.biopsy,
      ...(record.biopsy || {}),
      dimensions_mm: normalizeDimensions(record.biopsy?.dimensions_mm),
    },
    resection: {
      ...base.resection,
      ...(record.resection || {}),
      tumor_dimensions_mm: normalizeDimensions(record.resection?.tumor_dimensions_mm),
      margins: Array.isArray(record.resection?.margins)
        ? record.resection.margins.map((margin) => ({ ...makeMargin(), ...(margin || {}) }))
        : [],
      lymph_node_groups: Array.isArray(record.resection?.lymph_node_groups)
        ? record.resection.lymph_node_groups.map((group) => ({
          ...makeLymphNodeGroup(),
          ...(group || {}),
        }))
        : [],
    },
    cassettes: Array.isArray(record.cassettes)
      ? record.cassettes.map((cassette, index) => ({
        ...makeCassette(specimen.specimen_id, selectedContainerIds, index),
        ...(cassette || {}),
        parent_specimen_id: specimen.specimen_id,
        parent_container_ids: Array.isArray(cassette?.parent_container_ids)
          ? cassette.parent_container_ids.filter((id) => validContainerIds.has(id))
          : selectedContainerIds,
      }))
      : [],
    photographs: { ...base.photographs, ...(record.photographs || {}) },
    dictation: { ...base.dictation, ...(record.dictation || {}) },
  };
};

export const normalizeGrossing = (data = {}, specimens = [], staff = {}) => {
  const specimenMap = new Map((specimens || []).map((specimen) => [specimen.specimen_id, specimen]));
  const records = Array.isArray(data.records)
    ? data.records
      .filter((record) => specimenMap.has(record?.specimen_id))
      .map((record) => normalizeRecord(record, specimenMap.get(record.specimen_id), staff))
    : [];

  return {
    schema_version: "2.0",
    measurement_unit: "mm",
    records,
  };
};

export const ensureGrossingRecord = (grossing, specimen, staff = {}) => {
  const normalized = normalizeGrossing(grossing, [specimen], staff);
  const existing = (grossing.records || []).find((record) => record.specimen_id === specimen.specimen_id);
  if (existing) return normalizeRecord(existing, specimen, staff);
  return normalized.records[0] || makeGrossingRecord(specimen, staff);
};

export const serializeGrossing = (grossing, specimens = [], staff = {}) => {
  const normalized = normalizeGrossing(grossing, specimens, staff);
  const firstPrimary = normalized.records.findIndex((record) => record.primary_for_reporting);
  return {
    ...normalized,
    records: normalized.records.map((record, index) => ({
      ...record,
      primary_for_reporting: firstPrimary >= 0 ? index === firstPrimary : false,
      cassette_count: record.cassettes.length,
    })),
  };
};

export const getPrimaryGrossingRecord = (grossing = {}) => {
  const records = Array.isArray(grossing.records) ? grossing.records : [];
  return records.find((record) => record.primary_for_reporting)
    || records.find((record) => record.status === "Completed")
    || records[0]
    || null;
};

export const grossingRecordToLegacyView = (record) => {
  if (!record) return {};
  const proximal = (record.resection?.margins || []).find((margin) => /proximal/i.test(margin.name));
  const distal = (record.resection?.margins || []).find((margin) => /distal/i.test(margin.name));
  const radial = (record.resection?.margins || []).find((margin) => /radial|circumferential/i.test(margin.name));
  const nodeGroups = record.resection?.lymph_node_groups || [];
  return {
    tumor_location: record.resection?.lesion_location || "",
    tumor_greatest_dimension: record.resection?.tumor_dimensions_mm?.length_mm
      ? String(Number(record.resection.tumor_dimensions_mm.length_mm) / 10)
      : "",
    additional_dimensions: [
      record.resection?.tumor_dimensions_mm?.width_mm,
      record.resection?.tumor_dimensions_mm?.depth_mm,
    ].filter((value) => value !== "" && value != null).map((value) => Number(value) / 10).join(" x "),
    proximal_margin: proximal?.distance_mm !== "" && proximal?.distance_mm != null
      ? String(Number(proximal.distance_mm) / 10)
      : "",
    distal_margin: distal?.distance_mm !== "" && distal?.distance_mm != null
      ? String(Number(distal.distance_mm) / 10)
      : "",
    radial_margin: radial?.distance_mm !== "" && radial?.distance_mm != null
      ? String(Number(radial.distance_mm) / 10)
      : "",
    lymph_node_stations: nodeGroups.map((group) => group.name).filter(Boolean).join(", "),
  };
};

const isEmptyValue = (value) => value === "" || value === null || value === undefined;

export const mergeGrossingExtraction = (record, patch = {}) => {
  const mergeObject = (current, incoming) => {
    const next = { ...(current || {}) };
    Object.entries(incoming || {}).forEach(([key, value]) => {
      if (isEmptyValue(value) || (Array.isArray(value) && value.length === 0)) return;
      if (Array.isArray(value)) {
        if (Array.isArray(next[key]) && next[key].length > 0) return;
        if (key === "margins") {
          next[key] = value.filter((item) => item && typeof item === "object").map((item) => ({
            ...makeMargin(),
            ...item,
          }));
        } else if (key === "lymph_node_groups") {
          next[key] = value.filter((item) => item && typeof item === "object").map((item) => ({
            ...makeLymphNodeGroup(),
            ...item,
          }));
        } else {
          next[key] = value;
        }
        return;
      }
      if (value && typeof value === "object" && !Array.isArray(value)) {
        next[key] = mergeObject(next[key], value);
      } else if (isEmptyValue(next[key])) {
        next[key] = value;
      }
    });
    return next;
  };
  return mergeObject(record, patch);
};
