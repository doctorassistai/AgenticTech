"""
integration/mact/analysis.py

Turns verified per-document facts into case fields. Deterministic: conflicts, coverage rows,
flags, timeline and income range come from code comparing the same fact across documents.

  GET  /mact/cases/{id}            full case, with the stored analysis merged in
  POST /mact/cases/{id}/analyze    extract all parsed, typed documents, then rebuild (background)
  GET  /mact/cases/{id}/analysis   status, per-document counts, flat fact list
"""

import difflib
import logging
import re
from datetime import date, datetime, timedelta

from fastapi import APIRouter, Depends, HTTPException

from .auth import actor_of, require_user
from .db import case_analysis, cases, doc_extractions, documents
from .documents import _event, _get_case, _iso, _now, _spawn, require_adjudicator
from .extract import GROQ_API_KEY, NAME_TO_TYPE, extract_document

logger = logging.getLogger("mact.analysis")
router = APIRouter(tags=["mact-analysis"])

ORDER = ["dar", "fir", "mlc", "pm", "death", "dl", "rc", "policy", "id", "income", "bank", "bills",
         "discharge", "disability", "dependency", "petition"]
HUMAN = {
    "accident_date": "accident date", "accident_time": "accident time", "victim_name": "victim name",
    "victim_age": "victim age", "vehicle_reg": "vehicle registration", "policy_no": "policy number",
    "disability_pct": "disability", "claimed_disability_pct": "disability claimed",
}
_BLANK = {"", "—", "As per petition", "To be matched"}


def _blank(v) -> bool:
    return v is None or (isinstance(v, str) and v.strip() in _BLANK)


def _d(s):
    try:
        return date.fromisoformat(str(s)[:10])
    except (TypeError, ValueError):
        return None


def _reg(v):
    return re.sub(r"[^A-Z0-9]", "", str(v).upper())


def _hm(v):
    h, m = str(v).split(":")
    return int(h) * 60 + int(m)


def _tok(s):
    return {t for t in re.findall(r"\w+", str(s).lower()) if len(t) > 1}

def _latin(s) -> bool:
    letters = [ch for ch in str(s) if ch.isalpha()]
    return bool(letters) and sum(ch.isascii() for ch in letters) / len(letters) > 0.9


def _name_differs(a, b):
    """Names in different scripts (English vs Malayalam/Hindi) cannot be compared, so never a conflict.
    Latin spellings are compared loosely because transliteration varies (Jumailath / Jumile)."""
    if not (_latin(a) and _latin(b)):
        return False
    ta, tb = re.findall(r"[a-z]+", str(a).lower()), re.findall(r"[a-z]+", str(b).lower())
    if not ta or not tb:
        return False
    for x in ta:
        for y in tb:
            if difflib.SequenceMatcher(None, x, y).ratio() >= 0.7:
                return False
            if (len(x) == 1 or len(y) == 1) and x[0] == y[0]:  # initial vs full name
                return False
    return difflib.SequenceMatcher(None, "".join(ta), "".join(tb)).ratio() < 0.6


def _name_differs_old(a, b):  # unused, delete this function
    if _tok(a) & _tok(b):
        return False
    return difflib.SequenceMatcher(None, str(a).lower(), str(b).lower()).ratio() < 0.6


def _ref(f):
    return {"doc_id": f.get("doc_id"), "label": f["label"], "page": f.get("page"), "quote": f.get("quote")}


def _txt(f):
    p = f" p.{f['page']}" if f.get("page") else ""
    return f"{f['label']}{p}: {HUMAN.get(f['key'], f['key'])} {f['value']}"


