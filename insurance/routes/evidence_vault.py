"""
evidence_vault.py — drop into your FastAPI app and include the router.

In your main.py / app factory:
    from evidence_vault import router as evidence_router
    app.include_router(evidence_router)
"""

import os
from datetime import datetime
from fastapi import APIRouter, Request, HTTPException
from pymongo import MongoClient
from jose import jwt

router = APIRouter(prefix="/app", tags=["evidence"])

# MongoDB connections
_client = MongoClient(os.getenv("MONGO_URI"))
_db = _client["doctorassistai"]
CLAIMS = _db["insurance_claims_new"]
SUBS = _db["task_submissions"]
USER_AUTH = _db["user_auth"]  # Add this for investigators list

SECRET_KEY = os.getenv("SECRET_KEY")
ALGORITHM = os.getenv("ALGORITHM")

# Base URL where files are actually served.
STORAGE_BASE = os.getenv("STORAGE_BASE_URL", "https://doctorassist.ai/uploads")

INV_TYPES = ["MV", "HV", "HVI", "TELE", "BILL"]

INV_LABELS = {
    "MV": "Member Visit",
    "HV": "Hospital Visit",
    "HVI": "Home / Neighbour Visit",
    "TELE": "Telephone Verification",
    "BILL": "Bill Verification",
}

TEXT_KEYS = {
    "mv_visit_date", "mv_remarks",
    "hv_doctor_name", "hv_observations",
    "hvi_neighbour", "hvi_remarks",
    "tele_person", "tele_datetime", "tele_summary",
    "bill_amount", "bill_notes",
}

DOC_KEY_LABELS = {
    "id_proof_patient": "ID Proof – Patient",
    "id_proof_of_patient": "ID Proof – Patient",
    "id_proof_mvf": "ID Proof – MVF",
    "id_of_person_filling_mvf": "ID Proof – MVF Filler",
    "policy_card": "Policy Card",
    "policy_card___health_card": "Policy / Health Card",
    "discharge_summary": "Discharge Summary",
    "investigation_reports": "Investigation Reports",
    "consent_past_treatment": "Consent – Past Treatment",
    "previous_op_card": "Previous OP Card",
    "bill_copy": "Bill Copy",
    "driving_license": "Driving License",
    "scar_photo": "Scar Photo",
    "doctor_statement": "Doctor Statement",
    "hospital_records": "Hospital Records",
    "op_card": "OP Card",
    "neighbour_statement": "Neighbour Statement",
    "residence_proof": "Residence Proof",
    "call_recording": "Call Recording",
    "pharmacy_bill": "Pharmacy Bill",
    "discharge_bill": "Discharge Bill",
    "report_format": "Report Format",
    "check_for_cl___rsby_availability": "CL / RSBY Availability",
}

# ── helpers ────────────────────────────────────────────────────

def _full_url(value) -> str:
    if not value:
        return ""
    # Accept dict with path key
    if isinstance(value, dict):
        value = value.get("path") or value.get("url") or ""
    if not isinstance(value, str):
        return ""
    v = value.strip()
    if v.startswith("http://") or v.startswith("https://"):
        return v
    return f"{STORAGE_BASE}/files/{v}"

def _is_file(value) -> bool:
    if not value or not isinstance(value, str):
        return False
    v = value.strip()
    return bool(v) and ("/" in v or v.startswith("http"))

def _ext_type(url: str) -> str:
    ext = url.rsplit(".", 1)[-1].lower() if "." in url else ""
    if ext == "pdf":
        return "PDF"
    if ext in ("jpg", "jpeg", "png", "gif", "webp", "heic"):
        return "Image"
    if ext in ("mp4", "mov", "avi", "mkv", "webm"):
        return "Video"
    return "Document"
