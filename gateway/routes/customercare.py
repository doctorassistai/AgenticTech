from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import JSONResponse
from typing import List, Optional
from datetime import datetime
from pymongo import MongoClient
from motor.motor_asyncio import AsyncIOMotorClient
from passlib.context import CryptContext
import logging
import sys
import uuid
import os
import httpx
from jose import jwt, JWTError
from gateway.core.config import SECRET_KEY, ALGORITHM
from shared.audit.schema import AuditEvent
from shared.audit.utils import emit_audit
from gateway.middlewares.utils import get_client_ip
import json
import tempfile
router = APIRouter(
    prefix="/hms/users/customercare",
    tags=["customer_care"],
    responses={404: {"description": "Not found"}},
)

logger = logging.getLogger(__name__)
logger.setLevel(logging.DEBUG)
stream_handler = logging.StreamHandler(sys.stdout)
log_formatter = logging.Formatter("%(asctime)s [%(levelname)s] %(name)s: %(message)s")
stream_handler.setFormatter(log_formatter)
logger.addHandler(stream_handler)

logger.info('Customer Care API is starting up')
# Shared token file path
ZENZO_TOKEN_FILE = os.path.join(tempfile.gettempdir(), "zenzo_token.json")

def save_zenzo_token(token, expires_in=82800):
    """Save ZENZO token to shared file"""
    try:
        from datetime import datetime, timedelta
        import tempfile
        
        ZENZO_TOKEN_FILE = os.path.join(tempfile.gettempdir(), "zenzo_token.json")
        
        logger.info(f"💾 Saving ZENZO token to: {ZENZO_TOKEN_FILE}")
        
        data = {
            "token": token,
            "expires_at": (datetime.now() + timedelta(seconds=expires_in)).isoformat()
        }
        with open(ZENZO_TOKEN_FILE, 'w') as f:
            json.dump(data, f)
        
        # Verify the file was created
        if os.path.exists(ZENZO_TOKEN_FILE):
            logger.info("✅ ZENZO token saved successfully to shared file")
            # Log the file size for debugging
            file_size = os.path.getsize(ZENZO_TOKEN_FILE)
            logger.info(f"📁 Token file size: {file_size} bytes")
        else:
            logger.error("❌ Token file was not created!")
            
    except Exception as e:
        logger.error(f"Failed to save token: {e}")
        import traceback
        traceback.print_exc()


# Database connection
MONGO_URI = os.getenv("MONGO_URI")
MONGO_DB = "doctorassistai"

# Async client (Motor)
mongodb_client = AsyncIOMotorClient(MONGO_URI)
database = mongodb_client[MONGO_DB]

# Sync client (PyMongo) - for direct operations
client = MongoClient(MONGO_URI)
db = client[MONGO_DB]

# Collections
user_auth_collection = db["user_auth"]
customer_care_collection = db["customer_care_agents"]

# Password hashing
pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")


def generate_customer_care_id():
    """Generate unique customer care agent ID"""
    return f"CC-{uuid.uuid4().hex[:8].upper()}"


def hash_password(password: str):
    """Hash password using bcrypt"""
    return pwd_context.hash(password)


def convert_mongo_doc(doc):
    """Convert MongoDB document to JSON serializable format"""
    if not doc:
        return doc
    if "_id" in doc:
        doc["_id"] = str(doc["_id"])
    # Convert datetime fields
    datetime_fields = ["created_at", "updated_at", "current_shift_start", "current_shift_end", "last_login"]
    for field in datetime_fields:
        if field in doc and doc[field]:
            doc[field] = doc[field].isoformat()
    return doc


def get_current_user(request: Request):
    """Get current authenticated user (for protected routes if needed)"""
    token = request.cookies.get("access_token")
    if not token:
        raise HTTPException(status_code=401, detail="Not authenticated")

    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        sys_user_id = payload.get("sub")
        role = payload.get("role")

        if not sys_user_id or not role:
            raise HTTPException(status_code=401, detail="Invalid token")

        user = user_auth_collection.find_one({"sys_user_id": sys_user_id})
        if not user:
            raise HTTPException(status_code=401, detail="User not found")

        return user

    except JWTError:
        raise HTTPException(status_code=401, detail="Token expired or invalid")


