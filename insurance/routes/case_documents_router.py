from __future__ import annotations
import asyncio
import json
import logging
import os
import uuid
import io
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional
import httpx
from routes.multiagent_extraction import run_multiagent_extraction, agent_a7_email_instructions
from dotenv import load_dotenv
from fastapi import APIRouter, File, Form, HTTPException, Request, UploadFile
from groq import Groq
from motor.motor_asyncio import AsyncIOMotorClient
from jose import jwt
import requests
import base64
from celery_client import celery_client

# NEW: needed to slice a PDF down to only the pages the user selected before
# it goes to LlamaCloud for parsing/extraction.
try:
    from pypdf import PdfReader, PdfWriter
except ImportError:  # pragma: no cover - fallback for older envs
    from PyPDF2 import PdfReader, PdfWriter

load_dotenv()
logger = logging.getLogger(__name__)
from datetime import datetime, timezone, timedelta
IST = timezone(timedelta(hours=5, minutes=30))
# ── env ──────────────────────────────────────────────────────────────────────
MONGO_URI        = os.getenv("MONGO_URI")
GROQ_API_KEY     = os.getenv("GROQ_API_KEY")
SECRET_KEY       = os.getenv("SECRET_KEY")
ALGORITHM        = os.getenv("ALGORITHM", "HS256")
LLAMA_API_KEY = os.getenv("LLAMA_API_KEY")
LLAMA_CREDIT_BUDGET = int(os.getenv("LLAMA_CREDIT_BUDGET", "45000"))
CREDITS_PER_PAGE = int(os.getenv("LLAMA_CREDITS_PER_PAGE", "1"))  # 1 for cost_effective, 10 for agentic

#1HAGjDZaXymvAvRMg6ovKGELFwxwfpWFnpaa1vavO6kRt3K4"
PROXY_UPLOAD_URL = os.getenv(
    "PROXY_UPLOAD_URL",
    "http://common:8000/storage/proxy/upload",
)
STORAGE_BASE_URL = os.getenv("STORAGE_BASE_URL", "https://doctorassist.ai/uploads")
PROCESSING_LOCK_STALE_SECONDS = 300  # 5 min — lock older than this is treated as abandoned

# ── clients ──────────────────────────────────────────────────────────────────
motor_client = AsyncIOMotorClient(MONGO_URI)
db           = motor_client["doctorassistai"]
advanced_upload_tasks_col  = db["advanced_upload_tasks"]
# NEW: holds advanced-mode uploads that have been stored but not yet parsed —
# i.e. the file is sitting in storage waiting for the user to pick pages.
advanced_upload_staged_col = db["advanced_upload_staged"]
case_documents_col   = db["case_documents"]
insurance_claims_col = db["insurance_claims_new"]
processed_documents  = db["processed_documents"]
llama_stats_col = db["llama_usage_stats"]

groq_client = Groq(api_key=GROQ_API_KEY)

router = APIRouter(tags=["CaseDocuments"])


# ── index setup ──────────────────────────────────────────────────────────────
async def _fix_null_parents(collection, case_id: str, flat_keys):
    """
    Dot-notation $set fails with error 28 if the parent field is currently
    stored as an explicit null (e.g. "criticalDetails": null). Promote any
    such parents to {} first so the dotted $set can proceed.
    """
    existing = await collection.find_one({"caseId": case_id}, {"_id": 0}) or {}
    parents_to_fix = set()
    for k in flat_keys:
        if "." in k:
            parent = k.split(".", 1)[0]
            if parent in existing and existing[parent] is None:
                parents_to_fix.add(parent)
    if parents_to_fix:
        await collection.update_one(
            {"caseId": case_id},
            {"$set": {p: {} for p in parents_to_fix}},
        )

async def ensure_case_doc_indexes():
    try:
        await case_documents_col.drop_index("doc_id_1")
    except Exception:
        pass
    try:
        await case_documents_col.drop_index("case_id_1")
    except Exception:
        pass
    await case_documents_col.create_index("case_id", unique=True)
    await case_documents_col.create_index("supervisor_id")
    await case_documents_col.create_index("created_at")
    # NEW: staged advanced-uploads are looked up by doc_id+case_id, and it's
    # useful to know how old they are (in case we ever want to add a TTL).
    await advanced_upload_staged_col.create_index([("doc_id", 1), ("case_id", 1)])
    await advanced_upload_staged_col.create_index("created_at")
    # NEW: the sidebar polls for "which cases have an extraction in flight"
    # by status, so an index on status (+case_id for grouping) keeps that
    # cheap even as advanced_upload_tasks_col grows.
    await advanced_upload_tasks_col.create_index("status")
    await advanced_upload_tasks_col.create_index([("case_id", 1), ("status", 1)])


# ── auth helper ───────────────────────────────────────────────────────────────
def _get_user(request: Request) -> dict:
    uid  = request.headers.get("X-User-Id")
    role = request.headers.get("X-User-Role")
    if uid:
        return {"user_id": uid, "role": role}
    auth = request.headers.get("authorization", "")
    if not auth:
        raise HTTPException(status_code=401, detail="Missing auth")
    try:
        token   = auth.split(" ")[1]
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        return {"user_id": payload.get("sub"), "role": payload.get("role")}
    except Exception:
        raise HTTPException(status_code=401, detail="Invalid token")

async def _get_accumulated_markdown(
    case_id: str,
    new_text: str
) -> str:
    claim = await insurance_claims_col.find_one(
        {"caseId": case_id},
        {"raw_llama_markdown": 1}
    )

    existing = (claim or {}).get("raw_llama_markdown", "") or ""

    if not new_text.strip():
        return existing

    if new_text.strip() in existing:
        return existing

    if existing.strip():
        return existing + "\n\n" + new_text

    return new_text

async def _build_full_case_context(
    case_id: str,
    current_text: str
) -> str:
    record = await case_documents_col.find_one(
        {"case_id": case_id},
        {"documents.raw_markdown": 1}
    )

    prior_texts = []
    current_clean = current_text.strip()

    for doc in (record or {}).get("documents", []):
        md = (doc.get("raw_markdown") or "").strip()

        if md and md != current_clean:
            prior_texts.append(md)

    prior_texts = prior_texts[-2:]

    if not prior_texts:
        return current_text

    return (
        "PREVIOUS DOCUMENTS:\n\n"
        + "\n\n--- DOC ---\n\n".join(prior_texts)
        + "\n\nCURRENT DOCUMENT:\n\n"
        + current_text
    )


async def _wait_for_processed_doc(
    patient_id: str,
    stored_filename: str,
    max_wait_seconds: int = 90,
    poll_interval: float = 3.0,
) -> Optional[Dict[str, Any]]:
    deadline = asyncio.get_event_loop().time() + max_wait_seconds
    while asyncio.get_event_loop().time() < deadline:
        doc = await processed_documents.find_one({
            "patient_id": patient_id,
            "file_name":  stored_filename,
        })
        if doc:
            logger.info("processed_documents hit for %s / %s", patient_id, stored_filename)
            return doc
        await asyncio.sleep(poll_interval)

    logger.warning(
        "Timed out waiting for processed_documents | patient_id=%s | file=%s",
        patient_id, stored_filename,
    )
    return None
def _normalize_extracted_fields(flat: Dict[str, Any]) -> Dict[str, Any]:
    """
    Post-process extracted fields to fix common OCR/LLM formatting issues.
    """
    import re

    # Normalize Aadhaar: strip spaces/dashes from 12-digit numbers
    id_num = flat.get("idProofNumber")
    if id_num:
        digits_only = re.sub(r"[\s\-]", "", str(id_num))
        if len(digits_only) == 12 and digits_only.isdigit():
            flat["idProofNumber"] = digits_only
            if not flat.get("idProofType"):
                flat["idProofType"] = "Aadhaar Card"

    # Normalize mobile: strip +91, spaces, dashes → 10 digits
    mobile = flat.get("claimantMobile")
    if mobile:
        digits = re.sub(r"[\s\-\+]", "", str(mobile))
        if digits.startswith("91") and len(digits) == 12:
            digits = digits[2:]
        if len(digits) == 10:
            flat["claimantMobile"] = digits

    # Normalize amounts: strip Rs, commas, currency symbols
    amount_fields = [
        "claimedAmount", "sumInsured", "cashlessDetails.estimatedCost",
        "billingDetails.finalBillAmount", "billingDetails.discountAmount"
    ]
    for field in amount_fields:
        val = flat.get(field)
        if val and isinstance(val, str):
            cleaned = re.sub(r"[^\d.]", "", val)
            try:
                flat[field] = float(cleaned)
            except ValueError:
                pass
    claimed = flat.get("claimedAmount")
    net_received = flat.get("billingDetails.finalBillAmount")

    if claimed is not None and net_received is not None:
        try:
            claimed_f = float(claimed)
            net_f = float(net_received)

            # likely partial slip / subtotal extracted as claimedAmount
            if claimed_f > 0 and net_f > claimed_f * 2:
                logger.warning(
                    "claimedAmount (%s) much lower than finalBillAmount (%s) — overriding claimedAmount",
                    claimed_f,
                    net_f,
                )
                flat["claimedAmount"] = net_f

        except (ValueError, TypeError):
            pass

    return flat
def _enrich_description(text: str, extracted_flat: Dict[str, Any], existing_description: str = "") -> str:
    existing_desc = extracted_flat.get("description", "") or ""
    baseline = existing_description if len(existing_description) > len(existing_desc) else existing_desc

    if len(baseline) > 100:
        return baseline
    
    # Only enrich if description is too short (under 100 chars)
    if len(existing_desc) > 100:
        return existing_desc

    name    = extracted_flat.get("claimantName", "The patient")
    age     = extracted_flat.get("claimantAge", "")
    hosp    = (extracted_flat.get("hospitalDetails.name") or 
               extracted_flat.get("hospitalDetails", {}).get("name", "the hospital"))
    admit   = extracted_flat.get("hospitalDetails.admissionDate", "")
    trigger = extracted_flat.get("riskDetails.triggers", "")

    prompt = f"""
You are an insurance investigation case summarizer.

Using ONLY the information present in the document text below, write a 
4-6 sentence factual case description for an insurance investigator.

Include (if present in the document):
1. Patient name, age, gender
2. Nature of claim / how the incident/illness occurred
3. Incident date, time, and location
4. Hospital arrival date and time
5. Presenting condition and key vitals on admission
6. Key treatment given (surgery, ICU, ventilator, procedure, delivery)
7. Police/MLC/legal status (for accident cases)
8. Any fraud/suspicion flags from insurer email

Known facts already extracted:
- Name: {name}, Age: {age}
- Hospital: {hosp}, Admission: {admit}
- Insurer flags: {trigger or 'None'}

Write in third person, past tense. No bullet points. 
Output ONLY the description paragraph, nothing else.

DOCUMENT TEXT:
{text[:6000]}
"""
    try:
        completion = groq_client.chat.completions.create(
            model="llama-3.3-70b-versatile",
            temperature=0.1,
            max_tokens=400,
            messages=[{"role": "user", "content": prompt}],
        )
        return completion.choices[0].message.content.strip()
    except Exception as e:
        logger.error("Description enrichment failed: %s", e)
        return existing_desc

