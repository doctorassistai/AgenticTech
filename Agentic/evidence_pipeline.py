"""
evidence_pipeline.py
====================
FastAPI router for the Agentic Graph RAG Clinical Knowledge Pipeline.

Replaces the old pipeline.py which incorrectly imported MedicalRAGPipeline.
Now uses AgenticGraphRAGPipeline from evidence_rag_pipeline.py directly.

Routes
──────
  POST /pipeline/run              — upload files + run all 8 stages
  POST /pipeline/run-urls         — URL list + run all 8 stages
  POST /pipeline/query            — ask a clinical question (DeltaQueryRequest)
  GET  /pipeline/{pipeline_id}    — fetch a stored graph result
  GET  /pipeline/{pipeline_id}/graph — alias, same as above
  GET  /pipeline/                 — list all stored pipeline IDs
  DELETE /pipeline/{pipeline_id}  — remove a stored result

All graph results are stored in-memory in PIPELINE_RESULTS.
Replace with MongoDB / Redis as needed.
"""

from __future__ import annotations

import asyncio
from pathlib import Path
from typing import Any, Dict, List, Optional

from fastapi import Query

from fastapi import APIRouter, File, Form, HTTPException, UploadFile
from loguru import logger
import requests

from Agentic.clienty import send_agent_pdf_task,send_agent_pdf_urls_task

# ─────────────────────────────────────────────────────────────────
# MODELS  (single source of truth)
# ─────────────────────────────────────────────────────────────────

from Agentic.evidence_models import (
    ClinicalKnowledgeGraph,
    DeltaQueryRequest,
    DeltaQueryResponse,
    DocumentSource,
    GuidelineSource,
    SourceType,
)

# ─────────────────────────────────────────────────────────────────
# PIPELINE  (the 8-stage agentic orchestrator)
# ─────────────────────────────────────────────────────────────────

from Agentic.evidence_rag_pipeline import AgenticGraphRAGPipeline
STORAGE_BASE_URL = "https://doctorassist.ai/uploads" 
# ─────────────────────────────────────────────────────────────────
# INGESTION HELPERS
# ─────────────────────────────────────────────────────────────────

from Agentic.evidence_ingestion import (
    extract_file,          # routes .pdf/.docx/.txt by extension
    extract_url,           # async URL fetcher
    _detect_guideline_source,
)


from Agentic.evidence_graph_writer import (
    ClinicalGraphWriter,
    get_driver,
)

graph_writer = ClinicalGraphWriter()

from pydantic import BaseModel

class RunUrlsBody(BaseModel):
    urls: List[str]
    guideline_source: str = "other"
    version: Optional[str] = None

# from evidence_validation_agents import (
#     ChunkRecord, CoverageReport,
#     build_chunk_records,
#     CoverageValidationAgent,
#     MissingEntityCriticAgent,
#     RetryExtractionAgent,
#     GraphRepairAgent,
#     build_coverage_score,
# )

# ─────────────────────────────────────────────────────────────────
# ROUTER
# ─────────────────────────────────────────────────────────────────

router = APIRouter(
    prefix="/pipeline",
    tags=["Clinical Knowledge Graph"],
)

# ─────────────────────────────────────────────────────────────────
# IN-MEMORY STORE
# Replace with MongoDB later:
#   PIPELINE_RESULTS[pid] = graph.model_dump()
# ─────────────────────────────────────────────────────────────────

PIPELINE_RESULTS: Dict[str, Dict[str, Any]] = {}

# Each pipeline run gets its own AgenticGraphRAGPipeline instance
# so queries can be directed to the right one.
PIPELINE_INSTANCES: Dict[str, AgenticGraphRAGPipeline] = {}


# ─────────────────────────────────────────────────────────────────
# HELPERS
# ─────────────────────────────────────────────────────────────────

def _guideline_source_from_str(s: str) -> GuidelineSource:
    try:
        return GuidelineSource(s.lower())
    except ValueError:
        return GuidelineSource.OTHER


