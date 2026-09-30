from typing import Optional, Dict, List, Any
import hashlib

from loguru import logger


class ClinicalTimelinePatientProfileMixin:
    """
    PATIENT-LEVEL PROFILE — a SECOND, INDEPENDENT branch hanging
    directly off Patient. Completely isolated from ClinicalEvent /
    Encounter / ClinicalSummary / ClinicalSynthesis:

        PATIENT
          ├── ACTIVE_CONDITIONS
          ├── CURRENT_MEDICATIONS
          ├── FAMILY_HISTORY
          ├── ALLERGIES
          └── PREVIOUS_PROCEDURES

    ISOLATION RULES:
      - No event_id / encounter_id anywhere in this mixin.
      - Called once per document, for EVERY document_name
        (appointment, vitals, labs, clinical_note, etc.) since
        standing meds/conditions/allergies/family history/past
        procedures can surface in any document type.
      - Items dedupe per (patient, category, normalized value) so
        the same fact across many documents merges into ONE node.

    Depends on ClinicalTimelineBaseMixin for:
        self.driver, self.utc_now(), self._llm_json(),
        self.normalize_condition()
    """

    PATIENT_PROFILE_CATEGORIES = {
        "ACTIVE_CONDITIONS",
        "CURRENT_MEDICATIONS",
        "FAMILY_HISTORY",
        "ALLERGIES",
        "PREVIOUS_PROCEDURES",
    }

    # ==========================================================
    # ID HELPER — stable per (patient, category, normalized value)
    # ==========================================================

    @staticmethod
    def _profile_item_id(
        patient_id: str,
        category: str,
        value: str,
    ) -> str:
        normalized = value.strip().lower()
        digest = hashlib.sha1(normalized.encode("utf-8")).hexdigest()[:12]
        return f"profile_{patient_id}_{category.lower()}_{digest}"

    # ==========================================================
    # EXTRACTION
    # ==========================================================

    def extract_patient_profile_items(
        self,
        document_text: str,
        existing_profile: Optional[Dict[str, List[str]]] = None,
    ) -> Dict[str, List[Dict[str, str]]]:
        """
        Extract LIFETIME / STANDING facts — not facts specific to
        today's visit only.
        """

        existing_block = "NONE"
        if existing_profile:
            lines = []
            for category, items in existing_profile.items():
                if items:
                    lines.append(f"{category}: " + "; ".join(items))
            if lines:
                existing_block = "\n".join(lines)

        prompt = f"""
You are extracting LIFETIME / PATIENT-LEVEL facts from a medical
document — NOT facts specific to today's visit only.

DOCUMENT:
{document_text}

EXISTING PATIENT PROFILE (do not repeat facts already listed unless
their status has changed, e.g. a medication was stopped):
{existing_block}

Extract facts for exactly these 5 categories:

ACTIVE_CONDITIONS:
  Chronic/ongoing diagnoses the patient currently has (e.g.
  "Diabetes mellitus", "Hypertension"). Do NOT include a transient
  symptom of today's visit unless it is itself a standing diagnosis.

CURRENT_MEDICATIONS:
  Medications taken on an ONGOING / long-term basis — medicines the
  patient has NOT stopped. Do NOT include a short course prescribed
  only for this encounter unless the document says it's a standing
  medication. If the document says a medication was STOPPED, return
  it with status "DISCONTINUED".

FAMILY_HISTORY:
  Conditions explicitly reported in blood relatives (e.g. "Father —
  Diabetes mellitus").

ALLERGIES:
  Drug, food, or environmental allergies, with reaction if stated.

PREVIOUS_PROCEDURES:
  Surgeries/procedures the patient has ALREADY had (historical),
  not a procedure being performed today.

Rules:
- Only extract facts EXPLICITLY stated. Never invent.
- Empty list if nothing qualifies for a category.
- Don't duplicate an item already in EXISTING PATIENT PROFILE unless
  its status is changing (e.g. newly discontinued).

Return JSON only:

{{
    "ACTIVE_CONDITIONS": [
        {{"item": "...", "status": "ACTIVE", "detail": ""}}
    ],
    "CURRENT_MEDICATIONS": [
        {{"item": "...", "status": "ACTIVE", "detail": "5 mg daily"}}
    ],
    "FAMILY_HISTORY": [
        {{"item": "...", "status": "HISTORICAL", "detail": "Father"}}
    ],
    "ALLERGIES": [
        {{"item": "...", "status": "ACTIVE", "detail": "rash"}}
    ],
    "PREVIOUS_PROCEDURES": [
        {{"item": "...", "status": "HISTORICAL", "detail": "2019"}}
    ]
}}
"""

        result = self._llm_json(prompt, max_tokens=1500)

        cleaned: Dict[str, List[Dict[str, str]]] = {
            category: [] for category in self.PATIENT_PROFILE_CATEGORIES
        }

        for category in self.PATIENT_PROFILE_CATEGORIES:

            raw_items = result.get(category, [])
            if not isinstance(raw_items, list):
                continue

            for raw in raw_items:

                if not isinstance(raw, dict):
                    continue

                item = self.normalize_condition(raw.get("item", ""))
                if not item:
                    continue

                status = (raw.get("status") or "ACTIVE").strip().upper()
                if status not in {"ACTIVE", "DISCONTINUED", "RESOLVED", "HISTORICAL"}:
                    status = "ACTIVE"

                detail = (raw.get("detail") or "").strip()

                cleaned[category].append({
                    "item": item,
                    "status": status,
                    "detail": detail,
                })

        return cleaned

    # ==========================================================
    # STORE / MERGE ONE ITEM (dedup boundary)
    # ==========================================================

    def _upsert_profile_item(
        self,
        patient_id: str,
        category: str,
        item: str,
        status: str,
        detail: str,
        document_id: str,
        document_date: Optional[str],
    ) -> str:

        item_id = self._profile_item_id(patient_id, category, item)
        now = self.utc_now()

        query = """
        MATCH (p:Patient {patient_id: $patient_id})

        MERGE (p)-[:HAS_PROFILE_ITEM]->(
            pi:PatientProfileItem {
                item_id: $item_id
            }
        )

        ON CREATE SET
            pi.patient_id = $patient_id,
            pi.category = $category,
            pi.value = $item,
            pi.first_noted_document_id = $document_id,
            pi.first_noted_at = $document_date,
            pi.created_at = $now

        SET
            pi.status = $status,
            pi.detail = $detail,
            pi.last_confirmed_document_id = $document_id,
            pi.last_confirmed_at = $document_date,
            pi.updated_at = $now

        RETURN pi.item_id AS item_id
        """

        with self.driver.session() as session:

            record = session.run(
                query,
                patient_id=patient_id,
                item_id=item_id,
                category=category,
                item=item,
                status=status,
                detail=detail,
                document_id=document_id,
                document_date=(str(document_date) if document_date else None),
                now=now,
            ).single()

        return record["item_id"] if record else item_id

    # ==========================================================
    # READ — full current profile, grouped by category
    # ==========================================================

    def get_patient_profile(
        self,
        patient_id: str,
    ) -> Dict[str, List[Dict[str, Any]]]:

        query = """
        MATCH (p:Patient {patient_id: $patient_id})
              -[:HAS_PROFILE_ITEM]->
              (pi:PatientProfileItem)

        WHERE coalesce(pi.patient_id, '') = $patient_id

        RETURN
            coalesce(pi.category, '') AS category,
            coalesce(pi.value, '') AS value,
            coalesce(pi.status, '') AS status,
            coalesce(pi.detail, '') AS detail,
            coalesce(pi.first_noted_at, '') AS first_noted_at,
            coalesce(pi.updated_at, '') AS updated_at

        ORDER BY category ASC, value ASC
        """

        profile: Dict[str, List[Dict[str, Any]]] = {
            category: [] for category in self.PATIENT_PROFILE_CATEGORIES
        }

        with self.driver.session() as session:

            records = session.run(query, patient_id=patient_id)

            for record in records:
                data = dict(record)
                category = data.get("category")
                if category not in profile:
                    continue
                profile[category].append({
                    "value": data.get("value", ""),
                    "status": data.get("status", ""),
                    "detail": data.get("detail", ""),
                    "first_noted_at": data.get("first_noted_at", ""),
                    "updated_at": data.get("updated_at", ""),
                })

        return profile

    # ==========================================================
    # MAIN ENTRY POINT — call ONCE per document, from
    # process_document(). Fully independent of event_id /
    # encounter_id — safe for every document_name.
    # ==========================================================

    def update_patient_profile(
        self,
        patient_id: str,
        document_text: str,
        document_id: str,
        document_date: Optional[str],
    ) -> Dict[str, List[str]]:

        if not document_text or not document_text.strip():
            return {}

        existing = self.get_patient_profile(patient_id)
        existing_values_only = {
            category: [entry["value"] for entry in entries]
            for category, entries in existing.items()
        }

        extracted = self.extract_patient_profile_items(
            document_text=document_text,
            existing_profile=existing_values_only,
        )

        updated: Dict[str, List[str]] = {
            category: [] for category in self.PATIENT_PROFILE_CATEGORIES
        }

        for category, items in extracted.items():
            for entry in items:
                self._upsert_profile_item(
                    patient_id=patient_id,
                    category=category,
                    item=entry["item"],
                    status=entry["status"],
                    detail=entry["detail"],
                    document_id=document_id,
                    document_date=document_date,
                )
                updated[category].append(entry["item"])

        logger.info(
            "Patient profile updated: patient={} document={} categories={}",
            patient_id,
            document_id,
            {k: len(v) for k, v in updated.items() if v},
        )

        return updated