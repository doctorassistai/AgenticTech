"""
routes/insurance_claims_rag.py
─────────────────────────────────────────────────────────────────────────────
Upload provider claim-detail Excel batches (ALKOOT-style reports).

Two parallel things happen with every uploaded batch now:

1. EMBEDDING SIDE (unchanged): each claim (grouped by CLAIM NUMBER) gets
   merged into one text blob, embedded with OpenAI, stored in
   `insurance_claim_embeddings`. Powers the free-text "ask about a
   condition" RAG feature (/query).

2. LINE-ITEM SIDE (new): every individual row of the Excel file is stored
   as its own document in `insurance_claim_lines`, keeping every column
   (CPT, secondary ICDs, denial reason, bot remark, amounts, etc.) intact.
   This is what powers the Claim Browser / Search Matrix / Condition
   Dictionary tabs on the frontend — they need exact, structured,
   line-level data, not a text blob, so they can filter/group instantly
   in the browser the same way the original standalone HTML tool did.

IMPORTANT — COLUMN NAME MAPPING:
The Excel headers below marked "GUESS — VERIFY" are placeholders I picked
based on the pattern of your existing REQUIRED_COLS / group_claims columns.
Open one of your real claim-detail Excel files and check the exact header
text for: member ID, benefit type, clinic/provider code, secondary ICD
codes, service code, and patient share. Then update the COL dict below —
that's the only place these names live.
"""
from __future__ import annotations

import io
import os
import re
import json
import uuid
import base64
import asyncio
import logging
from collections import defaultdict
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

import numpy as np
import pandas as pd
from fastapi import APIRouter, File, Form, HTTPException, UploadFile
from motor.motor_asyncio import AsyncIOMotorClient
from pydantic import BaseModel
from pymongo import UpdateOne
from groq import Groq
from openai import OpenAI

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/web/claims-rag", tags=["Insurance Claims RAG"])

# -------------------- INIT --------------------
MONGO_URI = os.getenv("MONGO_URI")
MONGO_DB  = os.getenv("MONGO_DB", "doctorassistai")

motor_client = AsyncIOMotorClient(MONGO_URI)
db = motor_client[MONGO_DB]
claims_collection = db["insurance_claim_embeddings"]
claim_lines_collection = db["insurance_claim_lines"]  # NEW: line-item store

openai_client = OpenAI(
    api_key=os.getenv("OPENROUTER_API_KEY"),
    base_url="https://openrouter.ai/api/v1",
)
groq_client   = Groq(api_key=os.getenv("GROQ_API_KEY"))

EMBED_MODEL = "openai/text-embedding-3-small"
GROQ_MODEL  = "openai/gpt-oss-120b"

SIMILARITY_THRESHOLD = 0.45

REQUIRED_COLS = ["CLAIM NUMBER", "STATUS"]

claims_rag_upload_tasks_col = db["claims_rag_upload_tasks"]

# ── Excel column name mapping used by build_line_docs() ─────────────────
# Anything marked "GUESS — VERIFY" is my best guess at your header text.
COL = {
    "invoice":     "INVOICE NO.",
    "claim":       "CLAIM NUMBER",
    "member_name": "MEMBER NAME",
    "member_id":   "MEMBER ID",                         # GUESS — VERIFY
    "date":        "DATE OF TREATMENT /ADMISSION",
    "benefit":     "BENEFIT TYPE",                       # GUESS — VERIFY
    "clinic":      "CLINICIAN ID",                         # GUESS — VERIFY
    "preauth":     "PREAPPROVAL NO.",                     # GUESS — VERIFY
    "symptoms":    "SYMPTOMS",
    "picd":        "PRINCIPAL ICD CODE",
    "picddesc":    "ICD DESCRIPTION",
    # Secondary ICD codes. Adjust if your file has one comma-separated
    # column instead of several numbered ones.
    "secs": [
        "SECONDARY ICD CODE 1",                           # GUESS — VERIFY
        "SECONDARY ICD CODE 2",                           # GUESS — VERIFY
        "SECONDARY ICD CODE 3",                           # GUESS — VERIFY
        "SECONDARY ICD CODE 4",                           # GUESS — VERIFY
        "SECONDARY ICD CODE 5",                           # GUESS — VERIFY
    ],
    "scode":       "INTERNAL  SERVICE CODE",                        # GUESS — VERIFY
    "sdesc":       "SERVICE DESCRIPTION",
    "cpt":         "CPT CODE",
    "status":      "STATUS",
    "clm":         "AMOUNT CLAIMED",
    "app":         "APPROVED AMOUNT",
    "dis":         "DISALLOWED AMOUNT",
    "pshare":      "PATIENT SHARE",                       # GUESS — VERIFY
    "denial":      "DENIAL REASON",
    "bot":         "FINAL REMARKS",
}