def _store(
        pipeline: AgenticGraphRAGPipeline,
        doctor_id: str,
    ) -> Dict[str, Any]:
    """Persist pipeline result and instance; return serialised graph."""
    graph = pipeline.graph
    if graph is None:
        raise RuntimeError("Pipeline produced no graph.")
    graph.compute_summary()
    serialised = graph.model_dump()
    PIPELINE_RESULTS[graph.pipeline_id] = {
        "doctor_id": doctor_id,
        "graph": serialised
    }
    PIPELINE_INSTANCES[graph.pipeline_id] = pipeline
    logger.info(
        f"Stored pipeline {graph.pipeline_id} — "
        f"nodes={graph.total_nodes} edges={graph.total_edges} "
        f"deltas={graph.total_deltas} chains={graph.total_chains}"
    )
    return serialised


def _get_instance(pipeline_id: Optional[str]) -> AgenticGraphRAGPipeline:
    """Return the pipeline instance for a given ID (or the most recent one)."""
    if pipeline_id and pipeline_id in PIPELINE_INSTANCES:
        return PIPELINE_INSTANCES[pipeline_id]
    if PIPELINE_INSTANCES:
        return list(PIPELINE_INSTANCES.values())[-1]
    raise HTTPException(status_code=404, detail="No pipeline runs found.")


# ─────────────────────────────────────────────────────────────────
# POST /pipeline/run
# Upload one or more files (PDF / DOCX / TXT / MD) and run pipeline
# ─────────────────────────────────────────────────────────────────




@router.post("/run")
async def run_pipeline_from_files(
    files: List[UploadFile] = File(...),
    guideline_source: str = Form(default="other"),
    version: str = Form(default=""),
    doctor_id: str = Query(...),
):

    """
    Queue Agent PDF pipeline jobs.
    """

    if not files:

        raise HTTPException(
            status_code=400,
            detail="No files provided."
        )

    queued_tasks = []

    for upload in files:

        filename = upload.filename or "unknown"

        ext = Path(filename).suffix.lower()

        if ext not in (
            ".pdf",
            ".docx",
            ".doc",
            ".txt",
            ".md",
            ".csv",
        ):

            raise HTTPException(
                status_code=400,
                detail=f"Unsupported file type: {ext}"
            )

        logger.info(
            f"Uploading file to storage: {filename}"
        )

        # ====================================================
        # UPLOAD FILE TO STORAGE SERVICE
        # ====================================================

        storage_upload_url = (
            f"{STORAGE_BASE_URL}/upload"
        )

        file_content = await upload.read()

        files_payload = {

            "file": (
                filename,
                file_content,
                upload.content_type
            )
        }

        params = {
            "doctor_id": doctor_id,
            "patient_id":doctor_id,
            "doc_type": None,
            "category": None,
            "subcategory": None
            
        }

        response = requests.post(

            storage_upload_url,

            params=params,

            files=files_payload,

            timeout=120,
        )

        if response.status_code != 200:

            raise HTTPException(
                status_code=response.status_code,
                detail=response.text,
            )

        upload_result = response.json()

        stored_filename = upload_result["filename"]

        # ====================================================
        # BUILD FILE URL
        # ====================================================

        file_url = (
            f"{STORAGE_BASE_URL}/files/"
            f"{doctor_id}/"
            f"{stored_filename}"
        )

        logger.info(
            f"Stored file URL: {file_url}"
        )

        # ====================================================
        # SEND CELERY TASK
        # ====================================================

        task = send_agent_pdf_task(

            doctor_id=doctor_id,

            file_url=file_url,

            filename=filename,

            guideline_source=guideline_source,

            version=version,
        )

        queued_tasks.append({

            "task_id": task.id,

            "filename": filename,

            "file_url": file_url,
        })

    return {

        "status": "queued",

        "tasks": queued_tasks,
    }





