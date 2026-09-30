"""
patient_app/routes.py  (REWRITTEN sections: messages/chat thread, follow-ups,
check-in submit, photos. Medications/condition/appointments/consent/config
are unchanged.)

Chat thread = patient_messages, one collection, kinds:
  text      patient or doctor message
  photo     patient photo AFTER the patient confirmed the extraction
  followup  full Q&A of a follow-up on a free-text message
  checkin   summary card of a submitted daily check-in
"""

import uuid
from datetime import datetime, timezone
from typing import Optional

from fastapi import APIRouter, BackgroundTasks, Depends, File, Form, HTTPException, Query, Request, Response, UploadFile
from pydantic import BaseModel, Field, field_validator
from pymongo.errors import DuplicateKeyError

from .auth import Patient, get_current_patient
from .config import (
    MAX_ARRAY_ITEMS,
    MAX_BODY_BYTES,
    MAX_FREE_TEXT_CHARS,
    MAX_NOTE_CHARS,
    MAX_PHOTO_BYTES,
    MAX_PHOTO_SUMMARY_CHARS,
    SHOW_DIAGNOSIS_TO_PATIENT,
    SUPPORTED_LANGS,
    TZ,
)
from .db import (
    patient_alerts,
    patient_checkin_photos,
    patient_checkins,
    patient_consent,
    patient_med_log,
    patient_messages,
)
from .services import care_data
from .services import checkin as checkin_svc
from .services import condition as condition_svc
from .services import medications as medications_svc
from .services import photos as photos_svc


async def guard(request: Request, response: Response) -> None:
    length = request.headers.get("content-length")
    if length and length.isdigit() and int(length) > MAX_BODY_BYTES:
        raise HTTPException(status_code=413, detail="Request too large")
    response.headers["Cache-Control"] = "no-store"


router = APIRouter(prefix="/patient_app/me", tags=["patient_app"], dependencies=[Depends(guard)])

# The photo upload endpoint carries an image, so it needs a larger body cap
# than the JSON guard above. Patch note: if PATIENT_APP_MAX_BODY_BYTES (256 KB)
# is enforced by a proxy too, raise it there for /checkins/photos.


@router.get("/ping")
async def ping(patient: Patient = Depends(get_current_patient)):
    return {"status": "success"}


# =====================================================================
# Medications (unchanged)
# =====================================================================
@router.get("/medications")
async def get_medications(patient: Patient = Depends(get_current_patient)):
    now = datetime.now(timezone.utc)
    local_date = now.astimezone(TZ).date().isoformat()
    med_docs = await care_data.load_med_docs(patient.sys_user_id)
    current = medications_svc.select_current_docs(med_docs)
    doctors = await care_data.get_doctor_names(list(current.keys()))
    statuses = await care_data.load_slot_statuses(patient.sys_user_id, local_date)
    return medications_svc.build_medications(current, doctors, statuses, now, TZ)


_LOG_STATUSES = {"taken", "late", "early", "skipped", "together"}
_LOG_REASONS = {"vomit", "side", "forgot", "ranout", "other"}


class MedicationLogIn(BaseModel):
    client_id: str = Field(..., min_length=1, max_length=100)
    slot_id: str = Field(..., min_length=1, max_length=200)
    med_key: str = Field(..., min_length=1, max_length=100)
    name: str = Field(..., min_length=1, max_length=200)
    status: str
    reason: Optional[str] = None
    reported_time: Optional[str] = Field(default=None, max_length=20)
    taken_at: Optional[str] = Field(default=None, max_length=40)
    actor: str = Field(default="me", max_length=100)

    @field_validator("status")
    @classmethod
    def _check_status(cls, v: str) -> str:
        if v not in _LOG_STATUSES:
            raise ValueError(f"status must be one of {sorted(_LOG_STATUSES)}")
        return v

    @field_validator("reason")
    @classmethod
    def _check_reason(cls, v: Optional[str]) -> Optional[str]:
        if v is not None and v not in _LOG_REASONS:
            raise ValueError(f"reason must be one of {sorted(_LOG_REASONS)} or omitted")
        return v


