"""
pipeline.py — Step 2 (orchestrator)
=====================================
CHANGED: Graph is doctor-centric.
  - doctor_id  → primary graph identity (who owns this knowledge graph)
  - patient_id → optional provenance metadata (who the encounter was with)

Call run_graph_pipeline() after document processing is complete.
Returns a ClinicalGraphPayload keyed on doctor_id — ready for Phase 3 (Neo4j writer).
"""

from __future__ import annotations

import os
import asyncio
from typing import List, Optional
from datetime import datetime

from loguru import logger
from motor.motor_asyncio import AsyncIOMotorClient
from pymongo import MongoClient
from collections import Counter

from Agentic.document_model import (
    ClinicalGraphPayload,
    GraphNode,
    GraphEdge,
    SkillCandidate,
    Severity,
)


# At the top of pipeline.py alongside other imports
from Agentic.agentic_graph_rag import run_agentic_graph_rag, AgentDefinition
from Agentic.document_agents import run_doctor_pattern_agents


from fastapi import APIRouter, HTTPException
from pydantic import BaseModel as _BM

from fastapi import UploadFile, File, Form
from typing import List, Optional

router = APIRouter(prefix="/graph-pipeline", tags=["Doctor Graph Pipeline"])

# ── DB setup ──
MONGO_URI = os.getenv("MONGO_URI")
MONGO_DB = "doctorassistai"
NODES_DB = "doctorassistai_nodes"

mongodb_client = AsyncIOMotorClient(MONGO_URI)  # async (Motor)
database = mongodb_client[MONGO_DB]

client = MongoClient(MONGO_URI)  # sync (PyMongo)
db = client[MONGO_DB]

# CHANGED: collection is now keyed by doctor, not patient
graph_payloads_col = database["doctor_graph_payloads"]

processed_documents_col = database["processed_documents"]

# ── Skill promotion thresholds ──
SKILL_WEIGHT_THRESHOLD = 0.75
SKILL_MIN_OCCURRENCE   = 5


# async def _fetch_doctor_graph(doctor_id: str, knowledge_graph) -> dict:
#     """
#     CHANGED: Fetch the DOCTOR's aggregated knowledge graph.
#     This is the doctor's full clinical pattern graph across all patients,
#     not a single patient's history.
#     Falls back to empty dict on failure.
#     """
#     try:
#         # CHANGED: call get_doctor_graph instead of get_patient_graph_with_evidence
#         return await knowledge_graph.get_doctor_graph(doctor_id)
#     except Exception as e:
#         logger.warning(f"Doctor graph fetch failed for {doctor_id}: {e}")
#         return {}


def _infer_speciality(graph_nodes: List[GraphNode]) -> str:
    from collections import Counter
    signals = []
    for node in graph_nodes:
        for attr in ("speciality", "risk_category", "node_type"):
            val = getattr(node, attr, None)
            if val and isinstance(val, str) and val.strip():
                signals.append(val.strip().lower())
                break
    if not signals:
        return "general"
    most_common, _ = Counter(signals).most_common(1)[0]
    return most_common


def _get(obj, *keys, default=None):
    for key in keys:
        val = obj.get(key) if isinstance(obj, dict) else getattr(obj, key, None)
        if val is not None:
            return val
    return default

def _build_skill_candidates(
    merged: dict,
    doctor_id: str,
    speciality: Optional[str],
) -> List[SkillCandidate]:
    """
    From decision chains with probability >= threshold, create SkillCandidates.
    UNCHANGED in logic — skill candidates are always per-doctor.
    """
    candidates: List[SkillCandidate] = []
    seen: set = set()

    for chain in merged.get("decision_chains", []):
        prob      = _get(chain, "probability",     default=0.0)
        condition = _get(chain, "condition_label", "condition", default="")
        decision  = _get(chain, "decision_label",  "decision",  default="")

        key = f"{condition}::{decision}"
        if prob >= SKILL_WEIGHT_THRESHOLD and key not in seen:
            seen.add(key)
            candidates.append(SkillCandidate(
                condition_label=condition,
                decision_label=decision,
                pattern_summary=f"{condition} → {decision}",
                speciality=speciality,
                weight=prob,
                occurrence_count=1,
                awaiting_confirmation=True,
                doctor_id=doctor_id,
            ))

    return candidates


