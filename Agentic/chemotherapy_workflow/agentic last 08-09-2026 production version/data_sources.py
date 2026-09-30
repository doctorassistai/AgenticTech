"""
Data Sources & Mongo Document Parsers for Chemotherapy Intelligence Workflow
Parses raw Mongo EMR records into structured data objects for the 12 AI Agent Modules.
"""

import os
import json
import datetime
from typing import Dict, Any, List, Optional

try:
    from pymongo import MongoClient
    from bson import ObjectId
except ImportError:
    MongoClient = None
    ObjectId = None

# MongoDB Configuration
MONGO_URI = os.getenv("MONGO_URI") or os.getenv("MONGODB_URI") or "mongodb://localhost:27017"
DB_NAME = os.getenv("DB_NAME") or "doctorassistai"
SOURCE_COLLECTION = "chemotherapy_records"
TARGET_COLLECTION = "chemo_agentic"

# In-Memory Fallback Cache
REPORT_HISTORY_DB: Dict[str, List[Dict[str, Any]]] = {}


def get_mongo_db():
    """
    Returns Mongo Database connection instance if MongoDB is available.
    """
    if MongoClient:
        try:
            client = MongoClient(MONGO_URI, serverSelectionTimeoutMS=2000)
            dbs = client.list_database_names()
            if "doctorassistai" in dbs:
                return client["doctorassistai"]
            if "drassistai" in dbs:
                return client["drassistai"]
            return client[DB_NAME]
        except Exception:
            return None
    return None


def get_latest_chemo_report(patient_id: str) -> Optional[Dict[str, Any]]:
    """
    Retrieves the most recent saved chemotherapy report from doctorassistai.chemo_agentic collection.
    """
    db = get_mongo_db()
    if db is not None:
        try:
            doc = db[TARGET_COLLECTION].find_one(
                {"patient_id": patient_id},
                sort=[("timestamp", -1)]
            )
            if doc:
                return {
                    "version": doc.get("version", 1),
                    "timestamp": doc.get("timestamp", ""),
                    "report": doc.get("report", {}),
                }
        except Exception as e:
            print(f"[Mongo Warning] Failed to query {TARGET_COLLECTION}: {e}")

    # Fallback to local memory cache
    history = REPORT_HISTORY_DB.get(patient_id, [])
    if history:
        return history[-1]
    return None


def sanitize_keys_for_mongo(obj: Any) -> Any:
    """
    Recursively converts all dictionary keys to strings for BSON compatibility.
    """
    if isinstance(obj, dict):
        return {str(k): sanitize_keys_for_mongo(v) for k, v in obj.items()}
    elif isinstance(obj, list):
        return [sanitize_keys_for_mongo(item) for item in obj]
    return obj


def save_chemo_report_history(patient_id: str, report_data: Dict[str, Any]) -> Dict[str, Any]:
    """
    Appends a new timestamped chemotherapy report snapshot into doctorassistai.chemo_agentic collection.
    """
    db = get_mongo_db()
    timestamp_str = datetime.datetime.utcnow().isoformat() + "Z"
    version_num = 1
    clean_report = sanitize_keys_for_mongo(report_data)

    if db is not None:
        try:
            count = db[TARGET_COLLECTION].count_documents({"patient_id": patient_id})
            version_num = count + 1
            snapshot_doc = {
                "patient_id": patient_id,
                "timestamp": timestamp_str,
                "version": version_num,
                "report": clean_report,
            }
            db[TARGET_COLLECTION].insert_one(snapshot_doc)
            return snapshot_doc
        except Exception as e:
            print(f"[Mongo Warning] Failed to insert report snapshot into {TARGET_COLLECTION}: {e}")

    # Fallback in-memory save
    if patient_id not in REPORT_HISTORY_DB:
        REPORT_HISTORY_DB[patient_id] = []
    version_num = len(REPORT_HISTORY_DB[patient_id]) + 1
    snapshot = {
        "patient_id": patient_id,
        "timestamp": timestamp_str,
        "version": version_num,
        "report": clean_report,
    }
    REPORT_HISTORY_DB[patient_id].append(snapshot)
    return snapshot


