# clinical_timeline_encounters.py

from typing import Optional, Dict, List, Any

from loguru import logger


# ==============================================================
# ENTITY-SPECIFIC PROMPT TEMPLATES
#
# Each clinical entity type gets its own dedicated longitudinal
# summarization prompt, instead of one generic prompt +
# type_specific_instructions snippet.
#
# These templates are used by BOTH:
#   - generate_summary()          (cross-encounter comparison)
#   - _compare_within_encounter() (same-encounter comparison)
#
# so an encounter that already has a summary for a type does NOT
# fall back to the old generic comparison prompt.
#
# Placeholders filled via str.format():
#   {previous_text}
#   {document_text}
#   {document_date}
# ==============================================================

_SHARED_RECONCILIATION_RULES = """
Shared reconciliation rules:
- PREVIOUS SUMMARY is historical context, not ground truth.
- CURRENT DOCUMENT is the most recent evidence.
- Preserve clinically important facts, not verbatim previous wording.
- Actual performed / administered / completed events take priority over plans.
- Do not infer missing values, statuses, treatment cycles, or diagnoses.
- Repeated copied-forward information is not automatically new information.
- Do not silently resolve contradictions; explicitly report unresolved
  conflicts under "Data Quality / Unresolved Conflict" instead of
  resolving them silently.
- Do not use "stable", "improved", or "worsened" without comparable
  evidence.
- Do not duplicate identical facts.
- IMPORTANT: For procedures, ALWAYS carry forward ALL previously documented
  procedures and their statuses. Only update statuses when the CURRENT
  DOCUMENT provides new evidence of a status change.
"""

_OUTPUT_FORMAT = """
Output format (always follow this structure exactly):

**Prior State:**
[Relevant historical state from PREVIOUS SUMMARY. If PREVIOUS SUMMARY is
"NO PREVIOUS SUMMARY (NEW EVENT - BASELINE)" or "NO PREVIOUS SUMMARY",
write "None (baseline)".]

**Carried Forward (unchanged):**
[List any procedures/statuses from PREVIOUS SUMMARY that remain unchanged
and are NOT mentioned in the CURRENT DOCUMENT. If none, write "- None"]

**Current State:**
[Latest canonical state, incorporating BOTH prior and new information.
This should include ALL procedures: those carried forward AND those updated.]

**Changes:**
- [Entity] | [CHANGE_TYPE] | [OLD] → [NEW]
(One line per changed entity. If nothing changed, write "- None")

**Data Quality / Unresolved Conflict:**
[Only include content here when there is a genuine conflict or
ambiguity; otherwise write "None"]

**Overall:**
[Brief 1-2 sentence summary of the current state]
"""

_MEDICATION_PROMPT = f"""
You are generating a longitudinal clinical summary for MEDICATION_SUMMARY.

Track medication state and medication changes explicitly. For each
medication, track its current status and any change since the previous
summary.

Required status/change concepts (use these labels for CHANGE_TYPE):
NEW, STARTED, CONTINUED, DOSE_INCREASED, DOSE_DECREASED, DOSE_CHANGED,
FREQUENCY_CHANGED, ROUTE_CHANGED, HELD, RESUMED, STOPPED, DISCONTINUED,
COMPLETED, PLANNED, ORDERED, ADMINISTERED, NOT_ADMINISTERED, UNKNOWN,
CONFLICT.

Important rules:
- Actual administration is stronger evidence than a plan or an order.
- Absence of a medication from the CURRENT DOCUMENT does NOT mean it
  was STOPPED — only mark STOPPED/DISCONTINUED when the document
  explicitly says so.
- Do not infer a chemotherapy cycle transition (e.g. do not assume
  Cycle 2 was administered just because Cycle 1 was administered).
- If cycle or dosing information conflicts across documents, flag it
  explicitly as CONFLICT in "Data Quality / Unresolved Conflict"
  rather than resolving it silently.
{_SHARED_RECONCILIATION_RULES}
{_OUTPUT_FORMAT}

PREVIOUS SUMMARY (same entity type, from prior encounter/document):
{{previous_text}}

CURRENT DOCUMENT:
{{document_text}}

DOCUMENT DATE:
{{document_date}}

Return only the final summary using the structure above. Do not output
JSON.
"""

