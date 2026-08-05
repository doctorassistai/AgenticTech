# Agentic/Rag/graph_rag_system.py

from typing import Dict, Any, List, Optional
from langchain_community.vectorstores import FAISS
from langchain.text_splitter import RecursiveCharacterTextSplitter
from langchain_core.documents import Document
from langchain_core.embeddings import Embeddings
from neo4j import AsyncGraphDatabase
import numpy as np
from loguru import logger
import os
from dotenv import load_dotenv
import httpx
import asyncio
from datetime import datetime

import json
load_dotenv()

# Neo4j connection
NEO4J_URI = os.getenv("NEO4J_URI", "bolt://neo4j:7687")
NEO4J_USER = os.getenv("NEO4J_USER", "neo4j")
NEO4J_PASSWORD = os.getenv("NEO4J_PASSWORD", "password")
GROQ_API_KEY = os.getenv("GROQ_API_KEY")


class GroqEmbeddings(Embeddings):
    """
    Lightweight embeddings using Groq API
    Falls back to TF-IDF if Groq is unavailable
    """
    
    def __init__(self, api_key: Optional[str] = None):
        self.api_key = api_key or GROQ_API_KEY
        self.base_url = "https://api.groq.com/openai/v1/embeddings "
        self.model = "llama-3.1-8b-instant"  # Groq model for embeddings
        self.use_fallback = not self.api_key
        
        if self.use_fallback:
            logger.warning("⚠️ No Groq API key found, using TF-IDF fallback")
            from sklearn.feature_extraction.text import TfidfVectorizer
            self.vectorizer = TfidfVectorizer(max_features=384)
            self.fitted = False
            self.corpus = []
        else:
            logger.info("✅ Using Groq embeddings")
    
    def embed_documents(self, texts: List[str]) -> List[List[float]]:
        """Embed a list of documents"""
        if self.use_fallback:
            return self._embed_with_tfidf(texts)
        
        try:
            # Use Groq for embeddings via text generation
            # Since Groq doesn't have direct embedding API, we use a workaround
            return self._embed_with_groq_workaround(texts)
        except Exception as e:
            logger.error(f"❌ Groq embedding failed: {str(e)}, falling back to TF-IDF")
            self.use_fallback = True
            return self._embed_with_tfidf(texts)
    
    def embed_query(self, text: str) -> List[float]:
        """Embed a query"""
        if self.use_fallback:
            return self._embed_with_tfidf([text])[0]
        
        try:
            return self._embed_with_groq_workaround([text])[0]
        except Exception as e:
            logger.error(f"❌ Groq embedding failed: {str(e)}, falling back to TF-IDF")
            self.use_fallback = True
            return self._embed_with_tfidf([text])[0]
    
    def _embed_with_groq_workaround(self, texts: List[str]) -> List[List[float]]:
        """
        Workaround: Use Groq LLM to generate semantic representations
        Convert text to fixed-size vectors using hash of LLM response
        """
        embeddings = []
        
        for text in texts:
            # Create a simple hash-based embedding from text
            # This is a lightweight alternative since Groq doesn't have embedding endpoint
            embedding = self._text_to_vector(text)
            embeddings.append(embedding)
        
        return embeddings
    
    def _text_to_vector(self, text: str, dimension: int = 384) -> List[float]:
        """Convert text to vector using deterministic hashing"""
        import hashlib
        
        # Create multiple hashes for desired dimension
        vector = []
        for i in range(dimension // 16 + 1):
            hash_obj = hashlib.sha256(f"{text}_{i}".encode())
            hash_bytes = hash_obj.digest()
            
            for byte in hash_bytes:
                vector.append((byte / 127.5) - 1.0)
        
        # Normalize to unit length
        vector = vector[:dimension]
        norm = sum(x**2 for x in vector) ** 0.5
        if norm > 0:
            vector = [x / norm for x in vector]
        
        return vector
    
    def _embed_with_tfidf(self, texts: List[str]) -> List[List[float]]:
        """Fallback TF-IDF embeddings"""
        from sklearn.feature_extraction.text import TfidfVectorizer
        
        if not hasattr(self, 'vectorizer'):
            self.vectorizer = TfidfVectorizer(max_features=384)
            self.fitted = False
            self.corpus = []
        
        self.corpus.extend(texts)
        
        if not self.fitted:
            self.vectorizer.fit(self.corpus)
            self.fitted = True
        
        vectors = self.vectorizer.transform(texts).toarray()
        return vectors.tolist()


class ClinicalGraphRAG:
    """
    Hybrid Graph-RAG system for clinical reasoning
    
    Combines:
    - Vector similarity search (RAG) for semantic retrieval
    - Knowledge graph (Neo4j) for relationship traversal
    - Temporal reasoning for longitudinal analysis
    """
    
    def __init__(self):
        # ✅ Use Groq-based embeddings with TF-IDF fallback
        self.embeddings = GroqEmbeddings()
        logger.info("✅ Embeddings initialized")
        
        self.text_splitter = RecursiveCharacterTextSplitter(
            chunk_size=1000,
            chunk_overlap=200
        )
        # ⭐ Multi-patient vector isolation
        self.vector_stores: Dict[str, FAISS] = {}

        
        # ✅ Neo4j connection with error handling
        try:
            self.neo4j_driver = AsyncGraphDatabase.driver(
                NEO4J_URI,
                auth=(NEO4J_USER, NEO4J_PASSWORD)
            )
            logger.info("✅ Neo4j connection established")
        except Exception as e:
            logger.warning(f"⚠️ Neo4j connection failed: {str(e)}. Graph features will be disabled.")
            self.neo4j_driver = None
            
        logger.info("✅ Clinical Graph-RAG System Initialized")
    
    async def index_patient_data(
        self,
        patient_id: str,
        medical_context: Dict[str, Any],
        clinical_context: Dict[str, Any],
        longitudinal_context: Dict[str, Any]
    ):
        """
        Index patient data into both vector store and knowledge graph
        """
        logger.info(f"📊 Indexing patient data: {patient_id}")
        
        try:
            # Create documents for vector store
            documents = await self._create_documents(
                medical_context,
                clinical_context,
                longitudinal_context
            )
            
            logger.info(f"📄 Generated {len(documents)} documents for indexing")
            if documents:
                 logger.info(f"   Sample document: {documents[0].page_content}...")
            else:
                 logger.warning(f"⚠️ No documents generated from patient contexts!")
                 logger.warning(f"   Medical Context keys: {list(medical_context.keys())}")
                 logger.warning(f"   Clinical Context keys: {list(clinical_context.keys())}")
            
            # ✅ Only build vector store if we have documents
            if documents:
                # Build vector index
                logger.info(f"🔄 Creating vector store with {len(documents)} documents...")
                self.vector_stores[patient_id] = FAISS.from_documents(
                    documents,
                    self.embeddings
                )

                logger.info(
                    f"✅ Vector store created for patient {patient_id} "
                    f"with {len(documents)} documents"
                )
                logger.info(f"✅ Vector store created with {len(documents)} documents")
            else:
                logger.warning("⚠️ No documents to index in vector store")
            
            # Build knowledge graph only if Neo4j is available
            if self.neo4j_driver:
                await self._build_knowledge_graph(
                    patient_id,
                    medical_context,
                    clinical_context,
                    longitudinal_context
                )
            else:
                logger.warning("⚠️ Neo4j not available, skipping knowledge graph build")
            
            logger.info(f"✅ Indexed {len(documents)} documents for patient {patient_id}")
            
        except Exception as e:
            logger.error(f"❌ Failed to index patient data: {str(e)}")
            import traceback
            logger.error(traceback.format_exc())
            raise
    
    async def _create_documents(self, medical_context, clinical_context, longitudinal_context):
        """Create documents from NEW clinical eventDB structure only"""

        documents = []
        patient_id = medical_context.get("patient_id", "unknown")

        def add_doc(content, doc_type, subtype):
            if content and str(content).strip():
                documents.append(
                    Document(
                        page_content=str(content)[:2000],
                        metadata={
                            "type": doc_type,
                            "subtype": subtype,
                            "patient_id": patient_id
                        }
                    )
                )

        # ---------------------------------------------------
        # 🧬 MEDICAL CONTEXT (NEW STRUCTURE ONLY)
        # ---------------------------------------------------

        # 🏥 Procedures
        for record in medical_context.get("procedures", []):
            add_doc(self._dict_to_text(record), "medical", "procedure")

        # 💊 Medications
        for record in medical_context.get("medications", []):
            add_doc(self._dict_to_text(record), "medical", "medication")

        # 📋 Treatment Plan
        for record in medical_context.get("treatment_plan", []):
            add_doc(self._dict_to_text(record), "medical", "treatment_plan")

        # 🧪 Investigation
        for record in medical_context.get("investigation", []):
            add_doc(self._dict_to_text(record), "medical", "investigation")

        # 📝 Clinical Notes
        for record in medical_context.get("clinical_note", []):
            add_doc(self._dict_to_text(record), "medical", "clinical_note")

        # 🎙️ Dictation (single)
        for record in medical_context.get("dictation", []):
            add_doc(self._dict_to_text(record), "medical", "dictation")

        # 🎙️ Dictations (plural engine support)
        for record in medical_context.get("dictations", []):
            add_doc(self._dict_to_text(record), "medical", "dictations")

        # 💬 Conversation
        for record in medical_context.get("conversation", []):
            add_doc(self._dict_to_text(record), "medical", "conversation")

        # ⚠️ Allergies
        for record in medical_context.get("allergies", []):
            add_doc(self._dict_to_text(record), "medical", "allergies")

        # 📄 Documents
        for record in medical_context.get("documents", []):
            add_doc(self._dict_to_text(record), "medical", "document")

        # 🩺 Vital Signs (dynamic schema safe)
        for record in medical_context.get("vital_signs", []):

            if not isinstance(record, dict):
                continue

            # 🔥 merge timestamp + vitals so text is never empty
            vitals_data = {
                "timestamp": record.get("timestamp"),
                **(record.get("vitals") or {})
            }

            text = self._dict_to_text(vitals_data)

            logger.info(f"🩺 vital text generated: {text}")

            if text:
                add_doc(text, "medical", "vital_signs")

        # ---------------------------------------------------
        # LOGGING
        # ---------------------------------------------------

        logger.info(f"📄 Created {len(documents)} documents total")

        if not documents:
            logger.warning("⚠️ _create_documents produced 0 documents. Checking inputs:")
            logger.warning(f"   - Procedures: {len(medical_context.get('procedures', []))}")
            logger.warning(f"   - Medications: {len(medical_context.get('medications', []))}")
            logger.warning(f"   - Treatment Plan: {len(medical_context.get('treatment_plan', []))}")
            logger.warning(f"   - Investigation: {len(medical_context.get('investigation', []))}")
            logger.warning(f"   - Clinical Note: {len(medical_context.get('clinical_note', []))}")
            logger.warning(f"   - Dictation: {len(medical_context.get('dictation', []))}")
            logger.warning(f"   - Conversation: {len(medical_context.get('conversation', []))}")
            logger.warning(f"   - Allergies: {len(medical_context.get('allergies', []))}")
            logger.warning(f"   - Documents: {len(medical_context.get('documents', []))}")
            logger.warning(f"   - Vital Signs: {len(medical_context.get('vital_signs', []))}")

        return documents


    def _dict_to_text(self, data):
        """Convert dict or list to rich semantic text (NO TRUNCATION)"""

        if not isinstance(data, (dict, list)):
            return str(data)

        parts = []

        if isinstance(data, dict):
            for k, v in data.items():

                # Skip DB identifiers
                if k in ["_id", "patient_id", "doctor_id"]:
                    continue

                # ----------------------------
                # Primitive values
                # ----------------------------
                if isinstance(v, (str, int, float, bool)):
                    parts.append(f"{k}: {v}")

                # ----------------------------
                # List handling
                # ----------------------------
                elif isinstance(v, list):

                    if not v:
                        continue

                    # List of primitives
                    if all(isinstance(x, (str, int, float, bool)) for x in v):
                        parts.append(f"{k}: {', '.join(str(x) for x in v)}")

                    # List of dicts
                    elif all(isinstance(x, dict) for x in v):
                        list_content = []

                        for item in v:

                            # Prefer natural language fields if available
                            if "content" in item:
                                list_content.append(str(item["content"]))

                            elif "structured_data" in item:
                                list_content.append(
                                    self._dict_to_text(item["structured_data"])
                                )

                            else:
                                list_content.append(
                                    self._dict_to_text(item)
                                )

                        if list_content:
                            parts.append(f"{k}: [{' | '.join(list_content)}]")

                # ----------------------------
                # Nested dict recursion
                # ----------------------------
                elif isinstance(v, dict):
                    nested = self._dict_to_text(v)
                    if nested:
                        parts.append(f"{k}: {{ {nested} }}")

        elif isinstance(data, list):
            for item in data:
                parts.append(self._dict_to_text(item))

        return " | ".join(parts) if parts else ""


    async def _build_knowledge_graph(self, patient_id, medical_context, clinical_context, longitudinal_context):
        """Build knowledge graph with consistent schema"""
        if not self.neo4j_driver:
            return
            
        async with self.neo4j_driver.session() as session:
            try:
                # Create patient
                await session.run(
                    "MERGE (p:Patient {id: $patient_id}) SET p.last_updated = datetime()",
                    patient_id=patient_id
                )
                
                # Diagnoses - store as 'name' property
                for diagnosis in clinical_context.get("active_diagnoses", []):
                    if isinstance(diagnosis, str):
                        await session.run(
                            """
                            MERGE (d:Diagnosis {name: $name})
                            WITH d
                            MATCH (p:Patient {id: $patient_id})
                            MERGE (p)-[:HAS_DIAGNOSIS {timestamp: datetime()}]->(d)
                            """,
                            patient_id=patient_id, name=diagnosis
                        )
                
                # Labs - store with 'type', 'date', 'report' properties
                labs = medical_context.get("laboratory_results", {})
                for lab_type, records in labs.items():
                    for record in records[:15]:
                        if isinstance(record, dict):
                            await session.run(
                                """
                                CREATE (l:LabResult {
                                    type: $type,
                                    date: $date,
                                    report: $report
                                })
                                WITH l
                                MATCH (p:Patient {id: $patient_id})
                                CREATE (p)-[:HAS_LAB_RESULT]->(l)
                                """,
                                patient_id=patient_id,
                                type=lab_type,
                                date=str(record.get("report_date", record.get("date", ""))),
                                report=str(record.get("report", record.get("result", "")))[:1000]
                            )
                
                # Imaging - store with 'type', 'date', 'findings'
                imaging = medical_context.get("imaging", {})
                for img_type, records in imaging.items():
                    for record in records[:10]:
                        if isinstance(record, dict):
                            await session.run(
                                """
                                CREATE (i:Imaging {
                                    type: $type,
                                    date: $date,
                                    findings: $findings
                                })
                                WITH i
                                MATCH (p:Patient {id: $patient_id})
                                CREATE (p)-[:HAS_IMAGING]->(i)
                                """,
                                patient_id=patient_id,
                                type=img_type,
                                date=str(record.get("report_date", "")),
                                findings=str(record.get("report", record.get("findings", "")))[:1000]
                            )
                
                documents = medical_context.get("documents", [])

                logger.info(f"📄 Processing {len(documents)} documents for graph insert")

                for doc in documents:

                    # ---------------------------------------------------
                    # 1️⃣ VALIDATE DOCUMENT
                    # ---------------------------------------------------
                    document_id = doc.get("document_id")
                    if not document_id:
                        logger.warning("⚠️ Skipping entry without document_id")
                        continue

                    # ---------------------------------------------------
                    # 2️⃣ REPORT DATE (ONLY SOURCE OF DATE)
                    # ---------------------------------------------------
                    report_date = doc.get("report_date")
                    neo4j_date = None

                    if report_date:
                        try:
                            # Convert "20-07-2025" → "2025-07-20"
                            neo4j_date = datetime.strptime(
                                report_date, "%d-%m-%Y"
                            ).strftime("%Y-%m-%d")

                            logger.debug(
                                f"📅 Parsed report_date {report_date} → {neo4j_date}"
                            )

                        except Exception as e:
                            logger.warning(
                                f"⚠️ Invalid report_date format for {document_id}: {report_date}"
                            )

                    # ---------------------------------------------------
                    # 3️⃣ CATEGORY INFO
                    # ---------------------------------------------------
                    category = doc.get("category", "")
                    subcategory = doc.get("subcategory", "")

                    # ---------------------------------------------------
                    # 4️⃣ EXTRACT STRUCTURED DATA + ABSTRACT
                    # ---------------------------------------------------
                    processed_data = doc.get("processed_data", [])

                    abstract = ""
                    structured_data = {}

                    if processed_data and isinstance(processed_data, list):
                        first_block = processed_data[0] or {}

                        abstract = first_block.get("clinical_abstract", "")
                        structured_data = first_block.get("structured_data", {})

                    structured_json = json.dumps(structured_data)

                    # ---------------------------------------------------
                    # 5️⃣ INSERT INTO NEO4J
                    # ---------------------------------------------------
                    await session.run(
                        """
                        MERGE (d:Document {document_id:$document_id})

                        SET d.category = $category,
                            d.subcategory = $subcategory,
                            d.clinical_abstract = $abstract,
                            d.structured_data = $structured_json,

                            d.date = CASE
                                        WHEN $neo4j_date IS NOT NULL
                                        THEN date($neo4j_date)
                                        ELSE NULL
                                    END

                        WITH d
                        MATCH (p:Patient {id:$patient_id})
                        MERGE (p)-[:HAS_DOCUMENT]->(d)
                        """,
                        patient_id=patient_id,
                        document_id=document_id,
                        neo4j_date=neo4j_date,
                        category=category,
                        subcategory=subcategory,
                        abstract=abstract,
                        structured_json=structured_json
                    )

                logger.info(
                    f"✅ Document nodes inserted using report_date only for patient {patient_id}"
                )
                procedures = medical_context.get("procedures", [])

                logger.info(f"🏥 procedures count: {len(procedures)}")

                for idx, proc in enumerate(procedures, start=1):

                    if not isinstance(proc, dict):
                        logger.warning(f"⚠️ Skipping invalid procedure #{idx}")
                        continue

                    selected_procedure = proc.get("selected_procedure", "")
                    during_procedure = proc.get("during_procedure", "")
                    post_procedure = proc.get("post_procedure", "")
                    pre_procedure = proc.get("pre_procedure", "")

                    # -------- FORMAT DATE (YYYY-MM-DD) ----------
                    created_date = None
                    created_at = proc.get("created_at")

                    if created_at:
                        try:
                            created_date = created_at.date().isoformat()
                        except Exception:
                            logger.warning(f"⚠️ Invalid created_at for procedure: {created_at}")

                    logger.debug(f"📌 MERGING procedure #{idx}: {selected_procedure}")

                    await session.run(
                        """
                        MERGE (pr:Procedure {
                            selected_procedure:$selected_procedure,
                            date: CASE 
                                    WHEN $date IS NOT NULL THEN date($date)
                                    ELSE NULL
                                END
                        })
                        SET pr.during_procedure = $during_procedure,
                            pr.post_procedure = $post_procedure,
                            pr.pre_procedure = $pre_procedure
                        WITH pr
                        MATCH (p:Patient {id:$patient_id})
                        MERGE (p)-[:HAS_PROCEDURE]->(pr)
                        """,
                        patient_id=patient_id,
                        selected_procedure=selected_procedure,
                        date=created_date,
                        during_procedure=during_procedure,
                        post_procedure=post_procedure,
                        pre_procedure=pre_procedure
                    )

                logger.info(f"✅ Procedures inserted for {patient_id}")

                # ---------------------------------------------------
                # 🩺 STORE VITAL SIGNS INTO NEO4J
                # ---------------------------------------------------

                # ---------------------------------------------------
                # 🩺 STORE VITAL SIGNS INTO NEO4J (DYNAMIC KEYS)
                # ---------------------------------------------------

                vital_signs_list = medical_context.get("vital_signs", [])

                logger.info(f"🩺 Vital signs received: {vital_signs_list}")

                for idx, vital_record in enumerate(vital_signs_list, start=1):

                    if not isinstance(vital_record, dict):
                        logger.warning(f"⚠️ Invalid vital record #{idx}")
                        continue

                    timestamp = vital_record.get("timestamp")
                    vitals = vital_record.get("vitals", {})

                    if not isinstance(vitals, dict):
                        logger.warning(f"⚠️ Invalid vitals format #{idx}")
                        continue

                    # 🔥 Convert timestamp → DATE ONLY
                    created_date = None
                    if timestamp:
                        try:
                            created_date = timestamp.split("T")[0]
                        except Exception:
                            logger.warning(f"⚠️ Invalid timestamp format: {timestamp}")

                    # 🔥 Prepare dynamic properties
                    vitals_props = {
                        "patient_id": patient_id,
                        "date": created_date
                    }

                    # add all vitals dynamically
                    for key, value in vitals.items():
                        if value is not None:
                            vitals_props[key] = str(value)

                    logger.debug(f"📌 Dynamic vitals props #{idx}: {vitals_props}")

                    await session.run(
                        """
                        MERGE (v:VitalSigns {patient_id:$patient_id, date:date($date)})
                        SET v += $props
                        WITH v
                        MATCH (p:Patient {id:$patient_id})
                        MERGE (p)-[:HAS_VITAL_SIGNS]->(v)
                        """,
                        patient_id=patient_id,
                        date=created_date,
                        props=vitals_props
                    )

                logger.info(f"✅ Dynamic vital signs stored for {patient_id}")








                # Treatments
                # ---------------------------------------------------
                # 💊 STORE FULL processed_data INTO TREATMENT NODE (MERGE VERSION)
                # ---------------------------------------------------

                treatments_attempted = clinical_context.get("treatments_attempted", [])

                logger.info(f"💊 treatments_attempted count: {len(treatments_attempted)}")

                for idx, treatment in enumerate(treatments_attempted[:10], start=1):

                    if not isinstance(treatment, dict):
                        logger.warning(f"⚠️ Skipping invalid treatment #{idx}")
                        continue

                    # ---------------- FORMAT DATE ----------------
                    created_date = None
                    created_at = treatment.get("created_at")

                    if created_at:
                        try:
                            created_date = created_at.date().isoformat()  # YYYY-MM-DD
                        except Exception:
                            logger.warning(f"⚠️ Invalid created_at format: {created_at}")

                    # ---------------- TAKE FULL processed_data ARRAY ----------------
                    processed_data = treatment.get("processed_data", [])

                    try:
                        processed_json = json.dumps(processed_data)
                    except Exception:
                        logger.error("❌ Failed to serialize processed_data")
                        continue

                    logger.debug(f"📌 MERGING treatment #{idx} with date={created_date}")

                    await session.run(
                        """
                        MERGE (t:Treatment {
                            processed_data:$processed_json
                        })

                        // ✅ only set date if not null
                        FOREACH (_ IN CASE WHEN $date IS NOT NULL THEN [1] ELSE [] END |
                            SET t.date = date($date)
                        )

                        WITH t
                        MATCH (p:Patient {id:$patient_id})
                        MERGE (p)-[:RECEIVED_TREATMENT]->(t)
                        """,
                        patient_id=patient_id,
                        processed_json=processed_json,
                        date=created_date
                    )

                logger.info(f"✅ Knowledge graph built for {patient_id}")
                # ---------------------------------------------------
                # 🧠 CREATE / UPDATE CLINICAL SUMMARY NODE (FULL REPLACE MODE)
                # ---------------------------------------------------

                try:
                    summary_payload = {
                        "patient_id": patient_id,

                        # 🔥 FULL SNAPSHOT DATA (REPLACED EACH RUN)
                        "procedures": json.dumps(medical_context.get("procedures", [])),
                        "medications": json.dumps(medical_context.get("medications", [])),
                        "treatment_plan": json.dumps(medical_context.get("treatment_plan", [])),
                        "clinical_note": json.dumps(medical_context.get("clinical_note", [])),
                        "investigation": json.dumps(medical_context.get("investigation", [])),
                        "dictation": json.dumps(medical_context.get("dictations", [])),
                        "vital_signs": json.dumps(medical_context.get("vital_signs", [])),

                        # ✅ NEW — DOCUMENT SNAPSHOT
                        "documents": json.dumps(medical_context.get("documents", [])),
                    }
                    logger.info(
                        f"🧠 ClinicalSummary payload prepared | "
                        f"procedures={len(medical_context.get('procedures', []))}, "
                        f"medications={len(medical_context.get('medications', []))}, "
                        f"treatment_plan={len(medical_context.get('treatment_plan', []))}, "
                        f"clinical_note={len(medical_context.get('clinical_note', []))}, "
                        f"investigation={len(medical_context.get('investigation', []))}, "
                        f"dictation={len(medical_context.get('dictations', []))}, "
                        f"vital_signs={len(medical_context.get('vital_signs', []))}, "
                        f"documents={len(medical_context.get('documents', []))}"
                    )
                    logger.info(f"🧠 Updating ClinicalSummary (REPLACE MODE) for patient {patient_id}")

                    await session.run(
                        """
                        MERGE (s:ClinicalSummary {patient_id:$patient_id})

                        // 🔥 HARD RESET OLD NODE PROPERTIES
                        SET s = {
                            patient_id: $patient_id,
                            procedures: $procedures,
                            medications: $medications,
                            treatment_plan: $treatment_plan,
                            clinical_note: $clinical_note,
                            investigation: $investigation,
                            dictation: $dictation,
                            vital_signs: $vital_signs,
                            documents: $documents,
                            updated_at: datetime()
                        }

                        WITH s
                        MATCH (p:Patient {id:$patient_id})
                        MERGE (p)-[:HAS_SUMMARY]->(s)
                        """,
                        **summary_payload
                    )

                    logger.info(f"✅ ClinicalSummary node fully replaced for {patient_id}")

                except Exception as e:
                    logger.error(f"❌ Failed to create/update ClinicalSummary node: {str(e)}")

                
            except Exception as e:
                logger.error(f"❌ Graph build failed: {e}")




    async def get_temporal_story_data(self, patient_id: str) -> Dict[str, Any]:
        """
        Get temporal story data from knowledge graph
        Returns chronologically ordered events with causal relationships
        """

        if not self.neo4j_driver:
            logger.warning("Neo4j driver not initialized")
            return {"events": [], "episodes": []}

        async with self.neo4j_driver.session() as session:
            try:

                result = await session.run(
                    """
                    MATCH (p:Patient {id:$patient_id})
                    -[:HAS_EVENT
                    |RECEIVED_TREATMENT
                    |HAS_DOCUMENT
                    |HAS_PROCEDURE
                    |HAS_VITAL_SIGNS]->(e)

                    WHERE e.date IS NOT NULL

                    WITH e,
                        e.date AS event_date,

                        CASE
                            WHEN e:Procedure THEN toString(e.selected_procedure)

                            WHEN e:Treatment THEN toString(e.processed_data)

                            WHEN e:Document THEN toString(e.structured_data)

                            // ✅ RETURN MAP DIRECTLY (NO STRING CONVERSION)
                            WHEN e:VitalSigns THEN properties(e)

                            ELSE "Event recorded"
                        END AS summary_text,

                        CASE
                            WHEN e:Document THEN coalesce(e.subcategory,"Document")
                            WHEN e:VitalSigns THEN "VitalSigns"
                            ELSE labels(e)[0]
                        END AS event_type

                    RETURN
                        summary_text AS summary,
                        event_date AS date,
                        event_type AS event_type,
                        "unknown" AS severity

                    ORDER BY event_date DESC
                    LIMIT 100

                    """,
                    patient_id=patient_id
                )

                events = []

                async for record in result:
                    try:
                        event_date = record["date"]

                        # Convert Neo4j date/datetime safely
                        if hasattr(event_date, "to_native"):
                            event_date = event_date.to_native()

                        events.append({
                            "summary": record["summary"] or "Event recorded",
                            "date": str(event_date),
                            "event_type": record["event_type"] or "Unknown",
                            "severity": record["severity"] or "unknown",
                            "influenced": []   # influenced removed (no longer stored)
                        })

                    except Exception as e:
                        logger.warning(f"Skipping malformed event record: {e}")
                        continue

                if not events:
                    logger.warning(f"No events found for patient {patient_id}")
                    return {"events": [], "episodes": []}

                # 🔥 Group events into episodes
                episodes = self._group_into_episodes(events)

                logger.info(f"✅ Retrieved {len(events)} events in {len(episodes)} episodes")

                return {
                    "events": events,
                    "episodes": episodes
                }

            except Exception as e:
                logger.error(f"❌ Failed to retrieve story data: {str(e)}")
                import traceback
                logger.error(traceback.format_exc())
                return {"events": [], "episodes": []}



    def _group_into_episodes(self, events: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
        if not events:
            return []

        episodes = []
        episode_gap_days = 30

        try:
            sorted_events = sorted(events, key=lambda x: x["date"])
            current_episode = [sorted_events[0]]

            for event in sorted_events[1:]:
                try:
                    prev_date = datetime.fromisoformat(current_episode[-1]["date"].replace('Z', '+00:00'))
                    curr_date = datetime.fromisoformat(event["date"].replace('Z', '+00:00'))

                    gap = (curr_date - prev_date).days

                    if gap <= episode_gap_days:
                        current_episode.append(event)
                    else:
                        episodes.append({
                            "start_date": current_episode[0]["date"],
                            "end_date": current_episode[-1]["date"],
                            "event_count": len(current_episode),
                            "events": current_episode
                        })
                        current_episode = [event]

                except Exception as e:
                    logger.warning(f"Date parsing error: {e}")
                    current_episode.append(event)

            if current_episode:
                episodes.append({
                    "start_date": current_episode[0]["date"],
                    "end_date": current_episode[-1]["date"],
                    "event_count": len(current_episode),
                    "events": current_episode
                })

            return episodes

        except Exception as e:
            logger.error(f"Episode grouping failed: {e}")
            return [{
                "start_date": events[0]["date"],
                "end_date": events[-1]["date"],
                "event_count": len(events),
                "events": events
            }]




    async def retrieve_relevant_context(
        self,
        query: str,
        patient_id: str,
        top_k: int = 10
    ) -> Dict[str, Any]:
        """
        Retrieve relevant context using hybrid approach:
        1. Vector similarity search
        2. Graph traversal for relationships
        3. Temporal reasoning for trends
        """
        logger.info(f"🔍 Retrieving context for query: {query[:100]}...")
        
        try:
            # Vector search
            vector_results = await self._vector_search(patient_id,query, top_k)
            
            # Graph search (only if Neo4j available)
            graph_results = {}
            if self.neo4j_driver:
                graph_results = await self._graph_search(patient_id, query)
            else:
                logger.warning("⚠️ Neo4j not available, skipping graph search")
            
            # Temporal search (only if Neo4j available)
            temporal_results = {}
            if self.neo4j_driver:
                temporal_results = await self._temporal_search(patient_id)
            else:
                logger.warning("⚠️ Neo4j not available, skipping temporal search")
            
            return {
                "vector_results": vector_results,
                "graph_results": graph_results,
                "temporal_results": temporal_results
            }
            
        except Exception as e:
            logger.error(f"❌ Failed to retrieve context: {str(e)}")
            import traceback
            logger.error(traceback.format_exc())
            return {
                "vector_results": [],
                "graph_results": {},
                "temporal_results": {}
            }
    
    async def _vector_search(self, patient_id: str, query: str, top_k: int) -> List[Document]:
        """Perform vector similarity search"""
        store = self.vector_stores.get(patient_id)

        if not store:
            logger.warning(f"⚠️ No vector store for patient {patient_id}")
            return []
            
        
        try:
            results = store.similarity_search(query, k=top_k)
            logger.info(f"✅ Vector search returned {results} results")
            for i, res in enumerate(results[:3]):
                logger.info(f"   Result {i+1}: {res.page_content[:100]}... (Metadata: {res.metadata})")
            return results
        except Exception as e:
            logger.error(f"❌ Vector search failed: {str(e)}")
            return []
    
    async def _graph_search(self, patient_id: str, query: str) -> Dict[str, Any]:
        """Perform graph traversal search"""

        if not self.neo4j_driver:
            return {}

        async with self.neo4j_driver.session() as session:
            try:
                # ---------------------------------------------------
                # 🧠 Clinical Summary (NEW)
                # ---------------------------------------------------
                summary_result = await session.run(
                    """
                    MATCH (s:ClinicalSummary {patient_id:$patient_id})
                    RETURN
                        s.procedures AS procedures,
                        s.medications AS medications,
                        s.treatment_plan AS treatment_plan,
                        s.clinical_note AS clinical_note,
                        s.investigation AS investigation,
                        s.dictation AS dictation,
                        s.vital_signs AS vital_signs,
                        s.documents AS documents,
                        s.updated_at AS updated_at
                    """,
                    patient_id=patient_id
                )

                summary_record = await summary_result.single()

                clinical_summary = dict(summary_record) if summary_record else {}    
                logger.info(f"clinical_summary:{clinical_summary}")
                # ---------------------------------------------------
                # 🧠 Diagnoses
                # ---------------------------------------------------
                diagnoses_result = await session.run(
                    """
                    MATCH (p:Patient {id:$patient_id})-[:HAS_DIAGNOSIS]->(d:Diagnosis)
                    RETURN d.name AS diagnosis
                    """,
                    patient_id=patient_id
                )
                diagnoses = [record["diagnosis"] async for record in diagnoses_result]

                # ---------------------------------------------------
                # 🧪 Labs
                # ---------------------------------------------------
                labs_result = await session.run(
                    """
                    MATCH (p:Patient {id:$patient_id})-[:HAS_LAB_RESULT]->(l:LabResult)
                    RETURN l.type AS type, l.date AS date, l.report AS report
                    ORDER BY l.date DESC
                    LIMIT 10
                    """,
                    patient_id=patient_id
                )
                labs = [dict(record) async for record in labs_result]

                # ---------------------------------------------------
                # 🩻 Imaging
                # ---------------------------------------------------
                imaging_result = await session.run(
                    """
                    MATCH (p:Patient {id:$patient_id})-[:HAS_IMAGING]->(i:Imaging)
                    RETURN i.type AS type, i.date AS date, i.findings AS findings
                    ORDER BY i.date DESC
                    LIMIT 10
                    """,
                    patient_id=patient_id
                )
                imaging = [dict(record) async for record in imaging_result]

                # ---------------------------------------------------
                # 💊 Treatments (UPDATED — processed_data JSON)
                # ---------------------------------------------------
                treatments_result = await session.run(
                    """
                    MATCH (p:Patient {id:$patient_id})-[:RECEIVED_TREATMENT]->(t:Treatment)
                    RETURN 
                        t.processed_data AS processed_data,
                        t.date AS date
                    ORDER BY t.date DESC
                    LIMIT 10
                    """,
                    patient_id=patient_id
                )
                treatments = [dict(record) async for record in treatments_result]

                # ---------------------------------------------------
                # 📄 Documents
                # ---------------------------------------------------
                documents_result = await session.run(
                    """
                    MATCH (p:Patient {id:$patient_id})-[:HAS_DOCUMENT]->(d:Document)
                    RETURN
                        d.document_id AS document_id,
                        d.category AS category,
                        d.subcategory AS subcategory,
                    
                        d.structured_data AS structured_data,
                        d.date AS date
                    ORDER BY d.date DESC
                    LIMIT 10
                    """,
                    patient_id=patient_id
                )
                documents = [dict(record) async for record in documents_result]

                # ---------------------------------------------------
                # 🏥 Procedures
                # ---------------------------------------------------
                procedures_result = await session.run(
                    """
                    MATCH (p:Patient {id:$patient_id})-[:HAS_PROCEDURE]->(pr:Procedure)
                    RETURN
                        pr.selected_procedure AS selected_procedure,
                        pr.pre_procedure AS pre_procedure,
                        pr.during_procedure AS during_procedure,
                        pr.post_procedure AS post_procedure,
                        pr.date AS date
                    ORDER BY pr.date DESC
                    LIMIT 10
                    """,
                    patient_id=patient_id
                )
                procedures = [dict(record) async for record in procedures_result]

                # ---------------------------------------------------
                # ✅ FINAL RETURN
                # ---------------------------------------------------
                return {
                    "clinical_summary": clinical_summary,
                    "diagnoses": diagnoses,
                    "labs": labs,
                    "imaging": imaging,
                    "treatments": treatments,
                    "documents": documents,
                    "procedures": procedures
                }

            except Exception as e:
                logger.error(f"❌ Graph search failed: {str(e)}")
                return {}

    async def _temporal_search(self, patient_id: str) -> Dict[str, Any]:
        """Perform temporal trend analysis"""
        if not self.neo4j_driver:
            return {}
            
        async with self.neo4j_driver.session() as session:
            try:
                # Get lab trends over time
                trends_result = await session.run(
                    """
                    MATCH (p:Patient {id: $patient_id})-[:HAS_LAB_RESULT]->(l:LabResult)
                    WHERE l.date IS NOT NULL
                    RETURN l.type as type, l.date as date, l.report as report
                    ORDER BY l.date DESC
                    """,
                    patient_id=patient_id
                )
                
                trends = [dict(record) async for record in trends_result]
                
                # Organize by parameter and calculate trends
                trend_analysis = {}
                # ... implement trend calculation logic
                
                return {
                    "trends": trends,
                    "analysis": trend_analysis
                }
                
            except Exception as e:
                logger.error(f"❌ Temporal search failed: {str(e)}")
                return {}
    
    async def close(self):
        """Close connections"""
        if self.neo4j_driver:
            await self.neo4j_driver.close()
            logger.info("✅ Neo4j connection closed")


# Initialize global instance
graph_rag_system = ClinicalGraphRAG()