@router.post("/customercareregister")
async def customer_care_register(request: Request):
    """
    Register a new Customer Care Agent.
    
    Expected JSON body matches frontend submissionData:
    {
        "full_name": str,
        "username": str,
        "email": str,
        "password": str,
        "phone_number": str,
        "employee_id": str | None,
        "shift_timing": str,
        "department": str,
        "country_code": str,
        "language_skills": List[str],
        "experience_years": int,
        "certification_id": str | None,
        "user_type": str
    }
    """
    try:
        data = await request.json()
        
        logger.info(f"Customer Care Registration Started for: {data.get('username')}")
        
        # Extract data from request
        username = data["username"]
        email = data.get("email")
        phone = data["phone_number"]
        full_name = data["full_name"]
        password = data["password"]
        employee_id = data.get("employee_id")
        shift_timing = data.get("shift_timing", "rotational")
        department = data.get("department", "emergency_response")
        country_code = data.get("country_code", "IN")
        language_skills = data.get("language_skills", [])
        experience_years = data.get("experience_years", 0)
        certification_id = data.get("certification_id")
        
        # ========== VALIDATION ==========
        
        # Check if username already exists
        existing_username = user_auth_collection.find_one({"username": username})
        if existing_username:
            logger.warning(f"Username '{username}' already exists")
            return JSONResponse(
                status_code=400,
                content={
                    "status": "error",
                    "detail": f"Username '{username}' already exists"
                }
            )
        
        # Check if email already exists (if provided)
        if email:
            existing_email = user_auth_collection.find_one({"email": email})
            if existing_email:
                logger.warning(f"Email '{email}' already exists")
                return JSONResponse(
                    status_code=400,
                    content={
                        "status": "error",
                        "detail": f"Email '{email}' already exists"
                    }
                )
        
        # Check if phone number already exists
        existing_phone = user_auth_collection.find_one({"phone_number": phone})
        if existing_phone:
            logger.warning(f"Phone number '{phone}' already exists")
            return JSONResponse(
                status_code=400,
                content={
                    "status": "error",
                    "detail": f"Phone number '{phone}' already exists"
                }
            )
        
        # ========== CREATE USER ==========
        
        # Generate unique IDs
        sys_user_id = generate_customer_care_id()
        doctor_assist_id = generate_customer_care_id()
        
        # Hash the password
        hashed_password = hash_password(password)
        
        created_at = datetime.now()
        
        # 1. Create User Auth object (for login/authentication)
        user_obj = {
            "sys_user_id": sys_user_id,
            "doctor_assist_id": doctor_assist_id,
            "email": email,
            "phone_number": phone,
            "username": username,
            "password": hashed_password,
            "role": "customer_care",
            "user_type": "customer_care_agent",
            "status": "active",
            "created_at": created_at,
            "renewed_at": created_at
        }
        
        # 2. Create Customer Care Agent object (detailed profile)
        customer_care_obj = {
            "sys_user_id": sys_user_id,
            "customer_care_id": doctor_assist_id,
            "full_name": full_name,
            "username": username,
            "email": email,
            "phone_number": phone,
            "employee_id": employee_id,
            "shift_timing": shift_timing,
            "department": department,
            "country_code": country_code,
            "language_skills": language_skills,
            "experience_years": experience_years,
            "certification_id": certification_id,
            "status": "active",
            "current_shift_start": None,
            "current_shift_end": None,
            "created_at": created_at,
            "updated_at": created_at,
            "last_login": None
        }
        
        # ========== INSERT INTO DATABASE ==========
        
        # Insert into user_auth collection
        user_auth_collection.insert_one(user_obj)
        logger.info(f"User auth record created for: {username}")
        
        # Insert into customer_care_agents collection
        customer_care_collection.insert_one(customer_care_obj)
        logger.info(f"Customer care agent profile created for: {full_name}")
        
        # ========== AUDIT LOG (FIXED) ==========
        try:
            # Get client IP safely
            client_ip = None
            try:
                client_ip = get_client_ip(request)
            except:
                client_ip = "unknown"
            
            # Get trace_id safely
            trace_id = None
            if hasattr(request.state, 'trace_id'):
                trace_id = request.state.trace_id
            
            audit_event = AuditEvent(
                timestamp=datetime.utcnow(),
                level="INFO",
                source={
                    "service": "gateway", 
                    "component": "customer_care"
                },
                actor={
                    "type": "system",
                    "id": "registration_system"
                },
                context={
                    "trace_id": trace_id,
                    "ip": client_ip,
                    "endpoint": "/hms/users/customercare/customercareregister"
                },
                clinical_context={
                    "data_sensitivity": "NON_PHI",  # Required field
                    "purpose": "user_registration"
                },
                action={
                    "type": "REGISTER_CUSTOMER_CARE",
                    "status": "SUCCESS",
                    "customer_care_id": sys_user_id,
                    "username": username
                }
            )
            emit_audit(request.app, audit_event)
        except Exception as audit_error:
            # Don't fail registration if audit fails
            logger.warning(f"Audit emission failed (non-critical): {audit_error}")
        
        # ========== SUCCESS RESPONSE ==========
        return {
            "status": "success",
            "message": "Customer Care Agent registered successfully!",
            "customer_care_id": sys_user_id,
            "username": username
        }
        
    except Exception as e:
        logger.exception(f"Customer Care Registration Failed: {str(e)}")
        return JSONResponse(
            status_code=500,
            content={
                "status": "error",
                "detail": f"Registration failed: {str(e)}"
            }
        )


