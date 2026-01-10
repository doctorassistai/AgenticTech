from pydantic import BaseModel
from typing import Dict, Optional
from datetime import datetime

class AuditEvent(BaseModel):
    timestamp: datetime
    level: str

    source: Dict
    actor: Dict
    context: Dict
    clinical_context: Dict
    action: Dict
    decision: Optional[Dict] = None
