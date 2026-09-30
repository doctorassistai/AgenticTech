"""
integration/mact/decisions.py

Adjudicator decisions on findings, and the workflow stage, saved in Mongo.

  GET    /mact/cases/{id}/decisions                  {finding_id: {d, note, by, at}}
  PUT    /mact/cases/{id}/decisions/{finding_id}     body {d: accept|modify|reject, note}
  DELETE /mact/cases/{id}/decisions/{finding_id}     reopen
  PUT    /mact/cases/{id}/stage                      body {stage: 0..16}

Real cases only. The stage is stored as sent: the gates are still enforced by the console.
"""

import logging
import re
from datetime import datetime
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from .auth import actor_of
from .db import cases, decisions, events
from .documents import IST, _get_case, _now, require_adjudicator

logger = logging.getLogger("mact.decisions")
router = APIRouter(tags=["mact-decisions"])


class DecisionIn(BaseModel):
    d: Literal["accept", "modify", "reject"]
    note: str = Field(default="", max_length=1000)


class StageIn(BaseModel):
    stage: int = Field(ge=0, le=16)


def _fid(case_id: str, fid: str) -> str:
    if not fid.startswith(case_id + "-") or len(fid) > 160 or not re.fullmatch(r"[\w\-]+", fid):
        raise HTTPException(status_code=400, detail="Invalid finding id")
    return fid


async def _real_case(case_id: str) -> dict:
    c = await _get_case(case_id)
    if c.get("is_sample"):
        raise HTTPException(status_code=409, detail="Sample cases keep decisions in the browser")
    return c


async def _log(case_id: str, actor: str, action: str, text: str) -> None:
    try:
        await events.insert_one({
            "case_id": case_id, "at": datetime.now(IST).strftime("%Y-%m-%d %H:%M"), "src": "Review",
            "actor": actor, "action": action, "text": text, "created_at": _now(),
        })
    except Exception:
        logger.exception("event log write failed for %s", case_id)


@router.get("/cases/{case_id}/decisions")
async def list_decisions(case_id: str, user: dict = Depends(require_adjudicator)):
    await _get_case(case_id)
    rows = await decisions.find({"case_id": case_id}, {"_id": 0}).to_list(length=2000)
    return {"status": "success", "decisions": {
        r["finding_id"]: {"d": r["d"], "note": r.get("note", ""), "by": r.get("by"), "at": r.get("at")} for r in rows}}


@router.put("/cases/{case_id}/decisions/{finding_id}")
async def put_decision(case_id: str, finding_id: str, body: DecisionIn, user: dict = Depends(require_adjudicator)):
    await _real_case(case_id)
    fid = _fid(case_id, finding_id)
    note = body.note.strip()
    if body.d != "accept" and not note:
        raise HTTPException(status_code=422, detail="A reason is required to modify or reject a finding")
    actor = actor_of(user)
    rec = {"d": body.d, "note": note, "by": actor, "at": datetime.now(IST).strftime("%d %b %Y")}
    await decisions.update_one({"case_id": case_id, "finding_id": fid},
                               {"$set": {**rec, "updated_at": _now()}}, upsert=True)
    verb = {"accept": "accepted", "modify": "modified", "reject": "rejected"}[body.d]
    await _log(case_id, actor, f"Finding {verb}", fid + (f" — {note}" if note else ""))
    return {"status": "success", "decision": rec}


@router.delete("/cases/{case_id}/decisions/{finding_id}")
async def delete_decision(case_id: str, finding_id: str, user: dict = Depends(require_adjudicator)):
    await _real_case(case_id)
    fid = _fid(case_id, finding_id)
    await decisions.delete_one({"case_id": case_id, "finding_id": fid})
    await _log(case_id, actor_of(user), "Finding reopened", fid)
    return {"status": "success"}


@router.put("/cases/{case_id}/stage")
async def put_stage(case_id: str, body: StageIn, user: dict = Depends(require_adjudicator)):
    await _real_case(case_id)
    await cases.update_one({"id": case_id}, {"$set": {"stage": body.stage}})
    await _log(case_id, actor_of(user), "Stage changed", f"stage {body.stage}")
    return {"status": "success", "stage": body.stage}