"""
Context Builder Module
Manages hierarchical context construction for clinical reasoning agents
"""

from typing import Dict, Any, List, Optional
from loguru import logger
import json


def safe_json(data: Any) -> str:
    """Safely serialize data to JSON"""
    return json.dumps(data, indent=2, default=str)


def _format_domain_index_for_prompt(domain_index: Dict[str, Any]) -> str:
    """Format domain index into readable text for prompts"""
    lines = ["AVAILABLE DATA DOMAINS:"]
    
    # Vector results
    lines.append(f"\n📊 {domain_index.get('vector_search_results', 'No data')}")
    
    # Document breakdown
    breakdown = domain_index.get('document_breakdown', {})
    if breakdown:
        lines.append("\n📁 Document Types:")
        for doc_type, subtypes in breakdown.items():
            lines.append(f"  • {doc_type}:")
            for subtype, count in subtypes.items():
                lines.append(f"    - {subtype}: {count}")
    
    # Graph relationships
    graph = domain_index.get('graph_relationships', {})
    if graph:
        lines.append("\n🔗 Knowledge Graph:")
        for key, value in graph.items():
            lines.append(f"  • {key}: {value}")
    
    # Temporal data
    temporal = domain_index.get('temporal_data', {})
    if temporal:
        lines.append("\n📈 Temporal Analysis:")
        for key, value in temporal.items():
            lines.append(f"  • {key}: {value}")
    
    return "\n".join(lines)


def _format_documents_compact(docs: List[Dict[str, Any]], max_chars: int = 2000) -> str:
    """Format documents compactly for prompts"""
    if not docs:
        return "None available"
    
    lines = []
    for i, doc in enumerate(docs[:5], 1):
        content = doc.get("content", "")[:max_chars]
        doc_type = doc.get("metadata", {}).get("subtype", "unknown")
        date = doc.get("metadata", {}).get("date", "unknown date")
        lines.append(f"{i}. [{doc_type}] ({date}): {content}...")
    
    return "\n".join(lines)


def _format_documents_detailed(docs: List[Dict[str, Any]]) -> str:
    """Format documents with full detail (for medication reconciliation)"""
    if not docs:
        return "None available"
    
    lines = []
    for i, doc in enumerate(docs, 1):
        content = doc.get("content", "")
        metadata = doc.get("metadata", {})
        lines.append(f"\n{i}. Type: {metadata.get('subtype', 'unknown')}")
        lines.append(f"   Date: {metadata.get('date', 'unknown')}")
        lines.append(f"   Content: {content}")
    
    return "\n".join(lines)


def _get_domain_specific_data(
    state: Dict[str, Any],
    domain: str,
    subdomain: Optional[str] = None,
    limit: Optional[int] = 5
) -> List[Any]:
    """Extract specific domain data from RAG context"""
    try:
        rag_structured = state.get("rag_context_structured", {})
        full_context = rag_structured.get("full_context", {})
        vector_results = full_context.get("vector_results", [])
        
        filtered = []
        for doc in vector_results:
            if not isinstance(doc, dict):
                continue
                
            metadata = doc.get("metadata", {})
            doc_type = metadata.get("type", "")
            doc_subtype = metadata.get("subtype", "")
            
            # Match domain
            if domain.lower() in doc_type.lower():
                if subdomain:
                    if subdomain.lower() in doc_subtype.lower():
                        filtered.append(doc)
                else:
                    filtered.append(doc)
        
        return filtered[:limit] if limit else filtered
        
    except Exception as e:
        logger.error(f"Domain-specific data extraction failed: {e}")
        return []

