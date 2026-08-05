import React, { useState, useEffect, useRef, useCallback } from "react";
import { useParams, useNavigate } from "react-router-dom";
import RawDocument from "./RawDocument";
import { AnnotationProvider, AnnotationContext, useAnnotations } from "./AnnotationContext";
// ADD THIS LINE alongside the other imports
import GenerateConclusionBar from "./GenerateConclusionBar";
const BASE_URL = import.meta.env.VITE_BACKEND_URL;

/* ─── THEME ─────────────────────────────────────────────────────────── */
const T = {
  bg: "#ffffff",
  bgAlt: "#fafafa",
  bgTert: "#f4f4f2",
  text: "#0a0a0a",
  textSec: "#3a3a3a",
  textMuted: "#888888",
  border: "#e0e0e0",
  borderMid: "#c8c8c8",
  accent: "#1a1a1a",
  accentLight: "#f0f0ee",
  success: "#16a34a",
  warn: "#f59e0b",
  danger: "#dc2626",
  blue: "#1d4ed8",
  blueLight: "#eff6ff",
  purple: "#7c3aed",
  purpleLight: "#f5f3ff",
};

/* ─── TRIGGER LABEL MAP ─────────────────────────────────────────────── */
const TRIGGER_LABELS = {
  claim_genuinity_authenticity: "Claim Genuinity & Authenticity",
  ped_non_disclosure: "PED / Non-Disclosure",
  rta_accident: "RTA / Accident",
  death_claim: "Death Claim",
  short_duration_policy: "Short Duration Policy",
  billing_inflated: "Billing Inflated",
  hospital_empanelment: "Hospital Empanelment",
  cashless_irregularity: "Cashless Irregularity",
};

const TRIGGER_SECTION_LABELS = {
  section1: "Hospital Visit Findings",
  section2: "Member / Insured Visit Findings",
  section3: "Conclusion",
};



/* ─── FORM SECTIONS ─────────────────────────────────────────────────── */
/* ─── FORM SECTIONS (complete — matches every key the extraction agents write) ─── */
/* ─── FORM SECTIONS (complete — matches every key the extraction agents write) ─── */
const FORM_SECTIONS = [
  {
    id: "policy",
    title: "Insurer & Policy Details",
    fields: [
      { key: "insurer", label: "Insurer" },
      { key: "policyNumber", label: "Policy Number" },
      { key: "policyType", label: "Type of Policy" },
      { key: "insurerRef", label: "Claim ID / Insurer Ref" },
      { key: "insurerContact", label: "Insurer Contact Person" },
      { key: "insurerContactInfo", label: "Insurer Contact Info" },
      { key: "tpaName", label: "TPA Name" },
      { key: "policyDetails.startDate", label: "Policy Start Date", type: "date" },
      { key: "policyDetails.endDate", label: "Policy End Date", type: "date" },
      { key: "policyDetails.inceptionDate", label: "First Commencement Date", type: "date" },
      { key: "policyDetails.sumInsured", label: "Sum Insured" },
      { key: "policyDetails.originalSumInsured", label: "Original Sum Insured" },
      { key: "policyDetails.sumInsuredEnhancement", label: "Sum Insured Enhancement" },
      { key: "policyDetails.policyYears", label: "No. of Policy Years" },
      { key: "policyDetails.agentBroker", label: "Agent / Broker" },
      { key: "policyDetails.coverageType", label: "Coverage Type" },
      { key: "policyDetails.preExistingDisease", label: "Pre-Existing Disease" },
      { key: "policyDetails.roomRentLimit", label: "Room Rent Limit" },
      { key: "sumInsured", label: "Sum Insured (Claim-level)" },
      { key: "claimedAmount", label: "Claimed Amount" },
    ],
  },
  {
    id: "claimant",
    title: "Claimant Details",
    fields: [
      { key: "claimantName", label: "Name of Insured" },
      { key: "claimantMobile", label: "Insured Contact" },
      { key: "claimantEmail", label: "Insured Email" },
      { key: "claimantAge", label: "Age" },
      { key: "relationship", label: "Relationship to Policyholder" },
      { key: "claimantAddress", label: "Insured Address" },
      { key: "city", label: "City" },
      { key: "district", label: "District" },
      { key: "pinCode", label: "Pin Code" },
      { key: "idProofType", label: "ID Proof Type" },
      { key: "idProofNumber", label: "ID Proof Number" },
    ],
  },
  {
    id: "hospital",
    title: "Hospital Details",
    fields: [
      { key: "hospitalDetails.name", label: "Hospital Name" },
      { key: "hospitalDetails.address", label: "Hospital Address" },
      { key: "hospitalDetails.type", label: "Hospital Type" },
      { key: "hospitalDetails.registrationNumber", label: "Registration Number" },
      { key: "hospitalDetails.ppnStatus", label: "PPN / Non-PPN" },
      { key: "hospitalDetails.city", label: "Hospital City" },
      { key: "hospitalDetails.department", label: "Department" },
      { key: "hospitalDetails.contactPerson", label: "Contact Person" },
      { key: "hospitalDetails.hospitalContactNumber", label: "Hospital Contact Number" },
      { key: "hospitalDetails.hospitalEmail", label: "Hospital Email" },
      { key: "hospitalDetails.doctorName", label: "Treating Doctor Name" },
      { key: "hospitalDetails.doctorRegNumber", label: "Doctor Registration No." },
    ],
  },
  {
    id: "claim",
    title: "Claim & Ailment Details",
    fields: [
      { key: "claimMode", label: "Cashless / Non-Cashless" },
      { key: "claimSubtype", label: "Claim Subtype" },
      { key: "hospitalDetails.admissionDate", label: "Date of Admission", type: "date" },
      { key: "hospitalDetails.dischargeDate", label: "Date of Discharge", type: "date" },
      { key: "dateOfIncident", label: "Date of First Onset / Incident", type: "date" },
      { key: "dateOfIntimation", label: "Date of Intimation", type: "date" },
      { key: "criticalDetails.diagnosis", label: "Disease / Diagnosis" },
      { key: "criticalDetails.procedure", label: "Procedure / Surgery" },
      { key: "criticalDetails.implants", label: "Implants" },
      { key: "criticalDetails.surgeryDate", label: "Surgery Date", type: "date" },
      { key: "description", label: "Case Description", type: "textarea" },
      { key: "additionalMedicalDetails.referralDoctor", label: "Referral Doctor" },
      { key: "additionalMedicalDetails.initialTreatment", label: "Initial Treatment Details", type: "textarea" },
      { key: "additionalMedicalDetails.preHospitalisationDetails", label: "Pre-Hospitalisation Details", type: "textarea" },
      { key: "additionalMedicalDetails.postHospitalisationDetails", label: "Post-Hospitalisation Details", type: "textarea" },
      { key: "additionalMedicalDetails.investigationsSuggestingDiagnosis", label: "Investigations for Diagnosis", type: "textarea" },
    ],
  },
  {
    id: "cashlessBilling",
    title: "Cashless & Billing Details",
    fields: [
      { key: "cashlessDetails.tpaName", label: "TPA (Cashless)" },
      { key: "cashlessDetails.admissionType", label: "Admission Type" },
      { key: "cashlessDetails.icuDetails", label: "ICU Admission Details" },
      { key: "cashlessDetails.estimatedCost", label: "Estimated Treatment Cost" },
      { key: "cashlessDetails.amountAuthorized", label: "Amount Authorized" },
      { key: "billingDetails.grossAmount", label: "Gross Bill Amount" },
      { key: "billingDetails.finalBillAmount", label: "Final Bill Amount" },
      { key: "billingDetails.discountAmount", label: "Discount Amount" },
      { key: "billingDetails.netAmountReceived", label: "Net Amount Received" },
      { key: "billingDetails.paymentMode", label: "Payment Mode" },
      { key: "billingDetails.roomType", label: "Room Type" },
      { key: "billingDetails.tariffType", label: "Tariff Type" },
      { key: "billingDetails.lineItems", label: "Bill Line Items", type: "table" },
      { key: "reimbursementDetails.accountName", label: "Bank Account Name" },
      { key: "reimbursementDetails.bankDetails", label: "Bank Details" },
      { key: "reimbursementDetails.ifsc", label: "IFSC Code" },
    ],
  },
  {
    id: "accident",
    title: "Accident Details",
    fields: [
      { key: "accidentDetails.dateTime", label: "Accident Date/Time" },
      { key: "accidentDetails.place", label: "Place of Accident" },
      { key: "accidentDetails.firNumber", label: "FIR Number" },
      { key: "accidentDetails.mlcNumber", label: "MLC Number" },
      { key: "accidentDetails.mlcRegistered", label: "MLC Registered" },
      { key: "accidentDetails.mlcCollected", label: "MLC Collected" },
      { key: "accidentDetails.accidentNarration", label: "Accident Narration", type: "textarea" },
      { key: "accidentDetails.firstAidDetails", label: "First Aid Details", type: "textarea" },
      { key: "accidentDetails.firstAidHospital", label: "First Aid Hospital" },
      { key: "accidentDetails.firstAidDateTime", label: "First Aid Date/Time" },
    ],
  },
  {
    id: "death",
    title: "Death Details",
    fields: [
      { key: "deathDetails.date", label: "Date of Death", type: "date" },
      { key: "deathDetails.time", label: "Time of Death" },
      { key: "deathDetails.reason", label: "Reason for Death" },
      { key: "deathDetails.beneficiaryName", label: "Beneficiary Name" },
    ],
  },
  {
    id: "medical",
    title: "Additional Medical Details",
    fields: [
      { key: "additionalMedicalDetails.diagnosisSummary", label: "Diagnosis Summary", type: "textarea" },
      { key: "additionalMedicalDetails.clinicalSummary", label: "Clinical Summary", type: "textarea" },
      { key: "additionalMedicalDetails.chiefComplaints", label: "Chief Complaints", type: "textarea-array" },
      { key: "additionalMedicalDetails.pastHistory", label: "Past History", type: "textarea" },
      { key: "additionalMedicalDetails.generalExamination", label: "General Examination", type: "textarea" },
      { key: "additionalMedicalDetails.localExamination", label: "Local Examination", type: "textarea" },
      { key: "additionalMedicalDetails.vitals", label: "Vitals", type: "textarea" },
      { key: "additionalMedicalDetails.investigatorHospitalOpinion", label: "Investigator Opinion (Hospital)", type: "textarea" },
      { key: "additionalMedicalDetails.investigatorMemberOpinion", label: "Investigator Opinion (Member)", type: "textarea" },
      { key: "additionalMedicalDetails.firstConsultationDate", label: "First Consultation Date", type: "date" },
    ],
  },
  {
    id: "obstetric",
    title: "Obstetric Details",
    fields: [
      { key: "obstetricDetails.gestationAge", label: "Gestation Age" },
      { key: "obstetricDetails.edd", label: "EDD" },
      { key: "obstetricDetails.gravidaParity", label: "Gravida/Parity" },
      { key: "obstetricDetails.fetalCondition", label: "Fetal Condition", type: "textarea" },
    ],
  },
  {
    id: "medicalStaff",
    title: "Medical Staff",
    fields: [
      { key: "medicalStaff.pathologistName", label: "Pathologist Name" },
      { key: "medicalStaff.pathologistDesignation", label: "Pathologist Designation" },
      { key: "medicalStaff.pathologistRegNo", label: "Pathologist Reg. No" },
      { key: "medicalStaff.radiologistName", label: "Radiologist Name" },
      { key: "medicalStaff.radiologistDesignation", label: "Radiologist Designation" },
      { key: "medicalStaff.radiologistRegNo", label: "Radiologist Reg. No" },
    ],
  },
  {
    id: "risk",
    title: "Risk & Investigation Triggers",
    fields: [
      { key: "riskDetails.riskScore", label: "Risk Score" },
      { key: "riskDetails.riskLevel", label: "Risk Level" },
      { key: "riskDetails.triggers", label: "Risk Triggers", type: "textarea" },
      { key: "riskDetails.investigationInstruction", label: "Investigation Instruction", type: "textarea" },
      { key: "emailInstructions", label: "Email Instructions", type: "textarea" },
    ],
  },
  {
    id: "checklist",
    title: "Checklist",
    fields: [
      { key: "checklist.idProofInsured", label: "1. ID proof of insured patient", type: "yn" },
      { key: "checklist.hospitalExistence", label: "2. Hospital existence & registration", type: "yn" },
      { key: "checklist.admissionVerified", label: "3. Admission of patient on stated dates", type: "yn" },
      { key: "checklist.treatmentParticulars", label: "4. Treatment particulars", type: "yn" },
      { key: "checklist.copyOfICP", label: "5. Copy of ICP", type: "yn" },
      { key: "checklist.labVicinity", label: "6. Lab in vicinity / far off", type: "yn" },
      { key: "checklist.labRegistersVerified", label: "7. Lab registers verified", type: "yn" },
      { key: "checklist.billsReceipts", label: "8. Bills & receipts verified", type: "yn" },
      { key: "checklist.medicinePurchases", label: "9. Medicine shop purchases", type: "yn" },
      { key: "checklist.signatureMatching", label: "10. Signature matching", type: "yn" },
      { key: "checklist.otReceiptBooks", label: "11. OT / receipt book copies", type: "yn" },
      { key: "checklist.anyOther", label: "12. Any other", type: "yn" },
    ],
  },
  {
    id: "investigation",
    title: "Investigation Details",
    fields: [
      { key: "interviewDetails.neighbours", label: "Neighbours", type: "textarea" },
      { key: "investigationDetails.dataCollectedFrom", label: "Data Collected From" },
      { key: "investigationDetails.investigatorName", label: "Investigator Name" },
      { key: "investigationDetails.investigatorDesignation", label: "Investigator Designation" },
    ],
  },
  {
    id: "meta",
    title: "Report Meta",
    fields: [
      { key: "reportDate", label: "Report Date", type: "date" },
      { key: "enclosures", label: "Documents Collected", type: "textarea" },
    ],
  },
];



