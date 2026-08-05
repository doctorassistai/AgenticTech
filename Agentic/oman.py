from __future__ import annotations

import json
import logging
import asyncio
from typing import Dict, List, Optional, TypedDict, Any
from dataclasses import dataclass, field
from enum import Enum

from fastapi import FastAPI, HTTPException
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field

from langchain_core.messages import HumanMessage, SystemMessage
from langchain_groq import ChatGroq
from fastapi import APIRouter
# ============================================================
# LOGGING
# ============================================================

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s | %(levelname)s | %(name)s | %(message)s",
)
logger = logging.getLogger("MedicalCodingAPI")


# ============================================================
# CONFIG
# ============================================================

class LLMConfig:
    MODEL       = "llama-3.3-70b-versatile"
    TEMPERATURE = 0.1
    MAX_TOKENS  = 4096
    MAX_RETRIES = 3
    RETRY_DELAY = 1.5   # seconds between retries


# ============================================================
# PROMPT REGISTRY  (zero hardcoded strings elsewhere)
# ============================================================

class PromptRegistry:
    """
    Single source of truth for every system + user prompt in the pipeline.
    All prompts are class-level attributes — import and reference by name,
    never inline.
    """

    # ── Agent 1 ── Clinical Extractor ──────────────────────────────────────

    EXTRACTOR_SYSTEM = (
        "You are a board-certified clinical documentation specialist with expertise "
        "in ICD-10-CM, CPT, and HCPCS coding standards. Your task is to extract "
        "precise, structured clinical data from free-text medical case notes to "
        "support accurate downstream medical coding. Focus on clinical specificity: "
        "include laterality, acuity, anatomical site, wound measurements, repair "
        "complexity, and any co-morbid conditions. Return ONLY valid JSON."
    )

    EXTRACTOR_USER = """
Analyze the following medical case text and extract ALL clinically relevant data
required for complete and compliant medical coding.

Extract and structure the following fields (include every detail present in the note):

{{
  "encounter_type": "...",                  // e.g., Emergency, Outpatient, Inpatient
  "chief_complaint": "...",
  "diagnoses": [
    {{
      "condition": "...",
      "acuity": "...",                       // acute / chronic / acute-on-chronic
      "laterality": "...",                   // left / right / bilateral / N/A
      "anatomical_site": "...",
      "clinical_details": "..."
    }}
  ],
  "injuries": [
    {{
      "type": "...",                         // laceration, fracture, burn, contusion…
      "site": "...",
      "laterality": "...",
      "length_cm": null,
      "depth": "...",                        // superficial / subcutaneous / deep
      "contamination": "...",               // clean / contaminated / dirty
      "repair_type": "..."                  // simple / intermediate / complex
    }}
  ],
  "procedures": [
    {{
      "name": "...",
      "approach": "...",
      "site": "...",
      "laterality": "...",
      "details": "..."
    }}
  ],
  "medications_administered": [...],
  "imaging_labs": [...],
  "comorbidities": [...],
  "provider_specialty": "...",
  "facility_type": "...",
  "clinical_flags": [...]                   // e.g., drug interaction, fall risk
}}

CASE TEXT:
{case_text}

Return ONLY the JSON object with no additional commentary.
"""

    # ── Agent 2 ── Coder ────────────────────────────────────────────────────

    CODER_SYSTEM = (
        "You are a Certified Professional Coder (CPC) and Certified Inpatient Coder (CIC) "
        "with 15 years of experience. You apply official AMA CPT guidelines, CMS ICD-10-CM "
        "Official Guidelines for Coding and Reporting, and HCPCS Level II conventions "
        "with precision. You must assign the most specific code available, never use "
        "unspecified codes when specificity is documented, and always follow sequencing rules. "
        "Return ONLY valid JSON."
    )

    CODER_USER = """
You are given structured clinical data extracted from a medical case.
Assign ALL applicable codes across every relevant coding system.

EXTRACTED CLINICAL DATA:
{extracted_json}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
CODING INSTRUCTIONS:
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

ICD-10-CM (Diagnosis Codes):
  - Sequence: principal diagnosis first, then complications, then comorbidities
  - Apply specificity: include laterality, acuity, episode (initial/subsequent/sequela)
  - Code external cause (V/W/X/Y codes) and place of occurrence when applicable
  - Do NOT code signs/symptoms absorbed into a definitive diagnosis

CPT (Procedure Codes):
  - Assign based on documented procedure complexity and anatomical site
  - Apply correct add-on codes (+) where applicable
  - Differentiate unilateral vs bilateral procedures
  - Follow global surgery package rules for bundling

HCPCS Level II:
  - Assign for durable medical equipment, drugs, and supplies documented
  - Include J-codes for administered medications with dosage

Modifiers:
  - -25: Significant, separately identifiable E&M on same day as procedure
  - -26 / TC: Professional vs Technical component when applicable
  - -50: Bilateral procedure
  - -51: Multiple procedures (list most resource-intensive first)
  - -59: Distinct procedural service
  - -76 / -77: Repeat procedure, same / different physician
  - -LT / -RT: Laterality modifiers
  - -XE / -XS / -XP / -XU: Subset of -59 (use preferred over -59 when specific)

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Return EXACTLY this JSON structure:

{{
  "ICD-10-CM": [
    {{
      "code": "...",
      "description": "...",
      "sequencing_position": 1,
      "reasoning": "...",
      "guideline_reference": "..."
    }}
  ],
  "CPT": [
    {{
      "code": "...",
      "description": "...",
      "modifiers": [],
      "reasoning": "...",
      "bundling_notes": "..."
    }}
  ],
  "HCPCS": [
    {{
      "code": "...",
      "description": "...",
      "units": 1,
      "reasoning": "..."
    }}
  ],
  "Modifiers": [
    {{
      "modifier": "...",
      "applied_to_code": "...",
      "rationale": "..."
    }}
  ],
  "coding_confidence": {{
    "overall": "high / medium / low",
    "icd_confidence": "high / medium / low",
    "cpt_confidence": "high / medium / low",
    "notes": "..."
  }}
}}
"""

    # ── Agent 3 ── Validator / Auditor ──────────────────────────────────────

    VALIDATOR_SYSTEM = (
        "You are a Senior Certified Professional Medical Auditor (CPMA) with expertise "
        "in CMS NCCI edits, AMA CPT guidelines, ICD-10-CM Official Guidelines, payer "
        "LCD/NCD policies, and RAC audit patterns. You perform pre-bill audits to identify "
        "upcoding, undercoding, unbundling, missing codes, and documentation gaps. "
        "Your feedback must be actionable and guideline-referenced. Return ONLY valid JSON."
    )

    VALIDATOR_USER = """
Perform a comprehensive pre-submission audit of the following medical coding case.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
ORIGINAL CASE TEXT:
{case_text}

CLINICAL EXTRACTION:
{extracted_json}

ASSIGNED CODES:
{coding_json}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

AUDIT CHECKLIST — evaluate each area:

1. ICD-10-CM Compliance:
   - Correct sequencing (principal → secondary → comorbidities)?
   - Specificity maximized (laterality, acuity, episode)?
   - External cause / place-of-occurrence coded?
   - Signs/symptoms appropriately excluded or included?

2. CPT Compliance:
   - Correct procedure code selected for documented complexity?
   - Add-on codes included where required?
   - Bundling violations (NCCI edits)?
   - Global package inclusions/exclusions respected?

3. Modifier Validation:
   - Each modifier clinically and procedurally justified?
   - -25 supported by documented separate E&M?
   - -59 / X{{EPSU}} used correctly and not over-applied?

4. HCPCS Accuracy:
   - Drug codes match documented drug + dosage?
   - DME codes appropriate for setting?

5. Documentation Gaps:
   - What clinical details are missing that would strengthen or change codes?

6. Audit Risk Assessment:
   - RAC / ZPIC red flags present?
   - Upcoding or unbundling risk?

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Return EXACTLY this JSON:

{{
  "compliance_status": "valid | needs_review | non_compliant",
  "audit_score": 0-100,
  "icd_audit": {{
    "status": "pass | warn | fail",
    "guidelines_applied": [...],
    "issues": [...],
    "recommendations": [...]
  }},
  "cpt_audit": {{
    "status": "pass | warn | fail",
    "guidelines_applied": [...],
    "bundling_issues": [...],
    "recommendations": [...]
  }},
  "modifier_audit": {{
    "status": "pass | warn | fail",
    "issues": [...],
    "recommendations": [...]
  }},
  "hcpcs_audit": {{
    "status": "pass | warn | fail",
    "issues": [...],
    "recommendations": [...]
  }},
  "documentation_gaps": [...],
  "missing_codes": [
    {{
      "code": "...",
      "type": "ICD / CPT / HCPCS",
      "reason_missing": "..."
    }}
  ],
  "audit_risks": [
    {{
      "risk_level": "high | medium | low",
      "description": "...",
      "mitigation": "..."
    }}
  ],
  "overall_summary": "..."
}}
"""

    # ── Agent 4 ── Coding Narrative ─────────────────────────────────────────

    NARRATIVE_SYSTEM = (
        "You are a medical coding educator and documentation expert. "
        "Generate a clear, structured coding narrative that explains the "
        "complete coding rationale for billing and audit defense purposes. "
        "Use plain language that both clinical and administrative staff can follow. "
        "Return ONLY valid JSON."
    )

    NARRATIVE_USER = """
Generate a complete coding narrative for this case that can be attached to the claim
for audit defense and billing team reference.

CASE TEXT:
{case_text}

FINAL CODES:
{coding_json}

AUDIT RESULTS:
{validation_json}

Return:
{{
  "claim_summary": "...",
  "coding_rationale": "...",
  "guideline_references": [...],
  "audit_defense_notes": "...",
  "coder_attestation": "Codes assigned per official AMA/CMS guidelines as of current version."
}}
"""


