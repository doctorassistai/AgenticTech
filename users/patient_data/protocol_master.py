import os
import uuid
import asyncio
from fastapi import APIRouter, HTTPException, UploadFile, File, Form
import json
import io
from pydantic import BaseModel
from typing import Any, Dict, Optional
from motor.motor_asyncio import AsyncIOMotorClient
import logging
import re
from datetime import datetime, timedelta
from groq import Groq
from typing import Any, Dict, List, Optional, Union

logger = logging.getLogger(__name__)

MONGO_URI = os.getenv("MONGO_URI")
MONGO_DB = "doctorassistai"

try:
    mongodb_client = AsyncIOMotorClient(MONGO_URI)
    database = mongodb_client[MONGO_DB]
    protocol_master_collection = database["protocol_master"]
    summary_collection =  database["patient_summary"]
    chemotherapy_records_collection = database["chemotherapy_records"]
except Exception as e:
    logger.error(f"Error initializing MongoDB: {e}")


SECRET_KEY = os.getenv("SECRET_KEY")
ALGORITHM = os.getenv("ALGORITHM")
ACCESS_TOKEN_EXPIRE_DAYS = os.getenv("ACCESS_TOKEN_EXPIRE_DAYS")

api_key = os.getenv("GROQ_API_KEY")

groq_client = Groq(api_key=api_key)

router = APIRouter(prefix="/protocol_master", tags=["protocol_master"])


###22-07-2026- Aleena

# @router.post("/protocol-master/seed")
# async def seed_protocols():
#     logger.info("Starting protocol seeding...")
#     await seed()
#     logger.info("Protocol seeding completed.")

#     return {
#         "status": "success",
#         "message": "Protocols seeded successfully"
#     }
# async def seed():
#     seed_file_path = os.path.join(
#         os.path.dirname(__file__),
#         "protocol_master_seed.json"
#     )

#     logger.info(f"Seed file path: {seed_file_path}")
#     logger.info(f"Exists: {os.path.exists(seed_file_path)}")
#     with open(seed_file_path, "r") as f:
#         protocols = json.load(f)
#         logger.info(f"Loaded {len(protocols)} protocols from JSON")

#     count = 0
#     for proto in protocols:
#         await protocol_master_collection.update_one(
#             {"protocol_id": proto["protocol_id"]},
#             {"$set": proto},
#             upsert=True
#         )
#         count += 1
#         print(f"  Upserted: {proto['protocol_name']} ({proto['protocol_id']})")

#     await protocol_master_collection.create_index("disease_sites")
#     await protocol_master_collection.create_index("protocol_name")
#     await protocol_master_collection.create_index([("disease_sites", 1), ("intent", 1)])

#     print(f"\nDone. {count} protocols seeded.")

# if __name__ == "__main__":
#     asyncio.run(seed())


class DrugSchedule(BaseModel):
    name: str
    dose: str
    unit: str
    route: str
    day: str
    adminType: Optional[str] = None
    duration: Optional[str] = None


class ProtocolMaster(BaseModel):
    protocol_id: str
    protocol_name: str
    display_name: str

    aliases: List[str] = []
    disease_sites: List[str]

    histology: Optional[Union[str, List[str]]] = None

    intent: List[str]

    regimen_type: str

    standard_cycles: Optional[int] = None
    cycle_interval_days: int

    drug_schedule: List[DrugSchedule]

    premedications: List[str] = []
    hydration: List[str] = []
    supportive_care: List[str] = []

    dose_adjustment_rules: Dict[str, Any] = {}

    laboratory_requirements: List[str] = []
    references: List[str] = []

    version: str = "1.0"
    status: str = "active"


@router.post("/protocol-master/bulk")
async def add_protocols(protocols: List[ProtocolMaster]):

    added = 0
    updated = 0

    for protocol in protocols:

        result = await protocol_master_collection.update_one(
            {"protocol_id": protocol.protocol_id},
            {"$set": protocol.model_dump()},
            upsert=True
        )

        if result.upserted_id:
            added += 1
        elif result.modified_count > 0:
            updated += 1

    return {
        "status": "success",
        "added": added,
        "updated": updated,
        "total": len(protocols)
    }

@router.post("/protocol-master")
async def add_protocol(protocol: ProtocolMaster):

    exists = await protocol_master_collection.find_one(
        {"protocol_id": protocol.protocol_id}
    )

    if exists:
        raise HTTPException(
            status_code=409,
            detail="Protocol already exists."
        )

    await protocol_master_collection.insert_one(protocol.model_dump())

    return {
        "status": "success",
        "message": "Protocol added successfully."
    }

