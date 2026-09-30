// ─────────────────────────────────────────────────────────────────────────────
// clinicalScale.js — the BENCHMARK SCALE behind the assessment dashboard.
//
// The MSE form speaks in words ("Blunted", "Active with plan", "Tardive
// dyskinesia"). A dashboard needs numbers: to say how far this visit sits from
// normal, and whether the patient is better or worse than last time. This file
// is the translation layer, and nothing else in the module does that job.
//
// It is DATA, deliberately. Every clinical judgement lives in FIELD_SCALE as an
// editable literal, so a consultant can re-weight the whole instrument without
// reading a line of logic. ── The mappings below are drawn from standard
// psychiatric practice and, for the instruments, from published cut-offs, but
// they have NOT been signed off by a clinician. Treat them as a first draft to
// be reviewed before any report is printed for a patient record. ──
//
// The scale is keyed by FIELD KEY, matching the flat `formData` model, and the
// option strings are the tab's own. That makes it a sibling of
// BASELINE_TABLE_SPEC in tabFieldMap.js, and it carries the same obligation:
// when MSETab.jsx gains a field or renames an option, this file must follow.
// Failure is loud rather than silent — an unmapped value is reported as
// `unmapped` and excluded from every mean, never scored 0.
//
// Currently covers MSE & Cognition (52 scored fields across 9 domains). Baseline
// Inv. is the obvious next tab — PHQ-9/GAD-7/HAM-D/MADRS/YMRS/PANSS/GAF all have
// textbook bands — and needs only more FIELD_SCALE entries, no new logic.
// ─────────────────────────────────────────────────────────────────────────────

export const SCALE_VERSION = 'mse-1.0';

// The one severity ladder everything is normalised onto. Index IS the score, so
// a field's number and the word beside it can never drift apart.
export const BANDS = ['Normal', 'Borderline', 'Mild', 'Moderate', 'Severe'];
export const MAX_SCORE = BANDS.length - 1; // 4

/** Band name for a 0–4 field score (rounded — banded fields can be fractional). */
export const bandOf = (score) =>
  score === null || score === undefined
    ? null
    : BANDS[Math.max(0, Math.min(MAX_SCORE, Math.round(score)))];

/** Band name for a 0–100 domain/composite score. */
export const bandOf100 = (pct) =>
  pct === null || pct === undefined ? null : bandOf((pct / 100) * MAX_SCORE);

/**
 * The 0–100 span each band occupies, as [{band, from, to}] from Normal upward.
 *
 * Derived from the same rounding bandOf100 does, so the progression chart's
 * shaded zones can never drift out of step with the band a chip shows for the
 * same number — re-band the scale and the zones move with it.
 */
export const bandRanges = () =>
  BANDS.map((band, i) => ({
    band,
    from: Math.max(0, ((i - 0.5) / MAX_SCORE) * 100),
    to: Math.min(100, ((i + 0.5) / MAX_SCORE) * 100),
  }));

// ─────────────────────────────────────────────────────────────────────────────
// DOMAINS
//
// One per MSE section, so a subscore maps onto how a psychiatrist already reads
// the examination. `weight` is the domain's share of the composite index:
// a delusion moves the needle further than reduced eye contact.
//
// Risk is deliberately separate — never averaged into the composite, never
// assumed normal on silence, and pulled to the top of the dashboard, because a
// missed "active with plan" is not the same kind of error as a missed tremor.
// ─────────────────────────────────────────────────────────────────────────────
export const DOMAINS = {
  behaviour: { label: 'Appearance & Behaviour', short: 'Behaviour', weight: 1 },
  speech: { label: 'Speech', short: 'Speech', weight: 1 },
  affect: { label: 'Mood & Affect', short: 'Affect', weight: 1.5 },
  thought: { label: 'Thought', short: 'Thought', weight: 2 },
  perception: { label: 'Perception', short: 'Perception', weight: 2 },
  cognition: { label: 'Cognition', short: 'Cognition', weight: 1.5 },
  insight: { label: 'Insight & Judgement', short: 'Insight', weight: 1.5 },
  movement: { label: 'Movement / EPS', short: 'Movement', weight: 1 },
  risk: { label: 'Risk', short: 'Risk', weight: 0, separate: true },
};

export const RISK_DOMAIN = 'risk';

/** Grid order for the dashboard. Risk is excluded — it has its own panel. */
export const DOMAIN_ORDER = [
  'thought', 'perception', 'affect', 'cognition',
  'insight', 'behaviour', 'speech', 'movement',
];

// ─────────────────────────────────────────────────────────────────────────────
// Option matching
//
// The tab's option strings carry an EN DASH in "Partial (Grade 2–4)", EM DASHes
// in "Auditory — 3rd person", an accent in "Déjà vu" and an ampersand in
// "Logical & goal-directed". A map key typed with the wrong dash would silently
// stop matching, and a field that stops matching stops being scored — the exact
// failure this file is supposed to make impossible. So every lookup goes through
// the same aggressive normalisation the backend's _match_option uses.
// ─────────────────────────────────────────────────────────────────────────────
// Written as escapes, not pasted glyphs: this file is the one place a stray
// look-alike character would break matching silently, so the bytes are explicit.
const DASHES = /[−–—‐‑]/g;      // − – — ‐ ‑
const COMBINING = /[̀-ͯ]/g;                    // accents, post-NFKD

const normKey = (v) =>
  String(v ?? '')
    .replace(DASHES, '-')
    .normalize('NFKD')
    .replace(COMBINING, '') // "Déjà vu" → "deja vu"
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '');

/** Build a normalised lookup once per field spec, cached on the spec object. */
function lookup(spec) {
  if (!spec._lut) {
    const lut = new Map();
    Object.entries(spec.map || {}).forEach(([opt, score]) => lut.set(normKey(opt), score));
    Object.defineProperty(spec, '_lut', { value: lut, enumerable: false });
  }
  return spec._lut;
}

const isBlank = (v) =>
  v === undefined ||
  v === null ||
  (typeof v === 'string' && !v.trim()) ||
  (Array.isArray(v) && v.every(isBlank));