def _build_case_payload(case: dict) -> dict:
    case_id = case.get("caseId")
    inv = case.get("investigations", {})
    doc_id = case.get("doctor_assigned")
    doctor_name = "Unassigned"
    if doc_id:
        d = USER_AUTH.find_one({"sys_user_id": doc_id}, {"_id": 0, "full_name": 1})
        doctor_name = d.get("full_name") if d else doc_id

    sub_doc = SUBS.find_one({"task_id": case_id}, {"_id": 0})
    all_subs = sub_doc.get("submissions", {}) if sub_doc else {}

    # ── Build timeline ───────────────────────────────
    timeline = [{
        "action": "Case Created",
        "meta": f"Registered · {case.get('insurer', '')}",
        "time": _fmt_date(case.get("createdAt")),
        "status": "done",
        "docs_collected": [],
        "docs_required": [],
    }]

    for t in INV_TYPES:
        entries = inv.get(t, [])
        if not entries:
            continue

        for entry in entries:
            if not isinstance(entry, dict):
                continue

            inv_name = entry.get("investigatorName", "Unknown")
            user_id = entry.get("investigatorId", "")
            req_docs = entry.get("documents", [])

            ts_sub = all_subs.get(t, {}).get(user_id) if user_id else None
            ts_form = ts_sub.get("form_data", {}) if ts_sub else {}
            ts_status = ts_sub.get("status", "") if ts_sub else ""

            inv_sub = entry.get("submission", {}) or {}
            actual_form = ts_form or inv_sub.get("form_data", {})
            actual_status = ts_status or inv_sub.get("status", "")

            def _is_file_value(v):
                if not v:
                    return False
                if isinstance(v, str):
                    return bool(v.strip())
                if isinstance(v, dict):
                    path = v.get("path", "")
                    return bool(path and path.strip())
                return False

            collected_keys = [
                k for k, v in actual_form.items()
                if k not in TEXT_KEYS and _is_file_value(v)
            ]

            actual_status_upper = actual_status.upper()
            if actual_status_upper == "COMPLETED":
                tl_status = "done"
                meta = f"{inv_name} · {len(collected_keys)}/{len(req_docs)} docs collected"
            elif actual_status_upper == "PARTIAL":
                tl_status = "partial"
                meta = f"{inv_name} · {len(collected_keys)}/{len(req_docs)} docs · Partial"
            else:
                tl_status = "pending"
                meta = f"Assigned to {inv_name} · Not started"

            submitted_at = ts_sub.get("submitted_at") if ts_sub else None

            timeline.append({
                "action": INV_LABELS.get(t, t),
                "meta": meta,
                "time": _fmt_date(submitted_at) if submitted_at else "—",
                "status": tl_status,
                "docs_collected": collected_keys,
                "docs_required": req_docs,
                "text_filled": {},
                "inv_type": t,
                "investigator": inv_name,
            })

    claim_status = case.get("status", "ALLOCATED")
    if claim_status == "COMPLETED":
        timeline.append({
            "action": "Case Completed",
            "meta": "All investigation tasks done",
            "time": "—",
            "status": "done",
            "docs_collected": [],
            "docs_required": [],
        })

    # ── Investigators list ───────────────────────────
    investigators_list = []
    for t in INV_TYPES:
        for entry in inv.get(t, []):
            if not isinstance(entry, dict):
                continue
            name = entry.get("investigatorName")
            if name and name not in investigators_list:
                investigators_list.append(name)

    # ── SLA (hours elapsed since createdAt) ──────────
    created_at = case.get("createdAt")
    sla_elapsed = 0
    sla_max = 120
    if created_at and isinstance(created_at, datetime):
        elapsed = datetime.utcnow() - created_at
        sla_elapsed = int(elapsed.total_seconds() / 3600)

    # ── Progress counters ────────────────────────────
    total_inv = completed_inv = partial_inv = 0
    for t in INV_TYPES:
        for entry in inv.get(t, []):
            if not isinstance(entry, dict):
                continue
            total_inv += 1
            uid = entry.get("investigatorId", "")
            ts_sub = all_subs.get(t, {}).get(uid) if uid else None
            s = (ts_sub.get("status", "") if ts_sub else "").upper()
            if s == "COMPLETED":
                completed_inv += 1
            elif s == "PARTIAL":
                partial_inv += 1

    return {
        "id": case_id,
        "caseId": case_id,
        "insurerRef": case.get("insurerRef", ""),
        "claimMode": case.get("claimMode", ""),
        "type": f"{case.get('claimMode', '').title()} — {case.get('claimSubtype', '').title()}",
        "claimant": case.get("claimantName", "Unknown"),
        "doctorAssigned": doctor_name,     # ← NEW
        "doctorAssignedId": doc_id,        # ← NEW
        "insurer": case.get("insurer", "—"),
        "priority": case.get("claimPriority", "Normal"),
        "status": claim_status,
        "hospital": (case.get("hospitalDetails") or {}).get("name", "—"),
        "location": (case.get("hospitalDetails") or {}).get("address", "") or case.get("pinCode", "—"),
        "investigators": investigators_list,
        "claimedAmount": case.get("claimedAmount", 0),
        "targetDate": str(case.get("targetDate", "—")),
        "investigations": inv,
        "pinCode": case.get("pinCode", ""),
        "hospitalPincode": (case.get("hospitalDetails") or {}).get("pincode", ""),
        "createdAt": _fmt_date(created_at),
        "allocated": _fmt_date(created_at),
        "sla": sla_elapsed,
        "slaMax": sla_max,
        "timeline": timeline,
        "tags": case.get("tags", []),
        "progress": {
            "total": total_inv,
            "completed": completed_inv,
            "partial": partial_inv,
            "pending": total_inv - completed_inv - partial_inv,
        },
    }