# @router.post("/run")
# async def run_pipeline_from_files(
#     files: List[UploadFile] = File(...),
#     guideline_source: str   = Form(default="other"),
#     version: str            = Form(default=""),
#     doctor_id: str = Query(...),
# ):
#     """
#     Accepts multipart file uploads.
#     Runs all 8 pipeline stages and returns the ClinicalKnowledgeGraph.

#     Form fields
#     ───────────
#     files             — one or more files (.pdf .docx .doc .txt .md)
#     guideline_source  — nccn | acog | esmo | nejm | lancet | asco | other
#     version           — e.g. "2024.1"  (optional)
#     """
#     if not files:
#         raise HTTPException(status_code=400, detail="No files provided.")

#     gs      = _guideline_source_from_str(guideline_source)
#     ver     = version.strip() or None

#     pipeline = AgenticGraphRAGPipeline()

#     batch: List[tuple] = []

#     for upload in files:
#         filename   = upload.filename or "unknown"
#         file_bytes = await upload.read()
#         ext        = Path(filename).suffix.lower()

#         if ext not in (".pdf", ".docx", ".doc", ".txt", ".md", ".csv"):
#             raise HTTPException(
#                 status_code=400,
#                 detail=f"Unsupported file type: '{ext}'. "
#                        "Supported: .pdf .docx .doc .txt .md .csv",
#             )

#         # Detect source from filename if not overridden
#         detected_gs = gs if gs != GuidelineSource.OTHER else _detect_guideline_source(filename)
#         src_type    = (
#             SourceType.PDF      if ext == ".pdf"              else
#             SourceType.DOCUMENT if ext in (".docx", ".doc")   else
#             SourceType.TEXT
#         )
#         source = DocumentSource(
#             source_type=src_type,
#             guideline_source=detected_gs,
#             name=filename,
#             version=ver,
#         )
#         # Pass raw text for DOCX/TXT; raw bytes for PDF
#         content = file_bytes  # pipeline handles bytes correctly for all types
#         batch.append((content, source))

#         logger.info(f"Queued: {filename} ({ext}) as {src_type.value}/{detected_gs.value}")

#     try:
#         if len(batch) == 1:
#             content, source = batch[0]
#             if source.source_type == SourceType.PDF:
#                 pipeline.run_from_pdf(content, source)
#             else:
#                 # Decode text for DOCX/TXT
#                 try:
#                     text = content.decode("utf-8")
#                 except Exception:
#                     text = content.decode("latin-1", errors="replace")
#                 pipeline.run_from_text(text, source)
#         else:
#             # Batch run: decode non-PDF content
#             decoded_batch = []
#             for content, source in batch:
#                 if source.source_type == SourceType.PDF:
#                     decoded_batch.append((content, source))
#                 else:
#                     try:
#                         text = content.decode("utf-8")
#                     except Exception:
#                         text = content.decode("latin-1", errors="replace")
#                     decoded_batch.append((text, source))
#             pipeline.run_batch(decoded_batch)

#     except Exception as exc:
#         logger.exception("Pipeline run failed")
#         raise HTTPException(status_code=500, detail=str(exc))

#     # ─────────────────────────────────────
#     # SAVE GRAPH TO NEO4J
#     # ─────────────────────────────────────
#     await graph_writer.write_graph(
#         pipeline.graph,
#         doctor_id=doctor_id
#     )

#     # ─────────────────────────────────────
#     # STORE IN MEMORY
#     # ─────────────────────────────────────
#     serialised = _store(
#         pipeline,
#         doctor_id
#     )

#     graph = pipeline.graph

#     return {
#         "status":          "completed",
#         "pipeline_id":     graph.pipeline_id,
#         "generated_at":    graph.generated_at,
#         "source_names":    graph.source_names,
#         "source_versions": graph.source_versions,
#         "total_nodes":     graph.total_nodes,
#         "total_edges":     graph.total_edges,
#         "total_pathways":  graph.total_pathways,
#         "total_deltas":    graph.total_deltas,
#         "total_evidence":  graph.total_evidence,
#         "total_chains":    graph.total_chains,
#         "graph":           serialised,
#     }