async def ensure_claims_rag_indexes():
    """Call once at startup (from lifespan)."""
    await claims_collection.create_index([("hospital_id", 1), ("claim_number", 1)], unique=True)
    await claims_collection.create_index("hospital_id")
    await claims_rag_upload_tasks_col.create_index("task_id", unique=True)
    # NEW: line-item indexes
    await claim_lines_collection.create_index(
        [("hospital_id", 1), ("inv", 1), ("cpt", 1), ("scode", 1), ("claim", 1)],
        unique=True,
        name="uniq_line",
    )
    await claim_lines_collection.create_index("hospital_id")
    await claim_lines_collection.create_index([("hospital_id", 1), ("picd", 1)])


# -------------------- MODELS --------------------

class QueryRequest(BaseModel):
    hospital_id: str
    condition: str
    top_k: int = 15

# -------------------- HELPERS --------------------

def _clean_id(v: Any) -> str:
    """Excel often round-trips ints as floats (1177878682.0) — normalise."""
    if v is None:
        return ""
    if isinstance(v, float):
        if pd.isna(v):
            return ""
        if v.is_integer():
            return str(int(v))
        return str(v)
    return str(v).strip()


def _clean_num(v: Any) -> float:
    try:
        n = float(v)
        return 0.0 if pd.isna(n) else n
    except (TypeError, ValueError):
        return 0.0


def _clean_str(v: Any) -> str:
    if v is None or (isinstance(v, float) and pd.isna(v)):
        return ""
    return str(v).strip()


def _month_of(date_val: Any) -> str:
    """Best-effort 'YYYY-MM' from whatever date format the sheet uses."""
    if date_val is None or (isinstance(date_val, float) and pd.isna(date_val)):
        return ""
    if isinstance(date_val, (pd.Timestamp, datetime)):
        return date_val.strftime("%Y-%m")
    s = str(date_val).strip()
    if not s:
        return ""
    for fmt in ("%d/%m/%Y", "%Y-%m-%d", "%m/%d/%Y", "%d-%m-%Y"):
        try:
            return datetime.strptime(s, fmt).strftime("%Y-%m")
        except ValueError:
            continue
    try:
        return pd.to_datetime(s, dayfirst=True, errors="raise").strftime("%Y-%m")
    except Exception:
        return ""


def parse_excel_claims(file_bytes: bytes, filename: str) -> pd.DataFrame:
    ext = filename.lower().rsplit(".", 1)[-1]
    engine = "xlrd" if ext == "xls" else "openpyxl"
    df = pd.read_excel(io.BytesIO(file_bytes), engine=engine)
    df.columns = [str(c).strip() for c in df.columns]
    for col in REQUIRED_COLS:
        if col not in df.columns:
            raise ValueError(f"Missing expected column: {col}")
    df["CLAIM NUMBER"] = df["CLAIM NUMBER"].apply(_clean_id)
    return df