def _label(key: str) -> str:
    return DOC_KEY_LABELS.get(key, key.replace("_", " ").title())

def _fmt(dt) -> str:
    if not dt:
        return "—"
    try:
        if isinstance(dt, str):
            dt = datetime.fromisoformat(dt.replace("Z", "+00:00"))
        return dt.strftime("%-d %b %Y, %H:%M")
    except Exception:
        return str(dt)

def _filed(dt) -> str:
    if not dt:
        return "—"
    try:
        if isinstance(dt, str):
            dt = datetime.fromisoformat(dt.replace("Z", "+00:00"))
        return dt.strftime("%-d %b %Y")
    except Exception:
        return str(dt)

def _fmt_date(dt):
    """Simple date formatter for tracking endpoint"""
    if not dt:
        return "—"
    try:
        return dt.strftime("%d %b, %H:%M")
    except Exception:
        return str(dt)

def _norm_entries(entries):
    out = []
    if not entries or not isinstance(entries, list):
        return out
    for e in entries:
        if isinstance(e, str):
            out.append({
                "investigatorId": None,
                "investigatorName": e,
                "documents": [],
                "submission": None,
            })
        elif isinstance(e, dict):
            inv_id = e.get("investigatorId") or None
            inv_name = e.get("investigatorName") or e.get("investigator") or "Unknown"
            docs = e.get("documents", [])
            if not isinstance(docs, list):
                docs = []
            out.append({
                "investigatorId": inv_id,
                "investigatorName": inv_name,
                "documents": docs,
                "submission": e.get("submission") or None,
            })
    return out

def _get_sub(all_subs_new, inv_type, user_id, embedded_submission):
    ts = None
    if user_id and all_subs_new:
        ts = all_subs_new.get(inv_type, {}).get(user_id)
    if ts:
        return (
            ts.get("form_data") or {},
            ts.get("submitted_at"),
            ts.get("status", ""),
        )
    if embedded_submission and isinstance(embedded_submission, dict):
        return (
            embedded_submission.get("form_data") or {},
            embedded_submission.get("submitted_at"),
            embedded_submission.get("status", ""),
        )
    return {}, None, ""

def _load_subs(case_id: str) -> dict:
    doc = SUBS.find_one({"task_id": case_id}, {"_id": 0})
    if not doc:
        return {}
    if "submissions" in doc:
        return doc["submissions"]
    return {}
def _load_doctor_map() -> dict:
    """Returns {doctor_id: full_name} for active auditing doctors."""
    docs = USER_AUTH.find(
        {"role": "auditing-doctor-new", "status": "active"},
        {"_id": 0, "sys_user_id": 1, "full_name": 1},
    )
    return {d["sys_user_id"]: d.get("full_name", "Unknown") for d in docs}

