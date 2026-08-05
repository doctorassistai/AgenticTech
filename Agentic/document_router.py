"""
Medical Document Processing Router
Docling → Entity Extraction → MongoDB Storage
"""

from typing import Dict, List, Optional
from datetime import datetime
from pathlib import Path
import hashlib
import os
import httpx
from groq import Groq
import json
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from enum import Enum
from motor.motor_asyncio import AsyncIOMotorClient
from loguru import logger
from uuid import uuid4
from pymongo import ReturnDocument
from Agentic.client import send_document_task, send_mongo_document_task,send_patient_summary_task
from Agentic.enhanced_knowledge_graph import EnhancedMedicalKnowledgeGraph, Evidence
from Agentic.oncology_case_view_service import generate_longitudinal_case_view

# ==============================
# ROUTER
# ==============================

router = APIRouter(
    prefix="/documents",
    tags=["Document Processing"]
)

api_key = os.getenv("GROQ_API_KEY")

groq_client = Groq(api_key=api_key)
# ==============================
# DATABASE
# ==============================

MONGO_URI = os.getenv("MONGO_URI", "mongodb://localhost:27017")
DB_NAME = "doctorassistai"

client = AsyncIOMotorClient(MONGO_URI)
db = client[DB_NAME]

integrator_save_api_c = db["integrator_save_api"]
hospital_user_c = db["hospital_users"]
patient_user_collec = db["patient_users"]
doctor_user_c = db["doctor_users"]
patient_appointments_collection = db["patient_appointments"]

processed_documents = db["processed_documents"]
semantic_chunks = db["semantic_chunks"]
timeline_events = db["timeline_events"]
document_evidence = db["document_evidence"]
patient_documents = db["temp_documents"]
temp_data_collection = db["temp_data"]
patient_user_collection = db["patient_users"]
processing_tracker = db["processing_tracker"]
neo4j_uri = os.getenv("NEO4J_URI")
neo4j_user = os.getenv("NEO4J_USER")
neo4j_password = os.getenv("NEO4J_PASSWORD")

knowledge_graph = EnhancedMedicalKnowledgeGraph(
    uri=neo4j_uri,
    user=neo4j_user,
    password=neo4j_password,
    mongo_db=db
)




class DoclingCallbackRequest(BaseModel):
    patient_id: str
    doctor_id: str
    document_url: str
    file_name: Optional[str] = None
    appointment_id: Optional[str] = None
    markdown: str
    structure:dict
    tables: list
    sections: list
# ==============================
# ENUM
# ==============================
class DocumentProcessRequest(BaseModel):
    patient_id: str
    doctor_id: str
    appointment_id: Optional[str] = None

class DocumentProcessReques(BaseModel):
    temp_document_id: str

class DocumentType(str, Enum):
    LAB_REPORT = "lab_report"
    IMAGING_REPORT = "imaging_report"
    PATHOLOGY_REPORT = "pathology_report"
    PRESCRIPTION = "prescription"
    DISCHARGE_SUMMARY = "discharge_summary"
    UNKNOWN = "unknown"


# ==============================
# REQUEST MODEL
# ==============================

class DocumentURLRequest(BaseModel):
    patient_id: str
    doctor_id: str
    document_url: str


# ==============================
# ENTITY MODEL
# ==============================
from typing import Union
class ExtractedEntity(BaseModel):
    entity_type: str
    entity_name: str
    entity_value: Optional[Union[str, float, int]] = None
    confidence: float = 0.9
    evidence_text: str


# ==============================
# DOCLING INIT
# ==============================


async def get_latest_appointment_id(patient_id: str, doctor_id: str):

    pipeline = [
        {"$match": {"sys_user_id": patient_id}},
        {"$unwind": "$appointments"},
        {"$match": {"appointments.doctor_id": doctor_id}},
        {"$sort": {"appointments.date": -1}},
        {"$limit": 1},
        {
            "$project": {
                "_id": 0,
                "appointment_id": "$appointments.appointment_id"
            }
        }
    ]

    cursor = patient_appointments_collection.aggregate(pipeline)
    result = await cursor.to_list(length=1)

    if not result:
        return None

    return result[0].get("appointment_id")

# ==============================
# DOWNLOAD DOCUMENT
# ==============================

async def update_processing_progress(patient_id: str, doctor_id: str):

    

    tracker = await processing_tracker.find_one_and_update(
        {
            "patient_id": patient_id,
            "doctor_id": doctor_id
        },
        {
            "$inc": {"processed_documents": 1}
        },
        return_document=ReturnDocument.AFTER  # ✅ IMPORTANT
    )

    if not tracker:
        return

    processed = tracker["processed_documents"]
    total = tracker["total_documents"]

    if processed >= total:

        logger.info("All documents processed.")

        await processing_tracker.update_one(
            {"patient_id": patient_id, "doctor_id": doctor_id},
            {"$set": {"status": "completed"}}  # ✅ changed from generating_summary
        )

        

UAT_DOCLING_API = "http://143.198.100.153:8999/docling/process"


async def clean_ocr_llm(text: str):

    prompt = f"""
You are a medical document OCR cleaner.

Your task is to clean OCR text while preserving ALL clinically relevant information.

Important principles:
- NEVER remove medical findings, diagnoses, lab tests, values, units, ranges, medications, procedures, or physician notes.
- NEVER remove abnormal flags or interpretation comments.
- NEVER remove patient information such as age or sex if present in the report.

You may clean only obvious OCR noise such as:
- Page numbers
- Decorative headers or footers
- Repeated identical sections caused by OCR duplication
- Scanning artifacts
- Non-medical disclaimers about laboratory liability

Rules:
- Preserve tables and numeric values exactly.
- Preserve medical terminology exactly as written.
- Do NOT summarize or interpret the document.
- Do NOT change medical terms.
- Only remove formatting noise.

Return the cleaned text only.

Document:
{text}
"""

    completion = groq_client.chat.completions.create(
        model="llama-3.3-70b-versatile",
        temperature=0,
        max_tokens=3000,
        messages=[{"role": "user", "content": prompt}]
    )

    return completion.choices[0].message.content



async def send_to_docling(patient_id, doctor_id, file_url, file_name):

    async with httpx.AsyncClient(timeout=60) as client:
        await client.post(
            "http://143.198.100.153:8999/docling/process",  # ✅ internal doc
            json={
                "document_url": file_url,
                
                "callback_url": "http://64.227.186.186:8041/documents/internal/process-document",
                "patient_id": patient_id,
                "doctor_id": doctor_id,
                "file_name": file_name 
            }
        )

