"""
MongoDB index setup for insurance_analysis collection.
Call ensure_analysis_indexes() from your lifespan startup.
"""
from motor.motor_asyncio import AsyncIOMotorClient
import os

MONGO_URI = os.getenv("MONGO_URI")
motor_client = AsyncIOMotorClient(MONGO_URI)
db = motor_client["doctorassistai"]
analysis_col = db["insurance_analysis"]

async def ensure_analysis_indexes():
    await analysis_col.create_index("case_id")
    await analysis_col.create_index([("generated_at", -1)])
    await analysis_col.create_index([("case_id", 1), ("generated_at", -1)])