# ============================================================
# ENUMS & STATE
# ============================================================

class ComplianceStatus(str, Enum):
    VALID         = "valid"
    NEEDS_REVIEW  = "needs_review"
    NON_COMPLIANT = "non_compliant"


class CodingState(TypedDict):
    case_text:       str
    extracted_data:  Dict
    coding_outputs:  Dict
    validation:      Dict
    narrative:       Dict
    pipeline_meta:   Dict


# ============================================================
# REQUEST / RESPONSE MODELS
# ============================================================

class CodingRequest(BaseModel):
    case_text: str = Field(
        ...,
        min_length=20,
        description="Free-text clinical case note or operative report.",
        examples=["47-year-old male presented to ED after MVA with 4cm laceration ..."],
    )
    include_narrative: bool = Field(
        default=True,
        description="Include a coding narrative / audit defense summary.",
    )


# ============================================================
# BASE AGENT
# ============================================================

class BaseAgent:

    def __init__(self, llm_instance: ChatGroq, agent_name: str):
        self.llm        = llm_instance
        self.agent_name = agent_name

    async def run_llm(
        self,
        system_prompt: str,
        user_prompt:   str,
        retries:       int = LLMConfig.MAX_RETRIES,
    ) -> Dict:
        for attempt in range(1, retries + 1):
            try:
                logger.info(f"[{self.agent_name}] LLM call — attempt {attempt}")
                response = await self.llm.ainvoke([
                    SystemMessage(content=system_prompt),
                    HumanMessage(content=user_prompt),
                ])
                parsed = self._parse_json(response.content)
                logger.info(f"[{self.agent_name}] LLM call succeeded")
                return parsed
            except Exception as exc:
                logger.warning(f"[{self.agent_name}] Attempt {attempt} failed: {exc}")
                if attempt < retries:
                    await asyncio.sleep(LLMConfig.RETRY_DELAY * attempt)
                else:
                    logger.error(f"[{self.agent_name}] All retries exhausted.")
                    return {"error": str(exc), "agent": self.agent_name}

    def _parse_json(self, text: str) -> Dict:
        # Strip markdown fences if the model wraps the output
        clean = text.strip()
        if clean.startswith("```"):
            lines = clean.splitlines()
            clean = "\n".join(
                line for line in lines
                if not line.strip().startswith("```")
            ).strip()
        try:
            return json.loads(clean)
        except json.JSONDecodeError:
            logger.warning(f"[{self.agent_name}] JSON parse failed — returning raw output.")
            return {"raw_output": text}