def group_claims(df: pd.DataFrame) -> List[dict]:
    """One group per CLAIM NUMBER — merges that claim's line-items into a
    single searchable text block. Feeds the embedding/RAG side only."""
    groups: List[dict] = []

    for claim_number, g in df.groupby("CLAIM NUMBER", dropna=False):
        if not claim_number:
            continue

        statuses = [str(s).strip() for s in g.get("STATUS", []) if str(s).strip()]
        if statuses and all(s == "Approved" for s in statuses):
            overall_status = "Approved"
        elif statuses and all(s == "Rejected" for s in statuses):
            overall_status = "Rejected"
        else:
            overall_status = "Mixed"

        lines = []
        for _, row in g.iterrows():
            lines.append(
                f"Service: {row.get('SERVICE DESCRIPTION', '')} (CPT {row.get('CPT CODE', '')}) | "
                f"Status: {row.get('STATUS', '')} | "
                f"Amount Claimed: {row.get('AMOUNT CLAIMED', '')} | "
                f"Approved Amount: {row.get('APPROVED AMOUNT', '')} | "
                f"Disallowed: {row.get('DISALLOWED AMOUNT', '')} | "
                f"Denial Reason: {row.get('DENIAL REASON', '') or '-'} | "
                f"Remarks: {row.get('FINAL REMARKS', '') or '-'}"
            )

        first = g.iloc[0]
        header = (
            f"Claim {claim_number} | Invoice {_clean_id(first.get('INVOICE NO.'))} | "
            f"Member: {first.get('MEMBER NAME', '')} | "
            f"Diagnosis: {first.get('ICD DESCRIPTION', '')} ({first.get('PRINCIPAL ICD CODE', '')}) | "
            f"Symptoms: {first.get('SYMPTOMS', '')} | "
            f"Provider: {first.get('Provider Name', '')} | "
            f"Policy: {first.get('POLICY NO', '')} | "
            f"Group: {first.get('CORPORATE / GROUP NAME', '')} | "
            f"Date: {first.get('DATE OF TREATMENT /ADMISSION', '')}"
        )
        text = header + "\n" + "\n".join(lines)

        def _sum(col: str) -> float:
            if col not in g:
                return 0.0
            return float(pd.to_numeric(g[col], errors="coerce").fillna(0).sum())

        groups.append({
            "claim_number": claim_number,
            "invoice_no": _clean_id(first.get("INVOICE NO.")),
            "member_name": str(first.get("MEMBER NAME", "")),
            "icd_description": str(first.get("ICD DESCRIPTION", "")),
            "principal_icd_code": str(first.get("PRINCIPAL ICD CODE", "")),
            "symptoms": str(first.get("SYMPTOMS", "")),
            "provider_name": str(first.get("Provider Name", "")),
            "policy_no": str(first.get("POLICY NO", "")),
            "corporate_group_name": str(first.get("CORPORATE / GROUP NAME", "")),
            "overall_status": overall_status,
            "amount_claimed_total": _sum("AMOUNT CLAIMED"),
            "approved_amount_total": _sum("APPROVED AMOUNT"),
            "disallowed_amount_total": _sum("DISALLOWED AMOUNT"),
            "text": text,
        })

    return groups


def build_line_docs(df: pd.DataFrame, hospital_id: str, source_file: str) -> List[dict]:
    """NEW: one document per Excel row, field names matching what the
    frontend's Claim Browser / Search Matrix / Condition Dictionary tabs
    expect (short keys, mirroring the standalone HTML tool's row shape).

    Call this from the Celery upload task alongside the existing
    embedding pipeline — see the note at the bottom of this file for the
    one snippet you need to add there.
    """
    docs: List[dict] = []
    now = datetime.now(timezone.utc)

    for _, row in df.iterrows():
        secs = []
        for col in COL["secs"]:
            code = _clean_str(row.get(col)).upper()
            if code:
                secs.append(code)

        invoice = _clean_id(row.get(COL["invoice"]))
        claim_number = _clean_id(row.get(COL["claim"]))
        cpt = _clean_str(row.get(COL["cpt"]))
        scode = _clean_str(row.get(COL["scode"]))
        status = _clean_str(row.get(COL["status"])) or "Approved"

        doc = {
            "hospital_id": hospital_id,
            "source_file": source_file,
            "uploaded_at": now,
            "m": _month_of(row.get(COL["date"])),
            "inv": invoice,
            "claim": claim_number,
            "mname": _clean_str(row.get(COL["member_name"])),
            "mid": _clean_id(row.get(COL["member_id"])),
            "dot": _clean_str(row.get(COL["date"])),
            "ben": _clean_str(row.get(COL["benefit"])),
            "clin": _clean_str(row.get(COL["clinic"])),
            "pre": _clean_str(row.get(COL["preauth"])),
            "sym": _clean_str(row.get(COL["symptoms"])),
            "picd": _clean_str(row.get(COL["picd"])).upper(),
            "picddesc": _clean_str(row.get(COL["picddesc"])),
            "secs": secs,
            "scode": scode,
            "sdesc": _clean_str(row.get(COL["sdesc"])),
            "cpt": cpt,
            "status": "Rejected" if status.strip().lower().startswith("reject") else "Approved",
            "clm": _clean_num(row.get(COL["clm"])),
            "app": _clean_num(row.get(COL["app"])),
            "dis": _clean_num(row.get(COL["dis"])),
            "pshare": _clean_num(row.get(COL["pshare"])),
            "denial": _clean_str(row.get(COL["denial"])),
            "bot": _clean_str(row.get(COL["bot"])),
        }
        docs.append(doc)

    return docs


