"""
API Endpoints for Chemotherapy Intelligence Platform
"""

import traceback
from fastapi import APIRouter, HTTPException, Query
from typing import Optional
from .workflow import get_or_generate, regenerate
from . import store

router = APIRouter(prefix="/chemotherapy-intelligence", tags=["Chemotherapy Intelligence"])


@router.get("/report/{patient_id}")
@router.get("/report/{patient_id}/")
async def get_chemotherapy_report(
    patient_id: str,
    doctorId: Optional[str] = Query(None),
    treatmentId: Optional[str] = Query(None),
    cycleNum: Optional[str] = Query(None),
    force_regenerate: bool = Query(False),
):
    """
    Returns the chemotherapy intelligence report for a patient.
    Loads latest version from store cache unless force_regenerate=True.
    """
    try:
        if force_regenerate:
            res = regenerate(patient_id, requested_cycle=cycleNum, requested_treatment=treatmentId, doctor_id=doctorId)
        else:
            res = get_or_generate(patient_id, requested_cycle=cycleNum, requested_treatment=treatmentId, doctor_id=doctorId)

        return {
            "success": True,
            "cached": res.get("cached", False),
            "version": res.get("version", 1),
            "timestamp": res.get("generatedAt", ""),
            "data": res.get("data"),
        }
    except ValueError as e:
        print(f"[ChemoIntelligence 404 Notice] Patient '{patient_id}' not found: {e}")
        raise HTTPException(status_code=404, detail=str(e))
    except Exception as e:
        err_msg = traceback.format_exc()
        print(f"[ChemoIntelligence 500 CRASH]\n{err_msg}")
        raise HTTPException(status_code=500, detail=f"{e} | Traceback: {err_msg}")


@router.post("/generate/{patient_id}")
@router.post("/generate/{patient_id}/")
async def regenerate_chemotherapy_report(
    patient_id: str,
    doctorId: Optional[str] = Query(None),
    treatmentId: Optional[str] = Query(None),
    cycleNum: Optional[str] = Query(None),
):
    """
    Explicitly re-runs the agents on fresh patient data and appends a new snapshot to DB history.
    """
    try:
        res = regenerate(patient_id, requested_cycle=cycleNum, requested_treatment=treatmentId, doctor_id=doctorId)
        return {
            "success": True,
            "cached": False,
            "version": res.get("version", 1),
            "timestamp": res.get("generatedAt", ""),
            "data": res.get("data"),
        }
    except ValueError as e:
        print(f"[ChemoIntelligence 404 Notice] Patient '{patient_id}' not found: {e}")
        raise HTTPException(status_code=404, detail=str(e))
    except Exception as e:
        err_msg = traceback.format_exc()
        print(f"[ChemoIntelligence 500 CRASH]\n{err_msg}")
        raise HTTPException(status_code=500, detail=f"{e} | Traceback: {err_msg}")


@router.get("/history/{patient_id}")
@router.get("/history/{patient_id}/")
async def get_chemotherapy_report_history(patient_id: str):
    """
    Returns historical generation metadata for a patient.
    """
    try:
        history = store.list_history(patient_id)
        return {
            "success": True,
            "count": len(history),
            "history": history,
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
