import os
from motor.motor_asyncio import AsyncIOMotorClient
from pymongo import MongoClient


# ==================================================
# ENV CONFIG
# ==================================================
MONGO_URI = os.getenv("MONGO_URI")
MONGO_DB = os.getenv("MONGO_DB", "doctorassistai")

if not MONGO_URI:
    raise RuntimeError("❌ MONGO_URI environment variable not set")


# ==================================================
# ASYNC CLIENT (FastAPI)
# ==================================================
async_mongo_client = AsyncIOMotorClient(
    MONGO_URI,
    maxPoolSize=100,
    minPoolSize=10,
)

async_db = async_mongo_client[MONGO_DB]


# ==================================================
# SYNC CLIENT (Celery / background tasks)
# ==================================================
sync_mongo_client = MongoClient(
    MONGO_URI,
    maxPoolSize=100,
    minPoolSize=10,
)

sync_db = sync_mongo_client[MONGO_DB]


# ==================================================
# COLLECTIONS (ASYNC)
# ==================================================
patient_user_collection = async_db["patient_users"]
patient_appointments_collection = async_db["patient_appointments"]
doctor_user_collection = async_db["doctor_users"]
patient_documents_collection = async_db["patient_documents_collection"]


# ==================================================
# COLLECTIONS (SYNC)
# ==================================================
patient_user_collection_sync = sync_db["patient_users"]
patient_appointments_collection_sync = sync_db["patient_appointments"]
doctor_user_collection_sync = sync_db["doctor_users"]
patient_documents_collection_sync = sync_db["patient_documents_collection"]
reportnode_collection_sync = sync_db["report_nodes"]
condition_collection_sync = sync_db["conditions"]
image_reportnode_collection_sync = sync_db["image_report_nodes"]