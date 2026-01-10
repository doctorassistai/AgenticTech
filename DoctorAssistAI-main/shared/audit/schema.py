from pydantic import BaseModel
from datetime import datetime
from typing import Dict, Optional

class AuditEvent(BaseModel):
    timestamp: datetime
    level: str
    source: Dict
    actor: Dict
    context: Dict
    clinical_context: Dict
    action: Dict
    decision: Optional[Dict] = None