# ── extraction helpers ────────────────────────────────────────────────────────
SEMANTIC_RULES = """
Map semantically similar sections even if wording differs.

AGE EXTRACTION:

Extract claimant age from patterns like:
- 30 Y
- 30/F
- Age 30
- 30 years

"description":
Generate a 4-6 sentence investigative case narrative synthesizing:
- Patient demographics + incident cause + location + date/time
- Hospital arrival time + presenting condition + key vitals
- Treatment initiated (ICU, ventilator, surgery, procedure)
- Police/MLC/legal status if accident
- Insurer flags or suspicion remarks if present

Sources to pull from:
- Accident/Injury Report ("Alleged Causes", "Site", "Brought by")
- Nursing initial assessment (vitals on admission)
- Doctor's initial assessment (presenting complaints)
- Discharge summary (clinical course)
- Email content (investigation instructions, fraud flags)

Do NOT output just one line. Write readable prose, not a list.

"criticalDetails.diagnosis":
- diagnosis
- final diagnosis
- clinical impression
- medical condition
- pregnancy complication
- persistent condition

Diagnosis may appear without explicit heading.

Extract conditions such as:
- hypothyroidism
- GDM
- ectopic pregnancy
- SLIUG
- IUGR
- anemia
- hypertension

"criticalDetails.procedure":
- surgery performed
- operative procedure
- treatment done
- delivery method
- LSCS
- ORIF
- fixation
- debridement
- hysterectomy
- stenting
- vacuum delivery

"criticalDetails.implants":
- implants used
- implant details
- hardware details

"billingDetails.roomType":
- room category
- accommodation
- ward type

"billingDetails.finalBillAmount":
- net amount
- final amount
- payable amount

"accidentDetails.mlcNumber":
- medico legal case number
- MLC No
- police intimation number
POLICY DATES:
- If a policy period/range is present like:
  "05-11-2025 - 22-05-2026"
  then map:
  first date -> policyDetails.startDate
  second date -> policyDetails.endDate

CLAIM NUMBER:
- claim number
- authorization number
- reference number
- preauth number
→ insurerRef

HOSPITAL CONTACT:
- phone
- mobile
- hospital contact
- landline
→ hospitalDetails.hospitalContactNumber
If multiple phone numbers exist:
- numbers near hospital header/address -> hospital contact
- numbers near patient name/address -> claimant mobile

INSURER CONTACT RULES:

Do NOT map:
- insurance company names
- TPA company names
- hospital names

to insurerContact.

insurerContact should ONLY contain:
- human contact person name
- claims executive
- relationship officer
- insurance coordinator

TPA company names should map to:
tpaName

COVERAGE TYPE RULES:

If document indicates:
- RTA
- road traffic accident
- trauma
- fracture due to collision
→ policyDetails.coverageType = "accident"

Only populate cashlessDetails.admissionType if explicitly stated:
- planned
- emergency
- elective
- urgent

If document indicates:
- cashless authorization
- preauth approval
→ claimMode = "cashless"

If document indicates:
- surgery
- operative procedure
- ORIF
- implant fixation
→ claimSubtype = "surgical"
CLAIMANT CONTACT:

"claimantMobile":
- patient mobile
- contact number
- patient phone
- mobile number

If number appears near patient name/address,
prefer claimantMobile.

POLICY PERIOD RULES:

If a single field contains:
"Policy Period: DD-MM-YYYY - DD-MM-YYYY"

Then:
- first date → policyDetails.startDate
- second date → policyDetails.endDate

Do NOT store the full range as one value.
ADDITIONAL MEDICAL DETAILS:

"additionalMedicalDetails.chiefComplaints":
- chief complaints
- complaints
- presenting complaints
- c/o
- patient complains of
- pain
- swelling
- bleeding
- fever

"additionalMedicalDetails.pastHistory":
- past history
- medical history
- known case of
- hypothyroidism
- diabetes
- hypertension
- fibroid
- previous surgery
- previous pregnancy complications

"additionalMedicalDetails.generalExamination":
- general examination
- systemic examination
- P/A findings
- edema
- uterus involuted
- AFM well
- cephalic
- FHS good

"additionalMedicalDetails.localExamination":
- local examination
- wound findings
- episiotomy findings
- sutures
- tenderness
- swelling
- healing status
- local site findings

"additionalMedicalDetails.vitals":
- vitals
- vital signs
- BP
- pulse
- PR
- RR
- SPO2
- temperature
- FHS
- vitals stable

Summarize all vital observations found in records.

"additionalMedicalDetails.investigatorHospitalOpinion":
- investigator opinion (hospital visit)

"additionalMedicalDetails.investigatorMemberOpinion":
- investigator opinion (member visit)

"additionalMedicalDetails.firstConsultationDate":
- first consultation date

"additionalMedicalDetails.clinicalSummary":
- clinical summary
- treatment summary
- admission summary
- discharge summary
- medical course
- hospital course
- pregnancy summary
- follow up summary
- obstetric summary

INVESTIGATION DETAILS:

"investigationDetails.dataCollectedFrom":
- name and designation of person from whom data collected

MEDICAL STAFF:

"medicalStaff.pathologistName":
- pathologist name

"medicalStaff.radiologistName":
- radiologist name
RISK DETAILS:

"riskDetails.riskScore":
- risk score

"riskDetails.riskLevel":
- risk level

"riskDetails.triggers":
- triggers
- fraud triggers
- risk triggers
- trigger points

"riskDetails.investigationInstruction":
- please investigate
- do needful
- investigation instruction
- remarks

If insurer email contains:
- suspicious
- forensic review
- suspected claim
- fraud trigger
- verify genuinity

populate:
- riskDetails.triggers
- riskDetails.investigationInstruction

OBSTETRIC DETAILS:

"obstetricDetails.gestationAge":
- GA
- gestational age
- weeks pregnant
- 35 weeks
- 31W + 5D

"obstetricDetails.edd":
- EDD
- SEDD
- expected delivery date

"obstetricDetails.gravidaParity":
- G2P2L2
- gravida
- parity
- obstetric score

"obstetricDetails.fetalCondition":
- FHS good
- cephalic
- fetal movement
- AFI
- placenta
- fetal doppler
- liquor normal

RADIOLOGIST EXTRACTION:
Extract the doctor who signs/validates a scan or ultrasound report as radiologistName.
Look for: signature at bottom of scan reports, "Consultant Fetal Medicine",
"Senior Consultant OBG", TCMC/KSMC Reg. No. near scan footer.

ACCIDENT REPORT (A.R. No.):
"A.R. No." → accidentDetails.mlcNumber
"Alleged Causes" → accidentDetails.accidentNarration  
"Police Intimated / Where / Whom" → extract firNumber and police station

FETAL/BABY OUTCOME:
From labour records extract: baby gender, weight kg, time of birth, condition
→ obstetricDetails.fetalCondition

BILLING ROOM TYPE:
"IP Area", "Ward/Bed No", "Ward" field on nursing sheet → billingDetails.roomType

RISK LEVEL INFERENCE:
If triggers mention "forensic", "fraud", "suspected", "verify genuinity" 
→ riskDetails.riskLevel = "High"

AADHAAR NUMBER EXTRACTION:
Aadhaar card numbers are 12-digit numbers, often printed in groups of 4:
  XXXX XXXX XXXX  or  XXXXXXXXXXXX

Extract from:
- Large stylized number at the bottom of Aadhaar card image
- Text patterns: 4-digit space 4-digit space 4-digit
- After labels: "UID", "Aadhaar No", or standalone 12-digit number

Normalize: strip spaces → store as 12 consecutive digits.
Example: "9813 1170 0414" → idProofNumber = "981311700414"

idProofType: if document shows "Government of India" header with Tamil/Hindi text
"இந்திய அரசாங்கம்" or "भारत सरकार" and has a QR code → idProofType = "Aadhaar Card"


FIRST AID DETAILS:

"accidentDetails.firstAidDetails":
Extract the initial emergency condition and treatment given on hospital arrival.
Sources:
- Accident/Injury Report → "Condition/Injuries" section
- Nursing initial assessment → vitals and presenting condition on admission
- Doctor's initial assessment → "Presenting Complaints" on arrival

Synthesize into a readable summary. Include:
- Patient's condition on arrival (conscious level, irritability, distress)
- SpO2, RR, BP, Pulse on arrival
- Immediate interventions (intubation, ventilation, IV access, CPR)

Example:
"Patient arrived irritable with severe respiratory distress. SpO2 70% on room air,
RR >36, BP 210/110 mmHg. Immediately intubated and placed on mechanical ventilation."

Do NOT leave null if any admission vitals or condition notes are present.

"accidentDetails.firstAidHospital":
- Name of hospital where first aid was given
- "first aid hospital" | "brought to" | hospital name on accident report header
- If accident report and treatment are from same hospital, use that hospital name

"accidentDetails.firstAidDateTime":
- Date and time patient arrived at hospital / first aid was given
- "Hospital Arrival Date/Time" | "Date of Admission" on accident report
- Format: YYYY-MM-DD HH:MM
"""