def _collect(case, docs, exts):
    by_id = {d["id"]: d for d in docs}
    facts = {}
    for ex in exts:
        d = by_id.get(ex["doc_id"])
        if not d:
            continue
        for f in ex.get("fields", []):
            facts.setdefault(f["key"], []).append(
                {**f, "doc_id": d["id"], "dtype": ex["doc_type"], "label": d.get("doc_name") or d["file_name"]})
    acc_f = facts.get("accident_date")
    acc = _d(acc_f[0]["value"]) if acc_f else _d(case.get("accident"))
    for f in list(facts.get("victim_dob", [])):
        b = _d(f["value"])
        if b and acc:
            age = acc.year - b.year - ((acc.month, acc.day) < (b.month, b.day))
            facts.setdefault("victim_age", []).append({**f, "key": "victim_age", "value": age})
    for k in facts:
        facts[k].sort(key=lambda x: ORDER.index(x["dtype"]) if x["dtype"] in ORDER else 99)
    return facts


def build_patch(case, docs, exts):
    facts = _collect(case, docs, exts)
    first = lambda k: (facts.get(k) or [None])[0]
    val = lambda k: (first(k) or {}).get("value")
    acc = _d(val("accident_date")) or _d(case.get("accident"))
    patch = {}

    def put(sec, key, v):
        if v not in (None, ""):
            patch.setdefault(sec, {})[key] = v

    age = val("victim_age")
    put("victim", "name", val("victim_name")); put("victim", "age", int(age) if age is not None else None)
    put("victim", "sex", val("victim_sex")); put("victim", "occ", val("victim_occupation"))
    put("vehicle", "reg", val("vehicle_reg")); put("vehicle", "cls", val("vehicle_class"))
    put("policy", "no", val("policy_no")); put("policy", "from", val("policy_from"))
    put("policy", "to", val("policy_to")); put("policy", "kind", val("policy_type"))
    put("driver", "name", val("driver_name")); put("driver", "dl", val("dl_no"))
    put("driver", "cls", val("dl_class")); put("driver", "valid", val("dl_valid_to"))
    if val("accident_place"):
        patch["place"] = val("accident_place")
    if val("hospital"):
        patch["hospital"] = val("hospital")

    # ---- timeline ----
    ev = []

    def addev(key, text, tkey=None):
        f = first(key)
        dt = _d(f["value"]) if f else None
        if dt:
            t = val(tkey) if tkey else None
            ev.append((dt.isoformat() + (t or ""), f"{dt:%d %b %Y}" + (f" {t}" if t else ""), text,
                       f"{f['label']} p.{f['page']}"))

    addev("accident_date", "Accident (as per records)", "accident_time")
    addev("fir_date", "FIR registered"); addev("admission_date", "Admitted to hospital")
    addev("death_date", "Death recorded"); addev("discharge_date", "Discharged")
    patch["timeline"] = [[a, b, c] for _, a, b, c in sorted(ev)]

    # ---- conflicts: same fact, different documents ----
    conflicts, refs = [], []

    def add(a, b, sev):
        conflicts.append([_txt(a), _txt(b), sev])
        refs.append([_ref(a), _ref(b)])

    def cmp(key, norm, differs, sev, reg=None):
        s = list(facts.get(key, []))
        if reg is not None and not _blank(reg):
            s.append({"key": key, "value": reg, "label": "Case registration", "page": None, "quote": None, "doc_id": None})
        if len(s) < 2:
            return
        a, seen = s[0], set()
        for b in s[1:]:
            try:
                bad = differs(norm(a["value"]), norm(b["value"]))
            except Exception:
                continue
            sig = (b["label"], str(b["value"]))
            if bad and sig not in seen:
                seen.add(sig)
                add(a, b, sev)

    cmp("accident_date", str, lambda x, y: x != y, "high", case.get("accident"))
    cmp("accident_time", _hm, lambda x, y: abs(x - y) > 15, "med")
    cmp("victim_age", lambda v: int(float(v)), lambda x, y: abs(x - y) > 1, "med", (case.get("victim") or {}).get("age"))
    cmp("victim_name", str, _name_differs, "med", (case.get("victim") or {}).get("name"))
    cmp("vehicle_reg", _reg, lambda x, y: x != y, "high")
    cmp("policy_no", _reg, lambda x, y: x != y, "med", (case.get("policy") or {}).get("no"))
    a, b = first("disability_pct"), first("claimed_disability_pct")
    if a and b and abs(float(a["value"]) - float(b["value"])) >= 1:
        add(a, b, "med")
    patch["conflicts"] = conflicts

    # ---- coverage rows and flags ----
    cov, flags = [], []
    pf, pt = first("policy_from"), first("policy_to")
    if acc and pf and pt and _d(pf["value"]) and _d(pt["value"]):
        ok = _d(pf["value"]) <= acc <= _d(pt["value"])
        cov.append(["Policy in force on accident date", f"{'Yes' if ok else 'No'} — {pf['value']} to {pt['value']}",
                    f"{pf['label']} p.{pf['page']}", "ok" if ok else "bad", []])
        gap = (acc - _d(pf["value"])).days
        if 0 <= gap <= 7:
            flags.append(["med", f"Policy incepted {gap} day(s) before the accident",
                          f"Policy from {pf['value']}; accident {acc.isoformat()}"])
    dv = first("dl_valid_to")
    if acc and dv and _d(dv["value"]):
        ok = _d(dv["value"]) >= acc
        cls = val("dl_class") or "class not stated"
        cov.append(["Driver licence valid on accident date", f"{cls}; valid to {dv['value']}",
                    f"{dv['label']} p.{dv['page']}", "ok" if ok else "bad", ["swaran"]])
    pol_reg = next((f for f in facts.get("vehicle_reg", []) if f["dtype"] == "policy"), None)
    oth_reg = next((f for f in facts.get("vehicle_reg", []) if f["dtype"] != "policy"), None)
    if pol_reg and oth_reg:
        ok = _reg(pol_reg["value"]) == _reg(oth_reg["value"])
        cov.append(["Vehicle matches policy", "Match" if ok else f"Policy {pol_reg['value']} vs {oth_reg['value']}",
                    f"{pol_reg['label']} p.{pol_reg['page']} · {oth_reg['label']} p.{oth_reg['page']}",
                    "ok" if ok else "bad", []])
    patch["coverage"] = cov
    fir = first("fir_date")
    if acc and fir and _d(fir["value"]):
        delay = (_d(fir["value"]) - acc).days
        if delay > 1:
            flags.append(["low" if delay <= 3 else "med", f"FIR registered {delay} days after the accident",
                          f"FIR dated {fir['value']}, accident {acc.isoformat()}"])
    patch["flags"] = flags

    # ---- income ----
    srcs = [[f"{f['label']} p.{f['page']}", f["value"], "bank statement" if f["dtype"] == "bank" else "income proof"]
            for f in facts.get("monthly_income", [])]
    claimed = val("claimed_income") or (case.get("income") or {}).get("claimed")
    inc = {"sources": srcs}
    if claimed:
        inc["claimed"] = claimed
    if srcs:
        amts = [s[1] for s in srcs]
        inc["range"] = [min(amts), max(amts)]
    if srcs or claimed:
        patch["income"] = inc

    # ---- dependants (death cases) ----
    if case.get("type") == "Death":
        seen, deps = {}, []
        for f in facts.get("dependant", []):
            parts = [p.strip() for p in str(f["value"]).split(";")]
            name, rel = parts[0], (parts[1] if len(parts) > 1 else "")
            age_s = parts[2] if len(parts) > 2 else ""
            key = (rel.lower(), name.lower())
            supported = f["dtype"] == "dependency"
            if key in seen:
                if supported:
                    seen[key][2] = "Yes"
                continue
            row = [rel or name, int(age_s) if age_s.isdigit() else None, "Yes" if supported else "?"]
            seen[key] = row
            deps.append(row)
        patch["deps"] = deps

    # ---- medical (injury cases) and claimed inputs ----
    q = {}
    if case.get("type") == "Injury":
        inj = list(dict.fromkeys(f["value"] for f in facts.get("injuries", [])))
        path = []
        for key, txt in (("admission_date", "Admitted"), ("discharge_date", "Discharged")):
            f = first(key)
            if f and _d(f["value"]):
                path.append([f"{_d(f['value']):%d %b %Y}", txt])
        cert = val("disability_pct")
        dcl = val("claimed_disability_pct")
        bills = sum(dict.fromkeys(f["value"] for f in facts.get("bills_total", [])))
        if inj or cert is not None or dcl is not None or bills:
            dcl = dcl if dcl is not None else (cert or 0)
            patch["med"] = {
                "inj": inj, "path": path, "disClaim": dcl, "disCert": cert,
                # No AI functional assessment yet: equals the claim so no false finding is raised.
                "disAI": dcl, "billsClaim": bills, "billsVer": bills,
                "notes": ["Functional disability not yet assessed", "Bills are the sum of totals stated; not itemised-verified"],
            }
        if dcl:
            q["disClaim"] = dcl
        if bills:
            q["medClaim"] = bills
    if patch.get("deps"):
        q["depClaim"] = q["consClaim"] = len(patch["deps"])
    if q:
        patch["q"] = q

    nfacts = sum(len(v) for v in facts.values())
    return patch, refs, {"facts": nfacts, "documents": len(exts), "conflicts": len(conflicts), "flags": len(flags)}


