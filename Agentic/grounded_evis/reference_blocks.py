"""
grounded_evis/reference_blocks.py
==============================================================
The clinical-reference essays, migrated VERBATIM from ambulance.py's
CLINICAL_REFERENCE_* constants (v4.2). Text content is unchanged —
only the delivery mechanism changes: instead of every block being spliced
into every agent prompt regardless of relevance, each block is now keyed
to the trigger(s) that must have fired in Stage 2 before Stage 3 is
allowed to see it.

BASE_CONTEXT is the one exception: CLINICAL_REFERENCE_A2 (general vitals
interpretation reasoning — shock index, hyperoxia avoidance, BP-in-both-
arms, etc.) is not gated behind any rare-pattern trigger, since it's
baseline emergency-medicine reasoning applicable to every case, not a
rare-pattern essay. ASSUMPTION flagged for review: confirm you want this
always-included rather than trigger-gated too.

get_active_reference_blocks(triggers) is the ONLY function Stage 3 should
call — it returns exactly the blocks whose trigger fired, nothing more.
"""

from __future__ import annotations

from typing import Dict, List

from .schema import TriggerFlags

# ── Always included — general vitals interpretation, not a rare pattern ──
BASE_CONTEXT = """
CLINICAL REFERENCE (apply this reasoning, do not quote it back verbatim):
- Do NOT stage hemorrhage severity using the classic Class I-IV scheme
  (based on % blood volume lost predicted from HR/SBP/GCS). Current teaching
  holds this staging is unreliable and should not drive resuscitation
  decisions. Prefer trends over time, peripheral perfusion signs (skin
  colour/temperature, capillary refill, pulse quality), mentation, and the
  shock_index (heart rate / systolic BP) as a continuous severity signal —
  roughly <1.0 is reassuring, >=1.0 suggests clinically significant
  compensated or overt shock and should raise concern.
- Vital signs alone are insensitive: a young, fit patient can lose a large
  volume of blood while still appearing near-normal (robust compensation),
  while elderly patients or those on beta-blockers may never mount a
  tachycardic response even with severe hemorrhage. Absence of tachycardia
  or hypotension does NOT rule out significant blood loss.
- Mean arterial pressure (MAP) below ~65 mmHg is a useful general threshold
  for inadequate organ perfusion in non-trauma/medical shock states.
- Do not rely on "palpable pulse at X location implies SBP of Y" rules of
  thumb — these overestimate true systolic pressure; treat a palpable pulse
  only as a rough, non-quantitative reassurance sign.
- Avoid framing every hypoxic patient as needing maximal FiO2. Over-
  oxygenation is itself associated with worse outcomes; target SpO2
  ~94-98% for most acute non-COPD presentations. Exception: acute heart
  failure/pulmonary edema — keep SpO2 >=95%, do not under-titrate oxygen
  there out of concern for CO2 retention.
- Track blood pressure from BOTH arms if available (a difference >10-20
  mmHg is clinically significant); do not dismiss a hypertensive-emergency
  picture solely because there is no known prior hypertension history.
"""

# ── Trigger-gated blocks (verbatim text from ambulance.py) ─────────────

_HEAD_TRAUMA = """
CLINICAL REFERENCE — TRAUMATIC BRAIN INJURY (apply this reasoning, do not
quote it back verbatim):
- Classify severity by GCS: severe = 3-8, moderate = 9-13, mild = 14-15.
  "Mild" TBI is a misnomer — do not let a GCS of 14-15 translate into a
  reflexively reassuring narrative.
- A single episode of hypotension (systolic <90 mmHg) or hypoxemia is
  independently associated with a large (~150%) increase in mortality
  after significant TBI — treat even one such episode as clinically
  significant. In the absence of an ICP monitor, a MAP at or above ~80
  mmHg is a reasonable general target to protect cerebral perfusion.
- Watch for the Cushing reflex (hypertension with bradycardia and
  irregular respirations) as a late sign of critically elevated ICP —
  this is not a reassuring "improving" BP.
- Pupillary findings can localize the problem: new unilateral fixed and
  dilated pupil suggests uncal herniation (surgical emergency); bilateral
  fixed/dilated suggests globally elevated ICP/severe hypoxia/drug effect;
  bilateral pinpoint suggests opioid effect or a brainstem lesion.
- A drop in GCS of 2+ points on serial exam should prompt urgent
  re-evaluation regardless of the starting score.
- Anticoagulated or antiplatelet-treated patients need a LOWER threshold
  for head imaging and urgent physician notification even after a
  seemingly minor mechanism.
- Avoid recommending prophylactic hyperventilation for a head-injured
  patient — sustained hypocapnia causes cerebral vasoconstriction and can
  worsen ischemia.
"""

