"""
services/groq_rate_limiter.py

Shared, cross-process token-bucket limiter for Groq's TPM (tokens-per-
minute) cap. Backed by Redis so both celery-advanced-upload and
celery-agentic-investigation (separate containers, same broker/network)
draw from ONE real budget instead of each assuming they have the full
250k to themselves.

Usage:
    from services.groq_rate_limiter import reserve_tokens
    reserve_tokens(estimated_tokens)   # blocks until budget is free
    # ... then make the actual Groq call ...
"""

from __future__ import annotations

import os
import time
import logging
import redis

logger = logging.getLogger(__name__)

REDIS_URL = os.getenv("REDIS_URL", "redis://redis:6379/0")
_redis = redis.Redis.from_url(REDIS_URL, decode_responses=True)

# Keep a safety margin under Groq's real 250k/min cap so normal API
# jitter/estimation error doesn't still trip 429s.
GROQ_TPM_CAP = int(os.getenv("GROQ_TPM_CAP", "180000"))
_MODEL_KEY = "openai-gpt-oss-120b"

_RESERVE_SCRIPT = """
local key = KEYS[1]
local cap = tonumber(ARGV[1])
local amount = tonumber(ARGV[2])
local ttl = tonumber(ARGV[3])
local current = tonumber(redis.call('GET', key) or "0")
if current + amount > cap then
    return 0
else
    redis.call('INCRBY', key, amount)
    redis.call('EXPIRE', key, ttl)
    return 1
end
"""
_reserve = _redis.register_script(_RESERVE_SCRIPT)


def estimate_tokens(system_prompt: str, user_prompt: str, max_tokens: int) -> int:
    # Rough 4-chars-per-token estimate for input + full requested output budget.
    input_tokens = (len(system_prompt) + len(user_prompt)) // 4
    return input_tokens + max_tokens


def reserve_tokens(amount: int, cap: int = GROQ_TPM_CAP, poll_interval: float = 2.0) -> None:
    """Blocks until `amount` tokens of budget are available in the current
    Redis-tracked minute window, then reserves them atomically. Safe to
    call concurrently from many processes/containers."""
    waited = 0.0
    while True:
        minute_bucket = int(time.time() // 60)
        key = f"groq:tpm:{_MODEL_KEY}:{minute_bucket}"
        try:
            ok = _reserve(keys=[key], args=[cap, amount, 65])
        except Exception as e:
            # Redis itself being unavailable should never hard-fail a
            # background job — log and proceed without throttling rather
            # than blocking forever on a dead dependency.
            logger.error("groq_rate_limiter: Redis error, proceeding unthrottled: %s", e)
            return

        if ok:
            if waited:
                logger.info("groq_rate_limiter: acquired %d tokens after %.1fs wait", amount, waited)
            return

        time.sleep(poll_interval)
        waited += poll_interval
        if waited % 10 < poll_interval:  # log roughly every ~10s of waiting
            logger.info("groq_rate_limiter: waiting for TPM budget (%.0fs so far)...", waited)