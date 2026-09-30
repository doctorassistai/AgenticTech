# clinical_timeline_synthesis.py

from typing import Optional, Dict, List, Any

from loguru import logger


    # ==========================================================
    # TYPE-SPECIFIC REASONING GUIDANCE
    #
    # Same conceptual arc for every type — trend, clinical
    # significance, possible cause/hypothesis, decision context,
    # expected outcome/timeframe — but phrased around what
    # actually matters clinically for THAT entity type. Injected
    # into the shared prompt in generate_synthesis_reasoning().
    #
    # PROSE ONLY. No schema change, no new fields. This is
    # instruction text only.
    # ==========================================================






class ClinicalTimelineSynthesisMixin:
    """
    Cross-encounter synthesis (per entity type), the main
    process_document() orchestrator, timeline/synthesis reads,
    and close_encounter().

    Depends on ClinicalTimelineBaseMixin for: self.driver,
    self.groq_client, self.utc_now(), self.ensure_patient(),
    self.get_clinical_event(), self.identify_clinical_conditions(),
    self.create_or_update_clinical_event(),
    self.create_or_update_doctor(), self.normalize_condition(),
    self.ALLOWED_SUMMARY_TYPES,
    self.get_clinical_event_by_appointment(),
    self.find_or_create_event_for_appointment(),
    self.find_open_encounter_event_id(),
    self.event_has_summaries(),
    self.get_event_id_for_encounter().

    Depends on ClinicalTimelineEncounterMixin for:
    self.create_or_update_encounter(),
    self.process_encounter_summaries(),
    self.get_encounter_summary_entries(),
    self.get_previous_summary_for_event().
    """

    # ==========================================================
    # CLINICAL SYNTHESIS  (cross-encounter reasoning, per entity type)
    #
    # DESIGN / INVARIANTS:
    #
    # ClinicalSummary   -> one node per (encounter, summary_type).
    #                       Immutable snapshot of what THIS document /
    #                       encounter said. Synthesis logic below NEVER
    #                       edits this node.
    #
    # ClinicalSynthesis -> one node per (event_id, summary_type).
    #                       A running, cross-encounter "reasoning
    #                       thread" for exactly ONE entity type
    #                       (e.g. VITAL_SUMMARY). Each entity type is
    #                       its own isolated branch:
    #
    #                         - updating the VITAL_SUMMARY synthesis
    #                           never reads or writes LAB_SUMMARY's
    #                           synthesis, or any other type's.
    #                         - the reasoning text for a type is built
    #                           from that SAME type's prior reasoning
    #                           + this encounter's summary of that
    #                           type + (NEW) the OTHER summary types
    #                           present in this SAME encounter, passed
    #                           in purely as supporting context.
    #
    # TIMING:
    #
    #   Synthesis only runs once, when the encounter is CLOSED
    #   (Save button -> close_encounter()). See process_document() /
    #   process_encounter_summaries() — neither calls synthesis.
    #
    #   When the encounter is CLOSED:
    #     1. we look at exactly which summary_types ended up present
    #        on that encounter (get_encounter_summary_entries)
    #     2. for EACH type that is present (and only those — a type
    #        never touched in this encounter is skipped entirely),
    #        we run one synthesis step using:
    #           - that type's own prior reasoning thread
    #           - this encounter's final summary for that type
    #           - every OTHER type's current-encounter summary, as
    #             read-only supporting context
    #     3. each type's branch is updated independently; updating
    #        VITAL_SUMMARY's synthesis never reads/writes
    #        LAB_SUMMARY's synthesis, or any other type's. The LLM
    #        is explicitly instructed to reason only about the
    #        primary type and never produce reasoning for the
    #        context types.
    # ==========================================================
    SYNTHESIS_TYPE_GUIDANCE = {

        "VITAL_SUMMARY": """
    Focus on:
    - Whether the current reading is within a normal, borderline, or
    dangerous range for this parameter.
    - The direction and magnitude of change from the previous reasoning
    (improving, worsening, stable, or newly abnormal).
    - Whether the trend could plausibly relate to a current medication,
    a symptom, or another finding mentioned in this same encounter's
    other-type context — state this as a POSSIBILITY, not a proven
    cause.
    - What this trend would suggest checking or doing next (e.g.
    continued monitoring, dose review, further workup) and, if
    reasonable, a rough expectation for what the next reading should
    show.
    """,

            "LAB_SUMMARY": """
    Focus on:
    - Whether the value is within, above, or below the expected
    reference range, and the direction of change from the previous
    reasoning.
    - Whether this result corroborates, contradicts, or adds new
    information relative to a working diagnosis, symptom, or
    medication mentioned in this same encounter's other-type context.
    - A possible explanation for the trend, stated as a hypothesis, not
    a confirmed cause.
    - What this might trigger clinically (repeat testing, further
    investigation, treatment adjustment) and what result would be
    expected next, and roughly by when, if the current
    explanation/action is correct.
    """,

            "IMAGING_SUMMARY": """
    Focus on:
    - Whether this finding is new, or represents progression,
    regression, or stability compared to the previous reasoning.
    - The likely clinical relevance of the finding — what it supports,
    rules out, or leaves uncertain in relation to symptoms or other
    findings from this same encounter's other-type context.
    - Any plausible link to a diagnosis or treatment already in play,
    stated as a possibility, not a proven relationship.
    - What follow-up (repeat imaging, further workup, referral) this
    would reasonably prompt, and what the next imaging or clinical
    check would be expected to show if the current interpretation is
    correct.
    """,

            "MEDICATION_SUMMARY": """
    Focus on:
    - Whether the medication, dose, or regimen has changed since the
    previous reasoning (started, increased, reduced, held, switched,
    discontinued) and what changed in this encounter specifically.
    - Whether the change appears to be a response to something —a lab
    trend, a vital sign, or a symptom mentioned in this same
    encounter's other-type context — stated as a likely reason, not
    an asserted fact unless the document says so explicitly.
    - Any possible therapeutic benefit or adverse effect suggested by
    the surrounding clinical picture, stated cautiously.
    - What monitoring this warrants and what response is expected, and
    roughly within what timeframe, so it can be checked against the
    next encounter.
    """,

            "PROCEDURE_SUMMARY": """
    Focus on:
    - What the procedure was and, if stated, why it was performed
    (indication) relative to symptoms, findings, or diagnoses
    mentioned in this same encounter's other-type context.
    - The outcome or result, and whether it confirmed, ruled out, or
    left uncertain a suspected condition.
    - Any complications or follow-up actions triggered by the result.
    - What is expected to happen next as a result of this procedure
    (further treatment, monitoring, resolution) and by when.
    """,

            "SYMPTOM_SUMMARY": """
    Focus on:
    - Whether this symptom is new, worsening, improving, or persisting
    compared to the previous reasoning.
    - Its timing relative to any medication change, procedure, or other
    finding mentioned in this same encounter's other-type context —
    note a plausible temporal relationship without asserting causality
    unless it is explicitly stated in the source.
    - The likely clinical significance of the symptom in this context.
    - What this would reasonably prompt (monitoring, investigation,
    treatment adjustment) and what change would be expected by the
    next encounter if the current explanation is correct.
    """,

    }


    @staticmethod
    def _synthesis_id(
        encounter_id: str,
        summary_type: str
    ) -> str:
        """Create synthesis ID scoped to a specific ENCOUNTER.
        One immutable ClinicalSynthesis snapshot per (encounter, type) —
        closing a later encounter never overwrites an earlier one."""
        return f"synth_{encounter_id}_{summary_type.lower()}"

    def get_previous_synthesis_for_type(
        self,
        patient_id: str,
        event_id: str,
        summary_type: str,
        exclude_encounter_id: str,
    ) -> Optional[Dict[str, Any]]:
        """
        Fetch the most recent PRIOR CLOSED encounter's ClinicalSynthesis
        reasoning for this (event_id, summary_type), excluding the
        encounter currently being closed.

        Returns None if no prior synthesis exists for this type yet
        (i.e. this is the first encounter to produce this type) —
        that None is exactly your "initially null" baseline case.
        """

        query = """
        MATCH (p:Patient {patient_id: $patient_id})
            -[:HAS_ENCOUNTER]->(e:Encounter)
            -[:HAS_SUMMARY]->(s:ClinicalSummary)
        
        WHERE e.patient_id = $patient_id
        AND e.status = 'CLOSED'
        AND e.encounter_id <> $exclude_encounter_id
        AND s.summary_type = $summary_type
        AND s.event_id = $event_id

        // Get the ClinicalSynthesis for this summary type from that encounter
        MATCH (s)-[:DERIVED_FROM]-(cs:ClinicalSynthesis)
        WHERE cs.summary_type = $summary_type
        AND cs.event_id = $event_id

        RETURN
            cs.reasoning AS reasoning,
            cs.encounter_id AS encounter_id,
            coalesce(cs.encounter_count, 0) AS encounter_count,
            e.encounter_date AS encounter_date

        ORDER BY
            e.encounter_date DESC,
            e.closed_at DESC,
            e.encounter_id DESC

        LIMIT 1
        """

        with self.driver.session() as session:
            record = session.run(
                query,
                patient_id=patient_id,
                event_id=event_id,
                summary_type=summary_type,
                exclude_encounter_id=exclude_encounter_id,
            ).single()

        if not record:
            logger.info(
                "No previous CLOSED synthesis found for type={} event={} — baseline",
                summary_type,
                event_id,
            )
            return None

        return dict(record)

    def generate_synthesis_reasoning(
        self,
        summary_type: str,
        current_summary: str,
        previous_reasoning: Optional[str],
        document_date: Optional[str],
        other_current_summaries: Optional[List[Dict[str, str]]] = None,
    ) -> Optional[str]:
        """
        Cross-encounter reasoning for a SINGLE entity type only.

        Inputs:
          - current_summary: this encounter's ClinicalSummary for this type
          - previous_reasoning: the PRIOR encounter's synthesis reasoning
            for this same type (None if this is the first encounter to
            produce this type — baseline case)
          - other_current_summaries: OTHER types present on THIS SAME
            encounter, passed in purely as read-only supporting context
        """

        has_previous_reasoning = bool(
            previous_reasoning and previous_reasoning.strip()
        )

        if has_previous_reasoning:
            reasoning_context = f"""
PREVIOUS {summary_type} REASONING (from the prior encounter):
{previous_reasoning}

CURRENT {summary_type} (this encounter):
{current_summary}

Instructions:
1. Compare the current summary against the previous reasoning above
2. Identify what has changed: improved, worsened, stable, or new finding
3. EXTEND the previous reasoning with the new information —
   do not repeat the exact same text
4. Maintain continuity of the clinical story
"""
        else:
            reasoning_context = f"""
CURRENT {summary_type} (this encounter):
{current_summary}

No previous reasoning exists for this type yet.

Instructions:
1. This is the first {summary_type} reasoning for this event
2. Create a baseline reasoning statement
3. Do NOT say "unchanged", "improved", or "worsened" (no previous data)
"""

        other_summaries = other_current_summaries or []

        if other_summaries:
            other_context_blocks = []
            for other in other_summaries:
                other_type = other.get("type", "") or "UNKNOWN_TYPE"
                other_text = other.get("summary", "") or ""
                if not other_text.strip():
                    continue
                other_context_blocks.append(f"{other_type}:\n{other_text}")
            other_context_text = (
                "\n\n".join(other_context_blocks)
                if other_context_blocks
                else "NONE"
            )
        else:
            other_context_text = "NONE"

        type_guidance = self.SYNTHESIS_TYPE_GUIDANCE.get(
            summary_type,
            "",
        )

        prompt = f"""
You are maintaining a longitudinal clinical reasoning thread for a
SINGLE PRIMARY entity type: {summary_type}.

PRIMARY ENTITY: {summary_type}

{reasoning_context}

OTHER CURRENT ENCOUNTER CONTEXT (same encounter, other entity types):
{other_context_text}

DOCUMENT DATE:
{document_date or "Unknown"}

TYPE-SPECIFIC GUIDANCE FOR {summary_type}:
{type_guidance}

General instructions:

1. Reason ONLY about the PRIMARY entity: {summary_type}. Other-type
   context above is background only — do not produce reasoning FOR
   those other types.

2. If PREVIOUS REASONING exists, EXTEND it — compare, note
   progression, and check whether anything it anticipated (an
   expected change, an expected result) is now confirmed,
   contradicted, or still pending. Do NOT repeat the exact same text.

3. If no PREVIOUS REASONING exists, create a baseline statement
   using the type-specific guidance above. Do NOT say "unchanged",
   "improved", or "worsened" — there is no previous data to compare.

4. State any suspected cause or relationship as a POSSIBILITY or
   HYPOTHESIS, never as a proven or confirmed fact, unless the
   source material explicitly states the causal link.

5. Only use information present in the current summary, the
   previous reasoning, or the other-type context above. Do not
   invent values, dates, or findings.

6. Write 3-5 sentences of connected clinical prose (not a list, not
   labeled sections) — trend, significance, and, where reasonable,
   what would be expected next and roughly when.

7. Return only the reasoning text for {summary_type}. No JSON, no
   headers, no markdown, no bullet points.
"""

        try:
            completion = (
                self.groq_client
                .chat
                .completions
                .create(
                    model="openai/gpt-oss-120b",
                    temperature=0.1,
                    max_tokens=5000,
                    messages=[{"role": "user", "content": prompt}],
                )
            )
            response = completion.choices[0].message.content
            if not response:
                return None
            return response.strip()

        except Exception:
            logger.exception(
                "Failed generating synthesis reasoning for {}",
                summary_type
            )
            return None

    def store_synthesis_reasoning(
        self,
        patient_id: str,
        event_id: str,
        summary_type: str,
        reasoning: str,
        encounter_id: str,
        summary_id: str,
        encounter_count: int,
    ) -> str:
        """
        Creates a NEW, immutable ClinicalSynthesis node scoped to THIS
        encounter. Closing a later encounter NEVER touches or overwrites
        an earlier encounter's synthesis node for the same type — each
        encounter keeps its own permanent snapshot, exactly like
        ClinicalSummary does.
        """

        synthesis_id = self._synthesis_id(
            encounter_id,
            summary_type
        )

        query = """
        MATCH (p:Patient {patient_id: $patient_id})
        MATCH (s:ClinicalSummary {summary_id: $summary_id})

        MERGE (p)-[:HAS_SYNTHESIS]->(
            cs:ClinicalSynthesis {
                synthesis_id: $synthesis_id
            }
        )

        SET
            cs.patient_id = $patient_id,
            cs.event_id = $event_id,
            cs.summary_type = $summary_type,
            cs.encounter_id = $encounter_id,
            cs.reasoning = $reasoning,
            cs.encounter_count = $encounter_count,
            cs.last_encounter_id = $encounter_id,
            cs.updated_at = $updated_at,
            cs.created_at = coalesce(cs.created_at, $updated_at)

        MERGE (cs)-[:DERIVED_FROM]->(s)

        RETURN cs.synthesis_id AS synthesis_id
        """

        with self.driver.session() as session:

            record = session.run(
                query,
                patient_id=patient_id,
                event_id=event_id,
                synthesis_id=synthesis_id,
                summary_type=summary_type,
                encounter_id=encounter_id,
                summary_id=summary_id,
                reasoning=reasoning,
                encounter_count=encounter_count,
                updated_at=self.utc_now(),
            ).single()

        logger.info(
            "Synthesis stored (own snapshot): patient={}, event={}, type={}, encounter={}, encounter_count={}",
            patient_id,
            event_id,
            summary_type,
            encounter_id,
            encounter_count,
        )

        return (
            record["synthesis_id"]
            if record
            else synthesis_id
        )

    def update_synthesis_for_type(
        self,
        patient_id: str,
        event_id: str,
        summary_type: str,
        encounter_id: str,
        summary_id: str,
        current_summary: str,
        document_date: Optional[str],
        other_current_summaries: Optional[List[Dict[str, str]]] = None,
    ) -> Optional[Dict[str, Any]]:
        """
        Runs one full synthesis step for ONE entity type: look up the
        PRIOR CLOSED encounter's synthesis for this type (if any), reason over
        it + this encounter's summary + other same-encounter context,
        then persist as a brand-new snapshot for THIS encounter.
        """

        previous = self.get_previous_synthesis_for_type(
            patient_id=patient_id,
            event_id=event_id,
            summary_type=summary_type,
            exclude_encounter_id=encounter_id,
        )

        previous_reasoning = previous.get("reasoning") if previous else None
        previous_encounter_id = previous.get("encounter_id") if previous else None
        
        # ✅ encounter_count = number of CLOSED encounters with this type
        encounter_count = (
            (previous.get("encounter_count") or 0) + 1
            if previous
            else 1
        )

        reasoning = self.generate_synthesis_reasoning(
            summary_type=summary_type,
            current_summary=current_summary,
            previous_reasoning=previous_reasoning,
            document_date=document_date,
            other_current_summaries=other_current_summaries,
        )

        if not reasoning:
            return None

        synthesis_id = self.store_synthesis_reasoning(
            patient_id=patient_id,
            event_id=event_id,
            summary_type=summary_type,
            reasoning=reasoning,
            encounter_id=encounter_id,
            summary_id=summary_id,
            encounter_count=encounter_count,
        )

        return {
            "synthesis_id": synthesis_id,
            "summary_type": summary_type,
            "reasoning": reasoning,
            "encounter_count": encounter_count,
            "last_encounter_id": encounter_id,
            "is_baseline": previous is None,
            "previous_encounter_id": previous_encounter_id,
        }

    # ==========================================================
    # RUN SYNTHESIS FOR ONE ENCOUNTER (all types present, only
    # those present)
    #
    # Called by close_encounter(). Iterates over every entity type
    # that actually has a ClinicalSummary on this encounter, and
    # runs one isolated synthesis step per type — passing every
    # OTHER present type's current-encounter summary in as
    # supporting context. A type never touched by this encounter is
    # skipped entirely — its synthesis branch is left untouched.
    # ==========================================================

    def run_synthesis_for_encounter(
        self,
        patient_id: str,
        encounter_id: str,
    ) -> List[Dict[str, Any]]:

        # ✅ VERIFY encounter is actually CLOSED
        verify_query = """
        MATCH (e:Encounter {encounter_id: $encounter_id})
        WHERE e.status = 'CLOSED'
        RETURN e.status AS status
        """
        
        with self.driver.session() as session:
            record = session.run(verify_query, encounter_id=encounter_id).single()
        
        if not record:
            logger.warning(
                "Synthesis skipped: encounter {} is not closed (status: OPEN or not found)",
                encounter_id
            )
            return []

        # ✅ Get event_id for this encounter
        event_id = self.get_event_id_for_encounter(encounter_id)
        
        if not event_id:
            logger.warning(
                "No event_id found for encounter {}, skipping synthesis",
                encounter_id
            )
            return []

        # Get all summaries for this encounter
        entries = self.get_encounter_summary_entries(
            encounter_id=encounter_id,
        )

        if not entries:
            logger.info(
                "No summaries present on encounter {} — skipping synthesis entirely",
                encounter_id,
            )
            return []

        present_types = [
            entry["summary_type"]
            for entry in entries
        ]

        logger.info(
            "Entity types found on encounter {} for event {}: {}",
            encounter_id,
            event_id,
            present_types,
        )

        # Log skipped types
        skipped_types = sorted(
            self.ALLOWED_SUMMARY_TYPES - set(present_types)
        )

        for skipped_type in skipped_types:
            logger.info(
                "Synthesis skipped for {} — not present on encounter {}",
                skipped_type,
                encounter_id,
            )

        results = []

        for entry in entries:

            summary_type = entry["summary_type"]
            summary_id = entry["summary_id"]
            current_summary = entry["summary"]
            summary_date = entry.get("summary_date") or None

            # Every OTHER type present on this SAME encounter becomes read-only
            # supporting context for this primary type's synthesis call.
            other_current_summaries = [
                {
                    "type": other["summary_type"],
                    "summary": other["summary"],
                }
                for other in entries
                if other["summary_type"] != summary_type
            ]

            logger.info(
                "Synthesis for {}: encounter={}, event={}, context_types={}",
                summary_type,
                encounter_id,
                event_id,
                [o["type"] for o in other_current_summaries],
            )

            synthesis = self.update_synthesis_for_type(
                patient_id=patient_id,
                event_id=event_id,
                summary_type=summary_type,
                encounter_id=encounter_id,
                summary_id=summary_id,
                current_summary=current_summary,
                document_date=summary_date,
                other_current_summaries=other_current_summaries,
            )

            if not synthesis:
                logger.warning(
                    "Synthesis failed for type={} encounter={} event={}",
                    summary_type,
                    encounter_id,
                    event_id,
                )
                continue

            logger.info(
                "Synthesis completed for {} (encounter={}, event={}, encounter_count={})",
                summary_type,
                encounter_id,
                event_id,
                synthesis.get("encounter_count", 0),
            )

            results.append(synthesis)

        logger.info(
            "Synthesis complete on close: patient={} encounter={} event={} types={}",
            patient_id,
            encounter_id,
            event_id,
            [r["summary_type"] for r in results],
        )

        return results

    # ==========================================================
    # MAIN DOCUMENT PROCESSOR
    #
    # UPDATED: Handles appointment vs non-appointment documents
    # correctly. Conditions are extracted ONLY from non-appointment
    # documents (vitals, labs, etc.). Appointment documents only
    # find/create events based on chief complaint matching.
    # ==========================================================

    def process_document(
        self,
        patient_id: str,
        doctor_id: str,
        doctor_name: str,
        doctor_specialty: str,
        appointment_id: Optional[str],
        document_id: str,
        document_text: str,
        document_date: Optional[str],
        document_name: Optional[str] = None,
        clinical_event_id: Optional[str] = None,
    ) -> Dict[str, Any]:

        self.ensure_patient(patient_id=patient_id)
        self.update_patient_profile(
            patient_id=patient_id,
            document_text=document_text,
            document_id=document_id,
            document_date=document_date,
        )

        # Initialize variables
        event_id = None
        new_conditions = []
        is_new_event = False

        # ==========================================================
        # LOG THE INPUT
        # ==========================================================
        logger.info(
            "process_document called: patient={}, doctor={}, appointment_id={}, document_name={}, document_id={}",
            patient_id,
            doctor_id,
            appointment_id,
            document_name,
            document_id
        )

        # ==========================================================
        # DETERMINE EVENT_ID BASED ON DOCUMENT TYPE
        # ==========================================================

        if document_name == "appointment":
            # APPOINTMENT document - find or create event

            if clinical_event_id:
                event_id = clinical_event_id
                is_new_event = not self.event_has_summaries(event_id)
                logger.info(
                    "APPOINTMENT document with provided event_id: event_id={}, is_new_event={}",
                    event_id,
                    is_new_event
                )
            else:
                event_id = self.find_or_create_event_for_appointment(
                    patient_id=patient_id,
                    appointment_id=appointment_id,
                    document_text=document_text,
                    document_date=document_date,
                    doctor_id=doctor_id,
                )
                is_new_event = not self.event_has_summaries(event_id)
                logger.info(
                    "APPOINTMENT document: event_id={}, is_new_event={}, appointment_id={}",
                    event_id,
                    is_new_event,
                    appointment_id
                )

            # IMPORTANT: DO NOT extract conditions from appointment document
            new_conditions = []

        else:
            # NON-APPOINTMENT documents (clinical_note, dictation, vitals, labs, etc.)
            
            # ==========================================================
            # STEP 1: ALWAYS check for existing event by appointment_id FIRST
            # This is the primary key for case matching
            # ==========================================================
            
            if appointment_id:
                # Check if ANY event exists for this appointment (regardless of doctor)
                event_data = self.get_clinical_event_by_appointment(
                    patient_id=patient_id,
                    appointment_id=appointment_id,
                    doctor_id=doctor_id,  # Pass but not used in query
                )
                
                if event_data:
                    event_id = event_data["event_id"]
                    is_new_event = not self.event_has_summaries(event_id)
                    logger.info(
                        "NON-APPOINTMENT document: Found existing event for appointment_id={}: event_id={}, is_new_event={}",
                        appointment_id,
                        event_id,
                        is_new_event
                    )
                else:
                    # No event for this appointment yet - create one
                    event_id = self.create_new_clinical_event(
                        patient_id=patient_id,
                        conditions=[],
                        appointment_id=appointment_id,
                        document_date=document_date
                    )
                    is_new_event = True
                    logger.info(
                        "NON-APPOINTMENT document: Created new event for appointment_id={}: event_id={}",
                        appointment_id,
                        event_id
                    )
            else:
                # No appointment_id - use existing logic
                if clinical_event_id:
                    event_id = clinical_event_id
                    is_new_event = False
                    logger.info(
                        "NON-APPOINTMENT document with provided event_id: event_id={}",
                        event_id
                    )
                else:
                    # Find open encounter or create new
                    event_id = self.find_open_encounter_event_id(
                        patient_id=patient_id,
                        doctor_id=doctor_id
                    )
                    
                    if event_id:
                        is_new_event = not self.event_has_summaries(event_id)
                        logger.info(
                            "NON-APPOINTMENT document: found OPEN encounter event_id={}",
                            event_id
                        )
                    else:
                        event_id = self.create_new_clinical_event(
                            patient_id=patient_id,
                            conditions=[],
                            document_date=document_date
                        )
                        is_new_event = True
                        logger.info(
                            "NON-APPOINTMENT document: No OPEN encounter found, created new event_id={}",
                            event_id
                        )
            
            # ==========================================================
            # STEP 2: EXTRACT CONDITIONS FROM DOCUMENTS THAT SUPPORT IT
            # Only extract from clinical_note, dictation, doctor_plan, procedure_note
            # Do NOT extract from vitals, lab_reports, or appointment
            # ==========================================================

            CONDITION_DOCS = ["clinical_note", "dictation", "doctor_plan", "procedure_note"]

            if event_id and document_name in CONDITION_DOCS:
                # Get existing conditions for this event
                current_conditions = ""
                events = self.get_all_clinical_events(patient_id)
                for e in events:
                    if e["event_id"] == event_id:
                        current_conditions = e.get("conditions", "")
                        break
                
                new_conditions = self.identify_clinical_conditions(
                    document_text=document_text,
                    existing_conditions=current_conditions,
                )

                if new_conditions:
                    event_id = self.update_clinical_event_conditions(
                        patient_id=patient_id,
                        event_id=event_id,
                        conditions=new_conditions,
                    )
                    logger.info(
                        "Updated conditions for event_id={}: {}",
                        event_id,
                        new_conditions
                    )
                else:
                    logger.info(
                        "No new conditions extracted from {} document",
                        document_name
                    )
            else:
                new_conditions = []
                logger.info(
                    "Skipping condition extraction for document_type={}",
                    document_name
                )
            logger.info(
                "NON-APPOINTMENT document: event_id={}, is_new_event={}, conditions={}",
                event_id,
                is_new_event,
                new_conditions
            )

        # ------------------------------------------------------
        # DOCTOR
        # ------------------------------------------------------

        if event_id:
            self.create_or_update_doctor(
                event_id=event_id,
                doctor_id=doctor_id,
                doctor_name=doctor_name,
                doctor_specialty=doctor_specialty
            )
        else:
            logger.error(
                "No event_id available for doctor connection: patient={}, document={}",
                patient_id,
                document_name
            )

        # ------------------------------------------------------
        # ENCOUNTER
        # ------------------------------------------------------

        if event_id:
            encounter_id = self.create_or_update_encounter(
                event_id=event_id,
                patient_id=patient_id,
                doctor_id=doctor_id,
                appointment_id=appointment_id,
                document_date=document_date,
                document_id=document_id
            )
        else:
            logger.error(
                "Cannot create encounter without event_id: patient={}, document={}",
                patient_id,
                document_name
            )
            event_id = self.create_new_clinical_event(
                patient_id=patient_id,
                conditions=[],
                appointment_id=appointment_id,
                document_date=document_date
            )
            encounter_id = self.create_or_update_encounter(
                event_id=event_id,
                patient_id=patient_id,
                doctor_id=doctor_id,
                appointment_id=appointment_id,
                document_date=document_date,
                document_id=document_id
            )
            is_new_event = True

        # ------------------------------------------------------
        # SUMMARIES
        #
        # IMPORTANT: Pass event_id so summaries can be compared
        # within the same event.
        # ------------------------------------------------------

        summaries = self.process_encounter_summaries(
            patient_id=patient_id,
            encounter_id=encounter_id,
            document_text=document_text,
            document_id=document_id,
            document_date=document_date,
            is_new_event=is_new_event,
            event_id=event_id,
        )

        logger.info(
            "Clinical timeline graph updated: "
            "patient={}, event={}, doctor={}, encounter={}, is_new_event={}",
            patient_id,
            event_id,
            doctor_id,
            encounter_id,
            is_new_event
        )

        return {
            "event_id": event_id,
            "encounter_id": encounter_id,
            "appointment_id": appointment_id,
            "encounter_date": document_date,
            "new_conditions": new_conditions,
            "summaries": summaries,
            "is_new_event": is_new_event,
        }

    # ==========================================================
    # GET COMPLETE PATIENT TIMELINE
    #
    # CRITICAL PATIENT ISOLATION:
    #
    # Patient -> Encounter is the ownership boundary.
    # Doctor is global/shared and is NEVER used to decide which
    # patient's encounters are returned.
    #
    # ONE ROW = ONE ENCOUNTER
    #
    # Multiple summaries are collected into that encounter.
    # ==========================================================

    def get_patient_clinical_timeline(
        self,
        patient_id: str,
        appointment_id: Optional[str] = None,
    ) -> List[Dict[str, Any]]:

        logger.info(
            "Fetching clinical timeline "
            "patient={} appointment={}",
            patient_id,
            appointment_id,
        )

        query = """
        // =========================================================
        // PATIENT IS THE OWNERSHIP BOUNDARY
        // =========================================================

        MATCH (
            p:Patient {
                patient_id: $patient_id
            }
        )

        // =========================================================
        // GET ALL ENCOUNTERS BELONGING TO THIS PATIENT
        // =========================================================

        MATCH (
            p
        )-[:HAS_ENCOUNTER]->
        (e:Encounter)

        WHERE
            e.patient_id = $patient_id

            AND (
                $appointment_id IS NULL
                OR e.appointment_id = $appointment_id
            )

        // =========================================================
        // GET CLINICAL EVENT FOR THIS ENCOUNTER
        // =========================================================

        OPTIONAL MATCH (
            ce:ClinicalEvent {
                event_id: e.event_id,
                patient_id: $patient_id
            }
        )

        // =========================================================
        // GET DOCTOR FROM THIS ENCOUNTER
        // =========================================================

        OPTIONAL MATCH (
            d:Doctor {
                doctor_id: e.doctor_id
            }
        )

        // =========================================================
        // GET SUMMARIES CONNECTED TO THIS ENCOUNTER
        // =========================================================

        OPTIONAL MATCH (
            e
        )-[:HAS_SUMMARY]->
        (s:ClinicalSummary)

        // =========================================================
        // GET PATIENT-LEVEL CLINICAL SYNTHESIS
        //
        // ClinicalSynthesis is longitudinal and belongs to
        // the patient + summary_type.
        //
        // We retrieve it through Patient -> HAS_SYNTHESIS.
        // =========================================================

        OPTIONAL MATCH (
            p
        )-[:HAS_SYNTHESIS]->
        (cs:ClinicalSynthesis)

        WHERE
            coalesce(
                properties(cs)["patient_id"],
                ''
            ) = $patient_id
            AND coalesce(
                properties(cs)["event_id"],
                ''
            ) = coalesce(
                properties(ce)["event_id"],
                properties(e)["event_id"],
                ''
            )

        // =========================================================
        // GROUP DATA BY ENCOUNTER
        // =========================================================

        WITH
            p,
            e,
            ce,
            d,
            collect(DISTINCT {
                summary_id: coalesce(s.summary_id, ''),
                type: coalesce(s.summary_type, ''),
                summary: coalesce(s.summary, ''),
                summary_date: coalesce(s.summary_date, ''),
                document_id: coalesce(s.document_id, ''),
                is_baseline: coalesce(s.is_baseline, false),
                event_id: coalesce(s.event_id, '')
            }) AS summary_list,
            collect(DISTINCT {
                type: coalesce(cs.summary_type, ''),
                reasoning: coalesce(cs.reasoning, ''),
                encounter_count: coalesce(cs.encounter_count, 0),
                last_encounter_id: coalesce(cs.last_encounter_id, ''),
                created_at: coalesce(cs.created_at, ''),
                updated_at: coalesce(cs.updated_at, '')
            }) AS synthesis_list

        // =========================================================
        // RETURN ONE RECORD PER ENCOUNTER
        // =========================================================

        RETURN

            // =====================================================
            // CLINICAL EVENT
            // =====================================================

            coalesce(
                properties(ce)["event_id"],
                properties(e)["event_id"],
                ''
            ) AS event_id,

            coalesce(
                properties(ce)["conditions"],
                ''
            ) AS conditions,

            // =====================================================
            // DOCTOR
            // =====================================================

            coalesce(
                properties(e)["doctor_id"],
                properties(d)["doctor_id"],
                ''
            ) AS doctor_id,

            coalesce(
                properties(d)["name"],
                ''
            ) AS doctor_name,

            coalesce(
                properties(d)["specialty"],
                ''
            ) AS doctor_specialty,

            // =====================================================
            // ENCOUNTER
            // =====================================================

            coalesce(
                properties(e)["encounter_id"],
                ''
            ) AS encounter_id,

            coalesce(
                properties(e)["status"],
                'OPEN'
            ) AS encounter_status,

            coalesce(
                properties(e)["opened_at"],
                ''
            ) AS encounter_opened_at,

            coalesce(
                properties(e)["closed_at"],
                ''
            ) AS encounter_closed_at,

            // =====================================================
            // PATIENT
            // =====================================================

            coalesce(
                properties(e)["patient_id"],
                ''
            ) AS patient_id,

            // =====================================================
            // APPOINTMENT
            // =====================================================

            coalesce(
                properties(e)["appointment_id"],
                ''
            ) AS appointment_id,

            // =====================================================
            // DATE
            // =====================================================

            coalesce(
                toString(
                    properties(e)["encounter_date"]
                ),
                ''
            ) AS encounter_date,

            // =====================================================
            // SUMMARIES
            // =====================================================

            summary_list AS summaries,

            // =====================================================
            // CLINICAL SYNTHESIS
            // =====================================================

            synthesis_list AS clinical_synthesis

        ORDER BY
            encounter_date ASC,
            encounter_id ASC
        """

        records = []

        try:

            with self.driver.session() as session:

                result = session.run(
                    query,
                    patient_id=patient_id,
                    appointment_id=appointment_id,
                )

                for record in result:

                    data = dict(record)

                    # =================================================
                    # PATIENT SAFETY CHECK
                    # =================================================

                    returned_patient_id = (
                        data.get("patient_id")
                        or ""
                    )

                    if returned_patient_id != patient_id:

                        logger.error(
                            "BLOCKED CROSS-PATIENT RECORD: "
                            "requested_patient=%s "
                            "returned_patient=%s "
                            "encounter=%s",
                            patient_id,
                            returned_patient_id,
                            data.get("encounter_id"),
                        )

                        continue

                    # =================================================
                    # NORMALIZE SUMMARIES
                    # =================================================

                    summaries = []

                    raw_summaries = (
                        data.get("summaries")
                        or []
                    )

                    for summary in raw_summaries:

                        if not summary:
                            continue

                        summary_data = {
                            "summary": (
                                summary.get(
                                    "summary",
                                    ""
                                ) or ""
                            ),

                            "summary_date": (
                                summary.get(
                                    "summary_date",
                                    ""
                                ) or ""
                            ),

                            "type": (
                                summary.get(
                                    "type",
                                    ""
                                ) or ""
                            ),

                            "document_id": (
                                summary.get(
                                    "document_id",
                                    ""
                                ) or ""
                            ),

                            "summary_id": (
                                summary.get(
                                    "summary_id",
                                    ""
                                ) or ""
                            ),

                            "is_baseline": (
                                summary.get(
                                    "is_baseline",
                                    False
                                ) or False
                            ),
                            
                            "event_id": (
                                summary.get(
                                    "event_id",
                                    ""
                                ) or ""
                            ),
                        }

                        summaries.append(
                            summary_data
                        )

                    # =================================================
                    # NORMALIZE CLINICAL SYNTHESIS
                    # =================================================

                    clinical_synthesis = []

                    raw_synthesis = (
                        data.get("clinical_synthesis")
                        or []
                    )

                    for synthesis in raw_synthesis:

                        if not synthesis:
                            continue

                        synthesis_data = {
                            "type": (
                                synthesis.get(
                                    "type",
                                    ""
                                ) or ""
                            ),

                            "reasoning": (
                                synthesis.get(
                                    "reasoning",
                                    ""
                                ) or ""
                            ),

                            "encounter_count": (
                                synthesis.get(
                                    "encounter_count",
                                    0
                                ) or 0
                            ),

                            "last_encounter_id": (
                                synthesis.get(
                                    "last_encounter_id",
                                    ""
                                ) or ""
                            ),

                            "created_at": (
                                synthesis.get(
                                    "created_at",
                                    ""
                                ) or ""
                            ),

                            "updated_at": (
                                synthesis.get(
                                    "updated_at",
                                    ""
                                ) or ""
                            ),
                        }

                        clinical_synthesis.append(
                            synthesis_data
                        )

                    # =================================================
                    # NORMALIZE EVENT
                    # =================================================

                    data["event_id"] = (
                        data.get("event_id")
                        or ""
                    )

                    data["conditions"] = (
                        data.get("conditions")
                        or ""
                    )

                    # =================================================
                    # NORMALIZE DOCTOR
                    # =================================================

                    data["doctor_id"] = (
                        data.get("doctor_id")
                        or ""
                    )

                    data["doctor_name"] = (
                        data.get("doctor_name")
                        or ""
                    )

                    data["doctor_specialty"] = (
                        data.get("doctor_specialty")
                        or ""
                    )

                    # =================================================
                    # NORMALIZE ENCOUNTER
                    # =================================================

                    data["encounter_id"] = (
                        data.get("encounter_id")
                        or ""
                    )

                    data["encounter_status"] = (
                        data.get("encounter_status")
                        or "OPEN"
                    )

                    data["encounter_opened_at"] = (
                        data.get("encounter_opened_at")
                        or ""
                    )

                    data["encounter_closed_at"] = (
                        data.get("encounter_closed_at")
                        or ""
                    )

                    # =================================================
                    # NORMALIZE PATIENT
                    # =================================================

                    data["patient_id"] = (
                        data.get("patient_id")
                        or patient_id
                    )

                    # =================================================
                    # NORMALIZE APPOINTMENT
                    # =================================================

                    data["appointment_id"] = (
                        data.get("appointment_id")
                        or ""
                    )

                    # =================================================
                    # NORMALIZE DATE
                    # =================================================

                    data["encounter_date"] = (
                        data.get("encounter_date")
                        or ""
                    )

                    # =================================================
                    # ASSIGN SUMMARIES
                    # =================================================

                    data["summaries"] = summaries

                    # =================================================
                    # ASSIGN CLINICAL SYNTHESIS
                    # =================================================

                    data["clinical_synthesis"] = (
                        clinical_synthesis
                    )

                    # =================================================
                    # APPEND ENCOUNTER
                    # =================================================

                    records.append(data)

        except Exception as exc:

            logger.exception(
                "Failed to fetch clinical timeline "
                "patient=%s appointment=%s",
                patient_id,
                appointment_id,
            )

            raise

        logger.info(
            "Clinical timeline returned "
            "patient=%s encounters=%s",
            patient_id,
            len(records),
        )

        return records

    # ==========================================================
    # GET PATIENT CLINICAL SYNTHESIS (all entity-type branches)
    #
    # Unlike get_patient_clinical_timeline (one row per ENCOUNTER),
    # this returns one row per ENTITY TYPE — the cross-encounter
    # reasoning thread for that type, patient-scoped. Types are
    # fully independent of one another; reading/returning one
    # type's branch never touches another's.
    # ==========================================================

    def get_patient_synthesis(
        self,
        patient_id: str,
        event_id: Optional[str] = None,
        summary_type: Optional[str] = None,
    ) -> List[Dict[str, Any]]:

        query = """
        MATCH (p:Patient {patient_id: $patient_id})
              -[:HAS_SYNTHESIS]->
              (cs:ClinicalSynthesis)

        WHERE
            coalesce(cs.patient_id, '') = $patient_id
            AND (
                $event_id IS NULL
                OR cs.event_id = $event_id
            )
            AND (
                $summary_type IS NULL
                OR cs.summary_type = $summary_type
            )

        RETURN
            coalesce(cs.summary_type, '') AS summary_type,
            coalesce(cs.reasoning, '') AS reasoning,
            coalesce(cs.encounter_count, 0) AS encounter_count,
            coalesce(cs.last_encounter_id, '') AS last_encounter_id,
            coalesce(cs.created_at, '') AS created_at,
            coalesce(cs.updated_at, '') AS updated_at

        ORDER BY summary_type ASC
        """

        results = []

        with self.driver.session() as session:

            records = session.run(
                query,
                patient_id=patient_id,
                event_id=event_id,
                summary_type=summary_type,
            )

            for record in records:

                data = dict(record)

                if data.get("patient_id") not in (None, patient_id):
                    continue

                results.append(data)

        return results

    # ==========================================================
    # OPTIONAL: GET ONE APPOINTMENT TIMELINE
    # ==========================================================
    def get_closed_encounter_count_for_type(
        self,
        patient_id: str,
        event_id: str,
        summary_type: str,
        exclude_encounter_id: str,
    ) -> int:
        """
        Get the number of CLOSED encounters that have a summary of this type.
        Used to determine the correct encounter_count for synthesis.
        """
        
        query = """
        MATCH (p:Patient {patient_id: $patient_id})
            -[:HAS_ENCOUNTER]->(e:Encounter)
            -[:HAS_SUMMARY]->(s:ClinicalSummary)
        
        WHERE e.patient_id = $patient_id
        AND e.status = 'CLOSED'
        AND e.encounter_id <> $exclude_encounter_id
        AND s.summary_type = $summary_type
        AND s.event_id = $event_id
        
        RETURN count(DISTINCT e) AS encounter_count
        """
        
        with self.driver.session() as session:
            record = session.run(
                query,
                patient_id=patient_id,
                event_id=event_id,
                summary_type=summary_type,
                exclude_encounter_id=exclude_encounter_id,
            ).single()
        
        return record["encounter_count"] if record else 0

    def get_patient_appointment_timeline(
        self,
        patient_id: str,
        appointment_id: str
    ) -> List[Dict[str, Any]]:

        return self.get_patient_clinical_timeline(
            patient_id=patient_id,
            appointment_id=appointment_id
        )

    # ==========================================================
    # CLOSE CURRENT OPEN ENCOUNTER
    #
    # Called by the Save button.
    # Frontend only needs patient_id + doctor_id.
    #
    # Closing the encounter is the ONLY trigger for synthesis.
    # After marking the encounter CLOSED, we look at every entity
    # type actually present on that encounter (from however many
    # documents were added while it was OPEN) and run one isolated
    # synthesis step per type that is present, with every other
    # present type's summary passed in as supporting context. A
    # type never touched in this encounter is skipped — its
    # synthesis branch is left completely untouched.
    #
    # RETURN VALUE:
    #
    #   {
    #       "encounter_id": "enc_p1_3",
    #       "synthesis": [
    #           {
    #               "synthesis_id": "...",
    #               "summary_type": "VITAL_SUMMARY",
    #               "reasoning": "...",
    #               "is_baseline": False
    #           },
    #           ...
    #       ]
    #   }
    #
    #   Returns None if there was no OPEN encounter to close.
    # ==========================================================

    def close_encounter(
        self,
        patient_id: str,
        doctor_id: str,
    ) -> Optional[Dict[str, Any]]:

        if not patient_id:
            raise ValueError("patient_id is required")

        if not doctor_id:
            raise ValueError("doctor_id is required")

        closed_at = self.utc_now()

        query = """
        MATCH (p:Patient {patient_id: $patient_id})
              -[:HAS_ENCOUNTER]->
              (e:Encounter)

        WHERE
            e.patient_id = $patient_id
            AND e.doctor_id = $doctor_id
            AND coalesce(e.status, 'OPEN') = 'OPEN'

        WITH e
        ORDER BY coalesce(e.opened_at, e.created_at, '') DESC
        LIMIT 1

        SET
            e.status = 'CLOSED',
            e.closed_at = $closed_at,
            e.updated_at = $closed_at

        RETURN e.encounter_id AS encounter_id
        """

        with self.driver.session() as session:
            record = (
                session.run(
                    query,
                    patient_id=patient_id,
                    doctor_id=doctor_id,
                    closed_at=closed_at,
                )
                .single()
            )

        if not record:
            logger.warning(
                "No OPEN encounter found: patient={} doctor={}",
                patient_id,
                doctor_id,
            )
            return None

        encounter_id = record["encounter_id"]

        logger.info(
            "Encounter CLOSED: patient={} doctor={} encounter={}",
            patient_id,
            doctor_id,
            encounter_id,
        )

        # --------------------------------------------------
        # Synthesis runs HERE — once, on close, for every
        # entity type actually present on this encounter, each
        # receiving the other present types as context.
        # --------------------------------------------------

        synthesis_results = self.run_synthesis_for_encounter(
            patient_id=patient_id,
            encounter_id=encounter_id,
        )

        return {
            "encounter_id": encounter_id,
            "synthesis": synthesis_results,
        }