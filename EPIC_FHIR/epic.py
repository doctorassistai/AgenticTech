import base64
import json
import logging
import os
import re
import time
import uuid
from dataclasses import dataclass
from typing import Optional

import jwt  # pip install pyjwt cryptography
from cryptography.hazmat.primitives import serialization
from fastapi.responses import JSONResponse
import requests
from fastapi import APIRouter, Depends, Request, HTTPException
from fastapi.responses import RedirectResponse
from requests_oauthlib import OAuth2Session

router = APIRouter(
    prefix="",
    tags=["EPIC FHIR"],
)

# --- Configuration (Populated via Docker environment variables) ---
CLIENT_ID = os.getenv("epic_client_id_sandbox")
CLIENT_SECRET = os.getenv("epic_client_secret")

from itsdangerous import URLSafeTimedSerializer, BadSignature, SignatureExpired

# --- Redirect URI must exactly match your registered callback path ---
REDIRECT_URI = "https://doctorassist.ai/api/hms/users/epic/callback"

# Signs the OAuth "state" so it carries its own context (token_endpoint, fhir_base_url)
# instead of relying on a server-side dict that breaks across workers/restarts.
STATE_SIGNING_SECRET = os.getenv("epic_state_signing_secret", "change-me-in-production-please")
state_signer = URLSafeTimedSerializer(STATE_SIGNING_SECRET)
STATE_MAX_AGE_SECONDS = 600  # 10 minutes to complete the login


def discover_smart_endpoints(iss: str) -> dict:
    """Discover the real authorize/token/fhir endpoints for this EHR launch from its iss."""
    iss = iss.rstrip("/")
    try:
        r = requests.get(f"{iss}/.well-known/smart-configuration", timeout=5)
        r.raise_for_status()
        cfg = r.json()
        return {
            "authorization_endpoint": cfg["authorization_endpoint"],
            "token_endpoint": cfg["token_endpoint"],
            "fhir_base_url": iss,
        }
    except Exception:
        # Fallback: parse CapabilityStatement at {iss}/metadata
        r = requests.get(f"{iss}/metadata", headers={"Accept": "application/fhir+json"}, timeout=5)
        r.raise_for_status()
        capability = r.json()
        security = capability["rest"][0]["security"]
        ext = next(
            e for e in security.get("extension", [])
            if e.get("url") == "http://fhir-registry.smarthealthit.org/StructureDefinition/oauth-uris"
        )
        uris = {e["url"]: e["valueUri"] for e in ext["extension"]}
        return {
            "authorization_endpoint": uris["authorize"],
            "token_endpoint": uris["token"],
            "fhir_base_url": iss,
        }


@router.get("/ping")
def ping():
    """Simple ping route to confirm the router itself is wired up correctly."""
    return {"message": "EPIC_FHIR router is alive"}


# 1. THE LAUNCH HANDSHAKE ENDPOINT
# Public path: https://doctorassist.ai
@router.get("/launch")
def smart_launch(request: Request):
    """
    The simulator triggers this automatically when you click launch.
    It saves the context and redirects the browser to log in.
    """
    query_params = dict(request.query_params)
    launch_token = query_params.get("launch")
    iss_url = query_params.get("iss")  # The EHR FHIR database server URL

    if not launch_token or not iss_url:
        raise HTTPException(status_code=400, detail="Missing required launch or iss context.")



    # Discover this EHR's real SMART endpoints from its iss
    endpoints = discover_smart_endpoints(iss_url)

    # Request read permissions for demographics and vital signs
    scopes = [
        "launch",
        "patient/Patient.read",
        "patient/Observation.read",
        "patient/Condition.read",
        "patient/AllergyIntolerance.read",
        "patient/MedicationRequest.read",
        "patient/Immunization.read",
        "patient/Procedure.read",
        "patient/Encounter.read",
        "patient/DiagnosticReport.read",
        "patient/DocumentReference.read",
        "patient/CarePlan.read",
        "patient/Goal.read",
    ]

    # Encode everything the callback will need directly into a signed state token.
    # No server-side storage required, so this works across any number of workers/replicas.
    state = state_signer.dumps({
        "token_endpoint": endpoints["token_endpoint"],
        "fhir_base_url": endpoints["fhir_base_url"],
    })

    oauth = OAuth2Session(CLIENT_ID, redirect_uri=REDIRECT_URI, scope=scopes, state=state)

    authorization_url, _ = oauth.authorization_url(
        endpoints["authorization_endpoint"],
        launch=launch_token,
        aud=iss_url,
    )

    return RedirectResponse(authorization_url)


