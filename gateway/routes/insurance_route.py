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
    prefix="",  # ← Empty prefix, we'll handle all paths
    tags=["insurance"],
    responses={404: {"description": "Not found"}},
)

# --------------------------------------------------
# CONFIG
# --------------------------------------------------
insurance_SERVICE_URL = os.getenv("insurance_SERVICE_URL", "http://insurance:8000")
SERVICE_TOKEN = os.getenv("SERVICE_AUTH_TOKEN")

# --------------------------------------------------
# MAIN PROXY (Handles ALL paths with auth)
# --------------------------------------------------
@router.api_route(
    "/insurance/{path:path}",
    methods=["GET", "POST", "PUT", "DELETE", "PATCH", "HEAD", "OPTIONS"],
)
async def proxy_to_insurance(
    path: str,
    request: Request,
):
    """Proxy for /insurance/* paths with full authentication"""
    return await proxy_request(path, request, add_auth=True)

@router.api_route(
    "/hms/app/{path:path}",
    methods=["GET", "POST", "PUT", "DELETE", "PATCH", "HEAD", "OPTIONS"],
)
async def proxy_app_to_insurance(
    path: str,
    request: Request,
):
    """Proxy for /hms/app/* paths with FULL authentication (NOT public!)"""
    return await proxy_request(path, request, add_auth=True)

async def proxy_request(path: str, request: Request, add_auth: bool = True):
    """
    Common proxy logic with optional authentication
    """
    # ==================================================
    # AUTHENTICATION (Required for ALL /hms/app/* paths)
    # ==================================================
    x_service_token = request.headers.get("X-Service-Token")
    
    # Only treat as internal call if SERVICE_TOKEN is actually set
    internal_call = False
    if SERVICE_TOKEN and x_service_token:
        internal_call = x_service_token == SERVICE_TOKEN
    
    print(f"🔐 === GATEWAY AUTH DEBUG ===")
    print(f"🔐 X-Service-Token header: {x_service_token}")
    print(f"🔐 SERVICE_TOKEN env: {SERVICE_TOKEN}")
    print(f"🔐 internal_call: {internal_call}")
    print(f"🔐 add_auth: {add_auth}")
    print(f"🔐 ==========================")
    
    if not internal_call and add_auth:
        # 🔥 FIX: Remove 'await' - get_current_user is NOT async
        current_user = get_current_user(request)
        print(f"🔐 Got authenticated user: {current_user.get('sys_user_id')}")
        
        # 🔥 ROLE CHECK FOR TASKS ENDPOINTS
        if path.startswith("app/tasks/") or path.startswith("tasks/"):
            if current_user.get("role") != "field-officer":
                raise HTTPException(
                    status_code=403,
                    detail="Access denied: Only field officers can access tasks"
                )
    elif not internal_call and not add_auth:
        current_user = {"sys_user_id": "unknown", "role": "unknown"}
    else:
        current_user = {
            "sys_user_id": "internal-service",
            "role": "system",
        }
        print(f"🔐 USING INTERNAL SERVICE USER")

    # Build target URL
    if request.url.path.startswith("/insurance/"):
        target_url = f"{insurance_SERVICE_URL}/{path}"
    else:
        target_url = f"{insurance_SERVICE_URL}/app/{path}"
    
    if request.url.query:
        target_url += f"?{request.url.query}"

    full_endpoint = request.url.path
    trace_id = getattr(request.state, "trace_id", None) or str(uuid.uuid4())

    try:
        # Request body
        body = None
        if request.method in {"POST", "PUT", "PATCH"}:
            body = await request.body()

        # Forward headers
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

        # Propagate context
        headers.update({
            "X-Trace-Id": trace_id,
            "X-Client-IP": get_client_ip(request),
        })

        # Add user headers when add_auth is True
        if add_auth and not internal_call:
            headers.update({
                "X-User-Id": current_user["sys_user_id"],
                "X-User-Role": current_user["role"],
            })
            print(f"🔐 Gateway adding headers - X-User-Id: {current_user['sys_user_id']}")
            print(f"🔐 Gateway adding headers - X-User-Role: {current_user['role']}")
        elif internal_call:
            headers.update({
                "X-User-Id": "internal-service",
                "X-User-Role": "system",
            })

        # Debug: Log headers being sent
        print(f"🔐 Headers being sent to insurance: {list(headers.keys())}")
        print(f"🔐 X-User-Id present: {'X-User-Id' in headers}")
        print(f"🔐 X-User-Role present: {'X-User-Role' in headers}")

        # Call insurance service
        timeout = httpx.Timeout(connect=5.0, read=120.0, write=30.0, pool=5.0)

        async with httpx.AsyncClient(timeout=timeout) as client:
            response = await client.request(
                method=request.method,
                url=target_url,
                headers=headers,
                content=body,
            )

        # Audit success
        emit_audit(
            request.app,
            AuditEvent(
                timestamp=datetime.utcnow(),
                level="INFO",
                source={"service": "gateway", "component": "insurance-proxy"},
                actor={
                    "type": current_user.get("role"),
                    "id": current_user.get("sys_user_id"),
                },
                context={
                    "trace_id": trace_id,
                    "ip": get_client_ip(request),
                    "endpoint": full_endpoint,
                    "method": request.method,
                    "target_service": "insurance",
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
                source={"service": "gateway", "component": "insurance-proxy"},
                actor={
                    "type": current_user.get("role"),
                    "id": current_user.get("sys_user_id"),
                },
                context={
                    "trace_id": trace_id,
                    "ip": get_client_ip(request),
                    "endpoint": full_endpoint,
                    "method": request.method,
                    "target_service": "insurance",
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

        logger.exception("Error proxying request to insurance service")

        if isinstance(e, httpx.ConnectError):
            raise HTTPException(503, "insurance service unavailable")
        elif isinstance(e, httpx.TimeoutException):
            raise HTTPException(504, "insurance service timeout")
        else:
            raise HTTPException(500, "Internal server error while proxying request")