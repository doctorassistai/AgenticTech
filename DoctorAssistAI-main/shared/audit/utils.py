from datetime import datetime
import uuid
import asyncio

def emit_audit(app, event):
    """
    Fire-and-forget audit logging.
    NEVER block API requests.
    """
    try:
        loop = asyncio.get_running_loop()
        loop.run_in_executor(None, app.state.audit.log, event)
    except Exception:
        # Audit must NEVER break the main flow
        pass
