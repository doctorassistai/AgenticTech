"""
patient_app/services/checkin.py

Check-in question generation, via LLM (Groq) using real context — active
medicines, weight trend, doctor's watchSymptoms flags, time of day, and now
YESTERDAY'S CHECK-IN itself: what was asked, what came back positive, and
what any follow-up on free text turned up. Today's questions are meant to
track progression, not restart from zero every day:
  - a symptom that was positive yesterday gets a "compare" question
    ("Yesterday you said X. How is it today?" -> Gone / Better / Same / Worse)
  - anything new (not asked, or asked and negative) still gets its own
    plain yes/no question
  - the mix and order should read as one continuing conversation about the
    patient's condition and medication, not a fixed daily form

Consent gate (decision 5): the LLM is called only when the patient's
patient_consent.ai flag is true, and only if GROQ_API_KEY is configured.
Without either, or if generation fails validation, a small built-in
fallback is used so the check-in is never empty.

CACHING: unchanged from before — build_checkin_config is called inline on
every request; see README section 8/13.

LLM RELIABILITY: unchanged — call_llm() requests JSON mode, strips a
markdown fence, retries up to 3 times before falling back.
"""

from __future__ import annotations

import asyncio
import json
import logging
import re
from datetime import date, datetime, timedelta
from typing import Any, Optional

from .medications import (
    _as_dt,
    _row_names,
    _usable_rows,
    is_hospital_given,
    parse_duration,
    parse_frequency,
    select_current_docs,
)
from ..config import (
    CHECKIN_LLM_MAX_TOKENS,
    CHECKIN_LLM_MODEL,
    CHECKIN_MAX_SYMPTOMS,
    CHECKIN_TARGET_SYMPTOMS,
    GROQ_API_KEY,
    MAX_FREE_TEXT_SUMMARY_CHARS,
)

logger = logging.getLogger("patient_app.checkin")

ALLOWED_KINDS = {"bother", "freq", "body", "choice", "yesno", "compare"}
# Fixed 4-point scale the app renders for "compare" questions — Gone / Better /
# About the same / Worse. Kept in sync with ChatParts.tsx's CMP4.
COMPARE_OPTIONS = [0, 1, 2, 3]

_ID_RE = re.compile(r"^[a-z][a-z0-9_-]{1,40}$")
_MAX_LABEL = 160
_MAX_LIFESTYLE = 6

_ADVICE_BLOCKLIST = re.compile(
    r"\b(mg|milligram|dose|dosage|tablet|capsule|take \d|stop taking|increase|decrease|"
    r"discontinue|prescri|diagnos|should you|you should)\b",
    re.IGNORECASE,
)


def _L(en: str, hi: str, ml: str) -> dict:
    return {"en": en, "hi": hi, "ml": ml}


# =====================================================================
# Minimal built-in fallback
# =====================================================================
def _q(id_, en, hi, ml, urgent=False):
    return {"id": id_, "kind": "yesno", "label": _L(en, hi, ml), "urgent": urgent}


_FB_INFUSION = [
    _q("inf_reaction", "Did you have itching, rash, flushing or chills during your infusion?",
       "क्या इन्फ्यूज़न के दौरान आपको खुजली, दाने, चेहरा लाल होना या ठंड लगना हुआ?",
       "ഇൻഫ്യൂഷൻ സമയത്ത് ചൊറിച്ചിൽ, തടിപ്പ്, മുഖം ചുവക്കൽ അല്ലെങ്കിൽ വിറയൽ ഉണ്ടായോ?"),
    _q("inf_tight", "Did you have tightness in your chest or throat, or trouble breathing?",
       "क्या आपको सीने या गले में जकड़न या साँस लेने में तकलीफ़ हुई?",
       "നെഞ്ചിലോ തൊണ്ടയിലോ മുറുക്കമോ ശ്വാസതടസ്സമോ ഉണ്ടായോ?", True),
    _q("inf_site", "Did you have pain, swelling or redness where the drip was?",
       "क्या ड्रिप वाली जगह पर दर्द, सूजन या लालिमा हुई?",
       "ഡ്രിപ്പ് ഇട്ട സ്ഥലത്ത് വേദന, വീക്കം അല്ലെങ്കിൽ ചുവപ്പ് ഉണ്ടായോ?"),
]
_FB_COLD = _q("cold_tingle", "Did you feel tingling or cramps in your throat, jaw or hands from cold drinks or cold air?",
              "क्या ठंडा पानी या ठंडी हवा से गले, जबड़े या हाथों में झुनझुनी या ऐंठन हुई?",
              "തണുത്ത പാനീയമോ തണുത്ത കാറ്റോ ഏറ്റപ്പോൾ തൊണ്ടയിലോ താടിയെല്ലിലോ കൈകളിലോ തരിപ്പോ പിടുത്തമോ തോന്നിയോ?")
