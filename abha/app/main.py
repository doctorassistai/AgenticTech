from fastapi import FastAPI, APIRouter
from fastapi.middleware.cors import CORSMiddleware
from abdm.abha.auth import router as abha_router
from abdm.abha.profile import router as profile_router, share_router as scan_share_router
from datetime import datetime 

# Create the FastAPI application
app = FastAPI()

# Allow the frontend to actually read responses (including file downloads)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],          # replace "*" with your real frontend origin(s) in prod
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
    expose_headers=["Content-Disposition"],  # <-- required so JS can read the filename for downloads
)

# Create a new API router directly in main.py
# api_router = APIRouter()

# Include the routers from the auth and profile modules
# api_router.include_router(abha_router)
# api_router.include_router(profile_router)

# # Include the API router in the FastAPI app
# app.include_router(api_router)
app.include_router(abha_router)
app.include_router(profile_router)
app.include_router(scan_share_router)


# Health check endpoint
@app.get("/health") 
def health():
    return {"status": "healthy",
            "service": "integration",
            "timestamp": datetime.now().isoformat()}