# 2. THE CALLBACK EXCHANGE ENDPOINT
# Public path: https://doctorassist.ai
@router.get("/callback")
def smart_callback(request: Request):
    """
    The simulator securely redirects back here with a data-access grant code.
    We swap that code for a secure, functional access token.
    """
    query_params = dict(request.query_params)
    returned_state = query_params.get("state")

    if not returned_state:
        raise HTTPException(status_code=400, detail="Missing state parameter.")

    # Verify signature and decode the context that was embedded at /launch time
    try:
        launch_ctx = state_signer.loads(returned_state, max_age=STATE_MAX_AGE_SECONDS)
    except SignatureExpired:
        raise HTTPException(status_code=400, detail="Login session expired. Please relaunch the app.")
    except BadSignature:
        raise HTTPException(status_code=400, detail="State verification failed. Request blocked.")

    # The EHR reports authorization failures as ?error=...&error_description=...
    if query_params.get("error"):
        raise HTTPException(
            status_code=400,
            detail=f"Authorization denied: {query_params.get('error')} - {query_params.get('error_description', '')}",
        )

    auth_code = query_params.get("code")
    if not auth_code:
        raise HTTPException(status_code=400, detail="Missing authorization code.")

    # Trade the authorization code for an access token.
    # Confidential symmetric clients must authenticate with HTTP Basic auth.
    try:
        token_http = requests.post(
            launch_ctx["token_endpoint"],
            data={
                "grant_type": "authorization_code",
                "code": auth_code,
                "redirect_uri": REDIRECT_URI,
            },
            auth=(CLIENT_ID, CLIENT_SECRET),
            headers={"Accept": "application/json"},
            timeout=15,
        )
    except requests.RequestException as e:
        raise HTTPException(status_code=502, detail=f"Token endpoint unreachable: {e}")

    if token_http.status_code != 200:
        raise HTTPException(
            status_code=400,
            detail=f"OAuth Handshake failed ({token_http.status_code}): {token_http.text}",
        )

    token_response = token_http.json()

    access_token = token_response.get("access_token")
    patient_id = token_response.get("patient")  # The simulator returns the current active patient automatically

    if not access_token or not patient_id:
        raise HTTPException(status_code=400, detail="Failed to retrieve active token or patient context.")

    # Call our internal helper to pull real clinical JSON files from the EHR server
    clinical_data = fetch_clinical_records_from_fhir(access_token, patient_id, launch_ctx["fhir_base_url"])
    
    # Process the clinical results using our custom AI parsing pipeline below
    ai_insights = process_with_ai_engine(clinical_data)

    response = {"status": "Success", "patient_id": patient_id, **ai_insights}
    if clinical_data["errors"]:
        response["errors"] = clinical_data["errors"]  # only shown when a category failed
    return response


# 3. FUNCTIONAL PATIENT DATA ENDPOINT
# Public path: https://doctorassist.ai{patient_id}
@router.get("/patient/{patient_id}")
def get_patient(patient_id: str, request: Request, fhir_base_url: str):
    """Fetches a specific patient resource bundle directly from the live FHIR API."""
    auth_header = request.headers.get("Authorization")
    if not auth_header:
        raise HTTPException(status_code=401, detail="Missing required Authorization header.")

    headers = {
        "Authorization": auth_header,
        "Accept": "application/fhir+json"
    }

    res = requests.get(f"{fhir_base_url.rstrip('/')}/Patient/{patient_id}", headers=headers)
    if res.status_code != 200:
        raise HTTPException(status_code=res.status_code, detail="Failed fetching patient records from EHR.")

    return res.json()


# --- Internal Helper Core Functions ---