async def get_docling_markdown(file_url: str):

    async with httpx.AsyncClient(timeout=300) as client:

        response = await client.post(
            UAT_DOCLING_API,
            json={"document_url": file_url}
        )

        if response.status_code != 200:
            raise Exception(f"Docling service error: {response.text}")

        data = response.json()

        return {
            "structure":data.get("structure",""),
            "markdown": data.get("markdown", ""),
            "tables": data.get("tables", []),
            "sections": data.get("sections", [])
        }

# ==============================
# SECTION EXTRACTION
# ==============================

def extract_sections(markdown_text: str):

    sections = {}
    current = "general"
    sections[current] = []

    for line in markdown_text.split("\n"):

        if line.startswith("#"):
            current = line.replace("#", "").strip().lower()
            sections[current] = []

        elif line.strip():
            sections[current].append(line.strip())

    return {k: "\n".join(v) for k, v in sections.items() if v}


# ===
# ===========================
# ENTITY EXTRACTION
# ==============================
def extract_document_date(document):
    # ============================================
    # Priority 1: Lab Report Date
    # ============================================
    try:
        lab_reports = document.get("lab_reports", {})

        if isinstance(lab_reports, dict):
            reports = lab_reports.get("data")

            if isinstance(reports, list) and reports:
                report = reports[0]

                if isinstance(report, dict):
                    report_date = report.get("report_date")
                    if report_date:
                        return report_date

            elif isinstance(reports, dict):
                report_date = reports.get("report_date")
                if report_date:
                    return report_date

    except Exception:
        pass

    # ============================================
    # Priority 2: Visit Summary Date
    # ============================================
    try:
        visit_summary = document.get("visit_summary", {})

        if isinstance(visit_summary, dict):
            visits = visit_summary.get("data")

            if isinstance(visits, list) and visits:
                visit = visits[0]

                if isinstance(visit, dict):
                    visit_date = visit.get("visit_date")
                    if visit_date:
                        return visit_date

            elif isinstance(visits, dict):
                visit_date = visits.get("visit_date")
                if visit_date:
                    return visit_date

    except Exception:
        pass

    # ============================================
    # Priority 3: Dictation Date
    # ============================================
    try:
        dictation = document.get("dictation", {})

        if isinstance(dictation, dict):
            data = dictation.get("data")

            if isinstance(data, list):
                for item in data:
                    if isinstance(item, dict):
                        date = item.get("date")
                        if date:
                            return date

            elif isinstance(data, dict):
                date = data.get("date")
                if date:
                    return date

    except Exception:
        pass

    # ============================================
    # Priority 4: created_at
    # ============================================
    created_at = document.get("created_at")
    if created_at:
        return created_at

    return None

async def process_mongo_document(patient_id, doctor_id, document, file_name=None):

    # convert entire Mongo document into text
    document.pop("_id", None)

    text = json.dumps(document, indent=2)
    logger.info(f"Thomas:{text}")
    file_name = document.get("file_name")
    file_url = document.get("file_url")
    sections = extract_sections(text)

    base_name = document.get("document_name", "doctor plan")

    entities, llm_date = await extract_entities_llm(text, file_name=base_name)
    entities = await validate_entities_llm(text, entities, file_name=base_name)
    mongo_date = extract_document_date(document)

    document_date = mongo_date or llm_date
    logger.info(f"thomas entity:{document_date}")
    file_hash = hashlib.sha256(text.encode()).hexdigest()
    document_id = f"doc_{file_hash[:10]}"
    processing_timestamp = datetime.utcnow()
    processing_timestamp_iso = processing_timestamp.isoformat()

    base_name = document.get("document_name", "doctor plan")
    file_name_with_ts = f"{base_name}_{processing_timestamp_iso}"
    metadata = {
        "document_id": document_id,
        "patient_id": patient_id,
        "doctor_id": doctor_id,
        "file_name": file_name_with_ts,
        "file_hash": file_hash,

        "processing_date": datetime.utcnow(),
        "document_date": document_date
    }

    demographics = await get_patient_demographics(patient_id)
    await knowledge_graph.create_patient_node(
        patient_id=patient_id,
        demographics=demographics,
        visit_date=datetime.utcnow().isoformat()
    )

    await push_entities_to_graph(
        patient_id,
        document_id,
        entities,
        metadata,
        document_date
    )
    # Generate / Update Longitudinal Case View
    await generate_longitudinal_case_view(
        patient_id=patient_id,
        doctor_id=doctor_id,
        document_text=text,
        document_date=document_date,
        file_name=file_name,
        document_id=document_id,   # <-- add this, it's already computed above this line
    )

    if isinstance(sections, dict):
        sections = [
            {"heading": k, "content": v}
            for k, v in sections.items()
        ]
    chunks = create_chunks(sections, document_id)
    timeline = create_timeline(entities, document_id)

    await processed_documents.insert_one({
        "document_id": document_id,            # ✅ top-level
        "patient_id": patient_id,              # ✅ added
        "doctor_id": doctor_id,                # ✅ added
        "file_url": file_url,      # ✅ now defined
        "file_name": file_name,    # ✅ now defin
        "metadata": metadata,
        "raw_text": text,
        "raw_document": document,
        "sections": sections,
        "entities": [e.dict() for e in entities]
    })

    for c in chunks:
        c["patient_id"] = patient_id
        await semantic_chunks.insert_one(c)

    for t in timeline:
        t["patient_id"] = patient_id
        await timeline_events.insert_one(t)
    
    return {
        "document_id": document_id,
        "entities": len(entities),
        "chunks": len(chunks)
    }