def fetch_patient_emr_data(patient_id: str) -> Dict[str, Any]:
    """
    Fetches patient EMR record strictly from doctorassistai.chemotherapy_records collection.
    Raises ValueError if record does not exist in MongoDB.
    """
    db = get_mongo_db()
    if db is not None:
        chemotherapy_records_collection = db["chemotherapy_records"]
        query = {"$or": [{"patientId": patient_id}, {"patient_id": patient_id}]}
        if ObjectId and ObjectId.is_valid(patient_id):
            query["$or"].append({"_id": ObjectId(patient_id)})

        try:
            doc = chemotherapy_records_collection.find_one(query)
            if not doc:
                # Secondary fallback search across alternative collection names
                for col in ["chemotherapyrecords", "chemotherapy", "patientcontext"]:
                    doc = db[col].find_one(query)
                    if doc:
                        break
            if doc:
                if "_id" in doc:
                    doc["_id"] = str(doc["_id"])
                if "data" in doc:
                    return doc
                return {"data": doc, "patientId": patient_id}
        except Exception as e:
            print(f"[Mongo Error] Failed to fetch from chemotherapy_records: {e}")

    raise ValueError(f"No chemotherapy record found in {DB_NAME}.chemotherapy_records for patient '{patient_id}'")


def parse_mongo_record(
    raw_doc: Dict[str, Any],
    requested_cycle: Optional[str] = None,
    requested_treatment: Optional[str] = None,
) -> Dict[str, Any]:
    """
    Main parser entry point for a raw Mongo chemotherapy record.
    Supports targeting a specific requested_cycle or requested_treatment.
    """
    data = raw_doc.get("data", {})
    summary = data.get("summary", {})
    cycles = data.get("cycles", {})

    print(f"[RAW MONGO DOC ROOT KEYS]: {list(raw_doc.keys())}")
    print(f"[RAW MONGO DATA KEYS]: {list(data.keys())}")
    print(f"[REQUESTED TREATMENT ID]: {requested_treatment}")
    print(f"[TREATMENT FIELD IN MONGO]: {raw_doc.get('treatment') or data.get('treatment')}")
    if cycles:
        print(f"[CYCLES KEYS]: {list(cycles.keys())}")

    # Determine current cycle key
    cycle_keys = sorted([k for k in cycles.keys() if str(k).isdigit()], key=lambda x: int(x))
    
    # If a specific cycle was requested by user clicking a cycle button, use it!
    if requested_cycle and str(requested_cycle).isdigit() and str(requested_cycle) in cycles:
        latest_cycle_num = str(requested_cycle)
    else:
        latest_cycle_num = cycle_keys[-1] if cycle_keys else "1"

    latest_cycle = cycles.get(latest_cycle_num, {})

    details = latest_cycle.get("details", {})
    assessment = latest_cycle.get("assessment", {})
    regimen = latest_cycle.get("regimen", {})
    pre_chemo = latest_cycle.get("pre_chemo", {})

    print(f"[TARGET CYCLE {latest_cycle_num} EVALUATION KEYS]: {list(latest_cycle.keys())}")
    print(f"[PRE_CHEMO KEYS]: {list(pre_chemo.keys())}")
    print(f"[ASSESSMENT KEYS]: {list(assessment.keys())}")
    print(f"[DETAILS KEYS]: {list(details.keys())}")

    # Extract height & weight dynamically without fake numeric fallbacks (per chemoCrosswalk.js schema)
    raw_height = details.get("height") or assessment.get("height") or pre_chemo.get("height")
    raw_weight = details.get("weight") or assessment.get("weight") or pre_chemo.get("weight")

    height_cm = float(raw_height) if (raw_height is not None and str(raw_height).replace(".", "", 1).isdigit() and float(raw_height) > 0) else None
    weight_kg = float(raw_weight) if (raw_weight is not None and str(raw_weight).replace(".", "", 1).isdigit() and float(raw_weight) > 0) else None

    # Calculate Mosteller BSA only if authentic height and weight exist
    if height_cm and weight_kg:
        bsa_actual = round(((height_cm * weight_kg) / 3600.0) ** 0.5, 2)
        bsa_capped = min(bsa_actual, 2.0)
    else:
        bsa_actual = None
        bsa_capped = None

    # Serum Creatinine & CrCl calculation (Cockcroft-Gault)
    raw_scr = assessment.get("serumCreatinine") or details.get("serumCreatinine")
    scr = float(raw_scr) if (raw_scr is not None and str(raw_scr).replace(".", "", 1).isdigit() and float(raw_scr) > 0) else None
    
    age_raw = str(details.get("age") or summary.get("age") or "")
    age = None
    for token in age_raw.split():
        if token.isdigit():
            age = int(token)
            break

    gender_raw = details.get("gender") or summary.get("sex") or summary.get("gender")
    gender = str(gender_raw).strip().lower() if gender_raw else None

    # Cockcroft-Gault CrCl: Calculate only if authentic scr, age, and weight_kg are present
    if scr and scr > 0 and age and weight_kg:
        crcl = round(((140 - age) * weight_kg) / (72.0 * scr), 1)
        if gender in ["female", "f"]:
            crcl = round(crcl * 0.85, 1)
    else:
        crcl = None

    # ECOG Performance status parsing (supports "ecog-0", "0", etc. per chemoCrosswalk.js)
    ecog_raw = str(assessment.get("performanceStatus") or details.get("performanceStatus") or "")
    ecog_num = None
    for char in str(ecog_raw):
        if char.isdigit():
            ecog_num = int(char)
            break

    # Temperature and vitals extraction per chemoCrosswalk.js admin.vitals schema
    admin_node = latest_cycle.get("admin", {})
    admin_vitals = admin_node.get("vitals", {}) if isinstance(admin_node, dict) else {}
    raw_temp = (
        pre_chemo.get("temperature")
        or assessment.get("temperature")
        or (admin_vitals.get("tempPre") if isinstance(admin_vitals, dict) else None)
        or (admin_vitals.get("tempPost") if isinstance(admin_vitals, dict) else None)
    )
    temp_val = float(raw_temp) if (raw_temp is not None and str(raw_temp).replace(".", "", 1).isdigit() and float(raw_temp) > 0) else None

    diagnosis_val = details.get("diagnosis") or assessment.get("diagnosis") or summary.get("diagnosis") or details.get("detailsDiagnosis") or ""
    regimen_name = regimen.get("selectedProtocol") or regimen.get("protocolName") or regimen.get("name") or ""
    
    # Match requested treatment line from EMR treatment structure (dict or list)
    raw_treatment = raw_doc.get("treatment") or data.get("treatment") or summary.get("treatmentHistory") or []
    matched_treatment = None

    if requested_treatment:
        req_id_str = str(requested_treatment).strip()
        if isinstance(raw_treatment, list):
            for tr in raw_treatment:
                if isinstance(tr, dict) and (str(tr.get("id")) == req_id_str or str(tr.get("treatmentId")) == req_id_str):
                    matched_treatment = tr
                    break
        elif isinstance(raw_treatment, dict):
            tr_id = str(raw_treatment.get("id") or raw_treatment.get("treatmentId") or raw_doc.get("treatmentId") or "")
            if tr_id == req_id_str or not tr_id:
                matched_treatment = raw_treatment
    elif isinstance(raw_treatment, dict):
        matched_treatment = raw_treatment

    # Safe parsing of planned_cycles for selected treatment
    raw_planned = ""
    if matched_treatment:
        raw_planned = str(matched_treatment.get("cycles") or matched_treatment.get("plannedCycles") or "")
        if matched_treatment.get("name") or matched_treatment.get("protocolName"):
            regimen_name = matched_treatment.get("name") or matched_treatment.get("protocolName")

    if not raw_planned:
        raw_planned = str(regimen.get("plannedCycles") or details.get("cyclesPlan") or "")

    planned_cycles = None
    for token in raw_planned.split():
        if token.isdigit():
            planned_cycles = int(token)
            break
    if not planned_cycles or planned_cycles <= 0:
        planned_cycles = len(cycle_keys) if cycle_keys else None

    current_cycle_num = int(latest_cycle_num) if latest_cycle_num.isdigit() else len(cycle_keys)

    # Extract drugs dynamically: check matched_treatment first, then latest_cycle regimen/prep/admin
    prep_node = latest_cycle.get("prep", {})
    drugs_list = []
    if matched_treatment and isinstance(matched_treatment.get("drugs"), list) and len(matched_treatment.get("drugs")) > 0:
        drugs_list = matched_treatment.get("drugs")
    elif isinstance(regimen.get("drugs"), list) and len(regimen.get("drugs")) > 0:
        drugs_list = regimen.get("drugs")
    elif isinstance(prep_node, dict) and isinstance(prep_node.get("drugs"), list) and len(prep_node.get("drugs")) > 0:
        drugs_list = prep_node.get("drugs")
    elif isinstance(admin_node, dict) and isinstance(admin_node.get("adminDrugs"), list) and len(admin_node.get("adminDrugs")) > 0:
        drugs_list = admin_node.get("adminDrugs")

    print(f"[REGIMEN RAW DATA]: {regimen}")
    print(f"[MATCHED TREATMENT RAW DATA]: {matched_treatment}")
    print(f"[EXTRACTED DRUGS LIST]: {drugs_list}")

    return {
        "doctor_id": raw_doc.get("doctorId", ""),
        "patient_id": raw_doc.get("patientId") or summary.get("patientId", ""),
        "hospital_id": raw_doc.get("hospitalId", ""),
        "demographics": {
            "first_name": summary.get("firstName", ""),
            "last_name": summary.get("lastName", ""),
            "age": age,
            "gender": gender,
            "height_cm": height_cm,
            "weight_kg": weight_kg,
            "bsa_actual": bsa_actual,
            "bsa_capped": bsa_capped,
            "serum_creatinine": scr,
            "crcl": crcl,
            "ecog": ecog_num,
            "temperature": temp_val,
            "diagnosis": diagnosis_val,
            "comorbidities": details.get("comorbidities") or assessment.get("comorbidities") or "",
            "stage_tnm": details.get("diseaseStage") or details.get("stageTNM") or "",
            "cycle_current": current_cycle_num,
            "cycle_total": planned_cycles,
        },
        "regimen": {
            "name": regimen_name,
            "intent": regimen.get("treatmentIntent") or (matched_treatment.get("intent") if matched_treatment else "") or "",
            "planned_cycles": planned_cycles,
            "start_date": regimen.get("startDate") or (matched_treatment.get("startDate") if matched_treatment else "") or "",
            "drugs": drugs_list,
        },
        "cycles": cycles,
        "latest_cycle_num": latest_cycle_num,
        "summary": summary,
    }