# (label, resource type, extra search params)
RESOURCE_QUERIES = [
    ("vitals", "Observation", {"category": "vital-signs"}),
    ("labs", "Observation", {"category": "laboratory"}),
    ("social_history", "Observation", {"category": "social-history"}),
    ("problems", "Condition", {"category": "problem-list-item"}),
    ("encounter_diagnoses", "Condition", {"category": "encounter-diagnosis"}),
    ("conditions", "Condition", {}),  # no category filter; merged and de-duplicated in the summary
    ("allergies", "AllergyIntolerance", {}),
    ("medications", "MedicationRequest", {}),
    ("immunizations", "Immunization", {}),
    ("procedures", "Procedure", {}),
    ("encounters", "Encounter", {}),
    ("diagnostic_reports", "DiagnosticReport", {}),
    ("documents", "DocumentReference", {}),
    ("care_plans", "CarePlan", {}),
    ("goals", "Goal", {}),
]


def fetch_all_pages(base: str, headers: dict, resource_type: str, params: dict, max_pages: int = 25):
    """Search a resource type and follow Bundle 'next' links until exhausted."""
    url = f"{base}/{resource_type}"
    query = {"_count": 100, **params}
    resources = []

    for _ in range(max_pages):
        try:
            res = requests.get(url, headers=headers, params=query, timeout=20)
        except requests.RequestException as e:
            return resources, {"status": None, "detail": str(e)}

        if res.status_code != 200:
            return resources, {"status": res.status_code, "detail": res.text[:300]}

        bundle = res.json()
        for entry in bundle.get("entry", []):
            resource = entry.get("resource", {})
            if resource.get("resourceType") != "OperationOutcome":
                resources.append(resource)

        next_url = next(
            (l.get("url") for l in bundle.get("link", []) if l.get("relation") == "next"),
            None,
        )
        # Only follow pagination links that stay on the same FHIR server
        if not next_url or not next_url.startswith(base):
            break
        url, query = next_url, None  # next link already carries its query string

    return resources, None


def fetch_clinical_records_from_fhir(access_token: str, patient_id: str, fhir_base_url: str) -> dict:
    """Pulls demographics plus every configured resource type for the patient."""
    base = fhir_base_url.rstrip("/")
    headers = {"Authorization": f"Bearer {access_token}", "Accept": "application/fhir+json"}

    patient_res = requests.get(f"{base}/Patient/{patient_id}", headers=headers, timeout=20)
    demographics = patient_res.json() if patient_res.status_code == 200 else {}

    resources, errors = {}, {}
    for label, resource_type, params in RESOURCE_QUERIES:
        items, err = fetch_all_pages(base, headers, resource_type, {"patient": patient_id, **params})
        resources[label] = items
        if err:
            errors[label] = err  # e.g. 403 = scope/API not granted, 400 = missing required param

    return {"demographics": demographics, "resources": resources, "errors": errors}


def _observation_date(r: dict):
    return r.get("effectiveDateTime") or r.get("effectivePeriod", {}).get("start") or r.get("issued")


def summarize_observation(r: dict) -> dict:
    """Flatten an Observation, including multi-part values such as blood pressure."""
    code = r.get("code", {})
    name = code.get("text") or (code.get("coding") or [{}])[0].get("display", "Unknown")
    entry = {"name": name, "date": _observation_date(r), "id": r.get("id")}

    if "valueQuantity" in r:
        entry["value"] = r["valueQuantity"].get("value")
        entry["unit"] = r["valueQuantity"].get("unit", "")
    elif "valueString" in r:
        entry["value"] = r["valueString"]
    elif "valueCodeableConcept" in r:
        entry["value"] = r["valueCodeableConcept"].get("text")

    if r.get("component"):
        entry["components"] = [
            {
                "name": (c.get("code", {}).get("text")
                         or (c.get("code", {}).get("coding") or [{}])[0].get("display")),
                "value": c.get("valueQuantity", {}).get("value"),
                "unit": c.get("valueQuantity", {}).get("unit", ""),
            }
            for c in r["component"]
        ]
    return entry


from datetime import date


def _date(value):
    """'1986-07-16T08:54:18+00:00' -> '1986-07-16'"""
    return value[:10] if value else None


def _code_text(concept):
    """Readable label from a CodeableConcept."""
    if not concept:
        return None
    return concept.get("text") or (concept.get("coding") or [{}])[0].get("display")


def _round(value):
    return round(value, 1) if isinstance(value, (int, float)) else value


