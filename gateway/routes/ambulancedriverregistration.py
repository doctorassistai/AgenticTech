# ambulance_routes.py
from fastapi import APIRouter, HTTPException, Request, status, Query, Form, File, UploadFile
from fastapi import WebSocket, WebSocketDisconnect
from typing import Dict
from fastapi.responses import JSONResponse, FileResponse 
from pydantic import BaseModel, Field
from typing import Optional, Dict, Any, List
from datetime import datetime, timedelta, timezone
import os
import shutil
import uuid
import logging
from bson import ObjectId
import re
import httpx  # Add this import
from passlib.context import CryptContext
from motor.motor_asyncio import AsyncIOMotorClient
from jose import jwt
import json
import tempfile
import httpx

EXPO_PUSH_URL = "https://exp.host/--/api/v2/push/send"

async def send_expo_push(push_token: str, title: str, body: str, data: dict, channel_id: str = "default"):
    if not push_token:
        return
    payload = {
        "to": push_token,
        "sound": "default",
        "title": title,
        "body": body,
        "data": data,
        "priority": "high",
        "channelId": channel_id,
    }
    try:
        async with httpx.AsyncClient(timeout=10) as client:
            resp = await client.post(EXPO_PUSH_URL, json=payload)
            logger.info(f"Expo push response: {resp.status_code} {resp.text}")
    except Exception as e:
        logger.error(f"send_expo_push error: {e}")

class DriverConnectionManager:
    def __init__(self):
        self.active_connections: Dict[str, set] = {}

    async def connect(self, driver_id: str, websocket: WebSocket):
        await websocket.accept()
        self.active_connections.setdefault(driver_id, set()).add(websocket)
        logger.info(f"Driver {driver_id} connected via WebSocket ({len(self.active_connections[driver_id])} active)")

    def disconnect(self, driver_id: str, websocket: WebSocket = None):
        if driver_id in self.active_connections:
            if websocket is not None:
                self.active_connections[driver_id].discard(websocket)
            else:
                self.active_connections[driver_id].clear()
            if not self.active_connections[driver_id]:
                del self.active_connections[driver_id]
            logger.info(f"Driver {driver_id} disconnected")

    async def send_to_driver(self, driver_id: str, message: dict):
        conns = self.active_connections.get(driver_id)
        if not conns:
            return
        dead = []
        for ws in list(conns):
            try:
                await ws.send_json(message)
                logger.info(f"Message sent to driver {driver_id}")
            except Exception as e:
                logger.error(f"Failed to send to driver {driver_id}: {e}")
                dead.append(ws)
        for ws in dead:
            self.disconnect(driver_id, ws)

driver_manager = DriverConnectionManager()

router = APIRouter(
    prefix="/hms/users/ambulance",
    tags=["ambulance"],
)

async def send_push_notification(push_token: str, title: str, body: str, data: dict = None):
    """Send an Expo push notification. Safe no-op if token missing/invalid."""
    if not push_token or not push_token.startswith("ExponentPushToken"):
        return
    try:
        async with httpx.AsyncClient(timeout=10) as client:
            resp = await client.post(
                "https://exp.host/--/api/v2/push/send",
                json={
                    "to": push_token,
                    "title": title,
                    "body": body,
                    "sound": "default",
                    "priority": "high",
                    "channelId": "dispatch-alerts",
                    "data": data or {},
                },
                headers={"Content-Type": "application/json", "Accept": "application/json"},
            )
            logger.info(f"Push notification sent, status={resp.status_code}, response={resp.text}")
    except Exception as e:
        logger.error(f"Push send failed: {e}")

logger = logging.getLogger(__name__)

# Database connection
MONGO_URI = os.getenv("MONGO_URI", "mongodb://localhost:27017")
MONGO_DB = "doctorassistai"

logger.info(f"Initializing database connection with MONGO_URI: {MONGO_URI}")
logger.info(f"Using database: {MONGO_DB}")

mongodb_client = AsyncIOMotorClient(MONGO_URI)
database = mongodb_client[MONGO_DB]

#21-04-2026
ambulance_collection = database["ambulance_collection"]
ambulancedrivers_collection = database["ambulancedrivers_collection"]
# Shared token file path (same as customer_care.py)
ZENZO_TOKEN_FILE = os.path.join(tempfile.gettempdir(), "zenzo_token.json")

def get_shared_zenzo_token():
    """Get ZENZO token and organization ID from shared file"""
    try:
        from datetime import datetime
        import tempfile
        
        ZENZO_TOKEN_FILE = os.path.join(tempfile.gettempdir(), "zenzo_token.json")
        
        logger.info(f"🔍 Looking for token file at: {ZENZO_TOKEN_FILE}")
        
        if os.path.exists(ZENZO_TOKEN_FILE):
            with open(ZENZO_TOKEN_FILE, 'r') as f:
                data = json.load(f)
                token = data.get("token")
                organization_id = data.get("organization_id")
                expires_at = data.get("expires_at")
                
                if expires_at:
                    expires_at_dt = datetime.fromisoformat(expires_at)
                    if datetime.now() < expires_at_dt:
                        logger.info(f"✅ Using valid ZENZO token")
                        return token, organization_id
                    else:
                        logger.info("⚠️ Token has expired")
                else:
                    logger.info("✅ Using ZENZO token (no expiry)")
                    return token, organization_id
        else:
            logger.info("❌ Token file not found")
    except Exception as e:
        logger.error(f"Failed to read token: {e}")
    return None, None
from fastapi import HTTPException, status, Request
from datetime import datetime, timedelta
from typing import Optional
import jwt
from pydantic import BaseModel

# JWT Configuration
SECRET_KEY = "your-secret-key-change-this-in-production"  # Change this to a secure key
ALGORITHM = "HS256"
ACCESS_TOKEN_EXPIRE_MINUTES = 30

class AmbulanceDriverLogin(BaseModel):
    username: str
    password: str

def create_access_token(data: dict, expires_delta: Optional[timedelta] = None):
    to_encode = data.copy()
    if expires_delta:
        expire = datetime.utcnow() + expires_delta
    else:
        expire = datetime.utcnow() + timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES)
    to_encode.update({"exp": expire})
    encoded_jwt = jwt.encode(to_encode, SECRET_KEY, algorithm=ALGORITHM)
    return encoded_jwt

@router.post("/ambulance/driver/login")
async def driver_login(login_data: AmbulanceDriverLogin):
    """
    Login endpoint for drivers registered via CustomerDashboard.
    Checks only the ambulancedrivers_collection.
    """
    try:
        username = login_data.username
        password = login_data.password
        
        # Get the ambulance drivers collection
        ambulancedrivers_collection = database["ambulancedrivers_collection"]
        
        # Find driver by username
        driver = await ambulancedrivers_collection.find_one({"username": username})
        
        if not driver:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Invalid username or password"
            )
        
        # Verify password
        stored_password = driver.get("password")
        if stored_password != password:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Invalid username or password"
            )
        
        # Check if driver is active
        if driver.get("status") != "active":
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Account is not active. Please contact administrator."
            )
        
        # Prepare user data
        user_data = {
            "username": driver.get("username"),
            "role": "ambulance_driver",
            "driver_name": driver.get("fullName") or driver.get("driver_name"),
            "driver_id": driver.get("driverId") or driver.get("driver_id"),
            "phone_number": driver.get("phoneNumber"),
            "vehicle_id": driver.get("assignedVehicleId"),
            "status": driver.get("status")
        }
        
        # Create access token
        access_token = create_access_token(
            data={
                "sub": username, 
                "role": "ambulance_driver", 
                "driver_id": user_data["driver_id"],
                "driver_name": user_data["driver_name"]
            }
        )
        
        # Update last login time and online status
        await ambulancedrivers_collection.update_one(
            {"username": username},
            {
                "$set": {
                    "last_login": datetime.utcnow(), 
                    "is_online": True,
                    "updated_at": datetime.utcnow()
                }
            }
        )
        
        return {
            "status": "success",
            "message": "Login successful",
            "access_token": access_token,
            "token_type": "bearer",
            "user_data": user_data
        }
        
    except HTTPException:
        raise
    except Exception as e:
        print(f"Driver login error: {str(e)}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Internal server error: {str(e)}"
        )


@router.post("/ambulance/driver/logout")
async def driver_logout(request: Request):
    """
    Logout endpoint - updates driver status to offline
    """
    try:
        # Get token from Authorization header
        auth_header = request.headers.get("Authorization")
        if not auth_header or not auth_header.startswith("Bearer "):
            raise HTTPException(status_code=401, detail="Not authenticated")
        
        token = auth_header.replace("Bearer ", "")
        
        # Decode token to get username
        try:
            payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
            username = payload.get("sub")
        except jwt.PyJWTError:
            raise HTTPException(status_code=401, detail="Invalid token")
        
        if username:
            # Update driver status in ambulancedrivers_collection
            ambulancedrivers_collection = database["ambulancedrivers_collection"]
            
            await ambulancedrivers_collection.update_one(
                {"username": username},
                {
                    "$set": {
                        "is_online": False, 
                        "assignedVehicleId": None,
                        "assignedAmbulanceVehicleNumber": None,
                        "last_logout": datetime.utcnow(),
                        "updated_at": datetime.utcnow()
                    }
                }
            )
        
        return {"status": "success", "message": "Logged out successfully"}
        
    except HTTPException:
        raise
    except Exception as e:
        print(f"Logout error: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Internal server error: {str(e)}")


@router.get("/ambulance/driver/status/{username}")
async def get_driver_status(username: str):
    """
    Get driver online status
    """
    try:
        ambulancedrivers_collection = database["ambulancedrivers_collection"]
        
        driver = await ambulancedrivers_collection.find_one(
            {"username": username},
            {"is_online": 1, "last_login": 1, "last_logout": 1, "status": 1}
        )
        
        if not driver:
            raise HTTPException(status_code=404, detail="Driver not found")
        
        return {
            "status": "success",
            "data": {
                "username": username,
                "is_online": driver.get("is_online", False),
                "last_login": driver.get("last_login"),
                "last_logout": driver.get("last_logout"),
                "account_status": driver.get("status", "active")
            }
        }
        
    except HTTPException:
        raise
    except Exception as e:
        print(f"Get driver status error: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Internal server error: {str(e)}")


@router.post("/ambulance/driver/update-location")
async def update_driver_location(request: Request):
    """
    Update driver's current location
    """
    try:
        # Get token from Authorization header
        auth_header = request.headers.get("Authorization")
        if not auth_header or not auth_header.startswith("Bearer "):
            raise HTTPException(status_code=401, detail="Not authenticated")
        
        token = auth_header.replace("Bearer ", "")
        
        # Decode token to get username
        try:
            payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
            username = payload.get("sub")
        except jwt.PyJWTError:
            raise HTTPException(status_code=401, detail="Invalid token")
        
        # Get location data from request body
        body = await request.json()
        latitude = body.get("latitude")
        longitude = body.get("longitude")
        
        if latitude is None or longitude is None:
            raise HTTPException(status_code=400, detail="Latitude and longitude are required")
        
        # Update location in ambulancedrivers_collection
        ambulancedrivers_collection = database["ambulancedrivers_collection"]
        
        await ambulancedrivers_collection.update_one(
            {"username": username},
            {
                "$set": {
                    "latitude": latitude,
                    "longitude": longitude,
                    "last_location_update": datetime.utcnow(),
                    "updated_at": datetime.utcnow()
                }
            }
        )
        
        return {
            "status": "success",
            "message": "Location updated successfully",
            "data": {
                "username": username,
                "latitude": latitude,
                "longitude": longitude,
                "timestamp": datetime.utcnow().isoformat()
            }
        }
        
    except HTTPException:
        raise
    except Exception as e:
        print(f"Update location error: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Internal server error: {str(e)}")
# Collections
# ambulance_drivers_collection = database["ambulance_drivers"]
# user_auth_collection = database["user_auth"]

# logger.info("Collections initialized: ambulance_drivers, user_auth")

# # Password hashing
# pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")
# logger.info("Password hashing context initialized")

# # JWT settings
# SECRET_KEY = os.getenv("SECRET_KEY", "your-secret-key-change-this")
# ALGORITHM = "HS256"
# ACCESS_TOKEN_EXPIRE_MINUTES = 30
# logger.info(f"JWT settings loaded - Algorithm: {ALGORITHM}, Expiry: {ACCESS_TOKEN_EXPIRE_MINUTES} minutes")

# # ==================== Pydantic Models ====================

# class AmbulanceDriverRegister(BaseModel):
#     driver_id: str
#     driver_name: str
#     username: str
#     password: str
#     mobile_no: str
#     latitude: Optional[float] = None
#     longitude: Optional[float] = None
#     vehicle_id: Optional[str] = None  # ADD THIS LINE
#     vehicle_number: Optional[str] = None
#     hospital_assigned: Optional[str] = None
#     patient: Optional[str] = None  # ADD THIS LINE

# class AmbulanceDriverLogin(BaseModel):
#     username: str
#     password: str

# class LocationUpdate(BaseModel):
#     username: str
#     latitude: float
#     longitude: float
#     accuracy: Optional[float] = None
#     timestamp: Optional[datetime] = None

# # ==================== Helper Functions ====================

# def hash_password(password: str) -> str:
#     logger.debug(f"Hashing password for user (length: {len(password)})")
#     hashed = pwd_context.hash(password)
#     logger.debug("Password hashed successfully")
#     return hashed

# def verify_password(plain_password: str, hashed_password: str) -> bool:
#     logger.debug("Verifying password")
#     result = pwd_context.verify(plain_password, hashed_password)
#     logger.debug(f"Password verification result: {result}")
#     return result

# def generate_driver_assist_id() -> str:
#     driver_id = f"DRV-{uuid.uuid4().hex[:8].upper()}"
#     logger.info(f"Generated driver_assist_id: {driver_id}")
#     return driver_id

# def create_access_token(data: dict):
#     logger.info(f"Creating access token for user: {data.get('username')}")
#     to_encode = data.copy()
#     expire = datetime.utcnow() + timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES)
#     to_encode.update({"exp": expire})
#     token = jwt.encode(to_encode, SECRET_KEY, algorithm=ALGORITHM)
#     logger.info(f"Access token created successfully, expires at: {expire}")
#     return token

# def convert_mongo_document(doc):
#     if not doc:
#         logger.debug("Empty document received for conversion")
#         return doc
#     logger.debug(f"Converting MongoDB document with _id: {doc.get('_id')}")
#     doc["_id"] = str(doc["_id"])
#     return doc

# # ==================== API Endpoints ====================

# @router.post("/register")
# async def register_ambulance_driver(driver_data: AmbulanceDriverRegister):
#     """
#     Register a new ambulance driver
#     """
#     logger.info("=" * 50)
#     logger.info("REGISTRATION API CALLED")
#     logger.info(f"Request timestamp: {datetime.utcnow().isoformat()}")
    
#     try:
#         logger.info(f"Registration started for username: {driver_data.username}")
#         logger.info(f"Received data: {driver_data.dict()}")
        
#         # Validate mobile number
#         logger.info(f"Validating mobile number: {driver_data.mobile_no}")
#         if not re.match(r'^\d{10}$', driver_data.mobile_no):
#             logger.warning(f"Invalid mobile number format: {driver_data.mobile_no}")
#             return JSONResponse(
#                 status_code=400,
#                 content={
#                     "status": "error",
#                     "message": "Mobile number must be 10 digits"
#                 }
#             )
#         logger.info("Mobile number validation passed")
#         logger.info("Checking vehicle information")
#         if driver_data.vehicle_id:
#             logger.info(f"Vehicle ID provided: {driver_data.vehicle_id}")
#         else:
#             logger.info("No vehicle ID provided")
        
#         if driver_data.vehicle_number:
#             logger.info(f"Vehicle number provided: {driver_data.vehicle_number}")
#         else:
#             logger.info("No vehicle number provided")
        
#         # Check if username already exists
#         logger.info(f"Checking if username exists: {driver_data.username}")
#         existing_user = await user_auth_collection.find_one({"username": driver_data.username})
#         if existing_user:
#             logger.warning(f"Username already exists: {driver_data.username}")
#             return JSONResponse(
#                 status_code=400,
#                 content={
#                     "status": "error",
#                     "message": f"Username '{driver_data.username}' already exists."
#                 }
#             )
#         logger.info("Username is unique")
        
#         # Check if driver_id already exists
#         logger.info(f"Checking if driver_id exists: {driver_data.driver_id}")
#         existing_driver = await ambulance_drivers_collection.find_one({"driver_id": driver_data.driver_id})
#         if existing_driver:
#             logger.warning(f"Driver ID already exists: {driver_data.driver_id}")
#             return JSONResponse(
#                 status_code=400,
#                 content={
#                     "status": "error",
#                     "message": f"Driver ID '{driver_data.driver_id}' already exists."
#                 }
#             )
#         logger.info("Driver ID is unique")
        
#         # Check if mobile number already exists
#         logger.info(f"Checking if mobile number exists: {driver_data.mobile_no}")
#         existing_mobile = await ambulance_drivers_collection.find_one({"mobile_no": driver_data.mobile_no})
#         if existing_mobile:
#             logger.warning(f"Mobile number already registered: {driver_data.mobile_no}")
#             return JSONResponse(
#                 status_code=400,
#                 content={
#                     "status": "error",
#                     "message": f"Mobile number '{driver_data.mobile_no}' is already registered."
#                 }
#             )
#         logger.info("Mobile number is unique")
        
#         # Generate unique IDs
#         logger.info("Generating unique IDs")
#         driver_assist_id = generate_driver_assist_id()
#         sys_user_id = f"AMB-{uuid.uuid4().hex[:12].upper()}"
#         logger.info(f"Generated sys_user_id: {sys_user_id}")
        
#         # Hash password
#         logger.info("Hashing password")
#         hashed_password = hash_password(driver_data.password)
#         current_time = datetime.utcnow()
#         logger.info(f"Current timestamp: {current_time.isoformat()}")
        
#         # Create user authentication document
#         logger.info("Creating user authentication document")
#         user_auth_doc = {
#             "sys_user_id": sys_user_id,
#             "driver_assist_id": driver_assist_id,
#             "username": driver_data.username,
#             "password": hashed_password,
#             "role": "ambulance_driver",
#             "status": "active",
#             "created_at": current_time,
#             "phone_number": driver_data.mobile_no
#         }
#         logger.info(f"User auth document created for: {driver_data.username}")
        
#         # Create ambulance driver document
#         logger.info("Creating ambulance driver document")
#         driver_doc = {
#             "sys_user_id": sys_user_id,
#             "driver_assist_id": driver_assist_id,
#             "driver_id": driver_data.driver_id,
#             "driver_name": driver_data.driver_name,
#             "username": driver_data.username,
#             "mobile_no": driver_data.mobile_no,
#             "vehicle_id": driver_data.vehicle_id,  # ADD THIS LINE
#             "vehicle_number": driver_data.vehicle_number,
#             "hospital_assigned": driver_data.hospital_assigned,
#             "role": "ambulance_driver",
#             "patient": driver_data.patient,  # ADD THIS LINE
#             "status": "active",
#             "is_online": False,
#             "current_location": {
#                 "latitude": driver_data.latitude,
#                 "longitude": driver_data.longitude,
#                 "last_updated": current_time if driver_data.latitude else None
#             },
#             "created_at": current_time,
#             "registered_at": current_time
#         }
#         logger.info(f"Driver document created for: {driver_data.username}")
        