async def validate_entities_llm(original_text: str, entities: List[ExtractedEntity], file_name: str = None) -> List[ExtractedEntity]:
    """
    Cross-checks extracted entities against the original text:
    - removes entities NOT supported by the text (hallucinated / extra)
    - adds any clearly missed clinical entity that should have been extracted
    - fixes negation errors (Diagnosis that should be a negative Finding)
    Falls back to the original (unvalidated) entity list on any failure.
    """
    if not entities:
        return entities

    entities_json = json.dumps([e.dict() for e in entities], indent=2)
    logger.info(f"nomas:{entities_json}")

    validation_prompt = f"""
You are a strict clinical data QA auditor performing a final accuracy pass. Your single most important
job is to make the entity list match the ORIGINAL_TEXT exactly — nothing missing, nothing extra,
nothing misclassified.

You will be given:
1. ORIGINAL_TEXT — the source clinical text.
2. EXTRACTED_ENTITIES — entities a junior model extracted from ORIGINAL_TEXT.

STEP 1 — REMOVE FABRICATIONS not literally supported by ORIGINAL_TEXT.
STEP 2 — RECOVER MISSED ENTITIES (any of the 11 types not already captured).
STEP 3 — FIX NEGATIONS (positive Diagnosis that should be a negative Finding).
STEP 4 — LEAVE CORRECT ENTITIES UNTOUCHED.

Return ONLY valid JSON, no commentary, no markdown fences:
{{
  "entities": [
    {{
      "entity_type": "<one of the 11 types>",
      "entity_name": "<name exactly from text>",
      "entity_value": "<value exactly from text>",
      "confidence": 0.00,
      "evidence_text": "<verbatim or reconstructed text from document>"
    }}
  ]
}}

=== ORIGINAL_TEXT ===
{original_text}

=== EXTRACTED_ENTITIES ===
{entities_json}
"""

    try:
        if _is_chemotherapy_doc(file_name):
            response = await _call_gpt_entities(validation_prompt)
        else:
            completion = groq_client.chat.completions.create(
                model="llama-3.1-8b-instant",
                temperature=0.0,
                max_tokens=6000,
                response_format={"type": "json_object"},
                messages=[{"role": "user", "content": validation_prompt}],
            )
            response = completion.choices[0].message.content

        data = json.loads(response)
        logger.info(f"qhomas:{data}")

        validated = []
        for e in data.get("entities", []):
            entity_name = e.get("entity_name")
            entity_type = e.get("entity_type")
            if not entity_name or not entity_type:
                continue
            validated.append(
                ExtractedEntity(
                    entity_type=str(entity_type),
                    entity_name=str(entity_name),
                    entity_value=str(e.get("entity_value")) if e.get("entity_value") is not None else None,
                    confidence=float(e.get("confidence", 0.9)),
                    evidence_text=str(e.get("evidence_text", "")),
                )
            )

        if not validated and entities:
            logger.warning("Validation returned empty entity list — falling back to original extraction")
            return entities

        return validated

    except Exception as e:
        logger.error(f"Entity validation error: {e} — falling back to unvalidated entities")
        return entities

