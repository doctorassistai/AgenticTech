from fastapi import APIRouter, HTTPException
from pymongo import MongoClient
from bson import ObjectId
from passlib.context import CryptContext
import random, string, os

router = APIRouter(prefix="/api/hms/users", tags=["Users"])

MONGO_URI = os.getenv("MONGO_URI")
client = MongoClient(MONGO_URI)
db = client["doctorassistai"]

pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")

# 🔹 GET FIELD OFFICERS
@router.get("/field-officers")
def get_field_officers():
    users = list(db.user_auth.find({"role": "field-officer"}))

    for u in users:
        u["_id"] = str(u["_id"])

    return {"data": users}


# 🔹 RESET PASSWORD
def generate_password():
    return "FO@" + ''.join(random.choices(string.ascii_uppercase + string.digits, k=6))

@router.post("/reset-password")
def reset_password(data: dict):

    user_id = data.get("user_id")

    if not user_id:
        raise HTTPException(400, "user_id required")

    new_password = generate_password()
    hashed = pwd_context.hash(new_password)

    result = db.user_auth.update_one(
        {"_id": ObjectId(user_id)},
        {"$set": {"password": hashed}}
    )

    if result.matched_count == 0:
        raise HTTPException(404, "User not found")

    return {
        "message": "Password reset successful",
        "new_password": new_password
    }
print("USERS ROUTES FILE LOADED")

# 🔹 GET AUDITING DOCTORS
@router.get("/doctors")
def get_doctors():
    users = list(db.user_auth.find({"role": "auditing-doctor-new"}))

    for u in users:
        u["_id"] = str(u["_id"])
        u.pop("password", None)  # never send hashed password to frontend

    return {"data": users}