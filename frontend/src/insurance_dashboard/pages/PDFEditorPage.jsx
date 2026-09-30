import React, { useState, useEffect, useRef, useCallback } from "react";
import { useParams, useNavigate } from "react-router-dom";
import RawDocument from "./RawDocument";
import { AnnotationProvider, AnnotationContext, useAnnotations } from "./AnnotationContext";
// ADD THIS LINE alongside the other imports
import GenerateConclusionBar from "./GenerateConclusionBar";
import EditableFindingsSection from "./EditableFindingsSection";
import EditableSectionText from "./EditableSectionText";
import ClaimChatWidget from "./ClaimChatWidget";
import ClaimStoryMap from "./ClaimStoryMap";
import TourGuide from "./TourGuide";
import "./Dashboard.css";
const BASE_URL = import.meta.env.VITE_BACKEND_URL;

/* ─── THEME ─────────────────────────────────────────────────────────── */
const T = {
  bg: "var(--bg)",
  bgAlt: "var(--bg3, #fafafa)",
  bgTert: "var(--bg2, var(--bg3, #f4f4f2))",
  text: "var(--text)",
  textSec: "color-mix(in srgb, var(--text) 85%, var(--muted))",
  textMuted: "var(--muted)",
  border: "var(--border)",
  borderMid: "color-mix(in srgb, var(--border) 60%, var(--muted))",
  accent: "var(--accent)",
  accentLight: "color-mix(in srgb, var(--accent) 10%, var(--bg))",
  success: "var(--green)",
  warn: "var(--amber)",
  danger: "var(--red)",
  blue: "var(--blue)",
  blueLight: "color-mix(in srgb, var(--blue) 10%, var(--bg))",
  purple: "var(--purple)",
  purpleLight: "color-mix(in srgb, var(--purple) 10%, var(--bg))",
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
// Normalizes any reasonably-formatted date string into yyyy-mm-dd, which is
// the ONLY format <input type="date"> will actually render as a value.
// Handles: already-ISO, dd-mmm-yyyy ("29-Jul-2026"), dd-mm-yyyy / dd/mm/yyyy,
// and falls back to the native Date parser for anything else (e.g. "Jul 29, 2026").
const MONTH_NAME_TO_NUM = {
  jan: "01", feb: "02", mar: "03", apr: "04", may: "05", jun: "06",
  jul: "07", aug: "08", sep: "09", oct: "10", nov: "11", dec: "12",
};
function normalizeToISODate(value) {
  if (!value) return "";
  const s = value.toString().trim();
  if (!s) return "";

  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;

  m = s.match(/^(\d{1,2})[-\s]([A-Za-z]{3,})[-\s](\d{4})$/);
  if (m) {
    const mon = MONTH_NAME_TO_NUM[m[2].slice(0, 3).toLowerCase()];
    if (mon) return `${m[3]}-${mon}-${m[1].padStart(2, "0")}`;
  }

  m = s.match(/^(\d{1,2})[-\/](\d{1,2})[-\/](\d{4})$/);
  if (m) return `${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`;

  const d = new Date(s);
  if (!isNaN(d.getTime())) {
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, "0");
    const dd = String(d.getDate()).padStart(2, "0");
    return `${yyyy}-${mm}-${dd}`;
  }

  return "";
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

/* ─── HTML NOISE STRIPPER ─────────────────────────────────────────────
   Defensive cleanup for raw HTML/table markup that leaks into the
   LLM-generated conclusion text (e.g. a source doc's HTML table getting
   echoed verbatim instead of paraphrased). Generic regex-based — no
   hardcoded field names or table shapes, so it applies to any section. */
function stripHtmlNoise(text) {
  if (!text) return text;
  return text
    // row breaks → newline, so rows don't get glued into one line
    .replace(/<\/tr\s*>/gi, "\n")
    // cell boundaries → separator, so "Item | Amount" stays readable
    .replace(/<\/td\s*>\s*<td[^>]*>/gi, " | ")
    .replace(/<\/th\s*>\s*<th[^>]*>/gi, " | ")
    // strip every remaining tag (table/div/span/br/etc.)
    .replace(/<[^>]+>/g, "")
    // decode the handful of entities that show up in extracted docs
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    // NOTE: intentionally do NOT strip leading/trailing "|" here anymore —
    // that used to also strip real markdown pipe tables (e.g. the bill
    // line-items table), turning "| Item | Amount |" into "Item | Amount"
    // on every row. Only trim whitespace and drop genuinely blank lines.
    .split("\n")
    .map(line => line.trim())
    .filter(line => line.length > 0)
    .join("\n");
}

const makeEmptyTrigger = () => ({
  label: "INVESTIGATION REPORT",
  sections: { section1: "", section2: "", section3: "" },
});

function parseConclusionToTriggers(rawConclusion) {
    if (!rawConclusion) return { triggers: [], overallVerdict: "" };

  // Defensive cleanup — strip any HTML/table markup that leaked into the
  // stored text before we try to split it into sections.
  rawConclusion = stripHtmlNoise(rawConclusion);

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
function CandidateChips({ candidates, currentValue, onPick }) {
  if (!candidates || candidates.length === 0) return null;
  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: 5, marginTop: 4 }}>
      {candidates.map((c, i) => {
        const label = c.raw_phrase
          ? `${c.raw_phrase}${c.interpreted ? ` (${c.interpreted})` : ""}`
          : (c.value ?? "").toString();
        if (!label) return null;
        const pickValue = c.raw_phrase ? (c.interpreted || c.raw_phrase) : c.value;
        const active = (currentValue ?? "").toString() === (pickValue ?? "").toString();
        const src = c.source_file
          ? `${c.source_file}${c.source_page ? `, p.${c.source_page}` : ""}`
          : (c.manual ? "current value" : null);
        return (
          <button
            key={i}
            type="button"
            onClick={() => onPick(pickValue)}
            title={src ? `Source: ${src}` : undefined}
            style={{
              fontSize: 10, padding: "2px 8px", borderRadius: 99,
              border: `1px solid ${active ? "#1a1a1a" : "#ddd"}`,
              background: active ? "#1a1a1a" : "#fff",
              color: active ? "#fff" : "#444",
              cursor: "pointer", fontFamily: "inherit", whiteSpace: "nowrap",
            }}
          >
            {label.length > 40 ? label.slice(0, 38) + "…" : label}
            {src && <span style={{ opacity: 0.6, marginLeft: 4 }}>· {src.length > 20 ? src.slice(0, 18) + "…" : src}</span>}
          </button>
        );
      })}
    </div>
  );
}