FIELD_SCHEMA = """
Return a JSON object with ONLY the keys listed below. Use null for any field you cannot find.

{
  "insurer": string|null, "policyNumber": string|null, "policyType": string|null,"tpaName": "string|null",
  "insurerRef": string|null, "insurerContact": string|null, "insurerContactInfo": string|null,
  "policyDetails.startDate": string|null, "policyDetails.endDate": string|null,
  "policyDetails.coverageType": string|null, "policyDetails.preExistingDisease": string|null,
  "policyDetails.roomRentLimit": string|null,
  "claimantName": string|null, "claimantMobile": string|null, "claimantEmail": string|null,
  "claimantAge": "number|null", "relationship": string|null,
  "idProofType": string|null, "idProofNumber": string|null,
  "claimantAddress": string|null, "city": string|null, "district": string|null, "pinCode": string|null,
  "claimMode": string|null, "claimSubtype": string|null,
  "dateOfIncident": string|null, "dateOfIntimation": string|null,
  "claimedAmount": "number|null", "sumInsured": "number|null", "description": string|null,
  "hospitalDetails.name": string|null, "hospitalDetails.address": string|null,
  "hospitalDetails.type": string|null, "hospitalDetails.doctorName": string|null,
  "hospitalDetails.admissionDate": string|null, "hospitalDetails.dischargeDate": string|null,
  "hospitalDetails.city": string|null, "hospitalDetails.department": string|null,
  "reimbursementDetails.accountName": string|null, "reimbursementDetails.bankDetails": string|null,
  "reimbursementDetails.ifsc": string|null,
  "cashlessDetails.admissionType": string|null, "cashlessDetails.tpaName": string|null,
  "cashlessDetails.estimatedCost": "number|null",
  "accidentDetails.dateTime": string|null, "accidentDetails.place": string|null,
  "accidentDetails.firNumber": string|null, "accidentDetails.mlcNumber": string|null,
  "deathDetails.date": string|null, "deathDetails.time": string|null,
  "deathDetails.reason": string|null, "deathDetails.beneficiaryName": string|null,
  "criticalDetails.diagnosis": string|null,
  "criticalDetails.procedure": string|null,
  "criticalDetails.implants": string|null,
  "criticalDetails.surgeryDate": string|null,
  "billingDetails.finalBillAmount": "number|null",
  "billingDetails.discountAmount": "number|null",
  "billingDetails.roomType": string|null,
  "billingDetails.tariffType": string|null,
  "accidentDetails.mlcRegistered": string|null,
  "accidentDetails.mlcCollected": string|null,
  "accidentDetails.accidentNarration": string|null,
  "hospitalDetails.hospitalContactNumber": string|null,
"hospitalDetails.hospitalEmail": string|null,
"policyDetails.inceptionDate": string|null,
"additionalMedicalDetails.diagnosisSummary": string|null,
"additionalMedicalDetails.clinicalSummary": string|null,
"additionalMedicalDetails.chiefComplaints": string|null,
"additionalMedicalDetails.pastHistory": string|null,
"additionalMedicalDetails.generalExamination": string|null,
"additionalMedicalDetails.localExamination": string|null,
"additionalMedicalDetails.vitals": string|null,
"additionalMedicalDetails.investigatorHospitalOpinion": string|null,
"additionalMedicalDetails.investigatorMemberOpinion": string|null,
"additionalMedicalDetails.firstConsultationDate": string|null,

"investigationDetails.investigatorName": string|null,
"investigationDetails.investigatorDesignation": string|null,
"investigationDetails.dataCollectedFrom": string|null,

"medicalStaff.pathologistName": string|null,
"medicalStaff.pathologistDesignation": string|null,
"medicalStaff.pathologistRegNo": string|null,

"medicalStaff.radiologistName": string|null,
"medicalStaff.radiologistDesignation": string|null,
"medicalStaff.radiologistRegNo": string|null,
"riskDetails.riskScore": "number|null",
"riskDetails.riskLevel": string|null,
"riskDetails.triggers": string|null,
"riskDetails.investigationInstruction": string|null,
"obstetricDetails.gestationAge": string|null,
"obstetricDetails.edd": string|null,
"obstetricDetails.gravidaParity": string|null,
"obstetricDetails.fetalCondition": string|null,
"accidentDetails.firstAidDetails": string|null,
"accidentDetails.firstAidHospital": string|null,
"accidentDetails.firstAidDateTime": string|null,
"checklist.idProofInsured": "string|null",
"checklist.hospitalExistence": "string|null",
"checklist.admissionVerified": "string|null",
"checklist.treatmentParticulars": "string|null",
"checklist.copyOfICP": "string|null",
"checklist.labVicinity": "string|null",
"checklist.labRegistersVerified": "string|null",
"checklist.billsReceipts": "string|null",
"checklist.medicinePurchases": "string|null",
"checklist.signatureMatching": "string|null",
"checklist.otReceiptBooks": "string|null",
"checklist.anyOther": "string|null",
"conclusion": "string|null","emailInstructions": "string|null",
"suggestedTriggers": "array|null",
}
"""

# All known form field keys (flat) — used to detect unused/extra data from LLM
KNOWN_FLAT_KEYS = {
    "insurer", "policyNumber", "policyType", "insurerRef", "insurerContact",
    "insurerContactInfo", "policyDetails.startDate", "policyDetails.endDate",
    "policyDetails.coverageType", "policyDetails.preExistingDisease", "policyDetails.roomRentLimit",
    "claimantName", "claimantMobile", "claimantEmail", "claimantAge", "relationship",
    "idProofType", "idProofNumber", "claimantAddress", "city", "district", "pinCode",
    "claimMode", "claimSubtype", "dateOfIncident", "dateOfIntimation",
    "claimedAmount", "sumInsured", "description",
    "hospitalDetails.name", "hospitalDetails.address", "hospitalDetails.type",
    "hospitalDetails.doctorName", "hospitalDetails.admissionDate", "hospitalDetails.dischargeDate",
    "hospitalDetails.city", "hospitalDetails.department",
    "reimbursementDetails.accountName", "reimbursementDetails.bankDetails", "reimbursementDetails.ifsc",
    "cashlessDetails.admissionType", "cashlessDetails.tpaName", "cashlessDetails.estimatedCost",
    "accidentDetails.dateTime", "accidentDetails.place", "accidentDetails.firNumber",
    "accidentDetails.mlcNumber", "deathDetails.date", "deathDetails.time",
    "deathDetails.reason", "deathDetails.beneficiaryName",
    "criticalDetails.diagnosis",
"criticalDetails.procedure",
"criticalDetails.implants",
"criticalDetails.surgeryDate",
"emailInstructions",
"suggestedTriggers",
"billingDetails.finalBillAmount",
"billingDetails.discountAmount",
"billingDetails.roomType",
"billingDetails.tariffType",

"accidentDetails.mlcRegistered",
"accidentDetails.mlcCollected",
"accidentDetails.accidentNarration",

"hospitalDetails.hospitalContactNumber",
"hospitalDetails.hospitalEmail",

"policyDetails.inceptionDate",
"additionalMedicalDetails.diagnosisSummary",
"additionalMedicalDetails.clinicalSummary",
"additionalMedicalDetails.chiefComplaints",
"additionalMedicalDetails.pastHistory",
"additionalMedicalDetails.generalExamination",
"additionalMedicalDetails.localExamination",
"additionalMedicalDetails.vitals",
"additionalMedicalDetails.investigatorHospitalOpinion",
"additionalMedicalDetails.investigatorMemberOpinion",
"additionalMedicalDetails.firstConsultationDate",

"investigationDetails.investigatorName",
"investigationDetails.investigatorDesignation",
"investigationDetails.dataCollectedFrom",

"medicalStaff.pathologistName",
"medicalStaff.pathologistDesignation",
"medicalStaff.pathologistRegNo",

"medicalStaff.radiologistName",
"medicalStaff.radiologistDesignation",
"medicalStaff.radiologistRegNo",

"riskDetails.riskScore",
"riskDetails.riskLevel",
"riskDetails.triggers",
"riskDetails.investigationInstruction",
"obstetricDetails.gestationAge",
"obstetricDetails.edd",
"obstetricDetails.gravidaParity",
"obstetricDetails.fetalCondition",
"accidentDetails.firstAidDetails",
    "accidentDetails.firstAidHospital", 
    "accidentDetails.firstAidDateTime",
    "checklist.idProofInsured", "checklist.hospitalExistence",
"checklist.admissionVerified", "checklist.treatmentParticulars",
"checklist.copyOfICP", "checklist.labVicinity",
"checklist.labRegistersVerified", "checklist.billsReceipts",
"checklist.medicinePurchases", "checklist.signatureMatching",
"checklist.otReceiptBooks", "checklist.anyOther",
"conclusion",
}


def _extract_text_from_bytes(content: bytes, filename: str = "unknown.pdf") -> str:
    try:
        import PyPDF2
        reader = PyPDF2.PdfReader(io.BytesIO(content))
        parts = [f"<!-- PDF_START: {filename} -->"]
        for idx, p in enumerate(reader.pages):
            page_num = idx + 1
            text = p.extract_text() or ""
            parts.append(f"<!-- PAGE_START: {page_num} -->")
            parts.append(text)
            parts.append(f"<!-- PAGE_END: {page_num} -->")
        parts.append(f"<!-- PDF_END: {filename} -->")
        return "\n\n".join(parts)
    except Exception as e:
        logger.error("PyPDF2 failed: %s", e)
        return ""


# ── NEW: page-count + page-subset helpers for the advanced two-phase flow ───
def _get_pdf_page_count(content: bytes) -> int:
    """Best-effort page count for a PDF. Returns 1 on failure (e.g. images)."""
    try:
        reader = PdfReader(io.BytesIO(content))
        return max(len(reader.pages), 1)
    except Exception as e:
        logger.warning("Could not read PDF page count: %s", e)
        return 1


def _extract_selected_pages_pdf(content: bytes, pages: List[int]) -> bytes:
    """
    Given full PDF bytes and a list of 1-indexed page numbers, return new PDF
    bytes containing ONLY those pages (deduped, sorted, out-of-range dropped).
    Raises ValueError if nothing valid was selected.
    """
    reader = PdfReader(io.BytesIO(content))
    total_pages = len(reader.pages)
    valid_pages = sorted({int(p) for p in pages if 1 <= int(p) <= total_pages})
    if not valid_pages:
        raise ValueError("No valid pages were selected for this document.")

    writer = PdfWriter()
    for p in valid_pages:
        writer.add_page(reader.pages[p - 1])

    out = io.BytesIO()
    writer.write(out)
    return out.getvalue()


def _run_llm_extraction(text: str, doc_label: str) -> Dict[str, Any]:
    """Run LLM extraction and return the flat dict."""
    prompt = f"""
    You are an expert insurance document parser for an Indian insurance investigation company.
    Extract structured data from the uploaded document (referred to as "{doc_label}") to pre-fill a claim registration form.

    RULES:
    1. Infer semantically equivalent mappings where labels differ but meaning is clear. Never invent values.
    2. Return ONLY valid JSON — no markdown fences, no prose.
    3. Dates: ISO YYYY-MM-DD. Mobile: 10 digits (strip +91). Amounts: plain numbers.
    IMPORTANT:
    Hospital records may not contain explicit section headings.

    IMPORTANT — ID CARD PAGES:
    Pages may contain scanned ID cards (Aadhaar, PAN, Voter ID, DL).
    These are IMAGE pages. Extract all visible text including:
    - Large stylized numbers at card bottom (Aadhaar UID)
    - Name in CAPS under photo
    - Father/Husband name
    - Year of Birth
    - Gender
    The 12-digit number in groups of 4 at the card bottom IS the Aadhaar number.

    Infer diagnoses, vitals, examinations,
    clinical findings, procedures,
    and medical summaries from:
    - shorthand clinical notes
    - OP follow-up records
    - prescriptions
    - OBG abbreviations
    - handwritten style notes
    - progress records

SEMANTIC RULES:
{SEMANTIC_RULES}

FIELD SCHEMA:
{FIELD_SCHEMA}

DOCUMENT TEXT:
{text[:90000]}
"""
    try:
        completion = groq_client.chat.completions.create(
            model="llama-3.3-70b-versatile",
            temperature=0.0,
            max_tokens=6000,
            response_format={"type": "json_object"},
            messages=[{"role": "user", "content": prompt}],
        )
        raw = completion.choices[0].message.content
        return json.loads(raw)
    except Exception as e:
        logger.error("LLM extraction failed: %s", e)
        return {}


def _extract_unused_fields(flat: Dict[str, Any]) -> Dict[str, Any]:
    """
    Pull out any key-value pairs from the LLM response that are NOT in our
    form schema — these get stored as raw_additional_data for audit.
    """
    return {k: v for k, v in flat.items() if k not in KNOWN_FLAT_KEYS and v is not None}


