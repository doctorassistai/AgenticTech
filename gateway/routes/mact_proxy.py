"""
gateway/routes/mact_proxy.py

Thin proxy: public GET/POST/PUT/PATCH/DELETE /hms/mact/{path}
-> internal {INTEGRATION_SERVICE_URL}/mact/{path}.

Same pattern as patient_proxy.py / integration.py. The gateway rejects
unauthenticated calls at the edge (cookie login, get_current_user). The
Cookie header is forwarded untouched and the integration service verifies the
JWT again itself (integration/mact/auth.py), so identity is never taken on
trust from this layer. No business logic lives here.

CHANGED: document uploads (POST .../documents) get longer read/write timeouts,
because the integration service stores the file in the storage service before it answers.
"""

import logging
import os
import uuid

import httpx
from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import Response

from gateway.middlewares.utils import get_client_ip
from gateway.routes.login import get_current_user

logger = logging.getLogger(__name__)

router = APIRouter(
    prefix="/hms/mact",
    tags=["mact-proxy"],
    dependencies=[Depends(get_current_user)],
    responses={404: {"description": "Not found"}},
)

INTEGRATION_SERVICE_URL = os.getenv("INTEGRATION_SERVICE_URL", "http://integration:8000")

_HOP_BY_HOP_REQUEST_HEADERS = {
    "connection", "keep-alive", "proxy-authenticate", "proxy-authorization",
    "te", "trailers", "upgrade", "host", "content-length",
}
_STRIP_RESPONSE_HEADERS = {"content-length", "transfer-encoding", "content-encoding", "connection"}


@router.api_route("/{path:path}", methods=["GET", "POST", "PUT", "PATCH", "DELETE"])
async def proxy_to_mact(path: str, request: Request):
    target_url = f"{INTEGRATION_SERVICE_URL}/mact/{path}"
    if request.url.query:
        target_url += f"?{request.url.query}"

    body = None
    if request.method in {"POST", "PUT", "PATCH"}:
        body = await request.body()

    headers = {k: v for k, v in request.headers.items() if k.lower() not in _HOP_BY_HOP_REQUEST_HEADERS}
    headers["X-Trace-Id"] = getattr(request.state, "trace_id", None) or str(uuid.uuid4())
    headers["X-Client-IP"] = get_client_ip(request)

    is_upload = request.method == "POST" and path.rstrip("/").endswith("/documents")
    timeout = httpx.Timeout(
        connect=5.0,
        read=120.0 if is_upload else 30.0,
        write=60.0 if is_upload else 15.0,
        pool=5.0,
    )

    try:
        async with httpx.AsyncClient(timeout=timeout) as client:
            response = await client.request(
                method=request.method, url=target_url, headers=headers, content=body,
            )
    except httpx.ConnectError:
        logger.error("mact proxy: cannot reach %s", INTEGRATION_SERVICE_URL)
        raise HTTPException(status_code=503, detail="MACT service unavailable")
    except httpx.TimeoutException:
        logger.error("mact proxy: timeout reaching %s", target_url)
        raise HTTPException(status_code=504, detail="MACT service timeout")

    response_headers = {k: v for k, v in response.headers.items() if k.lower() not in _STRIP_RESPONSE_HEADERS}
    return Response(
        content=response.content,
        status_code=response.status_code,
        headers=response_headers,
        media_type=response.headers.get("content-type"),
    )