async def extract_entities_llm(text: str, file_name: str = None):
    prompt = f"""
You are a clinical-grade medical information extraction engine.

PRIMARY OBJECTIVE:
Extract EVERY explicit clinically relevant data element from the input.

Missing any populated clinical information is considered an extraction failure.

The input may be:
- Medical reports
- Pathology reports
- Radiology reports
- Discharge summaries
- Consultation notes
- Operative notes
- Chemotherapy workflows
- Radiotherapy workflows
- Surgical workflows
- Nursing notes
- ICU charts
- EMR exports
- JSON
- Forms
- Tables
- Checklists
- Key-value documents
- Semi-structured documents
- Mixed narrative + structured data

Treat ALL populated clinical fields equally.

Do NOT prioritize narrative text over structured fields.

Every populated clinical field should be considered for extraction.

STRICT RULES

Extract ONLY information explicitly present.

Never infer.

Never hallucinate.

Never summarize.

Never rewrite.

Ignore empty fields.

If multiple sections contain different values for the same concept, extract every occurrence separately.

Never ignore populated JSON fields, form fields, workflow fields, table cells, or structured values.

=== ENTITY TYPES ===

Map EVERY clinically relevant fact into ONE of the following entity types.

- Symptom
- Finding
- Diagnosis
- Procedure
- Medication
- Lab Result
- Vital Sign
- Anatomy
- Measurement
- Investigation
- Treatment
- Document Date

IMPORTANT

If a clinical field does not perfectly fit one category,
choose the closest matching entity type.

Never omit a populated clinical field simply because
it is part of a workflow or form.

Examples

Treatment includes:

• Treatment intent
• Treatment protocol
• Chemotherapy regimen
• Radiotherapy plan
• Dose adjustments
• Drug schedule
• Cycle information
• Concurrent therapy
• Treatment recommendations
• Treatment status
• Planned procedures

Procedure includes:

• Administration route
• Venous access
• Consent
• Pharmacy verification
• Nurse verification
• Drug preparation
• Label verification
• Start time
• End time
• Drug administration

Measurement includes:

• Height
• Weight
• BMI
• BSA
• Drug dose
• Dose per m²
• Calculated dose
• Tumor dimensions
• Lesion measurements
• Numeric clinical values
=== NON-CLINICAL CONTENT — DO NOT EXTRACT ===
Ignore and do NOT create entities from any of the following, even if they contain numbers, dates, or capitalized words:
  - Doctor/staff names, qualifications, designations (e.g. "MBBS", "MD", "DM", "DNB", "Consultant Radiologist")
  - Registration/license/council numbers (e.g. "Reg No", "Registration No", "MMC No", any state medical council ID)
  - Signature blocks, letterhead text, hospital/lab/clinic names, logos, addresses, phone numbers, emails, websites
  - Image/markdown placeholders such as "<!-- image -->", "[image]", "[logo]", scan artifacts
  - Page numbers, "Page X of Y", headers/footers repeated across pages
  - Report generation/print timestamps that are NOT a Report Date, Collection Date, Procedure Date, Order Date,
    Visit Date, Admission Date, or Discharge Date (e.g. "Printed on", "Generated on")
  - Disclaimers, watermark text, "This is a computer-generated report" type boilerplate
  - Printed/blank form field labels with no handwritten or filled-in content next to them
    (e.g. a printed "Diagnosis:" label followed by nothing, or an unchecked/blank checkbox
    with no accompanying text) are NOT entities

=== MAPPING RULES FOR COMPLEX CLINICAL DATA ===

STAGING & GRADING → map to "Diagnosis"
  - TNM, FIGO, Ann Arbor, Gleason, ISUP, CKD stage, NYHA, Child-Pugh, BIRADS, LIVERADS, APACHE II
  - entity_name  = staging system name
  - entity_value = stage/grade exactly as written in the text

RADIOLOGY / PATHOLOGY IMPRESSIONS → map to "Finding"
  - entity_name  = "Radiologist Impression" or "Pathology Impression"
  - entity_value = full impression text exactly as written

IMAGING OBSERVATIONS (individual findings) → map to "Finding"
  - One entity per distinct observation
  - entity_name  = finding label
  - entity_value = descriptive detail as written

LESION / ORGAN SIZES & DIMENSIONS → map to "Measurement"
  - entity_name  = what is being measured
  - entity_value = value and unit exactly as written

FOLLOW-UP / RECOMMENDATIONS → map to "Treatment"
  - Only extract if the text explicitly contains action/advice language such as:
    "advised", "recommended", "follow-up", "consult", "review after", "repeat in", "continue", "stop"
  - entity_name  = the exact action phrase as written in the text
    (e.g. "Cardiology consultation advised", "Follow-up in 2 weeks")
  - entity_value = the full instruction exactly as written
  - Do NOT invent a generic entity_name like "Recommendation" — always use the literal wording
    from the text
  - Do NOT create a Treatment entity for something you infer *should* be recommended based on
    the diagnosis or findings — only extract what the document itself explicitly instructs

ABNORMALITY FLAGS → embed inside "Lab Result" entity_value only
  - Derive flag from the normal range IF the range is explicitly stated in the text
  - If no range is present in the text, do NOT add a flag
  - Flag logic (apply only when range is present in text):
      Result > upper limit           → "| flag: HIGH"
      Result < lower limit           → "| flag: LOW"
      Result in borderline zone      → "| flag: BORDERLINE"
      Critically out of range        → "| flag: CRITICAL HIGH" or "| flag: CRITICAL LOW"
      Result within normal range     → "| flag: NORMAL"
  - entity_value format (include only parts present in text):
    "<result> <unit> | range: <normal range> | flag: <derived flag>"

=== ENTITY-SPECIFIC RULES ===

Lab Result:
  - Every test with a result value = one Lab Result entity
  - entity_name  = test name exactly as written
  - entity_value = result and unit as written; append range and flag only if present in text
  - evidence_text = reconstruct as: "Test: [name], Result: [value] [unit], Range: [range if present]"
  - Do NOT merge multiple tests into one entity

Vital Sign:
  - Only: BP, HR, RR, SpO2, Temperature, Height, Weight, BMI, Pulse
  - Do NOT extract Age, Sex, Gender, or Patient ID as Vital Sign

Diagnosis:
  - Confirmed or suspected conditions AND all staging/grading mentioned in text
  - NEVER extract a diagnosis that the text negates (see NEGATION RULES below)

Finding:
  - Imaging observations, exam findings, pathology findings
  - One entity per distinct finding
  - Includes NEGATIVE findings (see NEGATION RULES below)

Measurement:
  - Sizes, dimensions, volumes, ejection fraction, or numeric clinical parameters
    that are NOT lab results or vital signs

Investigation:
  - Ordered, recommended, pending, or follow-up investigations mentioned in text
  - entity_name  = investigation name
  - entity_value = purpose or instruction exactly as written

Medication:
  - entity_value = include only the parts present in text: drug, dose, frequency, route

Treatment:

Extract ALL treatment-related information explicitly present.

Including but not limited to:

• Treatment intent
• Treatment goal
• Selected protocol
• Drug regimen
• Chemotherapy plan
• Radiotherapy plan
• Surgery plan
• Dose adjustment
• Cycle number
• Planned cycles
• Concurrent therapy
• Sequential therapy
• Radical treatment
• Palliative treatment
• Follow-up plan
• Monitoring plan
• Recommendations

Do not omit treatment workflow fields.

Map them to Treatment.

Document Date:
  - Extract every date found in the text
  - Populate top-level "document_date" using this priority:
      1. Report Date
      2. Collection Date
      3. Procedure Date
      4. Order Date
      5. Visit Date
      6. Admission Date
      7. Discharge Date
      8. Earliest date found
  - Format: YYYY-MM-DD
  - If no date found anywhere in the text, set "document_date": null

=== NEGATION RULES ===

If the text explicitly negates a condition using language such as:
- No evidence of ...
- No ...
- Absent ...
- Negative for ...
- Without ...
- Not seen ...
- No obvious ...

DO NOT extract the condition/abnormality itself as a Diagnosis.

Instead, extract it as a Finding:
  entity_name  = "No <condition>" (preserve the exact negated phrasing)
  entity_value = the full negated sentence exactly as written

Example:
  Text: "No obvious destructive bony lesion is seen on this study."
  ❌ WRONG → Diagnosis: "destructive bony lesion"
  ✅ CORRECT → Finding: entity_name="No destructive bony lesion",
                entity_value="No obvious destructive bony lesion is seen on this study."

This applies consistently to all negated findings (e.g. "No pleural effusion", "No pneumothorax",
"No mediastinal lymphadenopathy", "No pericardial effusion", "No acute aortic abnormality").

IMPORTANT: negation only applies when the text EXPLICITLY contains negating words. Absence of
mention is NOT a negative finding — do not infer a negation just because something wasn't discussed.

=== STRICT PROHIBITIONS ===
- Do NOT extract any value not explicitly written in the text
- Do NOT use external medical knowledge to fill gaps
- Do NOT add entity types beyond the 11 listed above
- Do NOT merge distinct findings or results into one entity
- Do NOT add flags, ranges, doses, or units unless they appear in the text
- Do NOT extract anything from doctor credentials, registration numbers, letterhead, signature
  blocks, image placeholders, or other non-clinical content described above
- Do NOT create duplicate entities for the same fact
- Do NOT convert a negated finding into a positive Diagnosis
- Do NOT invent a "No X" finding unless the text contains an explicit negation word
- Do NOT use a generic/placeholder entity_name (e.g. "Recommendation", "Finding", "Note") —
  always use the exact wording present in the text

=== COMPLETENESS CHECK (internal — do not output) ===

Before returning:

Verify that EVERY populated clinical field has been extracted.

Check specifically for:

✓ Diagnoses
✓ Symptoms
✓ Findings
✓ Anatomy
✓ Procedures
✓ Medications
✓ Laboratory results
✓ Vital signs
✓ Measurements
✓ Investigations
✓ Treatment information

Also verify extraction of workflow-specific information including:

✓ Treatment intent
✓ Treatment protocol
✓ Drug regimen
✓ Drug schedule
✓ Drug route
✓ Dose
✓ Dose adjustments
✓ Calculated dose
✓ BSA
✓ Cycle number
✓ Planned cycles
✓ Current cycle
✓ Administration
✓ Concurrent therapy
✓ Surgery
✓ Radiotherapy
✓ Venous access
✓ Consent
✓ Pharmacy verification
✓ Nurse verification
✓ Organ function
✓ Performance status
✓ Allergies
✓ Clinical assessment
✓ Monitoring
✓ Follow-up

Finally verify:

No populated JSON key containing clinical information was skipped.

No populated table cell containing clinical information was skipped.

No populated workflow field containing clinical information was skipped.

=== SELF-CHECK BEFORE RETURNING (internal — do not output) ===

Read the document one final time.

Ask yourself:

"Did I skip any populated clinical field?"

If YES,
extract it.

Only after every populated clinical field has been extracted,
return the JSON.

Never discard a populated field because it looks administrative.

If the field influences diagnosis,
treatment,
medication,
investigation,
procedure,
measurement,
clinical assessment,
or patient management,

it MUST appear in the output.

Prefer over-extraction rather than under-extraction.

Missing clinically relevant information is considered a failure.
=== OUTPUT FORMAT ===
Return ONLY valid JSON. No commentary, no markdown fences.

{{
  "document_date": "YYYY-MM-DD or null",
  "entities": [
    {{
      "entity_type": "<one of the 11 types>",
      "entity_name": "<name exactly from text>",
      "entity_value": "<value exactly from text>",
      "confidence": 0.00,
      "evidence_text": "<verbatim or reconstructed text from document>"
    }}
  ]
}}

=== INPUT TEXT ===
{text}
"""

    if _is_chemotherapy_doc(file_name):
        response = await _call_gpt_entities(prompt)
    else:
        completion = groq_client.chat.completions.create(
            model="llama-3.3-70b-versatile",
            temperature=0.1,
            max_tokens=6000,
            response_format={"type": "json_object"},
            messages=[{"role": "user", "content": prompt}],
        )
        response = completion.choices[0].message.content
    try:
        data = json.loads(response)
        document_date = data.get("document_date")
        entities = []
        for e in data.get("entities", []):
            entity_name = e.get("entity_name")
            entity_type = e.get("entity_type")
            if not entity_name or not entity_type:
                continue
            entities.append(
                ExtractedEntity(
                    entity_type=str(entity_type),
                    entity_name=str(entity_name),
                    entity_value=str(e.get("entity_value")) if e.get("entity_value") is not None else None,
                    confidence=float(e.get("confidence", 0.9)),
                    evidence_text=str(e.get("evidence_text", "")),
                )
            )
        return entities, document_date
    except Exception as e:
        logger.error(f"LLM entity parsing error: {e}")
        return [], None