async def run_graph_pipeline(
    doctor_id: str,
    entities: List[dict],
    source_doc: str = "document",
    knowledge_graph=None,
    patient_id: Optional[str] = None,
    document_date: Optional[str] = None,
    raw_sections: Optional[str] = None,          # ← ADD
) -> ClinicalGraphPayload:
    """
    Main entry point for Steps 1 + 2.
    CHANGED: doctor_id is the PRIMARY graph identity.
    patient_id is optional — stored as provenance metadata only.

    1. Fetches the DOCTOR's aggregated graph from Neo4j.
    2. Runs all graph-extraction agents in parallel.
    3. Merges their outputs into a single ClinicalGraphPayload (doctor-keyed).
    4. Saves the payload to MongoDB (keyed by doctor_id).
    5. Returns the payload — ready for Phase 3 (Neo4j writer).

    Args:
        doctor_id:       Doctor identifier — PRIMARY graph key.
        entities:        Processed entities from Dockli.
        source_doc:      Source document name(s).
        knowledge_graph: Your EnhancedMedicalKnowledgeGraph instance.
        patient_id:      Optional — stored as audit provenance only.
        document_date:   Optional date of the document for timeline context.

    Returns:
        ClinicalGraphPayload — doctor-centric, graph-ready.
    """
    logger.info(
        f"🚀 Doctor graph pipeline starting | doctor={doctor_id} | "
        f"patient={patient_id or 'N/A'} | entities={len(entities)}"
    )

    # ── 1. Fetch DOCTOR's aggregated graph ──
    merged = await run_agentic_graph_rag(
        doctor_id=doctor_id,
        entities=entities,
        source_doc=source_doc,
        patient_id=patient_id,
        raw_sections=raw_sections,               # ← ADD
    )

    # ── 3. Infer speciality ──
    speciality = _infer_speciality(merged["graph_nodes"])

    # ── 4. Build skill candidates ──
    skill_candidates = [] 

    # ── 5. Assemble payload — CHANGED: doctor_id is primary, patient_id is provenance ──
    payload = ClinicalGraphPayload(
        doctor_id=doctor_id,           # PRIMARY
        patient_id=patient_id,         # provenance metadata only
        source_documents=[source_doc],
        speciality_detected=speciality,
        graph_nodes=merged["graph_nodes"],
        graph_edges=merged["graph_edges"],
        abnormalities=merged["abnormalities"],
        decision_chains=merged["decision_chains"],
        impact_flags=merged["impact_flags"],
        skill_candidates=skill_candidates,
        agent_outputs=merged["agent_outputs"],
    )
    payload.compute_summary()

    # ── 6. Save to MongoDB — CHANGED: keyed by doctor_id ──
    await graph_payloads_col.insert_one(payload.dict())
    logger.info(
        f"✅ Doctor payload saved: {payload.pipeline_id} | "
        f"doctor={doctor_id} | "
        f"nodes={payload.total_nodes} | "
        f"edges={payload.total_edges} | "
        f"abnormalities={payload.total_abnormalities} | "
        f"critical_flags={payload.critical_flags}"
    )

    return payload

@router.post("/run-pattern-agents")
async def run_pattern_agents_endpoint(
    doctor_id: str = Form(...),
    speciality: Optional[str] = Form(None),
):
    from Agentic.enhanced_knowledge_graph import EnhancedMedicalKnowledgeGraph

    kg = EnhancedMedicalKnowledgeGraph(
        uri=os.getenv("NEO4J_URI"),
        user=os.getenv("NEO4J_USER"),
        password=os.getenv("NEO4J_PASSWORD"),
        mongo_db=_db,
    )

    docs = await processed_documents_col.find(
        {"doctor_id": doctor_id}
    ).to_list(length=None)

    if not docs:
        raise HTTPException(
            status_code=404,
            detail="No consultations found for this doctor.",
        )

    def _collect(entities: List[dict], *type_names: str) -> str:
        return " | ".join(
            e["entity_name"] for e in entities
            if e.get("entity_type", "").lower() in type_names
        )

    consultations = [
        {
            "diagnosis":       _collect(doc.get("entities", []), "diagnosis"),
            "treatment_plan":  _collect(doc.get("entities", []), "treatment"),
            "medications":     _collect(doc.get("entities", []), "medication"),
            "investigations":  _collect(doc.get("entities", []), "procedure"),
            "clinical_notes":  doc.get("raw_text", "")[:500],
            "referral_letter": "",
            "saved_at":        str(doc.get("metadata", {}).get("processing_date", "")),
        }
        for doc in docs
    ]

    merged = await run_doctor_pattern_agents(
        doctor_id=doctor_id,
        consultations=consultations,
        speciality=speciality,
    )

    from Agentic.graph_writer import SkillPromoter
    new_candidates = await SkillPromoter().check_and_queue_candidates(doctor_id=doctor_id)

    return {
        "status":                  "completed",
        "doctor_id":               doctor_id,
        "graph_nodes":             len(merged["graph_nodes"]),
        "graph_edges":             len(merged["graph_edges"]),
        "decision_chains":         len(merged["decision_chains"]),
        "skill_candidates":        len(merged["skill_candidates"]),
        "queued_for_confirmation": len(new_candidates),
    }
# ─────────────────────────────────────────────
# FASTAPI ROUTER
# ─────────────────────────────────────────────




