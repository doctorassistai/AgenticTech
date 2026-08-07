import os
from celery import Celery
from celery.schedules import crontab
from kombu import Exchange, Queue

# ==================================================
# BROKER URL — same broker/vhost as common/celery_worker/celery_app.py.
# This is a SEPARATE Celery app instance living inside the insurance image;
# it cannot share the Python object common's workers use, since that's a
# different container/process entirely. Same broker connection, own queue.
# ==================================================
broker_url = os.getenv(
    "CELERY_BROKER_URL",
    "amqp://legacy_ai_user:strongpassword@rabbitmq:5672/legacy_pdf_ai"
)

# ==================================================
# CELERY APP
# ==================================================
celery_app = Celery(
    "insurance_advanced_upload",
    broker=broker_url,
    backend=None,
)

# ==================================================
# EXCHANGE / QUEUE
# ==================================================
advanced_upload_exchange = Exchange("advanced_upload", type="direct")

celery_app.conf.task_queues = (
    Queue(
        "advanced_upload_queue",
        advanced_upload_exchange,
        routing_key="advanced_upload",
    ),
)

# ==================================================
# TASK ROUTING
# ==================================================
celery_app.conf.task_routes = {
    "advanced_upload.process_document": {
        "queue": "advanced_upload_queue",
        "exchange": "advanced_upload",
        "routing_key": "advanced_upload",
    },
}

# ==================================================
# CELERY CONFIG — matches common/celery_worker/celery_app.py conventions
# ==================================================
celery_app.conf.update(
    task_serializer="json",
    accept_content=["json"],
    result_serializer="json",
    timezone="UTC",
    enable_utc=True,
    task_track_started=True,

    task_default_queue="advanced_upload_queue",

    # Never lose a task if the worker crashes mid-run
    task_acks_late=True,
    task_reject_on_worker_lost=True,

    # Don't grab more tasks than the worker can run right now
    worker_prefetch_multiplier=1,

    broker_pool_limit=None,
    broker_heartbeat=60,
    worker_heartbeat=60,
    broker_connection_retry_on_startup=True,

    beat_schedule={
        "reset-llama-credits-monthly": {
            "task": "llama_credits.reset",
            "schedule": crontab(hour=0, minute=5, day_of_month=15),
        },
    },
)

# ==================================================
# TASK DISCOVERY / REGISTRATION
# ==================================================
# NOTE: this assumes `celery_worker` resolves as a top-level package inside
# the insurance container (same as `routes` does for case_documents_router.py
# imports there). If your insurance/Dockerfile instead preserves the repo
# root (like common's does, giving "common.celery_worker..."), change this
# to autodiscover_tasks(["insurance.celery_worker"]) and update the -A path
# in docker-compose to match.
celery_app.autodiscover_tasks(["celery_worker"])

from . import advanced_upload_task  # noqa