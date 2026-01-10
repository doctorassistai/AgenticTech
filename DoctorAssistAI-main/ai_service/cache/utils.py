import hashlib
import json

def build_cache_key(payload: dict) -> str:
    normalized = json.dumps(payload, sort_keys=True)
    return "llm_feature:" + hashlib.sha256(normalized.encode()).hexdigest()

    
async def get_cache(redis_client, key: str):
    value = await redis_client.get(key)
    if value:
        return json.loads(value)
    return None

async def set_cache(redis_client, key: str, value: dict, ttl: int = 900):
    await redis_client.set(
        key,
        json.dumps(value),
        ex=ttl
    )
