import re
from typing import Dict


class InputSanitizer:
    """
    Deterministic sanitizer for user input.
    Designed for medical AI pre-safety pipelines.
    """

    # Phrases that must NEVER reach the AI model
    BLOCKED_PHRASES = [
        r"ignore (all|previous|above) instructions",
        r"disregard (rules|instructions|policies)",
        r"you are now (a|an)? (system|developer|assistant)",
        r"act as (a|an)?",
        r"simulate (system|developer)",
        r"reveal (your|the)? (system|prompt|instructions)",
        r"show (your|the)? prompt",
        r"override (rules|instructions|system)",
        r"bypass (safety|filters|guardrails)",
        r"jailbreak",
        r"do anything now",
        r"respond outside json",
        r"ignore json format",
    ]

    # Structural artifacts that leak into prompts
    STRUCTURAL_ARTIFACTS = [
        r"###\s*system.*",
        r"###\s*developer.*",
        r"role\s*:\s*(system|developer)",
        r"<<<?.*>>>?",
        r"\{\{.*?\}\}",
        r"\[\[.*?\]\]",
    ]

    # Excessive formatting / noise
    NOISE_PATTERNS = [
        r"\n{3,}",
        r"\s{2,}",
    ]

    def __init__(self):
        self._blocked = [
            re.compile(p, re.IGNORECASE) for p in self.BLOCKED_PHRASES
        ]
        self._structural = [
            re.compile(p, re.IGNORECASE | re.DOTALL)
            for p in self.STRUCTURAL_ARTIFACTS
        ]
        self._noise = [
            re.compile(p) for p in self.NOISE_PATTERNS
        ]

    # --------------------------------------------------
    # Public API
    # --------------------------------------------------
    def sanitize(self, text: str) -> Dict:
        if not text or not isinstance(text, str):
            return self._empty()

        original = text
        cleaned = text

        # Remove blocked phrases
        for pattern in self._blocked:
            cleaned = pattern.sub("[REMOVED]", cleaned)

        # Remove structural artifacts
        for pattern in self._structural:
            cleaned = pattern.sub(" ", cleaned)

        # Normalize whitespace
        for pattern in self._noise:
            cleaned = pattern.sub(" ", cleaned)

        cleaned = cleaned.strip()

        return {
            "original_input": original,
            "sanitized_input": cleaned,
            "was_sanitized": cleaned != original,
        }

    # --------------------------------------------------
    # Helpers
    # --------------------------------------------------
    def _empty(self) -> Dict:
        return {
            "original_input": "",
            "sanitized_input": "",
            "was_sanitized": False,
        }


# Example usage:

# sanitizer = InputSanitizer()

# if injection_result["is_injection"]:
#     sanitized = sanitizer.sanitize(user_input)
#     final_input = sanitized["sanitized_input"]
#     safety_mode = "max"
# else:
#     final_input = user_input
#     safety_mode = "normal"