_FB_SAFETY = [
    _q("vomit", "Did you vomit today?", "क्या आज आपको उल्टी हुई?", "ഇന്ന് ഛർദ്ദിച്ചോ?"),
    _q("vomit_many", "Did you vomit more than 3 times today?", "क्या आज आपको 3 बार से ज़्यादा उल्टी हुई?", "ഇന്ന് 3 തവണയിൽ കൂടുതൽ ഛർദ്ദിച്ചോ?", True),
    _q("loose_stools", "Did you pass loose stools today?", "क्या आज आपको पतले दस्त हुए?", "ഇന്ന് വയറിളക്കം ഉണ്ടായോ?"),
    _q("stools_many", "Did you pass loose stools more than 4 times today?", "क्या आज आपको 4 बार से ज़्यादा पतले दस्त हुए?", "ഇന്ന് 4 തവണയിൽ കൂടുതൽ വയറിളക്കം ഉണ്ടായോ?", True),
    _q("drink_trouble", "Did you have trouble drinking fluids today?", "क्या आज आपको तरल पदार्थ पीने में परेशानी हुई?", "ഇന്ന് ദ്രാവകങ്ങൾ കുടിക്കാൻ ബുദ്ധിമുട്ട് ഉണ്ടായോ?"),
    _q("fever_chills", "Did you have a fever or chills today?", "क्या आज आपको बुखार या ठंड लगी?", "ഇന്ന് പനിയോ വിറയലോ ഉണ്ടായോ?", True),
    _q("blood_stool", "Did you see blood in your stool or have black stools?", "क्या आपके मल में खून दिखा या काला मल आया?", "മലത്തിൽ രക്തം കണ്ടോ അല്ലെങ്കിൽ കറുത്ത മലം പോയോ?", True),
]
_FB_CAPE = [
    _q("hand_foot", "Did you notice redness, burning, tingling or peeling on your hands or feet?",
       "क्या आपके हाथों या पैरों में लालिमा, जलन, झुनझुनी या छिलना दिखा?",
       "കൈകളിലോ കാലുകളിലോ ചുവപ്പ്, പുകച്ചിൽ, തരിപ്പ്, തൊലി അടരൽ എന്നിവ ശ്രദ്ധിച്ചോ?"),
    _q("mouth_sores", "Did you notice sores in your mouth?", "क्या आपके मुँह में छाले दिखे?", "വായിൽ വ്രണങ്ങൾ ശ്രദ്ധിച്ചോ?"),
]
_FB_GENERAL = [
    _q("nausea", "Did you feel sick to your stomach today?", "क्या आज आपको जी मिचलाने जैसा लगा?", "ഇന്ന് ഓക്കാനം തോന്നിയോ?"),
    _q("tired", "Did you feel more tired than usual today?", "क्या आज आप सामान्य से ज़्यादा थके हुए थे?", "ഇന്ന് പതിവിലും കൂടുതൽ ക്ഷീണം തോന്നിയോ?"),
    _q("dizzy", "Did you feel dizzy today?", "क्या आज आपको चक्कर आया?", "ഇന്ന് തലകറക്കം തോന്നിയോ?"),
    _q("belly_pain", "Did you have pain in your belly today?", "क्या आज आपके पेट में दर्द हुआ?", "ഇന്ന് വയറുവേദന ഉണ്ടായോ?"),
    _q("low_urine", "Did you pass much less urine than usual today?", "क्या आज आपने सामान्य से बहुत कम पेशाब किया?", "ഇന്ന് പതിവിലും വളരെ കുറച്ച് മൂത്രം പോയോ?"),
    _q("bleed_bruise", "Did you notice unusual bleeding or bruising?", "क्या आपको असामान्य रक्तस्राव या नील पड़ना दिखा?", "അസാധാരണമായ രക്തസ്രാവമോ ചതവോ ശ്രദ്ധിച്ചോ?", True),
]

_WATCH_LABELS = {
    "pain": {"id": "pain", "kind": "bother", "label": _L("Pain", "दर्द", "വേദന")},
    "motions": {"id": "diarrhoea", "kind": "freq", "label": _L("Loose motions (diarrhoea)", "पतले दस्त", "വയറിളക്കം")},
    "constipation": {"id": "constipation", "kind": "bother", "label": _L("Constipation", "कब्ज़", "മലബന്ധം")},
    "vomiting": {"id": "nausea", "kind": "freq", "label": _L("Nausea or vomiting", "जी मिचलाना या उल्टी", "ഓക്കാനം അല്ലെങ്കിൽ ഛർദ്ദി")},
    "wbc": {"id": "fever_symptom", "kind": "bother", "label": _L("Fever or feeling hot/shivery", "बुखार या कँपकँपी", "പനി അല്ലെങ്കിൽ വിറയൽ")},
    "mouth": {"id": "mouth", "kind": "bother", "label": _L("Mouth sores", "मुँह में छाले", "വായിൽ വ്രണങ്ങൾ")},
    "indigestion": {"id": "indigestion", "kind": "bother", "label": _L("Indigestion or acidity", "बदहज़मी या एसिडिटी", "ദഹനക്കേട്")},
    "fever": {"id": "fever_symptom", "kind": "bother", "label": _L("Fever or feeling hot/shivery", "बुखार या कँपकँपी", "പനി അല്ലെങ്കിൽ വിറയൽ")},
}