from datetime import datetime

async def get_patient_demographics(patient_id: str):

    patient = await patient_user_collection.find_one({"sys_user_id": patient_id})

    if not patient:
        return {"age": None, "sex": None}

    gender = patient.get("gender")

    dob = patient.get("date_of_birth")
    age = None

    if dob:
        try:
            if isinstance(dob, str):
                dob = datetime.strptime(dob, "%Y-%m-%d")

            today = datetime.utcnow()
            age = today.year - dob.year - (
                (today.month, today.day) < (dob.month, dob.day)
            )
        except Exception:
            age = None

    return {
        "age": age,
        "sex": gender
    }

async def push_entities_to_graph(patient_id, document_id, entities, metadata,document_date):

    for e in entities:

        evidence = Evidence(
            evidence_id=f"ev_{uuid4().hex[:10]}",
            document_id=document_id,
            document_name=metadata["file_name"],
            document_type="clinical_document",
            document_date=document_date,
            evidence_text=e.evidence_text,
            confidence=e.confidence,
            extraction_date=datetime.utcnow()
        )

        entity_type = e.entity_type.lower()

        if entity_type == "diagnosis":

            await knowledge_graph.add_diagnosis_with_evidence(
                patient_id=patient_id,
                diagnosis=e.entity_name,
                diagnosis_date=document_date,
                record_type="current",
                confidence=str(e.confidence),
                evidence=evidence
            )

        elif entity_type == "medication":

            await knowledge_graph.add_medication_with_evidence(
                patient_id=patient_id,
                drug_name=e.entity_name,
                dose=e.entity_value or "",
                indication="",
                start_date=document_date,
                record_type="current",
                evidence=evidence
            )
        elif entity_type == "investigation":

            await knowledge_graph.add_investigation_with_evidence(
                patient_id=patient_id,
                investigation=e.entity_name,
                details=e.entity_value or "",
                investigation_date=document_date,
                evidence=evidence
            )

        elif entity_type == "symptom":

            await knowledge_graph.add_symptom_with_evidence(
                patient_id=patient_id,
                symptom=e.entity_name,
                onset_date=document_date,
                severity=None,
                record_type="current",
                evidence=evidence
            )

        elif entity_type == "lab result":

            await knowledge_graph.add_lab_result_with_evidence(
                patient_id=patient_id,
                test_name=e.entity_name,
                value=e.entity_value or "",
                test_date=document_date,
                record_type="current",
                is_abnormal=False,
                evidence=evidence
            )

        elif entity_type == "vital sign":

            await knowledge_graph.add_vital_sign_with_evidence(
                patient_id=patient_id,
                vital_type=e.entity_name,
                value=e.entity_value or "",
                measurement_date=document_date,
                is_abnormal=False,
                evidence=evidence
            )
        elif entity_type == "anatomy":

            await knowledge_graph.add_anatomy_with_evidence(
                patient_id,
                e.entity_name,
                document_date,
                evidence
            )

        elif entity_type == "finding":

            await knowledge_graph.add_finding_with_evidence(
                patient_id,
                e.entity_name,
                document_date,
                evidence
            )

        elif entity_type == "procedure":

            await knowledge_graph.add_procedure_with_evidence(
                patient_id,
                e.entity_name,
                document_date,
                evidence
            )

        elif entity_type == "measurement":

            await knowledge_graph.add_measurement_with_evidence(
                patient_id,
                e.entity_name,
                document_date,
                evidence
            )
        elif entity_type == "treatment":

            await knowledge_graph.add_treatment_with_evidence(
                patient_id,
                e.entity_name,
                e.entity_value or "",
                document_date,
                evidence
            )        
# ==============================
# CHUNK CREATION
# ==============================