#─────────────────────────────────────────────────────────────
# NEW: Update an existing protocol (used by the "Edit Protocol" form)
# ─────────────────────────────────────────────────────────────
@router.put("/protocol-master/{protocol_id}")
async def update_protocol(protocol_id: str, protocol: ProtocolMaster):
 
    existing = await protocol_master_collection.find_one(
        {"protocol_id": protocol_id}
    )
 
    if not existing:
        raise HTTPException(
            status_code=404,
            detail="Protocol not found."
        )
 
    # protocol_id is not editable from the form (it's disabled client-side),
    # but guard against a mismatched/edited body just in case.
    payload = protocol.model_dump()
    payload["protocol_id"] = protocol_id
 
    await protocol_master_collection.update_one(
        {"protocol_id": protocol_id},
        {"$set": payload}
    )
 
    return {
        "status": "success",
        "message": "Protocol updated successfully.",
        "data": payload
    }

@router.delete("/protocol-master/{protocol_id}")
async def delete_protocol(protocol_id: str):

    result = await protocol_master_collection.delete_one(
        {"protocol_id": protocol_id}
    )

    if result.deleted_count == 0:
        raise HTTPException(
            status_code=404,
            detail="Protocol not found."
        )

    return {
        "status": "success",
        "message": "Protocol deleted successfully."
    }

@router.delete("/protocol-master")
async def delete_all_protocols():

    result = await protocol_master_collection.delete_many({})

    return {
        "status": "success",
        "deleted": result.deleted_count
    }





# ─────────────────────────────────────────────────────────────
# ENDPOINT 1: List protocols for the browser UI
# ─────────────────────────────────────────────────────────────
@router.get("/protocol-master/list")
async def list_protocols(patient_id: str = "", search: str = ""):
    query = {}
    if search:
        query["$or"] = [
            {"protocol_name": {"$regex": search, "$options": "i"}},
            {"aliases": {"$regex": search, "$options": "i"}},
            {"disease_sites": {"$regex": search, "$options": "i"}},
        ]

    cursor = protocol_master_collection.find(query, {
        "protocol_id": 1, "protocol_name": 1, "disease_sites": 1,
        "intent": 1, "standard_cycles": 1, "cycle_interval_days": 1,
        "drug_schedule": 1, "regimen_type": 1, "references": 1, "_id": 0
    })
    protocols = await cursor.to_list(length=300)

    logger.info(f"Fetched {len(protocols)} protocols from MongoDB")

    recommended_ids = set()
    if patient_id:
        match_text = await _get_patient_match_context(patient_id)
        if match_text:
            matches = await _match_protocols_by_diagnosis(match_text, limit=5)
            recommended_ids = {p["protocol_id"] for p in matches}

    for p in protocols:
        p["recommended"] = p["protocol_id"] in recommended_ids
        p["drug_names"] = [d["name"] for d in p.get("drug_schedule", [])]
        p.pop("drug_schedule", None)  # don't need full detail in the list view

    protocols.sort(key=lambda p: (not p["recommended"], p["protocol_name"]))

    logger.info("=" * 80)
    logger.info(f"Total protocols found: {len(protocols)}")
    logger.info("Protocols being sent to frontend:")
    # logger.info(json.dumps(protocols, indent=2, default=str))
    logger.info("=" * 80)

    return {
        "status": "success",
        "data": protocols
    }


# ────────────────────────────────────────────────────────
# ENDPOINT 2: Select a protocol (triggers LLM adaptation)
# ─────────────────────────────────────────────────────────────
@router.post("/protocol-master/select")
async def select_protocol(payload: dict):
    
    doctor_id = payload.get("doctorId", "")
    

    patient_id = payload.get("patientId")
    protocol_id = payload.get("protocolId")

    if not patient_id or not protocol_id:
        raise HTTPException(status_code=400, detail="patientId and protocolId are required.")

    proto = await protocol_master_collection.find_one({"protocol_id": protocol_id}, {"_id": 0})
    if not proto:
        return {"status": "error", "detail": "Protocol not found."}

    summary_doc = await summary_collection.find_one({"patient_id": patient_id}) or {}
    clinical_context = _build_clinical_context(summary_doc)

    # capture the raw LLM json separately from the merged result
    llm_raw, data = await _adapt_protocol_with_llm(proto, clinical_context)

    await chemotherapy_records_collection.update_one(
        {"patient_id": patient_id, "doctor_id": doctor_id},
        {
            "$set": {
                "regimen": data
            }
        },
        upsert=True
    )

    return {
        "status": "success",
        "protocol": proto,              # raw protocol_master doc — full ground truth
        "clinicalContext": clinical_context,  # what was sent to the LLM
        "llmOutput": llm_raw,           # raw LLM json (treatmentIntent, doseAdjustments, etc.)
        "adaptedRegimen": data          # the merged final object your form already expects
    }