def merge_case(case: dict, patch: dict) -> dict:
    out = dict(case)
    for sec in ("victim", "vehicle", "policy", "driver"):
        cur = dict(out.get(sec) or {})
        for k, v in (patch.get(sec) or {}).items():
            if _blank(cur.get(k)):
                cur[k] = v
        out[sec] = cur
    for k in ("place", "hospital"):
        if _blank(out.get(k)) and patch.get(k):
            out[k] = patch[k]
    for k in ("timeline", "conflicts", "coverage", "flags", "deps"):
        if patch.get(k):
            out[k] = patch[k]
    if patch.get("income"):
        out["income"] = {**(out.get("income") or {}), **patch["income"]}
    if patch.get("med"):
        out["med"] = patch["med"]
    if patch.get("q"):
        out["q"] = {**(out.get("q") or {}), **patch["q"]}
    return out


async def rebuild(case_id: str) -> dict:
    case = await cases.find_one({"id": case_id}, {"_id": 0})
    docs = await documents.find({"case_id": case_id, "deleted": False}, {"_id": 0}).to_list(length=500)
    ids = [d["id"] for d in docs]
    exts = await doc_extractions.find({"doc_id": {"$in": ids}, "status": "ok"}, {"_id": 0}).to_list(length=500)
    patch, refs, stats = build_patch(case, docs, exts)
    await case_analysis.update_one(
        {"case_id": case_id},
        {"$set": {"patch": patch, "conflict_refs": refs, "built_at": _now(), "stats": stats}}, upsert=True)
    return stats