# ─────────────────────────────────────────────────────────────
# GET /app/evidence (existing endpoint)
# ─────────────────────────────────────────────────────────────
@router.get("/evidence")
async def get_evidence(request: Request, status: str = "", search: str = ""):
    query = {}
    if status and status not in ("", "All"):
        query["status"] = status
    if search:
        query["$or"] = [
            {"caseId": {"$regex": search, "$options": "i"}},
            {"claimantName": {"$regex": search, "$options": "i"}},
        ]

    cases = list(CLAIMS.find(query, {"_id": 0}).sort("createdAt", -1).limit(200))
    claimants_out = []

    for case in cases:
        case_id = case.get("caseId", "")
        inv_raw = case.get("investigations", {})
        if not isinstance(inv_raw, dict):
            inv_raw = {}

        all_subs_new = _load_subs(case_id)

        inv_names = []
        for t in INV_TYPES:
            for entry in _norm_entries(inv_raw.get(t, [])):
                n = entry["investigatorName"]
                if n and n not in inv_names:
                    inv_names.append(n)

        documents = []
        for t in INV_TYPES:
            entries = _norm_entries(inv_raw.get(t, []))
            for entry in entries:
                inv_name = entry["investigatorName"]
                user_id = entry["investigatorId"]
                form, submitted_at, status_val = _get_sub(
                    all_subs_new, t, user_id, entry["submission"]
                )
                verified = status_val.upper() in ("COMPLETED", "COMPLETE")
                sub_str = _fmt(submitted_at)

                for k, v in form.items():
                    if k in TEXT_KEYS:
                        continue

                    # Handle both string paths and dict file entries {"path": "...", "file_name": "..."}
                    if isinstance(v, dict):
                        raw_path = v.get("path") or v.get("url") or ""
                        if not raw_path:
                            continue
                        full_url = _full_url(raw_path)
                    elif isinstance(v, str):
                        if not _is_file(v):
                            continue
                        full_url = _full_url(v)
                    else:
                        continue
                    documents.append({
                        "id": f"{case_id}__{t}__{k}",
                        "name": k,
                        "label": _label(k),
                        "type": _ext_type(full_url),
                        "url": full_url,
                        "investigator": inv_name,
                        "invType": t,
                        "invLabel": INV_LABELS.get(t, t),
                        "submittedOn": sub_str,
                        "verified": verified,
                    })

        claim_mode = case.get("claimMode", "") or case.get("claimType", "") or ""
        claim_sub = case.get("claimSubtype", "") or case.get("claimSubType", "") or ""

        claimants_out.append({
            "id": case_id,
            "caseId": case_id,
            "name": case.get("claimantName", "Unknown"),
            "claimType": f"{claim_mode.title()} — {claim_sub.title()}".strip(" —"),
            "status": case.get("status", "ALLOCATED"),
            "filed": _filed(case.get("createdAt")),
            "investigators": inv_names,
            "documents": documents,
        })

    return {"claimants": claimants_out}