def _extract_raw_text(doc: dict) -> str:
    for key in ("raw_text", "markdown", "sections", "text", "content", "raw"):
        val = doc.get(key)
        if not val:
            continue
        if isinstance(val, str):
            return val.strip()
        if isinstance(val, dict):
            parts = []
            for v in val.values():
                if isinstance(v, str) and v.strip():
                    parts.append(v.strip())
                elif isinstance(v, list):
                    for item in v:
                        if isinstance(item, str) and item.strip():
                            parts.append(item.strip())
                        elif isinstance(item, dict):
                            for iv in item.values():
                                if isinstance(iv, str) and iv.strip():
                                    parts.append(iv.strip())
            if parts:
                return "\n\n".join(parts)
        if isinstance(val, list):
            parts = []
            for item in val:
                if isinstance(item, str) and item.strip():
                    parts.append(item.strip())
                elif isinstance(item, dict):
                    for iv in item.values():
                        if isinstance(iv, str) and iv.strip():
                            parts.append(iv.strip())
            if parts:
                return "\n\n".join(parts)
    return ""


class DirectPipelineRequest(_BM):
    doctor_id: str
    patient_id: Optional[str] = None
    markdown: str


@router.post("/run-direct")
async def run_pipeline_direct(req: DirectPipelineRequest):
    from Agentic.graph_writer import write_payload_to_graph

    payload = await run_graph_pipeline(
        doctor_id=req.doctor_id,
        entities=[],
        source_doc=f"direct_{req.doctor_id}",
        patient_id=req.patient_id,
        raw_sections=req.markdown,
    )

    write_result = {}
    try:
        write_result = await write_payload_to_graph(payload)
        logger.info(
            f"✅ Neo4j write complete | pipeline={payload.pipeline_id} | "
            f"nodes_created={write_result['write_stats'].get('nodes_created')} | "
            f"edges_created={write_result['write_stats'].get('edges_created')}"
        )
    except Exception as neo4j_err:
        logger.error(f"Neo4j write failed | pipeline={payload.pipeline_id} | {neo4j_err}")

    return {
        "status":              "completed",
        "pipeline_id":         payload.pipeline_id,
        "doctor_id":           payload.doctor_id,
        "patient_id":          payload.patient_id,
        "total_nodes":         payload.total_nodes,
        "total_edges":         payload.total_edges,
        "total_abnormalities": payload.total_abnormalities,
        "critical_flags":      payload.critical_flags,
        "neo4j_write":         write_result.get("write_stats", {}),
        "graph_nodes":         [n.dict() for n in payload.graph_nodes],
        "graph_edges":         [e.dict() for e in payload.graph_edges],
        "decision_chains":     [c.dict() for c in payload.decision_chains],
        "abnormalities":       [a.dict() for a in payload.abnormalities],
        "impact_flags":        [f.dict() for f in payload.impact_flags],
        "skill_candidates":    [s.dict() for s in payload.skill_candidates],
    }