async def store_line_docs(docs: List[dict], collection=None) -> int:
    """Upserts line docs, deduped on (hospital_id, inv, cpt, scode, claim)
    so re-uploading the same batch doesn't create duplicate lines.

    `collection` should be a Motor collection bound to a client created
    within the CURRENT event loop (e.g. inside a Celery task's own
    asyncio.run() call). Falls back to the global claim_lines_collection
    only for callers running on a single long-lived loop (e.g. FastAPI
    routes) — never pass no collection from a Celery task, since the
    global client is bound to whichever loop first used it and breaks
    across separate asyncio.run() invocations."""
    if not docs:
        return 0
    coll = collection if collection is not None else claim_lines_collection
    ops = [
        UpdateOne(
            {
                "hospital_id": d["hospital_id"],
                "inv": d["inv"],
                "cpt": d["cpt"],
                "scode": d["scode"],
                "claim": d["claim"],
            },
            {"$set": d},
            upsert=True,
        )
        for d in docs
    ]
    result = await coll.bulk_write(ops, ordered=False)


def compute_combos(rows: List[dict], min_n: int = 3, min_lift: float = 0.20) -> List[dict]:
    """Mines 'CPT X gets rejected much more often when co-billed with CPT Y'
    patterns from the line data, mirroring the original HTML tool's
    precomputed combo-risk warnings.

    - base rate: how often CPT X is rejected overall
    - pair rate: how often CPT X is rejected on invoices that also billed CPT Y
    - a combo is reported when pair rate exceeds base rate by at least
      `min_lift` (20 percentage points by default) and is backed by at
      least `min_n` co-billed invoices, to avoid flagging noise from a
      single unlucky claim.
    """
    by_invoice: Dict[str, List[dict]] = defaultdict(list)
    for r in rows:
        if r.get("inv"):
            by_invoice[r["inv"]].append(r)

    cpt_name: Dict[str, str] = {}
    cpt_total = defaultdict(int)
    cpt_rejected = defaultdict(int)
    pair_total = defaultdict(int)
    pair_rejected = defaultdict(int)

    for inv, lines in by_invoice.items():
        cpts_here = {l["cpt"] for l in lines if l.get("cpt")}
        for l in lines:
            cpt = l.get("cpt")
            if not cpt:
                continue
            cpt_name.setdefault(cpt, l.get("sdesc", ""))
            cpt_total[cpt] += 1
            rejected = l.get("status") == "Rejected"
            if rejected:
                cpt_rejected[cpt] += 1
            for other in cpts_here:
                if other == cpt:
                    continue
                pair_total[(cpt, other)] += 1
                if rejected:
                    pair_rejected[(cpt, other)] += 1

    combos = []
    for (cpt, other), n in pair_total.items():
        if n < min_n or cpt_total.get(cpt, 0) == 0:
            continue
        base_rate = cpt_rejected[cpt] / cpt_total[cpt]
        pair_rate = pair_rejected[(cpt, other)] / n
        if pair_rate - base_rate >= min_lift:
            combos.append({
                "rej": cpt,
                "with": other,
                "withName": cpt_name.get(other, ""),
                "rate": round(pair_rate, 4),
                "base": round(base_rate, 4),
                "n": n,
                "why": "Elevated rejection rate when co-billed on the same invoice",
            })

    return combos


async def embed_texts(texts: List[str]) -> List[List[float]]:
    if not texts:
        return []
    BATCH = 100

    async def _embed_batch(chunk: List[str]) -> List[List[float]]:
        resp = await asyncio.to_thread(
            openai_client.embeddings.create, model=EMBED_MODEL, input=chunk
        )
        return [d.embedding for d in resp.data]

    chunks = [texts[i:i + BATCH] for i in range(0, len(texts), BATCH)]
    results = await asyncio.gather(*(_embed_batch(c) for c in chunks))

    out: List[List[float]] = []
    for r in results:
        out.extend(r)
    return out


