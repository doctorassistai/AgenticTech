from fastapi import APIRouter, Depends, FastAPI, HTTPException, Request, status, File, Form, UploadFile
from fastapi.responses import Response
import httpx
import logging
import os
from typing import Any
from gateway.middlewares.utils import get_client_ip
from gateway.routes.login import get_current_user
from gateway.routes.login import get_current_user_optional
logger = logging.getLogger(__name__)

router = APIRouter(
    prefix="/hms/users/cm",
    tags=["common"],
    responses={404: {"description": "Not found"}},
)


from jose import JWTError
from typing import Optional



# Get common service URL from environment or use default
COMMON_SERVICE_URL = os.getenv("COMMON_SERVICE_URL", "http://common:8000")




@router.api_route(
    "/{path:path}",
    methods=["GET", "POST", "PUT", "DELETE", "PATCH", "HEAD", "OPTIONS"],
)


async def proxy_to_common(
    path: str,
    request: Request,
    # current_user: Optional[dict] = Depends(get_current_user_optional),
):
    """
    Dynamic proxy route that forwards all requests to common service.
    Propagates trace, IP, and user context to next Docker container.
    """
    try:
        # --------------------------------------------------
        # Construct target URL
        # --------------------------------------------------
        target_url = f"{COMMON_SERVICE_URL}/{path}"

        if request.url.query:
            target_url += f"?{request.url.query}"

        # --------------------------------------------------
        # Request body (if applicable)
        # --------------------------------------------------
        body = None
        if request.method in {"POST", "PUT", "PATCH"}:
            body = await request.body()

        # --------------------------------------------------
        # Forward headers (remove hop-by-hop)
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
            k: v
            for k, v in request.headers.items()
            if k.lower() not in hop_by_hop
        }
        
        # 🔥 ABSOLUTELY REQUIRED
        headers.pop("content-length", None)
        headers.pop("host", None)

        # --------------------------------------------------
        # 🔥 PROPAGATE CONTEXT TO NEXT DOCKER 🔥
        # --------------------------------------------------
        # trace_id = getattr(request.state, "trace_id", None) or str(uuid.uuid4())

        # headers.update({
        #     "X-Trace-Id": trace_id,
        #     "X-Client-IP": get_client_ip(request),
        #     "X-User-Id": current_user.get("sys_user_id"),
        #     "X-User-Role": current_user.get("role"),
        # })

        # logger.info(
        #     "Proxying request",
        #     extra={
        #         "trace_id": trace_id,
        #         "user_id": current_user.get("sys_user_id"),
        #         "role": current_user.get("role"),
        #         "target": target_url,
        #     },
        # )

        # --------------------------------------------------
        # Timeouts (FIXED)
        # --------------------------------------------------
        timeout = httpx.Timeout(
            connect=5.0,
            read=120.0,
            write=30.0,
            pool=5.0,
        )

        async with httpx.AsyncClient(timeout=timeout) as client:
            response = await client.request(
                method=request.method,
                url=target_url,
                headers=headers,
                content=body,
            )

        # --------------------------------------------------
        # Return upstream response
        # --------------------------------------------------
        return Response(
            content=response.content,
            status_code=response.status_code,
            headers=dict(response.headers),
            media_type=response.headers.get("content-type"),
        )

    except httpx.ConnectError:
        logger.error(
            "Failed to connect to common service",
            extra={"service_url": COMMON_SERVICE_URL},
        )
        raise HTTPException(
            status_code=503,
            detail="Common service unavailable",
        )

    except httpx.TimeoutException:
        logger.error(
            "Timeout connecting to common service",
            extra={"service_url": COMMON_SERVICE_URL},
        )
        raise HTTPException(
            status_code=504,
            detail="Common service timeout",
        )

    except Exception as e:
        logger.exception("Error proxying request to common service")
        raise HTTPException(
            status_code=500,
            detail="Internal server error while proxying request",
        )
