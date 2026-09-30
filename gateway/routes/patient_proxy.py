"""
gateway/routes/patient_proxy.py

Thin proxy: public GET/POST/PUT/PATCH/DELETE /hms/users/patients/me/{path}
-> internal {INTEGRATION_SERVICE_URL}/patient_app/me/{path}.

Deliberately does NOT use get_current_principal (that's cookie-based doctor
auth, see gateway/routes/integration.py). The patient app authenticates
itself via "Authorization: Bearer <token>", which is simply forwarded through
unread here — identity is established inside patient_app itself
(integration/patient_app/auth.py), never at this layer.
"""

import logging
import os

import httpx
from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import Response

logger = logging.getLogger(__name__)

router = APIRouter(
    prefix="/hms/users/patients/me",
    tags=["patient-proxy"],
    responses={404: {"description": "Not found"}},
)

# Reuses the same env var as gateway/routes/integration.py — both proxies
# ultimately point at the same integration container, patient_app just lives
# inside it (README decision 10).
INTEGRATION_SERVICE_URL = os.getenv("INTEGRATION_SERVICE_URL", "http://integration:8000")

_HOP_BY_HOP_REQUEST_HEADERS = {
    "connection", "keep-alive", "proxy-authenticate", "proxy-authorization",
    "te", "trailers", "upgrade", "host", "content-length",
}
_STRIP_RESPONSE_HEADERS = {"content-length", "transfer-encoding", "content-encoding", "connection"}


@router.api_route("/{path:path}", methods=["GET", "POST", "PUT", "PATCH", "DELETE"])
async def proxy_to_patient_app(path: str, request: Request):
    target_url = f"{INTEGRATION_SERVICE_URL}/patient_app/me/{path}"
    if request.url.query:
        target_url += f"?{request.url.query}"

    body = None
    if request.method in {"POST", "PUT", "PATCH"}:
        body = await request.body()

    headers = {k: v for k, v in request.headers.items() if k.lower() not in _HOP_BY_HOP_REQUEST_HEADERS}

    timeout = httpx.Timeout(connect=5.0, read=15.0, write=15.0, pool=5.0)

    try:
        async with httpx.AsyncClient(timeout=timeout) as client:
            response = await client.request(
                method=request.method,
                url=target_url,
                headers=headers,
                content=body,
            )
    except httpx.ConnectError:
        logger.error("patient_app proxy: cannot reach %s", INTEGRATION_SERVICE_URL)
        raise HTTPException(status_code=503, detail="Patient service unavailable")
    except httpx.TimeoutException:
        logger.error("patient_app proxy: timeout reaching %s", target_url)
        raise HTTPException(status_code=504, detail="Patient service timeout")

    response_headers = {k: v for k, v in response.headers.items() if k.lower() not in _STRIP_RESPONSE_HEADERS}

    return Response(
        content=response.content,
        status_code=response.status_code,
        headers=response_headers,
        media_type=response.headers.get("content-type"),
    )