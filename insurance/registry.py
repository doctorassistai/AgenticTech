from __future__ import annotations
from typing import Callable, Dict, Any, List
import asyncio
import logging
from routes.agents.unified_report_agent import generate_unified_conclusion
from routes.agents.preprocessor import has_ped_in_raw_markdown
logger = logging.getLogger(__name__)

from .triggers import (
        claim_genuinity,
        accident_incident,
        ped_non_disclosure,
        medical_records,
        hospital_criteria,
        death_verification,
        intoxication_addiction,
        financial_claim_pattern,
        policy_coverage,
        field_vicinity,
        employee_corporate,
        hospital_cash_benefit,
        suspicious_pattern,
        universal_red_flags,
    )

TRIGGER_REGISTRY: Dict[str, Callable] = {
        "claim_genuinity_authenticity":            claim_genuinity.run,
        "accident_incident_verification":          accident_incident.run,
        "ped_non_disclosure":                      ped_non_disclosure.run,
        "medical_records_treatment_verification":  medical_records.run,
        "hospital_criteria_watchlist":             hospital_criteria.run,
        "legal_regulatory_death_verification":     death_verification.run,
        "intoxication_addiction":                  intoxication_addiction.run,
        "financial_claim_pattern_risk":            financial_claim_pattern.run,
        "policy_coverage_verification":            policy_coverage.run,
        "field_vicinity_investigation":            field_vicinity.run,
        "employee_corporate_group_policy_verification": employee_corporate.run,
        "hospital_cash_benefit_abuse":             hospital_cash_benefit.run,
        "suspicious_claim_pattern_repeat_fraud":   suspicious_pattern.run,
        "final_universal_red_flags_matrix":        universal_red_flags.run,
    }

    # Human-readable labels for each trigger
TRIGGER_LABELS: Dict[str, str] = {
        "claim_genuinity_authenticity":            "Claim Genuinity & Authenticity",
        "accident_incident_verification":          "Accident / Incident Verification",
        "ped_non_disclosure":                      "PED / Non-Disclosure",
        "medical_records_treatment_verification":  "Medical Records & Treatment Verification",
        "hospital_criteria_watchlist":             "Hospital Criteria / Watchlist",
        "legal_regulatory_death_verification":     "Death Verification",
        "intoxication_addiction":                  "Intoxication / Addiction",
        "financial_claim_pattern_risk":            "Financial & Claim Pattern Risk",
        "policy_coverage_verification":            "Policy & Coverage Verification",
        "field_vicinity_investigation":            "Field / Vicinity Investigation",
        "employee_corporate_group_policy_verification": "Employee / Corporate Policy",
        "hospital_cash_benefit_abuse":             "Hospital Cash / Benefit Abuse",
        "suspicious_claim_pattern_repeat_fraud":   "Suspicious Claim Pattern",
        "final_universal_red_flags_matrix":        "Universal Red Flags Matrix",
    }


async def generate_conclusion(
        trigger: str,
        text: str,
        pass1_result: Dict,
        extracted_flat: Dict,
        preprocessed: Dict = None,
    ) -> str:
        fn = TRIGGER_REGISTRY.get(trigger) or claim_genuinity.run
        return await fn(text, pass1_result, extracted_flat, preprocessed)

