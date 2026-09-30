# patient_app: the full story

Last updated: 2026-09-25 (after first full end-to-end pipeline test: doctor
dashboard → backend → patient mobile app, including two bugs found and fixed).
Keep this file in the repo at `integration/patient_app/README.md` and update
section 17 after every testing session, and section 16 after every build step.
If you start a new Claude chat, paste this file together with
`PATIENT_APP_HANDOFF.md` (the original brief, which stays the source of truth
for endpoint JSON shapes; this file records what was decided and built
afterwards, and where it differs from that brief).

---

## 1. Goal

The DoctorAssist patient mobile app (Expo / React Native, app name "sahaya")
showed hard-coded demo data for medicines and check-in questions. `patient_app`
is a **Python sub-package inside the existing `integration` container**
(`integration/patient_app/`, FastAPI router + Motor) that serves real data from
the doctor system to that app, through a thin proxy in the gateway. The
original handoff asked for a separate Docker service; that was changed by
decision 10.

**Status as of this update: Steps 1–3 (skeleton, medicines, check-in
generation) are built and have been exercised end to end against real data on
the live server** — not just designed. See section 17 for the actual test
session. Step 4 (gateway wiring) is also done and confirmed working. Step 5
(mobile app) exists and has been tested manually through the UI. See section
16 for the build-status table and section 13 for what's still open.

Out of scope for the whole project so far: patient login itself (already works
with HMS ID + phone → JWT), except the small fallback in section 11.

**Step 7 (new): doctor-facing overview panel.** A doctor can now open a
patient's real check-in/medicine/alert data from the VoiceAssistant
dashboard's "Patient app and alerts" workflow module — previously that
panel (`PatientApp.jsx`) was 100% hardcoded mock data with no backend call
at all. Built and exercised once end to end (section 17); one auth bug
found and fixed during that first test. See section 18 for the full
design, and section 13 for what's still open.

## 2. Architecture
Patient app (Expo)
│ Authorization: Bearer <JWT>
▼
https://doctorassist.ai/api/hms/users/patients/me/... (public)
▼
gateway container ── gateway/routes/patient_proxy.py (confirmed working)
▼ http://integration:8000/patient_app/me/... (compose network only)
integration container ── integration/patient_app/ (confirmed working)
├─ reads : doctor-system collections (read-only)
│ writes : 6 collections owned by patient_app
└─ calls : Groq (check-in question generation, consent-gated)
           storage service (check-in photo upload — STORAGE_BASE_URL)
           OpenAI (check-in photo vision extraction, consent-gated — step 6)

Doctor dashboard (VoiceAssistant.jsx, PatientApp.jsx module)
│ Cookie: access_token (doctor session, set by /hms/users/auth/login)
▼
https://doctorassist.ai/api/hms/users/doctors/me/patients/... (public)
▼
gateway container ── gateway/routes/patient_app_doctor_proxy.py (confirmed
                      working — see section 18's bug fix) — authenticates
                      the cookie itself via get_current_user, then injects
                      X-Doctor-Id on the forwarded request
▼ http://integration:8000/patient_app/doctor/... (compose network only)
integration container ── integration/patient_app/routes_doctor.py
├─ reads : same doctor-system + patient_app collections as the patient
│           side, via care_data.py's existing helpers (no new writes to
│           doctor-owned collections; only patient_alerts gains an
│           `acknowledged` flag, written by this side)
└─ auth  : get_current_doctor (auth.py) trusts X-Doctor-Id — safe only
           because integration has no published port (see below) and the
           gateway is the sole caller


- No new container, Dockerfile or compose entry. `integration/Dockerfile`
  copies the whole `integration/` folder, so the sub-package ships with
  `docker compose up -d --build integration gateway`.
- `integration` has **no published port** — confirmed via `docker ps` — it's
  only reachable inside the Docker network at `http://integration:8000`, or
  from the host via `docker exec`. All external testing goes through the
  gateway's published port (`8040`, proxied publicly as
  `https://doctorassist.ai/api/...`).
- Layout: `integration/patient_app/{__init__,config,db,auth,routes}.py`, plus
  `services/` (`medications.py`, `condition.py`, `checkin.py`, `care_data.py`).
  The `data/` folder of curated JSON libraries described in the original
  handoff was **dropped** during step 2 — see section 7, "no drug library"
  note — everything patient-facing now comes only from the doctor's own
  entered text, parsed, never enriched from a curated library.
- Body-size cap and `Cache-Control: no-store` are a router-level dependency
  (`guard` in `routes.py`), so the existing integration routes are unaffected.
- `config.py` never raises at import: a bad patient_app setting must not stop
  the hospital-import service. Problems are logged and patient routes return
  503.
- `integration` has its own `/health` already (returns `{"status":"healthy",
  "service":"integration",...}`); not duplicated.

## 3. Verified environment facts

- MongoDB 7.0.29, database `doctorassistai` (hard-coded across the codebase).
- IDs: in clinical collections `patient_id` / `doctor_id` are the users'
  `sys_user_id` (`PAT-...` / `DOC-...`). The patient JWT `sub` is the
  patient's `sys_user_id`. Payload: `{sub, role:"patient", username, exp}`.
  Tokens last 365 days (`PATIENT_TOKEN_EXPIRE_DAYS`).
- `patient_users.hms_id` is a **string** (`"51252"`, `"hms-test-001"`), not a
  number. It has no `doctor_id` field. `patient_users.patient_id` is a
  different short id (`PAT-6aa79a...`), not the sys_user_id.
- `user_auth` fields: `sys_user_id, doctor_assist_id, email, phone_number
  (string, 10 digits), username (= HMS ID), password, role, user_type, status,
  created_at, renewed_at`.
- `doctor_users` fields: `name, specialization, sys_user_id, doctor_id (short,
  e.g. "ZftAnLgoXO"), hospital_id, hospital_name, ...`. Doctor name = `name`,
  specialty = `specialization`.
- `patient_appointments`: one doc per patient, keyed by `sys_user_id`. Each
  appointment: `appointment_id, doctor_id (sys_user_id), date "YYYY-MM-DD",
  scheduled_time "HH:MM" or "", visit_type, chief_complaint, created_at,
  updated_at`.
- Login gap: `user_auth` has fewer records than `patient_users`; some patients
  have no `user_auth` record and cannot log in without the fallback (section
  11 fixes this — confirmed working in testing: patient "Akhil"
  `hms-test-001` logs in successfully via the real flow).