async def _run(case_id: str, force: bool) -> None:
    try:
        docs = await documents.find({"case_id": case_id, "deleted": False, "status": "parsed"}, {"_id": 0}) \
            .sort("uploaded_at", 1).to_list(length=500)
        errors = []
        for d in docs:
            if not NAME_TO_TYPE.get(d.get("doc_name") or ""):
                continue
            ex = await doc_extractions.find_one({"doc_id": d["id"]}, {"_id": 0, "status": 1, "extracted_at": 1})
            fresh = ex and ex.get("status") == "ok" and ex["extracted_at"] >= (d.get("parsed_at") or ex["extracted_at"])
            if fresh and not force:
                continue
            try:
                await extract_document(d)
            except Exception as e:
                logger.exception("extraction failed for %s", d["id"])
                errors.append(f"{d['file_name']}: {str(e)[:120]}")
        stats = await rebuild(case_id)
        summary = f"{stats['facts']} facts from {stats['documents']} document(s); {stats['conflicts']} conflict(s)"
        await case_analysis.update_one({"case_id": case_id}, {"$set": {
            "status": "done", "summary": summary, "error": "; ".join(errors) or None, "finished_at": _now()}})
    except Exception as e:
        logger.exception("analysis failed for %s", case_id)
        try:
            await case_analysis.update_one({"case_id": case_id}, {"$set": {
                "status": "failed", "error": str(e)[:300] or "Analysis failed", "finished_at": _now()}})
        except Exception:
            logger.exception("could not record analysis failure for %s", case_id)