# ─────────────────────────────────────────────────────────────────
# POST /pipeline/run-urls
# ─────────────────────────────────────────────────────────────────


@router.post("/run-urls")
async def run_pipeline_from_urls(

    body: RunUrlsBody,

    doctor_id: str = Query(...),
):

    if not body.urls:

        raise HTTPException(
            status_code=400,
            detail="No URLs provided."
        )

    # ====================================================
    # SEND CELERY TASK
    # ====================================================

    task = send_agent_pdf_urls_task(

        doctor_id=doctor_id,

        urls=body.urls,

        guideline_source=body.guideline_source,

        version=body.version or "",
    )

    return {

        "status": "queued",

        "task_id": task.id,

        "total_urls": len(body.urls),

        "urls": body.urls,
    }
# ─────────────────────────────────────────────────────────────────
# POST /pipeline/run-urls
# ─────────────────────────────────────────────────────────────────

# @router.post("/run-urls")
# async def run_pipeline_from_urls(
#     body: RunUrlsBody,
#     doctor_id: str = Query(...),
# ):
#     urls             = body.urls
#     guideline_source = body.guideline_source
#     version          = body.version
#     if not urls:
#         raise HTTPException(status_code=400, detail="No URLs provided.")
 
#     gs       = _guideline_source_from_str(guideline_source)
#     pipeline = AgenticGraphRAGPipeline()
 
#     failed_urls = []
#     for url in urls:
#         try:
#             source = DocumentSource(
#                 source_type=SourceType.LINK,
#                 guideline_source=gs,
#                 name=url,
#                 version=version,
#             )
#             await pipeline.run_from_url(url, source)
#         except Exception as exc:
#             logger.warning(f"Skipping {url}: {exc}")
#             failed_urls.append({"url": url, "reason": str(exc)})

#     # Only hard-fail if ALL urls failed
#     if failed_urls and pipeline.graph is None:
#         raise HTTPException(
#             status_code=422,
#             detail=f"All URLs failed to fetch: {failed_urls}"
#         )
 
#     await graph_writer.write_graph(pipeline.graph, doctor_id=doctor_id)
 
#     serialised = _store(pipeline, doctor_id)  # ← FIX 2: was _store(pipeline) — missing doctor_id
#     graph      = pipeline.graph
 
#     return {
#         "status":      "completed",
#         "pipeline_id": graph.pipeline_id,
#         "total_nodes": graph.total_nodes,
#         "total_edges": graph.total_edges,
#         "graph":       serialised,
#         "failed_urls": failed_urls,   # ← add this
#     }
    
 


# ─────────────────────────────────────────────────────────────────
# POST /pipeline/query
# Ask a clinical question against an existing pipeline
# ─────────────────────────────────────────────────────────────────

@router.post("/query", response_model=DeltaQueryResponse)
async def query_pipeline(request: DeltaQueryRequest):
    """
    Body: { "clinical_question": "...", "pipeline_id": "ckg_..." }
    pipeline_id is optional — defaults to the most recent run.
    """
    try:
        instance = _get_instance(request.pipeline_id)
        response = instance.handle_delta_query(request)
        # Update stored graph with new reasoning chain
        if instance.graph:
            PIPELINE_RESULTS[instance.graph.pipeline_id] = instance.graph.model_dump()
        return response
    except HTTPException:
        raise
    except Exception as exc:
        logger.exception("Query failed")
        raise HTTPException(status_code=500, detail=str(exc))


# ─────────────────────────────────────────────────────────────────
# GET /pipeline/{pipeline_id}
# GET /pipeline/{pipeline_id}/graph  (alias — consumed by React frontend)
# ─────────────────────────────────────────────────────────────────

