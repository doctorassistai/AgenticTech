"""
gateway/routes/patient_app_doctor_proxy.py

Doctor-facing proxy onto integration's patient_app doctor router. Mirrors
patient_proxy.py's shape but authenticates the doctor's session COOKIE
(get_current_user, same as every other doctor route in this gateway —
see agentic.py's proxy_to_agentic for the established pattern) rather than
a Bearer token, since that's how doctor sessions actually work here
(login.py's /login sets an httponly access_token cookie, never returns a
bearer token to the browser).

The verified sys_user_id is injected as X-Doctor-Id on the forwarded
request. integration/patient_app/auth.py's get_current_doctor trusts this
header because integration has no published port — the gateway is the
only thing that can reach it (see patient_app README section 2) — so a
header injected here cannot be spoofed by an external caller bypassing
this proxy.
"""

import os

import httpx
from fastapi import APIRouter, HTTPException, Request, Response

from gateway.routes.login import get_current_user

router = APIRouter(
    prefix="/hms/users/doctors/me/patients",
    tags=["patient_app_doctor_proxy"],
    responses={404: {"description": "Not found"}},
)

INTEGRATION_SERVICE_URL = os.getenv("INTEGRATION_SERVICE_URL", "http://integration:8000")

_HOP_BY_HOP = {
    "connection", "keep-alive", "proxy-authenticate", "proxy-authorization",
    "te", "trailers", "upgrade", "content-length", "transfer-encoding", "content-encoding",
}


@router.api_route("/{path:path}", methods=["GET", "POST", "PUT", "PATCH", "DELETE"])
async def proxy_to_patient_app_doctor(path: str, request: Request):
    current_user = get_current_user(request)
    if current_user.get("role") != "doctor":
        raise HTTPException(status_code=403, detail="Doctor access only")

    target_url = f"{INTEGRATION_SERVICE_URL}/patient_app/doctor/{path}"
    if request.url.query:
        target_url += f"?{request.url.query}"

    body = await request.body() if request.method in {"POST", "PUT", "PATCH"} else None

    headers = {k: v for k, v in request.headers.items() if k.lower() not in _HOP_BY_HOP}
    headers.pop("host", None)
    headers.pop("cookie", None)  # never forward the raw cookie past this point
    headers["X-Doctor-Id"] = current_user["sys_user_id"]

    async with httpx.AsyncClient(timeout=30.0) as client:
        resp = await client.request(request.method, target_url, content=body, headers=headers)

    response_headers = {
        k: v for k, v in resp.headers.items() if k.lower() not in _HOP_BY_HOP
    }
    return Response(content=resp.content, status_code=resp.status_code, headers=response_headers)