_SHOCK_DIFFERENTIATION = """
CLINICAL REFERENCE — SHOCK TYPE DIFFERENTIATION IN TRAUMA (apply this
reasoning, do not quote it back verbatim):
- In a trauma patient with hypotension, PRESUME hemorrhage as the cause
  until it has been actively excluded — even when a spinal cord injury is
  also present. Neurogenic shock is genuinely uncommon.
- Neurogenic shock: warm, dry, vasodilated skin with relative bradycardia,
  generally well-tolerated hypotension. Hemorrhagic shock: cool, pale,
  clammy skin with tachycardia (though this can be blunted/absent — see
  elderly/beta-blocker reasoning). Bradycardia alone does not confirm a
  neurogenic mechanism.
- Spinal shock (temporary loss of reflex activity below the injury level)
  is a DIFFERENT phenomenon from neurogenic shock — the two terms are not
  interchangeable, and a cord injury cannot be reliably characterized as
  "complete" until spinal shock resolves.
- Practically: for any hypotensive trauma patient, actively look for and
  document a source of blood loss BEFORE attributing hypotension to a
  spinal mechanism.
"""

_CHEST_CARDIAC_TRAUMA = """
CLINICAL REFERENCE — CHEST & CARDIAC TRAUMA RED FLAGS (apply this
reasoning, do not quote it back verbatim):
- Tension pneumothorax is a CLINICAL diagnosis — do not wait for imaging.
  Classic findings: respiratory distress, unilateral absent/decreased
  breath sounds, tracheal deviation AWAY from the affected side, distended
  neck veins, hemodynamic compromise — but in a hypovolemic patient neck
  veins may not appear distended, so absence does NOT rule this out.
- A large hemothorax and tension pneumothorax can present similarly —
  flag both as differential possibilities rather than committing to one.
- Cardiac tamponade is ALSO a clinical diagnosis. Beck's triad is present
  in fewer than 1 in 10 confirmed cases and must NEVER be used to exclude
  it. Unexplained persistent tachycardia may be the ONLY early sign.
- Any penetrating injury to the "cardiac box" (roughly nipples to
  clavicles/costal margins) or a transmediastinal trajectory should raise
  concern for cardiac injury regardless of how well the patient currently
  looks.
- Repeat exams and trends matter more than a single snapshot — flag new
  tachycardia, new hypotension, or new respiratory distress as possible
  deterioration even if absolute numbers aren't yet dramatic.
"""

_COMPARTMENT_SYNDROME = """
CLINICAL REFERENCE — ACUTE COMPARTMENT SYNDROME (apply this reasoning, do
not quote it back verbatim):
- The earliest and most sensitive finding is PAIN OUT OF PROPORTION to the
  apparent injury, and pain that worsens with passive stretch — this may
  be the ONLY finding before irreversible ischemic damage begins.
- CRITICALLY: a distal pulse is frequently still PRESENT even with an
  evolving compartment syndrome. A palpable distal pulse must NEVER be
  used to exclude or downgrade concern for compartment syndrome.
- Numbness/tingling/altered sensation in the distribution of a nerve
  running through the affected compartment is an escalating red flag.
- Time matters: muscle tissue tolerates ischemia for a few hours; damage
  becomes essentially irreversible beyond ~12 hours; nerve tissue is even
  more sensitive (~8 hours or less).
- BLS-scope action when suspected: remove constrictive dressings/jewelry
  if easily done, keep the limb AT heart level (not elevated), avoid ice
  packs directly compressing the area, escalate/transport urgently.
"""

