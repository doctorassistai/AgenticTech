"""agents/ — one module-agent per dashboard module. Phase 1 first."""

from .base import BaseAgent
from .documentation import DocumentationAgent

__all__ = ["BaseAgent", "DocumentationAgent"]