- `chemotherapy_records`: `watchSymptoms` flags are frequently all `false` or
  the patient has no active record at all — the test patient used throughout
  section 17 has **no active chemo record**. This is the main reason for LLM
  generation (section 8) rather than relying solely on the doctor's
  `watchSymptoms` flags — confirmed in testing: the LLM still produced
  medically relevant, tailored symptoms (hand-foot syndrome, mouth sores) from
  the patient's active medicines alone, with `chemo_watch: []`.
- `patient_vitals` documents hold `vitals{<timestamp>: {blood_pressure,
  heart_rate, temperature, ...}}`. **No weight** appears in the samples, so the
  weight trend comes from the patient's own check-ins.
- Gateway: `/hms/users/patients/...` (patient_auth.py + patient_proxy.py) does
  not collide with any existing gateway route. `trace_middleware` only adds
  `X-Trace-ID`.
- Groq usage: `Groq(api_key=...)`, model from env `CHECKIN_LLM_MODEL` (default
  `openai/gpt-oss-20b`), key `GROQ_API_KEY`. **Confirmed in testing: this
  model intermittently returns malformed JSON or a `400
  json_validate_failed` error** — see section 8's reliability note and section
  17's bug log. Requesting `response_format={"type":"json_object"}` plus a
  bounded retry loop brought this from ~40% failure to 100% success across a
  small (3-request) confirmed sample; larger-sample monitoring still
  recommended.
- Integration container: `integration/Dockerfile` copies `integration/` and
  `shared/`, runs `uvicorn integration.main:app`; `integration/requirements.txt`
  already has fastapi, uvicorn, motor, pymongo, python-jose, python-dotenv,
  groq, httpx, pytz, tzdata. `integration/main.py` wires in
  `patient_app_router` and calls `patient_app_ensure_indexes()` on startup in
  its own separate `@app.on_event("startup")` handler (kept separate from the
  audit-client startup handler so a slow/failed Mongo connection for
  patient_app indexes never blocks or breaks the rest of the service) —
  **confirmed present and working** (`patient_app.db - patient_app indexes
  ensured` appears in container logs on every restart).
- The gateway's `patient_proxy.py` does **not** use `get_current_principal`
  (doctor cookie auth) — patient identity is established entirely inside
  `patient_app/auth.py` via the Bearer token; the proxy just forwards
  headers/body/query string unread. **Confirmed working**: proxy round-trips
  correctly for GET and POST, strips hop-by-hop and content-length/encoding
  headers both directions.
- Mobile app: Expo, React Native, React 19. Installed: AsyncStorage,
  expo-linear-gradient, expo-speech, expo-status-bar, react-native-svg,
  @expo/vector-icons. NetInfo/offline-queue flushing code exists in
  `store.tsx` but has **not yet been exercised in testing** (see section 13).

## 4. Collections

### 4.1 Read-only (owned by the doctor system; never written here)

| Collection | Used for | Fields read |
|---|---|---|
| `user_auth` | Confirm the token's user is an active patient | `sys_user_id, role, status, username`, `phone_number` (login fallback only, in the gateway) |
| `patient_users` | Auth fallback (no `user_auth` record); demographics for the LLM (age, sex only) | `sys_user_id, hms_id, date_of_birth, gender` |
| `patient_appointments` | Which doctors the patient has; next appointment | `appointments[]` |
| `doctor_users` | Prescriber / appointment doctor name and specialty | `sys_user_id, name, specialization` |
| `documentation-medication-analysis` | Current medicines (single source of truth) | `patient_id, doctor_id, created_at, finaloutput.prescriptions[]` |
| `diagnosis_data` | Diagnosis shown to the patient | `patient_id, doctor_id, diagnosis, type, updated_at` |
| `patient_summary` | Diagnosis fallback | `summary.confirmed_diagnoses, summary.diagnosis_header` |
| `chemotherapy_records` | Doctor's `watchSymptoms` → check-in questions; active-chemo context for the LLM | `patientId, status, treatment, data.completion.watchSymptoms` (camelCase!) |
| `patient_vitals` | Optional weight, if a `weight` key ever appears | `vitals` |

Never returned to the app: `_id`, `metadata`, `safety_alerts`, `raw_extracted_text`, `safe_rx`, `overall_analysis`, or anything not in the endpoint contracts.
Ignored on purpose: `doctor_screening_questions` (empty).

### 4.2 Written by patient_app (created on first use; indexes created at startup — confirmed working)

| Collection | Purpose | Key / index | Status |
|---|---|---|---|
| `patient_checkins` | Submitted check-ins (`POST /me/checkins`); `weekly.phq`/`weekly.distress` stored under a `private` sub-object | unique `(patient_id, client_id)`; `(patient_id, date desc)` | **Confirmed working** — verified shape via mongosh in testing, including correct `private` nesting |
| `patient_med_log` | Medicine taken/late/early/skipped/together log (`POST /me/medications/log`). Rows carry `local_date` (PATIENT_TZ) so today's slot status can be looked up | unique `(patient_id, client_id)`; `(patient_id, local_date, slot_id)` | **Confirmed working** — "Taken" tap round-tripped correctly |
| `patient_alerts` | Alerts raised by the check-in payload (`alerts[]`) | `(patient_id, created_at desc)` | **Confirmed working** — a severe symptom (fatigue_bother: 3) correctly produced a matching "Severe: fatigue" alert entry |
| `patient_consent` | Server-side consent flags (`ai` gates LLM use) | unique `patient_id` | **Confirmed working** — toggled on, persisted, read back correctly |
| `patient_checkin_config` | **Designed as a cache of generated check-in questions, with input hash + model name for audit — NOT actually implemented.** See section 8. | unique `(patient_id, lang)` (index created, never used) | **Not implemented** — see section 8 and 13 |
| `patient_checkin_photos` | Photos captured during a check-in (`POST /me/checkins/photos`) — body/rash, food, or note-attach. Every photo is uploaded to the shared storage service and run through vision extraction (step 6) | unique `photo_id`; `(patient_id, client_id)` | **Built, not yet tested end to end** — see section 6.11/13 |
## 5. Identity and security rules (from the handoff, all enforced — confirmed in testing)