# ========== HELPER ENDPOINTS ==========

@router.get("/get-all-agents")
async def get_all_customer_care_agents():
    """
    Fetch all customer care agents (for admin purposes).
    """
    try:
        logger.info("Fetching all customer care agents")
        
        agents = []
        cursor = database["customer_care_agents"].find({})
        
        async for agent in cursor:
            agents.append(convert_mongo_doc(agent))
        # Return with explicit JSONResponse and headers
        return JSONResponse(
            status_code=200,
            content={
                "status": "success",
                "total_agents": len(agents),
                "agents": agents
            },
            headers={
                "Content-Type": "application/json",
                "X-Content-Type-Options": "nosniff"
            }
        )
        
    except Exception as e:
        logger.exception(f"Error fetching agents: {str(e)}")
        return JSONResponse(
            status_code=500,
            content={
                "status": "error",
                "detail": str(e)
            },
            headers={
                "Content-Type": "application/json"
            }
        )

@router.get("/get-agent/{sys_user_id}")
async def get_customer_care_agent(sys_user_id: str):
    """
    Fetch a specific customer care agent by sys_user_id.
    """
    try:
        logger.info(f"Fetching agent with ID: {sys_user_id}")
        
        agent = await database["customer_care_agents"].find_one({"sys_user_id": sys_user_id})
        
        if not agent:
            raise HTTPException(status_code=404, detail="Customer care agent not found")
        
        agent = convert_mongo_doc(agent)
            
        return {
            "status": "success",
            "agent": agent
        }
    except HTTPException:
        raise
    except Exception as e:
        logger.exception(f"Error fetching agent: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))


@router.put("/update-agent/{sys_user_id}")
async def update_customer_care_agent(sys_user_id: str, request: Request):
    """
    Update customer care agent information.
    """
    try:
        data = await request.json()
        
        logger.info(f"Updating agent: {sys_user_id}")
        
        # Check if agent exists
        existing = await database["customer_care_agents"].find_one({"sys_user_id": sys_user_id})
        if not existing:
            raise HTTPException(status_code=404, detail="Customer care agent not found")
        
        # Fields that can be updated
        updateable_fields = [
            "full_name", "phone_number", "employee_id", "shift_timing",
            "department", "country_code", "language_skills", 
            "experience_years", "certification_id", "status"
        ]
        
        update_data = {"updated_at": datetime.now()}
        for field in updateable_fields:
            if field in data and data[field] is not None:
                update_data[field] = data[field]
        
        # Update in database
        result = await database["customer_care_agents"].update_one(
            {"sys_user_id": sys_user_id},
            {"$set": update_data}
        )
        
        if result.modified_count == 0:
            return {
                "status": "warning",
                "message": "No changes made to the agent record"
            }
        
        # Optional: Update user_auth as well if email/phone changed
        if "email" in update_data or "phone_number" in update_data:
            user_update = {}
            if "email" in update_data:
                user_update["email"] = update_data["email"]
            if "phone_number" in update_data:
                user_update["phone_number"] = update_data["phone_number"]
            if user_update:
                user_auth_collection.update_one(
                    {"sys_user_id": sys_user_id},
                    {"$set": user_update}
                )
        
        return {
            "status": "success",
            "message": "Customer care agent updated successfully"
        }
        
    except HTTPException:
        raise
    except Exception as e:
        logger.exception(f"Error updating agent: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))


@router.delete("/delete-agent/{sys_user_id}")
async def delete_customer_care_agent(sys_user_id: str, confirm: bool = False):
    """
    Delete a customer care agent.
    Use ?confirm=true for hard delete (removes from both collections).
    Without confirm, soft delete (set status to inactive).
    """
    try:
        logger.info(f"Deleting agent: {sys_user_id}")
        
        if confirm:
            # Hard delete - remove from both collections
            agent_result = customer_care_collection.delete_one({"sys_user_id": sys_user_id})
            user_result = user_auth_collection.delete_one({"sys_user_id": sys_user_id})
            
            if agent_result.deleted_count == 0:
                raise HTTPException(status_code=404, detail="Customer care agent not found")
            
            return {
                "status": "success",
                "message": "Customer care agent permanently deleted"
            }
        else:
            # Soft delete - just set status to inactive
            result = customer_care_collection.update_one(
                {"sys_user_id": sys_user_id},
                {
                    "$set": {
                        "status": "inactive",
                        "updated_at": datetime.now()
                    }
                }
            )
            
            if result.modified_count == 0:
                raise HTTPException(status_code=404, detail="Customer care agent not found")
            
            return {
                "status": "success",
                "message": "Customer care agent deactivated successfully"
            }
        
    except HTTPException:
        raise
    except Exception as e:
        logger.exception(f"Error deleting agent: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))


# Add this to your customer_care.py file (around line 400-420, before the last router line)
# ========== SUPERADMIN ENDPOINT ==========

@router.get("/superadmin/profile")
async def get_superadmin_profile(request: Request):
    """
    Get superadmin profile information for customer care users.
    Returns mock data if no superadmin found in database.
    """
    try:
        logger.info("Fetching superadmin profile")
        
        # Try multiple possible role values for superadmin
        superadmin = None
        possible_roles = ["superadmin", "super_admin", "system_admin", "admin"]
        
        for role in possible_roles:
            superadmin = user_auth_collection.find_one({"role": role})
            if superadmin:
                logger.info(f"Found superadmin with role: {role}")
                break
        
        # If no superadmin found in database, return mock data
        if not superadmin:
            logger.warning("No superadmin found in database - returning mock data")
            return JSONResponse(
                status_code=200,  # Return 200 with mock data instead of 404
                content={
                    "success": True,
                    "user": {
                        "id": "MOCK_SUPERADMIN_001",
                        "userId": "SUPERADMIN_001",
                        "firstName": "Super",
                        "lastName": "Admin",
                        "fullName": "Super Admin",
                        "email": "superadmin@doctorassist.ai",
                        "role": "superadmin",
                        "status": "active",
                        "lastLogin": datetime.now().isoformat(),
                        "organization": "DoctorAssist AI"
                    },
                    "is_mock": True  # Flag to indicate this is mock data
                }
            )
        
        # Get additional details - try multiple collections
        superadmin_details = None
        # Try customer_care_agents first
        superadmin_details = customer_care_collection.find_one({"sys_user_id": superadmin.get("sys_user_id")})
        
        # If not found, try looking in user_auth itself
        if not superadmin_details:
            superadmin_details = superadmin
        
        # Prepare response
        response_data = {
            "success": True,
            "user": {
                "id": str(superadmin.get("_id")),
                "userId": superadmin.get("sys_user_id") or superadmin.get("user_id"),
                "firstName": superadmin_details.get("first_name") or superadmin_details.get("firstName") or "Super",
                "lastName": superadmin_details.get("last_name") or superadmin_details.get("lastName") or "Admin",
                "fullName": superadmin_details.get("full_name") or superadmin_details.get("fullName") or f"{superadmin_details.get('first_name', 'Super')} {superadmin_details.get('last_name', 'Admin')}",
                "email": superadmin.get("email"),
                "role": superadmin.get("role", "superadmin"),
                "status": superadmin.get("status", "active"),
                "lastLogin": superadmin.get("last_login") or superadmin.get("lastLogin"),
                "organization": superadmin.get("organization", "DoctorAssist AI")
            }
        }
        
        # Convert datetime to string if needed
        if response_data["user"]["lastLogin"]:
            if hasattr(response_data["user"]["lastLogin"], 'isoformat'):
                response_data["user"]["lastLogin"] = response_data["user"]["lastLogin"].isoformat()
        
        logger.info(f"Superadmin profile fetched successfully for: {superadmin.get('email')}")
        return JSONResponse(
            status_code=200,
            content=response_data
        )
        
    except Exception as e:
        logger.exception(f"Error fetching superadmin profile: {str(e)}")
        # Return mock data on error instead of 500
        return JSONResponse(
            status_code=200,  # Return 200 with mock data
            content={
                "success": True,
                "user": {
                    "id": "ERROR_SUPERADMIN_001",
                    "userId": "SUPERADMIN_001",
                    "firstName": "Super",
                    "lastName": "Admin",
                    "fullName": "Super Admin",
                    "email": "superadmin@doctorassist.ai",
                    "role": "superadmin",
                    "status": "active",
                    "lastLogin": datetime.now().isoformat(),
                    "organization": "DoctorAssist AI"
                },
                "is_mock": True,
                "error": str(e)
            }
        )

# Add this endpoint to your backend
@router.post("/external-login")
async def external_customer_care_login(request: Request):
    try:
        body = await request.json()
        email = body.get("email")
        password = body.get("password")
        
        # Call the external API from your backend
        async with httpx.AsyncClient() as client:
            response = await client.post(
                "https://zenzo.theapothecary.co.in:9500/api/auth/login",
                json={"email": email, "password": password},
                timeout=30.0
            )
            
            data = response.json()
            return data
            
    except Exception as e:
        return {"success": False, "error": str(e)}
@router.post("/zenzo-superadmin-login")
async def zenzo_superadmin_login(request: Request):
    """
    Proxy endpoint to call ZENZO external API for superadmin login.
    """
    try:
        body = await request.json()
        email = body.get("email")
        password = body.get("password")
        
        if not email or not password:
            return JSONResponse(
                status_code=400,
                content={
                    "success": False,
                    "error": "Email and password are required"
                }
            )
        
        logger.info(f"🟡 Calling ZENZO external API for superadmin login: {email}")
        
        async with httpx.AsyncClient() as client:
            response = await client.post(
                "https://zenzo.theapothecary.co.in:9500/api/auth/login",
                json={"email": email, "password": password},
                timeout=30.0
            )
            
            if response.status_code == 200:
                data = response.json()
                logger.info(f"✅ ZENZO API login successful for: {email}")
                
                # Extract token from set-cookie header
                set_cookie = response.headers.get("set-cookie", "")
                logger.info(f"🍪 Set-Cookie header: {set_cookie[:200]}...")
                
                # Extract accessToken from cookie
                import re
                token_match = re.search(r'accessToken=([^;]+)', set_cookie)
                token = token_match.group(1) if token_match else None
                
                if token:
                    logger.info(f"🔑 Extracted accessToken: {token[:50]}...")
                    
                    # Get user ID for reference (not for token)
                    user_id = data.get("user", {}).get("id")
                    
                    # Save token and user info (organization will come from user input)
                    from datetime import datetime, timedelta
                    token_data = {
                        "token": token,
                        "user_id": user_id,
                        "user_email": data.get("user", {}).get("email"),
                        "expires_at": (datetime.now() + timedelta(hours=23)).isoformat()
                    }
                    with open(ZENZO_TOKEN_FILE, 'w') as f:
                        json.dump(token_data, f)
                    logger.info(f"💾 ZENZO token saved successfully")
                    logger.info(f"👤 User ID: {user_id}")
                else:
                    logger.error("❌ Failed to extract accessToken from cookies")
                
                return JSONResponse(
                    status_code=200,
                    content={
                        "success": True,
                        "user": data.get("user"),
                        "accessToken": token
                    }
                )
            else:
                logger.error(f"❌ ZENZO API returned error: {response.status_code}")
                return JSONResponse(
                    status_code=response.status_code,
                    content={
                        "success": False,
                        "error": f"External API error: {response.status_code}"
                    }
                )
                
    except httpx.TimeoutException:
        logger.error("⏰ ZENZO API timeout")
        return JSONResponse(
            status_code=504,
            content={"success": False, "error": "External API timeout"}
        )
    except Exception as e:
        logger.exception(f"❌ Error calling ZENZO API: {str(e)}")
        return JSONResponse(
            status_code=500,
            content={"success": False, "error": str(e)}
        )