#         # Insert into both collections
#         logger.info("Inserting into user_auth collection")
#         user_insert_result = await user_auth_collection.insert_one(user_auth_doc)
#         logger.info(f"User auth inserted with _id: {user_insert_result.inserted_id}")
        
#         logger.info("Inserting into ambulance_drivers collection")
#         driver_insert_result = await ambulance_drivers_collection.insert_one(driver_doc)
#         logger.info(f"Driver document inserted with _id: {driver_insert_result.inserted_id}")
        
#         logger.info(f"SUCCESS: Driver registered successfully: {driver_data.username}")
#         logger.info("=" * 50)
        
#         return {
#             "status": "success",
#             "message": "Ambulance driver registered successfully",
#             "data": {
#                 "username": driver_data.username,
#                 "driver_id": driver_data.driver_id,
#                 "driver_name": driver_data.driver_name,
#                 "mobile_no": driver_data.mobile_no
#             }
#         }
        
#     except Exception as e:
#         logger.error(f"REGISTRATION FAILED: {str(e)}")
#         logger.exception("Full exception details:")
#         logger.info("=" * 50)
#         return JSONResponse(
#             status_code=500,
#             content={
#                 "status": "error",
#                 "message": f"Registration failed: {str(e)}"
#             }
#         )

# @router.post("/login")
# async def login_ambulance_driver(login_data: AmbulanceDriverLogin):
#     """
#     Login ambulance driver and return JWT token
#     """
#     logger.info("=" * 50)
#     logger.info("LOGIN API CALLED")
#     logger.info(f"Request timestamp: {datetime.utcnow().isoformat()}")
    
#     try:
#         logger.info(f"Login attempt for username: {login_data.username}")
        
#         # Find user
#         logger.info(f"Searching for user in database: {login_data.username}")
#         user_auth = await user_auth_collection.find_one({"username": login_data.username})
        
#         if not user_auth:
#             logger.warning(f"User not found: {login_data.username}")
#             return JSONResponse(
#                 status_code=401,
#                 content={
#                     "status": "error",
#                     "message": "Invalid username or password"
#                 }
#             )
#         logger.info(f"User found: {login_data.username}")
        
#         # Check role
#         logger.info(f"Checking user role: {user_auth.get('role')}")
#         if user_auth.get("role") != "ambulance_driver":
#             logger.warning(f"Invalid role for user {login_data.username}: {user_auth.get('role')}")
#             return JSONResponse(
#                 status_code=401,
#                 content={
#                     "status": "error",
#                     "message": "Not registered as ambulance driver"
#                 }
#             )
#         logger.info("Role validation passed")
        
#         # Verify password
#         logger.info("Verifying password")
#         if not verify_password(login_data.password, user_auth["password"]):
#             logger.warning(f"Invalid password for user: {login_data.username}")
#             return JSONResponse(
#                 status_code=401,
#                 content={
#                     "status": "error",
#                     "message": "Invalid username or password"
#                 }
#             )
#         logger.info("Password verification passed")
        
#         # Get driver details
#         logger.info(f"Fetching driver details for: {login_data.username}")
#         driver_data = await ambulance_drivers_collection.find_one({"username": login_data.username})
        
#         if driver_data:
#             logger.info(f"Driver details found - Name: {driver_data.get('driver_name')}, ID: {driver_data.get('driver_id')}")
#         else:
#             logger.warning(f"Driver details not found for: {login_data.username}")
        
#         # Update last login time
#         logger.info("Updating last login timestamp")
#         await user_auth_collection.update_one(
#             {"username": login_data.username},
#             {"$set": {"last_login": datetime.utcnow()}}
#         )
#         logger.info("Last login timestamp updated")
        
#         # Update driver online status
#         if driver_data:
#             logger.info("Updating driver online status to True")
#             await ambulance_drivers_collection.update_one(
#                 {"username": login_data.username},
#                 {"$set": {"is_online": True}}
#             )
#             logger.info("Online status updated")
        
#         # Create JWT token
#         logger.info("Creating JWT access token")
#         access_token = create_access_token(
#             data={
#                 "sub": user_auth["sys_user_id"],
#                 "username": login_data.username,
#                 "role": "ambulance_driver"
#             }
#         )
        
#         logger.info(f"SUCCESS: User logged in successfully: {login_data.username}")
#         logger.info("=" * 50)
        
#         return {
#             "access_token": access_token,
#             "token_type": "bearer",
#             "user_data": {
#                 "username": login_data.username,
#                 "role": "ambulance_driver",
#                 "driver_name": driver_data.get("driver_name") if driver_data else None,
#                 "driver_id": driver_data.get("driver_id") if driver_data else None,
#                 "mobile_no": driver_data.get("mobile_no") if driver_data else None,
#                 "is_online": True
#             }
#         }
        
#     except Exception as e:
#         logger.error(f"LOGIN FAILED: {str(e)}")
#         logger.exception("Full exception details:")
#         logger.info("=" * 50)
#         return JSONResponse(
#             status_code=500,
#             content={
#                 "status": "error",
#                 "message": f"Login failed: {str(e)}"
#             }
#         )

# @router.post("/update-location")
# async def update_driver_location(location_data: LocationUpdate):
#     """
#     Update ambulance driver's current location
#     """
#     logger.info("=" * 50)
#     logger.info("UPDATE LOCATION API CALLED")
#     logger.info(f"Request timestamp: {datetime.utcnow().isoformat()}")
    
#     try:
#         logger.info(f"Updating location for driver: {location_data.username}")
#         logger.info(f"Location data - Lat: {location_data.latitude}, Lon: {location_data.longitude}, Accuracy: {location_data.accuracy}")
        
#         logger.info(f"Searching for driver: {location_data.username}")
#         driver = await ambulance_drivers_collection.find_one({"username": location_data.username})
        
#         if not driver:
#             logger.warning(f"Driver not found: {location_data.username}")
#             return JSONResponse(
#                 status_code=404,
#                 content={
#                     "status": "error",
#                     "message": "Driver not found"
#                 }
#             )
#         logger.info(f"Driver found: {location_data.username}")
        
#         current_time = location_data.timestamp if location_data.timestamp else datetime.utcnow()
#         logger.info(f"Using timestamp: {current_time.isoformat()}")
        
#         location_entry = {
#             "latitude": location_data.latitude,
#             "longitude": location_data.longitude,
#             "accuracy": location_data.accuracy,
#             "timestamp": current_time
#         }
#         logger.info("Location entry created")
        
#         logger.info("Updating current location and pushing to history")
#         update_result = await ambulance_drivers_collection.update_one(
#             {"username": location_data.username},
#             {
#                 "$set": {
#                     "current_location": {
#                         "latitude": location_data.latitude,
#                         "longitude": location_data.longitude,
#                         "accuracy": location_data.accuracy,
#                         "last_updated": current_time
#                     },
#                     "updated_at": current_time
#                 }
                
#             }
#         )
        
#         logger.info(f"Update result - Matched: {update_result.matched_count}, Modified: {update_result.modified_count}")
#         logger.info(f"SUCCESS: Location updated for driver: {location_data.username}")
#         logger.info("=" * 50)
        
#         return {
#             "status": "success",
#             "message": "Location updated successfully",
#             "timestamp": current_time.isoformat()
#         }
        
#     except Exception as e:
#         logger.error(f"LOCATION UPDATE FAILED: {str(e)}")
#         logger.exception("Full exception details:")
#         logger.info("=" * 50)
#         return JSONResponse(
#             status_code=500,
#             content={
#                 "status": "error",
#                 "message": f"Location update failed: {str(e)}"
#             }
#         )
# @router.get("/get-all-drivers")
# async def get_all_ambulance_drivers(
#     online_only: bool = False, 
#     limit: int = Query(100, ge=1, le=1000),
#     skip: int = Query(0, ge=0)
# ):
#     """
#     Get all ambulance drivers
#     """
#     logger.info("=" * 50)
#     logger.info("GET ALL DRIVERS API CALLED")
#     logger.info(f"Request timestamp: {datetime.utcnow().isoformat()}")
    
#     try:
#         logger.info(f"Query parameters - online_only: {online_only}, limit: {limit}, skip: {skip}")
        
#         query = {}
#         if online_only:
#             query["is_online"] = True
#             logger.info(f"Filtering for online drivers only")
#         else:
#             logger.info("Fetching all drivers")
        
#         logger.info(f"Executing database query with filter: {query}")
#         cursor = ambulance_drivers_collection.find(query).skip(skip).limit(limit)
#         drivers = []
        
#         driver_count = 0
#         async for driver in cursor:
#             driver_count += 1
#             logger.debug(f"Processing driver {driver_count}: {driver.get('username')}")
            
#             # Create a clean driver object with all required fields
#             clean_driver = {
#                 "_id": str(driver.get("_id")),
#                 "username": driver.get("username", "N/A"),
#                 "patient_queue": driver.get("patient_queue", []),
#                 "driver_name": driver.get("driver_name", "N/A"),
#                 "driver_id": driver.get("driver_id", "N/A"),
#                 "vehicle_number": driver.get("vehicle_number", "N/A"),
#                 "vehicle_id": driver.get("vehicle_id", "N/A"),
#                 "mobile_no": driver.get("mobile_no", "N/A"),
#                 "latitude": driver.get("current_location", {}).get("latitude") if driver.get("current_location") else driver.get("latitude"),
#                 "longitude": driver.get("current_location", {}).get("longitude") if driver.get("current_location") else driver.get("longitude"),
#                 "status": driver.get("status", "active"),
#                 "is_online": driver.get("is_online", False),
#                 "role": driver.get("role", "ambulance_driver"),
#                 "created_at": str(driver.get("created_at")) if driver.get("created_at") else None
#             }
            
#             drivers.append(clean_driver)
        
#         logger.info(f"Retrieved {len(drivers)} drivers from database")
        
#         # Log sample driver data for debugging
#         if drivers:
#             logger.info(f"Sample driver data: {drivers[0]}")
        
#         logger.info("Getting total count of drivers matching query")
#         total_count = await ambulance_drivers_collection.count_documents(query)
#         logger.info(f"Total count: {total_count}")
        
#         logger.info(f"SUCCESS: Returning {len(drivers)} drivers")
#         logger.info("=" * 50)
        
#         return {
#             "status": "success",
#             "total": total_count,
#             "limit": limit,
#             "skip": skip,
#             "drivers": drivers
#         }
        
#     except Exception as e:
#         logger.error(f"GET ALL DRIVERS FAILED: {str(e)}")
#         logger.exception("Full exception details:")
#         logger.info("=" * 50)
#         return JSONResponse(
#             status_code=500,
#             content={
#                 "status": "error",
#                 "message": str(e)
#             }
#         )
# @router.post("/assign-driver")
# async def assign_driver(data: dict):
#     try:
#         driver_id = data.get("driver_id")
#         patient_id = data.get("patient_id")

#         print("DRIVER ID:", driver_id)
#         print("PATIENT ID:", patient_id)

#         # 🚨 VALIDATION
#         if not patient_id or str(patient_id).strip() == "":
#             return {"status": "error", "message": "Invalid patient_id"}

#         result = await database["ambulance_drivers"].update_one(
#             {"driver_id": driver_id},
#             {
#                 # 🔥 FIFO QUEUE
#                 "$addToSet": {   # prevents duplicates
#                     "patient_queue": patient_id
#                 },
#                 "$set": {
#                     "dispatch_status": "Assigned",
#                     "assigned_at": datetime.utcnow()
#                 }
#             }
#         )

#         print("MATCHED:", result.matched_count)
#         print("MODIFIED:", result.modified_count)

#         if result.matched_count == 0:
#             return {"status": "error", "message": "Driver not found"}

#         return {
#             "status": "success",
#             "message": "Patient added to driver queue",
#             "driver_id": driver_id,
#             "patient_id": patient_id
#         }

#     except Exception as e:
#         print("ERROR:", str(e))
#         return {"status": "error", "message": str(e)}
# @router.get("/get-driver/{username}")
# async def get_driver_details(username: str):
#     """
#     Get specific driver details
#     """
#     logger.info("=" * 50)
#     logger.info("GET DRIVER DETAILS API CALLED")
#     logger.info(f"Request timestamp: {datetime.utcnow().isoformat()}")
    
#     try:
#         logger.info(f"Fetching details for driver username: {username}")
        
#         logger.info(f"Querying database for username: {username}")
#         driver = await ambulance_drivers_collection.find_one({"username": username})
        
#         if not driver:
#             logger.warning(f"Driver not found: {username}")
#             return JSONResponse(
#                 status_code=404,
#                 content={
#                     "status": "error",
#                     "message": "Driver not found"
#                 }
#             )
        
#         logger.info(f"Driver found: {username}")
#         logger.info(f"Driver details - Name: {driver.get('driver_name')}, ID: {driver.get('driver_id')}")
        
#         driver = convert_mongo_document(driver)
#         driver.pop("location_history", None)
#         logger.info("Location history removed from response")
        
#         logger.info(f"SUCCESS: Returning details for driver: {username}")
#         logger.info("=" * 50)
        
#         return {
#             "status": "success",
#             "data": driver
#         }
        
#     except Exception as e:
#         logger.error(f"GET DRIVER DETAILS FAILED: {str(e)}")
#         logger.exception("Full exception details:")
#         logger.info("=" * 50)
#         return JSONResponse(
#             status_code=500,
#             content={
#                 "status": "error",
#                 "message": str(e)
#             }
#         )

# # Startup log
# logger.info("=" * 60)
# logger.info("AMBULANCE ROUTES MODULE LOADED SUCCESSFULLY")
# logger.info(f"Routes available:")
# logger.info(f"  POST   /hms/users/ambulance/register")
# logger.info(f"  POST   /hms/users/ambulance/login")
# logger.info(f"  POST   /hms/users/ambulance/update-location")
# logger.info(f"  GET    /hms/users/ambulance/get-all-drivers")
# logger.info(f"  GET    /hms/users/ambulance/get-driver/{{username}}")
# logger.info("=" * 60)



# # Add this to your customer_care_routes.py file

# @router.delete("/delete-all-drivers")
# async def delete_all_customercare_drivers(confirm: str = Query(..., description="Type 'CONFIRM' to delete all drivers")):
#     """
#     DELETE ALL customer care drivers from both collections
#     WARNING: This action is irreversible!
#     """
#     logger.info("=" * 50)
#     logger.info("DELETE ALL CUSTOMERCARE DRIVERS API CALLED")
#     logger.info(f"Request timestamp: {datetime.utcnow().isoformat()}")
    
#     try:
#         # Safety check - require confirmation
#         if confirm != "CONFIRM":
#             logger.warning(f"Delete all drivers attempted without confirmation. Received: {confirm}")
#             return JSONResponse(
#                 status_code=400,
#                 content={
#                     "status": "error",
#                     "message": "Please provide confirm='CONFIRM' in query parameter to confirm deletion"
#                 }
#             )
        
#         logger.info("Confirmation received. Proceeding with deletion...")
        
#         # Get count before deletion for logging
#         logger.info("Counting drivers before deletion")
#         driver_count = await ambulance_drivers_collection.count_documents({})
#         auth_count = await user_auth_collection.count_documents({"role": "customer_care"})
        
#         logger.info(f"Found {driver_count} drivers in customer_care collection")
#         logger.info(f"Found {auth_count} authentication records for customer care")
        
#         if driver_count == 0 and auth_count == 0:
#             logger.info("No drivers found to delete")
#             return {
#                 "status": "success",
#                 "message": "No customer care drivers found to delete",
#                 "data": {
#                     "drivers_deleted": 0,
#                     "user_auth_deleted": 0
#                 }
#             }
        
#         # Delete from customer_care collection
#         logger.info("Deleting from customer_care collection")
#         driver_delete_result = await ambulance_drivers_collection.delete_many({})
#         logger.info(f"Deleted {driver_delete_result.deleted_count} documents from customer_care")
        
#         # Delete from user_auth collection (only customer care drivers)
#         logger.info("Deleting customer care records from user_auth collection")
#         auth_delete_result = await user_auth_collection.delete_many({"role": "customer_care"})
#         logger.info(f"Deleted {auth_delete_result.deleted_count} documents from user_auth")
        
#         logger.info(f"SUCCESS: Deleted {driver_delete_result.deleted_count} customer care drivers")
#         logger.info("=" * 50)
        
#         return {
#             "status": "success",
#             "message": f"Successfully deleted all customer care drivers",
#             "data": {
#                 "drivers_deleted": driver_delete_result.deleted_count,
#                 "user_auth_deleted": auth_delete_result.deleted_count,
#                 "timestamp": datetime.utcnow().isoformat()
#             }
#         }
        
#     except Exception as e:
#         logger.error(f"DELETE ALL CUSTOMERCARE DRIVERS FAILED: {str(e)}")
#         logger.exception("Full exception details:")
#         logger.info("=" * 50)
#         return JSONResponse(
#             status_code=500,
#             content={
#                 "status": "error",
#                 "message": f"Delete operation failed: {str(e)}"
#             }
#         )


# @router.delete("/delete-driver/{username}")
# async def delete_single_customercare_driver(username: str):
#     """
#     Delete a specific customer care driver by username
#     """
#     logger.info("=" * 50)
#     logger.info("DELETE SINGLE CUSTOMERCARE DRIVER API CALLED")
#     logger.info(f"Request timestamp: {datetime.utcnow().isoformat()}")
#     logger.info(f"Username to delete: {username}")
    
#     try:
#         # Check if driver exists
#         logger.info(f"Checking if driver exists: {username}")
#         driver = await ambulance_drivers_collection.find_one({"username": username})
        
#         if not driver:
#             logger.warning(f"Driver not found: {username}")
#             return JSONResponse(
#                 status_code=404,
#                 content={
#                     "status": "error",
#                     "message": f"Driver with username '{username}' not found"
#                 }
#             )
        
#         logger.info(f"Driver found. Name: {driver.get('driver_name')}")
        
#         # Delete from customer_care collection
#         logger.info(f"Deleting from customer_care collection")
#         driver_delete_result = await ambulance_drivers_collection.delete_one({"username": username})
#         logger.info(f"Deleted from customer_care: {driver_delete_result.deleted_count} document")
        
#         # Delete from user_auth collection
#         logger.info(f"Deleting from user_auth collection")
#         auth_delete_result = await user_auth_collection.delete_one({"username": username, "role": "customer_care"})
#         logger.info(f"Deleted from user_auth: {auth_delete_result.deleted_count} document")
        
#         logger.info(f"SUCCESS: Deleted driver: {username}")
#         logger.info("=" * 50)
        
#         return {
#             "status": "success",
#             "message": f"Driver '{username}' deleted successfully",
#             "data": {
#                 "username": username,
#                 "driver_name": driver.get('driver_name'),
#                 "timestamp": datetime.utcnow().isoformat()
#             }
#         }
        