def _age(birth, until=None):
    try:
        b = date.fromisoformat(birth[:10])
        e = date.fromisoformat(until[:10]) if until else date.today()
        return e.year - b.year - ((e.month, e.day) < (b.month, b.day))
    except Exception:
        return None


def _newest_first(items, key):
    return sorted(items, key=lambda x: x.get(key) or "", reverse=True)


def clean_patient(p: dict) -> dict:
    name = (p.get("name") or [{}])[0]
    full_name = " ".join(filter(None, [*name.get("prefix", []), *name.get("given", []), name.get("family")]))
    addr = (p.get("address") or [{}])[0]
    address = ", ".join(filter(None, [
        ", ".join(addr.get("line", [])), addr.get("city"), addr.get("state"), addr.get("postalCode"),
    ]))
    phone = next((t.get("value") for t in p.get("telecom", []) if t.get("system") == "phone"), None)
    mrn = next(
        (i.get("value") for i in p.get("identifier", [])
         if any(c.get("code") == "MR" for c in i.get("type", {}).get("coding", []))),
        None,
    )
    deceased_date = p.get("deceasedDateTime")
    deceased = bool(deceased_date or p.get("deceasedBoolean"))

    return {
        "id": p.get("id"),
        "name": full_name or None,
        "gender": p.get("gender"),
        "birth_date": p.get("birthDate"),
        "age": _age(p.get("birthDate"), deceased_date if deceased else None),
        "deceased": deceased,
        "deceased_date": _date(deceased_date),
        "marital_status": _code_text(p.get("maritalStatus")),
        "language": _code_text(((p.get("communication") or [{}])[0]).get("language")),
        "phone": phone,
        "address": address or None,
        "mrn": mrn,
    }


def _reading(r: dict) -> dict:
    """One Observation -> {date, value, unit}, or {date, systolic, diastolic, unit} for BP."""
    when = _date(_observation_date(r))
    components = r.get("component")
    if components:
        values = {}
        for c in components:
            label = (_code_text(c.get("code")) or "value").lower()
            key = "systolic" if "systolic" in label else "diastolic" if "diastolic" in label else label
            values[key] = _round(c.get("valueQuantity", {}).get("value"))
        unit = next((c["valueQuantity"].get("unit") for c in components if c.get("valueQuantity")), "")
        return {"date": when, **values, "unit": unit}

    vq = r.get("valueQuantity")
    if vq:
        return {"date": when, "value": _round(vq.get("value")), "unit": vq.get("unit", "")}
    return {"date": when, "value": r.get("valueString") or _code_text(r.get("valueCodeableConcept"))}


def _group_observations(items: list) -> dict:
    """Group by test name; latest reading first, older ones under 'previous'."""
    groups = {}
    for r in items:
        groups.setdefault(_code_text(r.get("code")) or "Unknown", []).append(_reading(r))
    return {
        name: {"latest": readings[0], "previous": readings[1:]}
        for name, readings in ((n, _newest_first(rs, "date")) for n, rs in groups.items())
    }