const firstNumber = (v) => {
  const m = String(v ?? '').match(/-?\d+(?:\.\d+)?/);
  return m ? Number(m[0]) : null;
};

// ─────────────────────────────────────────────────────────────────────────────
// FIELD_SCALE — the instrument itself.
//
//   kind: 'ordinal'      one option → one score
//         'multi'        checks; score is the WORST option ticked
//         'multi-intact' checks listing preserved abilities (orientation) —
//                        score rises with how many are MISSING
//         'banded'       a number read against published cut-offs
//         'protective'   recorded and displayed, never scored as severity
//         'narrative'    free text; shown in the report, never scored
//         'meta'         identity of the examination, not a finding
//
//   w:           weight within the domain (default 1)
//   benchmark:   what "no abnormality" looks like, shown as the report's
//                reference column
//   direction:   banded fields only — which way is worse (display + sanity)
//   unassessed:  option values that mean "we did not test this", so they can
//                never be mistaken for a normal result
//   critical:    must be explicitly confirmed; silence is reported, not assumed
//   caution:     extra extraction guidance appended verbatim to the field's guide
//   inferred:    a severity band read off the consultation instead of a measured
//                score — see CLINICAL IMPRESSIONS below
// ─────────────────────────────────────────────────────────────────────────────

// Appended to every administered instrument. Without it the guidance for MMSE
// reads "a number / 30, lower is worse — 27–30 Normal | 24–26 Borderline | …",
// which tells the model exactly which number carries which severity and never
// says a total must actually have been administered. A confused-sounding
// consultation then yields "mmse: 22" — a test result that was never performed,
// which the dashboard will plot, diff against the previous visit and flag on.
//
// The severity in that consultation is real; it just is not a test score. It
// belongs in the matching impression field instead.
const SCORE_CAUTION =
  'take this ONLY from a total actually stated as having been scored — never estimate it from how ' +
  'the patient sounds or performs in conversation, and leave it out if no total was given. Put the ' +
  'severity in the matching "clinical impression" field instead';

