from fastapi import FastAPI
from app.consumer import start_consumer
import threading

app = FastAPI()

@app.on_event("startup")
def startup_event():
    print("🚀 Starting Audit Service Consumer...", flush=True)

    consumer_thread = threading.Thread(
        target=start_consumer,
        daemon=True  # stops when app stops
    )
    consumer_thread.start()

@app.get("/health")
def health():
    return {"status": "healthy"}