async def generate_narrative(condition: str, approved: List[dict], rejected: List[dict]) -> dict:
    def _format(matches: List[dict]) -> str:
        if not matches:
            return "No matching claims found."
        return "\n\n".join(f"[Claim {m.get('claim_number')}] {m.get('text', '')[:1200]}" for m in matches)

    prompt = f"""You are analyzing hospital insurance claims data for the condition/diagnosis: "{condition}".

You are shown a SAMPLE of the matching claims below, not necessarily all of them. Do not state or imply specific counts or totals in your summaries — exact counts and amounts are reported separately and shown to the user independently of this text.

APPROVED CLAIMS EVIDENCE:
{_format(approved)}

REJECTED CLAIMS EVIDENCE:
{_format(rejected)}

Write two summaries based STRICTLY on the evidence above (never invent a pattern not supported by it; if one side has no evidence, say so plainly):
1. approved_summary: the common pattern(s) behind why these claims were approved (documentation, coding, prior approval, etc). 3-5 sentences.
2. rejected_summary: the common denial reasons and patterns behind why these claims were rejected. 3-5 sentences.

Respond with ONLY a JSON object, no markdown fences, no extra text:
{{"approved_summary": "...", "rejected_summary": "..."}}"""

    resp = await asyncio.to_thread(
        groq_client.chat.completions.create,
        model=GROQ_MODEL,
        messages=[{"role": "user", "content": prompt}],
        temperature=0.2,
    )
    raw = resp.choices[0].message.content.strip()
    raw = re.sub(r"^```(json)?|```$", "", raw, flags=re.MULTILINE).strip()
    try:
        return json.loads(raw)
    except json.JSONDecodeError:
        logger.warning("generate_narrative: model did not return valid JSON, returning raw text")
        return {"approved_summary": raw, "rejected_summary": ""}


# -------------------- ROUTES --------------------
@router.post("/upload")
async def upload_claims_excel(hospital_id: str = Form(...), files: List[UploadFile] = File(...)):
    """Accepts one or more Excel files in a single multipart request.
    Each file is dispatched as its own Celery task on advanced_upload_queue
    and returns immediately with a task_id to poll."""
    from celery_worker.claims_rag_upload_task import process_claims_rag_upload

    jobs = []

    for file in files:
        if not file.filename.lower().endswith((".xls", ".xlsx")):
            jobs.append({
                "file": file.filename,
                "status": "rejected",
                "error": "Only .xls or .xlsx files are supported",
            })
            continue

        file_bytes = await file.read()
        file_b64 = base64.b64encode(file_bytes).decode("ascii")
        task_id = str(uuid.uuid4())
        now = datetime.now(timezone.utc)

        await claims_rag_upload_tasks_col.insert_one({
            "task_id": task_id,
            "hospital_id": hospital_id,
            "file_name": file.filename,
            "status": "queued",
            "result": None,
            "error": None,
            "created_at": now,
            "updated_at": now,
        })

        process_claims_rag_upload.delay(task_id, hospital_id, file.filename, file_b64)

        jobs.append({"file": file.filename, "task_id": task_id, "status": "queued"})

    return {"success": True, "hospital_id": hospital_id, "jobs": jobs}


@router.get("/upload-status/{task_id}")
async def claims_upload_status(task_id: str):
    doc = await claims_rag_upload_tasks_col.find_one({"task_id": task_id}, {"_id": 0})
    if not doc:
        raise HTTPException(status_code=404, detail="Unknown task_id")
    return doc


@router.get("/summary")
async def claims_summary(hospital_id: str):
    count = await claims_collection.count_documents({"hospital_id": hospital_id})
    latest = await claims_collection.find(
        {"hospital_id": hospital_id}, {"_id": 0, "source_file": 1, "uploaded_at": 1}
    ).sort("uploaded_at", -1).limit(1).to_list(length=1)
    return {
        "success": True,
        "hospital_id": hospital_id,
        "claims_count": count,
        "last_upload": latest[0] if latest else None,
    }