export const FIELD_SCALE = {
  // ── 2.0 Examination details ────────────────────────────────────────────────
  mseDate: { kind: 'meta', label: 'Date of Examination' },
  mseExaminer: { kind: 'meta', label: 'Examined By' },

  // ── 2.1 Appearance & Behaviour ────────────────────────────────────────────
  appearance: {
    kind: 'ordinal', domain: 'behaviour', label: 'General Appearance',
    benchmark: 'Well-kempt', map: {
      'Well-kempt': 0, 'Age-appropriate': 0, 'Dishevelled': 2,
      'Unkempt/self-neglect': 3, 'Bizarre': 3,
      'Signs of weight loss': 3, 'Signs of intoxication': 3,
    },
  },
  behaviour: {
    kind: 'ordinal', domain: 'behaviour', label: 'Behaviour', w: 1.5,
    benchmark: 'Cooperative', map: {
      'Cooperative': 0, 'Guarded': 1, 'Preoccupied': 2, 'Withdrawn': 2,
      'Suspicious': 3, 'Disinhibited': 3, 'Agitated': 3, 'Hostile/aggressive': 4,
    },
  },
  eyeContact: {
    kind: 'ordinal', domain: 'behaviour', label: 'Eye Contact',
    benchmark: 'Appropriate', map: {
      'Appropriate': 0, 'Reduced': 1, 'Avoidant': 2, 'Intense/staring': 3,
    },
  },
  rapport: {
    kind: 'ordinal', domain: 'behaviour', label: 'Rapport',
    benchmark: 'Easily established', map: {
      'Easily established': 0, 'Difficult': 2, 'Not established': 4,
    },
  },
  psychomotor: {
    kind: 'ordinal', domain: 'behaviour', label: 'Psychomotor Activity', w: 1.5,
    benchmark: 'Normal', map: {
      'Normal': 0, 'Retardation': 2, 'Agitation': 2,
      'Stupor': 4, 'Catatonic features': 4,
    },
  },
  catatonia: {
    kind: 'multi', domain: 'behaviour', label: 'Catatonic Signs', w: 1.5,
    benchmark: 'None', map: {
      'None': 0, 'Grimacing': 1, 'Stereotypy': 1, 'Echolalia': 2, 'Echopraxia': 2,
      'Ambitendency': 2, 'Automatic obedience': 2, 'Negativism': 3, 'Posturing': 3,
      'Waxy flexibility': 3, 'Mutism': 4, 'Stupor': 4,
    },
  },
  // Drug-induced movement, not psychopathology — scored in its own domain so a
  // side-effect burden never reads as worsening illness.
  eps: {
    kind: 'multi', domain: 'movement', label: 'Extrapyramidal Signs', w: 1.5,
    benchmark: 'None', map: {
      'None': 0, 'Tremor': 1, 'Gait abnormality': 1, 'Bradykinesia': 2,
      'Rigidity': 2, 'Akathisia': 3, 'Dystonia': 3, 'Tardive dyskinesia': 4,
    },
  },
  appearanceNotes: { kind: 'narrative', domain: 'behaviour', label: 'Appearance & Behaviour Notes' },

  // ── 2.2 Speech ────────────────────────────────────────────────────────────
  speechRate: {
    kind: 'ordinal', domain: 'speech', label: 'Rate', benchmark: 'Normal',
    map: { 'Normal': 0, 'Increased (pressured)': 2, 'Reduced': 2, 'Mute': 4 },
  },
  speechVolume: {
    kind: 'ordinal', domain: 'speech', label: 'Volume', benchmark: 'Normal',
    map: { 'Normal': 0, 'Soft': 1, 'Loud': 2, 'Whispered': 2 },
  },
  speechTone: {
    kind: 'ordinal', domain: 'speech', label: 'Tone / Prosody', benchmark: 'Normal',
    map: { 'Normal': 0, 'Monotonous': 2, 'Dysarthric': 2, 'Dysprosodic': 2 },
  },
  speechFlow: {
    kind: 'ordinal', domain: 'speech', label: 'Flow / Coherence', w: 1.5,
    benchmark: 'Normal', map: {
      'Normal': 0, 'Circumstantial': 1, 'Tangential': 2, 'Poverty of speech': 3,
      'Flight of ideas': 3, 'Loosening of associations': 4,
    },
  },
  // Reverse polarity: "Yes" is the abnormal answer here.
  speechFormal: {
    kind: 'ordinal', domain: 'speech', label: 'Formal Thought Disorder Evident',
    benchmark: 'No', map: { 'No': 0, 'Yes': 3 },
  },

  // ── 2.3 Mood & Affect ─────────────────────────────────────────────────────
  moodSubjective: { kind: 'narrative', domain: 'affect', label: 'Mood (subjective)' },
  moodObjective: {
    kind: 'ordinal', domain: 'affect', label: 'Mood (objective)', w: 1.5,
    benchmark: 'Euthymic', map: {
      'Euthymic': 0, 'Irritable': 2, 'Anxious': 2, 'Depressed': 3,
      'Elated/euphoric': 3, 'Perplexed': 3, 'Labile': 3,
    },
  },
  affectRange: {
    kind: 'ordinal', domain: 'affect', label: 'Affect — Range', benchmark: 'Full',
    map: { 'Full': 0, 'Restricted': 2, 'Blunted': 3, 'Flat': 4 },
  },
  affectReactivity: {
    kind: 'ordinal', domain: 'affect', label: 'Affect — Reactivity', benchmark: 'Reactive',
    map: { 'Reactive': 0, 'Non-reactive': 3 },
  },
  affectCongruence: {
    kind: 'ordinal', domain: 'affect', label: 'Affect — Congruence', benchmark: 'Congruent',
    map: { 'Congruent': 0, 'Incongruent': 3 },
  },
  affectAppropriate: {
    kind: 'ordinal', domain: 'affect', label: 'Affect — Appropriateness', benchmark: 'Appropriate',
    map: { 'Appropriate': 0, 'Inappropriate': 3 },
  },

  // ── 2.4 Thought ───────────────────────────────────────────────────────────
  thoughtForm: {
    kind: 'ordinal', domain: 'thought', label: 'Form of Thought', w: 1.5,
    benchmark: 'Logical & goal-directed', map: {
      'Logical & goal-directed': 0, 'Circumstantial': 1, 'Tangential': 2,
      'Perseveration': 3, 'Thought block': 3, 'Flight of ideas': 3,
      'Loosening of associations': 4, 'Neologisms': 4, 'Word salad': 4,
    },
  },
  delusions: {
    kind: 'multi', domain: 'thought', label: 'Delusions', w: 2,
    benchmark: 'None', map: {
      'None': 0, 'Hypochondriacal': 2, 'Persecutory': 3, 'Grandiose': 3,
      'Reference': 3, 'Guilt': 3, 'Jealousy': 3, 'Erotomanic': 3, 'Religious': 3,
      'Control/passivity': 4, 'Nihilistic': 4, 'Bizarre': 4,
    },
  },
  delusionDetail: { kind: 'narrative', domain: 'thought', label: 'Delusion — Detail' },
  // Passivity phenomena are first-rank; any one of them carries the same weight.
  thoughtPossession: {
    kind: 'multi', domain: 'thought', label: 'Thought Possession', w: 2,
    benchmark: 'None', map: {
      'None': 0, 'Thought insertion': 4, 'Thought withdrawal': 4,
      'Thought broadcasting': 4, 'Made acts/feelings/impulses': 4,
    },
  },
  obsessions: {
    kind: 'multi', domain: 'thought', label: 'Obsessions / Compulsions',
    benchmark: 'None', map: {
      'None': 0, 'Contamination': 2, 'Checking': 2, 'Symmetry/ordering': 2,
      'Hoarding': 2, 'Sexual': 2, 'Religious': 2,
      'Aggressive/harm': 3, 'Compulsive rituals': 3,
    },
  },
  suicidalThoughts: {
    kind: 'ordinal', domain: 'risk', label: 'Suicidal Ideation', w: 3, critical: true,
    benchmark: 'None', map: {
      'None': 0, 'Passive': 2, 'Active without plan': 3,
      'Active with plan': 4, 'Active with intent': 4,
    },
  },
  homicidalThoughts: {
    kind: 'ordinal', domain: 'risk', label: 'Homicidal Ideation', w: 2, critical: true,
    benchmark: 'None', map: { 'None': 0, 'Present': 4 },
  },

  // ── 2.5 Perception ────────────────────────────────────────────────────────
  hallucinations: {
    kind: 'multi', domain: 'perception', label: 'Hallucinations', w: 2,
    benchmark: 'None', map: {
      'None': 0, 'Auditory — 2nd person': 3, 'Auditory — 3rd person': 3,
      'Auditory — commentary': 3, 'Auditory — command': 4, 'Visual': 3,
      'Olfactory': 3, 'Gustatory': 3, 'Tactile/somatic': 3,
    },
  },
  hallucinationDetail: { kind: 'narrative', domain: 'perception', label: 'Hallucination — Detail' },
  otherPerception: {
    kind: 'multi', domain: 'perception', label: 'Other Perceptual Disturbance',
    benchmark: 'None', map: {
      'None': 0, 'Illusions': 1, 'Déjà vu': 1, 'Heightened perception': 1,
      'Depersonalisation': 2, 'Derealisation': 2,
    },
  },

  // ── 2.6 Cognition ─────────────────────────────────────────────────────────
  conscLevel: {
    kind: 'ordinal', domain: 'cognition', label: 'Level of Consciousness', w: 1.5,
    benchmark: 'Alert', map: {
      'Alert': 0, 'Drowsy': 2, 'Fluctuating': 3, 'Clouding': 3, 'Stuporous': 4,
    },
  },
  // Ticks are what the patient still HAS, so the score comes from the gaps.
  orientation: {
    kind: 'multi-intact', domain: 'cognition', label: 'Orientation', w: 1.5,
    benchmark: 'Person, Place, Time, Situation',
    expected: ['Person', 'Place', 'Time', 'Situation'],
  },
  attention: {
    kind: 'ordinal', domain: 'cognition', label: 'Attention & Concentration',
    benchmark: 'Normal', map: {
      'Normal': 0, 'Mildly impaired': 2, 'Moderately impaired': 3, 'Severely impaired': 4,
    },
  },
  // "6 / 4" — forward span first, which is the figure the cut-offs are built on.
  digitSpan: {
    kind: 'banded', domain: 'cognition', label: 'Digit Span (forward / backward)',
    parse: 'firstNumber', direction: 'lower-worse', benchmark: '6 forward',
    bands: [[6, 20, 0], [5, 5, 2], [4, 4, 3], [0, 3, 4]],
    // A specific administration, like the clock: the digits were repeated back or
    // they were not. "Seemed to lose track" is not a span, so there is no
    // impression sibling for this one either.
    caution:
      'only where digits were actually given and repeated back — never inferred from the patient ' +
      'seeming distractible or losing the thread',
  },
  shortMemory: {
    kind: 'ordinal', domain: 'cognition', label: 'Short-term Memory',
    benchmark: 'Intact', map: { 'Intact': 0, 'Impaired': 3 },
    caution: 'Extract as "Intact" if delayed word recall (e.g. 3 words after distraction) is successfully performed',
  },
  longMemory: {
    kind: 'ordinal', domain: 'cognition', label: 'Long-term Memory',
    benchmark: 'Intact', map: { 'Intact': 0, 'Impaired': 3 },
    caution: 'Extract as "Intact" if remote past events, biographical milestones, or past history are recalled accurately',
  },
  workingMemory: {
    kind: 'ordinal', domain: 'cognition', label: 'Working Memory',
    benchmark: 'Intact', map: { 'Intact': 0, 'Impaired': 3 },
    caution: 'Extract as "Intact" if serial 7s, spelling WORLD backwards, or mental manipulation is performed accurately',
  },
  language: {
    kind: 'ordinal', domain: 'cognition', label: 'Language',
    benchmark: 'Normal', map: {
      'Normal': 0, 'Dysarthria': 2, 'Anomia': 3, 'Dysphasia': 4,
    },
  },
  executive: {
    kind: 'ordinal', domain: 'cognition', label: 'Executive Function',
    benchmark: 'Normal', map: { 'Normal': 0, 'Impaired': 3 },
    caution: 'Extract as "Normal" if abstract reasoning (similarities/proverbs), verbal fluency, or sequential planning is intact with no frontal deficits',
  },
  // Reverse polarity: "Absent" is the normal answer.
  confabulation: {
    kind: 'ordinal', domain: 'cognition', label: 'Confabulation',
    benchmark: 'Absent', map: { 'Absent': 0, 'Present': 3 },
    caution: 'Extract as "Absent" if the patient provides factual, accurate recall without making up false memories or fabricating stories',
  },

  // ── 2.7 Insight & Judgement ───────────────────────────────────────────────
  // Listed worst-first on the form (Grade 1 is no insight), so the map is
  // inverted relative to every other ordinal here. Left explicit on purpose.
  insight: {
    kind: 'ordinal', domain: 'insight', label: 'Insight', w: 2,
    benchmark: 'Good/True (Grade 6)', map: {
      'Good/True (Grade 6)': 0, 'Intellectual (Grade 5)': 1,
      'Partial (Grade 2–4)': 2, 'Absent (Grade 1)': 4,
    },
    caution: 'Extract as "Good/True (Grade 6)" if the patient clearly understands their illness, need for treatment, and agrees with ongoing medical care',
  },
  judgement: {
    kind: 'ordinal', domain: 'insight', label: 'Judgement',
    benchmark: 'Intact', map: { 'Intact': 0, 'Impaired': 3, 'Grossly impaired': 4 },
    caution: 'Extract as "Intact" if the patient demonstrates sound reasoning, safe decision-making, and understanding of situations',
  },
  capacityTreatment: {
    kind: 'ordinal', domain: 'insight', label: 'Capacity re: Treatment', w: 1.5,
    benchmark: 'Has capacity', unassessed: ['Not assessed'],
    map: { 'Has capacity': 0, 'Fluctuating': 3, 'Lacks capacity': 4 },
    caution: 'Extract as "Has capacity" if the patient understands, retains, weighs up treatment information, and makes their own treatment decisions',
  },
  insightNotes: { kind: 'narrative', domain: 'insight', label: 'Insight & Judgement Notes' },

  // ── 2.8 Risk ──────────────────────────────────────────────────────────────
  // All five are `critical`: an unanswered risk field is reported as NOT
  // ASSESSED, never inferred to be "None". A quiet consultation is not a safe one.
  riskSelfHarm: {
    kind: 'ordinal', domain: 'risk', label: 'Risk — Self-harm / Suicide', w: 3,
    critical: true, benchmark: 'None',
    map: { 'None': 0, 'Low': 2, 'Moderate': 3, 'High': 4 },
    caution: 'If the patient or informant denies self-harm, suicidal thoughts, or states there is no suicide risk, record "None"',
  },
  riskViolence: {
    kind: 'ordinal', domain: 'risk', label: 'Risk — Violence to Others', w: 2.5,
    critical: true, benchmark: 'None',
    map: { 'None': 0, 'Low': 2, 'Moderate': 3, 'High': 4 },
    caution: 'If the patient or informant denies violence, aggression, or states there is no risk to others, record "None"',
  },
  riskNeglect: {
    kind: 'ordinal', domain: 'risk', label: 'Risk — Self-neglect', w: 2,
    critical: true, benchmark: 'None',
    map: { 'None': 0, 'Low': 2, 'Moderate': 3, 'High': 4 },
    caution: 'If the patient manages personal care, hygiene, and daily living without neglect, record "None"',
  },
  riskVulnerability: {
    kind: 'ordinal', domain: 'risk', label: 'Risk — Vulnerability / Exploitation', w: 2,
    critical: true, benchmark: 'None',
    map: { 'None': 0, 'Low': 2, 'Moderate': 3, 'High': 4 },
    caution: 'If the patient is safe at home and not vulnerable to exploitation, abuse, or financial trickery, record "None"',
  },
  riskAbsconding: {
    kind: 'ordinal', domain: 'risk', label: 'Risk — Absconding', w: 1.5,
    critical: true, benchmark: 'None',
    map: { 'None': 0, 'Low': 2, 'Moderate': 3, 'High': 4 },
    caution: 'If the patient stays safely at home, does not wander, run away, or attempt to abscond, record "None"',
  },
  // Counted and displayed beside the risk scores, never folded into them:
  // protective factors mitigate risk, and adding them to a severity mean would
  // let good social support cancel out a suicide plan.
  protectiveFactors: {
    kind: 'protective', domain: 'risk', label: 'Protective Factors',
  },
  riskFormulation: {
    kind: 'narrative', domain: 'risk', label: 'Risk Formulation & Management Plan',
    caution: 'Extract the clinician summary of overall risk, protective factors, and follow-up management plan',
  },
  // "ideation 3, behaviour none" — the ideation grade (1–5) is the first number.
  cSSRS: {
    kind: 'banded', domain: 'risk', label: 'C-SSRS', critical: true,
    parse: 'firstNumber', direction: 'higher-worse', benchmark: 'ideation 0',
    bands: [[0, 0, 0], [1, 2, 2], [3, 3, 3], [4, 5, 4]],
    caution: 'Extract in the format "ideation <0-5>, behaviour <none/present>" when suicide/self-harm risk screening is discussed',
  },

  // ── 2.9 Screening & movement scales (published cut-offs) ──────────────────
  mmse: {
    kind: 'banded', domain: 'cognition', label: 'MMSE', w: 2,
    direction: 'lower-worse', benchmark: '≥ 27 / 30', unit: '/ 30',
    bands: [[27, 30, 0], [24, 26, 1], [19, 23, 2], [10, 18, 3], [0, 9, 4]],
    caution: SCORE_CAUTION,
  },
  moca: {
    kind: 'banded', domain: 'cognition', label: 'MoCA', w: 2,
    direction: 'lower-worse', benchmark: '≥ 26 / 30', unit: '/ 30',
    bands: [[26, 30, 0], [23, 25, 1], [18, 22, 2], [11, 17, 3], [0, 10, 4]],
    caution: SCORE_CAUTION,
  },
  aceIII: {
    kind: 'banded', domain: 'cognition', label: 'ACE-III', w: 2,
    direction: 'lower-worse', benchmark: '≥ 89 / 100', unit: '/ 100',
    bands: [[89, 100, 0], [83, 88, 1], [74, 82, 2], [60, 73, 3], [0, 59, 4]],
    caution: SCORE_CAUTION,
  },
  clock: {
    kind: 'ordinal', domain: 'cognition', label: 'Clock Drawing Test',
    benchmark: 'Normal (3)', map: {
      'Normal (3)': 0, 'Minor errors (2)': 2, 'Inaccurate (1)': 3, 'No attempt (0)': 4,
    },
    // A scored artefact: either the patient drew a clock or they did not, and no
    // amount of conversation reveals one. Hence no impression sibling.
    caution: 'only where a clock was actually drawn and graded',
  },
  fab: {
    kind: 'banded', domain: 'cognition', label: 'FAB (frontal battery)',
    direction: 'lower-worse', benchmark: '≥ 16 / 18', unit: '/ 18',
    bands: [[16, 18, 0], [14, 15, 1], [12, 13, 2], [9, 11, 3], [0, 8, 4]],
    caution: SCORE_CAUTION,
  },
  aims: {
    kind: 'banded', domain: 'movement', label: 'AIMS (dyskinesia)', w: 1.5,
    direction: 'higher-worse', benchmark: '0–1 / 28', unit: '/ 28',
    bands: [[0, 1, 0], [2, 4, 1], [5, 9, 2], [10, 17, 3], [18, 28, 4]],
    caution: SCORE_CAUTION,
  },
  basAkathisia: {
    kind: 'banded', domain: 'movement', label: 'Barnes Akathisia',
    direction: 'higher-worse', benchmark: '0–1 / 14', unit: '/ 14',
    bands: [[0, 1, 0], [2, 3, 1], [4, 6, 2], [7, 9, 3], [10, 14, 4]],
    caution: SCORE_CAUTION,
  },
  simpson: {
    kind: 'banded', domain: 'movement', label: 'Simpson–Angus (parkinsonism)',
    direction: 'higher-worse', benchmark: '≤ 2 / 40', unit: '/ 40',
    bands: [[0, 2, 0], [3, 5, 1], [6, 11, 2], [12, 19, 3], [20, 40, 4]],
    caution: SCORE_CAUTION,
  },
  cognitiveSummary: { kind: 'narrative', domain: 'cognition', label: 'Cognitive Summary' },
};