def _run_voice_llm(transcript: str, existing: Dict[str, Any]) -> Dict[str, Any]:
    existing_str = json.dumps({k: v for k, v in existing.items() if v is not None}, indent=2)
    prompt = f"""
You are helping an insurance investigator fill a claim form by voice.
The supervisor spoke the following transcript about an insurance case.

EXISTING extracted data (already known — do NOT change unless transcript explicitly corrects it):
{existing_str}

VOICE TRANSCRIPT:
{transcript}

Extract any NEW or CORRECTED fields mentioned in the voice transcript.
Return ONLY a JSON object with the fields that need to be added or updated.
Use the same field schema as before. Return empty object {{}} if nothing new is mentioned.
"""
    try:
        completion = groq_client.chat.completions.create(
            model="llama-3.3-70b-versatile",
            temperature=0.0,
            max_tokens=1000,
            response_format={"type": "json_object"},
            messages=[{"role": "user", "content": prompt}],
        )
        return json.loads(completion.choices[0].message.content)
    except Exception as e:
        logger.error("Voice LLM failed: %s", e)
        return {}


def _unflatten(flat: Dict[str, Any]) -> Dict[str, Any]:
    result: Dict[str, Any] = {}
    for key, value in flat.items():
        if value is None:
            continue
        parts = key.split(".", 1)
        if len(parts) == 1:
            result[key] = value
        else:
            parent, child = parts
            result.setdefault(parent, {})[child] = value
    return result

async def _build_claim_set_payload(
    case_id: str,
    extracted_flat: Dict[str, Any],
    dropdown_only: set,
) -> Dict[str, Any]:
    """
    Build the $set payload for insurance_claims_col WITHOUT blindly
    overwriting fields that already hold a better/non-empty value.

    - Most scalar fields: only set if currently empty in DB.
    - description: keep whichever is LONGER (richer) of old vs new.
    - suggestedTriggers / riskDetails.triggers: UNION old + new instead
      of replacing, so triggers found in one document aren't lost when
      a later document doesn't mention them.
    - emailInstructions: APPEND new instruction text to the existing
      value (separated by " | ") instead of overwriting, so multiple
      trigger notes pasted over time accumulate rather than replace
      one another.
    """
    existing = await insurance_claims_col.find_one(
        {"caseId": case_id},
        {"_id": 0},
    ) or {}

    payload: Dict[str, Any] = {}

    for flat_key, value in extracted_flat.items():
        if value is None or flat_key in dropdown_only:
            continue

        if flat_key == "description":
            existing_desc = existing.get("description") or ""
            new_desc = value or ""
            payload["description"] = new_desc if len(new_desc) > len(existing_desc) else existing_desc
            continue

        if flat_key == "suggestedTriggers":
            existing_triggers = set(existing.get("suggestedTriggers") or [])
            new_triggers = set(value or [])
            payload["suggestedTriggers"] = list(existing_triggers | new_triggers)
            continue

        if flat_key == "emailInstructions":
            existing_ei = (existing.get("emailInstructions") or "").strip()
            new_ei = (value or "").strip()
            if existing_ei and new_ei and new_ei not in existing_ei:
                payload["emailInstructions"] = f"{existing_ei} | {new_ei}"
            else:
                payload["emailInstructions"] = new_ei or existing_ei
            continue

        if flat_key == "riskDetails.triggers":
            existing_risk = existing.get("riskDetails") or {}
            existing_trig = (existing_risk.get("triggers") or "").strip()
            new_trig = (value or "").strip()
            if existing_trig and new_trig and new_trig not in existing_trig:
                payload["riskDetails.triggers"] = f"{existing_trig}; {new_trig}"
            else:
                payload["riskDetails.triggers"] = new_trig or existing_trig
            continue

        # default: only fill if not already present/non-empty
        parts = flat_key.split(".", 1)
        if len(parts) == 1:
            current_val = existing.get(parts[0])
        else:
            current_val = (existing.get(parts[0]) or {}).get(parts[1])

        if current_val in (None, "", [], {}):
            payload[flat_key] = value
        # else: keep existing value, skip overwrite

    return payload

def _deep_merge_override(base: dict, patch: dict) -> dict:
    """
    Like _deep_merge, but patch values WIN on conflict instead of being
    skipped when base already has a non-empty value. Used for advanced
    (LlamaCloud) extraction, which is explicitly meant to override
    lower-quality normal-mode results.
    """
    result = dict(base)
    for k, v in patch.items():
        if v is None:
            continue
        if isinstance(v, dict) and isinstance(result.get(k), dict):
            result[k] = _deep_merge_override(result[k], v)
        else:
            result[k] = v
    return result

def _deep_merge(base: dict, patch: dict) -> dict:
    """Merge patch into base. Skips None. Only fills empty slots."""
    result = dict(base)
    for k, v in patch.items():
        if v is None:
            continue
        if isinstance(v, dict) and isinstance(result.get(k), dict):
            result[k] = _deep_merge(result[k], v)
        elif k not in result or result[k] in (None, "", [], {}):
            result[k] = v
    return result

async def _llamacloud_parse(
    content: bytes,
    filename: str
) -> tuple[str, int]:
    """
    Upload PDF bytes to LlamaCloud and return (full_markdown, page_count).
    """
    import tempfile
    import asyncio

    def _sync_parse():
        from llama_cloud import LlamaCloud

        if not LLAMA_API_KEY:
            raise ValueError("LLAMA_API_KEY is not configured")

        client = LlamaCloud(api_key=LLAMA_API_KEY)
        safe_filename = filename.replace(" ", "_")
        tmp_path = os.path.join(tempfile.gettempdir(), safe_filename)

        with open(tmp_path, "wb") as tmp:
            tmp.write(content)

        try:
            uploaded_file = client.files.create(file=tmp_path, purpose="parse")
            result = client.parsing.parse(
                file_id=uploaded_file.id,
                tier="cost_effective",
                version="latest",
                expand=["markdown"],
                agentic_options={
                    "custom_prompt": (
                        "This document may contain text in multiple languages, including "
                        "non-English scripts (e.g. Hindi, Tamil, or other regional languages). "
                        "Preserve ALL original text exactly as written, in its original script — "
                        "do NOT translate or drop any original-language text. "
                        "Immediately after any non-English word, phrase, or sentence, insert its "
                        "English translation in square brackets right next to it, e.g. "
                        "'भारत सरकार [Government of India]' or 'ஆதார் [Aadhaar]'. "
                        "Do this inline for every non-English span, no matter how short "
                        "(single words, labels, headers, or full sentences). "
                        "Never replace the original text with only the translation — both must "
                        "always appear together."
                    )
                },
            )

            pages = result.markdown.pages
            page_count = len(pages)
    

            parts = [f"<!-- PDF_START: {filename} -->"]
            for idx, page in enumerate(pages):
                page_num = idx + 1
                parts.append(f"<!-- PAGE_START: {page_num} -->")
                parts.append(page.markdown)
                parts.append(f"<!-- PAGE_END: {page_num} -->")
            parts.append(f"<!-- PDF_END: {filename} -->")

            full_markdown = "\n\n".join(parts)
            return full_markdown, page_count

        finally:
            if os.path.exists(tmp_path):
                os.unlink(tmp_path)

    loop = asyncio.get_event_loop()
    return await loop.run_in_executor(None, _sync_parse)

# ═══════════════════════════════════════════════════════════════════════════
# WEB ENDPOINTS
# ═══════════════════════════════════════════════════════════════════════════