1. Identity only from the JWT (`patient_id = sub`). Never from URL, body or
   query. Token role must be `patient`, else 403. Missing/invalid/expired
   token → 401. **Confirmed**: `/verify` and every `/me/...` call rejected
   correctly without a valid bearer token during testing.
2. On every request the user must exist and be active, with the
   `user_auth` → `patient_users` fallback described in section 11.
   **Confirmed working** for the seeded test patient, who authenticates via
   the real login endpoint (not a manually inserted fixture).
3. Whitelist output: every response is built from explicit fields.
4. No generated clinical advice: no dosing suggestions, no "you may stop".
   Patient text comes from the doctor's own fields or validated generated
   check-in questions (section 8). The LLM system prompt also blocklists
   dosing/advice wording (`_ADVICE_BLOCKLIST` in `checkin.py`), enforced
   server-side regardless of what the model outputs.
5. Never fabricate a schedule. Unparseable frequency → `time:null,
   schedule:"unknown"`. **Confirmed**: a "long term" duration correctly
   produced no fabricated `ends_on` date; a parseable "2 weeks" correctly
   produced one.
6. Logging: `sys_user_id` and endpoint only. No names, no free-text notes, no
   tokens. **Confirmed** in container logs during testing — only
   `sub=PAT-... path=/patient_app/me/...` lines appear.
7. Writes only to the five collections in 4.2.
8. Limits: notes ≤ 2000 chars, arrays ≤ 200 items, request body ≤ 256 KB,
   unknown `status` values rejected.


Known weakness (not in scope): HMS ID + phone is a weak credential and the
token lasts 365 days. Add OTP and `/login` rate limiting before real patients
use it.

## 6. Decisions log

| # | Decision | Status |
|---|---|---|
| 1 | Current medicines use **Option B**: for each doctor, only that doctor's most recent Save Session with a **non-empty** `prescriptions` list counts. | Built and confirmed working in testing (section 17). Needs clinical sign-off. |
| 2 | **Blank duration**: no end date; the app says "Ask your doctor for the time period". `MED_DEFAULT_ACTIVE_DAYS` dropped. | Built and confirmed working — a "long term" drug produced no `ends_on`. |
| 3 | **Explicit long-term wording** → no end date. A parseable duration still ends on schedule. | Built and confirmed working with a real dictated example ("long term" vs "2 weeks"). |
| 4 | **Check-in questions are LLM-generated**, cached, and delivered from cache; rule-based fallback always exists. Red-flag list, crisis detection, escalation thresholds, ESAS and PHQ stay fixed and are never generated. | LLM generation and rule-based fallback are both built and confirmed working. **The caching half of this decision was never implemented** — see section 8. |
| 5 | **Consent gate**: patient context is sent to the LLM only if the patient's server-side `ai` consent is true. | Built and confirmed working. |
| 6 | **Language**: `en`/`hi`/`ml` sent as a display parameter, cache keyed by `(patient, lang)`. | Endpoint accepts `lang` correctly; the cache key is moot since there is no cache yet (section 8). |
| 7 | LLM = Groq, model from env `CHECKIN_LLM_MODEL` (default `openai/gpt-oss-20b`), key `GROQ_API_KEY`. | Built. **Reliability issue found and fixed** — see section 8. |
| 8 | Test-patient future appointment not seeded initially. | Superseded — testing has since happened against a real seeded patient (section 17). |
## 8a. Check-in photos (step 6) — built, not yet tested

Three capture points in the mobile app, all going through the same pipeline:
`CheckIn.tsx`'s note-attach button, the daily food-photo step, the quick
food-log bottom sheet, and (new) an optional "Add a photo" button inside the
body-kind symptom flow (alongside the existing tap-a-body-map widget).

- **Every photo — body, food, or note — is uploaded to the same storage
  service `caseDocuments.py`'s `upload_document` already uses.** Nothing is
  ever extraction-only/discarded; the doctor will eventually be able to view
  the actual stored image for any photo, food included (no doctor-facing
  view exists yet — see section 13).
- **Vision extraction** (OpenAI, `gpt-4o-mini` by default) produces two
  fields per photo: `patient_description` (short, shown back to the patient
  in the check-in chat) and `clinical_note` (slightly more detailed,
  doctor-facing, never patient-visible). Both are strictly descriptive —
  the prompt explicitly forbids naming a diagnosis or condition, mirroring
  the posture of `_ADVICE_BLOCKLIST` in `checkin.py`, though there is no
  equivalent server-side regex enforcement on the vision output yet (see
  open items below).
- **Food is never `diagnosis_relevant`**, regardless of what the model
  returns — forced server-side in `photos.py`, not merely requested in the
  prompt. This is what keeps food photos out of any future doctor
  photo-findings list and out of LLM check-in context, while still being
  stored and described to the patient like any other photo.
- **Consent-gated** the same way as check-in question generation
  (`patient_consent.ai`); if consent is off or `OPENAI_API_KEY` is unset,
  the photo record is created with `status: "skipped_no_consent"` and no
  extraction call is made — the record never gets stuck at `queued` forever.
- **Fail-closed**: any failure (storage upload, vision call, malformed
  response) ends in `status: "failed"` with nothing fabricated. The mobile
  poll loop (`GET /me/checkins/photos/{photo_id}`, 2s interval, 20 attempts
  max ≈ 40s) simply stops polling on any terminal status, success or not.
- **Correlated with the check-in it belongs to** via `client_id`: the mobile
  draft now generates one `client_id` at draft-start (`draftClientId` in
  `checkinDraft`) rather than at submission time, and both photo uploads and
  the final `POST /me/checkins` for that session share it. `submit_checkin`
  looks up all photos for that `(patient_id, client_id)` pair and folds the
  diagnosis-relevant ones' `clinical_note` (capped, condensed) into the
  saved check-in doc as `photo_findings`, which `build_llm_context`'s
  `recent_notes` already knows how to read (same mechanism as
  `note_summary`/`free_text_summary` from the free-text-answers feature).
