"""
patient_app/services/doctor_overview.py

Doctor-facing rollup for one patient: medicines, recent check-ins, alerts,
food log, and an adherence summary. Pure aggregation over data that
medications.py / care_data.py / checkin.py already produce or store —
nothing new is computed clinically here, this only assembles and shapes it
for the doctor's PatientApp panel.

Privacy boundary carried over from the patient side: weekly.private
(phq/distress) is never included here, matching load_recent_checkins'
existing comment that those fields are patient-private. A doctor sees
everything else a patient submitted, including symptoms, notes, and
red flags.
"""

from __future__ import annotations

from datetime import datetime, timedelta
from typing import Any, Optional


def _checkin_view(doc: dict) -> dict:
    """Strips weekly.private if present; keeps everything else as stored."""
    weekly = doc.get("weekly")
    if isinstance(weekly, dict) and "private" in weekly:
        weekly = {k: v for k, v in weekly.items() if k != "private"}
    return {
        "date": doc.get("date"),
        "weight": doc.get("weight"),
        "red_flag": doc.get("red_flag"),
        "symptoms": doc.get("symptoms"),
        "comparisons": doc.get("comparisons"),
        "body_sites": doc.get("body_sites"),
        "note": doc.get("note"),
        "free_text_answers": doc.get("free_text_answers"),
        "follow_up": doc.get("follow_up"),
        "food_items": doc.get("food_items"),
        "weekly": weekly,
        "photo_findings": doc.get("photo_findings"),
        "created_at": doc.get("created_at"),
    }


def build_adherence(med_log_rows: list, checkin_dates: list, days: int, today) -> dict:
    """med_log_rows: raw patient_med_log docs over the window.
    checkin_dates: the 'date' field (YYYY-MM-DD strings) of check-ins in the window."""
    counts = {"taken": 0, "late": 0, "early": 0, "skipped": 0, "together": 0}
    for row in med_log_rows:
        status = row.get("status")
        if status in counts:
            counts[status] += 1

    unique_checkin_days = len({d for d in checkin_dates if d})
    return {
        "window_days": days,
        "medication_log": counts,
        "checkin_days": unique_checkin_days,
        "checkin_days_possible": days,
    }


def build_overview(
    *,
    medications_payload: dict,
    checkin_docs: list,
    alert_docs: list,
    med_log_rows: list,
    days: int,
    today,
) -> dict:
    checkins = [_checkin_view(c) for c in checkin_docs]
    checkin_dates = [c.get("date") for c in checkin_docs]

    alerts = [
        {
            "id": str(a.get("_id")),
            "title": a.get("title"),
            "to": a.get("to"),
            "level": a.get("level"),
            "created_at": a.get("created_at"),
            "acknowledged": bool(a.get("acknowledged", False)),
        }
        for a in alert_docs
    ]

    food_log = [
        {"date": c.get("date"), "items": c.get("food_items")}
        for c in checkin_docs
        if c.get("food_items")
    ]

    return {
        "status": "success",
        "medications": medications_payload,
        "checkins": checkins,
        "alerts": alerts,
        "food_log": food_log,
        "adherence": build_adherence(med_log_rows, checkin_dates, days, today),
    }