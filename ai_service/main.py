from fastapi import FastAPI, Request
from .common_llm.nodes_llm import router as common
from .common_llm.speciality_llm import router as specialty_llm
from shared.audit.client import AuditClient
from .elevenlabs.elevenlabs import router as elevenlabs_router
import os
from fastapi.middleware.cors import CORSMiddleware

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(common)
app.include_router(specialty_llm)
app.include_router(elevenlabs_router)

@app.get("/health")
def health():
    return {"status": "healthy"}


@app.on_event("startup")
def startup_event():
    app.state.audit = AuditClient(
        os.getenv("RABBITMQ_URL")
    )