- **Async via FastAPI `BackgroundTasks`, not Celery** — see decision 13.
| 9 | `MedCard` shows only dose when there is no time. | Confirmed present in `ui.tsx`. |
| 10 | **Hosting**: patient_app runs inside the existing `integration` container. | Confirmed working — `integration` has no published port and is reached only via the gateway proxy or `docker exec`, matching this decision. |
| 11 | **Check-in photos**: every photo (body/rash, food, note-attach) is uploaded to durable storage and run through vision extraction, consent-gated the same way as check-in question generation. A food photo is still stored and described to the patient, but is server-side forced to never be `diagnosis_relevant` — it never reaches a future doctor photo-review list or LLM check-in context. | Built, not yet tested end to end. |
| 12 | **Photo extraction model**: OpenAI (`gpt-4o-mini` by default, `PHOTO_VISION_MODEL` env override), not LlamaCloud/Groq — LlamaCloud is a document OCR parser, not a general vision describer, so it's the wrong tool for a rash/food photo. | Built. |
| 13 | **Photo pipeline runs via FastAPI `BackgroundTasks`, not Celery** — no confirmed Celery worker exists for the `integration` container, and dispatching to an unconfirmed/unlistened queue risks a task that silently never runs. Revisit if `integration` is confirmed to have a real worker. | Built as a deliberate interim choice — see section 13. |

## 6a. Doctor-facing overview (step 7) — built, tested once, one bug fixed

**What it is:** a read (mostly) panel inside the existing VoiceAssistant
dashboard, reached via Patient Story → "Patient app and alerts" in the
workflow module menu. Shows, per patient, over the last N days (default
14, `?days=` query param, 1–90):
- Current medicines + hospital-given list (reuses `medications_svc.
  build_medications()` — the exact same function and output shape the
  patient app itself uses, so there is no second, divergent medicines
  computation to keep in sync)
- Recent check-ins: symptoms, comparisons, note, red_flag, weight,
  weekly ESAS/problems — **`weekly.private` (phq/distress) is deliberately
  excluded**, same privacy boundary `care_data.load_recent_checkins`
  already documents for the patient-app side
- Alerts, newest first, each with a real `acknowledged` flag (new field on
  `patient_alerts`, defaults false for pre-existing docs) and a working
  "Acknowledge" button — the original mock version of this button did
  nothing
- Food log (`food_items` per check-in)
- An adherence rollup: taken/late/skipped counts from `patient_med_log`
  over the window, plus a check-in-days-vs-window-days count

**Auth model (deliberately different from the patient side):** patient_app
routes are Bearer-JWT-only (section 5, rule 1) and never read a cookie.
Doctor sessions in this codebase work the opposite way — `/hms/users/
auth/login` (`gateway/routes/login.py`) sets an httponly `access_token`
cookie and never returns a bearer token to the browser at all; every other
doctor route (confirmed by reading `gateway/routes/agentic.py`'s
`proxy_to_agentic`) authenticates via `get_current_user(request)`, a
**synchronous** function that reads that cookie. So the doctor overview
does NOT reuse `get_current_patient` or add a second Bearer-token path —
it adds a new `get_current_doctor` (in `patient_app/auth.py`) that trusts
an `X-Doctor-Id` header, and that header is only ever set by the gateway
proxy after it has independently verified the cookie itself. This is safe
specifically because `integration` has no published port (section 2) —
nothing outside the gateway can reach `patient_app/doctor/...` to forge
that header. Every endpoint additionally checks `doctor_id in await
get_patient_doctor_ids(patient_id)` (existing helper, unchanged) before
returning anything, so a valid doctor session for Doctor A can never pull
Doctor B's patient data even if A guesses a patient_id.