def _rule_based_symptoms(watch: dict) -> tuple:
    seen: set = set()
    items, ids = [], []
    for flag, item in _WATCH_LABELS.items():
        if (watch or {}).get(flag) is True and item["id"] not in seen:
            seen.add(item["id"])
            items.append(item)
            ids.append(item["id"])
    return items[:CHECKIN_MAX_SYMPTOMS], ids


def rule_based_fallback(watch: dict, med_names: Optional[list] = None, hospital: Optional[list] = None) -> dict:
    """Medicine-aware safety net (used only if the LLM is unavailable or fails)."""
    hospital = hospital or []
    names = " ".join([*(med_names or []), *[(h.get("name") or "") for h in hospital]]).lower()
    infusion_day = any(h.get("days_since_start") in (0, 1) for h in hospital)
    items = []
    if infusion_day:
        items += _FB_INFUSION
    if "oxaliplatin" in names:
        items.append(_FB_COLD)
    items += _FB_SAFETY
    if any(k in names for k in ("capecitabine", "xeloda", "fluorouracil", "5-fu")):
        items += _FB_CAPE
    items += _FB_GENERAL
    _, chemo_watch = _rule_based_symptoms(watch)
    return {
        "symptoms": items[:CHECKIN_MAX_SYMPTOMS],
        "lifestyle": [],
        "sources": {"chemo_watch": chemo_watch, "from_medicines": med_names or [], "fallback": True, "generated": False},
    }


# =====================================================================
# LLM context — de-identified, built entirely from the patient's own data
# =====================================================================
def _active_medicine_context(med_docs: list, now: datetime, tz) -> list:
    current = select_current_docs(med_docs)
    today = now.astimezone(tz).date()
    out: list = []
    for doc in current.values():
        created = _as_dt(doc.get("created_at"))
        start = created.astimezone(tz).date() if created else None
        for row in _usable_rows(doc):
            names = _row_names(row)
            if is_hospital_given(row):
                continue
            dur = parse_duration(row.get("standard_duration_options"), row.get("dosage_instructions"), row.get("frequency"))
            if start and dur["days"] and today > start + timedelta(days=dur["days"]):
                continue
            sched = parse_frequency(row.get("frequency"), row.get("dosage_instructions"))
            out.append({"name": names[0], "dose": row.get("strength") or None, "schedule": sched["schedule"],
                        "days_on_treatment": (today - start).days if start else None})
    return out


def _hospital_given_context(med_docs: list, now: datetime, tz) -> list:
    current = select_current_docs(med_docs)
    today = now.astimezone(tz).date()
    out: list = []
    for doc in current.values():
        created = _as_dt(doc.get("created_at"))
        start = created.astimezone(tz).date() if created else None
        for row in _usable_rows(doc):
            if is_hospital_given(row):
                out.append({"name": _row_names(row)[0], "days_since_start": (today - start).days if start else None})
    return out


def _age_from_dob(dob: Any) -> Optional[int]:
    d = None
    if isinstance(dob, datetime):
        d = dob.date()
    elif isinstance(dob, str):
        try:
            d = datetime.fromisoformat(dob[:10]).date()
        except ValueError:
            d = None
    if not d:
        return None
    today = date.today()
    return today.year - d.year - ((today.month, today.day) < (d.month, d.day))


def _weight_trend(recent_checkins: list) -> dict:
    weights = [(c.get("date"), c.get("weight")) for c in recent_checkins if isinstance(c.get("weight"), (int, float))]
    weights.sort(key=lambda x: x[0] or "", reverse=True)
    if not weights:
        return {"latest": None, "previous": None, "direction": None}
    latest = weights[0][1]
    previous = weights[1][1] if len(weights) > 1 else None
    direction = None
    if previous is not None:
        direction = "up" if latest > previous else "down" if latest < previous else "same"
    return {"latest": latest, "previous": previous, "direction": direction}


def _time_of_day(now_local: datetime) -> str:
    h = now_local.hour
    if 5 <= h < 12:
        return "morning"
    if 12 <= h < 16:
        return "afternoon"
    if 16 <= h < 21:
        return "evening"
    return "night"