@router.get("/{pipeline_id}/graph")
@router.get("/{pipeline_id}")
async def get_graph(pipeline_id: str):
    """
    Returns the full serialised ClinicalKnowledgeGraph for the given pipeline_id.
    This is the endpoint called by the React frontend:
        GET /api/pipeline/{pipeline_id}/graph
    """
    result = PIPELINE_RESULTS.get(pipeline_id)
    if not result:
        raise HTTPException(
            status_code=404,
            detail=f"Pipeline '{pipeline_id}' not found.",
        )
    return result


# ─────────────────────────────────────────────────────────────────
# GET /pipeline/
# ─────────────────────────────────────────────────────────────────

@router.get("/")
async def list_pipelines():
    return {
        "total":        len(PIPELINE_RESULTS),
        "pipeline_ids": list(PIPELINE_RESULTS.keys()),
    }


# ─────────────────────────────────────────────────────────────────
# DELETE /pipeline/{pipeline_id}
# ─────────────────────────────────────────────────────────────────

@router.delete("/{pipeline_id}")
async def delete_pipeline(pipeline_id: str):
    if pipeline_id not in PIPELINE_RESULTS:
        raise HTTPException(status_code=404, detail="Not found.")
    PIPELINE_RESULTS.pop(pipeline_id, None)
    PIPELINE_INSTANCES.pop(pipeline_id, None)
    return {"status": "deleted", "pipeline_id": pipeline_id}


# ─────────────────────────────────────────────────────────────────
# POST /pipeline/run-files  (alias used by React UploadPanel)
# ─────────────────────────────────────────────────────────────────

@router.post("/run-files")
async def run_pipeline_files_alias(
    files: List[UploadFile] = File(...),
    guideline_source: str   = Form(default="other"),
    version: str            = Form(default=""),
    doctor_id: str          = Query(...),  # ← FIX 3: was missing doctor_id
):
    return await run_pipeline_from_files(
        files=files,
        guideline_source=guideline_source,
        version=version,
        doctor_id=doctor_id,               # ← FIX 3: was not passed through
    )


@router.get("/graph/doctor/{doctor_id}")
async def get_doctor_graph(doctor_id: str):

    graph_writer = ClinicalGraphWriter()

    graph = await graph_writer.load_doctor_graph(
        doctor_id
    )

    if not graph:
        return {
            "graph": {
                "nodes": [],
                "edges": [],
                "protocol_graphs": [],
                "deltas": [],
                "reasoning_chains": [],
                "total_nodes": 0,
                "total_edges": 0,
                "total_pathways": 0,
                "total_deltas": 0,
                "total_chains": 0,
            }
        }

    graph.compute_summary()

    return {
        "graph": graph.model_dump()
    }


@router.get("/graph/doctor/{doctor_id}/pipeline/{pipeline_id}")
async def get_pipeline_graph(
    doctor_id: str,
    pipeline_id: str,
):

    graph_writer = ClinicalGraphWriter()

    graph = await graph_writer.load_pipeline_graph(
        doctor_id=doctor_id,
        pipeline_id=pipeline_id
    )

    if not graph:
        raise HTTPException(
            status_code=404,
            detail="Pipeline graph not found"
        )

    graph.compute_summary()

    return {
        "graph": graph.model_dump()
    }


# ─────────────────────────────────────────────────────────────────
# DELETE SINGLE PIPELINE GRAPH
# ─────────────────────────────────────────────────────────────────

@router.delete("/graph/doctor/{doctor_id}/pipeline/{pipeline_id}")
async def delete_pipeline_graph(
    doctor_id: str,
    pipeline_id: str,
):

    graph_writer = ClinicalGraphWriter()

    driver = await get_driver()

    async with driver.session() as session:

        # delete relationships first
        await session.run(
            """
            MATCH (n {doctor_id: $doctor_id, pipeline_id: $pipeline_id})
            DETACH DELETE n
            """,
            doctor_id=doctor_id,
            pipeline_id=pipeline_id,
        )

    # remove from memory store also
    PIPELINE_RESULTS.pop(pipeline_id, None)
    PIPELINE_INSTANCES.pop(pipeline_id, None)

    return {
        "status": "deleted",
        "doctor_id": doctor_id,
        "pipeline_id": pipeline_id,
    }


