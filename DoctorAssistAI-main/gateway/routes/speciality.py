from fastapi import APIRouter, Request, HTTPException
from fastapi.responses import Response
import httpx
import logging
import os
from typing import Any

logger = logging.getLogger(__name__)

router = APIRouter(
    prefix="/hms/users/speciality",
    tags=["speciality"],
    responses={404: {"description": "Not found"}},
)

# Get speciality service URL from environment or use default
SPECIALITY_SERVICE_URL = os.getenv("SPECIALITY_SERVICE_URL", "http://speciality:8000")

@router.api_route("/{path:path}", methods=["GET", "POST", "PUT", "DELETE", "PATCH", "HEAD", "OPTIONS"])
async def proxy_to_speciality(path: str, request: Request):
    """
    Dynamic proxy route that forwards all requests to speciality service.
    Handles any HTTP method and any endpoint path dynamically.
    """
    try:
        # Construct the target URL
        target_url = f"{SPECIALITY_SERVICE_URL}/{path}"
        
        # Get query parameters
        query_params = str(request.url.query)
        if query_params:
            target_url += f"?{query_params}"
        
        # Get request body if present
        body = None
        if request.method in ["POST", "PUT", "PATCH"]:
            body = await request.body()
        
        # Forward headers (exclude hop-by-hop headers)
        headers = dict(request.headers)
        hop_by_hop = {
            'connection', 'keep-alive', 'proxy-authenticate',
            'proxy-authorization', 'te', 'trailers', 'upgrade'
        }
        headers = {k: v for k, v in headers.items() if k.lower() not in hop_by_hop}
        
        async with httpx.AsyncClient() as client:
            response = await client.request(
                method=request.method,
                url=target_url,
                headers=headers,
                content=body,
                timeout=30.0  # 30 second timeout
            )
            
            # Return the response from speciality service
            return Response(
                content=response.content,
                status_code=response.status_code,
                headers=dict(response.headers),
                media_type=response.headers.get("content-type")
            )
            
    except httpx.ConnectError:
        logger.error(f"Failed to connect to speciality service at {SPECIALITY_SERVICE_URL}")
        raise HTTPException(
            status_code=503, 
            detail="speciality service unavailable"
        )
    except httpx.TimeoutException:
        logger.error(f"Timeout connecting to speciality service at {SPECIALITY_SERVICE_URL}")
        raise HTTPException(
            status_code=504, 
            detail="speciality service timeout"
        )
    except Exception as e:
        logger.error(f"Error proxying request to speciality service: {str(e)}")
        raise HTTPException(
            status_code=500, 
            detail="Internal server error while proxying request"
        )