#     except Exception as e:
#         logger.error(f"DELETE SINGLE CUSTOMERCARE DRIVER FAILED: {str(e)}")
#         logger.exception("Full exception details:")
#         logger.info("=" * 50)
#         return JSONResponse(
#             status_code=500,
#             content={
#                 "status": "error",
#                 "message": f"Delete operation failed: {str(e)}"
#             }
#         )


# class StatusUpdate(BaseModel):
#     username: str
#     is_online: bool

# @router.post("/update-status")
# async def update_driver_status(status_data: StatusUpdate):
#     """Update driver online status"""
#     try:
#         result = await ambulance_drivers_collection.update_one(
#             {"username": status_data.username},
#             {"$set": {"is_online": status_data.is_online, "updated_at": datetime.utcnow()}}
#         )
        
#         if result.matched_count == 0:
#             return JSONResponse(status_code=404, content={"status": "error", "message": "Driver not found"})
        
#         return {"status": "success", "message": f"Status updated to {'online' if status_data.is_online else 'offline'}"}
#     except Exception as e:
#         return JSONResponse(status_code=500, content={"status": "error", "message": str(e)})




# AMBULANCE REgistration21-04-2026

class AmbulanceRegister(BaseModel):
    vehicleId: str
    vehicleRegNumber: str
    chassisNumber: Optional[str] = ""
    engineNumber: Optional[str] = ""
    vehicleModel: Optional[str] = ""
    vehicleMake: Optional[str] = ""
    manufacturingYear: Optional[str] = ""
    rtoRegistrationDate: Optional[str] = ""
    registrationAuthority: Optional[str] = ""
    fitnessCertificateValidity: Optional[str] = ""
    insuranceProvider: Optional[str] = ""
    insurancePolicyNumber: Optional[str] = ""
    insuranceExpiryDate: Optional[str] = ""
    pollutionCertificateValidity: Optional[str] = ""
    ambulanceType: Optional[str] = ""
    vehicleCategory: Optional[str] = ""
    fuelType: Optional[str] = ""
    seatingCapacity: Optional[str] = ""
    engineCapacity: Optional[str] = ""
    transmissionType: Optional[str] = ""
    oxygenCylinderFitted: Optional[str] = "No"
    stretcherAvailability: Optional[str] = "Yes"
    ventilatorInstalled: Optional[str] = "No"
    defibrillatorInstalled: Optional[str] = "No"
    sirenEmergencyLights: Optional[str] = "Yes"
    engaged: Optional[str] = None
@router.post("/ambulance/register")
async def register_ambulance(ambulance_data: AmbulanceRegister):
    """
    Register a new ambulance in the ambulance_collection
    """
    logger.info("=" * 50)
    logger.info("AMBULANCE REGISTRATION API CALLED")
    logger.info(f"Vehicle ID: {ambulance_data.vehicleId}")
    logger.info(f"Registration Number: {ambulance_data.vehicleRegNumber}")
    
    try:
        # Check if ambulance already exists
        existing = await database["ambulance_collection"].find_one({
            "$or": [
                {"vehicleId": ambulance_data.vehicleId},
                {"vehicleRegNumber": ambulance_data.vehicleRegNumber}
            ]
        })
        
        if existing:
            logger.warning(f"Duplicate found: {existing}")
            return JSONResponse(
                status_code=400,
                content={
                    "status": "error",
                    "message": f"Ambulance with Vehicle ID '{ambulance_data.vehicleId}' or Registration Number '{ambulance_data.vehicleRegNumber}' already exists"
                }
            )
        
        # Prepare document for insertion
        ambulance_doc = {
            "vehicleId": ambulance_data.vehicleId,
            "vehicleRegNumber": ambulance_data.vehicleRegNumber,
            "chassisNumber": ambulance_data.chassisNumber,
            "engineNumber": ambulance_data.engineNumber,
            "vehicleModel": ambulance_data.vehicleModel,
            "vehicleMake": ambulance_data.vehicleMake,
            "manufacturingYear": ambulance_data.manufacturingYear,
            "rtoRegistrationDate": ambulance_data.rtoRegistrationDate,
            "registrationAuthority": ambulance_data.registrationAuthority,
            "fitnessCertificateValidity": ambulance_data.fitnessCertificateValidity,
            "insuranceProvider": ambulance_data.insuranceProvider,
            "insurancePolicyNumber": ambulance_data.insurancePolicyNumber,
            "insuranceExpiryDate": ambulance_data.insuranceExpiryDate,
            "pollutionCertificateValidity": ambulance_data.pollutionCertificateValidity,
            "ambulanceType": ambulance_data.ambulanceType,
            "vehicleCategory": ambulance_data.vehicleCategory,
            "fuelType": ambulance_data.fuelType,
            "seatingCapacity": ambulance_data.seatingCapacity,
            "engineCapacity": ambulance_data.engineCapacity,
            "transmissionType": ambulance_data.transmissionType,
            "oxygenCylinderFitted": ambulance_data.oxygenCylinderFitted,
            "stretcherAvailability": ambulance_data.stretcherAvailability,
            "ventilatorInstalled": ambulance_data.ventilatorInstalled,
            "defibrillatorInstalled": ambulance_data.defibrillatorInstalled,
            "sirenEmergencyLights": ambulance_data.sirenEmergencyLights,
            "engaged": ambulance_data.engaged,  # ✅ ADD THIS LINE - will be null
            "is_active": True,
            "status": "Available",
            "createdAt": datetime.utcnow().isoformat(),
            "updatedAt": datetime.utcnow().isoformat()
        }
        
        # Insert into database
        result = await database["ambulance_collection"].insert_one(ambulance_doc)
        
        logger.info(f"Ambulance registered successfully with ID: {result.inserted_id}")
        
        return {
            "status": "success",
            "message": "Ambulance registered successfully",
            "ambulance_id": str(result.inserted_id),
            "vehicleId": ambulance_data.vehicleId
        }
        
    except Exception as e:
        logger.error(f"Error in ambulance registration: {str(e)}")
        return JSONResponse(
            status_code=500,
            content={
                "status": "error",
                "message": f"Registration failed: {str(e)}"
            }
        )
@router.get("/ambulance/list")
async def get_all_ambulances():
    """
    Get all registered ambulances with their ZENZO credentials
    """
    try:
        cursor = database["ambulance_collection"].find(
            {},
            {
                "_id": 0,
                "vehicleId": 1,
                "vehicleRegNumber": 1,
                "ambulanceNumber": 1,
                "password": 1,
                "zenzo_ambulance_number": 1,
                "zenzo_login_password": 1,  # ✅ Add this
                "zenzo_login_working": 1,    # ✅ Add this
                "zenzo_api_token": 1,
                "vehicleMake": 1,
                "vehicleModel": 1,
                "manufacturingYear": 1,
                "ambulanceType": 1,
                "status": 1,
                "is_active": 1
            }
        )
        ambulances = await cursor.to_list(length=None)
        
        for amb in ambulances:
            # Use ZENZO credentials for login
            if amb.get("zenzo_ambulance_number"):
                amb["ambulanceNumber"] = amb.get("zenzo_ambulance_number")  # Override with ZENZO number
                if amb.get("zenzo_login_password"):
                    amb["password"] = amb.get("zenzo_login_password")  # Override with ZENZO password
                amb["has_zenzo_token"] = bool(amb.get("zenzo_api_token"))
                amb["zenzo_login_ready"] = amb.get("zenzo_login_working", False)
        
        return {
            "status": "success",
            "count": len(ambulances),
            "ambulances": ambulances
        }
        
    except Exception as e:
        logger.error(f"Error fetching ambulances: {str(e)}")
        return JSONResponse(
            status_code=500,
            content={"status": "error", "message": f"Failed to fetch ambulances: {str(e)}"}
        )
class DriverRegister(BaseModel):
    driverId: str
    fullName: str
    dateOfBirth: Optional[str] = None
    gender: Optional[str] = None
    currentAddress: Optional[str] = None
    permanentAddress: Optional[str] = None
    phoneNumber: Optional[str] = None
    aadhaarNumber: Optional[str] = None
    panNumber: Optional[str] = None
    drivingLicenseNumber: Optional[str] = None
    licenseIssueDate: Optional[str] = None
    licenseExpiryDate: Optional[str] = None
    issuingRTOAuthority: Optional[str] = None
    employmentType: Optional[str] = None
    yearsOfExperience: Optional[str] = None
    ambulanceDrivingExperience: Optional[str] = None
    assignedAmbulanceVehicleNumber: Optional[str] = None
    shiftTiming: Optional[str] = None
    latitude: Optional[float] = None
    longitude: Optional[float] = None
    patient: Optional[str] = None
    username: Optional[str] = None  # Added for credentials
    password: Optional[str] = None   # Added for credentials

@router.post("/ambulance/driver/register")
async def register_driver(driver_data: DriverRegister):
    try:

        
        # Check if driver ID already exists
        existing_driver = await ambulancedrivers_collection.find_one({"driverId": driver_data.driverId})
        if existing_driver:
            raise HTTPException(status_code=400, detail="Driver ID already exists")
        
        # Check if username already exists
        if driver_data.username:
            existing_username = await ambulancedrivers_collection.find_one({"username": driver_data.username})
            if existing_username:
                raise HTTPException(status_code=400, detail="Username already exists")
        
        # Prepare document for insertion
        driver_doc = driver_data.dict()
        driver_doc["created_at"] = datetime.utcnow()
        driver_doc["updated_at"] = datetime.utcnow()
        driver_doc["status"] = "active"
        
        # Insert into database
        result = await ambulancedrivers_collection.insert_one(driver_doc)
        
        return {
    "status": "success",
    "message": "Driver registered successfully",
    "driver_id": driver_data.driverId,
    "username": driver_data.username,
    "password": driver_data.password,   # 🔥 ADD THIS
    "inserted_id": str(result.inserted_id)
}
        
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Internal server error: {str(e)}")

