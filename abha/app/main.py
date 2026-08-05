from fastapi import FastAPI, APIRouter
from abdm.abha.auth import router as abha_router
from abdm.abha.profile import router as profile_router
from datetime import datetime 

# Create the FastAPI application
app = FastAPI()

# Create a new API router directly in main.py
# api_router = APIRouter()

# Include the routers from the auth and profile modules
# api_router.include_router(abha_router)
# api_router.include_router(profile_router)

# # Include the API router in the FastAPI app
# app.include_router(api_router)
app.include_router(abha_router)
app.include_router(profile_router)


# Health check endpoint
@app.get("/health")
def health():
    return {"status": "healthy",
            "service": "integration",
            "timestamp": datetime.now().isoformat()}