# Add this to evidence_vault.py after your existing /evidence endpoint
# ─────────────────────────────────────────────────────────────
# GET /app/tracking/cases
# Field tracking endpoint for web dashboard
# ─────────────────────────────────────────────────────────────
@router.get("/tracking/cases")
async def get_tracking_cases(
    search: str = "",
    status: str = "",
    investigator: str = "",
    doctor: str = "",          # ← NEW
    page: int = 1,
    limit: int = 20,
):
    try:
        # ── Build query ──────────────────────────────────────
        query = {}
        and_clauses = []
        or_conditions = []

        if search:
            or_conditions += [
                {"caseId": {"$regex": search, "$options": "i"}},
                {"claimantName": {"$regex": search, "$options": "i"}},
                {"insurerRef": {"$regex": search, "$options": "i"}},
            ]

        if investigator and investigator not in ("All", ""):
            for t in INV_TYPES:
                or_conditions.append(
                    {f"investigations.{t}.investigatorName": {
                        "$regex": investigator, "$options": "i"
                    }}
                )

        if or_conditions:
            and_clauses.append({"$or": or_conditions})

        if status and status not in ("All", ""):
            query["status"] = status

        # ── Doctor filter ────────────────────────────────────
        doctor_map = _load_doctor_map()          # doctor_id -> full_name
        name_to_ids: dict = {}
        for did, name in doctor_map.items():
            name_to_ids.setdefault(name, []).append(did)

        if doctor and doctor not in ("All", ""):
            if doctor == "Unassigned":
                and_clauses.append({"$or": [
                    {"doctor_assigned": {"$exists": False}},
                    {"doctor_assigned": None},
                    {"doctor_assigned": ""},
                ]})
            else:
                matching_ids = name_to_ids.get(doctor, [])
                query["doctor_assigned"] = {"$in": matching_ids} if matching_ids else "__no_match__"

        if and_clauses:
            query["$and"] = and_clauses

        # ── Total count for the current filter (pre-pagination) ──
        total_count = CLAIMS.count_documents(query)

        page = max(1, page)
        limit = max(1, min(limit, 200))
        skip = (page - 1) * limit

        cases = list(
            CLAIMS.find(query, {"_id": 0})
            .sort("createdAt", -1)
            .skip(skip)
            .limit(limit)
        )

        result = []

        for case in cases:
            case_id = case.get("caseId")
            inv = case.get("investigations", {})

            sub_doc = SUBS.find_one({"task_id": case_id}, {"_id": 0})
            all_subs = sub_doc.get("submissions", {}) if sub_doc else {}

            # ── Build timeline ───────────────────────────────
            timeline = [{
                "action": "Case Created",
                "meta": f"Registered · {case.get('insurer', '')}",
                "time": _fmt_date(case.get("createdAt")),
                "status": "done",
                "docs_collected": [],
                "docs_required": [],
            }]

            for t in INV_TYPES:
                entries = inv.get(t, [])
                if not entries:
                    continue

                for entry in entries:
                    if not isinstance(entry, dict):
                        continue

                    inv_name = entry.get("investigatorName", "Unknown")
                    user_id = entry.get("investigatorId", "")
                    req_docs = entry.get("documents", [])

                    ts_sub = all_subs.get(t, {}).get(user_id) if user_id else None
                    ts_form = ts_sub.get("form_data", {}) if ts_sub else {}
                    ts_status = ts_sub.get("status", "") if ts_sub else ""

                    inv_sub = entry.get("submission", {}) or {}
                    actual_form = ts_form or inv_sub.get("form_data", {})
                    actual_status = ts_status or inv_sub.get("status", "")

                    def _is_file_value(v):
                        if not v:
                            return False
                        if isinstance(v, str):
                            # Accept any non‑empty string (file path or identifier)
                            return bool(v.strip())
                        if isinstance(v, dict):
                            path = v.get("path", "")
                            # Accept any non‑empty path, even if it's "voice-note"
                            return bool(path and path.strip())
                        return False

                    collected_keys = [
                        k for k, v in actual_form.items()
                        if k not in TEXT_KEYS and _is_file_value(v)
                    ]

                    actual_status_upper = actual_status.upper()
                    if actual_status_upper == "COMPLETED":
                        tl_status = "done"
                        meta = f"{inv_name} · {len(collected_keys)}/{len(req_docs)} docs collected"
                    elif actual_status_upper == "PARTIAL":
                        tl_status = "partial"
                        meta = f"{inv_name} · {len(collected_keys)}/{len(req_docs)} docs · Partial"
                    else:
                        tl_status = "pending"
                        meta = f"Assigned to {inv_name} · Not started"

                    submitted_at = ts_sub.get("submitted_at") if ts_sub else None

                    timeline.append({
                        "action": INV_LABELS.get(t, t),
                        "meta": meta,
                        "time": _fmt_date(submitted_at) if submitted_at else "—",
                        "status": tl_status,
                        "docs_collected": collected_keys,
                        "docs_required": req_docs,
                        "text_filled": {},
                        "inv_type": t,
                        "investigator": inv_name,
                    })

            claim_status = case.get("status", "ALLOCATED")
            if claim_status == "COMPLETED":
                timeline.append({
                    "action": "Case Completed",
                    "meta": "All investigation tasks done",
                    "time": "—",
                    "status": "done",
                    "docs_collected": [],
                    "docs_required": [],
                })

            # ── Investigators list ───────────────────────────
            investigators_list = []
            for t in INV_TYPES:
                for entry in inv.get(t, []):
                    if not isinstance(entry, dict):
                        continue
                    name = entry.get("investigatorName")
                    if name and name not in investigators_list:
                        investigators_list.append(name)

            # ── SLA (hours elapsed since createdAt) ──────────
            created_at = case.get("createdAt")
            sla_elapsed = 0
            sla_max = 120
            if created_at and isinstance(created_at, datetime):
                elapsed = datetime.utcnow() - created_at
                sla_elapsed = int(elapsed.total_seconds() / 3600)

            # ── Progress counters ────────────────────────────
            total_inv = completed_inv = partial_inv = 0
            for t in INV_TYPES:
                for entry in inv.get(t, []):
                    if not isinstance(entry, dict):
                        continue
                    total_inv += 1
                    uid = entry.get("investigatorId", "")
                    ts_sub = all_subs.get(t, {}).get(uid) if uid else None
                    s = (ts_sub.get("status", "") if ts_sub else "").upper()
                    if s == "COMPLETED":
                        completed_inv += 1
                    elif s == "PARTIAL":
                        partial_inv += 1
            doc_id = case.get("doctor_assigned")
            doctor_name = doctor_map.get(doc_id, "Unassigned") if doc_id else "Unassigned"
            result.append({
                "id": case_id,
                "caseId": case_id,
                "insurerRef": case.get("insurerRef", ""),          # ← ADD: main display identifier
                "claimMode": case.get("claimMode", ""),             # ← ADD: surfaced separately from `type`
                "type": f"{case.get('claimMode', '').title()} — {case.get('claimSubtype', '').title()}",
                "claimant": case.get("claimantName", "Unknown"),
                "insurer": case.get("insurer", "—"),
                "priority": case.get("claimPriority", "Normal"),
                "status": claim_status,
                "hospital": (case.get("hospitalDetails") or {}).get("name", "—"),
                "location": (case.get("hospitalDetails") or {}).get("address", "") or case.get("pinCode", "—"),
                "investigators": investigators_list,
                "claimedAmount": case.get("claimedAmount", 0),
                "targetDate": str(case.get("targetDate", "—")),
                "investigations": inv,
                "pinCode": case.get("pinCode", ""),
                "hospitalPincode": (case.get("hospitalDetails") or {}).get("pincode", ""),
                "createdAt": _fmt_date(created_at),
                "sla": sla_elapsed,
                "slaMax": sla_max,
                "timeline": timeline,
                "tags": case.get("tags", []),
                "doctorAssigned": doctor_name,          # ← NEW
                "doctorAssignedId": doc_id,              # ← NEW
                "progress": {
                    "total": total_inv,
                    "completed": completed_inv,
                    "partial": partial_inv,
                    "pending": total_inv - completed_inv - partial_inv,
                },
            })

        all_investigators = list(USER_AUTH.distinct("full_name", {"role": "field-officer"}))

        return {
            "status": "success",
            "data": result,
            "meta": {
                "total": total_count,
                "page": page,
                "limit": limit,
                "investigators": [i for i in all_investigators if i],
                "doctors": sorted(set(doctor_map.values())) + ["Unassigned"],   # ← NEW
                "statuses": ["ALLOCATED", "COMPLETED"],
            },
        }

    except Exception as e:
        import traceback
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=f"Tracking error: {str(e)}")
@router.get("/tracking/cases/{case_id}")
async def get_tracking_case_detail(case_id: str):
    case = CLAIMS.find_one({"caseId": case_id}, {"_id": 0})
    if not case:
        raise HTTPException(status_code=404, detail=f"Case '{case_id}' not found")
    try:
        payload = _build_case_payload(case)
    except Exception as e:
        import traceback
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=f"Tracking detail error: {str(e)}")
    return {"status": "success", "data": payload}