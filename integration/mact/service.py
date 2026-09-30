"""
integration/mact/service.py

Business logic for registering a petition and listing cases.

Case numbers
  MACT-<year>-<seq:04d>, e.g. MACT-2026-0001.
  * The sequence restarts at 0001 every calendar year (IST).
  * It comes from an atomic per-year counter ($inc), then any number already
    taken (sample cases, imported cases) is skipped.
  * A unique index on `id` is the last line of defence; on a clash we simply
    take the next number.
  * A number is "used up" once allocated. If the insert then fails for another
    reason there can be a gap (e.g. 0007 -> 0009). Gaps are harmless; reuse
    would not be.
"""

import logging
import re
from datetime import date, datetime, timedelta, timezone
from typing import Optional
from zoneinfo import ZoneInfo

from pymongo import ReturnDocument
from pymongo.errors import DuplicateKeyError

from .db import cases, counters, events
from .models import RegisterCaseIn

logger = logging.getLogger("mact.service")

try:
    IST = ZoneInfo("Asia/Kolkata")
except Exception:  # tzdata missing in the image; India has no DST
    logger.error("tzdata unavailable, falling back to fixed IST +05:30")
    IST = timezone(timedelta(hours=5, minutes=30))

_MAX_ID_ATTEMPTS = 5


class DuplicateCase(Exception):
    def __init__(self, field: str, existing_id: Optional[str]):
        self.field = field
        self.existing_id = existing_id
        super().__init__(f"duplicate {field}")


class InvalidInput(Exception):
    pass


def today_ist() -> date:
    return datetime.now(IST).date()


# ---------------------------------------------------------------------------
# Numbering
# ---------------------------------------------------------------------------
async def next_case_id(year: int) -> str:
    while True:
        doc = await counters.find_one_and_update(
            {"_id": f"case:{year}"},
            {"$inc": {"seq": 1}},
            upsert=True,
            return_document=ReturnDocument.AFTER,
        )
        cid = f"MACT-{year}-{doc['seq']:04d}"
        if not await cases.find_one({"id": cid}, {"_id": 1}):
            return cid  # else: taken (sample / imported) -> skip to the next number


# ---------------------------------------------------------------------------
# Case document (same shape as the React app's case objects)
# ---------------------------------------------------------------------------
def build_case_doc(case_id: str, p: RegisterCaseIn, today: date, created_by: str) -> dict:
    filed = (p.filed or today).isoformat()
    notice_on = (p.notice_on or today).isoformat()
    doc = {
        "id": case_id,
        "cnr": p.cnr,
        "mvc": p.mvc,
        "court": p.court,
        "district": p.district or "—",
        "state": p.state or "—",
        "type": p.type,
        "accident": p.acc.isoformat(),
        "place": "As per petition",
        "filed": filed,
        "noticeOn": notice_on,
        "darOn": None,
        "stage": 0,
        "courtStage": "Notice served (manual)",
        "priority": "Medium",
        "officer": "Unassigned",
        "advocate": "—",
        "cAdv": "—",
        "hospital": "—",
        "accType": "—",
        "vehCat": "—",
        "victim": {"name": p.victim, "age": p.age, "sex": "—", "occ": "—"},
        "vehicle": {"reg": "—", "cls": "—", "gvw": "—", "commercial": False},
        # Policy period is unknown until matched against policy admin: null, not invented dates.
        "policy": {"no": p.pol or "—", "from": None, "to": None, "kind": "To be matched"},
        "driver": {"name": "—", "dl": "—", "cls": "—", "valid": "—"},
        "claimed": p.claim,
        "reserve": 0,
        "next": None,
        "purpose": "Appearance",
        "income": {"claimed": None, "range": None, "sources": []},
        "deps": [],
        "q": {
            "emp": "fixed", "married": True,
            "depClaim": 0, "depIns": 0, "consClaim": 0, "consIns": 0,
            "medClaim": 0, "medVer": 0, "contribIns": 0, "contribTrib": 0,
            "disClaim": 0, "disIns": 0, "disTrib": 0, "months": 0, "lossPct": 0,
            "attendant": 0, "transport": 0, "futureMed": 0, "pain": 0, "amenities": 0,
        },
        "timeline": [], "conflicts": [], "coverage": [], "liab": None, "med": None,
        "flags": [], "law": [],
        # --- backend metadata ---
        "is_sample": False,
        "source": "manual",
        "created_at": datetime.now(timezone.utc),
        "created_by": created_by,
    }
    if p.type == "No-fault":
        doc["nfKind"] = p.no_fault_kind
    return doc


