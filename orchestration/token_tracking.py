"""
Centralized LLM token usage tracking.

Instead of calling groq_client.chat.completions.create(...) directly in
every one of your ~1000 feature functions, call `call_llm_with_tracking(...)`
from here. It makes the LLM call AND logs token usage (input/output kept
separate, tagged by doctor, hospital, and feature) in one shot.

── Mongo collections used ──
  doctor_user_collection   -> already exists in your codebase, used read-only
                               here to resolve hospital_id from doctor_id
  llm_usage_log_collection -> NEW collection you need to create/point to.
                               One document per LLM call. This is the
                               source of truth; totals are computed from it
                               on read via aggregation, not stored redundantly.

Recommended indexes on llm_usage_log_collection:
    db.llm_usage_log.create_index("doctor_id")
    db.llm_usage_log.create_index("hospital_id")
    db.llm_usage_log.create_index([("doctor_id", 1), ("feature", 1)])
    db.llm_usage_log.create_index("date")
"""

import inspect
import logging
import os
from datetime import datetime

from motor.motor_asyncio import AsyncIOMotorClient

logger = logging.getLogger(__name__)


# ──────────────────────────────────────────────────────────────────────────
# Module-level DB init — owns its own connection so no route/feature
# function ever has to pass collections around.
# ──────────────────────────────────────────────────────────────────────────

MONGO_URI = os.getenv("MONGO_URI")
MONGO_DB = "doctorassistai"

mongodb_client = AsyncIOMotorClient(MONGO_URI)  # async (Motor)
database = mongodb_client[MONGO_DB]

doctor_user_collection = database["doctor_users"]
llm_usage_log_collection = database["llm_usage_log"]  # now stores ROLLUP docs, _id = hospital_id
# Recommended index: db.llm_usage_log.create_index("doctors.doctor_id")


# ──────────────────────────────────────────────────────────────────────────
# Core: log one usage record
# ──────────────────────────────────────────────────────────────────────────

async def log_token_usage(
    *,
    doctor_id: str,
    feature: str,
    input_tokens: int,
    output_tokens: int,
    model: str,
    extra: dict | None = None,
):
    """
    Insert one granular usage record for a single LLM call and return it.

    doctor_id  : sys_user_id of the doctor (same id used everywhere else)
    feature    : short tag identifying which of your ~1000 functions this
                 call came from, e.g. "tumor_board_presentation",
                 "tumor_board_timeline_batch_summary", "discharge_summary"
    extra      : optional dict for anything else you want attached to this
                 call (e.g. patient_id, summary_id) — not aggregated on,
                 just stored for drill-down/audit.
    """
    doctor_result = doctor_user_collection.find_one(
        {"sys_user_id": doctor_id},
        {"_id": 0, "hospital_id": 1, "hospital_name": 1}
    )
    doctor_doc = await doctor_result if inspect.isawaitable(doctor_result) else doctor_result

    if not doctor_doc:
        logger.warning("log_token_usage: no doctor found for doctor_id=%s — logging with hospital_id=None", doctor_id)

    hospital_id = doctor_doc.get("hospital_id") if doctor_doc else None
    hospital_name = doctor_doc.get("hospital_name") if doctor_doc else None

    now = datetime.utcnow()
    input_tokens = int(input_tokens or 0)
    output_tokens = int(output_tokens or 0)
    total_tokens = input_tokens + output_tokens

    record = {
        "doctor_id": doctor_id,
        "hospital_id": hospital_id,
        "hospital_name": hospital_name,
        "feature": feature,
        "model": model,
        "input_tokens": input_tokens,
        "output_tokens": output_tokens,
        "total_tokens": total_tokens,
        "date": now.strftime("%Y-%m-%d"),
        "time": now.strftime("%H:%M:%S"),
        "created_at": now,
    }
    if extra:
        record["extra"] = extra

    if hospital_id:
        try:
            await _upsert_usage_summary(
                hospital_id=hospital_id,
                hospital_name=hospital_name,
                doctor_id=doctor_id,
                feature=feature,
                model=model,
                input_tokens=input_tokens,
                output_tokens=output_tokens,
                total_tokens=total_tokens,
                now=now,
            )
        except Exception:
            logger.exception(
                "log_token_usage: failed to upsert rollup for doctor_id=%s hospital_id=%s",
                doctor_id, hospital_id,
            )
    else:
        logger.warning(
            "log_token_usage: no hospital_id for doctor_id=%s — usage NOT persisted (no hospital to roll up under)",
            doctor_id,
        )

    return record