@router.post("/web/upload-document")
async def upload_document(
    request: Request,
    file: UploadFile = File(...),
    case_id: str = Form(...),
    email_text: str = Form(None)
):
    """Normal extraction — uses the Celery pipeline's processed_documents.
    NOTE: page-selection does NOT apply to normal mode — this endpoint is
    unchanged and always processes the whole document."""
    user            = _get_user(request)
    supervisor_id   = user["user_id"]
    supervisor_role = user.get("role", "")

    allowed_ext = (".pdf", ".jpg", ".jpeg", ".png", ".webp", ".txt")

    if not file.filename.lower().endswith(allowed_ext):
        raise HTTPException(
            status_code=400,
            detail="Only PDF and image files are accepted."
        )
    # ── Trigger-content-only path ──────────────────────────────────────────
    # This branch handles text pasted into the "Trigger Content" box on the
    # frontend (sent here as a fake .txt file). Unlike real documents, this
    # text is NOT run through the full multi-agent pipeline — it's just an
    # investigation instruction / trigger note, so we run ONLY the A7 agent
    # (agent_a7_email_instructions), and we run it on this text ALONE
    # (no prior case context), so the trigger extraction stays precise and
    # isn't diluted or distracted by unrelated document data.
    if file.filename.lower().endswith(".txt"):
        if not (email_text or "").strip():
            raise HTTPException(status_code=400, detail="Trigger text is empty.")

        trigger_text  = email_text.strip()
        doc_id        = f"CDOC-TRIGGER-{uuid.uuid4().hex[:8].upper()}"
        now           = datetime.now(IST)
        stored_url    = None   # no file storage upload happens on this path
        storage_path  = None   # same reason

        updated = await case_documents_col.find_one_and_update(
            {"case_id": case_id},
            {
                "$setOnInsert": {
                    "case_id": case_id, "supervisor_id": supervisor_id,
                    "supervisor_role": supervisor_role,
                    "merged_extracted_data": {}, "total_fields_found": 0,
                    "documents": [], "created_at": now,
                },
                "$set": {"updated_at": now},
                "$inc": {"doc_counter": 1},
            },
            upsert=True, return_document=True,
        )
        display_label = f"Trigger Content {updated['doc_counter']}"

        # Run ONLY the A7 trigger/email-instruction agent on the pasted text.
        # pass1_result is intentionally {} — trigger extraction should read
        # only what was pasted, not prior case data.
        extracted_flat = await agent_a7_email_instructions(trigger_text, {})
        extracted_flat = _normalize_extracted_fields(extracted_flat)

        extracted_nested = _unflatten(extracted_flat)
        fields_found = len([v for v in extracted_flat.values() if v is not None])

        new_doc_entry = {
        "doc_id":          doc_id,
        "file_name":       file.filename,
        "file_type":       file.content_type,
        "display_label":   display_label,
        "pdf_url":         stored_url,
        "storage_path":    storage_path,
         "extraction_mode": "trigger",
        "voice_notes":     [],
        "uploaded_at":     now.isoformat(),
    }


        # ── Merge into case record with OVERRIDE (latest trigger note wins
        # at the case_documents level; the claim-level merge below handles
        # union/append semantics for suggestedTriggers / emailInstructions) ──
        current = await case_documents_col.find_one({"case_id": case_id}, {"merged_extracted_data": 1})
        current_merged = (current or {}).get("merged_extracted_data", {})
        new_merged = _deep_merge_override(current_merged, extracted_nested)

        await case_documents_col.update_one(
            {"case_id": case_id},
            {
                "$push": {"documents": new_doc_entry},
                "$set": {"merged_extracted_data": new_merged, "updated_at": now},
                "$inc": {"total_fields_found": fields_found},
            },
        )

        DROPDOWN_ONLY = {'insurer', 'claimMode', 'claimSubtype', 'tags', 'claimTrigger'}
        flat_set_payload = await _build_claim_set_payload(case_id, extracted_flat, DROPDOWN_ONLY)

        flat_set_payload["updatedAt"] = now
        await _fix_null_parents(insurance_claims_col, case_id, extracted_flat.keys())

        await insurance_claims_col.update_one({"caseId": case_id}, {"$set": flat_set_payload})
        await insurance_claims_col.update_one(
            {"caseId": case_id, "supportingDocuments.doc_id": {"$ne": doc_id}},
            {"$push": {"supportingDocuments": {
                "doc_id": doc_id,
                "file_name": file.filename,
                "display_label": display_label,
                "pdf_url": stored_url,
                "storage_path": storage_path,
                "fields_found": fields_found,
                "status": "extracted",
                "doc_type": "claim_detail",
                "uploaded_at": now.isoformat(),
            }}},
        )

        return {
            "success": True, "doc_id": doc_id, "case_id": case_id,
            "file_name": file.filename, "display_label": display_label,
            "pdf_url": None, "extraction_mode": "trigger",
            "extracted_fields": extracted_nested, "fields_found": fields_found,
            "message": f"Trigger extraction: {fields_found} fields from {display_label}.",
        }
    content = await file.read()
    if len(content) > 20 * 1024 * 1024:
        raise HTTPException(status_code=400, detail="File exceeds 20 MB limit.")

    claim = await insurance_claims_col.find_one({"caseId": case_id}, {"_id": 0, "caseId": 1})
    if not claim:
        raise HTTPException(status_code=404, detail=f"Case {case_id} not found.")

    doc_id = f"CDOC-{uuid.uuid4().hex[:10].upper()}"
    now    = datetime.now(IST)

    # Atomically reserve a doc_number
    updated = await case_documents_col.find_one_and_update(
        {"case_id": case_id},
        {
            "$setOnInsert": {
                "case_id":               case_id,
                "supervisor_id":         supervisor_id,
                "supervisor_role":       supervisor_role,
                "merged_extracted_data": {},
                "total_fields_found":    0,
                "documents":             [],
                "created_at":            now,
            },
            "$set":  {"updated_at": now},
            "$inc":  {"doc_counter": 1},
        },
        upsert=True,
        return_document=True,
    )

    doc_number    = updated["doc_counter"]
    display_label = f"Document {doc_number}"

    # ── Credit budget precheck (no page selection on this path — estimate
    # from the full file) ───────────────────────────────────────────────────
    is_pdf_claim_doc = file.filename.lower().endswith(".pdf")
    estimated_pages = _get_pdf_page_count(content) if is_pdf_claim_doc else 1
    estimated_credits = estimated_pages * CREDITS_PER_PAGE
    stats_doc = await llama_stats_col.find_one({"_id": "global_total"}) or {}
    credits_used_so_far = stats_doc.get("credits_used", 0)
    if credits_used_so_far + estimated_credits > LLAMA_CREDIT_BUDGET:
        raise HTTPException(
            status_code=402,
            detail=(
                f"LlamaCloud credit budget nearly exhausted "
                f"({credits_used_so_far}/{LLAMA_CREDIT_BUDGET} used). "
                f"This extraction needs ~{estimated_credits} credits. "
                f"Please top up credits or contact admin."
            ),
        )

    # Upload to storage proxy
    # Upload directly to storage (same pattern as advanced_upload_document)
    stored_url: Optional[str]      = None
    storage_path: Optional[str]    = None
    stored_filename: Optional[str] = None

    try:
        upload_url   = f"{STORAGE_BASE_URL}/upload"
        content_type = file.content_type or "application/octet-stream"
        files = {"file": (file.filename, content, content_type)}
        params = {
            "doctor_id":   supervisor_id,
            "patient_id":  case_id,
            "doc_type":    f"document_{doc_number}",
            "category":    None,
            "subcategory": None,
        }
        response = requests.post(upload_url, params=params, files=files, timeout=60)
        if response.status_code != 200:
            raise HTTPException(status_code=response.status_code, detail=response.text)

        upload_result = response.json()
        full_path = upload_result.get("filename", "")
        if not full_path:
            raise HTTPException(status_code=500, detail="No filename returned from storage service.")

        stored_filename = full_path.split("/")[-1]
        storage_path    = f"{case_id}/{stored_filename}"
        stored_url      = f"{STORAGE_BASE_URL}/files/{case_id}/{stored_filename}"
        logger.info("Direct storage upload success | stored_filename=%s", stored_filename)

    except HTTPException:
        raise
    except Exception as exc:
        logger.exception("Direct storage upload failed")
        raise HTTPException(status_code=502, detail=f"Storage upload failed: {str(exc)}")

    # Poll processed_documents for Celery result
    # Parse the FULL document via LlamaCloud (agentic tier). No page
    # selection here — Claim Detail Documents always go in whole, so the
    # multi-agent extraction below has everything it needs.
    try:
        document_text, _page_count = await _llamacloud_parse(content, file.filename)
    except Exception as exc:
        logger.error("LlamaCloud parse failed for claim document '%s': %s", file.filename, exc)
        raise HTTPException(status_code=502, detail=f"Document parsing failed: {exc}")

    await llama_stats_col.update_one(
        {"_id": "global_total"},
        {"$inc": {"total_pages_parsed": _page_count, "credits_used": _page_count * CREDITS_PER_PAGE}},
        upsert=True,
    )

    document_text = (document_text or "").strip()
    if not document_text:
        raise HTTPException(
            status_code=422,
            detail=f"Parsing returned no text for '{file.filename}'.",
        )

    # Run LLM extraction
    email_lines = (email_text or "").strip().splitlines()
    email_subject = ""
    if email_lines and email_lines[0].lower().startswith("subject:"):
        email_subject = email_lines[0]

    combined_text = f"""
EMAIL CONTENT:
{email_text or ""}

DOCUMENT CONTENT:
{document_text}
"""

    full_context = await _build_full_case_context(
        case_id,
        combined_text
    )

    extracted_flat: Dict[str, Any] = await run_multiagent_extraction(
    full_context,
    display_label,
    email_text=email_text or "",
)

    extracted_flat = _normalize_extracted_fields(extracted_flat)

    existing_claim_doc = await insurance_claims_col.find_one({"caseId": case_id}, {"description": 1})
    existing_description = (existing_claim_doc or {}).get("description") or ""

    extracted_flat["description"] = _enrich_description(
        combined_text,
        extracted_flat,
        existing_description,
    )

    extracted_nested = _unflatten(extracted_flat)

    fields_found = len([
        v for v in extracted_flat.values()
        if v is not None
    ])

    # Capture any extra fields the LLM found that don't map to the form
    unused_flat = _extract_unused_fields(extracted_flat)

    # Build document entry
    new_doc_entry = {
        "doc_id":          doc_id,
        "file_name":       file.filename,
        "file_type":       file.content_type,
        "display_label":   display_label,
        "pdf_url":         stored_url,
        "storage_path":    storage_path,
        "extraction_mode": "advanced",
        "voice_notes":     [],
        "uploaded_at":     now.isoformat(),
    }

    # Merge into case record
    current        = await case_documents_col.find_one(
        {"case_id": case_id}, {"merged_extracted_data": 1}
    )
    current_merged = (current or {}).get("merged_extracted_data", {})
    new_merged     = _deep_merge(current_merged, extracted_nested)

    await case_documents_col.update_one(
        {"case_id": case_id},
        {
            "$push": {"documents": new_doc_entry},
            "$set":  {
                "merged_extracted_data": new_merged,
                "updated_at":            now,
            },
            "$inc":  {"total_fields_found": fields_found},
        },
    )

    DROPDOWN_ONLY = {'insurer', 'claimMode', 'claimSubtype', 'tags', 'claimTrigger'}

    flat_set_payload = await _build_claim_set_payload(case_id, extracted_flat, DROPDOWN_ONLY)
    flat_set_payload["raw_llama_markdown"] = await _get_accumulated_markdown(case_id, combined_text)
    flat_set_payload["updatedAt"] = now
    await _fix_null_parents(insurance_claims_col, case_id, extracted_flat.keys())
    await insurance_claims_col.update_one(
        {"caseId": case_id},
        {
            "$set": flat_set_payload,
            "$addToSet": {"ingested_files": file.filename},
        }
    )
    return {
        "success":          True,
        "doc_id":           doc_id,
        "case_id":          case_id,
        "file_name":        file.filename,
        "display_label":    display_label,
        "pdf_url":          stored_url,
        "storage_path":     storage_path,
        "extraction_mode":  "claim_detail",
        "extracted_fields": extracted_nested,
        "fields_found":     fields_found,
        "message":          f"Extracted {fields_found} fields from {display_label}.",
    }

@router.get("/web/advanced-upload/staged-list/{case_id}")
async def list_staged_supporting_documents(case_id: str, request: Request):
    """
    Returns all Supporting Documents for a case that have been stored but not
    yet extracted (still sitting in advanced_upload_staged_col). This is what
    the doctor's document-review screen lists so they can pick pages and
    trigger extraction.
    """
    _get_user(request)

    cursor = advanced_upload_staged_col.find({"case_id": case_id}, {"_id": 0}).sort("created_at", 1)
    docs = await cursor.to_list(length=200)

    for d in docs:
        if isinstance(d.get("created_at"), datetime):
            d["created_at"] = d["created_at"].isoformat()
        if isinstance(d.get("updated_at"), datetime):
            d["updated_at"] = d["updated_at"].isoformat()

    return {"success": True, "case_id": case_id, "documents": docs, "count": len(docs)}
# ═══════════════════════════════════════════════════════════════════════════
# ADVANCED UPLOAD — now a two-phase flow:
#   Phase 1 (this endpoint): upload + store the FULL file only. No parsing,
#            no LlamaCloud, no Celery. Returns page_count so the frontend can
#            show a page-selection checklist next to the PDF preview.
#   Phase 2 (/web/advanced-upload/extract, below): given doc_id + the pages
#            the user picked, re-read the stored full PDF, slice out ONLY
#            those pages with pypdf, and queue THAT subset for LlamaCloud
#            parse + LLM extraction. The full PDF stays in storage untouched
#            (for viewing) — only the parse/extraction path uses the subset.
# ═══════════════════════════════════════════════════════════════════════════