@router.get("/protocol-master/{protocol_id}")
async def get_protocol(protocol_id: str):
    protocol = await protocol_master_collection.find_one(
        {"protocol_id": protocol_id},
        {"_id": 0}
    )
    if not protocol:
        raise HTTPException(status_code=404, detail="Protocol not found")
    return {"status": "success", "data": protocol}


# ─────────────────────────────────────────────────────────────
# HELPERS
# ─────────────────────────────────────────────────────────────

def _strip_markdown(text: str) -> str:
    return re.sub(r"\*+", "", text or "").strip()


async def _get_patient_diagnosis(patient_id: str) -> str:
    doc = await summary_collection.find_one({"patient_id": patient_id})
    if not doc:
        logger.warning(f"No patient_summary doc found for patient_id={patient_id}")
        return ""

    root = doc.get("data", doc)
    summary = root.get("summary", {})

    header = summary.get("diagnosis_header", "")
    if isinstance(header, str) and header.strip():
        return _strip_markdown(header)

    diagnoses = summary.get("confirmed_diagnoses", [])
    if diagnoses:
        first = diagnoses[0]
        # handle both "confirmed_diagnoses": ["text", ...] and [{"text": "..."}, ...]
        if isinstance(first, dict):
            first = first.get("text") or first.get("diagnosis") or first.get("name") or ""
        if isinstance(first, str) and first.strip():
            return _strip_markdown(first)

    logger.warning(f"No usable diagnosis field found for patient_id={patient_id}, doc keys: {list(summary.keys())}")
    return ""

async def _get_patient_match_context(patient_id: str) -> str:
    """Broader text pool for protocol matching — not just diagnosis_header,
    since histology-only headers (e.g. 'invasive carcinoma NST') often omit
    the anatomical site entirely."""
    doc = await summary_collection.find_one({"patient_id": patient_id})
    if not doc:
        return ""

    root = doc.get("data", doc)
    summary = root.get("summary", {})

    parts = []

    header = summary.get("diagnosis_header", "")
    if isinstance(header, str) and header.strip():
        parts.append(_strip_markdown(header))

    for d in summary.get("confirmed_diagnoses", []):
        if isinstance(d, dict):
            d = d.get("text") or d.get("diagnosis") or d.get("name") or ""
        if isinstance(d, str) and d.strip():
            parts.append(_strip_markdown(d))

    full_text = summary.get("full_text", "") or " ".join(summary.get("paragraphs", []))
    if full_text:
        parts.append(full_text[:2000])  # cap length, just need enough for site mentions

    return " ".join(parts)


async def _match_protocols_by_diagnosis(match_text: str, limit: int = 5):
    if not match_text:
        return []

    stopwords = {"moderately", "differentiated", "clinical", "stage", "with",
                 "unspecified", "malignant", "neoplasm", "carcinoma", "invasive",
                 "special", "grade", "type"}
    keywords = [w for w in re.split(r"[^a-z0-9]+", match_text.lower())
                if len(w) > 4 and w not in stopwords]
    if not keywords:
        return []

    pattern = "|".join(re.escape(k) for k in keywords)

    # Pull a wider candidate pool across ALL relevant text fields
    cursor = protocol_master_collection.find({
        "$or": [
            {"disease_sites": {"$regex": pattern, "$options": "i"}},
            {"aliases": {"$regex": pattern, "$options": "i"}},
            {"histology": {"$regex": pattern, "$options": "i"}},
            {"protocol_name": {"$regex": pattern, "$options": "i"}},
            {"display_name": {"$regex": pattern, "$options": "i"}},
        ]
    }, {"protocol_id": 1, "protocol_name": 1, "disease_sites": 1,
        "aliases": 1, "histology": 1, "display_name": 1, "_id": 0}
    ).limit(50)  # wide candidate pool, ranked below

    candidates = await cursor.to_list(length=50)
    if not candidates:
        logger.warning(f"No protocol candidates matched diagnosis='{match_text}' keywords={keywords}")
        return []

    def score(proto: dict) -> int:
        haystack_parts = []
        for field in ("disease_sites", "aliases"):
            val = proto.get(field) or []
            haystack_parts.extend(str(v) for v in val)
        for field in ("histology", "protocol_name", "display_name"):
            val = proto.get(field)
            if isinstance(val, list):
                haystack_parts.extend(str(v) for v in val)
            elif val:
                haystack_parts.append(str(val))
        haystack = " ".join(haystack_parts).lower()
        return sum(1 for k in keywords if k in haystack)

    ranked = sorted(candidates, key=score, reverse=True)
    top = ranked[:limit]

    logger.info(f"Diagnosis='{match_text}' keywords={keywords} -> "
                f"{[(p['protocol_name'], score(p)) for p in top]}")

    return top

