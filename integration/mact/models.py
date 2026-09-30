"""
integration/mact/models.py

Request models. Field names match the "Register a petition manually" form in
Sync.jsx (cnr, mvc, court, type, victim, age, claim, acc, pol) so the front-end
can post them as-is.

Deliberately NOT validated: how long after the accident the petition was filed.
Late petitions are registered normally (no s.166(3) time-bar objection while
the Supreme Court's interim order stands).
"""

import re
from datetime import date
from typing import Literal, Optional

from pydantic import BaseModel, ConfigDict, Field, field_validator

# CNR = 16 alphanumerics, e.g. KABC0A0019902026
_CNR_RE = re.compile(r"^[A-Z0-9]{16}$")

_BLANK_TO_NONE = ("age", "pol", "state", "district", "filed", "notice_on")


class RegisterCaseIn(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True, extra="ignore")

    cnr: str
    mvc: str = Field(..., min_length=1, max_length=60)          # petition no., e.g. "MVC 1990/2026"
    court: str = Field(..., min_length=1, max_length=200)        # tribunal
    type: Literal["Death", "Injury", "No-fault"]
    victim: str = Field(..., min_length=1, max_length=120)
    age: Optional[int] = Field(default=None, ge=0, le=110)       # left empty -> stored as null, never guessed
    claim: int = Field(default=0, ge=0, le=100_000_000_000)      # amount claimed, rupees
    acc: date                                                    # accident date
    pol: Optional[str] = Field(default=None, max_length=60)      # policy no.

    # Optional extras (the form does not send these yet)
    state: Optional[str] = Field(default=None, max_length=60)
    district: Optional[str] = Field(default=None, max_length=60)
    filed: Optional[date] = None                                 # default: today (IST)
    notice_on: Optional[date] = None                             # default: today (IST)
    no_fault_kind: Literal["Death", "Injury"] = "Death"          # only used when type == "No-fault"

    @field_validator(*_BLANK_TO_NONE, mode="before")
    @classmethod
    def _blank_is_none(cls, v):
        return None if isinstance(v, str) and not v.strip() else v

    @field_validator("claim", mode="before")
    @classmethod
    def _blank_claim_is_zero(cls, v):
        return 0 if v is None or (isinstance(v, str) and not v.strip()) else v

    @field_validator("cnr")
    @classmethod
    def _check_cnr(cls, v: str) -> str:
        v = v.replace(" ", "").upper()
        if not _CNR_RE.match(v):
            raise ValueError("CNR must be 16 letters/digits, e.g. KABC0A0019902026")
        return v