def process_with_ai_engine(clinical_data: dict) -> dict:
    """Builds a compact, structured clinical summary with no FHIR bookkeeping."""
    res = clinical_data.get("resources", {})

    # Merge every Condition query and de-duplicate by id
    seen, conditions = set(), []
    for label in ("problems", "encounter_diagnoses", "conditions"):
        for c in res.get(label, []):
            if c.get("id") in seen:
                continue
            seen.add(c.get("id"))
            conditions.append({
                "name": _code_text(c.get("code")),
                "status": _code_text(c.get("clinicalStatus")),
                "onset": _date(c.get("onsetDateTime") or c.get("recordedDate")),
            })

    medications = _newest_first([
        {
            "name": _code_text(m.get("medicationCodeableConcept")),
            "status": m.get("status"),
            "prescribed_on": _date(m.get("authoredOn")),
        }
        for m in res.get("medications", [])
    ], "prescribed_on")

    allergies = [
        {
            "substance": _code_text(a.get("code")),
            "status": _code_text(a.get("clinicalStatus")),
            "criticality": a.get("criticality"),
        }
        for a in res.get("allergies", [])
    ]

    immunizations = _newest_first([
        {
            "vaccine": _code_text(i.get("vaccineCode")),
            "date": _date(i.get("occurrenceDateTime")),
            "status": i.get("status"),
        }
        for i in res.get("immunizations", [])
    ], "date")

    procedures = _newest_first([
        {
            "name": _code_text(p.get("code")),
            "date": _date(p.get("performedDateTime") or p.get("performedPeriod", {}).get("start")),
            "status": p.get("status"),
            "reason": ((p.get("reasonReference") or [{}])[0]).get("display"),
        }
        for p in res.get("procedures", [])
    ], "date")

    encounters = _newest_first([
        {
            "type": _code_text((e.get("type") or [{}])[0]),
            "class": e.get("class", {}).get("code"),
            "start": _date(e.get("period", {}).get("start")),
            "end": _date(e.get("period", {}).get("end")),
            "reason": _code_text((e.get("reasonCode") or [{}])[0]),
        }
        for e in res.get("encounters", [])
    ], "start")

    reports = _newest_first([
        {
            "name": _code_text(d.get("code")),
            "date": _date(d.get("effectiveDateTime") or d.get("issued")),
            "status": d.get("status"),
            "result_count": len(d.get("result", [])),
        }
        for d in res.get("diagnostic_reports", [])
    ], "date")

    care_plans = [
        {
            "name": _code_text((c.get("category") or [{}])[0]),
            "status": c.get("status"),
            "start": _date(c.get("period", {}).get("start")),
            "end": _date(c.get("period", {}).get("end")),
            "activities": [
                _code_text(a.get("detail", {}).get("code")) for a in c.get("activity", [])
            ],
        }
        for c in res.get("care_plans", [])
    ]

    summary = {
        "patient": clean_patient(clinical_data.get("demographics", {})),
        "conditions": conditions,
        "medications": medications,
        "allergies": allergies,
        "vitals": _group_observations(res.get("vitals", [])),
        "labs": _group_observations(res.get("labs", [])),
        "immunizations": immunizations,
        "procedures": procedures,
        "encounters": encounters,
        "diagnostic_reports": reports,
        "care_plans": care_plans,
    }
    # Drop empty sections so the response only contains what exists
    return {k: v for k, v in summary.items() if v or k == "patient"}


# =====================================================================
# EPIC BACKEND SERVICES FLOW (no app launch, no user login)
# doctor clicks patient -> stored Epic link -> token -> verify identity -> fetch -> process
# =====================================================================
audit_log = logging.getLogger("epic.audit")
EPIC_ENV = os.getenv("EPIC_ENV", "sandbox")  # "sandbox" or "production"
SANDBOX_FHIR_BASE = "https://fhir.epic.com/interconnect-fhir-oauth/api/FHIR/R4"


@dataclass(frozen=True)
class HospitalConfig:
    hospital_id: str
    fhir_base_url: str
    client_id: str
    private_key_pem: str
    key_id: Optional[str] = None


def _private_key() -> str:
    pem = os.getenv("epic_private_key_pem")
    if pem:
        return pem.replace("\\n", "\n")
    with open(os.environ["epic_private_key_path"], "r") as f:
        return f.read()


def get_hospital_config(hospital_id: str) -> HospitalConfig:
    key_id = os.getenv("epic_key_id")
    if EPIC_ENV == "sandbox":
        return HospitalConfig(hospital_id, SANDBOX_FHIR_BASE,
                              os.environ["epic_backend_client_id_sandbox"], _private_key(), key_id)

    hospitals = json.loads(os.environ["epic_production_hospitals"])
    entry = hospitals.get(hospital_id)
    if not entry:
        raise HTTPException(status_code=403, detail="Hospital is not enabled for Epic access.")
    return HospitalConfig(hospital_id, entry["fhir_base_url"],
                          os.environ["epic_backend_client_id_production"], _private_key(), key_id)


@dataclass
class PatientLink:
    hospital_id: str
    hms_patient_id: str
    epic_patient_id: str
    family_name: str   # from the hospital's registration call, used for the identity check
    birth_date: str    # YYYY-MM-DD
    gender: str        # male | female | other | unknown


# Demo record: Epic's public sandbox test patient. Verify name/DOB against what Epic returns.
PATIENT_LINKS = {
    ("sandbox", "HMS-DEMO-1"): PatientLink(
        "sandbox", "HMS-DEMO-1", "erXuFYUfucBZaryVksYEcMg3",
        family_name="Lopez", birth_date="1987-09-12", gender="female",
    ),
}


