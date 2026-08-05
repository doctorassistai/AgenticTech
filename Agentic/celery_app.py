from celery import Celery

celery_app = Celery(
    "agentic_worker",
    broker=os.getenv("RABBITMQ_LEGACY_URL"),
    backend="rpc://"
)