@router.get("/lines")
async def get_claim_lines(hospital_id: str):
    """NEW: full structured line-item dataset for a hospital, plus the
    'meta' block (months, benefit types, an ICD code->description map,
    and mined combo-risk rules). This is what the Claim Browser / Search
    Matrix / Condition Dictionary tabs load once and then filter entirely
    client-side, same approach as the original standalone HTML tool."""
    docs = await claim_lines_collection.find(
        {"hospital_id": hospital_id}, {"_id": 0}
    ).to_list(length=50000)

    if not docs:
        raise HTTPException(status_code=404, detail="No claim line data uploaded yet for this hospital")

    icd_dict: Dict[str, str] = {}
    for d in docs:
        if d.get("picd") and d.get("picddesc"):
            icd_dict.setdefault(d["picd"], d["picddesc"])

    months = sorted({d["m"] for d in docs if d.get("m")})
    benefits = sorted({d["ben"] for d in docs if d.get("ben")})
    combos = compute_combos(docs)

    return {
        "success": True,
        "rows": docs,
        "meta": {
            "months": months,
            "benefits": benefits,
            "icdDict": icd_dict,
            "combos": combos,
        },
    }


@router.post("/query")
async def query_claims(payload: QueryRequest):
    condition = payload.condition.strip()
    if not condition:
        raise HTTPException(status_code=400, detail="condition is required")

    try:
        condition_embedding = (await embed_texts([condition]))[0]
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Embedding generation failed: {e}")

    docs = await claims_collection.find(
        {"hospital_id": payload.hospital_id}, {"_id": 0}
    ).to_list(length=20000)

    if not docs:
        raise HTTPException(status_code=404, detail="No claims uploaded yet for this hospital")

    q_vec = np.array(condition_embedding, dtype=np.float32)
    q_norm = np.linalg.norm(q_vec) or 1.0

    scored = []
    for d in docs:
        emb = d.get("embedding")
        if not emb:
            continue
        v = np.array(emb, dtype=np.float32)
        v_norm = np.linalg.norm(v) or 1.0
        sim = float(np.dot(q_vec, v) / (q_norm * v_norm))
        scored.append((sim, d))
    scored.sort(key=lambda x: x[0], reverse=True)

    relevant = [(sim, d) for sim, d in scored if sim >= SIMILARITY_THRESHOLD]
    approved_relevant = [d for _, d in relevant if d.get("overall_status") in ("Approved", "Mixed")]
    rejected_relevant = [d for _, d in relevant if d.get("overall_status") in ("Rejected", "Mixed")]

    if not approved_relevant and not rejected_relevant:
        raise HTTPException(status_code=404, detail="No matching claims found for that condition")

    def _totals(matches: List[dict]) -> dict:
        return {
            "count": len(matches),
            "amount_claimed_total": round(sum(m.get("amount_claimed_total", 0) or 0 for m in matches), 2),
            "approved_amount_total": round(sum(m.get("approved_amount_total", 0) or 0 for m in matches), 2),
            "disallowed_amount_total": round(sum(m.get("disallowed_amount_total", 0) or 0 for m in matches), 2),
        }

    approved_totals = _totals(approved_relevant)
    rejected_totals = _totals(rejected_relevant)

    from collections import Counter
    icd_breakdown = Counter(d.get("icd_description", "?") for d in approved_relevant + rejected_relevant)
    approved_evidence = approved_relevant[: payload.top_k]
    rejected_evidence = rejected_relevant[: payload.top_k]

    narrative = await generate_narrative(condition, approved_evidence, rejected_evidence)

    return {
        "success": True,
        "condition": condition,
        "approved_summary": narrative.get("approved_summary", ""),
        "rejected_summary": narrative.get("rejected_summary", ""),
        "approved_evidence_count": approved_totals["count"],
        "rejected_evidence_count": rejected_totals["count"],
        "approved_totals": approved_totals,
        "rejected_totals": rejected_totals,
        "llm_evidence_sample_size": {
            "approved": len(approved_evidence),
            "rejected": len(rejected_evidence),
        },
        "debug_icd_breakdown": dict(icd_breakdown.most_common(15)),
    }


# ─────────────────────────────────────────────────────────────────────────
# ACTION NEEDED IN celery_worker/claims_rag_upload_task.py
# ─────────────────────────────────────────────────────────────────────────
# Your Celery task currently calls parse_excel_claims() + group_claims() +
# embed_texts() and stores into `insurance_claim_embeddings`. Add this
# right alongside that, using the SAME parsed `df` and `hospital_id`
# already in scope there:
#
#   from routes.insurance_claims_rag import build_line_docs, store_line_docs
#   ...
#   line_docs = build_line_docs(df, hospital_id, filename)
#   await store_line_docs(line_docs)
#
# That's the only change needed there — everything else (embeddings,
# task status polling) stays exactly as it is.
# ─────────────────────────────────────────────────────────────────────────