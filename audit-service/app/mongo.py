import os
from pymongo import MongoClient

client = MongoClient(os.getenv("MONGO_URI"))
db = client["audits"]
collection = db["audit_logs"]
