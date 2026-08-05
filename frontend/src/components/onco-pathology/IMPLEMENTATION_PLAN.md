# Onco-Pathology Module — Implementation Plan

Porting `templates/pathology_pp.html` (frontend) + `templates/pathology.py` (backend) into the
new component system, following the conventions of `components/surgical-oncology/*` and
`users/patient_data/surgical_oncology.py`.

> Status: **PLAN ONLY — not yet implemented.** Target folder `components/onco-pathology/` is empty.

> ### Decisions locked (2026-07-31)
> 1. **No Frozen-Section / Procedure-tab component for now.** Only the "Surgical Workflow" tab component
>    (`OncoPathologyWorkflow.jsx`) is in scope. `FrozenSectionRecord.jsx` is **deferred** — no Procedure-tab work.
> 2. **One document per case** in `onco_pathology`, keyed by generated `case_id`, with append-only history — confirmed.
> 3. **No `booking_id` back-reference.** Onco-pathology is shared by every oncology module, so a case is
>    **not** tied to a single surgical booking. Key by `patient_id` (+ `case_id`), never by booking.
> 4. **Synoptic per-site schema handled separately by the user** — build the synoptic layer to consume an
>    externally-defined schema; do not hardcode the colorectal field list here.
> 5. **QC Dashboard + Audit Log dropped** from the patient record.

---

## 0. TL;DR — the placement decision

The old template is a single-patient surgical-pathology lifecycle:
**Case Registry → Grossing → (Processing/Sectioning/Staining stubs) → Microscopy stub → Synoptic Report → TNM Staging → Final Diagnosis / Sign-out.**

