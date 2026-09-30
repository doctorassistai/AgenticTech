"""
patient_app/services/medications.py

Pure logic for "current medicines" (README section 7 / handoff rule 3 revised).
No database and no config imports: everything is passed in.

CHANGE (this revision): the curated drug_library.json is gone. Nothing here
enriches a prescription with content the doctor did not write. Consequences:
  * No "about" / explanation text. There is no source for it any more.
  * No minGapHours. There is no source for it any more (this was the only
    input to the "taken early" risk alert on the mobile side — that alert
    loses its signal until a replacement source exists).
  * hospital_given is decided ONLY from the doctor's own route / dosage_form /
    dosage_instructions text. No fallback list of "these drugs are always IV".
  * A field with no value in the doctor's row is OMITTED from the response,
    never replaced with a placeholder or empty string.

What is still computed here (not fabricated, just parsed from the doctor's
own text) and is therefore kept:
  * parse_frequency / parse_duration — turn the doctor's own frequency /
    duration / instructions text into reminder slots and an end date.
  * The WHEN_* constants below — these translate a *computed slot time* (an
    8am/8pm reminder derived from the doctor's own frequency text) into a
    trilingual UI label ("Morning, after food"). This is UI copy, not
    clinical content, so it stays as a Python constant rather than a JSON
    library file — there is nothing to curate per-drug here.
"""

from __future__ import annotations

import re
from datetime import datetime, timedelta, timezone
from typing import Any, Optional

# =====================================================================
# Tunable constants (patient-adjustable reminder times are a phase-2 feature)
# =====================================================================
T_MORNING = "08:00"
T_NOON = "14:00"
T_EVENING = "20:00"
T_BEDTIME = "21:00"

SLOTS_BY_COUNT = {
    1: [T_MORNING],
    2: ["08:00", "20:00"],
    3: ["08:00", "14:00", "20:00"],
    4: ["07:00", "12:00", "17:00", "22:00"],
}
SLOTS_BY_HOURS = {
    6: ["06:00", "12:00", "18:00", "00:00"],
    8: ["06:00", "14:00", "22:00"],
    12: ["08:00", "20:00"],
    24: [T_MORNING],
}
TOD_TIME = {"morning": T_MORNING, "afternoon": T_NOON, "evening": T_EVENING, "night": T_BEDTIME}

LOGGED_STATUSES = {"taken", "late", "early", "skipped"}

# =====================================================================
# UI-copy constants (translation of computed schedule, not drug content)
# =====================================================================
def _L(en: str, hi: str, ml: str) -> dict:
    return {"en": en, "hi": hi, "ml": ml}


WHEN_TOD = {
    "morning": _L("Morning", "सुबह", "രാവിലെ"),
    "afternoon": _L("Afternoon", "दोपहर", "ഉച്ചയ്ക്ക്"),
    "evening": _L("Evening", "शाम", "വൈകുന്നേരം"),
    "night": _L("Night", "रात", "രാത്രി"),
    "bedtime": _L("At bedtime", "सोने से पहले", "ഉറങ്ങുന്നതിനു മുമ്പ്"),
}
WHEN_FOOD = {
    "after_food": _L("after food", "खाने के बाद", "ഭക്ഷണത്തിനു ശേഷം"),
    "before_food": _L("before food", "खाने से पहले", "ഭക്ഷണത്തിനു മുമ്പ്"),
    "with_food": _L("with food", "खाने के साथ", "ഭക്ഷണത്തോടൊപ്പം"),
    "empty_stomach": _L("on an empty stomach", "खाली पेट", "വെറും വയറ്റിൽ"),
}
WHEN_PRN = _L("As needed", "ज़रूरत पड़ने पर", "ആവശ്യമുള്ളപ്പോൾ")
WHEN_UNKNOWN = _L("As directed by your doctor", "डॉक्टर के बताए अनुसार", "ഡോക്ടർ നിർദ്ദേശിച്ചതുപോലെ")

# =====================================================================
# Small helpers
# =====================================================================
_CTRL = re.compile(r"[\x00-\x1f\x7f]")


def _clean(v: Any, limit: int) -> str:
    """Patient-facing doctor text: strings/numbers only, no control chars, capped."""
    if not isinstance(v, (str, int, float)) or isinstance(v, bool):
        return ""
    s = _CTRL.sub(" ", str(v))
    return re.sub(r"\s+", " ", s).strip()[:limit]


