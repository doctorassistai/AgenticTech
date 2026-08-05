# middlewares/trace.py
import uuid
from fastapi import Request

async def trace_middleware(request: Request, call_next):
    request.state.trace_id = str(uuid.uuid4())
    response = await call_next(request)
    response.headers["X-Trace-ID"] = request.state.trace_id
    return response