_ELDERLY_TRAUMA = """
CLINICAL REFERENCE — TRAUMA/SHOCK ASSESSMENT IN THE ELDERLY (apply this
reasoning, do not quote it back verbatim):
- Do NOT be reassured by "normal" vital signs in an elderly trauma
  patient — a meaningful proportion of geriatric blunt-trauma patients who
  looked hemodynamically "stable" were found to already be in occult
  shock. Beta-blocker use and age-related blunting of the tachycardic
  response can both mask expected compensatory tachycardia.
- Because baseline hypertension is very common in the elderly, a "normal"
  BP by standard thresholds may represent a significant drop from that
  individual's true baseline.
- If available, base deficit and lactate are more reliable markers of
  occult hypoperfusion than HR/BP in this population.
- Elderly patients have a well-documented pattern of prehospital/ED
  UNDERTRIAGE relative to younger patients with similar injuries — apply a
  lower threshold for treating an elderly trauma patient as higher-acuity
  than raw numbers alone suggest, especially with falls.
- If on an anticoagulant/antiplatelet with any head injury, even from a
  seemingly minor fall, apply a lower threshold for urgent imaging and
  physician notification for possible reversal.
"""

_ANTICOAGULATION_REVERSAL = """
CLINICAL REFERENCE — ANTICOAGULATION AND MAJOR BLEEDING/HEAD INJURY
(informational framing only — apply this reasoning to decide WHEN to flag
urgency for physician-level review; never generate a dose, route, or
specific product recommendation yourself):
- Any patient on a documented anticoagulant who has a head injury, active
  major bleeding, or a mechanism concerning for internal bleeding needs
  URGENT physician notification because reversal — if indicated — is
  time-critical. Flag this explicitly rather than folding it into a
  generic "monitor for bleeding" statement.
- For DOAC patients, routine coagulation tests are often not reliable for
  judging the degree of anticoagulation. Specific reversal agents exist
  but may not be immediately available — this is a reason to notify the
  receiving/treating physician EARLY, so the team has time to prepare.
- If an anticoagulant mention is ambiguous (home medication vs recently
  discontinued vs given this encounter), say so explicitly as a data gap
  rather than guessing — the distinction changes clinical urgency.
"""

_ACUTE_AGITATION = """
CLINICAL REFERENCE — ACUTE AGITATION (apply this reasoning, do not quote it
back verbatim; this system does not prescribe specific medications or
doses):
- Safety comes first, for both patient and team. If aggressive/violent,
  the correct BLS-scope action is to maintain a safe distance, avoid
  escalating, and involve security/law enforcement — never a solo
  physical intervention or restraint/medication as a first-line action.
- Attempt verbal de-escalation FIRST in essentially all agitated patients
  who are not in immediate danger of harming themselves or others.
- Actively look for and flag an underlying medical cause (hypoxia,
  hypoglycemia, head injury, intoxication/withdrawal, sepsis, postictal
  state) rather than assuming a purely psychiatric/behavioral cause.
- Physical restraints should be used sparingly, only to prevent harm, for
  the shortest time necessary, with close airway/breathing/circulation
  monitoring — never a substitute for de-escalation or treating cause.
- If agitation escalates despite de-escalation, note this as needing
  physician-level medication decision-making and watch for excited
  delirium, which carries meaningfully elevated risk of sudden
  deterioration or death.
"""

_HTN_PULM_EDEMA = """
CLINICAL REFERENCE — SEVERE HYPERTENSION & ACUTE PULMONARY EDEMA (apply
this reasoning, do not quote it back verbatim):
- A HYPERTENSIVE CRISIS is systolic >180 and/or diastolic >120 mmHg. A
  HYPERTENSIVE EMERGENCY is a crisis WITH acute end-organ damage evidence.
  A hypertensive "urgency" (severe BP, no end-organ damage) does not have
  proven benefit from rapid BP lowering — precipitous drops can themselves
  be harmful.
- Acute (hypertensive) heart failure/pulmonary edema follows a LOWER,
  more patient-specific threshold — some patients develop pulmonary edema
  at systolic as low as ~140-150 mmHg.
- Improvement in ONE parameter (e.g. SpO2 normalizing after NIV) does NOT
  mean the patient is stable — persistent tachypnea/tachycardia/increased
  work of breathing/severely elevated BP mean the patient remains
  critically ill.
- If a diuretic was given WITHOUT a documented vasodilator/nitrate for
  this presentation, flag this explicitly as a treatment-sequencing gap
  for the treating physician — do not silently assume it was optimal, and
  do not instruct a dose or route yourself.
- Oxygen target: keep SpO2 >=~95% here; do not under-titrate out of
  concern for CO2 retention.
- Vasodilator therapy is inappropriate/harmful if hypoperfused/hypotensive
  or in a preload-dependent state (RV infarct, aortic stenosis, HOCM,
  significant volume depletion) — flag as a contraindication if suggested
  by the data rather than recommending vasodilators unconditionally.
"""