@router.get("/cases/{case_id}")
async def get_case(case_id: str, user: dict = Depends(require_user)):
    case = await cases.find_one({"id": case_id}, {"_id": 0})
    if not case:
        raise HTTPException(status_code=404, detail="Case not found")
    if not case.get("is_sample"):
        an = await case_analysis.find_one({"case_id": case_id}, {"_id": 0, "patch": 1, "conflict_refs": 1})
        if an and an.get("patch"):
            case = merge_case(case, an["patch"])
            case["conflictRefs"] = an.get("conflict_refs") or []
    return {"status": "success", "case": case}


@router.post("/cases/{case_id}/analyze", status_code=202)
async def analyze(case_id: str, force: bool = False, user: dict = Depends(require_adjudicator)):
    case = await _get_case(case_id)
    if case.get("is_sample"):
        raise HTTPException(status_code=409, detail="Sample cases are not analysed")
    if not GROQ_API_KEY:
        raise HTTPException(status_code=503, detail="GROQ_API_KEY is not configured")
    cur = await case_analysis.find_one({"case_id": case_id}, {"_id": 0, "status": 1, "started_at": 1})
    if cur and cur.get("status") == "running" and cur.get("started_at") and cur["started_at"] > _now() - timedelta(minutes=15):
        raise HTTPException(status_code=409, detail="Extraction is already running")
    if not await documents.count_documents({"case_id": case_id, "deleted": False, "status": "parsed"}):
        raise HTTPException(status_code=409, detail="No parsed documents yet")
    await case_analysis.update_one({"case_id": case_id},
                                   {"$set": {"status": "running", "error": None, "started_at": _now()}}, upsert=True)
    await _event(case_id, actor_of(user), "Extraction started", "forced re-run" if force else "new or changed documents")
    _spawn(_run(case_id, force))
    return {"status": "running"}


@router.get("/cases/{case_id}/analysis")
async def get_analysis(case_id: str, user: dict = Depends(require_adjudicator)):
    await _get_case(case_id)
    an = await case_analysis.find_one({"case_id": case_id}, {"_id": 0, "patch": 0, "conflict_refs": 0}) or {}
    if an.get("status") == "running" and an.get("started_at") and an["started_at"] < _now() - timedelta(minutes=15):
        an["status"], an["error"] = "failed", "Extraction was interrupted. Run it again."
    docs = await documents.find({"case_id": case_id, "deleted": False}, {"_id": 0}).sort("uploaded_at", 1).to_list(length=500)
    by_id = {d["id"]: d for d in docs}
    exts = await doc_extractions.find({"doc_id": {"$in": list(by_id)}}, {"_id": 0}).to_list(length=500)
    per_doc, facts = [], []
    for ex in exts:
        d = by_id[ex["doc_id"]]
        per_doc.append({"doc_id": d["id"], "file_name": d["file_name"], "doc_type": ex["doc_type"],
                        "fields": len(ex["fields"]), "rejected": ex.get("rejected", 0),
                        "truncated": ex.get("truncated", False), "extracted_at": _iso(ex.get("extracted_at"))})
        facts += [{"doc_id": d["id"], "doc_name": d.get("doc_name"), "file_name": d["file_name"], **f} for f in ex["fields"]]
    for k in ("started_at", "finished_at", "built_at"):
        an[k] = _iso(an.get(k))
    return {"status": "success", "analysis": {"status": "none", **an}, "documents": per_doc, "facts": facts}