def get_patient_link(hospital_id: str, hms_patient_id: str) -> Optional[PatientLink]:
    return PATIENT_LINKS.get((hospital_id, hms_patient_id))  # TODO: replace with a DB query


def get_current_doctor() -> dict:
    """TODO: replace with your real auth. hospital_id must come from the logged-in doctor, never the request."""
    return {"doctor_id": "doc-demo", "hospital_id": "sandbox"}


_token_cache: dict = {}


def get_backend_token(cfg: HospitalConfig) -> str:
    cached = _token_cache.get(cfg.hospital_id)
    if cached and cached[1] > time.time() + 30:
        return cached[0]

    token_endpoint = discover_smart_endpoints(cfg.fhir_base_url)["token_endpoint"]
    now = int(time.time())
    assertion = jwt.encode(
        {"iss": cfg.client_id, "sub": cfg.client_id, "aud": token_endpoint,
         "jti": str(uuid.uuid4()), "iat": now, "nbf": now, "exp": now + 240},
        cfg.private_key_pem,
        algorithm="RS384",
        headers={
            "kid": cfg.key_id,
            "jku": "https://doctorassist.ai/api/hms/users/epic/.well-known/jwks.json",
        } if cfg.key_id else None,
    )
    r = requests.post(token_endpoint, data={
        "grant_type": "client_credentials",
        "client_assertion_type": "urn:ietf:params:oauth:client-assertion-type:jwt-bearer",
        "client_assertion": assertion,
    }, timeout=15)
    if r.status_code != 200:
        raise HTTPException(status_code=502, detail=f"Epic token request failed ({r.status_code}): {r.text[:300]}")

    body = r.json()
    _token_cache[cfg.hospital_id] = (body["access_token"], time.time() + int(body.get("expires_in", 300)))
    return body["access_token"]


def verify_identity(fhir_patient: dict, link: PatientLink) -> list:
    problems = []
    families = {(n.get("family") or "").strip().lower() for n in fhir_patient.get("name", [])}
    if link.family_name.strip().lower() not in families:
        problems.append("name")
    if fhir_patient.get("birthDate") != link.birth_date:
        problems.append("birth_date")
    if link.gender and (fhir_patient.get("gender") or "").lower() != link.gender.lower():
        problems.append("gender")
    return problems


def audit(event: str, doctor: dict, link: Optional[PatientLink], hms_patient_id: str, **extra):
    """Log who accessed which patient. Never log clinical content."""
    audit_log.info(json.dumps({
        "event": event, "doctor_id": doctor["doctor_id"], "hospital_id": doctor["hospital_id"],
        "hms_patient_id": hms_patient_id, "epic_patient_id": link.epic_patient_id if link else None,
        "env": EPIC_ENV, "ts": int(time.time()), **extra,
    }))


# 4. APPOINTMENT-TIME ENDPOINT (real flow)
# Public path: /patients/{hms_patient_id}/epic-summary
@router.get("/patients/{hms_patient_id}/epic-summary")
def epic_summary(hms_patient_id: str, doctor: dict = Depends(get_current_doctor)):
    link = get_patient_link(doctor["hospital_id"], hms_patient_id)
    if not link:
        audit("no_link", doctor, None, hms_patient_id)
        raise HTTPException(status_code=404, detail="No Epic link stored for this patient.")

    cfg = get_hospital_config(doctor["hospital_id"])
    token = get_backend_token(cfg)
    base = cfg.fhir_base_url.rstrip("/")
    headers = {"Authorization": f"Bearer {token}", "Accept": "application/fhir+json"}

    # Read only the Patient resource first, so nothing else is pulled for a wrong match.
    try:
        res = requests.get(f"{base}/Patient/{link.epic_patient_id}", headers=headers, timeout=20)
    except requests.RequestException as e:
        audit("epic_unreachable", doctor, link, hms_patient_id)
        raise HTTPException(status_code=502, detail=f"Epic unreachable: {e}")

    if res.status_code != 200:
        audit("epic_patient_read_failed", doctor, link, hms_patient_id, status=res.status_code)
        raise HTTPException(
            status_code=res.status_code if res.status_code in (401, 403, 404) else 502,
            detail=f"Epic returned {res.status_code} for this patient. Ask the hospital to re-send the Epic ID.",
        )

    problems = verify_identity(res.json(), link)
    if problems:
        audit("identity_mismatch", doctor, link, hms_patient_id, fields=problems)
        raise HTTPException(status_code=409, detail=f"Identity check failed ({', '.join(problems)}). Data not shown.")

    data = fetch_clinical_records_from_fhir(token, link.epic_patient_id, base)
    summary = process_with_ai_engine(data)
    audit("fetched", doctor, link, hms_patient_id, failed_categories=list(data.get("errors", {}).keys()))

    out = {"status": "Success", "hms_patient_id": hms_patient_id, **summary}
    if data.get("errors"):
        out["errors"] = data["errors"]
    return out