/* ─── MERGE TEMPLATE-RESOLVED SECTIONS WITH THE FULL GENERIC LIST ────────
   resolved-fields returns a template-specific manifest which may only cover
   a subset of what the extraction agents actually populate. We never want
   a field that exists in the DB to become invisible just because the
   template manifest didn't mention it — so we keep every resolved section
   as-is (doctor should trust the template mapping first) and then append
   any FORM_SECTIONS fields whose keys aren't already covered by ANY
   resolved section, grouped into a trailing "Additional Fields" section. */
function mergeSections(resolvedSections, fallbackSections) {
  if (!resolvedSections || resolvedSections.length === 0) return fallbackSections;

  const coveredKeys = new Set();
  resolvedSections.forEach(sec => (sec.fields || []).forEach(f => coveredKeys.add(f.key)));

  const leftoverFields = [];
  fallbackSections.forEach(sec => {
    (sec.fields || []).forEach(f => {
      if (!coveredKeys.has(f.key)) {
        leftoverFields.push(f);
        coveredKeys.add(f.key); // avoid duplicate leftovers across sections
      }
    });
  });

  if (leftoverFields.length === 0) return resolvedSections;

  return [
    ...resolvedSections,
    { id: "additional_fields", title: "Additional Fields", fields: leftoverFields },
  ];
}

/* ─── HELPERS ────────────────────────────────────────────────────────── */
function getNestedValue(obj, dotKey) {
  if (!obj) return "";
  const parts = dotKey.split(".");
  let cur = obj;
  for (const p of parts) {
    if (cur == null) return "";
    cur = cur[p];
  }
  return cur ?? "";
}
/* ─── ARRAY-AWARE FIELD HELPERS ──────────────────────────────────────── */
// chiefComplaints (and similar array-of-strings fields) round-trip as
// newline-joined text in the UI but stay a real array in formData.
function arrayToDisplayText(val) {
  if (Array.isArray(val)) return val.join("\n");
  return val || "";
}
function displayTextToArray(text) {
  return text
    .split("\n")
    .map(s => s.trim())
    .filter(Boolean);
}
function setNestedValue(obj, dotKey, value) {
  const parts = dotKey.split(".");
  const clone = { ...obj };
  let cur = clone;
  for (let i = 0; i < parts.length - 1; i++) {
    if (typeof cur[parts[i]] !== "object" || cur[parts[i]] === null) {
      cur[parts[i]] = {};
    } else {
      cur[parts[i]] = { ...cur[parts[i]] };
    }
    cur = cur[parts[i]];
  }
  cur[parts[parts.length - 1]] = value;
  return clone;
}

/* ─── DOCUMENT LIST DEDUPE ────────────────────────────────────────────
   The auditing doctor should only ever see ONE copy of a given source
   file in the left panel — the page-selected ("sliced") copy they (or a
   colleague) already reviewed, never the original full PDF alongside it.

   Both copies can legitimately end up in case_documents.documents for the
   same file_name:
     - the ops-side ingest (/web/upload-document) pushes an entry pointing
       at the FULL original PDF, doc_id like "CDOC-XXXXXXXXXX"
     - the doctor's page-selection review (/web/advanced-upload →
       /web/advanced-upload/extract) pushes a second entry pointing at the
       SLICED subset PDF, doc_id always prefixed "CDOC-ADV-" — that prefix
       is only ever generated by the advanced-upload staging flow, so it's
       a reliable signal of "this is the reviewed/sliced copy", unlike the
       stored URL (which may get renamed by the storage backend) or
       extraction_mode (which isn't unique to this flow).

   We dedupe by file_name (falling back to display_label/doc_id if that's
   missing) and always keep the CDOC-ADV- entry when both exist. If there's
   no duplicate for a file, it's kept as-is regardless of which flow made it.
────────────────────────────────────────────────────────────────────── */
function dedupeDocsPreferSliced(docs) {
  if (!Array.isArray(docs) || docs.length === 0) return [];

  const isSlicedCopy = (d) => (d?.doc_id || "").startsWith("CDOC-ADV-");
  const keyOf = (d) => (d?.file_name || d?.display_label || d?.doc_id || "").trim().toLowerCase();

  const byKey = new Map();
  for (const d of docs) {
    const key = keyOf(d);
    if (!key) continue; // no identifying info — keep as unique, don't collapse
    const existing = byKey.get(key);
    if (!existing) {
      byKey.set(key, d);
      continue;
    }
    const dSliced = isSlicedCopy(d);
    const eSliced = isSlicedCopy(existing);
    if (dSliced && !eSliced) {
      byKey.set(key, d); // prefer the doctor-reviewed sliced copy
    } else if (dSliced === eSliced) {
      // Same kind (both full or both sliced) — keep the more recent upload
      const dTime = new Date(d?.uploaded_at || 0).getTime();
      const eTime = new Date(existing?.uploaded_at || 0).getTime();
      if (dTime >= eTime) byKey.set(key, d);
    }
    // else: existing is already the sliced copy — leave it in place
  }

  // Entries without a usable key were skipped above; keep them appended
  // as-is so nothing is silently dropped.
  const keyless = docs.filter(d => !keyOf(d));
  return [...byKey.values(), ...keyless];
}

/* ─── CONCLUSION PARSER ──────────────────────────────────────────────── */
/**
 * Parses the stored plain-text conclusion into per-trigger objects.
 * Format:
 *   ============================================================
 *   TRIGGER: CLAIM GENUINITY & AUTHENTICITY
 *   ============================================================
 *   SECTION 1 — HOSPITAL VISIT FINDINGS
 *   ...
 *   SECTION 2 — MEMBER / INSURED VISIT FINDINGS
 *   ...
 *   SECTION 3 — CONCLUSION
 *   ...
 *   ============================================================
 *   OVERALL CASE VERDICT
 *   ============================================================
 *   ...
 */