async def _upsert_usage_summary(
    *,
    hospital_id: str,
    hospital_name: str | None,
    doctor_id: str,
    feature: str,
    model: str,
    input_tokens: int,
    output_tokens: int,
    total_tokens: int,
    now: datetime,
):
    """
    Incrementally maintain the rolled-up hospital -> doctor -> feature
    document in llm_usage_log_collection (one doc per hospital, _id =
    hospital_id). Tries, in order:
      1. Existing (doctor, feature+model) leaf -> $inc in place.
      2. Doctor exists, feature+model doesn't -> $push new feature entry.
      3. Hospital doc exists, doctor doesn't -> $push new doctor subdoc.
      4. Hospital doc doesn't exist yet -> create it with $setOnInsert.
    """
    # 1) Existing doctor + existing feature/model leaf.
     # 1) Existing doctor + existing feature/model leaf -> $inc in place.
    # NOTE: when arrayFilters['feat'] matches zero elements (i.e. this
    # feature+model doesn't exist yet for this doctor), Mongo raises a
    # WriteError ("no array filter found for identifier 'feat'") instead
    # of just returning modified_count=0. We MUST catch that here and
    # fall through to step 2, or the new feature never gets recorded.
    try:
        result = await llm_usage_log_collection.update_one(
            {
                "_id": hospital_id,
                "doctors": {
                    "$elemMatch": {
                        "doctor_id": doctor_id,
                        "features": {
                            "$elemMatch": {"feature": feature, "model": model}
                        },
                    }
                },
            },
            {
                "$inc": {
                    "total_input_tokens": input_tokens,
                    "total_output_tokens": output_tokens,
                    "total_tokens": total_tokens,
                    "total_calls": 1,
                    "doctors.$[doc].total_input_tokens": input_tokens,
                    "doctors.$[doc].total_output_tokens": output_tokens,
                    "doctors.$[doc].total_tokens": total_tokens,
                    "doctors.$[doc].total_calls": 1,
                    "doctors.$[doc].features.$[feat].input_tokens": input_tokens,
                    "doctors.$[doc].features.$[feat].output_tokens": output_tokens,
                    "doctors.$[doc].features.$[feat].total_tokens": total_tokens,
                    "doctors.$[doc].features.$[feat].calls": 1,
                },
                "$set": {
                    "hospital_name": hospital_name,
                    "updated_at": now,
                    "doctors.$[doc].last_used": now,
                    "doctors.$[doc].features.$[feat].last_used": now,
                },
            },
            array_filters=[
                {"doc.doctor_id": doctor_id},
                {"feat.feature": feature, "feat.model": model},
            ],
        )
        if result.matched_count:
            return
    except Exception:
        # Expected/normal the first time a doctor uses a given
        # feature+model — the "feat" array filter has nothing to match
        # yet. Fall through to step 2 to create it.
        logger.debug(
            "step1 leaf-increment miss for doctor_id=%s feature=%s model=%s — falling through to step 2",
            doctor_id, feature, model,
        )

    # 2) Doctor exists on this hospital, feature+model doesn't yet.
    try:
        result = await llm_usage_log_collection.update_one(
            {"_id": hospital_id, "doctors.doctor_id": doctor_id},
            {
                "$inc": {
                    "total_input_tokens": input_tokens,
                    "total_output_tokens": output_tokens,
                    "total_tokens": total_tokens,
                    "total_calls": 1,
                    "doctors.$[doc].total_input_tokens": input_tokens,
                    "doctors.$[doc].total_output_tokens": output_tokens,
                    "doctors.$[doc].total_tokens": total_tokens,
                    "doctors.$[doc].total_calls": 1,
                },
                "$set": {
                    "hospital_name": hospital_name,
                    "updated_at": now,
                    "doctors.$[doc].last_used": now,
                },
                "$push": {
                    "doctors.$[doc].features": {
                        "feature": feature,
                        "model": model,
                        "input_tokens": input_tokens,
                        "output_tokens": output_tokens,
                        "total_tokens": total_tokens,
                        "calls": 1,
                        "last_used": now,
                    }
                },
            },
            array_filters=[{"doc.doctor_id": doctor_id}],
        )
        if result.modified_count:
            return
    except Exception:
        logger.debug(
            "step2 doctor-exists miss for doctor_id=%s — falling through to step 3",
            doctor_id,
        )

    # 3) Hospital doc exists, doctor doesn't.
    new_doctor = {
        "doctor_id": doctor_id,
        "total_input_tokens": input_tokens,
        "total_output_tokens": output_tokens,
        "total_tokens": total_tokens,
        "total_calls": 1,
        "last_used": now,
        "features": [{
            "feature": feature,
            "model": model,
            "input_tokens": input_tokens,
            "output_tokens": output_tokens,
            "total_tokens": total_tokens,
            "calls": 1,
            "last_used": now,
        }],
    }
    try:
        result = await llm_usage_log_collection.update_one(
            {"_id": hospital_id},
            {
                "$inc": {
                    "total_input_tokens": input_tokens,
                    "total_output_tokens": output_tokens,
                    "total_tokens": total_tokens,
                    "total_calls": 1,
                },
                "$set": {"hospital_name": hospital_name, "updated_at": now},
                "$push": {"doctors": new_doctor},
            },
        )
        if result.modified_count:
            return
    except Exception:
        logger.debug(
            "step3 hospital-exists miss for hospital_id=%s — falling through to step 4",
            hospital_id,
        )

    # 4) Hospital doc doesn't exist at all yet.
    await llm_usage_log_collection.update_one(
        {"_id": hospital_id},
        {
            "$setOnInsert": {
                "_id": hospital_id,
                "hospital_name": hospital_name,
                "total_input_tokens": input_tokens,
                "total_output_tokens": output_tokens,
                "total_tokens": total_tokens,
                "total_calls": 1,
                "updated_at": now,
                "doctors": [new_doctor],
            }
        },
        upsert=True,
    )