@router.post("/medications/log")
async def log_medication(payload: MedicationLogIn, patient: Patient = Depends(get_current_patient)):
    existing = await patient_med_log.find_one(
        {"patient_id": patient.sys_user_id, "client_id": payload.client_id}, {"_id": 1}
    )
    if existing:
        return {"status": "success", "id": str(existing["_id"])}
    now = datetime.now(timezone.utc)
    doc = {
        "patient_id": patient.sys_user_id, "client_id": payload.client_id, "slot_id": payload.slot_id,
        "med_key": payload.med_key, "name": payload.name, "status": payload.status, "reason": payload.reason,
        "reported_time": payload.reported_time, "taken_at": payload.taken_at, "actor": payload.actor,
        "local_date": now.astimezone(TZ).date().isoformat(), "created_at": now,
    }
    try:
        result = await patient_med_log.insert_one(doc)
    except DuplicateKeyError:
        existing = await patient_med_log.find_one(
            {"patient_id": patient.sys_user_id, "client_id": payload.client_id}, {"_id": 1}
        )
        return {"status": "success", "id": str(existing["_id"])}
    return {"status": "success", "id": str(result.inserted_id)}


# =====================================================================
# Condition / appointments / consent / checkin-config (unchanged)
# =====================================================================
@router.get("/condition")
async def get_condition(patient: Patient = Depends(get_current_patient)):
    if not SHOW_DIAGNOSIS_TO_PATIENT:
        return {"status": "success", "show_diagnosis": False, "condition": None}
    diagnosis_rows = await care_data.load_diagnosis_docs(patient.sys_user_id)
    summary_doc = await care_data.load_patient_summary(patient.sys_user_id)
    picked = condition_svc.pick_condition(diagnosis_rows, summary_doc)
    if picked and picked["doctor"]["doctor_id"]:
        names = await care_data.get_doctor_names([picked["doctor"]["doctor_id"]])
        info = names.get(picked["doctor"]["doctor_id"])
        if info:
            picked["doctor"]["name"] = info.get("name")
    return {"status": "success", "show_diagnosis": True, "condition": picked}


@router.get("/appointments/next")
async def get_next_appointment(patient: Patient = Depends(get_current_patient)):
    doc = await care_data.load_appointments_doc(patient.sys_user_id)
    appts = (doc or {}).get("appointments") or []
    today = datetime.now(TZ).date().isoformat()
    upcoming = [a for a in appts if isinstance(a, dict) and isinstance(a.get("date"), str) and a["date"] >= today]
    if not upcoming:
        return {"status": "success", "appointment": None}
    upcoming.sort(key=lambda a: (a["date"], a.get("scheduled_time") or "99:99"))
    nxt = upcoming[0]
    doctor_id = nxt.get("doctor_id")
    doctor_name = specialization = None
    if doctor_id:
        info = (await care_data.get_doctor_names([doctor_id])).get(doctor_id)
        if info:
            doctor_name, specialization = info.get("name"), info.get("specialization")
    return {
        "status": "success",
        "appointment": {
            "date": nxt.get("date"), "scheduled_time": nxt.get("scheduled_time") or None,
            "visit_type": nxt.get("visit_type"),
            "doctor": {"doctor_id": doctor_id, "name": doctor_name, "specialization": specialization},
        },
    }


class ConsentIn(BaseModel):
    ai: bool
    research: Optional[bool] = None


@router.get("/consent")
async def get_consent(patient: Patient = Depends(get_current_patient)):
    doc = await patient_consent.find_one({"patient_id": patient.sys_user_id}, {"_id": 0})
    return {"status": "success", "consent": {"ai": bool((doc or {}).get("ai", False)), "research": bool((doc or {}).get("research", False))}}


@router.post("/consent")
async def set_consent(payload: ConsentIn, patient: Patient = Depends(get_current_patient)):
    update = {"patient_id": patient.sys_user_id, "ai": payload.ai, "updated_at": datetime.now(timezone.utc)}
    if payload.research is not None:
        update["research"] = payload.research
    await patient_consent.update_one({"patient_id": patient.sys_user_id}, {"$set": update}, upsert=True)
    return {"status": "success", "consent": {"ai": payload.ai, "research": payload.research}}


