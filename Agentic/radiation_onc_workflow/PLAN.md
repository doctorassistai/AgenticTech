# Radiation Oncology Intelligence — Agent Platform Plan

**Goal:** Populate the doctor-facing dashboard `RadiationOncologyIntelligence.jsx`
(12 modules) with real, backend-derived data by building one backend "agent" per
module. Agents read from the radiotherapy databases, derive each dashboard row, and
return a fixed contract the dashboard overlays onto its existing rows.

This package mirrors the reference `surgical_onc_workflow/` structure
(`agents/`, `state.py`, `data_sources.py`, `workflow.py`, `api.py`, `PLAN.md`)
but for radiation oncology.

---

## 1. Hard constraints (from the product owner)

1. **The dashboard is field-locked.** `RadiationOncologyIntelligence.jsx` must not
   gain or lose any field, row, column, module, or KPI. Agents fill in the *values*
   of rows that already exist — they never restructure the page.
2. **MongoDB is reference-only.** We read the radiotherapy records; we never modify
   their schema or documents.
3. **Only show available or derivable data.** Anything that cannot be sourced or
   derived is labelled **"Not available"** — we never invent clinical values.
4. **Build order is data-readiness first** (most-sourceable agents first), one
   module after another.

---

## 2. Architecture

```
Frontend (frozen)                 Backend package: radiation_onc_workflow/
─────────────────                 ─────────────────────────────────────────
RadiationOncologyIntelligence.jsx     api.py         FastAPI router (envelope)
  REPORT_MODULES  (12, frozen)          │
        ▲                               ├─ workflow.py   registry + cache-aware run
        │ overlay by `param`            │                (get_or_generate / regenerate)
  radiationApi.js  ──HTTP──▶            ├─ store.py      radiation_onco_agentic cache
   load / regenerate button            │                 (insert-only, versioned)
                                        ├─ agents/
                                        │    base.py          BaseAgent + Row helpers
                                        │    documentation.py Module 09 (built)
                                        │    …one file per module…
                                        │
                                        ├─ data_sources.py  Mongo (Motor) + history
                                        │                    walk (reference-only)
                                        ├─ llm.py           Groq JSON-mode wrapper
                                        └─ state.py         Row / ModuleResult / consts
```

### Data flow (one module)
```
gather_context()  → pull records from data_sources (live radiotherapy DBs)
build_rows()      → DETERMINISTIC derivation of the module's fixed rows;
                    unsourceable rows → Row.not_available(...)
build_prompt()    → OPTIONAL: assemble a prompt for narrative text
call_llm()        → OPTIONAL: Groq JSON mode for prose (never for row status)
assemble()        → ModuleResult → {"status":"success","data":{...}}
store.save()      → persist the result as a new version in radiation_onco_agentic
```

**Design rule:** row **status/completeness are deterministic facts** from the DB.
The LLM is used only for *narrative prose* (summary bodies, explanations) that live
in `meta`, never to decide whether something is "ok/watch/alert". This keeps the
clinical signal auditable and lets every module run with zero external services.

---

## 3. The frozen row contract

Every agent row serializes to **exactly** the keys the dashboard already reads:

```json
{ "param": "...", "finding": "...", "ref": "...",
  "status": "ok|watch|alert|neutral", "statusLabel": "...", "action": "..." }
```

- Standard modules render: `finding`→Current Finding, `ref`→Reference/Expected,
  `status`+`statusLabel`→Status pill, `action`→Indication/Action.
- **Module 09 (Docs) re-maps the same keys**: col2 = status pill,
  `finding`→"Last Generated", `ref`→"Completeness". The agent emits the identical
  6 keys; only the renderer differs (already in the JSX — no change needed).

`status` values map to the existing `StatusPill`: `ok` (green), `watch` (amber),
`alert` (red), `neutral` (grey). **"Not available"** uses `status:"neutral"`,
`statusLabel:"Not available"`, `finding:"—"`.

The API envelope matches the reference backend exactly:
```json
{ "status": "success",
  "data": { "moduleId": "m9", "slug": "documentation", "num": "09 / 12",
            "title": "...", "status": "ok", "summary": "...",
            "rows": [ …6-key rows… ],
            "meta": { "generatedAt": "...", "provenance": [...], "warnings": [...] } } }
```
Extra keys live only under `meta` — the dashboard ignores them, so nothing is added
to the frozen file.

---

## 4. Data sources (reference-only reads)

| Source | Collection / API | Status | Used by |
|---|---|---|---|
| EBRT record | `rt-record-details` (Mongo) | LIVE | 05, 06, 07, 08, 09 |
| RT workflow record | `radiotherapy_records` (Mongo) | LIVE | 01, 02, 03, 09 |
| Patient master | Mongo | LIVE | strip / all |
| Lab results | external API | needs link | 01, 07 |
| Radiology | external API | needs link | 01, 08 |
| Physics / TPS (DVH, γ) | TPS export | needs link | 03, 04, 10 |
| Scheduling / machine | dept system | not available | 06, 12 |

**History walk:** on `RadiotherapyRecord`, the latest flattened section is often
nulled — real values live in earlier `data.history.<stage>[]` snapshots. `data_sources`
coalesces newest→oldest so agents always see the most recent *populated* value.
The `Rt_record` EBRT doc keeps a populated top-level `ebrt`, with `history.ebrt[]`
as backup.

---

## 5. Generated-data cache (`radiation_onco_agentic`)

Agents must **not** re-run on every page visit. Generated module results are persisted
to a dedicated **`radiation_onco_agentic`** collection (`store.py`) and served from
there. This collection is *ours* to write — it is separate from the reference-only
`rt-record-details` / `radiotherapy_records`, which are never touched.