@router.get("/ambulance/drivers/list")
async def get_all_drivers():
    try:
       
        drivers = await ambulancedrivers_collection.find({}).to_list(length=1000)
        
        # Convert ObjectId to string for JSON serialization
        for driver in drivers:
            driver["_id"] = str(driver["_id"])
        
        return {
            "status": "success",
            "drivers": drivers
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Internal server error: {str(e)}")
# Add to ambulance_routes.py

class StatusUpdate(BaseModel):
    username: str
    is_online: bool
@router.post("/update-status")
async def update_driver_status(status_data: StatusUpdate):

    try:

        result = await ambulancedrivers_collection.update_one(
            {"username": status_data.username},
            {
                "$set": {
                    "is_online": status_data.is_online,

                    "assignedVehicleId": None,
                    "assignedAmbulanceVehicleNumber": None,

                    "updated_at": datetime.utcnow()
                }
            }
        )

        print("✅ DRIVER STATUS UPDATED")
        print("👤 USERNAME:", status_data.username)
        print("🚑 VEHICLE RELEASED")

        if result.matched_count == 0:
            return JSONResponse(
                status_code=404,
                content={
                    "status": "error",
                    "message": "Driver not found"
                }
            )

        return {
            "status": "success",
            "message": f"Status updated"
        }

    except Exception as e:

        print("❌ UPDATE STATUS ERROR:", str(e))

        return JSONResponse(
            status_code=500,
            content={
                "status": "error",
                "message": str(e)
            }
        )
class AssignVehicleRequest(BaseModel):
    username: str
    vehicle_id: str
    vehicle_number: str
    latitude: Optional[float] = None
    longitude: Optional[float] = None

@router.post("/ambulance/assign-vehicle")
async def assign_vehicle_to_driver(request: AssignVehicleRequest):
    print("🚑 CONFIRM SELECTION CLICKED")
    print(f"👤 Username: {request.username}")
    print(f"🚑 Vehicle ID: {request.vehicle_id}")
    print(f"🚗 Vehicle Number: {request.vehicle_number}")
    print("✅ DEMO API /ambulance/assign-vehicle CALLED")
    """
    Assign an ambulance vehicle to a driver and store location
    """
    try:
        ambulancedrivers_collection = database["ambulancedrivers_collection"]
        
        # Prepare update data
        update_data = {
            "assignedAmbulanceVehicleNumber": request.vehicle_number,
            "assignedVehicleId": request.vehicle_id,
            "vehicle_assigned_at": datetime.utcnow().isoformat(),
            "updated_at": datetime.utcnow().isoformat()
        }
        
        # Add location if provided
        if request.latitude is not None and request.longitude is not None:
            update_data["latitude"] = request.latitude
            update_data["longitude"] = request.longitude
            update_data["last_location_update"] = datetime.utcnow().isoformat()
            # Check if ambulance already assigned
            existing_driver = await ambulancedrivers_collection.find_one({
                "assignedVehicleId": request.vehicle_id
            })

            if existing_driver:
                raise HTTPException(
                    status_code=400,
                    detail="Ambulance already assigned to another driver"
            )
        # Update driver with assigned vehicle and location
        result = await ambulancedrivers_collection.update_one(
            {"username": request.username},
            {"$set": update_data}
        )
        
        if result.modified_count == 0:
            raise HTTPException(status_code=404, detail="Driver not found")
        
        return {
            "status": "success",
            "message": f"Vehicle {request.vehicle_id} assigned successfully",
            "location_updated": request.latitude is not None
        }
        
    except HTTPException:
        raise
    except Exception as e:
        print(f"Error assigning vehicle: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Internal server error: {str(e)}")

@router.get("/ambulance/get-driver/{username}")
async def get_driver_details(username: str):
    """
    Get driver details including assigned vehicle
    """
    try:
        ambulancedrivers_collection = database["ambulancedrivers_collection"]
        
        # FIXED: Removed the indentation issue
        driver = await ambulancedrivers_collection.find_one(
            {"username": username},
            {"_id": 0}  # Exclude _id field
        )
        
        if not driver:
            raise HTTPException(status_code=404, detail="Driver not found")
        
        return {
            "status": "success",
            "data": driver
        }
        
    except HTTPException:
        raise
    except Exception as e:
        print(f"Error getting driver: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Internal server error: {str(e)}")


# Optional: Add endpoint to get driver by ID as well
@router.get("/ambulance/get-driver-by-id/{driver_id}")
async def get_driver_by_id(driver_id: str):
    """
    Get driver details by driver ID
    """
    try:
        ambulancedrivers_collection = database["ambulancedrivers_collection"]
        
        driver = await ambulancedrivers_collection.find_one(
            {"driverId": driver_id},
            {"_id": 0}
        )
        
        if not driver:
            raise HTTPException(status_code=404, detail="Driver not found")
        
        return {
            "status": "success",
            "data": driver
        }
        
    except HTTPException:
        raise
    except Exception as e:
        print(f"Error getting driver: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Internal server error: {str(e)}")


# Optional: Add endpoint to get all assigned vehicles for a driver
@router.get("/ambulance/driver-vehicle/{username}")
async def get_driver_vehicle(username: str):
    """
    Get the vehicle assigned to a driver
    """
    try:
        ambulancedrivers_collection = database["ambulancedrivers_collection"]
        
        driver = await ambulancedrivers_collection.find_one(
            {"username": username},
            {"assignedAmbulanceVehicleNumber": 1, "assignedVehicleId": 1, "vehicle_assigned_at": 1}
        )
        
        if not driver:
            raise HTTPException(status_code=404, detail="Driver not found")
        
        return {
            "status": "success",
            "data": {
                "username": username,
                "assignedVehicleId": driver.get("assignedVehicleId"),
                "assignedAmbulanceVehicleNumber": driver.get("assignedAmbulanceVehicleNumber"),
                "assigned_at": driver.get("vehicle_assigned_at")
            }
        }
        
    except HTTPException:
        raise
    except Exception as e:
        print(f"Error getting driver vehicle: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Internal server error: {str(e)}")
class AmbulanceActiveUpdate(BaseModel):
    vehicle_id: str
    is_active: bool


@router.post("/ambulance/update-ambulance-status")
async def update_ambulance_status(data: AmbulanceActiveUpdate):
    try:
        result = await ambulance_collection.update_one(
            {"vehicleId": data.vehicle_id},
            {
                "$set": {
                    "is_active": data.is_active,
                    "updatedAt": datetime.utcnow().isoformat()
                }
            }
        )

        if result.matched_count == 0:
            raise HTTPException(status_code=404, detail="Ambulance not found")

        return {
            "status": "success",
            "message": f"Ambulance set to {'active' if data.is_active else 'inactive'}"
        }

    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/active-with-location")
async def get_active_ambulances_with_location():
    try:
        ambulances = await ambulance_collection.find(
            {"is_active": True}
        ).to_list(length=100)

        result = []

        for amb in ambulances:
            vehicle_id = amb.get("vehicleId")

            if not vehicle_id:
                continue  # skip invalid data

            driver = await ambulancedrivers_collection.find_one({
                "assignedVehicleId": vehicle_id
            })

            result.append({
                "vehicleId": vehicle_id,
                "vehicleNumber": amb.get("vehicleRegNumber"),
                "is_active": amb.get("is_active", False),

                # ✅ SAFE ACCESS
                "driverName": driver.get("fullName") if driver else None,
                "driverId": driver.get("driverId") if driver else None,
                "latitude": driver.get("latitude") if driver else None,
                "longitude": driver.get("longitude") if driver else None,
                "is_online": driver.get("is_online") if driver else False,
            })

        return {
            "status": "success",
            "data": result
        }

    except Exception as e:
        print("❌ ERROR IN active-with-location:", str(e))  # 🔥 ADD THIS
        raise HTTPException(status_code=500, detail=str(e))


@router.websocket("/ws/driver/{driver_id}")
async def driver_websocket(websocket: WebSocket, driver_id: str):
    await driver_manager.connect(driver_id, websocket)
    try:
        while True:
            await websocket.receive_text()
    except WebSocketDisconnect:
        driver_manager.disconnect(driver_id, websocket)


class RegisterPushTokenRequest(BaseModel):
    driver_id: str
    push_token: str

@router.post("/ambulance/register-push-token")
async def register_push_token(data: RegisterPushTokenRequest):
    try:
        result = await ambulancedrivers_collection.update_one(
            {"driverId": data.driver_id},
            {"$set": {
                "push_token": data.push_token,
                "push_token_updated_at": datetime.utcnow().isoformat(),
            }}
        )
        logger.info(f"Push token registered for driver {data.driver_id}, matched={result.matched_count}")
        return {"status": "success", "matched": result.matched_count}
    except Exception as e:
        logger.error(f"register_push_token error: {e}")
        return {"status": "failed", "message": str(e)}


class NotifyDriverUpdateRequest(BaseModel):
    patient_id: str
    update_type: str  # "CLINICAL_ACTION_UPDATE" | "IMAGE_ANALYSIS_UPDATE"

@router.post("/notify-driver-update")
async def notify_driver_update(data: NotifyDriverUpdateRequest):
    try:
        driver_id = None
        source = None

        # 1️⃣ PRIMARY: check ambulance_assignments (this is what /ambulance/dispatch-patient
        #    actually writes to — the flow currently in use)
        assignment = await database["ambulance_assignments"].find_one(
            {"patient_id": data.patient_id, "status": {"$in": ["dispatched", "accepted"]}},
            sort=[("assigned_at", -1)],
        )
        if assignment:
            driver_id = assignment.get("driver_id")
            source = "ambulance_assignments"

        # 2️⃣ FALLBACK: legacy /assign-driver flow, writes patients.ambulance_driver
        if not driver_id:
            patient = await database["patients"].find_one(
                {"patient_id": data.patient_id},
                {"ambulance_driver.driver_id": 1}
            )
            if patient:
                driver_id = (patient.get("ambulance_driver") or {}).get("driver_id")
                if driver_id:
                    source = "patients.ambulance_driver"

        logger.info(f"notify_driver_update: patient={data.patient_id} resolved driver_id={driver_id} source={source}")

        if driver_id:
            await driver_manager.send_to_driver(driver_id, {
                "type": data.update_type,
                "patient_id": data.patient_id,
            })

            # Also send an actual OS-level push so this reaches the driver
            # even if the app is backgrounded or killed (WS alone can't).
            driver_doc = await ambulancedrivers_collection.find_one(
                {"driverId": driver_id}, {"push_token": 1}
            )
            push_token = (driver_doc or {}).get("push_token")

            title = (
                "Clinical Action Approved" if data.update_type == "CLINICAL_ACTION_UPDATE"
                else "New Image Analysis"
            )
            body = "Tap to view the update for your patient."

            await send_expo_push(
                push_token,
                title,
                body,
                {"type": data.update_type, "patient_id": data.patient_id},
                channel_id="clinical-alerts",
            )

            return {"status": "success", "notified": driver_id, "source": source}

        return {"status": "success", "notified": None, "reason": "no driver assigned to this patient"}
    except Exception as e:
        logger.error(f"notify_driver_update error: {e}")
        return {"status": "failed", "message": str(e)}

class AssignDriverRequest(BaseModel):
    patient_id: str
    driver_id: str
    driver_name: str
    ambulance_id: str
    vehicle_number: str

# @router.post("/assign-driver")
# async def assign_driver_to_patient(request: AssignDriverRequest):
#     """
#     Assign a driver/ambulance to a patient and update patient record
#     """
#     try:
#         from bson import ObjectId
        
#         patient_id = request.patient_id
#         driver_id = request.driver_id
#         driver_name = request.driver_name
#         ambulance_id = request.ambulance_id
#         vehicle_number = request.vehicle_number
        
#         print(f"🚑 ASSIGNING DRIVER TO PATIENT:")
#         print(f"   Patient ID: {patient_id}")
#         print(f"   Driver ID: {driver_id}")
#         print(f"   Driver Name: {driver_name}")
#         print(f"   Ambulance ID: {ambulance_id}")
#         print(f"   Vehicle Number: {vehicle_number}")
        
#         # Get the patients collection
#         patients_collection = database["patients"]
        
#         # Check if patient exists
#         patient = await patients_collection.find_one({"patient_id": patient_id})
        
#         if not patient:
#             raise HTTPException(status_code=404, detail="Patient not found")
        
#         # Prepare the ambulance assignment data
#         ambulance_assignment = {
#             "driver_id": driver_id,
#             "driver_name": driver_name,
#             "ambulance_id": ambulance_id,
#             "vehicle_number": vehicle_number,
#             "assigned_at": datetime.utcnow().isoformat(),
#             "status": "assigned"
#         }
        
#         # Update patient with ambulance driver information
#         # Use $set to update/replace the ambulance_driver field
#         # Also add to a history array for tracking multiple assignments
#         update_result = await patients_collection.update_one(
#             {"patient_id": patient_id},
#             {
#                 "$set": {
#                     "ambulance_driver": ambulance_assignment,
#                     "dispatch_status": "assigned",
#                     "dispatch_updated_at": datetime.utcnow().isoformat()
#                 },
#                 "$push": {
#                     "ambulance_assignment_history": ambulance_assignment
#                 }
#             }
#         )
        
#         if update_result.matched_count == 0:
#             raise HTTPException(status_code=404, detail="Failed to update patient record")
        
#         # Also update the driver's collection to mark them as engaged
#         ambulancedrivers_collection = database["ambulancedrivers_collection"]
#         #
#         await ambulancedrivers_collection.update_one(
#             {"driverId": driver_id},
#             {
#                 "$set": {
#                     "current_patient": patient_id,
#                     "dispatch_status": "on_duty",
#                     "last_assigned_at": datetime.utcnow().isoformat()
#                 },
#                 "$addToSet": {
#                     "assigned_patients": patient_id
#                 }
#             }
#         )
        
#         print(f"✅ Successfully assigned driver {driver_name} to patient {patient_id}")
# # Notify driver via WebSocket
#         patient_doc = await patients_collection.find_one({"patient_id": patient_id})
#         await driver_manager.send_to_driver(driver_id, {
#             "type": "DISPATCH",
#             "patient": {
#                 "id": patient_id,
#                 "patient_id": patient_id,
#                 "fullName": patient_doc.get("fullName") if patient_doc else "",
#                 "patient_name": patient_doc.get("fullName") if patient_doc else "",
#                 "age": patient_doc.get("age") if patient_doc else "",
#                 "gender": patient_doc.get("gender") if patient_doc else "",
#                 "phoneNumber": patient_doc.get("phoneNumber") if patient_doc else "",
#                 "accidentDetails": patient_doc.get("accidentDetails") if patient_doc else {},
#                 "emergencyContact": patient_doc.get("emergencyContact") if patient_doc else {},
#                 "registrationDate": patient_doc.get("registrationDate") if patient_doc else "",
#                 "status": "active",
#                 "ambulance_driver": {
#                     "driver_id": driver_id,
#                     "driver_name": driver_name,
#                     "vehicle_number": vehicle_number,
#                     "ambulance_id": ambulance_id
#                 }
#             }
#         })
        
#         return {
#             "status": "success",
#             "message": f"Driver {driver_name} assigned to patient successfully",
#             "data": {
#                 "patient_id": patient_id,
#                 "driver_id": driver_id,
#                 "driver_name": driver_name,
#                 "ambulance_id": ambulance_id,
#                 "assigned_at": datetime.utcnow().isoformat()
#             }
#         }
        
#     except HTTPException:
#         raise
#     except Exception as e:
#         print(f"❌ Error assigning driver: {str(e)}")
#         raise HTTPException(status_code=500, detail=f"Assignment failed: {str(e)}")


@router.post("/assign-driver")
async def assign_driver_to_patient(request: AssignDriverRequest):
    """
    Assign a driver/ambulance to a patient and update patient record
    """
    try:
        from bson import ObjectId
        
        patient_id = request.patient_id
        driver_id = request.driver_id
        driver_name = request.driver_name
        ambulance_id = request.ambulance_id
        vehicle_number = request.vehicle_number
        
        print(f"🚑 ASSIGNING DRIVER TO PATIENT:")
        print(f"   Patient ID: {patient_id}")
        print(f"   Driver ID: {driver_id}")
        print(f"   Driver Name: {driver_name}")
        print(f"   Ambulance ID: {ambulance_id}")
        print(f"   Vehicle Number: {vehicle_number}")
        
        # Get the patients collection
        patients_collection = database["patients"]
        
        # Check if patient exists
        patient = await patients_collection.find_one({"patient_id": patient_id})
        
        if not patient:
            raise HTTPException(status_code=404, detail="Patient not found")
        
        # Prepare the ambulance assignment data
        ambulance_assignment = {
            "driver_id": driver_id,
            "driver_name": driver_name,
            "ambulance_id": ambulance_id,
            "vehicle_number": vehicle_number,
            "assigned_at": datetime.utcnow().isoformat(),
            "status": "assigned"
        }
        
        # 1️⃣ Update patient with ambulance driver information
        update_result = await patients_collection.update_one(
            {"patient_id": patient_id},
            {
                "$set": {
                    "ambulance_driver": ambulance_assignment,
                    "dispatch_status": "assigned",
                    "dispatch_updated_at": datetime.utcnow().isoformat()
                },
                "$push": {
                    "ambulance_assignment_history": ambulance_assignment
                }
            }
        )
        
        if update_result.matched_count == 0:
            raise HTTPException(status_code=404, detail="Failed to update patient record")
        
        print(f"✅ Updated patients collection with ambulance_driver")
        
        # 2️⃣ ALSO save to ambulance_assignments collection for dashboard
        ambulance_assignments_collection = database["ambulance_assignments"]
        
        # Prepare patient data for assignment
        patient_data_for_assignment = {
            "fullName": patient.get("fullName", ""),
            "age": patient.get("age", ""),
            "gender": patient.get("gender", ""),
            "phoneNumber": patient.get("phoneNumber", ""),
            "address": patient.get("address", ""),
            "accidentDetails": patient.get("accidentDetails", {}),
            "emergencyContact": patient.get("emergencyContact", {}),
            "registrationDate": patient.get("registrationDate", ""),
            "status": patient.get("status", "registered")
        }
        
        # Check if already assigned to this ambulance
        existing_assignment = await ambulance_assignments_collection.find_one({
            "patient_id": patient_id
        })
        
        if existing_assignment:
            # Update existing assignment
            await ambulance_assignments_collection.update_one(
                {"patient_id": patient_id},
                {
                    "$set": {
                        "driver_id": driver_id,
                        "driver_name": driver_name,
                        "ambulance_id": ambulance_id,
                        "ambulance_number": vehicle_number,
                        "status": "dispatched",
                        "patient_data": patient_data_for_assignment,
                        "updated_at": datetime.utcnow().isoformat(),
                        "assigned_at": datetime.utcnow().isoformat()
                    }
                }
            )
            print(f"✅ Updated existing assignment in ambulance_assignments")
        else:
            # Create new assignment record
            assignment_doc = {
                "patient_id": patient_id,
                "driver_id": driver_id,
                "driver_name": driver_name,
                "ambulance_id": ambulance_id,
                "ambulance_number": vehicle_number,
                "assigned_at": datetime.utcnow().isoformat(),
                "status": "dispatched",
                "patient_data": patient_data_for_assignment,
                "created_at": datetime.utcnow().isoformat()
            }
            await ambulance_assignments_collection.insert_one(assignment_doc)
            print(f"✅ Created NEW assignment in ambulance_assignments")
        
        # 3️⃣ Update the driver's collection
        ambulancedrivers_collection = database["ambulancedrivers_collection"]
        
        await ambulancedrivers_collection.update_one(
            {"driverId": driver_id},
            {
                "$set": {
                    "current_patient": patient_id,
                    "dispatch_status": "on_duty",
                    "last_assigned_at": datetime.utcnow().isoformat()
                },
                "$addToSet": {
                    "assigned_patients": patient_id
                }
            }
        )
        print(f"✅ Updated driver collection")
        
       # 4️⃣ Notify driver via WebSocket
        try:
            patient_doc = await patients_collection.find_one({"patient_id": patient_id})
            await driver_manager.send_to_driver(driver_id, {
                "type": "DISPATCH",
                "patient": {
                    "id": patient_id,
                    "patient_id": patient_id,
                    "fullName": patient_doc.get("fullName") if patient_doc else "",
                    "patient_name": patient_doc.get("fullName") if patient_doc else "",
                    "age": patient_doc.get("age") if patient_doc else "",
                    "gender": patient_doc.get("gender") if patient_doc else "",
                    "phoneNumber": patient_doc.get("phoneNumber") if patient_doc else "",
                    "accidentDetails": patient_doc.get("accidentDetails") if patient_doc else {},
                    "emergencyContact": patient_doc.get("emergencyContact") if patient_doc else {},
                    "registrationDate": patient_doc.get("registrationDate") if patient_doc else "",
                    "status": "active",
                    "ambulance_driver": {
                        "driver_id": driver_id,
                        "driver_name": driver_name,
                        "vehicle_number": vehicle_number,
                        "ambulance_id": ambulance_id
                    }
                }
            })
            print(f"✅ WebSocket notification sent to driver: {driver_id}")
        except Exception as ws_error:
            print(f"⚠️ WebSocket notification failed (non-critical): {str(ws_error)}")

        # 5️⃣ Notify driver via push notification (reaches them even if app is closed)
        try:
            driver_record = await ambulancedrivers_collection.find_one(
                {"driverId": driver_id}, {"push_token": 1}
            )
            if driver_record and driver_record.get("push_token"):
                patient_name = patient_doc.get("fullName") if patient_doc else "Unknown patient"
                await send_push_notification(
                    driver_record["push_token"],
                    "🚨 New Emergency Dispatch",
                    f"{patient_name} has been assigned to you",
                    {"type": "DISPATCH", "patient_id": patient_id},
                )
                print(f"✅ Push notification sent to driver: {driver_id}")
            else:
                print(f"⚠️ No push token found for driver: {driver_id}")
        except Exception as push_error:
            print(f"⚠️ Push notification failed (non-critical): {str(push_error)}")
        
        print(f"✅ Successfully assigned driver {driver_name} to patient {patient_id}")
        
        return {
            "status": "success",
            "message": f"Driver {driver_name} assigned to patient successfully",
            "data": {
                "patient_id": patient_id,
                "driver_id": driver_id,
                "driver_name": driver_name,
                "ambulance_id": ambulance_id,
                "vehicle_number": vehicle_number,
                "assigned_at": datetime.utcnow().isoformat()
            }
        }
        
    except HTTPException:
        raise
    except Exception as e:
        print(f"❌ Error assigning driver: {str(e)}")
        import traceback
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=f"Assignment failed: {str(e)}")
@router.get("/patient/{patient_id}/ambulance")
async def get_patient_assigned_ambulance(patient_id: str):
    """
    Get the ambulance/driver assigned to a patient
    """
    try:
        logger.info(f"Fetching assigned ambulance for patient: {patient_id}")
        
        # FIXED: Use database["patients"] instead of emergency_patients_collection
        patients_collection = database["patients"]
        
        patient = await patients_collection.find_one(
            {"patient_id": patient_id},
            {"_id": 0, "ambulance_driver": 1, "dispatch_status": 1, "dispatch_updated_at": 1}
        )
        
        if not patient:
            raise HTTPException(status_code=404, detail="Patient not found")
        
        return {
            "status": "success",
            "data": {
                "patient_id": patient_id,
                "ambulance_assignment": patient.get("ambulance_driver"),
                "dispatch_status": patient.get("dispatch_status"),
                "assigned_at": patient.get("dispatch_updated_at")
            }
        }
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Failed to fetch assigned ambulance: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))
@router.get("/patients/by-driver/{driver_id}")
async def get_patients_by_driver(driver_id: str, today_only: bool = False):
    """
    Get all patients assigned to a specific driver
    """
    try:
        logger.info(f"Fetching patients for driver ID: {driver_id}")
        
        query = {
            "ambulance_driver.driver_id": driver_id
        }
        
        if today_only:
            today = datetime.now().strftime("%Y-%m-%d")
            query["accidentDetails.accidentDate"] = today
        
        patients = list(emergency_patients_collection.find(
            query,
            {"_id": 0}
        ).sort("created_at", -1))
        
        return {
            "status": "success",
            "total": len(patients),
            "patients": patients
        }
        
    except Exception as e:
        logger.error(f"Failed to fetch patients by driver: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))


@router.delete("/ambulance/driver/delete/{driver_id}")
async def delete_driver(driver_id: str):
    try:
        # Check if driver exists
        existing_driver = await ambulancedrivers_collection.find_one({"driverId": driver_id})
        if not existing_driver:
            raise HTTPException(status_code=404, detail="Driver not found")
        
        # Delete driver
        result = await ambulancedrivers_collection.delete_one({"driverId": driver_id})
        
        return {
            "status": "success",
            "message": f"Driver with ID {driver_id} deleted successfully",
            "deleted_count": result.deleted_count
        }

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Internal server error: {str(e)}")
    

class AmbulanceRegisterNew(BaseModel):
    registrationNumber: str
    type: str = "basic"
    location: Optional[Dict[str, Any]] = None
    password: str
    organization: str
    make: str
    model: str
    year: int
@router.post("/ambulance/register/v2")
async def register_ambulance_v2(ambulance_data: AmbulanceRegisterNew):
    """
    Register a new ambulance in the ambulance_collection with new format
    """
    logger.info("=" * 50)
    logger.info("AMBULANCE REGISTRATION V2 API CALLED")
    logger.info(f"Registration Number: {ambulance_data.registrationNumber}")
    
    try:
        # Check if ambulance already exists
        existing = await database["ambulance_collection"].find_one({
            "vehicleRegNumber": ambulance_data.registrationNumber
        })
        
        if existing:
            return JSONResponse(
                status_code=400,
                content={
                    "status": "error",
                    "message": f"Ambulance with Registration Number '{ambulance_data.registrationNumber}' already exists"
                }
            )
        
        # Generate unique IDs
        vehicle_id = f"AMB_{int(datetime.now().timestamp())}{str(uuid.uuid4())[:4]}"
        ambulance_number = f"AMB{str(uuid.uuid4())[:6].upper()}"
        
        # Extract coordinates if provided
        latitude = None
        longitude = None
        address = "Unknown Location"
        
        if ambulance_data.location:
            address = ambulance_data.location.get("address", "Unknown Location")
            coordinates = ambulance_data.location.get("coordinates", [])
            if len(coordinates) == 2:
                longitude = coordinates[0]  # Note: [lng, lat] order
                latitude = coordinates[1]
        
        # Prepare document for insertion (matching your existing collection structure)
        ambulance_doc = {
            "vehicleId": vehicle_id,
            "ambulanceNumber": ambulance_number,
            "vehicleRegNumber": ambulance_data.registrationNumber,
            "vehicleMake": ambulance_data.make,
            "vehicleModel": ambulance_data.model,
            "manufacturingYear": str(ambulance_data.year),
            "ambulanceType": ambulance_data.type,
            "is_active": True,
            "status": "Available",
            "createdAt": datetime.utcnow().isoformat(),
            "updatedAt": datetime.utcnow().isoformat(),
            "location": {
                "address": address,
                "latitude": latitude,
                "longitude": longitude,
                "last_updated": datetime.utcnow().isoformat()
            },
            "organization": ambulance_data.organization,
            "password": ambulance_data.password,  # Store if needed for device auth
            # Default values for optional fields
            "chassisNumber": "",
            "engineNumber": "",
            "rtoRegistrationDate": "",
            "registrationAuthority": "",
            "fitnessCertificateValidity": "",
            "insuranceProvider": "",
            "insurancePolicyNumber": "",
            "insuranceExpiryDate": "",
            "pollutionCertificateValidity": "",
            "vehicleCategory": "",
            "fuelType": "",
            "seatingCapacity": "",
            "engineCapacity": "",
            "transmissionType": "",
            "oxygenCylinderFitted": "No",
            "stretcherAvailability": "Yes",
            "ventilatorInstalled": "No",
            "defibrillatorInstalled": "No",
            "sirenEmergencyLights": "Yes",
            "engaged": None
        }
        
        # Insert into database
        result = await database["ambulance_collection"].insert_one(ambulance_doc)
        
        # Optional: Create auth record for ambulance device if needed
        # You may want to store password in a separate auth collection
        
        logger.info(f"Ambulance registered successfully with ID: {result.inserted_id}")
        
        return {
            "success": True,
            "data": {
                "ambulanceId": vehicle_id,
                "ambulanceNumber": ambulance_number,
                "loginEnabled": True,
                "registrationNumber": ambulance_data.registrationNumber,
                "type": ambulance_data.type,
                "status": "available",
                "isActive": True,
                "vehicleDetails": {
                    "make": ambulance_data.make,
                    "model": ambulance_data.model,
                    "year": ambulance_data.year
                },
                "location": {
                    "coordinates": [longitude, latitude] if latitude else None,
                    "address": address,
                    "lastUpdated": datetime.utcnow().isoformat()
                },
                "createdAt": datetime.utcnow().isoformat(),
                "updatedAt": datetime.utcnow().isoformat()
            }
        }
        
    except Exception as e:
        logger.error(f"Error in ambulance registration V2: {str(e)}")
        return JSONResponse(
            status_code=500,
            content={
                "status": "error",
                "message": f"Registration failed: {str(e)}"
            }
        )
# Add this at the top of ambulance_routes.py
import asyncio
from datetime import datetime, timedelta

# Shared token cache (accessible across routes)
ZENZO_TOKEN_CACHE = {
    "token": None,
    "expires_at": None
}

# You can also expose a way to set the token from customer_care.py
@router.post("/set-zenzo-token")
async def set_zenzo_token(request: Request):
    """Allow customer_care to share the ZENZO token"""
    try:
        body = await request.json()
        token = body.get("token")
        expires_in = body.get("expires_in", 82800)  # Default 23 hours
        
        if token:
            ZENZO_TOKEN_CACHE["token"] = token
            ZENZO_TOKEN_CACHE["expires_at"] = datetime.now() + timedelta(seconds=expires_in)
            logger.info("ZENZO token cached from customer_care")
            return {"success": True, "message": "Token cached"}
        return {"success": False, "error": "No token provided"}
    except Exception as e:
        return {"success": False, "error": str(e)}

@router.get("/get-zenzo-token")
async def get_cached_zenzo_token():
    """Get cached ZENZO token status"""
    return {
        "has_token": ZENZO_TOKEN_CACHE["token"] is not None,
        "expires_at": ZENZO_TOKEN_CACHE["expires_at"].isoformat() if ZENZO_TOKEN_CACHE["expires_at"] else None,
        "is_valid": ZENZO_TOKEN_CACHE["expires_at"] and datetime.now() < ZENZO_TOKEN_CACHE["expires_at"] if ZENZO_TOKEN_CACHE["expires_at"] else False
    }

def get_shared_zenzo_token():
    """Get ZENZO token from shared file"""
    try:
        from datetime import datetime
        import tempfile
        
        ZENZO_TOKEN_FILE = os.path.join(tempfile.gettempdir(), "zenzo_token.json")
        
        if os.path.exists(ZENZO_TOKEN_FILE):
            with open(ZENZO_TOKEN_FILE, 'r') as f:
                data = json.load(f)
                token = data.get("token")
                expires_at = data.get("expires_at")
                
                if expires_at:
                    expires_at_dt = datetime.fromisoformat(expires_at)
                    if datetime.now() < expires_at_dt:
                        logger.info(f"✅ Token is valid (expires: {expires_at})")
                        return token
                    else:
                        logger.info("⚠️ Token has expired")
                else:
                    return token
        else:
            logger.info("❌ Token file not found")
    except Exception as e:
        logger.error(f"Failed to read token: {e}")
    return None
@router.post("/zenzo-ambulance-register")
async def zenzo_ambulance_register(request: Request):
    """
    Proxy endpoint to call ZENZO external API and save credentials
    """
    try:
        body = await request.json()
        registration_number = body.get("registrationNumber")
        access_token = body.get("accessToken")
        ambulance_password = body.get("password")  # Get the password from request
        
        if not access_token:
            return JSONResponse(
                status_code=401,
                content={"success": False, "error": "Access token missing"}
            )
        
        # Remove token from payload
        body.pop("accessToken", None)
        
        # Step 1: Register ambulance with ZENZO
        async with httpx.AsyncClient() as client:
            register_response = await client.post(
                "https://zenzo.theapothecary.co.in:9500/api/ambulances/external",
                json=body,
                headers={
                    "Authorization": f"Bearer {access_token}",
                    "Content-Type": "application/json"
                },
                timeout=30.0
            )
        
        if register_response.status_code not in [200, 201]:
            return JSONResponse(
                status_code=register_response.status_code,
                content={"success": False, "error": "ZENZO registration failed"}
            )
        
        zenzo_data = register_response.json()
        
        if not zenzo_data.get("success") or not zenzo_data.get("data"):
            return JSONResponse(
                status_code=400,
                content={"success": False, "error": "Invalid ZENZO response"}
            )
        
        zenzo_ambulance = zenzo_data["data"]
        zenzo_ambulance_number = zenzo_ambulance.get("ambulanceNumber")
        
        # Step 2: Try to login with the provided password to verify/create credentials
        login_success = False
        login_tokens = None
        
        try:
            # First, try to login with the password we have
            login_response = await client.post(
                "https://zenzo.theapothecary.co.in:9500/api/ambulance-auth/api-login",
                json={
                    "ambulanceNumber": zenzo_ambulance_number,
                    "password": ambulance_password
                },
                timeout=30.0
            )
            
            if login_response.status_code == 200:
                login_success = True
                login_tokens = login_response.json().get("tokens")
                logger.info(f"✅ Login successful for {zenzo_ambulance_number}")
            else:
                logger.warning(f"⚠️ Login failed for {zenzo_ambulance_number}. Password may need setup.")
        except Exception as login_error:
            logger.error(f"Login attempt error: {str(login_error)}")
        
        # Step 3: Save all credentials to local database
        update_result = await database["ambulance_collection"].update_one(
            {"vehicleRegNumber": registration_number},
            {"$set": {
                "zenzo_ambulance_number": zenzo_ambulance_number,
                "zenzo_id": zenzo_ambulance.get("_id"),
                "zenzo_api_token": zenzo_ambulance.get("apiAuth", {}).get("token"),
                "zenzo_login_password": ambulance_password,  # Store the password
                "zenzo_login_working": login_success,
                "zenzo_tokens": login_tokens,
                "zenzo_credentials": {
                    "ambulanceNumber": zenzo_ambulance_number,
                    "api_token": zenzo_ambulance.get("apiAuth", {}).get("token"),
                    "login_password": ambulance_password,
                    "login_working": login_success,
                    "registered_at": datetime.utcnow().isoformat()
                },
                "synced_with_zenzo": True,
                "zenzo_sync_at": datetime.utcnow().isoformat()
            }}
        )
        
        # Return response with login info
        return JSONResponse(
            status_code=200,
            content={
                "success": True,
                "data": zenzo_ambulance,
                "login_credentials": {
                    "ambulanceNumber": zenzo_ambulance_number,
                    "password": ambulance_password,
                    "login_working": login_success
                },
                "tokens": login_tokens if login_success else None
            }
        )
        
    except Exception as e:
        logger.exception(f"Error: {str(e)}")
        return JSONResponse(status_code=500, content={"success": False, "error": str(e)})

@router.post("/zenzo-ambulance-login")
async def zenzo_ambulance_login(request: Request):

    print("🔐 ZENZO LOGIN ENDPOINT CALLED")

    body = await request.json()

    ambulance_number = body.get("ambulanceNumber")
    password = body.get("password")

    print(f"🚑 Ambulance Number: {ambulance_number}")
    print(f"🔑 Password: {password}")

    try:

        print("🌐 CALLING ZENZO EXTERNAL LOGIN API")

        # =========================
        # GET REQUEST BODY
        # =========================
        body = await request.json()

        print("🔥 ZENZO LOGIN ROUTE HIT")

        logger.info(
            f"📦 Login Request:\n{json.dumps(body, indent=2)}"
        )

        ambulance_number = body.get("ambulanceNumber")

        logger.info(
            f"🟡 Logging in ambulance: {ambulance_number}"
        )

        # =========================
        # VALIDATION
        # =========================
        if not body.get("ambulanceNumber"):
            return JSONResponse(
                status_code=400,
                content={
                    "success": False,
                    "error": "ambulanceNumber is required"
                }
            )

        if not body.get("password"):
            return JSONResponse(
                status_code=400,
                content={
                    "success": False,
                    "error": "password is required"
                }
            )

        # =========================
        # CALL ZENZO LOGIN API
        # =========================
        async with httpx.AsyncClient() as client:

            response = await client.post(
                "https://zenzo.theapothecary.co.in:9500/api/ambulance-auth/api-login",

                json={
                    "ambulanceNumber": body.get("ambulanceNumber"),
                    "password": body.get("password")
                },

                headers={
                    "Content-Type": "application/json"
                },

                timeout=30.0
            )

        # =========================
        # LOG RESPONSE
        # =========================
        logger.info(
            f"📡 ZENZO LOGIN STATUS: {response.status_code}"
        )

        logger.info(
            f"📨 ZENZO LOGIN RESPONSE: {response.text}"
        )

        # =========================
        # RETURN RESPONSE
        # =========================
        try:
            data = response.json()

        except Exception:
            data = {
                "message": response.text
            }

        return JSONResponse(
            status_code=response.status_code,
            content=data
        )

    # =========================
    # TIMEOUT
    # =========================
    except httpx.TimeoutException:

        logger.error("⏰ ZENZO LOGIN TIMEOUT")

        return JSONResponse(
            status_code=504,
            content={
                "success": False,
                "error": "ZENZO login timeout"
            }
        )

    # =========================
    # GENERAL ERROR
    # =========================
    except Exception as e:

        logger.exception(
            f"❌ ZENZO LOGIN ERROR: {str(e)}"
        )

        return JSONResponse(
            status_code=500,
            content={
                "success": False,
                "error": str(e)
            }
        )

@router.delete("/ambulance/drivers/delete-all")
async def delete_all_drivers(confirm: str = Query(..., description="Type 'CONFIRM' to delete all drivers")):
    """
    Delete all ambulance drivers
    WARNING: This action is irreversible
    """
    try:
        # Safety confirmation
        if confirm != "CONFIRM":
            raise HTTPException(
                status_code=400,
                detail="Please provide confirm=CONFIRM to delete all drivers"
            )

        # Count before delete
        total_drivers = await ambulancedrivers_collection.count_documents({})

        # Delete all drivers
        result = await ambulancedrivers_collection.delete_many({})

        return {
            "status": "success",
            "message": "All drivers deleted successfully",
            "total_found": total_drivers,
            "deleted_count": result.deleted_count,
            "deleted_at": datetime.utcnow().isoformat()
        }

    except HTTPException:
        raise

    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=f"Internal server error: {str(e)}"
        )