@router.post("/web/advanced-upload")
async def advanced_upload_document(
    request: Request,
    file: UploadFile = File(..., max_size=50_000_000),
    case_id: str = Form(...),
    email_text: str = Form(None)
):
    """
    Phase 1: store the full PDF/image to storage synchronously (so pdf_url
    comes back immediately) and report its page count. Does NOT parse or
    queue extraction — call /web/advanced-upload/extract once the user has
    picked which pages to include.
    """
    user            = _get_user(request)
    supervisor_id   = user["user_id"]
    supervisor_role = user.get("role", "")
 
    allowed_ext = (".pdf", ".jpg", ".jpeg", ".png", ".webp")
    if not file.filename.lower().endswith(allowed_ext):
        raise HTTPException(
            status_code=400,
            detail="Only PDF and image files are accepted."
        )
 
    content = await file.read()
    if len(content) > 50 * 1024 * 1024:
        raise HTTPException(status_code=400, detail="File exceeds 50 MB limit.")
 
    claim = await insurance_claims_col.find_one(
        {"caseId": case_id}, {"_id": 0, "caseId": 1, "ingested_files": 1}
    )
    if not claim:
        raise HTTPException(status_code=404, detail=f"Case {case_id} not found.")

    already_ingested = file.filename in set(claim.get("ingested_files") or [])
 
    doc_id = f"CDOC-ADV-{uuid.uuid4().hex[:8].upper()}"
    now    = datetime.now(IST)
 
    # Atomically reserve a doc_number (unchanged from before)
    updated = await case_documents_col.find_one_and_update(
        {"case_id": case_id},
        {
            "$setOnInsert": {
                "case_id":               case_id,
                "supervisor_id":         supervisor_id,
                "supervisor_role":       supervisor_role,
                "merged_extracted_data": {},
                "total_fields_found":    0,
                "documents":             [],
                "created_at":            now,
            },
            "$set":  {"updated_at": now},
            "$inc":  {"doc_counter": 1},
        },
        upsert=True,
        return_document=True,
    )
 
    doc_number    = updated["doc_counter"]
    display_label = f"Document {doc_number} (Advanced)"
 
    # ── Upload to storage synchronously (unchanged logic, just no longer
    #    gated behind the dedup check) ─────────────────────────────────────
    if not already_ingested:
        try:
            upload_url = f"{STORAGE_BASE_URL}/upload"
            content_type = file.content_type or "application/octet-stream"
            files = {"file": (file.filename, content, content_type)}
            params = {
                "doctor_id":   supervisor_id,
                "patient_id":  case_id,
                "doc_type":    f"document_{doc_number}_advanced",
                "category":    None,
                "subcategory": None
            }
            response = requests.post(upload_url, params=params, files=files, timeout=60)
            if response.status_code != 200:
                raise HTTPException(status_code=response.status_code, detail=response.text)
            upload_result = response.json()
            full_path = upload_result.get("filename", "")
            if not full_path:
                raise HTTPException(status_code=500, detail="No filename returned from storage service.")
            stored_filename = full_path.split("/")[-1]
            storage_path = f"{case_id}/{stored_filename}"
            stored_url = f"{STORAGE_BASE_URL}/files/{case_id}/{stored_filename}"
            logger.info("Advanced upload success | stored_filename=%s", stored_filename)
            if stored_url:
                await insurance_claims_col.update_one(
                    {"caseId": case_id, "supportingDocuments.doc_id": {"$ne": doc_id}},
                    {"$push": {"supportingDocuments": {
                        "doc_id": doc_id,
                        "file_name": file.filename,
                        "display_label": display_label,
                        "pdf_url": stored_url,
                        "storage_path": storage_path,
                        "fields_found": 0,
                        "status": "staged",
                        "uploaded_at": now.isoformat(),
                    }}},
                )
        except HTTPException:
            raise
        except Exception as exc:
            logger.exception("Direct storage upload failed")
            raise HTTPException(status_code=502, detail=f"Storage upload failed: {str(exc)}")
    else:
        stored_url, storage_path = None, None
        logger.info("Skipping storage re-upload — '%s' already ingested for case %s", file.filename, case_id)

    # ── NEW: page count (PDF only — images are always treated as 1 page) ───
    is_pdf = file.filename.lower().endswith(".pdf")
    page_count = _get_pdf_page_count(content) if is_pdf else 1

    # ── NEW: stage the upload instead of queueing extraction. The staged
    # record is looked up by /web/advanced-upload/extract once the user has
    # chosen pages. We don't store the file bytes here (could be up to
    # 50 MB, too big for a Mongo document) — we re-download from stored_url
    # in the extract step instead. ──────────────────────────────────────────
    await advanced_upload_staged_col.update_one(
        {"doc_id": doc_id, "case_id": case_id},
        {
            "$set": {
                "doc_id":            doc_id,
                "case_id":           case_id,
                "doc_number":        doc_number,
                "display_label":     display_label,
                "file_name":         file.filename,
                "file_content_type": file.content_type,
                "stored_url":        stored_url,
                "storage_path":      storage_path,
                "page_count":        page_count,
                "supervisor_id":     supervisor_id,
                "supervisor_role":   supervisor_role,
                "created_at":        now,
                "updated_at":        now,
            }
        },
        upsert=True,
    )
 
    return {
        "success":               True,
        "status":                "staged",
        "doc_id":                doc_id,
        "case_id":               case_id,
        "file_name":             file.filename,
        "display_label":         display_label,
        "pdf_url":               stored_url,
        "storage_path":          storage_path,
        "extraction_mode":       "advanced",
        "page_count":            page_count,
        "requires_page_selection": is_pdf and page_count > 1,
        "message":               f"'{file.filename}' uploaded ({page_count} page(s)) — select pages to extract.",
    }


@router.post("/web/advanced-upload/extract")
async def advanced_upload_extract_pages(request: Request):
    """
    Phase 2: given a doc_id staged by /web/advanced-upload and the list of
    page numbers the user selected (1-indexed), build a subset PDF containing
    ONLY those pages, then queue LlamaCloud parse + LLM extraction on that
    subset. The subset PDF is ALSO uploaded to storage and becomes this
    document's pdf_url from here on — replacing the full original — so the
    PDF Editor's left panel shows exactly what was selected/extracted, not
    the whole file. The original full file remains in storage untouched;
    it's just no longer the one referenced by this doc_id.

    Body: { "case_id": str, "doc_id": str, "pages": [int, ...], "email_text": str|null }
    Poll /web/advanced-upload/status/{task_id} for the result, same as before.
    """
    _get_user(request)
    body = await request.json()

    case_id    = body.get("case_id")
    doc_id     = body.get("doc_id")
    pages      = body.get("pages")
    email_text = body.get("email_text")

    if not case_id or not doc_id:
        raise HTTPException(status_code=400, detail="case_id and doc_id are required.")
    if not isinstance(pages, list) or not pages:
        raise HTTPException(status_code=400, detail="pages must be a non-empty list of page numbers.")

    staged = await advanced_upload_staged_col.find_one({"doc_id": doc_id, "case_id": case_id})
    if not staged:
        raise HTTPException(
            status_code=404,
            detail="Staged document not found or already extracted. Please re-upload.",
        )

    stored_url    = staged.get("stored_url")
    storage_path  = staged.get("storage_path")
    file_name     = staged.get("file_name") or "document.pdf"
    content_type  = staged.get("file_content_type") or "application/pdf"
    display_label = staged.get("display_label")
    doc_number    = staged.get("doc_number")
    supervisor_id = staged.get("supervisor_id")
    page_count    = staged.get("page_count", 1)

    if not stored_url:
        raise HTTPException(status_code=422, detail="Stored file URL missing for this document — cannot extract.")

    # Re-download the full stored file so we can slice out selected pages.
    try:
        async with httpx.AsyncClient(timeout=60) as http:
            resp = await http.get(stored_url)
            resp.raise_for_status()
            full_content = resp.content
    except Exception as exc:
        logger.error("Failed to re-download stored file for page selection: %s", exc)
        raise HTTPException(status_code=502, detail=f"Could not retrieve stored file: {exc}")

    is_pdf = file_name.lower().endswith(".pdf")
    selected_pages: Optional[List[int]] = None

    if is_pdf:
        try:
            subset_content = _extract_selected_pages_pdf(full_content, pages)
            selected_pages = sorted({int(p) for p in pages if 1 <= int(p) <= page_count})
        except ValueError as ve:
            raise HTTPException(status_code=400, detail=str(ve))
        except Exception as exc:
            logger.error("Page extraction failed: %s", exc)
            raise HTTPException(status_code=500, detail=f"Failed to extract selected pages: {exc}")
    else:
        # Images are single-page — nothing to slice, use the file as-is.
        subset_content = full_content

    # ── NEW: upload the page-subset PDF to storage and make IT the doc's
    # pdf_url from here on. Skip the extra upload if every page was
    # selected (full doc == selection) or it's an image (nothing sliced).
    if is_pdf and selected_pages is not None and len(selected_pages) != page_count:
        try:
            base_name = file_name.rsplit(".", 1)[0]
            subset_filename = f"{base_name}_pages_{'-'.join(str(p) for p in selected_pages)}.pdf"
            upload_url = f"{STORAGE_BASE_URL}/upload"
            files = {"file": (subset_filename, subset_content, "application/pdf")}
            params = {
                "doctor_id":   supervisor_id,
                "patient_id":  case_id,
                "doc_type":    f"document_{doc_number}_advanced_selected_pages",
                "category":    None,
                "subcategory": None,
            }
            async with httpx.AsyncClient(timeout=60) as http:
                upload_resp = await http.post(upload_url, params=params, files=files)

            if upload_resp.status_code == 200:
                upload_result = upload_resp.json()
                new_full_path = upload_result.get("filename", "")
                if new_full_path:
                    new_stored_filename = new_full_path.split("/")[-1]
                    storage_path = f"{case_id}/{new_stored_filename}"
                    stored_url   = f"{STORAGE_BASE_URL}/files/{case_id}/{new_stored_filename}"
                    logger.info(
                        "Selected-pages PDF stored | doc_id=%s | stored_filename=%s",
                        doc_id, new_stored_filename,
                    )
                else:
                    logger.warning(
                        "Selected-pages upload returned no filename for doc_id=%s — keeping full-doc URL.",
                        doc_id,
                    )
            else:
                logger.error(
                    "Selected-pages upload failed (%s) for doc_id=%s: %s — keeping full-doc URL.",
                    upload_resp.status_code, doc_id, upload_resp.text,
                )
        except Exception as exc:
            logger.error(
                "Selected-pages upload exception for doc_id=%s: %s — keeping full-doc URL.",
                doc_id, exc,
            )

    pages_to_bill = len(selected_pages) if selected_pages is not None else 1
    estimated_credits = pages_to_bill * CREDITS_PER_PAGE
    stats_doc = await llama_stats_col.find_one({"_id": "global_total"}) or {}
    credits_used_so_far = stats_doc.get("credits_used", 0)
    if credits_used_so_far + estimated_credits > LLAMA_CREDIT_BUDGET:
        raise HTTPException(
            status_code=402,
            detail=(
                f"LlamaCloud credit budget nearly exhausted "
                f"({credits_used_so_far}/{LLAMA_CREDIT_BUDGET} used). "
                f"This extraction needs ~{estimated_credits} credits. "
                f"Please top up credits or contact admin."
            ),
        )

    now     = datetime.now(IST)
    task_id = f"advadv_{uuid.uuid4().hex}"

    await advanced_upload_tasks_col.insert_one({
        "task_id":        task_id,
        "case_id":        case_id,
        "doc_id":         doc_id,
        "file_name":      file_name,
        "display_label":  display_label,
        "supervisor_id":  supervisor_id,
        "status":         "queued",
        "result":         None,
        "error":          None,
        "selected_pages": selected_pages,
        "total_pages":    page_count,
        "created_at":     now,
        "updated_at":     now,
    })

    # ── Hand off to Celery — same task, but file_b64 is now the PAGE-SUBSET
    # PDF, not the full document. ───────────────────────────────────────────
    celery_client.send_task(
        "advanced_upload.process_document",
        kwargs={
            "task_id":           task_id,
            "case_id":           case_id,
            "doc_id":            doc_id,
            "doc_number":        doc_number,
            "display_label":     display_label,
            "file_name":         file_name,
            "file_content_type": content_type,
            "file_b64":          base64.b64encode(subset_content).decode("utf-8"),
            "email_text":        email_text,
            "stored_url":        stored_url,
            "storage_path":      storage_path,
            "supervisor_id":     supervisor_id,
        },
        task_id=task_id,
        queue="advanced_upload_queue",
    )

    # Staging record has served its purpose once extraction is queued.
    await advanced_upload_staged_col.delete_one({"doc_id": doc_id, "case_id": case_id})

    return {
        "success":         True,
        "status":          "queued",
        "task_id":         task_id,
        "doc_id":          doc_id,
        "case_id":         case_id,
        "file_name":       file_name,
        "display_label":   display_label,
        "pdf_url":         stored_url,   # full PDF — still viewable as before
        "storage_path":    storage_path,
        "extraction_mode": "advanced",
        "pages_selected":  selected_pages,
        "page_count":      page_count,
        "message": (
            f"Extracting {len(selected_pages)} of {page_count} page(s) from '{file_name}'."
            if selected_pages is not None
            else f"Extracting '{file_name}'."
        ),
    }
 
 