**Bug found and fixed during first wiring (2026-09-25):** `gateway/routes/
patient_app_doctor_proxy.py`'s first version called `await get_current_user
(request)`, but `get_current_user` in `login.py` is a plain `def`, not
`async def` — it returns a dict directly, and PyMongo's `find_one` inside
it is itself a **blocking, un-awaited sync call in a function other async
routes already call**, which is a separate pre-existing latency concern
noted below but not something this change introduced or fixed. Calling
`await` on the dict it returns raised `TypeError: object dict can't be
used in 'await' expression` on every request, confirmed via the gateway's
traceback pointing directly at line 43 of the proxy file. Fixed by
removing the `await`. The request routing itself (gateway → dependency
call) was confirmed correct before the fix — the 500 happened after
successfully matching the proxy route, not before — so this was purely
the async/sync mismatch, not a wiring problem.

**Known pre-existing issue, not touched:** `get_current_user`'s
`user_auth_collection.find_one(...)` is sync PyMongo called directly
inside code that runs under FastAPI's async event loop, on every
authenticated doctor request across the whole gateway (not just this new
proxy). This blocks the event loop for the duration of that Mongo call.
Out of scope for this feature — flagged here for whoever eventually
addresses gateway-wide auth performance, since it affects every doctor
route, not just `patient_app_doctor_proxy.py`.

**Files:**
- `patient_app/auth.py` — added `Doctor` dataclass + `get_current_doctor()`
- `patient_app/services/doctor_overview.py` — new, pure aggregation
  (`build_overview`, `build_adherence`), no DB access itself
- `patient_app/services/care_data.py` — added `load_alerts()`,
  `load_med_log_window()`
- `patient_app/routes_doctor.py` — new router, prefix `/patient_app/doctor`,
  mounted separately from `routes.py` in `integration/main.py` so the
  patient-only router's auth story is untouched
- `patient_app/db.py` — added an index on `(patient_id, acknowledged)` for
  `patient_alerts`
- `gateway/routes/patient_app_doctor_proxy.py` — new, prefix
  `/hms/users/doctors/me/patients`
- `gateway/main.py` — router included (confirmed present)
- `PatientApp.jsx` — full rewrite from hardcoded mock arrays to a real
  fetch-on-mount against the new endpoint, with loading/error states and
  a working acknowledge action

**Endpoints:**

| Method | Path | Notes | Test status |
|---|---|---|---|
| GET | `/hms/users/doctors/me/patients/patients/{patient_id}/overview?days=` | Cookie-authed via gateway proxy; 403 if doctor not associated with patient | **Confirmed reachable after the await fix** — response-shape verification still pending (see section 13) |
| POST | `/hms/users/doctors/me/patients/alerts/{alert_id}/acknowledge` | Same auth; validates alert's patient belongs to the calling doctor before writing | **Built, not yet tested** |

## 7. Medicines: business rules as built (step 2 — done, confirmed working)

**Source:** `documentation-medication-analysis`, `feature_id ==
"documentation-medication-analysis"`, `finaloutput.prescriptions` non-empty.

**No drug library.** The curated `drug_library.json` described in the
original handoff was dropped during implementation. Consequences, all
confirmed in testing:
- No "about"/explanation text — there's no source for it.
- No `minGapHours` — the "taken early" risk-alert heuristic now only checks
  "taken within the last hour," nothing drug-specific.
- `hospital_given` is decided **only** from the doctor's own `route` /
  `dosage_form` / `dosage_instructions` text — no fallback list of "these
  drugs are always IV."
- A field with no value in the doctor's row is **omitted**, never a
  placeholder.

**Option B algorithm** (confirmed working end to end with real dictation input):
1. Group the patient's docs by `doctor_id`.
2. Per doctor take the newest doc with a non-empty `prescriptions` list.
3. Flatten its rows; skip rows with no `medication`/`generic_name`/`brand_name`.
4. Dedupe by normalized name + strength within that session.
5. Start date = doc `created_at` in PATIENT_TZ; end date from the parsed
   duration, else none.

**Duration parsing** (confirmed against real dictated text):
- A single, parseable duration string ("2 weeks", "for 2 weeks" inside
  `dosage_instructions`) → `ends_on` = start + N days, `duration_text` shows
  it in human words.
- Explicit long-term wording ("long term", "indefinite", "ongoing", etc.) →
  no `ends_on`, `duration_text` shows the word. **Confirmed**: a dictated
  "long term" instruction correctly produced `duration_text: "Long term"`
  with the `ends_on` key entirely absent from the response, not null or a
  fabricated date.
- Blank/null/`[]` → no end date, `duration_text: null` (app shows "Ask your
  doctor for the time period").
- Cyclic/multi-option/"N cycles"/"as directed" → unspecified, no end date.

**Frequency → reminder slots**, confirmed against real dictated text:
"twice daily" → `08:00, 20:00`; "once daily" → `08:00`. Food timing parsed
from `special_instructions`/`dosage_instructions` text: "after food" →
`after_food`; "before breakfast" → `before_food`. Both confirmed rendering
correctly in the mobile UI ("Morning, after food" / "Morning, before food").

**Slot status** (computed server-side in PATIENT_TZ): `due` once the slot
time has passed today with nothing logged, else `later`; a logged status for
today wins. **Confirmed**: a med dosed at 08:00 (past, at test time) showed
"Due now"; a med dosed at 20:00 (future) showed "Later" — both correctly
split into separate cards for the same drug at different times, not merged.

## 8. Check-in questions (LLM design, step 3) — built, tested, one design gap found, one bug found and fixed

- **Design called for caching outside the request path** (generation
  triggered by context changes or once a day, stored in
  `patient_checkin_config`, `GET /me/checkin-config` reading only from that
  cache). **This is not what's actually implemented.** The real
  `routes.py`/`checkin.py` code calls `build_checkin_config` — and therefore
  the LLM, when consent is on — synchronously, inline, on every single
  request. `patient_checkin_config`'s collection and index exist in `db.py`
  but nothing ever writes to or reads from it. **Confirmed by testing**:
  five consecutive calls to the same endpoint produced different Groq calls
  each time, with genuinely different generated wording/kind across runs
  (temperature=0.3 is non-deterministic), and every call pays the full LLM
  round-trip latency. This should be revisited before production use —
  caching would fix both the per-request latency and (indirectly) the
  reliability issue below, since a cached-and-validated result wouldn't need
  to survive a fresh dice-roll from the model on every screen load.
- **Consent gate:** confirmed working — `ai_consent=false` always uses the
  rule-based fallback with no Groq call; `ai_consent=true` (and
  `GROQ_API_KEY` set) attempts generation.
- **De-identified input:** diagnosis, active medicines, doctor's
  `watchSymptoms`, treatment phase, age/sex, weight trend, recent check-in
  answers. Never name/phone/HMS ID/patient id. Confirmed in testing: the LLM
  correctly produced hand-foot-syndrome and mouth-sore questions from a
  patient on Capecitabine with **no active chemo record at all**
  (`chemo_watch: []`), proving the medicine-derived context alone is
  sufficient to drive relevant generation.
- **Output:** strict JSON, `kind` ∈ `bother|freq|body|choice`, capped at
  `CHECKIN_MAX_SYMPTOMS`.
- **Server-side validation:** schema, length limits, dosing/advice
  reject-list, all before anything reaches the patient. Any failure → rule-
  based fallback.
- **Reliability issue found and fixed (2026-09-25):** the configured Groq
  model (`openai/gpt-oss-20b`) intermittently returned either malformed JSON
  (`json.JSONDecodeError` on `resp.choices[0].message.content`) or a hard
  `400 json_validate_failed` API error, causing `call_llm` to silently
  return `None` and fall back to rule-based questions on a run that should
  have succeeded. Confirmed via container logs during testing: a 5-request
  burst before the fix produced 2 successes / 3 fallbacks, with one failure
  showing a JSON decode error at a specific line/column and another showing
  the raw `failed_generation` payload from Groq (a stray unescaped
  brace/comma deep in the `lifestyle` array). **Fix applied in
  `call_llm`:**
  1. Request `response_format={"type":"json_object"}` on the first attempt.
  2. Strip a leading/trailing markdown code fence defensively before
     `json.loads`, even though the system prompt says not to send one.
  3. Retry up to 3 total attempts (json_object mode, then plain mode twice)
     before giving up and falling back, logging each failed attempt's
     reason.
  Post-fix testing: 3/3 successes on live traffic, including one case that
  needed all 3 attempts (400 error, then malformed JSON, then success) to
  recover — confirming the retry logic itself works, not just that later
  requests happened to be luckier. Small sample; keep monitoring under real
  load. See `checkin.py`'s comment above `call_llm` (patched — see the
  accompanying code patch) for the in-code version of this note.
  Also added debug logging inside `_valid_item`/`validate_generated` (not
  yet needed to fire in the confirmed-success runs, but present for the
  next time a technically-valid-JSON-but-schema-invalid response occurs, so
  it doesn't repeat as a silent "nothing usable" mystery).
- **Never generated:** red-flag list, crisis words, escalation thresholds,
  ESAS, PHQ — all confirmed still fixed/hardcoded, not touched by generation.
- **Rule-based fallback** (also the no-consent path): confirmed working —
  when consent is off, the checklist correctly shows the fixed
  Pain/Tiredness/Nausea/Trouble-eating set from `_FALLBACK_SYMPTOMS`.
- Risks: generated Hindi/Malayalam wording is unreviewed and cannot be
  validated by us. Changing questions run to run (due to the missing cache)
  makes trends harder to compare over time — another reason to prioritize
  fixing the caching gap.

## 9. Endpoints

Contracts (JSON shapes) are in the original handoff, section 5. Gateway path
`/hms/users/patients/me/...` → internal path `/patient_app/me/...` on the
integration container — **confirmed working** via the live proxy.

| Method | Path | Notes | Test status |
|---|---|---|---|
| GET | `/me/medications` | `medications[]`, `hospital_given[]`, `last_prescribed_at`. `duration_text` null = doctor gave no period | **Confirmed** (section 17) |
| POST | `/me/medications/log` | idempotent on `client_id` | **Confirmed** (Taken-tap round-trip) |
| GET | `/me/condition` | controlled by `SHOW_DIAGNOSIS_TO_PATIENT` | **Confirmed** |
| GET | `/me/appointments/next` | earliest `date >= today` (PATIENT_TZ) across the patient's doctors | Returns 200; no appointment seeded for this test patient, so empty-state not fully exercised |
| GET | `/me/checkin-config?lang=en\|hi\|ml` | LLM-generated when consented, rule-based otherwise | **Confirmed** both paths; caching gap noted (section 8) |
| POST | `/me/checkins` | idempotent on `client_id`; PHQ and distress stored under `private` | **Confirmed** shape; idempotency re-test still pending after the `submitNote` fix (section 13) |
| GET / POST | `/me/consent` | | **Confirmed** |
| POST | `/me/checkins/photos` | multipart; `client_id`, `source` (`body`\|`food`\|`note`), `file`. Consent-gated (OpenAI key + `patient_consent.ai`); returns `photo_id` immediately, processes async via `BackgroundTasks` | **Built, not yet tested** |
| GET | `/me/checkins/photos/{photo_id}` | poll target for the mobile app while a photo is `queued`/`processing` | **Built, not yet tested** |
| GET | `/health` | integration's own, not duplicated | — |

Condition source order: latest non-"Nil", non-empty `diagnosis_data` across
the patient's doctors → `patient_summary.summary.confirmed_diagnoses[0]` →
`diagnosis_header` with `**` stripped → null. **Confirmed working** with a
real dashboard-entered diagnosis flowing through correctly, `source:
"diagnosis_data"`.

Doctors = distinct `doctor_id` from appointments ∪ prescription docs ∪
diagnosis docs, names from `doctor_users` by `sys_user_id`. **Confirmed**:
login response correctly listed the prescribing doctor's name/specialization.

## 10. Languages

`en`, `hi`, `ml`. Hindi and Malayalam text needs clinical and language review
before real use; it is not validated. This applies equally to LLM-generated
text in those languages, which is generated but unreviewed (section 8).

## 11. Gateway changes (step 4) — done, confirmed working

1. `gateway/routes/patient_proxy.py`: prefix `/hms/users/patients/me`,
   catch-all GET/POST/PUT/PATCH/DELETE → `{INTEGRATION_SERVICE_URL}/patient_app/me/{path}`.
   Forwards `Authorization`, query string, body. Strips hop-by-hop request
   headers and `content-length`/`transfer-encoding`/`content-encoding`/
   `connection` on the response side. **Confirmed working** in every test in
   section 17 — every `/me/...` call went through this proxy successfully.
2. `gateway/main.py`: imports and includes `patient_proxy_router` alongside
   `patient_auth_router` — **confirmed present** in the actual running
   `main.py`.
3. `gateway/routes/patient_auth.py` login fallback: `user_auth` →
   `patient_users` fallback by `hms_id` (string) + last-10-digit phone.
   **Confirmed working**: the test patient authenticates through the real
   `/login` endpoint end to end, not a manually inserted token.
4. Integration-side wiring — **confirmed present and working**:
   `integration/main.py` imports `patient_app_router` and
   `patient_app_ensure_indexes`, includes the router, and calls
   `ensure_indexes()` in its own startup handler. Logs confirm
   `patient_app indexes ensured` on every container start.

## 12. Patient app changes (Part B, step 5) — built, exercised manually through the UI

`src/api.ts` (API base `https://doctorassist.ai/api/`, bearer token, 10s
timeout, 401 → `logout()` — **confirmed working**, including 401 handling via
`registerOnUnauthorized`); `store.tsx` (`loadCareContext()`, persisted
last-good data, offline queues for med logs and check-ins — **queues exist in
code but have not yet been exercised with the device actually offline**, see
section 13); `App.tsx` (verify then load, refresh on foreground — **confirmed
working**: backgrounding/foregrounding the app correctly refetched
`checkinConfig` mid-testing); `Meds.tsx`/`Today.tsx`'s `DueMedicineCard` (real
list, due/later status, batch "mark together" — **confirmed rendering
correctly**; batch mode and "taken early/late" risk-alert paths not yet
exercised); `CheckIn.tsx` (generated pool, `choice` kind for lifestyle, POST
to `/me/checkins` — **confirmed working, with one bug found and fixed, see
section 13**); `i18n.ts`/`data.ts` (kept as the fallback demo set, still used
correctly when `checkinConfig` is empty or consent is off).

