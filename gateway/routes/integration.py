from fastapi import APIRouter, Depends, FastAPI, HTTPException, Request, status, File, Form, UploadFile
from fastapi.responses import Response
import httpx
import logging
import os
import uuid
import json
from datetime import datetime, timezone
from typing import Any
from pymongo import MongoClient
from motor.motor_asyncio import AsyncIOMotorClient
from gateway.middlewares.utils import get_client_ip
from gateway.routes.login import get_current_principal

logger = logging.getLogger(__name__)

router = APIRouter(
    prefix="/hms/integration",
    tags=["integration"],
    responses={404: {"description": "Not found"}},
)

# Get integration service URL from environment or use default
INTEGRATION_SERVICE_URL = os.getenv("INTEGRATION_SERVICE_URL", "http://integration:8000")
MONGO_URI = os.getenv("MONGO_URI")
MONGO_DB = "doctorassistai"

mongodb_client = AsyncIOMotorClient(MONGO_URI)  # async (Motor)
database = mongodb_client[MONGO_DB]

client = MongoClient(MONGO_URI)  # sync (PyMongo)
db = client[MONGO_DB]

integration_request_logs_collection = database["integration_request_logs"]

def _safe_parse_json(raw: bytes) -> Any:
    if not raw:
        return None
    try:
        return json.loads(raw)
    except Exception:
        return raw.decode("utf-8", errors="replace")

def _extract_hospital_id(parsed_body: Any, query_string: str) -> str | None:
    if isinstance(parsed_body, dict):
        hid = parsed_body.get("hospital_id")
        if hid:
            return str(hid)
    for part in query_string.split("&"):
        if part.startswith("hospital_id="):
            return part.split("=", 1)[1]
    return None

async def _save_request_log(*, trace_id, hospital_id, method, endpoint,
                             query_string, client_ip, request_payload,
                             response_status, response_body, status, error_detail, duration_ms):
    try:
        await integration_request_logs_collection.insert_one({
            "trace_id":        trace_id,
            "hospital_id":     hospital_id,
            "method":          method,
            "endpoint":        endpoint,
            "query_string":    query_string,
            "client_ip":       client_ip,
            "request_payload": request_payload,
            "response_status": response_status,
            "response_body":   response_body,
            "status":          status,
            "error_detail":    error_detail,
            "duration_ms":     round(duration_ms, 2),
            "created_at":      datetime.now(timezone.utc),
        })
    except Exception:
        logger.exception("Failed to write request log to MongoDB")



@router.api_route(
    "/{path:path}",
    methods=["GET", "POST", "PUT", "DELETE", "PATCH", "HEAD", "OPTIONS"],
)
async def proxy_to_integration(
    path: str,
    request: Request,
    current_user: dict = Depends(get_current_principal),
):
    """
    Dynamic proxy route that forwards all requests to integration service.
    Propagates trace, IP, and user context to next Docker container.
    """
    try:
        started_at = datetime.now(timezone.utc)
        # --------------------------------------------------
        # Construct target URL
        # --------------------------------------------------
        target_url = f"{INTEGRATION_SERVICE_URL}/{path}"

        if request.url.query:
            target_url += f"?{request.url.query}"

        # --------------------------------------------------
        # Request body (if applicable)
        # --------------------------------------------------
        body        = None
        parsed_body = None
        if request.method in {"POST", "PUT", "PATCH"}:
            body        = await request.body()
            parsed_body = _safe_parse_json(body)

        hospital_id = _extract_hospital_id(parsed_body, request.url.query or "")

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

        # --------------------------------------------------
        # 🔥 PROPAGATE CONTEXT TO NEXT DOCKER 🔥
        # --------------------------------------------------
        trace_id = getattr(request.state, "trace_id", None) or str(uuid.uuid4())

        headers.update({
            "X-Trace-Id": trace_id,
            "X-Client-IP": get_client_ip(request),
        })

        logger.info(
            "Proxying request",
            extra={
                "trace_id": trace_id,
                "target": target_url,
            },
        )

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
        # Log + return upstream response
        # --------------------------------------------------
        duration_ms   = (datetime.now(timezone.utc) - started_at).total_seconds() * 1000
        response_body = _safe_parse_json(response.content)
        is_success    = response.status_code < 400

        await _save_request_log(
            trace_id        = trace_id,
            hospital_id     = hospital_id,
            method          = request.method,
            endpoint        = f"/{path}",
            query_string    = request.url.query or "",
            client_ip       = get_client_ip(request),
            request_payload = parsed_body,
            response_status = response.status_code,
            response_body   = response_body,
            status          = "success" if is_success else "error",
            error_detail    = None if is_success else str(response_body),
            duration_ms     = duration_ms,
        )

        return Response(
            content=response.content,
            status_code=response.status_code,
            headers=dict(response.headers),
            media_type=response.headers.get("content-type"),
        )

    except httpx.ConnectError:
        await _save_request_log(
            trace_id=trace_id, hospital_id=hospital_id, method=request.method,
            endpoint=f"/{path}", query_string=request.url.query or "",
            client_ip=get_client_ip(request), request_payload=parsed_body,
            response_status=503, response_body=None, status="error",
            error_detail="ConnectError: integration service unreachable",
            duration_ms=(datetime.now(timezone.utc) - started_at).total_seconds() * 1000,
        )
        logger.error("Failed to connect to integration service", extra={"service_url": INTEGRATION_SERVICE_URL})
        raise HTTPException(status_code=503, detail="Integration service unavailable")

    except httpx.TimeoutException:
        await _save_request_log(
            trace_id=trace_id, hospital_id=hospital_id, method=request.method,
            endpoint=f"/{path}", query_string=request.url.query or "",
            client_ip=get_client_ip(request), request_payload=parsed_body,
            response_status=504, response_body=None, status="error",
            error_detail="TimeoutException: integration service timed out",
            duration_ms=(datetime.now(timezone.utc) - started_at).total_seconds() * 1000,
        )
        logger.error("Timeout connecting to integration service", extra={"service_url": INTEGRATION_SERVICE_URL})
        raise HTTPException(status_code=504, detail="Integration service timeout")

    except Exception as e:
        await _save_request_log(
            trace_id=trace_id, hospital_id=hospital_id, method=request.method,
            endpoint=f"/{path}", query_string=request.url.query or "",
            client_ip=get_client_ip(request), request_payload=parsed_body,
            response_status=500, response_body=None, status="error",
            error_detail=f"Unhandled exception: {e}",
            duration_ms=(datetime.now(timezone.utc) - started_at).total_seconds() * 1000,
        )
        logger.exception("Error proxying request to integration service")
        raise HTTPException(status_code=500, detail="Internal server error while proxying request")
