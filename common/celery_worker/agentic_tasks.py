import os
import httpx
import logging



# 🔥 IMPORTANT — use EXISTING celery_app
from .celery_app import celery_app

logger = logging.getLogger(__name__)
# --------------------------------------------------
# ENV CONFIG
# --------------------------------------------------
API_BASE_URL = os.getenv("VITE_BACKEND_URL")

if not API_BASE_URL:
    logger.warning("⚠️ API_BASE_URL not set — agentic task may fail")


# --------------------------------------------------
# CELERY TASK
# --------------------------------------------------
@celery_app.task(
    bind=True,
    name="agentic.trigger_clinical_reasoning",
    autoretry_for=(Exception,),
    retry_backoff=True,        # exponential retry
    retry_kwargs={"max_retries": 3},
    acks_late=True             # safer for long LLM jobs
)
def trigger_clinical_reasoning(
    self,
    patient_id: str,
    doctor_id: str,
    data: dict
):
    """
    🔥 Background Agentic Clinical Reasoning Trigger

    Called from:
        save_patient_vitals endpoint

    Flow:
        Celery Worker
            → Calls Agentic API
            → Runs LangGraph workflow
            → Returns reasoning output
    """

    try:
        logger.info(
            f"🚀 [CELERY] Agentic reasoning started | patient={patient_id} | doctor={doctor_id}"
        )

        # --------------------------------------------------
        # BUILD PAYLOAD FOR AGENTIC ENDPOINT
        # --------------------------------------------------
        payload = {
            "patient_id": patient_id,
            "doctor_id": doctor_id,

            # ⚡ You can later improve this to structured context
            "consultation_text": f"current payload: {data}"
        }

        logger.debug(f"📦 Agentic Payload: {payload}")

        # --------------------------------------------------
        # CALL AGENTIC ENDPOINT
        # --------------------------------------------------
        url = f"{API_BASE_URL}hms/users/ai-legacy/clinical-reasoning"

        with httpx.Client(timeout=120.0) as client:
            response = client.post(url, json=payload)

        logger.info(
            f"📡 Agentic API Response | status={response.status_code}"
        )

        # --------------------------------------------------
        # HANDLE FAILURE
        # --------------------------------------------------
        if response.status_code != 200:
            logger.error(
                f"❌ Agentic API Failed | status={response.status_code} | body={response.text}"
            )
            raise Exception(response.text)

        result = response.json()

        logger.info(
            f"✅ Agentic reasoning completed | patient={patient_id}"
        )

        return result

    except Exception as e:
        logger.error(
            f"❌ Agentic Celery Task Error | patient={patient_id} | error={str(e)}"
        )

        # retry handled automatically via autoretry_for
        raise e