def build_differential_diagnosis_context(state: Dict[str, Any]) -> str:
    """
    Build optimized context for Differential Diagnosis Agent
    Needs: symptoms, vitals, recent labs, recent imaging
    """
    try:
        patient_id = state.get("patient_id", "unknown")
        consultation = state.get("consultation_text", "")
        
        # Get RAG context (using what actually exists in your state)
        structured = state.get("rag_context_structured", {})
        full_context = structured.get("full_context", {})

        vector_results = full_context.get("vector_results", [])
        vector_results = full_context.get("vector_results", [])
        graph_results = full_context.get("graph_results", {})
        
        # Get medical and clinical context
        medical = state.get("medical_context", {})
        clinical = state.get("clinical_context", {})
        longitudinal = state.get("longitudinal_context", {})
        
        # Build context string
        context_parts = [
            "═══════════════════════════════════════════════════════════════════",
            f"PATIENT: {patient_id}",
            "═══════════════════════════════════════════════════════════════════",
        ]
        
        # Add RAG retrieval results
        if vector_results:
            context_parts.append("\n📊 RECENT CLINICAL DATA (From RAG Retrieval):")
            context_parts.append(f"Retrieved {len(vector_results)} relevant documents\n")

            for i, doc in enumerate(vector_results[:5], 1):

                # 🔒 SAFE extraction (Document | dict)
                if hasattr(doc, "page_content"):
                    content = doc.page_content[:2000]
                    metadata = doc.metadata or {}
                elif isinstance(doc, dict):
                    content = str(doc.get("content", ""))[:2000]
                    metadata = doc.get("metadata", {})
                else:
                    content = str(doc)[:2000]
                    metadata = {}

                doc_type = metadata.get("subtype", metadata.get("type", "unknown"))

                context_parts.append(
                    f"{i}. [{doc_type.upper()}] {content}..."
                )
        else:
            context_parts.append("\n⚠️ LIMITED RAG DATA")
            context_parts.append("Note: Proceeding with available medical context\n")
        
        # Add knowledge graph data if available
        if graph_results:
            diagnoses = graph_results.get("diagnoses", [])
            if diagnoses:
                context_parts.append(f"\n🏥 KNOWN DIAGNOSES (From Knowledge Graph):")
                context_parts.append(", ".join(diagnoses[:10]))
            
            labs = graph_results.get("labs", [])
            if labs:
                context_parts.append(f"\n🧪 RECENT LABS: {len(labs)} results")
                for lab in labs[:3]:
                    context_parts.append(f"  - {lab.get('type', 'Unknown')}: {lab.get('date', 'Unknown date')}")
            
            imaging = graph_results.get("imaging", [])
            if imaging:
                context_parts.append(f"\n📸 RECENT IMAGING: {len(imaging)} studies")
                for img in imaging[:3]:
                    context_parts.append(f"  - {img.get('type', 'Unknown')}: {img.get('date', 'Unknown date')}")
        
        # Add active diagnoses from clinical context
        diagnoses = clinical.get("active_diagnoses", [])
        if diagnoses:
            context_parts.append(f"\n🩺 ACTIVE DIAGNOSES:")
            context_parts.append(", ".join(diagnoses[:10]))
        
        # Add current medications
        medications = medical.get("medications", [])

        all_prescriptions = []

        # Extract prescriptions from all medication documents
        for med_doc in medications:
            if not isinstance(med_doc, dict):
                continue

            prescriptions = (
                med_doc
                .get("finaloutput", {})
                .get("prescriptions", [])
            )

            if isinstance(prescriptions, list):
                all_prescriptions.extend(prescriptions)

        if all_prescriptions:
            context_parts.append(
                f"\n💊 CURRENT MEDICATIONS: {len(all_prescriptions)} medications"
            )

            for i, med in enumerate(all_prescriptions[:5], 1):
                name = (
                    med.get("medication")
                    or med.get("brand_name")
                    or med.get("generic_name")
                    or "Unknown"
                )

                strength = med.get("strength", "")
                frequency = med.get("frequency", "")
                route = med.get("route", "")

                details = " ".join(
                    part for part in [strength, frequency, route] if part
                )

                context_parts.append(
                    f"  {i}. {name} {details}".strip()
                )
        
        # Add vital signs if available
        vitals_list = medical.get("vital_signs", [])

        if isinstance(vitals_list, list) and vitals_list:
            latest = vitals_list[0]  # already sorted newest → oldest

            vitals = latest.get("vitals", {})

            if isinstance(vitals, dict) and vitals:
                context_parts.append("\n📈 VITAL SIGNS (Latest):")
                context_parts.append(f"  Recorded at: {latest.get('timestamp')}")

                for key, value in vitals.items():
                    if value is not None:
                        label = key.replace("_", " ").title()
                        context_parts.append(f"  - {label}: {value}")
        
        # Add laboratory summary
        labs = medical.get("laboratory_results", {})
        if labs:
            total_labs = sum(len(v) for v in labs.values() if isinstance(v, list))
            if total_labs > 0:
                context_parts.append(f"\n🧪 LABORATORY DATA: {total_labs} results available")
                for lab_type, records in labs.items():
                    if isinstance(records, list) and records:
                        context_parts.append(f"  - {lab_type.title()}: {len(records)} results")
                        # Show most recent result
                        if records:
                            latest = records[0]
                            if isinstance(latest, dict):
                                date = latest.get("report_date", latest.get("date", ""))
                                context_parts.append(f"    Latest: {date}")
        
        # Add imaging summary
        imaging = medical.get("imaging", {})
        if imaging:
            total_imaging = sum(len(v) for v in imaging.values() if isinstance(v, list))
            if total_imaging > 0:
                context_parts.append(f"\n📸 IMAGING STUDIES: {total_imaging} studies available")
                for img_type, records in imaging.items():
                    if isinstance(records, list) and records:
                        context_parts.append(f"  - {img_type.upper()}: {len(records)} studies")
        
        # Add disease trajectory
        trajectory = longitudinal.get("disease_trajectory", "unknown")
        if trajectory != "unknown":
            context_parts.append(f"\n📈 DISEASE TRAJECTORY: {trajectory.upper()}")
        
        # Add procedures
        procedures = medical.get("procedures", [])
        if procedures:
            context_parts.append(f"\n🔬 RECENT PROCEDURES: {len(procedures)} procedures documented")
        
        context_parts.append("\n═══════════════════════════════════════════════════════════════════")
        context_parts.append("\nNote: Complete patient history available in context above.")
        
        return "\n".join(context_parts)
        
    except Exception as e:
        logger.error(f"❌ Differential diagnosis context building failed: {str(e)}")
        import traceback
        logger.error(traceback.format_exc())
        
        # Return minimal context
        return f"""
═══════════════════════════════════════════════════════════════════
PATIENT: {state.get("patient_id", "unknown")}
═══════════════════════════════════════════════════════════════════

⚠️ Context building encountered errors. Using minimal available data.

CONSULTATION:
{state.get("consultation_text", "No consultation text provided")}

═══════════════════════════════════════════════════════════════════
"""



