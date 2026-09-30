"""
patient_app/services/care_data.py

Async Mongo helpers. Read-only on the doctor-system collections; projections keep
fields such as metadata / safety_alerts / raw text from ever leaving the database
(handoff rule 2). Shared by the medications, condition, appointments, check-in
and consent endpoints.

CHANGED:
- load_checkin_photos now only returns photos the patient has CONFIRMED
  (sent=True) — an unsent/unreviewed photo must never reach a check-in
  submission or the doctor's view.
- load_recent_checkins now also projects "questions" and "followups", so the
  check-in generator can see what was actually asked/answered yesterday
  (needed for the yesterday-vs-today comparison questions).
- added load_yesterday_checkin: the single most recent check-in, for the
  "how is X today compared to yesterday" prompt in checkin.py.
"""

from typing import Optional

from ..db import (
    chemotherapy_records,
    diagnosis_data,
    doctor_users,
    medication_analysis,
    patient_alerts,
    patient_appointments,
    patient_checkin_photos,
    patient_checkins,
    patient_med_log,
    patient_summary,
    patient_users,
)

_MAX_DOCS = 500  # a patient has a handful of sessions; this is only a safety cap


async def load_med_docs(patient_id: str) -> list:
    cursor = medication_analysis.find(
        {
            "patient_id": patient_id,
            "feature_id": "documentation-medication-analysis",
            "finaloutput.prescriptions.0": {"$exists": True},
        },
        {"doctor_id": 1, "created_at": 1, "finaloutput.prescriptions": 1},
    ).sort("created_at", -1)
    return await cursor.to_list(length=_MAX_DOCS)


async def get_doctor_names(doctor_ids: list) -> dict:
    """{sys_user_id: {"name": ..., "specialization": ...}}"""
    if not doctor_ids:
        return {}
    cursor = doctor_users.find(
        {"sys_user_id": {"$in": list(doctor_ids)}},
        {"sys_user_id": 1, "name": 1, "specialization": 1},
    )
    return {
        d["sys_user_id"]: {"name": d.get("name"), "specialization": d.get("specialization")}
        for d in await cursor.to_list(length=50)
    }


async def load_slot_statuses(patient_id: str, local_date: str) -> dict:
    """{slot_id: latest logged status today}. Later log entries win."""
    cursor = patient_med_log.find(
        {"patient_id": patient_id, "local_date": local_date},
        {"slot_id": 1, "status": 1},
    ).sort("created_at", 1)
    return {d["slot_id"]: d["status"] for d in await cursor.to_list(length=1000) if d.get("slot_id")}


async def load_diagnosis_docs(patient_id: str) -> list:
    cursor = diagnosis_data.find(
        {"patient_id": patient_id, "type": "diagnosis"},
        {"doctor_id": 1, "diagnosis": 1, "updated_at": 1, "created_at": 1},
    ).sort("updated_at", -1)
    return await cursor.to_list(length=200)


async def load_patient_summary(patient_id: str) -> Optional[dict]:
    return await patient_summary.find_one(
        {"patient_id": patient_id},
        {
            "doctor_id": 1,
            "summary.confirmed_diagnoses": 1,
            "summary.diagnosis_header": 1,
            "updated_at": 1,
            "generated_at": 1,
        },
    )


async def load_active_chemo(patient_id: str) -> Optional[dict]:
    """Field is patientId (camelCase) in this collection, unlike everywhere else."""
    return await chemotherapy_records.find_one(
        {"patientId": patient_id, "status": "active"},
        {"data.completion.watchSymptoms": 1, "treatment": 1},
    )


async def load_appointments_doc(patient_id: str, short_patient_id: Optional[str] = None) -> Optional[dict]:
    doc = await patient_appointments.find_one({"sys_user_id": patient_id}, {"appointments": 1})
    if not doc and short_patient_id:
        doc = await patient_appointments.find_one({"patient_id": short_patient_id}, {"appointments": 1})
    return doc