def create_chunks(sections: List[dict], document_id: str):

    chunks = []

    for sec in sections:

        content = sec.get("content", "")
        heading = sec.get("heading", "general")

        for sentence in content.split("."):

            sentence = sentence.strip()

            if len(sentence) > 30:
                chunks.append({
                    "document_id": document_id,
                    "section": heading,
                    "text": sentence
                })

    return chunks


# ==============================
# TIMELINE
# ==============================

def create_timeline(entities, document_id):

    return [
        {
            "document_id": document_id,
            "event_type": e.entity_type,
            "entity": e.entity_name,
            "date": datetime.utcnow()
        }
        for e in entities
    ]


# ==============================
# MAIN PROCESSING
# ==============================

async def process_document(patient_id, doctor_id, url):

    try:

        logger.info("Calling UAT Docling service")

        doc_data = await get_docling_markdown(url)
        structure = doc_data["structure"]
        markdown = doc_data["markdown"]
        tables = doc_data["tables"]
        sections = doc_data["sections"]
        

        llm_input = json.dumps({
            "text": markdown,
            "tables": tables,
            "sections": sections
        }, indent=2)

        entities, document_date = await extract_entities_llm(llm_input)
        
        entities = await validate_entities_llm(llm_input, entities)

        file_hash = hashlib.sha256(url.encode()).hexdigest()

        document_id = f"doc_{file_hash[:10]}"

        file_name = url.split("/")[-1]

        metadata = {
            "document_id": document_id,
            "patient_id": patient_id,
            "doctor_id": doctor_id,
            "file_name": file_name,
            "file_hash": file_hash,
            "processing_date": datetime.utcnow(),
            "document_date": document_date
        }

        demographics = await get_patient_demographics(patient_id)

        await knowledge_graph.create_patient_node(
            patient_id=patient_id,
            demographics=demographics,
            visit_date=datetime.utcnow().isoformat()
        )

        await push_entities_to_graph(
            patient_id,
            document_id,
            entities,
            metadata,
            document_date
        )

        chunks = create_chunks(sections, document_id)

        timeline = create_timeline(entities, document_id)

        await processed_documents.insert_one({
            "metadata": metadata,
            "structure":structure,
            "raw_markdown": markdown,

            "sections": {
                "tables": tables,
                "sections": sections
            },

            "entities": [e.dict() for e in entities]
        })

        for c in chunks:
            c["patient_id"] = patient_id
            await semantic_chunks.insert_one(c)

        for t in timeline:
            t["patient_id"] = patient_id
            await timeline_events.insert_one(t)

        for e in entities:
            await document_evidence.insert_one({
                "patient_id": patient_id,
                "document_id": document_id,
                "entity_type": e.entity_type,
                "entity_name": e.entity_name,
                "evidence_text": e.evidence_text,
                "confidence": e.confidence
            })

        return {
            "document_id": document_id,
            "entities": len(entities),
            "chunks": len(chunks)
        }

    except Exception as e:

        logger.error(f"Document processing failed for {url}: {str(e)}")

        return {
            "error": str(e),
            "document_url": url
        }

    finally:

        # 🔴 THIS ALWAYS RUNS (SUCCESS OR FAILURE)
        await update_processing_progress(patient_id, doctor_id)

# ==============================
# ROUTER ENDPOINT
# ==============================