def _as_dt(v: Any) -> Optional[datetime]:
    """created_at is a real date in the DB, but tolerate ISO strings. Naive = UTC."""
    if isinstance(v, datetime):
        dt = v
    elif isinstance(v, str):
        try:
            dt = datetime.fromisoformat(v.strip().replace("Z", "+00:00"))
        except ValueError:
            return None
    else:
        return None
    return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)


def _iso_z(dt: datetime) -> str:
    return dt.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


# =====================================================================
# Frequency -> reminder slots (parses the doctor's own text; nothing invented)
# =====================================================================
def _prep(v: Any) -> str:
    t = v if isinstance(v, str) else ""
    t = t.lower()
    t = re.sub(r"\b(after|before|with)\s*(food|meals?|eating|breakfast|lunch|dinner)\b", r"\1 \2", t)
    t = t.replace(".", "")
    return re.sub(r"\s+", " ", t).strip()


_PRN = re.compile(
    r"\b(as needed|as required|as and when|prn|sos|when required|when needed|at onset of|at the onset of|"
    r"if needed|if required|if necessary|in case of|"
    r"if (?:there is |you have |you feel )?(?:fever|pain|nausea|vomiting|headache))\b"
)
_CYCLE = re.compile(
    r"\bevery\s+\d+(?:\s*-\s*\d+)?\s*(?:weeks?|days?|months?)\b"
    r"|\bevery\s+\d+\s*-\s*\d+\s*(?:hours?|hrs?)\b"
    r"|\bweekly\b|\bfortnightly\b|\bmonthly\b|\bcycles?\b|\bon day\s*\d|\bday\s*1\b"
    r"|\brest\b|\bstat\b|\bsingle dose\b|\bone[- ]time\b|\bonce only\b"
    r"|\bevery other day\b|\balternate days?\b"
)
_HOURS = re.compile(r"\bevery\s*(\d+)\s*(?:hours?|hrs?|h)\b|\bq(\d+)h\b")
_TIMES = re.compile(r"\b(\d+|one|two|three|four|five|six)\s*(?:times?|x)\s*(?:a|per|/|each|every)?\s*(?:day|daily)\b")
_NUMWORD = {"one": 1, "two": 2, "three": 3, "four": 4, "five": 5, "six": 6}
_WORD_COUNTS = [
    (re.compile(r"\b(qid|qds)\b"), 4),
    (re.compile(r"\b(tds|tid|thrice)\b"), 3),
    (re.compile(r"\b(bd|bid|twice)\b"), 2),
]
_TOD_PATTERNS = [
    ("morning", re.compile(r"\bmorning\b")),
    ("afternoon", re.compile(r"\bafternoon\b|\bnoon\b|\bmidday\b")),
    ("evening", re.compile(r"\bevening\b")),
    ("night", re.compile(r"\bat night\b|\bnightly\b|\bevery night\b|\bbed ?time\b|\bhs\b|\bnocte\b|\bnight ?time\b")),
]
_DAILY = re.compile(r"\b(once a day|once per day|once daily|daily|od|qd|every day)\b")
_BEDTIME = re.compile(r"\bbed ?time\b|\bhs\b")


def _classify(raw: Any) -> Optional[tuple]:
    """Returns (kind, slots) or None. kind: 'parsed' | 'as_needed' | 'unknown'."""
    t = _prep(raw)
    if not t:
        return None
    if _PRN.search(t):
        return ("as_needed", [])
    if _CYCLE.search(t):
        return ("unknown", [])

    m = _HOURS.search(t)
    if m:
        hours = int(m.group(1) or m.group(2))
        return ("parsed", list(SLOTS_BY_HOURS[hours])) if hours in SLOTS_BY_HOURS else ("unknown", [])

    count: Optional[int] = None
    m = _TIMES.search(t)
    if m:
        g = m.group(1)
        count = int(g) if g.isdigit() else _NUMWORD[g]
    else:
        for rx, n in _WORD_COUNTS:
            if rx.search(t):
                count = n
                break
    if count is not None and count != 1:
        return ("parsed", list(SLOTS_BY_COUNT[count])) if count in SLOTS_BY_COUNT else ("unknown", [])

    found = [name for name, rx in _TOD_PATTERNS if rx.search(t)]
    if len(found) >= 2:
        return ("parsed", sorted({TOD_TIME[n] for n in found}))
    if len(found) == 1:
        if found[0] == "afternoon":
            return ("unknown", [])
        return ("parsed", [TOD_TIME[found[0]]])
    if count == 1 or _DAILY.search(t):
        return ("parsed", [T_MORNING])
    return None