def extract_baseline_labs(raw_doc: Dict[str, Any]) -> List[Dict[str, Any]]:
    """
    Parses assessment.baselineLabs JSON string array into python dictionaries.
    """
    cycles = raw_doc.get("data", {}).get("cycles", {})
    c1 = cycles.get("1", {})
    assessment = c1.get("assessment", {})
    labs_str = assessment.get("baselineLabs", "[]")

    try:
        return json.loads(labs_str)
    except Exception:
        return []


def extract_all_toxicities(raw_doc: Dict[str, Any]) -> List[Dict[str, Any]]:
    """
    Aggregates post_chemo.toxicities arrays and organ-specific monitoring fields across all cycles
    per the chemoCrosswalk.js / OPRecord partD schema.
    """
    all_tox = []
    cycles = raw_doc.get("data", {}).get("cycles", {})
    for cycle_num, cycle_data in cycles.items():
        if not isinstance(cycle_data, dict):
            continue
        post = cycle_data.get("post_chemo", {})
        
        # 1. CTCAE toxicities array from partD.toxicities
        toxicities = post.get("toxicities", [])
        if isinstance(toxicities, list):
            for t in toxicities:
                if isinstance(t, dict):
                    t_item = dict(t)
                    t_item["cycle_number"] = cycle_num
                    all_tox.append(t_item)
                    
        # 2. Organ-specific text assessments from partD
        neuro = post.get("neuroAssessment")
        if neuro:
            all_tox.append({"event": "Peripheral Neuropathy", "grade": 1, "description": neuro, "cycle_number": cycle_num})
            
        echo = post.get("echoDetails") or post.get("lvef")
        if echo:
            all_tox.append({"event": "Cardiotoxicity / LVEF", "grade": 0, "description": str(echo), "cycle_number": cycle_num})
            
        pft = post.get("pulmonaryTests")
        if pft:
            all_tox.append({"event": "Pulmonary Toxicity", "grade": 0, "description": str(pft), "cycle_number": cycle_num})
            
        audio = post.get("audioTests")
        if audio:
            all_tox.append({"event": "Ototoxicity", "grade": 0, "description": str(audio), "cycle_number": cycle_num})

    # 3. Check Part E / Part F global residual toxicity
    completion = raw_doc.get("data", {}).get("completion", {})
    res_tox = completion.get("residualToxicity") or completion.get("toxicitySummaryText")
    if res_tox:
        all_tox.append({"event": "Residual Toxicity", "grade": 1, "description": res_tox, "cycle_number": "Summary"})

    return all_tox


def extract_cumulative_drug_doses(raw_doc: Dict[str, Any]) -> Dict[str, float]:
    """
    Calculates cumulative delivered doses per drug across completed cycles.
    """
    cumulative = {}
    cycles = raw_doc.get("data", {}).get("cycles", {})
    for cycle_num, cycle_data in cycles.items():
        if not isinstance(cycle_data, dict):
            continue
        admin = cycle_data.get("admin", {})
        admin_drugs = admin.get("adminDrugs", [])
        for d in admin_drugs:
            if isinstance(d, dict) and d.get("given") == "yes":
                name = d.get("name", "").strip()
                dose_str = d.get("dose", "0")
                # Parse numeric dose
                num_val = 0.0
                parts = dose_str.split()
                if parts and parts[0].replace(".", "", 1).isdigit():
                    num_val = float(parts[0])
                cumulative[name] = cumulative.get(name, 0.0) + num_val
    return cumulative
