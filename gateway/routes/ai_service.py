from fastapi import APIRouter, Request, HTTPException
from fastapi.responses import Response
import httpx
import logging
import os
from typing import Any

logger = logging.getLogger(__name__)

router = APIRouter(
    prefix="/hms/users/ai",
    tags=["ai_service"],
    responses={404: {"description": "Not found"}},
)

# Get ai_service service URL from environment or use default
ai_service_SERVICE_URL = os.getenv("AI_SERVICE_URL", "http://ai_service:8000")

@router.api_route("/{path:path}", methods=["GET", "POST", "PUT", "DELETE", "PATCH", "HEAD", "OPTIONS"])
async def proxy_to_ai_service(path: str, request: Request):
    """
    Dynamic proxy route that forwards all requests to ai_service service.
    Handles any HTTP method and any endpoint path dynamically.
    """
    try:
        # Construct the target URL
        target_url = f"{ai_service_SERVICE_URL}/{path}"
        
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

        timeout = httpx.Timeout(
            connect=5.0,
            read=120.0,   # ← THIS fixes the timeout
            write=30.0,
            pool=5.0,
        )
        
        async with httpx.AsyncClient() as client:
            response = await client.request(
                method=request.method,
                url=target_url,
                headers=headers,
                content=body,
                timeout=30.0  # 30 second timeout
            )
            
            # Return the response from ai_service service
            return Response(
                content=response.content,
                status_code=response.status_code,
                headers=dict(response.headers),
                media_type=response.headers.get("content-type")
            )
            
    except httpx.ConnectError:
        logger.error(f"Failed to connect to ai_service service at {ai_service_SERVICE_URL}")
        raise HTTPException(
            status_code=503, 
            detail="ai_service service unavailable"
        )
    except httpx.TimeoutException:
        logger.error(f"Timeout connecting to ai_service service at {ai_service_SERVICE_URL}")
        raise HTTPException(
            status_code=504, 
            detail="ai_service service timeout"
        )
    except Exception as e:
        logger.error(f"Error proxying request to ai_service service: {str(e)}")
        raise HTTPException(
            status_code=500, 
            detail="Internal server error while proxying request"
        )

# # Health check endpoint for ai_service service
# @router.get("/health")
# async def ai_service_health():
#     """
#     Health check endpoint to verify ai_service service connectivity.
#     """
#     try:
#         async with httpx.AsyncClient() as client:
#             response = await client.get(
#                 f"{ai_service_SERVICE_URL}/health",
#                 timeout=5.0
#             )
#             return {
#                 "status": "healthy",
#                 "ai_service_status": response.status_code,
#                 "ai_service_url": ai_service_SERVICE_URL
#             }
#     except Exception as e:
#         return {
#             "status": "unhealthy",
#             "error": str(e),
#             "ai_service_url": ai_service_SERVICE_URL
#         }