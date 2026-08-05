from fastapi import APIRouter, Request, HTTPException
from fastapi.responses import Response
import httpx
import logging
import os

logger = logging.getLogger(__name__)

router = APIRouter(
    prefix="/hms/users/livelogs",
    tags=["livelogs"],
    responses={404: {"description": "Not found"}},
)

# Log streamer service URL (Docker service name)
LOG_STREAMER_SERVICE_URL = os.getenv(
    "LOG_STREAMER_SERVICE_URL",
    "http://log-streamer:9001"
)

from fastapi import WebSocket, WebSocketDisconnect
import websockets
import asyncio

@router.websocket("/ws/{path:path}")
async def websocket_proxy(ws: WebSocket, path: str):
    await ws.accept()

    target_ws_url = f"ws://log-streamer:9001/ws/{path}"

    try:
        async with websockets.connect(target_ws_url) as backend_ws:
            async def client_to_backend():
                while True:
                    msg = await ws.receive_text()
                    await backend_ws.send(msg)

            async def backend_to_client():
                async for msg in backend_ws:
                    await ws.send_text(msg)

            await asyncio.gather(
                client_to_backend(),
                backend_to_client()
            )

    except WebSocketDisconnect:
        pass
    except Exception as e:
        await ws.close(code=1011)