@router.delete("/ambulance/delete-all")
async def delete_all_ambulances(confirm: str = Query(...)):
    """
    Delete all ambulances from ambulance_collection
    """

    try:
        # Safety confirmation
        if confirm != "CONFIRM":
            raise HTTPException(
                status_code=400,
                detail="Please pass confirm=CONFIRM"
            )

        # Count existing ambulances
        total_ambulances = await ambulance_collection.count_documents({})

        # Delete all ambulances
        result = await ambulance_collection.delete_many({})

        return {
            "status": "success",
            "message": "All ambulances deleted successfully",
            "total_found": total_ambulances,
            "deleted_count": result.deleted_count,
            "deleted_at": datetime.utcnow().isoformat()
        }

    except HTTPException:
        raise

    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=f"Internal server error: {str(e)}"
        )


# Mongo Collection
ambulance_patient_clicks_collection = database["ambulance_patient_clicks"]


# Request Model
class AmbulancePatientClickRequest(BaseModel):
    id: str
    patient_id: str
    appointment_id: str = ""
    iframeUrl: str = ""
    ambulance: str = ""


@router.post("/ambulance/patient-click/save")
async def save_patient_click(data: AmbulancePatientClickRequest):

    try:

        logger.info(
            f"Saving clicked patient: {data.patient_id}"
        )

        document = {

            "id": data.id,

            "patient_id": data.patient_id,

            "appointment_id": data.appointment_id,

            "iframeUrl": data.iframeUrl,
            "ambulance": data.ambulance,

            "timestamp": datetime.now(),

            "date": datetime.now().strftime("%Y-%m-%d"),

            "time": datetime.now().strftime("%H:%M:%S"),

            "created_at": datetime.now()
        }

        result = await ambulance_patient_clicks_collection.insert_one(
            document
        )

        logger.info(
            f"Saved click ID: {result.inserted_id}"
        )
        logger.info(
            f"Saved click ID: {result.inserted_id}"
        )

        return {

            "status": "success",

            "message": "Patient click saved",

            "inserted_id": str(result.inserted_id),

            "patient_id": data.patient_id
        }

    except Exception as e:

        logger.error(
            f"Failed saving patient click: {str(e)}"
        )

        raise HTTPException(
            status_code=500,
            detail=str(e)
        )

# class UpdatePatientClickRequest(BaseModel):

#     patient_id: str

#     appointment_id: str = ""

#     iframeUrl: str = ""
#     ambulance: str = ""

# @router.post(
#     "/ambulance/patient-click/update"
# )
# async def update_patient_click(
#     data: UpdatePatientClickRequest
# ):

#     try:

#         # ✅ GET LATEST RECORD
#         latest_record = await (
#             ambulance_patient_clicks_collection
#             .find(
#                 {
#                     "patient_id":
#                         data.patient_id
#                 }
#             )
#             .sort("created_at", -1)
#             .to_list(length=1)
#         )

#         if not latest_record:

#             raise HTTPException(
#                 status_code=404,
#                 detail="No patient record found"
#             )

#         latest_id = latest_record[0]["_id"]

#         # ✅ UPDATE LATEST RECORD
#         await ambulance_patient_clicks_collection.update_one(

#             {
#                 "_id": latest_id
#             },

#             {
#                 "$set": {

#                     "appointment_id":
#                         data.appointment_id,

#                     "iframeUrl":
#                         data.iframeUrl,

#                    "ambulance":
#                         data.ambulance,

#                     "updated_at":
#                         datetime.now()
#                 }
#             }
#         )

#         return {
#             "status": "success"
#         }

#     except Exception as e:

#         raise HTTPException(
#             status_code=500,
#             detail=str(e)
#         )

class PatientClickUpdate(BaseModel):
    patient_id: str
    appointment_id: Optional[str] = ""
    iframeUrl: Optional[str] = ""
    ambulance: Optional[str] = ""
    status: Optional[str] = None

@router.post("/ambulance/patient-click/update")
async def update_patient_click(data: PatientClickUpdate):

    try:

        print("\n========== PATIENT CLICK UPDATE ==========")

        print("PATIENT ID:", data.patient_id)
        print("APPOINTMENT ID:", data.appointment_id)
        print("IFRAME URL:", data.iframeUrl)
        print("AMBULANCE:", data.ambulance)

        # ✅ COLLECTION
        patient_click_collection = database["patient_click"]

        # ✅ UPDATE QUERY
        result = await patient_click_collection.update_one(

            {
                "patient_id": data.patient_id
            },

            {
                "$set": {

                    "patient_id": data.patient_id,

                    "appointment_id": data.appointment_id,

                    "iframeUrl": data.iframeUrl,

                    "ambulance": data.ambulance,

                    "status": data.status if getattr(data, "status", None) else "active",

                    "updated_at": datetime.utcnow().isoformat()
                },

                "$setOnInsert": {

                    "created_at": datetime.utcnow().isoformat()
                }
            },

            upsert=True
        
        )

        print("MATCHED:", result.matched_count)
        print("MODIFIED:", result.modified_count)

        print("========== UPDATE SUCCESS ==========\n")

        return {

            "status": "success",

            "message": "Patient click updated successfully",

            "data": {

                "patient_id": data.patient_id,

                "appointment_id": data.appointment_id,

                "iframeUrl": data.iframeUrl,

                "ambulance": data.ambulance
            }
        }

    except Exception as e:

        print("❌ UPDATE ERROR:", str(e))

        raise HTTPException(
            status_code=500,
            detail=str(e)
        )
@router.get("/ambulance/patient-click/latest/{patient_id}")
async def get_latest_patient_click(patient_id: str):

    try:

        print("\n========== GET LATEST PATIENT CLICK ==========")

        print("PATIENT ID:", patient_id)

        patient_click_collection = database["patient_click"]

        # ✅ GET LATEST UPDATED RECORD
        data = await patient_click_collection.find_one(

            {
                "patient_id": patient_id
            },

            sort=[("updated_at", -1)]
        )

        if not data:

            return {
                "status": "success",
                "data": None
            }

        # ✅ CONVERT OBJECTID
        if "_id" in data:
            data["_id"] = str(data["_id"])

        print("FOUND DATA:", data)

        print("========== FETCH SUCCESS ==========\n")

        return {

            "status": "success",

            "data": data
        }

    except Exception as e:

        print("❌ FETCH ERROR:", str(e))

        raise HTTPException(
            status_code=500,
            detail=str(e)
        )


@router.delete("/ambulance/delete/{vehicle_id}")
async def delete_ambulance(vehicle_id: str):
    """
    Delete ambulance by vehicle ID
    """
    try:
        # Check if ambulance exists
        existing_ambulance = await ambulance_collection.find_one(
            {"vehicleId": vehicle_id}
        )

        if not existing_ambulance:
            raise HTTPException(
                status_code=404,
                detail="Ambulance not found"
            )

        # Delete ambulance
        result = await ambulance_collection.delete_one(
            {"vehicleId": vehicle_id}
        )

        return {
            "status": "success",
            "message": f"Ambulance with ID {vehicle_id} deleted successfully",
            "deleted_count": result.deleted_count
        }

    except HTTPException:
        raise

    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=f"Internal server error: {str(e)}"
        )