## 13. Risks and open items
- **Doctor overview panel (step 7) — reachability confirmed, response
  content not yet verified.** After the await-fix in section 6a, the
  request reaches `integration` and returns *something* other than a 500,
  but the actual JSON shape (medications/checkins/alerts/food_log/
  adherence all populated correctly for a real patient) has not been
  checked against Mongo directly the way section 17's patient-side testing
  did. Needs: a full pass against Akhil (`PAT-bf257a7c-...`) checking each
  of the five payload sections against what's actually in Mongo, an
  acknowledge-button round-trip test, and a 403 check using a doctor who
  is genuinely NOT associated with the test patient (to confirm
  `_require_association` actually blocks, not just that it's called).
- **`gateway/routes/login.py`'s `get_current_user` blocks the event loop**
  (sync PyMongo call inside code every doctor request path runs through,
  including the new proxy) — pre-existing, not introduced by step 7, but
  now has one more caller. Not fixed as part of this feature; flagged for
  whoever next touches gateway-wide doctor auth.
- **Check-in photos (step 6) — built, not yet tested at all.** Specific gaps:
  - No doctor-facing view of `patient_checkin_photos` or `photo_findings`
    exists yet — "just store for now, show later" per product decision.
  - The vision prompt asks the model not to name a diagnosis/condition, but
    unlike `checkin.py`'s generated symptom labels, there is no server-side
    blocklist/regex re-checking `patient_description`/`clinical_note`
    before they're stored or shown to the patient — the prompt is the only
    safeguard right now.
  - `expo-image-picker` is a newly added dependency, unverified against the
    project's actual Expo SDK 57 pin — confirm the resolved version once
    installed, and that camera permission prompts render correctly on both
    platforms.
  - No test yet of the failure paths in the mobile UI: a `status: "failed"`
    photo currently just shows nothing further (no error bubble) — decide
    if that's acceptable or needs an explicit "couldn't process that photo"
    message.
  - `BackgroundTasks` runs in-process on the `integration` container itself;
    unlike Celery this means a photo extraction job is lost if the
    container restarts mid-task, and there's no retry-on-restart. Acceptable
    for now per decision 13, but worth revisiting if `integration` is
    confirmed to run a real Celery worker.
  - The daily food-photo step's old per-item chip list (add/remove detected
    food items) was removed since it was tied to the fake `FOOD_DEMO`
    detection; `food_items` in the `/me/checkins` payload is now always `[]`
    for a photo-only submission. Decide if that field should be repurposed,
    dropped, or fed from the new `patient_description` instead.
