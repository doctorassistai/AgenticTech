
from fastapi import APIRouter, Request, HTTPException
from fastapi.responses import Response
import httpx
import logging
import os

logger = logging.getLogger(__name__)

router = APIRouter(
    prefix="/hms/users/speciality",
    tags=["speciality"],
    responses={404: {"description": "Not found"}},
)

# Get speciality service URL from environment or use default
SPECIALITY_SERVICE_URL = os.getenv(
    "SPECIALITY_SERVICE_URL",
    "http://speciality:8000"
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
async def proxy_to_speciality(
    path: str,
    request: Request,
):
    """
    Dynamic proxy route that forwards all requests to speciality service.

    Authentication has been removed from this route.
    """

    target_url = f"{SPECIALITY_SERVICE_URL}/{path}"
    full_endpoint = f"/hms/users/speciality/{path}"

    try:
        # ---------------- QUERY PARAMETERS ----------------
        query_params = str(request.url.query)

        if query_params:
            target_url += f"?{query_params}"

        # ---------------- REQUEST BODY ----------------
        body = None

        if request.method in ["POST", "PUT", "PATCH"]:
            body = await request.body()

        # ---------------- REQUEST HEADERS ----------------
        headers = dict(request.headers)

        # Remove hop-by-hop headers
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
            for key, value in headers.items()
            if key.lower() not in hop_by_hop
        }

        # httpx will calculate the correct Content-Length
        headers.pop("content-length", None)

        # Let httpx set the Host header for the target service
        headers.pop("host", None)

        # ---------------- PROXY REQUEST ----------------
        async with httpx.AsyncClient() as client:
            response = await client.request(
                method=request.method,
                url=target_url,
                headers=headers,
                content=body,
                timeout=30.0,
            )

        logger.info(
            "Speciality proxy request successful: "
            "method=%s endpoint=%s status=%s",
            request.method,
            full_endpoint,
            response.status_code,
        )

        # ---------------- RETURN RESPONSE ----------------
        return Response(
            content=response.content,
            status_code=response.status_code,
            headers=dict(response.headers),
            media_type=response.headers.get("content-type"),
        )

    except httpx.ConnectError:
        logger.error(
            "Failed to connect to speciality service at %s",
            SPECIALITY_SERVICE_URL,
        )

        raise HTTPException(
            status_code=503,
            detail="speciality service unavailable",
        )

    except httpx.TimeoutException:
        logger.error(
            "Timeout connecting to speciality service at %s",
            SPECIALITY_SERVICE_URL,
        )

        raise HTTPException(
            status_code=504,
            detail="speciality service timeout",
        )

    except Exception:
        logger.exception(
            "Error proxying request to speciality service: %s",
            full_endpoint,
        )

        raise HTTPException(
            status_code=500,
            detail="Internal server error while proxying request",
        )