_VITAL_PROMPT = f"""
You are generating a longitudinal clinical summary for VITAL_SUMMARY.

Track vital signs: BP, HR/pulse, RR, temperature, SpO2, height, weight,
BMI, and pain score. Compare genuinely new measurements against the
previous summary, and distinguish repeated/carry-forward values from
newly measured values.

Recommended change types (use these labels for CHANGE_TYPE):
NEW, INCREASED, DECREASED, STABLE, NORMALIZED, ABNORMAL, RESOLVED,
NO_CHANGE, CONFLICT.

Important rules:
- Only mark a vital as INCREASED/DECREASED/STABLE when the CURRENT
  DOCUMENT reports an actual new comparable measurement.
- A vital simply not mentioned again in the CURRENT DOCUMENT is not
  RESOLVED — carry it forward as-is from PREVIOUS SUMMARY.
- Flag conflicting readings for the same vital taken close in time as
  CONFLICT rather than silently picking one.
{_SHARED_RECONCILIATION_RULES}
{_OUTPUT_FORMAT}

PREVIOUS SUMMARY (same entity type, from prior encounter/document):
{{previous_text}}

CURRENT DOCUMENT:
{{document_text}}

DOCUMENT DATE:
{{document_date}}

Return only the final summary using the structure above. Do not output
JSON.
"""

_LAB_PROMPT = f"""
You are generating a longitudinal clinical summary for LAB_SUMMARY.

Track lab values: CBC, renal function, liver function tests,
electrolytes, and pathology/IHC markers.

Recommended change types (use these labels for CHANGE_TYPE):
NEW, INCREASED, DECREASED, STABLE, NORMALIZED, ABNORMAL, PENDING,
RESOLVED, NO_CHANGE, CONFLICT.

Important rules:
- ALWAYS carry forward established ER, PR, HER2, Ki-67, histology,
  grade, and any other previously documented pathology findings, even
  when the CURRENT DOCUMENT does not repeat them.
- Do NOT infer missing IHC/pathology markers that have never been
  documented.
- Keep pending test status (e.g. "results pending") until a result is
  actually reported.
- Compare current values with previous ones only when both are
  genuinely comparable (same parameter, same units).
{_SHARED_RECONCILIATION_RULES}
{_OUTPUT_FORMAT}

PREVIOUS SUMMARY (same entity type, from prior encounter/document):
{{previous_text}}

CURRENT DOCUMENT:
{{document_text}}

DOCUMENT DATE:
{{document_date}}

Return only the final summary using the structure above. Do not output
JSON.
"""

_IMAGING_PROMPT = f"""
You are generating a longitudinal clinical summary for IMAGING_SUMMARY.

Track modality (US, CT, MRI, PET-CT, X-ray, etc.), lesion/location,
measurements, SUVmax where applicable, new findings, progression,
regression, and stability.

Recommended change types (use these labels for CHANGE_TYPE):
NEW, STABLE, INCREASED, DECREASED, PROGRESSED, REGRESSED, RESOLVED,
NEW_FINDING, NO_CHANGE, CONFLICT.

Important rules:
- Only compare studies that are genuinely comparable (same lesion /
  region, same or compatible modality).
- Do not compare unrelated lesions or unrelated body regions as if
  they were the same finding.
- If two studies conflict about the same lesion (e.g. size reported
  differently for the same date), flag it as CONFLICT rather than
  silently choosing one value.
{_SHARED_RECONCILIATION_RULES}
{_OUTPUT_FORMAT}

PREVIOUS SUMMARY (same entity type, from prior encounter/document):
{{previous_text}}

CURRENT DOCUMENT:
{{document_text}}

DOCUMENT DATE:
{{document_date}}

Return only the final summary using the structure above. Do not output
JSON.
"""

_PROCEDURE_PROMPT = f"""
You are generating a longitudinal clinical summary for PROCEDURE_SUMMARY.

Track indication, procedure, date, result/outcome, complications, and
follow-up for each procedure (biopsy, surgery, chemotherapy session,
radiation session, etc.).

IMPORTANT CARRY-FORWARD RULES:
- You MUST preserve ALL procedure statuses from PREVIOUS SUMMARY, even when
  the CURRENT DOCUMENT does not mention them.
- For procedures NOT mentioned in CURRENT DOCUMENT, carry them forward as
  "Carried Forward (unchanged)" in the "Current State" section.
- Do NOT drop chemotherapy cycles, surgeries, biopsies, or any other procedures
  just because they are not mentioned in the new document.
- If a procedure was previously "COMPLETED" or "IN_PROGRESS", maintain that
  status unless the CURRENT DOCUMENT explicitly changes it.

Required status concepts (use these labels for CHANGE_TYPE):
PLANNED, SCHEDULED, STARTED, IN_PROGRESS, COMPLETED, CANCELLED,
DEFERRED, HELD, NOT_STARTED, UNKNOWN, CONFLICT.

Important rules:
- Never convert a PLANNED or SCHEDULED procedure into COMPLETED
  without explicit evidence in the CURRENT DOCUMENT that it actually
  happened.
- Track progression of a treatment plan explicitly where evidenced
  (e.g. "Step 1 COMPLETED → Step 2 PLANNED").
- If the CURRENT DOCUMENT and PREVIOUS SUMMARY disagree about a
  procedure's status, flag it as CONFLICT instead of guessing.
{_SHARED_RECONCILIATION_RULES}
{_OUTPUT_FORMAT}

PREVIOUS SUMMARY (same entity type, from prior encounter/document):
{{previous_text}}

CURRENT DOCUMENT:
{{document_text}}

DOCUMENT DATE:
{{document_date}}

Return only the final summary using the structure above. Do not output
JSON.
"""