// ─────────────────────────────────────────────────────────────────────────────
// CLINICAL IMPRESSIONS — the consultation's route to a severity
//
// SCORE_CAUTION above stops the model inventing an MMSE total. On its own that
// would make the tab strictly less useful: a consultation in which a patient
// cannot say what month it is, repeats herself and has stopped managing her own
// tablets carries real cognitive severity, and dropping it because no test was
// administered loses a genuine finding.
//
// So each instrument gains a sibling holding the BAND, which is what a
// consultation actually supports. Options are this file's own BANDS, since these
// bands carry no instrument-specific wording (they are [lo, hi, score] triples,
// unlike the CBT scale's). One vocabulary across all five, so it is learned once.
//
// Deliberately absent, and this is the important half:
//
//   • cSSRS has NO impression sibling and must never get one. Risk is an action
//     threshold, and the rule that silence means NOT ASSESSED rather than "none"
//     is the whole point. An inferred suicide risk is the one value this system
//     must not produce.
//   • digitSpan and clock have none either — see their cautions above.
//
// The instrument always wins where both are present (see scoreSession), and the
// dashboard marks an inferred point as inferred.
// ─────────────────────────────────────────────────────────────────────────────

const IMPRESSION_CAUTION =
  'read this from what the patient said and did in the consultation, not from a test — it is the ' +
  'clinician\'s impression, not a score. If a total for the instrument WAS given, fill that instead ' +
  'and leave this empty. Leave it out entirely if the consultation says nothing about this area';

