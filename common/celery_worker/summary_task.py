from common.celery_worker.celery_app import celery_app
import httpx
from datetime import datetime
from pymongo import MongoClient
import os

# ============================================================
# CONFIG
# ============================================================

MONGO_URI = os.getenv("MONGO_URI")
MONGO_DB = os.getenv("MONGO_DB", "doctorassistai")

mongo_client = MongoClient(MONGO_URI)
mongo_db = mongo_client[MONGO_DB]

processing_tracker = mongo_db["summary_tracker"]
doctor_collection = mongo_db["doctor_users"]

AGENTIC_URL = os.getenv("VITE_BACKEND_URL")


# ============================================================
# HELPER: FETCH SPECIALTY
# ============================================================

def get_specialty_by_sys_user_id(sys_user_id: str) -> str:
    """
    Fetch doctor's specialty using sys_user_id.
    """

    doctor = doctor_collection.find_one(
        {"sys_user_id": sys_user_id},
        {"specialization": 1, "_id": 0}
    )

    if not doctor:
        return None

    return doctor.get("specialization")


# ============================================================
# CELERY TASK
# ============================================================

@celery_app.task(
    name="legacy_lab_ai.generate_patient_summary",
    bind=True,
    autoretry_for=(Exception,),
    retry_backoff=5,
    retry_kwargs={"max_retries": 3},
)
def generate_patient_summary(self, patient_id, doctor_id):

    try:
        # ====================================================
        # STEP 1: MARK PROCESSING
        # ====================================================
        processing_tracker.update_one(
            {
                "patient_id": patient_id,
                "doctor_id": doctor_id
            },
            {
                "$set": {
                    "status": "processing",
                    "started_at": datetime.utcnow()
                }
            },
            upsert=True
        )

        # ====================================================
        # STEP 2: FETCH SPECIALTY (CRITICAL FIX)
        # ====================================================
        specialty = get_specialty_by_sys_user_id(doctor_id)
        
        if not specialty:
            # fallback to avoid pipeline failure
            specialty = "general_medicine"

        # ====================================================
        # STEP 3: CALL AGENTIC SERVICE
        # ====================================================
        response = httpx.post(
            f"{AGENTIC_URL}hms/users/ai-legacy/internal/run-reasoning",
            json={
                "patient_id": patient_id,
                "doctor_id": doctor_id,
                "consultation_text": "",
                "specialty": specialty,   # ✅ CRITICAL ADD
                "include_intermediates": False
            },
            timeout=3000
        )

        response.raise_for_status()

        # ====================================================
        # STEP 4: MARK COMPLETED
        # ====================================================
        processing_tracker.update_one(
            {
                "patient_id": patient_id,
                "doctor_id": doctor_id
            },
            {
                "$set": {
                    "status": "completed",
                    "completed_at": datetime.utcnow(),
                    "specialty_used": specialty   # optional (debugging)
                }
            }
        )

        return {
            "status": "completed",
            "specialty": specialty
        }

    except Exception as e:

        # ====================================================
        # STEP 5: MARK FAILED
        # ====================================================
        processing_tracker.update_one(
            {
                "patient_id": patient_id,
                "doctor_id": doctor_id
            },
            {
                "$set": {
                    "status": "failed",
                    "error": str(e),
                    "failed_at": datetime.utcnow()
                }
            }
        )

        raise e