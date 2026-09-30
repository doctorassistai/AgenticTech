from fastapi import APIRouter, FastAPI, HTTPException, Request
from fastapi.responses import Response

import httpx
import logging
import os
import uuid
from datetime import datetime

from gateway.middlewares.utils import get_client_ip

logger = logging.getLogger(__name__)

router = APIRouter(
    prefix="/hms/users/orchestration",
    tags=["orchestration"],
    responses={404: {"description": "Not found"}},
)

ORCHESTRATION_SERVICE_URL = os.getenv(
    "ORCHESTRATION_SERVICE_URL",
    "http://orchestration:8000",
)


@router.api_route(
    "/{path:path}",
    methods=[
        "GET",
        "POST",
        "PUT",
        "DELETE",
        "PATCH",
        "HEAD",
        "OPTIONS",
    ],
)
async def proxy_to_orchestration(
    path: str,
    request: Request,
):
    """
    Public orchestration proxy.

    No authentication dependency is required here.

    The request is forwarded to the orchestration service while
    preserving trace/client context.
    """

    target_url = f"{ORCHESTRATION_SERVICE_URL}/{path}"
    full_endpoint = f"/hms/users/orchestration/{path}"

    trace_id = (
        getattr(request.state, "trace_id", None)
        or str(uuid.uuid4())
    )

    try:
        # --------------------------------------------------
        # Query parameters
        # --------------------------------------------------

        if request.url.query:
            target_url += f"?{request.url.query}"

        # --------------------------------------------------
        # Request body
        # --------------------------------------------------

        body = None

        if request.method in {
            "POST",
            "PUT",
            "PATCH",
        }:
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
            key: value
            for key, value in request.headers.items()
            if key.lower() not in hop_by_hop
        }

        # These must be recreated by httpx.
        headers.pop("content-length", None)
        headers.pop("host", None)

        # --------------------------------------------------
        # Propagate non-auth context
        # --------------------------------------------------

        headers.update(
            {
                "X-Trace-Id": trace_id,
                "X-Client-IP": get_client_ip(request),
            }
        )

        # IMPORTANT:
        #
        # DO NOT send:
        #
        # X-User-Id
        # X-User-Role
        #
        # because there is no authenticated user.

        # --------------------------------------------------
        # Call orchestration service
        # --------------------------------------------------

        timeout = httpx.Timeout(
            connect=5.0,
            read=120.0,
            write=30.0,
            pool=5.0,
        )

        async with httpx.AsyncClient(
            timeout=timeout
        ) as client:

            response = await client.request(
                method=request.method,
                url=target_url,
                headers=headers,
                content=body,
            )

        # --------------------------------------------------
        # Logging
        # --------------------------------------------------

        logger.info(
            "Orchestration request completed",
            extra={
                "trace_id": trace_id,
                "ip": get_client_ip(request),
                "endpoint": full_endpoint,
                "method": request.method,
                "target_service": "orchestration",
                "target_url": target_url,
                "status_code": response.status_code,
            },
        )

        # --------------------------------------------------
        # Return upstream response
        # --------------------------------------------------

        return Response(
            content=response.content,
            status_code=response.status_code,
            headers=dict(response.headers),
            media_type=response.headers.get(
                "content-type"
            ),
        )

    except httpx.ConnectError:

        logger.exception(
            "Failed to connect to orchestration service"
        )

        raise HTTPException(
            status_code=503,
            detail="Orchestration service unavailable",
        )

    except httpx.TimeoutException:

        logger.exception(
            "Orchestration service timeout"
        )

        raise HTTPException(
            status_code=504,
            detail="Orchestration service timeout",
        )

    except Exception:

        logger.exception(
            "Error proxying request to orchestration service"
        )

        raise HTTPException(
            status_code=500,
            detail="Internal server error while proxying request",
        )


# ----------------------------------------------------------
# HEALTH CHECK
# ----------------------------------------------------------

@router.get("/health")
async def orchestration_health():

    try:

        async with httpx.AsyncClient() as client:

            response = await client.get(
                f"{ORCHESTRATION_SERVICE_URL}/health",
                timeout=5.0,
            )

        return {
            "status": "healthy",
            "orchestration_service_status": response.status_code,
            "orchestration_service_url": ORCHESTRATION_SERVICE_URL,
        }

    except Exception as e:

        return {
            "status": "unhealthy",
            "error": str(e),
            "orchestration_service_url": ORCHESTRATION_SERVICE_URL,
        }