// Antipsychotics predict akathisia and parkinsonism. Predicting is not observing,
// and a side effect recorded because the drug usually causes it is a fiction that
// looks exactly like a finding.
const OBSERVED_ONLY =
  'record only what was actually described or observed — never what the medication would be ' +
  'expected to cause';

/** Impression key → the instrument key(s) whose measurement supersedes it. */
export const IMPRESSION_FALLBACKS = {
  // MMSE, MoCA and ACE-III all measure global cognition, so ONE impression stands
  // in for whichever was not done. Three siblings would triple-count into the
  // cognition domain; any one administered total supersedes this field.
  cogImpression: ['mmse', 'moca', 'aceIII'],
  execImpression: ['fab'],
  dyskinesiaImpression: ['aims'],
  akathisiaImpression: ['basAkathisia'],
  parkinsonismImpression: ['simpson'],
};

const IMPRESSION_META = {
  cogImpression: {
    label: 'Global cognition — clinical impression', domain: 'cognition', w: 2,
    extra: 'If memory, orientation, or attention is described/tested and intact with no cognitive impairment, record "Normal"',
  },
  execImpression: {
    label: 'Executive / frontal function — clinical impression', domain: 'cognition', w: 1,
    extra: 'If similarities, proverb interpretation, verbal fluency, or sequential planning is intact with no frontal deficits, record "Normal"',
  },
  dyskinesiaImpression: {
    label: 'Involuntary movements — clinical impression',
    domain: 'movement', w: 1.5,
    extra: 'If hands, face, or tongue are examined and free of tremor, tics, or involuntary movements, record "Normal"',
  },
  akathisiaImpression: {
    label: 'Restlessness / akathisia — clinical impression',
    domain: 'movement', w: 1,
    extra: 'If the patient sits still and denies inner restlessness or urges to move legs, record "Normal"',
  },
  parkinsonismImpression: {
    label: 'Stiffness / parkinsonism — clinical impression',
    domain: 'movement', w: 1,
    extra: 'If muscle tone is supple and gait/arm swing is normal without rigidity, record "Normal"',
  },
};