@router.get("/web/advanced-upload/status/{task_id}")
async def get_advanced_upload_status(task_id: str, request: Request):
    """
    Poll this after /web/advanced-upload/extract returns a task_id.
    status values: "queued" -> "success" | "failed" | "rejected"
    ("rejected" = duplicate in-flight upload for the same file, caught by
    the Celery task's lock check).
    """
    _get_user(request)
 
    doc = await advanced_upload_tasks_col.find_one({"task_id": task_id}, {"_id": 0})
    if not doc:
        raise HTTPException(status_code=404, detail="Advanced upload task not found.")
 
    if isinstance(doc.get("created_at"), datetime):
        doc["created_at"] = doc["created_at"].isoformat()
    if isinstance(doc.get("updated_at"), datetime):
        doc["updated_at"] = doc["updated_at"].isoformat()
 
    return doc

# frontend dedupes on task_id via localStorage and only toasts once per id).
EXTRACTION_EVENT_WINDOW_MINUTES = 15
 
 
@router.get("/web/advanced-upload/active-tasks")
async def get_active_advanced_upload_tasks(request: Request):
    """
    Lightweight endpoint polled by:
      1. The doctor's case-list sidebar — "Extracting…" indicator per card
         (active_case_ids / counts, unchanged from before).
      2. The app-wide ExtractionNotificationProvider — recently finished
         (success/failed) extraction events, enriched with insurer name +
         insurerRef so a toast/notification can be shown anywhere in the
         app, even after the doctor has navigated to a different page.
 
    Response:
    {
      "success": true,
      "active_case_ids": [...],
      "counts": {case_id: n},
      "events": [
        {
          "task_id": str,          # stable id — frontend dedupes on this
          "case_id": str,
          "doc_id": str,
          "status": "success" | "failed",
          "file_name": str,
          "display_label": str,
          "insurer": str | None,
          "insurer_ref": str | None,
          "claimant_name": str | None,
          "fields_found": int | None,   # present for "success"
          "error": str | None,          # present for "failed"
          "completed_at": iso8601 str,
        },
        ...
      ]
    }
    """
    _get_user(request)
 
    TERMINAL_STATUSES = ["success", "failed", "rejected"]
 
    # ── 1. Active (in-flight) tasks — unchanged behavior ────────────────────
    active_cursor = advanced_upload_tasks_col.find(
        {"status": {"$nin": TERMINAL_STATUSES}},
        {"_id": 0, "case_id": 1, "task_id": 1},
    )
    active_docs = await active_cursor.to_list(length=2000)
 
    counts: Dict[str, int] = {}
    for d in active_docs:
        cid = d.get("case_id")
        if not cid:
            continue
        counts[cid] = counts.get(cid, 0) + 1
 
    # ── 2. NEW: recently finished tasks, for notifications + persistent
    # card state. "rejected" (duplicate-in-flight-file guard) is deliberately
    # excluded — it's not a real extraction outcome worth notifying about.
    event_cutoff = datetime.now(IST) - timedelta(minutes=EXTRACTION_EVENT_WINDOW_MINUTES)
    events_cursor = advanced_upload_tasks_col.find(
        {
            "status": {"$in": ["success", "failed"]},
            "updated_at": {"$gte": event_cutoff},
        },
        {"_id": 0},
    ).sort("updated_at", -1).limit(100)
    event_docs = await events_cursor.to_list(length=100)
 
    event_case_ids = list({d["case_id"] for d in event_docs if d.get("case_id")})
    claims_map: Dict[str, Dict[str, Any]] = {}
    if event_case_ids:
        claims_cursor = insurance_claims_col.find(
            {"caseId": {"$in": event_case_ids}},
            {"_id": 0, "caseId": 1, "insurer": 1, "insurerRef": 1, "claimantName": 1},
        )
        claims_map = {c["caseId"]: c async for c in claims_cursor}
 
    events: List[Dict[str, Any]] = []
    for d in event_docs:
        cid = d.get("case_id")
        claim = claims_map.get(cid, {})
        result = d.get("result") or {}
        updated_at = d.get("updated_at")
        events.append({
            "task_id":       d.get("task_id"),
            "case_id":       cid,
            "doc_id":        d.get("doc_id"),
            "status":        d.get("status"),
            "file_name":     d.get("file_name"),
            "display_label": d.get("display_label"),
            "insurer":       claim.get("insurer"),
            "insurer_ref":   claim.get("insurerRef"),
            "claimant_name": claim.get("claimantName"),
            "fields_found":  result.get("fields_found") if isinstance(result, dict) else None,
            "error":         d.get("error"),
            "completed_at":  updated_at.isoformat() if isinstance(updated_at, datetime) else updated_at,
        })
 
    return {
        "success":         True,
        "active_case_ids": list(counts.keys()),
        "counts":          counts,
        "events":          events,
    }

    
@router.get("/web/advanced-upload/staged/{doc_id}")
async def get_staged_advanced_upload(doc_id: str, case_id: str, request: Request):
    """
    Optional convenience lookup — lets the frontend re-fetch page_count /
    pdf_url for a staged (not-yet-extracted) advanced upload, e.g. after a
    page refresh, without re-uploading the file.
    """
    _get_user(request)
    staged = await advanced_upload_staged_col.find_one(
        {"doc_id": doc_id, "case_id": case_id}, {"_id": 0}
    )
    if not staged:
        raise HTTPException(status_code=404, detail="Staged document not found.")
    if isinstance(staged.get("created_at"), datetime):
        staged["created_at"] = staged["created_at"].isoformat()
    if isinstance(staged.get("updated_at"), datetime):
        staged["updated_at"] = staged["updated_at"].isoformat()
    return staged


@router.get("/web/check-processed/{case_id}")
async def check_processed_document(case_id: str, filename: str, request: Request):
    """Check if a document was already processed by Celery."""
    _get_user(request)

    doc = await processed_documents.find_one({
        "patient_id": case_id,
        "$or": [
            {"original_file_name": filename},
            {"file_name": filename},
        ]
    })

    if not doc:
        return {"found": False}

    raw_markdown = (doc.get("raw_markdown") or "").strip()
    if not raw_markdown:
        return {"found": False}

    return {
        "found":             True,
        "stored_filename":   doc.get("file_name"),
        "processed_doc_id":  str(doc["_id"]),
        "raw_markdown":      raw_markdown,
    }


@router.post("/web/extract-from-processed")
async def extract_from_processed(request: Request):
    """Run LLM extraction on an already-processed document (skip upload + Celery)."""
    _get_user(request)
    body = await request.json()

    case_id          = body.get("case_id")
    processed_doc_id = body.get("processed_doc_id")
    doc_label        = body.get("doc_label", "Document")

    from bson import ObjectId
    proc_doc = await processed_documents.find_one({"_id": ObjectId(processed_doc_id)})
    if not proc_doc:
        raise HTTPException(status_code=404, detail="Processed document not found.")

    raw_markdown = (proc_doc.get("raw_markdown") or "").strip()
    if not raw_markdown:
        raise HTTPException(status_code=422, detail="No text in processed document.")

    extracted_flat = _run_llm_extraction(
        raw_markdown,
        doc_label
    )

    # IMPORTANT: normalize + enrich
    extracted_flat = _normalize_extracted_fields(extracted_flat)

    existing_claim_doc = await insurance_claims_col.find_one({"caseId": case_id}, {"description": 1})
    existing_description = (existing_claim_doc or {}).get("description") or ""

    extracted_flat["description"] = _enrich_description(
        raw_markdown,
        extracted_flat,
        existing_description,
    )

    extracted_nested = _unflatten(extracted_flat)

    fields_found = len([
        v for v in extracted_flat.values()
        if v is not None
    ])

    unused_flat = _extract_unused_fields(extracted_flat)

    doc_id = f"CDOC-{uuid.uuid4().hex[:10].upper()}"
    now    = datetime.now(IST)

    new_doc_entry = {
        "doc_id":          doc_id,
        "file_name":       proc_doc.get("original_file_name") or proc_doc.get("file_name") or "unknown",
        "file_type":       None,
        "display_label":   doc_label,
        "pdf_url":         None,
        "storage_path":    None,
        "extraction_mode": "normal",
        "voice_notes":     [],
        "uploaded_at":     now.isoformat(),
    }

    current        = await case_documents_col.find_one({"case_id": case_id}, {"merged_extracted_data": 1})
    current_merged = (current or {}).get("merged_extracted_data", {})
    new_merged     = _deep_merge(current_merged, extracted_nested)

    await case_documents_col.update_one(
            {"case_id": case_id},
            {
                "$push": {"documents": new_doc_entry},
                "$set":  {"merged_extracted_data": new_merged, "updated_at": now},
                "$inc":  {"total_fields_found": fields_found},
            },
        )
    DROPDOWN_ONLY = {'insurer', 'claimMode', 'claimSubtype', 'tags', 'claimTrigger'}

    flat_set_payload = await _build_claim_set_payload(case_id, extracted_flat, DROPDOWN_ONLY)
    flat_set_payload["raw_llama_markdown"] = await _get_accumulated_markdown(case_id, raw_markdown)
    flat_set_payload["updatedAt"] = now
    await _fix_null_parents(insurance_claims_col, case_id, extracted_flat.keys())
    await insurance_claims_col.update_one(
        {"caseId": case_id},
        {"$set": flat_set_payload}
    )

    return {
        "success":          True,
        "doc_id":           doc_id,
        "display_label":    doc_label,
        "extracted_fields": extracted_nested,
        "fields_found":     fields_found,
        "pdf_url":          None,
    }


@router.get("/web/case-documents/{case_id}")
async def get_case_documents(case_id: str, request: Request):
    """Return the single case record (with all documents array + merged data)."""
    _get_user(request)

    record = await case_documents_col.find_one({"case_id": case_id}, {"_id": 0})
    if not record:
        return {
            "case_id":               case_id,
            "documents":             [],
            "merged_extracted_data": {},
            "total_fields_found":    0,
        }

    if isinstance(record.get("created_at"), datetime):
        record["created_at"] = record["created_at"].isoformat()
    if isinstance(record.get("updated_at"), datetime):
        record["updated_at"] = record["updated_at"].isoformat()

    return record