@router.post("/internal/process-document")
async def process_document_internal(req: DoclingCallbackRequest):

    patient_id = req.patient_id
    doctor_id = req.doctor_id
    url = req.document_url

    success = False

    try:
        logger.info(f"Processing Docling callback for {url}")
        logger.info(f"Callback file_name: {req.file_name}")
        raw_structure = req.structure or {}

        texts = []

        for item in raw_structure.get("texts", []):

            texts.append({
                "label": item.get("label"),
                "text": item.get("text"),
                "page": (
                    item.get("prov", [{}])[0]
                    .get("page_no", 1)
                )
            })

        structure = {
            "texts": texts
        } 
        markdown = req.markdown
        tables = req.tables or []
        sections = req.sections or []

        # ✅ Prepare LLM input
        llm_input = json.dumps({
            "text": markdown,
            "tables": tables,
            "sections": sections
        }, indent=2)
        appointment_id = req.appointment_id
        logger.info(f"appointment_id:{appointment_id}")
        # ✅ Extract entities
        entities, document_date = await extract_entities_llm(llm_input)
        entities = await validate_entities_llm(llm_input, entities)

        # ✅ Generate IDs
        file_hash = hashlib.sha256(url.encode()).hexdigest()
        document_id = f"doc_{file_hash[:10]}"
        og=req.file_name
        logger.info(f"thomas file:{og}")
        file_name = url.split("/")[-1]
        
        # ✅ Metadata
        metadata = {
            "document_id": document_id,
            "patient_id": patient_id,
            "doctor_id": doctor_id,
            "file_name": file_name,
            "file_hash": file_hash,
            "processing_date": datetime.utcnow(),
            "document_date": document_date
        }

        # ✅ Patient node
        demographics = await get_patient_demographics(patient_id)

        await knowledge_graph.create_patient_node(
            patient_id=patient_id,
            demographics=demographics,
            visit_date=datetime.utcnow().isoformat()
        )

        # ✅ Push to graph
        await push_entities_to_graph(
            patient_id,
            document_id,
            entities,
            metadata,
            document_date
        )

        # ✅ Fix sections format (important)
        if isinstance(sections, dict):
            sections = [{"heading": k, "content": v} for k, v in sections.items()]

        # ✅ Chunks + timeline
        chunks = create_chunks(sections, document_id)
        timeline = create_timeline(entities, document_id)

        # ✅ Store processed doc
        await processed_documents.insert_one({
            "document_id": metadata.get("document_id"),
            "patient_id": metadata.get("patient_id"),
            "doctor_id": metadata.get("doctor_id"),
            "appointment_id": appointment_id,   # ✅ ADD THIS
            "file_url": url,          # ✅ ADD THIS
            "file_name": metadata.get("file_name"),  # ✅ ADD THIS
            "og_file_name":og,
            "metadata": metadata,
            "structure":structure,
            "raw_markdown": markdown,

            "sections": {
                "tables": tables,
                "sections": sections
            },

            "entities": [e.dict() for e in entities]
        })
        
        try:

            latest_document_payload = {

                "tag": "processed_document",

                "document_id":
                    metadata.get("document_id"),

                "file_name":
                    metadata.get("file_name"),

                "raw_markdown":
                    markdown,

                "sections": {
                    "tables": tables,
                    "sections": sections
                },

                "entities":
                    [e.dict() for e in entities],

                "processing_date":
                    str(metadata.get("processing_date")),

                "document_date":
                    str(metadata.get("document_date"))
            }

            await trigger_hospital_integrator_reportupload(
                latest_document_payload,
                doctor_id,
                patient_id
            )

            logger.info(
                f"✅ Hospital integrator triggered | doc={document_id}"
            )

        except Exception as integrator_error:

            logger.error(
                f"❌ Hospital integrator failed | "
                f"doc={document_id} | "
                f"error={str(integrator_error)}",
                exc_info=True
            )
        # ✅ Store chunks
        for c in chunks:
            c["patient_id"] = patient_id
            await semantic_chunks.insert_one(c)

        # ✅ Store timeline
        for t in timeline:
            t["patient_id"] = patient_id
            await timeline_events.insert_one(t)

        # ✅ Store evidence
        for e in entities:
            await document_evidence.insert_one({
                "patient_id": patient_id,
                "document_id": document_id,
                "entity_type": e.entity_type,
                "entity_name": e.entity_name,
                "evidence_text": e.evidence_text,
                "confidence": e.confidence
            })

        success = True

        # ── Trigger graph pipeline only if doctor exists in DB ──
        pipeline_id = None

        try:
            logger.info(
                f"🚀 Triggering graph pipeline | "
                f"doctor_id={doctor_id} | "
                f"patient_id={patient_id} | "
                f"document_id={document_id} | "
                f"markdown_length={len(markdown) if markdown else 0}"
            )

            doctor = await db["doctor_users"].find_one({"sys_user_id": doctor_id})

            if not doctor:
                logger.warning(
                    f"Doctor {doctor_id} not found in doctor_users — skipping graph pipeline | doc={document_id}"
                )

            else:
                payload = {
                    "doctor_id": doctor_id,
                    "patient_id": patient_id,
                    "markdown": markdown,
                }

                # -----------------------------
                # LOG PAYLOAD BEFORE SENDING
                # -----------------------------
                logger.info(
                    f"📤 Sending graph payload | "
                    f"doc={document_id} | "
                    f"payload_keys={list(payload.keys())} | "
                    f"doctor_id={payload['doctor_id']} | "
                    f"patient_id={payload['patient_id']} | "
                    f"markdown_preview={payload['markdown'][:1000] if payload['markdown'] else 'EMPTY'}"
                )

                async with httpx.AsyncClient(timeout=120) as http:

                    pipeline_resp = await http.post(
                        "https://doctorassist.ai/api/hms/users/ai-legacy/graph-pipeline/run-direct",
                        json=payload
                    )

                    # -----------------------------
                    # LOG RESPONSE
                    # -----------------------------
                    logger.info(
                        f"📥 Graph pipeline response | "
                        f"doc={document_id} | "
                        f"status={pipeline_resp.status_code} | "
                        f"response_preview={pipeline_resp.text[:2000]}"
                    )

                    if pipeline_resp.status_code == 200:

                        result = pipeline_resp.json()

                        pipeline_id = result.get("pipeline_id")

                        logger.info(
                            f"✅ Graph complete | "
                            f"pipeline_id={pipeline_id} | "
                            f"nodes={result.get('total_nodes')} | "
                            f"edges={result.get('total_edges')} | "
                            f"reworks={result.get('reworks_detected')} | "
                            f"skills={result.get('new_skill_candidates')} | "
                            f"doc={document_id}"
                        )

                    else:
                        logger.error(
                            f"❌ Graph pipeline failed | "
                            f"doc={document_id} | "
                            f"status={pipeline_resp.status_code} | "
                            f"response={pipeline_resp.text}"
                        )

        except Exception as graph_err:

            logger.exception(
                f"💥 Graph pipeline exception | "
                f"doc={document_id} | "
                f"error={str(graph_err)}"
            )

        return {
            "status":      "processed",
            "document_id": document_id,
            "entities":    len(entities),
            "chunks":      len(chunks),
            "pipeline_id": pipeline_id,
        }

    except Exception as e:
        logger.error(f"Document processing failed for {url}: {str(e)}")
        return {
            "status": "failed",
            "error":  str(e),
            "document_url": url
        }

    finally:
        if success:
            await update_processing_progress(patient_id, doctor_id)


@router.post("/internal/process-mongo-document")
async def process_mongo_document_internal(payload: dict):

    result = await process_mongo_document(
        payload["patient_id"],
        payload["doctor_id"],
        payload["document"]
    )

    return {
        "status": "processed",
        "data": result
    }



@router.post("/process")
async def process_documents_api(req: DocumentProcessRequest):

    try:

        patient_id = req.patient_id
        doctor_id = req.doctor_id
        appointment_id = req.appointment_id
        queued = 0

        # =========================
        # QUEUE URL DOCUMENTS
        # =========================
        logger.info(f"appointment_id:{appointment_id}")
        documents = await patient_documents.find(
            {"patient_id": patient_id}
        ).to_list(length=None)
        logger.info(f"douments:{documents}")
        for doc in documents:

            file_url = doc.get("file_url")
            file_name = doc.get("file_name")   # ✅ ADD THIS

            if not file_url:
                continue

            send_document_task(
                patient_id,
                doctor_id,
                file_url,
                file_name,
                appointment_id
            )
            queued += 1

        if documents:
            await patient_documents.delete_many({"patient_id": patient_id})

        # =========================
        # QUEUE MONGO DOCUMENTS
        # =========================

        
        # =========================
        # TRIGGER PATIENT SUMMARY
        # =========================

        
        if queued == 0:
            raise HTTPException(
                status_code=404,
                detail="No documents found to process"
            )

        await processing_tracker.update_one(
            {
                "patient_id": patient_id,
                "doctor_id": doctor_id
            },
            {
                "$inc": {
                    "total_documents": queued
                },
                "$set": {
                    "status": "processing"
                },
                "$setOnInsert": {
                    "processed_documents": 0,
                    "created_at": datetime.utcnow()
                }
            },
            upsert=True
        )
        
        return {
            "status": "queued",
            "documents_queued": queued
        }

    except Exception as e:
        logger.error(e)
        raise HTTPException(status_code=500, detail=str(e))
    
    
from bson import ObjectId
from fastapi import HTTPException

