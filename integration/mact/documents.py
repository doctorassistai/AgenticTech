"""
integration/mact/documents.py

Real document handling for MACT cases (Documents tab).

  public  POST   /hms/mact/cases/{case_id}/documents      multipart: file, doc_name?
  public  GET    /hms/mact/cases/{case_id}/documents
  public  GET    /hms/mact/documents/{doc_id}/file        inline view (?download=true to save)
  public  POST   /hms/mact/documents/{doc_id}/retry       re-run parsing of a failed / skipped file
  public  DELETE /hms/mact/documents/{doc_id}             soft delete

Rules
  * Only role "mact_adjudicator" may use these routes.
  * Sample cases (is_sample) never accept uploads.
  * One document per file; several files may back the same checklist row (doc_name).
  * Files live in the platform storage service (STORAGE_BASE_URL), the same service the
    claims case-documents router uses. The browser never sees the storage URL: view and
    download go through the authenticated route below.
  * After upload the file is parsed with LlamaCloud (cost_effective tier) as a background
    task in this process. Page markdown is kept in mact_doc_pages for the later extraction
    and findings steps. No task queue: a restart can interrupt a parse, so a parse stuck in
    "parsing" for more than PARSE_STALE_MINUTES is shown as failed and can be retried.
"""

import asyncio
import hashlib
import io
import logging
import os
import re
import tempfile
import uuid
from datetime import datetime, timedelta, timezone
from typing import Optional
from urllib.parse import quote

import httpx
from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile, status
from fastapi.responses import Response
from pymongo.errors import DuplicateKeyError

from .auth import actor_of, require_user
from .db import cases, doc_pages, documents, events, llama_stats

logger = logging.getLogger("mact.documents")

router = APIRouter(tags=["mact-documents"])

ALLOWED_ROLE = "mact_adjudicator"
MAX_BYTES = 20 * 1024 * 1024
_KIND_BY_EXT = {".pdf": "pdf", ".jpg": "jpg", ".jpeg": "jpg", ".png": "png", ".webp": "webp"}
_CONTENT_TYPE = {"pdf": "application/pdf", "jpg": "image/jpeg", "png": "image/png", "webp": "image/webp"}

STORAGE_BASE_URL = os.getenv("STORAGE_BASE_URL", "https://doctorassist.ai/uploads").rstrip("/")
LLAMA_API_KEY = os.getenv("LLAMA_API_KEY")
LLAMA_CREDIT_BUDGET = int(os.getenv("LLAMA_CREDIT_BUDGET", "45000"))
CREDITS_PER_PAGE = int(os.getenv("LLAMA_CREDITS_PER_PAGE", "3"))
PARSE_STALE_MINUTES = 15

IST = timezone(timedelta(hours=5, minutes=30))


# ---------------------------------------------------------------------------
# Small helpers
# ---------------------------------------------------------------------------
async def require_adjudicator(user: dict = Depends(require_user)) -> dict:
    if user.get("role") != ALLOWED_ROLE:
        raise HTTPException(status_code=403, detail="Only MACT adjudicators can use case documents")
    return user


def _now() -> datetime:
    """Naive UTC, which is what pymongo stores and returns."""
    return datetime.now(timezone.utc).replace(tzinfo=None)


def _iso(v):
    if isinstance(v, datetime):
        return v.replace(tzinfo=timezone.utc).isoformat().replace("+00:00", "Z")
    return v


def _public(d: dict) -> dict:
    """What the browser may see. No storage path, no hash."""
    return {
        "id": d["id"],
        "case_id": d["case_id"],
        "doc_name": d.get("doc_name"),
        "file_name": d["file_name"],
        "content_type": d["content_type"],
        "size": d["size"],
        "status": d["status"],  # parsing | parsed | failed | skipped
        "pages": d.get("pages") or 0,
        "error": d.get("error"),
        "uploaded_by": d.get("uploaded_by"),
        "uploaded_at": _iso(d.get("uploaded_at")),
        "parsed_at": _iso(d.get("parsed_at")),
    }