def _food(raw: Any) -> Optional[str]:
    t = _prep(raw)
    if not t:
        return None
    if "empty stomach" in t:
        return "empty_stomach"
    if re.search(r"\bbefore (food|meals?|breakfast|lunch|dinner|eating)\b", t):
        return "before_food"
    if re.search(r"\bafter (food|meals?|breakfast|lunch|dinner|eating)\b", t):
        return "after_food"
    if re.search(r"\bwith (food|meals?|milk)\b", t):
        return "with_food"
    return None


def parse_frequency(frequency: Any, instructions: Any = "") -> dict:
    """Frequency field first, then dosage_instructions. Returns
    {schedule, slots, food, bedtime} — all derived from the doctor's own text."""
    result = None
    for src in (frequency, instructions):
        result = _classify(src)
        if result is not None:
            break
    kind, slots = result if result is not None else ("unknown", [])
    joined = f"{_prep(frequency)} {_prep(instructions)}"
    return {
        "schedule": kind,
        "slots": sorted(slots),
        "food": _food(frequency) or _food(instructions),
        "bedtime": bool(_BEDTIME.search(joined)),
    }


# =====================================================================
# Duration (parses the doctor's own text; no defaults injected)
# =====================================================================
_NUMS = {"one": 1, "two": 2, "three": 3, "four": 4, "five": 5, "six": 6, "seven": 7, "eight": 8, "nine": 9, "ten": 10}
_NUM = r"(\d+|one|two|three|four|five|six|seven|eight|nine|ten)"
_UNIT = r"(days?|weeks?|wks?|months?|years?|yrs?)"
_UNIT_DAYS = {"d": 1, "w": 7, "m": 30, "y": 365}
_LONG = re.compile(r"\b(long[- ]?term|indefinite(?:ly)?|ongoing|life[- ]?long|lifetime|life long|permanent|until further notice)\b")
_SPAN = re.compile(rf"\b(?:up ?to\s+)?{_NUM}(?:\s*(?:-|–|to)\s*{_NUM})?\s*{_UNIT}\b")
_FOR_SPAN = re.compile(rf"\b(?:for|x)\s*(?:the next\s+)?{_NUM}(?:\s*(?:-|–|to)\s*{_NUM})?\s*{_UNIT}\b")
_NOT_A_PERIOD = re.compile(r"\b(as needed|as directed|as required|prn|as per)\b")


def _n(v: str) -> int:
    return int(v) if v.isdigit() else _NUMS[v]


def _span_days(m: "re.Match") -> tuple:
    lo, hi, unit = m.group(1), m.group(2), m.group(3)
    n = _n(hi or lo)
    days = min(n * _UNIT_DAYS[unit[0]], 3650)
    unit_word = {"d": "days", "w": "weeks", "m": "months", "y": "years"}[unit[0]]
    shown = f"{_n(lo)}-{_n(hi)} {unit_word}" if hi else f"{_n(lo)} {unit_word}"
    if not hi and _n(lo) == 1:
        shown = shown[:-1]
    return days, shown


def _cap_first(s: str) -> str:
    s = _clean(s, 60)
    return s[:1].upper() + s[1:]


def parse_duration(options: Any, instructions: Any = "", frequency: Any = "") -> dict:
    """Returns {kind, days, text}, built only from the doctor's own fields.
    text is None when the doctor gave no period at all (the app then shows
    "Ask your doctor for the time period" — never a fabricated default)."""
    if isinstance(options, str):
        opts = [options]
    elif isinstance(options, list):
        opts = [o for o in options if isinstance(o, (str, int, float)) and not isinstance(o, bool)]
    else:
        opts = []
    opts = [_clean(o, 80) for o in opts]
    opts = [o for o in opts if o]

    leftover_text: Optional[str] = None
    if len(opts) == 1:
        o = opts[0]
        low = o.lower()
        if _LONG.search(low):
            return {"kind": "long_term", "days": None, "text": _cap_first(o)}
        m = _SPAN.search(low)
        if m:
            days, shown = _span_days(m)
            return {"kind": "fixed", "days": days, "text": shown}
        if not _NOT_A_PERIOD.search(low):
            leftover_text = _cap_first(o)

    t = _prep(instructions)
    cyclic = bool(_CYCLE.search(f"{t} {_prep(frequency)}") or re.search(r"\bthen\b", t))
    if t and not cyclic:
        if _LONG.search(t):
            return {"kind": "long_term", "days": None, "text": _cap_first(_LONG.search(t).group(1))}
        m = _FOR_SPAN.search(t)
        if m:
            days, shown = _span_days(m)
            return {"kind": "fixed", "days": days, "text": shown}
    return {"kind": "unspecified", "days": None, "text": leftover_text}


