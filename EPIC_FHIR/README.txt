EPIC_FHIR
=========

Basic service skeleton for integrating with EPIC's FHIR API.

Structure:
- main.py           -> FastAPI app entrypoint, defines /health and includes router.py
- router.py          -> APIRouter with /epic-fhir/* endpoints (placeholders for real FHIR calls)
- requirements.txt   -> Python dependencies
- Dockerfile         -> Container build + built-in HEALTHCHECK

Run locally:
    pip install -r requirements.txt
    uvicorn main:app --reload

Build & run with Docker:
    docker build -t epic_fhir .
    docker run -p 8000:8000 epic_fhir

Endpoints:
    GET /health                     -> basic health check
    GET /epic-fhir/ping              -> confirms router is wired up
    GET /epic-fhir/patient/{id}      -> placeholder for real EPIC FHIR patient lookup

Next steps:
- Add an epic_client.py (similar to celery_client.py in the "integration" service)
  to hold actual authentication + HTTP calls to EPIC's FHIR endpoints.
- Add environment variables (EPIC base URL, client id/secret, etc.) via a .env
  file or docker-compose environment section.
