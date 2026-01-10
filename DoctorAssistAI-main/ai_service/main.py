from fastapi import FastAPI, Request
from .common_llm.nodes_llm import router as common
from .common_llm.speciality_llm import router as specialty_llm
from shared.audit.client import AuditClient
import os
app = FastAPI()

app.include_router(common)
app.include_router(specialty_llm)

@app.get("/health")
def health():
    return {"status": "healthy"}


@app.on_event("startup")
def startup_event():
    app.state.audit = AuditClient(
        os.getenv("RABBITMQ_URL")
    )