"""
patient_app/db.py

Async Mongo access (Motor). Collections are split into two groups so the
read-only rule (handoff rule 6) is visible in code:

  READ-ONLY  (owned by the doctor system, never written from here)
  WRITABLE   (owned by patient_app, created on first use)

Indexes are created ONLY on the writable collections. We deliberately do not
touch indexes on the doctor-side collections.

CHANGED: added patient_messages (the unified chat thread: text, photo,
followup, checkin summary cards — see routes.py) and its indexes, and
extended patient_checkin_photos' index list for the new confirm/sent fields.
"""

import logging

from motor.motor_asyncio import AsyncIOMotorClient
from pymongo import ASCENDING, DESCENDING

from .config import MONGO_DB, MONGO_URI

logger = logging.getLogger("patient_app.db")

client = AsyncIOMotorClient(MONGO_URI, serverSelectionTimeoutMS=5000)
db = client[MONGO_DB]

# ---------------- READ-ONLY (doctor system) ----------------
user_auth = db["user_auth"]
patient_users = db["patient_users"]
doctor_users = db["doctor_users"]
patient_appointments = db["patient_appointments"]
medication_analysis = db["documentation-medication-analysis"]
diagnosis_data = db["diagnosis_data"]
patient_summary = db["patient_summary"]
chemotherapy_records = db["chemotherapy_records"]
patient_vitals = db["patient_vitals"]

# ---------------- WRITABLE (patient_app only) ----------------
patient_checkins = db["patient_checkins"]
patient_med_log = db["patient_med_log"]
patient_alerts = db["patient_alerts"]
patient_consent = db["patient_consent"]
patient_checkin_config = db["patient_checkin_config"]
patient_checkin_photos = db["patient_checkin_photos"]
patient_messages = db["patient_messages"]  # unified chat thread (text/photo/followup/checkin)


async def ensure_indexes() -> None:
    """Idempotent. Failures are logged, not raised, so the service still starts
    if Mongo is briefly unreachable (requests will return 503 until it is back)."""
    specs = [
        (patient_checkins, [("patient_id", ASCENDING), ("client_id", ASCENDING)], {"unique": True}),
        (patient_checkins, [("patient_id", ASCENDING), ("date", DESCENDING)], {}),
        (patient_med_log, [("patient_id", ASCENDING), ("client_id", ASCENDING)], {"unique": True}),
        (patient_med_log, [("patient_id", ASCENDING), ("local_date", ASCENDING), ("slot_id", ASCENDING)], {}),
        (patient_alerts, [("patient_id", ASCENDING), ("created_at", DESCENDING)], {}),
        (patient_alerts, [("patient_id", ASCENDING), ("acknowledged", ASCENDING)], {}),
        (patient_consent, [("patient_id", ASCENDING)], {"unique": True}),
        (patient_checkin_config, [("patient_id", ASCENDING), ("lang", ASCENDING)], {"unique": True}),
        (patient_checkin_photos, [("photo_id", ASCENDING)], {"unique": True}),
        (patient_checkin_photos, [("patient_id", ASCENDING), ("client_id", ASCENDING)], {}),
        (patient_checkin_photos, [("patient_id", ASCENDING), ("sent", ASCENDING)], {}),
        # Chat thread: client_id is the idempotency key for patient-authored rows
        # (text/photo/followup/checkin). Doctor-authored rows never carry a
        # client_id, so the unique index is partial — otherwise every doctor
        # message (client_id absent) would collide against the first one.
        (patient_messages, [("patient_id", ASCENDING), ("client_id", ASCENDING)],
         {"unique": True, "partialFilterExpression": {"client_id": {"$exists": True}}}),
        (patient_messages, [("patient_id", ASCENDING), ("created_at", DESCENDING)], {}),
        (patient_messages, [("patient_id", ASCENDING), ("from", ASCENDING), ("created_at", DESCENDING)], {}),
    ]
    for coll, keys, opts in specs:
        try:
            await coll.create_index(keys, **opts)
        except Exception:
            logger.exception("index creation failed on %s", coll.name)
    logger.info("patient_app indexes ensured")