def _recent_text_context(recent_checkins: list, limit: int = 3) -> list:
    out = []
    for c in recent_checkins:
        pieces = []
        if c.get("note_summary"):
            pieces.append(c["note_summary"])
        ft = c.get("free_text_summary")
        if isinstance(ft, dict):
            pieces.extend(v for v in ft.values() if isinstance(v, str) and v)
        pf = c.get("photo_findings")
        if isinstance(pf, list):
            pieces.extend(p.get("summary") for p in pf if isinstance(p, dict) and p.get("summary"))
        if pieces:
            out.append({"date": c.get("date"), "text": " / ".join(pieces)})
        if len(out) >= limit:
            break
    return out


def _yesterday_context(recent_checkins: list) -> list:
    """What was positive YESTERDAY (most recent check-in), so the LLM can turn
    each into a "how is it today" comparison instead of asking from scratch.
    Only symptoms with an id+label we can re-show are included; a bare
    numeric id with no snapshot label is skipped rather than guessed."""
    if not recent_checkins:
        return []
    last = recent_checkins[0]
    questions = {q["id"]: q for q in (last.get("questions") or []) if isinstance(q, dict) and q.get("id")}
    sym = last.get("symptoms") or {}
    out = []
    for qid, v in sym.items():
        q = questions.get(qid)
        if not q:
            continue
        kind = q.get("kind")
        positive = (v == 1) if kind == "yesno" else (isinstance(v, (int, float)) and v >= 1)
        if not positive:
            continue
        out.append({
            "id": qid, "kind": kind, "label_en": q.get("label_en") or q.get("label"),
            "value": v, "urgent": bool(q.get("urgent")),
        })
    fu = []
    for f in last.get("followups") or []:
        for qa in f.get("qa") or []:
            if qa.get("a") == "Yes":
                fu.append(qa.get("q"))
    return out[:20], fu[:6], last.get("date")


_DRUG_WATCH = {
    "capecitabine": ["loose stools and dehydration", "redness, burning or peeling of hands and feet", "mouth sores", "nausea and vomiting"],
    "xeloda": ["loose stools and dehydration", "redness, burning or peeling of hands and feet", "mouth sores", "nausea and vomiting"],
    "oxaliplatin": ["tingling or cramps in throat, jaw or hands from cold drinks or cold air", "infusion reaction (itching, flushing, chills)", "pain or redness at the drip site", "tightness in chest or throat"],
    "ondansetron": ["constipation"],
}


def _watch_hints(names: list) -> list:
    low = " ".join(n or "" for n in names).lower()
    hints: list = []
    for key, vals in _DRUG_WATCH.items():
        if key in low:
            hints += [v for v in vals if v not in hints]
    return hints


def build_llm_context(
    med_docs: list,
    chemo_doc: Optional[dict],
    recent_checkins: list,
    profile: Optional[dict],
    now: datetime,
    tz,
    diagnosis: Optional[str] = None,
) -> dict:
    now_local = now.astimezone(tz)
    watch = (((chemo_doc or {}).get("data") or {}).get("completion") or {}).get("watchSymptoms") or {}
    treatment = (chemo_doc or {}).get("treatment") or {}
    y = _yesterday_context(recent_checkins)
    yesterday_positive, yesterday_followup_yes, yesterday_date = y if y else ([], [], None)
    return {
        "age": _age_from_dob((profile or {}).get("date_of_birth")),
        "gender": (profile or {}).get("gender"),
        "diagnosis": diagnosis,
        "time_of_day": _time_of_day(now_local),
        "day_of_week": now_local.strftime("%A"),
        "active_medicines": _active_medicine_context(med_docs, now, tz),
        "hospital_given_medicines": _hospital_given_context(med_docs, now, tz),
        "doctor_watch_flags": [k for k, v in watch.items() if v is True],
        "chemo_cycle": (
            {"current_cycle": treatment.get("currentCycle"), "planned_cycles": treatment.get("plannedCycles")}
            if chemo_doc else None
        ),
        "weight_trend": _weight_trend(recent_checkins),
        "recent_checkin_count": len(recent_checkins),
        "recent_notes": _recent_text_context(recent_checkins),
        "yesterday_date": yesterday_date,
        "yesterday_positive_symptoms": yesterday_positive,
        "yesterday_followup_flagged": yesterday_followup_yes,
        "watch_hints": _watch_hints(
            [m["name"] for m in _active_medicine_context(med_docs, now, tz)]
            + [m["name"] for m in _hospital_given_context(med_docs, now, tz)]
        ),
    }