@router.get("/web/case-documents/{case_id}/{doc_id}")
async def get_single_document(case_id: str, doc_id: str, request: Request):
    """Return one specific document entry from within the case record."""
    _get_user(request)

    record = await case_documents_col.find_one({"case_id": case_id}, {"_id": 0})
    if not record:
        raise HTTPException(status_code=404, detail="Case documents not found.")

    doc = next((d for d in record.get("documents", []) if d["doc_id"] == doc_id), None)
    if not doc:
        raise HTTPException(status_code=404, detail="Document not found.")

    return doc


# ═══════════════════════════════════════════════════════════════════════════
# MOBILE ENDPOINTS
# ═══════════════════════════════════════════════════════════════════════════

@router.get("/api/app/my-cases")
async def get_my_cases(request: Request):
    """Mobile: list cases for this supervisor."""
    user          = _get_user(request)
    supervisor_id = user["user_id"]

    cursor = case_documents_col.find(
        {"supervisor_id": supervisor_id},
        {"case_id": 1, "total_fields_found": 1, "updated_at": 1, "documents": 1, "_id": 0},
    ).sort("updated_at", -1).limit(200)
    records = await cursor.to_list(length=200)

    if not records:
        return {"status": "success", "cases": [], "count": 0}

    case_ids   = [r["case_id"] for r in records]
    claims_cur = insurance_claims_col.find(
        {"caseId": {"$in": case_ids}},
        {"_id": 0, "caseId": 1, "claimantName": 1, "insurer": 1,
         "status": 1, "claimPriority": 1, "claimedAmount": 1, "tags": 1},
    )
    claims_map = {c["caseId"]: c async for c in claims_cur}

    result = []
    for r in records:
        cid   = r["case_id"]
        claim = claims_map.get(cid)
        if not claim:
            continue

        docs = r.get("documents", [])
        result.append({
            "case_id":        cid,
            "doc_count":      len(docs),
            "display_labels": [d["display_label"] for d in docs],
            "last_upload":    r["updated_at"].isoformat() if isinstance(r.get("updated_at"), datetime) else r.get("updated_at"),
            "claimantName":   claim.get("claimantName", "—"),
            "insurer":        claim.get("insurer", "—"),
            "status":         claim.get("status", "—"),
            "claimPriority":  claim.get("claimPriority", "Normal"),
            "claimedAmount":  claim.get("claimedAmount"),
            "tags":           claim.get("tags", []),
        })

    return {"status": "success", "cases": result, "count": len(result)}


@router.get("/api/app/case-documents/{case_id}")
async def get_mobile_case_documents(case_id: str, request: Request):
    """Mobile: list all documents within the single case record."""
    _get_user(request)

    record = await case_documents_col.find_one({"case_id": case_id}, {"_id": 0})
    if not record:
        return {"status": "success", "docs": [], "count": 0}

    docs = []
    for d in record.get("documents", []):
        docs.append({
            "doc_id":           d["doc_id"],
            "case_id":          case_id,
            "file_name":        d["file_name"],
            "display_label":    d["display_label"],
            "pdf_url":          d.get("pdf_url"),
            "extraction_mode":  d.get("extraction_mode", "normal"),
            "extracted_data":   d.get("extracted_data", {}),
            "fields_found":     d.get("fields_found", 0),
            "voice_notes":      d.get("voice_notes", []),
            "voice_note_count": len(d.get("voice_notes", [])),
            "uploaded_at":      d.get("uploaded_at"),
        })

    return {"status": "success", "docs": docs, "count": len(docs)}


@router.post("/api/app/voice-annotate")
async def voice_annotate(request: Request):
    """Mobile: add a voice note to a specific document within the case record."""
    user = _get_user(request)
    body = await request.json()

    case_id    = body.get("case_id")
    doc_id     = body.get("doc_id")
    transcript = body.get("transcript", "").strip()

    if not case_id or not doc_id or not transcript:
        raise HTTPException(status_code=400, detail="case_id, doc_id, and transcript are required.")

    record = await case_documents_col.find_one({"case_id": case_id})
    if not record:
        raise HTTPException(status_code=404, detail="Case documents not found.")

    doc_index = next(
        (i for i, d in enumerate(record.get("documents", [])) if d["doc_id"] == doc_id),
        None,
    )
    if doc_index is None:
        raise HTTPException(status_code=404, detail="Document not found.")

    doc             = record["documents"][doc_index]
    existing_data   = doc.get("extracted_data", {})
    new_flat        = _run_voice_llm(transcript, existing_data)
    new_nested      = _unflatten(new_flat)
    merged_doc_data = _deep_merge(existing_data, new_nested)
    new_case_merged = _deep_merge(record.get("merged_extracted_data", {}), new_nested)

    note_entry = {
        "note_id":       f"VN-{uuid.uuid4().hex[:8].upper()}",
        "supervisor_id": user["user_id"],
        "transcript":    transcript,
        "new_fields":    new_nested,
        "recorded_at":   datetime.now(IST).isoformat(),
    }

    await case_documents_col.update_one(
        {"case_id": case_id},
        {
            "$set": {
                f"documents.{doc_index}.extracted_data": merged_doc_data,
                "merged_extracted_data": new_case_merged,
                "updated_at":            datetime.now(IST),
            },
            "$push": {
                f"documents.{doc_index}.voice_notes": note_entry,
            },
        },
    )

    fields_added = len([v for v in new_flat.values() if v is not None])
    return {
        "status":           "success",
        "note_id":          note_entry["note_id"],
        "new_fields_found": fields_added,
        "extracted_data":   merged_doc_data,
        "message":          f"Voice note saved. {fields_added} new fields extracted.",
    }


@router.post("/web/create-draft-case")
async def create_draft_case():
    """Create a DRAFT entry in insurance_claims_new."""
    case_id = f"CIMS-{uuid.uuid4().hex[:8].upper()}"
    result  = await insurance_claims_col.insert_one({
        "caseId":    case_id,
        "status":    "DRAFT",
        "createdAt": datetime.now(IST),
        "updatedAt": datetime.now(IST),
    })
    return {
        "success": True,
        "caseId":  case_id,
        "id":      str(result.inserted_id),
    }


@router.patch("/web/case-documents/{case_id}/form-save")
async def save_form_to_draft(case_id: str, request: Request):
    """
    Save current form values into case_documents.merged_extracted_data
    while the case is in DRAFT status.
    """
    _get_user(request)

    body       = await request.json()
    new_merged = body.get("merged_extracted_data")

    if not isinstance(new_merged, dict):
        raise HTTPException(status_code=400, detail="merged_extracted_data must be a JSON object.")

    now = datetime.now(IST)

    result = await case_documents_col.update_one(
        {"case_id": case_id},
        {"$set": {"merged_extracted_data": new_merged, "updated_at": now}},
    )

    if result.matched_count == 0:
        await case_documents_col.insert_one({
            "case_id":               case_id,
            "merged_extracted_data": new_merged,
            "documents":             [],
            "doc_counter":           0,
            "total_fields_found":    0,
            "supervisor_id":         "web-user",
            "supervisor_role":       "supervisor",
            "created_at":            now,
            "updated_at":            now,
        })

    return {
        "success":  True,
        "case_id":  case_id,
        "message":  "Draft form data saved to case_documents.",
        "saved_at": now.isoformat(),
    }


@router.delete("/web/case-documents/{case_id}")
async def delete_case_documents(case_id: str, request: Request):
    """Hard-delete the case_documents record for a given case_id."""
    _get_user(request)

    result = await case_documents_col.delete_one({"case_id": case_id})

    return {
        "success":      True,
        "case_id":      case_id,
        "docs_deleted": result.deleted_count,
        "message":      (
            f"Case documents for {case_id} deleted."
            if result.deleted_count
            else f"No case_documents record found for {case_id} (nothing to delete)."
        ),
    }


@router.post("/web/case-documents/{case_id}/clear-staging")
async def clear_staging_data(case_id: str, request: Request):
    """
    Clear merged_extracted_data after a DRAFT is successfully submitted.
    Preserves the documents[] array and voice notes as audit trail.
    """
    _get_user(request)
    await case_documents_col.update_one(
        {"case_id": case_id},
        {
            "$unset": {"merged_extracted_data": "", "total_fields_found": ""},
            "$set":   {
                "staging_cleared_at": datetime.now(IST),
                "updated_at":         datetime.now(IST),
            },
        }
    )
    return {"success": True, "case_id": case_id, "message": "Staging data cleared after submission."}

@router.get("/web/check-advanced-processed/{case_id}")
async def check_advanced_processed(case_id: str, filename: str, request: Request):
    """Check if advanced extraction already ran for this file (raw_llama_markdown exists)."""
    _get_user(request)
    
    record = await case_documents_col.find_one({"case_id": case_id}, {"documents": 1})
    if not record:
        return {"found": False}
    
    for doc in record.get("documents", []):
        if doc.get("file_name") == filename and doc.get("raw_markdown"):
            return {
                "found": True,
                "raw_markdown": doc["raw_markdown"],
                "display_label": doc.get("display_label"),
                "doc_id": doc.get("doc_id"),
                "fields_found": doc.get("fields_found", 0),
            }
    return {"found": False}

@router.get("/web/llama-credit-status")
async def get_llama_credit_status():
    stats_doc = await llama_stats_col.find_one({"_id": "global_total"}) or {}
    used = stats_doc.get("credits_used", 0)
    percent = round((used / LLAMA_CREDIT_BUDGET) * 100, 1) if LLAMA_CREDIT_BUDGET else 0
    return {
        "credits_used": used,
        "credit_budget": LLAMA_CREDIT_BUDGET,
        "percent_used": percent,
        "warning": percent >= 90,
    }
    
@router.get("/web/check-file-ingested/{case_id}")
async def check_file_ingested(case_id: str, filename: str, request: Request):
    _get_user(request)
    claim = await insurance_claims_col.find_one(
        {"caseId": case_id}, {"ingested_files": 1}
    )
    ingested = set((claim or {}).get("ingested_files") or [])
    return {"already_uploaded": filename in ingested}


@router.get("/web/check-processing-status/{case_id}")
async def check_processing_status(case_id: str, filename: str, request: Request):
    """
    Tells the frontend whether a file is:
      - "done"       -> already fully ingested; safe to just re-fetch cached result
      - "processing" -> another request is actively working on it (lock is fresh)
      - "idle"       -> no lock, or a stale lock was just auto-cleared; safe to retry
    """
    _get_user(request)

    claim = await insurance_claims_col.find_one(
        {"caseId": case_id}, {"ingested_files": 1, "processing_locks": 1}
    )
    if not claim:
        return {"status": "idle"}

    if filename in set(claim.get("ingested_files") or []):
        return {"status": "done"}

    now = datetime.now(IST)
    stale_cutoff = now - timedelta(seconds=PROCESSING_LOCK_STALE_SECONDS)

    lock_entry = next(
        (l for l in (claim.get("processing_locks") or []) if l.get("filename") == filename),
        None,
    )

    if lock_entry:
        started_at = lock_entry.get("started_at")
        if isinstance(started_at, datetime) and started_at >= stale_cutoff:
            return {"status": "processing", "started_at": started_at.isoformat()}
        # stale — self-heal
        await insurance_claims_col.update_one(
            {"caseId": case_id},
            {"$pull": {"processing_locks": {"filename": filename}}},
        )

    return {"status": "idle"}