- **Check-in caching is designed but not implemented** (section 8) — every
  consented `GET /me/checkin-config` call re-triggers the LLM inline in the
  request path, with no `patient_checkin_config` cache read/write anywhere
  in the code despite the collection and index existing. Needs either a
  background generation job as originally designed, or an explicit decision
  that inline generation is acceptable for now (it currently works, but pays
  full LLM latency on every check-in load and produces different wording
  each time, which will make longitudinal symptom tracking harder to read).
- **Fixed 2026-09-25 — LLM JSON reliability**: see section 8 for the
  `call_llm` retry/json_object-mode fix. Confirmed working post-fix on a
  small sample (3/3); recommend re-confirming under higher volume before
  relying on it for production check-ins.
- **Fixed 2026-09-25 — `CheckIn.tsx` `submitNote()` stale-state bug**: a
  patient reporting a severe symptom (`>=3`) or one marked "worse" than
  yesterday could have the follow-up questions (duration / getting worse? /
  can you eat and drink?) silently skipped, because `needsFollow` was
  computed from a stale closed-over `chosenSymptoms`/`D.ans` snapshot instead
  of the freshest draft state. The nurse alert in `finalizeAll()` still fired
  correctly (it reads state fresh via a `useEffect`), so the bug was
  invisible from the alert side alone — only visible by comparing the saved
  `patient_checkins` document (`symptoms.fatigue_bother: 3` but
  `follow_up: null`) against what should have appeared in the UI. Fixed by
  moving the `needsFollow` computation inside a functional `ud((d) => ...)`
  update so it reads the current draft rather than a render-time closure.
  **Needs retesting** after the fix to confirm the follow-up questions now
  appear correctly for a severe symptom, and that the fix didn't introduce a
  regression elsewhere in the draft-update flow.
- Option B and the duration rules need clinical sign-off (still true — see
  section 7; the parsing itself is now confirmed correct on real dictated
  examples, but clinical sign-off on the *rules themselves* is separate from
  technical correctness).
- Doctors cannot remove all medicines by saving an empty session (needs a
  stop flag doctor-side) — not exercised in testing, still a known gap.
- Imported visit history can override the current list under Option B — not
  exercised in testing (no imported-history test patient used).
- Hindi/Malayalam text (both the static UI strings and any LLM-generated
  text) is unreviewed.
- Weight is not in `patient_vitals`; the weight trend depends on patients
  entering it in check-ins — not yet exercised across multiple days of
  check-ins (only single-session testing so far, so no real trend data
  exists yet for this test patient).
- **Not yet tested** (carried over from before, still open after this
  session):
  - Red-flag "Yes" path (should route to Urgent screen with an urgent nurse
    alert) — only "No" has been exercised.
  - Crisis-word detection in the note field and the quick-message box.
  - Idempotency re-test on `POST /me/checkins` with a repeated `client_id`,
    specifically after the `submitNote` fix.
  - Visual confirmation of the diagnosis card on the Today tab (confirmed at
    the API level via `GET /me/condition`, not yet screenshotted in the app).
  - PHQ-2 branch (only triggers when the weekly distress score is `>=5`) —
    not yet exercised; the one weekly section tested had a distress score of
    2.
  - Offline queueing (`medLogQueue`/`checkinSubmitQueue`) and the actual
    device-offline UI banner.
  - Batch "mark multiple medicines taken together" flow.
  - "Taken early"/"taken late" risk-alert thresholds on the Meds screen.
- The Section-5 weak-credential issue (HMS ID + phone, 365-day token, no
  rate limit) — unchanged, not addressed this session.
- Body-size guard checks `Content-Length` only; the gateway always sends it
  — unchanged.

## 14. Out of scope (phase 2)