def build_medication_reconciliation_context(state: Dict[str, Any]) -> str:
    """
    Build optimized context for Medication Reconciliation Agent

    Includes:
    - Medication records from RAG (medication + clinical docs)
    - Current medications from medical_context
    - Allergies
    - Renal / hepatic function
    """

    try:
        # ─────────────────────────────────────────────────────
        # 1️⃣ STRUCTURED RAG CONTEXT
        # ─────────────────────────────────────────────────────
        structured = state.get("rag_context_structured", {})
        critical = structured.get("critical_summary", "")

        # ─────────────────────────────────────────────────────
        # 2️⃣ COLLECT MEDICATION DOCUMENTS
        # ─────────────────────────────────────────────────────
        medication_records = _get_domain_specific_data(
            state,
            domain="medical",
            subdomain="medication",
            limit=None
        )

        clinical_docs = _get_domain_specific_data(
            state,
            domain="medical",
            subdomain="document",
            limit=5
        )

        medications = medication_records + clinical_docs

        # ─────────────────────────────────────────────────────
        # 3️⃣ LOG EXACT MEDICATION INPUT (CRITICAL DEBUG POINT)
        # ─────────────────────────────────────────────────────
        logger.info(
            f"💊 Medication documents prepared | "
            f"medication_records={len(medication_records)} | "
            f"clinical_docs={len(clinical_docs)} | "
            f"total={len(medications)}"
        )

        for idx, med in enumerate(medications, 1):
            if not isinstance(med, dict):
                logger.warning(
                    f"⚠️ Medication #{idx} invalid type | type={type(med)}"
                )
                continue

            metadata = med.get("metadata", {})
            content = med.get("content", "")

            logger.info(
                f"""
💊 Medication Document #{idx}
────────────────────────────────────────
Type    : {metadata.get("type")}
Subtype : {metadata.get("subtype")}
Patient : {metadata.get("patient_id")}
Content (truncated):
{content[:800]}
────────────────────────────────────────
"""
            )

        # ─────────────────────────────────────────────────────
        # 4️⃣ MEDICAL CONTEXT (SOURCE OF TRUTH)
        # ─────────────────────────────────────────────────────
        medical_context = state.get("medical_context", {})
        current_meds = medical_context.get("medications", [])
        allergies = medical_context.get("allergies", [])

        # Renal / hepatic function (labs)
        renal_hepatic = _get_domain_specific_data(
            state,
            domain="medical",
            subdomain="biochemistry",
            limit=5
        )

        # ─────────────────────────────────────────────────────
        # 5️⃣ BUILD FINAL CONTEXT STRING
        # ─────────────────────────────────────────────────────
        context = f"""
═══════════════════════════════════════════════════════════════
MEDICATION SAFETY ASSESSMENT
═══════════════════════════════════════════════════════════════

🚨 CRITICAL CONTEXT:
{critical}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
COMPLETE MEDICATION HISTORY (RAG RECORDS)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

{_format_documents_detailed(medications)}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
CURRENT MEDICATION LIST (SOURCE OF TRUTH)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

{safe_json(current_meds) if current_meds else "No active medications documented"}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
ALLERGIES & ADVERSE REACTIONS
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

{safe_json(allergies) if allergies else "No known drug allergies documented"}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
RENAL & HEPATIC FUNCTION
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Recent Labs (Creatinine, eGFR, ALT, AST, Bilirubin):
{_format_documents_compact(renal_hepatic)}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
"""

        return context.strip()

    except Exception as e:
        logger.exception("❌ Medication reconciliation context building failed")
        return "Medication context unavailable"


