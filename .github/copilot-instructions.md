# DoctorAssistAI Copilot Instructions

## Architecture Overview

This is a **microservices healthcare platform** using FastAPI services orchestrated via RabbitMQ, with MongoDB for persistence and LangGraph for clinical AI workflows.

### Core Services (see `docker-compose.yml`)
- **Gateway** (port 8040): HTTP request router, authentication, session management
- **Orchestration**: Workflow coordination, clinical data processing pipeline
- **Common**: Shared utilities, file storage, clinical transcript analysis (LangGraph)
- **AI Service**: LLM interactions, speciality-specific reasoning
- **Agentic**: Graph RAG system with Neo4j for medical knowledge
- **Users**: Patient/doctor profile management
- **Audit Service**: RabbitMQ-driven event logging
- **Speciality**: Specialty-specific endpoints

### Data Flow Pattern
1. **User Request** → Gateway (auth check, route) → Service Endpoint
2. **Long Tasks** → Celery worker (RabbitMQ broker) + async job tracking
3. **Clinical Data** → LangGraph workflow (extract → validate → save) → MongoDB + HMS API
4. **Audit Trail** → AuditClient (fire-and-forget to RabbitMQ) → Audit Service

---

## Critical Patterns

### 1. LangGraph Clinical Workflows (`common/save_download.py`)
The **ClinicalExtractionAgent** uses LangGraph StateGraph with typed state:

```python
class GraphState(TypedDict):
    transcript: str
    patient_id: str
    validated_extraction: Optional[ExtractedDataContainer]
    error_logs: Annotated[List[str], operator.add]  # Accumulator
    api_payloads: Dict[str, Any]
    # ... other fields
```

**Node Pattern:**
- Each node is an agent method: `classify_input` → `extract_clinical` → `classify_documents` → `verify_data` → `prepare_payloads` → `save_data`
- Nodes use **conditional routing** (e.g., stop if extraction fails)
- **Must use Pydantic models** for structured output parsing (`ClinicalExtract`, `ExtractedDataContainer`)
- **Critical**: Always flatten LLM null values: `"null"` string → Python `None` in parsed output

### 2. Celery Task Pattern (`common/celery_worker/`)
```python
@celery_app.task(bind=True)
def process_document_task(self, file_path: str, patient_id: str):
    # Long-running document processing
    # Result backend: RPC (fire-and-forget)
```
- Broker: RabbitMQ at `CELERY_BROKER_URL`
- Tasks auto-discovered from `celery_worker/` package
- Track status with `AsyncResult(task_id)` from FastAPI endpoints

### 3. Audit Logging Pattern (`shared/audit/`)
```python
from shared.audit.utils import emit_audit
from shared.audit.schema import AuditEvent

emit_audit(app.state.audit, AuditEvent(
    actor_id=doctor_id,
    action="transcription_processed",
    resource="patient_123",
    details={"transcript_length": 500}
))
```
- **Non-blocking**: Exceptions in audit don't crash APIs
- Every service initializes `app.state.audit = AuditClient(os.getenv("RABBITMQ_URL"))`
- Exchange: `audits` (topic, durable)

### 4. FastAPI Router Pattern
All services follow:
```python
from fastapi import APIRouter, HTTPException, Depends

router = APIRouter(prefix="/endpoint", tags=["feature"])

@router.post("/action")
async def endpoint_handler(payload: PayloadModel):
    # Dependency injection for auth, audit, mongo
    pass

# In main.py:
app.include_router(router)
```

### 5. MongoDB with Motor (Async)
```python
from motor.motor_asyncio import AsyncIOMotorClient

mongodb_client = AsyncIOMotorClient(MONGO_URI)
database = mongodb_client["doctorassistai"]
collection = database["patient_data"]

# Always use async operations:
await collection.insert_one(doc)
result = await collection.find_one({"_id": ObjectId(id)})
```

### 6. Taxonomy & Document Classification
Documents extracted from transcripts must match `DOCUMENT_CATEGORIES`:
- **Laboratory panels**: CBC, LFT, RFT, Lipid Profile, Troponin, etc.
- **Imaging modalities**: X-ray, CT, MRI, Ultrasound, Doppler, Echocardiography
- **Functional tests**: ECG, Spirometry, EEG, Endoscopy
- **Pathology**: HPE, FNAC, Core Biopsy, IHC