# ─────────────────────────────────────────────────────────────────
# DELETE ALL DOCTOR GRAPHS
# ─────────────────────────────────────────────────────────────────

@router.delete("/graph/doctor/{doctor_id}")
async def delete_doctor_graphs(
    doctor_id: str,
):

    driver = await get_driver()

    async with driver.session() as session:

        await session.run(
            """
            MATCH (n {doctor_id: $doctor_id})
            DETACH DELETE n
            """,
            doctor_id=doctor_id,
        )

    # remove from in-memory stores also
    pipeline_ids_to_remove = []

    for pid, value in PIPELINE_RESULTS.items():

        if value.get("doctor_id") == doctor_id:
            pipeline_ids_to_remove.append(pid)

    for pid in pipeline_ids_to_remove:
        PIPELINE_RESULTS.pop(pid, None)
        PIPELINE_INSTANCES.pop(pid, None)

    return {
        "status": "deleted",
        "doctor_id": doctor_id,
        "deleted_pipelines": pipeline_ids_to_remove,
    }



from pydantic import BaseModel
import httpx
# ============================================================
# INTERNAL REQUEST MODEL
# ============================================================

class InternalPipelineRequest(BaseModel):

    file_url: str

    filename: str

    guideline_source: str = "other"

    version: Optional[str] = None


# ============================================================
# INTERNAL PIPELINE ENDPO
# =========================================================

@router.post("/internal/pipeline/run")
async def internal_run_pipeline(

    body: InternalPipelineRequest,

    doctor_id: str = Query(...),
):

    logger.info(
        f"Internal pipeline started: {body.filename}"
    )

    try:

        # ====================================================
        # DOWNLOAD FILE
        # ====================================================

        response = httpx.get(

            body.file_url,

            timeout=httpx.Timeout(
                connect=30.0,
                read=300.0,
                write=60.0,
                pool=60.0,
            )
        )

        response.raise_for_status()

        file_bytes = response.content

        logger.info(
            f"Downloaded file: {body.filename}"
        )

        # ====================================================
        # VALIDATE EXTENSION
        # ====================================================

        ext = Path(
            body.filename
        ).suffix.lower()

        if ext not in (
            ".pdf",
            ".docx",
            ".doc",
            ".txt",
            ".md",
            ".csv",
        ):

            raise HTTPException(
                status_code=400,
                detail=f"Unsupported file type: {ext}"
            )

        # ====================================================
        # DETECT GUIDELINE
        # ====================================================

        guideline = (

            _guideline_source_from_str(
                body.guideline_source
            )

            if body.guideline_source != "other"

            else _detect_guideline_source(
                body.filename
            )
        )

        # ====================================================
        # BUILD SOURCE
        # ====================================================

        source_type = (

            SourceType.PDF

            if ext == ".pdf"

            else SourceType.DOCUMENT

            if ext in (".docx", ".doc")

            else SourceType.TEXT
        )

        source = DocumentSource(

            source_type=source_type,

            guideline_source=guideline,

            name=body.filename,

            version=body.version,
        )

        # ====================================================
        # CREATE PIPELINE
        # ====================================================

        pipeline = AgenticGraphRAGPipeline()

        logger.info(
            f"Running Graph RAG pipeline: "
            f"{body.filename}"
        )

        # ====================================================
        # RUN PIPELINE
        # ====================================================

        if source.source_type == SourceType.PDF:

            pipeline.run_from_pdf(
                file_bytes,
                source
            )

        else:

            try:

                text = file_bytes.decode("utf-8")

            except Exception:

                text = file_bytes.decode(
                    "latin-1",
                    errors="replace"
                )

            pipeline.run_from_text(
                text,
                source
            )

        # ====================================================
        # VALIDATE GRAPH
        # ====================================================

        if pipeline.graph is None:

            raise HTTPException(
                status_code=500,
                detail="Pipeline produced no graph"
            )

        pipeline.graph.compute_summary()

        # ====================================================
        # SAVE GRAPH TO NEO4J
        # ====================================================

        await graph_writer.write_graph(

            pipeline.graph,

            doctor_id=doctor_id
        )

        # ====================================================
        # STORE IN MEMORY
        # ====================================================

        serialised = _store(

            pipeline,

            doctor_id
        )

        graph = pipeline.graph

        logger.info(
            f"Pipeline completed: "
            f"{graph.pipeline_id}"
        )

        return {

            "status": "completed",

            "pipeline_id":
                graph.pipeline_id,

            "generated_at":
                graph.generated_at,

            "source_names":
                graph.source_names,

            "source_versions":
                graph.source_versions,

            "total_nodes":
                graph.total_nodes,

            "total_edges":
                graph.total_edges,

            "total_pathways":
                graph.total_pathways,

            "total_deltas":
                graph.total_deltas,

            "total_evidence":
                graph.total_evidence,

            "total_chains":
                graph.total_chains,

            "graph": serialised,
        }

    except Exception as e:

        logger.exception(
            f"Internal pipeline failed: {body.filename}"
        )

        raise HTTPException(
            status_code=500,
            detail=str(e)
        )

