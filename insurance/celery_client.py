import os
from celery import Celery

# Producer-only — no backend, no task_routes. Matches integration/celery_client.py.
# Must pass queue= explicitly on send_task since this instance never loads
# common.celery_worker.celery_app's routing config.
celery_client = Celery(
    "insurance_publisher",
    broker=os.getenv(
        "CELERY_BROKER_URL",
        "amqp://legacy_ai_user:strongpassword@rabbitmq:5672/legacy_pdf_ai"
    ),
)