Clinically, **none of that happens *during* the operation** — it is all specimen-in-the-lab work
that happens *after* resection (or, for accessioning, when the specimen/requisition arrives). The
one pathology activity that happens *during* the procedure — **frozen section / intra-operative
consultation** — **does not exist in the template**. It is net-new, and is **deferred out of scope**
for this phase (decision #1 above).

So the split mirrors surgical-oncology exactly:

| Surgical module | Placed in tab | Reason | Pathology analogue |
|---|---|---|---|
| `SurgicalOncologyWorkflow.jsx` | **Procedure** | used *during* the op | ~~`FrozenSectionRecord.jsx`~~ — **DEFERRED, out of scope** |
| `OTRecord.jsx` | **Surgical Workflow** | used *before & after* the op | **`OncoPathologyWorkflow.jsx`** — accessioning → grossing → synoptic → TNM → sign-out |

**Recommendation:** build **one** component for now:

1. **`OncoPathologyWorkflow.jsx`** → goes in the **"Surgical Workflow"** tab area (before/after). Holds the entire ported template.

> The Procedure-tab frozen-section form (`FrozenSectionRecord.jsx`) is **deferred** — not built in this
> phase. All work below targets the single Workflow-tab component.

---

## 1. Old template — tab & function inventory (what we are porting)

### 1.1 Tabs / screens (in template order)

| # | Screen | When (clinical) | Target placement |
|---|---|---|---|
| 1 | **Case Registry / Accessioning** — demographics, ordering clinician, dept, clinical indication, referral-PDF OCR | specimen/requisition received (before) | Workflow |
| 2 | **Grossing Bench** — receipt & fixation, measurements, tumor description, margins, lymph nodes, photos | post-op, at the bench (after) | Workflow |
| 3 | Processing / Sectioning / Staining | lab turnaround | Workflow (nav stubs — likely a simple status strip, not full forms) |
| 4 | Microscopy | after | Workflow (stub in template) |
| 5 | **Synoptic Report** (CAP Colon & Rectum v4.2) + embedded WSI/DICOM viewer + dictation | after | Workflow |
| 6 | **TNM Staging** (AJCC 8th) + **Final Pathologic Diagnosis** + AI Review + Sign-out | after | Workflow |
| 7 | QC Dashboard / Audit Log | — | **DROPPED** (static demo content; belongs in the dashboard module, not the patient record) |
| — | ~~Frozen Section / Intra-op Consult~~ | ~~during~~ | **DEFERRED — out of scope this phase** |

### 1.2 Frontend functions in the template, by purpose

| Function (template) | Purpose | New home |
|---|---|---|
| `showPage()` / `toggleSidebar()` / modal helpers | SPA tab nav | Replaced by React sidebar/tab state (copy `OTRecord` shell) |
| `loadCaseInformation()`, `loadCaseHeader()` | auto-fill demographics/accession from patient summary | `usePatientInfo` + a `getCaseRegister` fetch |
| `generateOverallSummary()` | pull visit summary into clinical indication | keep as API call (`get_visit_summary`) |
| referral upload + `extractFromReferral()` | upload referral PDF, OCR/LLM-summarize into clinical indication | `uploadReferralLetter()` + `processReferralLetters()` API |
| `toggleRecording()/startRecording()/stopRecording()/sendAudioForTranscription()` (×2 impls) | mic → `/transcribe_labs` | **Centralize** into one shared `useVoiceAutofill` hook (see §4) |
| `parseGrossingDictation()` | dictation → structured grossing fields (LLM) | `structureGrossing()` API + autofill merge |
| `saveGrossingData()` | persist grossing | `saveSection(caseId, "grossing", data)` |
| `fetchGrossingData()` / `#importGrossBtn` | import gross values into synoptic | client-side merge from the loaded case doc |
| `process & analyse` (`process-dictation-pathology`) | dictation → structured synoptic (LLM) | `structureSynoptic()` API + autofill merge |
| `saveDraft` (synoptic) | persist synoptic draft | `saveSection(caseId, "synoptic", data)` |
| CAP validators (`validate-cap-pathology`, `pathology/validate-cap`) | fixation/margin/node/grade rule checks | Backend returns **structured** data (not HTML); render as `FlagNote`s |
| `calculateTNM()` (client) + `calculate-stage`/`calculate-tnm` (server) | AJCC-8 colorectal staging | Keep **server** calc as source of truth; render result panel |
| `saveTNMButton` | append staging to history | `saveSection(caseId, "tnm", entry)` (append semantics — see §5) |
| `finalDiagnosisButton` / `final-diagnosis` | assemble final-diagnosis narrative | `generateFinalDiagnosis()` API |
| `aiReviewButton` / `ai-review` | LLM correlation of gross↔micro↔TNM | `aiReviewPathology()` API |
| `loadPathology()` | list WSI/DICOM slides for the patient | `getPathologySlides(patientId, type)` API (external DICOM service) |
| `exportReport()` / `printReport()` | PDF / CAP-XML / print | Reuse `OTRecord` `jsPDF` + `window.print()` conventions |

### 1.3 Constant lists to lift into a `constants.js`
Departments (3), Sex (3), Container types (3), Fixatives (3), Gross color (7), Consistency (5),
Tumor configuration (5), Histologic grade G1–G4, Depth of invasion (7), Margin status (2),
Procedures (colorectal, 4+), Tumor sites (colon segments), **T (6) / N (6) / M (4)** AJCC-8
colorectal option sets with descriptions, and the AJCC-8 **stage-grouping table** (currently
encoded as if/else in `calculateTNM()`).

> The template only implements the **colorectal** synoptic. Model the synoptic layer as a
> **pluggable per-site schema** driven by an **externally-defined schema (owned/handled by the user,
> decision #4)** — the layer consumes the schema; it does not hardcode the field list.

---

## 2. Frontend architecture (files to create)

```
components/onco-pathology/
├── OncoPathologyWorkflow.jsx      # MAIN — "Surgical Workflow" tab (before/after)
├── constants.js                   # dropdown option lists + AJCC-8 stage table
├── synoptic/
│   └── <site>.js                  # synoptic field schema — schema defined/owned by user (pluggable)
└── shared/                        # reuse surgical-oncology/shared where possible
    ├── api.js                     # NEW — pathology API wrapper (base = /onco-pathology)
    ├── usePathologyCase.js        # NEW — case-data hook (mirror useBookingData)
    └── useVoiceAutofill.js        # NEW — shared mic→transcribe→LLM-structure→merge hook
```

**Reuse directly from `components/surgical-oncology/shared/`** (do NOT re-create):
`designTokens` (C, FONT, inputSx, thSx/tdSx, saveBtnSx…), `FormComponents`
(`SectionBox, FG, FieldLabel, FlagNote, ROInput, Sel, CbxGroup, RdoGroup, StatusBadge, SubTabBar`),
`usePatientInfo`, `CompletedInvestigationsPanel`. Either import across folders or promote these to a
top-level `components/shared/` (a partial copy already exists there).

### 2.1 `OncoPathologyWorkflow.jsx` — shell & internal tabs

Copy the `OTRecord` shell (240px left sidebar, `motion.div` fade-in, header eyebrow → "Onco-Pathology",
loading / no-case overlays, single parent `handleSave(tabKey, data)` → `saveSection`, `Snackbar` + `refetch()`).

Props: `{ doctorId, patientId, doctorName }` (same as `OTRecord`).

Internal sidebar tabs (index → key → label):
0. `case-register` — **Case Registry / Accessioning**
1. `grossing` — **Grossing Bench**
2. `synoptic` — **Synoptic Report** (per-site schema, user-owned) + WSI viewer
3. `tnm` — **TNM Staging & Final Diagnosis** (staging calc + final dx + AI review + sign-out)
4. `slides` — **Pathology Viewer** (WSI/DICOM) — optional standalone, or embed in synoptic
5. `reports` — **Reports / Export** (PDF, print) — optional, reuse `ReportsTab` pattern

Each tab is a sub-component seeded with `useState({ ...defaults, ...(initialData||{}) })` and a
`useEffect` re-merge on `initialData` change, exactly like `OTRecord`'s tabs.

### 2.2 `FrozenSectionRecord.jsx` — Procedure tab — **DEFERRED (out of scope)**

Not built in this phase (decision #1). Kept here only as a forward-looking note for whenever the
Procedure-tab frozen-section form is picked up later. Nothing below depends on it; the `frozen_section`
section key is reserved in the data model but left unused for now.

---

## 3. Data model — pathology "case" (mirrors surgical "booking")

The old backend used **one Mongo collection per stage** (case_register, grossing_bench,
synoptic_reports, tnm_staging, final_diagnosis, validation_*). **Consolidate** into a single
document, like surgical-oncology's `surgical_oncology` collection, keyed by a generated `case_id`
(UUID) with an `accession_id` for display. **One document per case** — new cases append to the
patient's history rather than overwriting; no `booking_id` link (onco-pathology is shared across
all oncology modules, decision #3).

Proposed document shape (`onco_pathology` collection):
```
{
  case_id, patient_id, doctor_id, hospital_id,
  accession_id,                 # TMH-YYYY-xxxxxx display id
  created_at, updated_at,
  status,                       # Accessioned → Grossed → Reported → Signed-out
  is_active,
  case_register: {...},         # demographics, ordering clinician, dept, clinical indication
  grossing:      {...},         # GrossingBenchModel fields (normalized)
  synoptic:      {...},         # synoptic fields (per-site schema owned by user)
  tnm: { history: [ {...} ], latest: {...} },   # append-only staging history
  frozen_section:{...},         # reserved for deferred Procedure-tab form (unused this phase)
  final_diagnosis:{ text, signed_out_by, signed_out_at },
  cap_validation:{ grossing:{...}, synoptic:{...} }   # structured, not HTML
}
```

Referral PDFs and WSI slides remain **separate** (documents/storage collections), like surgical's
`surgical_oncology_documents`.

**Field-name normalization to fix during port:** template `totalNodes` (grossing) vs `totalNodess`
(synoptic) collision; standardize to `totalNodesExamined` / `positiveNodes`. Snake_case backend ↔
camelCase frontend mapping should be consistent (surgical stores camelCase verbatim in `data`; do the same).

---

## 4. Shared `useVoiceAutofill` hook (de-duplication)

Both surgical files duplicate the mic→transcribe→LLM→merge block per tab. Extract once:

```
useVoiceAutofill({ structureEndpoint })  →
  { transcript, setTranscript, isRecording, isProcessing, isAutofilling,
    startRecording, stopRecording, autofill(applyFn) }
```
- `stopRecording` POSTs webm to `${API_BASE}hms/users/ai/elevenlabs/api/transcribe_labs`.
- `autofill` POSTs `{ text }` to `structureEndpoint`, then calls `applyFn(data)` which does the
  skip-empty / union-merge-arrays merge into the tab's `f` state (same logic as `OTRecord` Post-Op).

Grossing passes `.../onco-pathology/grossing/structure`; synoptic passes `.../onco-pathology/synoptic/structure`.

---

## 5. Backend — `users/patient_data/onco_pathology.py`

New FastAPI router modeled on `surgical_oncology.py`.

- **Prefix:** `/onco-pathology` (mounted so full path is `…/hms/users/data/onco-pathology/*`, matching how `shared/api.js` builds `SO_BASE`).
- **Collections:** `onco_pathology` (main, one-doc-per-case), `onco_pathology_documents` (referral PDFs / uploads), optionally `onco_pathology_slides`.
- **Motor async** client only (drop the old sync `MongoClient`).

### 5.1 Endpoints (consolidated)

**Case CRUD**
- `POST /case` — create case (generate `case_id` + `accession_id`), like `create_booking`.
- `GET /case/{case_id}` — full document.
- `PUT /case/{case_id}` — update `case_register` section.
- `GET /cases/{doctor_id}` — worklist for a doctor.
- `GET /patient/{patient_id}/cases` / `.../latest-case` — patient history.
- `PUT /patient/{patient_id}/active-case/{case_id}` — set active.

**Generic section save (whitelist)** — copy surgical's `save_section` pattern:
- `PUT /case/{case_id}/section/{section_path}` with allowed set:
  `case_register, grossing, synoptic, final_diagnosis,
   tnm.latest, cap_validation.grossing, cap_validation.synoptic`.
  (`frozen_section` reserved in the whitelist but unused until the deferred Procedure form lands.)
- TNM history append: either a dedicated `POST /case/{case_id}/tnm/append` (push to `tnm.history`)
  or handle `tnm.latest` via section-save + push. Keep append-only history.

**LLM structuring (Groq)** — same shape as surgical (`{status, data}`):
- `POST /grossing/structure` — dictation → grossing JSON (port the template's grossing field list).
- `POST /synoptic/structure` — dictation → CAP synoptic JSON for the active site (map to the user-owned per-site schema: WHO→ICD-O, procedure/segment enums, grade, depth, margins, nodes, warnings, confidence).
- `POST /case/{case_id}/ai-review` — correlation of gross↔micro↔TNM (port `ai-review` prompt).
- `GET /process-referral-letters/{patient_id}` — PDF text extract + LLM summary → clinical indication.

**Rule-based calculators (pure Python — return structured JSON, not HTML)**
- `POST /calculate-stage` — `{t,n,m}` → `{final_stage, tnm, confidence, message}` (AJCC-8 colorectal table).
- `POST /calculate-tnm` — derive T/N/M from stored synoptic (depth→T, node-count→N, metastasis→M).
- `POST /validate-cap/grossing` and `POST /validate-cap/synoptic` — return `[{rule, status, message}]` arrays; frontend renders `FlagNote`s. (Replace the old HTML-string alerts.)

**Final diagnosis**
- `POST /case/{case_id}/final-diagnosis` — assemble narrative from grossing+synoptic+tnm (fix the missing `await` bug from the old code).
- `POST /case/{case_id}/sign-out` — set `status=Signed-out`, stamp signer/time.

**Documents / slides**
- `POST /documents/upload` — proxy referral/other files to `STORAGE_BASE_URL` (copy surgical's `upload_document`; do NOT write to local disk like the old code did).
- `GET /documents/{patient_id}`, `DELETE /documents/{document_id}`.
- `GET /slides/{patient_id}/{type}` — proxy/list WSI/DICOM from the external service.

**Dashboard/alerts** — **defer**; belongs in the dashboard module, and old versions returned HTML.

### 5.2 Pydantic models
Port `GrossingBenchModel` (normalize node field names) and `AIReviewRequest`. Add
`CreateCasePayload`, `SaveSectionPayload`, `StructurePayload{text}`, `CalcStagePayload{t,n,m}`,
`FinalDiagnosisPayload`. Follow surgical-oncology's model style.

### 5.3 Bugs / debt to fix while porting (from the old files)
1. **Hardcoded Groq API key** in `pathology.py` line ~41 → move to `os.getenv("GROQ_API_KEY")`; rotate the leaked key.
2. **Un-awaited** `final_diagnosis_collection.update_one(...)` → add `await`.
3. **Duplicate function names** (`process_pathology_dictation` ×2, `validate_cap_pathology` ×2, `save_cap_validation` ×2, `process_alerts` ×3) → rename on consolidation.
4. **Doubled route segment** `.../pathology/pathology/...` in some old routes → use clean single-segment paths.
5. **HTML-string alerts** → return structured data.
6. **Local-disk PDF storage** → proxy to storage service.
7. Model metadata claims a 70B model but calls `llama-3.1-8b-instant` → align comments/model choice.
8. **Field collisions** `totalNodes`/`totalNodess` → normalize.

---

## 6. Frontend ↔ backend wiring (`shared/api.js`)

New wrapper with `PATH_BASE = ${API_BASE_URL}hms/users/data/onco-pathology` (mirror surgical `SO_BASE`).
Functions: `createCase, getCase, updateCase, getCases, getPatientCases, getLatestCase, setActiveCase,
saveSection, appendTnm, structureGrossing, structureSynoptic, aiReviewPathology, processReferralLetters,
calculateStage, calculateTnm, validateCapGrossing, validateCapSynoptic, generateFinalDiagnosis, signOut,
uploadDocument, getDocuments, deleteDocument, getPathologySlides`. Reuse the generic `request/get/post/put/del`
helpers verbatim from surgical `shared/api.js`.

---

## 7. Suggested implementation phases

1. **Backend skeleton** — `onco_pathology.py`: case CRUD + generic section-save + document proxy. Wire router into the app. (Unblocks everything.)
2. **Frontend shell** — `OncoPathologyWorkflow.jsx` copied from `OTRecord` shell + `shared/api.js` + `usePathologyCase.js`. Empty tab stubs.
3. **Case Registry tab** — form + referral upload + LLM summary.
4. **Grossing tab** — form + `useVoiceAutofill` + `structureGrossing` + CAP validation.
5. **Synoptic tab** — consume user-owned per-site schema + import-from-gross + `structureSynoptic` + CAP validation + WSI viewer.
6. **TNM + Final Diagnosis tab** — server calc + AI review + final diagnosis + sign-out.
7. **Reports/export + polish** — PDF/print, worklist, postpone-style gating if needed.

> **Deferred (not scheduled this phase):** Procedure-tab `FrozenSectionRecord.jsx`.

---

## 8. Confirmed decisions (was: open questions)
All resolved on 2026-07-31 — see the "Decisions locked" box at the top.
1. **Frozen-section / Procedure tab** — **deferred, out of scope.**
2. **Case keying** — **one document per `case_id`** with append-only history. ✔
3. **Link to surgical booking** — **no `booking_id`**; onco-pathology is shared across all oncology modules, keyed by `patient_id`. ✔
4. **Synoptic schema** — **user-owned/defined**; the synoptic layer consumes an external per-site schema. ✔
5. **QC Dashboard / Audit Log** — **dropped** from the patient record. ✔