function parseConclusionToTriggers(rawConclusion) {
  if (!rawConclusion) return { triggers: [], overallVerdict: "" };

  // ── Old multi-trigger format (has ==== separators) ──────────────────
  if (rawConclusion.includes("====")) {
    const lines = rawConclusion.split("\n");
    const triggers = [];
    let overallVerdict = "";
    let i = 0;

    while (i < lines.length) {
      const line = lines[i].trim();
      if (line.startsWith("====")) {
        i++;
        const nextLine = (lines[i] || "").trim();
        if (nextLine.startsWith("TRIGGER:")) {
          const triggerLabel = nextLine.replace("TRIGGER:", "").trim();
          i++;
          if ((lines[i] || "").startsWith("====")) i++;
          const sections = { section1: "", section2: "", section3: "" };
          let currentSection = null;
          const sectionLines = [];
          while (i < lines.length && !(lines[i] || "").trim().startsWith("====")) {
            const sLine = lines[i].trim();
            if (/^SECTION\s+1\s*[—\-–]/i.test(sLine)) {
              if (currentSection) sections[currentSection] = sectionLines.join("\n").trim();
              currentSection = "section1"; sectionLines.length = 0;
            } else if (/^SECTION\s+2\s*[—\-–]/i.test(sLine)) {
              if (currentSection) sections[currentSection] = sectionLines.join("\n").trim();
              currentSection = "section2"; sectionLines.length = 0;
            } else if (/^SECTION\s+3\s*[—\-–]/i.test(sLine)) {
              if (currentSection) sections[currentSection] = sectionLines.join("\n").trim();
              currentSection = "section3"; sectionLines.length = 0;
            } else if (currentSection) {
              sectionLines.push(lines[i]);
            }
            i++;
          }
          if (currentSection) sections[currentSection] = sectionLines.join("\n").trim();
          triggers.push({ label: triggerLabel, sections });
        } else if (nextLine.startsWith("OVERALL CASE VERDICT")) {
          i++;
          if ((lines[i] || "").startsWith("====")) i++;
          const verdictLines = [];
          while (i < lines.length && !(lines[i] || "").trim().startsWith("====")) {
            verdictLines.push(lines[i]); i++;
          }
          overallVerdict = verdictLines.join("\n").trim();
        } else { i++; }
      } else { i++; }
    }
    return { triggers, overallVerdict };
  }

  // ── New unified format (SECTION 1 / 2 / 3 at top level) ─────────────
  const sections = { section1: "", section2: "", section3: "" };
  let currentSection = null;
  const sectionLines = [];

  for (const line of rawConclusion.split("\n")) {
    const trimmed = line.trim();
    if (/^SECTION\s+1\s*[—\-–]/i.test(trimmed)) {
      if (currentSection) sections[currentSection] = sectionLines.join("\n").trim();
      currentSection = "section1"; sectionLines.length = 0;
    } else if (/^SECTION\s+2\s*[—\-–]/i.test(trimmed)) {
      if (currentSection) sections[currentSection] = sectionLines.join("\n").trim();
      currentSection = "section2"; sectionLines.length = 0;
    } else if (/^SECTION\s+3\s*[—\-–]/i.test(trimmed)) {
      if (currentSection) sections[currentSection] = sectionLines.join("\n").trim();
      currentSection = "section3"; sectionLines.length = 0;
    } else if (currentSection) {
      sectionLines.push(line);
    }
  }
  if (currentSection) sections[currentSection] = sectionLines.join("\n").trim();

  // Detect overall verdict from section 3
  const overallVerdict = detectVerdict(sections.section3);

  // Wrap as a single trigger card labelled "Investigation Report"
  return {
    triggers: [{ label: "INVESTIGATION REPORT", sections }],
    overallVerdict,
  };
}

/**
 * Reassembles edited trigger data back into the plain-text format
 * that conclusion_formatter.py expects.
 */
function assembleConclusionFromTriggers(triggers, overallVerdict) {
  // Single unified report — write back clean format
  if (triggers.length === 1 && triggers[0].label === "INVESTIGATION REPORT") {
    const s = triggers[0].sections;
    const parts = [];
    if (s.section1?.trim()) {
      parts.push("SECTION 1 — HOSPITAL VISIT FINDINGS");
      parts.push(s.section1.trim());
    }
    if (s.section2?.trim()) {
      parts.push("\nSECTION 2 — MEMBER / INSURED VISIT FINDINGS");
      parts.push(s.section2.trim());
    }
    if (s.section3?.trim()) {
      parts.push("\nSECTION 3 — CONCLUSION");
      parts.push(s.section3.trim());
    }
    return parts.join("\n");
  }

  // Multi-trigger old format
  const sep = "============================================================";
  const parts = [];
  for (const t of triggers) {
    parts.push(sep);
    parts.push(`TRIGGER: ${t.label}`);
    parts.push(sep);
    parts.push("");
    if (t.sections.section1?.trim()) { parts.push("SECTION 1 — HOSPITAL VISIT FINDINGS"); parts.push(t.sections.section1.trim()); parts.push(""); }
    if (t.sections.section2?.trim()) { parts.push("SECTION 2 — MEMBER / INSURED VISIT FINDINGS"); parts.push(t.sections.section2.trim()); parts.push(""); }
    if (t.sections.section3?.trim()) { parts.push("SECTION 3 — CONCLUSION"); parts.push(t.sections.section3.trim()); parts.push(""); }
  }
  if (overallVerdict?.trim()) { parts.push(sep); parts.push("OVERALL CASE VERDICT"); parts.push(sep); parts.push(overallVerdict.trim()); }
  return parts.join("\n");
}


/* ─── DRAG HANDLE HOOK ───────────────────────────────────────────────── */
/* ─── DRAG HANDLE HOOK ───────────────────────────────────────────────── */
function useDrag(initial, min, max, direction = "horizontal", onDragStateChange) {
  const [size, setSize] = useState(initial);
  const dragging = useRef(false);
  const startPos = useRef(0);
  const startSize = useRef(initial);
  const getMax = useCallback(() => (typeof max === "function" ? max() : max), [max]);

  const onMouseDown = useCallback((e) => {
    e.preventDefault();
    dragging.current = true;
    startPos.current = direction === "horizontal" ? e.clientX : e.clientY;
    startSize.current = size;
    onDragStateChange?.(true);
  }, [size, direction, onDragStateChange]);

  useEffect(() => {
    const onMove = (e) => {
      if (!dragging.current) return;
      const delta = direction === "horizontal"
        ? e.clientX - startPos.current
        : e.clientY - startPos.current;
      const next = Math.min(Math.max(startSize.current + delta, min), getMax());
      setSize(next);
    };
    const onUp = () => {
      if (dragging.current) {
        dragging.current = false;
        onDragStateChange?.(false);
      }
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    // safety net: also end drag if the window loses focus mid-drag
    window.addEventListener("blur", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      window.removeEventListener("blur", onUp);
    };
  }, [direction, min, getMax, onDragStateChange]);

  // Re-clamp on window resize so the panel never exceeds the (possibly dynamic) max
  useEffect(() => {
    const onResize = () => {
      setSize(prev => Math.min(Math.max(prev, min), getMax()));
    };
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [min, getMax]);

  return { size, setSize, onMouseDown };
}

/* ─── DRAG HANDLE UI ─────────────────────────────────────────────────── */
function DragHandle({ onMouseDown, direction = "horizontal" }) {
  const [hovered, setHovered] = useState(false);
  const isH = direction === "horizontal";
  return (
    <div
      onMouseDown={onMouseDown}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        [isH ? "width" : "height"]: 5,
        [isH ? "height" : "width"]: "100%",
        cursor: isH ? "col-resize" : "row-resize",
        background: hovered ? T.borderMid : T.border,
        flexShrink: 0,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        transition: "background 0.15s",
        zIndex: 10,
      }}
    >
      <div style={{ display: "flex", flexDirection: isH ? "column" : "row", gap: 3 }}>
        {[0, 1, 2].map(i => (
          <div key={i} style={{
            width: 3, height: 3, borderRadius: "50%",
            background: hovered ? T.accent : T.borderMid,
            transition: "background 0.15s",
          }} />
        ))}
      </div>
    </div>
  );
}

/* ─── STATUS BADGE ───────────────────────────────────────────────────── */
function StatusBadge({ status }) {
  if (!status) return null;
  const map = {
    unsaved:    { color: T.warn,    label: "● Unsaved changes" },
    saving:     { color: T.textMuted, label: "↻ Saving…" },
    saved:      { color: T.success, label: "✓ Saved" },
    generating: { color: T.textMuted, label: "↻ Generating PDF…" },
    generated:  { color: T.success, label: "✓ PDF generated & stored" },
    error:      { color: T.danger,  label: "✕ Error — try again" },
  };
  const cfg = map[status] || {};
  return (
    <span style={{ fontSize: 10, color: cfg.color, letterSpacing: "0.06em", whiteSpace: "nowrap" }}>
      {cfg.label}
    </span>
  );
}

/* ─── FIELD ROW ──────────────────────────────────────────────────────── */
/* ─── FIELD ROW ──────────────────────────────────────────────────────── */
function FieldRow({ field, formData, onChange }) {
  const val = getNestedValue(formData, field.key);

  const inputStyle = {
    width: "100%", padding: "6px 9px",
    border: `1px solid ${T.border}`, borderRadius: 4,
    fontSize: 12, fontFamily: "inherit", color: T.text,
    background: T.bg, outline: "none", boxSizing: "border-box",
    resize: "vertical",
  };

  if (field.type === "table") {
    return <LineItemsEditor value={val} onChange={v => onChange(field.key, v)} />;
  }

  if (field.type === "yn") {
    return (
      <div style={{
        display: "grid", gridTemplateColumns: "1fr auto",
        alignItems: "center", gap: 10, padding: "5px 0",
        borderBottom: `1px solid ${T.bgTert}`,
      }}>
        <span style={{ fontSize: 11.5, color: T.textSec }}>{field.label}</span>
        <select
          value={val || "NA"}
          onChange={e => onChange(field.key, e.target.value)}
          style={{ ...inputStyle, width: 72, padding: "5px 6px" }}
        >
          {["NA", "Yes", "No", "N/A"].map(o => <option key={o}>{o}</option>)}
        </select>
      </div>
    );
  }

  if (field.type === "textarea-array") {
    return (
      <div style={{ marginBottom: 10 }}>
        <div style={{ fontSize: 10, textTransform: "uppercase", letterSpacing: "0.08em", color: T.textMuted, marginBottom: 3 }}>
          {field.label} <span style={{ textTransform: "none", letterSpacing: 0 }}>(one per line)</span>
        </div>
        <textarea
          rows={3}
          value={arrayToDisplayText(val)}
          onChange={e => onChange(field.key, displayTextToArray(e.target.value))}
          style={inputStyle}
        />
      </div>
    );
  }

  if (field.type === "textarea") {
    return (
      <div style={{ marginBottom: 10 }}>
        <div style={{ fontSize: 10, textTransform: "uppercase", letterSpacing: "0.08em", color: T.textMuted, marginBottom: 3 }}>
          {field.label}
        </div>
        <textarea rows={3} value={val || ""} onChange={e => onChange(field.key, e.target.value)} style={inputStyle} />
      </div>
    );
  }

  return (
    <div style={{ marginBottom: 8 }}>
      <div style={{ fontSize: 10, textTransform: "uppercase", letterSpacing: "0.08em", color: T.textMuted, marginBottom: 3 }}>
        {field.label}
      </div>
      <input
        type={field.type === "date" ? "date" : "text"}
        value={val || ""}
        onChange={e => onChange(field.key, e.target.value)}
        style={inputStyle}
        onFocus={e => e.target.style.borderColor = T.accent}
        onBlur={e => e.target.style.borderColor = T.border}
      />
    </div>
  );
}