@router.post("/process-mongo")
async def process_mongo_documents_api(req: DocumentProcessReques):
    try:
        # ==========================================================
        # Fetch the specific temp Mongo document
        # ==========================================================
        mongo_doc = await temp_data_collection.find_one(
            {"_id": ObjectId(req.temp_document_id)}
        )

        if mongo_doc is None:
            raise HTTPException(
                status_code=404,
                detail="Mongo document not found"
            )

        patient_id = mongo_doc["patient_id"]
        doctor_id = mongo_doc["doctor_id"]

        # Remove Mongo _id before sending to worker
        mongo_doc.pop("_id", None)

        # ==========================================================
        # Queue document for processing
        # ==========================================================
        send_mongo_document_task(
            patient_id=patient_id,
            doctor_id=doctor_id,
            document=mongo_doc
        )

        # ==========================================================
        # Delete temp document after queueing
        # ==========================================================
        await temp_data_collection.delete_one(
            {"_id": ObjectId(req.temp_document_id)}
        )

        return {
            "status": "queued",
            "message": "Mongo document queued successfully",
            "patient_id": patient_id,
            "doctor_id": doctor_id,
            "temp_document_id": req.temp_document_id
        }

    except HTTPException:
        raise

    except Exception as e:
        logger.exception("Mongo processing failed")
        raise HTTPException(
            status_code=500,
            detail=str(e)
        )
async def trigger_hospital_integrator_reportupload(document, doctor_id,patient_id):

    try:

        logger.info("🚀 Starting hospital integrator trigger")
        logger.info(f"📌 Incoming doctor_id: {doctor_id}")
        logger.info(f"patient_id:{patient_id}")
        # ======================================================
        # 1. FIND DOCTOR
        # ======================================================
        logger.info("🔍 Finding doctor details")

        doctor = await doctor_user_c.find_one(
            {"sys_user_id": doctor_id},
            {"_id": 0, "hospital_id": 1,"doctor_id": 1}
        )

        if not doctor:
            logger.warning(f"❌ Doctor not found: {doctor_id}")
            return

        logger.info(f"✅ Doctor found: {doctor}")

        hospital_id = doctor.get("hospital_id")
        actual_doctor_id = doctor.get("doctor_id")
        if not hospital_id:
            logger.warning(f"❌ No hospital_id for doctor: {doctor_id}")
            return

        logger.info(f"🏥 Hospital ID: {hospital_id}")

        patient = await patient_user_collec.find_one(
            {"sys_user_id": patient_id},
            {"_id": 0, "patient_id": 1}
        )

        if not doctor:
            logger.warning(f"❌ Doctor not found: {patient_id}")
            return
        logger.info(f"✅ patient found: {patient}")

        actual_patient_id = patient.get("patient_id")
        # ======================================================
        # 2. FIND HOSPITAL SYS USER ID
        # ======================================================
        logger.info("🔍 Finding hospital sys_user_id")

        hospital = await hospital_user_c.find_one(
            {"sys_user_id": hospital_id},
            {"_id": 0, "sys_user_id": 1}
        )

        if not hospital:
            logger.warning(f"❌ Hospital not found: {hospital_id}")
            return

        logger.info(f"✅ Hospital found: {hospital}")

        sys_user_id = hospital.get("sys_user_id")

        if not sys_user_id:
            logger.warning(f"❌ sys_user_id missing for hospital: {hospital_id}")
            return

        logger.info(f"👤 Hospital sys_user_id: {sys_user_id}")

        # ======================================================
        # 3. GET SAVE API
        # ======================================================
        logger.info("🔍 Fetching integrator save_api")

        api_doc = await integrator_save_api_c.find_one(
            {"sys_user_id": sys_user_id},
            {"_id": 0, "save_api": 1}
        )

        if not api_doc:
            logger.warning(
                f"❌ No integrator API configured for hospital: {hospital_id}"
            )
            return

        logger.info(f"✅ Integrator config found: {api_doc}")

        save_api = api_doc.get("save_api")

        if not save_api:
            logger.warning(f"❌ Empty save_api for hospital: {hospital_id}")
            return

        logger.info(f"🌐 save_api URL: {save_api}")

        # ======================================================
        # 4. PREPARE PAYLOAD
        # ======================================================
        payload = {
            "tag": document.get("tag"),
            "patient_id": actual_patient_id,
            "doctor_id": actual_doctor_id,
            "data": document
        }

        logger.info(f"📦 Payload prepared: {payload}")

        # ======================================================
        # 5. SEND DOCUMENT TO HOSPITAL API
        # ======================================================
        logger.info("📡 Sending payload to hospital integrator API")

        async with httpx.AsyncClient(timeout=20.0) as client:

            response = await client.post(
                save_api,
                json=payload
            )

            logger.info(
                f"✅ Integrator API response status: {response.status_code}"
            )

            logger.info(
                f"📨 Integrator API response body: {response.text}"
            )

        logger.info(
            f"🎉 Hospital integrator completed successfully | hospital={hospital_id}"
        )

    except Exception as e:

        logger.error(
            f"💥 Hospital integrator trigger failed: {str(e)}",
            exc_info=True
        )
        
        
OPENROUTER_API_KEY = os.getenv("OPENROUTER_API_KEY")
OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions"
OPENROUTER_MODEL = os.getenv("OPENROUTER_MODEL", "openai/gpt-4o")


def _is_chemotherapy_doc(file_name: str) -> bool:
    if not file_name:
        return False
    name = file_name.lower()
    return (
        "cghgdja" in name
        or "xgzjhx" in name
        or "sudhjsjhszcr" in name
    )


async def _call_gpt_entities(prompt: str) -> str:
    if not OPENROUTER_API_KEY:
        raise Exception("OPENROUTER_API_KEY is not set")
    headers = {
        "Authorization": f"Bearer {OPENROUTER_API_KEY}",
        "Content-Type": "application/json",
    }
    payload = {
        "model": OPENROUTER_MODEL,
        "messages": [{"role": "user", "content": prompt}],
        "temperature": 0.1,
        "response_format": {"type": "json_object"},
    }
    async with httpx.AsyncClient(timeout=180) as client:
        response = await client.post(OPENROUTER_URL, headers=headers, json=payload)
    if response.status_code != 200:
        raise Exception(f"OpenRouter entity extraction failed: {response.status_code} | {response.text}")
    result = response.json()
    return result["choices"][0]["message"]["content"]