# ============================================================
# INTERNAL URL PIPELINE ENDPOINT
# Used by Celery worker
# ============================================================

from pydantic import BaseModel
from typing import List, Optional

class InternalRunUrlsBody(BaseModel):

    urls: List[str]

    guideline_source: str = "other"

    version: Optional[str] = None


@router.post("/internal/run-urls")
async def internal_run_pipeline_urls(

    body: InternalRunUrlsBody,

    doctor_id: str = Query(...),
):

    urls = body.urls

    guideline_source = body.guideline_source

    version = body.version

    if not urls:

        raise HTTPException(
            status_code=400,
            detail="No URLs provided."
        )

    gs = _guideline_source_from_str(
        guideline_source
    )

    pipeline = AgenticGraphRAGPipeline()

    failed_urls = []

    # ========================================================
    # RUN URL PIPELINE
    # ========================================================

    for url in urls:

        try:

            source = DocumentSource(

                source_type=SourceType.LINK,

                guideline_source=gs,

                name=url,

                version=version,
            )

            await pipeline.run_from_url(
                url,
                source
            )

        except Exception as exc:

            logger.warning(
                f"Skipping URL {url}: {exc}"
            )

            failed_urls.append({

                "url": url,

                "reason": str(exc),
            })

    # ========================================================
    # FAIL IF EVERYTHING FAILED
    # ========================================================

    if failed_urls and pipeline.graph is None:

        raise HTTPException(

            status_code=422,

            detail={
                "message": "All URLs failed",
                "failed_urls": failed_urls,
            }
        )

    # ========================================================
    # SAVE GRAPH TO NEO4J
    # ========================================================

    await graph_writer.write_graph(

        pipeline.graph,

        doctor_id=doctor_id,
    )

    # ========================================================
    # STORE MEMORY
    # ====================================================

    serialised = _store(

        pipeline,

        doctor_id,
    )

    graph = pipeline.graph

    # =================================================
    # RESPONSE
    # ===================================================

    return {

        "status": "completed",

        "pipeline_id": graph.pipeline_id,

        "generated_at": graph.generated_at,

        "source_names": graph.source_names,

        "source_versions": graph.source_versions,

        "total_nodes": graph.total_nodes,

        "total_edges": graph.total_edges,

        "total_pathways": graph.total_pathways,

        "total_deltas": graph.total_deltas,

        "total_evidence": graph.total_evidence,

        "total_chains": graph.total_chains,

        "failed_urls": failed_urls,

        "graph": serialised,
    }