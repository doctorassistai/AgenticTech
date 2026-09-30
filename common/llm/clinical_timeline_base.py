# clinical_timeline_base.py

from typing import Optional, Dict, List, Any
from datetime import datetime, timezone
from uuid import uuid4
import json
import os
import re

from neo4j import GraphDatabase
from groq import Groq
from loguru import logger


class ClinicalTimelineBaseMixin:
    """
    Core / shared functionality:
      - driver + groq client init
      - static helpers (normalize, dedupe, utc_now)
      - generic LLM JSON call
      - clinical condition extraction
      - Patient node
      - ClinicalEvent (patient-level, legacy single-event) create/update
      - Multi-case ClinicalEvent helpers (chief-complaint based matching)
      - Doctor node
    """

    # ==========================================================
    # ENTITY TYPE REGISTRY
    #
    # Single source of truth for the allowed summary_type values.
    # Used by identify_summary_types() to validate LLM output, and
    # by run_synthesis_for_encounter() to log which types were
    # skipped (present in the registry but absent from a given
    # encounter).
    # ==========================================================

    ALLOWED_SUMMARY_TYPES = {
        "VITAL_SUMMARY",
        "LAB_SUMMARY",
        "IMAGING_SUMMARY",
        "MEDICATION_SUMMARY",
        "PROCEDURE_SUMMARY",
        "SYMPTOM_SUMMARY",
    }

    # ==========================================================
    # INIT
    # ==========================================================

    def __init__(
        self,
        uri: str,
        user: str,
        password: str,
        groq_client: Optional[Groq] = None,
    ):
        self.driver = GraphDatabase.driver(
            uri,
            auth=(user, password)
        )

        self.groq_client = groq_client or Groq(
            api_key=os.getenv("GROQ_API_KEY")
        )

        logger.info(
            "ClinicalTimelineGraph initialized"
        )

    # ==========================================================
    # CLOSE
    # ==========================================================

    def close(self):
        if self.driver:
            self.driver.close()

    # ==========================================================
    # BASIC HELPERS
    # ==========================================================

    @staticmethod
    def normalize_text(value: Any) -> str:
        if value is None:
            return ""

        return str(value).strip()

    @staticmethod
    def normalize_condition(value: str) -> str:
        if not value:
            return ""

        value = str(value).strip()

        value = re.sub(
            r"^[\-\*\•\s]+",
            "",
            value
        )

        return value.strip(" ,.")

    @staticmethod
    def utc_now() -> str:
        return datetime.now(
            timezone.utc
        ).isoformat()

    @staticmethod
    def deduplicate_conditions(
        existing: str,
        new_conditions: List[str]
    ) -> str:

        result = []

        # ------------------------------------------------------
        # Existing conditions
        # ------------------------------------------------------

        if existing:
            for item in existing.split(","):

                item = ClinicalTimelineBaseMixin.normalize_condition(
                    item
                )

                if item:
                    result.append(item)

        # ------------------------------------------------------
        # New conditions
        # ------------------------------------------------------

        for item in new_conditions or []:

            item = ClinicalTimelineBaseMixin.normalize_condition(
                item
            )

            if not item:
                continue

            already_exists = any(
                x.lower() == item.lower()
                for x in result
            )

            if not already_exists:
                result.append(item)

        return ", ".join(result)

    # ==========================================================
    # LLM JSON
    # ==========================================================

    def _llm_json(
        self,
        prompt: str,
        max_tokens: int = 5000
    ) -> Dict[str, Any]:

        try:

            completion = (
                self.groq_client
                .chat
                .completions
                .create(
                    model="openai/gpt-oss-120b",
                    temperature=0.1,
                    max_tokens=max_tokens,
                    response_format={
                        "type": "json_object"
                    },
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
                return {}

            try:
                return json.loads(response)

            except json.JSONDecodeError:

                logger.exception(
                    "LLM returned invalid JSON: {}",
                    response
                )

                return {}

        except Exception:

            logger.exception(
                "LLM request failed"
            )

            return {}

    # ==========================================================
    # IDENTIFY CLINICAL CONDITIONS
    # ==========================================================

    def identify_clinical_conditions(
        self,
        document_text: str,
        existing_conditions: str = ""
    ) -> List[str]:

        prompt = f"""
You are extracting clinical conditions from a medical document.

DOCUMENT:
{document_text}

EXISTING PATIENT CLINICAL CONDITIONS:
{existing_conditions or "None"}

Identify conditions explicitly mentioned in the document.

Include clinically meaningful conditions such as:

- Appendicitis
- Hypertension
- Diabetes mellitus
- Abdominal tumor
- Abdominal cancer
- Specific cancer
- Pneumonia
- Penicillin allergy
- Chronic kidney disease
- Asthma
- Viral fever

Do NOT include:

- patient_id
- doctor_id
- appointment_id
- dates
- medications by themselves
- laboratory values
- vital signs
- procedures by themselves
- generic words such as "normal"
- symptoms unless they represent a clinical condition

If a condition already exists in the existing condition list,
do not return it again.

Return JSON only:

{{
    "conditions": [
        "condition 1",
        "condition 2"
    ]
}}
"""

        result = self._llm_json(
            prompt
        )

        conditions = result.get(
            "conditions",
            []
        )

        if not isinstance(
            conditions,
            list
        ):
            return []

        cleaned = []

        for condition in conditions:

            if not isinstance(
                condition,
                str
            ):
                continue

            condition = (
                self.normalize_condition(
                    condition
                )
            )

            if condition:
                cleaned.append(
                    condition
                )

        # Defensive deduplication

        final = []
        seen = set()

        for condition in cleaned:

            key = condition.lower()

            if key not in seen:

                seen.add(key)

                final.append(
                    condition
                )

        return final

    # ==========================================================
    # PATIENT
    # ==========================================================

    def ensure_patient(
        self,
        patient_id: str
    ):

        query = """
        MERGE (p:Patient {
            patient_id: $patient_id
        })

        // Repair/link existing encounters that already carry this patient_id.
        // This makes the Patient -> Encounter ownership explicit, including
        // legacy Encounter nodes created before this relationship was added.
        WITH p
        OPTIONAL MATCH (e:Encounter {patient_id: $patient_id})
        FOREACH (_ IN CASE WHEN e IS NOT NULL THEN [1] ELSE [] END |
            MERGE (p)-[:HAS_ENCOUNTER]->(e)
        )

        RETURN p.patient_id AS patient_id
        """

        with self.driver.session() as session:

            session.run(
                query,
                patient_id=patient_id
            ).consume()

    # ==========================================================
    # GET PATIENT CLINICAL EVENT  (LEGACY — single event per patient)
    #
    # IMPORTANT:
    #
    # This method assumes ONE ClinicalEvent per patient and is kept
    # only for backward compatibility with old callers that still
    # pass no clinical_event_id AND don't want case-splitting
    # behavior. The normal process_document() flow no longer calls
    # this — see determine_clinical_event_for_complaint() /
    # get_all_clinical_events() below for the multi-case-aware path.
    #
    # This implementation also repairs legacy nodes
    # which do not have event_id.
    # ==========================================================

    def get_clinical_event(
        self,
        patient_id: str
    ) -> Optional[Dict[str, Any]]:

        query = """
        MATCH (
            p:Patient {
                patient_id: $patient_id
            }
        )

        OPTIONAL MATCH
            (p)-[:HAS_CLINICAL_EVENT]->(ce:ClinicalEvent)

        WITH ce
        ORDER BY
            coalesce(
                properties(ce)["created_at"],
                ""
            ) ASC

        LIMIT 1

        RETURN
            ce,
            properties(ce) AS props
        """

        with self.driver.session() as session:

            record = (
                session
                .run(
                    query,
                    patient_id=patient_id
                )
                .single()
            )

            if not record:
                return None

            ce = record["ce"]

            if ce is None:
                return None

            props = (
                record["props"]
                or {}
            )

            return {
                "neo4j_id": ce.element_id,
                "event_id": props.get(
                    "event_id"
                ),
                "conditions": props.get(
                    "conditions",
                    ""
                ) or "",
                "appointment_id": props.get(
                    "appointment_id"
                ),
                "created_at": props.get(
                    "created_at"
                ),
                "updated_at": props.get(
                    "updated_at"
                )
            }

    # ==========================================================
    # GET CLINICAL EVENT BY APPOINTMENT ID
    #
    # NEW METHOD: Find the ClinicalEvent associated with a specific
    # appointment_id. Used to attach vitals/labs to the correct event.
    # ==========================================================

    def get_clinical_event_by_appointment(
        self,
        patient_id: str,
        appointment_id: str,
        doctor_id: str = None,  # Make optional, not used in query
    ) -> Optional[Dict[str, Any]]:

        query = """
        MATCH (e:Encounter)
        WHERE e.patient_id = $patient_id
        AND e.appointment_id = $appointment_id
        // REMOVED: AND e.doctor_id = $doctor_id

        MATCH (ce:ClinicalEvent {event_id: e.event_id})
        WHERE ce.patient_id = $patient_id

        RETURN
            ce.event_id AS event_id,
            coalesce(ce.conditions, '') AS conditions,
            coalesce(ce.appointment_id, '') AS appointment_id,
            coalesce(ce.created_at, '') AS created_at

        ORDER BY e.created_at DESC
        LIMIT 1
        """

        with self.driver.session() as session:
            record = session.run(
                query,
                patient_id=patient_id,
                appointment_id=appointment_id,
                # doctor_id parameter removed from query
            ).single()

        if not record:
            return None

        return dict(record)
    # ==========================================================
    # GET EVENT ID FOR ENCOUNTER
    #
    # NEW METHOD: Get the event_id associated with an encounter
    # ==========================================================

    def get_event_id_for_encounter(self, encounter_id: str) -> Optional[str]:
        """Get the event_id associated with an encounter"""
        
        query = """
        MATCH (e:Encounter {encounter_id: $encounter_id})
        RETURN e.event_id AS event_id
        """
        
        with self.driver.session() as session:
            record = session.run(query, encounter_id=encounter_id).single()
        
        return record["event_id"] if record else None

    # ==========================================================
    # LINK APPOINTMENT TO EVENT
    #
    # NEW METHOD: Link an existing event to an appointment_id
    # ==========================================================

    def link_appointment_to_event(
        self,
        event_id: str,
        appointment_id: str
    ) -> None:

        query = """
        MATCH (ce:ClinicalEvent {event_id: $event_id})
        SET ce.appointment_id = $appointment_id
        RETURN ce.event_id
        """

        with self.driver.session() as session:
            session.run(
                query,
                event_id=event_id,
                appointment_id=appointment_id
            ).consume()

        logger.info(
            "Linked appointment {} to event {}",
            appointment_id,
            event_id
        )

    # ==========================================================
    # EXTRACT CHIEF COMPLAINT FROM APPOINTMENT TEXT
    #
    # NEW METHOD: Extract chief complaint from full appointment document
    # ==========================================================

    def extract_chief_complaint_from_appointment(
        self,
        document_text: str
    ) -> str:

        if not document_text or not document_text.strip():
            return ""

        prompt = f"""
Extract the chief complaint / reason-for-visit from this appointment text.

APPOINTMENT TEXT:
{document_text}

Return ONLY the short chief complaint phrase (e.g. "fever", "leg fracture", "follow-up hypertension").
If no clinical reason can be identified, return an empty string.

Return JSON:
{{
    "chief_complaint": "..."
}}
"""

        result = self._llm_json(prompt, max_tokens=5000)
        complaint = result.get("chief_complaint", "")

        return complaint.strip() if isinstance(complaint, str) else ""

    # ==========================================================
    # FIND OR CREATE EVENT FOR APPOINTMENT
    #
    # NEW METHOD: Find existing event for this appointment,
    # or create new one. CONDITIONS are NOT extracted from
    # appointment document. Conditions will be extracted later
    # from vitals/labs.
    # ==========================================================

    def find_or_create_event_for_appointment(
        self,
        patient_id: str,
        appointment_id: str,
        document_text: str,
        document_date: Optional[str] = None,
        doctor_id: Optional[str] = None
    ) -> str:

        # Step 1: Check if event already exists for this appointment
        existing = self.get_clinical_event_by_appointment(
            patient_id=patient_id,
            appointment_id=appointment_id,
            doctor_id=doctor_id,
        )

        if existing:
            event_id = existing["event_id"]

            # Same appointment_id is a strong signal this is the same
            # visit/case. Multiple specialties can legitimately share one
            # event (multidisciplinary care) — a doctor who's new to this
            # event just gets ADDED to it via create_or_update_doctor()
            # later in process_document(), not split into a new event.
            logger.info(
                "Found existing event for appointment {}: event_id={} (doctor={})",
                appointment_id,
                event_id,
                doctor_id
            )
            return event_id
            
            logger.info(
                "Found existing event for appointment {}: event_id={}",
                appointment_id,
                existing["event_id"]
            )
            return existing["event_id"]

        # Step 2: Extract chief complaint from appointment tex
        chief_complaint = self.extract_chief_complaint_from_appointment(
            document_text=document_text
        )

        if chief_complaint:
            # Check if this chief complaint matches any existing event
            event_id = self.determine_clinical_event_for_complaint(
                patient_id=patient_id,
                chief_complaint=chief_complaint
            )

            # Update the found event with appointment_id
            if event_id:
                self.link_appointment_to_event(
                    event_id=event_id,
                    appointment_id=appointment_id
                )
                return event_id

        # Step 3: No existing event, create new one with EMPTY conditions
        event_id = self.create_new_clinical_event(
            patient_id=patient_id,
            conditions=[],
            appointment_id=appointment_id,
            document_date=document_date
        )

        logger.info(
            "Created NEW event for appointment {}: event_id={}",
            appointment_id,
            event_id
        )

        return event_id

    # ==========================================================
    # GET EVENT DOCTOR
    #
    # NEW METHOD: Get the doctor_id associated with a ClinicalEvent
    # ==========================================================

    def _event_has_doctor(self, event_id: str, doctor_id: str) -> bool:
        """
        Check whether THIS doctor is already one of the (possibly many)
        doctors attached to this ClinicalEvent. A multidisciplinary case
        can legitimately have several HAS_DOCTOR edges — this is a
        membership test, not a single-owner lookup.
        """

        query = """
        MATCH (ce:ClinicalEvent {event_id: $event_id})
            -[:HAS_DOCTOR]->
            (d:Doctor {doctor_id: $doctor_id})
        RETURN count(d) > 0 AS has_doctor
        """

        with self.driver.session() as session:
            record = session.run(
                query,
                event_id=event_id,
                doctor_id=doctor_id
            ).single()

        return record["has_doctor"] if record else False

    # ==========================================================
    # FIND OPEN ENCOUNTER EVENT ID
    #
    # NEW METHOD: Find event_id from the current OPEN encounter
    # ==========================================================

    def find_open_encounter_event_id(
        self,
        patient_id: str,
        doctor_id: str
    ) -> Optional[str]:

        query = """
        MATCH (p:Patient {patient_id: $patient_id})
              -[:HAS_ENCOUNTER]->
              (e:Encounter)
        WHERE e.patient_id = $patient_id
          AND e.doctor_id = $doctor_id
          AND coalesce(e.status, 'OPEN') = 'OPEN'
        RETURN e.event_id AS event_id
        ORDER BY e.opened_at DESC
        LIMIT 1
        """

        with self.driver.session() as session:
            record = session.run(
                query,
                patient_id=patient_id,
                doctor_id=doctor_id
            ).single()

        return record["event_id"] if record else None

    # ==========================================================
    # CHECK IF EVENT HAS SUMMARIES
    #
    # NEW METHOD: Check if this event already has any ClinicalSummary nodes
    # ==========================================================

    def event_has_summaries(self, event_id: str) -> bool:

        query = """
        MATCH (ce:ClinicalEvent {event_id: $event_id})
              -[:HAS_ENCOUNTER]->
              (e:Encounter)
              -[:HAS_SUMMARY]->
              (s:ClinicalSummary)
        RETURN count(s) > 0 AS has_summaries
        """

        with self.driver.session() as session:
            record = session.run(query, event_id=event_id).single()

        return record["has_summaries"] if record else False

    # ==========================================================
    # CREATE / UPDATE CLINICAL EVENT  (LEGACY — single event per patient)
    #
    # IMPORTANT:
    #
    # ClinicalEvent is PATIENT LEVEL under this legacy path.
    #
    # Conditions are OPTIONAL.
    #
    # event_id is ALWAYS created.
    #
    # Kept only for backward compatibility. New flow uses
    # determine_clinical_event_for_complaint() +
    # update_clinical_event_conditions() instead, which support
    # multiple concurrent cases per patient.
    # ==========================================================

    def create_or_update_clinical_event(
        self,
        patient_id: str,
        conditions: List[str]
    ) -> str:

        existing = self.get_clinical_event(
            patient_id
        )

        # ------------------------------------------------------
        # Existing event
        # ------------------------------------------------------

        if existing:

            event_id = (
                existing.get(
                    "event_id"
                )
            )

            # --------------------------------------------------
            # Repair old ClinicalEvent without event_id
            # --------------------------------------------------

            if not event_id:

                event_id = (
                    f"ce_{patient_id}_"
                    f"{uuid4().hex[:10]}"
                )

                now = self.utc_now()

                repair_query = """
                MATCH (
                    p:Patient {
                        patient_id: $patient_id
                    }
                )

                MATCH (
                    p
                )-[:HAS_CLINICAL_EVENT]->(ce:ClinicalEvent)

                WHERE elementId(ce) = $neo4j_id

                SET
                    ce.event_id = $event_id,
                    ce.patient_id = $patient_id,
                    ce.created_at =
                        coalesce(
                            properties(ce)["created_at"],
                            $created_at
                        ),
                    ce.updated_at = $updated_at

                RETURN ce.event_id AS event_id
                """

                with self.driver.session() as session:

                    record = (
                        session
                        .run(
                            repair_query,
                            patient_id=patient_id,
                            neo4j_id=existing["neo4j_id"],
                            event_id=event_id,
                            created_at=now,
                            updated_at=now
                        )
                        .single()
                    )

                    if record:
                        event_id = (
                            record["event_id"]
                        )

                existing["event_id"] = event_id

            # --------------------------------------------------
            # Merge conditions
            # --------------------------------------------------

            merged_conditions = (
                self.deduplicate_conditions(
                    existing.get(
                        "conditions",
                        ""
                    ) or "",
                    conditions
                )
            )

            update_query = """
            MATCH (
                p:Patient {
                    patient_id: $patient_id
                }
            )

            MATCH (
                p
            )-[:HAS_CLINICAL_EVENT]->(ce:ClinicalEvent)

            WHERE
                ce.event_id = $event_id

            SET
                ce.patient_id = $patient_id,
                ce.conditions = $conditions,
                ce.updated_at = $updated_at

            RETURN ce.event_id AS event_id
            """

            with self.driver.session() as session:

                record = (
                    session
                    .run(
                        update_query,
                        patient_id=patient_id,
                        event_id=event_id,
                        conditions=merged_conditions,
                        updated_at=self.utc_now()
                    )
                    .single()
                )

                if record:
                    event_id = (
                        record["event_id"]
                    )

            logger.info(
                "Updated patient clinical event: "
                "patient={} event={}",
                patient_id,
                event_id
            )

            return event_id

        # ------------------------------------------------------
        # First clinical event
        # ------------------------------------------------------

        event_id = (
            f"ce_{patient_id}_"
            f"{uuid4().hex[:10]}"
        )

        condition_string = ", ".join(
            dict.fromkeys(
                [
                    self.normalize_condition(c)
                    for c in (
                        conditions or []
                    )
                    if self.normalize_condition(c)
                ]
            )
        )

        now = self.utc_now()

        query = """
        MATCH (
            p:Patient {
                patient_id: $patient_id
            }
        )

        CREATE (
            ce:ClinicalEvent {
                event_id: $event_id,
                patient_id: $patient_id,
                conditions: $conditions,
                created_at: $created_at,
                updated_at: $updated_at
            }
        )

        CREATE (
            p
        )-[:HAS_CLINICAL_EVENT]->(ce)

        RETURN ce.event_id AS event_id
        """

        with self.driver.session() as session:

            record = (
                session
                .run(
                    query,
                    patient_id=patient_id,
                    event_id=event_id,
                    conditions=condition_string,
                    created_at=now,
                    updated_at=now
                )
                .single()
            )

            if record:
                event_id = (
                    record["event_id"]
                )

        logger.info(
            "Created patient clinical event: "
            "patient={} event={}",
            patient_id,
            event_id
        )

        return event_id

    # ==========================================================
    # GET ALL CLINICAL EVENTS (CASES) FOR A PATIENT
    #
    # Unlike get_clinical_event() (legacy, singular), this returns
    # EVERY case the patient has — e.g. one for "fever" and a
    # separate one for "leg fracture" — so callers can decide which
    # case a new document belongs to.
    # ==========================================================

    def get_all_clinical_events(
        self,
        patient_id: str
    ) -> List[Dict[str, Any]]:

        query = """
        MATCH (
            p:Patient {
                patient_id: $patient_id
            }
        )-[:HAS_CLINICAL_EVENT]->(ce:ClinicalEvent)

        RETURN
            ce.event_id AS event_id,
            coalesce(ce.conditions, '') AS conditions,
            coalesce(ce.appointment_id, '') AS appointment_id,
            coalesce(ce.created_at, '') AS created_at

        ORDER BY
            created_at ASC
        """

        results = []

        with self.driver.session() as session:

            records = session.run(
                query,
                patient_id=patient_id
            )

            for record in records:

                data = dict(record)

                if data.get("event_id"):
                    results.append(data)

        return results

    # ==========================================================
    # CREATE A NEW CASE (never merges into an existing one)
    #
    # Used when a new document is clinically unrelated to every
    # existing case for the patient (e.g. new "leg fracture" case
    # while an existing "fever" case is still open).
    #
    # conditions is intentionally allowed to be empty — the chief
    # complaint used to DECIDE this is a new case is never itself
    # stored as a condition. Real conditions are filled in
    # separately via identify_clinical_conditions() over the
    # document text.
    # ==========================================================

    def create_new_clinical_event(
        self,
        patient_id: str,
        conditions: Optional[List[str]] = None,
        appointment_id: Optional[str] = None,
        document_date: Optional[str] = None
    ) -> str:

        event_id = (
            f"ce_{patient_id}_"
            f"{uuid4().hex[:10]}"
        )

        condition_string = ", ".join(
            dict.fromkeys(
                self.normalize_condition(c)
                for c in (conditions or [])
                if self.normalize_condition(c)
            )
        )

        now = self.utc_now()

        query = """
        MATCH (p:Patient {patient_id: $patient_id})

        CREATE (ce:ClinicalEvent {
            event_id: $event_id,
            patient_id: $patient_id,
            conditions: $conditions,
            appointment_id: $appointment_id,
            event_date: $document_date,
            created_at: $created_at,
            updated_at: $updated_at
        })

        CREATE (p)-[:HAS_CLINICAL_EVENT]->(ce)

        RETURN ce.event_id AS event_id
        """

        with self.driver.session() as session:

            record = session.run(
                query,
                patient_id=patient_id,
                event_id=event_id,
                conditions=condition_string,
                appointment_id=appointment_id,
                document_date=document_date,
                created_at=now,
                updated_at=now
            ).single()

            if record:
                event_id = record["event_id"]

        logger.info(
            "Created NEW clinical event: patient={} event={} appointment={}",
            patient_id,
            event_id,
            appointment_id
        )

        return event_id

    # ==========================================================
    # MERGE CONDITIONS INTO A SPECIFIC (already-decided) CASE
    #
    # Unlike create_or_update_clinical_event() (legacy, patient-
    # singleton), this always targets an explicit event_id, so it
    # is safe to use when a patient has multiple concurrent cases.
    # ==========================================================

    def update_clinical_event_conditions(
        self,
        patient_id: str,
        event_id: str,
        conditions: List[str],
    ) -> str:

        fetch_query = """
        MATCH (
            p:Patient {
                patient_id: $patient_id
            }
        )-[:HAS_CLINICAL_EVENT]->(ce:ClinicalEvent {event_id: $event_id})

        RETURN coalesce(ce.conditions, '') AS conditions
        """

        with self.driver.session() as session:

            record = (
                session
                .run(
                    fetch_query,
                    patient_id=patient_id,
                    event_id=event_id,
                )
                .single()
            )

        existing_conditions = (
            record["conditions"]
            if record
            else ""
        )

        merged_conditions = self.deduplicate_conditions(
            existing_conditions,
            conditions,
        )

        update_query = """
        MATCH (
            p:Patient {
                patient_id: $patient_id
            }
        )-[:HAS_CLINICAL_EVENT]->(ce:ClinicalEvent {event_id: $event_id})

        SET
            ce.conditions = $conditions,
            ce.updated_at = $updated_at

        RETURN ce.event_id AS event_id
        """

        with self.driver.session() as session:

            record = (
                session
                .run(
                    update_query,
                    patient_id=patient_id,
                    event_id=event_id,
                    conditions=merged_conditions,
                    updated_at=self.utc_now(),
                )
                .single()
            )

        result_event_id = (
            record["event_id"]
            if record
            else event_id
        )

        logger.info(
            "Updated case conditions: patient={} event={} conditions={}",
            patient_id,
            result_event_id,
            merged_conditions,
        )

        return result_event_id

    # ==========================================================
    # EXTRACT CHIEF COMPLAINT (from document_name)
    #
    # This looks ONLY at document_name (which is the appointment's
    # reason-for-visit label), NEVER the full document_text. This
    # keeps it cheap enough to run on every single document.
    # ==========================================================

    def extract_chief_complaint(
        self,
        document_name: Optional[str]
    ) -> str:

        if not document_name or not document_name.strip():
            return ""

        prompt = f"""
Extract the chief complaint / reason-for-visit from this appointment
or document name.

DOCUMENT NAME:
{document_name}

Return ONLY the short chief complaint phrase (e.g. "fever", "leg
fracture", "follow-up hypertension"). If no clinical reason can be
identified, return an empty string.

Return JSON:

{{
    "chief_complaint": "..."
}}
"""

        result = self._llm_json(
            prompt,
            max_tokens=5000
        )

        complaint = result.get(
            "chief_complaint",
            ""
        )

        if not isinstance(complaint, str):
            return ""

        return complaint.strip()

    # ==========================================================
    # DECIDE: existing case, or a brand-new unrelated case
    #
    # This is the entry point process_document() calls when no
    # clinical_event_id was explicitly provided. It:
    #
    #   1. If the patient has NO cases yet -> create the first one
    #      (empty conditions; the initial "no case yet" state is
    #      unaffected by this change).
    #   2. If chief_complaint could not be determined -> fall back
    #      to the most recently created case (safer than
    #      fragmenting cases with no signal to match on).
    #   3. Otherwise, ask the LLM whether the complaint continues
    #      an EXISTING case or is clinically UNRELATED. Unrelated
    #      -> a brand-new case is created with EMPTY conditions
    #      (the chief complaint itself is never stored as a
    #      condition — only used to decide case membership).
    # ==========================================================

    def determine_clinical_event_for_complaint(
        self,
        patient_id: str,
        chief_complaint: str,
    ) -> str:

        existing_events = self.get_all_clinical_events(
            patient_id=patient_id
        )

        if not existing_events:
            return self.create_new_clinical_event(
                patient_id=patient_id,
                conditions=[],
            )

        if not chief_complaint:
            fallback_event_id = existing_events[-1]["event_id"]

            logger.info(
                "No chief complaint available for patient={} — "
                "using most recent case {}",
                patient_id,
                fallback_event_id,
            )

            return fallback_event_id

        events_block = "\n".join(
            f'- event_id: "{e["event_id"]}", '
            f'conditions: "{e.get("conditions", "")}"'
            for e in existing_events
        )

        prompt = f"""
Decide whether this new visit belongs to an EXISTING clinical case for
this patient, or is a NEW, clinically unrelated case.

NEW VISIT CHIEF COMPLAINT:
{chief_complaint}

EXISTING CASES FOR THIS PATIENT:
{events_block}

Rules:

- If the complaint is a continuation, follow-up, or complication of
  an existing case, return that case's event_id.
- If the complaint is clinically UNRELATED (e.g. patient being
  treated for "fever" now presents with a "fractured leg"), it is a
  NEW case — return "NEW".
- If unclear, prefer "NEW" over merging unrelated problems.

Return JSON only:

{{
    "event_id": "<existing event_id OR the literal string NEW>"
}}
"""

        result = self._llm_json(
            prompt,
            max_tokens=5000
        )

        decision = result.get(
            "event_id",
            "NEW"
        )

        if not isinstance(decision, str):
            decision = "NEW"

        decision = decision.strip()

        valid_ids = {
            e["event_id"]
            for e in existing_events
        }

        if decision in valid_ids:

            logger.info(
                "Complaint '{}' matched EXISTING case {} for patient {}",
                chief_complaint,
                decision,
                patient_id,
            )

            return decision

        # ------------------------------------------------------
        # NEW case. Conditions start EMPTY — the chief complaint
        # is only used for this matching decision, never stored
        # directly as a condition. identify_clinical_conditions()
        # fills in real conditions from the document text
        # afterward, in process_document().
        # ------------------------------------------------------

        new_event_id = self.create_new_clinical_event(
            patient_id=patient_id,
            conditions=[],
        )

        logger.info(
            "Complaint '{}' unrelated to existing cases for patient {} "
            "— created NEW case {}",
            chief_complaint,
            patient_id,
            new_event_id,
        )

        return new_event_id

    # ==========================================================
    # DOCTOR
    #
    # Doctor is GLOBAL.
    #
    # The important patient boundary is maintained through
    # ClinicalEvent -> Doctor -> Encounter AND e.patient_id.
    # ==========================================================

    def create_or_update_doctor(
        self,
        event_id: str,
        doctor_id: str,
        doctor_name: str = "",
        doctor_specialty: str = ""
    ):

        query = """
        MATCH (
            ce:ClinicalEvent {
                event_id: $event_id
            }
        )

        MERGE (
            d:Doctor {
                doctor_id: $doctor_id
            }
        )

        SET
            d.name =
                CASE
                    WHEN $doctor_name <> ''
                    THEN $doctor_name
                    ELSE coalesce(
                        properties(d)["name"],
                        ''
                    )
                END,

            d.specialty =
                CASE
                    WHEN $doctor_specialty <> ''
                    THEN $doctor_specialty
                    ELSE coalesce(
                        properties(d)["specialty"],
                        ''
                    )
                END

        MERGE (
            ce
        )-[:HAS_DOCTOR]->(d)

        RETURN
            d.doctor_id AS doctor_id
        """

        with self.driver.session() as session:

            session.run(
                query,
                event_id=event_id,
                doctor_id=doctor_id,
                doctor_name=doctor_name or "",
                doctor_specialty=doctor_specialty or ""
            ).consume()

        logger.info(
            "Doctor connected to clinical event: {}",
            doctor_id
        )