def _build_clinical_context(summary_doc: dict) -> dict:
    root = summary_doc.get("data", summary_doc)
    summary = root.get("summary", {})
    timeline = root.get("timeline", {}).get("timeline", [])

    diagnosis = _strip_markdown(summary.get("diagnosis_header", ""))
    full_text = summary.get("full_text", "") or " ".join(summary.get("paragraphs", []))

    all_entities = []
    for entry in timeline:
        for et in entry.get("entity_types", []):
            for ent in et.get("entities", []):
                all_entities.append(ent)

    def find_evidence(*name_fragments):
        frags = [f.lower() for f in name_fragments]
        for ent in all_entities:
            name = (ent.get("name") or "").lower()
            if any(f in name for f in frags):
                return ent.get("evidence") or ""
        return ""

    def extract_number(text: str):
        m = re.search(r"[-+]?\d*\.?\d+", text or "")
        return m.group(0) if m else None

    ecog_evidence = find_evidence("ecog")
    creatinine_evidence = find_evidence("creatinine")
    hb_evidence = find_evidence("hemoglobin", "haemoglobin")
    allergy_evidence = find_evidence("allergy", "allergic")

    return {
        "diagnosis": diagnosis,
        "clinical_narrative": full_text[:6000],
        "ecog": extract_number(ecog_evidence),
        "ecog_evidence": ecog_evidence,
        "serum_creatinine": extract_number(creatinine_evidence),
        "hemoglobin": extract_number(hb_evidence),
        "allergy_flag": bool(allergy_evidence),
        "allergy_evidence": allergy_evidence,
    }


async def _adapt_protocol_with_llm(proto: dict, context: dict):
    system_prompt = f"""
You are adapting a FIXED chemotherapy protocol to one patient's clinical context.
Do NOT change the drug list, doses-per-unit, cycle count, or interval defined below.

Protocol (ground truth — do not alter):
{json.dumps(proto, default=str)}

Patient diagnosis: {context['diagnosis']}
Patient ECOG (if found): {context['ecog'] or 'not documented'}
Patient serum creatinine (if found): {context['serum_creatinine'] or 'not documented'}
Allergy flag: {'YES - review narrative' if context['allergy_flag'] else 'none documented'}

Full clinical narrative:
{context['clinical_narrative']}

Return ONLY this JSON, no prose, no markdown fences:
{{
  "treatmentIntent": "",
  "startDate": "",
  "doseAdjustments": "",
  "concurrentTherapy": "",
  "reasonForChange": "",
  "safetyFlags": []
}}
"""
    try:
        resp = groq_client.chat.completions.create(
            model="llama-3.3-70b-versatile",
            messages=[
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": "Adapt the protocol now."}
            ],
            response_format={"type": "json_object"},
            temperature=0,
        )
    except Exception as e:
        logger.exception(e)
        raise HTTPException(
            status_code=500,
            detail="Unable to adapt protocol."
        )
    llm_data = json.loads(resp.choices[0].message.content)

    protocol_details = " + ".join(
        [
            f"{drug['name']} {drug['dose']} {drug['unit']} {drug['route']} Day {drug['day']}"
            for drug in proto.get("drug_schedule", [])
        ]
    )

    protocol_details += f" every {proto.get('cycle_interval_days', '')} days"

    if proto.get("standard_cycles"):
        protocol_details += f" for {proto['standard_cycles']} cycles."

    merged = {
        "treatmentIntent": llm_data.get("treatmentIntent", proto["intent"][0]),

        "selectedProtocol": proto["protocol_name"],

        "protocolName": proto["display_name"],

        "typeOfChemotherapy": proto["regimen_type"],

        "protocolMasterRef": proto["protocol_id"],

        "startDate": llm_data.get("startDate") or datetime.now().strftime("%d-%m-%Y"),

        "plannedCycles": proto["standard_cycles"],

        "daysBetweenCycles": proto["cycle_interval_days"],

        "protocolDetails": protocol_details,

        "drugSchedule": proto["drug_schedule"],

        "premedications": proto.get("premedications", []),

        "hydration": proto.get("hydration", []),

        "supportiveCare": proto.get("supportive_care", []),

        "laboratoryRequirements": proto.get("laboratory_requirements", []),

        "doseAdjustmentRules": proto.get("dose_adjustment_rules", {}),

        "references": proto.get("references", []),

        "doseAdjustments": llm_data.get("doseAdjustments", ""),

        "concurrentTherapy": llm_data.get("concurrentTherapy", ""),

        "reasonForChange": llm_data.get("reasonForChange", ""),

        "safetyFlags": llm_data.get("safetyFlags", [])
    }

    return llm_data, merged