"""
integration/mact/routes.py

Internal routes (mounted on the integration app). Public URLs are the same
paths under /hms via the gateway proxy (gateway/routes/mact_proxy.py):

  public  POST   /hms/mact/cases            ->  internal  POST   /mact/cases
  public  GET    /hms/mact/cases            ->  internal  GET    /mact/cases
  public  DELETE /hms/mact/cases/samples    ->  internal  DELETE /mact/cases/samples

Document routes (upload / list / view / retry / delete) live in documents.py and are
included below; they need role == "mact_adjudicator".

Access: global. Any authenticated user sees every case (no per-user filter).
Deleting samples needs role == "system_admin".
"""

import logging
from typing import Literal, Optional

from fastapi import APIRouter, Depends, HTTPException, Query, status

from . import service
from .auth import actor_of, require_user
from .documents import router as documents_router
from .models import RegisterCaseIn

logger = logging.getLogger("mact.routes")

router = APIRouter(prefix="/mact", tags=["mact"])
router.include_router(documents_router)


@router.post("/cases", status_code=status.HTTP_201_CREATED)
async def register_case(payload: RegisterCaseIn, user: dict = Depends(require_user)):
    try:
        case = await service.register_case(payload, actor=actor_of(user))
    except service.DuplicateCase as e:
        what = "CNR" if e.field == "cnr" else "petition number for this court"
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail={"message": f"A case with this {what} already exists",
                    "field": e.field, "existing_case_id": e.existing_id},
        )
    except service.InvalidInput as e:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=str(e))
    except Exception:
        logger.exception("register_case failed")
        raise HTTPException(status_code=500, detail="Could not register the case")
    return {"status": "success", "case": case}


@router.get("/cases")
async def list_cases(
    q: Optional[str] = Query(default=None, max_length=100, description="id, CNR, petition no., victim, court"),
    case_type: Optional[Literal["Death", "Injury", "No-fault"]] = Query(default=None, alias="type"),
    include_samples: bool = True,
    skip: int = Query(default=0, ge=0),
    limit: int = Query(default=50, ge=1, le=200),
    user: dict = Depends(require_user),
):
    total, items = await service.list_cases(q, case_type, include_samples, skip, limit)
    return {"status": "success", "total": total, "skip": skip, "limit": limit, "cases": items}


@router.delete("/cases/samples")
async def delete_sample_cases(user: dict = Depends(require_user)):
    if user.get("role") != "system_admin":
        raise HTTPException(status_code=403, detail="Only a system admin can delete sample cases")
    result = await service.delete_samples()
    logger.info("sample cases deleted by %s: %s", actor_of(user), result)
    return {"status": "success", **result}