# =====================================================================
# Groq call + strict validation
# =====================================================================
_SYSTEM_PROMPT = """You write the EVENING monitoring questions for a cancer patient follow-up app,
the way a nurse would phone the patient at the end of the day. You are NOT giving advice, dosing
guidance or a diagnosis. You only ask what the patient experienced today.

TWO KINDS of question:

1. kind "compare" — use this for anything in yesterday_positive_symptoms. Word it as a short
   reminder of what the patient said yesterday, then ask how it is today. Example:
   "Yesterday you said you had nausea. How is it today?" The app shows the patient four fixed
   buttons (Gone / Better / About the same / Worse) — do NOT write your own options, and do not
   put the buttons in the label. Set "urgent_if_worse": true only if this symptom was already
   urgent yesterday (see the "urgent" field on that yesterday item) or is a safety symptom
   (fever/chills, breathlessness, chest pain, bleeding, blood in stool, fainting, confusion,
   vomiting/loose stools many times, unable to drink). Also use "compare" for anything the
   patient's follow-up answered Yes to yesterday (yesterday_followup_flagged) — word it the same
   way ("Yesterday you mentioned <thing>. How is it today?").

2. kind "yesno" — use this for everything else: new symptoms to check, or general/safety checks
   not covered above. One short, plain, past-tense question, e.g. "Did you vomit today?"
   yes_means_problem must be true. Never ask something where Yes is the good answer.

STYLE for both kinds: plain everyday words, no jargon, one symptom per question, say "today" (this
is an evening check-in covering the whole day, never "this morning" or "right now").

Return ONLY valid JSON, no markdown, no commentary, exactly this shape:
{{
  "symptoms": [
    {{"id": "short_snake_case_id",
      "kind": "yesno" | "compare",
      "group": "short heading, e.g. Infusion, Stomach and bowels, Mouth hands and feet, General, Wound",
      "label": "the question, in the requested language",
      "label_en": "the same question in English",
      "yes_means_problem": true,
      "urgent_if_yes": false,
      "urgent_if_worse": false
    }}
  ]
}}
Do not return a "lifestyle" list.

URGENT (yesno): set "urgent_if_yes" true ONLY for: blood in stool or black stools, chest pain, chest
or throat tightness, breathlessness, fever or chills, vomiting many times or unable to keep fluids
down, severe or very frequent loose stools, fainting or confusion, bleeding that will not stop.
Everything else false. For "compare" questions use "urgent_if_worse" as described above instead.

WHAT TO ASK:
- Every entry in yesterday_positive_symptoms and yesterday_followup_flagged becomes ONE "compare"
  question (do not also ask a fresh yesno for the same thing).
- If hospital_given_medicines is not empty and days_since_start is 0 or 1, the patient probably had
  an infusion today: ask about itching/rash/flushing/chills during the infusion, chest or throat
  tightness or trouble breathing, tingling in throat/jaw/hands, pain/swelling/redness at the drip
  site, tingling or cramps from cold drinks or cold air — as new "yesno" questions unless yesterday
  already covered the same one (then use "compare").
- Use watch_hints, active_medicines, doctor_watch_flags, chemo_cycle, diagnosis, recent_notes and
  weight_trend to choose remaining new questions. If diagnosis or recent_notes suggest recent
  surgery, ask about the wound.
- Also cover, as new questions when not already carried over from yesterday: nausea, vomiting,
  loose stools, blood or black stools, constipation, belly pain or bloating, mouth sores, difficulty
  swallowing, hands and feet, fever or chills, tiredness, dizziness, trouble drinking, urine passed,
  chest pain, palpitations, breathlessness, bleeding or bruising.
- Keep the general safety checks (pain, tiredness, nausea, fever) even if recently negative, unless
  already asked as a "compare" question this time.

COUNT: at most {max_symptoms}. Aim for 14-18 on an infusion day and 10-14 on other days. No padding.

ORDER (most relevant first): 1) compare questions on what is still active from yesterday;
2) infusion-day questions, if any; 3) vomiting, loose stools, trouble drinking, fever or chills,
blood in stool; 4) side effects for this patient's medicines; 5) general (tired, dizzy, pain, urine,
bleeding or bruising); 6) wound.

NEVER ASK ABOUT:
- Whether or when the patient took a medicine, dose timing, missed doses, or tablet schedules.
- Allergies, past medical history, other medicines, blood thinners, or herbal medicines.
- Whether the patient understands the treatment, has support at home, or has a hospital contact number.
- Never combine a medicine name with a dose, schedule, or instruction. Never state or imply the
  diagnosis in a label.

Write every label and group ONLY in the requested language."""

_FENCE_RE = re.compile(r"^\s*```(?:json)?\s*|\s*```\s*$", re.IGNORECASE)


def _strip_fence(text: str) -> str:
    return _FENCE_RE.sub("", text).strip()