**Insert-only, versioned.** Each generation inserts a new document; nothing is ever
overwritten, so prior generations survive as a silent history.

```json
{ "patientId": "...", "doctorId": "...", "moduleId": "m9", "slug": "documentation",
  "version": 3, "generatedAt": "2026-08-10T09:14:00Z",
  "latest": true, "data": { …ModuleResult.to_dict()… } }
```

- `version` is monotonic per `(patientId, slug)`; `latest:true` flags the newest.
- On save, the previous `latest` is demoted to `false` (kept as history).

**Two entry points (workflow.py):**

| Call | When | Behaviour |
|---|---|---|
| `get_or_generate()` | page visit / `GET /module/{slug}` | return newest saved version; generate + save **only if none exists** |
| `regenerate()` | "Regenerate" button / `POST …/regenerate` | always run the agent and insert a **new version** |

The API envelope carries `cached`, `version`, and `generatedAt` alongside `data` so the
frontend can show provenance and a version indicator. `GET …/history` lists prior
versions (metadata only). Indexes on `(patientId, slug, version)` and
`(patientId, slug, latest)` are created at startup via `store.ensure_indexes()`.

---

## 6. Per-module data-readiness map & build order

Derived from `agent-data-plan.html`. Phase 1 = build now (well-sourced),
Phase 2 = partial, Phase 3 = blocked on external integrations.

| # | Module (dashboard) | Primary source | Readiness | Phase |
|---|---|---|---|---|
| **09** | **Documentation** | EBRT record (sim/plan/completion/tox/follow-up) | **HIGH — built first** | **1** |
| 06 | Treatment Gap | EBRT `interruption` / `completion.gap*` | HIGH | 1 |
| 07 | Toxicity | EBRT `adverseEvents[]` (CTCAE) | HIGH | 1 |
| 05 | Delivery | EBRT sim/procedure/interruption | MEDIUM-HIGH | 1 |
| 01 | Readiness | RadiotherapyRecord baseline + labs | MEDIUM (labs ext) | 2 |
| 02 | Planning | EBRT procedure + RadiotherapyRecord | MEDIUM | 2 |
| 03 | Dose (EQD2/BED) | EBRT dose + TPS DVH | MEDIUM (DVH ext) | 2 |
| 08 | Response | EBRT completion + radiology | MEDIUM (imaging ext) | 2 |
| 11 | MDT | EBRT + systemic therapy | MEDIUM | 2 |
| 04 | Plan QA | TPS export | LOW (needs TPS) | 3 |
| 10 | Physics QA | TPS / machine QA | LOW (needs TPS) | 3 |
| 12 | Ops | dept scheduling | LOW (not available) | 3 |

**First build = Module 09 Documentation** — the highest data-ready agent, no external
dependency, and it validates the whole framework (data_sources → base agent → API →
frontend overlay) before we tackle data-gap-heavy modules.

---

## 7. Module 09 derivation (the built slice)

| Dashboard row | Source | Result on demo record |
|---|---|---|
| Consultation Summary | RadiotherapyRecord intake | **Not available** (not in EBRT-only demo) |
| Simulation Summary | `ebrt.simulationSets` | Derived → **Final / Complete** |
| Treatment Plan Summary | `ebrt.procedure` + `approvals` | Derived → **Final** (RO/MP/RTT signed) |
| Weekly Review Summary | on-treatment reviews | **Not available** (no source) |
| Completion Summary | `status=completed` + discharge | Derived → **Final** |
| Toxicity Summary | `ebrt.adverseEvents[]` + discharge | Derived → **Final** (CTCAE graded) |
| Follow-up Summary | `ebrt.followUp` | Derived → **Final** (2026-09-20 plan) |
| Tumor Board Summary | MDT record | **Not available** (no source) |
| Guideline Evidence Viewer | guideline KB | **Not available** (needs KB link) |
| Explainable AI Log | agent provenance | **Active** (this agent's own trace) |

Deterministic rows; optional Groq call only synthesizes the narrative *bodies*
(stored under `meta.documents`) when `GROQ_API_KEY` is set.

---

## 8. How to run

```bash
cd radiation_onc_workflow
pip install -r requirements.txt

# Live smoke test: load-or-generate, regenerate, then show version history.
RT_MONGO_URI="mongodb+srv://..." python run_demo.py [PATIENT_ID]

# Serve the API
RT_MONGO_URI="mongodb+srv://..." \
  uvicorn radiation_onc_workflow.api:create_app --factory --reload
```

Endpoints (all under `/radiation-oncology`):

```
GET  /modules
GET  /module/{slug}?patientId=...          load latest, or generate on first visit
POST /module/{slug}/regenerate  {patientId} run agent, store a new version
GET  /module/{slug}/history?patientId=...  version history (metadata only)
GET  /documentation?patientId=...          convenience alias for Module 09
POST /documentation/regenerate  {patientId} convenience alias
```

`RT_MONGO_URI` is **required** — the platform reads only from the live radiotherapy
databases (there is no mock/offline path). Collections read (reference-only, never
written): `rt-record-details` (EBRT) and `radiotherapy_records` (RT workflow),
overridable via `RT_EBRT_COLLECTION` / `RT_WORKFLOW_COLLECTION`. Generated dashboard
data is written to `radiation_onco_agentic`. Optional `GROQ_API_KEY` enables narrative
prose; without it, all row status/completeness is still derived deterministically.

---

## 9. Next modules (same template)

06 Gap → 07 Toxicity → 05 Delivery (Phase 1), each = a new `agents/<name>.py`
subclass of `BaseAgent`, registered in `workflow.py`, reusing `data_sources` and the
row contract. No frontend structural change — only the overlay map grows.