Mapped via `DocumentTaxonomyItem(category_key, subcategory_key, test_name, report_content, ...)`

---

## Development Workflows

### Local Testing
```bash
# 1. Start services
docker-compose up

# 2. Test gateway (logs in as test user, routes to services)
curl -X POST http://localhost:8040/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username":"doctor@demo.ai","password":"..."}' | jq '.token'

# 3. Send clinical transcript to common service
curl -X POST http://localhost:8000/storage/analyze-transcript/ \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"transcript":"Patient reports chest pain...","patient_id":"P123"}'

# 4. Monitor LangGraph execution in logs:
#    - "Node: classify_input_type | ..."
#    - "Node: extract_structured_clinical | ..."
```

### Adding New Clinical Features
1. **Define Pydantic model** (add to `ClinicalExtract` or create new in `save_download.py`)
2. **Update LLM prompts** (extraction_prompt in `extract_structured_clinical`)
3. **Add LangGraph node** (if multi-step logic needed)
4. **Test with real transcripts** (use test data from `Agentic/TestData/`)
5. **Audit the changes** (emit `AuditEvent` for compliance)

### Debugging LangGraph
- Enable detailed logging: `logger.info()` at each node start/end
- Check `state.error_logs` accumulator for workflow errors
- Inspect `validated_extraction` structure (check for missed fields)
- Use `_clinical_workflow.invoke(initial_state)` to run synchronously in tests

---

## Project-Specific Conventions

1. **Null Handling**: LLM outputs "null" as string → explicitly convert with:
   ```python
   def normalize_nulls(self, obj):
       if isinstance(obj, str) and obj.lower() == "null":
           return None
   ```

2. **Logging Format**: 
   ```python
   logger.info("Node: NODE_NAME | CONTEXT_VAR=%s | STATUS=%s", var1, var2)
   ```

3. **Error Messages**: Include operation context (e.g., `attempt=2`, `feature_id=...`)

4. **API Endpoints**: Always return `{"success": bool, "data": {...}, "error": str, "metadata": {...}}`

5. **CORS**: All services configured with:
   ```python
   app.add_middleware(CORSMiddleware, 
       allow_origins=["*"],  # Restricted to frontend URL in prod
       allow_credentials=True)
   ```

6. **Environment Variables** (see `.env`):
   - `GROQ_API_KEY`: LLM provider
   - `RABBITMQ_URL`: Broker connection
   - `MONGO_URI`: Database connection
   - `CELERY_BROKER_URL`: Task queue (separate from RabbitMQ if needed)

---

## Key Files Reference

| File | Purpose |
|------|---------|
| [common/save_download.py](common/save_download.py#L1465) | LangGraph workflow, clinical extraction (3400+ lines) |
| [gateway/main.py](gateway/main.py) | HTTP gateway, authentication, routing |
| [orchestration/nodes.py](orchestration/nodes.py#L1) | Workflow orchestration endpoints |
| [shared/audit/](shared/audit/) | Audit logging infrastructure |
| [common/celery_worker/](common/celery_worker/) | Async task definitions |
| [docker-compose.yml](docker-compose.yml) | Service definitions and network config |

---

## Common Pitfalls

❌ **Don't**: Assume LLM output is valid JSON (it often includes markdown)  
✅ **Do**: Extract JSON manually, validate with Pydantic, handle parse errors gracefully

❌ **Don't**: Block on audit logging  
✅ **Do**: Wrap `AuditClient.log()` in try-except that doesn't crash the handler

❌ **Don't**: Make blocking HTTP calls in FastAPI handlers  
✅ **Do**: Use `httpx` for async requests or offload to Celery

❌ **Don't**: Modify `GraphState` after workflow starts  
✅ **Do**: Return new state dict from each node: `{**state, "field": value}`

---

## Quick Links
- **LangGraph Docs**: https://langchain-ai.github.io/langgraph/
- **Pydantic Structured Output**: https://python.langchain.com/docs/modules/model_io/output_parsers/
- **Groq API**: https://console.groq.com/docs
- **RabbitMQ Overview**: https://www.rabbitmq.com/tutorials