def _clean_filename(name: Optional[str]) -> str:
    base = os.path.basename((name or "").replace("\\", "/")).strip()
    base = re.sub(r"[^\w.\- ()]", "_", base)[:150].strip(" .")
    return base or "document"


def _sniff(b: bytes) -> Optional[str]:
    if b"%PDF-" in b[:1024]:
        return "pdf"
    if b[:3] == b"\xff\xd8\xff":
        return "jpg"
    if b[:8] == b"\x89PNG\r\n\x1a\n":
        return "png"
    if b[:4] == b"RIFF" and b[8:12] == b"WEBP":
        return "webp"
    return None


def _client() -> httpx.AsyncClient:
    return httpx.AsyncClient(timeout=httpx.Timeout(60.0, connect=10.0))


async def _event(case_id: str, actor: str, action: str, text: str) -> None:
    try:
        await events.insert_one({
            "case_id": case_id, "at": datetime.now(IST).strftime("%Y-%m-%d %H:%M"),
            "src": "Upload", "actor": actor, "action": action, "text": text,
            "created_at": _now(),
        })
    except Exception:
        logger.exception("event log write failed for %s (document action itself succeeded)", case_id)


async def _get_case(case_id: str) -> dict:
    c = await cases.find_one({"id": case_id}, {"_id": 0, "id": 1, "is_sample": 1})
    if not c:
        raise HTTPException(status_code=404, detail="Case not found")
    return c


async def _get_doc(doc_id: str) -> dict:
    d = await documents.find_one({"id": doc_id, "deleted": False}, {"_id": 0})
    if not d:
        raise HTTPException(status_code=404, detail="Document not found")
    return d


async def _set(doc_id: str, **fields) -> None:
    fields["updated_at"] = _now()
    await documents.update_one({"id": doc_id}, {"$set": fields})


# ---------------------------------------------------------------------------
# Storage service
# ---------------------------------------------------------------------------
async def _store_file(case_id: str, user_id: str, filename: str, content: bytes, content_type: str) -> str:
    """Upload to the storage service; returns 'case_id/stored_filename' (same shape the claims service keeps)."""
    try:
        async with _client() as http:
            r = await http.post(
                f"{STORAGE_BASE_URL}/upload",
                params={"doctor_id": user_id, "patient_id": case_id, "doc_type": "mact_document"},
                files={"file": (filename, content, content_type)},
            )
    except httpx.HTTPError:
        logger.exception("storage upload failed for case %s", case_id)
        raise HTTPException(status_code=502, detail="Storage service is not reachable")
    if r.status_code != 200:
        logger.error("storage upload rejected (%s): %s", r.status_code, r.text[:200])
        raise HTTPException(status_code=502, detail="Storage service rejected the file")
    try:
        full_path = (r.json() or {}).get("filename", "")
    except ValueError:
        full_path = ""
    stored = full_path.split("/")[-1]
    if not stored:
        raise HTTPException(status_code=502, detail="Storage service returned no file name")
    return f"{case_id}/{stored}"


async def _fetch_stored(storage_path: str) -> bytes:
    try:
        async with _client() as http:
            r = await http.get(f"{STORAGE_BASE_URL}/files/{storage_path}")
    except httpx.HTTPError:
        logger.exception("storage fetch failed for %s", storage_path)
        raise HTTPException(status_code=502, detail="Storage service is not reachable")
    if r.status_code == 404:
        raise HTTPException(status_code=404, detail="The file is missing from storage")
    if r.status_code != 200:
        raise HTTPException(status_code=502, detail="Storage service could not return the file")
    return r.content


# ---------------------------------------------------------------------------
# LlamaCloud parsing (background)
# ---------------------------------------------------------------------------
_tasks: set = set()


def _spawn(coro) -> None:
    t = asyncio.create_task(coro)
    _tasks.add(t)  # keep a reference, otherwise the task can be garbage-collected mid-run
    t.add_done_callback(_tasks.discard)


