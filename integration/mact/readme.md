# MACT backend: petition registration and case list

First slice of the MACT backend. Scope: **register a petition manually** and **list cases**. Nothing else yet.

## Architecture

Same pattern as patient_app: the logic lives in the `integration` container, and the gateway only proxies.

```
React app ──► gateway  /hms/mact/{path}   (cookie login checked, Cookie forwarded)
                 │  routes/mact_proxy.py
                 ▼
              integration  /mact/{path}   (JWT verified again, all logic here)
                 │  integration/mact/*
                 ▼
              MongoDB  doctorassistai.mact_*
```

The public URLs do not change: `/hms/mact/cases`.

## Files

| File | Purpose |
|---|---|
| `integration/mact/db.py` | Motor client, collections, indexes (import-safe) |
| `integration/mact/auth.py` | Verifies the login JWT (cookie or Bearer) and the user in `user_auth` |
| `integration/mact/models.py` | Request model (`RegisterCaseIn`) |
| `integration/mact/service.py` | Numbering, case builder, register, list, delete samples |
| `integration/mact/seed.py` | One-time sample load |
| `integration/mact/routes.py` | Internal endpoints under `/mact` |
| `gateway/routes/mact_proxy.py` | Public `/hms/mact/{path}` → integration `/mact/{path}` |
| `tools/export_mact_samples.mjs` | Turns the React `cases.js` into `samples.json` |

Edits to existing files: `integration` app file (3) and `gateway/main.py` (2). See "Wiring".

## Endpoints (public paths, cookie login required)

### `POST /hms/mact/cases`: register a petition
```json
{ "cnr": "KABC0A0019902026", "mvc": "MVC 1990/2026", "court": "MACT (SCCH-9), Bengaluru",
  "type": "Death", "victim": "Harish B.", "age": 36, "claim": 4500000,
  "acc": "2026-07-12", "pol": "PC-2604-KA-0101990" }
```
Optional: `state`, `district`, `filed`, `notice_on` (both default to today, IST), `no_fault_kind` (`Death`/`Injury`, for `type: "No-fault"`).

- `201`: `{ "status": "success", "case": { ...full case, same shape as the React case object... } }`
- `409`: CNR, or petition no. at the same court, already exists. Body has `existing_case_id`.
- `422`: validation (bad CNR, future accident date, filing date before accident, ...).

### `GET /hms/mact/cases`: list
Query: `q` (id / CNR / petition no. / victim / court), `type`, `include_samples` (default true), `skip`, `limit` (default 50, max 200). Newest registration first. Returns a summary per case.

### `DELETE /hms/mact/cases/samples`: remove sample cases
`system_admin` only. Samples do not come back on restart.

Proxy-level errors: `401` not logged in (gateway), `503` integration unreachable, `504` timeout.

## Rules implemented

- **Numbering**: `MACT-<year>-<0001…>`. Restarts at 0001 every year (IST). Numbers already taken (samples, imports) are skipped. Numbers are never reused; a failed insert can leave a gap.
- **Sample cases**: loaded once at integration startup from `integration/mact/samples/samples.json`, flagged `is_sample: true`. A marker in `mact_meta` makes this once-only, even with several workers. Set `MACT_SEED_SAMPLES=false` in the integration container's env to skip.
- **Access**: global. Any logged-in user sees all cases.
- **Late petitions**: never rejected or flagged for time-bar.
- **Not invented**: unknown values are stored as `null` or `"—"` (age, policy period, district/state).

## Wiring

**Integration app file** (the one with `app = FastAPI()` and `patient_app_startup_event`):

1. Under `from .patient_app.db import ensure_indexes as patient_app_ensure_indexes` add:
   ```python
   from .mact.routes import router as mact_router
   from .mact.db import ensure_indexes as mact_ensure_indexes
   from .mact.seed import seed_samples as mact_seed_samples
   ```
2. Under `app.include_router(patient_app_doctor_router)` add `app.include_router(mact_router)`.
3. After `patient_app_startup_event` add:
   ```python
   @app.on_event("startup")
   async def mact_startup_event():
       await mact_ensure_indexes()
       await mact_seed_samples()
   ```

**Gateway `main.py`**:

1. Under the `patient_app_doctor_proxy` import add `from .routes.mact_proxy import router as mact_proxy_router`.
2. Under `app.include_router(patient_app_doctor_proxy_router)` add `app.include_router(mact_proxy_router)`.

**Samples** (once, from the React repo):
```bash
node tools/export_mact_samples.mjs ../mact-frontend/src/data/cases.js
```
This writes `integration/mact/samples/samples.json`. Make sure that folder is copied into the **integration** image.

**Env** (integration container): `MONGO_URI`, `SECRET_KEY`, `ALGORITHM` (same values the gateway signs with). Gateway: `INTEGRATION_SERVICE_URL` (already set).

Rebuild the **integration** and **gateway** images. Integration logs should show `mact indexes ensured` and `seeded N sample cases`.

## Try it

```bash
curl -b cookies.txt -X POST http://localhost:8000/hms/mact/cases \
  -H 'Content-Type: application/json' \
  -d '{"cnr":"KABC0A0019902026","mvc":"MVC 1990/2026","court":"MACT (SCCH-9), Bengaluru","type":"Death","victim":"Harish B.","age":36,"claim":4500000,"acc":"2026-07-12","pol":"PC-2604-KA-0101990"}'

curl -b cookies.txt 'http://localhost:8000/hms/mact/cases?q=harish'
```

## Collections

`mact_cases` (unique `id`, unique `cnr`), `mact_counters` (`case:<year>`), `mact_events` (activity log), `mact_meta`.

## Front-end notes

- The Sync form says "document requests sent" and defaults age to 35 when blank. The backend does neither: no documents are requested yet and age is stored as `null`. Change the toast and the age fallback when the form is switched to this API.
- New cases have `policy.from` / `policy.to` = `null`; views that format those dates must tolerate it.
- The hard-coded `state: "Karnataka"` is gone.
- Cross-site cookies: the login cookie is `SameSite=None; Secure`, so the front-end must call the gateway over HTTPS with `credentials: "include"` (the gateway CORS already allows credentials).

## Not done yet

Get-one case, documents, stage advance, decisions, connectors.