# ──────────────────────────────────────────────────────────────────────────
# Wrapper: replaces groq_client.chat.completions.create(...) directly
# ──────────────────────────────────────────────────────────────────────────

async def call_llm_with_tracking(
    *,
    groq_client,
    doctor_id: str,
    feature: str,
    messages: list,
    model: str,
    temperature: float = 0.2,
    max_tokens: int = 800,
    response_format: dict | None = None,
    extra: dict | None = None,
):
    """
    Drop-in replacement for:
        completion = groq_client.chat.completions.create(...)
        text = completion.choices[0].message.content.strip()

    Use it instead as:
        text, usage = await call_llm_with_tracking(
            groq_client=groq_client,
            doctor_id=doctor_id,
            feature="tumor_board_presentation",
            messages=[{"role": "user", "content": prompt}],
            model="openai/gpt-oss-120b",
            max_tokens=800,
        )

    Returns (response_text, usage_record).
    """
    create_kwargs = dict(
        model=model,
        messages=messages,
        temperature=temperature,
        max_tokens=max_tokens,
    )
    if response_format is not None:
        create_kwargs["response_format"] = response_format

    completion = groq_client.chat.completions.create(**create_kwargs)

    response_text = completion.choices[0].message.content.strip()

    # Groq mirrors the OpenAI response schema: completion.usage.prompt_tokens /
    # completion.usage.completion_tokens. Fall back to 0 (rather than crashing)
    # if a given SDK version doesn't return usage, but log it so it's visible.
    usage = getattr(completion, "usage", None)
    input_tokens = getattr(usage, "prompt_tokens", 0) if usage else 0
    output_tokens = getattr(usage, "completion_tokens", 0) if usage else 0

    if usage is None:
        logger.warning("call_llm_with_tracking: no usage field on completion for feature=%s — logging 0 tokens", feature)

    usage_record = await log_token_usage(
        doctor_id=doctor_id,
        feature=feature,
        input_tokens=input_tokens,
        output_tokens=output_tokens,
        model=model,
        extra=extra,
    )

    return response_text, usage_record


# ──────────────────────────────────────────────────────────────────────────
# Read side: totals per doctor / per hospital
# ──────────────────────────────────────────────────────────────────────────

async def get_doctor_totals(doctor_id: str, llm_usage_log_collection=None):
    """
    Total tokens for one doctor, broken down by feature. Looks up the
    hospital doc that contains this doctor and pulls their subdoc out.
    NOTE: date filtering is no longer supported (see get_hospital_totals).
    """
    llm_usage_log_collection = llm_usage_log_collection or globals()["llm_usage_log_collection"]
    hospital_doc = await llm_usage_log_collection.find_one({"doctors.doctor_id": doctor_id})
    if not hospital_doc:
        return None

    doctor_doc = next(
        (d for d in hospital_doc.get("doctors", []) if d["doctor_id"] == doctor_id),
        None,
    )
    if not doctor_doc:
        return None

    return {
        "doctor_id": doctor_id,
        "hospital_id": hospital_doc["_id"],
        "hospital_name": hospital_doc.get("hospital_name"),
        "total_input_tokens": doctor_doc["total_input_tokens"],
        "total_output_tokens": doctor_doc["total_output_tokens"],
        "total_tokens": doctor_doc["total_tokens"],
        "total_calls": doctor_doc["total_calls"],
        "by_feature": doctor_doc.get("features", []),
    }


async def get_hospital_totals(hospital_id: str, llm_usage_log_collection=None):
    """
    Totals for an entire hospital, doctor -> feature, straight from the
    rollup doc. NOTE: date_from/date_to filtering is no longer supported
    here — the collection stores running totals, not individual calls, so
    there's nothing to filter by date against. If you need date-range
    totals, that has to come from a separate raw event log.
    """
    llm_usage_log_collection = llm_usage_log_collection or globals()["llm_usage_log_collection"]
    doc = await llm_usage_log_collection.find_one({"_id": hospital_id})
    return doc


# get_usage_log() removed: with llm_usage_log_collection now storing
# rolled-up hospital docs (not one row per call), there is no raw
# per-call history left to drill into. If you need that later, log
# individual calls to a separate collection alongside this rollup.