@router.get("/checkin-config")
async def get_checkin_config(patient: Patient = Depends(get_current_patient), lang: str = Query(default="en")):
    if lang not in SUPPORTED_LANGS:
        lang = "en"
    consent_doc = await patient_consent.find_one({"patient_id": patient.sys_user_id}, {"ai": 1})
    ai_consent = bool((consent_doc or {}).get("ai", False))
    chemo_doc = await care_data.load_active_chemo(patient.sys_user_id)
    med_docs = await care_data.load_med_docs(patient.sys_user_id)
    recent_checkins = await care_data.load_recent_checkins(patient.sys_user_id)
    profile = await care_data.load_patient_profile(patient.sys_user_id)
    diagnosis_rows = await care_data.load_diagnosis_docs(patient.sys_user_id)
    summary_doc = await care_data.load_patient_summary(patient.sys_user_id)
    picked = condition_svc.pick_condition(diagnosis_rows, summary_doc)
    return await checkin_svc.build_checkin_config(
        ai_consent=ai_consent, med_docs=med_docs, chemo_doc=chemo_doc, recent_checkins=recent_checkins,
        profile=profile, now=datetime.now(timezone.utc), tz=TZ, lang=lang,
        diagnosis=picked["diagnosis"] if picked else None,
    )


# =====================================================================
# Chat thread
# =====================================================================
_URGENT_WORDS = ("blood", "bleed", "black stool", "fever", "chest pain", "breath", "faint",
                 "cannot drink", "can't drink", "unconscious", "seizure",
                 "खून", "बुखार", "सीने में दर्द", "साँस", "बेहोश",
                 "രക്തം", "പനി", "നെഞ്ചുവേദന", "ശ്വാസം", "ബോധം")


def _is_urgent(text: str) -> bool:
    low = (text or "").lower()
    return any(w in low for w in _URGENT_WORDS)


def _iso(dt) -> Optional[str]:
    return dt.isoformat() if dt else None


async def _thread_view(rows: list) -> list:
    photo_ids = [r["photo_id"] for r in rows if r.get("kind") == "photo" and r.get("photo_id")]
    confirmed = {}
    if photo_ids:
        async for p in patient_checkin_photos.find({"photo_id": {"$in": photo_ids}}, {"_id": 0, "photo_id": 1, "confirmed": 1}):
            confirmed[p["photo_id"]] = p.get("confirmed") or {}
    out = []
    for r in rows:
        kind = r.get("kind", "text")
        item = {
            "id": str(r["_id"]), "client_id": r.get("client_id"), "from": r.get("from", "patient"),
            "kind": kind, "text": r.get("text", ""), "doctor_name": r.get("doctor_name"),
            "urgent": bool(r.get("urgent")), "at": _iso(r.get("created_at")),
        }
        if kind == "photo":
            c = confirmed.get(r.get("photo_id"), {})
            item["photo"] = {"photo_id": r.get("photo_id"), "category": c.get("category"),
                             "items": c.get("items_local") or [], "note": c.get("note")}
        elif kind == "followup":
            item["qa"] = r.get("qa") or []
        elif kind == "checkin":
            item["lines"] = r.get("lines") or []
            item["date"] = r.get("date")
        out.append(item)
    return out


@router.get("/messages")
async def list_thread(patient: Patient = Depends(get_current_patient), limit: int = Query(default=150, ge=1, le=300)):
    cur = patient_messages.find({"patient_id": patient.sys_user_id}).sort("created_at", -1)
    rows = await cur.to_list(length=limit)
    rows.reverse()  # oldest -> newest
    return {"status": "success", "messages": await _thread_view(rows)}


class MessageIn(BaseModel):
    client_id: str = Field(..., min_length=1, max_length=100)
    text: str = Field(..., min_length=1, max_length=MAX_NOTE_CHARS)