/* ─── SECTION PANEL ──────────────────────────────────────────────────── */
function SectionPanel({ section, formData, onChange, expanded, onToggle }) {
  return (
    <div style={{ border: `1px solid ${T.border}`, borderRadius: 6, overflow: "hidden", marginBottom: 8 }}>
      <button
        type="button"
        onClick={onToggle}
        style={{
          width: "100%", display: "flex", justifyContent: "space-between",
          alignItems: "center", padding: "9px 14px",
          background: expanded ? T.accent : T.bgAlt,
          border: "none", cursor: "pointer", fontFamily: "inherit",
        }}
      >
        <span style={{ fontSize: 11, fontWeight: 500, color: expanded ? "#fff" : T.text, textTransform: "uppercase", letterSpacing: "0.1em" }}>
          {section.title}
        </span>
        <span style={{ fontSize: 13, color: expanded ? "#fff" : T.textMuted }}>{expanded ? "▲" : "▼"}</span>
      </button>
      {expanded && (
        <div style={{ padding: "12px 14px" }}>
          {section.fields.map(f => (
            <FieldRow key={f.key} field={f} formData={formData} onChange={onChange} />
          ))}
        </div>
      )}
    </div>
  );
}

/* ─── TRIGGER SECTION COLORS ─────────────────────────────────────────── */
const SECTION_COLORS = {
  section1: { bar: "#1a5276", bg: "#d6eaf8", label: "Section 1 — Hospital Visit Findings" },
  section2: { bar: "#1e8449", bg: "#d5f5e3", label: "Section 2 — Member / Insured Visit Findings" },
  section3: { bar: "#6c3483", bg: "#e8daef", label: "Section 3 — Conclusion" },
};