def _parse_llm_json(raw_text: str) -> dict:
    return json.loads(_strip_fence(raw_text))


async def call_llm(context: dict, lang: str) -> Optional[dict]:
    if not GROQ_API_KEY:
        return None
    try:
        from groq import Groq
    except Exception:
        logger.exception("groq package unavailable")
        return None

    def _one_attempt(client: "Groq", use_json_mode: bool) -> dict:
        kwargs = dict(
            model=CHECKIN_LLM_MODEL,
            messages=[
                {"role": "system", "content": _SYSTEM_PROMPT.format(max_symptoms=CHECKIN_TARGET_SYMPTOMS)},
                {"role": "user", "content": json.dumps({"language": lang, "patient_context": context})},
            ],
            temperature=0.2,
            max_tokens=CHECKIN_LLM_MAX_TOKENS,
            extra_body={"reasoning_effort": "low"},
        )
        if use_json_mode:
            kwargs["response_format"] = {"type": "json_object"}
        resp = client.chat.completions.create(**kwargs)
        return _parse_llm_json(resp.choices[0].message.content)

    def _sync_call() -> Optional[dict]:
        client = Groq(api_key=GROQ_API_KEY)
        last_exc: Optional[Exception] = None
        for attempt, use_json_mode in enumerate([True, False, False], start=1):
            try:
                return _one_attempt(client, use_json_mode)
            except json.JSONDecodeError as e:
                last_exc = e
                logger.warning("check-in generation: malformed JSON on attempt %d/3 (%s)", attempt, e)
            except Exception as e:
                last_exc = e
                logger.warning("check-in generation: attempt %d/3 failed (%s)", attempt, e)
        logger.error("check-in question generation failed after 3 attempts: %s", last_exc)
        return None

    return await asyncio.to_thread(_sync_call)


_SUMMARY_SYSTEM_PROMPT = """You condense a cancer patient's own free-text check-in answer into a
short clinical-style note for use as background context in a future check-in, in English regardless
of the input language.

Rules:
- Keep only symptom-relevant meaning: what the patient described feeling, when, and how it relates
  to their care (a medicine, a body part, a time of day).
- Remove names of people (family members, doctors by name), places, phone numbers, or any other
  detail that is not itself a symptom description.
- Do not add anything not stated in the original text. Do not give advice or a diagnosis.
- At most {max_chars} characters.
- Return ONLY the condensed text, no quotes, no commentary, no markdown."""


async def summarize_free_text(texts: list, lang: str) -> Optional[str]:
    if not GROQ_API_KEY or not texts:
        return None
    combined = " / ".join(t.strip() for t in texts if t and t.strip())
    if not combined:
        return None
    try:
        from groq import Groq
    except Exception:
        logger.exception("groq package unavailable")
        return None

    def _sync_call() -> Optional[str]:
        client = Groq(api_key=GROQ_API_KEY)
        for attempt in range(2):
            try:
                resp = client.chat.completions.create(
                    model=CHECKIN_LLM_MODEL,
                    messages=[
                        {"role": "system", "content": _SUMMARY_SYSTEM_PROMPT.format(max_chars=MAX_FREE_TEXT_SUMMARY_CHARS)},
                        {"role": "user", "content": json.dumps({"language": lang, "text": combined})},
                    ],
                    temperature=0.2,
                    max_tokens=200,
                )
                out = _strip_fence(resp.choices[0].message.content or "").strip()
                if out:
                    return out[:MAX_FREE_TEXT_SUMMARY_CHARS]
            except Exception as e:
                logger.warning("free-text summarization attempt %d/2 failed (%s)", attempt + 1, e)
        return None

    return await asyncio.to_thread(_sync_call)


def _valid_item(item: Any, _debug_label: str = "") -> bool:
    if not isinstance(item, dict):
        logger.warning("checkin validate: %s not a dict: %r", _debug_label, item)
        return False
    if not _ID_RE.match(str(item.get("id", ""))):
        logger.warning("checkin validate: %s bad id %r", _debug_label, item.get("id"))
        return False
    if item.get("kind") not in ALLOWED_KINDS:
        logger.warning("checkin validate: %s bad kind %r", _debug_label, item.get("kind"))
        return False
    label = item.get("label")
    if not isinstance(label, str) or not (0 < len(label) <= _MAX_LABEL):
        logger.warning("checkin validate: %s bad label (len=%s) %r", _debug_label,
                        len(label) if isinstance(label, str) else "n/a", label)
        return False
    if _ADVICE_BLOCKLIST.search(label):
        logger.warning("checkin validate: %s label hit blocklist: %r", _debug_label, label)
        return False
    if item.get("kind") == "choice":
        opts = item.get("options")
        if not isinstance(opts, list) or not (2 <= len(opts) <= 5):
            logger.warning("checkin validate: %s bad options list %r", _debug_label, opts)
            return False
        for o in opts:
            if (
                not isinstance(o, list) or len(o) != 2 or not all(isinstance(x, str) and x for x in o)
                or len(o[1]) > _MAX_LABEL or _ADVICE_BLOCKLIST.search(o[1])
            ):
                logger.warning("checkin validate: %s bad option entry %r", _debug_label, o)
                return False
    return True