def build_risk_stratification_context(state: Dict[str, Any]) -> str:
    """
    Build optimized context for Risk Stratification Agent
    Needs: vitals, disease severity, comorbidities, recent trends
    """
    try:
        structured = state.get("rag_context_structured", {})
        critical = structured.get("critical_summary", "")
        domain_idx = structured.get("domain_indices", {})
        
        # Get temporal data
        full_ctx = structured.get("full_context", {})
        temporal = full_ctx.get("temporal_results", {})
        logger.info(f"temporal:{temporal}")
        
        # Get vital signs
        vital_signs = state.get("medical_context", {}).get("vital_signs", {})
        
        # Get diagnosis and staging
        disease = state.get("differential_diagnosis", {})
        
        # Get comorbidities
        comorbidities = state.get("clinical_context", {}).get("active_diagnoses", [])
        
        context = f"""
═══════════════════════════════════════════════════════════════
RISK ASSESSMENT DATA
═══════════════════════════════════════════════════════════════

🚨 CRITICAL FINDINGS:
{critical}

📊 DATA AVAILABILITY:
{_format_domain_index_for_prompt(domain_idx)}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
CURRENT CLINICAL STATUS
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Vital Signs:
{safe_json(vital_signs) if vital_signs else "No current vitals"}

Active Comorbidities:
{', '.join(comorbidities[:10]) if comorbidities else "None documented"}

Working Diagnosis:
{safe_json(disease.get("most_likely_diagnoses", [])[:3]) if disease else "Pending differential diagnosis"}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
TEMPORAL TRENDS
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

{safe_json(temporal) if temporal else "No temporal trend data available"}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
"""
        return context
        
    except Exception as e:
        logger.error(f"Risk stratification context building failed: {e}")
        return "Risk context unavailable"