# =========================================================
# ZENZO DOCTOR LOGIN
# =========================================================
# =========================================================
# ZENZO DOCTOR LOGIN
# =========================================================
@router.post("/zenzo-doctor-login")
async def zenzo_doctor_login(request: Request):

    try:

        # =====================================================
        # REQUEST BODY
        # =====================================================
        body = await request.json()

        print("🩺 ZENZO DOCTOR LOGIN CALLED")

        print("📨 REQUEST BODY:")

        print(body)

        # =====================================================
        # VALIDATION
        # =====================================================
        if not body.get("email"):

            return JSONResponse(
                status_code=400,
                content={
                    "success": False,
                    "error": "email is required"
                }
            )

        if not body.get("password"):

            return JSONResponse(
                status_code=400,
                content={
                    "success": False,
                    "error": "password is required"
                }
            )

        # =====================================================
        # CALL ZENZO LOGIN API
        # =====================================================
        async with httpx.AsyncClient(

            timeout=httpx.Timeout(120.0),

            verify=False

        ) as client:

            print("🌐 CALLING ZENZO API")

            response = await client.post(

                "https://zenzo.theapothecary.co.in:9500/api/doctor-auth/login",

                json={

                    "email": body.get("email"),

                    "password": body.get("password")
                },

                headers={
                    "Content-Type": "application/json"
                },

                follow_redirects=True
            )

        # =====================================================
        # LOG RESPONSE
        # =====================================================
        print("📡 STATUS:", response.status_code)

        print("📨 RESPONSE TEXT:")

        print(response.text)

        # =====================================================
        # PARSE RESPONSE
        # =====================================================
        try:

            data = response.json()

        except Exception:

            print("❌ INVALID JSON RESPONSE")

            return JSONResponse(

                status_code=500,

                content={

                    "success": False,

                    "error": "Invalid response from Zenzo",

                    "raw": response.text
                }
            )

        # =====================================================
        # EXTRACT ACCESS TOKEN
        # =====================================================
        cookies = response.cookies

        print("🍪 COOKIES:")

        print(cookies)

        access_token = cookies.get("refreshToken") or cookies.get("accessToken")

        print("🔑 ACCESS TOKEN:")

        print(access_token)

        # =====================================================
        # ADD TOKEN TO RESPONSE
        # =====================================================
        if isinstance(data, dict):

            data["accessToken"] = access_token

        # =====================================================
        # RETURN RESPONSE
        # =====================================================
        return JSONResponse(

            status_code=response.status_code,

            content=data
        )

    # =========================================================
    # TIMEOUT ERROR
    # =========================================================
    except httpx.ConnectTimeout:

        print("❌ ZENZO CONNECTION TIMEOUT")

        return JSONResponse(

            status_code=504,

            content={

                "success": False,

                "error": "Zenzo server timeout"
            }
        )

    # =========================================================
    # GENERAL ERROR
    # =========================================================
    except Exception as e:

        print("❌ ZENZO LOGIN ERROR")

        print(str(e))

        return JSONResponse(

            status_code=500,

            content={

                "success": False,

                "error": str(e)
            }
        )


@router.patch("/zenzo/appointments/{appointment_id}/assign-doctor")
async def assign_doctor(
    appointment_id: str,
    request: Request
):

    print("\n" + "=" * 80)
    print("🚑 ZENZO ASSIGN DOCTOR API CALLED")
    print("=" * 80)

    try:

        # =========================================================
        # REQUEST BODY
        # =========================================================
        body = await request.json()

        print("📦 REQUEST BODY:")
        print(json.dumps(body, indent=2))

        access_token = body.get("accessToken")

        print(f"🆔 APPOINTMENT ID: {appointment_id}")

        if access_token:
            print(f"🔑 ACCESS TOKEN FOUND: {access_token[:40]}...")
        else:
            print("❌ ACCESS TOKEN MISSING")

        # =========================================================
        # CALL ZENZO API
        # =========================================================
        print("🌐 CALLING ZENZO ASSIGN DOCTOR API...")

        async with httpx.AsyncClient() as client:

            response = await client.patch(
                f"https://zenzo.theapothecary.co.in:9500/api/appointments/{appointment_id}/assign-doctor",

                json={},

                headers={
                    "Authorization": f"Bearer {access_token}",
                    "Content-Type": "application/json"
                },

                timeout=30.0
            )

        # =========================================================
        # RESPONSE LOGS
        # =========================================================
        print(f"📡 STATUS CODE: {response.status_code}")

        print("📨 RESPONSE TEXT:")
        print(response.text)

        print("📨 RESPONSE HEADERS:")
        print(dict(response.headers))

        # =========================================================
        # PARSE RESPONSE
        # =========================================================
        try:
            data = response.json()

            print("✅ RESPONSE JSON:")
            print(json.dumps(data, indent=2))

        except Exception as parse_error:

            print("❌ JSON PARSE ERROR:")
            print(str(parse_error))

            data = {
                "message": response.text
            }

        print("✅ ASSIGN DOCTOR API COMPLETED")
        print("=" * 80 + "\n")

        return JSONResponse(
            status_code=response.status_code,
            content=data
        )

    # =========================================================
    # TIMEOUT
    # =========================================================
    except httpx.TimeoutException:

        print("⏰ ZENZO ASSIGN DOCTOR TIMEOUT")

        return JSONResponse(
            status_code=504,
            content={
                "success": False,
                "error": "Zenzo assign doctor timeout"
            }
        )

    # =========================================================
    # GENERAL ERROR
    # =========================================================
    except Exception as e:

        print("❌ ZENZO ASSIGN DOCTOR ERROR")
        print(str(e))

        import traceback
        traceback.print_exc()

        return JSONResponse(
            status_code=500,
            content={
                "success": False,
                "error": str(e)
            }
        )
    
@router.post("/zenzo/tokens/doctor")
async def zenzo_doctor_token(request: Request):

    print("\n" + "=" * 80)
    print("🩺 ZENZO DOCTOR TOKEN API CALLED")
    print("=" * 80)

    try:

        # =========================================================
        # REQUEST BODY
        # =========================================================
        body = await request.json()

        print("📦 REQUEST BODY:")
        print(json.dumps(body, indent=2))

        access_token = body.get("accessToken")

        appointment = body.get("appointment")
        ambulance = body.get("ambulance")
        email = body.get("email")

        print(f"🆔 APPOINTMENT: {appointment}")
        print(f"🚑 AMBULANCE: {ambulance}")
        print(f"📧 EMAIL: {email}")

        if access_token:
            print(f"🔑 ACCESS TOKEN FOUND: {access_token[:40]}...")
        else:
            print("❌ ACCESS TOKEN MISSING")

        # =========================================================
        # CALL ZENZO API
        # =========================================================
        print("🌐 CALLING ZENZO TOKEN API...")

        async with httpx.AsyncClient() as client:

            response = await client.post(
                "https://zenzo.theapothecary.co.in:9500/api/tokens/doctor",

                json={
                    "appointment": appointment,
                    "ambulance": ambulance,
                    "email": email
                },

                headers={
                    "Authorization": f"Bearer {access_token}",
                    "Content-Type": "application/json"
                },

                timeout=30.0
            )

        # =========================================================
        # RESPONSE LOGS
        # =========================================================
        print(f"📡 STATUS CODE: {response.status_code}")

        print("📨 RESPONSE TEXT:")
        print(response.text)

        print("📨 RESPONSE HEADERS:")
        print(dict(response.headers))

        # =========================================================
        # PARSE RESPONSE
        # =========================================================
        try:

            data = response.json()

            print("✅ RESPONSE JSON:")
            print(json.dumps(data, indent=2))

        except Exception as parse_error:

            print("❌ JSON PARSE ERROR:")
            print(str(parse_error))

            data = {
                "message": response.text
            }

        print("✅ TOKEN API COMPLETED")
        print("=" * 80 + "\n")

        return JSONResponse(
            status_code=response.status_code,
            content=data
        )

    # =========================================================
    # TIMEOUT
    # =========================================================
    except httpx.TimeoutException:

        print("⏰ ZENZO TOKEN API TIMEOUT")

        return JSONResponse(
            status_code=504,
            content={
                "success": False,
                "error": "Zenzo token timeout"
            }
        )

    # =========================================================
    # GENERAL ERROR
    # =========================================================
    except Exception as e:

        print("❌ ZENZO TOKEN API ERROR")
        print(str(e))

        import traceback
        traceback.print_exc()

        return JSONResponse(
            status_code=500,
            content={
                "success": False,
                "error": str(e)
            }
        )






#NEW

Ambulance_driver_accept = database["Ambulance_driver_accept"]
class AmbulancePatientAccept(BaseModel):

    patient_id: str

    patient_name: Optional[str] = ""

    driver_id: Optional[str] = ""

    driver_name: Optional[str] = ""

    ambulance_id: Optional[str] = ""

    ambulance_number: Optional[str] = ""

    accepted_status: Optional[str] = "Accepted"

    accepted_at: Optional[str] = ""

    patient_data: Optional[dict] = {}


@router.post("/ambulance/save-patient-accept")
async def save_patient_accept(data: AmbulancePatientAccept):

    try:

        logger.info("=" * 50)
        logger.info("SAVE PATIENT ACCEPT API CALLED")

        logger.info(f"Patient ID: {data.patient_id}")
        logger.info(f"Driver ID: {data.driver_id}")

        # CHECK EXISTING
        existing = await Ambulance_driver_accept.find_one({
            "patient_id": data.patient_id,
            "driver_id": data.driver_id
        })

        # ALREADY EXISTS
        if existing:

            logger.info("PATIENT ALREADY ACCEPTED")

            return {
                "status": "success",
                "message": "Already Accepted",
                "already_exists": True
            }

        # NEW SAVE
        document = {

            "patient_id": data.patient_id,

            "patient_name": data.patient_name,

            "driver_id": data.driver_id,

            "driver_name": data.driver_name,

            "ambulance_id": data.ambulance_id,

            "ambulance_number": data.ambulance_number,

            "accepted_status": "Accepted",

            "accepted_at": data.accepted_at,

            "patient_data": data.patient_data
        }

        result = await Ambulance_driver_accept.insert_one(document)

        logger.info(f"NEW ACCEPT SAVED: {result.inserted_id}")

        return {
            "status": "success",
            "message": "Accepted Saved Successfully",
            "inserted_id": str(result.inserted_id),
            "already_exists": False
        }

    except Exception as e:

        logger.error(f"SAVE ACCEPT ERROR: {str(e)}")

        return {
            "status": "failed",
            "message": str(e)
        }
@router.post("/debug/clear-accepted/{driver_id}")
async def clear_accepted_patients(driver_id: str):
    result = await Ambulance_driver_accept.delete_many({"driver_id": driver_id})
    return {
        "status": "success",
        "driver_id": driver_id,
        "deleted_count": result.deleted_count
    }
@router.get("/ambulance/get-accepted-patients/{driver_id}")
async def get_accepted_patients(driver_id: str):

    try:

        logger.info("=" * 50)
        logger.info("GET ACCEPTED PATIENTS API CALLED")

        accepted_patients = await Ambulance_driver_accept.find({
            "driver_id": driver_id
        }).to_list(length=None)

        for item in accepted_patients:
            item["_id"] = str(item["_id"])

        return {
            "status": "success",
            "count": len(accepted_patients),
            "patients": accepted_patients
        }

    except Exception as e:

        logger.error(f"GET ACCEPTED ERROR: {str(e)}")

        return {
            "status": "failed",
            "message": str(e)
        }




# 1. Get all accepted patients (for checking)
@router.get("/ambulance/get-all-accepted-patients")
async def get_all_accepted_patients():
    try:
        all_accepted = await Ambulance_driver_accept.find({}).to_list(length=None)
        for item in all_accepted:
            item["_id"] = str(item["_id"])
        return {
            "status": "success",
            "count": len(all_accepted),
            "patients": all_accepted
        }
    except Exception as e:
        return {"status": "failed", "message": str(e)}
Ambulance_driver_declined = database["Ambulance_driver_declined"]
# 2. Decline a patient (remove from driver's view)
@router.post("/ambulance/decline-patient")
async def decline_patient(data: dict):
    try:
        patient_id = data.get("patient_id")
        driver_id = data.get("driver_id")
        reason = data.get("reason", "Declined by driver")
        
        # Store declined status
        decline_record = {
            "patient_id": patient_id,
            "driver_id": driver_id,
            "reason": reason,
            "declined_at": datetime.now().isoformat()
        }
        
        # Save to declined collection
        await Ambulance_driver_declined.insert_one(decline_record)

       # ✅ CLEAR DRIVER'S CURRENT ASSIGNMENT
        if driver_id:
            await ambulancedrivers_collection.update_one(
                {"driverId": driver_id},
                {
                    "$set": {
                        "current_patient": None,
                        "dispatch_status": None,
                        "updated_at": datetime.utcnow()
                    },
                    "$pull": {"assigned_patients": patient_id}
                }
            )
            # ✅ Remove from accepted-patients list so the BUSY check stops counting it
            await Ambulance_driver_accept.delete_many(
                {"driver_id": driver_id, "patient_id": patient_id}
            )
        
        return {
            "status": "success",
            "message": "Patient declined successfully"
        }
    except Exception as e:
        return {"status": "failed", "message": str(e)}

# 3. Check if driver has declined a patient
@router.get("/ambulance/check-patient-declined/{patient_id}/{driver_id}")
async def check_patient_declined(patient_id: str, driver_id: str):
    try:
        declined = await Ambulance_driver_declined.find_one({
            "patient_id": patient_id,
            "driver_id": driver_id
        })
        
        if declined:
            return {
                "status": "success",
                "is_declined": True,
                "reason": declined.get("reason"),
                "declined_at": declined.get("declined_at")
            }
        else:
            return {"status": "success", "is_declined": False}
    except Exception as e:
        return {"status": "failed", "message": str(e)}

# Add this NEW endpoint right after your assign-driver endpoint
@router.get("/ambulance/driver/{driver_id}/assigned-patient")
async def get_driver_assigned_patient(driver_id: str):
    """
    Get the patient currently assigned to a driver
    """
    try:
        from bson import ObjectId
        
        print(f"🔍 Checking assigned patient for driver: {driver_id}")
        
        # Check driver's current assignment
        ambulancedrivers_collection = database["ambulancedrivers_collection"]
        driver = await ambulancedrivers_collection.find_one({"driverId": driver_id})
        
        if not driver:
            return {
                "status": "success",
                "has_patient": False,
                "patient": None,
                "message": "Driver not found"
            }
        
        # Check if driver has a current patient assigned
        current_patient_id = driver.get("current_patient")
        
        if not current_patient_id:
            return {
                "status": "success",
                "has_patient": False,
                "patient": None,
                "message": "No patient currently assigned"
            }
        
        # Get the assigned patient details
        patients_collection = database["patients"]
        patient = await patients_collection.find_one(
            {"patient_id": current_patient_id},
            {"_id": 0}  # Exclude MongoDB _id
        )
        
        if not patient:
            return {
                "status": "success",
                "has_patient": False,
                "patient": None,
                "message": "Patient record not found"
            }
        
        print(f"✅ Found assigned patient: {patient.get('fullName')}")
        
        return {
            "status": "success",
            "has_patient": True,
            "patient": patient,
            "assigned_at": driver.get("last_assigned_at"),
            "driver_status": driver.get("dispatch_status")
        }
        
    except Exception as e:
        print(f"❌ Error getting assigned patient: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Failed to get assigned patient: {str(e)}")


# New collection for tracking multiple ambulance assignments
ambulance_assignments_collection = database["ambulance_assignments"]

class AmbulanceAssignment(BaseModel):
    patient_id: str
    driver_id: str
    driver_name: str
    ambulance_id: str
    ambulance_number: str
    assigned_at: str
    status: str  # "dispatched", "accepted", "completed", "declined"
    patient_data: Optional[dict] = {}