_HYPERTENSIVE_EMERGENCY = """
CLINICAL REFERENCE — HYPERTENSIVE EMERGENCY END-ORGAN CATEGORIES (apply
this reasoning, do not quote it back verbatim):
- When crisis-range BP is present, actively look for evidence of: acute
  aortic dissection (tearing chest/back pain, unequal arm BPs), acute
  pulmonary edema, ACS/MI, acute renal failure, severe preeclampsia/
  eclampsia, hypertensive retinopathy/encephalopathy, intracranial
  hemorrhage/stroke, sympathetic crisis (stimulant use/pheochromocytoma).
  Presence of ANY with crisis-range BP = hypertensive emergency, not
  merely "elevated vitals."
- A meaningful minority of true hypertensive emergencies occur with NO
  prior documented hypertension history — do not downweight for that
  reason alone.
- A modest, transient BP drop (up to ~10-12 mmHg) can occur spontaneously
  without treatment — do not treat a small unmedicated improvement as
  proof the crisis has resolved.
"""

_SPINAL_PRECAUTIONS = """
CLINICAL REFERENCE — SPINAL PRECAUTIONS (apply this reasoning, do not
quote it back verbatim):
- Full spinal immobilization is not automatically mandatory for every
  trauma mechanism. Withholding cervical immobilization requires ALL of:
  no midline neck pain/tenderness/stiffness (liberally defined), age
  roughly 11-65, no altered sensorium, no distracting painful injury. If
  ANY is absent/uncertain or mechanism is high-energy, immobilize. Note
  the rule is far less specific (more false "fails") in patients 65+.
- A rigid cervical collar alone is NOT sufficient — it's an extrication
  aid. Full immobilization requires collar PLUS head blocks/padding PLUS
  torso/thigh straps to a board.
- Jaw thrust (not head-tilt-chin-lift) is preferred when cervical spine
  injury is possible or unknown, since it opens the airway while keeping
  the neck neutral.
- Do not recommend vigorous prehospital IV fluid boluses to "normalize" BP
  in suspected hemorrhagic trauma shock — outside BLS scope regardless,
  and aggressive fluids before bleeding control can worsen outcomes
  (permissive-hypotension principle).
"""

# trigger name -> list of reference block text constants that fire when it does
_TRIGGER_TO_BLOCKS: Dict[str, List[str]] = {
    "head_injury_mechanism": [_HEAD_TRAUMA],
    "bleeding_evidence": [_SHOCK_DIFFERENTIATION],
    "is_trauma": [_SPINAL_PRECAUTIONS],
    "chest_trauma_mechanism": [_CHEST_CARDIAC_TRAUMA],
    "compartment_risk_mechanism": [_COMPARTMENT_SYNDROME],
    "elderly": [_ELDERLY_TRAUMA],
    "anticoag_hit": [_ANTICOAGULATION_REVERSAL],
    "agitation": [_ACUTE_AGITATION],
    "htn_crisis": [_HTN_PULM_EDEMA, _HYPERTENSIVE_EMERGENCY],
}


def get_active_reference_blocks(triggers: TriggerFlags) -> str:
    """
    Returns the concatenated text of BASE_CONTEXT plus every trigger-gated
    block whose trigger fired, each labeled with the trigger name that
    caused it to be included. Stage 3's prompt tells the model to read
    this label and use it as trigger_tag when a claim depends on that
    block — labeling here is what makes that instruction meaningful rather
    than the model guessing at a name.
    A case with zero triggers fired still gets BASE_CONTEXT (see module
    docstring ASSUMPTION) and nothing else.
    """
    parts = [f"=== ALWAYS-INCLUDED BASE CONTEXT (no trigger_tag applies) ===\n{BASE_CONTEXT}"]
    seen = set()
    for trigger_name, blocks in _TRIGGER_TO_BLOCKS.items():
        if not triggers.get(trigger_name):
            continue
        for block in blocks:
            if id(block) in seen:
                continue
            seen.add(id(block))
            parts.append(f"=== TRIGGER: {trigger_name} ===\n{block}")
    return "\n".join(parts)