# ============================================================
# AGENT 1 — CLINICAL EXTRACTOR
# ============================================================

class ClinicalExtractorAgent(BaseAgent):

    def __init__(self, llm_instance: ChatGroq):
        super().__init__(llm_instance, "ClinicalExtractor")

    async def run(self, case_text: str) -> Dict:
        user_prompt = PromptRegistry.EXTRACTOR_USER.format(case_text=case_text)
        return await self.run_llm(
            system_prompt=PromptRegistry.EXTRACTOR_SYSTEM,
            user_prompt=user_prompt,
        )


# ============================================================
# AGENT 2 — UNIVERSAL CODER
# ============================================================

class CodingAgent(BaseAgent):

    def __init__(self, llm_instance: ChatGroq):
        super().__init__(llm_instance, "UniversalCoder")

    async def run(self, extracted: Dict) -> Dict:
        user_prompt = PromptRegistry.CODER_USER.format(
            extracted_json=json.dumps(extracted, indent=2)
        )
        return await self.run_llm(
            system_prompt=PromptRegistry.CODER_SYSTEM,
            user_prompt=user_prompt,
        )


# ============================================================
# AGENT 3 — VALIDATOR / AUDITOR
# ============================================================

class ValidationAgent(BaseAgent):

    def __init__(self, llm_instance: ChatGroq):
        super().__init__(llm_instance, "AuditValidator")

    async def run(self, state: CodingState) -> Dict:
        user_prompt = PromptRegistry.VALIDATOR_USER.format(
            case_text=state["case_text"],
            extracted_json=json.dumps(state["extracted_data"], indent=2),
            coding_json=json.dumps(state["coding_outputs"], indent=2),
        )
        return await self.run_llm(
            system_prompt=PromptRegistry.VALIDATOR_SYSTEM,
            user_prompt=user_prompt,
        )


