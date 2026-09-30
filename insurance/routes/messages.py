# routes/messages.py
from fastapi import APIRouter, HTTPException, Request, WebSocket, WebSocketDisconnect
from motor.motor_asyncio import AsyncIOMotorClient
from pydantic import BaseModel
from datetime import datetime, timezone, timedelta
from typing import Optional, List
import os, json

from ws_manager import manager

IST = timezone(timedelta(hours=5, minutes=30))

router = APIRouter(prefix="/messages", tags=["Messages"])

MONGO_URI = os.getenv("MONGO_URI")
motor_client = AsyncIOMotorClient(MONGO_URI)
db = motor_client["doctorassistai"]
msg_col = db["case_messages"]
cases_col = db["insurance_claims_new"]

async def ensure_message_indexes():
    await msg_col.create_index([("caseId", 1), ("timestamp", 1)])
    await msg_col.create_index([("caseId", 1), ("readBy", 1)])


def _get_user_id(request: Request) -> str:
    uid = request.headers.get("X-User-Id")
    if not uid:
        raise HTTPException(status_code=401, detail="Missing X-User-Id")
    return uid
async def _get_unread_summary_for_user(user_id: str) -> dict:
    cursor = msg_col.find({"readBy": {"$ne": user_id}})
    counts = {}
    async for m in cursor:
        if m.get("senderId") == user_id:
            continue
        counts[m["caseId"]] = counts.get(m["caseId"], 0) + 1
    total = sum(counts.values())
    return {"unreadByCase": counts, "total": total}


async def _get_case_display_name(case_id: str) -> str:
    # ASSUMPTION: cases_col._id matches the caseId string stored on messages,
    # and claimantName is the field to show. Adjust the query/field if not.
    case = await cases_col.find_one({"_id": case_id}, {"claimantName": 1})
    if case and case.get("claimantName"):
        return case["claimantName"]
    return case_id

class SendMessage(BaseModel):
    caseId:     str
    senderId:   str
    senderName: str
    senderRole: str   # "field-officer" | "supervisor" | "admin"
    text:       str


def _serialize(m: dict) -> dict:
    m = dict(m)
    m["_id"] = str(m["_id"])
    if isinstance(m.get("timestamp"), datetime):
        m["timestamp"] = m["timestamp"].isoformat()
    return m


# ── REST: history, send (fallback), unread ──────────────────────────────────

@router.get("/case/{case_id}")
async def get_case_messages(case_id: str, request: Request, limit: int = 100):
    cursor = msg_col.find({"caseId": case_id}).sort("timestamp", 1).limit(limit)
    msgs = [ _serialize(m) async for m in cursor ]
    return {"messages": msgs}


@router.post("/send")
async def send_message(body: SendMessage, request: Request):
    doc = {
        "caseId":     body.caseId,
        "senderId":   body.senderId,
        "senderName": body.senderName,
        "senderRole": body.senderRole,
        "text":       body.text,
        "timestamp":  datetime.now(IST),
        "readBy":     [body.senderId],
    }
    result = await msg_col.insert_one(doc)
    doc["_id"] = result.inserted_id
    payload = _serialize(doc)

    # Broadcast to anyone actively viewing this case's chat
    await manager.broadcast_to_case(body.caseId, {"type": "message", "data": payload})

    # Notify the other party's badge even if they're not in the chat right now
    recipients = await _get_case_participants(body.caseId, exclude=body.senderId)
    case_name = await _get_case_display_name(body.caseId)
    for uid in recipients:
        summary = await _get_unread_summary_for_user(uid)
        await manager.notify_user(uid, {
            "type": "new_message",
            "caseId": body.caseId,
            "caseName": case_name,
            "senderName": body.senderName,
            "text": body.text,
            "unreadByCase": summary["unreadByCase"],
            "total": summary["total"],
        })

    return {"success": True, "message": payload}


@router.patch("/case/{case_id}/read")
async def mark_read(case_id: str, request: Request):
    user_id = _get_user_id(request)
    await msg_col.update_many(
        {"caseId": case_id, "readBy": {"$ne": user_id}},
        {"$addToSet": {"readBy": user_id}}
    )
    return {"success": True}


@router.get("/unread-summary")
async def unread_summary(request: Request):
    """
    Returns { caseId: unreadCount } for every case the current user
    participates in, plus a total for the sidebar/tab badge.
    """
    user_id = _get_user_id(request)
    return await _get_unread_summary_for_user(user_id)





# ── WebSocket: live case chat room ──────────────────────────────────────────

@router.websocket("/ws/case/{case_id}")
async def ws_case_chat(websocket: WebSocket, case_id: str):
    user_id = websocket.query_params.get("userId", "unknown")
    await manager.connect_case(case_id, websocket)
    try:
        while True:
            raw = await websocket.receive_text()
            data = json.loads(raw)
            # Expected: { senderId, senderName, senderRole, text }
            doc = {
                "caseId":     case_id,
                "senderId":   data.get("senderId", user_id),
                "senderName": data.get("senderName", ""),
                "senderRole": data.get("senderRole", ""),
                "text":       data.get("text", ""),
                "timestamp":  datetime.now(IST),
                "readBy":     [data.get("senderId", user_id)],
            }
            result = await msg_col.insert_one(doc)
            doc["_id"] = result.inserted_id
            payload = _serialize(doc)

            await manager.broadcast_to_case(case_id, {"type": "message", "data": payload})

            recipients = await _get_case_participants(case_id, exclude=doc["senderId"])
            case_name = await _get_case_display_name(case_id)
            for uid in recipients:
                summary = await _get_unread_summary_for_user(uid)
                await manager.notify_user(uid, {
                    "type": "new_message",
                    "caseId": case_id,
                    "caseName": case_name,
                    "senderName": doc["senderName"],
                    "text": doc["text"],
                    "unreadByCase": summary["unreadByCase"],
                    "total": summary["total"],
                })
    except WebSocketDisconnect:
        manager.disconnect_case(case_id, websocket)


# ── WebSocket: user-level notification channel (badges/toasts) ─────────────

@router.websocket("/ws/notifications/{user_id}")
async def ws_notifications(websocket: WebSocket, user_id: str):
    await manager.connect_user(user_id, websocket)
    try:
        while True:
            await websocket.receive_text()  # keep-alive pings from client, ignored
    except WebSocketDisconnect:
        manager.disconnect_user(user_id, websocket)