@router.post("/run")
async def run_pipeline_endpoint(
    doctor_id: str = Form(...),
    patient_id: Optional[str] = Form(None),
    files: List[UploadFile] = File(default=[]),
):
    from Agentic.enhanced_knowledge_graph import EnhancedMedicalKnowledgeGraph
    from Agentic.graph_writer import write_payload_to_graph   # ← ADD THIS IMPORT

    neo4j_uri = os.getenv("NEO4J_URI")
    neo4j_user = os.getenv("NEO4J_USER")
    neo4j_password = os.getenv("NEO4J_PASSWORD")
    kg = EnhancedMedicalKnowledgeGraph(
        uri=neo4j_uri, user=neo4j_user, password=neo4j_password, mongo_db=_db
    )

    processed_docs_col = _db["processed_documents"]

    query: dict = {"doctor_id": doctor_id}
    if patient_id:
        query["patient_id"] = patient_id

    docs = await processed_docs_col.find(query).to_list(length=None)

    if not docs:
        raise HTTPException(status_code=404, detail="No processed documents found for this doctor.")

    # After building all_entities, also collect raw text:
    all_entities: List[dict] = []
    all_raw_sections: List[str] = []
    file_names: List[str] = []
    for doc in docs:
        all_entities.extend(doc.get("entities", []))
        raw = _extract_raw_text(doc)
        if raw:
            all_raw_sections.append(raw)
        fn = doc.get("file_name") or doc.get("metadata", {}).get("file_name", "unknown")
        file_names.append(fn)

    combined_raw = "\n\n---\n\n".join(all_raw_sections)
    payload = await run_graph_pipeline(
        doctor_id=doctor_id,
        entities=all_entities,
        source_doc=", ".join(set(file_names)),
        knowledge_graph=kg,
        patient_id=patient_id,
        raw_sections=combined_raw,                   # ← ADD
    )

    # ── Step 2: Write payload to Neo4j immediately ──   ← ADD THIS BLOCK
    write_result = {}
    try:
        write_result = await write_payload_to_graph(payload)
        logger.info(
            f"✅ Neo4j write complete | pipeline={payload.pipeline_id} | "
            f"nodes_created={write_result['write_stats'].get('nodes_created')} | "
            f"edges_created={write_result['write_stats'].get('edges_created')} | "
            f"reworks={write_result['reworks_detected']} | "
            f"skill_candidates={write_result['new_skill_candidates']}"
        )
    except Exception as neo4j_err:
        logger.error(f"Neo4j write failed | pipeline={payload.pipeline_id} | {neo4j_err}")
        # Don't raise — MongoDB payload is safe, Neo4j write can be retried via /write-sync

    return {
        "status":              "completed",
        "pipeline_id":         payload.pipeline_id,
        "doctor_id":           payload.doctor_id,
        "patient_id":          payload.patient_id,
        "speciality":          payload.speciality_detected,
        "total_nodes":         payload.total_nodes,
        "total_edges":         payload.total_edges,
        "total_abnormalities": payload.total_abnormalities,
        "critical_flags":      payload.critical_flags,
        "skill_candidates":    len(payload.skill_candidates),

        # ── Neo4j write stats ──   ← ADD THESE
        "neo4j_write": {
            "nodes_created":     write_result.get("write_stats", {}).get("nodes_created", 0),
            "nodes_merged":      write_result.get("write_stats", {}).get("nodes_merged", 0),
            "edges_created":     write_result.get("write_stats", {}).get("edges_created", 0),
            "edges_merged":      write_result.get("write_stats", {}).get("edges_merged", 0),
            "reworks_detected":  write_result.get("reworks_detected", 0),
            "skill_candidates":  write_result.get("new_skill_candidates", 0),
        },

        # Full graph-ready payload
        "graph_nodes":      [n.dict() for n in payload.graph_nodes],
        "graph_edges":      [e.dict() for e in payload.graph_edges],
        "decision_chains":  [c.dict() for c in payload.decision_chains],
        "abnormalities":    [a.dict() for a in payload.abnormalities],
        "impact_flags":     [f.dict() for f in payload.impact_flags],
        "skill_candidates": [s.dict() for s in payload.skill_candidates],
    }


# @router.get("/latest/{doctor_id}")
# async def get_latest_payload(doctor_id: str):
#     """
#     CHANGED: Fetch the latest graph payload for a DOCTOR (was patient).
#     """
#     doc = await graph_payloads_col.find_one(
#         {"doctor_id": doctor_id},
#         sort=[("generated_at", -1)]
#     )
#     if not doc:
#         raise HTTPException(status_code=404, detail="No graph payload found for this doctor.")
#     doc.pop("_id", None)
#     return doc



from fastapi import HTTPException
from bson import ObjectId



@router.get("/graph/latest/{doctor_id}")
async def get_latest_payload(doctor_id: str):
    """
    Retrieve latest graph payload for a doctor.
    """

    try:
        logger.info(f"🔍 Retrieving graph payload | doctor_id={doctor_id}")

        # DEBUG COUNTS
        total_docs = await graph_payloads_col.count_documents({})
        doctor_docs = await graph_payloads_col.count_documents({
            "doctor_id": doctor_id
        })

        logger.info(
            f"📊 Mongo Stats | total_docs={total_docs} | doctor_docs={doctor_docs}"
        )

        # FETCH LATEST DOCUMENT
        doc = await graph_payloads_col.find_one(
            {"doctor_id": doctor_id},
            sort=[("_id", -1)]   # safer than generated_at
        )

        if not doc:
            logger.warning(
                f"❌ No graph payload found | doctor_id={doctor_id}"
            )

            # EXTRA DEBUG
            sample = await graph_payloads_col.find_one()

            logger.warning(
                f"⚠️ Sample document in collection: "
                f"{sample.get('doctor_id') if sample else 'NO_DOCS'}"
            )

            raise HTTPException(
                status_code=404,
                detail=f"No graph payload found for doctor_id={doctor_id}"
            )

        # CONVERT OBJECTID
        doc["_id"] = str(doc["_id"])

        logger.info(
            f"✅ Graph payload retrieved | "
            f"pipeline_id={doc.get('pipeline_id')} | "
            f"doctor_id={doctor_id}"
        )

        return {
            "status": "success",
            "message": "Graph payload retrieved successfully",
            "data": doc
        }

    except HTTPException:
        raise

    except Exception as e:
        logger.exception(
            f"❌ Graph retrieval failed | doctor_id={doctor_id} | error={str(e)}"
        )

        raise HTTPException(
            status_code=500,
            detail=f"Graph retrieval failed: {str(e)}"
        )