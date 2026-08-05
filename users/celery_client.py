import os
from celery import Celery

broker_url = os.getenv("CELERY_BROKER_URL")

if not broker_url:
    raise RuntimeError("CELERY_BROKER_URL is not configured")

celery_app = Celery(
    "fastapi_publisher",
    broker=broker_url,
)