@router.post("/messages")
async def post_message(payload: MessageIn, patient: Patient = Depends(get_current_patient)):
    if await patient_messages.find_one({"patient_id": patient.sys_user_id, "client_id": payload.client_id}, {"_id": 1}):
        return {"status": "success", "urgent": False}
    urgent = _is_urgent(payload.text)
    now = datetime.now(timezone.utc)
    try:
        await patient_messages.insert_one({
            "patient_id": patient.sys_user_id, "client_id": payload.client_id, "from": "patient",
            "kind": "text", "text": payload.text, "urgent": urgent, "created_at": now,
        })
    except DuplicateKeyError:
        return {"status": "success", "urgent": False}
    await patient_alerts.insert_one({
        "patient_id": patient.sys_user_id, "checkin_id": None,
        "title": "Message from patient: " + payload.text[:150], "to": "Nurse",
        "level": "urgent" if urgent else "routine", "created_at": now,
    })
    return {"status": "success", "urgent": urgent}


class MessageFollowupIn(BaseModel):
    client_id: str = Field(..., min_length=1, max_length=100)
    text: str = Field(..., min_length=1, max_length=MAX_NOTE_CHARS)
    lang: str = "en"
    source: str = "message"  # "message" (anytime chat) | "checkin" (free text inside a check-in)
    history: list[dict] = Field(default_factory=list, max_length=6)


_MAX_FOLLOWUPS = 4


@router.post("/messages/followup")
async def message_followup(payload: MessageFollowupIn, patient: Patient = Depends(get_current_patient)):
    lang = payload.lang if payload.lang in SUPPORTED_LANGS else "en"
    source = payload.source if payload.source in ("message", "checkin") else "message"
    hist = [h for h in payload.history if isinstance(h, dict)][:_MAX_FOLLOWUPS]
    urgent = _is_urgent(payload.text) or any(h.get("a") is True and h.get("urgent") for h in hist)

    question = None
    if not urgent and len(hist) < _MAX_FOLLOWUPS:
        consent_doc = await patient_consent.find_one({"patient_id": patient.sys_user_id}, {"ai": 1})
        if bool((consent_doc or {}).get("ai", False)):
            med_docs = await care_data.load_med_docs(patient.sys_user_id)
            chemo_doc = await care_data.load_active_chemo(patient.sys_user_id)
            profile = await care_data.load_patient_profile(patient.sys_user_id)
            rows = await care_data.load_diagnosis_docs(patient.sys_user_id)
            picked = condition_svc.pick_condition(rows, await care_data.load_patient_summary(patient.sys_user_id))
            ctx = checkin_svc.build_llm_context(med_docs, chemo_doc, [], profile, datetime.now(timezone.utc), TZ,
                                                diagnosis=picked["diagnosis"] if picked else None)
            question = await checkin_svc.generate_followup(ctx, lang, payload.text, hist)
        if question is None:  # no consent or LLM failed: fixed questions
            fb = checkin_svc.FOLLOWUP_FALLBACK
            if len(hist) < len(fb):
                q = fb[len(hist)]
                question = {"id": q["id"], "label": q["label"][lang], "urgent": q["urgent"]}
            else:
                question = {"done": True}

    if question and not question.get("done"):
        return {"status": "success", "done": False, "urgent": False, "question": question}

    # Finished: save the WHOLE Q&A for the doctor and send the nurse ONE alert.
    qa = [{"q": str(h.get("q") or "")[:200], "a": "Yes" if h.get("a") else "No"} for h in hist]
    now = datetime.now(timezone.utc)
    if source == "message":
        await patient_messages.update_one(
            {"patient_id": patient.sys_user_id, "client_id": "fu-" + payload.client_id},
            {"$setOnInsert": {
                "patient_id": patient.sys_user_id, "client_id": "fu-" + payload.client_id, "from": "patient",
                "kind": "followup", "text": payload.text[:MAX_NOTE_CHARS], "qa": qa, "urgent": urgent,
                "created_at": now}},
            upsert=True,
        )
    yes = [x["q"] for x in qa if x["a"] == "Yes"]
    no = [x["q"] for x in qa if x["a"] == "No"]
    what = "patient message" if source == "message" else "check-in free text"
    title = f"Follow-up on {what}: {payload.text[:80]} | Yes: {'; '.join(yes) or 'none'} | No: {'; '.join(no) or 'none'}"
    await patient_alerts.insert_one({
        "patient_id": patient.sys_user_id, "checkin_id": None, "title": title[:200], "to": "Nurse",
        "level": "urgent" if urgent else "routine", "created_at": now})
    return {"status": "success", "done": True, "urgent": urgent, "question": None}


