from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import Response
import httpx
import logging
import os
from gateway.middlewares.utils import get_client_ip
from gateway.routes.login import get_current_user
from shared.audit.schema import AuditEvent
from shared.audit.utils import emit_audit
from datetime import datetime
import uuid

logger = logging.getLogger(__name__)

router = APIRouter(
    prefix="/hms/users/ai-legacy",
    tags=["agentic"],
    responses={404: {"description": "Not found"}},
)

# --------------------------------------------------
# CONFIG
# --------------------------------------------------
agentic_SERVICE_URL = os.getenv("agentic_SERVICE_URL", "http://agentic:8000")
SERVICE_TOKEN = os.getenv("SERVICE_AUTH_TOKEN")


# --------------------------------------------------
# HEALTH
# --------------------------------------------------
@router.get("/health")
async def health_check():
    async with httpx.AsyncClient(timeout=5.0) as client:
        try:
            resp = await client.get(f"{agentic_SERVICE_URL}/health")
            return Response(
                content=resp.content,
                status_code=resp.status_code,
                media_type=resp.headers.get("content-type"),
            )
        except Exception as e:
            return {"status": "unhealthy", "detail": str(e)}


# --------------------------------------------------
# PUBLIC CHAT (NO AUTH)
# --------------------------------------------------
@router.post("/chat")
async def chat_proxy(request: Request):
    try:
        async with httpx.AsyncClient(timeout=30.0) as client:
            body = await request.body()
            headers = dict(request.headers)
            headers.pop("content-length", None)
            headers.pop("host", None)

            resp = await client.post(
                f"{agentic_SERVICE_URL}/chat",
                content=body,
                headers=headers,
            )
            return Response(
                content=resp.content,
                status_code=resp.status_code,
                media_type=resp.headers.get("content-type"),
            )
    except Exception as e:
        return {"error": str(e)}


# --------------------------------------------------
# MAIN PROXY (AUTH + INTERNAL BYPASS)
# --------------------------------------------------
@router.api_route(
    "/{path:path}",
    methods=["GET", "POST", "PUT", "DELETE", "PATCH", "HEAD", "OPTIONS"],
)
async def proxy_to_agentic(
    path: str,
    request: Request,
):
    """
    Proxy with:
    - JWT auth for users
    - X-Service-Token bypass for internal services (Celery)
    """

    # ==================================================
    # 🔥 INTERNAL SERVICE AUTH BYPASS
    # ==================================================
    x_service_token = request.headers.get("X-Service-Token")
    internal_call = x_service_token == SERVICE_TOKEN

    if not internal_call:
        current_user = await get_current_user(request)
    else:
        current_user = {
            "sys_user_id": "internal-service",
            "role": "system",
        }

    target_url = f"{agentic_SERVICE_URL}/{path}"
    full_endpoint = f"/hms/users/agentic/{path}"
    trace_id = getattr(request.state, "trace_id", None) or str(uuid.uuid4())

    try:
        # --------------------------------------------------
        # Query params
        # --------------------------------------------------
        if request.url.query:
            target_url += f"?{request.url.query}"

        # --------------------------------------------------
        # Request body
        # --------------------------------------------------
        body = None
        if request.method in {"POST", "PUT", "PATCH"}:
            body = await request.body()

        # --------------------------------------------------
        # Forward headers
        # --------------------------------------------------
        hop_by_hop = {
            "connection",
            "keep-alive",
            "proxy-authenticate",
            "proxy-authorization",
            "te",
            "trailers",
            "upgrade",
        }

        headers = {
            k: v for k, v in request.headers.items()
            if k.lower() not in hop_by_hop
        }

        headers.pop("content-length", None)
        headers.pop("host", None)

        # --------------------------------------------------
        # Propagate context
        # --------------------------------------------------
        headers.update({
            "X-Trace-Id": trace_id,
            "X-Client-IP": get_client_ip(request),
        })

        # Only attach user context for external calls
        if not internal_call:
            headers.update({
                "X-User-Id": current_user["sys_user_id"],
                "X-User-Role": current_user["role"],
            })

        # --------------------------------------------------
        # Call agentic service
        # --------------------------------------------------
        timeout = httpx.Timeout(connect=5.0, read=120.0, write=30.0, pool=5.0)

        async with httpx.AsyncClient(timeout=timeout) as client:
            response = await client.request(
                method=request.method,
                url=target_url,
                headers=headers,
                content=body,
            )

        # --------------------------------------------------
        # AUDIT SUCCESS
        # --------------------------------------------------
        emit_audit(
            request.app,
            AuditEvent(
                timestamp=datetime.utcnow(),
                level="INFO",
                source={"service": "gateway", "component": "agentic-proxy"},
                actor={
                    "type": current_user.get("role"),
                    "id": current_user.get("sys_user_id"),
                },
                context={
                    "trace_id": trace_id,
                    "ip": get_client_ip(request),
                    "endpoint": full_endpoint,
                    "method": request.method,
                    "target_service": "agentic",
                    "target_url": target_url,
                    "status_code": response.status_code,
                },
                clinical_context={},
                action={
                    "type": request.method,
                    "status": "SUCCESS",
                },
            ),
        )

        return Response(
            content=response.content,
            status_code=response.status_code,
            headers=dict(response.headers),
            media_type=response.headers.get("content-type"),
        )

    except Exception as e:
        error = str(e)

        emit_audit(
            request.app,
            AuditEvent(
                timestamp=datetime.utcnow(),
                level="ERROR",
                source={"service": "gateway", "component": "agentic-proxy"},
                actor={
                    "type": current_user.get("role"),
                    "id": current_user.get("sys_user_id"),
                },
                context={
                    "trace_id": trace_id,
                    "ip": get_client_ip(request),
                    "endpoint": full_endpoint,
                    "method": request.method,
                    "target_service": "agentic",
                    "target_url": target_url,
                    "error": error,
                },
                clinical_context={},
                action={
                    "type": request.method,
                    "status": "FAILED",
                },
            ),
        )

        logger.exception("Error proxying request to agentic service")

        if isinstance(e, httpx.ConnectError):
            raise HTTPException(503, "agentic service unavailable")
        elif isinstance(e, httpx.TimeoutException):
            raise HTTPException(504, "agentic service timeout")
        else:
            raise HTTPException(500, "Internal server error while proxying request")