def _page_count(content: bytes, kind: str) -> int:
    if kind != "pdf":
        return 1
    try:
        try:
            from pypdf import PdfReader
        except ImportError:
            from PyPDF2 import PdfReader
        return max(len(PdfReader(io.BytesIO(content)).pages), 1)
    except Exception:
        logger.warning("could not read PDF page count; assuming 1")
        return 1


def _llama_parse_sync(content: bytes, filename: str) -> list:
    """Blocking. Returns one markdown string per page. Same call the claims service uses."""
    if not LLAMA_API_KEY:
        raise RuntimeError("LLAMA_API_KEY is not configured")
    from llama_cloud import LlamaCloud  # imported here so a missing package cannot break service start-up

    client = LlamaCloud(api_key=LLAMA_API_KEY)
    with tempfile.TemporaryDirectory() as tmp:
        path = os.path.join(tmp, filename.replace(" ", "_"))
        with open(path, "wb") as fh:
            fh.write(content)
        uploaded = client.files.create(file=path, purpose="parse")
        result = client.parsing.parse(
            file_id=uploaded.id, tier="cost_effective", version="latest", expand=["markdown"],
        )
        return [(p.markdown or "") for p in result.markdown.pages]


async def _parse_document(doc_id: str, case_id: str, filename: str, content: bytes, kind: str) -> None:
    try:
        est = await asyncio.to_thread(_page_count, content, kind) * CREDITS_PER_PAGE
        stats = await llama_stats.find_one({"_id": "global_total"}) or {}
        used = stats.get("credits_used", 0)
        if used + est > LLAMA_CREDIT_BUDGET:
            await _set(
                doc_id, status="skipped",
                error=(f"LlamaCloud credit budget nearly exhausted ({used}/{LLAMA_CREDIT_BUDGET} used, "
                       f"needs about {est}). The file is stored; retry once credits are available."),
            )
            return

        pages = await asyncio.to_thread(_llama_parse_sync, content, filename)
        if not any(p.strip() for p in pages):
            await _set(doc_id, status="failed", error="No readable text was found in this file")
            return

        await doc_pages.delete_many({"doc_id": doc_id})
        await doc_pages.insert_many([
            {"doc_id": doc_id, "case_id": case_id, "page_number": i + 1, "text": t}
            for i, t in enumerate(pages)
        ])
        # Same shared counter the claims service reads for its budget check.
        await llama_stats.update_one(
            {"_id": "global_total"}, {"$inc": {"credits_used": len(pages) * CREDITS_PER_PAGE}}, upsert=True,
        )
        await _set(doc_id, status="parsed", pages=len(pages), error=None, parsed_at=_now(),
                   chars=sum(len(t) for t in pages))
    except Exception as e:
        logger.exception("parse failed for %s", doc_id)
        try:
            await _set(doc_id, status="failed", error=str(e)[:300] or "Parsing failed")
        except Exception:
            logger.exception("could not record parse failure for %s", doc_id)


# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------
@router.post("/cases/{case_id}/documents", status_code=status.HTTP_201_CREATED)
async def upload_document(
    case_id: str,
    file: UploadFile = File(...),
    doc_name: Optional[str] = Form(default=None),
    user: dict = Depends(require_adjudicator),
):
    case = await _get_case(case_id)
    if case.get("is_sample"):
        raise HTTPException(status_code=409, detail="Sample cases do not accept uploads")

    filename = _clean_filename(file.filename)
    ext = os.path.splitext(filename)[1].lower()
    if ext not in _KIND_BY_EXT:
        raise HTTPException(status_code=400, detail="Only PDF, JPG, PNG and WebP files are accepted")
    content = await file.read(MAX_BYTES + 1)
    if not content:
        raise HTTPException(status_code=400, detail="The file is empty")
    if len(content) > MAX_BYTES:
        raise HTTPException(status_code=413, detail="File exceeds the 20 MB limit")
    kind = _sniff(content)
    if kind != _KIND_BY_EXT[ext]:
        raise HTTPException(status_code=400, detail="File content does not match its extension")

    name = (doc_name or "").strip()[:120] or None
    sha = hashlib.sha256(content).hexdigest()
    dup = await documents.find_one({"case_id": case_id, "sha256": sha, "deleted": False}, {"_id": 0, "id": 1, "file_name": 1})
    if dup:
        raise HTTPException(status_code=409, detail={
            "message": f"This file is already uploaded for this case ({dup['file_name']})",
            "existing_doc_id": dup["id"],
        })

    actor = actor_of(user)
    content_type = _CONTENT_TYPE[kind]
    storage_path = await _store_file(case_id, user.get("sys_user_id") or actor, filename, content, content_type)

    now = _now()
    doc = {
        "id": "MDOC-" + uuid.uuid4().hex[:10].upper(),
        "case_id": case_id, "doc_name": name, "file_name": filename,
        "content_type": content_type, "size": len(content), "sha256": sha,
        "storage_path": storage_path, "status": "parsing", "pages": 0, "error": None,
        "uploaded_by": actor, "uploaded_at": now, "updated_at": now, "parsed_at": None,
        "deleted": False,
    }
    try:
        await documents.insert_one(doc)
    except DuplicateKeyError:  # lost a race with an identical concurrent upload
        raise HTTPException(status_code=409, detail="This file is already uploaded for this case")

    await _event(case_id, actor, "Document uploaded", f"{filename}" + (f" as {name}" if name else ""))
    _spawn(_parse_document(doc["id"], case_id, filename, content, kind))
    return {"status": "success", "document": _public(doc)}


@router.get("/cases/{case_id}/documents")
async def list_documents(case_id: str, user: dict = Depends(require_adjudicator)):
    await _get_case(case_id)
    cutoff = _now() - timedelta(minutes=PARSE_STALE_MINUTES)
    await documents.update_many(
        {"case_id": case_id, "status": "parsing", "updated_at": {"$lt": cutoff}},
        {"$set": {"status": "failed", "updated_at": _now(),
                  "error": "Parsing was interrupted (service restart or timeout). Use Retry."}},
    )
    items = await (documents.find({"case_id": case_id, "deleted": False}, {"_id": 0})
                   .sort("uploaded_at", 1).to_list(length=500))
    return {"status": "success", "case_id": case_id, "documents": [_public(d) for d in items]}


@router.get("/documents/{doc_id}/file")
async def get_document_file(doc_id: str, download: bool = False, user: dict = Depends(require_adjudicator)):
    doc = await _get_doc(doc_id)
    content = await _fetch_stored(doc["storage_path"])
    disposition = "attachment" if download else "inline"
    return Response(
        content=content,
        media_type=doc["content_type"],
        headers={
            "Content-Disposition": f"{disposition}; filename*=UTF-8''{quote(doc['file_name'])}",
            "Cache-Control": "private, no-store",
            "X-Content-Type-Options": "nosniff",
        },
    )


@router.post("/documents/{doc_id}/retry")
async def retry_document(doc_id: str, user: dict = Depends(require_adjudicator)):
    doc = await _get_doc(doc_id)
    if doc["status"] not in ("failed", "skipped"):
        raise HTTPException(status_code=409, detail="Only failed or skipped files can be retried")
    content = await _fetch_stored(doc["storage_path"])
    kind = _KIND_BY_EXT.get(os.path.splitext(doc["file_name"])[1].lower(), "pdf")
    await _set(doc_id, status="parsing", error=None)
    _spawn(_parse_document(doc_id, doc["case_id"], doc["file_name"], content, kind))
    doc = await _get_doc(doc_id)
    return {"status": "success", "document": _public(doc)}


@router.delete("/documents/{doc_id}")
async def delete_document(doc_id: str, user: dict = Depends(require_adjudicator)):
    doc = await _get_doc(doc_id)
    actor = actor_of(user)
    # Soft delete: the stored file is kept (no delete call on the storage service).
    await _set(doc_id, deleted=True, deleted_by=actor, deleted_at=_now())
    await doc_pages.delete_many({"doc_id": doc_id})
    await _event(doc["case_id"], actor, "Document removed", doc["file_name"])
    return {"status": "success", "id": doc_id}