# =====================================================================
# Name handling (own-text only; no library matching any more)
# =====================================================================
_STRENGTH = re.compile(r"\b\d+(?:[.,]\d+)?\s*(?:(?:mg|mcg|µg|ug|gm|g|ml|iu|units?)\b|%)")
_FORM_WORDS = {"tab", "tablet", "tablets", "cap", "capsule", "capsules", "inj", "injection", "syp", "syrup", "drops", "drop", "eye"}


def normalise_name(s: Any) -> str:
    """Used only to (a) dedupe the same drug saved twice in one session and
    (b) build a stable slug id. No longer used to look anything up."""
    t = (s if isinstance(s, str) else "").lower()
    t = re.sub(r"\(.*?\)", " ", t)
    t = _STRENGTH.sub(" ", t)
    t = t.replace("+", " ").replace("&", " ").replace("/", " ")
    t = re.sub(r"[^a-z0-9\- ]", " ", t)
    return " ".join(w for w in t.split() if w not in _FORM_WORDS)


def _slug(name: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", name.lower()).strip("-") or "medicine"


# =====================================================================
# Rows, hospital-given (rule-based only — no library fallback list)
# =====================================================================
_ROUTE_MAP = {
    "po": "oral", "orally": "oral", "oral": "oral", "by mouth": "oral",
    "iv": "intravenous", "intravenous": "intravenous",
    "sc": "subcutaneous", "sq": "subcutaneous", "subcutaneous": "subcutaneous", "subcutaneous injection": "subcutaneous",
    "im": "intramuscular", "intramuscular": "intramuscular",
}
_HOSPITAL_ROUTES = {"intravenous", "iv", "subcutaneous", "sc", "subcutaneous injection", "intramuscular", "im", "injection"}


def _s(v: Any) -> str:
    return v.strip().lower() if isinstance(v, str) else ""


def is_hospital_given(row: dict) -> bool:
    """Route / dosage_form / dosage_instructions from the doctor's own row only.
    There is no longer a curated fallback list of "always hospital-given" drugs —
    a drug the doctor entered with a plain oral route and no IV/SC wording will
    now show up as a reminder even if it is normally hospital-administered."""
    if _s(row.get("route")) in _HOSPITAL_ROUTES:
        return True
    if re.search(r"\b(injection|injectable|infusion|inj|iv)\b", _s(row.get("dosage_form"))):
        return True
    instr = _s(row.get("dosage_instructions"))
    if instr.startswith("administer") and re.search(r"\b(iv|sc|im)\b", instr):
        return True
    return False


def _row_names(row: dict) -> list:
    out = []
    for f in ("medication", "generic_name", "brand_name"):
        v = row.get(f)
        if isinstance(v, str) and v.strip():
            out.append(v.strip())
    return out


def _usable_rows(doc: dict) -> list:
    rows = (doc.get("finaloutput") or {}).get("prescriptions")
    if not isinstance(rows, list):
        return []
    return [r for r in rows if isinstance(r, dict) and _row_names(r)]


def select_current_docs(docs: list) -> dict:
    """Option B. Returns {doctor_id: doc}: per doctor, the newest doc that has at
    least one usable row (ties broken by _id)."""
    best: dict = {}
    floor = datetime.min.replace(tzinfo=timezone.utc)
    for d in docs:
        doctor = d.get("doctor_id")
        if not isinstance(doctor, str) or not doctor or not _usable_rows(d):
            continue
        key = (_as_dt(d.get("created_at")) or floor, str(d.get("_id", "")))
        if doctor not in best or key > best[doctor][0]:
            best[doctor] = (key, d)
    return {k: v[1] for k, v in best.items()}


def _tod(slot: str) -> str:
    h = int(slot[:2])
    if 5 <= h < 12:
        return "morning"
    if 12 <= h < 16:
        return "afternoon"
    if 16 <= h < 21:
        return "evening"
    return "night"


def _when(slot: str, sched: dict) -> dict:
    part = "bedtime" if (sched["bedtime"] and slot == T_BEDTIME) else _tod(slot)
    parts = [WHEN_TOD[part]]
    if sched["food"] and part != "bedtime":
        parts.append(WHEN_FOOD[sched["food"]])
    return {l: ", ".join(p[l] for p in parts) for l in ("en", "hi", "ml")}


# =====================================================================
# Response builder — every field is either present in the doctor's row
# (after parsing) or omitted; nothing is filled in from elsewhere.
# =====================================================================
def build_medications(current: dict, doctors: dict, statuses: dict, now: datetime, tz) -> dict:
    """current  : {doctor_id: doc} from select_current_docs
    doctors  : {doctor_id: {"name":..}} (names only; missing -> None)
    statuses : {slot_id: logged status} for today (PATIENT_TZ)
    now      : aware datetime; tz: tzinfo for PATIENT_TZ"""
    now_local = now.astimezone(tz)
    today = now_local.date()
    hhmm = now_local.strftime("%H:%M")

    meds: list = []
    hospital: list = []
    used_ids: set = set()
    latest: Optional[datetime] = None

    for doctor_id in sorted(current):
        doc = current[doctor_id]
        created = _as_dt(doc.get("created_at"))
        if created and (latest is None or created > latest):
            latest = created
        start = created.astimezone(tz).date() if created else None
        prescriber = {"doctor_id": doctor_id, "name": _clean((doctors.get(doctor_id) or {}).get("name"), 120) or None}
        seen: set = set()

        for row in _usable_rows(doc):
            names = _row_names(row)
            display = _clean(names[0], 120)
            display = display[:1].upper() + display[1:]
            key = _slug(normalise_name(names[0]))
            strength = _clean(row.get("strength"), 60)
            dedupe = (key, re.sub(r"\s+", "", strength.lower()))
            if dedupe in seen:
                continue
            seen.add(dedupe)

            duration_options = row.get("standard_duration_options")
            if not duration_options and row.get("follow_up"):
                duration_options = [row.get("follow_up")]
            dur = parse_duration(duration_options, row.get("dosage_instructions"), row.get("frequency"))
            ends_on = start + timedelta(days=dur["days"]) if (start and dur["days"]) else None
            if ends_on and today > ends_on:
                continue

            common = {"name": display, "prescriber": prescriber, "prescribed_on": start.isoformat() if start else None}
            if strength:  # doctor gave a dose — else the field is simply absent
                common["dose"] = strength
            route_raw = _s(row.get("route"))
            if route_raw:
                common["route"] = _ROUTE_MAP.get(route_raw, _clean(route_raw, 40))

            if is_hospital_given(row):
                hospital.append(common)
                continue

            sched = parse_frequency(row.get("frequency"), row.get("dosage_instructions"))
            extra = {"med_key": key, "schedule": sched["schedule"]}
            form = _clean(row.get("dosage_form"), 60)
            if form:
                extra["form"] = form
            if ends_on:
                extra["ends_on"] = ends_on.isoformat()
            if dur["text"]:
                extra["duration_text"] = dur["text"]
            instructions = _clean(row.get("dosage_instructions"), 500)
            if instructions:
                extra["instructions"] = instructions
            special = _clean(row.get("special_instructions"), 500)
            if special:
                extra["special_instructions"] = special

            def unique(base: str) -> str:
                cand, n = base, 2
                while cand in used_ids:
                    cand, n = f"{base}#{n}", n + 1
                used_ids.add(cand)
                return cand

            if sched["schedule"] == "parsed" and sched["slots"]:
                for slot in sched["slots"]:
                    sid = unique(f"{key}|{slot}")
                    logged = statuses.get(sid)
                    if logged in LOGGED_STATUSES or logged == "together":
                        status = "taken" if logged == "together" else logged
                    else:
                        status = "due" if hhmm >= slot else "later"
                    meds.append({**common, **extra, "id": sid, "time": slot, "status": status, "when": _when(slot, sched)})
            else:
                sid = unique(f"{key}|prn")
                when = WHEN_PRN if sched["schedule"] == "as_needed" else WHEN_UNKNOWN
                meds.append({**common, **extra, "id": sid, "time": None, "status": "prn", "when": when})

    meds.sort(key=lambda m: (m["time"] is None, m["time"] or "", m["name"].lower()))
    hospital.sort(key=lambda h: h["name"].lower())
    return {
        "status": "success",
        "tz": str(getattr(tz, "key", None) or tz),
        "generated_at": _iso_z(now),
        "last_prescribed_at": _iso_z(latest) if latest else None,
        "medications": meds,
        "hospital_given": hospital,
    }