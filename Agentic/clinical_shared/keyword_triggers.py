"""
clinical_shared/keyword_triggers.py
==============================================================
SINGLE SOURCE OF TRUTH for keyword/regex-based clinical trigger detection.

Migration note: today ANTICOAGULANT_KEYWORDS exists independently in ambulance.py
(EVIS) and as a differently-worded _ANTICOAG_KEYWORDS_NOTE in
emergency_structured_note.py — same drift problem compute_triage_colour
already had before clinical_shared/triage.py was created. This module is
the same fix applied to the keyword-trigger lists.

Every regex here answers ONE question: "does the raw text contain a
literal signal for X" — nothing here makes a clinical judgement. Judgement
(is this patient ACTUALLY at anticoagulation-related risk right now)
belongs to grounded_evis.stage2_ground_check, which combines these hits
with grounded facts (e.g. an actual head-injury fact) before treating a
trigger as "fired".
"""

from __future__ import annotations

import re
from typing import List

# ── Anticoagulant / antiplatelet ────────────────────────────────────────
# (identical to today's ambulance.py ANTICOAGULANT_KEYWORDS — kept as-is,
# just relocated so structured-note can import the same list instead of
# its own differently-worded copy)
ANTICOAGULANT_KEYWORDS = re.compile(
    r"\b(warfarin|coumadin|dabigatran|pradaxa|rivaroxaban|xarelto|apixaban|eliquis|"
    r"edoxaban|savaysa|betrixaban|heparin|enoxaparin|lovenox|dalteparin|fondaparinux|"
    r"clopidogrel|plavix|ticagrelor|prasugrel|aspirin|antiplatelet|anticoagulant|"
    r"blood thinner)\b",
    re.IGNORECASE,
)

# ── Bleeding / injury evidence ──────────────────────────────────────────
# (today's ambulance.py _has_bleeding_or_injury_evidence() keyword tuple,
# promoted to a shared regex; today's structured-note _BLEEDING_KEYWORDS_NOTE
# folds in here too — confirm with you if that list had additional terms
# EVIS's tuple didn't, since I only have ambulance.py to work from)
# ── Bleeding evidence ONLY — no trauma/mechanism words here. This is the
# pattern Stage 2 must use for the bleeding_evidence trigger specifically;
# trauma mechanism alone (accident, fall, "trauma evaluation") must NOT
# satisfy this, or every trauma-with-imaging case fires it regardless of
# whether bleeding is actually mentioned.
BLEEDING_KEYWORDS = re.compile(
    r"\b(bleed|ha?emorrhage|blood loss|laceration|wound|penetrat|gunshot|stab|"
    r"fracture|h[ae]matoma|internal bleeding)\b",
    re.IGNORECASE,
)

# Kept for any caller still relying on the OLD combined semantics
# (bleeding-OR-injury) — e.g. if ambulance.py's own sanitizer still needs
# this broader shape. New grounded-pipeline code should use BLEEDING_KEYWORDS
# for the bleeding_evidence trigger specifically, and TRAUMA_MECHANISM_KEYWORDS
# for trauma mechanism — never this combined list for a single named trigger.
BLEEDING_OR_INJURY_KEYWORDS = re.compile(
    r"\b(bleed|ha?emorrhage|blood loss|laceration|wound|penetrat|gunshot|stab|"
    r"fracture|h[ae]matoma|internal bleeding|trauma|accident|fall|fell|"
    r"assault|crush|burn)\b",
    re.IGNORECASE,
)

# ── Trauma mechanism (registration-level ground truth check) ───────────
# (today's ambulance.py _REGISTRATION_TRAUMA_KEYWORDS tuple, promoted to regex)
TRAUMA_MECHANISM_KEYWORDS = re.compile(
    r"\b(road traffic|rta|collision|accident|fall|fell|assault|stabbed|"
    r"gunshot|penetrating|blunt trauma|crush|burn|trauma)\b",
    re.IGNORECASE,
)

# ── Treatments/interventions performed this encounter ──────────────────
# (today's ambulance.py TREATMENT_KEYWORDS, unchanged)
TREATMENT_KEYWORDS = re.compile(
    r"\b(bipap|cpap|niv|non[- ]?invasive ventilation|nebuli[sz]|oxygen|o2\b|"
    r"nasal cannula|face mask|non[- ]?rebreather|high[- ]?flow nasal|intubat|ventilat(?:or|ed|ion)?|"
    r"lasix|furosemide|bumetanide|nitroglycerin|nitrate|gtn\b|morphine|aspirin|"
    r"clopidogrel|heparin|adrenaline|epinephrine|atropine|amiodarone|tranexamic|txa\b|"
    r"defibrillat|cardiovert|iv fluid|normal saline|ringer|cannula|catheter|"
    r"cardiac monitor|monitor connected|ecg\b|ekg\b|electrocardiogram|12[- ]?lead|"
    r"foley|ng tube|"
    r"chest tube|thoracostomy|compressions|cpr\b|dialysis|insulin|"
    r"diuretic|vasodilator|inotrope|pressor|calcium chloride|calcium gluconate|"
    r"needle decompression|pericardiocentesis|vitamin k|prothrombin complex|pcc\b|"
    r"idarucizumab|andexanet|protamine|fasciotomy|hematoma block|reduction splint(?:ed)?|"
    r"x[- ]?ray|xr\b|ct scan|ultrasound|fast scan|fast exam|echo(?:cardiogram)?|"
    r"abg\b|blood gas|blood test|blood work|labs drawn|lab sample|glucose check|"
    r"blood sugar checked|troponin|d[- ]?dimer)\b",
    re.IGNORECASE,
)

