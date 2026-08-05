// constants.js — Dropdown option lists for the Onco-Pathology module.
//
// Phase 1 (Case Registry) only needs departments + sex. The remaining lists
// (grossing / synoptic / AJCC-8 TNM) are scaffolded here for later tabs; the
// per-site synoptic field schema is owned/defined separately by the user.

// ─── Case Registry ─────────────────────────────────────────────────────────
export const DEPARTMENTS = [
  "Surgical Oncology",
  "Medical Oncology",
  "Gastroenterology",
];

export const SEX_OPTIONS = [
  { value: "male", label: "Male" },
  { value: "female", label: "Female" },
  { value: "other", label: "Other" },
];

// ─── Grossing Bench ─────────────────────────────────────────────────────────
export const CONTAINER_TYPES = ["Jar", "Cassette", "Bag"];

export const FIXATIVES = [
  "10% Neutral Buffered Formalin",
  "Alcohol",
  "Fresh (Not Fixed)",
];

export const GROSS_COLORS = [
  "Grey-white", "Tan", "Pink", "Yellow", "Brown", "Hemorrhagic", "Mixed",
];

export const CONSISTENCIES = ["Soft", "Firm", "Hard", "Friable", "Rubbery"];

export const TUMOR_CONFIGURATIONS = [
  "Ulcerated", "Polypoid", "Fungating", "Flat", "Infiltrative",
];

// ─── Case status lifecycle ─────────────────────────────────────────────────
export const CASE_STATUS = {
  ACCESSIONED: "Accessioned",
  GROSSED: "Grossed",
  REPORTED: "Reported",
  SIGNED_OUT: "Signed-out",
};