// The five band names ARE the option list, mapping straight onto scores 0–4.
const IMPRESSION_MAP = Object.fromEntries(BANDS.map((band, score) => [band, score]));

Object.assign(
  FIELD_SCALE,
  Object.fromEntries(
    Object.entries(IMPRESSION_META).map(([key, meta]) => [
      key,
      {
        kind: 'ordinal',
        domain: meta.domain,
        w: meta.w,
        inferred: true,
        label: meta.label,
        map: IMPRESSION_MAP,
        benchmark: BANDS[0],
        caution: meta.extra ? `${IMPRESSION_CAUTION}. ${meta.extra}` : IMPRESSION_CAUTION,
      },
    ])
  )
);

/**
 * Option lists for the impression selects, exported so the FORM reads them from
 * the scale instead of retyping them — a retyped option that drifted by one word
 * would score as unmapped and quietly stop counting.
 */
export const IMPRESSION_OPTIONS = Object.fromEntries(
  Object.keys(IMPRESSION_META).map((k) => [k, [...BANDS]])
);

/** Keys that carry a severity score (everything except meta/narrative/protective). */
export const SCORED_KEYS = Object.keys(FIELD_SCALE).filter((k) =>
  !['meta', 'narrative', 'protective'].includes(FIELD_SCALE[k].kind)
);

// ─────────────────────────────────────────────────────────────────────────────
// THE SCALE AS EXTRACTION GUIDANCE
// ─────────────────────────────────────────────────────────────────────────────

/** Options grouped by the band they score into: "Normal = A, B | Mild = C". */
const bandGroups = (map) => {
  const byBand = BANDS.map(() => []);
  Object.entries(map).forEach(([option, score]) => {
    byBand[Math.max(0, Math.min(MAX_SCORE, Math.round(score)))].push(option);
  });
  return byBand
    .map((opts, i) => (opts.length ? `${BANDS[i]} = ${opts.join(', ')}` : null))
    .filter(Boolean)
    .join(' | ');
};

/**
 * One line of mapping guidance for a field, or null if it needs none.
 *
 * Narrative and meta fields get null: free text has no ladder to read against,
 * and a date is not a severity. Returning null (rather than an empty string)
 * keeps them out of the payload entirely.
 */
export function guideFor(key) {
  const spec = FIELD_SCALE[key];
  if (!spec) return null;

  const bits = [];
  if (spec.kind === 'ordinal' || spec.kind === 'multi') {
    if (!spec.map) return null;
    // An impression's options ARE the five band names, so spelling the mapping out
    // would read "Normal = Normal | Mild = Mild" — noise. Its caution carries the
    // guidance that actually matters instead.
    if (!spec.inferred) bits.push(`how severe each option is — ${bandGroups(spec.map)}`);
    if (spec.kind === 'multi') bits.push('list every one present, not just the worst');
  } else if (spec.kind === 'banded') {
    const direction = spec.direction === 'lower-worse' ? 'lower is worse' : 'higher is worse';
    const ladder = (spec.bands || [])
      .map(([lo, hi, score]) => `${lo}–${hi} ${BANDS[Math.round(score)]}`)
      .join(' | ');
    bits.push(`a number${spec.unit ? ` ${spec.unit}` : ''}, ${direction} — ${ladder}`);
  } else if (spec.kind === 'multi-intact') {
    bits.push(
      `tick each of ${(spec.expected || []).join(', ')} the patient gets RIGHT — ` +
      'what is missing is the deficit, so do not tick one that was never tested'
    );
  } else if (spec.kind === 'protective') {
    bits.push('record only what was actually mentioned; never counted as severity');
  }

  if (spec.benchmark) bits.push(`no abnormality looks like: ${spec.benchmark}`);
  if (spec.unassessed?.length) {
    bits.push(
      `${spec.unassessed.map((u) => `"${u}"`).join(' / ')} means NOT TESTED — ` +
      'never use it to mean normal'
    );
  }
  // Mirrors the scoring rule that silence on a risk field is reported, never
  // assumed normal: if nothing was said, the field must arrive empty so the
  // dashboard can show NOT ASSESSED instead of a fabricated "None".
  if (spec.critical) {
    bits.push('fill ONLY from something explicitly said about this — otherwise leave it out');
  }
  if (spec.caution) bits.push(spec.caution);
  return bits.length ? bits.join('. ') : null;
}