# ── NEW for the grounded pipeline — chest/cardiac trauma mechanism ─────
# Used by Stage 2's chest_trauma_mechanism trigger. Mechanism/location
# keywords only — NOT a diagnosis. A hit here means "chest/cardiac trauma
# reasoning is plausibly relevant," not "tension pneumothorax is present."
CHEST_CARDIAC_TRAUMA_MECHANISM_KEYWORDS = re.compile(
    r"\b(chest trauma|chest injury|blunt chest|penetrating chest|stab(?:bed)? (?:to |in )?(?:the )?chest|"
    r"gunshot (?:to |in )?(?:the )?chest|rib fracture|flail chest|sternal|precordial|"
    r"cardiac box|thoracic trauma|pneumothorax|hemothorax|h[ae]mothorax|tamponade|"
    r"chest tube|thoracostomy)\b",
    re.IGNORECASE,
)

# ── NEW for the grounded pipeline — compartment-syndrome risk mechanism ─
COMPARTMENT_RISK_MECHANISM_KEYWORDS = re.compile(
    r"\b(crush injury|crushed|crush syndrome|prolonged (?:limb )?compression|"
    r"found down|tight (?:cast|dressing|bandage)|circumferential (?:cast|dressing)|"
    r"tibia fracture|fibula fracture|forearm fracture|compartment syndrome|"
    r"pain out of proportion|prolonged extrication)\b",
    re.IGNORECASE,
)

# ── NEW for the grounded pipeline — head-injury mechanism ──────────────
# ASSUMPTION (flagged for review): the design doc's canonical trigger list
# doesn't separately list "head_injury_mechanism", but CLINICAL_REFERENCE_
# HEAD_TRAUMA is specific enough that folding it under the generic
# is_trauma trigger would inject head-trauma content for e.g. an isolated
# ankle fracture. Added as its own trigger, gated separately in Stage 2.
# Flag this for correction if you want it folded differently.
HEAD_INJURY_MECHANISM_KEYWORDS = re.compile(
    r"\b(head injury|head trauma|hit (?:his|her|their) head|struck (?:his|her|their) head|"
    r"skull fracture|cranial|scalp laceration|loss of consciousness|"
    r"gcs\b|glasgow coma|concussion|herniation|cushing)\b",
    re.IGNORECASE,
)

# ── Acute agitation ──────────────────────────────────────────────────
AGITATION_KEYWORDS = re.compile(
    r"\b(agitated|agitation|combative|aggressive|violent|restraint|"
    r"de-?escalat|excited delirium|resisting|thrashing)\b",
    re.IGNORECASE,
)


# Negation cues that, if present in the SAME sentence as a keyword hit and
# preceding it, mean the hit should NOT count as evidence the finding is
# present. This exists because a naive keyword scan treats "denies any
# fall or collision" identically to "sustained a fall" — a real failure
# found while testing this module against the original repro case (a
# 35-year-old who explicitly denied trauma still tripped the bleeding/
# trauma keyword regexes on "fall"/"collision" before this fix).
# Deliberately conservative: only suppresses a hit when a negation cue
# appears BEFORE the matched term in the same sentence — "fall, denied"
# (cue after) is left as a hit, since word order for negation is
# ambiguous enough there that suppressing it risks masking a real finding.
NEGATION_CUES = re.compile(
    r"\b(den(?:y|ies|ied)|no |not |without|negative for|rule(?:d)? out|"
    r"absent|no evidence of|no sign(?:s)? of|no history of)\b",
    re.IGNORECASE,
)


def any_hit(text: str, pattern: "re.Pattern") -> bool:
    """Small convenience so callers don't need to null-check text everywhere.
    NOT negation-aware — use any_hit_excluding_negation for triggers where a
    denied finding must not count (which is almost always what you want for
    clinical trigger detection; this bare version exists for callers that
    are just checking evidence_text snippets Stage 1 already isolated, where
    Stage 1 was instructed not to extract negated findings as facts)."""
    return bool(text) and bool(pattern.search(text))


def any_hit_excluding_negation(text: str, pattern: "re.Pattern") -> bool:
    """Sentence-scoped, negation-aware hit check. Splits text into
    sentences; for each sentence containing a pattern match, suppresses
    that match if a negation cue appears earlier in the same sentence.
    This is the function Stage 2 should use for raw-text-blob trigger
    checks (is_trauma, bleeding_evidence, chest/compartment mechanism,
    agitation) since those scan whole conversations, not pre-isolated
    evidence_text snippets."""
    if not text:
        return False
    for sentence in re.split(r"(?<=[.;\n])\s+", text):
        match = pattern.search(sentence)
        if not match:
            continue
        prefix = sentence[: match.start()]
        if NEGATION_CUES.search(prefix):
            continue
        return True
    return False


def find_all_sentences_with_hit(text: str, pattern: "re.Pattern") -> List[str]:
    """Returns the individual sentences/lines within text that matched AND
    were not negated — used when Stage 2 needs to cite WHICH phrase
    triggered a flag, not just that the document as a whole contains a hit
    somewhere."""
    if not text:
        return []
    hits = []
    for sentence in re.split(r"(?<=[.;\n])\s+", text):
        sentence = sentence.strip()
        match = pattern.search(sentence)
        if not match:
            continue
        prefix = sentence[: match.start()]
        if NEGATION_CUES.search(prefix):
            continue
        hits.append(sentence)
    return hits