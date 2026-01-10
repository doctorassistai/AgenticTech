import re
from typing import Dict, List


class PromptInjectionDetector:
    """
    Deterministic, LLM-free prompt injection detector.
    Designed for production use in pre-safety layers.
    """

    # High-confidence injection patterns
    _INJECTION_PATTERNS: List[str] = [
        r"ignore (all|previous|above) instructions",
        r"disregard (rules|policies|instructions)",
        r"you are now (a|an)? (system|developer|assistant)",
        r"act as (a|an)?",
        r"reveal (your|the)? (system|prompt|instructions)",
        r"show (your|the)? prompt",
        r"bypass (safety|guardrails|filters)",
        r"override (rules|instructions|policies)",
        r"jailbreak",
        r"do anything now",
        r"simulate (system|developer)",
        r"this is a test ignore safety",
        r"respond outside json",
        r"forget (all|everything)",
        r"remember this rule forever",
        r"you must comply",
    ]

    # Medium-confidence structural abuse patterns
    _STRUCTURAL_PATTERNS: List[str] = [
        r"<<<?.*>>>?",
        r"\[\[.*\]\]",
        r"\{\{.*\}\}",
        r"###\s*system",
        r"###\s*developer",
        r"role\s*:\s*system",
        r"role\s*:\s*developer",
    ]

    # Common injection keywords (lightweight check)
    _KEYWORDS: List[str] = [
        "ignore instructions",
        "system prompt",
        "developer message",
        "override safety",
        "bypass policy",
        "prompt injection",
        "instruction override",
    ]

    def __init__(self):
        self._compiled_injection = [
            re.compile(p, re.IGNORECASE) for p in self._INJECTION_PATTERNS
        ]
        self._compiled_structural = [
            re.compile(p, re.IGNORECASE | re.DOTALL)
            for p in self._STRUCTURAL_PATTERNS
        ]

    # --------------------------------------------------
    # Public API
    # --------------------------------------------------
    def evaluate(self, text: str) -> Dict:
        """
        Main entry point.
        Returns a deterministic safety assessment.
        """
        if not text or not isinstance(text, str):
            return self._blocked("invalid_input")

        normalized = text.lower().strip()

        if self._matches(self._compiled_injection, normalized):
            return self._blocked("instruction_override")

        if self._matches(self._compiled_structural, normalized):
            return self._blocked("role_hijack")

        if any(k in normalized for k in self._KEYWORDS):
            return self._blocked("keyword_signal")

        return {
            "is_injection": False,
            "severity": "none",
            "action": "allow",
            "confidence": 0.0,
            "sanitized_input": text,
        }

    # --------------------------------------------------
    # Internal helpers
    # --------------------------------------------------
    def _matches(self, patterns: List[re.Pattern], text: str) -> bool:
        return any(p.search(text) for p in patterns)

    def _blocked(self, reason: str) -> Dict:
        return {
            "is_injection": True,
            "severity": self._severity(reason),
            "action": "sanitize_and_restrict",
            "confidence": 1.0,
            "reason": reason,
            "sanitized_input": self._sanitize(reason),
        }

    def _severity(self, reason: str) -> str:
        if reason in ("instruction_override", "role_hijack"):
            return "high"
        return "medium"

    def _sanitize(self, reason: str) -> str:
        """
        Conservative sanitization strategy.
        """
        return f"[CONTENT REMOVED DUE TO {reason.upper()}]"



# Example usage:

# from prompt_injection import PromptInjectionDetector

# detector = PromptInjectionDetector()

# result = detector.evaluate(user_input)