# 5. SANDBOX-ONLY TEST ENDPOINT (used by the React test page). DELETE BEFORE PRODUCTION.
# Public path: /test/fhir/{epic_patient_id}
@router.get("/test/fhir/{epic_patient_id}")
def sandbox_test_fetch(epic_patient_id: str):
    if EPIC_ENV != "sandbox":
        raise HTTPException(status_code=404, detail="Not found")
    if not re.fullmatch(r"[A-Za-z0-9.\-]{1,64}", epic_patient_id):
        raise HTTPException(status_code=400, detail="Invalid FHIR ID format.")

    cfg = get_hospital_config("sandbox")
    token = get_backend_token(cfg)
    data = fetch_clinical_records_from_fhir(token, epic_patient_id, cfg.fhir_base_url)
    if not data.get("demographics"):
        raise HTTPException(status_code=404, detail="Patient not found in Epic sandbox, or access not granted.")

    out = process_with_ai_engine(data)
    if data.get("errors"):
        out["errors"] = data["errors"]
    return out


# 6. PUBLIC KEY SET (Epic fetches this to verify our JWT signature). No login on this route.
# Public path: /.well-known/jwks.json
def _b64u(n: int) -> str:
    return base64.urlsafe_b64encode(
        n.to_bytes((n.bit_length() + 7) // 8, "big")
    ).rstrip(b"=").decode()


@router.get("/.well-known/jwks.json")
def epic_jwks():
    key = serialization.load_pem_private_key(_private_key().encode(), password=None)
    nums = key.public_key().public_numbers()  # public half only, the private key is never exposed
    return JSONResponse({"keys": [{
        "kty": "RSA",
        "use": "sig",
        "alg": "RS384",
        "kid": os.getenv("epic_key_id", "doctorassist-key-1"),
        "n": _b64u(nums.n),
        "e": _b64u(nums.e),
    }]})





# 7. SANDBOX-ONLY PATIENT SEARCH (find a FHIR ID by name/DOB, no PATIENT_LINKS needed).
# Public path: /test/search?family=Lopez&given=Camila&birthdate=1987-09-12
@router.get("/test/search")
def sandbox_test_search(family: str = None, given: str = None, birthdate: str = None):
    if EPIC_ENV != "sandbox":
        raise HTTPException(status_code=404, detail="Not found")
    if not any([family, given, birthdate]):
        raise HTTPException(status_code=400, detail="Provide at least one of: family, given, birthdate.")

    cfg = get_hospital_config("sandbox")
    token = get_backend_token(cfg)
    headers = {"Authorization": f"Bearer {token}", "Accept": "application/fhir+json"}

    params = {k: v for k, v in {"family": family, "given": given, "birthdate": birthdate}.items() if v}
    r = requests.get(f"{cfg.fhir_base_url.rstrip('/')}/Patient", headers=headers, params=params, timeout=20)

    if r.status_code != 200:
        raise HTTPException(status_code=502, detail=f"Epic search failed ({r.status_code}): {r.text[:300]}")

    matches = [
        {
            "id": entry["resource"].get("id"),
            "name": (entry["resource"].get("name") or [{}])[0].get("text"),
            "gender": entry["resource"].get("gender"),
            "birth_date": entry["resource"].get("birthDate"),
        }
        for entry in r.json().get("entry", [])
    ]
    if not matches:
        raise HTTPException(status_code=404, detail="No matching patients found.")
    return {"matches": matches}