@router.post("/ambulance/dispatch-patient")
async def dispatch_patient_to_ambulance(data: AmbulanceAssignment):
    """
    Dispatch a patient to a specific ambulance (creates a new assignment record)
    This does NOT overwrite existing assignments for other ambulances
    """
    try:
        # Check if this specific ambulance already has this patient assigned
        existing = await ambulance_assignments_collection.find_one({
            "patient_id": data.patient_id,
            "ambulance_id": data.ambulance_id,
            "status": {"$in": ["dispatched", "accepted"]}
        })
        
        if existing:
            return {
                "status": "success",
                "message": "Patient already dispatched to this ambulance",
                "already_exists": True
            }
        
        # Create new assignment record
        assignment_doc = {
            "patient_id": data.patient_id,
            "driver_id": data.driver_id,
            "driver_name": data.driver_name,
            "ambulance_id": data.ambulance_id,
            "ambulance_number": data.ambulance_number,
            "assigned_at": data.assigned_at,
            "status": "dispatched",
            "patient_data": data.patient_data,
            "created_at": datetime.utcnow().isoformat()
        }
        
        result = await ambulance_assignments_collection.insert_one(assignment_doc)
        
        # Send WebSocket notification to the specific driver
        await driver_manager.send_to_driver(data.driver_id, {
            "type": "DISPATCH",
            "patient": {
                "patient_id": data.patient_id,
                "fullName": data.patient_data.get("fullName"),
                "patient_name": data.patient_data.get("fullName"),
                "age": data.patient_data.get("age"),
                "gender": data.patient_data.get("gender"),
                "phoneNumber": data.patient_data.get("phoneNumber"),
                "accidentDetails": data.patient_data.get("accidentDetails", {}),
                "emergencyContact": data.patient_data.get("emergencyContact", {}),
                "status": "dispatched",
                "assignment_id": str(result.inserted_id)
            }
        })

        # Send push notification to the specific driver
        try:
            driver_record = await ambulancedrivers_collection.find_one(
                {"driverId": data.driver_id}, {"push_token": 1}
            )
            if driver_record and driver_record.get("push_token"):
                await send_push_notification(
                    driver_record["push_token"],
                    "🚨 New Emergency Dispatch",
                    f"{data.patient_data.get('fullName', 'Unknown patient')} has been assigned to you",
                    {"type": "DISPATCH", "patient_id": data.patient_id},
                )
        except Exception as push_error:
            print(f"⚠️ Push notification failed (non-critical): {str(push_error)}")

        return {
            "status": "success",
            "message": f"Patient dispatched to {data.driver_name} successfully",
            "assignment_id": str(result.inserted_id)
        }
        
    except Exception as e:
        logger.error(f"Error dispatching patient: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))
# @router.get("/ambulance/get-assigned-patients/{driver_id}")  # ← Fixed: removed extra 'b'
# async def get_assigned_patients_for_driver(driver_id: str):
#     """
#     Get all patients assigned to a specific driver (from multiple dispatches)
#     """
#     try:
#         assignments = await ambulance_assignments_collection.find({
#             "driver_id": driver_id,
#             "status": {"$in": ["dispatched", "accepted"]}
#         }).to_list(length=None)
        
#         patients = []
#         for assignment in assignments:
#             assignment["_id"] = str(assignment["_id"])
#             patients.append({
#                 "patient_id": assignment["patient_id"],
#                 "assignment_id": assignment["_id"],
#                 "patient_data": assignment.get("patient_data", {}),
#                 "assigned_at": assignment.get("assigned_at"),
#                 "status": assignment.get("status")
#             })
        
#         return {
#             "status": "success",
#             "count": len(patients),
#             "patients": patients
#         }
        
#     except Exception as e:
#         logger.error(f"Error getting assigned patients: {str(e)}")
#         return {"status": "failed", "message": str(e)}
@router.get("/ambulance/get-assigned-patients/{driver_id}")
async def get_assigned_patients_for_driver(driver_id: str):
    """
    Get all patients assigned to a specific driver (from multiple dispatches)
    """
    try:
        print(f"🔍 Getting assigned patients for driver: {driver_id}")
        
        # Initialize collections
        ambulance_assignments_collection = database["ambulance_assignments"]
        patients_collection = database["patients"]
        
        # 1️⃣ First, get assignments from ambulance_assignments collection
        assignments = await ambulance_assignments_collection.find({
            "driver_id": driver_id,
            "status": {"$in": ["dispatched", "accepted"]}
        }).to_list(length=None)
        
        print(f"📊 Found {len(assignments)} in ambulance_assignments")
        
        # 2️⃣ ALSO get patients from patients collection (as fallback)
        patients_with_driver = await patients_collection.find({
            "ambulance_driver.driver_id": driver_id,
            "status": {"$ne": "completed"}
        }).to_list(length=None)
        
        print(f"📊 Found {len(patients_with_driver)} in patients collection")
        
        # 3️⃣ Merge both sources, avoiding duplicates
        all_patients = []
        patient_ids = set()
        
        # Add from ambulance_assignments collection
        for assignment in assignments:
            patient_id = assignment.get("patient_id")
            if patient_id and patient_id not in patient_ids:
                patient_ids.add(patient_id)
                
                # Get patient_data from assignment or fetch from patients
                patient_data = assignment.get("patient_data", {})
                if not patient_data.get("fullName"):
                    # Fetch from patients collection if data is incomplete
                    patient_record = await patients_collection.find_one(
                        {"patient_id": patient_id},
                        {"_id": 0}  # ✅ Exclude _id field
                    )
                    if patient_record:
                        patient_data = patient_record
                
                # ✅ Convert ObjectId to string for assignment _id
                assignment_id = str(assignment.get("_id")) if assignment.get("_id") else patient_id
                
                all_patients.append({
                    "patient_id": patient_id,
                    "assignment_id": assignment_id,
                    "patient_data": patient_data,
                    "assigned_at": assignment.get("assigned_at"),
                    "status": assignment.get("status", "dispatched"),
                    "driver_id": assignment.get("driver_id"),
                    "driver_name": assignment.get("driver_name"),
                    "ambulance_id": assignment.get("ambulance_id"),
                    "ambulance_number": assignment.get("ambulance_number")
                })
        
        # Add from patients collection (only if not already added)
        for patient in patients_with_driver:
            patient_id = patient.get("patient_id")
            if patient_id and patient_id not in patient_ids:
                patient_ids.add(patient_id)
                
                ambulance_driver = patient.get("ambulance_driver", {})
                
                # ✅ Remove any ObjectId from patient data
                clean_patient = {
                    "fullName": patient.get("fullName", ""),
                    "age": patient.get("age", ""),
                    "gender": patient.get("gender", ""),
                    "phoneNumber": patient.get("phoneNumber", ""),
                    "address": patient.get("address", ""),
                    "accidentDetails": patient.get("accidentDetails", {}),
                    "emergencyContact": patient.get("emergencyContact", {}),
                    "registrationDate": patient.get("registrationDate", ""),
                    "status": patient.get("status", "")
                }
                
                all_patients.append({
                    "patient_id": patient_id,
                    "assignment_id": patient_id,  # Use patient_id as fallback
                    "patient_data": clean_patient,
                    "assigned_at": patient.get("dispatch_updated_at"),
                    "status": "dispatched",
                    "driver_id": ambulance_driver.get("driver_id"),
                    "driver_name": ambulance_driver.get("driver_name"),
                    "ambulance_id": ambulance_driver.get("ambulance_id"),
                    "ambulance_number": ambulance_driver.get("vehicle_number")
                })
        
        print(f"✅ Total unique patients assigned to driver {driver_id}: {len(all_patients)}")
        
        return {
            "status": "success",
            "count": len(all_patients),
            "patients": all_patients
        }
        
    except Exception as e:
        print(f"❌ Error getting assigned patients: {str(e)}")
        import traceback
        traceback.print_exc()
        return {
            "status": "failed",
            "message": str(e),
            "count": 0,
            "patients": []
        }
@router.post("/ambulance/accept-patient")
async def accept_assigned_patient(data: dict):
    """
    Driver accepts a dispatched patient
    """
    try:
        patient_id = data.get("patient_id")
        driver_id = data.get("driver_id")
        assignment_id = data.get("assignment_id")
        
        # Update the assignment status
        result = await ambulance_assignments_collection.update_one(
            {"_id": ObjectId(assignment_id), "driver_id": driver_id},
            {"$set": {"status": "accepted", "accepted_at": datetime.utcnow().isoformat()}}
        )
        
        if result.modified_count > 0:
            return {
                "status": "success",
                "message": "Patient accepted successfully"
            }
        else:
            return {
                "status": "failed",
                "message": "Assignment not found"
            }
            
    except Exception as e:
        logger.error(f"Error accepting patient: {str(e)}")
        return {"status": "failed", "message": str(e)}

# ✅ COMPLETED INCIDENT COLLECTION
completed_incidents_collection = database["completed_incidents_collection"]


@router.post("/ambulance/complete-incident")
async def complete_incident(data: dict):

    try:

        completed_data = {

            "patient_id": data.get("patient_id"),

            "driver_id": data.get("driver_id"),

            "ambulance_id": data.get("ambulance_id"),

            "status": "completed",

            "completed_at": datetime.utcnow().isoformat()
        }

        print("✅ SAVING COMPLETED INCIDENT")
        print(completed_data)

        # ✅ SAVE TO MONGODB
        result = await completed_incidents_collection.insert_one(
            completed_data
        )

       # ✅ CLEAR DRIVER'S CURRENT ASSIGNMENT (fixes stale BUSY status)
        driver_id = data.get("driver_id")
        patient_id = data.get("patient_id")
        if driver_id:
            await ambulancedrivers_collection.update_one(
                {"driverId": driver_id},
                {
                    "$set": {
                        "current_patient": None,
                        "dispatch_status": None,
                        "updated_at": datetime.utcnow()
                    },
                    "$pull": {"assigned_patients": patient_id}
                }
            )
            # ✅ Remove from accepted-patients list so the BUSY check stops counting it
            await Ambulance_driver_accept.delete_many(
                {"driver_id": driver_id, "patient_id": patient_id}
            )

        return {

            "status": "success",

            "message": "Completed incident saved",

            "inserted_id": str(result.inserted_id)
        }

    except Exception as e:

        print("❌ ERROR:", str(e))

        return {

            "status": "failed",

            "message": str(e)
        }

@router.get("/ambulance/get-completed-incident/{patient_id}")
async def get_completed_incident(patient_id: str):

    try:

        incident = await completed_incidents_collection.find_one({
            "patient_id": patient_id
        })

        if not incident:

            return {

                "status": "failed",

                "message": "Completed incident not found"
            }

        incident["_id"] = str(incident["_id"])

        return {

            "status": "success",

            "incident": incident
        }

    except Exception as e:

        print("❌ ERROR:", str(e))

        return {

            "status": "failed",

            "message": str(e)
        }

class BatchIncidentStatusRequest(BaseModel):
    patient_ids: List[str]


@router.post("/ambulance/get-completed-incidents-batch")
async def get_completed_incidents_batch(data: BatchIncidentStatusRequest):
    """
    Batched replacement for calling get-completed-incident/{id} once per patient.
    Returns { "patient_id": "completed" | "active" } for every id requested.
    """
    try:
        patient_ids = data.patient_ids or []
        if not patient_ids:
            return {"status": "success", "statuses": {}}

        cursor = completed_incidents_collection.find(
            {"patient_id": {"$in": patient_ids}},
            {"_id": 0, "patient_id": 1, "status": 1}
        )
        docs = await cursor.to_list(length=len(patient_ids))

        status_map = {pid: "active" for pid in patient_ids}
        for doc in docs:
            pid = doc.get("patient_id")
            if pid in status_map and doc.get("status") == "completed":
                status_map[pid] = "completed"

        return {"status": "success", "statuses": status_map}

    except Exception as e:
        logger.error(f"Batch incident status error: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))

dismissed_patients_collection = database["dismissed_patients_collection"]
class DismissPatientRequest(BaseModel):
    patient_id: str
    driver_id: str
    ambulance_id: str
@router.post("/ambulance/dismiss-patient")
async def dismiss_patient(request: DismissPatientRequest):
    try:

        # avoid duplicates
        existing = await dismissed_patients_collection.find_one({
            "patient_id": request.patient_id,
            "driver_id": request.driver_id
        })

        if existing:
            return {
                "status": "success",
                "message": "Already dismissed"
            }

        dismiss_doc = {
            "patient_id": request.patient_id,
            "driver_id": request.driver_id,
            "ambulance_id": request.ambulance_id,
            "dismissed_at": datetime.utcnow().isoformat()
        }

        await dismissed_patients_collection.insert_one(dismiss_doc)

       # ✅ CLEAR DRIVER'S CURRENT ASSIGNMENT
        await ambulancedrivers_collection.update_one(
            {"driverId": request.driver_id},
            {
                "$set": {
                    "current_patient": None,
                    "dispatch_status": None,
                    "updated_at": datetime.utcnow()
                },
                "$pull": {"assigned_patients": request.patient_id}
            }
        )
        # ✅ Remove from accepted-patients list so the BUSY check stops counting it
        await Ambulance_driver_accept.delete_many(
            {"driver_id": request.driver_id, "patient_id": request.patient_id}
        )

        return {
            "status": "success",
            "message": "Patient dismissed successfully"
        }

    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=str(e)
        )
@router.get("/ambulance/get-dismissed-patients/{driver_id}")
async def get_dismissed_patients(driver_id: str):
    try:

        dismissed = await dismissed_patients_collection.find(
            {
                "driver_id": driver_id
            },
            {
                "_id": 0
            }
        ).to_list(length=1000)

        return {
            "status": "success",
            "count": len(dismissed),
            "patients": dismissed
        }

    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=str(e)
        )

@router.get("/ambulance/selection/list")
async def get_ambulance_list():

    try:
        ambulance_collection = database["ambulance_collection"]
        ambulancedrivers_collection = database["ambulancedrivers_collection"]

        # Get assigned ambulances
        assigned_vehicle_ids = await ambulancedrivers_collection.distinct(
            "assignedVehicleId",
            {
                "assignedVehicleId": {
                    "$exists": True,
                    "$ne": None
                }
            }
        )

        print("🚑 ASSIGNED VEHICLES:", assigned_vehicle_ids)

        # Show only FREE ambulances
        cursor = ambulance_collection.find({
            "vehicleId": {
                "$nin": assigned_vehicle_ids
            }
        })

        ambulances = []

        async for ambulance in cursor:
            ambulance["_id"] = str(ambulance["_id"])
            ambulances.append(ambulance)

        print("🚑 FREE AMBULANCES:", ambulances)

        return {
            "status": "success",
            "ambulances": ambulances
        }

    except Exception as e:
        print("❌ Error loading ambulances:", str(e))

        raise HTTPException(
            status_code=500,
            detail=str(e)
        )
    

@router.get("/ambulance/patient-click/all")
async def get_all_patient_clicks():

    try:

        print("\n========== GET ALL PATIENT CLICKS ==========")

        patient_click_collection = database["patient_click"]

        # ✅ GET ALL RECORDS
        cursor = patient_click_collection.find().sort(
            "updated_at",
            -1
        )

        all_data = await cursor.to_list(length=1000)

        # ✅ CONVERT OBJECTID
        for item in all_data:

            if "_id" in item:
                item["_id"] = str(item["_id"])

        print("TOTAL RECORDS:", len(all_data))

        print("========== FETCH SUCCESS ==========\n")

        return {

            "status": "success",

            "count": len(all_data),

            "data": all_data
        }

    except Exception as e:

        print("❌ FETCH ERROR:", str(e))

        raise HTTPException(
            status_code=500,
            detail=str(e)
        )

@router.get("/ambulance/patient-click/{patient_id}")
async def get_patient_click_by_patient_id(patient_id: str):
    """
    Retrieve ALL patient click / iframe history records
    """

    try:

        # ✅ YOUR REAL COLLECTION
        collection = database["patient_click"]

        # ✅ FETCH ALL RECORDS FOR PATIENT
        data = await collection.find({
            "$or": [
                {"patient_id": patient_id},
                {"patient_id": int(patient_id)}
            ]
        }).sort("created_at", -1).to_list(length=1000)

        # ✅ CONVERT OBJECTID TO STRING
        for item in data:
            item["_id"] = str(item["_id"])

        return {
            "status": "success",
            "count": len(data),
            "patient_id": patient_id,
            "data": data
        }

    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=f"Error fetching patient history: {str(e)}"
        )

@router.get("/ambulance/debug-all")
async def debug_all():

    collection = database["patient_click"]

    data = await collection.find().sort("created_at", -1).to_list(length=100)

    for item in data:
        item["_id"] = str(item["_id"])

    return {
        "count": len(data),
        "data": data
    }


@router.get("/ambulance/get-driver-credentials/{driver_id}")
async def get_driver_credentials(driver_id: str):
    """
    Retrieve ambulance driver username and password using driver ID
    """
    try:
        ambulancedrivers_collection = database["ambulancedrivers_collection"]

        # Find driver by driver_id
        driver = await ambulancedrivers_collection.find_one(
            {"driver_id": driver_id},
            {
                "_id": 0,
                "driver_id": 1,
                "username": 1,
                "password": 1,
                "assignedVehicleId": 1,
                "assignedAmbulanceVehicleNumber": 1
            }
        )

        # Check if driver exists
        if not driver:
            raise HTTPException(
                status_code=404,
                detail="Driver not found"
            )

        return {
            "status": "success",
            "message": "Driver credentials retrieved successfully",
            "data": driver
        }

    except HTTPException:
        raise

    except Exception as e:
        print(f"Error retrieving driver credentials: {str(e)}")
        raise HTTPException(
            status_code=500,
            detail=f"Internal server error: {str(e)}"
        )

@router.get("/ambulance/driver-assigned-vehicle/{driver_id}")
async def get_driver_assigned_vehicle(driver_id: str):
    """
    Get assigned ambulance details based on driver ID
    """

    try:
        # Find driver
        driver = await ambulancedrivers_collection.find_one(
            {"driverId": driver_id},
            {"_id": 0}
        )

        if not driver:
            raise HTTPException(
                status_code=404,
                detail="Driver not found"
            )

        assigned_vehicle_id = driver.get("assignedVehicleId")

        if not assigned_vehicle_id:
            return {
                "status": "error",
                "message": "No vehicle assigned to this driver"
            }

        # Find ambulance
        ambulance = await ambulance_collection.find_one(
            {"vehicleId": assigned_vehicle_id},
            {
                "_id": 0,

                "vehicleId": 1,

                "ambulanceNumber": 1,

                "zenzo_ambulance_number": 1,

                "zenzo_login_password": 1,

                "password": 1,

                "zenzo_api_token": 1
            }
        )

        if not ambulance:
            raise HTTPException(
                status_code=404,
                detail="Assigned ambulance not found"
            )

        return {
            "status": "success",
            "data": {

                "vehicleId":
                    ambulance.get("vehicleId"),

                "local_ambulanceNumber":
                    ambulance.get("ambulanceNumber"),

                # ZENZO ambulance login number
                "ambulanceNumber":
                    ambulance.get("zenzo_ambulance_number")
                    or ambulance.get("ambulanceNumber"),

                # ZENZO password first, fallback local password
                "password":
                    ambulance.get("zenzo_login_password")
                    or ambulance.get("password"),

                "has_zenzo_token":
                    bool(ambulance.get("zenzo_api_token")),

                "has_password":
                    bool(
                        ambulance.get("zenzo_login_password")
                        or ambulance.get("password")
                    )
            }
        }

    except HTTPException:
        raise

    except Exception as e:

        print(f"Error fetching assigned vehicle: {str(e)}")

        raise HTTPException(
            status_code=500,
            detail=f"Internal server error: {str(e)}"
        )
@router.get("/debug/driver/{driver_id}")
async def debug_driver(driver_id: str):
    # Try all possible field names
    driver = await ambulancedrivers_collection.find_one({
        "$or": [
            {"driverId": driver_id},
            {"driver_id": driver_id},
            {"username": driver_id},
        ]
    })
    
    if driver:
        driver["_id"] = str(driver["_id"])
        return {"found": True, "driver": driver}
    
    # If still not found, return ALL drivers to inspect
    all_drivers = await ambulancedrivers_collection.find({}).to_list(length=100)
    for d in all_drivers:
        d["_id"] = str(d["_id"])
    
    return {
        "found": False,
        "message": "Driver not found with any field",
        "all_drivers_in_db": all_drivers
    }


@router.get("/debug/ambulance/{vehicle_id}")
async def debug_ambulance(vehicle_id: str):
    ambulance = await ambulance_collection.find_one({
        "$or": [
            {"vehicleId": vehicle_id},
            {"ambulanceNumber": vehicle_id},
        ]
    })
    if ambulance:
        ambulance["_id"] = str(ambulance["_id"])
        return {"found": True, "ambulance": ambulance}
    
    # Show all ambulances
    all_ambs = await ambulance_collection.find({}).to_list(length=100)
    for a in all_ambs:
        a["_id"] = str(a["_id"])
    return {
        "found": False,
        "all_ambulances": all_ambs
    }

@router.post("/debug/fix-ambulance/{vehicle_id}")
async def fix_ambulance_active(vehicle_id: str):
    result = await ambulance_collection.update_one(
        {"vehicleId": vehicle_id},
        {"$set": {
            "is_active": True,
            "status": "Available",
            "updatedAt": datetime.utcnow().isoformat()
        }}
    )
    return {
        "status": "success",
        "matched": result.matched_count,
        "modified": result.modified_count,
        "vehicle_id": vehicle_id
    }

@router.post("/debug/fix-driver/{driver_id}")
async def fix_driver_status(driver_id: str):
    result = await ambulancedrivers_collection.update_one(
        {"driverId": driver_id},
        {"$set": {
            "current_patient": None,
            "dispatch_status": None,
            "assigned_patients": []
        }}
    )
    return {
        "status": "success",
        "matched": result.matched_count,
        "modified": result.modified_count,
        "driverId": driver_id
    }

@router.get("/ambulance/get-completed-incidents/{driver_id}")
async def get_completed_incidents_by_driver(driver_id: str):
    """
    Get all completed incidents for a specific driver
    """
    try:
        incidents = await completed_incidents_collection.find({
            "driver_id": driver_id
        }).to_list(length=1000)
        
        # Convert ObjectId to string
        for incident in incidents:
            incident["_id"] = str(incident["_id"])
        
        return {
            "status": "success",
            "count": len(incidents),
            "incidents": incidents
        }
        
    except Exception as e:
        print(f"❌ Error: {str(e)}")
        return {
            "status": "failed",
            "message": str(e),
            "incidents": []
        }


@router.get("/ambulance/get-declined-patients/{driver_id}")
async def get_declined_patients(driver_id: str):
    """
    Get all patients declined by a specific driver
    """
    try:
        declined = await Ambulance_driver_declined.find(
            {"driver_id": driver_id}
        ).to_list(length=1000)
        
        # Convert ObjectId to string
        for item in declined:
            if "_id" in item:
                item["_id"] = str(item["_id"])
        
        return {
            "status": "success",
            "count": len(declined),
            "patients": declined
        }
        
    except Exception as e:
        print(f"❌ Error getting declined patients: {str(e)}")
        return {
            "status": "failed",
            "message": str(e),
            "patients": []
        }