_RULE_BLOCKLIST = re.compile(
    r"\b(take|took|taken|missed|forgot|forget|allerg\w*|blood thinner\w*|herbal|contact number|phone number|understand\w*)\b",
    re.IGNORECASE,
)
_ADVICE_STEMS = re.compile(
    r"(\bmg\b|milligram|\bdos(e|age)|tablet|capsule|stop taking|discontinue|prescri|diagnos|should you|you should)",
    re.IGNORECASE,
)
_URGENT_ID_RE = re.compile(r"(blood|black|chest|fever|chill|breath|tight|faint|confus|persistent|unable|severe)")


def validate_generated(data: Any) -> Optional[dict]:
    """Drops bad items individually; only returns None if nothing usable is left."""
    if not isinstance(data, dict) or not isinstance(data.get("symptoms"), list):
        logger.warning("checkin validate: no symptoms list")
        return None
    clean, seen = [], set()
    for i, item in enumerate(data["symptoms"]):
        if not isinstance(item, dict):
            continue
        kind = item.get("kind")
        if kind == "yesno" and item.get("yes_means_problem") is False:
            logger.warning("checkin validate: dropped, Yes is the good answer: %r", item.get("label"))
            continue
        qid = re.sub(r"[^a-z0-9_-]", "_", str(item.get("id", "")).lower())[:38]
        if not qid or not qid[0].isalpha():
            qid = "q_" + qid
        item["id"] = qid
        label = item.get("label")
        if isinstance(label, str) and (_RULE_BLOCKLIST.search(label) or _ADVICE_STEMS.search(label)):
            logger.warning("checkin validate: dropped, rule wording: %r", label)
            continue
        if qid in seen or not _valid_item(item, f"symptoms[{i}]"):
            continue
        seen.add(qid)
        entry = {"id": qid, "kind": kind, "label": item["label"]}
        if isinstance(item.get("group"), str) and 0 < len(item["group"]) <= 40:
            entry["group"] = item["group"]
        if isinstance(item.get("label_en"), str):
            entry["label_en"] = item["label_en"][:_MAX_LABEL]
        if kind == "compare":
            entry["urgent"] = bool(item.get("urgent_if_worse")) or bool(_URGENT_ID_RE.search(qid))
        else:
            entry["urgent"] = bool(item.get("urgent_if_yes")) or bool(_URGENT_ID_RE.search(qid))
        clean.append(entry)
        if len(clean) >= CHECKIN_MAX_SYMPTOMS:
            break
    if not clean:
        logger.warning("checkin validate: nothing usable left")
        return None
    return {"symptoms": clean, "lifestyle": []}


# =====================================================================
# Entry point used by routes.py
# =====================================================================
async def build_checkin_config(
    *,
    ai_consent: bool,
    med_docs: list,
    chemo_doc: Optional[dict],
    recent_checkins: list,
    profile: Optional[dict],
    now: datetime,
    tz,
    lang: str,
    diagnosis: Optional[str] = None,
) -> dict:
    watch = (((chemo_doc or {}).get("data") or {}).get("completion") or {}).get("watchSymptoms") or {}

    fallback_reason = (
        "no_consent" if not ai_consent
        else "no_api_key" if not GROQ_API_KEY
        else "llm_or_validation_failed"
    )
    logger.info("check-in config: ai_consent=%s groq_key_set=%s lang=%s", ai_consent, bool(GROQ_API_KEY), lang)
    if ai_consent and GROQ_API_KEY:
        context = build_llm_context(med_docs, chemo_doc, recent_checkins, profile, now, tz, diagnosis=diagnosis)
        cleaned = None
        for attempt in range(2):
            raw = await call_llm(context, lang)
            cleaned = validate_generated(raw) if raw is not None else None
            if cleaned is not None:
                break
            logger.warning("check-in generation failed validation on attempt %d/2", attempt + 1)
        if cleaned is not None:
            _, chemo_watch_ids = _rule_based_symptoms(watch)
            return {
                "status": "success",
                "symptoms": cleaned["symptoms"],
                "lifestyle": [],
                "sources": {
                    "chemo_watch": chemo_watch_ids,
                    "from_medicines": [m["name"] for m in context["active_medicines"]],
                    "fallback": False,
                    "generated": True,
                },
            }
        logger.warning("check-in generation returned nothing usable after retries, falling back to rule-based")

    active = _active_medicine_context(med_docs, now, tz)
    hosp = _hospital_given_context(med_docs, now, tz)
    fb = rule_based_fallback(watch, [m["name"] for m in active], hosp)
    fb["sources"]["reason"] = fallback_reason
    return {"status": "success", **fb}