# =====================================================================
# Photos: upload -> extraction -> patient edits -> confirm (sends to team)
# =====================================================================
@router.post("/checkins/photos")
async def upload_checkin_photo(
    background_tasks: BackgroundTasks,
    patient: Patient = Depends(get_current_patient),
    client_id: str = Form(..., min_length=1, max_length=100),
    lang: str = Form("en"),
    source: str = Form("auto"),  # kept for old clients; the type is now detected by the model
    file: UploadFile = File(...),
):
    content = await file.read()
    if len(content) > MAX_PHOTO_BYTES:
        raise HTTPException(status_code=413, detail="Photo too large")
    ctype = file.content_type or "image/jpeg"
    if not ctype.startswith("image/"):
        raise HTTPException(status_code=400, detail="Only images are accepted")
    lang = lang if lang in SUPPORTED_LANGS else "en"

    photo_id = f"PHOTO-{uuid.uuid4().hex[:12]}"
    now = datetime.now(timezone.utc)
    await patient_checkin_photos.insert_one({
        "photo_id": photo_id, "patient_id": patient.sys_user_id, "client_id": client_id, "source": source,
        "lang": lang, "photo_url": None, "storage_path": None, "status": "queued", "category": None,
        "ai": None, "confirmed": None, "sent": False, "patient_description": None, "clinical_note": None,
        "diagnosis_relevant": None, "error": None, "created_at": now, "updated_at": now,
    })
    background_tasks.add_task(
        photos_svc.process_checkin_photo,
        photo_id=photo_id, patient_id=patient.sys_user_id, content=content, content_type=ctype,
        filename=file.filename or "photo.jpg", lang=lang,
    )
    return {"status": "success", "photo_id": photo_id, "processing_status": "queued"}


@router.get("/checkins/photos/{photo_id}")
async def get_checkin_photo_status(photo_id: str, patient: Patient = Depends(get_current_patient)):
    doc = await patient_checkin_photos.find_one(
        {"photo_id": photo_id, "patient_id": patient.sys_user_id},
        {"_id": 0, "status": 1, "category": 1, "ai": 1, "sent": 1, "photo_url": 1},
    )
    if not doc:
        raise HTTPException(status_code=404, detail="Photo not found")
    ai = doc.get("ai") or {}
    return {"status": "success", "photo": {
        "status": doc.get("status"), "category": doc.get("category"),
        "items": ai.get("items_local") or [], "summary": ai.get("summary_local") or "",
        "sent": bool(doc.get("sent")), "has_image": bool(doc.get("photo_url")),
    }}


@router.get("/checkins/photos/{photo_id}/image")
async def get_checkin_photo_image(photo_id: str, patient: Patient = Depends(get_current_patient)):
    doc = await patient_checkin_photos.find_one(
        {"photo_id": photo_id, "patient_id": patient.sys_user_id}, {"photo_url": 1})
    if not doc:
        raise HTTPException(status_code=404, detail="Photo not found")
    data = await photos_svc.fetch_image(doc)
    if not data:
        raise HTTPException(status_code=404, detail="Image not available")
    return Response(content=data[0], media_type=data[1], headers={"Cache-Control": "private, max-age=600"})


class PhotoConfirmIn(BaseModel):
    client_id: str = Field(..., min_length=1, max_length=100)  # id of the chat message this creates
    category: str
    items: list[str] = Field(default_factory=list, max_length=12)
    note: Optional[str] = Field(default=None, max_length=300)
    lang: str = "en"

    @field_validator("category")
    @classmethod
    def _cat(cls, v: str) -> str:
        if v not in photos_svc.VALID_CATEGORIES:
            raise ValueError("bad category")
        return v

    @field_validator("items")
    @classmethod
    def _items(cls, v: list) -> list:
        return [i.strip()[:120] for i in v if isinstance(i, str) and i.strip()]


