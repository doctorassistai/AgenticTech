import uuid
from datetime import datetime, timezone

def abdm_headers(client_id: str):
    return {
        "Content-Type": "application/json",
        "REQUEST-ID": str(uuid.uuid4()),
        "TIMESTAMP": datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z"),
        "X-CM-ID": "sbx",

    }