Cycle/day card from `chemotherapy_records`; patient-adjustable reminder
times; doctor-dashboard panel for patient-reported check-ins; push
notifications; audit events via `shared.audit`; rate limiting on `/login`;
caregiver code redemption; **actually implementing the check-in cache**
(moved here from an implicit assumption to an explicit phase-2 item, given
section 8's finding that it was never built).

## 15. Test patient and seed

Two test patients have been used across this project's history:

- **Original seed** (from the original handoff, Appendix B): HMS ID `51252`,
  `sys_user_id PAT-cb42a44f-671c-45bd-876b-a70c94940fb7`, doctor
  `DOC-8f411554-cf17-4ac2-b65c-637441b8306e` ("Dr. Narayanankutty Warrier",
  Medical Oncology). Has 2 medication docs with **empty** prescriptions and
  no active chemo record. This patient was used for early login/verify
  smoke-testing only.
- **Live UI test patient** (used throughout section 17's full pipeline test):
  "Akhil", HMS ID `hms-test-001`, `sys_user_id
  PAT-bf257a7c-13a8-424b-8896-65daea03a7a0`, doctor
  `DOC-dcf818e8-a3e0-427a-b935-98b6f602699c` ("virat", Medical Oncology). No
  active chemo record. This is the patient the doctor-dashboard dictation,
  medication parsing, diagnosis, and full check-in flow were actually
  exercised against — treat this as the primary reference patient for future
  testing sessions, since it now has real dictated medicines, a real
  diagnosis, and at least one real check-in on file.

Definition of done for the pipeline as a whole (updated from the original,
now largely met for the happy paths — see section 13 for what's still open):
doctor dashboard dictation correctly parses into `documentation-medication-
analysis` and `diagnosis_data`; the patient app shows the correct computed
medication schedule, food timing, and duration handling; check-in generation
works (with the caching and reliability caveats in section 8); check-in
submission produces a correctly shaped `patient_checkins` document and fires
alerts appropriately for severe symptoms — **all confirmed working** as of
this session, with the open items in section 13 being the remaining gaps
before this could be called fully done.

## 16. Build status

| Step | Content | Status |
|---|---|---|
| 1 | Skeleton in `integration/patient_app/` | **Done, confirmed working** |
| 2 | Medicines: parsers, Option B logic, `GET /me/medications`, `POST /me/medications/log` | **Done, confirmed working end to end (section 17)** |
| 3 | Condition, appointments, consent, check-in generator + fallback, `POST /me/checkins` | **Done, confirmed working, with the caching gap and one now-fixed LLM reliability bug (section 8)** |
| 4 | Gateway proxy, login fallback, compose entry | **Done, confirmed working** |
| 5 | Part B mobile app | **Done, exercised manually through the UI; one bug found and fixed (section 13); several flows still untested (section 13)** |
| 7 | Doctor-facing overview panel (VoiceAssistant "Patient app and alerts") | **Built; one auth bug found and fixed (section 6a); reachability confirmed, response content not yet verified (section 13)** |
## 18. Doctor overview — design notes not covered elsewhere

- **Why a separate router instead of extending `routes.py`:** `routes.py`'s
  whole design assumes every dependency is `get_current_patient`
  (Bearer-only). Rather than branch that file's auth model per-route, the
  doctor endpoints live in their own file (`routes_doctor.py`) with their
  own `Depends(get_current_doctor)`, mounted as a second router in
  `integration/main.py`. This keeps the patient-only router's threat model
  simple to audit — nothing in `routes.py` needed to change at all for
  step 7.
- **Why a header (`X-Doctor-Id`) instead of forwarding the cookie itself:**
  the gateway already fully authenticates the cookie via `get_current_user`
  before this feature existed. Re-forwarding the raw cookie into
  `integration` would mean decoding the same JWT twice in two places with
  two copies of the same logic to keep in sync. Trusting a header set by
  the one caller that can reach `integration` at all (no published port)
  is simpler and has one fewer place to get the JWT-decoding logic wrong.
  This pattern only holds as long as `integration` truly stays
  unreachable from outside the compose network — if that ever changes,
  `get_current_doctor`'s trust of `X-Doctor-Id` needs to change with it.
- **Why `weekly.private` stays excluded for doctors too:** this mirrors an
  existing design decision (`care_data.load_recent_checkins`'s comment)
  rather than introducing a new one — phq/distress were already scoped as
  patient-private before step 7 existed; step 7 just had to remember to
  carry that exclusion into a new query path rather than accidentally
  re-including it.

## 17. Testing log

### 2026-09-25 — First full pipeline test, doctor dashboard → patient app

Test patient: "Akhil", HMS ID `hms-test-001`,
`PAT-bf257a7c-13a8-424b-8896-65daea03a7a0`, doctor
`DOC-dcf818e8-a3e0-427a-b935-98b6f602699c` ("virat", Medical Oncology). No
active chemo record.

**Confirmed working end to end:**
- Doctor dashboard dictation → Medication Analysis parsing →
  `documentation-medication-analysis` save → `GET /me/medications` → mobile
  Meds screen, with correct per-slot food timing and correct duration
  handling (fixed "2 weeks" duration produced `ends_on` + `duration_text`;
  "long term" produced `duration_text` only, no fabricated `ends_on`).
- Diagnosis: dashboard textarea → `diagnosis_data` → `GET /me/condition`
  (API-level confirmed; Today-tab visual confirmation still open, see
  section 13).
- Patient login (HMS ID + phone → JWT) and `/verify`, through the real
  endpoints, not a manually inserted fixture.
- Consent toggle (`POST`/`GET /me/consent`).
- LLM-generated check-in symptoms, visually confirmed in the app UI to
  differ from the rule-based fallback and to reflect the patient's actual
  active medicine (Capecitabine → hand-foot syndrome and mouth sores
  correctly appeared as generated symptoms), despite no active chemo record.
- Medicine "Taken" logging round-trip (`POST /me/medications/log`).
- Check-in submission (`POST /me/checkins`) — verified document shape,
  including `weekly.private.{phq,distress}` nesting.
- Nurse alert firing for a severe symptom (`finalizeAll()` path).

**Bugs found and fixed this session:**
- **LLM JSON-parsing/validation reliability** in `call_llm` (`checkin.py`) —
  the configured Groq model intermittently returned malformed JSON or a
  `400 json_validate_failed` error. Fixed with `response_format:
  json_object`, defensive fence-stripping, and a bounded 3-attempt retry.
  Pre-fix: 2/5 success in a burst test. Post-fix: 3/3 success in a
  follow-up burst, including one case that needed all 3 attempts to recover.
- **`submitNote()` stale-state bug** in `CheckIn.tsx` — a severe symptom
  (`fatigue_bother: 3`) correctly triggered the nurse alert in
  `finalizeAll()` but the follow-up questions (duration/worse/eating) were
  silently skipped because `needsFollow` was computed from a stale closure
  instead of fresh draft state. Fixed by moving the computation inside a
  functional `ud((d) => ...)` update. **Needs retest** — not yet re-verified
  after the fix (see section 13).

**Still open / not yet tested** (see section 13 for full detail): red-flag
"Yes" path, crisis-word detection, idempotency re-test post-fix, Today-tab
diagnosis card visual check, PHQ-2 branch, offline queueing, batch medicine
logging, taken-early/late risk-alert thresholds, and the check-in caching gap
itself (a design gap, not a bug, but worth prioritizing before production
use).