@router.post("/checkins/photos/{photo_id}/confirm")
async def confirm_checkin_photo(photo_id: str, payload: PhotoConfirmIn, patient: Patient = Depends(get_current_patient)):
    pid = patient.sys_user_id
    doc = await patient_checkin_photos.find_one({"photo_id": photo_id, "patient_id": pid})
    if not doc:
        raise HTTPException(status_code=404, detail="Photo not found")
    existing = await patient_messages.find_one({"patient_id": pid, "client_id": payload.client_id})
    if existing:
        return {"status": "success", "message": (await _thread_view([existing]))[0]}

    items = payload.items
    note = (payload.note or "").strip() or None
    if not items and not note:
        raise HTTPException(status_code=400, detail="Add at least one item or a note")
    lang = payload.lang if payload.lang in SUPPORTED_LANGS else "en"

    # English version for the doctor: unchanged AI items map to the AI English
    # text; anything the patient added/renamed is translated.
    ai = doc.get("ai") or {}
    ai_local, ai_en = ai.get("items_local") or [], ai.get("items_en") or []
    items_en: list = []
    pending: list = []  # (kind, index, text)
    for i, it in enumerate(items):
        if lang == "en":
            items_en.append(it)
        elif it in ai_local and ai_local.index(it) < len(ai_en):
            items_en.append(ai_en[ai_local.index(it)])
        else:
            items_en.append(None)
            pending.append(("item", i, it))
    note_en = note
    if note and lang != "en":
        note_en = None
        pending.append(("note", 0, note))
    if pending:
        translated = await photos_svc.translate_to_english([p[2] for p in pending], lang)
        for (kind, i, _), tr in zip(pending, translated):
            if kind == "item":
                items_en[i] = tr
            else:
                note_en = tr
    items_en = [x or items[i] for i, x in enumerate(items_en)]

    now = datetime.now(timezone.utc)
    clinical = "; ".join(items_en) + (f" — {note_en}" if note_en else "")
    await patient_checkin_photos.update_one(
        {"photo_id": photo_id},
        {"$set": {
            "confirmed": {"category": payload.category, "items_local": items, "items_en": items_en,
                          "note": note, "note_en": note_en, "lang": lang},
            "category": payload.category, "sent": True, "sent_at": now, "updated_at": now,
            "clinical_note": clinical[:MAX_PHOTO_SUMMARY_CHARS],
            "diagnosis_relevant": payload.category == "body",
        }},
    )
    urgent = _is_urgent(clinical)
    msg = {"patient_id": pid, "client_id": payload.client_id, "from": "patient", "kind": "photo",
           "photo_id": photo_id, "text": ", ".join(items), "urgent": urgent, "created_at": now}
    try:
        res = await patient_messages.insert_one(msg)
        msg["_id"] = res.inserted_id
    except DuplicateKeyError:
        msg = await patient_messages.find_one({"patient_id": pid, "client_id": payload.client_id})
    await patient_alerts.insert_one({
        "patient_id": pid, "checkin_id": None,
        "title": f"Photo from patient ({payload.category}): {clinical}"[:200], "to": "Nurse",
        "level": "urgent" if urgent else "routine", "created_at": now})
    return {"status": "success", "message": (await _thread_view([msg]))[0]}


# =====================================================================
# Check-in submission
# =====================================================================
class FollowUpIn(BaseModel):
    dur: Optional[int] = None
    worse: Optional[bool] = None
    eat: Optional[bool] = None


class WeeklyIn(BaseModel):
    esas: Optional[dict] = None
    distress: Optional[int] = None
    problems: Optional[list] = None
    phq: Optional[dict] = None
    lifestyle: Optional[dict] = None

    @field_validator("problems")
    @classmethod
    def _check_problems(cls, v: Optional[list]) -> Optional[list]:
        if v is not None and len(v) > MAX_ARRAY_ITEMS:
            raise ValueError("too many problems")
        return v


_ALERT_LEVELS = {"urgent", "routine"}


