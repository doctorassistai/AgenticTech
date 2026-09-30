"""
celery_worker/agentic_celery_app.py

Separate Celery app instance for the agentic investigation pipeline
(page-level document classification + PED agent + Billing reconciliation
agent).

Kept as its OWN Celery app — same pattern celery_app.py itself already
uses, whose own docstring explains why: a distinct pipeline gets a
distinct app/queue so it can be deployed, scaled, and reasoned about
independently, without touching the existing advanced_upload / findings
queue or its task registration.

Nothing in this file is imported by, or imports from, celery_app.py.
Wiring a worker process to actually consume this queue (a new
`celery -A ... worker -Q agentic_investigation_queue` process, or an
entry in an existing supervisor/compose config) is a deployment step —
see the bottom of this file for the exact command.
"""

from __future__ import annotations

import os
from celery import Celery
from kombu import Exchange, Queue

# ==================================================
# BROKER URL — same broker/vhost as the rest of the insurance image.
# ==================================================
broker_url = os.getenv(
    "CELERY_BROKER_URL",
    "amqp://legacy_ai_user:strongpassword@rabbitmq:5672/legacy_pdf_ai"
)

# ==================================================
# CELERY APP
# ==================================================
agentic_celery_app = Celery(
    "insurance_agentic_investigation",
    broker=broker_url,
    backend=None,
)

# ==================================================
# EXCHANGE / QUEUE
# ==================================================
agentic_investigation_exchange = Exchange("agentic_investigation", type="direct")

agentic_celery_app.conf.task_queues = (
    Queue(
        "agentic_investigation_queue",
        agentic_investigation_exchange,
        routing_key="agentic_investigation",
    ),
)

# ==================================================
# TASK ROUTING
# ==================================================
agentic_celery_app.conf.task_routes = {
    "agentic_investigation.run": {
        "queue": "agentic_investigation_queue",
        "exchange": "agentic_investigation",
        "routing_key": "agentic_investigation",
    },
}

# ==================================================
# CELERY CONFIG — matches celery_app.py's conventions
# ==================================================
agentic_celery_app.conf.update(
    task_serializer="json",
    accept_content=["json"],
    result_serializer="json",
    timezone="UTC",
    enable_utc=True,
    task_track_started=True,

    task_default_queue="agentic_investigation_queue",

    task_acks_late=True,
    task_reject_on_worker_lost=True,

    worker_prefetch_multiplier=1,

    broker_pool_limit=None,
    broker_heartbeat=60,
    worker_heartbeat=60,
    broker_connection_retry_on_startup=True,
)

# ==================================================
# TASK DISCOVERY / REGISTRATION
# ==================================================
from . import agentic_investigation_task  # noqa

# ==================================================
# HOW TO RUN A WORKER FOR THIS APP (deployment note, not code):
#
#   celery -A celery_worker.agentic_celery_app.agentic_celery_app \
#       worker -Q agentic_investigation_queue --loglevel=info
#
# Add this as its own process (new docker-compose service, or an extra
# supervisord program) alongside whatever already runs celery_app.py's
# worker — the two are independent apps sharing only the broker.
# ==================================================