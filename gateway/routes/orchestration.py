from fastapi import APIRouter, Depends, FastAPI, HTTPException, Request, status, File, Form, UploadFile
from fastapi.responses import Response
import httpx
import logging
import os
from typing import Any
from gateway.middlewares.utils import get_client_ip
from gateway.routes.login import get_current_user
from shared.audit.schema import AuditEvent
from shared.audit.utils import emit_audit
from datetime import datetime
from gateway.middlewares.utils import get_client_ip
logger = logging.getLogger(__name__)

router = APIRouter(
    prefix="/hms/users/orchestration",
    tags=["orchestration"],
    responses={404: {"description": "Not found"}},
)

# Get orchestration service URL from environment or use default
ORCHESTRATION_SERVICE_URL = os.getenv("ORCHESTRATION_SERVICE_URL", "http://orchestration:8000")

@router.api_route(
    "/{path:path}",
    methods=["GET", "POST", "PUT", "DELETE", "PATCH", "HEAD", "OPTIONS"],
)
async def proxy_to_orchestration(
    path: str,
    request: Request,
    current_user: dict = Depends(get_current_user),
):
    """
    Dynamic proxy route that forwards all requests to orchestration service.
    Propagates trace, IP, and user context to next Docker container.
    """

    target_url = f"{ORCHESTRATION_SERVICE_URL}/{path}"
    full_endpoint = f"/hms/users/orchestration/{path}"

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
            "connection", "keep-alive", "proxy-authenticate",
            "proxy-authorization", "te", "trailers", "upgrade",
        }

        headers = {
            k: v for k, v in request.headers.items()
            if k.lower() not in hop_by_hop
        }

         # 🔥 ABSOLUTELY REQUIRED
        headers.pop("content-length", None)
        headers.pop("host", None)

        # --------------------------------------------------
        # 🔥 Propagate context
        # --------------------------------------------------
        headers.update({
            "X-Trace-Id": trace_id,
            "X-Client-IP": get_client_ip(request),
            "X-User-Id": current_user["sys_user_id"],
            "X-User-Role": current_user["role"],
        })

        # --------------------------------------------------
        # Call orchestration
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
        # ✅ AUDIT SUCCESS
        # --------------------------------------------------
        emit_audit(
            request.app,
            AuditEvent(
                timestamp=datetime.utcnow(),
                level="INFO",
                source={"service": "gateway", "component": "orchestration-proxy"},
                actor={
                    "type": current_user["role"],
                    "id": current_user["sys_user_id"],
                },
                context={
                    "trace_id": trace_id,
                    "ip": get_client_ip(request),
                    "endpoint": full_endpoint,
                    "method": request.method,
                    "target_service": "orchestration",
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

        # --------------------------------------------------
        # ❌ AUDIT FAILURE
        # --------------------------------------------------
        emit_audit(
            request.app,
            AuditEvent(
                timestamp=datetime.utcnow(),
                level="ERROR",
                source={"service": "gateway", "component": "orchestration-proxy"},
                actor={
                    "type": current_user["role"],
                    "id": current_user["sys_user_id"],
                },
                context={
                    "trace_id": trace_id,
                    "ip": get_client_ip(request),
                    "endpoint": full_endpoint,
                    "method": request.method,
                    "target_service": "orchestration",
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

        logger.exception("Error proxying request to orchestration service")

        if isinstance(e, httpx.ConnectError):
            raise HTTPException(503, "Orchestration service unavailable")
        elif isinstance(e, httpx.TimeoutException):
            raise HTTPException(504, "Orchestration service timeout")
        else:
            raise HTTPException(500, "Internal server error while proxying request")



# @router.api_route(
#     "/{path:path}",
#     methods=["GET", "POST", "PUT", "DELETE", "PATCH", "HEAD", "OPTIONS"],
# )
# async def proxy_to_orchestration(
#     path: str,
#     request: Request,
#     current_user: dict = Depends(get_current_user),
# ):
#     """
#     Dynamic proxy route that forwards all requests to orchestration service.
#     Propagates trace, IP, and user context to next Docker container.
#     """
#     try:
#         # --------------------------------------------------
#         # Construct target URL
#         # --------------------------------------------------
#         target_url = f"{ORCHESTRATION_SERVICE_URL}/{path}"

#         if request.url.query:
#             target_url += f"?{request.url.query}"

#         # --------------------------------------------------
#         # Request body (if applicable)
#         # --------------------------------------------------
#         body = None
#         if request.method in {"POST", "PUT", "PATCH"}:
#             body = await request.body()

#         # --------------------------------------------------
#         # Forward headers (remove hop-by-hop)
#         # --------------------------------------------------
#         hop_by_hop = {
#             "connection",
#             "keep-alive",
#             "proxy-authenticate",
#             "proxy-authorization",
#             "te",
#             "trailers",
#             "upgrade",
#         }

#         headers = {
#             k: v
#             for k, v in request.headers.items()
#             if k.lower() not in hop_by_hop
#         }

#         # --------------------------------------------------
#         # 🔥 PROPAGATE CONTEXT TO NEXT DOCKER 🔥
#         # --------------------------------------------------
#         trace_id = getattr(request.state, "trace_id", None) or str(uuid.uuid4())

#         headers.update({
#             "X-Trace-Id": trace_id,
#             "X-Client-IP": get_client_ip(request),
#             "X-User-Id": current_user.get("sys_user_id"),
#             "X-User-Role": current_user.get("role"),
#         })

#         logger.info(
#             "Proxying request",
#             extra={
#                 "trace_id": trace_id,
#                 "user_id": current_user.get("sys_user_id"),
#                 "role": current_user.get("role"),
#                 "target": target_url,
#             },
#         )

#         # --------------------------------------------------
#         # Timeouts (FIXED)
#         # --------------------------------------------------
#         timeout = httpx.Timeout(
#             connect=5.0,
#             read=120.0,
#             write=30.0,
#             pool=5.0,
#         )

#         async with httpx.AsyncClient(timeout=timeout) as client:
#             response = await client.request(
#                 method=request.method,
#                 url=target_url,
#                 headers=headers,
#                 content=body,
#             )

#         # --------------------------------------------------
#         # Return upstream response
#         # --------------------------------------------------
#         return Response(
#             content=response.content,
#             status_code=response.status_code,
#             headers=dict(response.headers),
#             media_type=response.headers.get("content-type"),
#         )

#     except httpx.ConnectError:
#         logger.error(
#             "Failed to connect to orchestration service",
#             extra={"service_url": ORCHESTRATION_SERVICE_URL},
#         )
#         raise HTTPException(
#             status_code=503,
#             detail="Orchestration service unavailable",
#         )

#     except httpx.TimeoutException:
#         logger.error(
#             "Timeout connecting to orchestration service",
#             extra={"service_url": ORCHESTRATION_SERVICE_URL},
#         )
#         raise HTTPException(
#             status_code=504,
#             detail="Orchestration service timeout",
#         )

#     except Exception as e:
#         logger.exception("Error proxying request to orchestration service")
#         raise HTTPException(
#             status_code=500,
#             detail="Internal server error while proxying request",
#         )

# @router.api_route("/{path:path}", methods=["GET", "POST", "PUT", "DELETE", "PATCH", "HEAD", "OPTIONS"])
# async def proxy_to_orchestration(path: str, request: Request):
#     """
#     Dynamic proxy route that forwards all requests to orchestration service.
#     Handles any HTTP method and any endpoint path dynamically.
#     """
#     try:
#         # Construct the target URL
#         target_url = f"{ORCHESTRATION_SERVICE_URL}/{path}"
        
#         # Get query parameters
#         query_params = str(request.url.query)
#         if query_params:
#             target_url += f"?{query_params}"
        
#         # Get request body if present
#         body = None
#         if request.method in ["POST", "PUT", "PATCH"]:
#             body = await request.body()
        
#         # Forward headers (exclude hop-by-hop headers)
#         headers = dict(request.headers)
#         hop_by_hop = {
#             'connection', 'keep-alive', 'proxy-authenticate',
#             'proxy-authorization', 'te', 'trailers', 'upgrade'
#         }
#         headers = {k: v for k, v in headers.items() if k.lower() not in hop_by_hop}

#         timeout = httpx.Timeout(
#             connect=5.0,
#             read=120.0,   # ← THIS fixes the timeout
#             write=30.0,
#             pool=5.0,
#         )
        
#         async with httpx.AsyncClient() as client:
#             response = await client.request(
#                 method=request.method,
#                 url=target_url,
#                 headers=headers,
#                 content=body,
#                 timeout=30.0  # 30 second timeout
#             )
            
#             # Return the response from orchestration service
#             return Response(
#                 content=response.content,
#                 status_code=response.status_code,
#                 headers=dict(response.headers),
#                 media_type=response.headers.get("content-type")
#             )
            
#     except httpx.ConnectError:
#         logger.error(f"Failed to connect to orchestration service at {ORCHESTRATION_SERVICE_URL}")
#         raise HTTPException(
#             status_code=503, 
#             detail="Orchestration service unavailable"
#         )
#     except httpx.TimeoutException:
#         logger.error(f"Timeout connecting to orchestration service at {ORCHESTRATION_SERVICE_URL}")
#         raise HTTPException(
#             status_code=504, 
#             detail="Orchestration service timeout"
#         )
#     except Exception as e:
#         logger.error(f"Error proxying request to orchestration service: {str(e)}")
#         raise HTTPException(
#             status_code=500, 
#             detail="Internal server error while proxying request"
#         )

# # Health check endpoint for orchestration service
# @router.get("/health")
# async def orchestration_health():
#     """
#     Health check endpoint to verify orchestration service connectivity.
#     """
#     try:
#         async with httpx.AsyncClient() as client:
#             response = await client.get(
#                 f"{ORCHESTRATION_SERVICE_URL}/health",
#                 timeout=5.0
#             )
#             return {
#                 "status": "healthy",
#                 "orchestration_service_status": response.status_code,
#                 "orchestration_service_url": ORCHESTRATION_SERVICE_URL
#             }
#     except Exception as e:
#         return {
#             "status": "unhealthy",
#             "error": str(e),
#             "orchestration_service_url": ORCHESTRATION_SERVICE_URL
#         }