class AlertIn(BaseModel):
    title: str = Field(..., min_length=1, max_length=200)
    to: str = Field(..., min_length=1, max_length=100)
    level: str = "routine"

    @field_validator("level")
    @classmethod
    def _check_level(cls, v: str) -> str:
        if v not in _ALERT_LEVELS:
            raise ValueError(f"level must be one of {sorted(_ALERT_LEVELS)}")
        return v


class CheckinIn(BaseModel):
    client_id: str = Field(..., min_length=1, max_length=100)
    date: str = Field(..., min_length=8, max_length=10)
    phase: Optional[str] = Field(default=None, max_length=40)
    doctor_id: Optional[str] = None
    actor: str = Field(default="me", max_length=100)
    weight: Optional[float] = None
    red_flag: Optional[bool] = None
    symptoms: Optional[dict] = None
    comparisons: Optional[dict] = None
    body_sites: Optional[dict] = None
    note: str = Field(default="", max_length=MAX_NOTE_CHARS)
    free_text_answers: Optional[dict] = None
    questions: Optional[list] = Field(default=None, max_length=60)
    generated: Optional[bool] = None
    follow_up: Optional[FollowUpIn] = None
    followups: Optional[list] = Field(default=None, max_length=10)      # Q&A on free text: [{text, qa:[{q,a}]}]
    summary_lines: Optional[list] = Field(default=None, max_length=60)  # [{q,a}] for the chat summary card
    food_items: Optional[list] = None
    weekly: Optional[WeeklyIn] = None
    alerts: list[AlertIn] = Field(default_factory=list)
    submitted_at: Optional[str] = None

    @field_validator("food_items")
    @classmethod
    def _check_food_items(cls, v: Optional[list]) -> Optional[list]:
        if v is not None and len(v) > MAX_ARRAY_ITEMS:
            raise ValueError("too many food_items")
        return v

    @field_validator("alerts")
    @classmethod
    def _check_alerts(cls, v: list) -> list:
        if len(v) > MAX_ARRAY_ITEMS:
            raise ValueError("too many alerts")
        return v

    @field_validator("free_text_answers")
    @classmethod
    def _check_free_text(cls, v: Optional[dict]) -> Optional[dict]:
        if v is None:
            return v
        if len(v) > MAX_ARRAY_ITEMS:
            raise ValueError("too many free_text_answers")
        for k, val in v.items():
            if not isinstance(val, str) or len(val) > MAX_FREE_TEXT_CHARS:
                raise ValueError(f"free_text_answers[{k}] exceeds {MAX_FREE_TEXT_CHARS} chars")
        return v

    @field_validator("symptoms", "comparisons", "body_sites")
    @classmethod
    def _check_map_size(cls, v: Optional[dict]) -> Optional[dict]:
        if v is not None and len(v) > MAX_ARRAY_ITEMS:
            raise ValueError("too many entries")
        return v


def _clean_followups(v) -> Optional[list]:
    out = []
    for f in (v or [])[:10]:
        if not isinstance(f, dict):
            continue
        qa = [{"q": str(x.get("q", ""))[:200], "a": str(x.get("a", ""))[:10]}
              for x in (f.get("qa") or [])[:8] if isinstance(x, dict)]
        out.append({"text": str(f.get("text", ""))[:MAX_NOTE_CHARS], "qa": qa})
    return out or None