# =====================================================================
# Follow-up questions after the patient writes free text (message or
# check-in note/typed answer)
# =====================================================================
_FOLLOWUP_PROMPT = """You are a nurse phoning a cancer patient who has just written some free text
to their care team (either an anytime message, or a note/typed answer inside a check-in). Ask ONE
short follow-up question about what they wrote, to help the nurse understand. You are NOT giving
advice, dosing guidance or a diagnosis.

RULES:
- One question, past tense or present ("Did you...", "Have you...", "Do you have..."), plain words.
- It must be answerable with Yes or No, and Yes must mean a problem.
- Use patient_context (medicines, days since infusion, diagnosis) to pick the most useful question.
  Typical useful questions: fever or chills, vomiting, loose stools, trouble drinking, breathlessness
  or chest pain, dizziness or fainting, pain in one place, bleeding, a new rash, mouth sores.
- Never repeat a question already in history. Use the answers in history to choose the next one.
- Never ask about whether or when medicines were taken, allergies, past history, other medicines,
  or contact numbers. Never name a medicine with a dose or instruction. Never state a diagnosis.
- Set "urgent_if_yes" true only for: fever or chills, chest pain, breathlessness, blood in stool
  or vomit, fainting or confusion, vomiting many times, unable to drink, bleeding that will not stop.
- If you already have enough (or history has 4 answers), return {{"done": true}}.
- Write the question ONLY in the requested language.

Return ONLY JSON: {{"done": false, "question": "...", "urgent_if_yes": false}} or {{"done": true}}"""

FOLLOWUP_FALLBACK = [
    {"id": "fu_fever", "urgent": True, "label": _L(
        "Do you have a fever or chills?", "क्या आपको बुखार या ठंड लग रही है?", "നിങ്ങൾക്ക് പനിയോ വിറയലോ ഉണ്ടോ?")},
    {"id": "fu_gi", "urgent": False, "label": _L(
        "Have you vomited or had loose stools today?", "क्या आज आपको उल्टी या पतले दस्त हुए?", "ഇന്ന് ഛർദ്ദിയോ വയറിളക്കമോ ഉണ്ടായോ?")},
    {"id": "fu_drink", "urgent": True, "label": _L(
        "Are you having trouble drinking fluids?", "क्या आपको तरल पदार्थ पीने में परेशानी हो रही है?", "ദ്രാവകങ്ങൾ കുടിക്കാൻ ബുദ്ധിമുട്ടുണ്ടോ?")},
    {"id": "fu_breath", "urgent": True, "label": _L(
        "Do you have chest pain or trouble breathing?", "क्या आपको सीने में दर्द या साँस लेने में तकलीफ़ है?", "നെഞ്ചുവേദനയോ ശ്വാസതടസ്സമോ ഉണ്ടോ?")},
]


async def generate_followup(context: dict, lang: str, text: str, history: list) -> Optional[dict]:
    if not GROQ_API_KEY:
        return None
    try:
        from groq import Groq
    except Exception:
        return None

    def _sync() -> Optional[dict]:
        client = Groq(api_key=GROQ_API_KEY)
        for _ in range(2):
            try:
                resp = client.chat.completions.create(
                    model=CHECKIN_LLM_MODEL,
                    messages=[
                        {"role": "system", "content": _FOLLOWUP_PROMPT},
                        {"role": "user", "content": json.dumps({
                            "language": lang, "patient_message": text[:500],
                            "history": [{"q": h.get("q"), "yes": h.get("a")} for h in history],
                            "patient_context": context})},
                    ],
                    temperature=0.2,
                    max_tokens=CHECKIN_LLM_MAX_TOKENS,
                    response_format={"type": "json_object"},
                    extra_body={"reasoning_effort": "low"},
                )
                data = _parse_llm_json(resp.choices[0].message.content or "")
                if data.get("done") is True:
                    return {"done": True}
                q = data.get("question")
                if (isinstance(q, str) and 0 < len(q) <= _MAX_LABEL
                        and not _RULE_BLOCKLIST.search(q) and not _ADVICE_STEMS.search(q)):
                    return {"id": "fu_" + str(len(history) + 1), "label": q,
                            "urgent": bool(data.get("urgent_if_yes"))}
                logger.warning("followup: rejected question %r", q)
            except Exception as e:
                logger.warning("followup generation failed (%s)", e)
        return None

    return await asyncio.to_thread(_sync)