// ─────────────────────────────────────────────────────────────────────────────
// SCORING
// ─────────────────────────────────────────────────────────────────────────────

const displayOf = (raw) => (Array.isArray(raw) ? raw.join(', ') : String(raw ?? ''));

/**
 * Score ONE field.
 *
 * Returns { assessed, score, band, display, detail, unmapped }. An unmapped
 * value is assessed:false with unmapped:true — it is surfaced in the dashboard
 * footer so the scale can be corrected, and is never scored 0, because "we do
 * not recognise this answer" and "this answer is normal" must not look alike.
 */
export function scoreField(key, raw) {
  const spec = FIELD_SCALE[key];
  if (!spec) return null;

  const base = {
    k: key,
    label: spec.label || key,
    domain: spec.domain || null,
    kind: spec.kind,
    weight: spec.w || 1,
    // True for a band read off the consultation rather than an administered test.
    // Travels with the datapoint to the chart marker, so a judgement is never
    // displayed as a measurement.
    inferred: !!spec.inferred,
    benchmark: spec.benchmark || null,
    unit: spec.unit || null,
    direction: spec.direction || null,
    critical: !!spec.critical,
    display: '',
    detail: '',
    assessed: false,
    unmapped: false,
    score: null,
    band: null,
  };

  if (isBlank(raw)) return base;
  base.display = displayOf(raw);

  // Explicit "we didn't test this" answers must not be scored as findings.
  if ((spec.unassessed || []).some((u) => normKey(u) === normKey(raw))) {
    base.detail = 'not assessed';
    return base;
  }

  if (spec.kind === 'meta' || spec.kind === 'narrative') {
    base.assessed = true; // recorded, but carries no score
    return base;
  }

  if (spec.kind === 'protective') {
    const list = Array.isArray(raw) ? raw.filter((v) => !isBlank(v)) : [raw];
    base.assessed = true;
    base.detail = `${list.length} present`;
    base.count = list.length;
    return base;
  }

  if (spec.kind === 'ordinal') {
    const hit = lookup(spec).get(normKey(raw));
    if (hit === undefined) {
      base.unmapped = true;
      return base;
    }
    return { ...base, assessed: true, score: hit, band: bandOf(hit) };
  }

  if (spec.kind === 'multi') {
    const list = (Array.isArray(raw) ? raw : [raw]).filter((v) => !isBlank(v));
    const lut = lookup(spec);
    const hits = [];
    const misses = [];
    list.forEach((v) => {
      const s = lut.get(normKey(v));
      if (s === undefined) misses.push(v);
      else hits.push({ v, s });
    });
    if (!hits.length) {
      base.unmapped = misses.length > 0;
      return base;
    }
    // Worst-ticked wins. A count of positives is kept for display, because
    // "three types of delusion" reads differently from one even at the same
    // severity — but it does not inflate the score.
    const worst = hits.reduce((a, b) => (b.s > a.s ? b : a));
    const positives = hits.filter((h) => h.s > 0);
    return {
      ...base,
      assessed: true,
      score: worst.s,
      band: bandOf(worst.s),
      count: positives.length,
      detail: positives.length > 1 ? `${positives.length} present · worst: ${worst.v}` : '',
      unmapped: misses.length > 0,
    };
  }

  if (spec.kind === 'multi-intact') {
    const expected = spec.expected || [];
    const have = new Set((Array.isArray(raw) ? raw : [raw]).map(normKey));
    const missing = expected.filter((e) => !have.has(normKey(e)));
    const score = expected.length
      ? Math.min(MAX_SCORE, (missing.length / expected.length) * MAX_SCORE)
      : 0;
    return {
      ...base,
      assessed: true,
      score,
      band: bandOf(score),
      detail: missing.length ? `disoriented to ${missing.join(', ').toLowerCase()}` : 'fully oriented',
    };
  }

  if (spec.kind === 'banded') {
    const num = spec.parse === 'firstNumber' ? firstNumber(raw) : Number(raw);
    if (num === null || Number.isNaN(num)) {
      base.unmapped = true;
      return base;
    }
    const hit = (spec.bands || []).find(([lo, hi]) => num >= lo && num <= hi);
    if (!hit) {
      base.unmapped = true;
      base.detail = 'outside the expected range';
      return base;
    }
    return {
      ...base,
      assessed: true,
      score: hit[2],
      band: bandOf(hit[2]),
      value: num,
      display: spec.unit ? `${num} ${spec.unit}` : base.display,
    };
  }

  return base;
}

/**
 * Score a whole examination.
 *
 * `domains[d].score` is a weighted mean over ASSESSED fields only, as a
 * percentage of maximum severity, with `covered`/`total` reported beside it.
 * Averaging over unassessed fields would let a barely-discussed domain read as
 * reassuringly low, which is the single most dangerous thing a dashboard like
 * this can do — so coverage travels with every number it produces.
 */