# ============================================================
# AGENT 4 — NARRATIVE GENERATOR
# ============================================================

class NarrativeAgent(BaseAgent):

    def __init__(self, llm_instance: ChatGroq):
        super().__init__(llm_instance, "NarrativeGenerator")

    async def run(self, state: CodingState) -> Dict:
        user_prompt = PromptRegistry.NARRATIVE_USER.format(
            case_text=state["case_text"],
            coding_json=json.dumps(state["coding_outputs"], indent=2),
            validation_json=json.dumps(state["validation"], indent=2),
        )
        return await self.run_llm(
            system_prompt=PromptRegistry.NARRATIVE_SYSTEM,
            user_prompt=user_prompt,
        )


# ============================================================
# ORCHESTRATOR
# ============================================================

class CodingOrchestrator:

    def __init__(self, llm_instance: ChatGroq):
        self.extractor = ClinicalExtractorAgent(llm_instance)
        self.coder     = CodingAgent(llm_instance)
        self.validator = ValidationAgent(llm_instance)
        self.narrator  = NarrativeAgent(llm_instance)

    async def run(
        self,
        case_text:         str,
        include_narrative: bool = True,
    ) -> CodingState:

        state: CodingState = {
            "case_text":      case_text,
            "extracted_data": {},
            "coding_outputs": {},
            "validation":     {},
            "narrative":      {},
            "pipeline_meta":  {
                "steps_completed": [],
                "errors":          [],
            },
        }

        # ── STEP 1: Clinical Extraction ──────────────────────────────────
        logger.info("Pipeline Step 1 — Clinical Extraction")
        state["extracted_data"] = await self.extractor.run(case_text)
        state["pipeline_meta"]["steps_completed"].append("clinical_extraction")

        if "error" in state["extracted_data"]:
            state["pipeline_meta"]["errors"].append(state["extracted_data"]["error"])
            logger.error("Extraction failed — aborting pipeline.")
            return state

        # ── STEP 2: Universal Coding ─────────────────────────────────────
        logger.info("Pipeline Step 2 — Universal Coding")
        state["coding_outputs"] = await self.coder.run(state["extracted_data"])
        state["pipeline_meta"]["steps_completed"].append("universal_coding")

        if "error" in state["coding_outputs"]:
            state["pipeline_meta"]["errors"].append(state["coding_outputs"]["error"])
            logger.error("Coding failed — skipping validation.")
            return state

        # ── STEP 3: Audit & Validation ───────────────────────────────────
        logger.info("Pipeline Step 3 — Audit & Validation")
        state["validation"] = await self.validator.run(state)
        state["pipeline_meta"]["steps_completed"].append("audit_validation")

        # ── STEP 4: Coding Narrative (optional) ──────────────────────────
        if include_narrative:
            logger.info("Pipeline Step 4 — Narrative Generation")
            state["narrative"] = await self.narrator.run(state)
            state["pipeline_meta"]["steps_completed"].append("narrative_generation")

        logger.info("Pipeline complete — all steps finished.")
        return state


# ============================================================
# LLM + APP SETUP
# ============================================================

llm = ChatGroq(
    model=LLMConfig.MODEL,
    temperature=LLMConfig.TEMPERATURE,
    max_tokens=LLMConfig.MAX_TOKENS,
)

router = APIRouter()

orchestrator = CodingOrchestrator(llm_instance=llm)


# ============================================================
# ROUTES
# ============================================================

@router.get("/health")
async def health_check():
    return {"status": "ok", "version": app.version}


@router.post("/coding/analyze")
async def analyze_case(request: CodingRequest):
    if not request.case_text.strip():
        raise HTTPException(status_code=422, detail="case_text must not be empty.")

    try:
        result = await orchestrator.run(
            case_text=request.case_text,
            include_narrative=request.include_narrative,
        )
    except Exception as exc:
        logger.exception("Unexpected orchestrator error.")
        raise HTTPException(status_code=500, detail=str(exc))

    has_errors = bool(result["pipeline_meta"]["errors"])

    return JSONResponse(
        status_code=200,
        content={
            "status":               "partial" if has_errors else "success",
            "input_case":           request.case_text,
            "clinical_extraction":  result["extracted_data"],
            "coding":               result["coding_outputs"],
            "validation":           result["validation"],
            "narrative":            result["narrative"],
            "pipeline_meta":        result["pipeline_meta"],
        },
    )