/* ─── VERDICT DETECTOR (mirrors Python logic, fixed) ─────────────────── */
function detectVerdict(text) {
  if (!text) return "";
  // Check whole text, not just tail — fixes the formatter bug
  const lower = text.toLowerCase();
  // Look for explicit verdict statements
  if (/hence based on.*suspected/i.test(text)) return "SUSPECTED";
  if (/claim seems to be suspected/i.test(text)) return "SUSPECTED";
  if (/claim found to be suspected/i.test(text)) return "SUSPECTED";
  if (/hence based on.*genuine/i.test(text)) return "GENUINE";
  if (/claim seems to be genuine/i.test(text)) return "GENUINE";
  if (/claim found to be genuine/i.test(text)) return "GENUINE";
  // fallback: last occurrence wins
  const lastSuspected = lower.lastIndexOf("suspected");
  const lastGenuine = lower.lastIndexOf("genuine");
  if (lastSuspected === -1 && lastGenuine === -1) return "";
  return lastSuspected > lastGenuine ? "SUSPECTED" : "GENUINE";
}
function applyAutoBulletOnPeriod(oldValue, newValue) {
  // Only trigger when exactly one char was typed and it's a period
  if (newValue.length === oldValue.length + 1 && newValue.endsWith(".") ) {
    // avoid breaking on decimals like "1.5" — only break if char before "." isn't a digit
    const charBeforeDot = newValue[newValue.length - 2];
    if (charBeforeDot && /\d/.test(charBeforeDot)) return newValue;
    return newValue + "\n• ";
  }
  return newValue;
}
function splitIntoSentenceLines(text) {
  if (!text) return text;
  return text.split("\n").map(line => {
    const trimmed = line.trim();
    if (!trimmed) return line;
    return trimmed
      .split(/(?<=[.!?])\s+(?=[A-Z(])/g)
      .map(s => s.trim())
      .filter(Boolean)
      .join("\n");
  }).join("\n");
}
/* ─── TRIGGER CONCLUSION EDITOR ──────────────────────────────────────── */
function TriggerConclusionEditor({ triggerData, index, bulletMode, onChange, onRemove, canRemove }) {
  const [expandedSections, setExpandedSections] = useState({
    section1: true, section2: true, section3: true,
  });

  const toggleSection = (s) =>
    setExpandedSections(prev => ({ ...prev, [s]: !prev[s] }));

  const updateSection = (sectionKey, value) => {
    const oldValue = triggerData.sections[sectionKey] || "";
    const finalValue = bulletMode ? applyAutoBulletOnPeriod(oldValue, value) : value;
    onChange(index, {
      ...triggerData,
      sections: { ...triggerData.sections, [sectionKey]: finalValue },
    });
  };

  const updateLabel = (label) => {
    onChange(index, { ...triggerData, label });
  };

  // Detect verdict in section3 for visual indicator
  const verdict = detectVerdict(triggerData.sections.section3 || "");

  return (
    <div style={{
      border: `1.5px solid ${T.border}`,
      borderRadius: 8,
      overflow: "hidden",
      marginBottom: 12,
      boxShadow: "0 1px 4px rgba(0,0,0,0.06)",
    }}>
      {/* Trigger header */}
      <div style={{
        background: T.accent,
        padding: "10px 14px",
        display: "flex",
        alignItems: "center",
        gap: 10,
      }}>
        <div style={{
          width: 22, height: 22, borderRadius: "50%",
          background: "rgba(255,255,255,0.15)",
          display: "flex", alignItems: "center", justifyContent: "center",
          fontSize: 10, color: "#fff", fontWeight: 600, flexShrink: 0,
        }}>
          {index + 1}
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <input
            value={triggerData.label}
            onChange={e => updateLabel(e.target.value)}
            style={{
              background: "transparent", border: "none", outline: "none",
              color: "#fff", fontSize: 12, fontWeight: 500,
              fontFamily: "inherit", width: "100%",
              textTransform: "uppercase", letterSpacing: "0.08em",
            }}
            placeholder="TRIGGER LABEL"
          />
        </div>
        {verdict && (
          <span style={{
            fontSize: 9, padding: "2px 8px",
            background: verdict === "SUSPECTED" ? "#fdecea" : "#e8f5e9",
            color: verdict === "SUSPECTED" ? "#c0392b" : "#27ae60",
            borderRadius: 10, fontWeight: 600, letterSpacing: "0.08em",
            flexShrink: 0,
          }}>
            {verdict}
          </span>
        )}
        {canRemove && (
          <button
            onClick={() => onRemove(index)}
            style={{
              background: "rgba(255,255,255,0.1)", border: "none",
              color: "rgba(255,255,255,0.7)", cursor: "pointer",
              width: 22, height: 22, borderRadius: 4,
              display: "flex", alignItems: "center", justifyContent: "center",
              fontSize: 14, flexShrink: 0,
            }}
            title="Remove trigger"
          >
            ✕
          </button>
        )}
      </div>

      {/* Sections */}
      <div style={{ background: T.bg }}>
        {Object.entries(SECTION_COLORS).map(([sKey, cfg]) => (
          <div key={sKey} style={{ borderBottom: `1px solid ${T.border}` }}>
            <button
              type="button"
              onClick={() => toggleSection(sKey)}
              style={{
                width: "100%", display: "flex", alignItems: "center", gap: 8,
                padding: "8px 14px", border: "none", cursor: "pointer",
                fontFamily: "inherit", background: expandedSections[sKey] ? cfg.bg : T.bgAlt,
                transition: "background 0.15s",
              }}
            >
              <span style={{
                width: 3, height: 14, borderRadius: 2,
                background: cfg.bar, flexShrink: 0,
              }} />
              <span style={{ fontSize: 10, fontWeight: 500, color: cfg.bar, textTransform: "uppercase", letterSpacing: "0.1em", flex: 1, textAlign: "left" }}>
                {cfg.label}
              </span>
              <span style={{ fontSize: 12, color: T.textMuted }}>
                {expandedSections[sKey] ? "▲" : "▼"}
              </span>
            </button>
            {expandedSections[sKey] && (
              <div style={{ padding: "10px 14px", background: T.bg }}>
                {sKey === "section3" && (
                  <div style={{
                    fontSize: 10, color: T.textMuted, marginBottom: 6, lineHeight: 1.5,
                    padding: "5px 8px", background: T.bgTert, borderRadius: 4,
                    borderLeft: `3px solid ${T.borderMid}`,
                  }}>
                    Include DISCREPANCIES block, verdict line ("Hence based on..."), and any trigger-specific findings.
                    The verdict word (SUSPECTED/GENUINE) must appear in the final sentence.
                  </div>
                )}
                <textarea
                  rows={sKey === "section1" ? 8 : sKey === "section2" ? 5 : 6}
                  value={triggerData.sections[sKey] || ""}
                  onChange={e => updateSection(sKey, e.target.value)}
                  spellCheck={false}
                  style={{
                    width: "100%", padding: "8px 10px",
                    border: `1px solid ${T.border}`, borderRadius: 4,
                    fontSize: 11.5, fontFamily: "'IBM Plex Mono', monospace",
                    color: T.textSec, background: T.bg,
                    outline: "none", resize: "vertical",
                    lineHeight: 1.7, boxSizing: "border-box",
                  }}
                  onFocus={e => e.target.style.borderColor = cfg.bar}
                  onBlur={e => e.target.style.borderColor = T.border}
                />
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

/* ─── OVERALL VERDICT EDITOR ─────────────────────────────────────────── */
/* ─── BILLING LINE ITEMS EDITOR ──────────────────────────────────────── */
function LineItemsEditor({ value, onChange }) {
  // value is expected to be an array of {item, amount}. Be defensive about
  // legacy/malformed data (string, null, objects missing keys).
  const rows = Array.isArray(value)
    ? value.map(r => ({
        item: (r && r.item) ?? "",
        amount: (r && r.amount !== undefined && r.amount !== null) ? r.amount : "",
      }))
    : [];

  const updateRow = (idx, field, val) => {
    const next = rows.map((r, i) =>
      i === idx ? { ...r, [field]: field === "amount" ? val : val } : r
    );
    onChange(next);
  };

  const addRow = () => onChange([...rows, { item: "", amount: "" }]);

  const removeRow = (idx) => onChange(rows.filter((_, i) => i !== idx));

  const total = rows.reduce((sum, r) => {
    const n = parseFloat(r.amount);
    return sum + (isNaN(n) ? 0 : n);
  }, 0);

  const cellInputStyle = {
    width: "100%", padding: "5px 7px",
    border: `1px solid ${T.border}`, borderRadius: 4,
    fontSize: 11.5, fontFamily: "inherit", color: T.text,
    background: T.bg, outline: "none", boxSizing: "border-box",
  };

  return (
    <div style={{ marginBottom: 10 }}>
      <div style={{ fontSize: 10, textTransform: "uppercase", letterSpacing: "0.08em", color: T.textMuted, marginBottom: 6 }}>
        Bill Line Items
      </div>
      <div style={{ border: `1px solid ${T.border}`, borderRadius: 6, overflow: "hidden" }}>
        <div style={{
          display: "grid", gridTemplateColumns: "1fr 130px 34px",
          background: T.bgAlt, borderBottom: `1px solid ${T.border}`,
          fontSize: 10, color: T.textMuted, textTransform: "uppercase", letterSpacing: "0.06em",
        }}>
          <div style={{ padding: "6px 8px" }}>Item</div>
          <div style={{ padding: "6px 8px" }}>Amount</div>
          <div />
        </div>

        {rows.length === 0 && (
          <div style={{ padding: "14px 8px", fontSize: 11, color: T.textMuted, textAlign: "center" }}>
            No line items yet.
          </div>
        )}

        {rows.map((row, idx) => (
          <div
            key={idx}
            style={{
              display: "grid", gridTemplateColumns: "1fr 130px 34px",
              borderBottom: idx === rows.length - 1 ? "none" : `1px solid ${T.bgTert}`,
              alignItems: "center",
            }}
          >
            <div style={{ padding: "5px 8px" }}>
              <input
                value={row.item}
                placeholder="Item name"
                onChange={e => updateRow(idx, "item", e.target.value)}
                style={cellInputStyle}
              />
            </div>
            <div style={{ padding: "5px 8px" }}>
              <input
                value={row.amount}
                placeholder="0"
                inputMode="decimal"
                onChange={e => updateRow(idx, "amount", e.target.value)}
                style={{ ...cellInputStyle, textAlign: "right" }}
              />
            </div>
            <button
              onClick={() => removeRow(idx)}
              title="Remove row"
              style={{
                background: "none", border: "none", cursor: "pointer",
                color: T.textMuted, fontSize: 13, padding: "5px 8px",
                display: "flex", alignItems: "center", justifyContent: "center",
              }}
            >
              ✕
            </button>
          </div>
        ))}

        <div style={{
          display: "flex", alignItems: "center", justifyContent: "space-between",
          padding: "8px 10px", background: T.bgTert, borderTop: `1px solid ${T.border}`,
        }}>
          <button
            onClick={addRow}
            style={{
              padding: "5px 12px", border: `1px solid ${T.border}`,
              background: T.bg, color: T.textSec, fontFamily: "inherit",
              fontSize: 11, cursor: "pointer", borderRadius: 4,
            }}
          >
            + Add row
          </button>
          <div style={{ fontSize: 11.5, color: T.textSec }}>
            Total:&nbsp;
            <strong style={{ color: T.text }}>
              {total.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            </strong>
          </div>
        </div>
      </div>
    </div>
  );
}

function OverallVerdictEditor({ value, bulletMode, onChange }) {
const verdict = detectVerdict(value);
  const handleChange = (newValue) => {
    const finalValue = bulletMode ? applyAutoBulletOnPeriod(value || "", newValue) : newValue;
    onChange(finalValue);
  };  return (
    <div style={{
      border: `1.5px solid ${verdict === "SUSPECTED" ? "#c0392b" : verdict === "GENUINE" ? "#27ae60" : T.border}`,
      borderRadius: 8, overflow: "hidden", marginBottom: 8,
    }}>
      <div style={{
        padding: "9px 14px",
        background: verdict === "SUSPECTED" ? "#fdecea" : verdict === "GENUINE" ? "#e8f5e9" : T.bgAlt,
        display: "flex", alignItems: "center", justifyContent: "space-between",
      }}>
        <span style={{
          fontSize: 11, fontWeight: 500,
          color: verdict === "SUSPECTED" ? "#c0392b" : verdict === "GENUINE" ? "#27ae60" : T.text,
          textTransform: "uppercase", letterSpacing: "0.1em",
        }}>
          Overall Case Verdict
        </span>
        {verdict && (
          <span style={{
            fontSize: 10, fontWeight: 700,
            color: verdict === "SUSPECTED" ? "#c0392b" : "#27ae60",
            letterSpacing: "0.1em",
          }}>
            {verdict}
          </span>
        )}
      </div>
      <div style={{ padding: "10px 14px", background: T.bg }}>
        <div style={{
          fontSize: 10, color: T.textMuted, marginBottom: 6,
          padding: "5px 8px", background: T.bgTert, borderRadius: 4,
          borderLeft: `3px solid ${T.borderMid}`,
        }}>
          This is the final summary line(s) that appear after all triggers.
          Must contain SUSPECTED or GENUINE to be detected correctly.
        </div>
        <textarea
          rows={4}
          value={value || ""}
          onChange={e => onChange(e.target.value)}
          spellCheck={false}
          style={{
            width: "100%", padding: "8px 10px",
            border: `1px solid ${T.border}`, borderRadius: 4,
            fontSize: 11.5, fontFamily: "'IBM Plex Mono', monospace",
            color: T.textSec, background: T.bg,
            outline: "none", resize: "vertical",
            lineHeight: 1.7, boxSizing: "border-box",
          }}
          onFocus={e => { e.target.style.borderColor = T.accent; }}
          onBlur={e => { e.target.style.borderColor = T.border; }}
        />
      </div>
    </div>
  );
}

/* ─── DOC ITEM ───────────────────────────────────────────────────────── */
function DocItem({ doc, selected, onClick }) {
  return (
    <div
      onClick={onClick}
      style={{
        padding: "9px 12px", cursor: "pointer",
        borderBottom: `1px solid ${T.border}`,
        background: selected ? T.accentLight : T.bg,
        borderLeft: selected ? `3px solid ${T.accent}` : "3px solid transparent",
        transition: "background 0.1s",
      }}
      onMouseEnter={e => { if (!selected) e.currentTarget.style.background = T.bgAlt; }}
      onMouseLeave={e => { if (!selected) e.currentTarget.style.background = T.bg; }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={T.textMuted} strokeWidth="1.5">
          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
          <polyline points="14 2 14 8 20 8"/>
        </svg>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 12, color: T.text, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {doc.file_name || doc.display_label || "Document"}
          </div>
          <div style={{ fontSize: 10, color: T.textMuted, marginTop: 1 }}>{doc.display_label}</div>
        </div>
      </div>
    </div>
  );
}

/* ════════════════════════════════════════════════════════════════════════
   MAIN PAGE
═════════════════════════════════════════════════════════════════════════ */
function PDFEditorInner({ caseId, navigate, doctorId }) {
  const annotationCtx = React.useContext(AnnotationContext); // ✅ now inside Provider

  /* ── data ── */
  const [caseData, setCaseData]           = useState(null);
  const [formData, setFormData]           = useState({});
  const [resolvedSections, setResolvedSections] = useState(null); // null = not loaded / no manifest yet
  const [resolvedTemplate, setResolvedTemplate] = useState(null);


  const [loadingCase, setLoadingCase]     = useState(true);
  const [isDragging, setIsDragging]       = useState(false);
  const [docs, setDocs]                   = useState([]);
  const [selectedDoc, setSelectedDoc]     = useState(null);

  /* ── conclusion state ── */
  const [triggerSections, setTriggerSections] = useState([]); // [{label, sections:{section1,section2,section3}}]
  const [overallVerdict, setOverallVerdict]   = useState("");
    const [bulletMode, setBulletMode]           = useState(false);

const [status, setStatus]         = useState(null);
const [generating, setGenerating] = useState(false);
const [saving, setSaving]         = useState(false);

  /* ── panel state ── */
  const [leftTab, setLeftTab]         = useState("docs");
  const [activeRightTab, setActiveRightTab] = useState("fields"); // "fields" | "conclusion"
  const [pdfViewUrl, setPdfViewUrl]   = useState(null);
  const [genPdfUrl, setGenPdfUrl]     = useState(null);
  const [storedPdfUrl, setStoredPdfUrl] = useState(null);
  const [genDocxUrl, setGenDocxUrl]     = useState(null);
const [storedDocxUrl, setStoredDocxUrl] = useState(null);
const [generatingDocx, setGeneratingDocx] = useState(false);
const [storedFormattedDocxUrl, setStoredFormattedDocxUrl] = useState(null);
const [generatingFormattedDocx, setGeneratingFormattedDocx] = useState(false);
  const [showGenPdf, setShowGenPdf]   = useState(false);


/* ── expanded sections ── */
const [expandedSections, setExpandedSections] = useState(
  () => Object.fromEntries(FORM_SECTIONS.map(s => [s.id, true]))
);

const effectiveSections = React.useMemo(
  () => mergeSections(resolvedSections, FORM_SECTIONS),
  [resolvedSections]
);

useEffect(() => {
  setExpandedSections(prev => ({
    ...Object.fromEntries(effectiveSections.map(s => [s.id, true])),
    ...prev,
  }));
}, [effectiveSections]);

  /* ── resizable panels ── */
  /* ── resizable panels ── */
  /* ── resizable panels ── */
  const leftDrag   = useDrag(300, 200, () => window.innerWidth / 2, "horizontal", setIsDragging);
  const bottomDrag = useDrag(380, 160, 700, "vertical", setIsDragging);
    const safeFileBase = useCallback(() => {
    const raw = (caseData?.insurerRef || caseId || "case").toString().trim();
    const safe = raw.replace(/[^A-Za-z0-9_-]+/g, "_").replace(/^_+|_+$/g, "");
    return safe || "case";
  }, [caseData, caseId]);


  /* ── load case ── */
  useEffect(() => {
    if (!caseId) return;
    setLoadingCase(true);
    fetch(`${BASE_URL}insurance/web/doctor/case/${caseId}`, {
      headers: { "X-User-Id": doctorId, "X-User-Role": "auditing-doctor-new" },
    })
      .then(r => r.json())
      .then(d => {
        const c = d.case || {};
        setCaseData(c);
        setFormData(c);
        fetch(`${BASE_URL}insurance/web/doctor/case/${caseId}/resolved-fields`, {
          headers: { "X-User-Id": doctorId, "X-User-Role": "auditing-doctor-new" },
        })
          .then(r => r.json())
          .then(d => {
            setResolvedSections(d.sections || null);
            setResolvedTemplate(d.template || null);
          })
          .catch(() => { setResolvedSections(null); setResolvedTemplate(null); });


        // Parse conclusion into per-trigger editors
        const { triggers, overallVerdict: ov } = parseConclusionToTriggers(c.conclusion || "");

        setTriggerSections(triggers);
        setOverallVerdict(ov);

        // Dedupe so the doctor only ever sees the page-selected (sliced)
        // copy of a document, never both it and the original full PDF —
        // see dedupeDocsPreferSliced() for why both can exist.
        const caseDocs = dedupeDocsPreferSliced(c.case_documents?.documents || []);
        setDocs(caseDocs);
        if (caseDocs.length > 0) setSelectedDoc(caseDocs[0]);

        if (c.generated_pdf_url) {
          setStoredPdfUrl(c.generated_pdf_url);
          setGenPdfUrl(c.generated_pdf_url);
          setShowGenPdf(true);
        }
      })
      .catch(console.error)
      .finally(() => setLoadingCase(false));
  }, [caseId, doctorId]);
const handleGenerateDOCX = async () => {
  setGeneratingDocx(true);
  setStatus("generating");
  try {
    const conclusion = buildConclusion();
    const payload = { ...formData, conclusion };
    const res = await fetch(
      `${BASE_URL}insurance/web/doctor/case/${caseId}/generate-edited-docx`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-User-Id": doctorId,
          "X-User-Role": "auditing-doctor-new",
        },
        body: JSON.stringify({ case_data: payload }),
      }
    );
    if (!res.ok) throw new Error("DOCX generation failed");
 
    const headerUrl = res.headers.get("X-Generated-DOCX-URL");
    if (headerUrl) setStoredDocxUrl(headerUrl);
 
    const blob = await res.blob();
    const blobUrl = URL.createObjectURL(blob);
    setGenDocxUrl(blobUrl);
 
    // Trigger the download directly — unlike the PDF, there's no inline
    // preview pane for docx, so we just hand the file to the browser.
    const a = document.createElement("a");
    a.href = blobUrl;
    a.download = `${safeFileBase()}_edited.docx`;
    document.body.appendChild(a);
    a.click();
    a.remove();
 
    setStatus("generated");
    setTimeout(() => setStatus(null), 4000);
  } catch (err) {
    console.error(err);
    setStatus("error");
    setTimeout(() => setStatus(null), 4000);
  } finally {
    setGeneratingDocx(false);
  }
};
/* ── generate FORMATTED docx (mirrors the PDF template, editable) ── */
const handleGenerateFormattedDOCX = async () => {
  setGeneratingFormattedDocx(true);
  setStatus("generating");
  try {
    const conclusion = buildConclusion();
    const payload = { ...formData, conclusion };
    const res = await fetch(
      `${BASE_URL}insurance/web/doctor/case/${caseId}/generate-formatted-docx`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-User-Id": doctorId,
          "X-User-Role": "auditing-doctor-new",
        },
        body: JSON.stringify({ case_data: payload }),
      }
    );
    if (!res.ok) throw new Error("Formatted DOCX generation failed");

    const headerUrl = res.headers.get("X-Generated-FORMATTED-DOCX-URL");
    if (headerUrl) setStoredFormattedDocxUrl(headerUrl);

    const blob = await res.blob();
    const blobUrl = URL.createObjectURL(blob);

    const a = document.createElement("a");
    a.href = blobUrl;
    a.download = `${safeFileBase()}_formatted.docx`;
    document.body.appendChild(a);
    a.click();
    a.remove();

    setStatus("generated");
    setTimeout(() => setStatus(null), 4000);
  } catch (err) {
    console.error(err);
    setStatus("error");
    setTimeout(() => setStatus(null), 4000);
  } finally {
    setGeneratingFormattedDocx(false);
  }
};
  /* ── build assembled conclusion ── */
  const buildConclusion = useCallback(() => {
    return assembleConclusionFromTriggers(triggerSections, overallVerdict);
  }, [triggerSections, overallVerdict]);

  /* ── field change ── */
  const handleFieldChange = useCallback((dotKey, value) => {
    setFormData(prev => setNestedValue(prev, dotKey, value));
    setStatus("unsaved");
  }, []);

  const handleSectionToggle = (id) =>
    setExpandedSections(prev => ({ ...prev, [id]: !prev[id] }));
  const handleOpenSource = useCallback((fileName, pageNumber) => {
  if (!fileName) return;
  const norm = (s) => (s || "").trim().toLowerCase();
  const match = docs.find(d => norm(d.file_name) === norm(fileName))
    || docs.find(d => norm(d.file_name).includes(norm(fileName)) || norm(fileName).includes(norm(d.file_name)));

  if (!match?.pdf_url) {
    console.warn("No matching PDF found for", fileName);
    return;
  }

  setSelectedDoc(match);
  setPdfViewUrl(pageNumber ? `${match.pdf_url}#page=${pageNumber}` : match.pdf_url);
  setLeftTab("pdf");
}, [docs]);
  const handleSelectDoc = (doc) => {
    setSelectedDoc(doc);
    if (doc?.pdf_url) {
      setPdfViewUrl(doc.pdf_url);
      setLeftTab("pdf");
    }
  };

  /* ── trigger editors ── */
  const handleTriggerChange = useCallback((index, updated) => {
    setTriggerSections(prev => {
      const next = [...prev];
      next[index] = updated;
      return next;
    });
    setStatus("unsaved");
  }, []);

 const handleTriggerRemove = useCallback((index) => {
  setTriggerSections(prev => prev.filter((_, i) => i !== index));
  setStatus("unsaved");
}, []);

const handleTriggerAdd = useCallback(() => {
  setTriggerSections(prev => [
    ...prev,
    { label: "NEW TRIGGER", sections: { section1: "", section2: "", section3: "" } },
  ]);
  setStatus("unsaved");
}, []);
const toggleBulletMode = useCallback(() => {
  const turningOn = !bulletMode;

  const transformText = (text) => {
    if (!text) return text;

    if (turningOn) {
      // Paragraph → bullets: split each existing line into sentences, prefix each with •
      return text.split("\n").map(line => {
        const trimmed = line.trim();
        if (!trimmed) return line;
        if (/^[•\-\*]\s+/.test(trimmed)) return line; // already bulleted

        const sentences = trimmed
          .split(/(?<=[.!?])\s+(?=[A-Z(])/g)
          .map(s => s.trim())
          .filter(Boolean);

        return sentences.map(s => `• ${s}`).join("\n");
      }).join("\n");
    }

    // Bullets → paragraph: strip markers, merge consecutive bullet lines into one paragraph,
    // keep blank-line-separated blocks as separate paragraphs.
    const lines = text.split("\n");
    const out = [];
    let buffer = [];
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) {
        if (buffer.length) { out.push(buffer.join(" ")); buffer = []; }
        out.push("");
        continue;
      }
      buffer.push(trimmed.replace(/^[•\-\*]\s+/, ""));
    }
    if (buffer.length) out.push(buffer.join(" "));
    return out.join("\n");
  };

  setTriggerSections(prev => prev.map(t => ({
    ...t,
    sections: {
      section1: transformText(t.sections.section1),
      section2: transformText(t.sections.section2),
      section3: transformText(t.sections.section3),
    },
  })));
  setOverallVerdict(prev => transformText(prev));
  setBulletMode(turningOn);
  setStatus("unsaved");
}, [bulletMode]);


  /* ── save fields only ── */
  const handleSaveFields = async () => {
    setSaving(true);
    setStatus("saving");
    try {
      const conclusion = buildConclusion();
      const payload = { ...formData, conclusion };
      const res = await fetch(
        `${BASE_URL}insurance/web/doctor/case/${caseId}/save-fields`,
        {
          method: "PATCH",
          headers: {
            "Content-Type": "application/json",
            "X-User-Id": doctorId,
            "X-User-Role": "auditing-doctor-new",
          },
          body: JSON.stringify(payload),
        }
      );
      if (!res.ok) throw new Error("Save failed");
      setStatus("saved");
      setTimeout(() => setStatus(null), 3000);
    } catch {
      setStatus("error");
      setTimeout(() => setStatus(null), 4000);
    } finally {
      setSaving(false);
    }
  };

  /* ── generate PDF ── */
  const handleGeneratePDF = async () => {
    setGenerating(true);
    setStatus("generating");
    try {
      const conclusion = buildConclusion();
      const payload = { ...formData, conclusion };
      const res = await fetch(
        `${BASE_URL}insurance/web/doctor/case/${caseId}/generate-edited-pdf`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-User-Id": doctorId,
            "X-User-Role": "auditing-doctor-new",
          },
          body: JSON.stringify({ case_data: payload }),
        }
      );
      if (!res.ok) throw new Error("PDF generation failed");

      const headerUrl = res.headers.get("X-Generated-PDF-URL");
      if (headerUrl) setStoredPdfUrl(headerUrl);

      const blob = await res.blob();
      const blobUrl = URL.createObjectURL(blob);
      setGenPdfUrl(blobUrl);
      setShowGenPdf(true);
      setStatus("generated");
      setTimeout(() => setStatus(null), 4000);
    } catch (err) {
      console.error(err);
      setStatus("error");
      setTimeout(() => setStatus(null), 4000);
    } finally {
      setGenerating(false);
    }
  };

  /* ── download ── */
  const handleDownload = () => {
    const url = genPdfUrl || storedPdfUrl;
    if (!url) return;
    const a = document.createElement("a");
    a.href = url;
    a.download = `${safeFileBase()}_edited.pdf`;
    document.body.appendChild(a);
    a.click();
    a.remove();
  };

  /* ─────────────────────────────────────────────────────────────────── */
  if (loadingCase) {
    return (
      <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", background: T.bgTert }}>
        <div style={{ textAlign: "center" }}>
          <div style={{ width: 28, height: 28, border: `2px solid ${T.border}`, borderTopColor: T.text, borderRadius: "50%", animation: "spin 0.7s linear infinite", margin: "0 auto 12px" }} />
          <div style={{ fontSize: 12, color: T.textMuted, letterSpacing: "0.1em" }}>LOADING CASE…</div>
        </div>
        <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
      </div>
    );
  }

  const TOP_H = 52;

  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=IBM+Plex+Sans:wght@300;400;500&family=IBM+Plex+Mono:wght@400&display=swap');
        *, *::before, *::after { box-sizing: border-box; }
        body { margin: 0; font-family: 'IBM Plex Sans', sans-serif; font-weight: 300; background: ${T.bgTert}; color: ${T.text}; -webkit-font-smoothing: antialiased; }
        ::selection { background: #000; color: #fff; }
        ::-webkit-scrollbar { width: 4px; height: 4px; }
        ::-webkit-scrollbar-track { background: transparent; }
        ::-webkit-scrollbar-thumb { background: ${T.border}; border-radius: 2px; }
        input, textarea, select { font-family: 'IBM Plex Sans', sans-serif; }
        @keyframes spin { to { transform: rotate(360deg); } }
        @keyframes fadeIn { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: translateY(0); } }
      `}</style>

      {/* ════ TOP BAR ════ */}
      <div style={{
        height: TOP_H, background: T.bg, borderBottom: `1px solid ${T.border}`,
        display: "flex", alignItems: "center", padding: "0 16px",
        position: "sticky", top: 0, zIndex: 200,
        justifyContent: "space-between", gap: 12,
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12, minWidth: 0 }}>
          <button
            onClick={() => navigate(-1)}
            style={{ background: "none", border: "none", cursor: "pointer", color: T.textMuted, display: "flex", alignItems: "center", gap: 5, fontSize: 12, fontFamily: "inherit", padding: 0, whiteSpace: "nowrap" }}
          >
            ← Back
          </button>
          <div style={{ width: 1, height: 20, background: T.border, flexShrink: 0 }} />
          <div style={{ minWidth: 0 }}>
  <div style={{ fontSize: 13, fontWeight: 500, color: T.text }}>PDF Report Editor</div>
  <div style={{ fontSize: 10, color: T.textMuted, fontFamily: "'IBM Plex Mono', monospace", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
    {caseData?.insurerRef || "—"}
    {caseData?.claimantName && <span style={{ marginLeft: 8, color: T.textSec, fontFamily: "'IBM Plex Sans', sans-serif" }}>· {caseData.claimantName}</span>}
  </div>
</div>
          {caseData?.insurer && (
            <>
              <div style={{ width: 1, height: 20, background: T.border, flexShrink: 0 }} />
              <span style={{ fontSize: 10, background: T.text, color: "#fff", padding: "3px 10px", letterSpacing: "0.08em", textTransform: "uppercase", whiteSpace: "nowrap" }}>
                {caseData.insurer}
              </span>
            </>
          )}
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 8, flexShrink: 0 }}>
  {(genPdfUrl || storedPdfUrl) && (
    <button
      onClick={handleDownload}
      style={{
        display: "flex", alignItems: "center", gap: 6,
        padding: "7px 14px", border: `1px solid ${T.border}`,
        background: T.bg, color: T.textSec,
        fontFamily: "inherit", fontSize: 12,
        cursor: "pointer", borderRadius: 5,
      }}
    >
      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
        <polyline points="7 10 12 15 17 10"/>
        <line x1="12" y1="15" x2="12" y2="3"/>
      </svg>
      Download
    </button>
  )}
</div>
      </div>

      {/* ════ MAIN LAYOUT ════ */}
      <div style={{
        display: "flex",
        height: `calc(100vh - ${TOP_H}px)`,
        overflow: "hidden",
        userSelect: "none",
      }}>

        {/* ── LEFT PANEL ── */}
        <div style={{
          width: leftDrag.size, minWidth: 200,
          flexShrink: 0, borderRight: `1px solid ${T.border}`,
          background: T.bg, display: "flex", flexDirection: "column", overflow: "hidden",
        }}>
          <div style={{ display: "flex", borderBottom: `1px solid ${T.border}`, flexShrink: 0 }}>
            {[
              { id: "docs", label: "Documents" },
              { id: "pdf",  label: "PDF Viewer" },
            ].map(t => (
              <button
                key={t.id}
                onClick={() => setLeftTab(t.id)}
                style={{
                  flex: 1, padding: "10px 0", border: "none", cursor: "pointer",
                  fontFamily: "inherit", fontSize: 11, letterSpacing: "0.08em",
                  textTransform: "uppercase", fontWeight: leftTab === t.id ? 500 : 300,
                  color: leftTab === t.id ? T.text : T.textMuted,
                  background: leftTab === t.id ? T.bg : T.bgAlt,
                  borderBottom: leftTab === t.id ? `2px solid ${T.text}` : "2px solid transparent",
                }}
              >
                {t.label}
                {t.id === "docs" && docs.length > 0 && (
                  <span style={{ marginLeft: 5, fontSize: 9, background: T.bgTert, color: T.textMuted, borderRadius: 10, padding: "1px 5px" }}>
                    {docs.length}
                  </span>
                )}
              </button>
            ))}
          </div>

          {leftTab === "docs" && (
            <div style={{ flex: 1, overflowY: "auto" }}>
              {docs.length === 0 ? (
                <div style={{ padding: 32, textAlign: "center" }}>
                  <div style={{ fontSize: 28, marginBottom: 8 }}>📋</div>
                  <div style={{ fontSize: 11, color: T.textMuted }}>No documents for this case.</div>
                </div>
              ) : (
                docs.map((doc, i) => (
                  <DocItem
                    key={doc.doc_id || i}
                    doc={doc}
                    selected={selectedDoc?.doc_id === doc.doc_id}
                    onClick={() => handleSelectDoc(doc)}
                  />
                ))
              )}
              {storedPdfUrl && (
                <div style={{ padding: "10px 12px", borderTop: `1px solid ${T.border}`, background: T.bgTert }}>
                  <div style={{ fontSize: 10, color: T.textMuted, marginBottom: 6, textTransform: "uppercase", letterSpacing: "0.08em" }}>
                    Generated report
                  </div>
                  <button
                    onClick={() => { setPdfViewUrl(storedPdfUrl); setLeftTab("pdf"); }}
                    style={{
                      width: "100%", padding: "7px 0", border: `1px solid ${T.border}`,
                      background: T.bg, fontFamily: "inherit", fontSize: 11,
                      color: T.textSec, cursor: "pointer", borderRadius: 4,
                    }}
                  >
                    View stored PDF →
                  </button>
                  
                </div>
              )}
              {selectedDoc?.pdf_url && (
                <div style={{ padding: "10px 12px", borderTop: `1px solid ${T.border}` }}>
                  <button
                    onClick={() => { setPdfViewUrl(selectedDoc.pdf_url); setLeftTab("pdf"); }}
                    style={{
                      width: "100%", padding: "7px 0", border: `1px solid ${T.border}`,
                      background: T.bgTert, fontFamily: "inherit", fontSize: 11,
                      color: T.textSec, cursor: "pointer", borderRadius: 4,
                    }}
                  >
                    View selected PDF →
                  </button>
                </div>
              )}
            </div>
          )}

          {leftTab === "pdf" && (
            <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
              {pdfViewUrl ? (
  <>
    <div style={{
      padding: "6px 10px", borderBottom: `1px solid ${T.border}`,
      background: T.bgTert, display: "flex", alignItems: "center",
      justifyContent: "space-between", flexShrink: 0,
    }}>
      <span style={{ fontSize: 10, color: T.textMuted, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: "70%" }}>
        {selectedDoc?.file_name || "Document"}
      </span>
      <a href={pdfViewUrl} target="_blank" rel="noreferrer" style={{ fontSize: 10, color: T.textSec, textDecoration: "none", whiteSpace: "nowrap" }}>
        Open ↗
      </a>
    </div>
<iframe
  key={pdfViewUrl}
  src={pdfViewUrl}
  style={{ flex: 1, border: "none", width: "100%", pointerEvents: isDragging ? "none" : "auto" }}
  title="PDF Viewer"
/>  </>
) :(
                <div style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 10, color: T.textMuted }}>
                  <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1">
                    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
                    <polyline points="14 2 14 8 20 8"/>
                  </svg>
                  <div style={{ fontSize: 12 }}>Select a document to view its PDF</div>
                </div>
              )}
            </div>
          )}
        </div>

        <DragHandle onMouseDown={leftDrag.onMouseDown} direction="horizontal" />

        {/* ── RIGHT AREA ── */}
        <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", overflow: "hidden" }}>

          {/* Tab switcher: Fields vs Conclusion */}
          <div style={{
            display: "flex", borderBottom: `1px solid ${T.border}`,
            background: T.bg, flexShrink: 0,
          }}>
            {[
              { id: "fields", label: "Form Fields" },
{ id: "raw", label: "Raw Document" },
{ id: "conclusion", label: `Investigation Conclusion${triggerSections.length > 0 ? ` (${triggerSections.length})` : ""}` },
            ].map(t => (
              <button
                key={t.id}
                onClick={() => setActiveRightTab(t.id)}
                style={{
                  padding: "10px 20px", border: "none", cursor: "pointer",
                  fontFamily: "inherit", fontSize: 11, letterSpacing: "0.08em",
                  textTransform: "uppercase", fontWeight: activeRightTab === t.id ? 500 : 300,
                  color: activeRightTab === t.id ? T.text : T.textMuted,
                  background: activeRightTab === t.id ? T.bg : T.bgAlt,
                  borderBottom: activeRightTab === t.id ? `2px solid ${T.text}` : "2px solid transparent",
                }}
              >
                {t.label}
              </button>
            ))}
          </div>

          {/* Form editor area */}
          <div style={{
            flex: showGenPdf ? "none" : 1,
            height: showGenPdf ? `calc(100% - ${bottomDrag.size}px - 5px)` : undefined,
            overflowY: "auto",
            background: T.bgTert,
            padding: "18px 22px 40px",
            display: activeRightTab === "fields" ? "block" : "none",
          }}>
<div style={{ marginBottom: 16, fontSize: 11, color: T.textMuted, letterSpacing: "0.1em", textTransform: "uppercase" }}>
  {resolvedSections
    ? `Fields for ${resolvedTemplate} (+ any additional extracted fields) — verify before generating`
    : resolvedTemplate
      ? `No field mapping yet for ${resolvedTemplate} — showing all extracted fields`
      : "Edit report fields — changes apply to PDF on generation"}
</div>

{effectiveSections.map(section => (
  <SectionPanel
    key={section.id}
    section={section}
    formData={formData}
    onChange={handleFieldChange}
    expanded={!!expandedSections[section.id]}
    onToggle={() => handleSectionToggle(section.id)}
  />
))}

           
          </div>

          {/* Conclusion editor area */}
          <div style={{
            flex: showGenPdf ? "none" : 1,
            height: showGenPdf ? `calc(100% - ${bottomDrag.size}px - 5px)` : undefined,
            overflowY: "auto",
            background: T.bgTert,
            padding: "18px 22px 40px",
            display: activeRightTab === "conclusion" ? "block" : "none",
          }}>
            {/* Header */}
            <div style={{ marginBottom: 16, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              <div>
                <div style={{ fontSize: 11, color: T.textMuted, letterSpacing: "0.1em", textTransform: "uppercase", marginBottom: 4 }}>
                  Investigation Outcome / Conclusion
                </div>
                <div style={{ fontSize: 11, color: T.textMuted, lineHeight: 1.5 }}>
                  Each trigger has 3 editable sections. Plain text only — formatting is applied automatically by the PDF engine.
                </div>
              </div>
              <button
  onClick={toggleBulletMode}
  style={{
    padding: "6px 14px", borderRadius: 5, fontFamily: "inherit",
    fontSize: 11, cursor: "pointer",
    border: `1px solid ${bulletMode ? T.accent : T.border}`,
    background: bulletMode ? T.accent : T.bg,
    color: bulletMode ? "#fff" : T.textSec,
  }}
>
  {bulletMode ? "● Bullet points" : "▤ Paragraphs"}
</button>
              
            </div>

            

            {triggerSections.length === 0 ? (
              <div style={{
                padding: "40px 20px", textAlign: "center",
                background: T.bg, border: `1px dashed ${T.border}`, borderRadius: 8,
                marginBottom: 12,
              }}>
                <div style={{ fontSize: 32, marginBottom: 10 }}>📝</div>
                <div style={{ fontSize: 13, color: T.textSec, marginBottom: 6 }}>No conclusion sections found</div>
                <div style={{ fontSize: 11, color: T.textMuted, marginBottom: 16 }}>
                  Generate a conclusion first from the case detail page, or add a trigger manually.
                </div>
                <button
                  onClick={handleTriggerAdd}
                  style={{
                    padding: "8px 18px", background: T.text, color: "#fff",
                    border: "none", borderRadius: 5, fontFamily: "inherit",
                    fontSize: 12, cursor: "pointer",
                  }}
                >
                  + Add Trigger Section
                </button>
              </div>
            ) : (
              triggerSections.map((t, i) => (
                <TriggerConclusionEditor
  key={i}
  index={i}
  triggerData={t}
  bulletMode={bulletMode}
  onChange={handleTriggerChange}
  onRemove={handleTriggerRemove}
  canRemove={triggerSections.length > 1}
/>
              ))
            )}

            {/* Overall verdict */}
            <OverallVerdictEditor
  value={overallVerdict}
  bulletMode={bulletMode}
  onChange={v => { setOverallVerdict(v); setStatus("unsaved"); }}
/>

            {/* Bottom CTA */}
            <div style={{ marginTop: 20, padding: "14px 18px", background: T.bg, border: `1px solid ${T.border}`, borderRadius: 6, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              <div>
                <div style={{ fontSize: 13, fontWeight: 500 }}>Ready to generate?</div>
                <div style={{ fontSize: 11, color: T.textMuted, marginTop: 2 }}>
                  Conclusion will be formatted and rendered into the PDF automatically.
                </div>
              </div>
              <div style={{ display: "flex", gap: 8 }}>
                <button
                  onClick={handleSaveFields}
                  disabled={saving || generating}
                  style={{
                    padding: "9px 16px", background: T.bg,
                    border: `1px solid ${T.border}`, color: T.textSec,
                    fontFamily: "inherit", fontSize: 12,
                    cursor: (saving || generating) ? "not-allowed" : "pointer", borderRadius: 5,
                    opacity: (saving || generating) ? 0.6 : 1,
                  }}
                >
                  {saving ? "Saving…" : "Save"}
                </button>
                <button
  onClick={handleGenerateDOCX}
  disabled={generatingDocx || saving || generating}
  style={{
    padding: "9px 16px", background: T.bg,
    border: `1px solid ${T.border}`, color: T.textSec,
    fontFamily: "inherit", fontSize: 12,
    cursor: (generatingDocx || saving || generating) ? "not-allowed" : "pointer",
    borderRadius: 5,
    opacity: (generatingDocx || saving || generating) ? 0.6 : 1,
  }}
>
  {generatingDocx ? "Generating Word…" : "Download as Word"}
</button>
                <button
  onClick={handleGenerateFormattedDOCX}
  disabled={generatingFormattedDocx || saving || generating}
  title="Same layout as the PDF report, but as an editable Word document"
  style={{
    padding: "9px 16px", background: T.bg,
    border: `1px solid ${T.border}`, color: T.textSec,
    fontFamily: "inherit", fontSize: 12,
    cursor: (generatingFormattedDocx || saving || generating) ? "not-allowed" : "pointer",
    borderRadius: 5,
    opacity: (generatingFormattedDocx || saving || generating) ? 0.6 : 1,
  }}
>
  {generatingFormattedDocx ? "Formatting…" : "Formatted Word (editable)"}
</button>
                <button
                  onClick={handleGeneratePDF}
                  disabled={generating || saving}
                  style={{
                    padding: "9px 20px", background: generating ? T.bgTert : T.text,
                    border: "none", color: generating ? T.textMuted : "#fff",
                    fontFamily: "inherit", fontSize: 12, fontWeight: 500,
                    cursor: generating ? "not-allowed" : "pointer", borderRadius: 5,
                  }}
                >
                  {generating ? "Generating…" : "Generate PDF"}
                </button>
              </div>
            </div>
          </div>

{activeRightTab === "raw" && (
  <div style={{ flex: 1, overflow: "hidden", background: T.bgTert, display: "flex", flexDirection: "column" }}>
    <RawDocument
      markdown={caseData?.raw_llama_markdown}
      externalAnnotationContext={annotationCtx}
      onOpenSource={handleOpenSource}
      topContent={
        <GenerateConclusionBar
          caseId={caseId}
          annotations={annotationCtx?.annotations || []}
          baseUrl={BASE_URL}
          initialTriggers={caseData?.claimTriggers || []}
          emailInstructions={caseData?.emailInstructions}
          onConclusionGenerated={(conclusionText) => {
            const { triggers, overallVerdict: ov } = parseConclusionToTriggers(conclusionText);
            setTriggerSections(triggers);
            setOverallVerdict(ov);
            setActiveRightTab("conclusion");
            setStatus("unsaved");
          }}
        />
      }
    />
  </div>
)}

          {/* Vertical drag + generated PDF preview */}
          {showGenPdf && (
            <DragHandle onMouseDown={bottomDrag.onMouseDown} direction="vertical" />
          )}


          {showGenPdf && (
            <div style={{
              height: bottomDrag.size, flexShrink: 0,
              display: "flex", flexDirection: "column", overflow: "hidden",
              borderTop: `1px solid ${T.border}`, background: T.bg,
              animation: "fadeIn 0.25s ease",
            }}>
              <div style={{
                display: "flex", alignItems: "center", gap: 10,
                padding: "6px 12px", borderBottom: `1px solid ${T.border}`,
                background: T.bgTert, flexShrink: 0,
              }}>
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke={T.textMuted} strokeWidth="1.5">
                  <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
                  <polyline points="14 2 14 8 20 8"/>
                </svg>
                <span style={{ fontSize: 11, color: T.textSec, fontWeight: 500 }}>Generated PDF preview</span>
                {storedPdfUrl && (
                  <a href={storedPdfUrl} target="_blank" rel="noreferrer"
                    style={{ fontSize: 10, color: T.textSec, textDecoration: "none", marginLeft: 4 }}>
                    Open stored ↗
                  </a>
                )}
                <div style={{ flex: 1 }} />
                <button
                  onClick={handleDownload}
                  style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 11, padding: "4px 10px", border: `1px solid ${T.border}`, background: T.bg, cursor: "pointer", borderRadius: 4, color: T.textSec, fontFamily: "inherit" }}
                >
                  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
                    <polyline points="7 10 12 15 17 10"/>
                    <line x1="12" y1="15" x2="12" y2="3"/>
                  </svg>
                  Download
                </button>
                <button
                  onClick={() => setShowGenPdf(false)}
                  style={{ background: "none", border: "none", cursor: "pointer", fontSize: 14, color: T.textMuted, padding: "2px 6px", lineHeight: 1 }}
                  title="Close preview"
                >
                  ✕
                </button>
              </div>
<iframe
  src={genPdfUrl}
  style={{ flex: 1, border: "none", width: "100%", pointerEvents: isDragging ? "none" : "auto" }}
  title="Generated PDF"
/>            </div>
          )}
        </div>
      </div>
</>

);
}

export default function PDFEditorPage() {
  const { caseId } = useParams();
  const navigate = useNavigate();
  const doctorId = localStorage.getItem("user_id") || "";
  return (
    <AnnotationProvider key={caseId} caseId={caseId}>
      <PDFEditorInner caseId={caseId} navigate={navigate} doctorId={doctorId} />
    </AnnotationProvider>
  );
}