#11-06-2026
@router.delete("/ambulancemanagementdelete/{vehicle_id}")
async def delete_ambulance(vehicle_id: str):
    """
    Delete an ambulance (and all its fields/data) from ambulance_collection
    by its vehicleId
    """
    logger.info("=" * 50)
    logger.info("AMBULANCE DELETE API CALLED")
    logger.info(f"Vehicle ID: {vehicle_id}")

    try:
        existing = await database["ambulance_collection"].find_one({"vehicleId": vehicle_id})

        if not existing:
            return JSONResponse(
                status_code=404,
                content={
                    "status": "error",
                    "message": f"Ambulance with Vehicle ID '{vehicle_id}' not found"
                }
            )

        result = await database["ambulance_collection"].delete_one({"vehicleId": vehicle_id})

        if result.deleted_count == 1:
            logger.info(f"Ambulance '{vehicle_id}' deleted successfully")
            return {
                "status": "success",
                "message": f"Ambulance '{vehicle_id}' deleted successfully",
                "vehicleId": vehicle_id
            }
        else:
            return JSONResponse(
                status_code=500,
                content={
                    "status": "error",
                    "message": "Failed to delete ambulance"
                }
            )

    except Exception as e:
        logger.error(f"Error deleting ambulance: {str(e)}")
        return JSONResponse(
            status_code=500,
            content={
                "status": "error",
                "message": f"Delete failed: {str(e)}"
            }
        )
    
class AmbulanceUpdate(BaseModel):
    vehicleRegNumber: Optional[str] = None
    vehicleMake: Optional[str] = None
    vehicleModel: Optional[str] = None
    manufacturingYear: Optional[str] = None


@router.put("/ambulancemanagementupdate/{vehicle_id}")
async def update_ambulance(vehicle_id: str, update_data: AmbulanceUpdate):
    """
    Update editable fields (Reg Number, Make, Model, Year) for an
    ambulance identified by vehicleId
    """
    logger.info("=" * 50)
    logger.info("AMBULANCE UPDATE API CALLED")
    logger.info(f"Vehicle ID: {vehicle_id}")
    logger.info(f"Update payload: {update_data}")

    try:
        existing = await database["ambulance_collection"].find_one({"vehicleId": vehicle_id})

        if not existing:
            return JSONResponse(
                status_code=404,
                content={
                    "status": "error",
                    "message": f"Ambulance with Vehicle ID '{vehicle_id}' not found"
                }
            )

        # Build update dict from only the fields provided (non-None)
        update_fields = {}
        if update_data.vehicleRegNumber is not None:
            update_fields["vehicleRegNumber"] = update_data.vehicleRegNumber
        if update_data.vehicleMake is not None:
            update_fields["vehicleMake"] = update_data.vehicleMake
        if update_data.vehicleModel is not None:
            update_fields["vehicleModel"] = update_data.vehicleModel
        if update_data.manufacturingYear is not None:
            update_fields["manufacturingYear"] = update_data.manufacturingYear

        if not update_fields:
            return JSONResponse(
                status_code=400,
                content={
                    "status": "error",
                    "message": "No valid fields provided to update"
                }
            )

        # If reg number is being changed, ensure no duplicate exists
        if "vehicleRegNumber" in update_fields:
            duplicate = await database["ambulance_collection"].find_one({
                "vehicleRegNumber": update_fields["vehicleRegNumber"],
                "vehicleId": {"$ne": vehicle_id}
            })
            if duplicate:
                return JSONResponse(
                    status_code=400,
                    content={
                        "status": "error",
                        "message": f"Another ambulance already uses Registration Number '{update_fields['vehicleRegNumber']}'"
                    }
                )

        update_fields["updatedAt"] = datetime.utcnow().isoformat()

        result = await database["ambulance_collection"].update_one(
            {"vehicleId": vehicle_id},
            {"$set": update_fields}
        )

        if result.matched_count == 0:
            return JSONResponse(
                status_code=404,
                content={
                    "status": "error",
                    "message": f"Ambulance with Vehicle ID '{vehicle_id}' not found"
                }
            )

        logger.info(f"Ambulance '{vehicle_id}' updated successfully")

        return {
            "status": "success",
            "message": "Ambulance updated successfully",
            "vehicleId": vehicle_id,
            "updatedFields": update_fields
        }

    except Exception as e:
        logger.error(f"Error updating ambulance: {str(e)}")
        return JSONResponse(
            status_code=500,
            content={
                "status": "error",
                "message": f"Update failed: {str(e)}"
            }
        )

class DriverUpdate(BaseModel):
    fullName: Optional[str] = None
    phoneNumber: Optional[str] = None
    gender: Optional[str] = None
    licenseExpiryDate: Optional[str] = None
    yearsOfExperience: Optional[str] = None
    employmentType: Optional[str] = None
    shiftTiming: Optional[str] = None


@router.put("/ambulance/drivermanagementupdate/{driver_id}")
async def update_driver(driver_id: str, update_data: DriverUpdate):
    try:
        existing_driver = await ambulancedrivers_collection.find_one({"driverId": driver_id})
        if not existing_driver:
            raise HTTPException(status_code=404, detail="Driver not found")

        update_fields = {k: v for k, v in update_data.dict().items() if v is not None}

        if not update_fields:
            raise HTTPException(status_code=400, detail="No valid fields provided to update")

        update_fields["updated_at"] = datetime.utcnow()

        result = await ambulancedrivers_collection.update_one(
            {"driverId": driver_id},
            {"$set": update_fields}
        )

        if result.matched_count == 0:
            raise HTTPException(status_code=404, detail="Driver not found")

        return {
            "status": "success",
            "message": "Driver updated successfully",
            "driverId": driver_id,
            "updatedFields": update_fields
        }

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Internal server error: {str(e)}")


@router.delete("/ambulance/drivermanagementdelete/{driver_id}")
async def delete_driver(driver_id: str):
    try:
        existing_driver = await ambulancedrivers_collection.find_one({"driverId": driver_id})
        if not existing_driver:
            raise HTTPException(status_code=404, detail="Driver not found")

        result = await ambulancedrivers_collection.delete_one({"driverId": driver_id})

        if result.deleted_count == 1:
            return {
                "status": "success",
                "message": "Driver deleted successfully",
                "driverId": driver_id
            }
        else:
            raise HTTPException(status_code=500, detail="Failed to delete driver")

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Internal server error: {str(e)}")

#11-06-2026















# Add this after your existing imports
import os

# Define the upload directory path
# This points to: /root/Project/ProjectRepo/4.1.7_beta/DoctorAssist-AiEngine/gateway/uploads
CURRENT_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
UPLOAD_DIR = os.path.join(CURRENT_DIR, "uploads")

# Create the directory if it doesn't exist
os.makedirs(UPLOAD_DIR, exist_ok=True)
print(f"✅ UPLOAD_DIR set to: {UPLOAD_DIR}")
# ── Add this with your other collection declarations ──────────────────────────
Image_photography_Ambulance_collection = database["Image_photography_Ambulance_collection"]

IST = timezone(timedelta(hours=5, minutes=30))
@router.post("/ambulance/image/save")
async def save_ambulance_image(
    patient_id: str = Form(...),
    driver_id: str = Form(""),
    driver_name: str = Form(""),
    ambulance_id: str = Form(""),
    vehicle_number: str = Form(""),
    image: UploadFile = File(...),
):
    """
    Save a clinical image captured by an ambulance driver.
    Timestamp: Asia/Kolkata (IST).
    Collection: Image_photography_Ambulance_collection
    """
    try:
        logger.info(f"Saving ambulance image for patient_id: {patient_id}")

        # IST timestamp
        now_ist = datetime.now(IST)
        date_str = now_ist.strftime("%Y-%m-%d")
        time_str = now_ist.strftime("%H:%M:%S")
        timestamp_iso = now_ist.isoformat()

        # Save image file to disk - USE UPLOAD_DIR defined at top of file
        upload_subdir = "ambulance_images"
        full_upload_path = os.path.join(UPLOAD_DIR, upload_subdir)
        os.makedirs(full_upload_path, exist_ok=True)

        ext = os.path.splitext(image.filename or "photo.jpg")[-1] or ".jpg"
        file_name = f"{patient_id}_{now_ist.strftime('%Y%m%d_%H%M%S')}_{uuid.uuid4().hex[:8]}{ext}"
        file_path = os.path.join(full_upload_path, file_name)

        # Save the file
        contents = await image.read()
        with open(file_path, "wb") as buffer:
            buffer.write(contents)

        # Create URL for the image
        BASE_URL = "https://doctorassist.ai"
        image_url = f"{BASE_URL}/api/hms/users/ambulance/ambulance/view-image/{file_name}"

        image_entry = {
            "image_id": str(uuid.uuid4()),
            "image_url": image_url,
            "file_name": file_name,
            "timestamp": now_ist,
            "date": date_str,
            "time": time_str,
            "timestamp_iso": timestamp_iso,
        }

        # Save to database
        existing = await Image_photography_Ambulance_collection.find_one(
            {"patient_id": patient_id}
        )

        if existing:
            await Image_photography_Ambulance_collection.update_one(
                {"patient_id": patient_id},
                {
                    "$push": {"images": image_entry},
                    "$set": {
                        "last_image_at": now_ist,
                        "driver_id": driver_id,
                        "driver_name": driver_name,
                        "ambulance_id": ambulance_id,
                        "vehicle_number": vehicle_number,
                    },
                },
            )
            record_id = str(existing["_id"])
            logger.info(f"Appended image to existing patient: {patient_id}")
        else:
            doc = {
                "patient_id": patient_id,
                "driver_id": driver_id,
                "driver_name": driver_name,
                "ambulance_id": ambulance_id,
                "vehicle_number": vehicle_number,
                "created_at": now_ist,
                "date": date_str,
                "time": time_str,
                "timestamp_iso": timestamp_iso,
                "images": [image_entry],
            }
            result = await Image_photography_Ambulance_collection.insert_one(doc)
            record_id = str(result.inserted_id)
            logger.info(f"Created new image record: {record_id}")

        return {
            "status": "success",
            "message": "Image saved successfully",
            "patient_id": patient_id,
            "record_id": record_id,
            "image_id": image_entry["image_id"],
            "image_url": image_url,
            "timestamp": timestamp_iso,
        }

    except Exception as e:
        logger.error(f"Failed to save ambulance image: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Failed to save image: {str(e)}")
# ── GET IMAGES FOR PATIENT ────────────────────────────────────────────────────
@router.get("/ambulance/image/{patient_id}")
async def get_patient_images(patient_id: str):
    """
    Get all clinical images for a patient. Latest first.
    """
    try:
        logger.info(f"Fetching images for patient_id: {patient_id}")

        # ✅ await Motor DB call
        record = await Image_photography_Ambulance_collection.find_one(
            {"patient_id": patient_id},
            {"_id": 0},
        )

        if not record:
            return {
                "status":       "success",
                "patient_id":   patient_id,
                "total_images": 0,
                "images":       [],
            }

        images = record.get("images", [])

        # Convert datetime to ISO string for JSON
        for img in images:
            if "timestamp" in img and hasattr(img["timestamp"], "isoformat"):
                img["timestamp"] = img["timestamp"].isoformat()
            if "created_at" in img and hasattr(img["created_at"], "isoformat"):
                img["created_at"] = img["created_at"].isoformat()

        # Sort latest first
        images.sort(key=lambda x: x.get("timestamp_iso", ""), reverse=True)

        return {
            "status":         "success",
            "patient_id":     patient_id,
            "driver_id":      record.get("driver_id"),
            "driver_name":    record.get("driver_name"),
            "ambulance_id":   record.get("ambulance_id"),
            "vehicle_number": record.get("vehicle_number"),
            "total_images":   len(images),
            "images":         images,
        }

    except Exception as e:
        logger.error(f"Failed to fetch images: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Failed to fetch images: {str(e)}")



@router.get("/ambulance/get-current-assignment/{patient_id}")
async def get_current_assignment(patient_id: str):
    """
    Get the current active ambulance assignment for a patient
    """
    try:
        # Find the most recent active assignment for this patient
        assignment = await ambulance_assignments_collection.find_one(
            {
                "patient_id": patient_id,
                "status": {"$in": ["dispatched", "accepted"]}
            },
            sort=[("assigned_at", -1)]  # Most recent first
        )
        
        if not assignment:
            return {
                "status": "error",
                "message": "No active assignment found for this patient"
            }
        
        # Convert ObjectId to string for JSON serialization
        assignment["_id"] = str(assignment["_id"])
        
        return {
            "status": "success",
            "patient_id": assignment["patient_id"],
            "driver_id": assignment["driver_id"],
            "driver_name": assignment["driver_name"],
            "ambulance_id": assignment["ambulance_id"],
            "ambulance_number": assignment["ambulance_number"],
            "status": assignment["status"],
            "assigned_at": assignment["assigned_at"]
        }
        
    except Exception as e:
        return {
            "status": "error",
            "message": str(e)
        }

@router.get("/ambulance/view-image/{file_name}")
async def view_ambulance_image(file_name: str):
    try:
        upload_subdir = "ambulance_images"
        full_upload_path = os.path.join(UPLOAD_DIR, upload_subdir)
        file_path = os.path.join(full_upload_path, file_name)
        
        logger.info(f"🔍 view-image request for: {file_path}")
        
        if not os.path.exists(file_path):
            logger.warning(f"❌ File not found: {file_path}")
            raise HTTPException(status_code=404, detail="Image not found")
        
        logger.info(f"✅ Serving file: {file_path} (size={os.path.getsize(file_path)} bytes)")
        return FileResponse(file_path, media_type="image/jpeg")
        
    except HTTPException:
        raise
    except Exception as e:
        logger.exception(f"❌ view-image failed for {file_name}")
        raise HTTPException(status_code=500, detail=str(e))



Image_Extracted_Ambulance_collection = database["Image_Extracted_Ambulance"]
class ImageExtractedRequest(BaseModel):
    patient_id: str
    doctor_id: str
    image_id: str
    extracted_text: str
    extracted_data: Optional[dict] = None   # ← ADD THIS

@router.post("/ambulance/image-extracted/save")
async def save_image_extracted(data: ImageExtractedRequest):
    try:
        patient_id = data.patient_id
        image_id = data.image_id

        patient_images = await Image_photography_Ambulance_collection.find_one(
            {"patient_id": patient_id}
        )
        if not patient_images:
            raise HTTPException(status_code=404, detail="Patient images not found")

        image_entry = None
        for img in patient_images.get("images", []):
            if img.get("image_id") == image_id:
                image_entry = img
                break
        if not image_entry:
            raise HTTPException(status_code=404, detail="Image not found")

        image_timestamp = image_entry.get("timestamp")

        extracted_doc = {
            "patient_id": patient_id,
            "doctor_id": data.doctor_id,
            "image_id": image_id,
            "extracted_text": data.extracted_text,
            "extracted_data": data.extracted_data or {},   # ← ADD THIS
            "timestamp": image_timestamp,
            "date": image_timestamp.strftime("%Y-%m-%d"),
            "time": image_timestamp.strftime("%H:%M:%S"),
            "image_timestamp_iso": image_entry.get("timestamp_iso"),
            "created_from": "ambulance_image"
        }

        result = await Image_Extracted_Ambulance_collection.insert_one(extracted_doc)

        return {
            "status": "success",
            "id": str(result.inserted_id),
            "patient_id": patient_id,
            "image_id": image_id,
            "timestamp": image_timestamp.isoformat()
        }
    except Exception as e:
        logger.error(f"Failed to save extracted image data: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))

@router.get("/ambulance/image-extracted/latest/{patient_id}")
async def get_latest_extracted(patient_id: str):

    try:

        latest = await Image_Extracted_Ambulance_collection.find_one(
            {"patient_id": patient_id},
            sort=[("timestamp", -1)]
        )

        if not latest:

            return {
                "status": "success",
                "data": None
            }

        latest["_id"] = str(latest["_id"])

        if latest.get("timestamp"):
            latest["timestamp"] = (
                latest["timestamp"].isoformat()
            )

        return {
            "status": "success",
            "data": latest
        }

    except Exception as e:

        raise HTTPException(
            status_code=500,
            detail=str(e)
        )

Doctor_Suggestion_collection = database["Doctor_Suggestion_Ambulance"]

class DoctorSuggestionRequest(BaseModel):
    patient_id: str
    doctor_id: str
    suggestion_text: str

@router.post("/ambulance/doctor-suggestion/save")
async def save_doctor_suggestion(data: DoctorSuggestionRequest):
    try:
        import pytz
        from datetime import datetime
        kolkata = pytz.timezone("Asia/Kolkata")
        now = datetime.now(kolkata)
        doc = {
            "patient_id": data.patient_id,
            "doctor_id": data.doctor_id,
            "suggestion_text": data.suggestion_text,
            "type": "doctor_suggestion",
            "timestamp": now,
            "timestamp_iso": now.strftime("%d %b %Y, %I:%M:%S %p"),
            "date": now.strftime("%Y-%m-%d"),
            "time": now.strftime("%H:%M:%S"),
        }
        result = await Doctor_Suggestion_collection.insert_one(doc)
        return {"status": "success", "id": str(result.inserted_id)}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/ambulance/image-extracted/all-notes/{patient_id}")
async def get_all_notes(patient_id: str):
    try:
        extracted_cursor = Image_Extracted_Ambulance_collection.find(
            {"patient_id": patient_id}
        ).sort("timestamp", -1)
        extracted_docs = await extracted_cursor.to_list(length=100)

        suggestion_cursor = Doctor_Suggestion_collection.find(
            {"patient_id": patient_id}
        ).sort("timestamp", -1)
        suggestion_docs = await suggestion_cursor.to_list(length=100)

        notes = []
        for doc in extracted_docs:
            notes.append({
                "type": "extracted_data",
                "extracted_text": doc.get("extracted_text", ""),
                "extracted_data": doc.get("extracted_data", {}),   # ← ADD THIS
                "timestamp_iso": doc.get("image_timestamp_iso", ""),
                "_sort_key": doc.get("timestamp").isoformat() if doc.get("timestamp") else "",
            })
        for doc in suggestion_docs:
            notes.append({
                "type": "doctor_suggestion",
                "suggestion_text": doc.get("suggestion_text", ""),
                "timestamp_iso": doc.get("timestamp_iso", ""),
                "_sort_key": doc.get("timestamp").isoformat() if doc.get("timestamp") else "",
            })

        notes.sort(key=lambda x: x["_sort_key"], reverse=True)
        for n in notes:
            n.pop("_sort_key", None)

        return {"status": "success", "notes": notes}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/ambulance/image-extracted/all-notes/doctor-suggestions/{patient_id}")
async def get_all_notes(patient_id: str):
    try:
        suggestion_cursor = Doctor_Suggestion_collection.find(
            {"patient_id": patient_id}
        ).sort("timestamp", -1)

        suggestion_docs = await suggestion_cursor.to_list(length=100)

        notes = []

        for doc in suggestion_docs:
            notes.append({
                "suggestion_text": doc.get("suggestion_text", ""),
                "timestamp_iso": doc.get("timestamp_iso", "")
            })

        return {
            "status": "success",
            "notes": notes
        }

    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