_SYMPTOM_PROMPT = f"""
You are generating a longitudinal clinical summary for SYMPTOM_SUMMARY.

Track symptom, severity/grade, onset, duration, status, management, and
relationship to treatment when documented (e.g. a symptom occurring
after a specific medication or procedure).

Recommended change types (use these labels for CHANGE_TYPE):
NEW, PERSISTENT, IMPROVED, WORSENED, RESOLVED, RECURRENT, NO_CHANGE,
CONFLICT.

Important rules:
- Only mark IMPROVED/WORSENED/RESOLVED when the CURRENT DOCUMENT gives
  actual evidence of a change in that specific symptom.
- A symptom not mentioned again in the CURRENT DOCUMENT is not
  automatically RESOLVED — carry it forward as PERSISTENT/unchanged
  unless resolution is explicitly documented.
- Note temporal relationship to medications or procedures only when
  the document actually supports that link; do not infer causation.
{_SHARED_RECONCILIATION_RULES}
{_OUTPUT_FORMAT}

PREVIOUS SUMMARY (same entity type, from prior encounter/document):
{{previous_text}}

CURRENT DOCUMENT:
{{document_text}}

DOCUMENT DATE:
{{document_date}}

Return only the final summary using the structure above. Do not output
JSON.
"""

ENTITY_PROMPTS = {
    "MEDICATION_SUMMARY": _MEDICATION_PROMPT,
    "VITAL_SUMMARY": _VITAL_PROMPT,
    "LAB_SUMMARY": _LAB_PROMPT,
    "IMAGING_SUMMARY": _IMAGING_PROMPT,
    "PROCEDURE_SUMMARY": _PROCEDURE_PROMPT,
    "SYMPTOM_SUMMARY": _SYMPTOM_PROMPT,
}