function FieldRow({ field, formData, onChange }) {
  const val = getNestedValue(formData, field.key);

  const inputStyle = {
    width: "100%", padding: "6px 9px",
    border: `1px solid ${T.border}`, borderRadius: 4,
    fontSize: 12, fontFamily: "inherit", color: T.text,
    background: T.bg, outline: "none", boxSizing: "border-box",
    resize: "vertical",
    whiteSpace: "pre-wrap",
    overflowWrap: "anywhere",
    wordBreak: "break-word",
  };

  if (field.type === "table") {
    const rowCandidates = (field.candidates || []).filter(c => c.rows);
    return (
      <div style={{ marginBottom: 10 }}>
        {rowCandidates.length > 0 && (
          <div style={{ marginBottom: 6, display: "flex", gap: 6, flexWrap: "wrap" }}>
            {rowCandidates.map((c, i) => (
              <button
                key={i}
                type="button"
                onClick={() => onChange(field.key, c.rows)}
                title={c.source_file ? `Source: ${c.source_file}${c.source_page ? `, p.${c.source_page}` : ""}` : undefined}
                style={{ fontSize: 10, padding: "3px 9px", borderRadius: 6, border: "1px solid #ddd", background: "#fff", cursor: "pointer", fontFamily: "inherit" }}
              >
                Use extracted rows ({c.rows.length}){c.source_file ? ` — ${c.source_file}` : ""}
              </button>
            ))}
          </div>
        )}
        <LineItemsEditor value={val} onChange={v => onChange(field.key, v)} />
      </div>
    );
  }

  if (field.type === "rows") {
    return (
      <RowsEditor
        label={field.label}
        columns={field.columns}
        value={val}
        onChange={v => onChange(field.key, v)}
      />
    );
  }

  if (field.type === "yn") {
        return (
      <div style={{ padding: "5px 0", borderBottom: `1px solid ${T.bgTert}` }}>
        <div style={{ display: "grid", gridTemplateColumns: "1fr auto", alignItems: "center", gap: 10 }}>
          <span style={{ fontSize: 11.5, color: T.textSec }}>{field.label}</span>
          <select
            value={val || "NA"}
            onChange={e => onChange(field.key, e.target.value)}
            style={{ ...inputStyle, width: 72, padding: "5px 6px" }}
          >
            {["NA", "Yes", "No", "N/A"].map(o => <option key={o}>{o}</option>)}
          </select>
        </div>
        <CandidateChips candidates={field.candidates} currentValue={val} onPick={v => onChange(field.key, v)} />
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
<CandidateChips candidates={field.candidates} currentValue={arrayToDisplayText(val)} onPick={v => onChange(field.key, Array.isArray(v) ? v : displayTextToArray(String(v)))} />      </div>
    );
  }

  if (field.type === "textarea") {
    return (
      <div style={{ marginBottom: 10 }}>
        <div style={{ fontSize: 10, textTransform: "uppercase", letterSpacing: "0.08em", color: T.textMuted, marginBottom: 3 }}>
          {field.label}
        </div>
        <textarea rows={3} value={val || ""} onChange={e => onChange(field.key, e.target.value)} style={inputStyle} />
        <CandidateChips candidates={field.candidates} currentValue={val} onPick={v => onChange(field.key, v)} />
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
        value={field.type === "date" ? normalizeToISODate(val) : (val || "")}
        onChange={e => onChange(field.key, e.target.value)}
        style={inputStyle}
        onFocus={e => e.target.style.borderColor = T.accent}
        onBlur={e => e.target.style.borderColor = T.border}
      />
      <CandidateChips candidates={field.candidates} currentValue={val} onPick={v => onChange(field.key, field.type === "date" ? normalizeToISODate(v) : v)} />
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
  section1: { bar: "var(--blue)", bg: "color-mix(in srgb, var(--blue) 14%, var(--bg))", label: "Section 1 — Hospital Visit Findings" },
  section2: { bar: "var(--green)", bg: "color-mix(in srgb, var(--green) 14%, var(--bg))", label: "Section 2 — Member / Insured Visit Findings" },
  section3: { bar: "var(--purple)", bg: "color-mix(in srgb, var(--purple) 14%, var(--bg))", label: "Section 3 — Conclusion" },
};

/* ─── RICH TEXT RENDERING (citations → clickable chips, disc tags → badges) ─── */
const SEVERE_DISC_TAGS = new Set([
  "MISSING", "CONTRADICTORY", "BILLING MISMATCH", "CRITICAL FACT MISSING",
  "PHYSIOLOGICAL ANOMALY", "UNDISCLOSED PED SUSPECTED", "SUSPICIOUS",
  "DOCUMENT INTEGRITY", "TIMELINE MISMATCH",
]);
const RICH_TOKEN_RE = /\(Source:\s*([^)]+)\)|\[(MISSING|INCOMPLETE|CONTRADICTORY|SUSPICIOUS|BILLING MISMATCH|TIMELINE MISMATCH|SINGLE STRETCH|CRITICAL FACT MISSING|PHYSIOLOGICAL ANOMALY|UNDISCLOSED PED SUSPECTED|DOCUMENT INTEGRITY)\]|\[([A-Za-z][A-Za-z /]*)\s—\s([A-Z][A-Z_]*)\]/g;
function renderRichText(text, onOpenSource) {
  if (!text) return null;
  const parts = [];
  let lastIndex = 0, m, key = 0;
  const re = new RegExp(RICH_TOKEN_RE.source, "g");
  while ((m = re.exec(text)) !== null) {
    if (m.index > lastIndex) parts.push(text.slice(lastIndex, m.index));
    if (m[1]) {
      const sources = m[1].split(";").map(s => s.trim()).filter(Boolean);
      parts.push(
        <span key={`c${key++}`} style={{ display: "inline-flex", gap: 4, flexWrap: "wrap", verticalAlign: "middle" }}>
          {sources.map((src, i) => {
            const cm = src.match(/^(.+?),\s*Page\s*(\d+)$/i);
            const fileName = cm ? cm[1].trim() : src;
            const pageNumber = cm ? parseInt(cm[2], 10) : null;
            return (
              <button
                key={i}
                type="button"
                onClick={() => onOpenSource?.(fileName, pageNumber)}
                title={`Open ${fileName}${pageNumber ? `, page ${pageNumber}` : ""}`}
                style={{
                  fontSize: 9, padding: "1px 5px", borderRadius: 99, margin: "0 1px",
                  border: `1px solid ${T.border}`, background: T.bgTert,
                  color: T.blue, cursor: onOpenSource ? "pointer" : "default", fontFamily: "inherit",
                  whiteSpace: "nowrap",
                }}
              >
                📄 {fileName.length > 18 ? fileName.slice(0, 16) + "…" : fileName}{pageNumber ? ` p.${pageNumber}` : ""}
              </button>
            );
          })}
        </span>
      );
    } else if (m[2]) {
      const tag = m[2];
      const critical = SEVERE_DISC_TAGS.has(tag);
      parts.push(
        <span key={`t${key++}`} style={{
          display: "inline-block", fontSize: 9.5, fontWeight: 700, padding: "1px 7px",
          borderRadius: 99, margin: "0 2px", verticalAlign: "middle",
          background: critical ? "color-mix(in srgb, var(--red) 14%, var(--bg))" : "color-mix(in srgb, var(--amber) 14%, var(--bg))",
          color: critical ? T.danger : T.warn,
          border: `1px solid ${critical ? "color-mix(in srgb, var(--red) 40%, var(--bg))" : "color-mix(in srgb, var(--amber) 40%, var(--bg))"}`,
        }}>
          {tag}
        </span>
      );
    } else if (m[3]) {
      // Specialist-agent finding: "[Agent Label — FINDING_TYPE]" — informational,
      // not an automatic-severity discrepancy tag, so it gets its own color.
      parts.push(
        <span key={`s${key++}`} style={{
          display: "inline-block", fontSize: 9.5, fontWeight: 700, padding: "1px 7px",
          borderRadius: 99, margin: "0 2px", verticalAlign: "middle",
          background: T.blueLight, color: T.blue,
          border: `1px solid color-mix(in srgb, var(--blue) 40%, var(--bg))`,
        }}>
          {m[3]} — {m[4]}
        </span>
      );
    }
    lastIndex = re.lastIndex;
  }
  if (lastIndex < text.length) parts.push(text.slice(lastIndex));
  return parts;
}
function RichTextBlockInline({ text, onOpenSource, checks, onToggle, sectionKey }) {
  if (!text || !text.trim()) return <div style={{ fontSize: 11.5, color: T.textMuted, fontStyle: "italic" }}>No content yet.</div>;
  const lines = text.split("\n");
  return (
    <div style={{ fontSize: 11.5, lineHeight: 1.75, color: T.textSec }}>
      {lines.map((line, idx) => {
        const m = line.trim().match(DISC_TAG_LINE_RE);
        if (m) {
          const key = `${sectionKey}:${discLineKey(idx)}`;
          return (
            <DiscrepancyCheckRow
              key={key}
              tag={m[1].trim()}
              text={m[2].trim()}
              checked={checks ? checks[key] !== false : true}
              onToggle={() => onToggle && onToggle(key)}
              onOpenSource={onOpenSource}
            />
          );
        }
        if (!line.trim()) return null;
        return (
          <div key={idx} style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere", padding: "1px 0" }}>
            {renderRichText(line, onOpenSource)}
          </div>
        );
      })}
    </div>
  );
}
function RichTextBlock({ text, onOpenSource }) {
  if (!text || !text.trim()) return <div style={{ fontSize: 11.5, color: T.textMuted, fontStyle: "italic" }}>No content yet.</div>;
  return (
    <div style={{ fontSize: 11.5, lineHeight: 1.75, color: T.textSec, whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>
      {renderRichText(text, onOpenSource)}
    </div>
  );
}

/* ─── SECTION 3 DISCREPANCY CHECKLIST + CLAIM STORY PARSING ────────────
   Every "[TAG] explanation (Source: ...)" line anywhere in Section 3 —
   whether under the flat DISCREPANCIES header or nested inside the
   backend's CLAIM STORY block (see unified_report_agent.py's
   _run_claim_story_and_discrepancies) — is addressable by its absolute
   line index within the section3 text. That single key space is used
   both for checkbox state AND for filtering before Save/Generate, so
   parsing and filtering can never disagree about which line is which. */
const DISC_TAG_LINE_RE = /^\[([A-Z /]+)\]\s*(.+)$/;
const DISC_HEADER_LINE_RE = /^DISCREPANCIES\s*$/i;
const STORY_HEADER_RE = /^CLAIM STORY\b/i;
const STORY_EVENT_LINE_RE = /^•\s*\[(.+?)\]\s*(.*)$/;
const OTHER_DISC_HEADER_RE = /^Other discrepancies\b/i;

function discLineKey(lineIndex) {
  return `L${lineIndex}`;
}

// Parses the CLAIM STORY block (if present) into a timeline + unanchored
// discrepancy list, each discrepancy tagged with its absolute line index.
// Also returns the set of line indices "consumed" by the story block, so
// the flat-discrepancy renderer can skip lines already shown here.
function parseSection3Story(text) {
  const empty = { found: false, timeline: [], unanchored: [], consumedIndices: new Set() };
  if (!text) return empty;
  const lines = text.split("\n");
  let startIdx = -1;
  for (let i = 0; i < lines.length; i++) {
    if (STORY_HEADER_RE.test(lines[i].trim())) { startIdx = i; break; }
  }
  if (startIdx === -1) return empty;

  let endIdx = lines.length;
  for (let i = startIdx + 1; i < lines.length; i++) {
    const t = lines[i].trim();
    if (t === "") continue;
    if (t.startsWith("•") || DISC_TAG_LINE_RE.test(t) || OTHER_DISC_HEADER_RE.test(t)) continue;
    endIdx = i;
    break;
  }

  const timeline = [];
  const unanchored = [];
  const consumedIndices = new Set([startIdx]);
  let currentEvent = null;
  let inUnanchored = false;

  for (let i = startIdx + 1; i < endIdx; i++) {
    const trimmed = lines[i].trim();
    if (!trimmed) continue;
    consumedIndices.add(i);
    if (OTHER_DISC_HEADER_RE.test(trimmed)) { inUnanchored = true; currentEvent = null; continue; }
    if (!inUnanchored) {
      const evMatch = trimmed.match(STORY_EVENT_LINE_RE);
      if (evMatch) {
        currentEvent = { date: evMatch[1].trim(), description: evMatch[2].trim(), discrepancies: [] };
        timeline.push(currentEvent);
        continue;
      }
      const tagMatch = trimmed.match(DISC_TAG_LINE_RE);
      if (tagMatch && currentEvent) {
        currentEvent.discrepancies.push({ key: discLineKey(i), tag: tagMatch[1].trim(), text: tagMatch[2].trim() });
        continue;
      }
    } else {
      const tagMatch = trimmed.match(DISC_TAG_LINE_RE);
      if (tagMatch) {
        unanchored.push({ key: discLineKey(i), tag: tagMatch[1].trim(), text: tagMatch[2].trim() });
      }
    }
  }

  return { found: true, timeline, unanchored, consumedIndices };
}

// Flat "[TAG] ..." lines anywhere in section3Text that are NOT already
// part of the CLAIM STORY block (typically the top-of-section
// DISCREPANCIES block). Each item keyed by absolute line index.
function parseFlatDiscrepancyItems(text, consumedIndices) {
  if (!text) return [];
  const lines = text.split("\n");
  const items = [];
  lines.forEach((line, idx) => {
    if (consumedIndices && consumedIndices.has(idx)) return;
    const m = line.trim().match(DISC_TAG_LINE_RE);
    if (m) items.push({ key: discLineKey(idx), tag: m[1].trim(), text: m[2].trim() });
  });
  return items;
}

// Removes every "[TAG] ..." line whose checkbox state is explicitly
// false in `checks` (default: checked/kept if absent). Also drops a now-
// empty "Other discrepancies..." header. Used right before Save/Generate
// so unchecked discrepancies never reach the PDF/DOCX.
function filterSection3ByChecks(text, checks, sectionKey = "section3") {
  if (!text || !checks) return text;
  const lines = text.split("\n");
  const kept = lines.filter((line, idx) => {
    const trimmed = line.trim();
    if (!DISC_TAG_LINE_RE.test(trimmed)) return true;
    return checks[`${sectionKey}:${discLineKey(idx)}`] !== false;
  });
  const result = [];
  for (let i = 0; i < kept.length; i++) {
    if (OTHER_DISC_HEADER_RE.test(kept[i].trim())) {
      let hasFollowingTag = false;
      for (let j = i + 1; j < kept.length; j++) {
        const t = kept[j].trim();
        if (!t) break;
        hasFollowingTag = DISC_TAG_LINE_RE.test(t);
        break;
      }
      if (!hasFollowingTag) continue; // drop the now-empty header
    }
    result.push(kept[i]);
  }
  return result.join("\n");
}

function DiscrepancyCheckRow({ tag, text, checked, onToggle, onOpenSource }) {
  const critical = SEVERE_DISC_TAGS.has(tag);
  return (
    <label style={{
      display: "flex", gap: 8, alignItems: "flex-start",
      padding: "5px 8px", borderRadius: 5, cursor: "pointer",
      background: checked ? "transparent" : T.bgTert,
      opacity: checked ? 1 : 0.55,
    }}>
      <input
        type="checkbox"
        checked={checked}
        onChange={onToggle}
        style={{ marginTop: 2, flexShrink: 0, width: 13, height: 13 }}
      />
      <div style={{ flex: 1, minWidth: 0, fontSize: 10.5, lineHeight: 1.55 }}>
        <span style={{
          display: "inline-block", fontSize: 9, fontWeight: 700, padding: "1px 6px",
          borderRadius: 99, marginRight: 6,
          background: critical ? "color-mix(in srgb, var(--red) 14%, var(--bg))" : "color-mix(in srgb, var(--amber) 14%, var(--bg))",
          color: critical ? T.danger : T.warn,
        }}>
          {tag}
        </span>
        <span style={{ color: T.textSec }}>{renderRichText(text, onOpenSource)}</span>
      </div>
    </label>
  );
}

function Section3FlatDiscrepancies({ items, checks, onToggle, onOpenSource }) {
  if (!items.length) return null;
  return (
    <div style={{ border: `1px solid ${T.border}`, borderRadius: 7, overflow: "hidden", marginBottom: 10 }}>
      <div style={{
        padding: "7px 12px", background: "color-mix(in srgb, var(--red) 10%, var(--bg))",
        borderBottom: `1px solid ${T.border}`,
        fontSize: 10.5, fontWeight: 600, color: T.danger, textTransform: "uppercase", letterSpacing: "0.06em",
      }}>
        Discrepancies
      </div>
      <div style={{ padding: "10px 12px", background: T.bg, display: "flex", flexDirection: "column", gap: 3 }}>
        {items.map(d => (
          <DiscrepancyCheckRow
            key={d.key}
            tag={d.tag}
            text={d.text}
            checked={checks[d.key] !== false}
            onToggle={() => onToggle(d.key)}
            onOpenSource={onOpenSource}
          />
        ))}
      </div>
    </div>
  );
}

function Section3StoryCard({ story, checks, onToggle, onOpenSource }) {
  if (!story.found) return null;
  return (
    <div style={{ border: `1px solid ${T.border}`, borderRadius: 7, overflow: "hidden", marginBottom: 10 }}>
      <div style={{
        padding: "7px 12px", background: T.blueLight, borderBottom: `1px solid ${T.border}`,
        fontSize: 10.5, fontWeight: 600, color: T.blue, textTransform: "uppercase", letterSpacing: "0.06em",
      }}>
        Claim Story — Chronological Timeline
      </div>
      <div style={{ padding: "10px 12px", background: T.bg }}>
        {story.timeline.length === 0 && story.unanchored.length === 0 && (
          <div style={{ fontSize: 11, color: T.textMuted, fontStyle: "italic" }}>
            No dateable events could be reconstructed.
          </div>
        )}
        {story.timeline.map((ev, i) => (
          <div key={i} style={{ marginBottom: 8, paddingLeft: 12, borderLeft: `2px solid ${T.border}` }}>
            <div style={{ fontSize: 11, color: T.text }}>
              <strong style={{ color: T.blue }}>{ev.date}</strong> — {renderRichText(ev.description, onOpenSource)}
            </div>
            {ev.discrepancies.length > 0 && (
              <div style={{ marginTop: 4, display: "flex", flexDirection: "column", gap: 3 }}>
                {ev.discrepancies.map(d => (
                  <DiscrepancyCheckRow
                    key={d.key}
                    tag={d.tag}
                    text={d.text}
                    checked={checks[d.key] !== false}
                    onToggle={() => onToggle(d.key)}
                    onOpenSource={onOpenSource}
                  />
                ))}
              </div>
            )}
          </div>
        ))}
        {story.unanchored.length > 0 && (
          <div style={{ marginTop: 10 }}>
            <div style={{ fontSize: 9.5, textTransform: "uppercase", letterSpacing: "0.08em", color: T.textMuted, marginBottom: 4 }}>
              Other Discrepancies
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
              {story.unanchored.map(d => (
                <DiscrepancyCheckRow
                  key={d.key}
                  tag={d.tag}
                  text={d.text}
                  checked={checks[d.key] !== false}
                  onToggle={() => onToggle(d.key)}
                  onOpenSource={onOpenSource}
                />
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// Generalized: was Section3-only, now shared by Section 1 / 2 / 3 so every
// account's inline flags are checkbox-able, not just Section 3's. `sectionKey`
// namespaces line-index keys so Section 1's line 4 and Section 3's line 4
// never collide in the shared checks object.
function FlaggedSectionView({ text, sectionKey, checks, onToggle, onOpenSource, plainBodyRenderer }) {
  const story = React.useMemo(
    () => (sectionKey === "section3" ? parseSection3Story(text || "") : { found: false, consumedIndices: new Set() }),
    [text, sectionKey]
  );
  const flatItems = React.useMemo(
    () => parseFlatDiscrepancyItems(text || "", story.consumedIndices).map(item => ({ ...item, key: `${sectionKey}:${item.key}` })),
    [text, story, sectionKey]
  );
    const restText = React.useMemo(() => {
    if (!text) return "";
    const flatKeys = new Set(flatItems.map(f => f.key.replace(`${sectionKey}:`, "")));
    return text
      .split("\n")
      .filter((line, idx) =>
        !story.consumedIndices.has(idx) &&
        !flatKeys.has(discLineKey(idx)) &&
        !DISC_HEADER_LINE_RE.test(line.trim())
      )
      .join("\n");
  }, [text, story, flatItems, sectionKey]);

  return (
    <div>
      {sectionKey === "section3" && (
        <Section3FlatDiscrepancies items={flatItems} checks={checks} onToggle={onToggle} onOpenSource={onOpenSource} />
      )}
      {sectionKey === "section3" && (
        <Section3StoryCard story={story} checks={checks} onToggle={onToggle} onOpenSource={onOpenSource} />
      )}
      {sectionKey === "section1" ? (
        <Section1EpisodeView
          text={text}
          onOpenSource={onOpenSource}
          checks={checks}
          onToggle={onToggle}
          sectionKey={sectionKey}
        />
      ) : sectionKey !== "section3" ? (
        <RichTextBlockInline
          text={text}
          onOpenSource={onOpenSource}
          checks={checks}
          onToggle={onToggle}
          sectionKey={sectionKey}
        />
      ) : (
        <RichTextBlock text={restText} onOpenSource={onOpenSource} />
      )}
    </div>
  );
}

const Section3View = (props) => <FlaggedSectionView {...props} sectionKey="section3" />;
/* ─── EPISODE CARD PARSING (Section 1 only) ───────────────────────────
   The backend writes each hospital episode with a literal header line:
   "Episode N of M — <Hospital> (<admission> to <discharge>, outcome: <x>)"
   followed by the episode's prose, then (optionally) trigger-assessment
   blocks headed "<Trigger Label> — Hospital Assessment". Parsed here so
   each episode renders as its own card instead of one continuous wall
   of text. */
const EPISODE_HEADER_RE = /^Episode\s+(\d+)\s+of\s+(\d+)\s*[—-]\s*(.+?)\s*\((.+?)\s+to\s+(.+?),\s*outcome:\s*([\w_]+)\)\s*$/;
const TRIGGER_ASSESSMENT_HEADER_RE = /^(.+?)\s*[—-]\s*Hospital Assessment\s*$/;

function parseSection1IntoCards(text) {
  if (!text) return { intro: "", episodes: [], triggerAssessments: [] };
  const lines = text.split("\n");
  const episodes = [];
  const triggerAssessments = [];
  const introLines = []; // now holds {idx, line} objects, not plain strings
  let current = null;
  const flush = () => {
    if (!current) return;
    // bodyLines is now [{idx, line}] — keep both the joined text (for any
    // caller still expecting a string) AND the indexed array (for inline
    // flag rendering).
    const bodyIndexedLines = current.bodyLines;
    const body = bodyIndexedLines.map(l => l.line).join("\n").trim();
    if (current.kind === "episode") episodes.push({ ...current.meta, body, bodyIndexedLines });
    else triggerAssessments.push({ label: current.meta.label, body, bodyIndexedLines });
  };
  lines.forEach((line, idx) => {
    // Headers may arrive with a leading bullet marker ("• Episode 1 of 5 — ...")
    // from the AI-generated text — strip it before matching, or the ^Episode
    // anchor never fires and the line falls through as plain text.
    const strippedLine = line.replace(/^[\s]*[•\-\*]\s*/, "");
    const epMatch = strippedLine.match(EPISODE_HEADER_RE);
    const trigMatch = !epMatch && strippedLine.match(TRIGGER_ASSESSMENT_HEADER_RE);
    if (epMatch) {
      flush();
      current = {
        kind: "episode",
        meta: {
          index: parseInt(epMatch[1], 10), total: parseInt(epMatch[2], 10),
          hospital: epMatch[3].trim(), admission: epMatch[4].trim(),
          discharge: epMatch[5].trim(), outcome: epMatch[6].trim(),
        },
        bodyLines: [],
      };
    } else if (trigMatch) {
      flush();
      current = { kind: "trigger", meta: { label: trigMatch[1].trim() }, bodyLines: [] };
    } else if (current) {
      current.bodyLines.push({ idx, line });
    } else {
      introLines.push({ idx, line });
    }
  });
  flush();
  return {
    intro: introLines.map(l => l.line).join("\n").trim(),
    introIndexedLines: introLines,
    episodes,
    triggerAssessments,
  };
}

/* ─── EPISODE OUTCOME BADGE COLORS ─────────────────────────────────── */
const OUTCOME_COLORS = {
  discharged: { bg: "#dcfce7", fg: "#15803d" },
  deceased:   { bg: "#fee2e2", fg: "#b91c1c" },
  expired:    { bg: "#fee2e2", fg: "#b91c1c" },
  lama:       { bg: "#fef3c7", fg: "#b45309" },
  dama:       { bg: "#fef3c7", fg: "#b45309" },
  referred:   { bg: "#dbeafe", fg: "#1d4ed8" },
};
function outcomeStyle(outcome) {
  const key = (outcome || "").toLowerCase();
  return OUTCOME_COLORS[key] || { bg: "#f1f5f9", fg: "#64748b" };
}

/* ─── MEDICINE LINE DETECTION ─────────────────────────────────────────
   Lines like "XONE SB 1.5 gm in 100ml NS IV, Inj." or
   "VANOPRAZAN 20mg (B/F) 1---0---0 X 30 days, Syp." are drug/dosage
   entries. They read fine as a comma-wrapped chip list and take up far
   less vertical space than one bullet per drug. */
const MEDICINE_LINE_RE = /,\s*(Inj|Syp|Tab|Cap|IVF|Susp|Oint|Gel|Drops|Amp|Sol)\.?\s*$/i;

function stripBulletPrefix(line) {
  return line.replace(/^[\s]*[•\-\*]\s*/, "");
}

/* ─── BILL BREAKDOWN / CHARGE LINE DETECTION ──────────────────────────
   Two messy-but-common shapes seen in generated Section 1 text:
     1. "Bill breakdown items: • NAME — amount, • NAME2 — amount2, ..."
        — one giant line listing dozens of items. Converted to a real
        Item/Amount table.
     2. Shorter lines that pack 2+ items into one bullet via a mid-line
        "•" separator (e.g. "FAHID BASHA — 400.00, • GRBS- Dr.") —
        converted into a wrapped chip row instead of a dense run-on line. */
const BILL_BREAKDOWN_HEADER_RE = /^(Bill\s*(?:line\s*items|breakdown(?:\s*items)?|breakdown\s*includes))\s*[:\-]\s*(.+)$/i;
const BILL_ITEM_RE = /^(.+?)\s*(?:\(\s*([\d,]+\.\d+)\s*\)|[—\-:]\s*([\d,]+\.\d+))\s*$/;

function splitBillSegments(rest) {
  return rest
    .split(/,\s*(?=•?\s*[A-Za-z(])/)
    .map(s => s.replace(/^•\s*/, "").trim())
    .filter(Boolean);
}

function parseBillBreakdownLine(line) {
  const m = line.trim().match(BILL_BREAKDOWN_HEADER_RE);
  if (!m) return null;
  const segments = splitBillSegments(m[2]);
  const rows = segments.map(seg => {
    const im = seg.match(BILL_ITEM_RE);
    if (!im) return null;
    const amount = (im[2] || im[3] || "").trim();
    const name = im[1].trim();
    if (!name || !amount) return null;
    return { name, amount };
  }).filter(Boolean);
  // bail to plain text if parsing didn't cleanly cover most segments
  if (rows.length < 2 || rows.length < segments.length * 0.6) return null;
  return { label: m[1], rows };
}

// A "multi-item" line: contains a mid-string "• " separator, meaning more
// than one item was packed into a single bullet by the source text.
function splitInlineChips(line) {
  if (!/\S\s*•\s*\S/.test(line)) return null;
  const parts = line.split(/\s*•\s*/).map(s => s.trim()).filter(Boolean);
  return parts.length >= 2 ? parts : null;
}

function BillTable({ label, rows }) {
  return (
    <div style={{ margin: "8px 0" }}>
      <div style={{ fontSize: 9.5, textTransform: "uppercase", letterSpacing: "0.08em", color: T.textMuted, marginBottom: 4 }}>
        {label} ({rows.length} items)
      </div>
      <div style={{ border: `1px solid ${T.border}`, borderRadius: 6, overflow: "hidden" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 11 }}>
          <thead>
            <tr style={{ background: T.bgAlt }}>
              <th style={{ textAlign: "left", padding: "5px 8px", fontSize: 9.5, textTransform: "uppercase", letterSpacing: "0.05em", color: T.textMuted, borderBottom: `1px solid ${T.border}` }}>Item</th>
              <th style={{ textAlign: "right", padding: "5px 8px", fontSize: 9.5, textTransform: "uppercase", letterSpacing: "0.05em", color: T.textMuted, borderBottom: `1px solid ${T.border}` }}>Amount</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={i} style={{ background: i % 2 === 1 ? T.bgTert : "transparent" }}>
                <td style={{ padding: "3px 8px", borderBottom: `1px solid ${T.bgTert}`, color: T.textSec }}>{r.name}</td>
                <td style={{ padding: "3px 8px", borderBottom: `1px solid ${T.bgTert}`, textAlign: "right", fontFamily: "ui-monospace, monospace", color: T.textSec, whiteSpace: "nowrap" }}>{r.amount}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/* ─── MARKDOWN PIPE TABLE DETECTION ────────────────────────────────────
   Detects a standard GFM-style pipe table emitted by the LLM (used for
   Section 1 bill line items — see unified_report_agent.py item ⑮):
     | Item | Amount |
     |---|---|
     | NAME | 123.45 |
   Grouped out of the line stream BEFORE any of the legacy comma/bullet
   bill-parsing heuristics run, so a real table is never mistaken for a
   prose bill-breakdown line. */
const MD_TABLE_ROW_RE = /^\|(.+)\|$/;
const MD_TABLE_SEP_RE = /^\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)+\|?$/;

function isMarkdownTableRowLine(line) {
  return /^\s*\|.*\|\s*$/.test(line.trim());
}

function parseMarkdownTableRow(line) {
  const m = line.trim().match(MD_TABLE_ROW_RE);
  const inner = m ? m[1] : line.trim().replace(/^\|/, "").replace(/\|$/, "");
  return inner.split("|").map(c => c.trim());
}

// Walks a flat array of text lines and collapses any run that looks like
// "header row" + "separator row" + "0-or-more data rows" into a single
// {kind:"mdtable", header, rows} object. Non-table lines pass through
// unchanged (as plain strings) so the rest of EpisodeBodyBlock's line
// logic still runs on them exactly as before.
function groupMarkdownTables(lines) {
  const out = [];
  let i = 0;
  while (i < lines.length) {
    if (
      isMarkdownTableRowLine(lines[i]) &&
      i + 1 < lines.length &&
      MD_TABLE_SEP_RE.test(lines[i + 1].trim())
    ) {
      const header = parseMarkdownTableRow(lines[i]);
      i += 2; // skip header + separator rows
      const rows = [];
      while (i < lines.length && isMarkdownTableRowLine(lines[i])) {
        rows.push(parseMarkdownTableRow(lines[i]));
        i++;
      }
      out.push({ kind: "mdtable", header, rows });
    } else {
      out.push(lines[i]);
      i++;
    }
  }
  return out;
}

function MarkdownTableBlock({ header, rows }) {
  return (
    <div style={{ margin: "8px 0" }}>
      <div style={{ border: `1px solid ${T.border}`, borderRadius: 6, overflow: "hidden" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 11 }}>
          <thead>
            <tr style={{ background: T.bgAlt }}>
              {header.map((h, hi) => (
                <th key={hi} style={{
                  textAlign: hi === header.length - 1 ? "right" : "left",
                  padding: "5px 8px", fontSize: 9.5, textTransform: "uppercase",
                  letterSpacing: "0.05em", color: T.textMuted,
                  borderBottom: `1px solid ${T.border}`,
                }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r, ri) => (
              <tr key={ri} style={{ background: ri % 2 === 1 ? T.bgTert : "transparent" }}>
                {r.map((c, ci) => (
                  <td key={ci} style={{
                    padding: "3px 8px", borderBottom: `1px solid ${T.bgTert}`,
                    textAlign: ci === r.length - 1 ? "right" : "left",
                    fontFamily: ci === r.length - 1 ? "ui-monospace, monospace" : "inherit",
                    color: T.textSec,
                    whiteSpace: ci === r.length - 1 ? "nowrap" : "normal",
                    overflowWrap: "anywhere",
                  }}>{c}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function InlineChipRow({ parts, onOpenSource }) {
    return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: 5, padding: "3px 0" }}>
      {parts.map((p, i) => (
        <span key={i} style={{
          fontSize: 10.5, padding: "2px 8px", borderRadius: 5,
          background: T.bgTert, border: `1px solid ${T.border}`,
          color: T.textSec, whiteSpace: "nowrap",
        }}>
          {renderRichText(p, onOpenSource)}
        </span>
      ))}
    </div>
  );
}
/* ─── EPISODE BODY RENDERER ────────────────────────────────────────────
   Groups the free-text episode body into: normal findings (rendered as
   individual bullet lines, with citation chips / disc tags intact) and
   medicine runs (rendered as a single wrapped chip row instead of one
   bullet per drug — this is what was eating vertical space before). */
function EpisodeBodyBlock({ text, indexedLines, onOpenSource, checks, onToggle, sectionKey }) {
  if ((!text || !text.trim()) && (!indexedLines || indexedLines.length === 0)) {
    return <div style={{ fontSize: 11.5, color: T.textMuted, fontStyle: "italic" }}>No findings recorded.</div>;
  }

  // Two call shapes: indexedLines (preferred — carries the line's absolute
  // position in the full section text, needed to key its checkbox) or a
  // plain text string (legacy — flag lines still render, just without a
  // stable checkbox key, so they fall back to a content-based key).
  let workingLines;
  if (indexedLines && indexedLines.length > 0) {
    const normalizedJoined = indexedLines.map(l => l.line).join("\n")
      .replace(/([^\n])(\|\s*Item\s*\|\s*Amount\s*\|)/gi, "$1\n$2");
    // re-split only if the normalization above inserted a break; otherwise reuse as-is
    if (normalizedJoined.includes("\n" + "| Item | Amount |")) {
      workingLines = normalizedJoined.split("\n").map((line, i) => ({
        idx: indexedLines[i] ? indexedLines[i].idx : -1,
        line: stripBulletPrefix(line),
      }));
    } else {
      workingLines = indexedLines.map(l => ({ idx: l.idx, line: stripBulletPrefix(l.line) }));
    }
    workingLines = workingLines.filter(l => l.line.trim().length > 0);
  } else {
    const normalizedText = (text || "").replace(/([^\n])(\|\s*Item\s*\|\s*Amount\s*\|)/gi, "$1\n$2");
    workingLines = normalizedText.split("\n").map(stripBulletPrefix)
      .filter(l => l.trim().length > 0)
      .map(line => ({ idx: -1, line }));
  }

  const rawLines = workingLines.map(l => l.line);
  // Collapse real markdown pipe tables (e.g. the bill line-items table)
  // BEFORE any of the legacy comma/bullet bill-parsing heuristics run, so
  // a clean table is never fed through the fragile prose parsers below.
  const grouped = groupMarkdownTables(rawLines);
  // groupMarkdownTables collapses some rawLines into {kind:"mdtable"} objects
  // and returns the rest as plain strings, in order — walk both arrays in
  // lockstep so we can still recover each surviving plain line's original idx.
  let rawLineCursor = 0;
  const groupedWithIdx = grouped.map(item => {
    if (item && typeof item === "object" && item.kind === "mdtable") return item;
    const idx = workingLines[rawLineCursor] ? workingLines[rawLineCursor].idx : -1;
    rawLineCursor++;
    return { line: item, idx };
  });

  const blocks = [];
  let medBuffer = [];
  const flushMeds = () => {
    if (medBuffer.length > 0) {
      blocks.push({ kind: "meds", lines: medBuffer });
      medBuffer = [];
    }
  };
  groupedWithIdx.forEach(item => {
    if (item && item.kind === "mdtable") {
      flushMeds();
      blocks.push(item);
      return;
    }
    const { line, idx: lineIdx } = item;

    // Flag line ("[TAG] explanation (Source: ...)") — render as a real
    // checkbox row, in place, instead of falling through to the medicine/
    // chip/bullet heuristics below.
    const flagMatch = line.trim().match(DISC_TAG_LINE_RE);
    if (flagMatch) {
      flushMeds();
      const key = lineIdx >= 0 ? `${sectionKey}:${discLineKey(lineIdx)}` : `${sectionKey}:content:${flagMatch[1]}:${flagMatch[2].slice(0, 40)}`;
      blocks.push({ kind: "flag", tag: flagMatch[1].trim(), text: flagMatch[2].trim(), key });
      return;
    }
    if (line.trim() === "SPECIALIST FINDINGS") {
      flushMeds();
      blocks.push({ kind: "specialist_header" });
      return;
    }
    const billTable = parseBillBreakdownLine(line);
    if (billTable) {
      flushMeds();
      blocks.push({ kind: "bill", ...billTable });
      return;
    }
    const chipParts = !MEDICINE_LINE_RE.test(line.trim()) ? splitInlineChips(line) : null;
    if (chipParts) {
      flushMeds();
      blocks.push({ kind: "chips", parts: chipParts });
      return;
    }
    if (MEDICINE_LINE_RE.test(line.trim())) {
      medBuffer.push(line.trim());
    } else {
      flushMeds();
      blocks.push({ kind: "line", text: line });
    }
  });
  flushMeds();

  return (
    <div style={{ fontSize: 11.5, lineHeight: 1.7, color: T.textSec }}>
      {blocks.map((b, i) => {
        if (b.kind === "flag") {
          return (
            <DiscrepancyCheckRow
              key={b.key}
              tag={b.tag}
              text={b.text}
              checked={checks ? checks[b.key] !== false : true}
              onToggle={() => onToggle && onToggle(b.key)}
              onOpenSource={onOpenSource}
            />
          );
        }
        if (b.kind === "mdtable") {
          return <MarkdownTableBlock key={i} header={b.header} rows={b.rows} />;
        }
        if (b.kind === "bill") {
          return <BillTable key={i} label={b.label} rows={b.rows} />;
        }
        if (b.kind === "chips") {
          return <InlineChipRow key={i} parts={b.parts} onOpenSource={onOpenSource} />;
        }
        if (b.kind === "specialist_header") {
          return (
            <div key={i} style={{
              fontSize: 9.5, textTransform: "uppercase", letterSpacing: "0.08em",
              color: T.blue, marginTop: 10, marginBottom: 4,
              borderTop: `1px dashed ${T.border}`, paddingTop: 6,
            }}>
              Specialist Findings
            </div>
          );
        }
        if (b.kind === "meds") {
          return (
            <div key={i} style={{ margin: "6px 0 10px" }}>
              <div style={{ fontSize: 9.5, textTransform: "uppercase", letterSpacing: "0.08em", color: T.textMuted, marginBottom: 4 }}>
                Medications ({b.lines.length})
              </div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 5 }}>
                {b.lines.map((m, mi) => (
                  <span key={mi} style={{
                    fontSize: 10.5, padding: "3px 9px", borderRadius: 5,
                    background: T.bgTert, border: `1px solid ${T.border}`,
                    color: T.textSec, whiteSpace: "nowrap",
                  }}>
                    {m}
                  </span>
                ))}
              </div>
            </div>
          );
        }
        return (
          <div key={i} style={{ display: "flex", gap: 7, alignItems: "flex-start", padding: "2px 0" }}>
            <span style={{ color: T.borderMid, flexShrink: 0, marginTop: 1 }}>•</span>
            <span style={{ overflowWrap: "anywhere" }}>{renderRichText(b.text, onOpenSource)}</span>
          </div>
        );
      })}
    </div>
  );
}

/* ─── SECTION 1 EPISODE VIEW ───────────────────────────────────────────
   Read-mode rendering for Section 1 (Hospital Visit Findings): parses
   the flat text into per-episode cards with a highlighted header
   (hospital, date range, outcome badge) instead of one long wall of
   bulleted text. */
function Section1EpisodeView({ text, onOpenSource, checks, onToggle, sectionKey = "section1" }) {
  const { intro, introIndexedLines, episodes, triggerAssessments } = React.useMemo(
    () => parseSection1IntoCards(text), [text]
  );

  if (episodes.length === 0 && triggerAssessments.length === 0) {
    return (
      <EpisodeBodyBlock
        text={text}
        onOpenSource={onOpenSource}
        checks={checks}
        onToggle={onToggle}
        sectionKey={sectionKey}
      />
    );
  }

  return (
    <div>
      {intro && (
        <div style={{ marginBottom: 12 }}>
          <EpisodeBodyBlock
            indexedLines={introIndexedLines}
            onOpenSource={onOpenSource}
            checks={checks}
            onToggle={onToggle}
            sectionKey={sectionKey}
          />
        </div>
      )}

      {episodes.map((ep, i) => {
        const os = outcomeStyle(ep.outcome);
        return (
          <div key={i} style={{
            border: `1px solid ${T.border}`, borderRadius: 7,
            overflow: "hidden", marginBottom: 10,
          }}>
            <div style={{
              display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap",
              padding: "8px 12px", background: "color-mix(in srgb, var(--blue) 16%, var(--bg))",
              borderBottom: `1px solid ${T.border}`,
            }}>
              <span style={{
                fontSize: 9.5, fontWeight: 700, padding: "2px 8px", borderRadius: 99,
                background: "#1d4ed8", color: "#fff", flexShrink: 0, letterSpacing: "0.04em",
              }}>
                EP {ep.index}/{ep.total}
              </span>
              <span style={{ fontSize: 12, fontWeight: 700, color: "#1e293b", flex: 1, minWidth: 120 }}>
                {ep.hospital}
              </span>
              <span style={{ fontSize: 10.5, color: T.textMuted, whiteSpace: "nowrap" }}>
                {ep.admission} → {ep.discharge}
              </span>
              <span style={{
                fontSize: 9.5, fontWeight: 700, padding: "2px 9px", borderRadius: 99,
                background: os.bg, color: os.fg, textTransform: "uppercase", letterSpacing: "0.05em",
                whiteSpace: "nowrap",
              }}>
                {ep.outcome}
              </span>
            </div>
            <div style={{ padding: "10px 12px", background: T.bg }}>
              <EpisodeBodyBlock
                indexedLines={ep.bodyIndexedLines}
                onOpenSource={onOpenSource}
                checks={checks}
                onToggle={onToggle}
                sectionKey={sectionKey}
              />
            </div>
          </div>
        );
      })}

      {triggerAssessments.map((ta, i) => (
        <div key={`ta${i}`} style={{
          border: `1px solid ${T.borderMid}`, borderRadius: 7,
          overflow: "hidden", marginBottom: 10,
        }}>
          <div style={{
            padding: "7px 12px", background: T.purpleLight,
            borderBottom: `1px solid ${T.border}`,
            fontSize: 10.5, fontWeight: 600, color: T.purple,
            textTransform: "uppercase", letterSpacing: "0.06em",
          }}>
            {ta.label}
          </div>
          <div style={{ padding: "10px 12px", background: T.bg }}>
            <EpisodeBodyBlock
              indexedLines={ta.bodyIndexedLines}
              onOpenSource={onOpenSource}
              checks={checks}
              onToggle={onToggle}
              sectionKey={sectionKey}
            />
          </div>
        </div>
      ))}
    </div>
  );
}

function normalizeHospitalNameClient(name) {
    const stop = new Set(["the","hospital","nursing","home","surgical","maternity","general","clinic","centre","center","and","of"]);
  return (name || "").toLowerCase().replace(/[^a-z0-9\s]/g, "").split(/\s+/).filter(w => w && !stop.has(w)).sort().join(" ");
}
function findDuplicateEpisodeGroups(episodes) {
  const groups = [];
  episodes.forEach(ep => {
    const nameKey = normalizeHospitalNameClient(ep.hospital);
    const dateKey = (ep.admission || "").replace(/[^\d]/g, "");
    const groupKey = `${nameKey}|${dateKey}`;
    const existing = groups.find(g => g.key === groupKey);
    if (existing) {
      existing.episodes.push(ep);
    } else {
      groups.push({ key: groupKey, episodes: [ep] });
    }
  });
  return groups.filter(g => g.episodes.length > 1);
}

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
/* ─── AUTOSIZE TEXTAREA (grows to fit content, no inner scrollbar) ──── */
function AutosizeTextarea({ value, onChange, style, minRows = 3, ...rest }) {
  const ref = useRef(null);

  const resize = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "0px";
    el.style.height = `${el.scrollHeight}px`;
  }, []);

  // Recalculate whenever the text changes...
  useEffect(() => {
    resize();
  }, [value, resize]);

  // ...and whenever the box itself changes size (panel drag-resize,
  // window resize, scrollbar appearing/disappearing, font load, etc.)
  // Value-only deps miss these, leaving the box stuck at a stale height.
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => resize());
    ro.observe(el);
    return () => ro.disconnect();
  }, [resize]);

  return (
    <textarea
      ref={ref}
      value={value}
      onChange={onChange}
      rows={minRows}
      style={{ ...style, overflow: "hidden", resize: "none" }}
      {...rest}
    />
  );
}

function TriggerConclusionEditor({ triggerData, index, bulletMode, onChange, onRemove, canRemove, onOpenSource, discChecks, onToggleDiscrepancy }) {
    const [expandedSections, setExpandedSections] = useState({
    section1: true, section2: true, section3: true,
  });
  const [readMode, setReadMode] = useState({
    section1: false, section2: false, section3: false,
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
            background: verdict === "SUSPECTED" ? "color-mix(in srgb, var(--red) 12%, var(--bg))" : "color-mix(in srgb, var(--green) 12%, var(--bg))",
            color: verdict === "SUSPECTED" ? "var(--red)" : "var(--green)",
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
            <div style={{ display: "flex", alignItems: "stretch", background: expandedSections[sKey] ? cfg.bg : T.bgAlt }}>
              <button
                type="button"
                onClick={() => toggleSection(sKey)}
                style={{
                  flex: 1, display: "flex", alignItems: "center", gap: 8,
                  padding: "8px 14px", border: "none", cursor: "pointer",
                  fontFamily: "inherit", background: "transparent",
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
                <button
                  type="button"
                  onClick={(e) => { e.stopPropagation(); setReadMode(prev => ({ ...prev, [sKey]: !prev[sKey] })); }}
                  style={{
                    flexShrink: 0, alignSelf: "center", margin: "0 10px",
                    padding: "3px 10px", fontSize: 10, fontWeight: 600, borderRadius: 5, cursor: "pointer",
                    border: `1px solid ${cfg.bar}`, background: readMode[sKey] ? cfg.bar : "transparent",
                    color: readMode[sKey] ? "#fff" : cfg.bar, fontFamily: "inherit",
                  }}
                >
                  {readMode[sKey] ? "✎ Edit" : "👁 Preview"}
                                  </button>
              )}
            </div>
            {expandedSections[sKey] && (
              <div style={{ padding: "10px 14px", background: T.bg }}>
                {sKey === "section3" && !readMode[sKey] && (
                  <div style={{
                    fontSize: 10, color: T.textMuted, marginBottom: 6, lineHeight: 1.5,
                    padding: "5px 8px", background: T.bgTert, borderRadius: 4,
                    borderLeft: `3px solid ${T.borderMid}`,
                  }}>
                    Include DISCREPANCIES block, verdict line ("Hence based on..."), and any trigger-specific findings.
                    The verdict word (SUSPECTED/GENUINE) must appear in the final sentence.
                  </div>
                )}
                {readMode[sKey] ? (
                  <FlaggedSectionView
                    text={triggerData.sections[sKey] || ""}
                    sectionKey={sKey}
                    checks={discChecks || {}}
                    onToggle={key => onToggleDiscrepancy(index, key)}
                    onOpenSource={onOpenSource}
                  />
                ) : (
                  <EditableSectionText
                    value={triggerData.sections[sKey] || ""}
                    onChange={v => updateSection(sKey, v)}
                    minRows={sKey === "section1" ? 8 : sKey === "section2" ? 5 : 6}
                    accentColor={cfg.bar}
                  />
                )}
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
function RowsEditor({ label, columns, value, onChange }) {
  const cols = columns || [];
  const rows = Array.isArray(value) ? value : [];
  const gridCols = `${cols.map(() => "1fr").join(" ")} 34px`;

  const updateCell = (i, key, v) =>
    onChange(rows.map((r, idx) => (idx === i ? { ...r, [key]: v } : r)));
  const addRow = () =>
    onChange([...rows, Object.fromEntries(cols.map(c => [c.key, ""]))]);
  const removeRow = (i) => onChange(rows.filter((_, idx) => idx !== i));

  const cellStyle = {
    width: "100%", padding: "5px 7px", border: `1px solid ${T.border}`,
    borderRadius: 4, fontSize: 11.5, fontFamily: "inherit", color: T.text,
    background: T.bg, outline: "none", boxSizing: "border-box",
  };

  return (
    <div style={{ marginBottom: 10 }}>
      <div style={{ fontSize: 10, textTransform: "uppercase", letterSpacing: "0.08em", color: T.textMuted, marginBottom: 6 }}>
        {label}
      </div>
      <div style={{ border: `1px solid ${T.border}`, borderRadius: 6, overflow: "hidden" }}>
        <div style={{ display: "grid", gridTemplateColumns: gridCols, background: T.bgAlt, borderBottom: `1px solid ${T.border}`, fontSize: 10, color: T.textMuted, textTransform: "uppercase", letterSpacing: "0.06em" }}>
          {cols.map(c => <div key={c.key} style={{ padding: "6px 8px" }}>{c.label}</div>)}
          <div />
        </div>
        {rows.length === 0 && (
          <div style={{ padding: "14px 8px", fontSize: 11, color: T.textMuted, textAlign: "center" }}>
            No rows — the PDF will show “(Auto)”.
          </div>
        )}
        {rows.map((row, i) => (
          <div key={i} style={{ display: "grid", gridTemplateColumns: gridCols, alignItems: "center", borderBottom: i === rows.length - 1 ? "none" : `1px solid ${T.bgTert}` }}>
            {cols.map(c => (
              <div key={c.key} style={{ padding: "5px 8px" }}>
                <input value={row?.[c.key] ?? ""} onChange={e => updateCell(i, c.key, e.target.value)} style={cellStyle} />
              </div>
            ))}
            <button onClick={() => removeRow(i)} title="Remove row"
              style={{ background: "none", border: "none", cursor: "pointer", color: T.textMuted, fontSize: 13, padding: "5px 8px" }}>✕</button>
          </div>
        ))}
        <div style={{ padding: "8px 10px", background: T.bgTert, borderTop: `1px solid ${T.border}` }}>
          <button onClick={addRow}
            style={{ padding: "5px 12px", border: `1px solid ${T.border}`, background: T.bg, color: T.textSec, fontFamily: "inherit", fontSize: 11, cursor: "pointer", borderRadius: 4 }}>
            + Add row
          </button>
        </div>
      </div>
    </div>
  );
}

function LineItemsEditor({ value, onChange }) {  // value is expected to be an array of {item, amount}. Be defensive about
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
    const n = parseFloat(String(r.amount).replace(/,/g, ""));
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
      border: `1.5px solid ${verdict === "SUSPECTED" ? "var(--red)" : verdict === "GENUINE" ? "var(--green)" : T.border}`,
      borderRadius: 8, overflow: "hidden", marginBottom: 8,
    }}>
      <div style={{
        padding: "9px 14px",
        background: verdict === "SUSPECTED" ? "color-mix(in srgb, var(--red) 12%, var(--bg))" : verdict === "GENUINE" ? "color-mix(in srgb, var(--green) 12%, var(--bg))" : T.bgAlt,
        display: "flex", alignItems: "center", justifyContent: "space-between",
      }}>
        <span style={{
          fontSize: 11, fontWeight: 500,
          color: verdict === "SUSPECTED" ? "var(--red)" : verdict === "GENUINE" ? "var(--green)" : T.text,
          textTransform: "uppercase", letterSpacing: "0.1em",
        }}>
          Overall Case Verdict
        </span>
        {verdict && (
          <span style={{
            fontSize: 10, fontWeight: 700,
            color: verdict === "SUSPECTED" ? "var(--red)" : "var(--green)",
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
        <EditableFindingsSection
          text={value || ""}
          onChange={onChange}
          structured={false}
        />
      </div>
    </div>
  );
}





const CASE_TRIGGER_LABELS = {
  claim_genuinity_authenticity: "Claim Genuinity & Authenticity",
  ped_non_disclosure: "PED / Non-Disclosure",
  accident_incident_verification: "Accident / Incident Verification",
  intoxication_addiction: "Intoxication / Addiction",
  medical_records_treatment_verification: "Medical Records & Treatment Verification",
  financial_claim_pattern_risk: "Financial & Claim Pattern Risk",
  policy_coverage_verification: "Policy & Coverage Verification",
  field_vicinity_investigation: "Field / Vicinity Investigation",
  legal_regulatory_death_verification: "Legal / Regulatory / Death Verification",
  hospital_criteria_watchlist: "Hospital Criteria / Watchlist Hospital",
  employee_corporate_group_policy_verification: "Employee / Corporate / Group Policy Verification",
  hospital_cash_benefit_abuse: "Hospital Cash / Benefit Abuse",
  suspicious_claim_pattern_repeat_fraud: "Suspicious Claim Pattern / Repeat Fraud",
  final_universal_red_flags_matrix: "Final Universal Red Flags Matrix",
};

function CaseImportanceBanner({ caseData }) {
  const [open, setOpen] = useState(true);
  if (!caseData) return null;

  const triggers = Array.isArray(caseData.claimTriggers) ? caseData.claimTriggers.filter(Boolean) : [];
  // triggerContent = raw text pasted at submission; emailInstructions = older
  // cases where only the extracted summary was saved.
  const instruction = (caseData.triggerContent || caseData.emailInstructions || "").toString().trim();
  const priority = caseData.claimPriority;
  if (!triggers.length && !instruction && !priority) return null;

  const hot = priority === "Critical" || priority === "Urgent";
  const prioColor = hot ? "var(--red)" : priority === "High" ? "var(--amber)" : "var(--muted)";
  const labelFor = (k) => CASE_TRIGGER_LABELS[k] || k.replace(/_/g, " ");

  return (
    <div style={{
      flexShrink: 0, background: T.bg, borderBottom: `1px solid ${T.border}`,
      padding: "8px 16px",
    }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: "0.1em", textTransform: "uppercase", color: T.textMuted }}>
          Case importance
        </span>
        {priority && (
          <span style={{
            fontSize: 10, fontWeight: 700, padding: "2px 9px", borderRadius: 99,
            color: prioColor, border: `1px solid ${prioColor}`,
            background: `color-mix(in srgb, ${prioColor} 10%, var(--bg))`,
          }}>
            {priority} priority
          </span>
        )}
        {triggers.map(t => (
          <span key={t} style={{
            fontSize: 10.5, padding: "2px 9px", borderRadius: 99,
            background: T.accentLight, border: `1px solid ${T.border}`, color: T.text,
          }}>
            {labelFor(t)}
          </span>
        ))}
        {instruction && (
          <button
            type="button"
            onClick={() => setOpen(o => !o)}
            style={{
              marginLeft: "auto", fontSize: 10.5, background: "none", border: "none",
              cursor: "pointer", color: T.blue, fontFamily: "inherit",
            }}
          >
            {open ? "▲ Hide instruction" : "▼ Show instruction"}
          </button>
        )}
      </div>
      {instruction && open && (
        <div style={{
          marginTop: 6, padding: "8px 10px", background: T.bgTert,
          border: `1px solid ${T.border}`, borderRadius: 5,
          fontSize: 11.5, lineHeight: 1.6, color: T.textSec,
          whiteSpace: "pre-wrap", overflowWrap: "anywhere",
          maxHeight: 140, overflowY: "auto", userSelect: "text",
        }}>
          {instruction}
        </div>
      )}
    </div>
  );
}

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
  // Per-trigger discrepancy checkbox state: { [triggerIndex]: { [lineKey]: boolean } }.
  // Absent key = checked/kept by default (see discLineKey / filterSection3ByChecks).
  const [discrepancyChecks, setDiscrepancyChecks] = useState({});

const [status, setStatus]         = useState(null);
const [generating, setGenerating] = useState(false);
const [saving, setSaving]         = useState(false);

  /* ── panel state ── */
  const [leftTab, setLeftTab]         = useState("docs");
const [activeRightTab, setActiveRightTab] = useState("conclusion");
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

/* ── guided tour ── */
const [tourOpen, setTourOpen] = useState(false);
const tourSteps = React.useMemo(() => [
  {
    id: "docs", selector: "tab-left-docs", placement: "bottom",
    title: "Documents panel",
    content: "Every file uploaded for this case lives here. Click any document to preview its PDF.",
    onBeforeShow: () => setLeftTab("docs"),
  },
  {
    id: "pdfviewer", selector: "tab-left-pdf", placement: "bottom",
    title: "PDF Viewer",
    content: "Once you pick a document (or open the generated report), it renders here so you can cross-check it against the extracted fields.",
    onBeforeShow: () => setLeftTab("pdf"),
  },
  {
    id: "fields", selector: "tab-right-fields", placement: "bottom",
    title: "Form Fields",
    content: "Every extracted claim field, grouped by section. Edit anything here before generating — changes are picked up automatically.",
    onBeforeShow: () => setActiveRightTab("fields"),
  },
  // Raw Document / Claim Story / trigger-chips / Generate Conclusion tour
  // steps removed along with those tabs (parsing disabled — see above).
  // {
  //   id: "raw", selector: "tab-right-raw", placement: "bottom",
  //   title: "Raw Document",
  //   content: "The original parsed text of every uploaded document, with suspicious findings and abnormal values highlighted for quick review.",
  //   onBeforeShow: () => setActiveRightTab("raw"),
  // },
  // {
  //   id: "claimstory", selector: "tab-right-claim_story", placement: "bottom",
  //   title: "Claim Story",
  //   content: "A route map of the whole claim journey, in order — every dated event, with flagged findings and conflicting duplicate records surfaced right where they occur.",
  //   onBeforeShow: () => setActiveRightTab("claim_story"),
  // },
  // {
  //   id: "triggers", selector: "trigger-chips", placement: "bottom",
  //   title: "Investigation triggers",
  //   content: "Select which fraud/verification triggers apply to this claim — Claim Genuinity, PED / Non-Disclosure, Accident Verification, and so on. These decide what the generated conclusion actually checks for.",
  //   onBeforeShow: () => setActiveRightTab("raw"),
  // },
  // {
  //   id: "genconclusion", selector: "generate-conclusion-btn", placement: "bottom",
  //   title: "Generate Conclusion",
  //   content: "Runs the AI investigation pass over every selected trigger and writes a draft conclusion for each — hospital visit findings, member visit findings, and a verdict. Review it in the Investigation Conclusion tab afterward.",
  //   onBeforeShow: () => setActiveRightTab("raw"),
  // },
  {
    id: "conclusion", selector: "tab-right-conclusion", placement: "bottom",
    title: "Investigation Conclusion",
    content: "Write or edit the investigation findings here, organized by trigger. This becomes the conclusion section of the final report.",
    onBeforeShow: () => setActiveRightTab("conclusion"),
  },
  {
    id: "bullets", selector: "bullet-toggle", placement: "left",
    title: "Paragraphs vs. bullet points",
    content: "Switch how the conclusion text is formatted — toggling this reflows existing text automatically.",
    onBeforeShow: () => setActiveRightTab("conclusion"),
  },
  {
    id: "save", selector: "save-btn", placement: "top",
    title: "Save your edits",
    content: "Saves all field and conclusion changes to the case without generating any files yet.",
    onBeforeShow: () => setActiveRightTab("fields"),
  },
  {
    id: "genpdf", selector: "generate-pdf-btn", placement: "top",
    title: "Generate PDF",
    content: "Produces the final formatted investigation report as a PDF, using your current fields and conclusion text.",
    onBeforeShow: () => setActiveRightTab("fields"),
  },
  {
    id: "word", selector: "download-word-btn", placement: "top",
    title: "Download as Word",
    content: "Get the same report content as an editable Word document, in case you need manual tweaks outside this tool.",
    onBeforeShow: () => setActiveRightTab("fields"),
  },
  {
    id: "chat", selector: "chat-toggle", placement: "left",
    title: "Ask about this claim",
    content: "Have a question about the claim? This assistant answers strictly from this case's fields and documents — it'll tell you if something is missing or conflicting rather than guessing.",
    onBeforeShow: () => {},
  },
], []);
const effectiveSections = resolvedSections && resolvedSections.length > 0
  ? resolvedSections
  : FORM_SECTIONS;

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

        // Parse conclusion into per-trigger editors
        const { triggers, overallVerdict: ov } = parseConclusionToTriggers(c.conclusion || "");

        // No saved conclusion yet → start with one blank report so the doctor
        // can type straight away, no "Add Trigger" click needed.
        setTriggerSections(triggers.length > 0 ? triggers : [makeEmptyTrigger()]);
        setOverallVerdict(ov);

        // Every entry in documents[] is now a distinct real upload (Claim
        // Detail or Supporting Document) — no page-selection flow exists
        // anymore to produce a "full vs sliced" duplicate, so show them all.
        const caseDocs = c.case_documents?.documents || [];
        setDocs(caseDocs);
        if (caseDocs.length > 0) setSelectedDoc(caseDocs[0]);

if (c.generated_pdf_url) {
  setStoredPdfUrl(c.generated_pdf_url);
  setGenPdfUrl(c.generated_pdf_url);
}
      })
      .catch(console.error)
      .finally(() => setLoadingCase(false));
  }, [caseId, doctorId]);

  /* ── resolved-fields (template manifest + extracted candidates) ── */
  const fetchResolvedFields = useCallback(() => {
    fetch(`${BASE_URL}insurance/web/doctor/case/${caseId}/resolved-fields`, {
      headers: { "X-User-Id": doctorId, "X-User-Role": "auditing-doctor-new" },
    })
      .then(r => r.json())
      .then(d => {
        if (d?.success) {
          setResolvedSections(d.sections || null);
          setResolvedTemplate(d.template || null);
        }
      })
      .catch(console.error);
  }, [caseId, doctorId]);

  useEffect(() => {
    if (!caseId) return;
    fetchResolvedFields();
  }, [caseId, fetchResolvedFields]);
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
  /* ── build assembled conclusion ──
     Strips out any discrepancy the doctor has unchecked (in the flat
     DISCREPANCIES block or nested in the CLAIM STORY block) before the
     text is assembled — this runs before Save, Generate PDF, Generate
     DOCX, and Generate Formatted DOCX, since they all call this. */
  const buildConclusion = useCallback(() => {
    const filteredTriggers = triggerSections.map((t, i) => ({
      ...t,
      sections: {
        section1: filterSection3ByChecks(t.sections.section1 || "", discrepancyChecks[i] || {}, "section1"),
        section2: filterSection3ByChecks(t.sections.section2 || "", discrepancyChecks[i] || {}, "section2"),
        section3: filterSection3ByChecks(t.sections.section3 || "", discrepancyChecks[i] || {}, "section3"),
      },
    }));
    return assembleConclusionFromTriggers(filteredTriggers, overallVerdict);
  }, [triggerSections, overallVerdict, discrepancyChecks]);

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
  /* ── re-run suspicious-finding detection over already-parsed text ──
     Backend now enqueues this as a Celery task and returns a task_id
     immediately (same pattern as advanced-upload). We poll the existing
     status endpoint until it's done, so there's no single long-lived
     request that can exceed a gateway timeout. */
  const POLL_INTERVAL_MS = 4000;
  const POLL_MAX_ATTEMPTS = 120; // ~8 minutes — large cases can have 100+ page chunks across map+reduce

  const handleRegenerateFindings = useCallback(async () => {
    const sleep = (ms) => new Promise(r => setTimeout(r, ms));

    const enqueueRes = await fetch(
      `${BASE_URL}insurance/web/regenerate-findings/${caseId}`,
      {
        method: "POST",
        headers: {
          "X-User-Id": doctorId,
          "X-User-Role": "auditing-doctor-new",
        },
      }
    );
    if (!enqueueRes.ok) {
      let detail = "Failed to queue findings regeneration.";
      try { detail = (await enqueueRes.json())?.detail || detail; } catch {}
      throw new Error(detail);
    }
    const { task_id: taskId } = await enqueueRes.json();
    if (!taskId) throw new Error("No task_id returned for findings regeneration.");

    for (let attempt = 0; attempt < POLL_MAX_ATTEMPTS; attempt++) {
      await sleep(POLL_INTERVAL_MS);

      const statusRes = await fetch(
        `${BASE_URL}insurance/web/advanced-upload/status/${taskId}`,
        { headers: { "X-User-Id": doctorId, "X-User-Role": "auditing-doctor-new" } }
      );
      if (!statusRes.ok) continue; // transient — keep polling

      const statusData = await statusRes.json();
      if (statusData.status === "success") {
        const findings = statusData.result?.findings || [];
        setCaseData(prev => (prev
          ? {
              ...prev,
              documentFindings: findings,
              documentFindingsStatus: "ok",
              documentFindingsError: null,
              findingsUpdatedAt: statusData.result?.generated_at,
            }
          : prev));
        return;
      }
      if (statusData.status === "failed") {
        throw new Error(statusData.error || "Findings regeneration failed.");
      }
      // "queued" / "processing" — keep polling
    }

    throw new Error("Findings regeneration is taking longer than expected. It may still complete in the background — try refreshing shortly.");
  }, [caseId, doctorId]);


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

  const handleToggleDiscrepancy = useCallback((triggerIndex, key) => {
    setDiscrepancyChecks(prev => {
      const forTrigger = prev[triggerIndex] || {};
      const current = forTrigger[key] !== false; // default: checked
      return { ...prev, [triggerIndex]: { ...forTrigger, [key]: !current } };
    });
    setStatus("unsaved");
  }, []);
 const handleTriggerRemove = useCallback((index) => {
  setTriggerSections(prev => prev.filter((_, i) => i !== index));
  // Discrepancy checks are keyed by trigger index — reindex so remaining
  // triggers' checkbox state doesn't silently attach to the wrong trigger.
  setDiscrepancyChecks(prev => {
    const next = {};
    Object.entries(prev).forEach(([k, v]) => {
      const i = parseInt(k, 10);
      if (i < index) next[i] = v;
      else if (i > index) next[i - 1] = v;
    });
    return next;
  });
  setStatus("unsaved");
}, []);
const handleTriggerAdd = useCallback(() => {
  setTriggerSections(prev => [...prev, makeEmptyTrigger()]);
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
        *, *::before, *::after { box-sizing: border-box; }
        body { margin: 0; background: ${T.bgTert}; color: ${T.text}; -webkit-font-smoothing: antialiased; }
        ::-webkit-scrollbar { width: 4px; height: 4px; }
        ::-webkit-scrollbar-track { background: transparent; }
        ::-webkit-scrollbar-thumb { background: ${T.border}; border-radius: 2px; }
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
  <div style={{ fontSize: 10, color: T.textMuted, fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
    {caseData?.insurerRef || "—"}
    {caseData?.claimantName && <span style={{ marginLeft: 8, color: T.textSec, fontFamily: "inherit" }}>· {caseData.claimantName}</span>}
  </div>
</div>
          {caseData?.insurer && (
            <>
              <div style={{ width: 1, height: 20, background: T.border, flexShrink: 0 }} />
              <span style={{ fontSize: 10, background: T.accent, color: "#fff", padding: "3px 10px", borderRadius: 999, letterSpacing: "0.08em", textTransform: "uppercase", whiteSpace: "nowrap" }}>
                {caseData.insurer}
              </span>
            </>
          )}
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexShrink: 0 }}>
  <button
    onClick={() => setTourOpen(true)}
    style={{
      display: "flex", alignItems: "center", gap: 6,
      padding: "7px 14px", border: `1px solid ${T.border}`,
      background: T.bg, color: T.textSec,
      fontFamily: "inherit", fontSize: 12,
      cursor: "pointer", borderRadius: 5,
    }}
  >
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <circle cx="12" cy="12" r="10" />
      <path d="M9.5 9a2.5 2.5 0 0 1 5 0c0 1.5-2 1.8-2 3.5" />
      <line x1="12" y1="16.5" x2="12.01" y2="16.5" />
    </svg>
    Take a tour
  </button>
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
                data-tour={`tab-left-${t.id}`}
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

          <CaseImportanceBanner caseData={caseData} />

          {/* Tab switcher: Fields vs Conclusion */}          <div style={{
            display: "flex", borderBottom: `1px solid ${T.border}`,
            background: T.bg, flexShrink: 0,
          }}>
            {[
              // Claim Story and Raw Document tabs removed — supporting and
              // field-officer documents are no longer parsed, so there is
              // no markdown/findings/story data to show here anymore.
              // Doctors now just view PDFs (Documents / PDF Viewer tabs on
              // the left) and write the conclusion manually.
              // { id: "claim_story", label: "Claim Story" },
              // { id: "raw", label: "Raw Document" },
              { id: "conclusion", label: `Investigation Conclusion${triggerSections.length > 0 ? ` (${triggerSections.length})` : ""}` },
              { id: "fields", label: "Form Fields" },
            ].map(t => (
              <button
                key={t.id}
                data-tour={`tab-right-${t.id}`}
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
            overflowX: "hidden",
            background: T.bgTert,
            padding: "18px 22px 40px",
            display: activeRightTab === "fields" ? "block" : "none",
          }}>
<div style={{ marginBottom: 16, fontSize: 11, color: T.textMuted, letterSpacing: "0.1em", textTransform: "uppercase" }}>
  Edit report fields — changes apply to PDF on generation
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

{/* Ready to generate — Save / Word / PDF actions */}
<div style={{ marginTop: 20, padding: "14px 18px", background: T.bg, border: `1px solid ${T.border}`, borderRadius: 6, display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
  <div>
    <div style={{ fontSize: 13, fontWeight: 500 }}>Ready to generate?</div>
    <div style={{ fontSize: 11, color: T.textMuted, marginTop: 2 }}>
      Fields and conclusion will be saved and rendered into the report automatically.
    </div>
  </div>
  <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
    <button
      data-tour="save-btn"
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
      data-tour="download-word-btn"
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
      data-tour="generate-pdf-btn"
      onClick={handleGeneratePDF}
      disabled={generating || saving}
      style={{
        padding: "9px 20px", background: generating ? T.bgTert : T.accent,
        border: "none", color: generating ? T.textMuted : "#fff",
        fontFamily: "inherit", fontSize: 12, fontWeight: 700,
        cursor: generating ? "not-allowed" : "pointer", borderRadius: 6,
      }}
    >
      {generating ? "Generating…" : "Generate PDF"}
    </button>
  </div>
</div>

           
          </div>

          {/* Conclusion editor area */}
          <div style={{
            flex: showGenPdf ? "none" : 1,
            height: showGenPdf ? `calc(100% - ${bottomDrag.size}px - 5px)` : undefined,
            overflowY: "auto",
            overflowX: "hidden",
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
  data-tour="bullet-toggle"
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
                    padding: "8px 18px", background: T.accent, color: "#fff",
                    border: "none", borderRadius: 6, fontFamily: "inherit", fontWeight: 700,
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
  onOpenSource={handleOpenSource}
  discChecks={discrepancyChecks[i]}
  onToggleDiscrepancy={handleToggleDiscrepancy}
/>
              ))
            )}

            {/* Overall verdict */}
            <OverallVerdictEditor
  value={overallVerdict}
  bulletMode={bulletMode}
  onChange={v => { setOverallVerdict(v); setStatus("unsaved"); }}
/>

  
          </div>
{/* Claim Story and Raw Document tabs disabled — supporting and
    field-officer documents are no longer parsed, so raw_llama_markdown /
    documentFindings / agenticInvestigation are no longer reliably
    populated. Kept commented (not deleted) in case parsing is
    re-enabled later.

{activeRightTab === "claim_story" && (
  <div style={{
    flex: showGenPdf ? "none" : 1,
    height: showGenPdf ? `calc(100% - ${bottomDrag.size}px - 5px)` : undefined,
    overflowY: "auto", background: T.bgTert, padding: "18px 22px 40px",
  }}>
    <ClaimStoryMap
      agenticInvestigation={caseData?.agenticInvestigation}
      onOpenSource={handleOpenSource}
    />
  </div>
)}

{activeRightTab === "raw" && (
    <div style={{ flex: 1, overflow: "hidden", background: T.bgTert, display: "flex", flexDirection: "column" }}>
    <RawDocument
      markdown={caseData?.raw_llama_markdown}
      findings={caseData?.documentFindings || []}
      findingsStatus={caseData?.documentFindingsStatus}
      findingsError={caseData?.documentFindingsError}
      externalAnnotationContext={annotationCtx}
      onOpenSource={handleOpenSource}
      onRegenerateFindings={handleRegenerateFindings}
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
            setDiscrepancyChecks({});
            setActiveRightTab("conclusion");
            setStatus("unsaved");
            fetchResolvedFields();
          }}
        />
      }
    />
  </div>
)}
*/}

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

      <ClaimChatWidget
        caseId={caseId}
        doctorId={doctorId}
        baseUrl={BASE_URL}
        claimantName={caseData?.claimantName}
      />
      <TourGuide steps={tourSteps} active={tourOpen} onClose={() => setTourOpen(false)} />
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