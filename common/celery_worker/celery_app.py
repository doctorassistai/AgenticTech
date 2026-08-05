import os
from celery import Celery
from kombu import Exchange, Queue

# ==================================================
# BROKER URL
# ==================================================
broker_url = os.getenv("CELERY_BROKER_URL")

# ==================================================
# CELERY APP
# ==================================================
celery_app = Celery(
    "legacy_pdf_ai",
    broker=broker_url,
    backend=None,
)

# ==================================================
# EXCHANGES
# ==================================================
legacy_exchange  = Exchange("legacy",  type="direct")
agentic_exchange = Exchange("agentic", type="direct")
summary_exchange = Exchange("summary", type="direct")
agent_pdf_exchange = Exchange( "agent_pdf", type="direct" )
handwritten_exchange = Exchange("handwritten", type="direct")
mobile_parse_exchange = Exchange("mobile_parse", type="direct")


# ==================================================
# QUEUES
# ==================================================

celery_app.conf.task_queues = (

    Queue(
        "legacy_queue",
        legacy_exchange,
        routing_key="legacy"
    ),

    Queue(
        "agentic_queue",
        agentic_exchange,
        routing_key="agentic"
    ),

    Queue(
        "summary_queue",
        summary_exchange,
        routing_key="summary"
    ),
    
    
    Queue(
        "handwritten_queue", 
        handwritten_exchange, 
        routing_key="handwritten"
    ),
     Queue(
        "mobile_parse_queue",
        mobile_parse_exchange,
        routing_key="mobile_parse"
    ),

    


    # ==================================================
    # PDF PIPELINE QUEUE
    # ==================================================

    Queue(
        "agent_pdf_queue",
        agent_pdf_exchange,
        routing_key="agent_pdf"
    ),
)



# ==================================================
# TASK ROUTING
# ==================================================
celery_app.conf.task_routes = {
    "legacy_lab_ai.process_document": {
        "queue": "legacy_queue",
        "exchange": "legacy",
        "routing_key": "legacy",
    },
    "runpod_analysis_task": {
        "queue": "legacy_queue",
        "exchange": "legacy",
        "routing_key": "legacy",
    },
    "agentic.trigger_clinical_reasoning": {
        "queue": "agentic_queue",
        "exchange": "agentic",
        "routing_key": "agentic",
    },
    "legacy_lab_ai.generate_patient_summary": {
        "queue": "summary_queue",
        "exchange": "summary",
        "routing_key": "summary",
    },
    "legacy_lab_ai.process_mongo_batch": {
        "queue": "agentic_queue",   # 👈 important
        "exchange": "agentic",
        "routing_key": "agentic",
    },
    "agentic.run_pipeline": { 
        "queue": "agent_pdf_queue", 
        "exchange": "agent_pdf", 
        "routing_key": "agent_pdf",
    },
    "agentic.phase1_pipeline": {
        "queue":       "phase1_queue",
        "exchange":    "phase1",
        "routing_key": "phase1",
    },
    "handwritten.process_handwritten_document": {
        "queue": "handwritten_queue",
        "exchange": "handwritten",
        "routing_key": "handwritten",
    },
    "mobile_parse.parse_document": {
        "queue": "mobile_parse_queue",
        "exchange": "mobile_parse",
        "routing_key": "mobile_parse",
    },
#     "timeline.build_visit_timeline_task": {
#     "queue": "handwritten_queue",
#     "exchange": "handwritten",
#     "routing_key": "handwritten",
# },
}

# ==================================================
# CELERY CONFIG
# ==================================================
celery_app.conf.update(
    task_serializer="json",
    accept_content=["json"],
    result_serializer="json",
    timezone="UTC",
    enable_utc=True,
    task_track_started=True,

    # ✅ Default queue for any unrouted tasks
    task_default_queue="legacy_queue",

    # ✅ Never lose a task if worker crashes mid-execution
    task_acks_late=True,
    task_reject_on_worker_lost=True,

    # ✅ Don't grab more tasks than worker can run right now
    worker_prefetch_multiplier=1,

    # connection stability
    broker_pool_limit=None,
    broker_heartbeat=60,
    worker_heartbeat=60,
    broker_connection_retry_on_startup=True,
)

# ==================================================
# TASK DISCOVERY
# ==================================================
celery_app.autodiscover_tasks(
    ["common.celery_worker"]
)

# ==================================================
# FORCE TASK REGISTRATION (SAFE IMPORTS)
# ==================================================
from . import process_document
  # noqa
from . import runpod_task        # noqa
from . import agentic_tasks      # noqa
from . import summary_task  
from . import mongo_task# noqa
from . import agent_pdf_task
from . import handwritten_task
from . import phase1_task
from . import mobile_parse_task  # noqa
# from . import build_visit_timeline_task
 # noqa