@router.post("/checkins")
async def submit_checkin(payload: CheckinIn, patient: Patient = Depends(get_current_patient)):
    pid = patient.sys_user_id
    existing = await patient_checkins.find_one({"patient_id": pid, "client_id": payload.client_id}, {"_id": 1})
    if existing:
        return {"status": "success", "id": str(existing["_id"])}

    doctor_ids = await care_data.get_patient_doctor_ids(pid)
    doctor_id = payload.doctor_id if payload.doctor_id in doctor_ids else None

    weekly = None
    if payload.weekly:
        w = payload.weekly.model_dump(exclude_none=True)
        private = {}
        if "phq" in w:
            private["phq"] = w.pop("phq")
        if "distress" in w:
            private["distress"] = w.pop("distress")
        weekly = w
        if private:
            weekly["private"] = private

    note_summary = None
    free_text_summary = None
    consent_doc = await patient_consent.find_one({"patient_id": pid}, {"ai": 1})
    ai_consent = bool((consent_doc or {}).get("ai", False))
    if ai_consent and (payload.note.strip() or payload.free_text_answers):
        if payload.note.strip():
            note_summary = await checkin_svc.summarize_free_text([payload.note], lang="en")
        if payload.free_text_answers:
            summary_map = {}
            for qid, text in payload.free_text_answers.items():
                s = await checkin_svc.summarize_free_text([text], lang="en")
                if s:
                    summary_map[qid] = s
            free_text_summary = summary_map or None

    # Only photos the patient CONFIRMED (load_checkin_photos filters sent=True).
    photo_docs = await care_data.load_checkin_photos(pid, payload.client_id)
    photo_findings = [
        {"source": (p.get("confirmed") or {}).get("category") or p.get("source"),
         "summary": (p.get("clinical_note") or "")[:MAX_PHOTO_SUMMARY_CHARS]}
        for p in photo_docs if p.get("diagnosis_relevant") and p.get("clinical_note")
    ]
    food_from_photos: list = []
    for p in photo_docs:
        c = p.get("confirmed") or {}
        if c.get("category") == "food":
            food_from_photos += c.get("items_en") or c.get("items_local") or []
    food_items = food_from_photos or payload.food_items

    now = datetime.now(timezone.utc)
    doc = {
        "patient_id": pid, "client_id": payload.client_id, "date": payload.date, "phase": payload.phase,
        "doctor_id": doctor_id, "actor": payload.actor, "weight": payload.weight, "red_flag": payload.red_flag,
        "symptoms": payload.symptoms, "comparisons": payload.comparisons, "body_sites": payload.body_sites,
        "note": payload.note, "free_text_answers": payload.free_text_answers, "questions": payload.questions,
        "generated": payload.generated, "note_summary": note_summary, "free_text_summary": free_text_summary,
        "photo_ids": [p["photo_id"] for p in photo_docs] or None, "photo_findings": photo_findings or None,
        "follow_up": payload.follow_up.model_dump(exclude_none=True) if payload.follow_up else None,
        "followups": _clean_followups(payload.followups),
        "food_items": food_items, "weekly": weekly, "submitted_at": payload.submitted_at, "created_at": now,
    }
    try:
        result = await patient_checkins.insert_one(doc)
    except DuplicateKeyError:
        existing = await patient_checkins.find_one({"patient_id": pid, "client_id": payload.client_id}, {"_id": 1})
        return {"status": "success", "id": str(existing["_id"])}

    checkin_id = str(result.inserted_id)
    for alert in payload.alerts:
        await patient_alerts.insert_one({
            "patient_id": pid, "checkin_id": checkin_id, "title": alert.title, "to": alert.to,
            "level": alert.level, "created_at": now})

    # Summary card in the patient's chat thread (kept across days).
    lines = [{"q": str(l.get("q", ""))[:200], "a": str(l.get("a", ""))[:300]}
             for l in (payload.summary_lines or []) if isinstance(l, dict)]
    if lines:
        await patient_messages.update_one(
            {"patient_id": pid, "client_id": payload.client_id},
            {"$setOnInsert": {"patient_id": pid, "client_id": payload.client_id, "from": "patient",
                              "kind": "checkin", "text": "", "date": payload.date, "lines": lines,
                              "created_at": now}},
            upsert=True,
        )
    return {"status": "success", "id": checkin_id}


@router.get("/checkins/today")
async def get_today_checkin_status(patient: Patient = Depends(get_current_patient)):
    local_date = datetime.now(TZ).date().isoformat()
    daily = await patient_checkins.find_one(
        {"patient_id": patient.sys_user_id, "date": local_date, "red_flag": {"$ne": True}},
        {"_id": 1, "weekly": 1},
    )
    return {"status": "success", "date": local_date, "checked_in_today": bool(daily),
            "weekly_done_today": bool(daily and daily.get("weekly"))}