async def load_recent_checkins(patient_id: str, limit: int = 14) -> list:
    """Most recent check-ins (newest first), for weight trend, recent symptom
    answers, and the "yesterday" comparison prompt. Never the private
    sub-object. note_summary/free_text_summary/photo_findings (the
    LLM-condensed versions) are projected for feeding future context — the
    raw note/free_text_answers fields and photo clinical_note originals are
    deliberately NOT projected here, since the patient's original
    wording/imagery should never be re-sent to the LLM.

    "questions" (id/kind/label/urgent snapshot) and "followups" (Q&A on free
    text) ARE projected: build_llm_context needs to know not just the
    symptom VALUES from yesterday but which of them were actually asked and
    whether a follow-up flagged something worsening, so today's questions
    can track progression on the same condition rather than re-picking from
    scratch each day."""
    cursor = patient_checkins.find(
        {"patient_id": patient_id},
        {
            "date": 1, "weight": 1, "symptoms": 1, "comparisons": 1, "red_flag": 1,
            "created_at": 1, "note_summary": 1, "free_text_summary": 1, "photo_findings": 1,
            "questions": 1, "followups": 1,
        },
    ).sort("date", -1)
    return await cursor.to_list(length=limit)


async def load_yesterday_checkin(patient_id: str) -> Optional[dict]:
    """The single most recent check-in (any date strictly before today is
    accepted implicitly since we just take the latest by date). Used to
    build the "yesterday you said X, how is it today" prompt."""
    cursor = patient_checkins.find(
        {"patient_id": patient_id},
        {"date": 1, "symptoms": 1, "questions": 1, "note_summary": 1, "free_text_summary": 1},
    ).sort("date", -1).limit(1)
    rows = await cursor.to_list(length=1)
    return rows[0] if rows else None


async def load_checkin_photos(patient_id: str, client_id: str) -> list:
    """CONFIRMED (patient-reviewed and sent) photos captured during one
    in-progress check-in draft, tagged with the same client_id the eventual
    /me/checkins submission uses. An unreviewed photo (still being edited,
    or abandoned) must never be folded into the check-in or shown to the
    doctor, so this only matches sent=True."""
    cursor = patient_checkin_photos.find(
        {"patient_id": patient_id, "client_id": client_id, "sent": True},
        {"_id": 0, "photo_id": 1, "source": 1, "status": 1, "diagnosis_relevant": 1,
         "clinical_note": 1, "confirmed": 1},
    )
    return await cursor.to_list(length=50)


async def load_patient_profile(patient_id: str) -> Optional[dict]:
    """De-identified only: age (derived by the caller) and gender."""
    return await patient_users.find_one({"sys_user_id": patient_id}, {"date_of_birth": 1, "gender": 1})


async def load_alerts(patient_id: str, limit: int = 50) -> list:
    """Newest first, for the doctor overview panel."""
    cursor = patient_alerts.find(
        {"patient_id": patient_id},
        {"title": 1, "to": 1, "level": 1, "created_at": 1, "acknowledged": 1},
    ).sort("created_at", -1)
    return await cursor.to_list(length=limit)


async def load_med_log_window(patient_id: str, since_local_date: str) -> list:
    """patient_med_log rows with local_date >= since_local_date, for the
    doctor overview's adherence rollup."""
    cursor = patient_med_log.find(
        {"patient_id": patient_id, "local_date": {"$gte": since_local_date}},
        {"status": 1, "local_date": 1},
    )
    return await cursor.to_list(length=5000)


async def get_patient_doctor_ids(patient_id: str) -> set:
    """Doctors = distinct doctor_id across appointments, prescription docs, and
    diagnosis docs (handoff section 6.1.6). Used to validate a check-in's
    doctor_id — anything outside this set is stored as null rather than
    trusted from the client."""
    ids: set = set()

    appt_doc = await patient_appointments.find_one({"sys_user_id": patient_id}, {"appointments.doctor_id": 1})
    for a in (appt_doc or {}).get("appointments") or []:
        if isinstance(a, dict) and a.get("doctor_id"):
            ids.add(a["doctor_id"])

    med_cursor = medication_analysis.find({"patient_id": patient_id}, {"doctor_id": 1})
    async for d in med_cursor:
        if d.get("doctor_id"):
            ids.add(d["doctor_id"])

    diag_cursor = diagnosis_data.find({"patient_id": patient_id}, {"doctor_id": 1})
    async for d in diag_cursor:
        if d.get("doctor_id"):
            ids.add(d["doctor_id"])

    return ids