async def generate_multi_conclusion(
    triggers: List[str],
    text: str,
    pass1_result: Dict,
    extracted_flat: Dict,
    preprocessed: Dict = None,
) -> str:
    """
    Run multiple triggers concurrently.
    Returns combined conclusion with one section per trigger.
    Guarantees trigger/header consistency.
    Retries failed triggers.
    Adds PED-specific recovery if PED exists in raw markdown.
    """

    if not triggers:
        return ""

    tasks = []
    valid_triggers = []

    # --------------------------------------------------
    # Build async tasks
    # --------------------------------------------------
    for t in triggers:
        fn = TRIGGER_REGISTRY.get(t)

        if fn:
            tasks.append(
                fn(
                    text,
                    pass1_result,
                    extracted_flat,
                    preprocessed,
                )
            )
            valid_triggers.append(t)
        else:
            logger.warning(
                "Unknown trigger skipped: %s",
                t,
            )

    # Run all triggers safely
    results = await asyncio.gather(
        *tasks,
        return_exceptions=True,
    )

    combined_parts = []
    failed_triggers = []

    # --------------------------------------------------
    # First pass
    # --------------------------------------------------
    for trigger, result in zip(valid_triggers, results):
        label = TRIGGER_LABELS.get(
            trigger,
            trigger,
        )

        header = (
            f"{'=' * 60}\n"
            f"TRIGGER: {label.upper()}\n"
            f"{'=' * 60}\n\n"
        )

        # Trigger exception
        if isinstance(result, Exception):
            logger.exception(
                "Trigger failed: %s",
                trigger,
                exc_info=result,
            )

            failed_triggers.append(trigger)

            combined_parts.append(
                header
                + f"[Generation failed for this trigger: {result}]"
            )
            continue

        # Empty result
        if not result or not str(result).strip():
            logger.warning(
                "Trigger returned empty result: %s",
                trigger,
            )

            failed_triggers.append(trigger)

            combined_parts.append(
                header
                + "No findings for this trigger"
            )
            continue

        # Success
        combined_parts.append(
            header + str(result)
        )

    # --------------------------------------------------
    # Header consistency check
    # --------------------------------------------------
    combined = "\n\n\n".join(combined_parts)
    header_count = combined.count("TRIGGER:")

    if header_count != len(valid_triggers):
        logger.warning(
            "Header mismatch. expected=%d actual=%d",
            len(valid_triggers),
            header_count,
        )

        # Retry failed triggers individually
        for trigger in failed_triggers:
            fn = TRIGGER_REGISTRY.get(trigger)
            label = TRIGGER_LABELS.get(
                trigger,
                trigger,
            )

            header = (
                f"{'=' * 60}\n"
                f"TRIGGER: {label.upper()}\n"
                f"{'=' * 60}\n\n"
            )

            try:
                logger.info(
                    "Retrying failed trigger: %s",
                    trigger,
                )

                retry_result = await fn(
                    text,
                    pass1_result,
                    extracted_flat,
                    preprocessed,
                )

                if (
                    retry_result
                    and str(retry_result).strip()
                ):
                    placeholder = (
                        header
                        + "No findings for this trigger"
                    )

                    failure_prefix = (
                        header
                        + "[Generation failed for this trigger:"
                    )

                    for i, part in enumerate(combined_parts):
                        if part == placeholder:
                            combined_parts[i] = (
                                header
                                + str(retry_result)
                            )
                            break

                        elif part.startswith(failure_prefix):
                            combined_parts[i] = (
                                header
                                + str(retry_result)
                            )
                            break

                else:
                    logger.warning(
                        "Retry still empty: %s",
                        trigger,
                    )

            except Exception as exc:
                logger.exception(
                    "Retry failed: %s",
                    trigger,
                    exc_info=exc,
                )

    # --------------------------------------------------
    # PED-specific validation + retry
    # --------------------------------------------------
    for i, trigger in enumerate(valid_triggers):
        if trigger == "ped_non_disclosure":
            ped_conclusion = (
                combined_parts[i]
                if i < len(combined_parts)
                else ""
            )

            if (
                not ped_conclusion
                or "No findings for this trigger"
                in ped_conclusion
            ):
                raw = (
                    extracted_flat.get("raw_markdown")
                    or text
                    or ""
                )

                if has_ped_in_raw_markdown(raw):
                    logger.warning(
                        "PED conclusion empty but raw text has PED – retrying PED trigger"
                    )

                    fn = TRIGGER_REGISTRY.get(
                        "ped_non_disclosure"
                    )

                    try:
                        retry_result = await fn(
                            text,
                            pass1_result,
                            extracted_flat,
                            preprocessed,
                        )

                        if (
                            retry_result
                            and str(retry_result).strip()
                            and "No findings"
                            not in retry_result
                        ):
                            combined_parts[i] = (
                                f"{'=' * 60}\n"
                                f"TRIGGER: PED / NON-DISCLOSURE\n"
                                f"{'=' * 60}\n\n"
                                f"{retry_result}"
                            )
                        else:
                            logger.warning(
                                "PED retry still empty"
                            )

                    except Exception as exc:
                        logger.exception(
                            "PED retry failed",
                            exc_info=exc,
                        )

    # --------------------------------------------------
    # Final return
    # --------------------------------------------------
    return "\n\n\n".join(combined_parts)