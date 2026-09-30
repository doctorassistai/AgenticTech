"""
integration/patient_app: patient mobile-app endpoints, hosted inside the
existing `integration` container (no separate Docker service).

The integration service does not configure logging itself, so we attach our own
handler to the "patient_app" logger namespace. INFO lines carry sys_user_id and
endpoint only (handoff rule 5).
"""

import logging
import sys

_log = logging.getLogger("patient_app")
if not _log.handlers:
    _handler = logging.StreamHandler(sys.stdout)
    _handler.setFormatter(logging.Formatter("%(asctime)s %(levelname)s %(name)s - %(message)s"))
    _log.addHandler(_handler)
    _log.setLevel(logging.INFO)
    _log.propagate = False