def _ci_exact(value: str) -> dict:
    return {"$regex": f"^{re.escape(value)}$", "$options": "i"}


# ---------------------------------------------------------------------------
# Register
# ---------------------------------------------------------------------------
async def register_case(p: RegisterCaseIn, actor: str) -> dict:
    today = today_ist()

    if p.acc > today:
        raise InvalidInput("Accident date cannot be in the future")
    filed = p.filed or today
    if filed > today:
        raise InvalidInput("Filing date cannot be in the future")
    if filed < p.acc:
        raise InvalidInput("Filing date cannot be before the accident date")

    # Duplicate checks BEFORE a number is allocated, so rejected petitions burn no numbers.
    hit = await cases.find_one({"cnr": p.cnr}, {"id": 1})
    if hit:
        raise DuplicateCase("cnr", hit["id"])
    hit = await cases.find_one({"court": _ci_exact(p.court), "mvc": _ci_exact(p.mvc)}, {"id": 1})
    if hit:
        raise DuplicateCase("mvc", hit["id"])

    doc = None
    for _ in range(_MAX_ID_ATTEMPTS):
        case_id = await next_case_id(today.year)
        doc = build_case_doc(case_id, p, today, actor)
        try:
            await cases.insert_one(doc)
            break
        except DuplicateKeyError as e:
            key = ((getattr(e, "details", None) or {}).get("keyPattern")) or {}
            if "cnr" in key:  # lost a race with a concurrent registration of the same CNR
                hit = await cases.find_one({"cnr": p.cnr}, {"id": 1})
                raise DuplicateCase("cnr", hit["id"] if hit else None)
            logger.warning("case id %s clashed, taking the next number", case_id)
    else:
        raise RuntimeError("could not allocate a case number")

    doc.pop("_id", None)
    now_local = datetime.now(IST).strftime("%Y-%m-%d %H:%M")
    try:
        await events.insert_one({
            "case_id": doc["id"], "at": now_local, "src": "Manual", "actor": actor,
            "action": "Case registered manually",
            "text": f"{doc['mvc']}, {doc['court']}; petition registered manually",
            "created_at": datetime.now(timezone.utc),
        })
    except Exception:
        logger.exception("event log write failed for %s (case itself was saved)", doc["id"])
    return doc


# ---------------------------------------------------------------------------
# List
# ---------------------------------------------------------------------------
SUMMARY_FIELDS = {
    "_id": 0, "id": 1, "cnr": 1, "mvc": 1, "court": 1, "district": 1, "state": 1,
    "type": 1, "nfKind": 1, "stage": 1, "courtStage": 1, "priority": 1,
    "officer": 1, "advocate": 1, "victim.name": 1, "victim.age": 1,
    "claimed": 1, "reserve": 1, "accident": 1, "filed": 1, "next": 1, "purpose": 1,
    "is_sample": 1, "source": 1, "created_at": 1,
}


async def list_cases(q: Optional[str], case_type: Optional[str], include_samples: bool,
                     skip: int, limit: int) -> tuple:
    flt: dict = {}
    if case_type:
        flt["type"] = case_type
    if not include_samples:
        flt["is_sample"] = {"$ne": True}
    if q and q.strip():
        rx = {"$regex": re.escape(q.strip()), "$options": "i"}
        flt["$or"] = [{"id": rx}, {"cnr": rx}, {"mvc": rx}, {"victim.name": rx}, {"court": rx}]
    total = await cases.count_documents(flt)
    cur = (cases.find(flt, SUMMARY_FIELDS)
           .sort([("created_at", -1), ("id", -1)])  # newest registration first
           .skip(skip).limit(limit))
    return total, await cur.to_list(length=limit)


async def delete_samples() -> dict:
    ids = [d["id"] async for d in cases.find({"is_sample": True}, {"id": 1, "_id": 0})]
    res = await cases.delete_many({"is_sample": True})
    if ids:
        await events.delete_many({"case_id": {"$in": ids}})
    return {"deleted_cases": res.deleted_count}