class ClinicalTimelineEncounterMixin:
    """
    Encounter lifecycle (open/reuse/create/close-metadata) and
    per-encounter ClinicalSummary generation/storage.

    Depends on ClinicalTimelineBaseMixin for: self.driver,
    self.utc_now(), self._llm_json(), self.ALLOWED_SUMMARY_TYPES.
    """

    # ==========================================================
    # ENCOUNTER LIFECYCLE
    #
    # Encounter ID format:
    #
    #   enc_<patient_id>_1
    #   enc_<patient_id>_2
    #   enc_<patient_id>_3
    #
    # appointment_id is stored only as metadata. It is NEVER used
    # to create the encounter_id.
    #
    # Lifecycle:
    #
    #   existing OPEN encounter -> reuse it
    #   no OPEN encounter       -> create next numbered encounter
    #   Save button             -> close current OPEN encounter
    #                              AND run cross-encounter synthesis
    #                              for every entity type present on
    #                              that encounter
    #   next document           -> create next encounter
    # ==========================================================

    def get_or_create_encounter(
        self,
        event_id: str,
        patient_id: str,
        doctor_id: str,
        appointment_id: Optional[str],
        document_date: Optional[str],
        document_id: str,
    ) -> str:

        if not patient_id:
            raise ValueError("patient_id is required")

        if not doctor_id:
            raise ValueError("doctor_id is required")

        # ------------------------------------------------------
        # 1. Find the patient's current OPEN encounter.
        # Patient + doctor are the ownership boundary.
        # appointment_id is deliberately NOT used here.
        # ------------------------------------------------------
        find_open_query = """
        MATCH (p:Patient {patient_id: $patient_id})
              -[:HAS_ENCOUNTER]->
              (e:Encounter)

        WHERE
            e.patient_id = $patient_id
            AND e.doctor_id = $doctor_id
            AND coalesce(e.status, 'OPEN') = 'OPEN'

        RETURN
            e.encounter_id AS encounter_id

        ORDER BY
            coalesce(e.opened_at, e.created_at, '') DESC

        LIMIT 1
        """

        with self.driver.session() as session:
            record = (
                session.run(
                    find_open_query,
                    patient_id=patient_id,
                    doctor_id=doctor_id,
                )
                .single()
            )

        if record:
            encounter_id = record["encounter_id"]

            logger.info(
                "Using existing OPEN encounter: "
                "patient={} doctor={} encounter={}",
                patient_id,
                doctor_id,
                encounter_id,
            )

            # Keep metadata current, but DO NOT change the encounter ID.
            update_query = """
            MATCH (e:Encounter {encounter_id: $encounter_id})

            SET
                e.patient_id = $patient_id,
                e.doctor_id = $doctor_id,
                e.event_id = $event_id,
                e.last_document_id = $document_id,
                e.updated_at = $updated_at,
                e.encounter_date =
                    CASE
                        WHEN $document_date IS NOT NULL
                             AND $document_date <> ''
                        THEN $document_date
                        ELSE coalesce(
                            e.encounter_date,
                            date()
                        )
                    END,
                e.appointment_id =
                    CASE
                        WHEN $appointment_id IS NOT NULL
                             AND $appointment_id <> ''
                        THEN $appointment_id
                        ELSE coalesce(e.appointment_id, null)
                    END

            WITH e
            MATCH (ce:ClinicalEvent {event_id: $event_id})
            MERGE (ce)-[:HAS_ENCOUNTER]->(e)

            RETURN e.encounter_id AS encounter_id
            """

            with self.driver.session() as session:
                updated = (
                    session.run(
                        update_query,
                        encounter_id=encounter_id,
                        patient_id=patient_id,
                        doctor_id=doctor_id,
                        event_id=event_id,
                        document_id=document_id,
                        document_date=(
                            str(document_date)
                            if document_date
                            else None
                        ),
                        appointment_id=appointment_id,
                        updated_at=self.utc_now(),
                    )
                    .single()
                )

            if not updated:
                raise RuntimeError(
                    f"Failed to update OPEN encounter {encounter_id}"
                )

            return encounter_id

        # ------------------------------------------------------
        # 2. No OPEN encounter. Find the next encounter number.
        #
        # Supports both new numbered IDs and legacy encounter IDs.
        # ------------------------------------------------------
        next_number_query = """
        MATCH (p:Patient {patient_id: $patient_id})
              -[:HAS_ENCOUNTER]->
              (e:Encounter)

        WITH collect(
            CASE
                WHEN e.encounter_number IS NOT NULL
                THEN toInteger(e.encounter_number)
                ELSE 0
            END
        ) AS numbers

        RETURN
            CASE
                WHEN size(numbers) = 0
                THEN 1
                ELSE reduce(
                    maxNumber = 0,
                    n IN numbers |
                    CASE
                        WHEN n > maxNumber
                        THEN n
                        ELSE maxNumber
                    END
                ) + 1
            END AS next_number
        """

        with self.driver.session() as session:
            record = (
                session.run(
                    next_number_query,
                    patient_id=patient_id,
                )
                .single()
            )

        next_number = int(
            record["next_number"]
            if record and record["next_number"]
            else 1
        )

        # ------------------------------------------------------
        # 3. Create the NEW encounter ID.
        # NO appointment_id in this ID.
        # ------------------------------------------------------
        encounter_id = (
            f"enc_{patient_id}_{next_number}"
        )

        opened_at = self.utc_now()

        create_query = """
        MATCH (p:Patient {patient_id: $patient_id})

        MATCH (ce:ClinicalEvent {event_id: $event_id})

        WHERE
            coalesce(ce.patient_id, '') = $patient_id

        MATCH (d:Doctor {doctor_id: $doctor_id})

        CREATE (e:Encounter {
            encounter_id: $encounter_id,
            encounter_number: $encounter_number,
            patient_id: $patient_id,
            doctor_id: $doctor_id,
            event_id: $event_id,
            appointment_id: $appointment_id,
            encounter_date: CASE
                WHEN $document_date IS NOT NULL
                     AND $document_date <> ''
                THEN $document_date
                ELSE toString(date())
            END,
            status: 'OPEN',
            opened_at: $opened_at,
            closed_at: '',
            last_document_id: $document_id,
            created_at: $opened_at,
            updated_at: $opened_at
        })

        MERGE (p)-[:HAS_ENCOUNTER]->(e)
        MERGE (d)-[:HAS_ENCOUNTER]->(e)
        MERGE (ce)-[:HAS_ENCOUNTER]->(e)


        RETURN e.encounter_id AS encounter_id
        """

        with self.driver.session() as session:
            created = (
                session.run(
                    create_query,
                    patient_id=patient_id,
                    doctor_id=doctor_id,
                    event_id=event_id,
                    appointment_id=appointment_id,
                    document_date=(
                        str(document_date)
                        if document_date
                        else None
                    ),
                    document_id=document_id,
                    encounter_id=encounter_id,
                    encounter_number=next_number,
                    opened_at=opened_at,
                )
                .single()
            )

        if not created:
            raise RuntimeError(
                "Failed to create new encounter"
            )

        logger.info(
            "Created NEW OPEN encounter: "
            "patient={} doctor={} encounter={} number={}",
            patient_id,
            doctor_id,
            encounter_id,
            next_number,
        )

        return created["encounter_id"]

    # ----------------------------------------------------------
    # Backward-compatible wrapper.
    # Existing callers can continue calling
    # create_or_update_encounter().
    # ----------------------------------------------------------

    def create_or_update_encounter(
        self,
        event_id: str,
        patient_id: str,
        doctor_id: str,
        appointment_id: Optional[str],
        document_date: Optional[str],
        document_id: str,
    ) -> str:

        return self.get_or_create_encounter(
            event_id=event_id,
            patient_id=patient_id,
            doctor_id=doctor_id,
            appointment_id=appointment_id,
            document_date=document_date,
            document_id=document_id,
        )

    # ==========================================================
    # GET PREVIOUS SUMMARY
    #
    # IMPORTANT:
    #
    # Patient boundary is explicitly enforced.
    # ==========================================================

    def get_previous_summary(
        self,
        patient_id: str,
        summary_type: str,
        exclude_encounter_id: Optional[str] = None
    ) -> Optional[str]:

        query = """
        MATCH (
            p:Patient {
                patient_id: $patient_id
            }
        )

        MATCH (
            p
        )-[:HAS_ENCOUNTER]->
        (e:Encounter)
        -[:HAS_SUMMARY]->
        (s:ClinicalSummary)

        WHERE
            e.patient_id = $patient_id
            AND properties(s)["summary_type"] = $summary_type
        """

        if exclude_encounter_id:

            query += """
            AND e.encounter_id <> $exclude_encounter_id
            """

        query += """
        RETURN
            properties(s)["summary"] AS summary,
            properties(e)["encounter_date"] AS encounter_date

        ORDER BY
            encounter_date DESC,
            coalesce(
                properties(s)["updated_at"],
                ""
            ) DESC

        LIMIT 1
        """

        with self.driver.session() as session:

            record = (
                session
                .run(
                    query,
                    patient_id=patient_id,
                    summary_type=summary_type,
                    exclude_encounter_id=exclude_encounter_id
                )
                .single()
            )

            if not record:
                return None

            return record["summary"]

    # ==========================================================
    # GET PREVIOUS SUMMARY FOR EVENT
    #
    # NEW METHOD: Get previous summary for a specific summary_type
    # within the SAME ClinicalEvent.
    # ==========================================================

    def get_previous_summary_for_event(
        self,
        patient_id: str,
        event_id: str,
        summary_type: str,
        exclude_encounter_id: Optional[str] = None
    ) -> Optional[Dict[str, str]]:
        """
        Get the previous summary AND its encounter_id for a specific summary_type 
        within the SAME ClinicalEvent.
        """
        
        query = """
        MATCH (p:Patient {patient_id: $patient_id})
        MATCH (ce:ClinicalEvent {event_id: $event_id})
            -[:HAS_ENCOUNTER]->
            (e:Encounter)
            -[:HAS_SUMMARY]->
            (s:ClinicalSummary)
        
        WHERE 
            s.summary_type = $summary_type
            AND s.event_id = $event_id
            AND e.encounter_id <> $exclude_encounter_id
        """
        
        # NO FILTER on is_baseline - we want ANY previous summary
        
        query += """
        RETURN 
            properties(s)["summary"] AS summary,
            properties(e)["encounter_id"] AS encounter_id,
            properties(e)["encounter_date"] AS encounter_date
        
        ORDER BY 
            encounter_date DESC,
            coalesce(properties(s)["updated_at"], "") DESC
        
        LIMIT 1
        """
        
        with self.driver.session() as session:
            record = (
                session
                .run(
                    query,
                    patient_id=patient_id,
                    event_id=event_id,
                    summary_type=summary_type,
                    exclude_encounter_id=exclude_encounter_id
                )
                .single()
            )
            
            if not record:
                logger.info(
                    "No previous summary found for type={} in event={}",
                    summary_type,
                    event_id
                )
                return None
            
            logger.info(
                "Found previous summary for type={} from encounter={}",
                summary_type,
                record["encounter_id"]
            )
            
            return {
                "summary": record["summary"],
                "encounter_id": record["encounter_id"],
                "encounter_date": record["encounter_date"],
            }

    # ==========================================================
    # GET EXISTING SUMMARY FOR ENCOUNTER TYPE
    #
    # NEW METHOD: Check if this encounter already has a summary for this type
    # ==========================================================

    def _get_existing_summary_for_encounter_type(
        self,
        encounter_id: str,
        summary_type: str
    ) -> Optional[Dict[str, str]]:
        """Get existing summary for this encounter and type"""
        
        query = """
        MATCH (e:Encounter {encounter_id: $encounter_id})
              -[:HAS_SUMMARY]->
              (s:ClinicalSummary)
        WHERE s.summary_type = $summary_type
        RETURN 
            properties(s)["summary"] AS summary,
            properties(s)["summary_date"] AS summary_date,
            properties(s)["updated_at"] AS updated_at
        """
        
        with self.driver.session() as session:
            record = session.run(
                query,
                encounter_id=encounter_id,
                summary_type=summary_type
            ).single()
            
        if not record:
            logger.info(
                "No existing summary found for encounter={}, type={}",
                encounter_id,
                summary_type
            )
            return None
        
        logger.info(
            "Found existing summary for encounter={}, type={}: {}",
            encounter_id,
            summary_type,
            record["summary"][:100] + "..." if len(record["summary"]) > 100 else record["summary"]
        )
        
        return {
            "summary": record["summary"],
            "summary_date": record["summary_date"],
            "updated_at": record["updated_at"],
        }

    # ==========================================================
    # COMPARE WITHIN ENCOUNTER
    #
    # UPDATED: now uses the same entity-specific prompt template
    # (ENTITY_PROMPTS) used by generate_summary(), instead of a
    # separate generic comparison prompt. This ensures an
    # encounter that already has a summary for a type is compared
    # with the same entity-specific change vocabulary and rules.
    # ==========================================================

    def _compare_within_encounter(
        self,
        existing_summary: str,
        new_document_text: str,
        summary_type: str,
        document_date: Optional[str]
    ) -> str:
        """
        Compare existing summary in the same encounter with new data,
        using the entity-specific prompt template for summary_type.
        """

        prompt_template = ENTITY_PROMPTS.get(summary_type)

        if not prompt_template:
            raise ValueError(
                f"Unsupported summary type: {summary_type}"
            )

        # Add context preservation for PROCEDURE_SUMMARY
        context_instruction = ""
        if summary_type == "PROCEDURE_SUMMARY":
            context_instruction = """
    CRITICAL INSTRUCTION FOR PROCEDURE SUMMARY:
    The PREVIOUS SUMMARY contains the COMPLETE procedure history for this patient.
    The CURRENT DOCUMENT may only contain NEW information about ONE procedure (e.g., surgery scheduling).
    You MUST preserve ALL procedures from the PREVIOUS SUMMARY that are not mentioned in the CURRENT DOCUMENT.
    This includes chemotherapy cycles, previous surgeries, biopsies, etc.
    Only update a procedure's status when the CURRENT DOCUMENT explicitly provides new evidence for THAT procedure.

    Example: If PREVIOUS SUMMARY shows "Cycle 1 COMPLETED, Cycle 2 PENDING" and CURRENT DOCUMENT only mentions "Surgery SCHEDULED", you must preserve both chemotherapy cycles AND add the surgery update.

    """
        
        prompt = prompt_template.format(
            previous_text=existing_summary,
            document_text=context_instruction + "\n\n" + new_document_text,
            document_date=document_date or "Unknown",
        )

        try:
            completion = (
                self.groq_client
                .chat
                .completions
                .create(
                    model="openai/gpt-oss-120b",
                    temperature=0.1,
                    max_tokens=5000,
                    messages=[
                        {
                            "role": "user",
                            "content": prompt
                        }
                    ],
                )
            )

            response = (
                completion
                .choices[0]
                .message
                .content
            )

            if not response:
                return existing_summary

            return response.strip()

        except Exception:
            logger.exception(
                "Failed comparing summary within encounter for {}",
                summary_type
            )
            return existing_summary

    # ==========================================================
    # EXTRACT DOCUMENT CLINICAL TYPES
    # ==========================================================

    def identify_summary_types(
        self,
        document_text: str
    ) -> List[str]:

        prompt = f"""
Identify which clinical event categories are actually present
in this medical document.

DOCUMENT:
{document_text}

Allowed categories:

VITAL_SUMMARY
LAB_SUMMARY
IMAGING_SUMMARY
MEDICATION_SUMMARY
PROCEDURE_SUMMARY
SYMPTOM_SUMMARY

Rules:

- Return only categories supported by the document.
- One document can contain multiple categories.
- Do not infer a category.
- If the document only contains vitals, return only VITAL_SUMMARY.
- Do not include clinical conditions here.

Return JSON:

{{
    "types": [
        "VITAL_SUMMARY"
    ]
}}
"""

        result = self._llm_json(
            prompt
        )

        types = result.get(
            "types",
            []
        )

        allowed = self.ALLOWED_SUMMARY_TYPES

        final_types = []

        for value in types:

            if not isinstance(
                value,
                str
            ):
                continue

            value = value.strip().upper()

            if (
                value in allowed
                and value not in final_types
            ):
                final_types.append(value)

        return final_types

    # ==========================================================
    # GENERATE SUMMARY
    #
    # UPDATED: Instead of building one generic prompt with a
    # small type_specific_instructions snippet, this now selects
    # a dedicated entity-specific prompt template from
    # ENTITY_PROMPTS based on summary_type. Each template defines
    # its own required fields and change-type vocabulary (e.g.
    # MEDICATION_SUMMARY tracks STOPPED/DOSE_CHANGED/etc, while
    # PROCEDURE_SUMMARY tracks PLANNED/COMPLETED/etc).
    #
    # is_new_event still controls whether previous summary context
    # is used, exactly as before.
    # ==========================================================

    def generate_summary(
        self,
        document_text: str,
        summary_type: str,
        previous_summary: Optional[str],
        document_date: Optional[str],
        is_new_event: bool = False,
    ) -> Optional[str]:

        # For NEW events, we don't use previous summary
        # This ensures clean baselines for new cases
        if is_new_event:
            previous_text = "NO PREVIOUS SUMMARY (NEW EVENT - BASELINE)"
        else:
            previous_text = (
                previous_summary
                if previous_summary
                else "NO PREVIOUS SUMMARY"
            )

        # ==========================================================
        # Select the entity-specific prompt template for this type.
        # ==========================================================

        prompt_template = ENTITY_PROMPTS.get(summary_type)

        if not prompt_template:
            raise ValueError(
                f"Unsupported summary type: {summary_type}"
            )

        prompt = prompt_template.format(
            previous_text=previous_text,
            document_text=document_text,
            document_date=document_date or "Unknown",
        )

        try:
            completion = (
                self.groq_client
                .chat
                .completions
                .create(
                    model="openai/gpt-oss-120b",
                    temperature=0.1,
                    max_tokens=5000,
                    messages=[
                        {
                            "role": "user",
                            "content": prompt
                        }
                    ],
                )
            )

            response = (
                completion
                .choices[0]
                .message
                .content
            )

            if not response:
                return None

            return response.strip()

        except Exception:
            logger.exception(
                "Failed generating summary for {}",
                summary_type
            )
            return None

    # ==========================================================
    # STORE SUMMARY
    #
    # One summary per:
    #
    # encounter + summary_type
    #
    # Multiple documents for same encounter update the same
    # summary node.
    # ==========================================================

    def store_summary(
        self,
        encounter_id: str,
        summary_type: str,
        summary: str,
        document_id: str,
        document_date: Optional[str],
        is_baseline: bool = False,
        event_id: Optional[str] = None,
    ) -> str:

        summary_id = (
            f"summary_{encounter_id}_"
            f"{summary_type.lower()}"
        )

        query = """
        MATCH (
            e:Encounter {
                encounter_id: $encounter_id
            }
        )

        MERGE (
            s:ClinicalSummary {
                summary_id: $summary_id
            }
        )

        SET
            s.summary_type = $summary_type,
            s.summary = $summary,
            s.document_id = $document_id,
            s.summary_date = $document_date,
            s.is_baseline = $is_baseline,
            s.event_id = $event_id,
            s.updated_at = $updated_at

        MERGE (
            e
        )-[:HAS_SUMMARY]->(s)

        RETURN s.summary_id AS summary_id
        """

        with self.driver.session() as session:

            session.run(
                query,
                encounter_id=encounter_id,
                summary_id=summary_id,
                summary_type=summary_type,
                summary=summary,
                document_id=document_id,
                document_date=(
                    str(document_date)
                    if document_date
                    else None
                ),
                is_baseline=is_baseline,
                event_id=event_id,
                updated_at=self.utc_now()
            ).consume()

        logger.info(
            "Stored {} for encounter {} (is_baseline={}, event={})",
            summary_type,
            encounter_id,
            is_baseline,
            event_id
        )

        return summary_id

    # ==========================================================
    # GET SUMMARIES ACTUALLY PRESENT ON ONE ENCOUNTER
    #
    # Used at close-time to know exactly which entity types this
    # encounter produced (across however many documents were added
    # to it while it was OPEN), so synthesis only runs for types
    # that are actually present.
    # ==========================================================

    def get_encounter_summary_entries(
        self,
        encounter_id: str,
    ) -> List[Dict[str, Any]]:

        query = """
        MATCH (e:Encounter {encounter_id: $encounter_id})
              -[:HAS_SUMMARY]->
              (s:ClinicalSummary)

        RETURN
            coalesce(s.summary_id, '') AS summary_id,
            coalesce(s.summary_type, '') AS summary_type,
            coalesce(s.summary, '') AS summary,
            coalesce(s.summary_date, '') AS summary_date,
            coalesce(s.is_baseline, false) AS is_baseline,
            coalesce(s.event_id, '') AS event_id
        """

        entries = []

        with self.driver.session() as session:

            records = session.run(
                query,
                encounter_id=encounter_id,
            )

            for record in records:

                data = dict(record)

                if not data.get("summary_type"):
                    continue

                if not data.get("summary"):
                    continue

                entries.append(data)

        return entries

    # ==========================================================
    # PROCESS ENCOUNTER SUMMARIES
    #
    # NOTE: this only produces/stores the per-encounter
    # ClinicalSummary snapshot for each type detected in THIS
    # document. It NEVER runs cross-encounter synthesis —
    # that happens once, for every type present, only when the
    # encounter is closed (see run_synthesis_for_encounter /
    # close_encounter). No synthesis LLM call is made from here.
    #
    # UNCHANGED from before (branching logic is the same). The
    # only change is that generate_summary() and
    # _compare_within_encounter(), called below, now use the
    # entity-specific ENTITY_PROMPTS templates internally.
    # ==========================================================

    def process_encounter_summaries(
        self,
        patient_id: str,
        encounter_id: str,
        document_text: str,
        document_id: str,
        document_date: Optional[str],
        is_new_event: bool = False,
        event_id: Optional[str] = None,
    ):

        summary_types = (
            self.identify_summary_types(
                document_text
            )
        )

        logger.info(
            "Detected summary types: {} (new_event={}, event_id={})",
            summary_types,
            is_new_event,
            event_id
        )

        results = []

        for summary_type in summary_types:

            # ==========================================================
            # STEP 1: Check if this encounter already has a summary for this type
            # ==========================================================
            existing_summary_data = self._get_existing_summary_for_encounter_type(
                encounter_id=encounter_id,
                summary_type=summary_type
            )
            
            existing_summary = existing_summary_data.get("summary") if existing_summary_data else None

            # ==========================================================
            # STEP 2: Get previous summary from PREVIOUS encounters (same event)
            # ==========================================================
            previous_encounter_summary = None
            is_baseline = True
            previous_encounter_id = None

            if is_new_event:
                # NEW event - baseline for ALL types
                logger.info(
                    "NEW event - skipping previous {} summary (clean baseline)",
                    summary_type
                )
            else:
                # EXISTING event - get previous summary from SAME event
                prev_data = self.get_previous_summary_for_event(
                    patient_id=patient_id,
                    event_id=event_id,
                    summary_type=summary_type,
                    exclude_encounter_id=encounter_id
                )
                
                if prev_data:
                    previous_encounter_summary = prev_data.get("summary")
                    previous_encounter_id = prev_data.get("encounter_id")
                    is_baseline = False  # ← NOT baseline
                    logger.info(
                        "Previous {} summary found in event {} from encounter {}",
                        summary_type,
                        event_id,
                        previous_encounter_id
                    )
                else:
                    # No previous summary found - this is the FIRST time for this type
                    previous_encounter_summary = None
                    previous_encounter_id = None
                    is_baseline = True  # ← Baseline for this type
                    logger.info(
                        "No previous {} summary found in event {} - creating baseline",
                        summary_type,
                        event_id
                    )

            # ==========================================================
            # STEP 3: Generate/update the summary
            # ==========================================================
            
            if existing_summary:
                # SAME encounter has existing summary → COMPARE with new data
                logger.info(
                    "Encounter {} already has {} summary, comparing WITHIN encounter",
                    encounter_id,
                    summary_type
                )
                
                summary = self._compare_within_encounter(
                    existing_summary=existing_summary,
                    new_document_text=document_text,
                    summary_type=summary_type,
                    document_date=document_date
                )
                
            elif previous_encounter_summary:
                # DIFFERENT encounter has previous summary → COMPARE ACROSS encounters
                logger.info(
                    "Previous {} summary found from encounter {}, comparing ACROSS encounters",
                    summary_type,
                    previous_encounter_id
                )
                
                summary = self.generate_summary(
                    document_text=document_text,
                    summary_type=summary_type,
                    previous_summary=previous_encounter_summary,
                    document_date=document_date,
                    is_new_event=False,
                )
                
            else:
                # No previous summary anywhere → CREATE BASELINE
                logger.info(
                    "No previous {} summary found, creating baseline",
                    summary_type
                )
                summary = self.generate_summary(
                    document_text=document_text,
                    summary_type=summary_type,
                    previous_summary=None,
                    document_date=document_date,
                    is_new_event=True,
                )

            if not summary:
                continue

            # ==========================================================
            # STEP 4: Store the summary
            # ==========================================================
            summary_id = self.store_summary(
                encounter_id=encounter_id,
                summary_type=summary_type,
                summary=summary,
                document_id=document_id,
                document_date=document_date,
                is_baseline=is_baseline,
                event_id=event_id,
            )

            results.append({
                "type": summary_type,
                "summary": summary,
                "document_id": document_id,
                "summary_id": summary_id,
                "summary_date": (
                    str(document_date)
                    if document_date
                    else ""
                ),
                "is_baseline": is_baseline,
                "event_id": event_id,
                "previous_encounter_id": previous_encounter_id,
                "updated_within_encounter": existing_summary is not None,
            })

        return results