export function scoreSession(data = {}) {
  const fields = {};
  Object.keys(FIELD_SCALE).forEach((k) => {
    const scored = scoreField(k, data[k]);
    if (scored) fields[k] = scored;
  });

  // An impression is the consultation's route to a severity; the instrument is
  // the measurement. Where both are present the measurement wins, and blanking
  // `assessed` is all that takes: the domain means, the scored list, the composite
  // and the coverage count all filter on it already, so the same severity cannot
  // be counted twice and nothing else needs to know this rule exists.
  Object.entries(IMPRESSION_FALLBACKS).forEach(([key, targets]) => {
    if (!fields[key]?.assessed) return;
    const measured = targets.find((t) => fields[t]?.assessed);
    if (!measured) return;
    fields[key] = {
      ...fields[key],
      assessed: false,
      superseded: true,
      detail: `superseded by the administered ${FIELD_SCALE[measured].label}`,
    };
  });

  const domains = {};
  Object.keys(DOMAINS).forEach((d) => {
    const members = SCORED_KEYS.filter((k) => FIELD_SCALE[k].domain === d);
    const assessed = members.filter((k) => fields[k]?.assessed);
    const wSum = assessed.reduce((t, k) => t + fields[k].weight, 0);
    const sSum = assessed.reduce((t, k) => t + fields[k].weight * fields[k].score, 0);
    domains[d] = {
      key: d,
      ...DOMAINS[d],
      score: wSum ? Math.round((sSum / (wSum * MAX_SCORE)) * 100) : null,
      band: wSum ? bandOf100((sSum / (wSum * MAX_SCORE)) * 100) : null,
      covered: assessed.length,
      total: members.length,
      // At least one scored member is a clinical impression, not a measured test.
      inferred: assessed.some((k) => fields[k].inferred),
      members,
      missing: members.filter((k) => !fields[k]?.assessed),
    };
  });

  // Composite index — weighted mean of the clinical domains. Risk has weight 0
  // and is excluded by construction: it is an action threshold, not a severity,
  // and burying it in an average is exactly how it gets missed.
  const clinical = DOMAIN_ORDER.map((d) => domains[d]).filter((x) => x.score !== null);
  const cw = clinical.reduce((t, d) => t + d.weight, 0);
  const composite = cw
    ? Math.round(clinical.reduce((t, d) => t + d.weight * d.score, 0) / cw)
    : null;
  // True when any contributing domain rested on a conversation-derived band.
  const compositeInferred = clinical.some((d) => d.inferred);

  const scoredList = SCORED_KEYS.map((k) => fields[k]).filter(Boolean);
  const criticalMissing = scoredList.filter((f) => f.critical && !f.assessed);

  return {
    scaleVersion: SCALE_VERSION,
    fields,
    domains,
    composite: { score: composite, band: bandOf100(composite), inferred: compositeInferred },
    coverage: {
      assessed: scoredList.filter((f) => f.assessed).length,
      total: scoredList.length,
      unmapped: scoredList.filter((f) => f.unmapped).map((f) => f.label),
      criticalMissing: criticalMissing.map((f) => f.label),
    },
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// PROGRESSION
// ─────────────────────────────────────────────────────────────────────────────

/** A change in severity, from the patient's point of view. */
export function deltaOf(now, before) {
  if (now === null || now === undefined || before === null || before === undefined) return null;
  const diff = Math.round((now - before) * 10) / 10;
  return {
    diff,
    dir: diff > 0 ? 'worse' : diff < 0 ? 'better' : 'same',
    label: diff > 0 ? `+${diff}` : `${diff}`,
  };
}

/**
 * Cheap fingerprint of the scored answers in a session: enough to tell "still
 * being filled in" apart from "already saved, untouched since". Separated, so
 * "ab" + "c" cannot collide with "a" + "bc".
 */
const fingerprint = (scores) =>
  SCORED_KEYS.map((k) => (scores.fields[k]?.assessed ? scores.fields[k].display : '')).join(' | ');

/**
 * Score every saved examination oldest → newest, so the dashboard can draw a
 * trend and diff the latest against the one before it.
 *
 * BOTH visits are re-scored from their stored `data` with the CURRENT scale, so
 * a delta is always apples-to-apples even after the scale has been re-weighted.
 * (Each session may also carry the scores it was saved with, for a printed
 * report to stay reproducible — that is a storage concern, not this one.)
 *
 * `provisional` is the examination being typed right now: shown as the latest
 * point so the doctor sees the assessment take shape, but excluded from the
 * saved trend line so an unsaved half-finished form cannot rewrite history.
 */
export function buildTrend(sessions = [], { dateKey = 'mseDate', provisional = null } = {}) {
  const visits = [...sessions]
    .map((s) => ({
      id: s.id,
      no: s.session_no,
      dateLabel: (s.data || {})[dateKey] || (s.saved_at ? String(s.saved_at).slice(0, 10) : '—'),
      sortKey: (s.data || {})[dateKey] || s.saved_at || '',
      scores: scoreSession(s.data || {}),
      saved: true,
    }))
    .sort((a, b) => String(a.sortKey).localeCompare(String(b.sortKey)));

  let current = visits[visits.length - 1] || null;
  const previous = visits[visits.length - 2] || null;

  if (provisional) {
    const scores = scoreSession(provisional);
    // The form still holds what was just saved, so an unchanged provisional is
    // the SAME examination, not a new one — otherwise every save would leave a
    // duplicate point on the chart labelled "unsaved".
    const last = visits[visits.length - 1];
    const unchanged = last && fingerprint(last.scores) === fingerprint(scores);
    if (scores.coverage.assessed >= 5 && !unchanged) {
      current = {
        id: '__provisional__',
        no: null,
        dateLabel: provisional[dateKey] || 'today',
        scores,
        saved: false,
      };
    }
  }

  return {
    visits,                                  // saved only — the trend line
    points: provisional && current && !current.saved ? [...visits, current] : visits,
    current,
    previous: current && !current.saved ? visits[visits.length - 1] || null : previous,
  };
}

/** Composite score per visit, for the progression chart. */
export const compositeSeries = (points = []) =>
  points.map((p) => ({
    label: p.dateLabel,
    value: p.scores.composite.score,
    saved: p.saved,
    // Drawn as a broken marker: this point rests at least partly on a clinical
    // impression rather than an administered test.
    inferred: !!p.scores.composite.inferred,
  }));

/** One domain's score per visit, for its sparkline. */
export const domainSeries = (points = [], domain) =>
  points.map((p) => ({
    label: p.dateLabel,
    value: p.scores.domains[domain]?.score ?? null,
    saved: p.saved,
    inferred: !!p.scores.domains[domain]?.inferred,
  }));
