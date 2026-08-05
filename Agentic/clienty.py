from celery import Celery
from kombu import Exchange, Queue

import os

# ============================================================
# CELERY CLIENT
# ============================================================

celery_app = Celery(

    "agentic_client",

    broker=os.getenv(
        "CELERY_BROKER_URL",
    )
)

# ============================================================
# EXCHANGE
# ============================================================

agent_pdf_exchange = Exchange(

    "agent_pdf",

    type="direct"
)

# ============================================================
# QUEUE
# ============================================================

agent_pdf_queue = Queue(

    "agent_pdf_queue",

    exchange=agent_pdf_exchange,

    routing_key="agent_pdf"
)

# ============================================================
# SEND PDF PIPELINE TASK
# ============================================================

def send_agent_pdf_task(

    doctor_id,
    file_url,
    filename,
    guideline_source="other",
    version="",
):

    return celery_app.send_task(

        "agentic.run_pipeline",

        kwargs={

            "doctor_id": doctor_id,

            "file_url": file_url,

            "filename": filename,

            "guideline_source": guideline_source,

            "version": version,
        },

        exchange=agent_pdf_exchange,

        routing_key="agent_pdf",

        queue=agent_pdf_queue,
    )

# ============================================================
# SEND URL PIPELINE TASK
# ============================================================

def send_agent_pdf_urls_task(

    doctor_id,
    urls,
    guideline_source="other",
    version="",
):

    return celery_app.send_task(

        "agentic.run_pipeline_urls",

        kwargs={

            "doctor_id": doctor_id,

            "urls": urls,

            "guideline_source": guideline_source,

            "version": version,
        },

        exchange=agent_pdf_exchange,

        routing_key="agent_pdf",

        queue=agent_pdf_queue,
    )