def build_treatment_validation_context(state: Dict[str, Any]) -> str:
    """
    Build context for Treatment Validation Agent
    Needs: diagnosis, staging, comorbidities, current medications
    """
    try:
        structured = state.get("rag_context_structured", {})
        logger.info(f"treatment structured:{structured}")
        critical = structured.get("critical_summary", "")
        
        # Get diagnosis
        diagnosis = state.get("differential_diagnosis", {})
        
        # Get risk assessment
        risk = state.get("risk_stratification", {})
        
        # Get current medications
        medications = state.get("medication_reconciliation", {})
        
        # Get comorbidities
        comorbidities = state.get("clinical_context", {}).get("active_diagnoses", [])
        
        context = f"""
═══════════════════════════════════════════════════════════════
TREATMENT PLANNING DATA
═══════════════════════════════════════════════════════════════

🚨 CRITICAL CONTEXT:
{critical}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
WORKING DIAGNOSIS
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

{safe_json(diagnosis.get("most_likely_diagnoses", [])[:3]) if diagnosis else "Pending"}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
RISK ASSESSMENT
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

{safe_json(risk) if risk else "Risk assessment pending"}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
CURRENT MEDICATIONS
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

{safe_json(medications.get("reconciled_medication_list", [])) if medications else "Medication reconciliation pending"}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
COMORBIDITIES
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

{', '.join(comorbidities) if comorbidities else "None documented"}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
"""
        return context
        
    except Exception as e:
        logger.error(f"Treatment validation context building failed: {e}")
        return "Treatment context unavailable"


def build_discharge_readiness_context(state: Dict[str, Any]) -> str:
    """
    Build context for Discharge Readiness Agent
    Needs: comprehensive view of current status and plan
    """
    try:
        structured = state.get("rag_context_structured", {})
        critical = structured.get("critical_summary", "")
        domain_idx = structured.get("domain_indices", {})
        
        # Get all agent outputs
        diagnosis = state.get("differential_diagnosis", {})
        medications = state.get("medication_reconciliation", {})
        risk = state.get("risk_stratification", {})
        treatment = state.get("treatment_validation", {})
        deterioration = state.get("clinical_deterioration_warning", {})
        
        context = f"""
═══════════════════════════════════════════════════════════════
DISCHARGE PLANNING ASSESSMENT
═══════════════════════════════════════════════════════════════

🚨 CRITICAL STATUS:
{critical}

📊 PATIENT DATA SUMMARY:
{_format_domain_index_for_prompt(domain_idx)}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
CLINICAL STATUS
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Diagnosis:
{safe_json(diagnosis.get("most_likely_diagnoses", [])[:2]) if diagnosis else "Pending"}

Clinical Stability:
{safe_json(deterioration) if deterioration else "Assessment pending"}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
TREATMENT PLAN
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

{safe_json(treatment) if treatment else "Treatment plan pending"}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
MEDICATION PLAN
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

{safe_json(medications.get("transition_of_care_plan", {})) if medications else "Medication plan pending"}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
RISK ASSESSMENT
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

{safe_json(risk.get("overall_risk_category", {})) if risk else "Risk assessment pending"}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
"""
        return context
        
    except Exception as e:
        logger.error(f"Discharge readiness context building failed: {e}")
        return "Discharge context unavailable"
    
    
    

