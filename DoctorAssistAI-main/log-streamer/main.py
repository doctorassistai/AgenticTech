from fastapi import FastAPI, WebSocket
from pymongo import MongoClient
import docker
import asyncio
from datetime import datetime, timedelta
from typing import Set
import json

app = FastAPI()

# ==========================
# MongoDB
# ==========================
mongo = MongoClient(
    "mongodb://admin:DoctorAssist52022266abi@68.183.82.95:27018/admin"
)
db = mongo["doctorassistai"]
logs_col = db.container_logs
status_col = db.container_status

# ==========================
# Docker (BLOCKING)
# ==========================
docker_client = docker.DockerClient(
    base_url="unix://var/run/docker.sock"
)

# ==========================
# Config
# ==========================
RETENTION_MINUTES = 5
log_queue = asyncio.Queue(maxsize=5000)

# ==========================
# BLOCKING Docker reader (thread)
# ==========================
def docker_log_reader(container_name: str, loop: asyncio.AbstractEventLoop):
    while True:
        try:
            container = docker_client.containers.get(container_name)

            for line in container.logs(stream=True, follow=True, tail=20):
                log = {
                    "container": container_name,
                    "ts": datetime.utcnow(),
                    "message": line.decode(errors="ignore")[:2000],
                }

                asyncio.run_coroutine_threadsafe(
                    log_queue.put(log), loop
                )

        except Exception as e:
            print(f"[docker-log] {container_name}:", e)

# ==========================
# Async broadcaster
# ==========================
async def broadcaster():
    while True:
        log = await log_queue.get()

        # DB write
        logs_col.insert_one(log)

        # WebSocket broadcast
        clients: Set[WebSocket] = app.state.clients
        for ws in list(clients):
            try:
                await ws.send_text(json.dumps({
                    "container": log["container"],
                    "message": log["message"],
                    "ts": log["ts"].isoformat(),
                }))
            except Exception:
                clients.discard(ws)

# ==========================
# WebSocket
# ==========================
@app.websocket("/ws/logs")
async def logs_ws(ws: WebSocket):
    await ws.accept()
    app.state.clients.add(ws)

    try:
        while True:
            await ws.receive()
    except Exception:
        pass
    finally:
        app.state.clients.discard(ws)

# ==========================
# Health watcher
# ==========================
async def container_health_watcher():
    while True:
        try:
            now = datetime.utcnow()
            for c in docker_client.containers.list(all=True):
                status_col.update_one(
                    {"container": c.name},
                    {"$set": {
                        "status": "up" if c.status == "running" else "down",
                        "last_seen": now
                    }},
                    upsert=True
                )
        except Exception as e:
            print("[health]", e)

        await asyncio.sleep(15)

# ==========================
# Cleanup
# ==========================
async def cleanup_worker():
    while True:
        try:
            cutoff = datetime.utcnow() - timedelta(minutes=RETENTION_MINUTES)
            logs_col.delete_many({"ts": {"$lt": cutoff}})
        except Exception as e:
            print("[cleanup]", e)

        await asyncio.sleep(60)

# ==========================
# Startup
# ==========================
@app.on_event("startup")
async def startup():
    print("Starting log-streamer...")

    app.state.clients: Set[WebSocket] = set()
    loop = asyncio.get_running_loop()

    asyncio.create_task(broadcaster())
    asyncio.create_task(container_health_watcher())
    asyncio.create_task(cleanup_worker())

    for name in [
        "gateway",
        "users",
        "audit-service",
        "speciality",
        "orchestration",
        "ai_service",
    ]:
        asyncio.create_task(
            asyncio.to_thread(docker_log_reader, name, loop)
        )

    print("Startup completed")
