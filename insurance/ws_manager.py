# ws_manager.py
from fastapi import WebSocket
from typing import Dict, List
import json

class ConnectionManager:
    def __init__(self):
        # caseId -> list of active WebSocket connections
        self.case_rooms: Dict[str, List[WebSocket]] = {}
        # userId -> list of active notification sockets
        self.user_sockets: Dict[str, List[WebSocket]] = {}

    async def connect_case(self, case_id: str, ws: WebSocket):
        await ws.accept()
        self.case_rooms.setdefault(case_id, []).append(ws)

    def disconnect_case(self, case_id: str, ws: WebSocket):
        if case_id in self.case_rooms and ws in self.case_rooms[case_id]:
            self.case_rooms[case_id].remove(ws)
            if not self.case_rooms[case_id]:
                del self.case_rooms[case_id]

    async def broadcast_to_case(self, case_id: str, message: dict):
        for ws in self.case_rooms.get(case_id, []):
            try:
                await ws.send_text(json.dumps(message))
            except Exception:
                pass

    async def connect_user(self, user_id: str, ws: WebSocket):
        await ws.accept()
        self.user_sockets.setdefault(user_id, []).append(ws)

    def disconnect_user(self, user_id: str, ws: WebSocket):
        if user_id in self.user_sockets and ws in self.user_sockets[user_id]:
            self.user_sockets[user_id].remove(ws)
            if not self.user_sockets[user_id]:
                del self.user_sockets[user_id]

    async def notify_user(self, user_id: str, payload: dict):
        for ws in self.user_sockets.get(user_id, []):
            try:
                await ws.send_text(json.dumps(payload))
            except Exception:
                pass

manager = ConnectionManager()